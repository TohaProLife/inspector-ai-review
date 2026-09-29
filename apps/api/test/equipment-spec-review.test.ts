import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyEquipmentSpecReview,
  type EquipmentSpecReviewVerificationInput } from "../src/equipment-spec-review.js";

// Python worker fixture: synthetic reviewed PD/OV pages with schedule,
// smoke calculation and change register contexts. No project PDF is included.
const workerFixtureBrotliBase64 = "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";
const workerContentHash = "69a738ad3b920c9b151525ab4bd69ef9b4bd00a1d71c51d77190df1dcec94343";

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture(): EquipmentSpecReviewVerificationInput {
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

function rehashResult(input: EquipmentSpecReviewVerificationInput): void {
  const result = input.result as any;
  const { contentHash: _old, ...body } = result;
  result.contentHash = sha256(workerJson(body));
}

function rehashLead(lead: any): void {
  const { leadSha256: _old, ...body } = lead;
  lead.leadSha256 = sha256(workerJson(body));
}

test("accepts independent worker fixture with exact schedule/calculation/register routing", () => {
  const input = fixture();
  assert.equal((input.result as any).contentHash, workerContentHash);
  assert.equal(verifyEquipmentSpecReview(input), true);
  const rows = (input.result as any).codeRows;
  assert.deepEqual(rows.map((row: any) => row.leadCount), [2, 1, 3]);
  assert.equal(rows.every((row: any) => row.status === "ABSTAIN"), true);
  assert.equal((input.result as any).findingCount, null);
});

test("rejects rehashed forged category, line, locator, status and false zero leads", () => {
  const changes: Array<(input: EquipmentSpecReviewVerificationInput) => void> = [
    (input) => { const lead = (input.result as any).codeRows[0].leads[0];
      lead.leadKind = "CALCULATION_PROSE"; rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[1].leads[0];
      lead.sourceStage = "RD"; rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[2].leads[0];
      lead.lineText = "вентилятор подменён"; lead.lineTextSha256 = sha256(lead.lineText);
      rehashLead(lead); },
    (input) => { const lead = (input.result as any).codeRows[0].leads[0];
      lead.bboxMilliPoints[0] += 1; rehashLead(lead); },
    (input) => { const row = (input.result as any).codeRows[2];
      row.leads = []; row.leadCount = 0;
      row.reasonCodes = [...row.reasonCodes, "NO_EXACT_LINE_LEAD"].sort(); },
    (input) => { (input.result as any).codeRows[1].leadCount = 0; },
    (input) => { (input.result as any).codeRows[0].status = "PASS"; },
    (input) => { (input.result as any).parameterCoverage = 1; },
    (input) => { (input.result as any).codeRows[2].reasonCodes.pop(); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    rehashResult(input);
    assert.equal(verifyEquipmentSpecReview(input), false);
  }
});

test("rejects stale source review, wrong section/stage, altered text and manifest", () => {
  const changes: Array<(input: EquipmentSpecReviewVerificationInput) => void> = [
    (input) => { input.sourceReviews["F-FIXTURE"].approvalStatus = "UNKNOWN"; },
    (input) => { input.sourceReviews["F-FIXTURE"].decisionHash = "e".repeat(64); },
    (input) => { input.sourceFiles[0].sectionCode = "GP"; },
    (input) => { input.sourceFiles[0].stages = ["ID"]; },
    (input) => { delete input.textArtifacts["F-FIXTURE"]; },
    (input) => { input.textArtifacts["F-FIXTURE"].content_hash = "f".repeat(64); },
    (input) => { input.inputManifestHash = "b".repeat(64); },
  ];
  for (const change of changes) {
    const input = fixture();
    change(input);
    assert.equal(verifyEquipmentSpecReview(input), false);
  }
});
