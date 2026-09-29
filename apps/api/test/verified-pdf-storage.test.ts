import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { ObjectStorage } from "../src/storage.js";
import { readVerifiedOriginalPdf } from "../src/verified-pdf-storage.js";

const pdf = Buffer.from("%PDF-1.7\nsynthetic bounded source\n");
const sha = createHash("sha256").update(pdf).digest("hex");
const storage = (chunks: Buffer[], size = pdf.length, contentType?: string): ObjectStorage => ({
  putFile: async () => {},
  getFile: async () => ({ body: Readable.from(chunks), size, contentType }),
});
const read = (store: ObjectStorage, expectedSha256 = sha, expectedByteSize = pdf.length) =>
  readVerifiedOriginalPdf({ storage: store, storageKey: "objects/verified-public.pdf",
    expectedSha256, expectedByteSize, expectedMediaType: "application/pdf" });

describe("bounded original PDF storage reader", () => {
  it("accepts only complete bytes matching DB-owned SHA and size", async () => {
    expect(await read(storage([pdf.subarray(0, 8), pdf.subarray(8)], pdf.length,
      "application/pdf"))).toEqual(pdf);
  });

  it("rejects metadata, stream truncation, oversized stream and SHA tampering", async () => {
    await expect(read(storage([pdf], pdf.length + 1))).rejects.toThrow("metadata mismatch");
    await expect(read(storage([pdf.subarray(0, 8)]))).rejects.toThrow("bytes differ");
    await expect(read(storage([pdf, Buffer.from("extra")]))).rejects.toThrow("exceeds");
    await expect(read(storage([pdf], pdf.length, "text/plain"))).rejects.toThrow("metadata mismatch");
    await expect(read(storage([pdf]), "0".repeat(64))).rejects.toThrow("bytes differ");
  });

  it("rejects non-PDF bytes and invalid DB reference before accepting them", async () => {
    const wrong = Buffer.from("HELLO-1.7\nsynthetic bounded source\n");
    const wrongSha = createHash("sha256").update(wrong).digest("hex");
    await expect(read(storage([wrong], wrong.length), wrongSha, wrong.length))
      .rejects.toThrow("PDF signature");
    await expect(readVerifiedOriginalPdf({ storage: storage([pdf]), storageKey: "",
      expectedSha256: sha, expectedByteSize: pdf.length,
      expectedMediaType: "application/pdf" })).rejects.toThrow("outside verified bounds");
  });
});
