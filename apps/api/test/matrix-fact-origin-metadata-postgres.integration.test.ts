import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MatrixExecutionRead, MatrixFactTargetsRead } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { MATRIX_PROFILE } from "../src/matrix-execution.js";
import { MATRIX_INVENTORY_PROFILE } from "../src/matrix-inventory-profile.js";
import { MATRIX_CALL_INVENTORY_PROFILE } from "../src/matrix-call-inventory-profile.js";
import { MATRIX_RAIL_INVENTORY_PROFILE } from "../src/matrix-rail-inventory-profile.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { LocalObjectStorage } from "../src/storage.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const flags = ["INSPECTOR_MATRIX_INVENTORY_COMPARISONS", "INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS",
  "INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS", "INSPECTOR_MATRIX_OCR_LAYOUT"];
const extraction = `import json,sys,hashlib
from pathlib import Path
from inspector_worker.text_layer import extract_pdf_text_artifact
x=json.load(sys.stdin)
json.dump([extract_pdf_text_artifact(Path(f['path']),f['id'],f['sha256']) for f in x],sys.stdout,ensure_ascii=False)`;
// Only download transports are substituted. The actual adapter dispatch validates every pinned
// release and executes its ordinary scalar and typed siblings against the stored full artifacts.
const dispatch = `import importlib,json,sys
from contextlib import ExitStack
from unittest.mock import patch
from inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter
x=json.load(sys.stdin);profile=x['lease']['release']['providerSlot']['profileId']
module,loader=({
 'matrix-text-facts-inventory-v5':('durable_inventory_matrix','download_inventory_comparison_inputs'),
 'matrix-text-facts-call-inventory-v6':('durable_call_inventory_matrix','download_reviewed_inventory_comparison_inputs'),
 'matrix-text-facts-rail-inventory-v7':('durable_rail_inventory_matrix','download_reviewed_inventory_comparison_inputs')
}.get(profile,('durable_matrix',None)))
worker=importlib.import_module('inspector_worker.'+module)
artifacts={a['sourceFileId']:a for a in x['artifacts']}
with ExitStack() as stack:
 stack.enter_context(patch.object(worker,'download_text_artifact',side_effect=lambda lease,source,attempt:artifacts[source['sourceFileId']]))
 if loader:stack.enter_context(patch.object(worker,loader,return_value=x['loader']))
 result=PilotPz002RuleAdapter().execute(x['lease'],x['attempt'])
json.dump(result,sys.stdout,ensure_ascii=False)`;
type Source = { id: string; name: string; size: number; stage: "PD" | "RD"; mimeType: string;
  sha256: string; scanStatus: "CLEAN"; status: "STORED"; storageKey: string; path: string };
type Fixture = { objectId: string; actor: AuthenticatedActor; files: Source[]; artifacts: any[] };
type Saved = { profile: string; checkId: string; read: MatrixExecutionRead; targets?: MatrixFactTargetsRead };

