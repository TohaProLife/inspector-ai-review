import { describe, expect, it } from "vitest";
import { renderRelayMetrics } from "../src/outbox-metrics.js";

describe("outbox relay metrics", () => {
  it("renders bounded operational state in Prometheus text format", () => {
    const metrics = renderRelayMetrics({
      relayReady: 1,
      outbox: { PENDING: 2, PUBLISHING: 1, PUBLISHED: 20, DEAD: 0 },
      jobs: { BLOCKED: 5, READY: 3, LEASED: 1, RETRY_WAIT: 2, SUCCEEDED: 12, FAILED: 1, DEAD: 0, CANCELLED: 4 },
      oldestPendingSeconds: 61.5,
      oldestQueuedJobSeconds: 42,
      retryingOutboxEvents: 1,
      expiredAttempts: 2,
    });

    expect(metrics).toContain("inspector_outbox_relay_ready 1");
    expect(metrics).toContain('inspector_outbox_events{state="PENDING"} 2');
    expect(metrics).toContain('inspector_analysis_jobs{state="CANCELLED"} 4');
    expect(metrics).toContain('inspector_analysis_jobs{state="BLOCKED"} 5');
    expect(metrics).toContain("inspector_outbox_oldest_pending_seconds 61.5");
    expect(metrics).toContain("inspector_job_expired_attempts 2");
    expect(metrics).toContain("inspector_outbox_relay_scrape_success 1");
  });
});
