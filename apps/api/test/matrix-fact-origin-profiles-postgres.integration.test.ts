import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MatrixExecutionRead, MatrixFactScope, MatrixFactTargetsRead, SourceReviewInput } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { MATRIX_PROFILE, MATRIX_STEEL_PROFILE, MATRIX_CONSTRAINTS_PROFILE, MATRIX_LEGACY_PROFILE, matrixRegistry } from "../src/matrix-execution.js";
import { MATRIX_INVENTORY_PROFILE } from "../src/matrix-inventory-profile.js";
import { MATRIX_CALL_INVENTORY_PROFILE } from "../src/matrix-call-inventory-profile.js";
import { MATRIX_RAIL_INVENTORY_PROFILE, matrixFullPolicyForProfile } from "../src/matrix-rail-inventory-profile.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { LocalObjectStorage } from "../src/storage.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const profiles = [MATRIX_LEGACY_PROFILE, MATRIX_CONSTRAINTS_PROFILE, MATRIX_STEEL_PROFILE,
  MATRIX_PROFILE, MATRIX_INVENTORY_PROFILE, MATRIX_CALL_INVENTORY_PROFILE, MATRIX_RAIL_INVENTORY_PROFILE];
const flags = ["INSPECTOR_MATRIX_INVENTORY_COMPARISONS", "INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS",
  "INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS", "INSPECTOR_MATRIX_OCR_LAYOUT"];
const rule = matrixRegistry.entries.find(row => row.parameterCode === "PZ-009")!.atomicRules[0];
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
const command = (actor: AuthenticatedActor) => ({ actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() });
type Source = { id: string; name: string; size: number; stage: "PD" | "RD"; mimeType: string;
  sha256: string; scanStatus: "CLEAN"; status: "STORED"; storageKey: string; path: string };
type Fixture = { objectId: string; actor: AuthenticatedActor; files: Source[]; artifacts: any[] };
type Saved = { profile: string; checkId: string; read: MatrixExecutionRead; targets?: MatrixFactTargetsRead };

