import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewSpecs } from "./candidate-family-preview.js";
import { validateOcrFactPairReview, type OcrFactPairReviewInput,
  type OcrFactPairReviewVerificationContext } from "./ocr-fact-pair-review.js";

type PairProvenance = NonNullable<ReturnType<typeof validateOcrFactPairReview>>["provenance"];
type Rational = { numerator: bigint; denominator: bigint };

/** Verified projection of one append-only origin decision into the target run. */
export interface OcrFactPairDecisionSnapshot {
  decisionId: string;
  decisionContentHash: string;
  originCheckId: string;
  targetCheckId: string;
  targetReviewHash: string | null;
  review: OcrFactPairReviewInput | null;
  provenance: PairProvenance | null;
  eligibleForPairReview: boolean;
  actorId: string;
}

/** Supplied by a fresh target-run loader, never by request JSON. */
export interface OcrFactPairComparisonContext {
  pair: OcrFactPairReviewVerificationContext;
  snapshots: readonly OcrFactPairDecisionSnapshot[];
  latestDecisionId: string;
  /** Current catalog selection; drift from the pinned candidate pack abstains. */
  catalog: {
    candidateRulePackSha256: string;
    parameterCode: string;
    attribute: string;
    family: string;
    canonicalUnit: string;
    aggregation: string;
    threshold: { value: string; unit: string; strict: boolean } | null;
  };
  /** Independently established quantity meaning for the exact target pair. */
  quantity: {
    targetCheckId: string;
    inputManifestHash: string;
    objectId: string;
    parameterCode: string;
    attribute: string;
    entityKey: string;
    context: string;
    pdFactId: string;
    rdFactId: string;
    pdLocatorHash: string;
    rdLocatorHash: string;
    semantics: "SAME_SCALAR_TOTAL";
    denominator: "PD";
    evidenceHash: string;
  } | null;
}

export type OcrFactPairComparisonPreview = {
  schemaVersion: "ocr-fact-pair-comparison-preview-v1";
  purpose: "REVIEW_ONLY";
  status: "ABSTAIN" | "COMPARISON_CANDIDATE";
  reasonCode: string | null;
  comparison: null | {
    parameterCode: string;
    attribute: string;
    family: "RELATIVE_DELTA" | "RELATIVE_INCREASE";
    canonicalUnit: string;
    pdValue: string;
    rdValue: string;
    thresholdPercent: string;
    observedPercent: { numerator: string; denominator: string };
    exceedsThreshold: boolean;
    pdFactId: string;
    rdFactId: string;
    pdLocatorHash: string;
    rdLocatorHash: string;
    targetReviewHash: string;
    artifactHash: string;
    quantityEvidenceHash: string;
  };
};

const PACK = "a3ad00a04865f04bfeef5c2f21f5a11054fec88dcab264590fdb66d70a968581";
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const abstain = (reasonCode: string): OcrFactPairComparisonPreview => ({
  schemaVersion: "ocr-fact-pair-comparison-preview-v1", purpose: "REVIEW_ONLY",
  status: "ABSTAIN", reasonCode, comparison: null,
});

