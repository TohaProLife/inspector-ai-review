import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { LocalObjectStorage } from "../src/storage.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const root = new URL("../../../", import.meta.url);
const manual = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const originals = [
  manual("fixtures/document-text-v3-figures-v1/qa-core-manual-goldens.json").cases[0],
  manual("fixtures/document-text-v3-v1/qa-core-manual-goldens.json").cases[0],
];
// Independently frozen before T62 algorithms: original PDF, whole raw/native/manual output.
// Only sourceFileId and current selected extractorProfile/hash may change for this run.
const domainHash = (artifact: unknown) => sha256(canonicalJson({ hashDomain: "document-text-v3-content-v1", artifact }));
const profileHash = (profile: unknown) => sha256(canonicalJson({ hashDomain: "document-text-extractor-profile-v1", profile }));
const extract = `import json,sys
from pathlib import Path
from inspector_worker.document_text_v3 import extract_pdf_text_artifact_v3
x=json.load(sys.stdin)
json.dump([extract_pdf_text_artifact_v3(Path(s['path']),s['id'],s['sha'],traversal_policy_version='pdfminer-analyzed-figures-boxes-flow-none-v1') for s in x],sys.stdout,ensure_ascii=False)`;
const scaffold = `import json,sys
from inspector_worker.stage_scaffold import DEFAULT_STAGE_PROVIDER_REGISTRY
x=json.load(sys.stdin)
json.dump(DEFAULT_STAGE_PROVIDER_REGISTRY.execute(x['type'],x['lease'],x['attempt']),sys.stdout)`;

