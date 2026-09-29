import { sourceReviewSchema, sourceSectionCodes, type SourceReviewDecision } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewSections, candidateFamilyPreviewSpecs } from "./candidate-family-preview.js";
import type { OcrHeatStageEnvelope } from "./ocr-heat-row-proposals.js";
import { validateOcrRowTranscriptionReview, type OcrRowTranscriptionReviewInput,
  type ValidatedOcrRowTranscriptionReview } from "./ocr-row-transcription-review.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const exact = (value: Json, fields: readonly string[]): boolean =>
  Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const text = (value: unknown, maxBytes: number, required = true): value is string =>
  typeof value === "string" && value === value.trim()
  && Buffer.byteLength(value, "utf8") <= maxBytes
  && (!required || value.length > 0)
  && !/[\p{Cc}\p{Cf}]/u.test(value);

/** Human judgment about whether a transcribed row is relevant to one candidate attribute.
 * This is never a typed fact or an approval of a PD/RD comparison. */
export interface OcrRowApplicabilityReviewInput {
  schemaVersion: "ocr-row-applicability-review-v1";
  decision: "APPLICABLE" | "NOT_APPLICABLE" | "UNSURE";
  targetCheckId: string;
  sourceFileId: string;
  sourceSha256: string;
  pageNumber: number;
  renderSha256: string;
  ocrStageSha256: string;
  rowFingerprint: string;
  transcriptionDecisionId: string;
  transcriptionDecisionHash: string;
  sourceReviewDecisionId: string;
  sourceReviewDecisionHash: string;
  parameterCode: string;
  attribute: string;
  stage: "PD" | "RD";
  entityKey: string;
  context: string;
  basis: string;
}

/** Caller must load these from the committed target run, its immutable snapshots,
 * and the saved origin OCR/rule artifacts; user input must never construct them. */
export interface OcrRowApplicabilityVerificationContext {
  targetCheckId: string;
  objectId: string;
  /** Target run manifest may differ after source-review decision changes. */
  inputManifestHash: string;
  /** Manifest pinned by the origin run that produced the OCR and rule artifacts. */
  originInputManifestHash: string;
  source: {
    sourceFileId: string;
    sourceSha256: string;
    stages: string[];
    sourceReviewHash: string | null;
  };
  transcriptionSnapshot: {
    targetCheckId: string;
    decisionId: string;
    decisionContentHash: string;
    originCheckId: string;
    actorId: string;
    sourceFileId: string;
    sourceSha256: string;
    rowFingerprint: string;
    review: OcrRowTranscriptionReviewInput;
    provenance: ValidatedOcrRowTranscriptionReview["provenance"];
  };
  sourceReviewSnapshot: {
    targetCheckId: string;
    decisionId: string;
    decisionHash: string;
    decision: SourceReviewDecision;
  };
  tableRowsResult: unknown;
  ocrStage: OcrHeatStageEnvelope;
}

export interface ValidatedOcrRowApplicabilityReview {
  review: OcrRowApplicabilityReviewInput;
  provenance: {
    targetCheckId: string;
    objectId: string;
    inputManifestHash: string;
    originInputManifestHash: string;
    sourceFileId: string;
    sourceSha256: string;
    pageNumber: number;
    ocrPageContentHash: string;
    renderSha256: string;
    ocrStageSha256: string;
    tableRowsContentHash: string;
    rowFingerprint: string;
    transcriptionDecisionId: string;
    transcriptionDecisionHash: string;
    sourceReviewDecisionId: string;
    sourceReviewDecisionHash: string;
    sectionCode: string | null;
  };
  /** No caller may promote NOT_APPLICABLE or UNSURE into a fact. */
  eligibleForFactReview: boolean;
}

