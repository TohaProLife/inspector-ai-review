import assert from "node:assert/strict";
import { vi, test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { pythonHash } from "../src/trusted-page-words.js";
import { verifyPopplerPageEvidenceAgainstOriginalPdf } from "../src/poppler-page-evidence.js";

const poppler = vi.hoisted(() => ({
  wrongVersion: false, shortList: false, pdfWarning: false, calls: 0,
}));

const xml = `<html><body><page width="595.320000" height="841.920000">
<word xMin="450.220000" yMin="147.297320" xMax="467.800000" yMax="156.261320">0,65</word>
<word xMin="467.860000" yMin="146.194160" xMax="471.100000" yMax="152.026160">*</word>
</page></body></html>`;
const shortXml = xml.replace(/<word xMin="467.860000"[^>]+>\*<\/word>/u, "");
const plain = "Тест страницы\n";
const pdf = Buffer.from("%PDF-synthetic page receipt", "utf8");
const pdfSha = sha256(pdf);

vi.mock("node:child_process", () => ({
  execFile: (program: string, args: string[], _options: unknown,
    callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void) => {
    poppler.calls += 1;
    if (args[0] === "-v") {
      const version = program === "pdfinfo" && poppler.wrongVersion ? "25.03.0" : "25.12.0";
      callback(null, Buffer.alloc(0), Buffer.from(
        `${program} version ${version}\nCopyright Poppler\n`));
    } else if (program === "pdfinfo") {
      callback(null, Buffer.from("Pages: 2\nEncrypted: no\n"),
        Buffer.from(poppler.pdfWarning ? "Syntax Warning" : ""));
    } else if (args.includes("-bbox-layout")) {
      callback(null, Buffer.from(poppler.shortList ? shortXml : xml), Buffer.alloc(0));
    } else if (args.includes("-raw")) {
      callback(null, Buffer.from(plain), Buffer.alloc(0));
    } else {
      callback(new Error("unexpected Poppler invocation"), Buffer.alloc(0), Buffer.alloc(0));
    }
  },
}));

function workerResult() {
  const words = [
    { wordIndex: 0, rawText: "0,65",
      bboxMilliPointsTopLeft: [450220, 147297, 467800, 156261] },
    { wordIndex: 1, rawText: "*",
      bboxMilliPointsTopLeft: [467860, 146194, 471100, 152026] },
  ];
  const pageBody = {
    providerId: "worker-poppler-pdftotext-bbox-layout-v1@25.12.0",
    sourceSha256: pdfSha, pdfPageCount: 2, pageNumber: 2,
    pageWidthMilliPoints: 595320, pageHeightMilliPoints: 841920,
    xmlSha256: sha256(xml), plainTextSha256: sha256(plain), pageText: plain,
    words, wordArtifactSha256: pythonHash(words),
  };
  const body = {
    schemaVersion: "poppler-page-evidence-v1", purpose: "REVIEW_ONLY",
    sourceSha256: pdfSha, sourceByteSize: pdf.length, pdfPageCount: 2,
    selectedPageNumbers: [2],
    pageEvidence: [{ ...pageBody, inspectionSha256: pythonHash(pageBody) }],
    absenceConclusion: "NOT_AVAILABLE", typedFacts: null, findings: null,
    parameterCoverage: null,
  };
  return { ...body, contentHash: pythonHash(body) };
}

function input(result: unknown = workerResult()) {
  return { originalPdfBytes: pdf, expectedSourceSha256: pdfSha,
    expectedSourceByteSize: pdf.length, expectedPdfPageCount: 2,
    expectedSelectedPageNumbers: [2], workerResult: result };
}

test("independent original-byte replay matches complete page and canonical hashes", async () => {
  poppler.calls = 0;
  const result = await verifyPopplerPageEvidenceAgainstOriginalPdf(input());
  assert.equal(poppler.calls, 5);
  assert.deepEqual(result, { verified: true,
    providerId: "api-poppler-pdftotext-bbox-layout-v1@25.12.0",
    sourceSha256: pdfSha, selectedPageNumbers: [2], pageWordCounts: [2],
    contentHash: workerResult().contentHash });
});

test("source SHA, size, selected pages, and excessive page list fail before Poppler", async () => {
  poppler.calls = 0;
  const invalid = [
    { ...input(), expectedSourceSha256: "0".repeat(64) },
    { ...input(), expectedSourceByteSize: pdf.length + 1 },
    { ...input(), expectedSelectedPageNumbers: [1] },
    { ...input(), expectedSelectedPageNumbers: [2, 2] },
    { ...input(), expectedSelectedPageNumbers: [1, 2, 3, 4, 5] },
    { ...input(), originalPdfBytes: Buffer.from("%PDF-forged") },
  ];
  for (const item of invalid) {
    await assert.rejects(verifyPopplerPageEvidenceAgainstOriginalPdf(item),
      /source, scope, or review-only/u);
  }
  assert.equal(poppler.calls, 0);
});

test("short full-page list and forged word, page text, or hash fail replay", async () => {
  poppler.shortList = true;
  await assert.rejects(verifyPopplerPageEvidenceAgainstOriginalPdf(input()),
    /differs from independent/u);
  poppler.shortList = false;
  for (const mutate of [
    (packet: ReturnType<typeof workerResult>) => {
      packet.pageEvidence[0].words[0].rawText = "0,85";
    },
    (packet: ReturnType<typeof workerResult>) => {
      packet.pageEvidence[0].pageText = "Подменённый текст";
    },
    (packet: ReturnType<typeof workerResult>) => {
      packet.pageEvidence[0].xmlSha256 = "a".repeat(64);
    },
    (packet: ReturnType<typeof workerResult>) => {
      packet.contentHash = "f".repeat(64);
    },
  ]) {
    const packet = workerResult();
    mutate(packet);
    await assert.rejects(verifyPopplerPageEvidenceAgainstOriginalPdf(input(packet)),
      /differs from independent/u);
  }
});

test("both Poppler versions and PDF warnings are exact fail-closed gates", async () => {
  poppler.wrongVersion = true;
  await assert.rejects(verifyPopplerPageEvidenceAgainstOriginalPdf(input()),
    /requires pdfinfo 25\.12\.0/u);
  poppler.wrongVersion = false;
  poppler.pdfWarning = true;
  await assert.rejects(verifyPopplerPageEvidenceAgainstOriginalPdf(input()),
    /PDF warning/u);
  poppler.pdfWarning = false;
});

test("absence, findings, facts, coverage and extra fields cannot be inserted", async () => {
  for (const mutate of [
    (packet: Record<string, unknown>) => { packet.absenceConclusion = "ABSENT"; },
    (packet: Record<string, unknown>) => { packet.findings = []; },
    (packet: Record<string, unknown>) => { packet.typedFacts = []; },
    (packet: Record<string, unknown>) => { packet.parameterCoverage = {}; },
    (packet: Record<string, unknown>) => { packet.extra = "forged"; },
  ]) {
    const packet: Record<string, unknown> = workerResult();
    mutate(packet);
    await assert.rejects(verifyPopplerPageEvidenceAgainstOriginalPdf(input(packet)));
  }
});
