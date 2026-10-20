import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { MATRIX_PROFILE } from "../src/matrix-execution.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { LocalObjectStorage } from "../src/storage.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const flags = ["INSPECTOR_MATRIX_INVENTORY_COMPARISONS", "INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS",
  "INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS", "INSPECTOR_MATRIX_OCR_LAYOUT"];
const fixturePath = fileURLToPath(new URL("../../../services/worker/tests/fixtures/rebar-F0106-F0139.json", import.meta.url));
// Independent oracle: ordinary ASCII-key canonical JSON over the COMPLETE artifact envelope.
// These full original canonical artifacts contain no trusted source review or inferred authority.
function portable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(portable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${portable(value[k])}`).join(",")}}`;
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw Error("Noninteger oracle value");
  return JSON.stringify(value);
}
const artifactHash = (artifact: unknown) => sha256(portable({ hashDomain: "matrix-source-declaration-text-artifact-v1", textArtifact: artifact }));
const dispatch = `import json,sys
from unittest.mock import patch
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
import inspector_worker.durable_matrix as worker
x=json.load(sys.stdin);artifacts={a['sourceFileId']:a for a in x['artifacts']}
with patch.object(worker,'download_text_artifact',side_effect=lambda lease,source,attempt:artifacts[source['sourceFileId']]):
 result=PilotPz002RuleAdapter().execute(x['lease'],x['attempt'])
json.dump(result,sys.stdout,ensure_ascii=False)`;

