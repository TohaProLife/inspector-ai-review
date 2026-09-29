import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { validateOcrFactPairReview, type OcrFactPairReviewInput,
  type OcrFactPairReviewVerificationContext } from "../src/ocr-fact-pair-review.js";
import { ocrFactPairQuantityCatalogFor, validateOcrFactPairQuantityReview,
  type OcrFactPairQuantityReviewInput,
  type OcrFactPairQuantityReviewVerificationContext } from
  "../src/ocr-fact-pair-quantity-review.js";
import type { OcrTypedFactV2 } from "../src/ocr-typed-fact-v2.js";

const h = (letter: string) => letter.repeat(64);
const manifest = h("1");
function source(stage: "PD" | "RD", sectionCode: "PZ" | "AR" | "SM") {
  const sourceFileId = `FILE-${stage}`;
  const sourceSha256 = h(stage === "PD" ? "2" : "3");
  const decision = {
    id: `SOURCE-${stage}`, objectId: "OBJECT-1", sourceFileId,
    sourceSha256, actorId: "REVIEWER-1", createdAt: "2026-01-01T00:00:00.000Z",
    revisionStatus: "CURRENT" as const, approvalStatus: "APPROVED" as const,
    linkGroupId: "building-1", sectionCode, pageStages: {},
    basis: { reference: "Synthetic source review for unit test." }, contentHash: "",
  };
  decision.contentHash = sha256(canonicalJson({
    objectApiId: decision.objectId, sourceFileApiId: sourceFileId,
    sourceSha256, revisionStatus: decision.revisionStatus,
    approvalStatus: decision.approvalStatus, linkGroupId: decision.linkGroupId,
    sectionCode, pageStages: decision.pageStages, basis: decision.basis,
    actorId: decision.actorId,
  }));
  return decision;
}

function fact(stage: "PD" | "RD", decision: ReturnType<typeof source>,
  rawValue: string, rawUnit: string, parameterCode: string,
  attribute: string): OcrTypedFactV2 {
  const body: Omit<OcrTypedFactV2, "factId"> = {
    schemaVersion: "typed-fact-v2", targetCheckId: "TARGET-1",
    inputManifestHash: manifest, objectId: "OBJECT-1",
    sourceFileId: decision.sourceFileId, sourceSha256: decision.sourceSha256,
    stage, pageNumber: stage === "PD" ? 4 : 9,
    parameterCode, attribute,
    entityKey: "building-1", context: "whole building",
    rawText: `Total building area ${rawValue} ${rawUnit}`, rawValue, rawUnit,
    locator: {
      kind: "OCR_ROW", originInputManifestHash: h("4"),
      ocrPageContentHash: h("5"), renderSha256: h("6"),
      ocrStageSha256: h("7"), tableRowsContentHash: h("8"),
      rowFingerprint: h(stage === "PD" ? "9" : "a"),
      transcriptionDecisionId: `TRANS-${stage}`, transcriptionDecisionHash: h("b"),
      sourceReviewDecisionId: decision.id,
      sourceReviewDecisionHash: decision.contentHash,
      applicabilityDecisionId: `APP-${stage}`, applicabilityDecisionHash: h("c"),
      targetSnapshotHash: h("d"), originCheckId: "ORIGIN-1",
      sectionCode: decision.sectionCode, labelEvidence: { lineIndex: 1 },
      valueEvidence: { lineIndex: 2 },
    },
  };
  return { factId: sha256(canonicalJson(body)), ...body };
}

