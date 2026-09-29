import assert from "node:assert/strict";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifySiteTepAreaReview,
  type SiteTepAreaReviewVerificationInput } from "../src/site-tep-area-review.js";

const sourceSha = "a".repeat(64);
const reviewSha = "b".repeat(64);
const manifestSha = "c".repeat(64);
const sourceId = "F-GP";
const labels = ["1 Площадь застройки*", "3.  Площадь покрытий, в том числе:",
  "Площадь озеленения*, в т. ч.:"];

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture(): SiteTepAreaReviewVerificationInput {
  const blocks = labels.map((text, index) => ({ text,
    bboxMilliPoints: [100, index * 100 + 10, 600, index * 100 + 40] }));
  const artifact = { schemaVersion: "document-text-v2", sourceFileId: sourceId,
    inputSha256: sourceSha, pageCount: 2,
    pages: [{ pageNumber: 1, quality: { disposition: "TEXT_LAYER_CANDIDATE" }, blocks },
      { pageNumber: 2, quality: { disposition: "OCR_REQUIRED" }, blocks: [] }] };
  const artifactSha = sha256(canonicalJson(artifact));
  const codes = ["PZ-001", "SPZU-026", "SPZU-027"];
  const rows = codes.map((parameterCode, index) => {
    const body = { sourceFileId: sourceId, sourceSha256: sourceSha,
      textArtifactSha256: artifactSha, pageNumber: 1, blockIndex: index,
      lineIndex: 0, lineText: labels[index], blockTextSha256: sha256(labels[index]),
      bboxMilliPoints: blocks[index].bboxMilliPoints, sourceRole: "PD_GP_TEP" };
    const lead = { ...body, leadSha256: sha256(workerJson(body)) };
    const reasonCodes = ["LEAD_NOT_VERIFIED_FACT", "OCR_REQUIRED_IN_SCOPE"];
    if (parameterCode === "SPZU-026") reasonCodes.push("PAVING_MATERIAL_UNRESOLVED");
    return { parameterCode, status: "ABSTAIN", reasonCodes,
      eligibleSourceCount: 1, textCandidatePageCount: 1,
      ocrRequiredPageCount: 1, leadCount: 1, leads: [lead] };
  });
  const resultBody = { schemaVersion: "site-tep-area-run-review-v1",
    profileId: "site-tep-area-text-review-v1", purpose: "REVIEW_ONLY",
    objectId: "OBJ", inputManifestHash: manifestSha,
    sourceStageArtifacts: [{ sourceFileId: sourceId, sourceSha256: sourceSha,
      textArtifactSha256: artifactSha }], codeRows: rows,
    findingCount: null, parameterCoverage: null };
  const result = { ...resultBody, contentHash: sha256(workerJson(resultBody)) };
  return { objectId: "OBJ", inputManifestHash: manifestSha,
    sourceFiles: [{ sourceFileId: sourceId, objectId: "OBJ", sha256: sourceSha,
      stages: ["PD"], sourceReviewHash: reviewSha, sectionCode: "GP" }],
    sourceReviews: { [sourceId]: { sourceSha256: sourceSha,
      revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      sectionCode: "GP", pageStages: {}, contentHash: reviewSha,
      decisionHash: reviewSha } },
    textArtifacts: { [sourceId]: { content_json: artifact, content_hash: artifactSha } },
    result };
}

function rehashResult(input: SiteTepAreaReviewVerificationInput): void {
  const result = input.result as any;
  for (const row of result.codeRows) for (const lead of row.leads) {
    const { leadSha256: _oldLead, ...body } = lead;
    lead.leadSha256 = sha256(workerJson(body));
  }
  const { contentHash: _oldResult, ...body } = result;
  result.contentHash = sha256(workerJson(body));
}

test("accepts synthetic PD/GP table labels as review-only leads with exact counters", () => {
  assert.equal(verifySiteTepAreaReview(fixture()), true);
});

test("rejects rehashed forged locator, line, role, counts, and finding", () => {
  const changes: Array<(input: SiteTepAreaReviewVerificationInput) => void> = [
    (input) => { (input.result as any).codeRows[0].leads[0].lineText = "Площадь застройки 999"; },
    (input) => { (input.result as any).codeRows[1].leads[0].pageNumber = 2; },
    (input) => { (input.result as any).codeRows[2].leads[0].sourceRole = "RD_GP_TEP"; },
    (input) => { (input.result as any).codeRows[0].leads[0].bboxMilliPoints[2] += 1; },
    (input) => { (input.result as any).codeRows[1].leadCount = 0; },
    (input) => { (input.result as any).codeRows[1].ocrRequiredPageCount = 0; },
    (input) => { (input.result as any).findingCount = 1; },
    (input) => { (input.result as any).codeRows[1].reasonCodes.pop(); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    rehashResult(input);
    assert.equal(verifySiteTepAreaReview(input), false);
  }
});

test("rejects stale source review, wrong stage, missing artifact and changed manifest", () => {
  const changes: Array<(input: SiteTepAreaReviewVerificationInput) => void> = [
    (input) => { input.sourceReviews[sourceId].approvalStatus = "UNAPPROVED"; },
    (input) => { input.sourceReviews[sourceId].contentHash = "d".repeat(64); },
    (input) => { input.sourceFiles[0].stages = ["RD"]; },
    (input) => { input.sourceFiles[0].sectionCode = "SPZU"; },
    (input) => { delete input.textArtifacts[sourceId]; },
    (input) => { input.inputManifestHash = "d".repeat(64); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifySiteTepAreaReview(input), false);
  }
});

test("accepts explicit abstention when no source has current approved review", () => {
  const input = fixture();
  input.sourceReviews[sourceId].approvalStatus = "UNKNOWN";
  delete input.textArtifacts[sourceId];
  const result = input.result as any;
  result.sourceStageArtifacts = [];
  for (const row of result.codeRows) {
    row.reasonCodes = ["LEAD_NOT_VERIFIED_FACT", "NO_ELIGIBLE_REVIEWED_SOURCE",
      "NO_EXACT_LINE_LEAD", "SOURCE_REVIEW_REQUIRED"];
    if (row.parameterCode === "SPZU-026") {
      row.reasonCodes.splice(3, 0, "PAVING_MATERIAL_UNRESOLVED");
    }
    row.eligibleSourceCount = row.textCandidatePageCount = row.ocrRequiredPageCount = 0;
    row.leadCount = 0;
    row.leads = [];
  }
  rehashResult(input);
  assert.equal(verifySiteTepAreaReview(input), true);
});
