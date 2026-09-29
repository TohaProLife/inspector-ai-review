import assert from "node:assert/strict";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { boundedOcrConfigHashV6, boundedOcrProfileIdV6,
  boundedOcrProfileV6, validateBoundedOcrV6StageResult,
  type OcrV6ExpectedSource } from "../src/ocr-layout.js";
import { verifyUnresolvedFamilyOcrReview,
  type UnresolvedFamilyOcrReviewVerificationInput } from "../src/unresolved-family-ocr-review.js";

const sourceSha = "a".repeat(64);
const manifestSha = "b".repeat(64);
const sourceId = "F-AR";
const objectId = "OBJ";
const lineText = "Высота дверного проема 2,1 м";
const box = [10, 20, 300, 60];
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashed<T extends Record<string, unknown>>(body: T): T & { contentHash: string } {
  return { ...body, contentHash: sha256(canonicalJson(body)) };
}

function source(): OcrV6ExpectedSource {
  const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: sourceId,
    inputSha256: sourceSha, pageCount: 1,
    pages: [{ pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
      quality: { disposition: "OCR_REQUIRED" }, blocks: [] }] };
  return { apiId: sourceId, sha256: sourceSha, byteSize: 100,
    mediaType: "application/pdf", textArtifact,
    textArtifactSha256: sha256(canonicalJson(textArtifact)), stages: ["PD"],
    sectionCode: "AR", sourceDecision: { sourceSha256: sourceSha,
      revisionStatus: "CURRENT", approvalStatus: "APPROVED", sectionCode: "AR",
      pageStages: {}, basis: { reference: "Synthetic review" } } };
}

function stage(lines: Array<{ text: string; score: number; bboxPx: number[] }> = [{
  text: lineText, score: 0.9, bboxPx: box,
}]): Record<string, unknown> {
  const page = hashed({ schemaVersion: "document-ocr-page-v1", sourceFileId: sourceId,
    inputSha256: sourceSha, pageNumber: 1,
    render: { sha256: "c".repeat(64), widthPx: 992, heightPx: 1404, dpi: 120,
      rendererProfileId: boundedOcrProfileV6.rendererProfileId },
    provider: { profileId: boundedOcrProfileV6.ocrProviderProfileIds[0], script: "eslav" },
    lines });
  return { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: manifestSha, disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: boundedOcrProfileIdV6, providerConfigHash: boundedOcrConfigHashV6,
    outputCount: 1, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v6",
      objectId, inputManifestHash: manifestSha, profile: boundedOcrProfileV6,
      sourceCount: 1, ocrRequiredPageCount: 1, processedPageCount: 1,
      deferredPageCount: 0, skippedOversizePageCount: 0,
      skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
      reviewEligiblePageCount: 1, stageUnresolvedPageCount: 0,
      sources: [{ sourceFileId: sourceId, sourceSha256: sourceSha,
        mediaType: "application/pdf", pageCount: 1, status: "SCANNED",
        ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0,
        skippedRenderPixelPageCount: 0, reviewEligiblePageCount: 1,
        stageUnresolvedPageCount: 0, selectionReasonCodes: [], pages: [page] }] } };
}

function row(parameterCode: string, leads: unknown[] = []) {
  return { parameterCode, status: "ABSTAIN",
    reasonCodes: leads.length
      ? ["LEAD_NOT_VERIFIED_FACT", "OCR_TEXT_REQUIRES_VISUAL_REVIEW"]
      : ["LEAD_NOT_VERIFIED_FACT", "NO_EXACT_LINE_LEAD", "OCR_TEXT_REQUIRES_VISUAL_REVIEW"],
    leads };
}

function fixture(): UnresolvedFamilyOcrReviewVerificationInput {
  const expected = source();
  const ocrStage = stage();
  const stageHash = sha256(canonicalJson(ocrStage));
  const page = ((ocrStage.analysis as any).sources[0].pages[0]);
  const leadBody = { sourceFileId: sourceId, sourceSha256: sourceSha,
    textArtifactSha256: expected.textArtifactSha256,
    ocrStageSha256: stageHash, ocrPageSha256: page.contentHash,
    pageNumber: 1, stage: "PD", sectionCode: "AR",
    coordinateSystem: "IMAGE_TOP_LEFT_PIXELS", lineIndex: 0,
    lineText, score: 0.9, bboxPx: box,
    renderSha256: page.render.sha256,
    rendererProfileId: page.render.rendererProfileId,
    providerProfileId: page.provider.profileId,
    providerScript: page.provider.script, dpi: 120, widthPx: 992, heightPx: 1404 };
  const lead = { ...leadBody, leadSha256: sha256(workerJson(leadBody)) };
  const resultBody = { schemaVersion: "unresolved-family-ocr-review-v1",
    profileId: "unresolved-family-ocr-review-v1", purpose: "REVIEW_ONLY",
    objectId, inputManifestHash: manifestSha, ocrStageSha256: stageHash,
    sourceStageArtifacts: [{ sourceFileId: sourceId, sourceSha256: sourceSha,
      textArtifactSha256: expected.textArtifactSha256 }],
    codeRows: [row("AR-042", [lead]), row("IOS2-072"), row("IOS3-075")],
    findingCount: null, parameterCoverage: null };
  const result = { ...resultBody, contentHash: sha256(workerJson(resultBody)) };
  return { objectId, inputManifestHash: manifestSha,
    expectedSources: [expected], stage: ocrStage, stageHash, result };
}

