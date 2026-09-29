import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewSpecs } from "./candidate-family-preview.js";
import { normalizeFact } from "./fact-family-proposals.js";
import { validateOcrRowApplicabilityReview,
  type OcrRowApplicabilityReviewInput,
  type OcrRowApplicabilityVerificationContext,
  type ValidatedOcrRowApplicabilityReview } from "./ocr-row-applicability-review.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const same = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

/** The loader must select the effective latest decision from the immutable target run.
 * A supplied decision body or a client-reported "confirmed" flag is never authority. */
export interface OcrTypedFactV2VerificationContext {
  /** Re-loaded from the origin immutable run, never reconstructed from target input. */
  originApplicability: OcrRowApplicabilityVerificationContext;
  applicability: OcrRowApplicabilityVerificationContext;
  applicabilitySnapshot: {
    targetCheckId: string;
    decisionId: string;
    /** Hash saved with the origin human decision. */
    decisionContentHash: string;
    originReview: OcrRowApplicabilityReviewInput;
    actorId: string;
    review: OcrRowApplicabilityReviewInput;
    provenance: ValidatedOcrRowApplicabilityReview["provenance"];
    eligibleForFactReview: boolean;
  };
  latestApplicabilityDecisionId: string;
}

/** Separate schema and locator: never reinterpret as TEXT_BLOCK or typed-fact-v1. */
export interface OcrTypedFactV2 {
  schemaVersion: "typed-fact-v2";
  factId: string;
  targetCheckId: string;
  inputManifestHash: string;
  objectId: string;
  sourceFileId: string;
  sourceSha256: string;
  stage: "PD" | "RD";
  pageNumber: number;
  parameterCode: string;
  attribute: string;
  entityKey: string;
  context: string;
  rawText: string;
  rawValue: string;
  rawUnit: string;
  locator: {
    kind: "OCR_ROW";
    originInputManifestHash: string;
    ocrPageContentHash: string;
    renderSha256: string;
    ocrStageSha256: string;
    tableRowsContentHash: string;
    rowFingerprint: string;
    transcriptionDecisionId: string;
    transcriptionDecisionHash: string;
    sourceReviewDecisionId: string;
    sourceReviewDecisionHash: string;
    applicabilityDecisionId: string;
    applicabilityDecisionHash: string;
    targetSnapshotHash: string;
    originCheckId: string;
    sectionCode: string;
    labelEvidence: unknown;
    labelContinuationEvidence?: unknown[];
    valueEvidence: unknown;
  };
}

/** Derive a review-only fact candidate from saved artifacts and three frozen human decisions.
 * No pair, entity link, comparison, finding, or coverage is inferred here. */
