import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;
type Loader = (client: PoolClient, runId: string, objectId: string) => Promise<unknown>;

suite("ZU-127 generic v3 authenticated PostgreSQL inputs", () => {
  it("loads only pinned synthetic PDF, review and successful text; rejects DB tampering", async () => {
    const name = `inspector_zu_generic_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 3 });
      const organizationSlug = `zu-generic-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({ name: "Synthetic ZU loader", address: "Test" });
      const fileId = `FIL-${randomUUID()}`;
      const sourceHash = "e".repeat(64);
      const storageKey = `objects/${object.id}/originals/${sourceHash}/synthetic.pdf`;
      expect(await repository.registerIngestedFiles(object.id, [{ id: fileId,
        name: "synthetic.pdf", size: 100, stage: "PD", mimeType: "application/pdf",
        sha256: sourceHash, scanStatus: "CLEAN", status: "STORED", storageKey }]))
        .toBeDefined();
      const reviewer = await provisionLocalUser(database, { organizationSlug,
        login: `zu-generic-${randomUUID()}`, displayName: "Synthetic reviewer",
        password: "Synthetic-ZU-Loader-2026!", role: "INSPECTOR",
        capabilities: ["SOURCE_REVIEW"], objectApiIds: [object.id],
        objectPermissions: ["READ", "REVIEW_DECIDE"] });
      const ids = (await database.query<{ object_id: string; source_id: string }>(
        `SELECT object.id AS object_id, source.id AS source_id
         FROM objects object JOIN source_files source ON source.object_id = object.id
         WHERE object.api_id = $1 AND source.api_id = $2`, [object.id, fileId],
      )).rows[0];
      const basis = "Synthetic fixture only; no real project approval.";
      const reviewHash = sha256(canonicalJson({ objectApiId: object.id,
        sourceFileApiId: fileId, sourceSha256: sourceHash, revisionStatus: "CURRENT",
        approvalStatus: "APPROVED", linkGroupId: null, sectionCode: "ZU",
        pageStages: {}, basis: { reference: basis }, actorId: reviewer.id }));
      await database.query(
        `INSERT INTO source_review_decisions (id, object_id, source_file_id,
           source_sha256, revision_status, approval_status, link_group_id, section_code,
           page_stages, basis_reference, actor_id, content_hash)
         VALUES ($1, $2, $3, $4, 'CURRENT', 'APPROVED', NULL, 'ZU', '{}'::jsonb,
           $5, $6, $7)`, [randomUUID(), ids.object_id, ids.source_id, sourceHash,
          basis, reviewer.id, reviewHash],
      );
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const run = (await database.query<{ id: string; manifest_hash: string;
        text_job_id: string }>(
        `SELECT run.id, manifest.sha256 AS manifest_hash, job.id AS text_job_id
         FROM analysis_runs run
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         JOIN analysis_jobs job ON job.run_id = run.id AND job.job_type = 'DOCUMENT_TEXT_LAYER'
         WHERE run.api_id = $1`, [check!.id],
      )).rows[0];
      const text = { schemaVersion: "document-text-v2", sourceFileId: fileId,
        inputSha256: sourceHash, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        pageCount: 1, textPageCount: 1, qualityPolicyVersion: "text-layer-quality-v2",
        qualitySummary: { textLayerCandidatePageCount: 1, ocrRequiredPageCount: 0 },
        pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          blocks: [{ text: "Сопротивление теплопередаче окна",
            bboxMilliPoints: [1_000, 1_000, 200_000, 3_000] }],
          quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [],
            metrics: { blockCount: 1, nonWhitespaceCharacterCount: 30,
              alphanumericCharacterCount: 30, replacementCharacterCount: 0,
              disallowedControlCharacterCount: 0 } } }] };
      const textCanonical = canonicalJson(text);
      await database.query(`UPDATE analysis_jobs SET state = 'SUCCEEDED' WHERE id = $1`,
        [run.text_job_id]);
      await database.query(
        `INSERT INTO analysis_text_artifacts (id, job_id, run_id, source_file_id,
           schema_version, input_sha256, content_hash, byte_size, page_count,
           text_page_count, content_json)
         VALUES ($1, $2, $3, $4, 'document-text-v2', $5, $6, $7, 1, 1, $8::jsonb)`,
        [randomUUID(), run.text_job_id, run.id, ids.source_id, sourceHash,
          sha256(textCanonical), Buffer.byteLength(textCanonical, "utf8"), textCanonical],
      );
      const load = (repository as unknown as {
        loadAuthenticatedZu127GenericInputs: Loader;
      }).loadAuthenticatedZu127GenericInputs.bind(repository);
      const connection = await database.connect();
      try {
        const loaded = await load(connection, run.id, ids.object_id) as Record<string, any>;
        expect(loaded).toMatchObject({ inputManifestHash: run.manifest_hash.trim(),
          sourceFiles: [{ sourceFileId: fileId, objectId: object.id, sha256: sourceHash,
            byteSize: 100, pageCount: 1, mediaType: "application/pdf",
            stages: ["PD"], sectionCode: "ZU" }],
          sourceDecisions: { [fileId]: { sourceSha256: sourceHash,
            revisionStatus: "CURRENT", approvalStatus: "APPROVED", sectionCode: "ZU",
            basis: { reference: basis } } },
          textArtifacts: [{ sourceFileId: fileId, contentSha256: sha256(textCanonical),
            artifact: text }],
          pdfStorageRefs: { [fileId]: { storageKey, sha256: sourceHash, byteSize: 100 } },
        });
        expect(await load(connection, run.id, randomUUID())).toBeNull();

        const tamper = async (sql: string, args: unknown[]) => {
          await connection.query("BEGIN");
          try {
            await connection.query("SET LOCAL session_replication_role = replica");
            await connection.query(sql, args);
            expect(await load(connection, run.id, ids.object_id)).toBeNull();
          } finally { await connection.query("ROLLBACK"); }
        };
        await tamper(`UPDATE source_review_decisions SET approval_status = 'UNKNOWN'
          WHERE source_file_id = $1`, [ids.source_id]);
        await tamper(`UPDATE run_source_review_snapshots SET decision_hash = $2
          WHERE run_id = $1`, [run.id, "0".repeat(64)]);
        await tamper(`DELETE FROM run_source_review_snapshots WHERE run_id = $1`,
          [run.id]);
        await tamper(`UPDATE analysis_text_artifacts SET content_json = '{"bad":true}'::jsonb
          WHERE run_id = $1`, [run.id]);
        await tamper(`UPDATE analysis_text_artifacts SET page_count = 2
          WHERE run_id = $1`, [run.id]);
        await tamper(`UPDATE analysis_text_artifacts SET input_sha256 = $2
          WHERE run_id = $1`, [run.id, "0".repeat(64)]);
        await tamper(`UPDATE analysis_jobs SET state = 'READY' WHERE id = $1`,
          [run.text_job_id]);
        await tamper(`UPDATE analysis_jobs SET release_id = 'wrong-release' WHERE id = $1`,
          [run.text_job_id]);
        await tamper(`UPDATE manifest_items SET blob_sha256 = $2
          WHERE source_file_id = $1`, [ids.source_id, "0".repeat(64)]);
        await tamper(`UPDATE blobs SET sha256 = $2
          WHERE id = (SELECT blob_id FROM source_files WHERE id = $1)`,
        [ids.source_id, "0".repeat(64)]);
      } finally { connection.release(); }
    } finally {
      await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000); // Includes isolated database setup and a complete durable lifecycle.
});
