import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { validateOcrFactPairReview, type OcrFactPairReviewInput,
  type OcrFactPairReviewVerificationContext } from "../src/ocr-fact-pair-review.js";
import type { OcrTypedFactV2 } from "../src/ocr-typed-fact-v2.js";

const h = (letter: string) => letter.repeat(64);
const manifestHash = h("1");

function sourceReview(sourceFileId: string, sourceSha256: string,
  sectionCode: "PZ" | "AR", stage: "PD" | "RD") {
  const decision = {
    id: `SR-${stage}`, objectId: "OBJ-1", sourceFileId,
    sourceSha256, actorId: "REVIEWER-1", createdAt: "2026-01-01T00:00:00.000Z",
    revisionStatus: "CURRENT" as const, approvalStatus: "APPROVED" as const,
    linkGroupId: "building-1", sectionCode, pageStages: {},
    basis: { reference: "Синтетический титульный лист и ведомость." },
    contentHash: "",
  };
  decision.contentHash = sha256(canonicalJson({
    objectApiId: "OBJ-1", sourceFileApiId: sourceFileId,
    sourceSha256, revisionStatus: decision.revisionStatus,
    approvalStatus: decision.approvalStatus, linkGroupId: decision.linkGroupId,
    sectionCode, pageStages: decision.pageStages,
    basis: decision.basis, actorId: decision.actorId,
  }));
  return decision;
}

function fact(stage: "PD" | "RD", decision: ReturnType<typeof sourceReview>): OcrTypedFactV2 {
  const body: Omit<OcrTypedFactV2, "factId"> = {
    schemaVersion: "typed-fact-v2", targetCheckId: "CHK-TARGET",
    inputManifestHash: manifestHash, objectId: "OBJ-1",
    sourceFileId: decision.sourceFileId, sourceSha256: decision.sourceSha256,
    stage, pageNumber: stage === "PD" ? 4 : 9,
    parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
    entityKey: "building-1", context: "Здание целиком",
    rawText: "Общая площадь здания\t84,9 м²", rawValue: "84,9", rawUnit: "м²",
    locator: {
      kind: "OCR_ROW", originInputManifestHash: h("2"),
      ocrPageContentHash: h("3"), renderSha256: h("4"),
      ocrStageSha256: h("5"), tableRowsContentHash: h("6"),
      rowFingerprint: stage === "PD" ? h("7") : h("8"),
      transcriptionDecisionId: `TR-${stage}`, transcriptionDecisionHash: h("9"),
      sourceReviewDecisionId: decision.id,
      sourceReviewDecisionHash: decision.contentHash,
      applicabilityDecisionId: `APP-${stage}`, applicabilityDecisionHash: h("a"),
      targetSnapshotHash: h("b"), originCheckId: "CHK-ORIGIN",
      sectionCode: decision.sectionCode,
      labelEvidence: { lineIndex: 1 }, valueEvidence: { lineIndex: 2 },
    },
  };
  return { factId: sha256(canonicalJson(body)), ...body };
}

function fixture() {
  const pdReview = sourceReview("FIL-PD", h("c"), "PZ", "PD");
  const rdReview = sourceReview("FIL-RD", h("d"), "AR", "RD");
  const pd = fact("PD", pdReview);
  const rd = fact("RD", rdReview);
  const content = {
    schemaVersion: "ocr-typed-fact-candidates-v1" as const, items: [pd, rd],
    snapshotCount: 2, abstainedCount: 0, findingCount: 0 as const,
    coverageCount: 0 as const,
  };
  const context: OcrFactPairReviewVerificationContext = {
    targetCheckId: "CHK-TARGET", inputManifestHash: manifestHash,
    objectId: "OBJ-1", releaseProfile: "ocr-typed-fact-candidates-v1",
    artifact: { content, contentHash: sha256(canonicalJson(content)) },
    sourceReviews: {
      PD: { targetCheckId: "CHK-TARGET", decision: pdReview },
      RD: { targetCheckId: "CHK-TARGET", decision: rdReview },
    },
  };
  const input: OcrFactPairReviewInput = {
    schemaVersion: "ocr-fact-pair-review-v1", decision: "PAIR_CONFIRMED",
    targetCheckId: "CHK-TARGET", inputManifestHash: manifestHash,
    objectId: "OBJ-1", parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
    pdFactId: pd.factId, pdLocatorHash: sha256(canonicalJson(pd.locator)),
    rdFactId: rd.factId, rdLocatorHash: sha256(canonicalJson(rd.locator)),
    entityKey: "building-1", context: "Здание целиком",
    linkGroupId: "building-1",
    basis: "Синтетический тест: сверены объект, граница здания, ревизии и листы ПД/РД.",
  };
  return { context, input };
}

