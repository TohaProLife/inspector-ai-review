import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewSpecs } from "./candidate-family-preview.js";
import { candidateFamilyPreviewPolicy } from "./pilot-rules.js";
import { validateOcrFactPairReview,
  type OcrFactPairReviewVerificationContext } from "./ocr-fact-pair-review.js";
import type { OcrFactPairDecisionSnapshot,
  OcrFactPairComparisonContext } from "./ocr-fact-pair-comparison.js";

type Catalog = OcrFactPairComparisonContext["catalog"];
type Json = Record<string, unknown>;
const PACK = "a3ad00a04865f04bfeef5c2f21f5a11054fec88dcab264590fdb66d70a968581";
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const exact = (value: Json, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length > 0 && value === value.trim()
  && Buffer.byteLength(value, "utf8") <= limit && !/[\p{Cc}\p{Cf}]/u.test(value);
const explanation = (value: unknown): value is string =>
  text(value, 1000) && Array.from(value).length >= 12
  && !/^(?:unknown|unsure|n\/?a|none|нет|не знаю|неизвестно|не уверен|\?+|[-—]+)[.!?\s]*$/iu.test(value);

/** Exact relative-rule slice; no other catalog code gains quantity eligibility. */
const rules: Record<string, { family: "RELATIVE_DELTA" | "RELATIVE_INCREASE";
  threshold: string; attributes: Record<string, { unit: string; aliases: readonly string[] }> }> = {
  "PZ-002": { family: "RELATIVE_DELTA", threshold: "1", attributes: {
    BUILDING_TOTAL_AREA: { unit: "m2", aliases: ["m2", "m²", "м2", "м²", "кв.м", "кв. м"] },
  } },
  "SPZU-024": { family: "RELATIVE_DELTA", threshold: "5", attributes: {
    EXCAVATION_VOLUME: { unit: "m3", aliases: ["m3", "m³", "м3", "м³"] },
    BACKFILL_VOLUME: { unit: "m3", aliases: ["m3", "m³", "м3", "м³"] },
  } },
  "SPZU-025": { family: "RELATIVE_DELTA", threshold: "5", attributes: {
    HARD_SURFACE_AREA: { unit: "m2", aliases: ["m2", "m²", "м2", "м²", "кв.м", "кв. м"] },
  } },
  "KR-067": { family: "RELATIVE_DELTA", threshold: "2", attributes: {
    CONCRETE_VOLUME: { unit: "m3", aliases: ["m3", "m³", "м3", "м³"] },
    STEEL_MASS: { unit: "t", aliases: ["t", "т", "т."] },
  } },
  "POS-082": { family: "RELATIVE_INCREASE", threshold: "10", attributes: {
    CRITICAL_CONSTRUCTION_STAGE_DURATION: { unit: "day",
      aliases: ["day", "день", "дня", "дни", "сут", "сут.", "сутки"] },
  } },
  "POD-093": { family: "RELATIVE_DELTA", threshold: "5", attributes: {
    DEMOLITION_VOLUME_BY_TYPE: { unit: "m3", aliases: ["m3", "m³", "м3", "м³"] },
  } },
  "SM-132": { family: "RELATIVE_INCREASE", threshold: "5", attributes: {
    CONSTRUCTION_TOTAL_COST: { unit: "thousand_rub",
      aliases: ["thousand_rub", "тыс. руб.", "тыс руб.", "тыс.руб."] },
  } },
};

/** Deterministic pinned selection for loaders; null means unsupported rule/attribute. */
export function ocrFactPairQuantityCatalogFor(parameterCode: string,
  attribute: string): Catalog | null {
  const rule = Object.hasOwn(rules, parameterCode) ? rules[parameterCode] : null;
  const selected = rule && Object.hasOwn(rule.attributes, attribute)
    ? rule.attributes[attribute] : null;
  const spec = Object.hasOwn(candidateFamilyPreviewSpecs, parameterCode)
    ? candidateFamilyPreviewSpecs[parameterCode] : null;
  if (!rule || !selected || spec?.family !== rule.family
    || spec.attributes[attribute] !== selected.unit
    || candidateFamilyPreviewPolicy.candidateRulePackSha256 !== PACK) return null;
  return { candidateRulePackSha256: PACK, parameterCode, attribute,
    family: rule.family, canonicalUnit: selected.unit, aggregation: "PER_ATTRIBUTE",
    threshold: { value: rule.threshold, unit: "percent", strict: true } };
}

export interface OcrFactPairQuantityReviewInput {
  schemaVersion: "ocr-fact-pair-quantity-review-v1";
  decision: "SAME_SCALAR_TOTAL" | "NOT_COMPARABLE" | "UNSURE";
  targetCheckId: string;
  inputManifestHash: string;
  objectId: string;
  parameterCode: string;
  attribute: string;
  entityKey: string;
  context: string;
  pdFactId: string;
  pdLocatorHash: string;
  rdFactId: string;
  rdLocatorHash: string;
  pairDecisionId: string;
  pairTargetReviewHash: string;
  pdDenominatorAffirmed: boolean;
  pdPageNumber: number;
  rdPageNumber: number;
  basis: {
    scope: string;
    quantityType: string;
    period: string;
    aggregation: string;
    priceBasis?: string;
  };
}

/** Caller loads only verified target-run artifacts, source lineage and pair journal.
 * latestDecisionId must be the effective decision for this exact pair subject. */
export interface OcrFactPairQuantityReviewVerificationContext {
  pair: OcrFactPairReviewVerificationContext;
  snapshots: readonly OcrFactPairDecisionSnapshot[];
  latestDecisionId: string;
  catalog: Catalog;
}

export interface ValidatedOcrFactPairQuantityReview {
  review: OcrFactPairQuantityReviewInput;
  provenance: {
    artifactHash: string;
    pairDecisionId: string;
    pairDecisionContentHash: string;
    pairTargetReviewHash: string;
    candidateRulePackSha256: string;
    canonicalUnit: string;
    pdSourceFileId: string;
    pdSourceSha256: string;
    pdSourceReviewHash: string;
    pdApplicabilityDecisionHash: string;
    pdTargetSnapshotHash: string;
    rdSourceFileId: string;
    rdSourceSha256: string;
    rdSourceReviewHash: string;
    rdApplicabilityDecisionHash: string;
    rdTargetSnapshotHash: string;
  };
  eligibleForComparison: boolean;
  evidenceHash: string;
}

function numeric(value: unknown): boolean {
  return typeof value === "string" && value.length <= 120
    && /^(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?$/u.test(value);
}
function nonzero(value: string): boolean {
  return /[1-9]/u.test(value);
}

/** Pure human quantity gate. Positive output remains review-only, never a finding. */
export function validateOcrFactPairQuantityReview(value: unknown,
  verification: OcrFactPairQuantityReviewVerificationContext):
  ValidatedOcrFactPairQuantityReview | null {
  try {
    if (!record(value) || !record(verification) || !record(verification.pair)
      || !record(verification.catalog) || !Array.isArray(verification.snapshots)
      || verification.snapshots.length < 1 || verification.snapshots.length > 512
      || !exact(value, ["schemaVersion", "decision", "targetCheckId",
        "inputManifestHash", "objectId", "parameterCode", "attribute", "entityKey",
        "context", "pdFactId", "pdLocatorHash", "rdFactId", "rdLocatorHash",
        "pairDecisionId", "pairTargetReviewHash", "pdDenominatorAffirmed",
        "pdPageNumber", "rdPageNumber", "basis"])
      || value.schemaVersion !== "ocr-fact-pair-quantity-review-v1"
      || !["SAME_SCALAR_TOTAL", "NOT_COMPARABLE", "UNSURE"].includes(String(value.decision))
      || !text(value.targetCheckId, 128) || !hash(value.inputManifestHash)
      || !text(value.objectId, 128) || !text(value.parameterCode, 32)
      || !text(value.attribute, 128) || !text(value.entityKey, 256)
      || !text(value.context, 1000) || !hash(value.pdFactId)
      || !hash(value.pdLocatorHash) || !hash(value.rdFactId)
      || !hash(value.rdLocatorHash) || !text(value.pairDecisionId, 128)
      || !hash(value.pairTargetReviewHash)
      || typeof value.pdDenominatorAffirmed !== "boolean"
      || !Number.isSafeInteger(value.pdPageNumber) || Number(value.pdPageNumber) < 1
      || Number(value.pdPageNumber) > 100000
      || !Number.isSafeInteger(value.rdPageNumber) || Number(value.rdPageNumber) < 1
      || Number(value.rdPageNumber) > 100000
      || !record(value.basis)
      || !exact(value.basis, value.parameterCode === "SM-132"
        ? ["scope", "quantityType", "period", "aggregation", "priceBasis"]
        : ["scope", "quantityType", "period", "aggregation"])
      || !explanation(value.basis.scope) || !explanation(value.basis.quantityType)
      || !explanation(value.basis.period) || !explanation(value.basis.aggregation)
      || (value.parameterCode === "SM-132" && !explanation(value.basis.priceBasis))
      || value.targetCheckId !== verification.pair.targetCheckId
      || value.inputManifestHash !== verification.pair.inputManifestHash
      || value.objectId !== verification.pair.objectId
      || value.pairDecisionId !== verification.latestDecisionId
      || (value.decision === "SAME_SCALAR_TOTAL" && !value.pdDenominatorAffirmed)) return null;

    const expected = ocrFactPairQuantityCatalogFor(value.parameterCode, value.attribute);
    if (!expected || !same(expected, verification.catalog)) return null;
    if (verification.snapshots.some((item) => !record(item)
      || !text(item.decisionId, 128))
      || verification.snapshots.filter((item) => item.decisionId === value.pairDecisionId)
        .length !== 1) return null;
    const snapshot = verification.snapshots.find((item) =>
      item.decisionId === value.pairDecisionId)!;
    if (snapshot.targetCheckId !== value.targetCheckId
      || !text(snapshot.originCheckId, 128)
      || snapshot.originCheckId === snapshot.targetCheckId
      || !text(snapshot.actorId, 128)
      || !hash(snapshot.decisionContentHash)
      || snapshot.targetReviewHash !== value.pairTargetReviewHash
      || snapshot.eligibleForPairReview !== true
      || snapshot.review?.decision !== "PAIR_CONFIRMED"
      || !record(snapshot.provenance)) return null;

    const review = snapshot.review;
    if (review.targetCheckId !== value.targetCheckId
      || review.inputManifestHash !== value.inputManifestHash
      || review.objectId !== value.objectId
      || review.parameterCode !== value.parameterCode
      || review.attribute !== value.attribute
      || review.entityKey !== value.entityKey || review.context !== value.context
      || review.pdFactId !== value.pdFactId
      || review.pdLocatorHash !== value.pdLocatorHash
      || review.rdFactId !== value.rdFactId
      || review.rdLocatorHash !== value.rdLocatorHash) return null;
    const validatedPair = validateOcrFactPairReview(review, verification.pair);
    if (!validatedPair || !validatedPair.eligibleForPairReview
      || !same(validatedPair.provenance, snapshot.provenance)
      || sha256(canonicalJson({ checkId: value.targetCheckId,
        objectId: value.objectId, ...validatedPair,
        actorId: snapshot.actorId })) !== value.pairTargetReviewHash) return null;

    const items = verification.pair.artifact.content.items;
    const pd = items.find((item) => item.factId === value.pdFactId);
    const rd = items.find((item) => item.factId === value.rdFactId);
    const rule = rules[value.parameterCode];
    const selected = rule.attributes[value.attribute];
    if (!pd || !rd || pd.pageNumber !== value.pdPageNumber
      || rd.pageNumber !== value.rdPageNumber
      || !selected.aliases.includes(pd.rawUnit)
      || !selected.aliases.includes(rd.rawUnit)
      || !numeric(pd.rawValue) || !numeric(rd.rawValue)
      || !nonzero(pd.rawValue)
      || !hash(pd.locator.applicabilityDecisionHash)
      || !hash(rd.locator.applicabilityDecisionHash)
      || !hash(pd.locator.targetSnapshotHash)
      || !hash(rd.locator.targetSnapshotHash)) return null;

    const input = value as unknown as OcrFactPairQuantityReviewInput;
    const provenance = {
      artifactHash: validatedPair.provenance.artifactHash,
      pairDecisionId: snapshot.decisionId,
      pairDecisionContentHash: snapshot.decisionContentHash,
      pairTargetReviewHash: value.pairTargetReviewHash,
      candidateRulePackSha256: expected.candidateRulePackSha256,
      canonicalUnit: expected.canonicalUnit,
      pdSourceFileId: validatedPair.provenance.pdSourceFileId,
      pdSourceSha256: validatedPair.provenance.pdSourceSha256,
      pdSourceReviewHash: validatedPair.provenance.pdSourceReviewHash,
      pdApplicabilityDecisionHash: pd.locator.applicabilityDecisionHash,
      pdTargetSnapshotHash: pd.locator.targetSnapshotHash,
      rdSourceFileId: validatedPair.provenance.rdSourceFileId,
      rdSourceSha256: validatedPair.provenance.rdSourceSha256,
      rdSourceReviewHash: validatedPair.provenance.rdSourceReviewHash,
      rdApplicabilityDecisionHash: rd.locator.applicabilityDecisionHash,
      rdTargetSnapshotHash: rd.locator.targetSnapshotHash,
    };
    const eligibleForComparison = input.decision === "SAME_SCALAR_TOTAL";
    const reviewCopy = { ...input, basis: { ...input.basis } };
    return { review: reviewCopy, provenance, eligibleForComparison,
      evidenceHash: sha256(canonicalJson({ review: reviewCopy, provenance,
        eligibleForComparison })) };
  } catch {
    return null;
  }
}
