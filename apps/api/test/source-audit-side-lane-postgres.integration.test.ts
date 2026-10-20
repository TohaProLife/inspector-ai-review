/** Owned disposable PG; hand-authored worker artifacts test admission/lifecycle, not extraction accuracy. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { sha256 } from "../src/canonical-json.js";
import { fullSourceV4Artifact } from "./full-source-v4-fixture.js";
import { isFrozenSourceAuditRelease } from "../src/source-audit-release-identity.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const migration = readFileSync(new URL("../../../migrations/052_source_audit_side_lane.sql", import.meta.url), "utf8");
const profile = "SOURCE_AUDIT_V4_FULL_SOURCE_V1" as const;
const scaffold = {
  DOCUMENT_RENDER: ["PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"],
  DOCUMENT_METADATA: ["PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED", "METADATA_EXTRACTOR"],
  DOCUMENT_LINKING: ["POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"],
  ENTITY_EXTRACTION: ["PROVIDER_NOT_CONFIGURED", "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED", "ENTITY_EXTRACTION_MODEL"],
  RULE_EVALUATION: ["UNSUPPORTED_RULESET", "EXECUTABLE_RULES_NOT_CONFIGURED", "RULE_ENGINE"],
  EVIDENCE_VALIDATION: ["NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"],
} as const;

(adminUrl ? describe : describe.skip)("source audit side lane and narrow OPEN repair", { timeout: 120000 }, () => {
  const database = `qa_side_${randomUUID().replaceAll("-", "")}`, org = `qa-side-${randomUUID()}`;
  let admin: Pool, db: Pool, repo: PostgresInspectionRepository;
  const command = (actor: AuthenticatedActor) => ({ actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() });
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(adminUrl!); url.pathname = `/${database}`;
    await runDatabaseMigrations(url.toString());
    db = new Pool({ connectionString: url.toString(), statement_timeout: 20000 });
    repo = await PostgresInspectionRepository.create({ connectionString: url.toString(), organizationSlug: org,
      parameters: (await loadReferenceData()).parameters, analysisProfile: "SCAFFOLD" });
  });
  afterAll(async () => {
    await repo?.close(); await db?.end();
    if (admin) { try { await admin.query(`DROP DATABASE IF EXISTS "${database}"`); } finally { await admin.end(); } }
  });
  async function fixture(withEngineering = true) {
    const object = await repo.createObject({ name: "Synthetic side-lane test", address: `Owned ${randomUUID()}` });
    const user = await provisionLocalUser(db, { organizationSlug: org, login: `side-${randomUUID()}`, displayName: "Side reader",
      role: "SUPERVISOR", password: "Synthetic-Side-Lane-2026!", objectApiIds: [object.id],
      objectPermissions: ["READ", "UPLOAD", "RUN", "REVIEW_DECIDE", "FINALIZE"] });
    const actor = { sessionId: randomUUID(), userId: user.id, organizationId: user.organizationId, displayName: "Side reader",
      roles: ["SUPERVISOR"], capabilities: ["SOURCE_REVIEW"], csrfHash: "unused", expiresAt: "2030-01-01T00:00:00Z" } as AuthenticatedActor;
    const fileId = `FIL-${randomUUID()}`, digest = sha256("Synthetic worker-admission source, not a parsed PDF");
    await repo.registerIngestedFiles(object.id, [{ id: fileId, name: "synthetic.pdf", stage: "PD", size: 55,
      mimeType: "application/pdf", sha256: digest, scanStatus: "CLEAN", status: "STORED", storageKey: `${fileId}.pdf` }]);
    const engineering = withEngineering ? await repo.startCheck(object.id, actor) : undefined;
    if (engineering) await repo.completeCheck(engineering.id);
    const started = await repo.startCheckCommand(object.id, command(actor), { sourceAuditV4Full: true });
    expect(started.kind).toBe("success"); if (started.kind !== "success") throw Error("No audit");
    const internal = (await db.query("SELECT id,inspection_id,object_id,manifest_id,release_id FROM analysis_runs WHERE api_id=$1", [started.value.id])).rows[0];
    return { object, actor, engineering, audit: started.value, internal, fileId, digest };
  }
  async function claim(checkId: string, type: string) {
    const rows = await db.query("SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.job_type=$2 AND job.state='READY'", [checkId, type]);
    expect(rows.rows).toHaveLength(1);
    const result = await repo.claimJob(rows.rows[0].id, { workerId: "synthetic-side-test", capabilities: [type as any] });
    expect(result.kind).toBe("acquired"); if (result.kind !== "acquired") throw Error("No lease");
    return { id: rows.rows[0].id, lease: result.lease, attempt: { attemptId: result.lease.attemptId, fencingToken: result.lease.fencingToken } };
  }
  it("runs all nine detached jobs, stores text/history, preserves engineering, then finalizes it without another run", async () => {
    const f = await fixture(), before = await repo.getObject(f.object.id, f.actor);
    expect(before).not.toBe("AUTH_REQUIRED");
    const same = await repo.startCheckCommand(f.object.id, command(f.actor), { sourceAuditV4Full: true });
    expect(same.kind).toBe("success"); if (same.kind === "success") expect(same.value.id).toBe(f.audit.id);
    const inventory = await claim(f.audit.id, "ANALYSIS_INVENTORY");
    const savedRelease = (await db.query("SELECT content_json FROM analysis_releases WHERE release_id=$1", [f.internal.release_id])).rows[0].content_json;
    expect(isFrozenSourceAuditRelease(savedRelease)).toBe(true);
    expect((await repo.completeJob(inventory.id, { ...inventory.attempt, result: { disposition: "MANIFEST_INVENTORIED", sourceCount: 1, stageCounts: { PD: 1, RD: 0, ID: 0 } } })).kind).toBe("completed");
    const text = await claim(f.audit.id, "DOCUMENT_TEXT_LAYER");
    const layer = savedRelease.textLayer;
    expect((text.lease.release as any).textLayer).toEqual(layer);
    const artifact = fullSourceV4Artifact(layer.extractorProfile, layer.extractorProfileHash, 3);
    artifact.sourceFileId = f.fileId; artifact.inputSha256 = f.digest;
    expect((await repo.completeJob(text.id, { ...text.attempt, result: { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
      purpose: "SOURCE_AUDIT_ONLY", resourcePolicyVersion: "document-text-v4-full-source-bounds-v1",
      sources: [{ sourceFileId: f.fileId, inputSha256: f.digest, status: "EXTRACTED", artifact }], workerId: "synthetic-side-test" } },
      { sourceAuditProfileVersion: profile })).kind).toBe("completed");
    for (const [type, [disposition, reasonCode, providerKind]] of Object.entries(scaffold)) {
      const job = await claim(f.audit.id, type);
      expect((await repo.completeJob(job.id, { ...job.attempt, result: { schemaVersion: "analysis-stage-result-v1", jobType: type,
        inputManifestHash: job.lease.inputManifestHash, disposition, reasonCode, providerKind,
        providerProfileId: null, providerConfigHash: null, outputCount: 0 } })).kind).toBe("completed");
    }
    const seal = await claim(f.audit.id, "ANALYSIS_SEAL_UNSUPPORTED");
    expect((await repo.completeJob(seal.id, { ...seal.attempt, result: { disposition: "UNSUPPORTED_COVERAGE_SEALED" } })).kind).toBe("completed");
    const after = await repo.getObject(f.object.id, f.actor);
    expect(after).toMatchObject({ activeCheckId: f.engineering!.id, status: "PARTIAL", stats: (before as any).stats });
    expect((await db.query("SELECT state,count(*)::int n FROM analysis_jobs WHERE run_id=$1 GROUP BY state", [f.internal.id])).rows).toEqual([{ state: "SUCCEEDED", n: 9 }]);
    expect((await db.query("SELECT page_count FROM analysis_text_artifacts WHERE run_id=$1", [f.internal.id])).rows).toEqual([{ page_count: 3 }]);
    const current = await repo.getCheck(f.engineering!.id, f.actor); if (!current || current === "AUTH_REQUIRED") throw Error("No engineering");
    const final = await repo.finalizeCommand(current.id, { ...command(f.actor), expectedVersion: current.rowVersion!, input: {
      runId: current.id, decisionSetHash: current.decisionSetHash!, acknowledgedGapsHash: current.gapsHash!, acknowledgementReason: "Synthetic partial-run lifecycle acceptance" } });
    expect(final.kind).toBe("success");
    for (const options of [undefined, { sourceAuditV4Full: true } as const])
      expect(await repo.startCheckCommand(f.object.id, command(f.actor), options)).toMatchObject({ kind: "invalid_state", code: "INSPECTION_FINALIZED" });
    expect(await repo.getCheck(f.audit.id, f.actor)).toMatchObject({ status: "PARTIAL", purpose: "SOURCE_AUDIT_ONLY" });
    expect(await repo.getDocumentTextV4FullSource(f.audit.id, f.fileId, f.actor)).not.toBeUndefined();
    // Even an old FINAL active-audit pointer must never be rewritten by052.
    await db.query("UPDATE inspections SET active_run_id=$1 WHERE id=$2", [f.internal.id, f.internal.inspection_id]);
    const frozen = (await db.query("SELECT row_to_json(i) value FROM inspections i WHERE id=$1", [f.internal.inspection_id])).rows[0].value;
    const protocol = (await db.query("SELECT row_to_json(p) value FROM inspection_protocol_versions p WHERE inspection_id=$1 ORDER BY version", [f.internal.inspection_id])).rows;
    await db.query(migration);
    expect((await db.query("SELECT row_to_json(i) value FROM inspections i WHERE id=$1", [f.internal.inspection_id])).rows[0].value).toEqual(frozen);
    expect((await db.query("SELECT row_to_json(p) value FROM inspection_protocol_versions p WHERE inspection_id=$1 ORDER BY version", [f.internal.inspection_id])).rows).toEqual(protocol);
  });
  it("repairs only legacy OPEN pointers, preserves all audit bytes, and is idempotent", async () => {
    const f = await fixture(); await repo.completeCheck(f.audit.id);
    await db.query("UPDATE inspections SET active_run_id=$1,working_manifest_id=$2 WHERE id=$3", [f.internal.id, f.internal.manifest_id, f.internal.inspection_id]);
    const runs = (await db.query("SELECT row_to_json(run) value FROM analysis_runs run WHERE inspection_id=$1 ORDER BY api_id", [f.internal.inspection_id])).rows;
    await db.query(migration);
    expect(await repo.getObject(f.object.id, f.actor)).toMatchObject({ activeCheckId: f.engineering!.id, status: "PARTIAL" });
    expect((await db.query("SELECT row_to_json(run) value FROM analysis_runs run WHERE inspection_id=$1 ORDER BY api_id", [f.internal.inspection_id])).rows).toEqual(runs);
    const repaired = (await db.query("SELECT row_to_json(i) value FROM inspections i WHERE id=$1", [f.internal.inspection_id])).rows;
    await db.query(migration);
    expect((await db.query("SELECT row_to_json(i) value FROM inspections i WHERE id=$1", [f.internal.inspection_id])).rows).toEqual(repaired);
    expect((await repo.listObjectChecks(f.object.id, f.actor)) as any).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.audit.id, purpose: "SOURCE_AUDIT_ONLY" })]));
  });
  it("restores no-engineering OPEN objects to a draft without deleting the audit", async () => {
    const f = await fixture(false);
    await db.query("UPDATE inspections SET active_run_id=$1,working_manifest_id=$2 WHERE id=$3", [f.internal.id, f.internal.manifest_id, f.internal.inspection_id]);
    await db.query(migration);
    expect(await repo.getObject(f.object.id, f.actor)).toMatchObject({ activeCheckId: null, status: "UPLOADING" });
    expect((await db.query("SELECT count(*)::int n FROM analysis_runs WHERE id=$1", [f.internal.id])).rows[0].n).toBe(1);
  });
});
