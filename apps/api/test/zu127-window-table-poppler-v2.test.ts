import { pythonExecutable, pythonEnv, pythonAvailable } from "./python.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { inspectPdfPageWordsWithPoppler,
  type IndependentPdfPageWords } from "../src/poppler-page-words.js";
import { pythonHash } from "../src/trusted-page-words.js";
import { replayZu127WindowTablePopplerV2FromInspections,
  verifyZu127WindowTablePopplerV2 } from "../src/zu127-window-table-poppler-v2.js";

const sha = "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af";
const pdfPath = "/tmp/F0152-public-sha-verified.pdf";
const python = pythonExecutable;
const source = {
  file_id: "F0152", split: "TRAIN_PUBLIC", distribution_status: "INCLUDE",
  label_visibility: "PUBLIC_TRAIN", object_id: "OBJ-TYUMENSKAYA-5-GOLD-SEED",
  sha256: sha, size_bytes: 6_359_136, pdf_pages: 77, stage: "PD", section: "OTHER",
};
const makeWord = (wordIndex: number, rawText: string, x: number, y: number) => ({
  wordIndex, rawText,
  bboxMilliPointsTopLeft: [x, y, x + 20_000, y + 10_000] as [number, number, number, number],
});

function syntheticPages(): IndependentPdfPageWords[] {
  const page = (pageNumber: number, pageText: string,
    cells: Array<[string, number, number]>): IndependentPdfPageWords => {
    const words = cells.map(([text, x, y], index) => makeWord(index, text, x, y));
    const body = { providerId: "api-poppler-pdftotext-bbox-layout-v1@25.12.0",
      sourceSha256: sha, pdfPageCount: 77, pageNumber,
      pageWidthMilliPoints: 595_320, pageHeightMilliPoints: 841_920,
      xmlSha256: "a".repeat(64), plainTextSha256: "b".repeat(64), pageText, words };
    return { ...body, inspectionSha256: pythonHash(body) };
  };
  return [
    page(49, "сопротивление теплопередаче", [
      ["Окна", 300_000, 110_000], ["Витражи", 300_000, 170_000],
      ["0,65", 450_000, 140_000], ["*", 470_050, 140_000],
      ["0,85", 450_000, 200_000], ["**", 470_050, 200_000],
    ]),
    page(51, "сопротивление теплопередаче", [
      ["требуемое", 260_000, 400_000], ["расчётное", 450_000, 400_000],
      ["Окна", 110_000, 440_000], ["Витражи", 110_000, 470_000],
      ["0,50", 260_000, 440_000], ["0,65", 450_000, 440_000],
      ["0,50", 260_000, 470_000], ["0,85", 450_000, 470_000],
    ]),
  ];
}

// Python worker builds fixture from complete synthetic Poppler page words.
const fixtureScript = `import sys,json
from inspector_worker.zu127_window_table_poppler_v2 import _page_proposals,_hash
pages=json.load(sys.stdin)
proposals=[]; receipts=[]
reasons={'REVIEW_ONLY_NOT_TYPED_FACT','SOURCE_ROLE_UNVERIFIED','PD_RD_PAIR_UNVERIFIED','ROW_ASSOCIATION_UNVERIFIED'}
for page in pages:
 words=[]
 for word in page['words']:
  text=word['rawText']
  words.append({'pageNumber':page['pageNumber'],'wordIndex':word['wordIndex'],'rawText':text,'wordTextSha256':__import__('hashlib').sha256(text.encode()).hexdigest(),'bboxMilliPointsTopLeft':word['bboxMilliPointsTopLeft']})
 local,local_reasons=_page_proposals({'words':words,'pageText':page['pageText'],'pageWidthMilliPoints':page['pageWidthMilliPoints']},page['pageNumber'])
 proposals.extend(local); reasons.update(local_reasons)
 receipts.append({'pageNumber':page['pageNumber'],'providerId':'poppler-pdftotext-bbox-layout-v2@25.12.0','pageWidthMilliPoints':page['pageWidthMilliPoints'],'pageHeightMilliPoints':page['pageHeightMilliPoints'],'wordCount':len(words),'wordArtifactSha256':_hash(words),'xmlSha256':page['xmlSha256'],'plainTextSha256':page['plainTextSha256'],'proposalCount':len(local),'reasonCodes':sorted(set(local_reasons))})
result={'schemaVersion':'zu127-window-table-proposals-poppler-v2','profileId':'zu127-window-table-poppler-review-v2','purpose':'REVIEW_ONLY','sourceFileId':'F0152','sourceSha256':'${sha}','sourceObjectId':'OBJ-TYUMENSKAYA-5-GOLD-SEED','selectedPageNumbers':[49,51],'pageReceipts':receipts,'codeRows':[{'parameterCode':'ZU-127','status':'ABSTAIN','reasonCodes':sorted(reasons),'proposalCount':len(proposals),'truncatedProposalCount':max(0,len(proposals)-16),'absenceConclusion':'NOT_AVAILABLE','typedFact':None,'proposals':proposals[:16]}],'findings':None,'findingCount':None,'parameterCoverage':None,'typedFacts':None}
result['contentHash']=_hash(result)
print(json.dumps(result,ensure_ascii=False))`;

