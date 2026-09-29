import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { pythonHash, type PdfWord, type TrustedPageWords } from "../src/trusted-page-words.js";
import { replayPod094ContractCandidates,
  verifyPod094WasteChainAgainstOriginalPdf,
  verifyPod094WasteChainProposals,
  type Pod094WasteChainVerificationInput } from "../src/pod094-waste-chain-proposals.js";

const root = "/home/freetok/Projects/Hackaton";
const python = `${root}/services/worker/.venv/bin/python`;
const manifest = `${root}/datasets/reference_methodology/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ/data/document_manifest.jsonl`;
const originals = {
  F0189: { path: "/tmp/inspector-pod094-F0189.pdf",
    sha: "eae7d1997b49d2302d20d66483f9490ca3fb5e2bb7b465329d9518563e95c7cd" },
  F0071: { path: "/tmp/inspector-pod094-F0071.pdf",
    sha: "a314d845fcb58fc6ac1502fc1fb1672562f419ed36cc8ead88327d374817d327" },
};
const available = existsSync(python) && existsSync(manifest)
  && Object.values(originals).every((item) => existsSync(item.path));
const script = `import fitz,json,hashlib,sys
sys.path.insert(0,'/home/freetok/Projects/Hackaton/services/worker')
from pathlib import Path
from inspector_worker.pod094_waste_chain_proposals import evaluate_pod094_waste_chain_proposals
file_id=sys.argv[1]; path=Path(sys.argv[2]); manifest=Path(sys.argv[3]); source=next(json.loads(row) for row in manifest.read_text().splitlines() if json.loads(row)['file_id']==file_id)
result=evaluate_pod094_waste_chain_proposals(path,source)
doc=fitz.open(path); pages=[]
for page_number in ([99,100] if file_id=='F0189' else [5]):
 page=doc[page_number-1]; words=[]
 for index,raw in enumerate(page.get_text('words',sort=False)):
  raw_text=str(raw[4]); words.append({'pageNumber':page_number,'wordIndex':index,'rawText':raw_text,'wordTextSha256':hashlib.sha256(raw_text.encode()).hexdigest(),'bboxMilliPointsTopLeft':[round(float(value)*1000) for value in raw[:4]]})
 pages.append({'providerId':'api-independent-pdf-words-v1','sourceSha256':source['sha256'],'pdfPageCount':doc.page_count,'pageNumber':page_number,'pageWidthMilliPoints':round(page.rect.width*1000),'pageHeightMilliPoints':round(page.rect.height*1000),'pageText':page.get_text('text'),'words':words})
print(json.dumps({'source':source,'result':result,'pages':pages},ensure_ascii=False))`;
let cached: Record<string, Pod094WasteChainVerificationInput> = {};
function fixture(fileId: keyof typeof originals): Pod094WasteChainVerificationInput {
  if (!cached[fileId]) {
    const original = originals[fileId];
    const bytes = readFileSync(original.path);
    assert.equal(sha256(bytes), original.sha);
    const output = JSON.parse(execFileSync(python,
      ["-c", script, fileId, original.path, manifest],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 }));
    const pages: TrustedPageWords[] = output.pages.map((page: any) => ({
      ...page, inspectionSha256: pythonHash(page),
    }));
    cached[fileId] = { originalPdfBytes: bytes, publicSource: output.source,
      trustedPages: pages, result: output.result };
  }
  const item = cached[fileId];
  return { originalPdfBytes: item.originalPdfBytes,
    publicSource: structuredClone(item.publicSource),
    trustedPages: structuredClone(item.trustedPages),
    result: structuredClone(item.result) };
}
function rehashResult(input: Pod094WasteChainVerificationInput): void {
  const result = input.result as Record<string, unknown>;
  const { contentHash: _old, ...body } = result;
  result.contentHash = pythonHash(body);
}
function rehashPage(page: TrustedPageWords): void {
  const { inspectionSha256: _old, ...body } = page;
  page.inspectionSha256 = pythonHash(body);
}


test("synthetic contract row keeps orientative mass separate from price and transfer", () => {
  const entries: Array<[string, number, number]> = [
    ["Ориентировочный", 388000, 513000], ["(тонн)", 441000, 551000],
    ["Лом", 97000, 567000], ["железобетонных", 120000, 567000],
    ["изделий,", 97000, 579000], ["V", 250000, 580000],
    ["8", 295000, 579000], ["22", 304000, 579000],
    ["301", 318000, 579000], ["01", 337000, 579000],
    ["21", 351000, 579000], ["5", 365000, 579000],
    ["350,00", 420000, 579000], ["55,00", 511000, 585000],
  ];
  const words: PdfWord[] = entries.map(([rawText, x, y], wordIndex) => ({
    pageNumber: 5, wordIndex, rawText, wordTextSha256: sha256(rawText),
    bboxMilliPointsTopLeft: [x, y, x + 10000, y + 10000],
  }));
  const checked = replayPod094ContractCandidates(words);
  assert.equal(checked.proposals.length, 1);
  const row = checked.proposals[0] as any;
  assert.equal(row.quantityRaw, "350,00");
  assert.equal(row.quantitySlots.contractOrientative, "350,00");
  assert.equal(row.quantitySlots.contractLimit, null);
  assert.equal(row.quantitySlots.actualTransfer, null);
  assert.equal(row.roles.excludedPriceCell[0].rawText, "55,00");
  assert.equal(row.typedValues, null);
  assert.equal(replayPod094ContractCandidates([...words, {
    ...words[12], wordIndex: 14, rawText: "351,00",
    wordTextSha256: sha256("351,00") }]).proposals.length, 0);
  assert.equal(replayPod094ContractCandidates(words.filter((word) =>
    word.rawText !== "(тонн)")).proposals.length, 0);
});

