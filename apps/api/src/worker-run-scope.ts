import type { PoolClient } from "pg";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { isFrozenSourceAuditRelease } from "./source-audit-release-identity.js";

/** A detached audit is an explicitly frozen lane, never a stale NORMAL run.
 * Caller still checks OPEN lifecycle, run state, lease and fencing token.
 */
export async function isDetachedSourceAuditJob(client: PoolClient, jobId: string,
  runId: string, organizationId: string): Promise<boolean> {
  const rows = (await client.query<{ release_id: string; content_json: unknown;
    content_hash: string; byte_size: number | string }>(
    `SELECT release.release_id,release.content_json,release.content_hash,release.byte_size
     FROM analysis_jobs job
     JOIN analysis_runs run ON run.id=job.run_id AND run.object_id=job.object_id
       AND run.inspection_id=job.inspection_id AND run.release_id=job.release_id
     JOIN objects object ON object.id=run.object_id AND object.organization_id=job.organization_id
     JOIN input_manifests manifest ON manifest.id=run.manifest_id
       AND manifest.inspection_id=run.inspection_id AND manifest.sha256=job.input_manifest_hash
     JOIN analysis_releases release ON release.release_id=job.release_id
     WHERE job.id=$1 AND run.id=$2 AND job.organization_id=$3`,
    [jobId, runId, organizationId])).rows;
  if (rows.length !== 1) return false;
  const row = rows[0]!;
  if (!isFrozenSourceAuditRelease(row.content_json)) return false;
  const canonical = canonicalJson(row.content_json);
  return (row.content_json as { releaseId?: unknown }).releaseId === row.release_id
    && sha256(canonical) === row.content_hash.trim()
    && Buffer.byteLength(canonical, "utf8") === Number(row.byte_size);
}
