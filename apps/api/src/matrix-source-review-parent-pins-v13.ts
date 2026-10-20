/** Output-only v13 parent hash/reference boundary; scoped SQL remains the caller's responsibility. */
import { sourceSectionCodes } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";

export class SourceReviewParentPinsV13Error extends TypeError {
  readonly code = "SOURCE_REVIEW_PARENT_UNVERIFIED";
  constructor() { super("SOURCE_REVIEW_PARENT_UNVERIFIED"); }
}

export interface SourceReviewParentPinsV13 {
  reviewDecisionId: string;
  reviewContentHash: string;
  body: Record<string, unknown>;
}

const contextKeys = ["objectId", "objectApiId", "sourceInternalId", "sourceFileApiId",
  "sourceSha256", "sourcePageCount", "snapshotReviewId", "snapshotReviewHash", "review"];
const scopeKeys = ["matrixScope", "inventoryScope", "callInventoryScope", "railInventoryScope",
  "waterNodeScope", "lightingTechnologyScope", "steelComparisonScope"];
const reviewKeys = ["id", "objectId", "sourceInternalId", "sourceSha256", "revisionStatus",
  "approvalStatus", "linkGroupId", "sectionCode", "pageStages", "basisReference", "actorId",
  "contentHash", ...scopeKeys];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/iu;
const hash = /^[a-f0-9]{64}(?![\s\S])/u;
const page = /^[1-9][0-9]{0,3}(?![\s\S])/u;
const fail = (): never => { throw new SourceReviewParentPinsV13Error(); };
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function closed(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function id(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && hash.test(value); }
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

/**
 * Authenticate the complete parent preimage, not an isolated matrixScope hash.
 * Input is an explicit projection from a protected, scoped snapshot/review query.
 * All seven nullable scope columns must be present. Their typed domain validators
 * still run downstream; this helper does not interpret opaque child bodies.
 * UNKNOWN and empty fact bindings remain authentic data, never an approval.
 * No review is represented only by three nulls; a partial reference refuses.
 */
export function pinSourceReviewParentV13(value: unknown, options?: { unpaginated: true }): SourceReviewParentPinsV13 | null {
  // Descriptor/proxy/native limits precede every read of caller properties.
  assertConcreteWallLeaseNativeV13(value);
  if (!record(value) || !closed(value, contextKeys)
    || !id(value.objectId) || !id(value.sourceInternalId)
    || !nonempty(value.objectApiId) || !nonempty(value.sourceFileApiId)
    || !digest(value.sourceSha256) || !Number.isSafeInteger(value.sourcePageCount)
    || (options?.unpaginated ? value.sourcePageCount !== 0 : (value.sourcePageCount as number) < 1)
    || (value.sourcePageCount as number) > 2000) return fail();

  if (value.review === null && value.snapshotReviewId === null && value.snapshotReviewHash === null) return null;
  if (!id(value.snapshotReviewId) || !digest(value.snapshotReviewHash)
    || !record(value.review) || !closed(value.review, reviewKeys)) return fail();
  const review = value.review;
  if (!id(review.id) || review.id !== value.snapshotReviewId
    || review.objectId !== value.objectId || review.sourceInternalId !== value.sourceInternalId
    || review.sourceSha256 !== value.sourceSha256 || !digest(review.contentHash)
    || !["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(review.revisionStatus as string)
    || !["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(review.approvalStatus as string)
    || (review.linkGroupId !== null && (typeof review.linkGroupId !== "string"
      || review.linkGroupId.trim() !== review.linkGroupId || review.linkGroupId.length < 1 || review.linkGroupId.length > 120))
    || (review.sectionCode !== null && !(sourceSectionCodes as readonly unknown[]).includes(review.sectionCode))
    || !record(review.pageStages) || typeof review.basisReference !== "string"
    || review.basisReference.trim() !== review.basisReference
    || review.basisReference.length < 8 || review.basisReference.length > 1000
    || !nonempty(review.actorId)) return fail();
  for (const [key, stage] of Object.entries(review.pageStages)) {
    if (!page.test(key) || Number(key) > (value.sourcePageCount as number)
      || !["PD", "RD", "ID", "UNRESOLVED"].includes(stage as string)) return fail();
  }
  for (const key of scopeKeys) if (review[key] !== null && !record(review[key])) return fail();

  // Match the existing writer's complete historical hash domain exactly.
  const body: Record<string, unknown> = {
    objectApiId: value.objectApiId, sourceFileApiId: value.sourceFileApiId,
    sourceSha256: value.sourceSha256, revisionStatus: review.revisionStatus,
    approvalStatus: review.approvalStatus, linkGroupId: review.linkGroupId,
    ...(review.sectionCode ? { sectionCode: review.sectionCode } : {}),
    pageStages: review.pageStages, basis: { reference: review.basisReference },
    actorId: review.actorId,
  };
  for (const key of scopeKeys) if (review[key] !== null) body[key] = review[key];
  const canonical = canonicalJson(body);
  const contentHash = sha256(canonical);
  if (contentHash !== review.contentHash || contentHash !== value.snapshotReviewHash) return fail();
  return { reviewDecisionId: review.id, reviewContentHash: contentHash,
    body: JSON.parse(canonical) as Record<string, unknown> };
}
