import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { fstat } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getEventListeners } from "node:events";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { LocalObjectStorage, S3ObjectStorage } from "../src/storage.js";

afterEach(() => vi.restoreAllMocks());
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const close = (body: Readable) => body.closed ? Promise.resolve()
  : new Promise<void>(resolve => body.once("close", resolve));
async function consume(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  await close(body);
  return Buffer.concat(chunks);
}
async function closedFd(fd: number): Promise<void> {
  await new Promise<void>((resolve, reject) => fstat(fd, error => {
    if (error?.code === "EBADF") resolve(); else reject(new Error("Actual descriptor still open"));
  }));
}
async function localFixture(operation: (storage: LocalObjectStorage, bytes: Buffer) => Promise<void>) {
  const root = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), "research-io-local-"));
  try {
    const bytes = Buffer.from("%PDF-1.7\nSYNTHETIC ONLY\n");
    await writeFile(join(root, "authored.pdf"), bytes);
    await mkdir(join(root, "directory"));
    await operation(new LocalObjectStorage(root), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
}
function s3() { return new S3ObjectStorage("synthetic-only", {
  endpoint: "http://127.0.0.1:1", accessKey: "synthetic", secretKey: "synthetic",
}); }
function fakeSend(handler: (command: { constructor: { name: string } }, options?: { abortSignal?: AbortSignal }) => Promise<unknown>) {
  vi.spyOn(S3Client.prototype, "send").mockImplementation(handler as unknown as typeof S3Client.prototype.send);
}
function delayedBody(state: { cleaned: boolean }): Readable {
  return new Readable({ read() {}, destroy(error, callback) {
    setTimeout(() => { state.cleaned = true; callback(error); }, 8);
  } });
}

test("local read-only uses opened descriptor size and closes actual fd after success", async () => {
  await localFixture(async (storage, bytes) => {
    const controller = new AbortController();
    const stored = await storage.getFile("authored.pdf", { readOnly: true, signal: controller.signal });
    const fd = (stored.body as Readable & { fd: number }).fd!;
    assert.equal(typeof fd, "number");
    assert.equal(stored.size, bytes.length);
    assert.deepEqual(await consume(stored.body), bytes);
    await closedFd(fd);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});
test("local abort after handoff closes actual fd and removes abort listeners", async () => {
  await localFixture(async storage => {
    const controller = new AbortController();
    const stored = await storage.getFile("authored.pdf", { readOnly: true, signal: controller.signal });
    const fd = (stored.body as Readable & { fd: number }).fd!;
    const closed = close(stored.body);
    controller.abort();
    await closed;
    await closedFd(fd);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
});
test("local missing/directory/escaping keys reject; pre-abort wins before open", async () => {
  await localFixture(async storage => {
    await assert.rejects(storage.getFile("missing.pdf", { readOnly: true }), { code: "ENOENT" });
    await assert.rejects(storage.getFile("directory", { readOnly: true }), /regular file/);
    await assert.rejects(storage.getFile("../outside", { readOnly: true }), /escapes/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(storage.getFile("missing.pdf", { readOnly: true, signal: controller.signal }), { name: "AbortError" });
  });
});
test("legacy local no-options path still consumes same immutable bytes", async () => {
  await localFixture(async (storage, bytes) => {
    const stored = await storage.getFile("authored.pdf");
    assert.equal(stored.size, bytes.length);
    assert.deepEqual(await consume(stored.body), bytes);
  });
});
test("read-only S3 sends only GetObject with exact abortSignal; never bootstraps bucket", async () => {
  const calls: string[] = []; const controller = new AbortController();
  fakeSend(async (command, options) => {
    calls.push(command.constructor.name);
    assert.equal(options?.abortSignal, controller.signal);
    return { Body: Readable.from([Buffer.from("%PDF-")]), ContentLength: 5, ContentType: "application/pdf" };
  });
  const stored = await s3().getFile("authored.pdf", { readOnly: true, signal: controller.signal });
  assert.deepEqual(await consume(stored.body), Buffer.from("%PDF-"));
  assert.deepEqual(calls, ["GetObjectCommand"]);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
test("missing S3 bucket does not create bucket on read-only read", async () => {
  const calls: string[] = [];
  fakeSend(async command => { calls.push(command.constructor.name); throw Object.assign(new Error("NoSuchBucket"), { $metadata: { httpStatusCode: 404 } }); });
  await assert.rejects(s3().getFile("x", { readOnly: true }), /NoSuchBucket/);
  assert.deepEqual(calls, ["GetObjectCommand"]);
});
test("read-only S3 retains explicitly empty content type for verifier rejection", async () => {
  fakeSend(async () => ({ Body: Readable.from([Buffer.from("%PDF-")]), ContentLength: 5, ContentType: "" }));
  const stored = await s3().getFile("x", { readOnly: true });
  assert.equal(stored.contentType, ""); await consume(stored.body);
});
test("pre-aborted S3 read performs no SDK request", async () => {
  let calls = 0; fakeSend(async () => { calls++; throw new Error("Unexpected SDK call"); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(s3().getFile("x", { readOnly: true, signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
});
test("legacy S3 no-options path retains Head/Create/Get sequence", async () => {
  const calls: string[] = [];
  fakeSend(async (command, options) => {
    calls.push(command.constructor.name); assert.equal(options, undefined);
    if (command.constructor.name === "HeadBucketCommand") throw { $metadata: { httpStatusCode: 404 } };
    return { Body: Readable.from([Buffer.from("%PDF-")]), ContentLength: 5 };
  });
  assert.equal((await consume((await s3().getFile("x")).body)).length, 5);
  assert.deepEqual(calls, ["HeadBucketCommand", "CreateBucketCommand", "GetObjectCommand"]);
});
for (const [name, metadata] of Object.entries({ missing: {}, negative: { ContentLength: -1 },
  unsafe: { ContentLength: Number.MAX_SAFE_INTEGER + 1 }, nan: { ContentLength: NaN },
  type: { ContentLength: 5, ContentType: 123 } })) {
  test(`malformed S3 ${name} metadata awaits asynchronous body destruction`, async () => {
    const state = { cleaned: false }; const body = delayedBody(state); const controller = new AbortController();
    fakeSend(async () => ({ Body: body, ...metadata }));
    await assert.rejects(s3().getFile("x", { readOnly: true, signal: controller.signal }), /invalid content metadata/);
    assert.equal(state.cleaned, true); assert.equal(body.closed, true);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
}
test("unexpected S3 web stream is cancelled and awaited", async () => {
  let cancelled = false;
  const body = new ReadableStream({ async cancel() { await pause(8); cancelled = true; } });
  fakeSend(async () => ({ Body: body, ContentLength: 5 }));
  await assert.rejects(s3().getFile("x", { readOnly: true }), /no native readable/);
  assert.equal(cancelled, true);
});
test("S3 SDK abort during request is forwarded and awaited without client destruction", async () => {
  const controller = new AbortController(); let settled = false; const calls: string[] = [];
  const destroy = vi.spyOn(S3Client.prototype, "destroy").mockImplementation(() => {});
  fakeSend(async (command, options) => {
    calls.push(command.constructor.name); assert.equal(options?.abortSignal, controller.signal);
    return await new Promise((_resolve, reject) => options!.abortSignal!.addEventListener("abort", () => {
      setTimeout(() => { settled = true; reject(new DOMException("fake SDK aborted", "AbortError")); }, 8);
    }, { once: true }));
  });
  const reading = s3().getFile("x", { readOnly: true, signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, { name: "AbortError" });
  assert.equal(settled, true); assert.deepEqual(calls, ["GetObjectCommand"]);
  assert.equal(destroy.mock.calls.length, 0);
});
test("SDK late body after cancellation is closed before rejection", async () => {
  const state = { cleaned: false }; const body = delayedBody(state); const controller = new AbortController();
  fakeSend(async () => { await pause(8); return { Body: body, ContentLength: 5 }; });
  const reading = s3().getFile("x", { readOnly: true, signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, { name: "AbortError" });
  assert.equal(body.closed, true); assert.equal(state.cleaned, true);
});
test("S3 post-handoff abort closes body with observed error, no consumer required", async () => {
  const state = { cleaned: false }; const body = delayedBody(state); const controller = new AbortController();
  fakeSend(async () => ({ Body: body, ContentLength: 5 }));
  await s3().getFile("x", { readOnly: true, signal: controller.signal });
  const completion = finished(body).catch(() => {}); const closed = close(body);
  controller.abort(); await completion; await closed;
  assert.equal(state.cleaned, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
