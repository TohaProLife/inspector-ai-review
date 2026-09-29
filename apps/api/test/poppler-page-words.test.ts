import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { compareCompleteWorkerWordsWithPoppler,
  inspectPdfPageWordsWithPoppler, parsePopplerPageWordsXml,
  verifyCompleteWorkerWordsAgainstOriginalPdf } from "../src/poppler-page-words.js";
import { pythonHash, type TrustedPageWords } from "../src/trusted-page-words.js";

const publicPath = "/tmp/F0152-public-sha-verified.pdf";
const publicSha = "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af";

test("parses all words from one XML page and rejects incomplete or duplicate pages", () => {
  const xml = `<?xml version="1.0"?><doc><page width="600.000000" height="800.000000">
    <word xMin="10.000000" yMin="20.000000" xMax="30.000000" yMax="40.000000">Окна</word>
    <word xMin="40.000000" yMin="20.000000" xMax="60.000000" yMax="40.000000">0,65&amp;*</word>
    </page></doc>`;
  assert.deepEqual(parsePopplerPageWordsXml(xml), {
    pageWidthMilliPoints: 600000, pageHeightMilliPoints: 800000,
    words: [
      { wordIndex: 0, rawText: "Окна", bboxMilliPointsTopLeft: [10000, 20000, 30000, 40000] },
      { wordIndex: 1, rawText: "0,65&*", bboxMilliPointsTopLeft: [40000, 20000, 60000, 40000] },
    ],
  });
  assert.throws(() => parsePopplerPageWordsXml(xml.replace("</doc>",
    '<page width="600" height="800"/></doc>')), /multiple pages/u);
  assert.throws(() => parsePopplerPageWordsXml(xml.replace("</page>", "")));
  assert.throws(() => parsePopplerPageWordsXml(xml.replace("</page>",
    '</page><word xMin="1" yMin="1" xMax="2" yMax="2">forged</word>')),
  /outside page/u);
  assert.throws(() => parsePopplerPageWordsXml(xml.replace("30.000000", "700.000000")),
    /outside page box/u);
});

test.skipIf(!existsSync(publicPath))("Poppler owns complete original F0152 p49/p51 word receipts", async () => {
  const originalPdfBytes = readFileSync(publicPath);
  assert.equal(sha256(originalPdfBytes), publicSha);
  for (const pageNumber of [49, 51]) {
    const receipt = await inspectPdfPageWordsWithPoppler({ originalPdfBytes,
      expectedSourceSha256: publicSha, expectedPdfPageCount: 77, pageNumber });
    assert.match(receipt.providerId, /^api-poppler-pdftotext-bbox-layout-v1@\d+\.\d+\.\d+$/u);
    assert.equal(receipt.sourceSha256, publicSha);
    assert.ok(receipt.words.length > 50);
    assert.equal(receipt.words.every((word, index) => word.wordIndex === index), true);
    const { inspectionSha256: _hash, ...body } = receipt;
    assert.equal(receipt.inspectionSha256, pythonHash(body));
  }
  await assert.rejects(inspectPdfPageWordsWithPoppler({ originalPdfBytes,
    expectedSourceSha256: "f".repeat(64), expectedPdfPageCount: 77, pageNumber: 49 }),
  /SHA mismatch/u);
  await assert.rejects(inspectPdfPageWordsWithPoppler({ originalPdfBytes,
    expectedSourceSha256: publicSha, expectedPdfPageCount: 76, pageNumber: 49 }),
  /page count/u);
});

