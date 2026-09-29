import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { compareCompleteWorkerWordsWithPoppler,
  inspectPdfPageWordsWithPoppler, type IndependentPdfPageWords } from "../src/poppler-page-words.js";
import { pythonHash, type TrustedPageWords } from "../src/trusted-page-words.js";
import { comparePz006CompleteWordBijection,
  verifyPz006BuildingLevelsAgainstOriginalPdf,
  verifyPz006BuildingLevelsProposals,
  type Pz006BuildingLevelsVerificationInput } from "../src/pz006-building-levels-proposals.js";

// Generated once by Python worker evaluate_pz006_building_levels_proposals with
// a synthetic page. PDF bytes are a marker, not a parsed PDF. This proves replay
// parity only; runtime must supply words from an independent API-owned parser.
const compressedFixture = "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";

function fixture(): Pz006BuildingLevelsVerificationInput {
  const value = JSON.parse(inflateSync(Buffer.from(compressedFixture, "base64"))
    .toString("utf8"));
  return { originalPdfBytes: Buffer.from(value.pdfBase64, "base64"),
    publicSource: value.source, trustedPage: value.trustedPage, result: value.result };
}

function rehashResult(input: Pz006BuildingLevelsVerificationInput): void {
  const result = input.result as Record<string, unknown>;
  const { contentHash: _old, ...body } = result;
  result.contentHash = pythonHash(body);
}

function rehashPage(input: Pz006BuildingLevelsVerificationInput): void {
  const page = input.trustedPage;
  const { inspectionSha256: _old, ...body } = page;
  page.inspectionSha256 = pythonHash(body);
}

function independentFixture(input: Pz006BuildingLevelsVerificationInput): IndependentPdfPageWords {
  const page = input.trustedPage;
  const body = { providerId: "api-poppler-pdftotext-bbox-layout-v1@25.03.0",
    sourceSha256: page.sourceSha256, pdfPageCount: page.pdfPageCount,
    pageNumber: page.pageNumber, pageWidthMilliPoints: page.pageWidthMilliPoints,
    pageHeightMilliPoints: page.pageHeightMilliPoints,
    xmlSha256: "a".repeat(64), plainTextSha256: "b".repeat(64),
    pageText: page.pageText,
    words: [...page.words].reverse().map((word, index) => ({ wordIndex: index,
      rawText: word.rawText,
      bboxMilliPointsTopLeft: [...word.bboxMilliPointsTopLeft] as [number, number, number, number] })) };
  return { ...body, inspectionSha256: pythonHash(body) };
}

function rehashIndependent(receipt: IndependentPdfPageWords): void {
  const { inspectionSha256: _old, ...body } = receipt;
  receipt.inspectionSha256 = pythonHash(body);
}

test("replays seven Python PZ-006 synthetic proposals, all review-only", () => {
  const input = fixture();
  const result = input.result as any;
  assert.equal(result.contentHash,
    "5a93abde9f293ee642af13e0d979a6f2fba90cc6ae1270bd36bfed342d5a7da1");
  assert.equal(verifyPz006BuildingLevelsProposals(input), true);
  assert.equal(result.proposalCount, 7);
  assert.deepEqual(result.proposals.map((item: any) => item.proposalKind), [
    "FLOOR_COUNT_HEADER", "FLOOR_COUNT_CONTINUATION",
    "CORPUS_FLOOR_COUNT", "CORPUS_FLOOR_COUNT", "VOLUME_TOTAL",
    "VOLUME_UNDERGROUND_PART", "VOLUME_ABOVEGROUND_PART",
  ]);
  assert.equal(result.status, "ABSTAIN");
  assert.equal(result.findingCount, null);
  assert.equal(result.parameterCoverage, null);
  assert.ok(result.proposals.every((item: any) => item.typedFact === null));
  assert.ok(result.reasonCodes.includes("PZ006_CATALOG_TITLE_TRIGGER_CONFLICT"));
  assert.ok(result.reasonCodes.includes("TOTAL_VS_PART_UNIT_CONFLICT"));
});

