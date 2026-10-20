/** Output-only scoped-capture materialization. Original PDF I/O and release admission remain external. */
import { canonicalJson, sha256 } from "./canonical-json.js";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";
import { composeSourceSnapshotsV13, type SourceSnapshotCompositionV13 } from "./matrix-source-snapshot-composition-v13.js";
import type { ImmutableSourceQueryV13Capture, ImmutableSourceQueryV13Row } from "./postgres-immutable-source-query-v13.js";

export class ImmutableSourceInputsV13Error extends TypeError {
  readonly code = "IMMUTABLE_SOURCE_INPUTS_UNVERIFIED";
  constructor() { super("IMMUTABLE_SOURCE_INPUTS_UNVERIFIED"); }
}
export interface ImmutableSourceInputsV13 {
  readonly metadata: SourceSnapshotCompositionV13;
  readonly sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
    byteSize: number; pageCount: number; mediaType: string; stages: Array<"PD" | "RD" | "ID">;
    sectionCode: string | null }>;
  readonly textArtifacts: Array<{ sourceFileId: string; contentSha256: string; artifact: Record<string, unknown> }>;
  readonly pdfStorageRefs: Record<string, { storageKey: string; sha256: string; byteSize: number }>;
}
const fail = (): never => { throw new ImmutableSourceInputsV13Error(); };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}(?![\s\S])/u.test(value);
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/iu.test(value);
const closed = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// PostgreSQL bigint values are decimal strings. Do not coerce null, booleans,
// whitespace, exponent notation or fractional values into valid sizes.
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(0|[1-9][0-9]*)(?![\s\S])/u.test(value))) return fail();
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fail();
}
const parentColumns = ["review_id", "review_object_id", "review_source_file_id", "review_source_sha256",
  "revision_status", "approval_status", "link_group_id", "section_code", "page_stages", "basis_reference",
  "actor_id", "review_content_hash", "matrix_scope", "inventory_scope", "call_inventory_scope",
  "rail_inventory_scope", "water_node_scope", "lighting_technology_scope", "steel_comparison_scope"] as const;
function parent(row: ImmutableSourceQueryV13Row): Record<string, unknown> | null {
  if (row.review_id === null) {
    if (parentColumns.some(key => row[key] !== null)) return fail();
    return null;
  }
  return { id: row.review_id, objectId: row.review_object_id, sourceInternalId: row.review_source_file_id,
    sourceSha256: row.review_source_sha256, revisionStatus: row.revision_status,
    approvalStatus: row.approval_status, linkGroupId: row.link_group_id, sectionCode: row.section_code,
    pageStages: row.page_stages, basisReference: row.basis_reference, actorId: row.actor_id,
    contentHash: row.review_content_hash, matrixScope: row.matrix_scope, inventoryScope: row.inventory_scope,
    callInventoryScope: row.call_inventory_scope, railInventoryScope: row.rail_inventory_scope,
    waterNodeScope: row.water_node_scope, lightingTechnologyScope: row.lighting_technology_scope,
    steelComparisonScope: row.steel_comparison_scope };
}

/**
 * Only the protected SQL caller may supply this capture and authenticated run,
 * object and release identity. Hash agreement is not membership authorization.
 * Full parent bodies stay available for the seven downstream typed validators;
 * missing reviews remain null. This function never supplies current eligibility
 * or retained origin authority, and never creates a review decision or proof.
 */
