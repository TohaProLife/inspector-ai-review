import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxRelay } from "../src/outbox-relay.js";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] })),
  end: vi.fn(async () => undefined),
}));

vi.mock("amqplib", () => ({ default: { connect: mocks.connect } }));
vi.mock("pg", () => ({ Pool: class {
  query = mocks.query;
  end = mocks.end;
} }));

type Handler = () => void;

function emitter() {
  const listeners = new Map<string, Handler[]>();
  return {
    on(event: string, handler: Handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    emit(event: string) {
      for (const handler of listeners.get(event) ?? []) handler();
    },
  };
}

function transport() {
  const channelEvents = emitter();
  const connectionEvents = emitter();
  const channel = {
    ...channelEvents,
    assertExchange: vi.fn(async () => undefined),
    assertQueue: vi.fn(async () => undefined),
    bindQueue: vi.fn(async () => undefined),
    publish: vi.fn((_exchange: string, _routing: string, _body: Buffer,
      _options: { messageId: string }) => true),
    waitForConfirms: vi.fn(async () => undefined),
    close: vi.fn(async () => { channelEvents.emit("close"); }),
  };
  const connection = {
    ...connectionEvents,
    createConfirmChannel: vi.fn(async () => channel),
    close: vi.fn(async () => { connectionEvents.emit("close"); }),
  };
  return { channel, connection };
}

function event(id: string) {
  return { id, event_type: "job.ready", exchange_name: "inspector.jobs",
    routing_key: "rules.evaluate", payload: { event_id: id }, attempt_count: 10,
    lock_token: `lock-${id}` };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("outbox relay AMQP recovery", () => {
  it("stays unready through failed dial and topology setup, then asserts topology before claiming", async () => {
    const broken = transport();
    const healthy = transport();
    const reconnect = deferred<typeof healthy.connection>();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.connect.mockRejectedValueOnce(new Error("broker unavailable"))
      .mockResolvedValueOnce(broken.connection)
      .mockReturnValueOnce(reconnect.promise);
    broken.channel.assertExchange.mockRejectedValueOnce(new Error("topology unavailable"));
    const claimBatch = vi.fn().mockResolvedValue([]);
    const relay = new OutboxRelay("postgres://unused", "amqp://unused", 1);
    Object.assign(relay, { recoverDueJobsOnce: vi.fn(async () => undefined), claimBatch });
    const running = relay.start();

    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(3));
    expect(relay.isReady()).toBe(false);
    expect(claimBatch).not.toHaveBeenCalled();
    expect(broken.connection.close).toHaveBeenCalled();
    reconnect.resolve(healthy.connection);
    await vi.waitFor(() => expect(relay.isReady()).toBe(true));
    expect(healthy.channel.assertExchange).toHaveBeenCalledTimes(3);
    expect(healthy.channel.assertQueue).toHaveBeenCalledTimes(12);
    await relay.close();
    await running;
    errors.mockRestore();
  });

  it("requeues an unconfirmed event and remaining claimed batch without burning attempts, then reconnects", async () => {
    const first = transport();
    const second = transport();
    const reconnect = deferred<typeof second.connection>();
    mocks.connect.mockResolvedValueOnce(first.connection).mockReturnValueOnce(reconnect.promise);
    first.channel.waitForConfirms.mockImplementationOnce(async () => {
      first.channel.emit("close");
      throw new Error("channel closed before confirmation");
    });
    const events = [event("one"), event("two")];
    const claimBatch = vi.fn()
      .mockResolvedValueOnce(events)
      .mockResolvedValueOnce(events)
      .mockResolvedValue([]);
    const relay = new OutboxRelay("postgres://unused", "amqp://unused", 1);
    Object.assign(relay, { recoverDueJobsOnce: vi.fn(async () => undefined), claimBatch });
    const running = relay.start();

    await vi.waitFor(() => {
      expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("GREATEST(attempt_count - 1")))
        .toHaveLength(2);
    });
    expect(relay.isReady()).toBe(false);
    expect(claimBatch).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("THEN 'DEAD'"))).toBe(false);

    reconnect.resolve(second.connection);
    await vi.waitFor(() => {
      expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("SET state = 'PUBLISHED'")))
        .toHaveLength(2);
    });
    expect(relay.isReady()).toBe(true);
    expect(second.channel.publish.mock.calls.map(([, , , options]) => options.messageId))
      .toEqual(["one", "two"]);
    expect(second.channel.assertExchange).toHaveBeenCalledTimes(3);
    await relay.close();
    await running;
  });

  it("persists a broker-confirmed event even if the channel closes immediately afterward", async () => {
    const first = transport();
    const second = transport();
    const reconnect = deferred<typeof second.connection>();
    mocks.connect.mockResolvedValueOnce(first.connection).mockReturnValueOnce(reconnect.promise);
    first.channel.waitForConfirms.mockImplementationOnce(async () => {
      first.channel.emit("close");
    });
    const claimBatch = vi.fn().mockResolvedValueOnce([event("confirmed")]).mockResolvedValue([]);
    const relay = new OutboxRelay("postgres://unused", "amqp://unused", 1);
    Object.assign(relay, { recoverDueJobsOnce: vi.fn(async () => undefined), claimBatch });
    const running = relay.start();

    await vi.waitFor(() => {
      expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("SET state = 'PUBLISHED'")))
        .toHaveLength(1);
    });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("GREATEST(attempt_count - 1")))
      .toBe(false);
    reconnect.resolve(second.connection);
    await relay.close();
    await running;
  });
});
