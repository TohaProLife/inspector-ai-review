import assert from "node:assert/strict";
import { test } from "vitest";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { getEventListeners } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { fstat } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalObjectStorage, type ObjectStorage } from "../src/storage.js";
import { PDF_IO_LIMITS, PdfIoAdmissionGate, PdfIoError, verifyOriginalPdfSet, withPdfIoBudget,
  type OriginalPdfReference } from "../src/verified-pdf-io.js";

const bytes = Buffer.from("%PDF-1.7\nSYNTHETIC ONLY PDF IO\n");
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const reference = (value = bytes, key = "authored.pdf"): OriginalPdfReference => ({ storageKey: key,
  expectedSha256: sha(value), expectedByteSize: value.length, expectedMediaType: "application/pdf" });
const code = (expected: string) => (error: unknown) => error instanceof PdfIoError && error.code === expected;
function storage(getFile: ObjectStorage["getFile"]): ObjectStorage { return { getFile, async putFile() { throw new Error("Unexpected write"); } }; }
function source(value = bytes, overrides: Record<string, unknown> = {}) {
  const body = Readable.from([value.subarray(0, 2), value.subarray(2, 4), value.subarray(4)]);
  return { body, size: value.length, contentType: "application/pdf", ...overrides };
}
test("split signature exact SHA/size receipt; strict read-only options; resources closed", async () => {
  const controller = new AbortController(); const body = source(); let calls = 0;
  const receipts = await verifyOriginalPdfSet({ storage: storage(async (key, options) => {
    calls++; assert.equal(key, "authored.pdf"); assert.equal(options?.readOnly, true);
    assert.equal(options?.signal, controller.signal); return body;
  }), references: [reference()], signal: controller.signal });
  assert.deepEqual(receipts, [{ storageKey: "authored.pdf", sha256: sha(bytes), byteSize: bytes.length }]);
  assert.equal(calls, 1); assert.equal(body.body.closed, true);
  assert.equal(Object.isFrozen(receipts), true); assert.equal(Object.isFrozen(receipts[0]), true);
});
for (const [name, value, overrides, expected] of [
  ["wrong SHA", Buffer.from(bytes.toString().replace("SYNTHETIC", "ALTEREDXX")), {}, "PDF_BYTES_MISMATCH"],
  ["truncated", bytes.subarray(0, -1), { size: bytes.length }, "PDF_BYTES_MISMATCH"],
  ["oversize", Buffer.concat([bytes, Buffer.from("x")]), { size: bytes.length }, "PDF_STREAM_OVERSIZE"],
  ["metadata size", bytes, { size: bytes.length + 1 }, "PDF_METADATA_MISMATCH"],
  ["media", bytes, { contentType: "text/plain" }, "PDF_METADATA_MISMATCH"],
  ["empty media", bytes, { contentType: "" }, "PDF_METADATA_MISMATCH"],
] as const) {
  test(`${name} closes before failure and never starts next source`, async () => {
    const supplied = source(value, overrides); let calls = 0;
    await assert.rejects(verifyOriginalPdfSet({ storage: storage(async () => { calls++; return supplied; }),
      references: [reference(), reference(bytes, "never.pdf")], signal: new AbortController().signal }), code(expected));
    assert.equal(calls, 1); assert.equal(supplied.body.closed, true);
  });
}
test("same SHA/size with non-PDF prefix still rejects signature", async () => {
  const notPdf = Buffer.from("WRONG\nSYNTHETIC ONLY\n"); const supplied = source(notPdf);
  await assert.rejects(verifyOriginalPdfSet({ storage: storage(async () => supplied),
    references: [reference(notPdf)], signal: new AbortController().signal }), code("PDF_SIGNATURE_MISMATCH"));
  assert.equal(supplied.body.closed, true);
});
test("signature compares literal bytes; high-bit ASCII masking cannot pass", async () => {
  const notPdf = Buffer.concat([Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad]), bytes.subarray(5)]);
  assert.equal(notPdf.subarray(0, 5).toString("ascii"), "%PDF-");
  const supplied = source(notPdf);
  await assert.rejects(verifyOriginalPdfSet({ storage: storage(async () => supplied),
    references: [reference(notPdf)], signal: new AbortController().signal }), code("PDF_SIGNATURE_MISMATCH"));
  assert.equal(supplied.body.closed, true);
});
test("exact reference dedupe, no cross-invocation cache", async () => {
  let calls = 0; const adapter = storage(async () => { calls++; return source(); });
  for (let i = 0; i < 2; i++) assert.equal((await verifyOriginalPdfSet({ storage: adapter,
    references: [reference(), reference()], signal: new AbortController().signal })).length, 1);
  assert.equal(calls, 2);
});
test("all reference/aggregate budgets reject before storage I/O", async () => {
  let calls = 0; const adapter = storage(async () => { calls++; return source(); });
  const run = (references: OriginalPdfReference[]) => verifyOriginalPdfSet({ storage: adapter, references, signal: new AbortController().signal });
  await assert.rejects(run(Array.from({ length: 65 }, (_, i) => reference(bytes, String(i)))), code("PDF_IO_LIMIT"));
  await assert.rejects(run(Array.from({ length: 3 }, (_, i) => ({ ...reference(bytes, String(i)), expectedByteSize: PDF_IO_LIMITS.perPdfBytes }))), code("PDF_IO_LIMIT"));
  for (const mutation of [{ expectedByteSize: 4 }, { expectedByteSize: 1.5 }, { expectedSha256: "x" },
    { expectedSha256: `${"a".repeat(64)}\n` }, { storageKey: "" },
    { expectedMediaType: "text/plain" }, { expectedByteSize: PDF_IO_LIMITS.perPdfBytes + 1 }]) {
    await assert.rejects(run([{ ...reference(), ...mutation } as OriginalPdfReference]), code("PDF_REFERENCE_INVALID"));
  }
  assert.equal(calls, 0);
});
test("pre-abort never opens storage; sensitive SDK errors are not exposed", async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  const adapter = storage(async () => { calls++; throw new Error("https://secret.invalid/?token=private"); });
  await assert.rejects(verifyOriginalPdfSet({ storage: adapter, references: [reference()], signal: controller.signal }), code("PDF_IO_CANCELLED"));
  assert.equal(calls, 0);
  await assert.rejects(verifyOriginalPdfSet({ storage: adapter, references: [reference()], signal: new AbortController().signal }), error => {
    assert.equal((error as Error).message, "PDF_STORAGE_UNAVAILABLE");
    assert.equal("cause" in (error as Error), false);
    assert.equal(JSON.stringify(error).includes("private"), false);
    return true;
  });
});
test("deadline awaits slow native body close; no orphan pipeline", async () => {
  let cleaned = false; const body = new Readable({ read() {}, destroy(error, callback) {
    setTimeout(() => { cleaned = true; callback(error); }, 12);
  } });
  const gate = new PdfIoAdmissionGate(1, 1);
  await assert.rejects(withPdfIoBudget(signal => verifyOriginalPdfSet({ storage: storage(async () => ({ body, size: bytes.length })),
    references: [reference()], signal }), { deadlineMilliseconds: 15, gate }), code("PDF_IO_DEADLINE"));
  assert.equal(cleaned, true); assert.equal(body.closed, true); assert.equal(gate.activeCount, 0);
});
test("caller abort during actual local streaming closes actual descriptor before rejection", async () => {
  const root = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), "research-verify-local-"));
  try {
    const large = Buffer.alloc(2 * 1024 * 1024, 65); bytes.copy(large);
    await writeFile(join(root, "authored.pdf"), large);
    const local = new LocalObjectStorage(root); const controller = new AbortController(); let fd = -1; let body: Readable | undefined;
    const adapter = storage(async (key, options) => {
      const supplied = await local.getFile(key, options); body = supplied.body;
      fd = (body as Readable & { fd: number }).fd!;
      body.once("data", () => controller.abort()); return supplied;
    });
    await assert.rejects(withPdfIoBudget(signal => verifyOriginalPdfSet({ storage: adapter,
      references: [reference(large)], signal }), { signal: controller.signal }), code("PDF_IO_CANCELLED"));
    assert.equal(body?.closed, true);
    await new Promise<void>((resolve, reject) => fstat(fd, error => error?.code === "EBADF" ? resolve() : reject(new Error("Descriptor still open"))));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("admission bounds, abort removes waiter, FIFO and idempotent releases", async () => {
  const gate = new PdfIoAdmissionGate(); const controllers = Array.from({ length: 11 }, () => new AbortController());
  const releaseA = await gate.acquire(controllers[0]!.signal); const releaseB = await gate.acquire(controllers[1]!.signal);
  const waiting = controllers.slice(2, 10).map(item => gate.acquire(item.signal));
  assert.equal(gate.activeCount, 2); assert.equal(gate.pendingCount, 8);
  await assert.rejects(gate.acquire(controllers[10]!.signal), code("PDF_IO_BUSY"));
  const aborted = assert.rejects(waiting[3]!, code("PDF_IO_CANCELLED")); controllers[5]!.abort(); await aborted;
  assert.equal(gate.pendingCount, 7); releaseA(); releaseA();
  const releaseFirst = await waiting[0]!; assert.equal(gate.activeCount, 2); assert.equal(gate.pendingCount, 6);
  releaseFirst(); releaseB();
  for (const [index, item] of waiting.entries()) if (index !== 0 && index !== 3) (await item)();
  assert.equal(gate.activeCount, 0); assert.equal(gate.pendingCount, 0);
  for (const controller of controllers) assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
test("queued deadline removes waiter and never starts operation", async () => {
  const gate = new PdfIoAdmissionGate(1, 1); const release = await gate.acquire(new AbortController().signal); let invoked = false;
  await assert.rejects(withPdfIoBudget(async () => { invoked = true; }, { gate, deadlineMilliseconds: 10 }), code("PDF_IO_DEADLINE"));
  assert.equal(invoked, false); assert.equal(gate.pendingCount, 0); assert.equal(gate.activeCount, 1); release();
});
test("lease reserve rejection and callback failure release admission", async () => {
  const gate = new PdfIoAdmissionGate(1, 1); let invoked = false;
  await assert.rejects(withPdfIoBudget(async () => { invoked = true; }, { gate, leaseUntilEpochMs: Date.now() + 499 }), code("PDF_IO_DEADLINE"));
  assert.equal(invoked, false); assert.equal(gate.activeCount, 0);
  await assert.rejects(withPdfIoBudget(async () => { throw new Error("bounded callback"); }, { gate }), /bounded callback/);
  assert.equal(gate.activeCount, 0); assert.equal(gate.pendingCount, 0);
});