(adminUrl ? describe : describe.skip)("authenticated scalar origin metadata rejects tampered sealed projections", { timeout: 240_000 }, () => {
  const databaseName = `fact_origin_profiles_${randomUUID().replaceAll("-", "")}`;
  const oldFlags = flags.map(key => process.env[key]);
  let admin: Pool, database: Pool, repository: PostgresInspectionRepository;
  let connection: string, storageRoot: string, f: Fixture;

  beforeAll(async () => {
    flags.forEach(key => process.env[key] = "0");
    storageRoot = await mkdtemp(join(tmpdir(), "matrix-fact-origin-profiles-"));
    admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 20_000 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(adminUrl!); url.pathname = `/${databaseName}`; connection = url.toString();
    await runDatabaseMigrations(connection);
    database = new Pool({ connectionString: connection, connectionTimeoutMillis: 5_000, statement_timeout: 15_000, query_timeout: 20_000 });
    repository = await PostgresInspectionRepository.create({ connectionString: connection,
      parameters: (await loadReferenceData()).parameters, analysisProfile: "MATRIX_V1",
      organizationSlug: "fact-origin-profiles-it", storage: new LocalObjectStorage(storageRoot) });
    f = await fixture();
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
  function python(script: string, input: unknown) {
    const result = spawnSync(pythonExecutable, ["-c", script], { input: JSON.stringify(input), encoding: "utf8",
      env: { ...process.env, ...pythonEnv }, timeout: 30_000, maxBuffer: 48 * 1024 * 1024 });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }
  async function fixture(): Promise<Fixture> {
    const directory = join(storageRoot, "authored-originals");
    const generated = spawnSync(pythonExecutable, [fileURLToPath(new URL("../../../scripts/create-matrix-project-zero-fixture.py", import.meta.url)), "--directory", directory],
      { encoding: "utf8", env: { ...process.env, ...pythonEnv }, timeout: 30_000 });
    expect(generated.status, generated.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8"));
    const object = await repository.createObject({ name: "T47 SYNTHETIC ONLY immutable scalar origin profile fixture", address: "Москва" });
    const user = await provisionLocalUser(database, { organizationSlug: "fact-origin-profiles-it", login: `fact-origin-${randomUUID()}`,
      displayName: "Synthetic origin reviewer", password: "Synthetic-Origin-Test-2026!", objectApiIds: [object.id], objectPermissions: ["READ", "REVIEW_DECIDE"] });
    const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: user.id, organizationId: user.organizationId,
      displayName: "Synthetic origin reviewer", roles: ["INSPECTOR"], capabilities: ["SOURCE_REVIEW"], csrfHash: "x", expiresAt: "2030-01-01T00:00:00Z" };
    const files: Source[] = [];
    for (const row of manifest.documents) {
      const path = join(directory, row.name), bytes = readFileSync(path), id = `FIL-${randomUUID()}`;
      expect(sha256(bytes)).toBe(row.sha256);
      const storageKey = `objects/${object.id}/${id}.pdf`, destination = join(storageRoot, storageKey);
      await mkdir(dirname(destination), { recursive: true }); await copyFile(path, destination);
      files.push({ id, name: row.name, stage: row.stage, size: bytes.length, mimeType: "application/pdf", sha256: row.sha256,
        scanStatus: "CLEAN", status: "STORED", storageKey, path });
    }
    await repository.registerIngestedFiles(object.id, files);
    const artifacts = python(extraction, files);
    expect(artifacts.map((a: any) => a.pageCount)).toEqual([1, 1]);
    return { objectId: object.id, actor, files, artifacts };
  }
  /** Actual release selection only; this metadata test exercises v7. */
  async function start(profile: string) {
    expect(profile).toBe(MATRIX_RAIL_INVENTORY_PROFILE);
    const previous = flags.map(key => process.env[key]); flags.forEach(key => process.env[key] = "0");
    process.env.INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS = "1";
    try { const result = await repository.startCheck(f.objectId); expect(result).toBeDefined(); return result!; }
    finally { flags.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
  }
  async function run(profile: string): Promise<Saved> {
    const check = await start(profile);
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
        WHERE run.api_id=$1 AND job.state='READY' ORDER BY job.created_at LIMIT 1`, [check.id]);
      if (!ready.rows.length) break;
      const job = ready.rows[0], claimed = await repository.claimJob(job.id, { workerId: "fact-origin-profiles-it", capabilities: [job.job_type] });
      expect(claimed.kind, job.job_type).toBe("acquired"); if (claimed.kind !== "acquired") throw Error("Expected acquired job");
      const lease = claimed.lease, attempt = { attemptId: lease.attemptId, fencingToken: lease.fencingToken };
      let result: any;
      if (job.job_type === "ANALYSIS_INVENTORY") result = { disposition: "MANIFEST_INVENTORIED", sourceCount: 2, stageCounts: { PD: 1, RD: 1, ID: 0 } };
      else if (job.job_type === "DOCUMENT_TEXT_LAYER") result = { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", sources: f.artifacts.map(artifact => ({ sourceFileId: artifact.sourceFileId, inputSha256: artifact.inputSha256, status: "EXTRACTED", artifact })) };
      else if (job.job_type === "RULE_EVALUATION") {
        expect(lease.release.providerSlot?.profileId).toBe(profile);
        let loader: unknown;
        if ([MATRIX_INVENTORY_PROFILE, MATRIX_CALL_INVENTORY_PROFILE, MATRIX_RAIL_INVENTORY_PROFILE].includes(profile)) {
          const loaded = profile === MATRIX_RAIL_INVENTORY_PROFILE ? await repository.getJobRailReviewedInventoryComparisonInputs(job.id, attempt)
            : profile === MATRIX_CALL_INVENTORY_PROFILE ? await repository.getJobReviewedInventoryComparisonInputs(job.id, attempt)
              : await repository.getJobInventoryComparisonInputs(job.id, attempt);
          expect(loaded.kind).toBe("available"); if (loaded.kind !== "available") throw Error("Authenticated original loader unavailable");
          loader = JSON.parse(loaded.canonical);
        }
        result = python(dispatch, { lease, attempt, artifacts: f.artifacts, loader });
        expect(result.providerProfileId).toBe(profile);
        expect(result.execution.observations.filter((o: any) => o.attribute === "PROJECT_ZERO_ABSOLUTE_ELEVATION").map((o: any) => o.value).sort()).toEqual(["159.95", "159.96"]);
      } else if (job.job_type === "ANALYSIS_SEAL_UNSUPPORTED") result = { disposition: "UNSUPPORTED_COVERAGE_SEALED", workerId: "fact-origin-profiles-it" };
      else { const [disposition, reasonCode, providerKind] = scaffold[job.job_type] ?? []; if (!disposition) throw Error(`Unexpected job ${job.job_type}`);
        result = { schemaVersion: "analysis-stage-result-v1", jobType: job.job_type, inputManifestHash: lease.inputManifestHash, disposition, reasonCode, providerKind, providerProfileId: null, providerConfigHash: null, outputCount: 0 }; }
      const completed = await repository.completeJob(job.id, { ...attempt, result });
      expect(completed.kind, `Completion ${job.job_type}`).toBe("completed");
    }
    const read = await repository.getMatrixExecution(check.id, f.actor);
    if (!read || typeof read === "string") throw Error("Expected immutable saved execution");
    expect(await repository.getCheck(check.id, f.actor)).toMatchObject({ status: "PARTIAL", progress: 100 });
    expect(read.execution.observations).toHaveLength(2);
    return { profile, checkId: check.id, read };
  }
  async function writeCount() { return Number((await database.query("SELECT count(*)::int n FROM source_review_decisions")).rows[0].n); }
  it("rejects twelve metadata/content attacks before exposing a sealed v7 scalar target", async () => {
    const row = await run(MATRIX_RAIL_INVENTORY_PROFILE);
    const baseline = await repository.getMatrixFactTargets(row.checkId, f.actor);
    expect(baseline && typeof baseline !== "string" ? baseline.items : []).toHaveLength(2);
    const client = await database.connect(), before = await writeCount();
    try {
      const ids = (await client.query(`SELECT run.id AS run_id,run.object_id,run.release_id,stage.id AS stage_id,
        stage.job_id,stage.content_json AS stage_json,release.content_json AS release_json
        FROM analysis_runs run JOIN analysis_stage_artifacts stage ON stage.run_id=run.id AND stage.job_type='RULE_EVALUATION'
        JOIN analysis_releases release ON release.release_id=run.release_id WHERE run.api_id=$1`, [row.checkId])).rows[0];
      const snapshots = async () => (await client.query(`SELECT stage.content_hash,stage.byte_size,snapshot.submission_hash,
        encode(snapshot.submission_bytes,'hex') AS submission FROM analysis_stage_artifacts stage
        JOIN machine_prediction_snapshots snapshot ON snapshot.run_id=stage.run_id
        WHERE stage.id=$1`, [ids.stage_id])).rows[0];
      const original = await snapshots();
      const load = () => (repository as any).loadMatrixFactOrigin(client, ids.object_id, row.checkId);
      const envelope = async (edit: (body: any) => void) => {
        const body = structuredClone(ids.stage_json); edit(body); const canonical = canonicalJson(body);
        await client.query("UPDATE analysis_stage_artifacts SET content_json=$1::jsonb,content_hash=$2,byte_size=$3 WHERE id=$4",
          [canonical,sha256(canonical),Buffer.byteLength(canonical),ids.stage_id]);
      };
      const release = async (edit: (body: any) => void) => {
        const body = structuredClone(ids.release_json); edit(body); const canonical = canonicalJson(body);
        await client.query("UPDATE analysis_releases SET content_json=$1::jsonb,content_hash=$2,byte_size=$3 WHERE release_id=$4",
          [canonical,sha256(canonical),Buffer.byteLength(canonical),ids.release_id]);
      };
      const vectors: Array<[string, () => Promise<unknown>]> = [
        ["stage byte_size",()=>client.query("UPDATE analysis_stage_artifacts SET byte_size=byte_size+1 WHERE id=$1",[ids.stage_id])],
        ["stage config column",()=>client.query("UPDATE analysis_stage_artifacts SET provider_config_hash=$1 WHERE id=$2",["0".repeat(64),ids.stage_id])],
        ["rehashed stage profile envelope",()=>envelope(body=>body.providerProfileId=MATRIX_PROFILE)],
        ["rehashed stage manifest envelope",()=>envelope(body=>body.inputManifestHash="0".repeat(64))],
        ["release byte_size",()=>client.query("UPDATE analysis_releases SET byte_size=byte_size+1 WHERE release_id=$1",[ids.release_id])],
        ["rehashed release profile slot",()=>release(body=>body.providerSlots.find((slot:any)=>slot.stageJobType==="RULE_EVALUATION").profileId="matrix-text-facts-rail-inventory-v700")],
        ["rehashed release definitions",()=>release(body=>body.rules.matrixDefinitions.engineSourceSha256="0".repeat(64))],
        ["job manifest tuple",()=>client.query("UPDATE analysis_jobs SET input_manifest_hash=$1 WHERE id=$2",["0".repeat(64),ids.job_id])],
        ["unsealed run",()=>client.query("UPDATE analysis_runs SET sealed_at=NULL WHERE id=$1",[ids.run_id])],
        ["nonterminal run",()=>client.query("UPDATE analysis_runs SET run_state='RUNNING' WHERE id=$1",[ids.run_id])],
        ["stage does not match frozen manifest",()=>client.query(`UPDATE source_file_stages SET stage='RD' WHERE source_file_id=
          (SELECT id FROM source_files WHERE api_id=$1)`,[f.files.find(source=>source.stage==="PD")!.id])],
        ["rehashed original primary text",async()=>{
          const pd=f.files.find(source=>source.stage==="PD")!;
          const text=(await client.query(`SELECT text.id,text.content_json FROM analysis_text_artifacts text JOIN source_files source ON source.id=text.source_file_id
            WHERE text.run_id=$1 AND source.api_id=$2`,[ids.run_id,pd.id])).rows[0];
          const body=structuredClone(text.content_json),fact=row.read.execution.observations.find(fact=>fact.sourceFileId===pd.id)!;
          const [blockIndex,lineIndex]=fact.blockId.split(":").map(Number);
          const block=body.pages[fact.pageNumber-1].blocks[blockIndex],lines=block.text.split("\n");lines[lineIndex]+=" FORGED";block.text=lines.join("\n");
          const canonical=canonicalJson(body);
          await client.query("UPDATE analysis_text_artifacts SET content_json=$1::jsonb,content_hash=$2,byte_size=$3 WHERE id=$4",
            [canonical,sha256(canonical),Buffer.byteLength(canonical),text.id]);
        }],
      ];
      expect(vectors).toHaveLength(12);
      for (const [name, mutate] of vectors) {
        await client.query("BEGIN");
        try {
          await client.query("ALTER TABLE analysis_runs DISABLE TRIGGER analysis_runs_sealed_immutable");
          await client.query("ALTER TABLE analysis_stage_artifacts DISABLE TRIGGER analysis_stage_artifacts_immutable");
          await client.query("ALTER TABLE analysis_releases DISABLE TRIGGER analysis_releases_immutable");
          await client.query("ALTER TABLE analysis_text_artifacts DISABLE TRIGGER analysis_text_artifacts_immutable");
          await mutate(); expect(await load(),name).toBeNull();
        } finally { await client.query("ROLLBACK"); }
        expect(await snapshots(),name+" rollback").toEqual(original);
      }
      expect(await writeCount()).toBe(before);
    } finally { client.release(); }
    expect(await repository.getMatrixFactTargets(row.checkId,f.actor)).toEqual(baseline);
  });
});