test("requires original bytes, public manifest and complete independent word artifact", () => {
  const changes: Array<(input: Pz006BuildingLevelsVerificationInput) => void> = [
    (input) => { input.originalPdfBytes = Buffer.from("different"); },
    (input) => { input.publicSource.split = "TEST_HIDDEN"; },
    (input) => { input.publicSource.distribution_status = "EXCLUDE"; },
    (input) => { input.publicSource.label_visibility = "HIDDEN"; },
    (input) => { input.publicSource.file_id = "F9999"; },
    (input) => { input.publicSource.size_bytes += 1; },
    (input) => { input.publicSource.pdf_pages += 1; },
    (input) => { input.trustedPage = undefined as any; },
    (input) => { input.trustedPage.words = []; },
    (input) => { input.trustedPage.providerId = "worker" as any; },
    (input) => { input.trustedPage.words[0].wordIndex = 5; },
    (input) => { input.trustedPage.words[0].rawText = "Иное"; },
    (input) => { input.trustedPage.words[0].bboxMilliPointsTopLeft[0] += 1000; },
  ];
  for (const [index, change] of changes.entries()) {
    const input = fixture(); change(input);
    if (input.trustedPage) rehashPage(input);
    assert.equal(verifyPz006BuildingLevelsProposals(input), false, `input tamper ${index}`);
  }
});

test("rejects rehashed false zero, locator change, unit erasure and fact escalation", () => {
  const changes: Array<(input: Pz006BuildingLevelsVerificationInput) => void> = [
    (input) => { (input.result as any).proposals = []; },
    (input) => { (input.result as any).proposalCount = 0; },
    (input) => { (input.result as any).wordCount = 0; },
    (input) => { (input.result as any).oversizeLineCount = 1; },
    (input) => { (input.result as any).proposals[0].wordLocators[0].wordIndex = 999; },
    (input) => { (input.result as any).proposals[4].rawUnit = "куб. м"; },
    (input) => { (input.result as any).proposals[2].corpusLabelRaw = "9"; },
    (input) => { (input.result as any).proposals[2].typedFact = { floorCount: 19 }; },
    (input) => { (input.result as any).status = "PASS"; },
    (input) => { (input.result as any).findingCount = 0; },
    (input) => { (input.result as any).parameterCoverage = "COMPLETE"; },
  ];
  for (const [index, change] of changes.entries()) {
    const input = fixture(); change(input); rehashResult(input);
    assert.equal(verifyPz006BuildingLevelsProposals(input), false, `result tamper ${index}`);
  }
});

test("unique full-page bijection accepts reordered words, rejects missing, duplicate and ambiguous words", () => {
  const input = fixture();
  const receipt = independentFixture(input);
  assert.deepEqual(comparePz006CompleteWordBijection(input.trustedPage, receipt), {
    equivalent: true, reason: "FULL_UNIQUE_WORD_BIJECTION_MATCH",
    workerWordCount: input.trustedPage.words.length,
    independentWordCount: input.trustedPage.words.length,
  });
  const changes: Array<(page: TrustedPageWords, independent: IndependentPdfPageWords) => void> = [
    (_page, independent) => { independent.words.pop(); },
    (page) => { page.words[1] = { ...page.words[0], wordIndex: 1 }; },
    (_page, independent) => { independent.words[1] = { ...independent.words[0], wordIndex: 1 }; },
    (_page, independent) => { independent.words[0].rawText = "другое"; },
    (_page, independent) => { independent.words[0].bboxMilliPointsTopLeft[0] += 101; },
    (_page, independent) => { independent.pageText = "другая страница"; },
    (_page, independent) => { independent.sourceSha256 = "f".repeat(64); },
    (_page, independent) => { independent.inspectionSha256 = "f".repeat(64); },
  ];
  for (const [index, change] of changes.entries()) {
    const item = fixture(); const altered = independentFixture(item);
    change(item.trustedPage, altered);
    rehashPage(item);
    if (index !== changes.length - 1) rehashIndependent(altered);
    const comparison = comparePz006CompleteWordBijection(item.trustedPage, altered);
    assert.equal(comparison.equivalent, false, `bijection tamper ${index}`);
  }
});

