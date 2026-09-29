import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyUnresolvedConfigReviewV2, unresolvedReviewConfigV2Sha256,
  pinnedUnresolvedReviewConfigV2,
  type UnresolvedConfigReviewV2VerificationInput } from "../src/unresolved-config-review-v2.js";

// Compressed Python worker fixture; all ten reviewed PD section roles have a lead.
const workerFixtureBrotliBase64 = "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";
const workerContentHash = "9f46f1fd5162469c9961db2542744fce63ef70ffd2892d46d1f6f81ba8fd16ff";
// Python fixture for complete mixed page stages, OCR deferral and bounded leads.
const mixedFixtureBrotliBase64 = "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";
const mixedContentHash = "079ee53a7af53051b143c9aca4bf10da614354b1bd900f8de925b2fd8100e656";

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture(encoded = workerFixtureBrotliBase64): UnresolvedConfigReviewV2VerificationInput {
  const f = JSON.parse(brotliDecompressSync(
    Buffer.from(encoded, "base64")).toString("utf8")) as any;
  const reviewHash = "d".repeat(64);
  return { objectId: f.objectId, inputManifestHash: f.inputManifestHash,
    config: f.config,
    sourceFiles: f.sources.map((source: any) => ({
      sourceFileId: source.sourceFileId, objectId: source.objectId,
      sha256: source.sha256, stages: source.stages,
      sourceReviewHash: reviewHash, sectionCode: source.sectionCode })),
    sourceReviews: Object.fromEntries(f.sources.map((source: any) => [source.sourceFileId,
      { sourceSha256: source.sha256, revisionStatus: source.revisionStatus,
        approvalStatus: source.approvalStatus, sectionCode: source.sectionCode,
        pageStages: source.pageStages, contentHash: reviewHash, decisionHash: reviewHash }])),
    textArtifacts: Object.fromEntries(f.textArtifacts.map((artifact: any) => [
      artifact.sourceFileId, { content_json: artifact,
        content_hash: sha256(canonicalJson(artifact)) }])),
    result: f.result };
}

function rehashResult(input: UnresolvedConfigReviewV2VerificationInput): void {
  const result = input.result as any;
  const { contentHash: _old, ...body } = result;
  result.contentHash = sha256(workerJson(body));
}

function rehashLead(lead: any): void {
  const { leadSha256: _old, ...body } = lead;
  lead.leadSha256 = sha256(workerJson(body));
}

function row(input: UnresolvedConfigReviewV2VerificationInput, code: string): any {
  return (input.result as any).codeRows.find((candidate: any) =>
    candidate.parameterCode === code);
}

test("accepts pinned ten-code Python worker fixture", () => {
  const input = fixture();
  assert.equal((input.result as any).contentHash, workerContentHash);
  assert.equal((input.result as any).configSha256, unresolvedReviewConfigV2Sha256);
  assert.equal(sha256(workerJson(pinnedUnresolvedReviewConfigV2)), unresolvedReviewConfigV2Sha256);
  assert.deepEqual(pinnedUnresolvedReviewConfigV2, input.config);
  assert.equal(Object.isFrozen(pinnedUnresolvedReviewConfigV2), true);
  assert.equal(verifyUnresolvedConfigReviewV2(input), true);
  assert.deepEqual((input.result as any).codeRows.map((candidate: any) =>
    candidate.parameterCode), ["SPZU-026", "AR-052", "IOS2-072", "IOS3-075", "ZU-130",
      "AR-043", "IOS5-080", "PPM-106", "PPM-108", "PPM-110"]);
  assert.equal((input.result as any).codeRows.every((candidate: any) =>
    candidate.status === "ABSTAIN" && candidate.leadCount === 1
      && candidate.absenceConclusion === "NOT_AVAILABLE"), true);
  assert.equal((input.result as any).findingCount, null);
  assert.equal((input.result as any).parameterCoverage, null);
});

test("rejects audited PDF/page/render evidence drift and config or family changes", () => {
  const changes: Array<(input: UnresolvedConfigReviewV2VerificationInput) => void> = [
    (input) => { (input.config as any).entries[0].anchorEvidence[0].sourceSha256 = "e".repeat(64); },
    (input) => { (input.config as any).entries[0].anchorEvidence[0].pageNumber = 20; },
    (input) => { (input.config as any).entries[0].anchorEvidence[0].renderSha256 = "e".repeat(64); },
    (input) => { (input.config as any).entries[0].anchorEvidence[0].lineText = "unrelated"; },
    (input) => { (input.config as any).entries[0].candidateExtractorFamily = "SAFETY_COVERAGE"; },
    (input) => { (input.result as any).codeRows.reverse(); rehashResult(input); },
    (input) => { (input.result as any).configSha256 = "e".repeat(64); rehashResult(input); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifyUnresolvedConfigReviewV2(input), false);
  }
});

