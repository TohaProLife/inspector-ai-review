/** Output-only immutable source metadata composition; persisted authority is external. */
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";
import { FrozenSourceManifestV13Error, pinFrozenSourceManifestV13 } from "./matrix-frozen-source-manifest-v13.js";
import { SourceReviewParentPinsV13Error, pinSourceReviewParentV13,
  type SourceReviewParentPinsV13 } from "./matrix-source-review-parent-pins-v13.js";

export class SourceSnapshotCompositionV13Error extends TypeError {
  readonly code = "SOURCE_SNAPSHOT_UNVERIFIED";
  constructor() { super("SOURCE_SNAPSHOT_UNVERIFIED"); }
}

export interface SourceSnapshotCompositionV13 {
  inspectionId: string;
  inputManifestHash: string;
  sources: Array<{ sourceFileId: string; sha256: string; pageCount: number;
    originalStages: Array<"PD" | "RD" | "ID">;
    sourceReview: SourceReviewParentPinsV13 | null }>;
}

const fail = (): never => { throw new SourceSnapshotCompositionV13Error(); };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/iu;
const rowKeys = ["sourceObjectId", "sourceInternalId", "sourceFileApiId", "sourceSha256",
  "sourcePageCount", "snapshotReviewId", "snapshotReviewHash", "review"];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function closed(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/**
 * Bind every ordered immutable manifest source to its full saved review parent.
 * The checked SQL caller supplies original run snapshots, never latest reviews
 * or current source stages. Matching these caller-supplied values does not prove
 * scoped DB access, original PDF integrity, child-domain validity or release.
 * Current eligibility remains a separate context evaluated after reconstruction.
 */
export function composeSourceSnapshotsV13(value: unknown): SourceSnapshotCompositionV13 {
  assertConcreteWallLeaseNativeV13(value);
  if (!record(value) || !closed(value, ["objectId", "objectApiId", "inspectionId",
    "inputManifestHash", "manifest", "sources"])
    || typeof value.objectId !== "string" || !uuid.test(value.objectId)
    || typeof value.objectApiId !== "string" || value.objectApiId.length === 0
    || !Array.isArray(value.sources)) return fail();
  try {
    const manifest = pinFrozenSourceManifestV13({ inspectionId: value.inspectionId,
      inputManifestHash: value.inputManifestHash, manifest: value.manifest });
    if (value.sources.length !== manifest.sources.length) return fail();
    const seen = new Set<string>();
    const sources: SourceSnapshotCompositionV13["sources"] = [];
    for (const [index, expected] of manifest.sources.entries()) {
      const row: unknown = value.sources[index];
      if (!record(row) || !(closed(row, rowKeys) || row.unpaginated === true && closed(row, [...rowKeys, "unpaginated"])) || row.sourceObjectId !== value.objectId
        || typeof row.sourceInternalId !== "string" || !uuid.test(row.sourceInternalId)
        || seen.has(row.sourceInternalId.toLowerCase()) || row.sourceFileApiId !== expected.sourceFileId
        || row.sourceSha256 !== expected.sha256) return fail();
      seen.add(row.sourceInternalId.toLowerCase());
      const parent = pinSourceReviewParentV13({ objectId: value.objectId,
        objectApiId: value.objectApiId, sourceInternalId: row.sourceInternalId,
        sourceFileApiId: row.sourceFileApiId, sourceSha256: row.sourceSha256,
        sourcePageCount: row.sourcePageCount, snapshotReviewId: row.snapshotReviewId,
        snapshotReviewHash: row.snapshotReviewHash, review: row.review }, row.unpaginated === true ? { unpaginated: true } : undefined);
      if ((parent?.reviewContentHash ?? null) !== expected.sourceReviewHash) return fail();
      sources.push({ sourceFileId: expected.sourceFileId, sha256: expected.sha256,
        pageCount: row.sourcePageCount as number, originalStages: expected.stages,
        sourceReview: parent });
    }
    return { inspectionId: manifest.inspectionId,
      inputManifestHash: manifest.inputManifestHash, sources };
  } catch (error) {
    if (error instanceof FrozenSourceManifestV13Error
      || error instanceof SourceReviewParentPinsV13Error) return fail();
    throw error;
  }
}
