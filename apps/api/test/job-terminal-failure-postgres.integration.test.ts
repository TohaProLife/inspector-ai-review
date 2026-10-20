import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { OutboxRelay } from "../src/outbox-relay.js";
import { loadReferenceData } from "../src/reference-data.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
(adminUrl ? describe : describe.skip)("terminal job failure recovery PostgreSQL", { timeout: 30_000 }, () => {
  const databaseName = `terminal_job_it_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, database: Pool, repository: PostgresInspectionRepository, relay: OutboxRelay;
  let connectionString: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(adminUrl!); url.pathname = `/${databaseName}`; connectionString = url.toString();
    await runDatabaseMigrations(connectionString);
    database = new Pool({ connectionString });
    repository = await PostgresInspectionRepository.create({ connectionString,
      parameters: (await loadReferenceData()).parameters, organizationSlug: "terminal-job-it" });
    relay = new OutboxRelay(connectionString, "amqp://unused");
  });
  afterAll(async () => {
    await relay?.close(); await repository?.close(); await database?.end();
    if (admin) {
      // pg-pool.end resolves before every socket has emitted its final close.
      // Wait for normal backend disconnects instead of FORCE-killing closing clients.
      let connections = 1;
      for (let attempt = 0; attempt < 100 && connections; attempt++) {
        connections = (await admin.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1`, [databaseName])).rows[0].n;
        if (connections) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(connections, "Test clients must disconnect before dropping their database").toBe(0);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`); await admin.end();
    }
  });
  async function fixture(mediaType = "application/pdf") {
    const object = await repository.createObject({ name: "Controlled terminal recovery", address: "Synthetic" });
    await repository.registerIngestedFiles(object.id, [{ id: `FIL-${randomUUID()}`, name: "controlled.pdf", size: 43,
      stage: "PD", mimeType: mediaType, sha256: "a".repeat(64), scanStatus: "CLEAN", status: "STORED",
      storageKey: `objects/${object.id}/controlled.pdf` }]);
    const check = await repository.startCheck(object.id); expect(check).toBeDefined();
    const job = (await database.query<{ id: string; job_type: string; run_id: string }>(`SELECT job.id,job.job_type,job.run_id
      FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id
      WHERE run.api_id=$1 AND job.state='READY'`, [check!.id])).rows[0];
    expect(job).toBeDefined();
    const claimInput = { workerId: "terminal-it", capabilities: [job.job_type] };
    const claim = await repository.claimJob(job.id, claimInput); expect(claim.kind).toBe("acquired");
    if (claim.kind !== "acquired") throw new Error("Synthetic lease unavailable");
    return { object, check: check!, job, claimInput, lease: claim.lease };
  }
  async function snapshot(runId: string) {
    const run = (await database.query(`SELECT run.run_state,run.display_status,run.completed_at,run.event_version,
      object.display_status AS object_status FROM analysis_runs run JOIN objects object ON object.id=run.object_id
      WHERE run.id=$1`, [runId])).rows[0];
    const jobs = (await database.query(`SELECT state,current_attempt_id,lease_until,last_error_code FROM analysis_jobs
      WHERE run_id=$1 ORDER BY created_at,id`, [runId])).rows;
    const events = (await database.query(`SELECT payload FROM domain_outbox WHERE aggregate_id=$1
      AND event_type='stage.finished' AND payload->>'outcome'='FAILED'`, [runId])).rows;
    return { run, jobs, events };
  }
  async function expireLastAttempt(setup: Awaited<ReturnType<typeof fixture>>) {
    await database.query(`UPDATE analysis_jobs SET max_attempts=attempt_count,lease_until=now()-interval '1 second' WHERE id=$1`, [setup.job.id]);
    await database.query(`UPDATE job_attempts SET lease_until=now()-interval '1 second' WHERE id=$1`, [setup.lease.attemptId]);
  }
  function expectFailed(saved: Awaited<ReturnType<typeof snapshot>>, code: string) {
    expect(saved.run).toMatchObject({ run_state: "FAILED", display_status: "FAILED", object_status: "FAILED" });
    expect(saved.run.completed_at).not.toBeNull();
    expect(saved.jobs.every(job => ["FAILED", "CANCELLED"].includes(job.state))).toBe(true);
    expect(saved.jobs.every(job => job.current_attempt_id === null && job.lease_until === null)).toBe(true);
    expect(saved.events).toHaveLength(1); expect(saved.events[0].payload.error_code).toBe(code);
  }
  it("claim exhaustion expires the attempt and terminates run/object/descendants exactly once", async () => {
    const setup = await fixture(); await expireLastAttempt(setup);
    expect(await repository.claimJob(setup.job.id, setup.claimInput)).toEqual({ kind: "already_terminal", state: "FAILED" });
    const saved = await snapshot(setup.job.run_id); expectFailed(saved, "ATTEMPTS_EXHAUSTED");
    expect((await database.query(`SELECT state,error_code FROM job_attempts WHERE id=$1`, [setup.lease.attemptId])).rows[0])
      .toEqual({ state: "EXPIRED", error_code: "LEASE_EXPIRED" });
    await repository.claimJob(setup.job.id, setup.claimInput); await relay.recoverDueJobsOnce();
    expect(await snapshot(setup.job.run_id)).toEqual(saved);
    expect(await repository.startCheck(setup.object.id)).toMatchObject({ status: "PROCESSING" });
  });
  it("ordinary reported terminal failure uses the same cleanup and event policy", async () => {
    const setup = await fixture();
    expect(await repository.failJob(setup.job.id, { attemptId: setup.lease.attemptId,
      fencingToken: setup.lease.fencingToken, errorCode: "INVALID_DOCUMENT", message: "Controlled invalid source" }))
      .toEqual({ kind: "failed" });
    expectFailed(await snapshot(setup.job.run_id), "INVALID_DOCUMENT");
    await relay.recoverDueJobsOnce(); expect((await snapshot(setup.job.run_id)).events).toHaveLength(1);
  });
  it("relay repairs already FAILED and DEAD stranded runs concurrently, retaining original error", async () => {
    for (const state of ["FAILED", "DEAD"] as const) {
      const setup = await fixture();
      // Reproduce pre-fix durable state, not a runtime repair through manual SQL.
      await database.query(`UPDATE analysis_jobs SET state=$2,last_error_code='ORIGINAL_PROVIDER_FAILURE',
        last_error_message='Preserve original failure',completed_at=now() WHERE id=$1`, [setup.job.id, state]);
      const other = new OutboxRelay(connectionString, "amqp://unused");
      try { await Promise.all([relay.recoverDueJobsOnce(), other.recoverDueJobsOnce()]); }
      finally { await other.close(); }
      const saved = await snapshot(setup.job.run_id);
      expect(saved.run).toMatchObject({ run_state: "FAILED", object_status: "FAILED" });
      expect(saved.events).toHaveLength(1); expect(saved.events[0].payload.error_code).toBe("ORIGINAL_PROVIDER_FAILURE");
      const terminal = saved.jobs.find(job => job.state === state)!;
      expect(terminal).toMatchObject({ current_attempt_id: null, lease_until: null, last_error_code: "ORIGINAL_PROVIDER_FAILURE" });
      await relay.recoverDueJobsOnce(); expect(await snapshot(setup.job.run_id)).toEqual(saved);
    }
  });
  it("relay terminalizes expired max-attempt leases without another dispatch and ignores a live lease", async () => {
    const exhausted = await fixture(), live = await fixture(); await expireLastAttempt(exhausted);
    const eventsBefore = (await database.query(`SELECT count(*)::int n FROM domain_outbox WHERE aggregate_id=$1`, [exhausted.job.id])).rows[0].n;
    await relay.recoverDueJobsOnce(); expectFailed(await snapshot(exhausted.job.run_id), "ATTEMPTS_EXHAUSTED");
    expect((await snapshot(live.job.run_id)).run.run_state).toBe("RUNNING");
    expect((await database.query(`SELECT count(*)::int n FROM domain_outbox WHERE aggregate_id=$1`, [exhausted.job.id])).rows[0].n).toBe(eventsBefore);
    expect(await repository.heartbeatJob(exhausted.job.id, { attemptId: exhausted.lease.attemptId,
      fencingToken: exhausted.lease.fencingToken })).toMatchObject({ kind: "already_terminal", state: "FAILED" });
  });
  it("does not revive expired or retrying jobs from finalized, superseded or sealed runs", async () => {
    const finalized = await fixture(), superseded = await fixture(), sealed = await fixture();
    for (const setup of [finalized, superseded, sealed]) {
      await database.query(`UPDATE analysis_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`, [setup.job.id]);
      await database.query(`UPDATE job_attempts SET lease_until=now()-interval '1 second' WHERE id=$1`, [setup.lease.attemptId]);
    }
    await database.query(`UPDATE inspections SET lifecycle='FINALIZED' WHERE active_run_id=$1`, [finalized.job.run_id]);
    await database.query(`UPDATE analysis_runs SET run_state='PARTIAL' WHERE id=$1`, [superseded.job.run_id]);
    await repository.startCheck(superseded.object.id);
    await database.query(`UPDATE analysis_runs SET run_state='RUNNING' WHERE id=$1`, [superseded.job.run_id]);
    await database.query(`UPDATE analysis_runs SET run_state='PARTIAL' WHERE id=$1`, [sealed.job.run_id]);
    await database.query(`UPDATE analysis_jobs SET state='RETRY_WAIT',next_attempt_at=now()-interval '1 second' WHERE id=$1`, [sealed.job.id]);
    const durable = async (setup: typeof finalized) => ({
      snapshot: await snapshot(setup.job.run_id),
      attempts: (await database.query(`SELECT * FROM job_attempts WHERE job_id=$1 ORDER BY id`, [setup.job.id])).rows,
      outbox: (await database.query(`SELECT * FROM domain_outbox WHERE aggregate_id=$1 ORDER BY id`, [setup.job.id])).rows,
    });
    const before = await Promise.all([finalized, superseded, sealed].map(durable));
    await relay.recoverDueJobsOnce();
    expect(await Promise.all([finalized, superseded, sealed].map(durable))).toEqual(before);
    const active = await fixture();
    await database.query(`UPDATE analysis_jobs SET lease_until=now()-interval '1 second' WHERE id=$1`, [active.job.id]);
    const other = new OutboxRelay(connectionString, "amqp://unused");
    try { await Promise.all([relay.recoverDueJobsOnce(), other.recoverDueJobsOnce()]); }
    finally { await other.close(); }
    expect((await database.query(`SELECT count(*)::int n FROM domain_outbox WHERE aggregate_id=$1 AND event_type='job.ready'`, [active.job.id])).rows[0].n).toBe(2);
    expect((await database.query(`SELECT state,current_attempt_id,lease_until,fencing_token FROM analysis_jobs WHERE id=$1`, [active.job.id])).rows[0])
      .toMatchObject({ state: "READY", current_attempt_id: null, lease_until: null, fencing_token: String(active.lease.fencingToken + 1) });
    expect((await database.query(`SELECT state FROM job_attempts WHERE id=$1`, [active.lease.attemptId])).rows[0].state).toBe("EXPIRED");
  });
  it("recovers eligible retries but leaves finalized, superseded and sealed artifacts byte-identical", async () => {
    const sealed = await fixture("application/octet-stream");
    let current = { job: sealed.job, lease: sealed.lease };
    const scaffold: Record<string, string[]> = {
      DOCUMENT_RENDER: ["PROVIDER_NOT_CONFIGURED", "RENDERER_PROFILE_NOT_SELECTED", "RENDERER"],
      DOCUMENT_METADATA: ["PROVIDER_NOT_CONFIGURED", "METADATA_PROFILE_NOT_SELECTED", "METADATA_EXTRACTOR"],
      DOCUMENT_LINKING: ["POLICY_NOT_CONFIGURED", "LINKING_POLICY_NOT_SELECTED", "LINKING_POLICY"],
      ENTITY_EXTRACTION: ["PROVIDER_NOT_CONFIGURED", "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED", "ENTITY_EXTRACTION_MODEL"],
      RULE_EVALUATION: ["UNSUPPORTED_RULESET", "EXECUTABLE_RULES_NOT_CONFIGURED", "RULE_ENGINE"],
      EVIDENCE_VALIDATION: ["NO_MACHINE_RESULTS", "RULE_RESULTS_UNAVAILABLE", "EVIDENCE_VALIDATOR"],
    };
    for (let step = 0; step < 10; step++) {
      let result: Record<string, unknown>;
      if (current.job.job_type === "ANALYSIS_INVENTORY") result = { disposition: "MANIFEST_INVENTORIED", sourceCount: 1,
        stageCounts: { PD: 1, RD: 0, ID: 0 } };
      else if (current.job.job_type === "DOCUMENT_TEXT_LAYER") result = { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
        sources: current.lease.inputs.sourceFiles.map(file => ({ sourceFileId: file.sourceFileId, inputSha256: file.sha256,
          status: "SKIPPED_UNSUPPORTED_FORMAT", reason: "Controlled non-PDF source" })) };
      else if (current.job.job_type === "ANALYSIS_SEAL_UNSUPPORTED") result = { disposition: "UNSUPPORTED_COVERAGE_SEALED" };
      else { const [disposition, reasonCode, providerKind] = scaffold[current.job.job_type];
        result = { schemaVersion: "analysis-stage-result-v1", jobType: current.job.job_type,
          inputManifestHash: current.lease.inputManifestHash, disposition, reasonCode, providerKind,
          providerProfileId: null, providerConfigHash: null, outputCount: 0 }; }
      const completed = await repository.completeJob(current.job.id, { attemptId: current.lease.attemptId,
        fencingToken: current.lease.fencingToken, result });
      expect(completed.kind, JSON.stringify(completed)).toBe("completed");
      const ready = (await database.query<{ id: string; job_type: string; run_id: string }>(
        `SELECT id,job_type,run_id FROM analysis_jobs WHERE run_id=$1 AND state='READY'`, [sealed.job.run_id])).rows[0];
      if (!ready) break;
      const claim = await repository.claimJob(ready.id, { workerId: "terminal-it", capabilities: [ready.job_type] });
      expect(claim.kind).toBe("acquired"); if (claim.kind !== "acquired") throw new Error("Cannot seal fixture");
      current = { job: ready, lease: claim.lease };
    }
    const frozen = async () => ({ run: (await database.query(`SELECT * FROM analysis_runs WHERE id=$1`, [sealed.job.run_id])).rows,
      artifacts: (await database.query(`SELECT content_json::text,content_hash,byte_size FROM analysis_stage_artifacts
        WHERE run_id=$1 ORDER BY job_type`, [sealed.job.run_id])).rows,
      coverage: (await database.query(`SELECT * FROM parameter_coverage WHERE run_id=$1 ORDER BY parameter_id`, [sealed.job.run_id])).rows });
    const old = await frozen(); expect(old.run[0]).toMatchObject({ run_state: "PARTIAL", progress: 100 });
    expect(old.artifacts.length).toBeGreaterThan(0);
    const next = await repository.startCheck(sealed.object.id); expect(next).toBeDefined();
    const nextJob = (await database.query<{ id: string }>(`SELECT job.id FROM analysis_jobs job
      JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.state='READY'`, [next!.id])).rows[0];
    await database.query(`UPDATE analysis_jobs SET state='FAILED',last_error_code='NEXT_RUN_FAILURE' WHERE id=$1`, [nextJob.id]);
    const finalized = await fixture();
    await database.query(`UPDATE analysis_jobs SET state='FAILED',last_error_code='FINALIZED_OLD' WHERE id=$1`, [finalized.job.id]);
    await database.query(`UPDATE inspections SET lifecycle='FINALIZED' WHERE active_run_id=$1`, [finalized.job.run_id]);
    const finalizedBefore = await snapshot(finalized.job.run_id);
    const retry = await fixture();
    expect(await repository.failJob(retry.job.id, { attemptId: retry.lease.attemptId,
      fencingToken: retry.lease.fencingToken, errorCode: "TRANSIENT_NETWORK", message: "Controlled retry" }))
      .toMatchObject({ kind: "retry_scheduled" });
    await database.query(`UPDATE analysis_jobs SET next_attempt_at=now()-interval '1 second' WHERE id=$1`, [retry.job.id]);
    await relay.recoverDueJobsOnce();
    expect(await frozen()).toEqual(old); expect(await snapshot(finalized.job.run_id)).toEqual(finalizedBefore);
    expect((await database.query(`SELECT state FROM analysis_jobs WHERE id=$1`, [retry.job.id])).rows[0].state).toBe("READY");
    expect((await snapshot(retry.job.run_id)).events).toHaveLength(0);
  });
});
