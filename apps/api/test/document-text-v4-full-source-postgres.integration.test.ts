import type { DocumentTextV4FullAuditPageBatchRead } from "@inspector-ai/contracts";
/** Real isolated PG + API injection + actual Python producer. Transport copying only is stubbed. */
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { LocalObjectStorage } from "../src/storage.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { pythonExecutable, pythonEnv, projectRoot } from "./python.js";
const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const profile = "SOURCE_AUDIT_V4_FULL_SOURCE_V1" as const;
const sha = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const processor = `import json,sys,shutil,os\nfrom pathlib import Path\nfrom unittest.mock import patch\nfrom inspector_worker import durable_text_v4_full as mod\nx=json.load(sys.stdin)\ndef download(path,destination,expected_sha,expected_size,attempt):\n original=Path(x['original']);assert original.stat().st_size==expected_size;shutil.copyfile(original,destination)\nos.environ.pop('INSPECTOR_DURABLE_TEXT_CACHE_ROOT',None)\nwith patch.object(mod,'_download_source',side_effect=download):\n result=mod.process_document_text_layer_v4_full(x['lease'],x['attempt'],'v4-integration')\njson.dump(result,sys.stdout,ensure_ascii=False,separators=(',',':'))`;
(adminUrl ? describe : describe.skip)("V4 full676 source NORMAL isolated PG/API", { timeout: 180000 }, () => {
  const name = `qa_v4_${randomUUID().replaceAll("-", "")}`, org = `qa-v4-${randomUUID()}`;
  let admin: Pool, db: Pool, repo: PostgresInspectionRepository, dir: string, actor: AuthenticatedActor, app: Awaited<ReturnType<typeof buildApp>>;
  let objectId: string, checkId: string, fileId: string, foreignId: string, original: string, textJob: any, result: any;
  const headers = { cookie: "inspector_session=session; inspector_csrf=csrf", "x-csrf-token": "csrf", "idempotency-key": randomUUID() };
  const worker = { "x-worker-token": "v4-local-worker-token", "content-type": "application/json" };
  function python(code: string, input?: unknown) {
    const child = spawnSync(pythonExecutable, ["-c", code], { cwd: projectRoot,
      env: { ...process.env, ...pythonEnv, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 60000,
      input: input === undefined ? undefined : JSON.stringify(input), maxBuffer: 33554432 });
    expect(child.status, child.stderr).toBe(0); return child.stdout;
  }
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5000, query_timeout: 20000 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(adminUrl!); url.pathname = `/${name}`; await runDatabaseMigrations(url.toString());
    db = new Pool({ connectionString: url.toString(), statement_timeout: 20000, query_timeout: 25000 });
    dir = await mkdtemp(join(tmpdir(), "qa-v4-full-")); original = join(dir, "authored676.pdf");
    python(`import sys\nfrom pathlib import Path\nsys.path.insert(0,'services/worker/tests')\nfrom test_document_text_v4_full import authored_pdf\nPath(${JSON.stringify(original)}).write_bytes(authored_pdf(676))`);
    repo = await PostgresInspectionRepository.create({ connectionString: url.toString(), parameters: (await loadReferenceData()).parameters,
      analysisProfile: "MATRIX_V1", organizationSlug: org, storage: new LocalObjectStorage(dir) });
    objectId = (await repo.createObject({ name: "V4 authored676 full source audit", address: "Disposable local" })).id;
    const u = await provisionLocalUser(db, { organizationSlug: org, login: `qa-${randomUUID()}`, displayName: "V4 reader", password: "Synthetic-V4-Only-2026!",
      objectApiIds: [objectId], objectPermissions: ["READ", "RUN", "REVIEW_DECIDE"] });
    actor = { sessionId: randomUUID(), userId: u.id, organizationId: u.organizationId, displayName: "V4 reader", roles: ["INSPECTOR"],
      capabilities: ["SOURCE_REVIEW", "RUN_START"], csrfHash: "x", expiresAt: "2030-01-01T00:00:00Z" } as AuthenticatedActor;
    const pdf = readFileSync(original); fileId = `FIL-${randomUUID()}`;
    await repo.registerIngestedFiles(objectId, [{ id: fileId, name: "authored676.pdf", stage: "RD", size: pdf.length, mimeType: "application/pdf", sha256: sha(pdf), scanStatus: "CLEAN", status: "STORED", storageKey: "authored676.pdf" }]);
    const foreignObject = (await repo.createObject({ name: "Cross-object neighbour", address: "Disposable local" })).id;
    foreignId = `FIL-${randomUUID()}`;
    await repo.registerIngestedFiles(foreignObject, [{ id: foreignId, name: "foreign676.pdf", stage: "RD", size: pdf.length, mimeType: "application/pdf", sha256: sha(pdf), scanStatus: "CLEAN", status: "STORED", storageKey: "authored676.pdf" }]);
    // Mixed stage declaration is frozen in manifest; full reading cannot authorize RD automatically.
    await db.query("INSERT INTO source_file_stages (source_file_id,stage) SELECT id,'PD' FROM source_files WHERE api_id=$1", [fileId]);
    app = await buildApp({ repository: repo, workerToken: worker["x-worker-token"], identityService: {
      login: async () => undefined, resolveSession: async t => t === "session" ? actor : undefined, verifyCsrf: (_a, t) => t === "csrf",
      revokeSession: async () => undefined, close: async () => undefined,
    } });
  });
  afterAll(async () => {
    await app?.close(); await db?.end(); if (dir) await rm(dir, { recursive: true, force: true });
    if (admin) { try { await admin.query(`DROP DATABASE IF EXISTS "${name}"`); } finally { await admin.end(); } }
  });
  async function claim(type: string) {
    const rows = (await db.query("SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.job_type=$2 AND job.state='READY'", [checkId, type])).rows;
    expect(rows).toHaveLength(1); const acquired = await repo.claimJob(rows[0].id, { workerId: "v4-integration", capabilities: [type as any] });
    expect(acquired.kind).toBe("acquired"); if (acquired.kind !== "acquired") throw Error("No lease");
    return { id: rows[0].id, lease: acquired.lease as any, attempt: { attemptId: acquired.lease.attemptId, fencingToken: acquired.lease.fencingToken } };
  }
  async function artifacts() { return (await db.query("SELECT count(*)::int n FROM analysis_text_artifacts")).rows[0].n; }
  it("public explicit start creates9 jobs and pins full source producer; actual Python returns all676", async () => {
    const url = `/api/objects/${objectId}/source-audit-v4-full-source-v1`;
    const unauth = await app.inject({ method: "POST", url, payload: {} }); expect(unauth.statusCode, unauth.body).toBe(401);
    const started = await app.inject({ method: "POST", url, headers, payload: {} }); expect(started.statusCode, started.body).toBe(201);
    checkId = started.json().id; expect(started.json()).toMatchObject({ mode: "NORMAL", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: profile });
    expect((await app.inject({ method: "POST", url, headers, payload: {} })).headers["idempotency-replayed"]).toBe("true");
    const inventory = await claim("ANALYSIS_INVENTORY");
    expect(inventory.lease.release.textLayer).toMatchObject({ artifactSchemaVersion: "document-text-v4", sourceAuditProfileVersion: profile });
    expect(inventory.lease.release.rules.executionStatus).toBe("UNCONFIGURED");
    const savedRelease = (await db.query("SELECT release.content_json FROM analysis_releases release JOIN analysis_runs run ON run.release_id=release.release_id WHERE run.api_id=$1", [checkId])).rows[0].content_json;
    expect(savedRelease.providerSlots.map((slot: any) => slot.stageJobType).sort()).toEqual([
      "DOCUMENT_RENDER", "DOCUMENT_METADATA", "DOCUMENT_OCR_LAYOUT", "DOCUMENT_LINKING", "ENTITY_EXTRACTION", "RULE_EVALUATION", "EVIDENCE_VALIDATION",
    ].sort());
    expect(savedRelease.providerSlots.every((s: any) => s.status === "UNCONFIGURED")).toBe(true);
    expect((await repo.completeJob(inventory.id, { ...inventory.attempt, result: { disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 1, ID: 0 } } })).kind).toBe("completed");
    textJob = await claim("DOCUMENT_TEXT_LAYER"); result = JSON.parse(python(processor, { ...textJob, original }));
    const artifact = result.sources[0].artifact;
    expect(artifact.pageCount).toBe(676); expect(artifact.pages.map((p: any) => p.pageNumber)).toEqual(Array.from({ length: 676 }, (_, i) => i + 1));
    expect(artifact.pages.at(-1).locatedLines[0].rawText).toBe("FULLSOURCE PAGE 676\n");
    expect(artifact.inputSha256).toBe(sha(readFileSync(original))); expect(await artifacts()).toBe(0);
  });
  it("API rejects wrong profile, stale fence, missing/duplicate/out-of-budget pages before insert or lease mutation", async () => {
    const complete = (value: any, route = "complete-source-audit-v4-full-source-v1", attempt = textJob.attempt) => app.inject({ method: "POST", url: `/api/internal/v1/jobs/${textJob.id}/${route}`, headers: worker, payload: JSON.stringify({ ...attempt, result: value }) });
    expect((await complete(result, "complete")).statusCode).toBe(409);
    expect((await complete(result, "complete-source-audit-v3-large-v1")).statusCode).toBe(409);
    expect((await complete(result, undefined, { ...textJob.attempt, fencingToken: textJob.attempt.fencingToken + 1 })).statusCode).toBe(409);
    const before = (await db.query("SELECT state,current_attempt_id,fencing_token,lease_until FROM analysis_jobs WHERE id=$1", [textJob.id])).rows;
    for (const mutate of [(v: any) => v.sources[0].artifact.pages.splice(300, 1), (v: any) => v.sources[0].artifact.pages[300] = structuredClone(v.sources[0].artifact.pages[299]), (v: any) => v.sources[0].artifact.pages = Array(1025).fill(null), (v: any) => v.sources[0].inputSha256 = "0".repeat(64), (v: any) => v.sources[0].sourceFileId = foreignId, (v: any) => v.sources.push(structuredClone(v.sources[0]))]) {
      const bad = structuredClone(result); mutate(bad); expect((await complete(bad)).statusCode).toBe(409); expect(await artifacts()).toBe(0);
      expect((await db.query("SELECT state,current_attempt_id,fencing_token,lease_until FROM analysis_jobs WHERE id=$1", [textJob.id])).rows).toEqual(before);
    }
    const duplicate = await app.inject({ method: "POST", url: `/api/internal/v1/jobs/${textJob.id}/complete-source-audit-v4-full-source-v1`, headers: worker,
      payload: `{"attemptId":${JSON.stringify(textJob.attempt.attemptId)},"fencingToken":${textJob.attempt.fencingToken},"result":{},"result":{}}` });
    expect(duplicate.statusCode).toBe(400); expect(await artifacts()).toBe(0);
    const accepted = await complete(result); expect(accepted.statusCode, accepted.body).toBe(200); expect(accepted.json().status).toBe("COMPLETED");
    expect((await complete(result)).json().replayed).toBe(true); expect(await artifacts()).toBe(1);
    const stored = (await db.query("SELECT schema_version,resource_policy_version,page_count FROM analysis_text_artifacts")).rows;
    expect(stored).toEqual([{ schema_version: "document-text-v4", resource_policy_version: "document-text-v4-full-source-bounds-v1", page_count: 676 }]);
    // DB rejects a v4 row with a NULL policy, even if shape and historical8MiB ceiling fit.
    const constraint = await db.connect();
    try {
      await constraint.query("BEGIN");
      await constraint.query("ALTER TABLE analysis_text_artifacts DISABLE TRIGGER analysis_text_artifacts_immutable");
      await expect(constraint.query("UPDATE analysis_text_artifacts SET resource_policy_version=NULL")).rejects.toMatchObject({ code: "23514" });
    } finally { await constraint.query("ROLLBACK"); constraint.release(); }
    for (const type of ["DOCUMENT_RENDER", "DOCUMENT_METADATA", "DOCUMENT_LINKING", "ENTITY_EXTRACTION", "RULE_EVALUATION", "EVIDENCE_VALIDATION"]) {
      const job = await claim(type);
      const value = JSON.parse(python("import json,sys\nfrom inspector_worker.stage_scaffold import DEFAULT_STAGE_PROVIDER_REGISTRY\nx=json.load(sys.stdin)\njson.dump(DEFAULT_STAGE_PROVIDER_REGISTRY.execute(x['type'],x['lease'],x['attempt']),sys.stdout)", { type, ...job }));
      expect(value.outputCount).toBe(0); expect((await repo.completeJob(job.id, { ...job.attempt, result: value })).kind).toBe("completed");
    }
    const seal = await claim("ANALYSIS_SEAL_UNSUPPORTED"); expect((await repo.completeJob(seal.id, { ...seal.attempt, result: { disposition: "UNSUPPORTED_COVERAGE_SEALED" } })).kind).toBe("completed");
    expect((await db.query("SELECT state,count(*)::int n FROM analysis_jobs GROUP BY state")).rows).toEqual([{ state: "SUCCEEDED", n: 9 }]);
    expect((await db.query("SELECT count(*)::int n FROM rule_results")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int n FROM analysis_jobs WHERE job_type='DOCUMENT_OCR_LAYOUT'")).rows[0].n).toBe(0);
  });
  it("authenticated API batches reconstruct676 exactly, preserve mixed-stage UNRESOLVED and refuse bad continuation/scope", async () => {
    const base = `/api/checks/${checkId}/source-text-v4-full-source-v1`;
    const whole = await app.inject({ url: `${base}?sourceFileId=${fileId}`, headers }); expect(whole.statusCode, whole.body).toBe(200);
    expect(whole.json()).toMatchObject({ sourceAuditProfileVersion: profile, stage: "UNRESOLVED", calibratedProbability: null, renderedVisibility: "UNVERIFIED" });
    expect(whole.json().textArtifact.pages.at(-1).pageNumber).toBe(676);
    const numbers: number[] = []; let page: number | null = 1, hash = "";
    while (page !== null) {
      const cursor = page > 1 ? `&expectedArtifactContentHash=${hash}` : "";
      const batch: { statusCode: number; body: string; json: () => DocumentTextV4FullAuditPageBatchRead } = await app.inject({ url: `${base}/pages?sourceFileId=${fileId}&startPage=${page}&pageLimit=128${cursor}`, headers });
      expect(batch.statusCode, batch.body).toBe(200); const value: DocumentTextV4FullAuditPageBatchRead = batch.json(); hash = value.textArtifactContentHash;
      expect(value.wholeArtifactPageCount).toBe(676); expect(value).not.toHaveProperty("textArtifact");
      numbers.push(...value.pages.map((p: any) => p.pageNumber)); page = value.nextPage;
    }
    expect(numbers).toEqual(Array.from({ length: 676 }, (_, i) => i + 1));
    for (const suffix of ["startPage=129&pageLimit=128", `startPage=677&pageLimit=1&expectedArtifactContentHash=${hash}`, `startPage=1&pageLimit=1&expectedArtifactContentHash=${"0".repeat(64)}`]) expect((await app.inject({ url: `${base}/pages?sourceFileId=${fileId}&${suffix}`, headers })).statusCode).toBe(409);
    expect((await app.inject({ url: `${base}/pages?sourceFileId=${fileId}&startPage=1&pageLimit=129`, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: `${base}?sourceFileId=${fileId}` })).statusCode).toBe(401);
    expect((await app.inject({ url: `${base}?sourceFileId=${foreignId}`, headers })).statusCode).toBe(404);
    expect(await repo.getDocumentTextV3LargeSource(checkId, fileId, actor)).toBeUndefined();
    expect(await repo.getMatrixInventorySourcePages(checkId, fileId, actor)).toBeUndefined();
    expect((await repo.getCheck(checkId, actor)) as any).toMatchObject({ status: "PARTIAL", sourceAuditProfileVersion: profile, purpose: "SOURCE_AUDIT_ONLY" });
  });
  it("frozen manifest stages survive current stage changes while review metadata stays explicitly latest", async () => {
    const base = `/api/checks/${checkId}/source-text-v4-full-source-v1`;
    const firstReview = await repo.recordSourceReviewCommand(objectId, fileId, {
      sourceSha256: sha(readFileSync(original)), revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      linkGroupId: null, pageStages: { "676": "PD" }, expectedReviewHash: null,
      basis: { reference: "SYNTHETIC review for mixed PD/RD declaration before current stages change" },
    }, { actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() });
    expect(firstReview.kind, JSON.stringify(firstReview)).toBe("success");
    if (firstReview.kind !== "success") throw Error("Initial synthetic review was not stored");
    const beforeResponse = await app.inject({ url: `${base}?sourceFileId=${fileId}`, headers });
    expect(beforeResponse.statusCode, beforeResponse.body).toBe(200);
    const before = beforeResponse.json();
    expect(before).toMatchObject({ stage: "UNRESOLVED", latestReviewHash: firstReview.value.contentHash, pageStages: { "676": "PD" } });
    const manifestQuery = "SELECT manifest.sha256,manifest.canonical_json FROM input_manifests manifest JOIN analysis_runs run ON run.manifest_id=manifest.id WHERE run.api_id=$1";
    const manifestBefore = (await db.query(manifestQuery, [checkId])).rows;
    expect(manifestBefore[0].canonical_json.sources[0].stages).toEqual(["PD", "RD"]);
    await db.query("DELETE FROM source_file_stages WHERE source_file_id=(SELECT id FROM source_files WHERE api_id=$1) AND stage='PD'", [fileId]);
    const decision = await repo.recordSourceReviewCommand(objectId, fileId, {
      sourceSha256: before.sourceSha256, revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      linkGroupId: null, pageStages: {}, expectedReviewHash: firstReview.value.contentHash,
      basis: { reference: "SYNTHETIC latest review after stage declaration changed; no engineering approval claim" },
    }, { actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() });
    expect(decision.kind, JSON.stringify(decision)).toBe("success");
    if (decision.kind !== "success") throw Error("Latest synthetic review was not stored");
    const afterResponse = await app.inject({ url: `${base}?sourceFileId=${fileId}`, headers });
    expect(afterResponse.statusCode, afterResponse.body).toBe(200);
    const after = afterResponse.json();
    expect(after).toEqual({ ...before, pageStages: {}, latestReviewHash: decision.value.contentHash });
    const batchResponse = await app.inject({ url: `${base}/pages?sourceFileId=${fileId}&startPage=641&pageLimit=128&expectedArtifactContentHash=${before.textArtifactContentHash}`, headers });
    expect(batchResponse.statusCode, batchResponse.body).toBe(200);
    expect(batchResponse.json()).toMatchObject({ stage: "UNRESOLVED", pageStages: {}, latestReviewHash: decision.value.contentHash,
      inputManifestHash: before.inputManifestHash, textArtifactByteSha256: before.textArtifactByteSha256, nextPage: null });
    expect(batchResponse.json().pages).toEqual(before.textArtifact.pages.slice(640));
    expect((await db.query(manifestQuery, [checkId])).rows).toEqual(manifestBefore);
  });
  it("historical full artifact survives a newer old-profile start and a fresh repository", async () => {
    const before = await repo.getDocumentTextV4FullSource(checkId, fileId, actor);
    const started = await repo.startCheckCommand(objectId, { actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() }, { sourceAuditV3: true });
    expect(started.kind).toBe("success");
    expect(await repo.getDocumentTextV4FullSource(checkId, fileId, actor)).toEqual(before);
    const url = new URL(adminUrl!); url.pathname = `/${name}`;
    const reopened = await PostgresInspectionRepository.create({ connectionString: url.toString(), parameters: (await loadReferenceData()).parameters, analysisProfile: "MATRIX_V1", organizationSlug: org, storage: new LocalObjectStorage(dir) });
    try { expect(await reopened.getDocumentTextV4FullSource(checkId, fileId, actor)).toEqual(before); }
    finally { await reopened.close(); }
  });
});
