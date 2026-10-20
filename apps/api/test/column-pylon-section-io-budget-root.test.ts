import assert from "node:assert/strict";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import * as io from "../src/verified-pdf-io.js";

// Independent fixed-budget expectations; no implementation-derived clock values.
const withColumnPylonSectionIoBudget = (io as unknown as {
  withColumnPylonSectionIoBudget: typeof io.withPdfIoBudget;
}).withColumnPylonSectionIoBudget;
const errorCode = (code: string) => (error: unknown) => error instanceof io.PdfIoError && error.code === code;
const flush = () => vi.advanceTimersByTimeAsync(0);
function untilAbort(signal: AbortSignal, cleaned?: () => void): Promise<void> {
  return new Promise(resolve => signal.addEventListener("abort", () => { cleaned?.(); resolve(); }, { once: true }));
}

beforeAll(() => expect(withColumnPylonSectionIoBudget, "missing export withColumnPylonSectionIoBudget").toBeTypeOf("function"));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z")); });
afterEach(() => { const remaining = vi.getTimerCount(); vi.useRealTimers(); assert.equal(remaining, 0, "no orphan budget timer"); });

test("new fixed budget survives 20 seconds and returns before 55 seconds", async () => {
  let received: AbortSignal | undefined; let finish!: () => void;
  const result = withColumnPylonSectionIoBudget(signal => { received = signal; return new Promise<void>(resolve => { finish = resolve; }); });
  await flush(); await vi.advanceTimersByTimeAsync(20_001);
  assert.equal(received?.aborted, false); finish(); await result;
});

test("default abort is exactly 55 seconds and operation is awaited", async () => {
  let received: AbortSignal | undefined; let cleaned = false;
  const result = withColumnPylonSectionIoBudget(signal => { received = signal; return untilAbort(signal, () => { cleaned = true; }); });
  const rejected = assert.rejects(result, errorCode("PDF_IO_DEADLINE"));
  await flush(); await vi.advanceTimersByTimeAsync(54_999); assert.equal(received?.aborted, false);
  await vi.advanceTimersByTimeAsync(1); await rejected; assert.equal(cleaned, true);
});

test("new invalid options reject before callback; legacy still caps at 20 seconds", async () => {
  let calls = 0; const operation = async () => { calls++; };
  for (const deadlineMilliseconds of [55_001, 0, -1, 1.5, Infinity, NaN]) {
    await assert.rejects(withColumnPylonSectionIoBudget(operation, { deadlineMilliseconds }), errorCode("PDF_IO_LIMIT"));
  }
  await assert.rejects(io.withPdfIoBudget(operation, { deadlineMilliseconds: 20_001 }), errorCode("PDF_IO_LIMIT"));
  await assert.rejects(withColumnPylonSectionIoBudget(operation, { leaseUntilEpochMs: NaN }), errorCode("PDF_IO_LIMIT"));
  assert.equal(calls, 0); assert.equal(io.PDF_IO_LIMITS.deadlineMilliseconds, 20_000);
});

test("explicit shortening and lease reserve use the earlier deadline", async () => {
  const gate = new io.PdfIoAdmissionGate(1, 1); let received: AbortSignal | undefined;
  const result = withColumnPylonSectionIoBudget(signal => { received = signal; return untilAbort(signal); },
    { deadlineMilliseconds: 5_000, leaseUntilEpochMs: Date.now() + 1_200, gate });
  const rejected = assert.rejects(result, errorCode("PDF_IO_DEADLINE"));
  await flush(); await vi.advanceTimersByTimeAsync(699); assert.equal(received?.aborted, false);
  await vi.advanceTimersByTimeAsync(1); await rejected;
  assert.equal(gate.activeCount, 0); assert.equal(gate.pendingCount, 0);
});

test("exhausted lease and pre-aborted caller never enter callback", async () => {
  let calls = 0; const operation = async () => { calls++; }; const controller = new AbortController(); controller.abort();
  await assert.rejects(withColumnPylonSectionIoBudget(operation, { leaseUntilEpochMs: Date.now() + 500 }), errorCode("PDF_IO_DEADLINE"));
  await assert.rejects(withColumnPylonSectionIoBudget(operation, { signal: controller.signal }), errorCode("PDF_IO_CANCELLED"));
  assert.equal(calls, 0);
});

