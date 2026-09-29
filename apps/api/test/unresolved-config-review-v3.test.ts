import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyUnresolvedConfigReviewV3, unresolvedReviewConfigV3Sha256,
  pinnedUnresolvedReviewConfigV3,
  type UnresolvedConfigReviewV3VerificationInput } from "../src/unresolved-config-review-v3.js";
import { verifyUnresolvedConfigReview } from "../src/unresolved-config-review.js";
import { verifyUnresolvedConfigReviewV2 } from "../src/unresolved-config-review-v2.js";

const allFixtureBrotliBase64 = "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";
const allContentHash = "4a07a9fd82b5e6df18e5a623357b3f83cb3e26641a7ae617e8351b4e8c5eae03";
const mixedFixtureBrotliBase64 = "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";
const mixedContentHash = "433393086e9d333689173531dde461a0aab33423be4691e6b8ad9a87316d63dc";
const cappedFixtureBrotliBase64 = "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";
const cappedContentHash = "69841caf4a3ecd22ce89a434b42817fc17cc67af7d4e885cad9348fc707ff867";

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture(encoded = allFixtureBrotliBase64): UnresolvedConfigReviewV3VerificationInput {
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

function rehashResult(input: UnresolvedConfigReviewV3VerificationInput): void {
  const result = input.result as any;
  const { contentHash: _old, ...body } = result;
  result.contentHash = sha256(workerJson(body));
}

function rehashLead(lead: any): void {
  const { leadSha256: _old, ...body } = lead;
  lead.leadSha256 = sha256(workerJson(body));
}

function row(input: UnresolvedConfigReviewV3VerificationInput, code: string): any {
  return (input.result as any).codeRows.find((candidate: any) =>
    candidate.parameterCode === code);
}

test("accepts seven-code Python fixture and API-owned config pin", () => {
  const input = fixture();
  assert.equal((input.result as any).contentHash, allContentHash);
  assert.equal((input.result as any).configSha256, unresolvedReviewConfigV3Sha256);
  assert.equal(sha256(workerJson(pinnedUnresolvedReviewConfigV3)), unresolvedReviewConfigV3Sha256);
  assert.deepEqual(pinnedUnresolvedReviewConfigV3, input.config);
  assert.equal(Object.isFrozen(pinnedUnresolvedReviewConfigV3), true);
  assert.equal(verifyUnresolvedConfigReviewV3(input), true);
  assert.deepEqual((input.result as any).codeRows.map((candidate: any) =>
    candidate.parameterCode), ["IOS1-068", "IOS1-069", "IOS1-070", "IOS4-076",
      "IOS4-078", "PPM-111", "PPM-113"]);
  assert.equal((input.result as any).codeRows.every((candidate: any) =>
    candidate.status === "ABSTAIN" && candidate.leadCount === 1
      && candidate.reasonCodes.includes("NETWORK_TOPOLOGY_UNVERIFIED")
      && candidate.absenceConclusion === "NOT_AVAILABLE"), true);
  assert.equal((input.result as any).findingCount, null);
  assert.equal((input.result as any).parameterCoverage, null);
});

test("trusted wrappers reject another profile's otherwise valid sidecar", () => {
  const input = fixture();
  assert.equal(verifyUnresolvedConfigReviewV3(input), true);
  assert.equal(verifyUnresolvedConfigReview(input), false);
  assert.equal(verifyUnresolvedConfigReviewV2(input), false);
});

test("rejects v3 config render tuple, profile, code and family drift", () => {
  const changes: Array<(input: UnresolvedConfigReviewV3VerificationInput) => void> = [
    (input) => { (input.config as any).entries[0].anchorEvidence[0].sourceSha256 = "e".repeat(64); },
    (input) => { (input.config as any).entries[0].anchorEvidence[0].pageNumber = 248; },
    (input) => { (input.config as any).entries[0].anchorEvidence[0].renderSha256 = "e".repeat(64); },
    (input) => { (input.config as any).auditedRenderProfile = "unknown"; },
    (input) => { (input.config as any).entries[0].candidateExtractorFamily = "DOCUMENT_APPROVAL"; },
    (input) => { (input.result as any).codeRows.reverse(); rehashResult(input); },
    (input) => { (input.result as any).profileId = "unresolved-review-config-v2";
      rehashResult(input); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifyUnresolvedConfigReviewV3(input), false);
  }
});

test("rejects rehashed false zero, forged locators, and topology/finding claims", () => {
  const changes: Array<(input: UnresolvedConfigReviewV3VerificationInput) => void> = [
    (input) => { const target = row(input, "IOS1-068"); target.leads = []; target.leadCount = 0;
      target.reasonCodes = [...target.reasonCodes, "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"].sort(); },
    (input) => { const lead = row(input, "IOS4-078").leads[0];
      lead.lineIndex = 99; rehashLead(lead); },
    (input) => { const lead = row(input, "PPM-111").leads[0];
      lead.pageNumber = 19; rehashLead(lead); },
    (input) => { const lead = row(input, "PPM-113").leads[0];
      lead.elementAssociationStatus = "VERIFIED"; rehashLead(lead); },
    (input) => { row(input, "IOS1-069").reasonCodes = ["NETWORK_TOPOLOGY_VERIFIED"]; },
    (input) => { row(input, "IOS1-070").status = "PASS"; },
    (input) => { (input.result as any).findingCount = 1; },
    (input) => { (input.result as any).parameterCoverage = {}; },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    rehashResult(input);
    assert.equal(verifyUnresolvedConfigReviewV3(input), false);
  }
});

test("rejects source, review, text artifact and run snapshot drift", () => {
  const changes: Array<(input: UnresolvedConfigReviewV3VerificationInput) => void> = [
    (input) => { input.sourceReviews["S-EOM"].approvalStatus = "UNKNOWN"; },
    (input) => { input.sourceReviews["S-OV"].decisionHash = "e".repeat(64); },
    (input) => { input.sourceFiles[0].sha256 = "e".repeat(64); },
    (input) => { input.sourceFiles[0].sectionCode = "OV"; },
    (input) => { delete input.textArtifacts["S-VK"]; },
    (input) => { input.textArtifacts["S-OV"].content_hash = "e".repeat(64); },
    (input) => { input.inputManifestHash = "e".repeat(64); },
    (input) => { const lead = row(input, "IOS1-068").leads[0];
      lead.lineText = "forged"; lead.lineTextSha256 = sha256(lead.lineText);
      rehashLead(lead); rehashResult(input); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifyUnresolvedConfigReviewV3(input), false);
  }
});

test("accepts mixed RD/ID with page-specific exclusion and OCR deferral", () => {
  const input = fixture(mixedFixtureBrotliBase64);
  assert.equal((input.result as any).contentHash, mixedContentHash);
  assert.equal(verifyUnresolvedConfigReviewV3(input), true);
  const hvac = row(input, "IOS4-078");
  assert.deepEqual([hvac.eligibleSourceCount, hvac.textCandidatePageCount,
    hvac.ocrRequiredPageCount, hvac.leadCount], [1, 1, 1, 1]);
  assert.equal(hvac.leads[0].sourceStage, "RD");
  assert.equal(hvac.reasonCodes.includes("PAGE_STAGE_UNRESOLVED_DEFERRED"), true);
  assert.equal(row(input, "IOS1-068").reasonCodes.includes("NO_SCANNED_TEXT_IN_SCOPE"), true);
  assert.equal(row(input, "IOS4-076").reasonCodes.includes(
    "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"), true);
  assert.equal(row(input, "IOS4-076").absenceConclusion, "NOT_AVAILABLE");
});

test("rejects incomplete mixed map, forged page role, OCR and false zero", () => {
  const changes: Array<(input: UnresolvedConfigReviewV3VerificationInput) => void> = [
    (input) => { delete input.sourceReviews["S-OV-MIXED"].pageStages["2"]; },
    (input) => { input.sourceReviews["S-OV-MIXED"].pageStages["1"] = "ID"; },
    (input) => { input.sourceReviews["S-OV-MIXED"].pageStages["3"] = "RD"; },
    (input) => { row(input, "IOS4-078").ocrRequiredPageCount = 0; rehashResult(input); },
    (input) => { const target = row(input, "IOS4-078"); target.leads = [];
      target.leadCount = 0; target.reasonCodes = [...target.reasonCodes,
        "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"].sort(); rehashResult(input); },
    (input) => { const lead = row(input, "IOS4-078").leads[0];
      lead.sourceStage = "ID"; rehashLead(lead); rehashResult(input); },
  ];
  for (const change of changes) {
    const input = fixture(mixedFixtureBrotliBase64);
    change(input);
    assert.equal(verifyUnresolvedConfigReviewV3(input), false);
  }
});

test("accepts Python capped lead fixture and rejects rehashed count drift", () => {
  const input = fixture(cappedFixtureBrotliBase64);
  assert.equal((input.result as any).contentHash, cappedContentHash);
  assert.equal(verifyUnresolvedConfigReviewV3(input), true);
  const target = row(input, "IOS4-078");
  assert.deepEqual([target.eligibleSourceCount, target.textCandidatePageCount,
    target.ocrRequiredPageCount, target.oversizeAnchorLineCount,
    target.leadCount, target.truncatedLeadCount, target.leads.length],
  [1, 1, 1, 1, 20, 4, 16]);
  assert.equal(target.reasonCodes.includes("LEAD_LIMIT_REACHED"), true);
  for (const change of [
    (row: any) => { row.leadCount = 16; row.truncatedLeadCount = 0;
      row.reasonCodes = row.reasonCodes.filter((reason: string) => reason !== "LEAD_LIMIT_REACHED"); },
    (row: any) => { row.oversizeAnchorLineCount = 0;
      row.reasonCodes = row.reasonCodes.filter((reason: string) =>
        reason !== "OVERSIZE_ANCHOR_LINE_DEFERRED"); },
    (row: any) => { row.ocrRequiredPageCount = 0;
      row.reasonCodes = row.reasonCodes.filter((reason: string) =>
        reason !== "OCR_REQUIRED_DEFERRED"); },
  ]) {
    const tampered = fixture(cappedFixtureBrotliBase64);
    change(row(tampered, "IOS4-078"));
    rehashResult(tampered);
    assert.equal(verifyUnresolvedConfigReviewV3(tampered), false);
  }
});