// Only explicit percent thresholds in the pinned candidate pack. Other rules lack
// a safe executable threshold or quantity basis and therefore abstain here.
const rules: Record<string, { family: "RELATIVE_DELTA" | "RELATIVE_INCREASE";
  thresholdPercent: string; units: Record<string, readonly string[]> }> = {
  "PZ-002": { family: "RELATIVE_DELTA", thresholdPercent: "1",
    units: { BUILDING_TOTAL_AREA: ["m2", "m²", "м2", "м²", "кв.м", "кв. м"] } },
  "SPZU-024": { family: "RELATIVE_DELTA", thresholdPercent: "5",
    units: { EXCAVATION_VOLUME: ["m3", "m³", "м3", "м³"],
      BACKFILL_VOLUME: ["m3", "m³", "м3", "м³"] } },
  "SPZU-025": { family: "RELATIVE_DELTA", thresholdPercent: "5",
    units: { HARD_SURFACE_AREA: ["m2", "m²", "м2", "м²", "кв.м", "кв. м"] } },
  "KR-067": { family: "RELATIVE_DELTA", thresholdPercent: "2",
    units: { CONCRETE_VOLUME: ["m3", "m³", "м3", "м³"], STEEL_MASS: ["t", "т", "т."] } },
  "POS-082": { family: "RELATIVE_INCREASE", thresholdPercent: "10",
    units: { CRITICAL_CONSTRUCTION_STAGE_DURATION: ["day", "день", "дня", "дни", "сут", "сут.", "сутки"] } },
  "POD-093": { family: "RELATIVE_DELTA", thresholdPercent: "5",
    units: { DEMOLITION_VOLUME_BY_TYPE: ["m3", "m³", "м3", "м³"] } },
  "SM-132": { family: "RELATIVE_INCREASE", thresholdPercent: "5",
    units: { CONSTRUCTION_TOTAL_COST: ["thousand_rub", "тыс. руб.", "тыс руб.", "тыс.руб."] } },
};