(adminUrl ? describe : describe.skip)("full original source text pages authenticated sealed read", { timeout: 240_000 }, () => {
  const databaseName = `source_text_pages_${randomUUID().replaceAll("-", "")}`;
  const oldFlags = flags.map(key => process.env[key]);
  let admin: Pool, database: Pool, repository: PostgresInspectionRepository, storageRoot: string;
  let objectId: string, actor: AuthenticatedActor, stranger: AuthenticatedActor, checkId: string;
  let foreignSourceId: string, foreignCheckId: string;
  let files: any[], artifacts: any[], terminal = false;

  beforeAll(async () => {
    flags.forEach(key => process.env[key] = "0");
    const bytes = readFileSync(fixturePath);
    expect(sha256(bytes)).toBe("ee4c645f50f87d44e056b62f215170067e8cd75555837473e2599072c9fa6b54");
    const fixture = JSON.parse(bytes.toString("utf8"));
    expect(fixture.sources.map((s: any) => s.source.pdf_pages)).toEqual([139, 22]);
    storageRoot = await mkdtemp(join(tmpdir(), "source-text-pages-"));
    admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 20_000 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(adminUrl!); url.pathname = `/${databaseName}`; const connection = url.toString();
    await runDatabaseMigrations(connection);
    database = new Pool({ connectionString: connection, connectionTimeoutMillis: 5_000, statement_timeout: 15_000, query_timeout: 20_000 });
    repository = await PostgresInspectionRepository.create({ connectionString: connection,
      parameters: (await loadReferenceData()).parameters, analysisProfile: "MATRIX_V1",
      organizationSlug: "source-text-pages-it", storage: new LocalObjectStorage(storageRoot) });
    const object = await repository.createObject({ name: "T49 public original canonical-only source text fixture; no design approval", address: "Москва" });
    objectId = object.id;
    actor = await userActor([objectId]); stranger = await userActor([]);
    files = fixture.sources.map((row: any) => ({ id: `FIL-${randomUUID()}`, name: `T49-public-${row.source.file_id}.pdf`,
      stage: row.source.stage, size: row.source.size_bytes, mimeType: "application/pdf", sha256: row.source.sha256,
      scanStatus: "CLEAN", status: "STORED", storageKey: `canonical-only-not-present/${randomUUID()}.pdf` }));
    // No original PDF is fabricated or copied: this test authenticates the canonical-text store,
    // while the separate v7 HTTP acceptance validates the actual PDF-backed public run.
    artifacts = fixture.sources.map((row: any, i: number) => ({ ...structuredClone(row.sourceArtifact), sourceFileId: files[i].id }));
    await repository.registerIngestedFiles(objectId, files);
    const foreign = await repository.createObject({ name: "T49 unrelated canonical source access fixture", address: "Москва" });
    foreignSourceId = `FIL-${randomUUID()}`;
    await repository.registerIngestedFiles(foreign.id, [{ ...files[0], id: foreignSourceId, storageKey: `canonical-only-not-present/${randomUUID()}.pdf` }]);
    foreignCheckId = (await repository.startCheck(foreign.id))!.id;
    checkId = (await repository.startCheck(objectId))!.id;
  });
  afterAll(async () => {
    flags.forEach((key, i) => { if (oldFlags[i] === undefined) delete process.env[key]; else process.env[key] = oldFlags[i]; });
    await repository?.close(); await database?.end();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    if (admin) try {
      await admin.query("SET statement_timeout=10000"); await admin.query("SET lock_timeout=5000");
      expect((await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1", [databaseName])).rows[0].n).toBe(0);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally { await admin.end(); }
  });
  async function userActor(objects: string[]): Promise<AuthenticatedActor> {
    const user = await provisionLocalUser(database, { organizationSlug: "source-text-pages-it", login: `source-text-${randomUUID()}`,
      displayName: "Canonical source text reader", password: "Canonical-Text-Test-2026!", objectApiIds: objects, objectPermissions: ["READ", "REVIEW_DECIDE"] });
    return { sessionId: randomUUID(), userId: user.id, organizationId: user.organizationId,
      displayName: "Canonical source text reader", roles: ["INSPECTOR"], capabilities: ["SOURCE_REVIEW"], csrfHash: "x", expiresAt: "2030-01-01T00:00:00Z" };
  }
  async function snapshots() {
    const [matrix, submission, targets] = await Promise.all([repository.getMatrixExecution(checkId, actor), repository.getSubmission(checkId, actor), repository.getMatrixFactTargets(checkId, actor)]);
    const counts = await database.query(`SELECT 'reviews' name,count(*)::int n FROM source_review_decisions
      UNION ALL SELECT 'review_snapshots',count(*)::int FROM run_source_review_snapshots
      UNION ALL SELECT 'runs',count(*)::int FROM analysis_runs
      UNION ALL SELECT 'rules',count(*)::int FROM rule_results
      UNION ALL SELECT 'stages',count(*)::int FROM analysis_stage_artifacts
      UNION ALL SELECT 'machine',count(*)::int FROM machine_prediction_snapshots ORDER BY name`);
    return { matrix: sha256(JSON.stringify(matrix)), submission: sha256(JSON.stringify(submission)), targets: sha256(JSON.stringify(targets)), counts: counts.rows };
  }
  async function sealed() {
    const scaffold: Record<string, string[]> = {
      DOCUMENT_RENDER: ["PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"],
      DOCUMENT_OCR_LAYOUT: ["PROVIDER_NOT_CONFIGURED", "OCR_LAYOUT_PROFILE_NOT_SELECTED", "OCR_LAYOUT"],
      DOCUMENT_METADATA: ["PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED", "METADATA_EXTRACTOR"],
      DOCUMENT_LINKING: ["POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"],
      ENTITY_EXTRACTION: ["PROVIDER_NOT_CONFIGURED", "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED", "ENTITY_EXTRACTION_MODEL"],
      EVIDENCE_VALIDATION: ["NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"],
    };
    for (let step = 0; step < 16; step++) {
      const ready = await database.query(`SELECT job.id,job.job_type FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id
        WHERE run.api_id=$1 AND job.state='READY' ORDER BY job.created_at LIMIT 1`, [checkId]);
      if (!ready.rows.length) break;
      const job = ready.rows[0], claimed = await repository.claimJob(job.id, { workerId: "source-text-pages-it", capabilities: [job.job_type] });
      expect(claimed.kind, job.job_type).toBe("acquired"); if (claimed.kind !== "acquired") throw Error("Expected acquired job");
      const lease = claimed.lease, attempt = { attemptId: lease.attemptId, fencingToken: lease.fencingToken };
      let result: any;
      if (job.job_type === "ANALYSIS_INVENTORY") result = { disposition: "MANIFEST_INVENTORIED", sourceCount: 2, stageCounts: { PD: 1, RD: 1, ID: 0 } };
      else if (job.job_type === "DOCUMENT_TEXT_LAYER") result = { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", sources: artifacts.map(artifact => ({ sourceFileId: artifact.sourceFileId, inputSha256: artifact.inputSha256, status: "EXTRACTED", artifact })) };
      else if (job.job_type === "RULE_EVALUATION") {
        expect(lease.release.providerSlot?.profileId).toBe(MATRIX_PROFILE);
        const python = spawnSync(pythonExecutable, ["-c", dispatch], { input: JSON.stringify({ lease, attempt, artifacts }), encoding: "utf8",
          env: { ...process.env, ...pythonEnv }, timeout: 45_000, maxBuffer: 48 * 1024 * 1024 });
        expect(python.status, python.stderr).toBe(0); result = JSON.parse(python.stdout);
        expect(result.providerProfileId).toBe(MATRIX_PROFILE);
        expect(result.execution.observations).toHaveLength(15);
      } else if (job.job_type === "ANALYSIS_SEAL_UNSUPPORTED") result = { disposition: "UNSUPPORTED_COVERAGE_SEALED", workerId: "source-text-pages-it" };
      else { const [disposition, reasonCode, providerKind] = scaffold[job.job_type] ?? []; if (!disposition) throw Error(`Unexpected job ${job.job_type}`);
        result = { schemaVersion: "analysis-stage-result-v1", jobType: job.job_type, inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind, providerProfileId: null, providerConfigHash: null, outputCount: 0 }; }
      expect((await repository.completeJob(job.id, { ...attempt, result })).kind, job.job_type).toBe("completed");
      if (job.job_type === "DOCUMENT_TEXT_LAYER") {
        expect(await repository.getMatrixInventorySourcePages(checkId, files[0].id, actor)).toBeUndefined();
      }
    }
    expect(await repository.getCheck(checkId, actor)).toMatchObject({ status: "PARTIAL", progress: 100 });
    terminal = true;
  }
  it("withholds unsealed originals then publishes all139+22 pages after actual default-v4 durable dispatch/seal", async () => {
    expect(await repository.getMatrixInventorySourcePages(checkId, files[0].id, actor)).toBeUndefined();
    await sealed();
    const matrix = await repository.getMatrixExecution(checkId, actor);
    if (!matrix || typeof matrix === "string") throw Error("Expected sealed saved matrix");
    expect(matrix.execution.observations).toHaveLength(15); expect(matrix.execution.results).toHaveLength(63);
    expect(matrix.execution.results.every(row => row.qualified === false)).toBe(true);
    const targets = await repository.getMatrixFactTargets(checkId, actor);
    if (!targets || typeof targets === "string") throw Error("Expected sealed immutable fact targets");
    expect(targets.items).toHaveLength(15);
    for (let i = 0; i < files.length; i++) {
      const pages = await repository.getMatrixInventorySourcePages(checkId, files[i].id, actor);
      if (!pages || typeof pages === "string") throw Error(`Full original ${files[i].stage} unavailable`);
      expect(isDeepStrictEqual(pages.textArtifact, artifacts[i])).toBe(true);
      expect(pages).toMatchObject({ checkId, sourceFileId: files[i].id, sourceSha256: files[i].sha256,
        inputManifestHash: matrix.execution.inputManifestHash, stage: files[i].stage, pageStages: {}, latestReviewHash: null,
        textArtifactHash: artifactHash(artifacts[i]) });
      const text = await database.query(`SELECT artifact.content_hash FROM analysis_text_artifacts artifact JOIN analysis_runs run ON run.id=artifact.run_id
        JOIN source_files source ON source.id=artifact.source_file_id WHERE run.api_id=$1 AND source.api_id=$2`, [checkId, files[i].id]);
      expect(text.rows).toHaveLength(1); expect(pages.textStageContentHash).toBe(text.rows[0].content_hash);
    }
  });
  it("retains exact zero and stair lines/geometry without assigning source review or scalar authority", async context => {
    if (!terminal) context.skip();
    const pages = await repository.getMatrixInventorySourcePages(checkId, files[0].id, actor);
    if (!pages || typeof pages === "string") throw Error("Expected full original text");
    const originalPages = pages.textArtifact.pages as any[];
    const page53 = originalPages[52], page50 = originalPages[49];
    const zero = page53.blocks[0], stair = page50.blocks[3];
    expect(zero.text.split("\n")[0]).toBe("Отметка нуля принята на абсолютной отметке +159.950.");
    expect(zero.lineBboxesMilliPoints[0]).toEqual([106800, 800208, 395980, 812208]);
    expect(stair.text.split("\n")[0]).toBe("Лестницы, лестничные площадки всех корпусов В30.");
    expect(stair.lineBboxesMilliPoints[0]).toEqual([106320, 698448, 380184, 710448]);
    expect(page53).toMatchObject({ widthMilliPoints: 595200, heightMilliPoints: 841920 });
    expect(await repository.getSourceReview(objectId, files[0].id, actor)).toBeUndefined();
    expect(await repository.getSourceReview(objectId, files[1].id, actor)).toBeUndefined();
  });
  it("denies foreign source, foreign object, unrelated actor and organization with zero read-side writes", async context => {
    if (!terminal) context.skip();
    const before = await snapshots();
    expect(await repository.getMatrixInventorySourcePages(checkId, foreignSourceId, actor)).toBeUndefined();
    expect([undefined, "AUTH_REQUIRED"]).toContain(await repository.getMatrixInventorySourcePages(foreignCheckId, foreignSourceId, actor));
    expect([undefined, "AUTH_REQUIRED"]).toContain(await repository.getMatrixInventorySourcePages(checkId, files[0].id, stranger));
    expect([undefined, "AUTH_REQUIRED"]).toContain(await repository.getMatrixInventorySourcePages(checkId, files[0].id, { ...actor, organizationId: randomUUID() }));
    for (const file of files) expect(await repository.getMatrixInventorySourcePages(checkId, file.id, actor)).toBeDefined();
    expect(isDeepStrictEqual(await snapshots(), before)).toBe(true);
    expect(before.counts.find(row => row.name === "reviews")?.n).toBe(0);
  });
});