export function buildOcrTypedFactV2(
  context: OcrTypedFactV2VerificationContext,
): OcrTypedFactV2 | null {
  try {
    if (!record(context) || !record(context.applicability)
      || !record(context.originApplicability)
      || !record(context.applicabilitySnapshot)) return null;
    const { applicability, originApplicability,
      applicabilitySnapshot: snapshot } = context;
    const originValidated = validateOcrRowApplicabilityReview(
      snapshot.originReview, originApplicability);
    const validated = validateOcrRowApplicabilityReview(snapshot.review, applicability);
    if (!originValidated || !originValidated.eligibleForFactReview
      || !validated || !validated.eligibleForFactReview
      || snapshot.eligibleForFactReview !== true
      || snapshot.targetCheckId !== applicability.targetCheckId
      || snapshot.decisionId !== context.latestApplicabilityDecisionId
      || typeof snapshot.decisionId !== "string" || snapshot.decisionId.length === 0
      || typeof snapshot.actorId !== "string" || snapshot.actorId.length === 0
      || !hash(snapshot.decisionContentHash)
      || !same(snapshot.provenance, validated.provenance)
      || applicability.objectId !== originApplicability.objectId
      || !same(snapshot.review, { ...snapshot.originReview,
        targetCheckId: applicability.targetCheckId })
      || sha256(canonicalJson({ checkId: originApplicability.targetCheckId,
        objectId: originApplicability.objectId, ...originValidated,
        actorId: snapshot.actorId })) !== snapshot.decisionContentHash) return null;

    const targetSnapshotHash = sha256(canonicalJson({
      checkId: applicability.targetCheckId, objectId: applicability.objectId,
      ...validated, actorId: snapshot.actorId,
    }));

    const transcription = applicability.transcriptionSnapshot.review;
    const review = validated.review;
    const provenance = validated.provenance;
    const spec = candidateFamilyPreviewSpecs[review.parameterCode];
    // A table row with an arbitrary string or a set/class token is not a numeric fact.
    if (!spec || !["LOWER_BOUND", "UPPER_BOUND", "DIFFERENT", "DECREASE",
      "INCREASE", "RELATIVE_DELTA", "RELATIVE_INCREASE"].includes(spec.family)
      || typeof transcription.reviewedLabel !== "string"
      || typeof transcription.reviewedValue !== "string"
      || typeof transcription.reviewedUnit !== "string"
      || !/^(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?$/u.test(
        transcription.reviewedValue)
      || transcription.reviewedUnit.length === 0
      || !normalizeFact({ rawValue: transcription.reviewedValue,
        rawUnit: transcription.reviewedUnit, attribute: review.attribute },
      spec.attributes[review.attribute])
      || !record(applicability.transcriptionSnapshot.provenance.labelEvidence)
      || !record(applicability.transcriptionSnapshot.provenance.valueEvidence)
      || !provenance.sectionCode) return null;

    const withoutId = {
      schemaVersion: "typed-fact-v2" as const,
      targetCheckId: applicability.targetCheckId,
      inputManifestHash: applicability.inputManifestHash,
      objectId: applicability.objectId,
      sourceFileId: provenance.sourceFileId,
      sourceSha256: provenance.sourceSha256,
      stage: review.stage,
      pageNumber: provenance.pageNumber,
      parameterCode: review.parameterCode,
      attribute: review.attribute,
      entityKey: review.entityKey,
      context: review.context,
      rawText: `${transcription.reviewedLabel}\t${transcription.reviewedValue} ${transcription.reviewedUnit}`,
      rawValue: transcription.reviewedValue,
      rawUnit: transcription.reviewedUnit,
      locator: {
        kind: "OCR_ROW" as const,
        originInputManifestHash: provenance.originInputManifestHash,
        ocrPageContentHash: provenance.ocrPageContentHash,
        renderSha256: provenance.renderSha256,
        ocrStageSha256: provenance.ocrStageSha256,
        tableRowsContentHash: provenance.tableRowsContentHash,
        rowFingerprint: provenance.rowFingerprint,
        transcriptionDecisionId: provenance.transcriptionDecisionId,
        transcriptionDecisionHash: provenance.transcriptionDecisionHash,
        sourceReviewDecisionId: provenance.sourceReviewDecisionId,
        sourceReviewDecisionHash: provenance.sourceReviewDecisionHash,
        applicabilityDecisionId: snapshot.decisionId,
        applicabilityDecisionHash: snapshot.decisionContentHash,
        targetSnapshotHash,
        originCheckId: originApplicability.targetCheckId,
        sectionCode: provenance.sectionCode,
        labelEvidence: structuredClone(applicability.transcriptionSnapshot.provenance.labelEvidence),
        ...(applicability.transcriptionSnapshot.provenance.labelContinuationEvidence
          ? { labelContinuationEvidence: structuredClone(
            applicability.transcriptionSnapshot.provenance.labelContinuationEvidence) } : {}),
        valueEvidence: structuredClone(applicability.transcriptionSnapshot.provenance.valueEvidence),
      },
    };
    return { factId: sha256(canonicalJson(withoutId)), ...withoutId };
  } catch {
    return null;
  }
}

/** Independent save/seal/GET admission check over a re-derived candidate. */
export function validateOcrTypedFactV2(value: unknown,
  context: OcrTypedFactV2VerificationContext): boolean {
  try {
    const derived = buildOcrTypedFactV2(context);
    return Boolean(derived && record(value) && same(value, derived));
  } catch {
    return false;
  }
}
