/** Protected KR-060 preparation. This does not authorize an actor or verify PDF bytes.
 * The caller must verify references outside locks and reprepare in a fresh scoped transaction. */
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
import type { PoolClient } from "pg";
import { sourceSectionCodes } from "@inspector-ai/contracts";
import type {
  ColumnPylonSectionV2Origin, ColumnPylonSectionV2Source,
} from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { loadColumnPylonSectionV2ImmutableOrigin, ColumnPylonSectionOriginMemo } from "./postgres-column-pylon-section-v2-origin.js";
import type { OriginalPdfReference } from "./verified-pdf-io.js";

export class ColumnPylonSectionInputError extends Error {
  constructor(readonly code: "KR060_INPUT_INTEGRITY" | "KR060_INPUT_LIMIT") {
    super(code); this.name = "ColumnPylonSectionInputError";
  }
}
function invalid(): never { throw new ColumnPylonSectionInputError("KR060_INPUT_INTEGRITY"); }
function validPageStages(value: unknown, pageCount: number): value is Record<string,"PD"|"RD"|"ID"|"UNRESOLVED"> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length <= 512 && Object.entries(value).every(([page,stage]) =>
      /^[1-9][0-9]{0,2}$/.test(page) && Number(page) <= pageCount
      && ["PD","RD","ID","UNRESOLVED"].includes(stage as string));
}
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/iu;

interface SourceRow {
  id: string; api_id: string; object_id: string; blob_object_id: string; sha256: string;
  storage_key: string; byte_size: string | number; media_type: string; scan_status: string;
  stages: Array<"PD" | "RD" | "ID">; latest_review_id: string | null;
}
interface ReviewRow {
  id: string; object_id: string; source_file_id: string; source_sha256: string;
  revision_status: string; approval_status: string; section_code: string | null;
  link_group_id: string | null; page_stages: Record<string, string>; basis_reference: string;
  actor_id: string; content_hash: string; matrix_scope: unknown; inventory_scope: unknown;
  call_inventory_scope: unknown; rail_inventory_scope: unknown; water_node_scope: unknown;
  lighting_technology_scope: unknown; steel_comparison_scope: unknown;
}