test.skipIf(!available)("real F0189/F0071: replay passes but independent full words fail closed", async () => {
  for (const fileId of ["F0189", "F0071"] as const) {
    const input = fixture(fileId);
    assert.equal(verifyPod094WasteChainProposals(input), true);
    const checked = await verifyPod094WasteChainAgainstOriginalPdf(input);
    assert.equal(checked.verified, false);
    assert.equal(checked.reason, "FULL_WORD_BIJECTION_FAILED", JSON.stringify(checked));
    assert.deepEqual(checked.pageComparisons?.map(({ pageNumber, comparison }) =>
      [pageNumber, comparison.reason, comparison.workerWordCount,
        comparison.independentWordCount]), fileId === "F0189"
      ? [[99, "WORD_COUNT_MISMATCH", 422, 423],
        [100, "WORD_COUNT_MISMATCH", 388, 393]]
      : [[5, "WORD_TEXT_OR_BOX_UNMATCHED", 365, 365]]);
    assert.equal((input.result as any).proposalCount, fileId === "F0189" ? 2 : 1);
    assert.equal((input.result as any).status, "ABSTAIN");
    assert.equal((input.result as any).findingCount, null);
    assert.equal((input.result as any).parameterCoverage, null);
    assert.equal((input.result as any).actualTransfer, null);
    assert.equal((input.result as any).contractLimit, null);
  }
}, 180_000);

test.skipIf(!available)("rejects source mix, hidden split, incomplete page, and rehashed result promotion", () => {
  const changes: Array<(input: Pod094WasteChainVerificationInput) => void> = [
    (input) => { input.publicSource.split = "TEST_HIDDEN"; },
    (input) => { input.publicSource.object_id = "OBJ-OTHER"; },
    (input) => { input.publicSource.stage = "RD"; },
    (input) => { input.publicSource.sha256 = "0".repeat(64); },
    (input) => { input.publicSource.size_bytes += 1; },
    (input) => { input.originalPdfBytes = Buffer.from("%PDF-other"); },
    (input) => { input.trustedPages.pop(); },
    (input) => { input.trustedPages[1].words.pop(); rehashPage(input.trustedPages[1]); },
    (input) => { (input.result as any).proposalCount = 0; },
    (input) => { (input.result as any).proposals = []; },
    (input) => { (input.result as any).actualTransfer = "259,875"; },
    (input) => { (input.result as any).contractLimit = "259,875"; },
    (input) => { (input.result as any).findingCount = 0; },
    (input) => { (input.result as any).parameterCoverage = "COMPLETE"; },
    (input) => { (input.result as any).status = "PASS"; },
    (input) => { (input.result as any).proposals[0].quantitySlots.actualTransfer = "259,875"; },
    (input) => { (input.result as any).proposals[0].roles.quantity[0].rawText = "0"; },
    (input) => { (input.result as any).scannedPages[0].wordCount = 0; },
  ];
  for (const [index, change] of changes.entries()) {
    const input = fixture("F0189"); change(input); rehashResult(input);
    assert.equal(verifyPod094WasteChainProposals(input), false, `tamper ${index}`);
  }
  const crossObject = fixture("F0189");
  crossObject.trustedPages = fixture("F0071").trustedPages;
  assert.equal(verifyPod094WasteChainProposals(crossObject), false);
}, 180_000);

test.skipIf(!available)("contract price stays outside quantity and limit/transfer remain null", () => {
  const input = fixture("F0071");
  assert.equal(verifyPod094WasteChainProposals(input), true);
  const proposal = (input.result as any).proposals[0];
  assert.equal(proposal.quantityRaw, "350,00");
  assert.equal(proposal.quantitySlots.contractOrientative, "350,00");
  assert.equal(proposal.quantitySlots.contractLimit, null);
  assert.equal(proposal.quantitySlots.actualTransfer, null);
  assert.equal(proposal.roles.excludedPriceCell[0].rawText, "55,00");
  assert.equal(proposal.typedValues, null);
  const modified = fixture("F0071");
  (modified.result as any).proposals[0].quantityRaw = "55,00";
  rehashResult(modified);
  assert.equal(verifyPod094WasteChainProposals(modified), false);
}, 180_000);
