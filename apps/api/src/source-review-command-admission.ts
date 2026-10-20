import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { PdfIoError } from "./verified-pdf-io.js";

export const SOURCE_REVIEW_ADMISSION_LIMITS = Object.freeze({
  connections: 2, invocations: 10, pollMilliseconds: 25,
  connectionMilliseconds: 1500, statementMilliseconds: 5000,
  lockMilliseconds: 1500, deadlineMilliseconds: 55_000,
});
// The two-int32 advisory key space is disjoint from the existing single-bigint
// receipt lock. Hash collisions only serialize: authorization/hash checks stay fresh.
export const SOURCE_REVIEW_ADMISSION_NAMESPACE = 0x53525631;
const TRY_LOCK = "SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired";
const UNLOCK = "SELECT pg_advisory_unlock($1::integer,$2::integer) AS released";
interface Lease { client: PoolClient; release(destroy?: boolean): Promise<void> }

function check(signal: AbortSignal): void { signal.throwIfAborted(); }
function wait(signal: AbortSignal): Promise<void> {
  check(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, SOURCE_REVIEW_ADMISSION_LIMITS.pollMilliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Cross-repository/process admission only. No result or authorization cache. */
export class SourceReviewCommandAdmission {
  private pool?: Pool;
  private slots = 0;
  private closed = false;
  private closing?: Promise<void>;
  private readonly active = new Set<{ controller: AbortController; done: Promise<void> }>();
  constructor(private readonly connectionString: string) {}

  private async checkout(signal: AbortSignal): Promise<Lease> {
    while (this.slots >= SOURCE_REVIEW_ADMISSION_LIMITS.connections) await wait(signal);
    check(signal);
    // Synchronous reservation: never enqueue pool.connect behind a held session.
    this.slots++;
    let client: PoolClient;
    try {
      this.pool ??= new Pool({ connectionString: this.connectionString,
        max: SOURCE_REVIEW_ADMISSION_LIMITS.connections,
        connectionTimeoutMillis: SOURCE_REVIEW_ADMISSION_LIMITS.connectionMilliseconds,
        statement_timeout: SOURCE_REVIEW_ADMISSION_LIMITS.statementMilliseconds,
        query_timeout: SOURCE_REVIEW_ADMISSION_LIMITS.statementMilliseconds,
        lock_timeout: SOURCE_REVIEW_ADMISSION_LIMITS.lockMilliseconds });
      // Idle failures must be observed; active sessions have invocation handlers.
      if (this.pool.listenerCount("error") === 0) this.pool.on("error", () => {});
      client = await this.pool.connect();
    } catch (error) { this.slots--; throw error; }
    let released = false, ended = false;
    let finishEnd!: () => void;
    const end = new Promise<void>(resolve => { finishEnd = resolve; });
    const onEnd = () => { ended = true; finishEnd(); };
    client.once("end", onEnd);
    const lease: Lease = { client, release: async (destroy = false) => {
      if (released) return;
      released = true;
      try {
        if (destroy) { client.release(true); if (!ended) await end; }
        else { client.removeListener("end", onEnd); client.release(); }
      } finally { this.slots--; }
    } };
    // No Promise.race: late connect resolutions are owned and destroyed here.
    if (signal.aborted) { await lease.release(true); check(signal); }
    return lease;
  }

  async run<T>(scope: string, operation: (signal: AbortSignal) => Promise<T>,
    options: { signal?: AbortSignal } = {}): Promise<T> {
    if (this.closed || this.active.size >= SOURCE_REVIEW_ADMISSION_LIMITS.invocations) throw new PdfIoError("PDF_IO_BUSY");
    if (typeof scope !== "string" || scope.length < 1 || scope.length > 16_384
      || options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new PdfIoError("PDF_IO_LIMIT");
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new PdfIoError("PDF_IO_DEADLINE")), SOURCE_REVIEW_ADMISSION_LIMITS.deadlineMilliseconds);
    let finish!: () => void;
    const entry = { controller, done: new Promise<void>(resolve => { finish = resolve; }) };
    this.active.add(entry);
    const key = createHash("sha256").update(scope).digest().readInt32BE(0);
    let owned: Lease | undefined, failed = false;
    const onOwnerError = () => controller.abort(new PdfIoError("PDF_IO_CANCELLED"));
    try {
      for (;;) {
        check(signal);
        const lease = await this.checkout(signal);
        lease.client.on("error", onOwnerError);
        let cancelled: Promise<void> | undefined;
        const abortProbe = () => { cancelled ??= lease.release(true); };
        signal.addEventListener("abort", abortProbe, { once: true });
        try {
          check(signal);
          const result = await lease.client.query<{ acquired: boolean }>(TRY_LOCK, [SOURCE_REVIEW_ADMISSION_NAMESPACE, key]);
          check(signal);
          if (result.rows.length !== 1 || typeof result.rows[0].acquired !== "boolean") throw new PdfIoError("PDF_IO_CANCELLED");
          if (result.rows[0].acquired) { owned = lease; break; }
        } catch (error) {
          await (cancelled ?? lease.release(true));
          throw error;
        } finally {
          signal.removeEventListener("abort", abortProbe);
          if (!owned) lease.client.removeListener("error", onOwnerError);
        }
        await lease.release();
        await wait(signal);
      }
      check(signal);
      // The existing heavy gate is acquired by the caller only after admission.
      const value = await operation(signal);
      check(signal);
      return value;
    } catch (error) { failed = true; check(signal); throw error; }
    finally {
      try {
        if (owned) {
          // Keep the session until domain work and its rollback have settled.
          // Abort cannot release admission while an inventory transaction is live.
          let destroy = signal.aborted;
          try {
            if (!destroy) {
              const result = await owned.client.query<{ released: boolean }>(UNLOCK, [SOURCE_REVIEW_ADMISSION_NAMESPACE, key]);
              if (result.rows.length !== 1 || result.rows[0].released !== true) { destroy = true; if (!failed) throw new PdfIoError("PDF_IO_CANCELLED"); }
            }
          } catch (error) { destroy = true; if (!failed) { check(signal); throw error; } }
          finally { owned.client.removeListener("error", onOwnerError); await owned.release(destroy); }
        }
        if (!failed) check(signal);
      } finally {
        clearTimeout(timer);
        this.active.delete(entry);
        finish();
      }
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      const entries = [...this.active];
      for (const entry of entries) entry.controller.abort(new PdfIoError("PDF_IO_CANCELLED"));
      await Promise.allSettled(entries.map(entry => entry.done));
      await this.pool?.end();
    })();
    return this.closing;
  }
}
