export const outboxStates = ["PENDING", "PUBLISHING", "PUBLISHED", "DEAD"] as const;
export const jobStates = ["BLOCKED", "READY", "LEASED", "RETRY_WAIT", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"] as const;

export interface RelayOperationalSnapshot {
  relayReady: number;
  outbox: Record<(typeof outboxStates)[number], number>;
  jobs: Record<(typeof jobStates)[number], number>;
  oldestPendingSeconds: number;
  oldestQueuedJobSeconds: number;
  retryingOutboxEvents: number;
  expiredAttempts: number;
}

function metric(name: string, help: string, value: number): string[] {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${value}`];
}

export function renderRelayMetrics(snapshot: RelayOperationalSnapshot): string {
  const lines = [
    ...metric("inspector_outbox_relay_ready", "Whether relay has an active RabbitMQ topology", snapshot.relayReady),
    "# HELP inspector_outbox_events Current outbox rows by state",
    "# TYPE inspector_outbox_events gauge",
    ...outboxStates.map((state) => `inspector_outbox_events{state="${state}"} ${snapshot.outbox[state]}`),
    "# HELP inspector_analysis_jobs Current analysis jobs by state",
    "# TYPE inspector_analysis_jobs gauge",
    ...jobStates.map((state) => `inspector_analysis_jobs{state="${state}"} ${snapshot.jobs[state]}`),
    ...metric(
      "inspector_outbox_oldest_pending_seconds",
      "Age of oldest pending or publishing outbox event",
      snapshot.oldestPendingSeconds,
    ),
    ...metric(
      "inspector_job_oldest_queued_seconds",
      "Age of oldest ready or retry-wait analysis job",
      snapshot.oldestQueuedJobSeconds,
    ),
    ...metric(
      "inspector_outbox_retrying_events",
      "Outbox events with more than one publish attempt and no successful publish",
      snapshot.retryingOutboxEvents,
    ),
    ...metric(
      "inspector_job_expired_attempts",
      "Persisted worker attempts ended by lease expiry",
      snapshot.expiredAttempts,
    ),
    ...metric("inspector_outbox_relay_scrape_success", "Whether relay metrics snapshot succeeded", 1),
  ];
  return `${lines.join("\n")}\n`;
}
