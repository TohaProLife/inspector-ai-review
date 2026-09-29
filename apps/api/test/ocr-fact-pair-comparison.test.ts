import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { buildOcrFactPairComparisonPreview,
  type OcrFactPairComparisonContext } from "../src/ocr-fact-pair-comparison.js";
import { validateOcrFactPairReview, type OcrFactPairReviewInput,
  type OcrFactPairReviewVerificationContext } from "../src/ocr-fact-pair-review.js";
import type { OcrTypedFactV2 } from "../src/ocr-typed-fact-v2.js";

const h = (letter: string) => letter.repeat(64);
const manifest = h("1");
function source(stage: "PD" | "RD") {
  const sourceFileId = `FILE-${stage}`;
  const sourceSha256 = h(stage === "PD" ? "2" : "3");
  const decision = {
    id: `SR-${stage}`, objectId: "OBJECT-1", sourceFileId,
    sourceSha256, actorId: "REVIEWER-1", createdAt: "2026-01-01T00:00:00.000Z",
    revisionStatus: "CURRENT" as const, approvalStatus: "APPROVED" as const,
    linkGroupId: "building-1", sectionCode: stage === "PD" ? "PZ" as const : "AR" as const,
    pageStages: {}, basis: { reference: "Synthetic source" }, contentHash: "",
  };
  decision.contentHash = sha256(canonicalJson({
    objectApiId: decision.objectId, sourceFileApiId: sourceFileId,
    sourceSha256, revisionStatus: decision.revisionStatus,
    approvalStatus: decision.approvalStatus, linkGroupId: decision.linkGroupId,
    sectionCode: decision.sectionCode, pageStages: decision.pageStages,
    basis: decision.basis, actorId: decision.actorId,
  }));
  return decision;
}

