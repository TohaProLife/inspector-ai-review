import { sourceReviewSchema, type SourceReviewDecision } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewSections, candidateFamilyPreviewSpecs } from "./candidate-family-preview.js";
import type { OcrTypedFactV2 } from "./ocr-typed-fact-v2.js";
import type { OcrTypedFactV2Read } from "./repository.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const exact = (value: Json, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const text = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" && value.length > 0 && value === value.trim()
  && Buffer.byteLength(value, "utf8") <= maxBytes
  && !/[\p{Cc}\p{Cf}]/u.test(value);

/** Client submits only identities and explicit human judgment, never fact bodies. */
export interface OcrFactPairReviewInput {
  schemaVersion: "ocr-fact-pair-review-v1";
  decision: "PAIR_CONFIRMED" | "PAIR_REJECTED" | "UNSURE";
  targetCheckId: string;
  inputManifestHash: string;
  objectId: string;
  parameterCode: string;
  attribute: string;
  pdFactId: string;
  pdLocatorHash: string;
  rdFactId: string;
  rdLocatorHash: string;
  entityKey: string;
  context: string;
  linkGroupId: string;
  basis: string;
}

export interface OcrFactPairReviewVerificationContext {
  targetCheckId: string;
  inputManifestHash: string;
  objectId: string;
  /** Loader must first rederive and verify this immutable artifact at save/seal/GET. */
  releaseProfile: "ocr-typed-fact-candidates-v1";
  artifact: { content: OcrTypedFactV2Read; contentHash: string };
  /** Loaded from immutable target-run source-review snapshots, not request JSON. */
  sourceReviews: {
    PD: { targetCheckId: string; decision: SourceReviewDecision };
    RD: { targetCheckId: string; decision: SourceReviewDecision };
  };
}

export interface ValidatedOcrFactPairReview {
  review: OcrFactPairReviewInput;
  provenance: {
    artifactHash: string;
    pdSourceFileId: string;
    pdSourceSha256: string;
    pdSourceReviewHash: string;
    rdSourceFileId: string;
    rdSourceSha256: string;
    rdSourceReviewHash: string;
  };
  eligibleForPairReview: boolean;
}

function verifiedFact(value: unknown, context: OcrFactPairReviewVerificationContext):
  value is OcrTypedFactV2 {
  if (!record(value) || !exact(value, ["schemaVersion", "factId", "targetCheckId",
    "inputManifestHash", "objectId", "sourceFileId", "sourceSha256", "stage",
    "pageNumber", "parameterCode", "attribute", "entityKey", "context", "rawText",
    "rawValue", "rawUnit", "locator"]) || value.schemaVersion !== "typed-fact-v2"
    || !hash(value.factId) || value.targetCheckId !== context.targetCheckId
    || value.inputManifestHash !== context.inputManifestHash
    || value.objectId !== context.objectId || !text(value.sourceFileId, 128)
    || !hash(value.sourceSha256) || !["PD", "RD"].includes(String(value.stage))
    || !Number.isSafeInteger(value.pageNumber) || Number(value.pageNumber) < 1
    || !record(value.locator) || value.locator.kind !== "OCR_ROW"
    || !hash(value.locator.sourceReviewDecisionHash)
    || !text(value.locator.sourceReviewDecisionId, 128)
    || !hash(value.locator.targetSnapshotHash)
    || !hash(value.locator.rowFingerprint)
    || !text(value.parameterCode, 32) || !text(value.attribute, 128)
    || !text(value.entityKey, 256) || !text(value.context, 1000)) return false;
  const { factId, ...body } = value;
  return sha256(canonicalJson(body)) === factId;
}

function verifiedSource(snapshot: { targetCheckId: string; decision: SourceReviewDecision },
  fact: OcrTypedFactV2, context: OcrFactPairReviewVerificationContext,
  allowedSections: readonly string[]): boolean {
  const decision = snapshot.decision;
  if (!record(snapshot) || !record(decision)
    || snapshot.targetCheckId !== context.targetCheckId
    || decision.objectId !== context.objectId
    || decision.sourceFileId !== fact.sourceFileId
    || decision.sourceSha256 !== fact.sourceSha256
    || decision.id !== fact.locator.sourceReviewDecisionId
    || decision.contentHash !== fact.locator.sourceReviewDecisionHash
    || !hash(decision.contentHash) || !text(decision.actorId, 128)
    || decision.revisionStatus !== "CURRENT" || decision.approvalStatus !== "APPROVED"
    || !text(decision.linkGroupId, 256)
    || !allowedSections.includes(decision.sectionCode ?? "")
    || decision.sectionCode !== fact.locator.sectionCode) return false;
  const parsed = sourceReviewSchema.safeParse({
    sourceSha256: decision.sourceSha256,
    revisionStatus: decision.revisionStatus,
    approvalStatus: decision.approvalStatus,
    linkGroupId: decision.linkGroupId,
    sectionCode: decision.sectionCode,
    pageStages: decision.pageStages,
    basis: decision.basis,
  });
  if (!parsed.success) return false;
  const { sectionCode, ...legacy } = parsed.data;
  const hashInput = sectionCode ? { ...legacy, sectionCode } : legacy;
  return sha256(canonicalJson({
    objectApiId: context.objectId, sourceFileApiId: fact.sourceFileId,
    ...hashInput, actorId: decision.actorId,
  })) === decision.contentHash;
}

