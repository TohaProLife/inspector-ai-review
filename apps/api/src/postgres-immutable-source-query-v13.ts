import type { PoolClient } from "pg";

/** Raw JSONB data only. These types do not authenticate database content. */
export type ImmutableSourceJsonV13 = null | boolean | number | string
  | ImmutableSourceJsonV13[] | ImmutableSourceJsonObjectV13;
export interface ImmutableSourceJsonObjectV13 {
  [key: string]: ImmutableSourceJsonV13;
}

export interface ImmutableSourceQueryV13Scope {
  inspection_id: string;
  object_id: string;
  manifest_hash: string;
  manifest_json: ImmutableSourceJsonObjectV13;
}

export interface ImmutableSourceQueryV13Row {
  source_internal_id: string;
  source_file_id: string;
  source_object_id: string;
  object_api_id: string;
  blob_object_id: string;
  source_sha256: string;
  blob_sha256: string;
  blob_byte_size: number | string;
  blob_media_type: string;
  blob_scan_status: string;
  storage_key: string;
  inclusion_role: string;
  snapshot_decision_id: string | null;
  snapshot_hash: string | null;
  // Complete 19-field parent projection, including all seven nullable scopes.
  review_id: string | null;
  review_object_id: string | null;
  review_source_file_id: string | null;
  review_source_sha256: string | null;
  revision_status: string | null;
  approval_status: string | null;
  link_group_id: string | null;
  section_code: string | null;
  page_stages: ImmutableSourceJsonObjectV13 | null;
  basis_reference: string | null;
  actor_id: string | null;
  review_content_hash: string | null;
  matrix_scope: ImmutableSourceJsonObjectV13 | null;
  inventory_scope: ImmutableSourceJsonObjectV13 | null;
  call_inventory_scope: ImmutableSourceJsonObjectV13 | null;
  rail_inventory_scope: ImmutableSourceJsonObjectV13 | null;
  water_node_scope: ImmutableSourceJsonObjectV13 | null;
  lighting_technology_scope: ImmutableSourceJsonObjectV13 | null;
  steel_comparison_scope: ImmutableSourceJsonObjectV13 | null;
  text_job_id: string | null;
  text_job_run_id: string | null;
  text_job_object_id: string | null;
  text_job_type: string | null;
  text_job_state: string | null;
  text_job_manifest_hash: string | null;
  text_job_release_id: string | null;
  run_release_id: string;
  text_artifact: ImmutableSourceJsonObjectV13 | null;
  text_hash: string | null;
  text_byte_size: number | string | null;
  text_input_sha256: string | null;
  text_page_count: number | null;
  text_schema_version: string | null;
  text_job_result?: ImmutableSourceJsonObjectV13 | null;
}

export interface ImmutableSourceQueryV13Capture {
  scope: ImmutableSourceQueryV13Scope;
  rows: ImmutableSourceQueryV13Row[];
}

/**
 * Output-only v13 raw capture seam; not a loader or an authority validator.
 * Caller supplies its checked A transaction client and freshly authorized internal
 * run/object IDs. Same transaction/fresh-scope requirements remain with caller.
 * Original stages must later be read from the authenticated manifest_json array.
 * Current stages/reviews are separate contexts and are deliberately not queried.
 * All manifest/source/review/text/job/release/PDF checks remain downstream.
 */
export async function captureImmutableSourceQueryV13(
  client: PoolClient, runId: string, objectId: string,
): Promise<ImmutableSourceQueryV13Capture | null> {
  const scope = await client.query<ImmutableSourceQueryV13Scope>(
    `SELECT run.inspection_id, run.object_id, manifest.sha256 AS manifest_hash,
            manifest.canonical_json AS manifest_json
     FROM analysis_runs run
     JOIN input_manifests manifest ON manifest.id = run.manifest_id
       AND manifest.inspection_id = run.inspection_id
     WHERE run.id = $1 AND run.object_id = $2`, [runId, objectId],
  );
  if (scope.rows.length !== 1) return null;
  const result = await client.query<ImmutableSourceQueryV13Row>(
    `SELECT source.id AS source_internal_id, source.api_id AS source_file_id,
            source.object_id AS source_object_id, object.api_id AS object_api_id,
            blob.object_id AS blob_object_id, item.blob_sha256 AS source_sha256,
            blob.sha256 AS blob_sha256, blob.byte_size AS blob_byte_size,
            blob.media_type AS blob_media_type, blob.scan_status AS blob_scan_status,
            blob.storage_key, item.inclusion_role,
            snapshot.decision_id AS snapshot_decision_id,
            snapshot.decision_hash AS snapshot_hash,
            review.id AS review_id, review.object_id AS review_object_id,
            review.source_file_id AS review_source_file_id,
            review.source_sha256 AS review_source_sha256,
            review.revision_status, review.approval_status, review.link_group_id,
            review.section_code, review.page_stages, review.basis_reference,
            review.actor_id, review.content_hash AS review_content_hash,
            review.matrix_scope, review.inventory_scope, review.call_inventory_scope,
            review.rail_inventory_scope, review.water_node_scope,
            review.lighting_technology_scope, review.steel_comparison_scope,
            text_job.id AS text_job_id, text.content_json AS text_artifact,
            text.content_hash AS text_hash, text.byte_size AS text_byte_size,
            text.input_sha256 AS text_input_sha256, text.page_count AS text_page_count,
            text.schema_version AS text_schema_version,
            text_job.run_id AS text_job_run_id, text_job.object_id AS text_job_object_id,
            text_job.job_type AS text_job_type, text_job.state AS text_job_state,
            text_job.input_manifest_hash AS text_job_manifest_hash,
            text_job.release_id AS text_job_release_id,
            run.release_id AS run_release_id, text_job.result_json AS text_job_result
     FROM analysis_runs run
     JOIN objects object ON object.id = run.object_id
     JOIN manifest_items item ON item.manifest_id = run.manifest_id
     JOIN source_files source ON source.id = item.source_file_id
     JOIN blobs blob ON blob.id = source.blob_id
     LEFT JOIN run_source_review_snapshots snapshot
       ON snapshot.run_id = run.id AND snapshot.source_file_id = source.id
     LEFT JOIN source_review_decisions review ON review.id = snapshot.decision_id
     LEFT JOIN analysis_text_artifacts text
       ON text.run_id = run.id AND text.source_file_id = source.id
         AND text.schema_version = 'document-text-v2'
     LEFT JOIN analysis_jobs text_job ON text_job.run_id = run.id
       AND text_job.job_type = 'DOCUMENT_TEXT_LAYER'
       AND (text.job_id IS NULL OR text_job.id = text.job_id)
     WHERE run.id = $1 AND run.object_id = $2
     ORDER BY source.api_id`, [runId, objectId],
  );
  return { scope: scope.rows[0]!, rows: result.rows };
}
