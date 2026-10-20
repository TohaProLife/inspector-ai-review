import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import type { ObjectStorage } from "./storage.js";

export const PDF_IO_LIMITS = Object.freeze({ perPdfBytes: 64 * 1024 * 1024,
  aggregateDistinctPdfBytes: 128 * 1024 * 1024, distinctSources: 64,
  deadlineMilliseconds: 20_000, leaseReserveMilliseconds: 500,
  activeGroups: 2, waitingGroups: 8 });
const SHA = /^[a-f0-9]{64}$/u;
export type PdfIoErrorCode = "PDF_REFERENCE_INVALID" | "PDF_IO_LIMIT" | "PDF_IO_BUSY"
  | "PDF_IO_DEADLINE" | "PDF_IO_CANCELLED" | "PDF_METADATA_MISMATCH"
  | "PDF_BYTES_MISMATCH" | "PDF_STREAM_OVERSIZE" | "PDF_SIGNATURE_MISMATCH"
  | "PDF_STORAGE_UNAVAILABLE";
/** Safe public error code. No storage key, URL, credentials, SDK error or request body. */
export class PdfIoError extends Error {
  constructor(readonly code: PdfIoErrorCode) { super(code); this.name = "PdfIoError"; }
}
export interface OriginalPdfReference {
  readonly storageKey: string;
  readonly expectedSha256: string;
  readonly expectedByteSize: number;
  readonly expectedMediaType: "application/pdf";
}
/** Internal invocation receipt only. Caller must separately authenticate complete DB references. */
export interface VerifiedOriginalPdfReceipt {
  readonly storageKey: string;
  readonly sha256: string;
  readonly byteSize: number;
}
function abortError(signal: AbortSignal): PdfIoError {
  return signal.reason instanceof PdfIoError && signal.reason.code === "PDF_IO_DEADLINE"
    ? signal.reason : new PdfIoError("PDF_IO_CANCELLED");
}
function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw abortError(signal); }
function validateReference(reference: OriginalPdfReference): void {
  if (!reference || typeof reference.storageKey !== "string" || reference.storageKey.length < 1
    || reference.storageKey.length > 4096 || typeof reference.expectedSha256 !== "string"
    || reference.expectedSha256.length !== 64 || !SHA.test(reference.expectedSha256)
    || !Number.isSafeInteger(reference.expectedByteSize) || reference.expectedByteSize < 5
    || reference.expectedByteSize > PDF_IO_LIMITS.perPdfBytes
    || reference.expectedMediaType !== "application/pdf") throw new PdfIoError("PDF_REFERENCE_INVALID");
}
async function closeReadable(body: Readable): Promise<void> {
  const completion = finished(body, { cleanup: true }).catch(() => {});
  const closed = body.closed ? Promise.resolve() : new Promise<void>(resolve => body.once("close", resolve));
  if (!body.destroyed) body.destroy();
  await completion;
  await closed;
}
async function verifyOne(storage: ObjectStorage, reference: OriginalPdfReference,
  signal: AbortSignal): Promise<VerifiedOriginalPdfReceipt> {
  checkSignal(signal);
  let body: Readable | undefined;
  try {
    const stored = await storage.getFile(reference.storageKey, { readOnly: true, signal });
    if (stored?.body instanceof Readable) body = stored.body;
    checkSignal(signal);
    if (!body || !Number.isSafeInteger(stored.size) || stored.size !== reference.expectedByteSize
      || stored.contentType !== undefined && stored.contentType !== "application/pdf") {
      throw new PdfIoError("PDF_METADATA_MISMATCH");
    }
    let byteSize = 0;
    const signature = Buffer.alloc(5);
    let signatureBytes = 0;
    const digest = createHash("sha256");
    const sink = new Writable({ highWaterMark: 64 * 1024,
      write(chunk: unknown, _encoding, callback) {
        try {
          if (!(chunk instanceof Uint8Array)) throw new PdfIoError("PDF_METADATA_MISMATCH");
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          byteSize += bytes.byteLength;
          if (byteSize > reference.expectedByteSize) throw new PdfIoError("PDF_STREAM_OVERSIZE");
          if (signatureBytes < signature.length) {
            const n = Math.min(signature.length - signatureBytes, bytes.length);
            bytes.copy(signature, signatureBytes, 0, n);
            signatureBytes += n;
          }
          digest.update(bytes);
          callback();
        } catch (error) { callback(error instanceof Error ? error : new PdfIoError("PDF_STORAGE_UNAVAILABLE")); }
      },
    });
    await pipeline(body, sink, { signal });
    checkSignal(signal);
    if (byteSize !== reference.expectedByteSize || digest.digest("hex") !== reference.expectedSha256) {
      throw new PdfIoError("PDF_BYTES_MISMATCH");
    }
    if (signatureBytes !== 5 || !signature.equals(Buffer.from("%PDF-", "ascii"))) throw new PdfIoError("PDF_SIGNATURE_MISMATCH");
    return Object.freeze({ storageKey: reference.storageKey, sha256: reference.expectedSha256, byteSize });
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof PdfIoError) throw error;
    throw new PdfIoError("PDF_STORAGE_UNAVAILABLE");
  } finally {
    if (body) await closeReadable(body);
  }
}
/** Strictly sequential, one native body at a time. No cache across invocations/boundaries. */
export async function verifyOriginalPdfSet(input: { storage: ObjectStorage;
  references: readonly OriginalPdfReference[]; signal: AbortSignal }): Promise<readonly VerifiedOriginalPdfReceipt[]> {
  if (!input || !input.storage || typeof input.storage.getFile !== "function"
    || !(input.signal instanceof AbortSignal) || !Array.isArray(input.references)
    || input.references.length > PDF_IO_LIMITS.distinctSources) throw new PdfIoError("PDF_IO_LIMIT");
  checkSignal(input.signal);
  const unique = new Map<string, OriginalPdfReference>();
  let reservedBytes = 0;
  for (const reference of input.references) {
    validateReference(reference);
    const key = JSON.stringify([reference.storageKey, reference.expectedSha256, reference.expectedByteSize]);
    if (unique.has(key)) continue;
    reservedBytes += reference.expectedByteSize;
    if (reservedBytes > PDF_IO_LIMITS.aggregateDistinctPdfBytes) throw new PdfIoError("PDF_IO_LIMIT");
    unique.set(key, reference);
  }
  const receipts: VerifiedOriginalPdfReceipt[] = [];
  for (const reference of unique.values()) receipts.push(await verifyOne(input.storage, reference, input.signal));
  return Object.freeze(receipts);
}
interface Waiter { signal: AbortSignal; resolve: (release: () => void) => void;
  reject: (error: PdfIoError) => void; onAbort: () => void }