function fixture(pdValue = "100", rdValue = "102", unit = "м²",
  parameterCode = "PZ-002", attribute = "BUILDING_TOTAL_AREA") {
  const pdSource = source("PD", parameterCode === "SM-132" ? "SM" : "PZ");
  const rdSource = source("RD", parameterCode === "SM-132" ? "SM" : "AR");
  const pd = fact("PD", pdSource, pdValue, unit, parameterCode, attribute);
  const rd = fact("RD", rdSource, rdValue, unit, parameterCode, attribute);
  const content = { schemaVersion: "ocr-typed-fact-candidates-v1" as const,
    items: [pd, rd], snapshotCount: 2, abstainedCount: 0,
    findingCount: 0 as const, coverageCount: 0 as const };
  const pair: OcrFactPairReviewVerificationContext = {
    targetCheckId: "TARGET-1", inputManifestHash: manifest,
    objectId: "OBJECT-1", releaseProfile: "ocr-typed-fact-candidates-v1",
    artifact: { content, contentHash: sha256(canonicalJson(content)) },
    sourceReviews: {
      PD: { targetCheckId: "TARGET-1", decision: pdSource },
      RD: { targetCheckId: "TARGET-1", decision: rdSource },
    },
  };
  const review: OcrFactPairReviewInput = {
    schemaVersion: "ocr-fact-pair-review-v1", decision: "PAIR_CONFIRMED",
    targetCheckId: "TARGET-1", inputManifestHash: manifest,
    objectId: "OBJECT-1", parameterCode,
    attribute, entityKey: "building-1",
    context: "whole building", pdFactId: pd.factId,
    pdLocatorHash: sha256(canonicalJson(pd.locator)), rdFactId: rd.factId,
    rdLocatorHash: sha256(canonicalJson(rd.locator)), linkGroupId: "building-1",
    basis: "Synthetic pair confirmation for same building and revision.",
  };
  const validated = validateOcrFactPairReview(review, pair);
  if (!validated) throw new Error("Invalid synthetic pair fixture");
  const pairTargetReviewHash = sha256(canonicalJson({
    checkId: "TARGET-1", objectId: "OBJECT-1", ...validated,
    actorId: "REVIEWER-1",
  }));
  const catalog = ocrFactPairQuantityCatalogFor(parameterCode, attribute);
  if (!catalog) throw new Error("Missing pinned catalog fixture");
  const verification: OcrFactPairQuantityReviewVerificationContext = {
    pair, snapshots: [{ decisionId: "PAIR-1", decisionContentHash: h("e"),
      originCheckId: "ORIGIN-1", targetCheckId: "TARGET-1", actorId: "REVIEWER-1",
      targetReviewHash: pairTargetReviewHash, review,
      provenance: validated.provenance, eligibleForPairReview: true }],
    latestDecisionId: "PAIR-1", catalog,
  };
  const input: OcrFactPairQuantityReviewInput = {
    schemaVersion: "ocr-fact-pair-quantity-review-v1",
    decision: "SAME_SCALAR_TOTAL", targetCheckId: "TARGET-1",
    inputManifestHash: manifest, objectId: "OBJECT-1", parameterCode,
    attribute, entityKey: "building-1",
    context: "whole building", pdFactId: pd.factId,
    pdLocatorHash: review.pdLocatorHash, rdFactId: rd.factId,
    rdLocatorHash: review.rdLocatorHash, pairDecisionId: "PAIR-1",
    pairTargetReviewHash, pdDenominatorAffirmed: true,
    pdPageNumber: 4, rdPageNumber: 9,
    basis: { scope: "Same whole building boundary on both sheets.",
      quantityType: "Both values are total building area.",
      period: "Both values apply to same project revision period.",
      aggregation: "Each row is one scalar total, not a component." },
  };
  return { verification, input };
}

