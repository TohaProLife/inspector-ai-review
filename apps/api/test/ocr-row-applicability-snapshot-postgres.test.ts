import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrProfileV5 } from "../src/ocr-layout.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const databaseSuite = adminUrl ? describe : describe.skip;

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) =>
      `${JSON.stringify(key)}:${workerJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

databaseSuite("PostgreSQL OCR row applicability run snapshots", () => {
  it("carries latest synthetic subject decision and verifies both origins", async () => {
    const name = `inspector_ocr_review_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    const previous = Object.fromEntries([
      "INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE", "INSPECTOR_OCR_HEAT_ROW_PROFILE",
      "INSPECTOR_FACT_FAMILY_PROFILE", "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE",
      "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE",
      "INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE",
      "INSPECTOR_OCR_TABLE_ROWS_PROFILE",
    ].map((key) => [key, process.env[key]]));
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 2 });
      process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE = "v5";
      process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE = "v1";
      process.env.INSPECTOR_FACT_FAMILY_PROFILE = "v1";
      process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE = "v1";
      process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE = "v1";
      process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE = "v1";
      process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE = "v1";
      const organizationSlug = `ocr-review-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({ name: "Synthetic OCR review", address: "Test" });
      const file = { id: `FIL-${randomUUID()}`, name: "fixture.pdf", size: 120,
        stage: "RD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/fixture.pdf` };
      await repository.registerIngestedFiles(object.id, [file]);
      const user = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-review-${randomUUID()}`, displayName: "OCR Reviewer",
        password: "Synthetic-Test-Only-2026!", role: "INSPECTOR",
        capabilities: ["REVIEW_DECIDE"], objectApiIds: [object.id],
        objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: user.id,
        displayName: "OCR Reviewer", organizationId: user.organizationId,
        roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
        csrfHash: "b".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const run = (await database.query<{ id: string; object_id: string;
        organization_id: string; inspection_id: string;
        manifest_hash: string; release_id: string }>(
        `SELECT run.id, run.object_id, object.organization_id, run.inspection_id,
                manifest.sha256 AS manifest_hash, run.release_id
         FROM analysis_runs run
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE run.api_id = $1`, [check!.id])).rows[0];
      const manifestHash = run.manifest_hash.trim();
      const lines = [
        { text: "Наименование", bboxPx: [250, 100, 430, 130], score: 0.98 },
        { text: "Значение", bboxPx: [600, 100, 730, 130], score: 0.97 },
        { text: "Общая площадь здания", bboxPx: [250, 150, 510, 178], score: 0.96 },
        { text: "84,9 м²", bboxPx: [620, 151, 700, 178], score: 0.95 },
      ];
      const page: Record<string, unknown> = {
        schemaVersion: "document-ocr-page-v1", sourceFileId: file.id,
        inputSha256: file.sha256, pageNumber: 9,
        render: { sha256: "c".repeat(64), widthPx: 1000, heightPx: 1400,
          dpi: 120, rendererProfileId: boundedOcrProfileV5.rendererProfileId },
        provider: { profileId: boundedOcrProfileV5.ocrProviderProfileIds[0], script: "eslav" },
        lines,
      };
      page.contentHash = sha256(canonicalJson(page));
      const ocrContent = { schemaVersion: "analysis-stage-result-v2",
        jobType: "DOCUMENT_OCR_LAYOUT", inputManifestHash: manifestHash,
        disposition: "OCR_LAYOUT_BOUNDED", reasonCode: "BOUNDED_OCR_ONLY",
        providerKind: "OCR_LAYOUT", providerProfileId: boundedOcrProfileIdV5,
        providerConfigHash: boundedOcrConfigHashV5, outputCount: 1,
        analysis: { schemaVersion: "bounded-ocr-layout-analysis-v5", objectId: run.object_id,
          inputManifestHash: manifestHash, profile: boundedOcrProfileV5,
          sourceCount: 1, processedPageCount: 1,
          sources: [{ sourceFileId: file.id, sourceSha256: file.sha256,
            processedPageCount: 1, pages: [page] }] } };
      const ocrHash = sha256(canonicalJson(ocrContent));
      const evidence = (index: number, role: string) => ({ role, lineIndex: index,
        text: lines[index].text, bboxPx: lines[index].bboxPx, score: lines[index].score });
      const proposal = { sourceFileId: file.id, inputSha256: file.sha256,
        pageNumber: 9, ocrPageContentHash: page.contentHash, renderSha256: "c".repeat(64),
        headerEvidence: [evidence(0, "labelHeader"), evidence(1, "valueHeader")],
        labelEvidence: evidence(2, "rowLabel"), valueEvidence: evidence(3, "rawValue") };
      const tableRows: Record<string, unknown> = {
        schemaVersion: "ocr-table-row-proposals-v1",
        profileId: "conservative-ocr-table-rows-v1", ocrStageSha256: ocrHash,
        inputManifestHash: manifestHash, proposals: [proposal], abstentions: [],
        findingCount: 0,
      };
      tableRows.contentHash = sha256(workerJson(tableRows));
      const release = (await database.query<{ content_json: Record<string, any> }>(
        `SELECT content_json FROM analysis_releases WHERE release_id = $1`,
        [run.release_id])).rows[0].content_json;
      const ruleSlot = release.providerSlots.find(
        (slot: Record<string, unknown>) => slot.stageJobType === "RULE_EVALUATION");
      const ruleContent = { schemaVersion: "analysis-stage-result-v2",
        jobType: "RULE_EVALUATION", inputManifestHash: manifestHash,
        disposition: "RULES_EVALUATED", providerProfileId: ruleSlot.profileId,
        providerConfigHash: ruleSlot.configHash, outputCount: 8,
        ocrTableRows: tableRows };
      for (const [jobType, content, disposition, configHash, profile] of [
        ["DOCUMENT_OCR_LAYOUT", ocrContent, "OCR_LAYOUT_BOUNDED", boundedOcrConfigHashV5,
          boundedOcrProfileIdV5],
        ["RULE_EVALUATION", ruleContent, "RULES_EVALUATED", ruleSlot.configHash,
          ruleSlot.profileId],
      ] as const) {
        let job = (await database.query<{ id: string }>(
          `UPDATE analysis_jobs SET state = 'SUCCEEDED', completed_at = now()
           WHERE run_id = $1 AND job_type = $2 RETURNING id`,
          [run.id, jobType])).rows[0];
        // OCR job is normally inserted after text quality finds OCR_REQUIRED.
        // This repository fixture stores a synthetic committed page directly.
        if (!job && jobType === "DOCUMENT_OCR_LAYOUT") {
          job = (await database.query<{ id: string }>(
            `INSERT INTO analysis_jobs (
               organization_id, object_id, inspection_id, run_id, queue_name,
               job_type, scope_type, state, semantic_key, input_manifest_hash,
               release_id, completed_at
             ) VALUES ($1, $2, $3, $4, 'documents.render', $5, 'ANALYSIS',
               'SUCCEEDED', $6, $7, $8, now()) RETURNING id`,
            [run.organization_id, run.object_id, run.inspection_id, run.id,
              jobType, sha256(randomUUID()), manifestHash, run.release_id])).rows[0];
        }
        expect(job).toBeDefined();
        const canonical = canonicalJson(content);
        await database.query(
          `INSERT INTO analysis_stage_artifacts (
             id, job_id, run_id, job_type, schema_version, disposition,
             reason_code, provider_kind, provider_profile_id, provider_config_hash,
             output_count, input_manifest_hash, content_hash, byte_size, content_json
           ) VALUES ($1, $2, $3, $4, 'analysis-stage-result-v2', $5,
             'SYNTHETIC_TEST_ONLY', 'TEST', $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [randomUUID(), job.id, run.id, jobType, disposition,
            profile, configHash, jobType === "RULE_EVALUATION" ? 8 : 1,
            manifestHash, sha256(canonical), Buffer.byteLength(canonical, "utf8"), canonical]);
      }
      await database.query(
        `UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE id = $1`, [run.id]);
      const read = await repository.getOcrRowTranscriptionReviews(check!.id, actor);
      if (!read || typeof read === "string") throw new Error("No OCR candidates");
      const fingerprint = read.candidates[0].rowFingerprint;
      const command = () => ({ actor, idempotencyKey: randomUUID(),
        requestId: randomUUID(), traceId: randomUUID() });
      const transcription = await repository.recordOcrRowTranscriptionReviewCommand(
        check!.id, {
          schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: ocrHash,
          rowFingerprint: fingerprint, decision: "CONFIRMED_TRANSCRIPTION",
          reviewedLabel: "Общая площадь здания", reviewedValue: "84,9",
          reviewedUnit: "м²", basis: "Synthetic transcription; no real reviewer approval.",
        }, command());
      expect(transcription.kind).toBe("success");
      const sourceReview = await repository.recordSourceReviewCommand(
        object.id, file.id, { sourceSha256: file.sha256,
          revisionStatus: "CURRENT", approvalStatus: "APPROVED",
          linkGroupId: null, sectionCode: "AR", pageStages: {},
          basis: { reference: "Synthetic AR source review for database test only" } },
        command());
      expect(sourceReview.kind).toBe("success");
      const next = await repository.startCheck(object.id);
      expect(next).toBeDefined();
      expect(next!.id).not.toBe(check!.id);
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [next!.id]);
      const before = await repository.getOcrRowApplicabilityReviews(next!.id, actor);
      if (!before || typeof before === "string") throw new Error("No applicability candidates");
      expect(before.canReview).toBe(true);
      expect(before.items).toHaveLength(0);
      expect(before.candidates).toHaveLength(1);
      const candidate = before.candidates[0];
      expect(candidate).toMatchObject({
        sourceFileId: file.id, sourceSha256: file.sha256, pageNumber: 9,
        rowFingerprint: fingerprint, transcriptionDecision: "CONFIRMED_TRANSCRIPTION",
        sourceReview: { revisionStatus: "CURRENT", approvalStatus: "APPROVED",
          sectionCode: "AR", pageStage: "RD" },
        reviewedLabel: "Общая площадь здания", reviewedValue: "84,9", reviewedUnit: "м²",
      });
      expect(candidate.codeOptions).toContainEqual({
        parameterCode: "AR-040", attribute: "EVACUATION_CORRIDOR_WIDTH", stage: "RD" });
      expect(candidate.codeOptions).toContainEqual({
        parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA", stage: "RD" });
      expect(candidate.transcriptionDecisionId).toBe(transcription.kind === "success"
        ? transcription.value.id : "");
      expect(candidate.sourceReviewDecisionId).toBe(sourceReview.kind === "success"
        ? sourceReview.value.id : "");
      const input = {
        schemaVersion: "ocr-row-applicability-review-v1" as const,
        decision: "APPLICABLE" as const, targetCheckId: next!.id,
        sourceFileId: candidate.sourceFileId, sourceSha256: candidate.sourceSha256,
        pageNumber: candidate.pageNumber, renderSha256: candidate.renderSha256,
        ocrStageSha256: candidate.ocrStageSha256,
        rowFingerprint: candidate.rowFingerprint,
        transcriptionDecisionId: candidate.transcriptionDecisionId,
        transcriptionDecisionHash: candidate.transcriptionDecisionHash,
        sourceReviewDecisionId: candidate.sourceReviewDecisionId,
        sourceReviewDecisionHash: candidate.sourceReviewDecisionHash,
        parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
        stage: "RD" as const, entityKey: "synthetic-building-1",
        context: "Synthetic test applicability only",
        basis: "Synthetic test decision; no production fact or finding.",
      };
      const firstCommand = command();
      expect((await repository.recordOcrRowApplicabilityReviewCommand(next!.id, input,
        { ...firstCommand, actor: { ...actor, capabilities: [] } })).kind).toBe("forbidden");
      expect((await repository.recordOcrRowApplicabilityReviewCommand(next!.id,
        { ...input, sourceReviewDecisionHash: "d".repeat(64) }, command())).kind)
        .toBe("invalid_state");
      const first = await repository.recordOcrRowApplicabilityReviewCommand(
        next!.id, input, firstCommand);
      expect(first).toMatchObject({ kind: "success", replayed: false,
        value: { review: { decision: "APPLICABLE" }, eligibleForFactReview: true } });
      expect(await repository.recordOcrRowApplicabilityReviewCommand(
        next!.id, input, firstCommand)).toMatchObject({ kind: "success", replayed: true });
      expect((await repository.recordOcrRowApplicabilityReviewCommand(next!.id,
        { ...input, basis: "Different synthetic basis" }, firstCommand)).kind)
        .toBe("idempotency_conflict");
      expect(await repository.recordOcrRowApplicabilityReviewCommand(next!.id, input,
        command())).toMatchObject({ kind: "success", replayed: true });
      const after = await repository.getOcrRowApplicabilityReviews(next!.id, actor);
      expect(after && typeof after === "object" ? after.items : null).toHaveLength(1);
      expect(after && typeof after === "object" ? after.candidates : null).toHaveLength(1);
      expect(await repository.getOcrRowApplicabilityReviews(next!.id,
        { ...actor, userId: randomUUID() })).toBeUndefined();
      const unsure = await repository.recordOcrRowApplicabilityReviewCommand(next!.id,
        { ...input, decision: "UNSURE", basis: "Synthetic uncertainty supersedes positive judgment." },
        command());
      expect(unsure).toMatchObject({ kind: "success", replayed: false,
        value: { eligibleForFactReview: false } });
      const beforeTamper = await repository.getOcrRowApplicabilityReviews(next!.id, actor);
      expect(beforeTamper && typeof beforeTamper === "object"
        ? beforeTamper.items.map((item) => item.review.decision) : null)
        .toEqual(["APPLICABLE", "UNSURE"]);
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [next!.id]);
      const third = await repository.startCheck(object.id);
      expect(third).toBeDefined();
      const carriedUnsure = await repository.getOcrRowApplicabilitySnapshots(third!.id, actor);
      if (!carriedUnsure || typeof carriedUnsure === "string") {
        throw new Error("No applicability snapshot read");
      }
      expect(carriedUnsure.items).toHaveLength(1);
      expect(carriedUnsure.items[0]).toMatchObject({
        decisionId: unsure.kind === "success" ? unsure.value.id : "",
        originCheckId: next!.id,
        sourceFileId: file.id, sourceSha256: file.sha256,
        rowFingerprint: fingerprint, review: { decision: "UNSURE" },
        eligibleForFactReview: false,
      });
      expect(await repository.getOcrTypedFactCandidates(third!.id, actor)).toEqual({
        schemaVersion: "ocr-typed-fact-candidates-v1", items: [],
        snapshotCount: 1, abstainedCount: 1, findingCount: 0, coverageCount: 0,
      });
      expect(await repository.getOcrRowApplicabilitySnapshots(third!.id,
        { ...actor, userId: randomUUID() })).toBeUndefined();
      await expect(database.query(`UPDATE run_ocr_applicability_snapshots
        SET review_json = '{}'::jsonb`)).rejects.toThrow();
      const counts = (await database.query<{ snapshots: string; findings: string;
        coverage: string }>(
        `SELECT (SELECT count(*)::text FROM run_ocr_applicability_snapshots) AS snapshots,
                (SELECT count(*)::text FROM findings) AS findings,
                (SELECT count(*)::text FROM parameter_coverage) AS coverage`)).rows[0];
      expect(counts).toEqual({ snapshots: "1", findings: "0", coverage: "0" });

      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [third!.id]);
      const applied = await repository.recordOcrRowApplicabilityReviewCommand(third!.id,
        { ...input, targetCheckId: third!.id,
          basis: "Later synthetic applicability decision replaces uncertainty." }, command());
      expect(applied).toMatchObject({ kind: "success",
        value: { eligibleForFactReview: true } });
      const fourth = await repository.startCheck(object.id);
      expect(fourth).toBeDefined();
      const carriedApplied = await repository.getOcrRowApplicabilitySnapshots(fourth!.id, actor);
      if (!carriedApplied || typeof carriedApplied === "string") {
        throw new Error("No later applicability snapshot read");
      }
      expect(carriedApplied.items).toHaveLength(1);
      expect(carriedApplied.items[0]).toMatchObject({
        decisionId: applied.kind === "success" ? applied.value.id : "",
        originCheckId: third!.id, review: { decision: "APPLICABLE" },
        eligibleForFactReview: true,
      });
      const typedCandidates = await repository.getOcrTypedFactCandidates(fourth!.id, actor);
      if (!typedCandidates || typeof typedCandidates === "string") {
        throw new Error("No OCR typed fact candidate read");
      }
      expect(typedCandidates).toMatchObject({
        schemaVersion: "ocr-typed-fact-candidates-v1", snapshotCount: 1,
        abstainedCount: 0, findingCount: 0, coverageCount: 0,
        items: [{ schemaVersion: "typed-fact-v2", targetCheckId: fourth!.id,
          parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
          rawValue: "84,9", rawUnit: "м²",
          locator: { kind: "OCR_ROW", originCheckId: third!.id,
            applicabilityDecisionId: applied.kind === "success" ? applied.value.id : "" } }],
      });
      expect(await repository.getOcrTypedFactCandidates(fourth!.id,
        { ...actor, userId: randomUUID() })).toBeUndefined();
      // A forged immutable row cannot claim another subject key for a real decision.
      await database.query(
        `INSERT INTO run_ocr_applicability_snapshots (
           run_id, object_id, source_file_id, source_sha256,
           row_fingerprint_sha256, parameter_code, attribute, stage,
           entity_key, decision_id, decision_content_hash, origin_run_id,
           transcription_decision_id, source_review_decision_id,
           review_json, eligible_for_fact_review
         ) SELECT run_id, object_id, source_file_id, source_sha256,
                  row_fingerprint_sha256, parameter_code, attribute, stage,
                  $1, decision_id, decision_content_hash, origin_run_id,
                  transcription_decision_id, source_review_decision_id,
                  review_json, eligible_for_fact_review
           FROM run_ocr_applicability_snapshots WHERE run_id =
             (SELECT id FROM analysis_runs WHERE api_id = $2)`,
        ["forged-entity", fourth!.id]);
      await expect(repository.getOcrRowApplicabilitySnapshots(fourth!.id, actor))
        .rejects.toThrow(/snapshot key integrity/);
      await expect(repository.getOcrTypedFactCandidates(fourth!.id, actor))
        .rejects.toThrow(/snapshot key integrity/);
      // Forged latest journal row must abort the next run, never revive prior APPLICABLE.
      await database.query(
        `INSERT INTO ocr_row_applicability_decisions (
           object_id, run_id, source_file_id, source_sha256,
           row_fingerprint_sha256, transcription_decision_id,
           source_review_decision_id, review_json, actor_id,
           content_hash, created_at
         ) SELECT object_id, run_id, source_file_id, source_sha256,
                  row_fingerprint_sha256, transcription_decision_id,
                  source_review_decision_id, review_json, actor_id,
                  $1, now() + interval '1 day'
           FROM ocr_row_applicability_decisions WHERE id = $2`,
        ["e".repeat(64), applied.kind === "success" ? applied.value.id : randomUUID()]);
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [fourth!.id]);
      await expect(repository.startCheck(object.id))
        .rejects.toThrow(/OCR applicability decision hash integrity/);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await repository?.close();
      await database?.end();
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  }, 60_000);
});
