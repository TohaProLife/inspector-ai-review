import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { buildZu127GenericV3ReleaseManifest,
  PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { ZU127_GENERIC_V3_QUEUE } from "../src/zu127-queue-policy.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const suite = adminUrl ? describe : describe.skip;

suite("ZU-127 generic v3 persisted queue claim", () => {
  it("requires the explicit dedicated queue on a pinned rule job", async () => {
    const databaseName = `inspector_zu_queue_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${databaseName}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 2 });
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(),
        parameters: (await loadReferenceData()).parameters,
        organizationSlug: `zu-queue-${randomUUID()}`,
      });
      const object = await repository.createObject({ name: "Synthetic queue gate", address: "Test" });
      const sourceHash = "e".repeat(64);
      expect(await repository.registerIngestedFiles(object.id, [{
        id: `FIL-${randomUUID()}`, name: "synthetic.pdf", size: 100,
        stage: "PD", mimeType: "application/pdf", sha256: sourceHash,
        scanStatus: "CLEAN", status: "STORED",
        storageKey: `objects/${object.id}/originals/${sourceHash}/synthetic.pdf`,
      }])).toBeDefined();
      const check = await repository.startCheck(object.id);
      expect(check).toBeDefined();
      const job = (await database.query<{ id: string }>(
        `SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id = job.run_id
         WHERE run.api_id = $1 AND job.job_type = 'RULE_EVALUATION'`, [check!.id],
      )).rows[0];
      const release = buildZu127GenericV3ReleaseManifest(132);
      await database.query(
        `INSERT INTO analysis_releases (
           release_id, schema_version, lifecycle, content_hash, byte_size,
           content_json, external_network_allowed
         ) VALUES ($1, 'analysis-release-v1', 'DRAFT', $2, $3, $4::jsonb, false)`,
        [release.manifest.releaseId, release.contentHash, release.byteSize, release.canonical],
      );
      await database.query(
        `UPDATE analysis_jobs SET release_id = $2, queue_name = $3, state = 'READY'
         WHERE id = $1`, [job.id, release.manifest.releaseId, ZU127_GENERIC_V3_QUEUE],
      );
      const claim = { workerId: "synthetic-zu-worker", capabilities: ["RULE_EVALUATION"] };
      expect(await repository.claimJob(job.id, claim)).toEqual({ kind: "queue_mismatch" });
      expect(await repository.claimJob(job.id,
        { ...claim, queueName: "rules.evaluate" })).toEqual({ kind: "queue_mismatch" });
      const persisted = (await database.query<{ queue_name: string; state: string }>(
        `SELECT queue_name, state FROM analysis_jobs WHERE id = $1`, [job.id],
      )).rows[0];
      expect(persisted).toEqual({ queue_name: ZU127_GENERIC_V3_QUEUE, state: "READY" });
    } finally {
      await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000); // Includes isolated database setup and a complete durable lifecycle.
});