/** Pure eligibility gate. A positive review remains review-only, with no comparison or finding. */
export function validateOcrFactPairReview(value: unknown,
  context: OcrFactPairReviewVerificationContext): ValidatedOcrFactPairReview | null {
  try {
    if (!record(value) || !record(context) || !record(context.artifact)
      || !record(context.artifact.content) || !record(context.sourceReviews)
      || !exact(value, ["schemaVersion", "decision", "targetCheckId",
        "inputManifestHash", "objectId", "parameterCode", "attribute", "pdFactId",
        "pdLocatorHash", "rdFactId", "rdLocatorHash", "entityKey", "context",
        "linkGroupId", "basis"])
      || value.schemaVersion !== "ocr-fact-pair-review-v1"
      || !["PAIR_CONFIRMED", "PAIR_REJECTED", "UNSURE"].includes(String(value.decision))
      || value.targetCheckId !== context.targetCheckId
      || value.inputManifestHash !== context.inputManifestHash
      || value.objectId !== context.objectId
      || !text(value.targetCheckId, 128) || !hash(value.inputManifestHash)
      || !text(value.objectId, 128) || !text(value.parameterCode, 32)
      || !text(value.attribute, 128) || !hash(value.pdFactId)
      || !hash(value.rdFactId) || !hash(value.pdLocatorHash)
      || !hash(value.rdLocatorHash) || value.pdFactId === value.rdFactId
      || !text(value.entityKey, 256) || !text(value.context, 1000)
      || !text(value.linkGroupId, 256) || !text(value.basis, 2000)
      || context.releaseProfile !== "ocr-typed-fact-candidates-v1"
      || !hash(context.artifact.contentHash)
      || sha256(canonicalJson(context.artifact.content)) !== context.artifact.contentHash
      || context.artifact.content.schemaVersion !== "ocr-typed-fact-candidates-v1"
      || context.artifact.content.findingCount !== 0
      || context.artifact.content.coverageCount !== 0
      || !Array.isArray(context.artifact.content.items)
      || context.artifact.content.items.length > 512) return null;

    const spec = candidateFamilyPreviewSpecs[String(value.parameterCode)];
    const sections = candidateFamilyPreviewSections[String(value.parameterCode)];
    if (!spec || !Object.hasOwn(spec.attributes, String(value.attribute)) || !sections) return null;
    const facts = context.artifact.content.items;
    if (new Set(facts.map((fact) => fact.factId)).size !== facts.length) return null;
    const pd = facts.find((fact) => fact.factId === value.pdFactId);
    const rd = facts.find((fact) => fact.factId === value.rdFactId);
    if (!verifiedFact(pd, context) || !verifiedFact(rd, context)
      || pd.stage !== "PD" || rd.stage !== "RD"
      || pd.parameterCode !== value.parameterCode || rd.parameterCode !== value.parameterCode
      || pd.attribute !== value.attribute || rd.attribute !== value.attribute
      || pd.entityKey !== value.entityKey || rd.entityKey !== value.entityKey
      || pd.context !== value.context || rd.context !== value.context
      || pd.sourceFileId === rd.sourceFileId || pd.sourceSha256 === rd.sourceSha256
      || sha256(canonicalJson(pd.locator)) !== value.pdLocatorHash
      || sha256(canonicalJson(rd.locator)) !== value.rdLocatorHash
      || !verifiedSource(context.sourceReviews.PD, pd, context, sections.PD)
      || !verifiedSource(context.sourceReviews.RD, rd, context, sections.RD)
      || context.sourceReviews.PD.decision.linkGroupId !== value.linkGroupId
      || context.sourceReviews.RD.decision.linkGroupId !== value.linkGroupId) return null;

    const review = value as unknown as OcrFactPairReviewInput;
    return { review: { ...review }, provenance: {
      artifactHash: context.artifact.contentHash,
      pdSourceFileId: pd.sourceFileId, pdSourceSha256: pd.sourceSha256,
      pdSourceReviewHash: pd.locator.sourceReviewDecisionHash,
      rdSourceFileId: rd.sourceFileId, rdSourceSha256: rd.sourceSha256,
      rdSourceReviewHash: rd.locator.sourceReviewDecisionHash,
    }, eligibleForPairReview: review.decision === "PAIR_CONFIRMED" };
  } catch {
    return null;
  }
}