(adminUrl ? describe : describe.skip)("immutable scalar fact origins across explicitly supported matrix profiles", { timeout: 240_000 }, () => {
  const databaseName = `fact_origin_profiles_${randomUUID().replaceAll("-", "")}`;
  const oldFlags = flags.map(key => process.env[key]);
  let admin: Pool, database: Pool, repository: PostgresInspectionRepository;
  let connection: string, storageRoot: string, f: Fixture;
  const saved: Saved[] = [];
  let targetsReady = false;

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
  /** v1-v3 are historical saved-profile fixtures; activation flags exist only for v4-v7. */
  async function start(profile: string) {
    const previous = flags.map(key => process.env[key]); flags.forEach(key => process.env[key] = "0");
    if (profile === MATRIX_INVENTORY_PROFILE) process.env[flags[0]] = "1";
    if (profile === MATRIX_CALL_INVENTORY_PROFILE) process.env[flags[1]] = "1";
    if (profile === MATRIX_RAIL_INVENTORY_PROFILE) process.env[flags[2]] = "1";
    let historical: { mockRestore(): void } | undefined;
    if ([MATRIX_LEGACY_PROFILE, MATRIX_CONSTRAINTS_PROFILE, MATRIX_STEEL_PROFILE].includes(profile)) {
      const owner = repository as any, base = owner.ensureAnalysisRelease.bind(repository), policy = matrixFullPolicyForProfile(profile)!;
      historical = vi.spyOn(owner, "ensureAnalysisRelease").mockImplementation(async (...args: any[]) => {
        const release = await base(...args), { releaseId: _id, ...old } = release.manifest;
        const identity = { ...old, rules: { ...old.rules, matrixDefinitions: policy.definitions }, providerSlots: old.providerSlots.map((slot: any) =>
          slot.stageJobType === "RULE_EVALUATION" ? { ...slot, profileId: profile, adapterVersion: policy.adapterVersion, configHash: policy.configHash } : slot) };
        const manifest = { ...identity, releaseId: `release:matrix-v1:${sha256(canonicalJson(identity)).slice(0, 24)}` }, canonical = canonicalJson(manifest);
        await args[0].query(`INSERT INTO analysis_releases(release_id,schema_version,lifecycle,content_hash,byte_size,content_json,external_network_allowed)
          VALUES($1,'analysis-release-v1','DRAFT',$2,$3,$4::jsonb,false) ON CONFLICT DO NOTHING`, [manifest.releaseId, sha256(canonical), Buffer.byteLength(canonical), canonical]);
        return { manifest, canonical, contentHash: sha256(canonical), byteSize: Buffer.byteLength(canonical) };
      });
    }
    try { const result = await repository.startCheck(f.objectId); expect(result).toBeDefined(); return result!; }
    finally { historical?.mockRestore(); flags.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
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
  function target(run: Saved, source: Source) { return run.targets!.items.find(item => item.sourceFileId === source.id)!.target; }
  function binding(t: MatrixFactTargetsRead["items"][number]["target"], authority?: any): MatrixFactScope["bindings"][number] {
    return { ruleId: rule.ruleId, ruleVersion: rule.version, parameterCode: "PZ-009", entityKey: "synthetic-building-zero", target: t,
      reference: "SYNTHETIC ONLY original project zero scalar fact explicitly reviewed", contexts: {
        APPROVED_CHANGE_STATUS: { reference: "SYNTHETIC ONLY approved design change register checked", approvedChangePresent: false },
        ...(authority ? { PROJECT_ZERO_GEODETIC_AUTHORITY: { reference: "SYNTHETIC ONLY classified PD geodetic basis; no real datum assertion", projectZeroAuthority: authority } } : {}),
        [`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`]: { reference: "SYNTHETIC ONLY explicit building floor and reviewed datum mapping",
          parameterCode: "PZ-009", attribute: "PROJECT_ZERO_ABSOLUTE_ELEVATION", canonicalUnit: "m", componentRole: "PROJECT_ZERO_DATUM",
          componentKey: "synthetic-building-zero", zoneKey: "same-local-finished-floor", operatingModeKey: "synthetic-reviewed-vertical-datum",
          measurementBasisKey: "FINISHED_FLOOR_PROJECT_ZERO_TO_APPROVED_ABSOLUTE_DATUM" },
      } };
  }
  function review(source: Source, t: MatrixFactTargetsRead["items"][number]["target"], prior: string | null, authority?: any): SourceReviewInput {
    return { sourceSha256: source.sha256, revisionStatus: "UNKNOWN", approvalStatus: "UNKNOWN", linkGroupId: null,
      sectionCode: source.stage === "PD" ? "PZ" : "KR", pageStages: {},
      basis: { reference: "SYNTHETIC ONLY preserved unknown source interpretation with immutable scalar target" },
      matrixScope: { schemaVersion: "matrix-fact-scopes-v1", bindings: [binding(t, authority)] }, expectedReviewHash: prior };
  }
  it("reads two original scalar targets for all seven known profiles (actual v4-v7 dispatch; historical v1-v3 fixtures)", async () => {
    const before = await writeCount();
    const counts: Array<{ profile: string; targets: number | null }> = [];
    for (const profile of profiles) {
      const row = await run(profile); saved.push(row);
      const actual = await repository.getMatrixFactTargets(row.checkId, f.actor);
      row.targets = actual && typeof actual !== "string" ? actual : undefined;
      counts.push({ profile, targets: row.targets?.items.length ?? null });
      if (row.targets) for (const fact of row.read.execution.observations) {
        const artifact = f.artifacts.find(a => a.sourceFileId === fact.sourceFileId), derived = deriveMatrixFactTarget(fact, artifact);
        expect(derived).not.toBeNull();
        expect(row.targets.items.find(item => item.sourceFileId === fact.sourceFileId)?.target).toEqual({ checkId: row.checkId,
          executionContentHash: row.read.contentHash, observationId: fact.id, evidenceHash: derived!.evidenceHash, textArtifactHash: derived!.textArtifactHash });
      }
    }
    expect(await writeCount()).toBe(before);
    // One assertion preserves the complete old-positive/new-negative diagnostic without running
    // any target-dependent writer against missing origins before the production fix.
    expect(counts).toEqual(profiles.map(profile => ({ profile, targets: 2 })));
    targetsReady = true;
  });
  it("saves same-profile immutable bindings while preserving UNKNOWN source authority", async context => {
    if (!targetsReady) context.skip();
    const pd = f.files.find(file => file.stage === "PD")!;
    for (const row of saved) {
      const prior = await repository.getSourceReview(f.objectId, pd.id, f.actor);
      const result = await repository.recordSourceReviewCommand(f.objectId, pd.id, review(pd, target(row, pd), (prior && typeof prior !== "string" ? prior.contentHash : null)), command(f.actor));
      expect(result.kind, row.profile).toBe("success");
      if (result.kind !== "success") throw Error("Expected same-profile binding save");
      expect(result.value).toMatchObject({ revisionStatus: "UNKNOWN", approvalStatus: "UNKNOWN", matrixScope: { bindings: [binding(target(row, pd))] } });
    }
  });
  it("resolves synthetic v7 PD authority for RD and rejects wrong source/stage/object/hash without review writes", async context => {
    if (!targetsReady) context.skip();
    const row = saved.find(run => run.profile === MATRIX_RAIL_INVENTORY_PROFILE)!, pd = f.files[0], rd = f.files[1];
    const claim = { kind: "APPROVED_PD_GEODETIC_BASIS", sourceFileId: pd.id, sourceSha256: pd.sha256, pageNumber: 1, target: target(row, pd) };
    const prior = await repository.getSourceReview(f.objectId, pd.id, f.actor);
    const input = review(pd, target(row, pd), (prior && typeof prior !== "string" ? prior.contentHash : null), claim);
    input.revisionStatus = "CURRENT"; input.approvalStatus = "APPROVED"; input.linkGroupId = "synthetic-reviewed-building";
    const decision = await repository.recordSourceReviewCommand(f.objectId, pd.id, input, command(f.actor));
    expect(decision.kind).toBe("success"); if (decision.kind !== "success") throw Error("Expected synthetic PD authority save");
    const rdInput = review(rd, target(row, rd), null, { ...claim, reviewContentHash: decision.value.contentHash });
    rdInput.revisionStatus = "CURRENT"; rdInput.approvalStatus = "APPROVED"; rdInput.linkGroupId = input.linkGroupId;
    const before = await writeCount();
    for (const patch of [{ sourceFileId: rd.id }, { sourceSha256: "0".repeat(64) }, { pageNumber: 2 },
      { target: target(row, rd) }, { reviewContentHash: "0".repeat(64) }]) {
      const changed = structuredClone(rdInput); ((changed.matrixScope as MatrixFactScope).bindings[0].contexts.PROJECT_ZERO_GEODETIC_AUTHORITY as any).projectZeroAuthority = { ...claim, reviewContentHash: decision.value.contentHash, ...patch };
      expect(await repository.recordSourceReviewCommand(f.objectId, rd.id, changed, command(f.actor))).toMatchObject({ kind: "invalid_state", code: "MATRIX_PROJECT_ZERO_AUTHORITY_MISMATCH" });
      expect(await writeCount()).toBe(before);
    }
    expect((await repository.recordSourceReviewCommand(f.objectId, rd.id, rdInput, command(f.actor))).kind).toBe("success");
    const after = await writeCount();
    const changed = review(pd, { ...target(row, pd), executionContentHash: "0".repeat(64) }, decision.value.contentHash);
    expect(await repository.recordSourceReviewCommand(f.objectId, pd.id, changed, command(f.actor))).toMatchObject({ kind: "invalid_state", code: "MATRIX_FACT_TARGET_MISMATCH" });
    changed.sourceSha256 = "0".repeat(64);
    expect((await repository.recordSourceReviewCommand(f.objectId, pd.id, changed, command(f.actor))).kind).toBe("invalid_state");
    const denied = { ...f.actor, userId: randomUUID() };
    expect(await repository.getMatrixFactTargets(row.checkId, denied)).toBeUndefined();
    expect(await repository.getMatrixFactTargets(row.checkId, { ...f.actor, organizationId: randomUUID() })).toBeUndefined();
    expect((await repository.recordSourceReviewCommand(f.objectId, pd.id, input, command(denied))).kind).not.toBe("success");
    const other = await repository.createObject({ name: "T47 SYNTHETIC ONLY unrelated object", address: "Москва" });
    expect((await repository.recordSourceReviewCommand(other.id, pd.id, input, command(f.actor))).kind).not.toBe("success");
    expect(await writeCount()).toBe(after);
  });
  it("rejects unlisted or malformed stored profiles, object mismatch and corrupt original hashes without writes", async context => {
    if (!targetsReady) context.skip();
    const row = saved.find(run => run.profile === MATRIX_RAIL_INVENTORY_PROFILE)!;
    const client = await database.connect(), before = await writeCount();
    try {
      const origin = (await client.query(`SELECT run.object_id,stage.id,stage.content_json,stage.content_hash FROM analysis_runs run
        JOIN analysis_stage_artifacts stage ON stage.run_id=run.id AND stage.job_type='RULE_EVALUATION' WHERE run.api_id=$1`, [row.checkId])).rows[0];
      const load = () => (repository as any).loadMatrixFactOrigin(client, origin.object_id, row.checkId);
      for (const profile of ["matrix-text-facts-inventory-v500", `${MATRIX_RAIL_INVENTORY_PROFILE}:forged`]) {
        await client.query("BEGIN");
        try { await client.query("ALTER TABLE analysis_stage_artifacts DISABLE TRIGGER analysis_stage_artifacts_immutable");
          await client.query("UPDATE analysis_stage_artifacts SET provider_profile_id=$1 WHERE id=$2", [profile, origin.id]);
          expect(await load()).toBeNull();
        } finally { await client.query("ROLLBACK"); }
      }
      expect(await (repository as any).loadMatrixFactOrigin(client, randomUUID(), row.checkId)).toBeNull();
      await client.query("BEGIN");
      try { await client.query("ALTER TABLE analysis_stage_artifacts DISABLE TRIGGER analysis_stage_artifacts_immutable");
        await client.query("UPDATE analysis_stage_artifacts SET content_hash=$1 WHERE id=$2", ["0".repeat(64), origin.id]);
        expect(await load()).toBeNull();
      } finally { await client.query("ROLLBACK"); }
      await client.query("BEGIN");
      try { await client.query("ALTER TABLE analysis_text_artifacts DISABLE TRIGGER analysis_text_artifacts_immutable");
        await client.query("UPDATE analysis_text_artifacts SET content_hash=$1 WHERE run_id=(SELECT id FROM analysis_runs WHERE api_id=$2)", ["0".repeat(64), row.checkId]);
        expect(await load()).toBeNull();
      } finally { await client.query("ROLLBACK"); }
      expect((await client.query("SELECT content_hash FROM analysis_stage_artifacts WHERE id=$1", [origin.id])).rows[0].content_hash.trim()).toBe(origin.content_hash.trim());
      expect(await writeCount()).toBe(before);
    } finally { client.release(); }
  });
});