function decimal(value: unknown): Rational | null {
  if (typeof value !== "string" || value.length > 120
    || !/^(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.replace(/[ \u00a0]/gu, "").replace(",", ".").split(".");
  return { numerator: BigInt(whole + fraction), denominator: 10n ** BigInt(fraction.length) };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function canonicalDecimal(value: Rational): string {
  const scale = value.denominator.toString().length - 1;
  const digits = value.numerator.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/u, "").replace(/\.$/u, "");
}

/** Pure review preview. Caller must load immutable artifact, verified journal projections,
 * latest journal identity, catalog selection, and fresh quantity evidence in one target scope. */
export function buildOcrFactPairComparisonPreview(
  context: OcrFactPairComparisonContext): OcrFactPairComparisonPreview {
  try {
    if (!record(context) || !record(context.pair) || !record(context.catalog)
      || !Array.isArray(context.snapshots) || context.snapshots.length > 512
      || typeof context.latestDecisionId !== "string" || !context.latestDecisionId) {
      return abstain("CONTEXT_INVALID");
    }
    const matches = context.snapshots.filter((item) => item.decisionId === context.latestDecisionId);
    if (matches.length !== 1 || context.snapshots.some((item) => !record(item)
      || typeof item.decisionId !== "string" || !item.decisionId)) {
      return abstain("LATEST_DECISION_UNVERIFIED");
    }
    const snapshot = matches[0];
    if (!snapshot.eligibleForPairReview || snapshot.review?.decision !== "PAIR_CONFIRMED") {
      return abstain("PAIR_NOT_CONFIRMED");
    }
    const review = snapshot.review;
    if (!review || !hash(snapshot.decisionContentHash) || !hash(snapshot.targetReviewHash)
      || !record(snapshot.provenance) || !snapshot.originCheckId
      || !snapshot.actorId || snapshot.targetCheckId !== context.pair.targetCheckId
      || review.targetCheckId !== context.pair.targetCheckId
      || review.inputManifestHash !== context.pair.inputManifestHash
      || review.objectId !== context.pair.objectId) return abstain("SNAPSHOT_SCOPE_INVALID");
    const validated = validateOcrFactPairReview(review, context.pair);
    if (!validated || !validated.eligibleForPairReview
      || !same(validated.provenance, snapshot.provenance)
      || snapshot.targetReviewHash !== sha256(canonicalJson({
        checkId: context.pair.targetCheckId, objectId: context.pair.objectId,
        ...validated, actorId: snapshot.actorId,
      }))) return abstain("SNAPSHOT_TAMPERED");
    const code = review.parameterCode;
    const attribute = review.attribute;
    const rule = Object.hasOwn(rules, code) ? rules[code] : null;
    const spec = Object.hasOwn(candidateFamilyPreviewSpecs, code)
      ? candidateFamilyPreviewSpecs[code] : null;
    const unit = spec && Object.hasOwn(spec.attributes, attribute)
      ? spec.attributes[attribute] : null;
    if (!rule || !unit || !Object.hasOwn(rule.units, attribute)
      || context.catalog.candidateRulePackSha256 !== PACK
      || context.catalog.parameterCode !== code || context.catalog.attribute !== attribute
      || context.catalog.family !== rule.family || spec?.family !== rule.family
      || context.catalog.canonicalUnit !== unit
      || context.catalog.aggregation !== "PER_ATTRIBUTE"
      || !same(context.catalog.threshold,
        { value: rule.thresholdPercent, unit: "percent", strict: true })) {
      return abstain("CATALOG_RULE_UNSUPPORTED");
    }
    const quantity = context.quantity;
    if (!quantity || !hash(quantity.evidenceHash)
      || quantity.targetCheckId !== review.targetCheckId
      || quantity.inputManifestHash !== review.inputManifestHash
      || quantity.objectId !== review.objectId
      || quantity.parameterCode !== code || quantity.attribute !== attribute
      || quantity.entityKey !== review.entityKey || quantity.context !== review.context
      || quantity.pdFactId !== review.pdFactId || quantity.rdFactId !== review.rdFactId
      || quantity.pdLocatorHash !== review.pdLocatorHash
      || quantity.rdLocatorHash !== review.rdLocatorHash
      || quantity.semantics !== "SAME_SCALAR_TOTAL" || quantity.denominator !== "PD") {
      return abstain("QUANTITY_CONTEXT_UNVERIFIED");
    }
    const items = context.pair.artifact.content.items;
    const pd = items.find((item) => item.factId === review.pdFactId);
    const rd = items.find((item) => item.factId === review.rdFactId);
    if (!pd || !rd) return abstain("TARGET_FACT_UNAVAILABLE");
    const aliases = rule.units[attribute];
    if (!aliases.includes(pd.rawUnit) || !aliases.includes(rd.rawUnit)) {
      return abstain("UNIT_AMBIGUOUS");
    }
    const pdValue = decimal(pd.rawValue);
    const rdValue = decimal(rd.rawValue);
    if (!pdValue || !rdValue || pdValue.numerator === 0n) {
      return abstain("QUANTITY_VALUE_UNUSABLE");
    }
    const signedDifference = rdValue.numerator * pdValue.denominator
      - pdValue.numerator * rdValue.denominator;
    const difference = rule.family === "RELATIVE_DELTA" && signedDifference < 0n
      ? -signedDifference : signedDifference;
    const numerator = difference * 100n;
    const denominator = rdValue.denominator * pdValue.numerator;
    const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
    const threshold = decimal(rule.thresholdPercent);
    if (!threshold) return abstain("THRESHOLD_INVALID");
    const exceedsThreshold = numerator * threshold.denominator
      > threshold.numerator * denominator;
    return { schemaVersion: "ocr-fact-pair-comparison-preview-v1", purpose: "REVIEW_ONLY",
      status: "COMPARISON_CANDIDATE", reasonCode: null, comparison: {
        parameterCode: code, attribute, family: rule.family, canonicalUnit: unit,
        pdValue: canonicalDecimal(pdValue), rdValue: canonicalDecimal(rdValue),
        thresholdPercent: rule.thresholdPercent,
        observedPercent: { numerator: (numerator / divisor).toString(),
          denominator: (denominator / divisor).toString() },
        exceedsThreshold, pdFactId: pd.factId, rdFactId: rd.factId,
        pdLocatorHash: review.pdLocatorHash, rdLocatorHash: review.rdLocatorHash,
        targetReviewHash: snapshot.targetReviewHash,
        artifactHash: validated.provenance.artifactHash,
        quantityEvidenceHash: quantity.evidenceHash,
      } };
  } catch {
    return abstain("CONTEXT_INVALID");
  }
}
