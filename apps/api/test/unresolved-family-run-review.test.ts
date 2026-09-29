import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyUnresolvedFamilyRunReview } from "../src/unresolved-family-run-review.js";
import { buildPilotPz002Pz017ReleaseManifest } from "../src/postgres-repository.js";

const sourceSha = "a".repeat(64);
const blockText = "Высота дверного проема 2,1 м";
const box = [10, 20, 300, 60];
const artifact = {
  schemaVersion: "document-text-v2", sourceFileId: "F-AR", inputSha256: sourceSha,
  pageCount: 1, pages: [{ pageNumber: 1,
    quality: { disposition: "TEXT_LAYER_CANDIDATE" },
    blocks: [{ text: blockText, bboxMilliPoints: box }] }],
};
const artifactSha = sha256(canonicalJson(artifact));
const leadContent = { sourceFileId: "F-AR", sourceSha256: sourceSha,
  textArtifactSha256: artifactSha, pageNumber: 1, blockIndex: 0,
  lineIndex: 0, lineText: blockText, blockTextSha256: sha256(blockText),
  bboxMilliPoints: box };
const lead = { ...leadContent, leadSha256: sha256(canonicalJson(leadContent)) };
const row = (parameterCode: string, leads: unknown[] = []) => ({ parameterCode,
  status: "ABSTAIN", reasonCodes: leads.length
    ? ["LEAD_NOT_VERIFIED_FACT"]
    : ["LEAD_NOT_VERIFIED_FACT", "NO_EXACT_LINE_LEAD"], leads });
const content = (leads: unknown[] = []) => ({
  schemaVersion: "unresolved-family-run-review-v1",
  profileId: "unresolved-family-text-review-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ", inputManifestHash: "m".repeat(64),
  sourceStageArtifacts: [{ sourceFileId: "F-AR", sourceSha256: sourceSha,
    textArtifactSha256: artifactSha }],
  codeRows: [row("AR-042", leads), row("IOS2-072"), row("IOS3-075")],
  findingCount: null, parameterCoverage: null,
});
const hashed = (value: Record<string, unknown>) => ({
  ...value, contentHash: sha256(canonicalJson(value)),
});
const input = (result: unknown) => ({ objectId: "OBJ", inputManifestHash: "m".repeat(64),
  sourceFiles: [{ sourceFileId: "F-AR", objectId: "OBJ", sha256: sourceSha,
    stages: ["PD"], sourceReviewHash: "b".repeat(64), sectionCode: "AR" }],
  sourceReviews: { "F-AR": { sourceSha256: sourceSha, revisionStatus: "CURRENT",
    approvalStatus: "APPROVED", pageStages: {}, contentHash: "b".repeat(64),
    decisionHash: "b".repeat(64) } },
  textArtifacts: { "F-AR": { content_json: artifact, content_hash: artifactSha } },
  result,
});

test("pinned run review accepts only original lexical line and still abstains", () => {
  assert.equal(verifyUnresolvedFamilyRunReview(input(hashed(content([lead])))), true);
  assert.equal(verifyUnresolvedFamilyRunReview(input(hashed(content()))), true);
  assert.equal(verifyUnresolvedFamilyRunReview({ ...input(hashed(content([lead]))),
    sourceReviews: { "F-AR": { ...input(null).sourceReviews["F-AR"],
      approvalStatus: "UNKNOWN" } } }), false);
});

test("rehashed forged line, page, source, and finding are rejected", () => {
  for (const patch of [
    { lineText: "Высота коридора 2,8 м" },
    { pageNumber: 2 },
    { bboxMilliPoints: [10, 20, 301, 60] },
    { sourceSha256: "c".repeat(64) },
  ]) {
    const altered = { ...leadContent, ...patch };
    const forged = { ...altered, leadSha256: sha256(canonicalJson(altered)) };
    assert.equal(verifyUnresolvedFamilyRunReview(input(hashed(content([forged])))), false);
  }
  assert.equal(verifyUnresolvedFamilyRunReview(input(hashed({ ...content([lead]),
    findingCount: 1 }))), false);
});

test("new release profile is opt-in and pins 9-output lexical aid", () => {
  const old = buildPilotPz002Pz017ReleaseManifest(125, "V6", "V5", true,
    true, true, true, true, "v3");
  const next = buildPilotPz002Pz017ReleaseManifest(125, "V6", "V5", true,
    true, true, true, true, "v3", false, true);
  assert.notEqual(old.manifest.releaseId, next.manifest.releaseId);
  assert.equal(next.manifest.providerSlots.find((slot) => slot.stageJobType === "RULE_EVALUATION")?.profileId,
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3-unresolved-review-v1");
  assert.throws(() => buildPilotPz002Pz017ReleaseManifest(125, "V6", "V5", true,
    true, true, true, true, "v2", false, true));
});

test("Python worker fixture with three source-bound leads passes independent API verifier", () => {
  const fixture = JSON.parse(readFileSync(new URL(
    "./fixtures/unresolved-family-run-review-cross-language.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture.result.codeRows.map((row: { leads: unknown[] }) => row.leads.length),
    [1, 1, 1]);
  assert.equal(verifyUnresolvedFamilyRunReview(fixture), true);
  fixture.result.codeRows[1].leads[0].lineText = "Труба ПВХ, но другая сеть";
  const { contentHash: _previous, ...body } = fixture.result;
  fixture.result.contentHash = sha256(canonicalJson(body));
  assert.equal(verifyUnresolvedFamilyRunReview(fixture), false);
});