export function materializeImmutableSourceInputsV13(
  capture: ImmutableSourceQueryV13Capture, context: { runId: string; objectId: string; releaseId: string },
): ImmutableSourceInputsV13 {
  // Entire raw result first: even an unused column cannot hide a getter/proxy.
  assertConcreteWallLeaseNativeV13({ capture, context });
  if (!record(capture) || !closed(capture, ["scope", "rows"]) || !record(capture.scope)
    || !closed(capture.scope, ["inspection_id", "object_id", "manifest_hash", "manifest_json"]) || !Array.isArray(capture.rows)
    || capture.rows.length < 1 || capture.rows.length > 64 || !record(context)
    || Object.keys(context).length !== 3 || !["runId", "objectId", "releaseId"].every(key => Object.hasOwn(context, key))
    || !uuid(context.runId)
    || typeof context.releaseId !== "string" || context.releaseId.length === 0
    || capture.scope.object_id !== context.objectId || !hash(capture.scope.manifest_hash)) return fail();
  const objectApiId = capture.rows[0]?.object_api_id;
  if (typeof objectApiId !== "string" || objectApiId.length === 0) return fail();
  const metadata = composeSourceSnapshotsV13({ objectId: context.objectId, objectApiId,
    inspectionId: capture.scope.inspection_id, inputManifestHash: capture.scope.manifest_hash,
    manifest: capture.scope.manifest_json,
    sources: capture.rows.map(row => {
      if (!record(row) || row.object_api_id !== objectApiId) return fail();
      return { sourceObjectId: row.source_object_id, sourceInternalId: row.source_internal_id,
        sourceFileApiId: row.source_file_id, sourceSha256: row.source_sha256,
        sourcePageCount: row.blob_media_type === "application/pdf" ? integer(row.text_page_count, 1, 2000) : 0,
        ...(row.blob_media_type !== "application/pdf" ? { unpaginated: true } : {}),
        snapshotReviewId: row.snapshot_decision_id, snapshotReviewHash: row.snapshot_hash, review: parent(row) };
    }) });
  const sourceFiles: ImmutableSourceInputsV13["sourceFiles"] = [];
  const textArtifacts: ImmutableSourceInputsV13["textArtifacts"] = [];
  const pdfStorageRefs: ImmutableSourceInputsV13["pdfStorageRefs"] = Object.create(null);
  const seenHashes = new Set<string>();
  for (const [index, row] of capture.rows.entries()) {
    const source = metadata.sources[index]!;
    const byteSize = integer(row.blob_byte_size, 1, 67_108_864);
    if (seenHashes.has(source.sha256) || row.blob_object_id !== context.objectId
      || row.blob_sha256 !== source.sha256 || row.inclusion_role !== "SOURCE"
      || !["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/xml", "image/vnd.dwg"].includes(row.blob_media_type)
      || row.blob_scan_status !== "CLEAN"
      || typeof row.storage_key !== "string" || row.storage_key.length === 0
      || !uuid(row.text_job_id)
      || row.text_job_run_id !== context.runId || row.text_job_object_id !== context.objectId
      || row.text_job_type !== "DOCUMENT_TEXT_LAYER" || row.text_job_state !== "SUCCEEDED"
      || row.text_job_manifest_hash !== metadata.inputManifestHash
      || row.run_release_id !== context.releaseId || row.text_job_release_id !== context.releaseId) return fail();
    if (row.blob_media_type !== "application/pdf") {
      // These accepted originals remain part of the immutable manifest. This
      // release declares PDF text extraction only: authenticate its explicit
      // skip instead of inventing PDF pages, geometry or negative predictions.
      const result = row.text_job_result;
      if (row.text_artifact !== null || row.text_hash !== null || row.text_byte_size !== null
        || row.text_input_sha256 !== null || row.text_page_count !== null || row.text_schema_version !== null
        || !record(result) || result.disposition !== "DOCUMENT_TEXT_LAYER_COMPLETED"
        || !Array.isArray(result.sources)) return fail();
      const skipped = result.sources.filter(item => record(item) && item.sourceFileId === source.sourceFileId);
      if (skipped.length !== 1 || !record(skipped[0]) || skipped[0].inputSha256 !== source.sha256
        || skipped[0].status !== "SKIPPED_UNSUPPORTED_FORMAT"
        || typeof skipped[0].reason !== "string" || skipped[0].reason.length < 1 || skipped[0].reason.length > 500) return fail();
      seenHashes.add(source.sha256);
      sourceFiles.push({ sourceFileId: source.sourceFileId, objectId: objectApiId, sha256: source.sha256,
        byteSize, pageCount: 0, mediaType: row.blob_media_type,
        stages: [...source.originalStages], sectionCode: (source.sourceReview?.body.sectionCode ?? null) as string | null });
      continue;
    }
    if (byteSize < 5 || row.text_schema_version !== "document-text-v2"
      || row.text_input_sha256 !== source.sha256 || !hash(row.text_hash) || !record(row.text_artifact)) return fail();
    const artifact = row.text_artifact;
    if (artifact.schemaVersion !== "document-text-v2" || artifact.sourceFileId !== source.sourceFileId
      || artifact.inputSha256 !== source.sha256 || artifact.pageCount !== source.pageCount
      || !Array.isArray(artifact.pages) || artifact.pages.length !== source.pageCount) return fail();
    const canonical = canonicalJson(artifact);
    if (sha256(canonical) !== row.text_hash
      || Buffer.byteLength(canonical, "utf8") !== integer(row.text_byte_size, 1, 67_108_864)) return fail();
    seenHashes.add(source.sha256);
    sourceFiles.push({ sourceFileId: source.sourceFileId, objectId: objectApiId, sha256: source.sha256,
      byteSize, pageCount: source.pageCount, mediaType: row.blob_media_type,
      stages: [...source.originalStages], sectionCode: (source.sourceReview?.body.sectionCode ?? null) as string | null });
    textArtifacts.push({ sourceFileId: source.sourceFileId, contentSha256: row.text_hash,
      artifact: JSON.parse(canonical) as Record<string, unknown> });
    pdfStorageRefs[source.sourceFileId] = { storageKey: row.storage_key, sha256: source.sha256, byteSize };
  }
  return { metadata, sourceFiles, textArtifacts, pdfStorageRefs };
}