test.skipIf(!existsSync(publicPath))("original F0152 PyMuPDF words fail closed against full Poppler words", async () => {
  const originalPdfBytes = readFileSync(publicPath);
  assert.equal(sha256(originalPdfBytes), publicSha);
  const python = "services/worker/.venv/bin/python";
  if (!existsSync(python)) return;
  const script = `import fitz,json,hashlib,sys
p=fitz.open(sys.argv[1]); n=int(sys.argv[2]); page=p[n-1]
words=[]
for i,w in enumerate(page.get_text('words',sort=False)):
 t=str(w[4]); words.append({'pageNumber':n,'wordIndex':i,'rawText':t,'wordTextSha256':hashlib.sha256(t.encode()).hexdigest(),'bboxMilliPointsTopLeft':[round(float(v)*1000) for v in w[:4]]})
print(json.dumps({'pageNumber':n,'pdfPageCount':p.page_count,'pageWidthMilliPoints':round(page.rect.width*1000),'pageHeightMilliPoints':round(page.rect.height*1000),'pageText':page.get_text('text'),'words':words},ensure_ascii=False))`;
  for (const pageNumber of [49, 51]) {
    const receipt = await inspectPdfPageWordsWithPoppler({ originalPdfBytes,
      expectedSourceSha256: publicSha, expectedPdfPageCount: 77, pageNumber });
    const extracted = JSON.parse(execFileSync(python, ["-c", script, publicPath,
      String(pageNumber)], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
    const worker: TrustedPageWords = { ...extracted,
      providerId: "api-independent-pdf-words-v1", sourceSha256: publicSha,
      inspectionSha256: "" };
    const { inspectionSha256: _hash, ...body } = worker;
    worker.inspectionSha256 = pythonHash(body);
    const comparison = compareCompleteWorkerWordsWithPoppler(worker, receipt);
    assert.deepEqual(comparison, pageNumber === 49
      ? { equivalent: false, reason: "WORD_COUNT_MISMATCH",
        workerWordCount: 132, independentWordCount: 135 }
      : { equivalent: false, reason: "WORD_COUNT_MISMATCH",
        workerWordCount: 175, independentWordCount: 173 });
    const independentComparison = await verifyCompleteWorkerWordsAgainstOriginalPdf({
      originalPdfBytes, expectedSourceSha256: publicSha,
      expectedPdfPageCount: 77, workerPage: worker });
    assert.deepEqual(independentComparison, comparison);
  }
});

test("full equivalence requires every index, word, box and page text", () => {
  const rawText = "Окна";
  const word = { pageNumber: 1, wordIndex: 0, rawText,
    wordTextSha256: sha256(rawText),
    bboxMilliPointsTopLeft: [10000, 20000, 30000, 40000] as [number, number, number, number] };
  const worker: TrustedPageWords = { providerId: "api-independent-pdf-words-v1",
    sourceSha256: "a".repeat(64), pdfPageCount: 1, pageNumber: 1,
    pageWidthMilliPoints: 600000, pageHeightMilliPoints: 800000,
    pageText: "Окна", words: [word], inspectionSha256: "b".repeat(64) };
  const independent = { providerId: "api-poppler-pdftotext-bbox-layout-v1@25.03.0",
    sourceSha256: worker.sourceSha256, pdfPageCount: 1, pageNumber: 1,
    pageWidthMilliPoints: worker.pageWidthMilliPoints,
    pageHeightMilliPoints: worker.pageHeightMilliPoints, xmlSha256: "c".repeat(64),
    plainTextSha256: "d".repeat(64), pageText: "Окна\f",
    words: [{ wordIndex: 0, rawText, bboxMilliPointsTopLeft: word.bboxMilliPointsTopLeft }],
    inspectionSha256: "e".repeat(64) };
  assert.equal(compareCompleteWorkerWordsWithPoppler(worker, independent).equivalent, true);
  assert.equal(compareCompleteWorkerWordsWithPoppler({ ...worker, pageText: "Витражи" },
    independent).reason, "PAGE_TEXT_MISMATCH");
  assert.equal(compareCompleteWorkerWordsWithPoppler({ ...worker, words: [{ ...word,
    wordIndex: 1 }] }, independent).reason, "WORD_ORDER_TEXT_OR_BOX_MISMATCH");
});
