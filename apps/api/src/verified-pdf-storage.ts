import { createHash } from "node:crypto";
import type { ObjectStorage } from "./storage.js";

const MAX_PDF_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;

/** Read API-owned object storage bytes selected by an authenticated DB reference. */
export async function readVerifiedOriginalPdf(input: {
  storage: ObjectStorage;
  storageKey: string;
  expectedSha256: string;
  expectedByteSize: number;
  expectedMediaType: "application/pdf";
}): Promise<Buffer> {
  const { storage, storageKey, expectedSha256, expectedByteSize } = input;
  if (!storage || typeof storage.getFile !== "function"
    || typeof storageKey !== "string" || !storageKey
    || !SHA256.test(expectedSha256)
    || !Number.isSafeInteger(expectedByteSize)
    || expectedByteSize < 5 || expectedByteSize > MAX_PDF_BYTES
    || input.expectedMediaType !== "application/pdf") {
    throw new Error("PDF storage reference outside verified bounds");
  }
  const stored = await storage.getFile(storageKey);
  if (!Number.isSafeInteger(stored.size) || stored.size !== expectedByteSize
    || stored.contentType && stored.contentType !== "application/pdf") {
    stored.body.destroy();
    throw new Error("PDF storage metadata mismatch");
  }
  const parts: Buffer[] = [];
  const digest = createHash("sha256");
  let bytesRead = 0;
  try {
    for await (const chunk of stored.body) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += part.length;
      if (bytesRead > expectedByteSize || bytesRead > MAX_PDF_BYTES) {
        throw new Error("PDF storage stream exceeds committed size");
      }
      parts.push(part);
      digest.update(part);
    }
  } finally {
    stored.body.destroy();
  }
  if (bytesRead !== expectedByteSize || digest.digest("hex") !== expectedSha256) {
    throw new Error("PDF storage bytes differ from committed source");
  }
  const bytes = Buffer.concat(parts, bytesRead);
  if (bytes.toString("ascii", 0, 5) !== "%PDF-") {
    throw new Error("PDF storage object has no PDF signature");
  }
  return bytes;
}
