#!/usr/bin/env -S npx tsx
/** Render each saved public candidate's exact PDF page crop through the API renderer. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { renderVerifiedPdfPage, type NormalizedCrop } from "../apps/api/src/pdf-preview.ts";

type Row = Record<string, any>;
const [artifactFile, manifestFile, originalsDir, outputDir] = process.argv.slice(2);
if (!artifactFile || !manifestFile || !originalsDir || !outputDir) {
  throw new Error("usage: tsx scripts/verify-review-candidate-crops.mts ARTIFACT MANIFEST ORIGINALS OUTPUT");
}
const artifact = JSON.parse(await readFile(artifactFile, "utf8")) as Row;
const manifest = new Map<string, Row>((await readFile(manifestFile, "utf8"))
  .split(/\r?\n/u).filter(Boolean).map((line) => {
    const entry = JSON.parse(line) as Row;
    return [entry.file_id, entry];
  }));
if (artifact.resultType !== "REVIEW_CANDIDATE" || !Array.isArray(artifact.candidates)) {
  throw new Error("review candidate artifact is invalid");
}
await mkdir(outputDir, { recursive: true });
const bytesBySource = new Map<string, Buffer>();
const rows: Row[] = [];
for (const [index, candidate] of artifact.candidates.entries()) {
  const id = candidate.sourceFileId as string;
  const entry = manifest.get(id);
  if (!entry || entry.split !== "TRAIN_PUBLIC" || entry.distribution_status !== "INCLUDE"
    || entry.label_visibility !== "PUBLIC_TRAIN" || entry.sha256 !== candidate.sourceSha256) {
    throw new Error(`candidate ${index + 1} is outside the public manifest`);
  }
  let pdf = bytesBySource.get(id);
  if (!pdf) {
    pdf = await readFile(resolve(originalsDir, `${id}.pdf`));
    if (pdf.byteLength !== entry.size_bytes
      || createHash("sha256").update(pdf).digest("hex") !== entry.sha256) {
      throw new Error(`${id} PDF bytes do not match the public manifest`);
    }
    bytesBySource.set(id, pdf);
  }
  const [x0, y0, x1, y1] = candidate.locator.bboxMilliPoints as number[];
  const width = candidate.pageWidthMilliPoints as number;
  const height = candidate.pageHeightMilliPoints as number;
  const crop = [x0 / width, 1 - y1 / height, x1 / width, 1 - y0 / height] as const;
  if (!crop.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    || crop[0] >= crop[2] || crop[1] >= crop[3]) {
    throw new Error(`candidate ${index + 1} has an invalid crop`);
  }
  const png = await renderVerifiedPdfPage(Readable.from(pdf),
    { byteSize: pdf.byteLength, sha256: candidate.sourceSha256 },
    candidate.pageNumber, crop as NormalizedCrop);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`candidate ${index + 1} crop is not PNG`);
  }
  const imageName = `${String(index + 1).padStart(2, "0")}-${id}-${candidate.parameterCode}-p${candidate.pageNumber}.png`;
  await writeFile(resolve(outputDir, imageName), png);
  rows.push({ candidateId: candidate.candidateId, parameterCode: candidate.parameterCode,
    sourceFileId: id, sourceSha256: candidate.sourceSha256,
    pageNumber: candidate.pageNumber, locator: candidate.locator,
    image: imageName, imageSha256: createHash("sha256").update(png).digest("hex"),
    imageWidth: png.readUInt32BE(16), imageHeight: png.readUInt32BE(20) });
}
const report = { schemaVersion: "review-candidate-crop-check-v1",
  artifactSha256: artifact.contentHash, candidateCount: rows.length, rows };
await writeFile(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ candidateCount: rows.length, outputDir }));
