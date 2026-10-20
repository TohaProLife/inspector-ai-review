import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import type { AuditedMutationCommand } from "../src/repository.js";
import { provisionLocalUser } from "../src/user-provisioning.js";

const adminUrl = process.env.INSPECTOR_POSTGRES_ADMIN_URL;
type Outcome<T> = { ok: true; value: T } | { ok: false; code: string };

// Attach the rejection handler immediately: a deadlock victim may reject while
// the other command is still waiting. Never retain or print a pg client/error.
function captured<T>(operation: Promise<T>): Promise<Outcome<T>> {
  return operation.then(value => ({ ok: true, value }), error => ({
    ok: false, code: typeof error?.code === "string" ? error.code : "OPERATION_REJECTED",
  }));
}

(adminUrl ? describe : describe.skip)("aggregate row lock order PostgreSQL", { timeout: 30_000 }, () => {
  const databaseName = `aggregate_lock_it_${randomUUID().replaceAll("-", "")}`;
  const organizationSlug = "aggregate-lock-it";
  let admin: Pool | undefined;
  let database: Pool | undefined;
  let repository: PostgresInspectionRepository | undefined;
  let databaseCreated = false;
  const poolErrors: string[] = [];

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1, statement_timeout: 7_000 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    const url = new URL(adminUrl!);
    url.pathname = `/${databaseName}`;
    // Repository creates its own pool; startup options bound its statements too.
    const inheritedOptions = url.searchParams.get("options");
    url.searchParams.set("options", `${inheritedOptions ? `${inheritedOptions} ` : ""}-c statement_timeout=7000`);
    const connectionString = url.toString();
    await runDatabaseMigrations(connectionString);
    database = new Pool({ connectionString, max: 4 });
    repository = await PostgresInspectionRepository.create({
      connectionString,
      parameters: (await loadReferenceData()).parameters,
      organizationSlug,
      onPoolError: error => poolErrors.push((error as Error & { code?: string }).code ?? "POOL_ERROR"),
    });
  }, 30_000);

  afterAll(async () => {
    // Every test settles its commands and releases its controller before here.
    await repository?.close();
    await database?.end();
    if (!admin) return;
    try {
      if (databaseCreated) {
        let connections = 1;
        for (let attempt = 0; attempt < 200 && connections > 0; attempt++) {
          connections = (await admin.query<{ n: number }>(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1", [databaseName],
          )).rows[0].n;
          if (connections > 0) await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(connections, "All fixture backends must disconnect before DROP DATABASE").toBe(0);
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
      expect(poolErrors).toEqual([]);
    } finally {
      await admin.end();
    }
  }, 15_000);

  function db(): Pool {
    if (!database) throw new Error("Fixture database unavailable");
    return database;
  }

  function store(): PostgresInspectionRepository {
    if (!repository) throw new Error("Fixture repository unavailable");
    return repository;
  }

  function command(actor: AuthenticatedActor): AuditedMutationCommand {
    return { actor, idempotencyKey: randomUUID(), requestId: randomUUID(), traceId: randomUUID() };
  }

  function source(objectId: string, digest = "a".repeat(64)) {
    return {
      id: `FIL-${randomUUID()}`, name: "controlled.pdf", size: 43, stage: "PD" as const,
      mimeType: "application/pdf", sha256: digest, scanStatus: "CLEAN" as const,
      status: "STORED" as const, storageKey: `objects/${objectId}/${digest}.pdf`,
    };
  }

  async function objectFixture(withSource = true) {
    const object = await store().createObject({ name: "Controlled aggregate race", address: "Synthetic" });
    const user = await provisionLocalUser(db(), {
      organizationSlug, login: `aggregate-${randomUUID()}`, displayName: "Aggregate race inspector",
      password: "Aggregate-Fixture-2026!", objectApiIds: [object.id], objectPermissions: ["READ", "RUN", "UPLOAD"],
    });
    const actor: AuthenticatedActor = {
      userId: user.id, organizationId: user.organizationId, displayName: "Aggregate race inspector",
      sessionId: randomUUID(), roles: ["INSPECTOR"], capabilities: [], csrfHash: "fixture",
      expiresAt: "2030-01-01T00:00:00Z",
    };
    const scope = (await db().query<{ object_id: string; inspection_id: string }>(
      `SELECT object.id AS object_id,inspection.id AS inspection_id
       FROM objects object JOIN inspections inspection ON inspection.object_id=object.id
       WHERE object.api_id=$1 AND inspection.lifecycle='OPEN'`, [object.id],
    )).rows[0];
    const file = source(object.id);
    if (withSource) expect(await store().registerIngestedFiles(object.id, [file])).toBeDefined();
    return { object, actor, scope, file };
  }

  async function runningFixture() {
    const setup = await objectFixture();
    const check = await store().startCheck(setup.object.id);
    if (!check) throw new Error("Controlled run did not start");
    const job = (await db().query<{ id: string; job_type: string; run_id: string }>(
      `SELECT job.id,job.job_type,job.run_id FROM analysis_jobs job
       JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.state='READY'`, [check.id],
    )).rows[0];
    if (!job) throw new Error("Controlled READY job missing");
    const claimed = await store().claimJob(job.id, { workerId: "aggregate-lock-it", capabilities: [job.job_type] });
    if (claimed.kind !== "acquired") throw new Error("Controlled lease unavailable");
    return { ...setup, check, job, lease: claimed.lease };
  }

  async function frozenInputs(runId: string) {
    return (await db().query(
      `SELECT run.manifest_id,run.release_id,manifest.sha256,manifest.canonical_json,
         (SELECT count(*)::int FROM manifest_items item WHERE item.manifest_id=run.manifest_id) AS source_count
       FROM analysis_runs run JOIN input_manifests manifest ON manifest.id=run.manifest_id WHERE run.id=$1`, [runId],
    )).rows[0];
  }

  async function terminalSnapshot(runId: string) {
    const run = (await db().query(
      "SELECT run_state,display_status,completed_at,event_version FROM analysis_runs WHERE id=$1", [runId],
    )).rows[0];
    const jobs = (await db().query(
      `SELECT state,current_attempt_id,lease_until,last_error_code FROM analysis_jobs
       WHERE run_id=$1 ORDER BY id`, [runId],
    )).rows;
    const events = (await db().query(
      `SELECT payload FROM domain_outbox WHERE aggregate_id=$1
       AND event_type='stage.finished' AND payload->>'outcome'='FAILED' ORDER BY id`, [runId],
    )).rows;
    return { run, jobs, events };
  }

  async function waitForBlockedBy(blockerPid: number): Promise<number> {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const waiting = await db().query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
         AND wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid)) ORDER BY pid`, [blockerPid],
      );
      if (waiting.rows.length === 1) return waiting.rows[0].pid;
      if (waiting.rows.length > 1) throw new Error("Unexpected additional fixture blocker");
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error("Expected PostgreSQL lock wait was not observed");
  }

  async function barrier(table: "analysis_runs" | "upload_receipts", scopeId: string) {
    // Identifier/value interpolation is limited to generated identifiers, UUIDs,
    // bounded integer keys, and the two table literals owned by this test.
    if (!/^[a-f0-9-]{36}$/.test(scopeId)) throw new Error("Invalid fixture scope UUID");
    const suffix = randomUUID().replaceAll("-", "");
    const name = `aggregate_barrier_${suffix}`;
    const namespace = 23318;
    const key = Number.parseInt(suffix.slice(0, 7), 16);
    const predicate = table === "analysis_runs"
      ? `NEW.id='${scopeId}'::uuid AND NEW.run_state='FAILED' AND OLD.run_state IN ('QUEUED','RUNNING')`
      : `NEW.object_id='${scopeId}'::uuid`;
    const event = table === "analysis_runs" ? "UPDATE" : "INSERT";
    const controller: PoolClient = await db().connect();
    let held = false;
    let functionCreated = false;
    let triggerCreated = false;
    try {
      const controllerPid = (await controller.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await controller.query("SELECT pg_advisory_lock($1::int,$2::int)", [namespace, key]);
      held = true;
      await db().query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF ${predicate} THEN PERFORM pg_advisory_xact_lock(${namespace},${key}); END IF;
          RETURN NEW;
        END $$`);
      functionCreated = true;
      await db().query(`CREATE TRIGGER ${name} AFTER ${event} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION ${name}()`);
      triggerCreated = true;
      const release = async () => {
        if (!held) return;
        await controller.query("SELECT pg_advisory_unlock($1::int,$2::int)", [namespace, key]);
        held = false;
      };
      return {
        controllerPid, release,
        async close(operations: Array<Promise<unknown>>) {
          try {
            await release();
            // Settle actual backends before DDL cleanup or database teardown.
            await Promise.allSettled(operations);
            if (triggerCreated) await db().query(`DROP TRIGGER ${name} ON ${table}`);
            if (functionCreated) await db().query(`DROP FUNCTION ${name}()`);
          } finally {
            controller.release();
          }
        },
      };
    } catch (error) {
      try {
        if (held) await controller.query("SELECT pg_advisory_unlock($1::int,$2::int)", [namespace, key]);
        if (triggerCreated) await db().query(`DROP TRIGGER ${name} ON ${table}`);
        if (functionCreated) await db().query(`DROP FUNCTION ${name}()`);
      } finally {
        controller.release();
      }
      throw error;
    }
  }

  it.each(["start", "upload"] as const)("terminal worker failure commits beside actual %s command", async operation => {
    const setup = await runningFixture();
    const original = await frozenInputs(setup.job.run_id);
    expect(original.source_count).toBe(1);
    const pause = await barrier("analysis_runs", setup.job.run_id);
    const operations: Array<Promise<unknown>> = [];
    const mutation = command(setup.actor);
    const addedFile = source(setup.object.id, "b".repeat(64));
    try {
      const failureInput = { attemptId: setup.lease.attemptId, fencingToken: setup.lease.fencingToken,
        errorCode: "CONTROLLED_INVALID_DOCUMENT", message: "Controlled aggregate lock-order failure" };
      const worker = captured(store().failJob(setup.job.id, failureInput));
      operations.push(worker);
      const workerPid = await waitForBlockedBy(pause.controllerPid);
      const competing = captured((async () => {
        const result = operation === "start"
          ? await store().startCheckCommand(setup.object.id, mutation)
          : await store().registerIngestedFilesCommand(setup.object.id, [addedFile], mutation);
        return result.kind === "success"
          ? { kind: result.kind, id: result.value.id, replayed: result.replayed }
          : { kind: result.kind, id: null, replayed: false };
      })());
      operations.push(competing);
      const commandPid = await waitForBlockedBy(workerPid);
      expect(commandPid).not.toBe(workerPid);
      await pause.release();

      const [failed, completed] = await Promise.all([worker, competing]);
      expect(failed, "Worker must not lose a deadlock race or time out").toEqual({ ok: true, value: { kind: "failed" } });
      expect(completed, "Aggregate command must not lose a deadlock race or time out").toMatchObject({ ok: true, value: { kind: "success", replayed: false } });
      if (!completed.ok || !completed.value.id) throw new Error("Competing command did not commit");
      const terminal = await terminalSnapshot(setup.job.run_id);
      expect(terminal.run).toMatchObject({ run_state: "FAILED", display_status: "FAILED" });
      expect(terminal.run.completed_at).not.toBeNull();
      expect(terminal.jobs.every(job => ["FAILED", "CANCELLED"].includes(job.state))).toBe(true);
      expect(terminal.jobs.every(job => job.current_attempt_id === null && job.lease_until === null)).toBe(true);
      expect(terminal.events).toHaveLength(1);
      expect(terminal.events[0].payload.error_code).toBe(failureInput.errorCode);
      expect(await frozenInputs(setup.job.run_id)).toEqual(original);
      expect(await store().failJob(setup.job.id, failureInput)).toMatchObject({ kind: "already_terminal", state: "FAILED" });
      expect(await terminalSnapshot(setup.job.run_id)).toEqual(terminal);

      const replay = operation === "start"
        ? await store().startCheckCommand(setup.object.id, mutation)
        : await store().registerIngestedFilesCommand(setup.object.id, [addedFile], mutation);
      expect(replay).toMatchObject({ kind: "success", replayed: true, value: { id: completed.value.id } });
      const aggregate = (await db().query(
        `SELECT object.file_count,inspection.active_run_id,
          (SELECT api_id FROM analysis_runs WHERE id=inspection.active_run_id) AS active_check,
          (SELECT count(*)::int FROM analysis_runs WHERE inspection_id=inspection.id) AS run_count
         FROM objects object JOIN inspections inspection ON inspection.object_id=object.id WHERE object.id=$1`,
        [setup.scope.object_id],
      )).rows[0];
      if (operation === "start") {
        expect(aggregate).toMatchObject({ file_count: 1, active_check: completed.value.id, run_count: 2 });
        expect(aggregate.active_run_id).not.toBe(setup.job.run_id);
      } else {
        expect(aggregate).toMatchObject({ file_count: 2, active_run_id: setup.job.run_id, run_count: 1 });
        expect((await db().query(
          "SELECT count(*)::int n FROM source_files WHERE object_id=$1", [setup.scope.object_id],
        )).rows[0].n).toBe(2);
      }
    } finally {
      await pause.close(operations);
    }
  });

  it("reads the first uploaded source after waiting without relying on an inspection tuple update", async () => {
    const setup = await objectFixture(false);
    const pause = await barrier("upload_receipts", setup.scope.object_id);
    const operations: Array<Promise<unknown>> = [];
    try {
      // Actual upload owns the inspection and pauses before inserting source
      // metadata/updating file_count. Upload itself does not update inspection.
      const upload = captured(store().registerIngestedFilesCommand(setup.object.id, [setup.file], command(setup.actor)));
      operations.push(upload);
      const uploadPid = await waitForBlockedBy(pause.controllerPid);
      expect((await db().query("SELECT file_count FROM objects WHERE id=$1", [setup.scope.object_id])).rows[0].file_count).toBe(0);
      const start = captured(store().startCheckCommand(setup.object.id, command(setup.actor)));
      operations.push(start);
      await waitForBlockedBy(uploadPid);
      await pause.release();
      const [uploaded, started] = await Promise.all([upload, start]);
      expect(uploaded).toMatchObject({ ok: true, value: { kind: "success" } });
      expect(started, "A committed first upload must not produce DOCUMENTS_REQUIRED").toMatchObject({ ok: true, value: { kind: "success" } });
      if (!started.ok || started.value.kind !== "success") throw new Error("First-source check did not start");
      const persisted = (await db().query(
        `SELECT object.file_count,manifest.canonical_json,
          (SELECT count(*)::int FROM manifest_items item WHERE item.manifest_id=run.manifest_id) AS source_count
         FROM analysis_runs run JOIN objects object ON object.id=run.object_id
         JOIN input_manifests manifest ON manifest.id=run.manifest_id WHERE run.api_id=$1`, [started.value.value.id],
      )).rows[0];
      expect(persisted).toMatchObject({ file_count: 1, source_count: 1 });
      expect(persisted.canonical_json.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceFileId: setup.file.id, sha256: setup.file.sha256 }),
      ]));
    } finally {
      await pause.close(operations);
    }
  });
});