test("rejects rehashed false zero, forged locators and fact claims", () => {
  const changes: Array<(input: UnresolvedConfigReviewV2VerificationInput) => void> = [
    (input) => { const target = row(input, "SPZU-026"); target.leads = []; target.leadCount = 0;
      target.reasonCodes = [...target.reasonCodes, "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"].sort(); },
    (input) => { const lead = row(input, "AR-052").leads[0];
      lead.pageNumber = 2; rehashLead(lead); },
    (input) => { const lead = row(input, "IOS2-072").leads[0];
      lead.lineIndex = 99; rehashLead(lead); },
    (input) => { const lead = row(input, "IOS3-075").leads[0];
      lead.matchedAnchors = ["подмена"]; rehashLead(lead); },
    (input) => { const lead = row(input, "ZU-130").leads[0];
      lead.elementAssociationStatus = "VERIFIED"; rehashLead(lead); },
    (input) => { row(input, "PPM-106").status = "PASS"; },
    (input) => { row(input, "PPM-108").absenceConclusion = "ABSENT"; },
    (input) => { (input.result as any).findingCount = 1; },
    (input) => { (input.result as any).parameterCoverage = {}; },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    rehashResult(input);
    assert.equal(verifyUnresolvedConfigReviewV2(input), false);
  }
});

test("rejects stale source, mutable review, artifact and manifest snapshots", () => {
  const changes: Array<(input: UnresolvedConfigReviewV2VerificationInput) => void> = [
    (input) => { input.sourceReviews["F-GP"].approvalStatus = "UNKNOWN"; },
    (input) => { input.sourceReviews["F-AR"].decisionHash = "e".repeat(64); },
    (input) => { input.sourceFiles[0].stages = ["RD"]; },
    (input) => { input.sourceFiles[0].sha256 = "e".repeat(64); },
    (input) => { delete input.textArtifacts["F-IOS2"]; },
    (input) => { input.textArtifacts["F-IOS3"].content_hash = "e".repeat(64); },
    (input) => { input.inputManifestHash = "e".repeat(64); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifyUnresolvedConfigReviewV2(input), false);
  }
});

test("accepts Python mixed-page, OCR, oversize and truncation fixture", () => {
  const input = fixture(mixedFixtureBrotliBase64);
  assert.equal((input.result as any).contentHash, mixedContentHash);
  assert.equal(verifyUnresolvedConfigReviewV2(input), true);
  const target = row(input, "IOS2-072");
  assert.deepEqual([target.eligibleSourceCount, target.textCandidatePageCount,
    target.ocrRequiredPageCount, target.oversizeAnchorLineCount,
    target.leadCount, target.truncatedLeadCount, target.leads.length],
  [1, 1, 1, 1, 20, 4, 16]);
  assert.equal(target.leads.every((lead: any) => lead.sourceStage === "PD"
    && lead.pageNumber === 1), true);
  assert.equal(target.reasonCodes.includes("PAGE_STAGE_UNRESOLVED_DEFERRED"), true);
  assert.equal(row(input, "SPZU-026").reasonCodes.includes("NO_SCANNED_TEXT_IN_SCOPE"), true);
});

test("rejects mixed page-map forgery and rehashed false zero or truncation", () => {
  const changes: Array<(input: UnresolvedConfigReviewV2VerificationInput) => void> = [
    (input) => { delete input.sourceReviews["F-IOS2-MIX"].pageStages["2"]; },
    (input) => { input.sourceReviews["F-IOS2-MIX"].pageStages["1"] = "RD"; },
    (input) => { input.sourceReviews["F-IOS2-MIX"].pageStages["3"] = "PD"; },
    (input) => { row(input, "IOS2-072").truncatedLeadCount = 0; rehashResult(input); },
    (input) => { row(input, "IOS2-072").oversizeAnchorLineCount = 0; rehashResult(input); },
    (input) => { row(input, "IOS2-072").ocrRequiredPageCount = 0; rehashResult(input); },
    (input) => { const target = row(input, "IOS2-072"); target.leads = [];
      target.leadCount = 0; target.truncatedLeadCount = 0;
      target.reasonCodes = [...target.reasonCodes, "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"].sort();
      rehashResult(input); },
    (input) => { const lead = row(input, "IOS2-072").leads[0];
      lead.sourceStage = "RD"; rehashLead(lead); rehashResult(input); },
    (input) => { const lead = row(input, "IOS2-072").leads[0];
      lead.lineIndex = 99; rehashLead(lead); rehashResult(input); },
  ];
  for (const change of changes) {
    const input = fixture(mixedFixtureBrotliBase64);
    change(input);
    assert.equal(verifyUnresolvedConfigReviewV2(input), false);
  }
});