/** Per-process bounded admission; aborted waiters removed rather than raced in background. */
export class PdfIoAdmissionGate {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  constructor(private readonly maxActive: number = PDF_IO_LIMITS.activeGroups,
    private readonly maxWaiting: number = PDF_IO_LIMITS.waitingGroups) {
    if (!Number.isSafeInteger(maxActive) || maxActive < 1 || maxActive > PDF_IO_LIMITS.activeGroups
      || !Number.isSafeInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > PDF_IO_LIMITS.waitingGroups) {
      throw new PdfIoError("PDF_IO_LIMIT");
    }
  }
  get pendingCount(): number { return this.waiting.length; }
  get activeCount(): number { return this.active; }
  acquire(signal: AbortSignal): Promise<() => void> {
    checkSignal(signal);
    if (this.active < this.maxActive) { this.active++; return Promise.resolve(this.makeRelease()); }
    if (this.waiting.length >= this.maxWaiting) return Promise.reject(new PdfIoError("PDF_IO_BUSY"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject, onAbort: () => {
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) this.waiting.splice(index, 1);
        signal.removeEventListener("abort", waiter.onAbort);
        reject(abortError(signal));
      } };
      this.waiting.push(waiter);
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal.aborted) waiter.onAbort();
    });
  }
  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      while (this.waiting.length) {
        const waiter = this.waiting.shift()!;
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        if (waiter.signal.aborted) { waiter.reject(abortError(waiter.signal)); continue; }
        this.active++;
        waiter.resolve(this.makeRelease());
        break;
      }
    };
  }
}
const processAdmissionGate = new PdfIoAdmissionGate();
/** Parent callback must await its operations/cleanup; no orphan work and no Promise.race. */
export async function withPdfIoBudget<T>(operation: (signal: AbortSignal) => Promise<T>, options: {
  signal?: AbortSignal; deadlineMilliseconds?: number; leaseUntilEpochMs?: number; gate?: PdfIoAdmissionGate;
} = {}): Promise<T> {
  return withFixedPdfIoBudget(operation, options, PDF_IO_LIMITS.deadlineMilliseconds);
}

/** Fixed KR060 operation budget; PDF limits and process admission remain shared. */
export async function withColumnPylonSectionIoBudget<T>(operation: (signal: AbortSignal) => Promise<T>, options: {
  signal?: AbortSignal; deadlineMilliseconds?: number; leaseUntilEpochMs?: number; gate?: PdfIoAdmissionGate;
} = {}): Promise<T> {
  return withFixedPdfIoBudget(operation, options, 55_000);
}

async function withFixedPdfIoBudget<T>(operation: (signal: AbortSignal) => Promise<T>, options: {
  signal?: AbortSignal; deadlineMilliseconds?: number; leaseUntilEpochMs?: number; gate?: PdfIoAdmissionGate;
}, maximumDeadlineMilliseconds: number): Promise<T> {
  let deadline = options.deadlineMilliseconds ?? maximumDeadlineMilliseconds;
  if (typeof operation !== "function" || !Number.isSafeInteger(deadline) || deadline < 1
    || deadline > maximumDeadlineMilliseconds
    || options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new PdfIoError("PDF_IO_LIMIT");
  if (options.leaseUntilEpochMs !== undefined) {
    if (!Number.isSafeInteger(options.leaseUntilEpochMs)) throw new PdfIoError("PDF_IO_LIMIT");
    deadline = Math.min(deadline, options.leaseUntilEpochMs - Date.now() - PDF_IO_LIMITS.leaseReserveMilliseconds);
    if (deadline <= 0) throw new PdfIoError("PDF_IO_DEADLINE");
  }
  const timeout = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(new PdfIoError("PDF_IO_DEADLINE")), deadline);
  let release: (() => void) | undefined;
  try {
    release = await (options.gate ?? processAdmissionGate).acquire(signal);
    checkSignal(signal);
    const value = await operation(signal);
    checkSignal(signal);
    return value;
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    clearTimeout(timer);
    release?.();
  }
}