/** Reconstruct the ORIGINAL full parent hash. Compact v2 metadata is not a new parent authority. */
function projectReview(row: ReviewRow, source: SourceRow, objectApiId: string):
  NonNullable<ColumnPylonSectionV2Source["review"]> {
  if (!UUID.test(row.id) || row.object_id !== source.object_id || row.source_file_id !== source.id
    || row.source_sha256.trim() !== source.sha256.trim() || !SHA.test(row.content_hash.trim())) invalid();
  const parent = {
    objectApiId, sourceFileApiId: source.api_id, sourceSha256: row.source_sha256.trim(),
    revisionStatus: row.revision_status, approvalStatus: row.approval_status,
    linkGroupId: row.link_group_id, ...(row.section_code ? { sectionCode: row.section_code } : {}),
    pageStages: row.page_stages, basis: { reference: row.basis_reference },
    ...Object.fromEntries([
      ["matrixScope", row.matrix_scope], ["inventoryScope", row.inventory_scope],
      ["callInventoryScope", row.call_inventory_scope], ["railInventoryScope", row.rail_inventory_scope],
      ["waterNodeScope", row.water_node_scope], ["lightingTechnologyScope", row.lighting_technology_scope],
      ["steelComparisonScope", row.steel_comparison_scope],
    ].filter(([, value]) => value)), actorId: row.actor_id,
  };
  if (sha256(canonicalJson(parent)) !== row.content_hash.trim()) invalid();
  if (!["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(row.revision_status)
    || !["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(row.approval_status)
    || row.section_code !== null && !(sourceSectionCodes as readonly string[]).includes(row.section_code)
    || row.link_group_id !== null && (typeof row.link_group_id !== "string" || row.link_group_id.length < 1
      || row.link_group_id.length > 200 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufffd]/u.test(row.link_group_id))) invalid();
  return {
    decisionId: row.id, contentHash: row.content_hash.trim(),
    revisionStatus: row.revision_status as "CURRENT" | "SUPERSEDED" | "UNKNOWN",
    approvalStatus: row.approval_status as "APPROVED" | "UNAPPROVED" | "UNKNOWN",
    sectionCode: row.section_code as NonNullable<ColumnPylonSectionV2Source["review"]>["sectionCode"],
    linkGroupId: row.link_group_id,
    pageStages: row.page_stages as NonNullable<ColumnPylonSectionV2Source["review"]>["pageStages"],
  };
}

export interface ColumnPylonSectionSourcePreparationInput {
  /** Private DB object UUID, never included in v2 wire/hash domains. */
  objectId: string;
  /** Public API object ID, used in every v2 origin and comparison. */
  objectApiId: string;
  sourceFileId: string;
  checkId: string;
  /** Omitted for current comparison/preview; explicit only for immutable historical reconstruction. */
  historicalReviewDecisionId?: string;
}
export interface PreparedColumnPylonSectionSource {
  source: ColumnPylonSectionV2Source;
  origin: ColumnPylonSectionV2Origin;
  sourceInternalId: string;
  reference: OriginalPdfReference;
  fingerprint: string;
}

/** Two finite callers: one source preview, or two reviewed pair operands.
 * Uses a private immutable-manifest origin reader; the old public reader stays unchanged. */
export async function prepareColumnPylonSectionSource(client: PoolClient,
  input: ColumnPylonSectionSourcePreparationInput, unconfiguredScaffold: unknown, budget?: MatrixPreparationBudgetV13,
  originMemo?: ColumnPylonSectionOriginMemo):
  Promise<PreparedColumnPylonSectionSource> {
  if (!UUID.test(input.objectId) || !input.objectApiId || input.objectApiId.length > 200
    || !input.sourceFileId || input.sourceFileId.length > 200 || !input.checkId || input.checkId.length > 200
    || input.historicalReviewDecisionId !== undefined && !UUID.test(input.historicalReviewDecisionId)) invalid();
  const rows = (await client.query<SourceRow>(`SELECT source.id,source.api_id,source.object_id,
      blob.object_id AS blob_object_id,blob.sha256,blob.storage_key,blob.byte_size,blob.media_type,blob.scan_status,
      ARRAY(SELECT stage.stage FROM source_file_stages stage WHERE stage.source_file_id=source.id ORDER BY stage.stage) AS stages,
      (SELECT review.id FROM source_review_decisions review WHERE review.source_file_id=source.id
        ORDER BY review.created_at DESC,review.id DESC LIMIT 1) AS latest_review_id
    FROM source_files source JOIN blobs blob ON blob.id=source.blob_id
    JOIN objects object ON object.id=source.object_id
    WHERE source.object_id=$1 AND source.api_id=$2 AND object.api_id=$3`,
  [input.objectId, input.sourceFileId, input.objectApiId])).rows;
  if (rows.length !== 1) invalid();
  const row = rows[0]!;
  const bytes = Number(row.byte_size), hash = row.sha256.trim();
  if (row.object_id !== input.objectId || row.blob_object_id !== input.objectId || row.api_id !== input.sourceFileId
    || !SHA.test(hash) || row.media_type !== "application/pdf" || row.scan_status !== "CLEAN"
    || !Number.isSafeInteger(bytes) || bytes < 5 || bytes > 64 * 1024 * 1024
    || typeof row.storage_key !== "string" || row.storage_key.length < 1 || row.storage_key.length > 4096
    || !input.historicalReviewDecisionId && (!Array.isArray(row.stages) || row.stages.length < 1 || row.stages.length > 3
      || new Set(row.stages).size !== row.stages.length || row.stages.some(stage => !["PD", "RD", "ID"].includes(stage)))) invalid();
  const read = originMemo
    ? await originMemo.load(client,input.objectId,input.checkId,input.sourceFileId,unconfiguredScaffold,budget)
    : budget === undefined
      ? await loadColumnPylonSectionV2ImmutableOrigin(client, input.objectId, input.checkId,
      input.sourceFileId, unconfiguredScaffold)
      : await loadColumnPylonSectionV2ImmutableOrigin(client, input.objectId, input.checkId,
      input.sourceFileId, unconfiguredScaffold, budget);
  if (!read || read.sourceSha256 !== hash) invalid();

  // The preceding reader authenticates the complete manifest and frozen review parents.
  // Retrieve original stage metadata from that SAME run, not a current review substitution.
  const originals = (await client.query(`SELECT manifest.canonical_json,
      snapshot.decision_id,snapshot.decision_hash,review.page_stages
    FROM analysis_runs run JOIN input_manifests manifest ON manifest.id=run.manifest_id
      AND manifest.inspection_id=run.inspection_id
    JOIN manifest_items item ON item.manifest_id=manifest.id AND item.source_file_id=$3
    LEFT JOIN run_source_review_snapshots snapshot ON snapshot.run_id=run.id AND snapshot.source_file_id=$3
    LEFT JOIN source_review_decisions review ON review.id=snapshot.decision_id AND review.source_file_id=$3
    WHERE run.object_id=$1 AND run.api_id=$2`, [input.objectId, input.checkId, row.id])).rows;
  if (originals.length !== 1) invalid();
  const original = originals[0]!;
  const originalSources: unknown = original.canonical_json?.sources;
  if (!Array.isArray(originalSources)) invalid();
  const selected = originalSources.filter(source => source?.sourceFileId === input.sourceFileId);
  if (selected.length !== 1 || selected[0].sha256 !== hash
    || selected[0].sourceReviewHash !== (original.decision_hash?.trim() ?? null)
    || (original.decision_id === null) !== (original.decision_hash === null)
    || !Array.isArray(selected[0].stages) || selected[0].stages.length < 1 || selected[0].stages.length > 3
    || new Set(selected[0].stages).size !== selected[0].stages.length
    || selected[0].stages.some((stage: unknown) => !["PD","RD","ID"].includes(stage as string))
    || !validPageStages(original.decision_id === null ? {} : original.page_stages,read.textArtifact.pageCount)) invalid();

  let review: ColumnPylonSectionV2Source["review"] = null;
  const decisionId = input.historicalReviewDecisionId ?? row.latest_review_id;
  if (decisionId) {
    if (budget !== undefined) await budget.sourceReview(row.id, decisionId);
    const reviews = (await client.query<ReviewRow>(`SELECT id,object_id,source_file_id,source_sha256,
        revision_status,approval_status,section_code,link_group_id,page_stages,basis_reference,actor_id,
        content_hash,matrix_scope,inventory_scope,call_inventory_scope,rail_inventory_scope,
        water_node_scope,lighting_technology_scope,steel_comparison_scope
      FROM source_review_decisions WHERE id=$1 AND object_id=$2 AND source_file_id=$3`,
    [decisionId, input.objectId, row.id])).rows;
    if (reviews.length !== 1) invalid();
    review = projectReview(reviews[0]!, row, input.objectApiId);
    if (!validPageStages(review.pageStages,read.textArtifact.pageCount)) invalid();
  }
  const source: ColumnPylonSectionV2Source = { sourceFileId: row.api_id, sourceSha256: hash,
    stages: input.historicalReviewDecisionId ? selected[0].stages : row.stages, review };
  const origin: ColumnPylonSectionV2Origin = {
    objectId: input.objectApiId, sourceFileId: row.api_id, sourceSha256: hash,
    target: {
      checkId: read.checkId, inputManifestHash: read.inputManifestHash,
      textStageContentHash: read.textStageContentHash, textArtifactByteSha256: read.textArtifactByteSha256,
      textArtifactContentHash: read.textArtifactContentHash, extractorProfileHash: read.extractorProfileHash,
      resourcePolicyVersion: read.resourcePolicyVersion, sourceAuditProfileVersion: read.sourceAuditProfileVersion,
    },
    stages: selected[0].stages,
    pageStages: original.decision_id === null ? {} : original.page_stages,
    textArtifact: read.textArtifact,
  };
  const body = { source, origin, sourceInternalId: row.id, reference: {
    storageKey: row.storage_key, expectedSha256: hash, expectedByteSize: bytes,
    expectedMediaType: "application/pdf" as const,
  } };
  return { ...body, fingerprint: sha256(canonicalJson(body)) };
}