function verifiedSourceReview(context: OcrRowApplicabilityVerificationContext): boolean {
  const { targetCheckId, objectId, source, sourceReviewSnapshot: snapshot } = context;
  const decision = snapshot.decision;
  if (!record(snapshot) || !record(decision) || !hash(snapshot.decisionHash)
    || snapshot.targetCheckId !== targetCheckId
    || !text(snapshot.decisionId, 128)
    || snapshot.decisionId !== decision.id
    || decision.objectId !== objectId || decision.sourceFileId !== source.sourceFileId
    || decision.sourceSha256 !== source.sourceSha256
    || decision.contentHash !== snapshot.decisionHash
    || decision.contentHash !== source.sourceReviewHash
    || !text(decision.actorId, 128)) return false;
  const parsed = sourceReviewSchema.safeParse({
    sourceSha256: decision.sourceSha256,
    revisionStatus: decision.revisionStatus,
    approvalStatus: decision.approvalStatus,
    linkGroupId: decision.linkGroupId,
    sectionCode: decision.sectionCode,
    pageStages: decision.pageStages,
    basis: decision.basis,
  });
  if (!parsed.success || (decision.sectionCode !== null
    && !(sourceSectionCodes as readonly string[]).includes(decision.sectionCode))) return false;
  const { sectionCode, ...legacy } = parsed.data;
  const hashInput = sectionCode ? { ...legacy, sectionCode } : legacy;
  const expectedHash = sha256(canonicalJson({
    objectApiId: objectId, sourceFileApiId: source.sourceFileId,
    ...hashInput, actorId: decision.actorId,
  }));
  return expectedHash === snapshot.decisionHash;
}

function positiveSourceScope(input: OcrRowApplicabilityReviewInput,
  context: OcrRowApplicabilityVerificationContext): boolean {
  const { source, sourceReviewSnapshot } = context;
  const decision = sourceReviewSnapshot.decision;
  const spec = candidateFamilyPreviewSpecs[input.parameterCode];
  const sections = candidateFamilyPreviewSections[input.parameterCode]?.[input.stage];
  if (!spec || !Object.hasOwn(spec.attributes, input.attribute)
    || !sections?.includes(decision.sectionCode ?? "")
    || decision.revisionStatus !== "CURRENT" || decision.approvalStatus !== "APPROVED"
    || !Array.isArray(source.stages) || source.stages.length < 1
    || new Set(source.stages).size !== source.stages.length
    || source.stages.some((stage) => !["PD", "RD", "ID"].includes(stage))
    || !source.stages.includes(input.stage)) return false;
  if (source.stages.length === 1) {
    return source.stages[0] === input.stage
      && Object.keys(decision.pageStages).length === 0;
  }
  return decision.pageStages[String(input.pageNumber)] === input.stage;
}

