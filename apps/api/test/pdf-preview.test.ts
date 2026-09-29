import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseNormalizedCrop, PdfPreviewError, renderVerifiedPdfPage } from "../src/pdf-preview.js";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngDimensions(image: Buffer): [number, number] {
  expect(image.subarray(0, 8)).toEqual(pngSignature);
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

function pngPixel(image: Buffer, x: number, y: number): [number, number, number] {
  const [width, height] = pngDimensions(image);
  expect(x).toBeLessThan(width);
  expect(y).toBeLessThan(height);
  expect(image[24]).toBe(8);
  expect(image[25]).toBe(2); // Poppler RGB PNG
  const idat: Buffer[] = [];
  for (let offset = 8; offset < image.length;) {
    const length = image.readUInt32BE(offset);
    const type = image.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(image.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  let previous = Buffer.alloc(stride);
  let rowOffset = 0;
  for (let rowIndex = 0; rowIndex <= y; rowIndex += 1) {
    const filter = raw[rowOffset];
    const row = Buffer.from(raw.subarray(rowOffset + 1, rowOffset + 1 + stride));
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 3 ? row[index - 3] : 0;
      const above = previous[index];
      const upperLeft = index >= 3 ? previous[index - 3] : 0;
      const predictor = left + above - upperLeft;
      const distances = [Math.abs(predictor - left), Math.abs(predictor - above), Math.abs(predictor - upperLeft)];
      const paeth = distances[0] <= distances[1] && distances[0] <= distances[2] ? left
        : distances[1] <= distances[2] ? above : upperLeft;
      const correction = [0, left, above, Math.floor((left + above) / 2), paeth][filter];
      if (correction === undefined) throw new Error(`Unsupported PNG filter: ${filter}`);
      row[index] = (row[index] + correction) & 255;
    }
    if (rowIndex === y) return [row[x * 3], row[x * 3 + 1], row[x * 3 + 2]];
    previous = row;
    rowOffset += stride + 1;
  }
  throw new Error("PNG row missing");
}

describe("verified PDF page preview", () => {
  it("renders a page only from matching immutable source bytes", async () => {
    const pdf = await readFile(new URL("./fixtures/valid.pdf", import.meta.url));
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    const image = await renderVerifiedPdfPage(Readable.from(pdf), { byteSize: pdf.byteLength, sha256 }, 1);
    expect(image.subarray(0, 8)).toEqual(pngSignature);
    expect(image.byteLength).toBeGreaterThan(100);
  }, 15_000);

  it("rejects hash mismatch and pages outside the source", async () => {
    const pdf = await readFile(new URL("./fixtures/valid.pdf", import.meta.url));
    await expect(renderVerifiedPdfPage(
      Readable.from(pdf), { byteSize: pdf.byteLength, sha256: "0".repeat(64) }, 1,
    )).rejects.toMatchObject({ code: "SOURCE_INTEGRITY_ERROR" } satisfies Partial<PdfPreviewError>);
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    await expect(renderVerifiedPdfPage(
      Readable.from(pdf), { byteSize: pdf.byteLength, sha256 }, 2,
    )).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" } satisfies Partial<PdfPreviewError>);
  });

  it("bounds concurrent PDF renders", async () => {
    const first = new Readable({ read() { /* hold a renderer slot */ } });
    const second = new Readable({ read() { /* hold a renderer slot */ } });
    const expected = { byteSize: 1, sha256: "a".repeat(64) };
    const firstRender = renderVerifiedPdfPage(first, expected, 1);
    const secondRender = renderVerifiedPdfPage(second, expected, 1);
    try {
      await expect(renderVerifiedPdfPage(
        Readable.from(Buffer.from("x")), expected, 1,
      )).rejects.toMatchObject({ status: 429, code: "PREVIEW_BUSY" } satisfies Partial<PdfPreviewError>);
    } finally {
      first.destroy();
      second.destroy();
      await Promise.allSettled([firstRender, secondRender]);
    }
  });

  it("rejects malformed and out-of-bounds normalized crops", () => {
    expect(parseNormalizedCrop(undefined)).toBeUndefined();
    expect(parseNormalizedCrop("0,0,1,1")).toEqual([0, 0, 1, 1]);
    for (const value of ["", "0,0,1", "-0.1,0,1,1", "0,0,1.001,1", "0,0,0,1", "0,1,1,0", "NaN,0,1,1", "0e0,0,1,1", "0,0,1,1,0", "0.1234567,0,1,1"]) {
      expect(() => parseNormalizedCrop(value)).toThrowError(PdfPreviewError);
    }
  });

  it("renders a bounded crop in displayed coordinates on a rotated PDF", async () => {
    const pdf = await readFile(new URL("./fixtures/rotated.pdf", import.meta.url));
    const expected = { byteSize: pdf.byteLength, sha256: createHash("sha256").update(pdf).digest("hex") };
    const crop = parseNormalizedCrop("0.72,0.06,0.76,0.10");
    const image = await renderVerifiedPdfPage(Readable.from(pdf), expected, 1, crop);
    const [width, height] = pngDimensions(image);
    expect(width).toBeGreaterThan(50);
    expect(height).toBeGreaterThan(50);
    expect(width).toBeLessThanOrEqual(1600);
    expect(height).toBeLessThanOrEqual(1600);
    const center = pngPixel(image, Math.floor(width / 2), Math.floor(height / 2));
    expect(center[0]).toBeGreaterThan(220);
    expect(center[1]).toBeLessThan(50);
    expect(center[2]).toBeLessThan(50);
    await expect(renderVerifiedPdfPage(Readable.from(pdf), { ...expected, sha256: "0".repeat(64) }, 1, crop))
      .rejects.toMatchObject({ code: "SOURCE_INTEGRITY_ERROR" } satisfies Partial<PdfPreviewError>);
  }, 15_000);

  it("expands the short side of a tall proposal to a near-square crop", async () => {
    const pdf = await readFile(new URL("./fixtures/valid.pdf", import.meta.url));
    const expected = { byteSize: pdf.byteLength, sha256: createHash("sha256").update(pdf).digest("hex") };
    const bbox = parseNormalizedCrop("0.358,0.305,0.363,0.440");
    const image = await renderVerifiedPdfPage(Readable.from(pdf), expected, 1, bbox);
    const [width, height] = pngDimensions(image);
    expect(width / height).toBeGreaterThan(0.97);
    expect(width / height).toBeLessThan(1.03);
    expect(width).toBeLessThanOrEqual(1600);
    expect(height).toBeLessThanOrEqual(1600);

    const rotated = await readFile(new URL("./fixtures/rotated.pdf", import.meta.url));
    const impossible = await renderVerifiedPdfPage(Readable.from(rotated), {
      byteSize: rotated.byteLength, sha256: createHash("sha256").update(rotated).digest("hex"),
    }, 1, parseNormalizedCrop("0.30,0.10,0.31,0.99"));
    const [boundedWidth, boundedHeight] = pngDimensions(impossible);
    expect(boundedWidth / boundedHeight).toBeGreaterThan(0.45);
    expect(boundedWidth / boundedHeight).toBeLessThan(0.55);
    expect(boundedWidth).toBeLessThanOrEqual(1600);
    expect(boundedHeight).toBeLessThanOrEqual(1600);
  }, 15_000);

  it("keeps a long text-line proposal as a narrow readable strip", async () => {
    const pdf = await readFile(new URL("./fixtures/valid.pdf", import.meta.url));
    const expected = { byteSize: pdf.byteLength, sha256: createHash("sha256").update(pdf).digest("hex") };
    const image = await renderVerifiedPdfPage(Readable.from(pdf), expected, 1,
      parseNormalizedCrop("0.18,0.40,0.78,0.42"));
    const [width, height] = pngDimensions(image);
    expect(width / height).toBeGreaterThan(3);
    expect(width).toBeLessThanOrEqual(1600);
    expect(height).toBeLessThanOrEqual(1600);
  }, 15_000);
});
