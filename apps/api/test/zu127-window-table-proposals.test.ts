import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { corroboratePdfWordsWithPoppler, pythonHash } from "../src/trusted-page-words.js";
import { verifyZu127WindowTableProposals,
  type Zu127WindowVerificationInput } from "../src/zu127-window-table-proposals.js";

// Python worker-generated synthetic word fixture. Its PDF bytes are a marker, not a
// real parsed PDF: only an API-owned source parser may create trustedPages in runtime.
const syntheticFixture = "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";
function fixture(): Zu127WindowVerificationInput {
  const value = JSON.parse(inflateSync(Buffer.from(syntheticFixture, "base64"))
    .toString("utf8"));
  return { originalPdfBytes: Buffer.from(value.pdfBase64, "base64"),
    publicSource: value.source, trustedPages: value.trustedPages, result: value.result };
}
function rehash(input: Zu127WindowVerificationInput): void {
  const result = input.result as any;
  const { contentHash: _old, ...body } = result;
  result.contentHash = pythonHash(body);
}
function rehashPage(input: Zu127WindowVerificationInput): void {
  const page = input.trustedPages[0];
  const { inspectionSha256: _old, ...body } = page;
  page.inspectionSha256 = pythonHash(body);
}

test("replays Python ZU-127 synthetic window/vitrage proposals without typed values", () => {
  const input = fixture();
  const result = input.result as any;
  assert.equal(result.contentHash,
    "952c022ca9703b6e57fb75dae97c8a000071265d675f8d5268df5cf5128a88df");
  assert.equal(verifyZu127WindowTableProposals(input), true);
  assert.deepEqual(result.codeRows[0].proposals.map((item: any) =>
    [item.productKind, item.rawCellTexts]), [
    ["WINDOW", { required: "0,50", calculated: "0,65" }],
    ["VITRAGE", { required: "0,50", calculated: "0,85" }],
  ]);
  assert.equal(result.codeRows[0].proposals.every((item: any) =>
    item.typedValues === null && item.rowAssociationStatus === "UNVERIFIED"), true);
});

test("fails closed on missing or tampered independently supplied words", () => {
  const missing = fixture();
  missing.trustedPages = [];
  assert.equal(verifyZu127WindowTableProposals(missing), false);
  const changes: Array<(input: Zu127WindowVerificationInput) => void> = [
    (input) => { input.trustedPages[0].words[5].rawText = "0,99"; },
    (input) => { input.trustedPages[0].words[5].bboxMilliPointsTopLeft[0] += 100; },
    (input) => { input.trustedPages[0].sourceSha256 = "a".repeat(64); },
    (input) => { input.trustedPages[0].pageText = "Коэффициент теплопередачи"; },
    (input) => { input.trustedPages[0].providerId = "worker-word-list" as any; },
    (input) => { input.trustedPages[0].words[5].wordIndex = 99; },
    (input) => { input.originalPdfBytes = Buffer.from("different PDF"); },
  ];
  for (const [index, change] of changes.entries()) {
    const input = fixture(); change(input); rehashPage(input);
    assert.equal(verifyZu127WindowTableProposals(input), false, `page tamper ${index}`);
  }
});

test("rejects rehashed false zero, product swap, value swap, and assertion escalation", () => {
  const changes: Array<(input: Zu127WindowVerificationInput) => void> = [
    (input) => { (input.result as any).codeRows[0].proposals = []; },
    (input) => { (input.result as any).codeRows[0].proposalCount = 0; },
    (input) => { (input.result as any).codeRows[0].proposals[0].productKind = "VITRAGE"; },
    (input) => { (input.result as any).codeRows[0].proposals[0].rawCellTexts.calculated = "0,85"; },
    (input) => { (input.result as any).codeRows[0].proposals[0].roles.calculatedCell.wordIndex = 99; },
    (input) => { (input.result as any).codeRows[0].proposals[0].rowAssociationStatus = "VERIFIED"; },
    (input) => { (input.result as any).codeRows[0].proposals[0].typedValues = { resistance: 0.65 }; },
    (input) => { (input.result as any).pageReceipts[0].wordArtifactSha256 = "f".repeat(64); },
    (input) => { (input.result as any).codeRows[0].status = "PASS"; },
    (input) => { (input.result as any).findingCount = 1; },
  ];
  for (const [index, change] of changes.entries()) {
    const input = fixture(); change(input); rehash(input);
    assert.equal(verifyZu127WindowTableProposals(input), false, `result tamper ${index}`);
  }
});

const publicPdf = "/tmp/F0152-public-sha-verified.pdf";
test.skipIf(!existsSync(publicPdf))("original F0152 cannot pass without independent word provider", () => {
  const input = fixture();
  const bytes = readFileSync(publicPdf);
  assert.equal(sha256(bytes),
    "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af");
  input.originalPdfBytes = bytes;
  input.publicSource = { ...input.publicSource, sha256: sha256(bytes),
    size_bytes: bytes.length, pdf_pages: 77 };
  input.trustedPages = [];
  assert.equal(verifyZu127WindowTableProposals(input), false);
});

test.skipIf(!existsSync(publicPdf))("Poppler corroborates original F0152 p51 word text and box, rejects wrong cell", () => {
  const sourceSha256 = "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af";
  const words = [
    { text: "Окна", box: [119060, 442273, 143171, 454495] },
    { text: "0,50", box: [273790, 442273, 293110, 454495] },
    { text: "0,65", box: [461740, 442273, 481060, 454495] },
    { text: "Витражи", box: [110060, 465433, 152067, 477655] },
    { text: "0,85", box: [461740, 465433, 481060, 477655] },
  ].map((item, wordIndex) => ({ pageNumber: 51, wordIndex,
    rawText: item.text, wordTextSha256: sha256(item.text),
    bboxMilliPointsTopLeft: item.box as [number, number, number, number] }));
  const input = { pdfPath: publicPdf, sourceSha256, pageNumber: 51, words };
  assert.equal(corroboratePdfWordsWithPoppler(input), true);
  words[2].bboxMilliPointsTopLeft[0] += 5000;
  assert.equal(corroboratePdfWordsWithPoppler(input), false);
});

test.skipIf(!existsSync(publicPdf))("Poppler corroborates original F0152 p49 separate window and vitrage cells", () => {
  const words = [
    { text: "Окна", box: [307990, 114866, 329693, 125891] },
    { text: "0,65*", box: [450220, 144846, 471100, 156251] },
    { text: "Витражи", box: [299950, 175586, 337928, 186611] },
    { text: "0,85**", box: [448660, 205446, 472780, 216851] },
  ].map((item, wordIndex) => ({ pageNumber: 49, wordIndex,
    rawText: item.text, wordTextSha256: sha256(item.text),
    bboxMilliPointsTopLeft: item.box as [number, number, number, number] }));
  assert.equal(corroboratePdfWordsWithPoppler({ pdfPath: publicPdf,
    sourceSha256: "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af",
    pageNumber: 49, words }), true);
});
