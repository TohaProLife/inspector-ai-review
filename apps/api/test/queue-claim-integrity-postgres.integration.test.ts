import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { LocalObjectStorage } from "../src/storage.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { matrixConcreteWallInstalledIdentityV13, historicalConcreteWallReadIdentityV13 } from "../src/matrix-concrete-wall-profile-v13.js";
import { OutboxRelay } from "../src/outbox-relay.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl ? describe : describe.skip)("claim all-source isolation PostgreSQL", { timeout: 60_000 }, () => {
  const name = `qa30_claim_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, db: Pool, repo: PostgresInspectionRepository, dir: string, relay: OutboxRelay;
  let previousFlag: string | undefined;
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(adminUrl!); url.pathname = `/${name}`;
    await runDatabaseMigrations(url.toString()); db = new Pool({ connectionString: url.toString() });
    dir = await mkdtemp(join(tmpdir(), "qa30-claim-"));
    previousFlag = process.env.INSPECTOR_MATRIX_CONCRETE_WALLS_V13;
    process.env.INSPECTOR_MATRIX_CONCRETE_WALLS_V13 = "1";
    expect(matrixConcreteWallInstalledIdentityV13(), "all source-pinned V13 files must be installed in this test runtime").not.toBeNull();
    repo = await PostgresInspectionRepository.create({ connectionString: url.toString(),
      parameters: (await loadReferenceData()).parameters, analysisProfile: "MATRIX_V1",
      organizationSlug: "qa30-claim", storage: new LocalObjectStorage(dir) });
    relay = new OutboxRelay(url.toString(), "amqp://unused");
  });
  afterAll(async () => {
    if (previousFlag === undefined) delete process.env.INSPECTOR_MATRIX_CONCRETE_WALLS_V13;
    else process.env.INSPECTOR_MATRIX_CONCRETE_WALLS_V13 = previousFlag;
    await relay?.close(); await repo?.close(); await db?.end(); if (dir) await rm(dir, { recursive: true, force: true });
    if (admin) { for (let i = 0; i < 100; i++) {
      if (!(await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1", [name])).rows[0].n) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    } await admin.query(`DROP DATABASE "${name}"`); await admin.end(); }
  });
  async function fixture(mediaTypes: string[]) {
    const object = await repo.createObject({ name: "QA30 claim isolation", address: "Synthetic" });
    const files = [];
    for (const [index, mediaType] of mediaTypes.entries()) {
      const bytes = mediaType === "application/pdf"
        ? await readFile(new URL("../../../scripts/fixtures/smoke.pdf", import.meta.url))
        : Buffer.from(`<?xml version="1.0"?><qa30 index="${index}"/>`);
      const storageKey = `qa30-${randomUUID()}`; await writeFile(join(dir, storageKey), bytes);
      files.push({ id: `FIL-${randomUUID()}`, name: `QA30-${index}`, size: bytes.length, stage: "PD" as const,
        mimeType: mediaType, sha256: sha256(bytes), scanStatus: "CLEAN" as const, status: "STORED" as const, storageKey });
    }
    await repo.registerIngestedFiles(object.id, files);
    const user = await provisionLocalUser(db, { organizationSlug: "qa30-claim", login: `qa30-${randomUUID()}`,
      displayName: "QA30", password: "Synthetic-Only-Test-2026!", objectApiIds: [object.id], objectPermissions: ["READ", "RUN"] });
    const actor = { sessionId: randomUUID(), userId: user.id, organizationId: user.organizationId,
      displayName: "QA30", roles: ["INSPECTOR"], capabilities: ["SOURCE_REVIEW"], csrfHash: "x", expiresAt: "2030-01-01T00:00:00Z" } as AuthenticatedActor;
    await db.query(`INSERT INTO user_sessions(id,user_id,token_hash,csrf_hash,auth_version,expires_at)
      SELECT $1,id,$3,$4,auth_version,now()+interval '1 hour' FROM inspector_users WHERE id=$2`,
    [actor.sessionId, user.id, sha256(randomUUID()), sha256(randomUUID())]);
    const started = await repo.startCheckCommand(object.id, { actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() }, { analysisMode: "FULL" });
    expect(started.kind, JSON.stringify(started)).toBe("success");
    if (started.kind !== "success") throw new Error("Installed V13 start rejected");
    const check = started.value;
    const job = (await db.query<{ id: string; run_id: string; job_type: string }>(`SELECT job.id,job.run_id,job.job_type
      FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id
      WHERE run.api_id=$1 AND job.state='READY'`, [check!.id])).rows[0]!;
    expect(job).toBeDefined();
    return { object, check: check!, actor, job, input: { workerId: "qa30-isolation", capabilities: [job.job_type] }, files };
  }
  it.each([
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["application/xml"], ["image/vnd.dwg"],
    ["application/xml", "application/pdf", "image/vnd.dwg"],
  ])("claims every pinned source including non-PDF %j", async (...mediaTypes) => {
    const setup = await fixture(mediaTypes);
    const claimed = await repo.claimJob(setup.job.id, setup.input);
    expect(claimed.kind, JSON.stringify(claimed)).toBe("acquired");
    if (claimed.kind !== "acquired") throw new Error("No lease");
    expect(claimed.lease.inputs.sourceFiles.map(s => s.sourceFileId).sort()).toEqual(setup.files.map(f => f.id).sort());
    for (const file of claimed.lease.inputs.sourceFiles) expect(file.sha256).toBe(setup.files.find(f => f.id === file.sourceFileId)!.sha256);
  });
  async function corruptManifest(runId: string) {
    // Simulated at-rest corruption in this isolated test DB, never production repair.
    await db.query("ALTER TABLE input_manifests DISABLE TRIGGER USER");
    try { await db.query(`UPDATE input_manifests SET canonical_json=jsonb_set(canonical_json,'{sources,0,sha256}',to_jsonb($2::text))
      WHERE id=(SELECT manifest_id FROM analysis_runs WHERE id=$1)`, [runId, "0".repeat(64)]); }
    finally { await db.query("ALTER TABLE input_manifests ENABLE TRIGGER USER"); }
  }
  it("terminalizes a corrupt frozen manifest once, without leasing, then claims a following PDF", async () => {
    const poisoned = await fixture(["application/xml"]), next = await fixture(["application/pdf"]);
    await corruptManifest(poisoned.job.run_id);
    const claims = await Promise.all([repo.claimJob(poisoned.job.id, poisoned.input), repo.claimJob(poisoned.job.id, poisoned.input)]);
    expect(claims).toEqual([{ kind: "already_terminal", state: "FAILED" }, { kind: "already_terminal", state: "FAILED" }]);
    const jobs = (await db.query("SELECT state,attempt_count,current_attempt_id,lease_until FROM analysis_jobs WHERE run_id=$1", [poisoned.job.run_id])).rows;
    expect(jobs.every(j => ["FAILED", "CANCELLED"].includes(j.state))).toBe(true);
    expect(jobs.every(j => Number(j.attempt_count) === 0 && j.current_attempt_id === null && j.lease_until === null)).toBe(true);
    expect((await db.query("SELECT count(*)::int n FROM job_attempts WHERE job_id=$1", [poisoned.job.id])).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int n FROM domain_outbox WHERE aggregate_id=$1 AND event_type='stage.finished' AND payload->>'outcome'='FAILED'", [poisoned.job.run_id])).rows[0].n).toBe(1);
    expect((await repo.claimJob(next.job.id, next.input)).kind).toBe("acquired");
    expect(await repo.claimJob(poisoned.job.id, poisoned.input)).toEqual({ kind: "already_terminal", state: "FAILED" });
  });
  it("does not terminate a concurrent unexpired lease when immutable bytes later change", async () => {
    const setup = await fixture(["application/xml"]);
    expect((await repo.claimJob(setup.job.id, setup.input)).kind).toBe("acquired");
    await corruptManifest(setup.job.run_id);
    expect(await repo.claimJob(setup.job.id, setup.input)).toEqual({ kind: "not_ready", state: "LEASED" });
    expect((await db.query("SELECT run_state FROM analysis_runs WHERE id=$1", [setup.job.run_id])).rows[0].run_state).toBe("RUNNING");
  });
  it.each(["superseded", "closed", "sealed"])("ACK-cancels stale corrupt %s delivery without rewriting its run/object", async condition => {
    const setup = await fixture(["application/xml"]);
    if (condition === "superseded") await db.query("UPDATE inspections SET active_run_id=NULL WHERE active_run_id=$1", [setup.job.run_id]);
    if (condition === "closed") await db.query("UPDATE inspections SET lifecycle='FINALIZED' WHERE active_run_id=$1", [setup.job.run_id]);
    if (condition === "sealed") await db.query("UPDATE analysis_runs SET run_state='PARTIAL' WHERE id=$1", [setup.job.run_id]);
    await corruptManifest(setup.job.run_id);
    const immutable = async () => (await db.query(`SELECT row_to_json(run) AS run,row_to_json(object) AS object,
      row_to_json(inspection) AS inspection FROM analysis_runs run JOIN objects object ON object.id=run.object_id
      JOIN inspections inspection ON inspection.id=run.inspection_id WHERE run.id=$1`, [setup.job.run_id])).rows[0];
    const before = await immutable();
    expect(await repo.claimJob(setup.job.id, setup.input)).toEqual({ kind: "already_terminal", state: "CANCELLED" });
    expect(await repo.claimJob(setup.job.id, setup.input)).toEqual({ kind: "already_terminal", state: "CANCELLED" });
    expect(await immutable()).toEqual(before);
    expect((await db.query("SELECT count(*)::int n FROM job_attempts WHERE job_id=$1", [setup.job.id])).rows[0].n).toBe(0);
  });
  it("recovers detached exact source-audit retries and exhausts them without changing the engineering object", async () => {
    const normal = await fixture(["application/xml"]);
    const command = { actor: normal.actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() };
    const audit = await repo.startCheckCommand(normal.object.id, command, { sourceAuditV3: true });
    expect(audit.kind, JSON.stringify(audit)).toBe("success"); if (audit.kind !== "success") throw new Error("Audit start rejected");
    const job = (await db.query<{ id: string; run_id: string; job_type: string }>(`SELECT job.id,job.run_id,job.job_type
      FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id
      WHERE run.api_id=$1 AND job.state='READY'`, [audit.value.id])).rows[0]!;
    const objectProjection = async () => (await db.query(`SELECT object.display_status,object.stats,inspection.active_run_id
      FROM objects object JOIN inspections inspection ON inspection.object_id=object.id WHERE object.api_id=$1`, [normal.object.id])).rows[0];
    const before = await objectProjection(); expect(before.active_run_id).toBe(normal.job.run_id);
    const input = { workerId: "qa30-audit", capabilities: [job.job_type] };
    const first = await repo.claimJob(job.id, input); expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") throw new Error("Detached audit lease rejected");
    expect(await repo.heartbeatJob(job.id, { attemptId: first.lease.attemptId, fencingToken: first.lease.fencingToken })).toMatchObject({ kind: "extended" });
    expect(await repo.failJob(job.id, { attemptId: first.lease.attemptId, fencingToken: first.lease.fencingToken,
      errorCode: "TRANSIENT_NETWORK", message: "Controlled temporary failure" })).toMatchObject({ kind: "retry_scheduled" });
    await db.query("UPDATE analysis_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1", [job.id]);
    await relay.recoverDueJobsOnce();
    expect((await db.query("SELECT state FROM analysis_jobs WHERE id=$1", [job.id])).rows[0].state).toBe("READY");
    const second = await repo.claimJob(job.id, input); expect(second.kind).toBe("acquired");
    if (second.kind !== "acquired") throw new Error("Detached audit retry rejected");
    await db.query("UPDATE analysis_jobs SET max_attempts=attempt_count,lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
    await db.query("UPDATE job_attempts SET lease_until=now()-interval '1 second' WHERE id=$1", [second.lease.attemptId]);
    await relay.recoverDueJobsOnce();
    expect((await db.query("SELECT run_state FROM analysis_runs WHERE id=$1", [job.run_id])).rows[0].run_state).toBe("FAILED");
    expect(await objectProjection()).toEqual(before);
    expect(await repo.claimJob(job.id, input)).toEqual({ kind: "already_terminal", state: "FAILED" });
  });
  it("refuses a queued original V13 runtime after promotion even though its exact release is readable", async () => {
    const setup = await fixture(["application/xml"]);
    const current = (await db.query(`SELECT release.content_json FROM analysis_runs run
      JOIN analysis_releases release ON release.release_id=run.release_id WHERE run.id=$1`, [setup.job.run_id])).rows[0].content_json;
    current.rules.matrixDefinitions.concreteWallExecution.sourcePins["concrete_wall_transport_v13.py"] = historicalConcreteWallReadIdentityV13.transportSourceHash;
    const oldConfig = sha256(canonicalJson(current.rules.matrixDefinitions));
    expect(oldConfig).toBe(historicalConcreteWallReadIdentityV13.configHash);
    current.providerSlots.find((s: any) => s.stageJobType === "RULE_EVALUATION").configHash = oldConfig;
    const { releaseId: _oldId, ...identity } = current;
    const release = { ...identity, releaseId: `release:matrix-v1:${sha256(canonicalJson(identity)).slice(0, 24)}` };
    const canonical = canonicalJson(release);
    expect(sha256(canonical)).toBe(historicalConcreteWallReadIdentityV13.contentHash);
    await db.query(`INSERT INTO analysis_releases(release_id,schema_version,lifecycle,content_hash,byte_size,content_json,external_network_allowed)
      VALUES($1,'analysis-release-v1','DRAFT',$2,$3,$4::jsonb,false) ON CONFLICT(release_id) DO NOTHING`,
    [release.releaseId, sha256(canonical), Buffer.byteLength(canonical), canonical]);
    // Simulate a job legitimately pinned before deployment, in the isolated DB.
    await db.query("ALTER TABLE analysis_runs DISABLE TRIGGER USER");
    try { await db.query("UPDATE analysis_runs SET release_id=$2 WHERE id=$1", [setup.job.run_id, release.releaseId]); }
    finally { await db.query("ALTER TABLE analysis_runs ENABLE TRIGGER USER"); }
    await db.query("UPDATE analysis_jobs SET release_id=$2 WHERE run_id=$1", [setup.job.run_id, release.releaseId]);
    expect(await repo.claimJob(setup.job.id, setup.input)).toEqual({ kind: "already_terminal", state: "FAILED" });
    expect((await db.query("SELECT count(*)::int n FROM job_attempts WHERE job_id=$1", [setup.job.id])).rows[0].n).toBe(0);
  });
});