test("caller cancellation retains slot until asynchronous cleanup finishes", async () => {
  const gate = new io.PdfIoAdmissionGate(1, 1); const controller = new AbortController(); let cleaned = false; let settled = false;
  const result = withColumnPylonSectionIoBudget(signal => new Promise<void>(resolve => signal.addEventListener("abort", () => {
    setTimeout(() => { cleaned = true; resolve(); }, 30);
  }, { once: true })), { gate, signal: controller.signal });
  const rejected = assert.rejects(result, errorCode("PDF_IO_CANCELLED")).then(() => { settled = true; });
  await flush(); controller.abort(); await flush(); assert.equal(gate.activeCount, 1); assert.equal(settled, false);
  await vi.advanceTimersByTimeAsync(29); assert.equal(cleaned, false); assert.equal(settled, false);
  await vi.advanceTimersByTimeAsync(1); await rejected; assert.equal(cleaned, true); assert.equal(gate.activeCount, 0);
});

test("deadline also awaits delayed cleanup, rather than racing orphan work", async () => {
  const gate = new io.PdfIoAdmissionGate(1, 1); let cleaned = false; let settled = false;
  const result = withColumnPylonSectionIoBudget(signal => new Promise<void>(resolve => signal.addEventListener("abort", () => {
    setTimeout(() => { cleaned = true; resolve(); }, 40);
  }, { once: true })), { gate, deadlineMilliseconds: 10 });
  const rejected = assert.rejects(result, errorCode("PDF_IO_DEADLINE")).then(() => { settled = true; });
  await flush(); await vi.advanceTimersByTimeAsync(10); assert.equal(settled, false); assert.equal(gate.activeCount, 1);
  await vi.advanceTimersByTimeAsync(39); assert.equal(cleaned, false);
  await vi.advanceTimersByTimeAsync(1); await rejected; assert.equal(cleaned, true); assert.equal(gate.activeCount, 0);
});

test("new and legacy wrappers share process admission: 2 active, 8 waiting, ninth waiting rejected", async () => {
  const controllers = Array.from({ length: 11 }, () => new AbortController()); const started: number[] = [];
  const results = controllers.slice(0, 10).map((controller, index) => {
    const wrapper = index % 2 ? withColumnPylonSectionIoBudget : io.withPdfIoBudget;
    return assert.rejects(wrapper(signal => { started.push(index); return untilAbort(signal); }, { signal: controller.signal }), errorCode("PDF_IO_CANCELLED"));
  });
  await flush(); assert.deepEqual(started, [0, 1]);
  await assert.rejects(withColumnPylonSectionIoBudget(async () => { started.push(10); }, { signal: controllers[10]!.signal }), errorCode("PDF_IO_BUSY"));
  for (const controller of controllers) controller.abort(); await Promise.all(results);
  assert.deepEqual(started, [0, 1]);
  assert.equal(await withColumnPylonSectionIoBudget(async () => "released"), "released");
});

test("queued new deadline removes waiter before any operation; shared gate is reusable", async () => {
  const gate = new io.PdfIoAdmissionGate(1, 1); const release = await gate.acquire(new AbortController().signal); let called = false;
  const result = withColumnPylonSectionIoBudget(async () => { called = true; }, { gate, deadlineMilliseconds: 10 });
  const rejected = assert.rejects(result, errorCode("PDF_IO_DEADLINE")); await flush(); assert.equal(gate.pendingCount, 1);
  await vi.advanceTimersByTimeAsync(10); await rejected; assert.equal(called, false); assert.equal(gate.pendingCount, 0);
  assert.equal(gate.activeCount, 1); release();
  await withColumnPylonSectionIoBudget(async () => {}, { gate }); assert.equal(gate.activeCount, 0);
});

test("legacy default still aborts at 20 seconds", async () => {
  let received: AbortSignal | undefined;
  const result = io.withPdfIoBudget(signal => { received = signal; return untilAbort(signal); });
  const rejected = assert.rejects(result, errorCode("PDF_IO_DEADLINE")); await flush();
  await vi.advanceTimersByTimeAsync(19_999); assert.equal(received?.aborted, false);
  await vi.advanceTimersByTimeAsync(1); await rejected;
});

test("callback failure releases admission and timer", async () => {
  const gate = new io.PdfIoAdmissionGate(1, 1);
  await assert.rejects(withColumnPylonSectionIoBudget(async () => { throw new Error("authored bounded failure"); }, { gate }), /authored bounded failure/);
  assert.equal(gate.activeCount, 0); assert.equal(gate.pendingCount, 0);
});