(adminUrl ? describe : describe.skip)("T62 isolated durable v3 source audit", { timeout: 240_000 }, () => {
  const name = `text_v3_audit_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, database: Pool, repository: PostgresInspectionRepository, directory: string;
  let actor: AuthenticatedActor, stranger: AuthenticatedActor, objectId: string, checkId: string;
  let foreignSourceId: string, files: any[], artifacts: any[], textJob: any, textLease: any, textAttempt: any;
  const read = async (sourceId = files[0].id, who = actor) => (repository as any).getDocumentTextV3Source(checkId, sourceId, who);
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5000, query_timeout: 20000 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(adminUrl!); url.pathname = `/${name}`;
    await runDatabaseMigrations(url.toString());
    database = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000 });
    directory = await mkdtemp(join(tmpdir(), "text-v3-audit-"));
    repository = await PostgresInspectionRepository.create({ connectionString: url.toString(),
      parameters: (await loadReferenceData()).parameters, analysisProfile: "SOURCE_AUDIT_V3" as any,
      organizationSlug: "text-v3-audit-it", storage: new LocalObjectStorage(directory) });
    objectId = (await repository.createObject({ name: "T62 authored source audit; no design approval", address: "Москва" })).id;
    const user = async (objects: string[]) => {
      const u = await provisionLocalUser(database, { organizationSlug: "text-v3-audit-it", login: `audit-${randomUUID()}`,
        displayName: "Source audit reader", password: "Source-Audit-Test-2026!", objectApiIds: objects, objectPermissions: ["READ", "REVIEW_DECIDE"] });
      return { sessionId: randomUUID(), userId: u.id, organizationId: u.organizationId, displayName: "Source audit reader",
        roles: ["INSPECTOR"], capabilities: ["SOURCE_REVIEW"], csrfHash: "x", expiresAt: "2030-01-01T00:00:00Z" } as AuthenticatedActor;
    };
    actor = await user([objectId]); stranger = await user([]);
    files = originals.map((c: any, i: number) => {
      const bytes = readFileSync(new URL(c.originalPath, root)); expect(sha256(bytes)).toBe(c.originalSha256);
      return { id: `FIL-${randomUUID()}`, name: `T62-original-${i}.pdf`, stage: i === 0 ? "PD" : "RD",
        size: bytes.length, mimeType: "application/pdf", sha256: c.originalSha256, scanStatus: "CLEAN", status: "STORED",
        storageKey: `canonical-original-${randomUUID()}.pdf` };
    });
    await repository.registerIngestedFiles(objectId, files);
    const other = (await repository.createObject({ name: "T62 unrelated source", address: "Москва" })).id;
    foreignSourceId = `FIL-${randomUUID()}`;
    await repository.registerIngestedFiles(other, [{ ...files[0], id: foreignSourceId }]);
    const produced = spawnSync(pythonExecutable, ["-c", extract], { cwd: root, encoding: "utf8", timeout: 30000,
      env: { ...process.env, ...pythonEnv }, input: JSON.stringify(files.map((f, i) => ({ id: f.id, sha: f.sha256, path: originals[i].originalPath }))) });
    expect(produced.status, produced.stderr).toBe(0); artifacts = JSON.parse(produced.stdout);
    for (const [i, artifact] of artifacts.entries()) {
      expect(artifact).toEqual({ ...originals[i].artifact, sourceFileId: files[i].id,
        extractorProfile: artifact.extractorProfile, extractorProfileHash: profileHash(artifact.extractorProfile) });
    }
    checkId = (await repository.startCheck(objectId))!.id;
  });
  afterAll(async () => {
    await repository?.close(); await database?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
    if (admin) try {
      await admin.query("SET statement_timeout=10000"); await admin.query("SET lock_timeout=5000");
      expect((await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n).toBe(0);
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    } finally { await admin.end(); }
  });
  async function claim(type: string) {
    const selected = await database.query(`SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id
      WHERE run.api_id=$1 AND job.job_type=$2 AND job.state='READY'`, [checkId, type]);
    expect(selected.rows).toHaveLength(1);
    const acquired = await repository.claimJob(selected.rows[0].id, { workerId: "text-v3-audit-it", capabilities: [type as any] });
    expect(acquired.kind).toBe("acquired"); if (acquired.kind !== "acquired") throw Error("Expected current lease");
    return { id: selected.rows[0].id, lease: acquired.lease, attempt: { attemptId: acquired.lease.attemptId, fencingToken: acquired.lease.fencingToken } };
  }
  const result = () => ({ disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", purpose: "SOURCE_AUDIT_ONLY",
    sources: artifacts.map(artifact => ({ sourceFileId: artifact.sourceFileId, inputSha256: artifact.inputSha256, status: "EXTRACTED", artifact })),
    workerId: "text-v3-audit-it" });
  const rows = () => database.query(`SELECT * FROM analysis_text_artifacts`);

  it("selects isolated pinned release; withholds unsealed source and rejects stale/adulterated completion without inserts", async () => {
    const inventory = await claim("ANALYSIS_INVENTORY");
    const runtimeRelease = inventory.lease.release as unknown as { textLayer: unknown; rules: { executionStatus: string } };
    expect(runtimeRelease.textLayer).toMatchObject({ artifactSchemaVersion: "document-text-v3", purpose: "SOURCE_AUDIT_ONLY" });
    expect(runtimeRelease.rules.executionStatus).toBe("UNCONFIGURED");
    expect((await repository.completeJob(inventory.id, { ...inventory.attempt,
      result: { disposition: "MANIFEST_INVENTORIED", sourceCount: 2, stageCounts: { PD: 1, RD: 1, ID: 0 } } })).kind).toBe("completed");
    const current = await claim("DOCUMENT_TEXT_LAYER"); textJob = current.id; textLease = current.lease; textAttempt = current.attempt;
    expect(await read()).toBeUndefined();
    expect((await repository.completeJob(textJob, { ...textAttempt, fencingToken: textAttempt.fencingToken + 1, result: result() })).kind).toBe("stale_attempt");
    for (const mutate of [
      (v: any) => { delete v.purpose; },
      (v: any) => { v.sources[0].artifact.pages[0].locatedLines[0].rawText += "FORGED"; },
      (v: any) => { v.sources[0].artifact.extractorProfile.documentTextV3SourceSha256 = "a".repeat(64);
        v.sources[0].artifact.extractorProfileHash = profileHash(v.sources[0].artifact.extractorProfile); },
      (v: any) => { v.sources[0].sourceFileId = foreignSourceId; },
      (v: any) => { v.sources.push(structuredClone(v.sources[0])); },
    ]) {
      const forged = structuredClone(result()); mutate(forged);
      expect((await repository.completeJob(textJob, { ...textAttempt, result: forged })).kind).toBe("invalid_state");
      expect((await rows()).rows).toHaveLength(0);
    }
  });
  it("commits whole raw/native audit with separate hashes; duplicate complete is harmless and no v2/OCR adapter can consume it", async () => {
    expect((await repository.completeJob(textJob, { ...textAttempt, result: result() })).kind).toBe("completed");
    const stored = (await rows()).rows; expect(stored).toHaveLength(2);
    for (const [i, artifact] of artifacts.entries()) {
      const row = stored.find(r => r.input_sha256.trim() === files[i].sha256);
      expect(row.content_json).toEqual(artifact); expect(row.schema_version).toBe("document-text-v3");
      expect(row.text_page_count).toBe(artifact.locatedTextPageCount);
      expect(row.content_hash.trim()).toBe(sha256(canonicalJson(artifact)));
      expect(row.content_hash.trim()).not.toBe(domainHash(artifact));
    }
    expect(await repository.completeJob(textJob, { ...textAttempt, result: result() })).toMatchObject({ kind: "completed", replayed: true });
    expect((await rows()).rows).toHaveLength(2);
    expect((await database.query("SELECT 1 FROM analysis_jobs WHERE job_type='DOCUMENT_OCR_LAYOUT'")).rows).toHaveLength(0);
    const summary = (await database.query("SELECT result_json FROM analysis_jobs WHERE id=$1", [textJob])).rows[0].result_json;
    expect(summary.ocrRequiredPageCount).toBe(1); expect(summary.purpose).toBe("SOURCE_AUDIT_ONLY");
    const render = await claim("DOCUMENT_RENDER");
    expect(await repository.getJobTextArtifact(render.id, files[0].id, render.attempt)).toEqual({ kind: "not_found" });
    expect(await read()).toBeUndefined();
    const completeScaffold = async (type: string, current: Awaited<ReturnType<typeof claim>>) => {
      expect(current.lease.release.providerSlot?.status).toBe("UNCONFIGURED");
      const actual = spawnSync(pythonExecutable, ["-c", scaffold], { cwd: root, encoding: "utf8", timeout: 30000,
        env: { ...process.env, ...pythonEnv }, input: JSON.stringify({ type, ...current }) });
      expect(actual.status, actual.stderr).toBe(0); const value = JSON.parse(actual.stdout); expect(value.outputCount).toBe(0);
      expect((await repository.completeJob(current.id, { ...current.attempt, result: value })).kind).toBe("completed");
    };
    await completeScaffold("DOCUMENT_RENDER", render);
    for (const type of ["DOCUMENT_METADATA", "DOCUMENT_LINKING", "ENTITY_EXTRACTION", "RULE_EVALUATION", "EVIDENCE_VALIDATION"])
      await completeScaffold(type, await claim(type));
    const seal = await claim("ANALYSIS_SEAL_UNSUPPORTED");
    expect((await repository.completeJob(seal.id, { ...seal.attempt, result: { disposition: "UNSUPPORTED_COVERAGE_SEALED" } })).kind).toBe("completed");
    expect(await repository.getCheck(checkId, actor)).toMatchObject({ status: "PARTIAL", progress: 100 });
    expect((await database.query("SELECT count(*)::int n FROM parameter_coverage WHERE execution_rollup='UNSUPPORTED'")).rows[0].n).toBe(132);
    expect((await database.query("SELECT count(*)::int n FROM rule_results")).rows[0].n).toBe(0);
    expect((await database.query("SELECT count(*)::int n FROM machine_prediction_snapshots")).rows[0].n).toBe(0);
  });
  it("publishes exact full source after seal, denies foreign scope and preserves append-only bytes on reads", async () => {
    const before = sha256(JSON.stringify((await rows()).rows));
    for (const [i, artifact] of artifacts.entries()) {
      const value = await read(files[i].id);
      expect(value).toMatchObject({ schemaVersion: "document-text-v3-source-read-v1", purpose: "SOURCE_AUDIT_ONLY", checkId,
        sourceFileId: files[i].id, sourceSha256: files[i].sha256, stage: files[i].stage, latestReviewHash: null,
        textArtifactByteSha256: sha256(canonicalJson(artifact)), textArtifactContentHash: domainHash(artifact),
        extractorProfileHash: artifact.extractorProfileHash, authorityStatus: "SOURCE_DECLARED_UNVERIFIED",
        renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact });
      expect(value.textArtifact).toEqual(artifact);
    }
    expect(await read(foreignSourceId)).toBeUndefined();
    expect([undefined, "AUTH_REQUIRED"]).toContain(await read(files[0].id, stranger));
    expect([undefined, "AUTH_REQUIRED"]).toContain(await read(files[0].id, { ...actor, organizationId: randomUUID() }));
    expect(await repository.getMatrixInventorySourcePages(checkId, files[0].id, actor)).toBeUndefined();
    expect(sha256(JSON.stringify((await rows()).rows))).toBe(before);
    await expect(database.query("UPDATE analysis_text_artifacts SET page_count=page_count")).rejects.toThrow();
    await expect(database.query("DELETE FROM analysis_text_artifacts")).rejects.toThrow();
  });
});
