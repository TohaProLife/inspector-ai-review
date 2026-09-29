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

databaseSuite("PostgreSQL OCR row transcription run snapshots", () => {
  it("snapshots latest synthetic review and verifies immutable origin", async () => {
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
        { text: "Площадь помещения", bboxPx: [250, 150, 510, 178], score: 0.96 },
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
      const base = { schemaVersion: "ocr-row-transcription-review-v1" as const,
        ocrStageSha256: ocrHash, rowFingerprint: fingerprint,
        reviewedLabel: "Площадь помещения", reviewedValue: "84,9",
        reviewedUnit: "м²", basis: "Synthetic test decision; no real reviewer approval." };
      const command = () => ({ actor, idempotencyKey: randomUUID(),
        requestId: randomUUID(), traceId: randomUUID() });
      const confirmed = await repository.recordOcrRowTranscriptionReviewCommand(
        check!.id, { ...base, decision: "CONFIRMED_TRANSCRIPTION" }, command());
      expect(confirmed.kind).toBe("success");
      const rejected = await repository.recordOcrRowTranscriptionReviewCommand(
        check!.id, { ...base, decision: "REJECTED", reviewedLabel: null,
          reviewedValue: null, reviewedUnit: null,
          basis: "Synthetic later rejection supersedes transcription." }, command());
      expect(rejected.kind).toBe("success");
      const next = await repository.startCheck(object.id);
      expect(next).toBeDefined();
      expect(next!.id).not.toBe(check!.id);
      const snapshots = await repository.getOcrRowTranscriptionSnapshots(next!.id, actor);
      if (!snapshots || typeof snapshots === "string") throw new Error("No snapshots");
      expect(snapshots.items).toHaveLength(1);
      expect(snapshots.items[0]).toMatchObject({
        decisionId: rejected.kind === "success" ? rejected.value.id : "",
        decisionContentHash: rejected.kind === "success" ? rejected.value.contentHash : "",
        originCheckId: check!.id, sourceFileId: file.id,
        sourceSha256: file.sha256, rowFingerprint: fingerprint,
        review: { decision: "REJECTED", reviewedLabel: null,
          reviewedValue: null, reviewedUnit: null },
      });
      const stored = await database.query<{ snapshots: string;
        manifest_hash: string }>(
        `SELECT (SELECT count(*)::text FROM run_ocr_transcription_snapshots) AS snapshots,
                (SELECT manifest.sha256 FROM analysis_runs run
                 JOIN input_manifests manifest ON manifest.id = run.manifest_id
                 WHERE run.api_id = $1) AS manifest_hash`, [next!.id]);
      expect(stored.rows[0].snapshots).toBe("1");
      expect(stored.rows[0].manifest_hash.trim()).toBe(manifestHash);
      await expect(database.query(
        `UPDATE run_ocr_transcription_snapshots SET review_json = '{}'::jsonb`))
        .rejects.toThrow();
      // A second object cannot inherit decisions merely because it has an OCR-shaped file.
      const other = await repository.createObject({ name: "Unrelated", address: "Test" });
      await repository.registerIngestedFiles(other.id, [{ ...file,
        id: `FIL-${randomUUID()}`, storageKey: `objects/${other.id}/originals/${file.sha256}/fixture.pdf` }]);
      const otherCheck = await repository.startCheck(other.id);
      expect(otherCheck).toBeDefined();
      const otherRows = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM run_ocr_transcription_snapshots snapshot
         JOIN analysis_runs run ON run.id = snapshot.run_id
         WHERE run.api_id = $1`, [otherCheck!.id]);
      expect(otherRows.rows[0].count).toBe("0");
      // A latest row claiming different source bytes cannot reactivate the
      // earlier confirmation or rejection, even if inserted outside the API.
      await database.query(
        `INSERT INTO ocr_row_transcription_decisions (
           object_id, run_id, ocr_stage_artifact_id, rule_stage_artifact_id,
           source_file_id, source_sha256, row_fingerprint_sha256, review_json,
           actor_id, content_hash, created_at
         ) SELECT object_id, run_id, ocr_stage_artifact_id, rule_stage_artifact_id,
                  source_file_id, $1, row_fingerprint_sha256, review_json,
                  actor_id, $2, now() + interval '1 day'
           FROM ocr_row_transcription_decisions WHERE content_hash = $3`,
        ["d".repeat(64), "e".repeat(64),
          rejected.kind === "success" ? rejected.value.contentHash : "f".repeat(64)]);
      await database.query(
        `UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [next!.id]);
      const afterMismatch = await repository.startCheck(object.id);
      expect(afterMismatch).toBeDefined();
      const mismatchSnapshots = await repository.getOcrRowTranscriptionSnapshots(
        afterMismatch!.id, actor);
      expect(mismatchSnapshots && typeof mismatchSnapshots === "object"
        ? mismatchSnapshots.items : null).toHaveLength(0);
      // Matching bytes with a forged content hash must abort run creation.
      await database.query(
        `INSERT INTO ocr_row_transcription_decisions (
           object_id, run_id, ocr_stage_artifact_id, rule_stage_artifact_id,
           source_file_id, source_sha256, row_fingerprint_sha256, review_json,
           actor_id, content_hash, created_at
         ) SELECT object_id, run_id, ocr_stage_artifact_id, rule_stage_artifact_id,
                  source_file_id, source_sha256, row_fingerprint_sha256,
                  review_json, actor_id, $1, now() + interval '2 days'
           FROM ocr_row_transcription_decisions WHERE content_hash = $2`,
        ["f".repeat(64),
          rejected.kind === "success" ? rejected.value.contentHash : "c".repeat(64)]);
      await database.query(
        `UPDATE analysis_runs SET run_state = 'PARTIAL' WHERE api_id = $1`,
        [afterMismatch!.id]);
      await expect(repository.startCheck(object.id))
        .rejects.toThrow(/OCR transcription decision integrity/);
      // Forged duplicate on a new fingerprint must be rejected on readback.
      await database.query(
        `INSERT INTO run_ocr_transcription_snapshots (
           run_id, object_id, source_file_id, source_sha256, row_fingerprint_sha256,
           decision_id, decision_content_hash, origin_run_id,
           ocr_stage_artifact_id, rule_stage_artifact_id, review_json
         ) SELECT run_id, object_id, source_file_id, source_sha256, $1,
                  decision_id, decision_content_hash, origin_run_id,
                  ocr_stage_artifact_id, rule_stage_artifact_id, review_json
           FROM run_ocr_transcription_snapshots WHERE row_fingerprint_sha256 = $2`,
        ["d".repeat(64), fingerprint]);
      await expect(repository.getOcrRowTranscriptionSnapshots(next!.id, actor))
        .rejects.toThrow(/snapshot origin integrity/);
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
