import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const databaseSuite = adminUrl ? describe : describe.skip;

databaseSuite("durable opt-in OCR_ROW typed fact candidate artifact", () => {
  it("pins empty review artifact to release and rejects stored tampering", async () => {
    const name = `inspector_ocr_fact_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: adminUrl!, max: 1 });
    let database: Pool | undefined;
    let repository: PostgresInspectionRepository | undefined;
    const settings = ["INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE",
      "INSPECTOR_OCR_HEAT_ROW_PROFILE", "INSPECTOR_FACT_FAMILY_PROFILE",
      "INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE",
      "INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE",
      "INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE",
      "INSPECTOR_OCR_TABLE_ROWS_PROFILE",
      "INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE"];
    const previous = Object.fromEntries(settings.map((key) => [key, process.env[key]]));
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(adminUrl!);
      url.pathname = `/${name}`;
      await runDatabaseMigrations(url.toString());
      database = new Pool({ connectionString: url.toString(), max: 2 });
      Object.assign(process.env, {
        INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE: "v5",
        INSPECTOR_OCR_HEAT_ROW_PROFILE: "v1",
        INSPECTOR_FACT_FAMILY_PROFILE: "v1",
        INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE: "v1",
        INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE: "v1",
        INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE: "v1",
        INSPECTOR_OCR_TABLE_ROWS_PROFILE: "v2",
        INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE: "v1",
      });
      const organizationSlug = `ocr-fact-${randomUUID()}`;
      repository = await PostgresInspectionRepository.create({
        connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
        organizationSlug, analysisProfile: "PILOT_PZ002_PZ017",
      });
      const object = await repository.createObject({ name: "Synthetic OCR artifact", address: "Test" });
      const file = { id: `FIL-${randomUUID()}`, name: "fixture.pdf", size: 120,
        stage: "RD" as const, mimeType: "application/pdf", sha256: "a".repeat(64),
        scanStatus: "CLEAN" as const, status: "STORED" as const,
        storageKey: `objects/${object.id}/originals/${"a".repeat(64)}/fixture.pdf` };
      await repository.registerIngestedFiles(object.id, [file]);
      const user = await provisionLocalUser(database, {
        organizationSlug, login: `ocr-fact-${randomUUID()}`, displayName: "OCR fact reader",
        password: "Synthetic-Test-Only-2026!", role: "INSPECTOR",
        capabilities: ["REVIEW_DECIDE"], objectApiIds: [object.id],
        objectPermissions: ["READ", "REVIEW_DECIDE"],
      });
      const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: user.id,
        displayName: "OCR fact reader", organizationId: user.organizationId,
        roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
        csrfHash: "b".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const run = await repository.startCheck(object.id);
      expect(run).toBeDefined();
      const saved = (await database.query<{ run_id: string; content_hash: string;
        fact_count: number; snapshot_count: number; content_json: Record<string, unknown>;
        release_json: Record<string, unknown> }>(
        `SELECT artifact.run_id, artifact.content_hash, artifact.fact_count,
                artifact.snapshot_count, artifact.content_json,
                release.content_json AS release_json
         FROM run_ocr_typed_fact_candidate_artifacts artifact
         JOIN analysis_runs run ON run.id = artifact.run_id
         JOIN analysis_releases release ON release.release_id = run.release_id
         WHERE run.api_id = $1`, [run!.id])).rows[0];
      expect(saved).toBeDefined();
      expect(saved.release_json.reviewArtifacts).toEqual({
        ocrTypedFactCandidates: "ocr-typed-fact-candidates-v1" });
      expect(saved.fact_count).toBe(0);
      expect(saved.snapshot_count).toBe(0);
      expect(await repository.getOcrTypedFactCandidates(run!.id, actor)).toMatchObject({
        schemaVersion: "ocr-typed-fact-candidates-v1", items: [],
        findingCount: 0, coverageCount: 0 });
      const connection = await database.connect();
      try {
        await expect(connection.query(
          `UPDATE run_ocr_typed_fact_candidate_artifacts
           SET fact_count = 1 WHERE run_id = $1`, [saved.run_id],
        )).rejects.toThrow();
        await connection.query("BEGIN");
        await connection.query("SET LOCAL session_replication_role = replica");
        await connection.query(
          `UPDATE run_ocr_typed_fact_candidate_artifacts
           SET content_json = jsonb_set(content_json, '{findingCount}', '1'::jsonb)
           WHERE run_id = $1`, [saved.run_id],
        );
        await connection.query("COMMIT");
      } finally {
        connection.release();
      }
      await expect(repository.getOcrTypedFactCandidates(run!.id, actor))
        .rejects.toThrow("OCR typed fact candidate artifact hash mismatch");
      const sealRead = await database.connect();
      try {
        const verifyAtSeal = repository as unknown as {
          verifyOcrTypedFactCandidateArtifact(client: typeof sealRead,
            runId: string): Promise<unknown>;
        };
        await expect(verifyAtSeal.verifyOcrTypedFactCandidateArtifact(
          sealRead, saved.run_id)).rejects.toThrow(
          "OCR typed fact candidate artifact hash mismatch");
      } finally {
        sealRead.release();
      }
    } finally {
      for (const key of settings) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      await repository?.close();
      await database?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000);
});
