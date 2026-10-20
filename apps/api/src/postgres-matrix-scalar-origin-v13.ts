import type { PoolClient } from "pg";
import {
  captureImmutableSourceQueryV13,
  type ImmutableSourceQueryV13Capture,
} from "./postgres-immutable-source-query-v13.js";

/** Raw persisted scalar projection; no schema, hash or policy authentication. */
export interface MatrixScalarOriginV13Row {
  id: string;
  content_json: Record<string, unknown>;
  content_hash: string;
  byte_size: number | string;
  input_manifest_hash: string;
  provider_profile_id: string;
  provider_config_hash: string;
  schema_version: string;
  provider_kind: string;
  disposition: string;
  release_id: string;
  release_json: Record<string, unknown>;
  release_hash: string;
  release_byte_size: number | string;
}

export interface MatrixScalarOriginV13Capture {
  stage: MatrixScalarOriginV13Row;
  inputs: ImmutableSourceQueryV13Capture;
}

/**
 * Output-only raw historical-origin capture; not an authority/semantic validator.
 * objectId is internal object UUID; checkId is public analysis_runs.api_id.
 * Caller owns actor/org/fresh scope, checked transaction client and isolation.
 * No transaction is opened here. Every SELECT uses exactly that supplied client.
 *
 * Profile filtering is intentionally deferred: caller must authenticate the exact
 * persisted profile/release and complete stage/hash/bytes/manifest/source/PDF chain.
 * Raw unknown profiles and duplicate rows must not become implicit authorization.
 * Nothing is trimmed, coerced, canonicalized, filtered or replaced with current data.
 */
export async function captureMatrixScalarOriginV13(
  client: PoolClient, objectId: string, checkId: string,
): Promise<MatrixScalarOriginV13Capture | null> {
  const saved = await client.query<MatrixScalarOriginV13Row>(
    `SELECT run.id,stage.content_json,stage.content_hash,stage.byte_size,stage.input_manifest_hash,
         stage.provider_profile_id,stage.provider_config_hash,stage.schema_version,stage.provider_kind,
         stage.disposition,run.release_id,release.content_json AS release_json,
         release.content_hash AS release_hash,release.byte_size AS release_byte_size FROM analysis_runs run
       JOIN analysis_stage_artifacts stage ON stage.run_id=run.id AND stage.job_type='RULE_EVALUATION'
       JOIN analysis_jobs job ON job.id=stage.job_id AND job.run_id=run.id
         AND job.object_id=run.object_id AND job.job_type=stage.job_type AND job.state='SUCCEEDED'
         AND job.release_id=run.release_id AND job.input_manifest_hash=stage.input_manifest_hash
       JOIN analysis_releases release ON release.release_id=run.release_id
       WHERE run.object_id=$1 AND run.api_id=$2 AND run.sealed_at IS NOT NULL
         AND run.run_state IN ('SUCCEEDED','PARTIAL')`, [objectId, checkId],
  );
  if (saved.rows.length !== 1) return null;
  const row = saved.rows[0]!;
  const inputs = await captureImmutableSourceQueryV13(client, row.id, objectId);
  if (inputs === null) return null;
  return { stage: row, inputs };
}