/** Re-derive source and OCR identities before accepting an append-only applicability judgment. */
export function validateOcrRowApplicabilityReview(
  value: unknown,
  context: OcrRowApplicabilityVerificationContext,
): ValidatedOcrRowApplicabilityReview | null {
  try {
    if (!record(value) || !record(context)
      || !exact(value, ["schemaVersion", "decision", "targetCheckId", "sourceFileId",
        "sourceSha256", "pageNumber", "renderSha256", "ocrStageSha256", "rowFingerprint",
        "transcriptionDecisionId", "transcriptionDecisionHash", "sourceReviewDecisionId",
        "sourceReviewDecisionHash", "parameterCode", "attribute", "stage", "entityKey",
        "context", "basis"])
      || value.schemaVersion !== "ocr-row-applicability-review-v1"
      || !["APPLICABLE", "NOT_APPLICABLE", "UNSURE"].includes(value.decision as string)
      || !text(value.targetCheckId, 128) || !text(value.sourceFileId, 128)
      || !hash(value.sourceSha256) || !Number.isSafeInteger(value.pageNumber)
      || Number(value.pageNumber) < 1 || !hash(value.renderSha256)
      || !hash(value.ocrStageSha256) || !hash(value.rowFingerprint)
      || !text(value.transcriptionDecisionId, 128) || !hash(value.transcriptionDecisionHash)
      || !text(value.sourceReviewDecisionId, 128) || !hash(value.sourceReviewDecisionHash)
      || !text(value.parameterCode, 32) || !text(value.attribute, 128)
      || !candidateFamilyPreviewSpecs[String(value.parameterCode)]
      || !Object.hasOwn(candidateFamilyPreviewSpecs[String(value.parameterCode)].attributes,
        String(value.attribute))
      || !["PD", "RD"].includes(value.stage as string)
      || !text(value.entityKey, 256) || !text(value.context, 1000)
      || !text(value.basis, 1000)
      || !hash(context.inputManifestHash) || !hash(context.originInputManifestHash)
      || value.targetCheckId !== context.targetCheckId
      || value.sourceFileId !== context.source.sourceFileId
      || value.sourceSha256 !== context.source.sourceSha256
      || value.transcriptionDecisionId !== context.transcriptionSnapshot.decisionId
      || value.transcriptionDecisionHash !== context.transcriptionSnapshot.decisionContentHash
      || value.sourceReviewDecisionId !== context.sourceReviewSnapshot.decisionId
      || value.sourceReviewDecisionHash !== context.sourceReviewSnapshot.decisionHash
      || context.transcriptionSnapshot.targetCheckId !== context.targetCheckId
      || context.transcriptionSnapshot.sourceFileId !== context.source.sourceFileId
      || context.transcriptionSnapshot.sourceSha256 !== context.source.sourceSha256
      || context.transcriptionSnapshot.rowFingerprint !== value.rowFingerprint
      || !hash(context.transcriptionSnapshot.decisionContentHash)
      || !text(context.transcriptionSnapshot.originCheckId, 128)
      || !text(context.transcriptionSnapshot.actorId, 128)
      || !verifiedSourceReview(context)) return null;

    const verified = validateOcrRowTranscriptionReview(
      context.transcriptionSnapshot.review, context.tableRowsResult,
      context.ocrStage, context.originInputManifestHash);
    if (!verified || canonicalJson(verified) !== canonicalJson({
      review: context.transcriptionSnapshot.review,
      provenance: context.transcriptionSnapshot.provenance,
    }) || sha256(canonicalJson({
      checkId: context.transcriptionSnapshot.originCheckId,
      objectId: context.objectId, ...verified,
      actorId: context.transcriptionSnapshot.actorId,
    })) !== context.transcriptionSnapshot.decisionContentHash
      || verified.provenance.rowFingerprint !== value.rowFingerprint
      || verified.provenance.sourceFileId !== value.sourceFileId
      || verified.provenance.sourceSha256 !== value.sourceSha256
      || verified.provenance.pageNumber !== value.pageNumber
      || verified.provenance.renderSha256 !== value.renderSha256
      || verified.provenance.ocrStageSha256 !== value.ocrStageSha256
      || verified.provenance.inputManifestHash !== context.originInputManifestHash) return null;

    const review = value as unknown as OcrRowApplicabilityReviewInput;
    const eligibleForFactReview = review.decision === "APPLICABLE"
      && verified.review.decision === "CONFIRMED_TRANSCRIPTION"
      && positiveSourceScope(review, context);
    if (review.decision === "APPLICABLE" && !eligibleForFactReview) return null;
    return { review: { ...review }, provenance: {
      targetCheckId: context.targetCheckId,
      objectId: context.objectId,
      inputManifestHash: context.inputManifestHash,
      originInputManifestHash: context.originInputManifestHash,
      sourceFileId: verified.provenance.sourceFileId,
      sourceSha256: verified.provenance.sourceSha256,
      pageNumber: verified.provenance.pageNumber,
      ocrPageContentHash: verified.provenance.ocrPageContentHash,
      renderSha256: verified.provenance.renderSha256,
      ocrStageSha256: verified.provenance.ocrStageSha256,
      tableRowsContentHash: verified.provenance.tableRowsContentHash,
      rowFingerprint: verified.provenance.rowFingerprint,
      transcriptionDecisionId: context.transcriptionSnapshot.decisionId,
      transcriptionDecisionHash: context.transcriptionSnapshot.decisionContentHash,
      sourceReviewDecisionId: context.sourceReviewSnapshot.decisionId,
      sourceReviewDecisionHash: context.sourceReviewSnapshot.decisionHash,
      sectionCode: context.sourceReviewSnapshot.decision.sectionCode,
    }, eligibleForFactReview };
  } catch {
    return null;
  }
}