describe("OCR_ROW quantity semantics review validator", () => {
  it("accepts synthetic affirmative review and computes evidence from verified lineage", () => {
    const { verification, input } = fixture();
    const result = validateOcrFactPairQuantityReview(input, verification);
    expect(result).toMatchObject({ review: input, eligibleForComparison: true,
      provenance: { artifactHash: verification.pair.artifact.contentHash,
        pairDecisionId: "PAIR-1", pairTargetReviewHash: input.pairTargetReviewHash,
        candidateRulePackSha256: verification.catalog.candidateRulePackSha256,
        pdApplicabilityDecisionHash: h("c") } });
    expect(result?.evidenceHash).toBe(sha256(canonicalJson({
      review: result?.review, provenance: result?.provenance,
      eligibleForComparison: true,
    })));
    expect(result).not.toHaveProperty("finding");
    expect(result).not.toHaveProperty("coverage");
  });

  it("records negative and unsure decisions as ineligible", () => {
    for (const decision of ["NOT_COMPARABLE", "UNSURE"] as const) {
      const { verification, input } = fixture();
      input.decision = decision;
      input.pdDenominatorAffirmed = false;
      expect(validateOcrFactPairQuantityReview(input, verification)
        ?.eligibleForComparison).toBe(false);
    }
  });

  it("rejects client provenance, missing basis, missing affirmation and wrong pages", () => {
    const { verification, input } = fixture();
    expect(validateOcrFactPairQuantityReview({ ...input, evidenceHash: h("f") },
      verification)).toBeNull();
    expect(validateOcrFactPairQuantityReview({ ...input, artifactHash: h("f") },
      verification)).toBeNull();
    expect(validateOcrFactPairQuantityReview({ ...input, pdDenominatorAffirmed: false },
      verification)).toBeNull();
    expect(validateOcrFactPairQuantityReview({ ...input, pdPageNumber: 5 },
      verification)).toBeNull();
    expect(validateOcrFactPairQuantityReview({ ...input, basis: {
      ...input.basis, period: "unknown" } }, verification)).toBeNull();
    expect(validateOcrFactPairQuantityReview({ ...input, basis: {
      ...input.basis, aggregation: "" } }, verification)).toBeNull();
  });

  it("requires effective next-run confirmed pair and verified projection", () => {
    const changes: Array<(value: ReturnType<typeof fixture>) => void> = [
      (value) => { value.verification.latestDecisionId = "OTHER"; },
      (value) => { value.verification.snapshots = []; },
      (value) => { value.verification.snapshots[0].originCheckId = "TARGET-1"; },
      (value) => { value.verification.snapshots[0].targetReviewHash = h("f"); },
      (value) => { value.verification.snapshots[0].eligibleForPairReview = false; },
      (value) => { value.verification.snapshots[0].review!.decision = "PAIR_REJECTED"; },
      (value) => { value.input.pairDecisionId = "OTHER"; },
      (value) => { value.input.rdFactId = h("f"); },
    ];
    for (const change of changes) {
      const value = fixture();
      change(value);
      expect(validateOcrFactPairQuantityReview(value.input, value.verification))
        .toBeNull();
    }
  });

  it("rejects artifact/source drift, unsupported catalog or unit, and zero PD", () => {
    const changes: Array<(value: ReturnType<typeof fixture>) => void> = [
      (value) => { value.verification.pair.artifact.contentHash = h("f"); },
      (value) => { value.verification.pair.sourceReviews.PD.decision.approvalStatus = "UNAPPROVED"; },
      (value) => { value.verification.catalog.threshold = {
        value: "0", unit: "percent", strict: true }; },
      (value) => { value.input.parameterCode = "PZ-017"; },
    ];
    for (const change of changes) {
      const value = fixture();
      change(value);
      expect(validateOcrFactPairQuantityReview(value.input, value.verification))
        .toBeNull();
    }
    const unit = fixture("100", "102", "кв.?");
    expect(validateOcrFactPairQuantityReview(unit.input, unit.verification)).toBeNull();
    const zero = fixture("0", "102");
    expect(validateOcrFactPairQuantityReview(zero.input, zero.verification)).toBeNull();
  });

  it("requires separate price basis for cost rules", () => {
    expect(ocrFactPairQuantityCatalogFor("SM-132", "CONSTRUCTION_TOTAL_COST"))
      .toMatchObject({ canonicalUnit: "thousand_rub" });
    expect(ocrFactPairQuantityCatalogFor("PZ-017", "TOTAL_HEATING_LOAD"))
      .toBeNull();
    const { verification, input } = fixture("100", "102", "тыс. руб.",
      "SM-132", "CONSTRUCTION_TOTAL_COST");
    expect(validateOcrFactPairQuantityReview(input, verification)).toBeNull();
    input.basis.priceBasis = "Both estimates use same base year and price level.";
    expect(validateOcrFactPairQuantityReview(input, verification)
      ?.eligibleForComparison).toBe(true);
    input.basis.priceBasis = "unknown";
    expect(validateOcrFactPairQuantityReview(input, verification)).toBeNull();
  });
});