test.skipIf(!pythonAvailable)("replays Python synthetic four review-only proposals", () => {
  const pages = syntheticPages();
  const result = JSON.parse(execFileSync(python, ["-c", fixtureScript], {
    input: JSON.stringify(pages), encoding: "utf8",
    env: { ...process.env, ...pythonEnv },
  }));
  assert.equal(result.codeRows[0].proposalCount, 4);
  assert.equal(replayZu127WindowTablePopplerV2FromInspections(source, result, pages), true);
  assert.deepEqual(result.codeRows[0].proposals.map((item: any) => item.rawCellTexts), [
    { resistance: "0,65", footnoteMarker: "*" },
    { resistance: "0,85", footnoteMarker: "**" },
    { required: "0,50", calculated: "0,65" },
    { required: "0,50", calculated: "0,85" },
  ]);
  const tampered = structuredClone(result);
  tampered.codeRows[0].proposalCount = 0;
  const { contentHash: _old, ...body } = tampered;
  tampered.contentHash = pythonHash(body);
  assert.equal(replayZu127WindowTablePopplerV2FromInspections(source, tampered, pages), false);
  const wrongWord = structuredClone(pages);
  wrongWord[0].words[2].rawText = "0,99";
  assert.equal(replayZu127WindowTablePopplerV2FromInspections(source, result, wrongWord), false);
  const wrongVersion = structuredClone(pages);
  wrongVersion[0].providerId = "api-poppler-pdftotext-bbox-layout-v1@99.99.99";
  assert.equal(replayZu127WindowTablePopplerV2FromInspections(source, result, wrongVersion), false);
  const oldPages = structuredClone(pages);
  oldPages.forEach((page) => { page.providerId = "api-poppler-pdftotext-bbox-layout-v1@25.03.0"; });
  const oldResult = structuredClone(result);
  oldResult.pageReceipts.forEach((receipt: any) => {
    receipt.providerId = "poppler-pdftotext-bbox-layout-v2@25.03.0";
  });
  const { contentHash: _oldVersionHash, ...oldVersionBody } = oldResult;
  oldResult.contentHash = pythonHash(oldVersionBody);
  assert.equal(replayZu127WindowTablePopplerV2FromInspections(source, oldResult, oldPages), false);
  const typed = structuredClone(result);
  typed.codeRows[0].typedFact = { value: 0.65 };
  const { contentHash: _typedHash, ...typedBody } = typed;
  typed.contentHash = pythonHash(typedBody);
  assert.equal(replayZu127WindowTablePopplerV2FromInspections(source, typed, pages), false);
});

test.skipIf(!existsSync(pdfPath) || !pythonAvailable)(
  "accepts original F0152 only with independent Poppler 25.12.0 re-extraction", async () => {
    const originalPdfBytes = readFileSync(pdfPath);
    assert.equal(sha256(originalPdfBytes), sha);
    const script = `import json,sys
from pathlib import Path
from inspector_worker.zu127_window_table_poppler_v2 import evaluate_zu127_window_table_poppler_v2
source=${JSON.stringify(source)}
print(json.dumps(evaluate_zu127_window_table_poppler_v2(Path(sys.argv[1]),source,[49,51]),ensure_ascii=False))`;
    const result = JSON.parse(execFileSync(python, ["-c", script, pdfPath], {
      encoding: "utf8", maxBuffer: 1024 * 1024,
      env: { ...process.env, ...pythonEnv },
    }));
    assert.equal(result.codeRows[0].proposalCount, 4);
    assert.equal(result.codeRows[0].status, "ABSTAIN");
    const page = await inspectPdfPageWordsWithPoppler({ originalPdfBytes,
      expectedSourceSha256: sha, expectedPdfPageCount: 77, pageNumber: 49 });
    const pinnedRuntime = page.providerId === "api-poppler-pdftotext-bbox-layout-v1@25.12.0";
    assert.equal(await verifyZu127WindowTablePopplerV2({ originalPdfBytes,
      publicSource: source, result }), pinnedRuntime);
    const original = structuredClone(result);
    original.codeRows[0].proposals = [];
    original.codeRows[0].proposalCount = 0;
    original.pageReceipts[0].proposalCount = 0;
    original.pageReceipts[1].proposalCount = 0;
    const { contentHash: _old, ...body } = original;
    original.contentHash = pythonHash(body);
    assert.equal(await verifyZu127WindowTablePopplerV2({ originalPdfBytes,
      publicSource: source, result: original }), false);
    assert.equal(await verifyZu127WindowTablePopplerV2({ originalPdfBytes,
      publicSource: { ...source, split: "VALIDATION" }, result }), false);
    assert.equal(await verifyZu127WindowTablePopplerV2({ originalPdfBytes,
      publicSource: source, result: { ...result, findings: [] } }), false);
    assert.equal(page.words.length, 135);
    assert.equal(result.pageReceipts[0].xmlSha256, page.xmlSha256);
    assert.equal(result.pageReceipts[0].plainTextSha256, page.plainTextSha256);
  });
