import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyMaterialClassReview,
  type MaterialClassReviewVerificationInput } from "../src/material-class-review.js";

// Python worker fixture: synthetic approved PD/RD KR text with grade, rebar,
// fire requirement and protection mentions, plus one deferred OCR page.
const workerFixtureBrotliBase64 = "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";
const workerContentHash = "cc5bd9a13786c8d2d625df1b9b938f3348fbf698135ebe7e0b49d2279cfd8a04";

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture(): MaterialClassReviewVerificationInput {
  const f = JSON.parse(brotliDecompressSync(
    Buffer.from(workerFixtureBrotliBase64, "base64")).toString("utf8")) as any;
  const reviewHash = "d".repeat(64);
  return { objectId: f.objectId, inputManifestHash: f.inputManifestHash,
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

function rehashResult(input: MaterialClassReviewVerificationInput): void {
  const result = input.result as any;
  const { contentHash: _old, ...body } = result;
  result.contentHash = sha256(workerJson(body));
}

function rehashLead(lead: any): void {
  const { leadSha256: _old, ...body } = lead;
  lead.leadSha256 = sha256(workerJson(body));
}

test("accepts independent worker fixture with unlinked grade and fire contexts", () => {
  const input = fixture();
  assert.equal((input.result as any).contentHash, workerContentHash);
  assert.equal(verifyMaterialClassReview(input), true);
  const rows = (input.result as any).codeRows;
  assert.deepEqual(rows.map((row: any) => row.leadCount), [2, 2, 5]);
  assert.equal(rows.every((row: any) => row.status === "ABSTAIN"), true);
  assert.equal(rows[2].leads.every((lead: any) =>
    lead.actualProtectionStatus === "NOT_ESTABLISHED"), true);
});

test("rejects rehashed element linkage, claimed protection, forged category and false zero", () => {
  const changes: Array<(input: MaterialClassReviewVerificationInput) => void> = [
    (input) => { const lead = (input.result as any).codeRows[0].leads[0];
      lead.leadKind = "TABLE_HEADING_UNLINKED"; rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[1].leads[0];
      lead.elementAssociationStatus = "VERIFIED"; rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[1].leads[0];
      lead.crossFileMatchStatus = "VERIFIED"; rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[2].leads[0];
      lead.actualProtectionStatus = "ESTABLISHED"; rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[2].leads[0];
      lead.lineText = "REI 999"; lead.lineTextSha256 = sha256(lead.lineText);
      rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[0].leads[0];
      lead.pageNumber += 1; rehashLead(lead); },
    (input) => { const row = (input.result as any).codeRows[2];
      row.leads = []; row.leadCount = 0;
      row.reasonCodes = [...row.reasonCodes, "NO_EXACT_LINE_LEAD"].sort(); },
    (input) => { (input.result as any).codeRows[1].ocrRequiredPageCount = 0; },
    (input) => { (input.result as any).codeRows[0].status = "PASS"; },
    (input) => { (input.result as any).findingCount = 1; },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    rehashResult(input);
    assert.equal(verifyMaterialClassReview(input), false);
  }
});

test("rejects stale KR review, wrong stage/section, text digest and manifest", () => {
  const changes: Array<(input: MaterialClassReviewVerificationInput) => void> = [
    (input) => { input.sourceReviews["F-PD"].approvalStatus = "UNAPPROVED"; },
    (input) => { input.sourceReviews["F-RD"].decisionHash = "e".repeat(64); },
    (input) => { input.sourceFiles[0].sectionCode = "OV"; },
    (input) => { input.sourceFiles[1].stages = ["ID"]; },
    (input) => { delete input.textArtifacts["F-PD"]; },
    (input) => { input.textArtifacts["F-RD"].content_hash = "f".repeat(64); },
    (input) => { input.inputManifestHash = "b".repeat(64); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifyMaterialClassReview(input), false);
  }
});
