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

const settings = ["INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE",
  "INSPECTOR_OCR_HEAT_ROW_PROFILE", "INSPECTOR_FACT_FAMILY_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE",
  "INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE",
  "INSPECTOR_OCR_TABLE_ROWS_PROFILE",
  "INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE"];

function selectSyntheticRelease(): void {
  Object.assign(process.env, {
    INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE: "v5",
    INSPECTOR_OCR_HEAT_ROW_PROFILE: "v1",
    INSPECTOR_FACT_FAMILY_PROFILE: "v1",
    INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE: "v1",
    INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE: "v1",
    INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE: "v1",
    INSPECTOR_OCR_TABLE_ROWS_PROFILE: "v1",
    INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE: "v1",
  });
}

function restoreSettings(previous: Record<string, string | undefined>): void {
  for (const key of settings) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

databaseSuite("OCR fact pair append-only journal", () => {
  it("keeps an unreviewed run empty, rejects forged pair and stored tampering", async () => {
    const name = `inspector_ocr_pair_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    const previous = Object.fromEntries(settings.map((key) => [key, process.env[key]]));
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 2 });
      selectSyntheticRelease();
      const organizationSlug = `ocr-pair-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(),
        parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({
        name: "Synthetic OCR pair journal", address: "Test",
      });
      const file = { id: `FIL-${randomUUID()}`, name: "fixture.pdf", size: 120,
        stage: "RD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/fixture.pdf` };
      await repository.registerIngestedFiles(object.id, [file]);
      const user = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-pair-${randomUUID()}`,
        displayName: "OCR pair reviewer", password: "Synthetic-Test-Only-2026!",
        role: "INSPECTOR", capabilities: ["REVIEW_DECIDE"],
        objectApiIds: [object.id], objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: user.id,
        displayName: "OCR pair reviewer", organizationId: user.organizationId,
        roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
        csrfHash: "b".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [check!.id]);
      const scoped = await repository.getOcrFactPairReviews(check!.id, actor);
      expect(scoped).toMatchObject({ items: [], candidates: [], canReview: true });
      expect(await repository.getOcrFactPairReviews(check!.id,
        { ...actor, userId: randomUUID() })).toBeUndefined();
      const run = (await database.query<{
        id: string; object_id: string; sha256: string;
      }>(`SELECT run.id, run.object_id, manifest.sha256
          FROM analysis_runs run JOIN input_manifests manifest ON manifest.id = run.manifest_id
          WHERE run.api_id = $1`, [check!.id])).rows[0];
      const forged = {
        schemaVersion: "ocr-fact-pair-review-v1" as const,
        decision: "PAIR_CONFIRMED" as const, targetCheckId: check!.id,
        inputManifestHash: run.sha256.trim(), objectId: object.id,
        parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
        pdFactId: "1".repeat(64), pdLocatorHash: "2".repeat(64),
        rdFactId: "3".repeat(64), rdLocatorHash: "4".repeat(64),
        entityKey: "synthetic", context: "synthetic", linkGroupId: "synthetic",
        basis: "Synthetic forged pair; must be rejected.",
      };
      const command = () => ({ actor, idempotencyKey: randomUUID(),
        requestId: randomUUID(), traceId: randomUUID() });
      expect((await repository.recordOcrFactPairReviewCommand(
        check!.id, forged, command())).kind).toBe("invalid_state");
      expect((await database.query<{ decisions: string; audits: string;
        findings: string; coverage: string }>(
        `SELECT (SELECT count(*)::text FROM ocr_fact_pair_decisions) AS decisions,
                (SELECT count(*)::text FROM audit_events
                 WHERE action = 'OCR_FACT_PAIR_REVIEW') AS audits,
                (SELECT count(*)::text FROM findings) AS findings,
                (SELECT count(*)::text FROM parameter_coverage) AS coverage`,
      )).rows[0]).toEqual({ decisions: "0", audits: "0",
        findings: "0", coverage: "0" });
      const connection = await database.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SET LOCAL session_replication_role = replica");
        await connection.query(
          `INSERT INTO ocr_fact_pair_decisions (
             object_id, run_id, input_manifest_hash, artifact_hash,
             parameter_code, attribute, entity_key, pd_fact_id, rd_fact_id,
             pd_locator_hash, rd_locator_hash, pd_source_file_id, rd_source_file_id,
             pd_source_review_decision_id, rd_source_review_decision_id,
             review_json, actor_id, content_hash
           ) VALUES ($1, $2, $3, $4, 'PZ-002', 'BUILDING_TOTAL_AREA',
                     'synthetic', $5, $6, $7, $8, $9, $10, $11, $12,
                     '{}'::jsonb, $13, $14)`,
          [run.object_id, run.id, run.sha256.trim(), "5".repeat(64),
            "1".repeat(64), "3".repeat(64), "2".repeat(64), "4".repeat(64),
            randomUUID(), randomUUID(), randomUUID(), randomUUID(),
            actor.userId, "6".repeat(64)],
        );
        await connection.query("COMMIT");
      } finally {
        connection.release();
      }
      await expect(repository.getOcrFactPairReviews(check!.id, actor))
        .rejects.toThrow("OCR fact pair decision integrity check failed");
      await expect(database.query(`UPDATE ocr_fact_pair_decisions SET entity_key = 'tampered'`))
        .rejects.toThrow();
    } finally {
      restoreSettings(previous);
      await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000); // Includes isolated database setup and a complete durable lifecycle.

  it("saves and replays only a synthetic verified PD/RD pair, then rejects source tamper", async () => {
    const name = `inspector_ocr_pair_positive_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    const previous = Object.fromEntries(settings.map((key) => [key, process.env[key]]));
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 2 });
      selectSyntheticRelease();
      const organizationSlug = `ocr-pair-positive-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(),
        parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({
        name: "Synthetic OCR PD/RD pair", address: "Test",
      });
      const files = [
        { id: `FIL-${randomUUID()}`, name: "synthetic-pd.pdf", size: 120,
          stage: "PD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
          scanStatus: "CLEAN" as const, status: "STORED" as const,
          storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/synthetic-pd.pdf` },
        { id: `FIL-${randomUUID()}`, name: "synthetic-rd.pdf", size: 120,
          stage: "RD" as const, mimeType: "application/pdf", sha256: "b".repeat(64),
          scanStatus: "CLEAN" as const, status: "STORED" as const,
          storageKey: `objects/${object.id}/originals/${"b".repeat(64)}/synthetic-rd.pdf` },
      ];
      await repository.registerIngestedFiles(object.id, files);
      const user = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-pair-positive-${randomUUID()}`,
        displayName: "Synthetic OCR pair reviewer",
        password: "Synthetic-Test-Only-2026!", role: "INSPECTOR",
        capabilities: ["REVIEW_DECIDE"], objectApiIds: [object.id],
        objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: user.id,
        displayName: "Synthetic OCR pair reviewer", organizationId: user.organizationId,
        roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
        csrfHash: "c".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const command = () => ({ actor, idempotencyKey: randomUUID(),
        requestId: randomUUID(), traceId: randomUUID() });

      const firstRun = await repository.startCheck(object.id);
      expect(firstRun).toBeDefined();
      const run = (await database.query<{
        id: string; object_id: string; organization_id: string;
        inspection_id: string; manifest_hash: string; release_id: string;
      }>(
        `SELECT run.id, run.object_id, object.organization_id, run.inspection_id,
                manifest.sha256 AS manifest_hash, run.release_id
         FROM analysis_runs run JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE run.api_id = $1`, [firstRun!.id])).rows[0];
      const manifestHash = run.manifest_hash.trim();
      const pages = files.map((file, index) => {
        const lines = [
          { text: "Наименование", bboxPx: [250, 100, 430, 130], score: 0.98 },
          { text: "Значение", bboxPx: [600, 100, 730, 130], score: 0.97 },
          { text: "Общая площадь здания", bboxPx: [250, 150, 510, 178], score: 0.96 },
          { text: index === 0 ? "84,9 м²" : "85,0 м²",
            bboxPx: [620, 151, 700, 178], score: 0.95 },
        ];
        const page: Record<string, unknown> = {
          schemaVersion: "document-ocr-page-v1", sourceFileId: file.id,
          inputSha256: file.sha256, pageNumber: index === 0 ? 4 : 9,
          render: { sha256: index === 0 ? "d".repeat(64) : "e".repeat(64),
            widthPx: 1000, heightPx: 1400, dpi: 120,
            rendererProfileId: boundedOcrProfileV5.rendererProfileId },
          provider: { profileId: boundedOcrProfileV5.ocrProviderProfileIds[0],
            script: "eslav" }, lines,
        };
        page.contentHash = sha256(canonicalJson(page));
        return { file, page, lines };
      });
      const ocrContent = {
        schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
        inputManifestHash: manifestHash, disposition: "OCR_LAYOUT_BOUNDED",
        reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
        providerProfileId: boundedOcrProfileIdV5,
        providerConfigHash: boundedOcrConfigHashV5, outputCount: 2,
        analysis: { schemaVersion: "bounded-ocr-layout-analysis-v5",
          objectId: run.object_id, inputManifestHash: manifestHash,
          profile: boundedOcrProfileV5, sourceCount: 2, processedPageCount: 2,
          sources: pages.map(({ file, page }) => ({ sourceFileId: file.id,
            sourceSha256: file.sha256, processedPageCount: 1, pages: [page] })) },
      };
      const ocrHash = sha256(canonicalJson(ocrContent));
      const proposals = pages.map(({ file, page, lines }) => {
        const evidence = (index: number, role: string) => ({ role, lineIndex: index,
          text: lines[index].text, bboxPx: lines[index].bboxPx,
          score: lines[index].score });
        return { sourceFileId: file.id, inputSha256: file.sha256,
          pageNumber: page.pageNumber, ocrPageContentHash: page.contentHash,
          renderSha256: (page.render as { sha256: string }).sha256,
          headerEvidence: [evidence(0, "labelHeader"), evidence(1, "valueHeader")],
          labelEvidence: evidence(2, "rowLabel"), valueEvidence: evidence(3, "rawValue") };
      });
      const tableRows: Record<string, unknown> = {
        schemaVersion: "ocr-table-row-proposals-v1",
        profileId: "conservative-ocr-table-rows-v1", ocrStageSha256: ocrHash,
        inputManifestHash: manifestHash, proposals, abstentions: [], findingCount: 0,
      };
      tableRows.contentHash = sha256(workerJson(tableRows));
      const release = (await database.query<{ content_json: Record<string, any> }>(
        `SELECT content_json FROM analysis_releases WHERE release_id = $1`,
        [run.release_id])).rows[0].content_json;
      const ruleSlot = release.providerSlots.find(
        (slot: Record<string, unknown>) => slot.stageJobType === "RULE_EVALUATION");
      const ruleContent = {
        schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
        inputManifestHash: manifestHash, disposition: "RULES_EVALUATED",
        providerProfileId: ruleSlot.profileId, providerConfigHash: ruleSlot.configHash,
        outputCount: 8, ocrTableRows: tableRows,
      };
      for (const [jobType, content, disposition, configHash, profile, count] of [
        ["DOCUMENT_OCR_LAYOUT", ocrContent, "OCR_LAYOUT_BOUNDED",
          boundedOcrConfigHashV5, boundedOcrProfileIdV5, 2],
        ["RULE_EVALUATION", ruleContent, "RULES_EVALUATED",
          ruleSlot.configHash, ruleSlot.profileId, 8],
      ] as const) {
        let job = (await database.query<{ id: string }>(
          `UPDATE analysis_jobs SET state = 'SUCCEEDED', completed_at = now()
           WHERE run_id = $1 AND job_type = $2 RETURNING id`,
          [run.id, jobType])).rows[0];
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
            profile, configHash, count, manifestHash, sha256(canonical),
            Buffer.byteLength(canonical, "utf8"), canonical]);
      }
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE id = $1`,
        [run.id]);
      const transcriptionRead = await repository.getOcrRowTranscriptionReviews(
        firstRun!.id, actor);
      if (!transcriptionRead || typeof transcriptionRead === "string") {
        throw new Error("No synthetic OCR transcription candidates");
      }
      expect(transcriptionRead.candidates).toHaveLength(2);
      for (const candidate of transcriptionRead.candidates) {
        const index = files.findIndex((file) => file.id === candidate.proposal.sourceFileId);
        const decision = await repository.recordOcrRowTranscriptionReviewCommand(
          firstRun!.id, {
            schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: ocrHash,
            rowFingerprint: candidate.rowFingerprint,
            decision: "CONFIRMED_TRANSCRIPTION", reviewedLabel: "Общая площадь здания",
            reviewedValue: index === 0 ? "84,9" : "85,0", reviewedUnit: "м²",
            basis: "Synthetic test transcription; no real document or expert.",
          }, command());
        expect(decision.kind).toBe("success");
      }
      for (const file of files) {
        const source = await repository.recordSourceReviewCommand(
          object.id, file.id, { sourceSha256: file.sha256,
            revisionStatus: "CURRENT", approvalStatus: "APPROVED",
            linkGroupId: "synthetic-building-1",
            sectionCode: file.stage === "PD" ? "PZ" : "AR",
            pageStages: {}, basis: { reference: "Synthetic source review only" } },
          command());
        expect(source.kind).toBe("success");
      }
      const secondRun = await repository.startCheck(object.id);
      expect(secondRun).toBeDefined();
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [secondRun!.id]);
      const applicabilityRead = await repository.getOcrRowApplicabilityReviews(
        secondRun!.id, actor);
      if (!applicabilityRead || typeof applicabilityRead === "string") {
        throw new Error("No synthetic applicability candidates");
      }
      expect(applicabilityRead.candidates).toHaveLength(2);
      for (const candidate of applicabilityRead.candidates) {
        const file = files.find((entry) => entry.id === candidate.sourceFileId)!;
        const decision = await repository.recordOcrRowApplicabilityReviewCommand(
          secondRun!.id, {
            schemaVersion: "ocr-row-applicability-review-v1", decision: "APPLICABLE",
            targetCheckId: secondRun!.id, sourceFileId: candidate.sourceFileId,
            sourceSha256: candidate.sourceSha256, pageNumber: candidate.pageNumber,
            renderSha256: candidate.renderSha256,
            ocrStageSha256: candidate.ocrStageSha256,
            rowFingerprint: candidate.rowFingerprint,
            transcriptionDecisionId: candidate.transcriptionDecisionId,
            transcriptionDecisionHash: candidate.transcriptionDecisionHash,
            sourceReviewDecisionId: candidate.sourceReviewDecisionId,
            sourceReviewDecisionHash: candidate.sourceReviewDecisionHash,
            parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
            stage: file.stage, entityKey: "synthetic-building-1",
            context: "Здание целиком",
            basis: "Synthetic test applicability; no real document or expert.",
          }, command());
        expect(decision.kind).toBe("success");
      }
      const thirdRun = await repository.startCheck(object.id);
      expect(thirdRun).toBeDefined();
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [thirdRun!.id]);
      const typed = await repository.getOcrTypedFactCandidates(thirdRun!.id, actor);
      if (!typed || typeof typed === "string") throw new Error("No synthetic typed facts");
      expect(typed.items).toHaveLength(2);
      const before = await repository.getOcrFactPairReviews(thirdRun!.id, actor);
      if (!before || typeof before === "string") throw new Error("No synthetic pair read");
      expect(before.items).toHaveLength(0);
      expect(before.candidates).toHaveLength(1);
      const candidate = before.candidates[0];
      const input = {
        schemaVersion: "ocr-fact-pair-review-v1" as const,
        decision: "PAIR_CONFIRMED" as const, targetCheckId: thirdRun!.id,
        inputManifestHash: typed.items[0].inputManifestHash, objectId: object.id,
        parameterCode: candidate.parameterCode, attribute: candidate.attribute,
        pdFactId: candidate.pdFact.factId, pdLocatorHash: candidate.pdLocatorHash,
        rdFactId: candidate.rdFact.factId, rdLocatorHash: candidate.rdLocatorHash,
        entityKey: candidate.entityKey, context: candidate.context,
        linkGroupId: candidate.linkGroupId,
        basis: "Synthetic test pair only; no real document or expert.",
      };
      const firstCommand = command();
      expect((await repository.recordOcrFactPairReviewCommand(thirdRun!.id,
        { ...input, rdLocatorHash: "f".repeat(64) }, command())).kind)
        .toBe("invalid_state");
      const first = await repository.recordOcrFactPairReviewCommand(
        thirdRun!.id, input, firstCommand);
      expect(first).toMatchObject({ kind: "success", replayed: false,
        value: { review: { decision: "PAIR_CONFIRMED" }, eligibleForPairReview: true } });
      expect(await repository.recordOcrFactPairReviewCommand(
        thirdRun!.id, input, firstCommand)).toMatchObject({ kind: "success", replayed: true });
      expect((await repository.recordOcrFactPairReviewCommand(thirdRun!.id,
        { ...input, basis: "Different synthetic basis" }, firstCommand)).kind)
        .toBe("idempotency_conflict");
      expect(await repository.recordOcrFactPairReviewCommand(thirdRun!.id,
        input, command())).toMatchObject({ kind: "success", replayed: true });
      const after = await repository.getOcrFactPairReviews(thirdRun!.id, actor);
      expect(after && typeof after === "object" ? after.items : null).toHaveLength(1);
      const currentQuantity = await repository.getOcrFactPairQuantityReviews(
        thirdRun!.id, actor);
      expect(currentQuantity).toMatchObject({ items: [], candidates: [],
        canReview: false, reasonCode: "OCR_QUANTITY_SNAPSHOT_REQUIRED" });
      expect(await repository.getOcrFactPairComparisonPreviews(thirdRun!.id, actor))
        .toEqual({ items: [] });
      const currentQuantityAttempt = await repository.recordOcrFactPairQuantityReviewCommand(
        thirdRun!.id, {
          schemaVersion: "ocr-fact-pair-quantity-review-v1", decision: "UNSURE",
          targetCheckId: thirdRun!.id, inputManifestHash: input.inputManifestHash,
          objectId: object.id, parameterCode: input.parameterCode,
          attribute: input.attribute, entityKey: input.entityKey,
          context: input.context, pdFactId: input.pdFactId,
          pdLocatorHash: input.pdLocatorHash, rdFactId: input.rdFactId,
          rdLocatorHash: input.rdLocatorHash,
          pairDecisionId: first.kind === "success" ? first.value.id : randomUUID(),
          pairTargetReviewHash: "f".repeat(64), pdDenominatorAffirmed: false,
          pdPageNumber: candidate.pdFact.pageNumber,
          rdPageNumber: candidate.rdFact.pageNumber,
          basis: { scope: "Synthetic source scope for test",
            quantityType: "Synthetic quantity type for test",
            period: "Synthetic common period for test",
            aggregation: "Synthetic aggregation rule for test" },
        }, command());
      expect(currentQuantityAttempt).toMatchObject({ kind: "invalid_state",
        code: "OCR_QUANTITY_SNAPSHOT_REQUIRED" });
      const fourthRun = await repository.startCheck(object.id);
      expect(fourthRun).toBeDefined();
      const confirmedSnapshot = await repository.getOcrFactPairSnapshots(
        fourthRun!.id, actor);
      if (!confirmedSnapshot || typeof confirmedSnapshot === "string") {
        throw new Error("No synthetic pair snapshot read");
      }
      expect(confirmedSnapshot.items).toHaveLength(1);
      expect(confirmedSnapshot.items[0]).toMatchObject({
        decisionId: first.kind === "success" ? first.value.id : "",
        originCheckId: thirdRun!.id, targetCheckId: fourthRun!.id,
        actorId: actor.userId, reasonCode: "REBOUND", eligibleForPairReview: true,
        originReview: { decision: "PAIR_CONFIRMED" },
        review: { decision: "PAIR_CONFIRMED" },
      });
      expect(confirmedSnapshot.items[0].review?.pdFactId).not.toBe(input.pdFactId);
      expect(confirmedSnapshot.items[0].review?.rdFactId).not.toBe(input.rdFactId);
      expect(confirmedSnapshot.items[0].targetReviewHash).not.toBe(first.kind === "success"
        ? first.value.contentHash : "");
      await expect(database.query(`UPDATE run_ocr_fact_pair_snapshots
        SET eligible_for_pair_review = false`)).rejects.toThrow();
      await expect(database.query(`DELETE FROM run_ocr_fact_pair_snapshots`))
        .rejects.toThrow();
      const tamperSnapshot = await database.connect();
      try {
        await tamperSnapshot.query("BEGIN");
        await tamperSnapshot.query("SET LOCAL session_replication_role = replica");
        await tamperSnapshot.query(`UPDATE run_ocr_fact_pair_snapshots
          SET target_review_hash = $1 WHERE decision_id = $2`,
        ["f".repeat(64), confirmedSnapshot.items[0].decisionId]);
        await tamperSnapshot.query("COMMIT");
        await expect(repository.getOcrFactPairSnapshots(fourthRun!.id, actor))
          .rejects.toThrow("OCR fact pair snapshot target integrity check failed");
        await tamperSnapshot.query("BEGIN");
        await tamperSnapshot.query("SET LOCAL session_replication_role = replica");
        await tamperSnapshot.query(`UPDATE run_ocr_fact_pair_snapshots
          SET target_review_hash = $1 WHERE decision_id = $2`,
        [confirmedSnapshot.items[0].targetReviewHash,
          confirmedSnapshot.items[0].decisionId]);
        await tamperSnapshot.query("COMMIT");
      } finally {
        tamperSnapshot.release();
      }
      expect((await database.query<{ decisions: string; audits: string;
        findings: string; coverage: string }>(
        `SELECT (SELECT count(*)::text FROM ocr_fact_pair_decisions) AS decisions,
                (SELECT count(*)::text FROM audit_events
                 WHERE action = 'OCR_FACT_PAIR_REVIEW') AS audits,
                (SELECT count(*)::text FROM findings) AS findings,
                (SELECT count(*)::text FROM parameter_coverage) AS coverage`,
      )).rows[0]).toEqual({ decisions: "1", audits: "1",
        findings: "0", coverage: "0" });
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL'
        WHERE api_id = $1`, [fourthRun!.id]);
      const quantityRead = await repository.getOcrFactPairQuantityReviews(
        fourthRun!.id, actor);
      if (!quantityRead || typeof quantityRead === "string") {
        throw new Error("No synthetic quantity read");
      }
      expect(quantityRead).toMatchObject({ items: [], effectiveItems: [],
        canReview: true, reasonCode: null });
      expect(quantityRead.candidates).toHaveLength(1);
      const quantityCandidate = quantityRead.candidates[0];
      const quantityInput = {
        schemaVersion: "ocr-fact-pair-quantity-review-v1" as const,
        decision: "SAME_SCALAR_TOTAL" as const,
        targetCheckId: fourthRun!.id,
        inputManifestHash: quantityCandidate.pdFact.inputManifestHash,
        objectId: object.id,
        parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
        entityKey: quantityCandidate.pdFact.entityKey,
        context: quantityCandidate.pdFact.context,
        pdFactId: quantityCandidate.pdFact.factId,
        pdLocatorHash: sha256(canonicalJson(quantityCandidate.pdFact.locator)),
        rdFactId: quantityCandidate.rdFact.factId,
        rdLocatorHash: sha256(canonicalJson(quantityCandidate.rdFact.locator)),
        pairDecisionId: quantityCandidate.pairSnapshot.decisionId,
        pairTargetReviewHash: quantityCandidate.pairSnapshot.targetReviewHash!,
        pdDenominatorAffirmed: true,
        pdPageNumber: quantityCandidate.pdFact.pageNumber,
        rdPageNumber: quantityCandidate.rdFact.pageNumber,
        basis: {
          scope: "Synthetic whole building scalar total",
          quantityType: "Synthetic building total floor area",
          period: "Synthetic same design revision period",
          aggregation: "Synthetic single building total aggregation",
        },
      };
      const quantityCommand = command();
      const quantityPositive = await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, quantityInput, quantityCommand);
      expect(quantityPositive).toMatchObject({ kind: "success", replayed: false,
        value: { eligibleForComparison: true,
          review: { decision: "SAME_SCALAR_TOTAL" } } });
      const positivePreview = await repository.getOcrFactPairComparisonPreviews(
        fourthRun!.id, actor);
      expect(positivePreview).toMatchObject({ items: [{
        quantityDecisionId: quantityPositive.kind === "success"
          ? quantityPositive.value.id : "",
        preview: { purpose: "REVIEW_ONLY", status: "COMPARISON_CANDIDATE",
          comparison: { parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
            pdValue: "84.9", rdValue: "85", exceedsThreshold: false,
            quantityEvidenceHash: quantityPositive.kind === "success"
              ? quantityPositive.value.evidenceHash : "" } },
      }] });
      const beforeQuantityOverride = await repository.getOcrFactPairQuantityReviews(
        fourthRun!.id, actor);
      if (!beforeQuantityOverride || typeof beforeQuantityOverride === "string") {
        throw new Error("No synthetic positive quantity history");
      }
      expect(await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, quantityInput, quantityCommand))
        .toMatchObject({ kind: "success", replayed: true });
      expect((await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, { ...quantityInput,
          pdLocatorHash: "f".repeat(64) }, command())).kind).toBe("invalid_state");
      expect((await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, { ...quantityInput,
          basis: { ...quantityInput.basis, scope: "Synthetic altered quantity scope" } },
        quantityCommand)).kind).toBe("idempotency_conflict");
      const quantityNegative = await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, { ...quantityInput, decision: "NOT_COMPARABLE" }, command());
      expect(quantityNegative).toMatchObject({ kind: "success", replayed: false,
        value: { eligibleForComparison: false,
          review: { decision: "NOT_COMPARABLE" } } });
      const quantityUnsure = await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, { ...quantityInput, decision: "UNSURE" }, command());
      expect(quantityUnsure).toMatchObject({ kind: "success", replayed: false,
        value: { eligibleForComparison: false,
          review: { decision: "UNSURE" } } });
      const quantityAfter = await repository.getOcrFactPairQuantityReviews(
        fourthRun!.id, actor);
      if (!quantityAfter || typeof quantityAfter === "string") {
        throw new Error("No synthetic quantity history");
      }
      expect(quantityAfter.items).toHaveLength(3);
      expect(quantityAfter.effectiveItems).toHaveLength(1);
      expect(quantityAfter.effectiveItems[0].review.decision).toBe("UNSURE");
      expect(await repository.getOcrFactPairComparisonPreviews(fourthRun!.id, actor))
        .toMatchObject({ items: [{
          quantityDecisionId: quantityUnsure.kind === "success"
            ? quantityUnsure.value.id : "",
          preview: { purpose: "REVIEW_ONLY", status: "ABSTAIN",
            reasonCode: "QUANTITY_CONTEXT_UNVERIFIED", comparison: null },
        }] });
      const originalQuantityRead = repository.getOcrFactPairQuantityReviews.bind(repository);
      repository.getOcrFactPairQuantityReviews = async () => beforeQuantityOverride;
      try {
        await expect(repository.getOcrFactPairComparisonPreviews(fourthRun!.id, actor))
          .rejects.toThrow("OCR comparison stale quantity decision; retry");
      } finally {
        repository.getOcrFactPairQuantityReviews = originalQuantityRead;
      }
      await expect(database.query(`UPDATE ocr_fact_pair_quantity_decisions
        SET evidence_hash = '${"f".repeat(64)}'`)).rejects.toThrow();
      await expect(database.query(`DELETE FROM ocr_fact_pair_quantity_decisions`))
        .rejects.toThrow();
      const tamperQuantity = await database.connect();
      try {
        await tamperQuantity.query("BEGIN");
        await tamperQuantity.query("SET LOCAL session_replication_role = replica");
        await tamperQuantity.query(`UPDATE ocr_fact_pair_quantity_decisions
          SET evidence_hash = $1 WHERE id = $2`,
        ["f".repeat(64), quantityAfter.items[0].id]);
        await tamperQuantity.query("COMMIT");
        await expect(repository.getOcrFactPairQuantityReviews(fourthRun!.id, actor))
          .rejects.toThrow("OCR quantity decision provenance integrity check failed");
        await expect(repository.getOcrFactPairComparisonPreviews(fourthRun!.id, actor))
          .rejects.toThrow("OCR quantity decision provenance integrity check failed");
        await tamperQuantity.query("BEGIN");
        await tamperQuantity.query("SET LOCAL session_replication_role = replica");
        await tamperQuantity.query(`UPDATE ocr_fact_pair_quantity_decisions
          SET evidence_hash = $1 WHERE id = $2`,
        [quantityAfter.items[0].evidenceHash, quantityAfter.items[0].id]);
        await tamperQuantity.query("COMMIT");
      } finally {
        tamperQuantity.release();
      }
      const rejected = await repository.recordOcrFactPairReviewCommand(
        fourthRun!.id, {
          ...confirmedSnapshot.items[0].review!, decision: "PAIR_REJECTED",
          basis: "Synthetic rejection supersedes the frozen pair snapshot.",
        }, command());
      expect(rejected).toMatchObject({ kind: "success",
        value: { eligibleForPairReview: false } });
      expect((await repository.getOcrFactPairQuantityReviews(fourthRun!.id, actor)))
        .toMatchObject({ candidates: [], canReview: false,
          reasonCode: "OCR_QUANTITY_SNAPSHOT_REQUIRED" });
      expect(await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, quantityInput, quantityCommand)).toMatchObject({
        kind: "invalid_state", code: "OCR_QUANTITY_SNAPSHOT_REQUIRED",
      });
      expect(await repository.getOcrFactPairComparisonPreviews(fourthRun!.id, actor))
        .toMatchObject({ items: [{ preview: { status: "ABSTAIN",
          reasonCode: "PAIR_SUPERSEDED_IN_CURRENT_RUN", comparison: null } }] });
      const unsure = await repository.recordOcrFactPairReviewCommand(
        fourthRun!.id, {
          ...confirmedSnapshot.items[0].review!, decision: "UNSURE",
          basis: "Synthetic uncertainty replaces prior positive pair judgment.",
        }, command());
      expect(unsure).toMatchObject({ kind: "success",
        value: { eligibleForPairReview: false } });
      const supersededQuantity = await repository.getOcrFactPairQuantityReviews(
        fourthRun!.id, actor);
      expect(supersededQuantity).toMatchObject({ candidates: [], canReview: false,
        reasonCode: "OCR_QUANTITY_SNAPSHOT_REQUIRED" });
      expect((await repository.recordOcrFactPairQuantityReviewCommand(
        fourthRun!.id, quantityInput, command()))).toMatchObject({
        kind: "invalid_state", code: "OCR_QUANTITY_SNAPSHOT_REQUIRED",
      });
      expect(await repository.getOcrFactPairComparisonPreviews(fourthRun!.id, actor))
        .toMatchObject({ items: [{ preview: { status: "ABSTAIN",
          reasonCode: "PAIR_SUPERSEDED_IN_CURRENT_RUN", comparison: null } }] });
      const fifthRun = await repository.startCheck(object.id);
      expect(fifthRun).toBeDefined();
      const unsureSnapshot = await repository.getOcrFactPairSnapshots(fifthRun!.id, actor);
      if (!unsureSnapshot || typeof unsureSnapshot === "string") {
        throw new Error("No synthetic uncertainty snapshot read");
      }
      expect(unsureSnapshot.items).toHaveLength(1);
      expect(unsureSnapshot.items[0]).toMatchObject({
        decisionId: unsure.kind === "success" ? unsure.value.id : "",
        originCheckId: fourthRun!.id, targetCheckId: fifthRun!.id,
        reasonCode: "REBOUND", eligibleForPairReview: false,
        review: { decision: "UNSURE" },
      });
      const pdFile = files[0];
      const changedSourceReview = await repository.recordSourceReviewCommand(
        object.id, pdFile.id, { sourceSha256: pdFile.sha256,
          revisionStatus: "CURRENT", approvalStatus: "UNAPPROVED",
          linkGroupId: "synthetic-building-1", sectionCode: "PZ", pageStages: {},
          basis: { reference: "Synthetic source revision withdrawal only" } },
        command());
      expect(changedSourceReview.kind).toBe("success");
      await database.query(`UPDATE analysis_runs SET run_state = 'PARTIAL'
        WHERE api_id = $1`, [fifthRun!.id]);
      const sixthRun = await repository.startCheck(object.id);
      expect(sixthRun).toBeDefined();
      expect(sixthRun!.id).not.toBe(fifthRun!.id);
      const missingSnapshot = await repository.getOcrFactPairSnapshots(sixthRun!.id, actor);
      if (!missingSnapshot || typeof missingSnapshot === "string") {
        throw new Error("No synthetic missing-target snapshot read");
      }
      expect(missingSnapshot.items).toHaveLength(1);
      expect(missingSnapshot.items[0]).toMatchObject({
        decisionId: unsure.kind === "success" ? unsure.value.id : "",
        reasonCode: "TARGET_FACT_UNAVAILABLE", eligibleForPairReview: false,
        originReview: { decision: "UNSURE" },
        review: null, targetReviewHash: null, provenance: null,
      });
      await expect(database.query(`UPDATE ocr_fact_pair_decisions
        SET review_json = '{}'::jsonb`)).rejects.toThrow();
      await expect(database.query(`DELETE FROM ocr_fact_pair_decisions`))
        .rejects.toThrow();
      const sourceDecisionId = (await database.query<{ id: string }>(
        `SELECT pd_source_review_decision_id AS id FROM ocr_fact_pair_decisions
         LIMIT 1`)).rows[0].id;
      const connection = await database.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("SET LOCAL session_replication_role = replica");
        await connection.query(`UPDATE source_review_decisions
          SET content_hash = $1 WHERE id = $2`, ["f".repeat(64), sourceDecisionId]);
        await connection.query("COMMIT");
      } finally {
        connection.release();
      }
      await expect(repository.getOcrFactPairReviews(thirdRun!.id, actor))
        .rejects.toThrow();
    } finally {
      restoreSettings(previous);
      await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);
});