function fact(stage: "PD" | "RD", decision: ReturnType<typeof source>,
  rawValue: string, rawUnit = "м²"): OcrTypedFactV2 {
  const body: Omit<OcrTypedFactV2, "factId"> = {
    schemaVersion: "typed-fact-v2", targetCheckId: "TARGET-1",
    inputManifestHash: manifest, objectId: "OBJECT-1",
    sourceFileId: decision.sourceFileId, sourceSha256: decision.sourceSha256,
    stage, pageNumber: stage === "PD" ? 1 : 2,
    parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
    entityKey: "building-1", context: "whole building",
    rawText: `Area\t${rawValue} ${rawUnit}`, rawValue, rawUnit,
    locator: {
      kind: "OCR_ROW", originInputManifestHash: h("4"),
      ocrPageContentHash: h("5"), renderSha256: h("6"),
      ocrStageSha256: h("7"), tableRowsContentHash: h("8"),
      rowFingerprint: h(stage === "PD" ? "9" : "a"),
      transcriptionDecisionId: `TR-${stage}`, transcriptionDecisionHash: h("b"),
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

function fixture(pdRaw = "100", rdRaw = "102", rawUnit = "м²"):
  OcrFactPairComparisonContext {
  const pdSource = source("PD");
  const rdSource = source("RD");
  const pd = fact("PD", pdSource, pdRaw, rawUnit);
  const rd = fact("RD", rdSource, rdRaw, rawUnit);
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
    objectId: "OBJECT-1", parameterCode: "PZ-002",
    attribute: "BUILDING_TOTAL_AREA", pdFactId: pd.factId,
    pdLocatorHash: sha256(canonicalJson(pd.locator)), rdFactId: rd.factId,
    rdLocatorHash: sha256(canonicalJson(rd.locator)), entityKey: "building-1",
    context: "whole building", linkGroupId: "building-1",
    basis: "Synthetic reviewed scalar pair and building scope.",
  };
  const validated = validateOcrFactPairReview(review, pair);
  if (!validated) throw new Error("Invalid synthetic pair fixture");
  const actorId = "REVIEWER-1";
  return { pair, snapshots: [{ decisionId: "PAIR-1",
    decisionContentHash: h("e"), originCheckId: "ORIGIN-1",
    targetCheckId: "TARGET-1", review,
    provenance: validated.provenance, eligibleForPairReview: true, actorId,
    targetReviewHash: sha256(canonicalJson({ checkId: "TARGET-1",
      objectId: "OBJECT-1", ...validated, actorId })) }],
  latestDecisionId: "PAIR-1", catalog: {
    candidateRulePackSha256: "a3ad00a04865f04bfeef5c2f21f5a11054fec88dcab264590fdb66d70a968581",
    parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
    family: "RELATIVE_DELTA", canonicalUnit: "m2", aggregation: "PER_ATTRIBUTE",
    threshold: { value: "1", unit: "percent", strict: true },
  }, quantity: { targetCheckId: "TARGET-1", inputManifestHash: manifest,
    objectId: "OBJECT-1", parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
    entityKey: "building-1", context: "whole building", pdFactId: pd.factId,
    rdFactId: rd.factId, pdLocatorHash: review.pdLocatorHash,
    rdLocatorHash: review.rdLocatorHash, semantics: "SAME_SCALAR_TOTAL",
    denominator: "PD", evidenceHash: h("f") } };
}

describe("OCR_ROW typed-fact-v2 comparison preview", () => {
  it("derives exact, review-only percent comparison from confirmed target pair", () => {
    const result = buildOcrFactPairComparisonPreview(fixture());
    expect(result).toMatchObject({ purpose: "REVIEW_ONLY",
      status: "COMPARISON_CANDIDATE", comparison: {
        pdValue: "100", rdValue: "102", thresholdPercent: "1",
        observedPercent: { numerator: "2", denominator: "1" },
        exceedsThreshold: true } });
    expect(result).not.toHaveProperty("finding");
    expect(result).not.toHaveProperty("coverage");
    expect(buildOcrFactPairComparisonPreview(fixture("100", "101"))
      .comparison?.exceedsThreshold).toBe(false);
  });

  it("latest rejection or UNSURE suppresses earlier confirmation", () => {
    for (const decision of ["PAIR_REJECTED", "UNSURE"] as const) {
      const input = fixture();
      const newest = structuredClone(input.snapshots[0]);
      if (!newest.review) throw new Error("fixture");
      newest.decisionId = `LATEST-${decision}`;
      newest.review.decision = decision;
      newest.eligibleForPairReview = false;
      input.snapshots = [input.snapshots[0], newest];
      input.latestDecisionId = newest.decisionId;
      expect(buildOcrFactPairComparisonPreview(input)).toMatchObject({
        status: "ABSTAIN", reasonCode: "PAIR_NOT_CONFIRMED", comparison: null });
    }
  });

  it("rejects origin IDs, forged locator, artifact, source, and projection hashes", () => {
    const changes: Array<(input: OcrFactPairComparisonContext) => void> = [
      (input) => { input.snapshots[0].review!.pdFactId = h("0"); },
      (input) => { input.snapshots[0].review!.rdLocatorHash = h("0"); },
      (input) => { input.pair.artifact.content.items[0].rawValue = "999"; },
      (input) => { input.pair.sourceReviews.PD.decision.approvalStatus = "UNAPPROVED"; },
      (input) => { input.snapshots[0].targetReviewHash = h("0"); },
      (input) => { input.snapshots[0].targetCheckId = "ORIGIN-1"; },
    ];
    for (const change of changes) {
      const input = fixture();
      change(input);
      expect(buildOcrFactPairComparisonPreview(input).status).toBe("ABSTAIN");
    }
  });

  it("abstains on ambiguous units, missing quantity semantics or threshold drift", () => {
    const quantity = fixture();
    quantity.quantity = null;
    expect(buildOcrFactPairComparisonPreview(quantity).reasonCode)
      .toBe("QUANTITY_CONTEXT_UNVERIFIED");
    const unit = fixture("100", "102", "кв.?");
    expect(buildOcrFactPairComparisonPreview(unit).reasonCode).toBe("UNIT_AMBIGUOUS");
    const threshold = fixture();
    threshold.catalog.threshold = { value: "0", unit: "percent", strict: true };
    expect(buildOcrFactPairComparisonPreview(threshold).reasonCode)
      .toBe("CATALOG_RULE_UNSUPPORTED");
    const zero = fixture("0", "2");
    expect(buildOcrFactPairComparisonPreview(zero).reasonCode)
      .toBe("QUANTITY_VALUE_UNUSABLE");
  });

  it("public F0202 has no confirmed target pair snapshot and abstains", () => {
    const input = fixture();
    input.pair.targetCheckId = "F0202";
    input.snapshots = [];
    input.latestDecisionId = "";
    expect(buildOcrFactPairComparisonPreview(input).status).toBe("ABSTAIN");
  });
});
