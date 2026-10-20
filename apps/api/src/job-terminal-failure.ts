import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isDetachedSourceAuditJob } from "./worker-run-scope.js";

type TerminalFailure = { jobId: string; organizationId: string } & (
  | { reason: "REPORTED_FAILURE"; errorCode: string; message: string }
  | { reason: "CLAIM_INPUT_INTEGRITY"; errorCode: string; message: string }
  | { reason: "ATTEMPTS_EXHAUSTED" | "RECOVER" }
);

/** Caller owns the transaction. REPORTED_FAILURE additionally requires a fenced,
 * validated worker lease. Lock order matches repository commands: inspection/run/job.
 * Repairs only the current open running scope; immutable terminal runs are untouched.
 */
export async function propagateTerminalJobFailure(client: PoolClient, input: TerminalFailure): Promise<boolean> {
  const scope = (await client.query<{ inspection_id: string; run_id: string }>(
    `SELECT inspection_id,run_id FROM analysis_jobs WHERE id=$1 AND organization_id=$2`,
    [input.jobId, input.organizationId])).rows[0];
  if (!scope) return false;
  const inspection = (await client.query<{ lifecycle: string; active_run_id: string | null }>(
    `SELECT lifecycle,active_run_id FROM inspections WHERE id=$1 FOR UPDATE`, [scope.inspection_id])).rows[0];
  const run = (await client.query<{ run_state: string; object_id: string }>(
    `SELECT run_state,object_id FROM analysis_runs WHERE id=$1 FOR UPDATE`, [scope.run_id])).rows[0];
  if (inspection?.lifecycle !== "OPEN" || (inspection.active_run_id !== scope.run_id
      && !await isDetachedSourceAuditJob(client, input.jobId, scope.run_id, input.organizationId))
    || !run || !["QUEUED", "RUNNING"].includes(run.run_state)) return false;
  const job = (await client.query<{ state: string; job_type: string; attempt_count: number; max_attempts: number;
    lease_expired: boolean; retry_due: boolean; current_attempt_id: string | null;
    last_error_code: string | null; last_error_message: string | null }>(
    `SELECT state,job_type,attempt_count,max_attempts,current_attempt_id,last_error_code,last_error_message,
      lease_until <= now() AS lease_expired,next_attempt_at <= now() AS retry_due
     FROM analysis_jobs WHERE id=$1 AND organization_id=$2 AND run_id=$3 FOR UPDATE`,
    [input.jobId, input.organizationId, scope.run_id])).rows[0];
  if (!job) return false;
  const alreadyFailed = ["FAILED", "DEAD"].includes(job.state);
  const exhausted = Number(job.attempt_count) >= Number(job.max_attempts)
    && (job.state === "READY" || (job.state === "LEASED" && job.lease_expired)
      || (job.state === "RETRY_WAIT" && job.retry_due));
  // Claim validation runs before a lease is delivered. Its rollback must not
  // erase the deterministic failure forever, nor may a concurrent live lease
  // be terminated by a failed competing claimant.
  const invalidClaim = input.reason === "CLAIM_INPUT_INTEGRITY"
    && (job.state === "READY" || job.state === "RETRY_WAIT" && job.retry_due
      || job.state === "LEASED" && job.lease_expired);
  if (!alreadyFailed && !(input.reason === "REPORTED_FAILURE" ? job.state === "LEASED" : invalidClaim || exhausted)) return false;
  const errorCode = alreadyFailed ? job.last_error_code ?? "JOB_TERMINAL_FAILURE"
    : input.reason === "REPORTED_FAILURE" || input.reason === "CLAIM_INPUT_INTEGRITY" ? input.errorCode : "ATTEMPTS_EXHAUSTED";
  const message = alreadyFailed ? job.last_error_message ?? "Job terminal failure recovered"
    : input.reason === "REPORTED_FAILURE" || input.reason === "CLAIM_INPUT_INTEGRITY" ? input.message : "Worker attempts exhausted after lease expiry";
  if (job.current_attempt_id) await client.query(
    `UPDATE job_attempts SET state=CASE WHEN lease_until<=now() THEN 'EXPIRED' ELSE 'FAILED' END,
       error_code=CASE WHEN lease_until<=now() THEN 'LEASE_EXPIRED' ELSE $2 END,
       error_message=$3,completed_at=now() WHERE id=$1 AND state='LEASED'`,
    [job.current_attempt_id, errorCode, message]);
  await client.query(`UPDATE analysis_jobs SET state=$2,current_attempt_id=NULL,lease_until=NULL,
    last_error_code=$3,last_error_message=$4,completed_at=COALESCE(completed_at,now()),updated_at=now()
    WHERE id=$1`, [input.jobId, job.state === "DEAD" ? "DEAD" : "FAILED", errorCode, message]);
  const descendants = await client.query<{ id: string; current_attempt_id: string | null }>(
    `WITH RECURSIVE descendants(id) AS (
       SELECT job_id FROM analysis_job_dependencies WHERE prerequisite_job_id=$1
       UNION SELECT dependency.job_id FROM analysis_job_dependencies dependency
       JOIN descendants parent ON parent.id=dependency.prerequisite_job_id
     ) SELECT job.id,job.current_attempt_id FROM analysis_jobs job
       WHERE job.id IN (SELECT id FROM descendants) AND job.run_id=$2 AND job.organization_id=$3
         AND job.state IN ('BLOCKED','READY','RETRY_WAIT','LEASED') ORDER BY job.id FOR UPDATE OF job`,
    [input.jobId, scope.run_id, input.organizationId]);
  for (const descendant of descendants.rows) {
    if (descendant.current_attempt_id) await client.query(`UPDATE job_attempts SET state='CANCELLED',
      completed_at=now(),error_code='PREREQUISITE_FAILED',error_message='Prerequisite job terminal failure'
      WHERE id=$1 AND state='LEASED'`, [descendant.current_attempt_id]);
    await client.query(`UPDATE analysis_jobs SET state='CANCELLED',current_attempt_id=NULL,lease_until=NULL,
      fencing_token=fencing_token+CASE WHEN state='LEASED' THEN 1 ELSE 0 END,
      last_error_code='PREREQUISITE_FAILED',last_error_message='Prerequisite job terminal failure',
      completed_at=now(),updated_at=now() WHERE id=$1`, [descendant.id]);
  }
  const failedRun = await client.query<{ event_version: string | number }>(
    `UPDATE analysis_runs SET run_state='FAILED',display_status='FAILED',current_stage='Worker завершился ошибкой',
      completed_at=now(),event_version=event_version+1 WHERE id=$1 AND run_state IN ('QUEUED','RUNNING')
      RETURNING event_version`, [scope.run_id]);
  if (failedRun.rows.length !== 1) throw new Error("Terminal failure lost the locked active run");
  if (inspection.active_run_id === scope.run_id) await client.query(`UPDATE objects SET display_status='FAILED',updated_at=now()
    WHERE id=$1 AND organization_id=$2`, [run.object_id, input.organizationId]);
  const eventId = randomUUID(), version = Number(failedRun.rows[0].event_version);
  await client.query(`INSERT INTO domain_outbox (id,event_type,aggregate_type,aggregate_id,aggregate_version,
    exchange_name,routing_key,payload) VALUES ($1,'stage.finished','ANALYSIS_RUN',$2,$3,
    'inspector.events','stage.finished',$4::jsonb)`, [eventId, scope.run_id, version, JSON.stringify({
    schema_version: "1.0", event_id: eventId, event_type: "stage.finished", occurred_at: new Date().toISOString(),
    trace_id: randomUUID(), organization_id: input.organizationId, object_id: run.object_id,
    inspection_id: scope.inspection_id, run_id: scope.run_id, job_id: input.jobId, job_type: job.job_type,
    aggregate_version: version, outcome: "FAILED", error_code: errorCode,
  })]);
  return true;
}
