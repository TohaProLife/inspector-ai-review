import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer, type Server } from "node:http";
import amqp, { type ConfirmChannel } from "amqplib";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { renderRelayMetrics, type RelayOperationalSnapshot } from "./outbox-metrics.js";

interface OutboxRow extends QueryResultRow {
  id: string;
  event_type: string;
  exchange_name: string;
  routing_key: string;
  payload: Record<string, unknown> | string;
  attempt_count: number;
  lock_token: string;
}

interface RecoverableJobRow extends QueryResultRow {
  id: string;
  organization_id: string;
  object_id: string;
  inspection_id: string;
  run_id: string;
  queue_name: string;
  job_type: string;
  input_manifest_hash: string;
  semantic_key: string;
  release_id: string;
}

const JOB_EXCHANGE = "inspector.jobs";
const EVENT_EXCHANGE = "inspector.events";
const DEAD_EXCHANGE = "inspector.jobs.dead";
const JOB_QUEUES = [
  "rules.evaluate",
  "rules.evaluate.zu127.poppler-v2",
  "rules.evaluate.zu127.poppler-v3",
  "documents.render",
  "documents.extract",
  "documents.link",
] as const;

function parsePayload(value: Record<string, unknown> | string): Record<string, unknown> {
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asCount(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export class OutboxRelay {
  private readonly pool: Pool;
  private channel?: ConfirmChannel;
  private connection?: Awaited<ReturnType<typeof amqp.connect>>;
  private stopped = false;
  private ready = false;
  private runPromise?: Promise<void>;

  constructor(
    connectionString: string,
    private readonly rabbitUrl: string,
    private readonly pollIntervalMs = 500,
  ) {
    this.pool = new Pool({ connectionString, max: 4 });
  }

  async start(): Promise<void> {
    if (this.runPromise || this.stopped) throw new Error("Outbox relay is already running or stopped");
    this.runPromise = this.run();
    try {
      await this.runPromise;
    } finally {
      this.ready = false;
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    await this.runPromise?.catch(() => undefined);
    await this.pool.end();
  }

  private async run(): Promise<void> {
    let reconnectDelayMs = 100;
    while (!this.stopped) {
      if (!this.ready) {
        try {
          await this.connectOnce();
          reconnectDelayMs = 100;
        } catch (error) {
          if (!this.stopped) {
            console.error(JSON.stringify({ level: "error", event: "outbox.amqp.reconnect_failed",
              message: error instanceof Error ? error.message : "Unknown AMQP error" }));
            await sleep(reconnectDelayMs);
            reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000);
          }
        }
        continue;
      }
      try {
        await this.recoverDueJobsOnce();
        if (!this.ready || this.stopped) continue;
        // Claim one event at a time: a later row in a large batch could outlive
        // its 30-second lock while earlier AMQP confirms are still pending.
        const batch = await this.claimBatch(1);
        if (batch.length === 0) {
          await sleep(this.pollIntervalMs);
          continue;
        }
        for (let index = 0; index < batch.length; index += 1) {
          if (!this.ready || this.stopped) {
            await this.requeueUnpublished(batch.slice(index), "AMQP transport unavailable");
            break;
          }
          await this.publish(batch[index]);
        }
      } catch (error) {
        if (!this.stopped) {
          console.error(JSON.stringify({ level: "error", event: "outbox.relay.iteration_failed",
            message: error instanceof Error ? error.message : "Unknown relay error" }));
          await sleep(this.pollIntervalMs);
        }
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const connection = await amqp.connect(this.rabbitUrl, { timeout: 5_000 });
    let channel: ConfirmChannel | undefined;
    let unavailable = false;
    const onUnavailable = () => {
      if (unavailable) return;
      unavailable = true;
      if (this.connection === connection) {
        this.ready = false;
        this.connection = undefined;
        this.channel = undefined;
      }
      void connection.close().catch(() => undefined);
    };
    connection.on("close", onUnavailable);
    connection.on("error", onUnavailable);
    try {
      channel = await connection.createConfirmChannel();
      channel.on("close", onUnavailable);
      channel.on("error", onUnavailable);
      await this.assertTopology(channel);
      if (unavailable || this.stopped) throw new Error("AMQP transport closed during setup");
      this.connection = connection;
      this.channel = channel;
      this.ready = true;
    } catch (error) {
      await channel?.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  async operationalSnapshot(): Promise<RelayOperationalSnapshot> {
    const [outboxResult, jobResult] = await Promise.all([
      this.pool.query<{
        pending: string | number;
        publishing: string | number;
        published: string | number;
        dead: string | number;
        oldest_pending_seconds: string | number;
        retrying: string | number;
      }>(
        `SELECT
           count(*) FILTER (WHERE state = 'PENDING') AS pending,
           count(*) FILTER (WHERE state = 'PUBLISHING') AS publishing,
           count(*) FILTER (WHERE state = 'PUBLISHED') AS published,
           count(*) FILTER (WHERE state = 'DEAD') AS dead,
           COALESCE(EXTRACT(EPOCH FROM (
             now() - min(created_at) FILTER (WHERE state IN ('PENDING', 'PUBLISHING'))
           )), 0) AS oldest_pending_seconds,
           count(*) FILTER (
             WHERE state IN ('PENDING', 'PUBLISHING', 'DEAD') AND attempt_count > 1
           ) AS retrying
         FROM domain_outbox`,
      ),
      this.pool.query<{
        blocked: string | number;
        ready: string | number;
        leased: string | number;
        retry_wait: string | number;
        succeeded: string | number;
        failed: string | number;
        dead: string | number;
        cancelled: string | number;
        oldest_queued_seconds: string | number;
        expired_attempts: string | number;
      }>(
        `SELECT
           count(*) FILTER (WHERE job.state = 'BLOCKED') AS blocked,
           count(*) FILTER (WHERE job.state = 'READY') AS ready,
           count(*) FILTER (WHERE job.state = 'LEASED') AS leased,
           count(*) FILTER (WHERE job.state = 'RETRY_WAIT') AS retry_wait,
           count(*) FILTER (WHERE job.state = 'SUCCEEDED') AS succeeded,
           count(*) FILTER (WHERE job.state = 'FAILED') AS failed,
           count(*) FILTER (WHERE job.state = 'DEAD') AS dead,
           count(*) FILTER (WHERE job.state = 'CANCELLED') AS cancelled,
           COALESCE(EXTRACT(EPOCH FROM (
             now() - min(job.created_at) FILTER (WHERE job.state IN ('READY', 'RETRY_WAIT'))
           )), 0) AS oldest_queued_seconds,
           (SELECT count(*) FROM job_attempts attempt WHERE attempt.state = 'EXPIRED') AS expired_attempts
         FROM analysis_jobs job`,
      ),
    ]);
    const outbox = outboxResult.rows[0];
    const jobs = jobResult.rows[0];
    return {
      relayReady: this.ready ? 1 : 0,
      outbox: {
        PENDING: asCount(outbox.pending),
        PUBLISHING: asCount(outbox.publishing),
        PUBLISHED: asCount(outbox.published),
        DEAD: asCount(outbox.dead),
      },
      jobs: {
        BLOCKED: asCount(jobs.blocked),
        READY: asCount(jobs.ready),
        LEASED: asCount(jobs.leased),
        RETRY_WAIT: asCount(jobs.retry_wait),
        SUCCEEDED: asCount(jobs.succeeded),
        FAILED: asCount(jobs.failed),
        DEAD: asCount(jobs.dead),
        CANCELLED: asCount(jobs.cancelled),
      },
      oldestPendingSeconds: asCount(outbox.oldest_pending_seconds),
      oldestQueuedJobSeconds: asCount(jobs.oldest_queued_seconds),
      retryingOutboxEvents: asCount(outbox.retrying),
      expiredAttempts: asCount(jobs.expired_attempts),
    };
  }

  isReady(): boolean {
    return this.ready;
  }

  private async assertTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertExchange(JOB_EXCHANGE, "direct", { durable: true });
    await channel.assertExchange(EVENT_EXCHANGE, "topic", { durable: true });
    await channel.assertExchange(DEAD_EXCHANGE, "direct", { durable: true });
    for (const queue of JOB_QUEUES) {
      await channel.assertQueue(queue, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": DEAD_EXCHANGE,
          "x-dead-letter-routing-key": `${queue}.dead`,
        },
      });
      await channel.bindQueue(queue, JOB_EXCHANGE, queue);
      await channel.assertQueue(`${queue}.dead`, { durable: true });
      await channel.bindQueue(`${queue}.dead`, DEAD_EXCHANGE, `${queue}.dead`);
    }
  }

  async recoverDueJobsOnce(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const expiredAttempts = await client.query<{ current_attempt_id: string }>(
        `SELECT current_attempt_id
         FROM analysis_jobs
         WHERE state = 'LEASED' AND lease_until <= now() AND current_attempt_id IS NOT NULL
         ORDER BY lease_until, id
         FOR UPDATE SKIP LOCKED
         LIMIT 100`,
      );
      for (const attempt of expiredAttempts.rows) {
        await client.query(
          `UPDATE job_attempts
           SET state = 'EXPIRED', completed_at = now(), error_code = 'LEASE_EXPIRED'
           WHERE id = $1 AND state = 'LEASED'`,
          [attempt.current_attempt_id],
        );
      }
      const recovered = await client.query<RecoverableJobRow>(
        `UPDATE analysis_jobs
         SET state = 'READY', current_attempt_id = NULL, lease_until = NULL,
             fencing_token = CASE WHEN state = 'LEASED' THEN fencing_token + 1 ELSE fencing_token END,
             updated_at = now()
         WHERE id IN (
           SELECT id
           FROM analysis_jobs
           WHERE (state = 'LEASED' AND lease_until <= now())
              OR (state = 'RETRY_WAIT' AND next_attempt_at <= now())
           ORDER BY next_attempt_at, created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 100
         )
         RETURNING id, organization_id, object_id, inspection_id, run_id,
                   queue_name, job_type, input_manifest_hash, semantic_key, release_id`,
      );
      for (const job of recovered.rows) await this.enqueueJobEvent(client, job);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async enqueueJobEvent(client: PoolClient, job: RecoverableJobRow): Promise<void> {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const payload = {
      schema_version: "1.0",
      event_id: eventId,
      event_type: "job.ready",
      occurred_at: occurredAt,
      trace_id: randomUUID(),
      organization_id: job.organization_id,
      object_id: job.object_id,
      inspection_id: job.inspection_id,
      run_id: job.run_id,
      job_id: job.id,
      job_type: job.job_type,
      scope_type: "ANALYSIS",
      input_manifest_hash: job.input_manifest_hash.trim(),
      semantic_key: job.semantic_key.trim(),
      release_id: job.release_id,
    };
    await client.query(
      `INSERT INTO domain_outbox (
         id, event_type, aggregate_type, aggregate_id, aggregate_version,
         exchange_name, routing_key, payload
       ) VALUES (
         $1, 'job.ready', 'ANALYSIS_JOB', $2::uuid::text,
         (SELECT attempt_count + 1 FROM analysis_jobs WHERE id = $2::uuid),
         $3, $4, $5::jsonb
       )`,
      [eventId, job.id, JOB_EXCHANGE, job.queue_name, JSON.stringify(payload)],
    );
  }

  private async claimBatch(limit: number): Promise<OutboxRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE domain_outbox
         SET state = 'PENDING', lock_token = NULL, lock_until = NULL
         WHERE state = 'PUBLISHING' AND lock_until <= now()`,
      );
      const claimed = await client.query<OutboxRow>(
        `WITH selected AS (
           SELECT id
           FROM domain_outbox
           WHERE state = 'PENDING' AND available_at <= now()
           ORDER BY created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE domain_outbox event
         SET state = 'PUBLISHING', attempt_count = event.attempt_count + 1,
             lock_token = gen_random_uuid(), lock_until = now() + interval '30 seconds'
         FROM selected
         WHERE event.id = selected.id
         RETURNING event.id, event.event_type, event.exchange_name, event.routing_key,
                   event.payload, event.attempt_count, event.lock_token`,
        [limit],
      );
      await client.query("COMMIT");
      return claimed.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async publish(event: OutboxRow): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = parsePayload(event.payload);
    } catch (error) {
      await this.failEvent(event, error);
      return;
    }
    const channel = this.channel;
    if (!this.ready || !channel) {
      await this.requeueUnpublished([event], "AMQP transport unavailable");
      return;
    }
    try {
      channel.publish(
        event.exchange_name,
        event.routing_key,
        Buffer.from(JSON.stringify(payload)),
        {
          persistent: true,
          contentType: "application/json",
          messageId: event.id,
          type: event.event_type,
          timestamp: Date.now(),
        },
      );
      let confirmationTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          channel.waitForConfirms(),
          new Promise<never>((_resolve, reject) => {
            confirmationTimeout = setTimeout(() => reject(new Error("AMQP confirmation timed out")), 20_000);
          }),
        ]);
      } finally {
        if (confirmationTimeout) clearTimeout(confirmationTimeout);
      }
    } catch (error) {
      // The broker may have accepted a publish before the connection failed.
      // Keep its stable messageId and retry as an unconfirmed outbox event.
      this.ready = false;
      void this.connection?.close().catch(() => undefined);
      await this.requeueUnpublished([event], error);
      return;
    }
    // Once confirmed, persist PUBLISHED even if the channel closes immediately afterward.
    // A database failure leaves the locked row for recovery; it must not be marked DEAD.
    await this.pool.query(
      `UPDATE domain_outbox
       SET state = 'PUBLISHED', published_at = now(), lock_token = NULL, lock_until = NULL, last_error = NULL
       WHERE id = $1 AND state = 'PUBLISHING' AND lock_token = $2`,
      [event.id, event.lock_token],
    );
  }

  private async requeueUnpublished(events: OutboxRow[], error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
    for (const event of events) {
      await this.pool.query(
        `UPDATE domain_outbox
         SET state = 'PENDING', attempt_count = GREATEST(attempt_count - 1, 0),
             available_at = now(), lock_token = NULL, lock_until = NULL, last_error = $3
         WHERE id = $1 AND state = 'PUBLISHING' AND lock_token = $2`,
        [event.id, event.lock_token, message],
      );
    }
  }

  private async failEvent(event: OutboxRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 2000) : "Unknown publish error";
    const delaySeconds = Math.min(60, 2 ** Math.min(event.attempt_count, 5));
    await this.pool.query(
      `UPDATE domain_outbox
       SET state = CASE WHEN attempt_count >= 10 THEN 'DEAD' ELSE 'PENDING' END,
           available_at = now() + make_interval(secs => $3),
           lock_token = NULL, lock_until = NULL, last_error = $4
       WHERE id = $1 AND state = 'PUBLISHING' AND lock_token = $2`,
      [event.id, event.lock_token, delaySeconds, message],
    );
  }
}

class RelayMetricsServer {
  private server?: Server;

  constructor(
    private readonly relay: OutboxRelay,
    private readonly host: string,
    private readonly port: number,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request.url ?? "/", response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, this.host, () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private async handle(url: string, response: import("node:http").ServerResponse): Promise<void> {
    if (url !== "/health" && url !== "/metrics") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }
    try {
      const snapshot = await this.relay.operationalSnapshot();
      if (url === "/health") {
        if (!this.relay.isReady()) {
          response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ status: "starting" })}\n`);
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(`${JSON.stringify({ status: "ok" })}\n`);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      response.end(renderRelayMetrics(snapshot));
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        event: "outbox.metrics.failed",
        message: error instanceof Error ? error.message : "Unknown metrics error",
      }));
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("inspector_outbox_relay_scrape_success 0\n");
    }
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const rabbitUrl = process.env.RABBITMQ_URL;
  if (!connectionString || !rabbitUrl) {
    throw new Error("DATABASE_URL and RABBITMQ_URL are required for outbox relay");
  }
  const metricsPort = Number(process.env.OUTBOX_METRICS_PORT ?? "9465");
  if (!Number.isInteger(metricsPort) || metricsPort < 1 || metricsPort > 65_535) {
    throw new Error("OUTBOX_METRICS_PORT must be an integer between 1 and 65535");
  }
  const relay = new OutboxRelay(connectionString, rabbitUrl);
  const metrics = new RelayMetricsServer(relay, process.env.OUTBOX_METRICS_HOST ?? "0.0.0.0", metricsPort);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void Promise.all([metrics.close(), relay.close()]).finally(() => process.exit(0));
    });
  }
  await metrics.start();
  await relay.start();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
