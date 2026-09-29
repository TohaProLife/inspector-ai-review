import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyUnresolvedConfigReview, unresolvedReviewConfigSha256,
  pinnedUnresolvedReviewConfig,
  type UnresolvedConfigReviewVerificationInput } from "../src/unresolved-config-review.js";

// Python worker fixture: pinned 19-code config, synthetic reviewed GP/AR
// text, an OCR-deferred page, 20 matches and an oversized matching line.
const workerFixtureBrotliBase64 = "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";
const workerContentHash = "4107ae56de2971ea0bf5f87de380a1cb2160ef77123a0ae49d997e06f50621c8";
// Worker fixture for complete mixed PD/RD page maps and Unicode line boundaries.
const mixedFixtureBrotliBase64 = "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";
const mixedContentHash = "a87e337107d03d08ab867a78ff861f0bc9c5e3df55cc7d0ac8923466b33d4b7b";

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture(encoded = workerFixtureBrotliBase64): UnresolvedConfigReviewVerificationInput {
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

function rehashResult(input: UnresolvedConfigReviewVerificationInput): void {
  const result = input.result as any;
  const { contentHash: _old, ...body } = result;
  result.contentHash = sha256(workerJson(body));
}

function rehashLead(lead: any): void {
  const { leadSha256: _old, ...body } = lead;
  lead.leadSha256 = sha256(workerJson(body));
}

function row(input: UnresolvedConfigReviewVerificationInput, code: string): any {
  return (input.result as any).codeRows.find((candidate: any) =>
    candidate.parameterCode === code);
}

test("accepts independent 19-code worker fixture with explicit scan limits", () => {
  const input = fixture();
  assert.equal((input.result as any).contentHash, workerContentHash);
  assert.equal((input.result as any).configSha256, unresolvedReviewConfigSha256);
  assert.equal(sha256(workerJson(pinnedUnresolvedReviewConfig)), unresolvedReviewConfigSha256);
  assert.deepEqual(pinnedUnresolvedReviewConfig, input.config);
  assert.equal(Object.isFrozen(pinnedUnresolvedReviewConfig), true);
  assert.equal(verifyUnresolvedConfigReview(input), true);
  assert.equal((input.result as any).codeRows.length, 19);
  assert.deepEqual([row(input, "SPZU-027").leadCount,
    row(input, "SPZU-027").truncatedLeadCount,
    row(input, "SPZU-027").ocrRequiredPageCount,
    row(input, "SPZU-027").oversizeAnchorLineCount], [20, 4, 1, 1]);
  assert.equal((input.result as any).codeRows.every((candidate: any) =>
    candidate.status === "ABSTAIN" && candidate.absenceConclusion === "NOT_AVAILABLE"), true);
});

test("rejects rehashed false zero, truncation, anchor, locator and fact claims", () => {
  const changes: Array<(input: UnresolvedConfigReviewVerificationInput) => void> = [
    (input) => { const lead = row(input, "SPZU-027").leads[0];
      lead.matchedAnchors = ["площадь газонов"]; rehashLead(lead); },
    (input) => { const lead = row(input, "AR-042").leads[0];
      lead.elementAssociationStatus = "VERIFIED"; rehashLead(lead); },
    (input) => { const lead = row(input, "SPZU-033").leads[0];
      lead.lineText = "Уклон дороги 99"; lead.lineTextSha256 = sha256(lead.lineText);
      rehashLead(lead); },
    (input) => { const lead = row(input, "AR-046").leads[0];
      lead.sourceSection = "GP"; rehashLead(lead); },
    (input) => { const target = row(input, "SPZU-027");
      target.leads = []; target.leadCount = 0; target.truncatedLeadCount = 0;
      target.reasonCodes = [...target.reasonCodes,
        "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"].sort(); },
    (input) => { row(input, "SPZU-027").truncatedLeadCount = 0; },
    (input) => { row(input, "SPZU-027").oversizeAnchorLineCount = 0; },
    (input) => { row(input, "SPZU-027").ocrRequiredPageCount = 0; },
    (input) => { row(input, "AR-046").candidateExtractorFamily = "DIMENSION_LAYOUT"; },
    (input) => { row(input, "AR-042").absenceConclusion = "ABSENT"; },
    (input) => { row(input, "AR-042").status = "PASS"; },
    (input) => { (input.result as any).findingCount = 1; },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    rehashResult(input);
    assert.equal(verifyUnresolvedConfigReview(input), false);
  }
});

test("rejects config drift, row order, source review, text SHA and run manifest", () => {
  const changes: Array<(input: UnresolvedConfigReviewVerificationInput) => void> = [
    (input) => { (input.config as any).entries[0].anchors = ["подмена"]; },
    (input) => { (input.config as any).entries.reverse(); },
    (input) => { (input.result as any).configSha256 = "e".repeat(64); rehashResult(input); },
    (input) => { (input.result as any).codeRows.reverse(); rehashResult(input); },
    (input) => { input.sourceReviews["F-GP"].approvalStatus = "UNKNOWN"; },
    (input) => { input.sourceReviews["F-AR"].decisionHash = "e".repeat(64); },
    (input) => { input.sourceFiles[0].stages = ["RD"]; },
    (input) => { input.sourceFiles[0].sectionCode = "AR"; },
    (input) => { delete input.textArtifacts["F-GP"]; },
    (input) => { input.textArtifacts["F-AR"].content_hash = "f".repeat(64); },
    (input) => { input.inputManifestHash = "b".repeat(64); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifyUnresolvedConfigReview(input), false);
  }
});

test("accepts worker mixed PD/RD page stages and Unicode line locators", () => {
  const input = fixture(mixedFixtureBrotliBase64);
  assert.equal((input.result as any).contentHash, mixedContentHash);
  assert.equal(verifyUnresolvedConfigReview(input), true);
  const program = row(input, "PZ-003");
  assert.deepEqual([program.eligibleSourceCount, program.textCandidatePageCount,
    program.leadCount], [1, 1, 1]);
  assert.deepEqual([program.leads[0].sourceFileId, program.leads[0].sourceStage,
    program.leads[0].pageNumber], ["F-MIX", "PD", 1]);
  const area = row(input, "SPZU-027");
  assert.deepEqual([area.eligibleSourceCount, area.textCandidatePageCount,
    area.ocrRequiredPageCount, area.leadCount], [3, 3, 1, 3]);
  assert.deepEqual(area.leads.map((lead: any) => lead.sourceStage), ["PD", "RD", "PD"]);
  assert.equal(area.leads[2].lineIndex, 1);
  assert.equal(area.leads[2].lineText, "Площадь озеленения");
  assert.equal(area.reasonCodes.includes("PAGE_STAGE_UNRESOLVED_DEFERRED"), true);
});

test("rejects incomplete mixed page maps and rehashed false-zero or forged page stage", () => {
  const changes: Array<(input: UnresolvedConfigReviewVerificationInput) => void> = [
    (input) => { delete input.sourceReviews["F-MIX"].pageStages["2"]; },
    (input) => { input.sourceReviews["F-MIX-GP"].pageStages["1"] = "RD"; },
    (input) => { input.sourceReviews["F-MIX"].pageStages["3"] = "PD"; },
    (input) => { const lead = row(input, "SPZU-027").leads[1];
      lead.sourceStage = "PD"; rehashLead(lead); rehashResult(input); },
    (input) => { const lead = row(input, "SPZU-027").leads[2];
      lead.lineIndex = 0; rehashLead(lead); rehashResult(input); },
    (input) => { const target = row(input, "PZ-003");
      target.leads = []; target.leadCount = 0;
      target.reasonCodes = [...target.reasonCodes,
        "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"].sort(); rehashResult(input); },
  ];
  for (const change of changes) {
    const input = fixture(mixedFixtureBrotliBase64);
    change(input);
    assert.equal(verifyUnresolvedConfigReview(input), false);
  }
});