test("worker raw word order is replayed after independent complete bijection", () => {
  const input = fixture();
  const independent = independentFixture(input);
  const first = input.trustedPage.words[0];
  const second = input.trustedPage.words[1];
  input.trustedPage.words[0] = { ...second, wordIndex: 0 };
  input.trustedPage.words[1] = { ...first, wordIndex: 1 };
  rehashPage(input);
  assert.equal(comparePz006CompleteWordBijection(input.trustedPage, independent).equivalent, true);
  assert.equal(verifyPz006BuildingLevelsProposals(input), false);
});

const originalF0101 = "/tmp/inspector-pz006-F0101-public.pdf";
const workerPython = "../../services/worker/.venv/bin/python";
const originalSha = "01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54";

test.skipIf(!existsSync(originalF0101) || !existsSync(workerPython))(
  "original F0101 p9: strict order fails, unique full-word bijection and review replay pass",
  async () => {
    const bytes = readFileSync(originalF0101);
    assert.equal(sha256(bytes), originalSha);
    const source = { file_id: "F0101", object_id: "OBJ-NOVOSLOBODSKAYA",
      split: "TRAIN_PUBLIC", distribution_status: "INCLUDE",
      label_visibility: "PUBLIC_TRAIN", sha256: originalSha,
      size_bytes: 891618, pdf_pages: 13, stage: "PD", section: "OTHER" };
    const script = `import fitz,json,hashlib,sys
sys.path.insert(0,'/home/freetok/Projects/Hackaton/services/worker')
from inspector_worker.pz006_building_levels_proposals import evaluate_pz006_building_levels_proposals
document=fitz.open(sys.argv[1]); page=document[8]; words=[]
for index,raw in enumerate(page.get_text('words',sort=False)):
 text=str(raw[4]); words.append({'pageNumber':9,'wordIndex':index,'rawText':text,
  'wordTextSha256':hashlib.sha256(text.encode()).hexdigest(),
  'bboxMilliPointsTopLeft':[round(float(value)*1000) for value in raw[:4]]})
result=evaluate_pz006_building_levels_proposals(open(sys.argv[1],'rb').read(),json.loads(sys.argv[2]),9)
print(json.dumps({'result':result,'page':{'pdfPageCount':document.page_count,'pageNumber':9,
 'pageWidthMilliPoints':round(page.rect.width*1000),
 'pageHeightMilliPoints':round(page.rect.height*1000),
 'pageText':page.get_text('text'),'words':words}},ensure_ascii=False))`;
    const extracted = JSON.parse(execFileSync(workerPython,
      ["-c", script, originalF0101, JSON.stringify(source)],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
    const worker: TrustedPageWords = { ...extracted.page,
      providerId: "api-independent-pdf-words-v1", sourceSha256: originalSha,
      inspectionSha256: "" };
    const { inspectionSha256: _old, ...body } = worker;
    worker.inspectionSha256 = pythonHash(body);
    const independent = await inspectPdfPageWordsWithPoppler({
      originalPdfBytes: bytes, expectedSourceSha256: originalSha,
      expectedPdfPageCount: 13, pageNumber: 9,
    });
    const comparison = compareCompleteWorkerWordsWithPoppler(worker, independent);
    assert.deepEqual(comparison, { equivalent: false,
      reason: "WORD_ORDER_TEXT_OR_BOX_MISMATCH",
      workerWordCount: 322, independentWordCount: 322 });
    assert.deepEqual(comparePz006CompleteWordBijection(worker, independent), {
      equivalent: true, reason: "FULL_UNIQUE_WORD_BIJECTION_MATCH",
      workerWordCount: 322, independentWordCount: 322,
    });
    const verified = await verifyPz006BuildingLevelsAgainstOriginalPdf({
      originalPdfBytes: bytes, publicSource: source, trustedPage: worker,
      result: extracted.result,
    });
    assert.equal(verified.verified, true);
    assert.equal(verified.reason, "VERIFIED_REVIEW_ONLY");
    assert.equal(extracted.result.proposalCount, 7);
    assert.equal(extracted.result.status, "ABSTAIN");
    assert.equal(extracted.result.typedFact, null);
    assert.equal(extracted.result.findingCount, null);
    assert.equal(extracted.result.parameterCoverage, null);
    // Bijection proves complete text/boxes, not PyMuPDF's wordIndex order.
    // Runtime word artifact is still separately supplied; no durable path uses this gate.
  },
);