function refreshArtifact(context: OcrFactPairReviewVerificationContext) {
  context.artifact.contentHash = sha256(canonicalJson(context.artifact.content));
}

describe("OCR_ROW fact pair review-only validator", () => {
  it("accepts explicit synthetic PD/RD pair from trusted run-local artifact", () => {
    const { context, input } = fixture();
    const result = validateOcrFactPairReview(input, context);
    expect(result).toMatchObject({ eligibleForPairReview: true,
      provenance: { artifactHash: context.artifact.contentHash,
        pdSourceFileId: "FIL-PD", rdSourceFileId: "FIL-RD" } });
    expect(result).not.toHaveProperty("comparison");
    expect(result).not.toHaveProperty("finding");
    expect(result).not.toHaveProperty("coverage");
  });

  it("allows recorded negative or unsure judgment but never marks pair eligible", () => {
    for (const decision of ["PAIR_REJECTED", "UNSURE"] as const) {
      const { context, input } = fixture();
      input.decision = decision;
      expect(validateOcrFactPairReview(input, context)?.eligibleForPairReview).toBe(false);
    }
  });

  it("rejects forged fact body, locator, artifact hash and non-OCR locator", () => {
    const { context, input } = fixture();
    expect(validateOcrFactPairReview({ ...input, pdFact: context.artifact.content.items[0] },
      context)).toBeNull();
    expect(validateOcrFactPairReview({ ...input, pdLocatorHash: h("f") },
      context)).toBeNull();
    const stale = structuredClone(context);
    stale.artifact.contentHash = h("f");
    expect(validateOcrFactPairReview(input, stale)).toBeNull();
    const forged = structuredClone(context);
    forged.artifact.content.items[0].rawValue = "999";
    refreshArtifact(forged);
    expect(validateOcrFactPairReview(input, forged)).toBeNull();
    const wrongLocator = structuredClone(context);
    (wrongLocator.artifact.content.items[0].locator as { kind: string }).kind = "TEXT_BLOCK";
    refreshArtifact(wrongLocator);
    expect(validateOcrFactPairReview(input, wrongLocator)).toBeNull();
  });

  it("rejects wrong run, object, profile, code, attribute, entity and context", () => {
    for (const field of ["targetCheckId", "objectId", "parameterCode", "attribute",
      "entityKey", "context"] as const) {
      const { context, input } = fixture();
      const changed = { ...input, [field]: "wrong" };
      expect(validateOcrFactPairReview(changed, context)).toBeNull();
    }
    const { context, input } = fixture();
    expect(validateOcrFactPairReview(input,
      { ...context, releaseProfile: "other" as never })).toBeNull();
  });

  it("rejects wrong source SHA, CURRENT/APPROVED, link group and pinned sections", () => {
    const changes: Array<(context: OcrFactPairReviewVerificationContext) => void> = [
      (context) => { context.sourceReviews.RD.decision.sourceSha256 = h("e"); },
      (context) => { context.sourceReviews.PD.decision.revisionStatus = "UNKNOWN"; },
      (context) => { context.sourceReviews.RD.decision.approvalStatus = "UNAPPROVED"; },
      (context) => { context.sourceReviews.RD.decision.linkGroupId = "other"; },
      (context) => { context.sourceReviews.PD.decision.sectionCode = "AR"; },
      (context) => { context.sourceReviews.RD.targetCheckId = "CHK-OTHER"; },
    ];
    for (const change of changes) {
      const { context, input } = fixture();
      change(context);
      expect(validateOcrFactPairReview(input, context)).toBeNull();
    }
    const { context, input } = fixture();
    context.artifact.content.items[1].sourceSha256 = context.artifact.content.items[0].sourceSha256;
    refreshArtifact(context);
    expect(validateOcrFactPairReview(input, context)).toBeNull();
  });
});