function rehash(input: UnresolvedFamilyOcrReviewVerificationInput): void {
  const result = input.result as any;
  for (const row of result.codeRows) for (const lead of row.leads) {
    const { leadSha256: _previous, ...body } = lead;
    lead.leadSha256 = sha256(workerJson(body));
  }
  const { contentHash: _previous, ...body } = result;
  result.contentHash = sha256(workerJson(body));
}

test("accepts only review-only synthetic OCR v6 line linked to committed stage", () => {
  const valid = fixture();
  assert.ok(validateBoundedOcrV6StageResult(valid.stage, manifestSha, objectId,
    valid.expectedSources));
  assert.equal(verifyUnresolvedFamilyOcrReview(valid), true);
  const empty = fixture();
  (empty.result as any).codeRows[0] = row("AR-042");
  rehash(empty);
  assert.equal(verifyUnresolvedFamilyOcrReview(empty), false);

  const noTrigger = fixture();
  const page = ((noTrigger.stage.analysis as any).sources[0].pages[0]);
  page.lines[0].text = "Общий лист";
  const { contentHash: _oldPageHash, ...pageBody } = page;
  page.contentHash = sha256(canonicalJson(pageBody));
  noTrigger.stageHash = sha256(canonicalJson(noTrigger.stage));
  (noTrigger.result as any).ocrStageSha256 = noTrigger.stageHash;
  (noTrigger.result as any).codeRows[0] = row("AR-042");
  rehash(noTrigger);
  assert.equal(verifyUnresolvedFamilyOcrReview(noTrigger), true);
});

test("rejects forged lead line, page, source, stage, geometry, and metadata", () => {
  const patches = [
    { lineText: "Высота коридора 3 м" }, { pageNumber: 2 },
    { sourceSha256: "d".repeat(64) }, { ocrPageSha256: "d".repeat(64) },
    { ocrStageSha256: "d".repeat(64) }, { lineIndex: 1 },
    { bboxPx: [10, 20, 301, 60] }, { score: 0.7 },
    { stage: "RD" }, { sectionCode: "VK" },
    { renderSha256: "d".repeat(64) }, { rendererProfileId: "forged" },
    { providerProfileId: "forged" }, { providerScript: "eng" },
    { dpi: 72 }, { widthPx: 100 }, { heightPx: 100 },
  ];
  for (const patch of patches) {
    const input = fixture();
    Object.assign((input.result as any).codeRows[0].leads[0], patch);
    rehash(input);
    assert.equal(verifyUnresolvedFamilyOcrReview(input), false,
      `accepted forged ${Object.keys(patch).join(",")}`);
  }
});

test("rejects stale stage, altered source review, OCR quality, and result facts", () => {
  const input = fixture();
  input.expectedSources[0].sourceDecision!.approvalStatus = "UNAPPROVED";
  assert.equal(verifyUnresolvedFamilyOcrReview(input), false);
  const quality = fixture();
  ((quality.expectedSources[0].textArtifact as any).pages[0].quality).disposition =
    "TEXT_LAYER_CANDIDATE";
  assert.equal(verifyUnresolvedFamilyOcrReview(quality), false);
  const stale = fixture();
  ((stale.stage.analysis as any).sources[0].pages[0].lines[0]).text = "forged";
  assert.equal(verifyUnresolvedFamilyOcrReview(stale), false);
  const fact = fixture();
  (fact.result as any).findingCount = 1;
  rehash(fact);
  assert.equal(verifyUnresolvedFamilyOcrReview(fact), false);
});

test("rejects missing review, unresolved mixed stage, and altered integrity hashes", () => {
  const cases: Array<(input: UnresolvedFamilyOcrReviewVerificationInput) => void> = [
    (input) => { input.expectedSources[0].sourceDecision = null;
      input.expectedSources[0].sectionCode = null; },
    (input) => { input.expectedSources[0].stages = ["PD", "RD"]; },
    (input) => { input.expectedSources[0].stages = ["ID"]; },
    (input) => { input.expectedSources[0].textArtifactSha256 = "d".repeat(64); },
    (input) => { input.stageHash = "d".repeat(64); },
    (input) => { (input.result as any).contentHash = "d".repeat(64); },
    (input) => { (input.result as any).codeRows[0].reasonCodes.push("VERIFIED_FACT");
      rehash(input); },
  ];
  for (const change of cases) {
    const input = fixture();
    change(input);
    assert.equal(verifyUnresolvedFamilyOcrReview(input), false);
  }
});

test("zero-lead rows cannot hide exact IOS2 or IOS3 lines on eligible VK OCR pages", () => {
  const input = fixture();
  input.expectedSources[0].sectionCode = "VK";
  input.expectedSources[0].sourceDecision!.sectionCode = "VK";
  const page = ((input.stage.analysis as any).sources[0].pages[0]);
  page.lines[0].text = "Труба ПВХ водоснабжения и канализации";
  const { contentHash: _oldPageHash, ...pageBody } = page;
  page.contentHash = sha256(canonicalJson(pageBody));
  input.stageHash = sha256(canonicalJson(input.stage));
  const result = input.result as any;
  result.ocrStageSha256 = input.stageHash;
  result.codeRows = [row("AR-042"), row("IOS2-072"), row("IOS3-075")];
  rehash(input);
  assert.equal(verifyUnresolvedFamilyOcrReview(input), false);
});
