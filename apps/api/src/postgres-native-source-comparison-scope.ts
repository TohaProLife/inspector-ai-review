import type { PoolClient } from "pg";
import type { AuthenticatedActor } from "./identity.js";
import { NativeSourceComparisonError } from "./native-source-comparison-error.js";

export type NativeSourceComparisonScope = { object_id: string; object_api_id: string; run_id: string; check_id: string; inspection_id: string;
  manifest_hash: string; release_id: string; eligible: boolean };
export async function nativeSourceComparisonScope(client: PoolClient, checkId: string, actor: AuthenticatedActor): Promise<NativeSourceComparisonScope> {
  const rows = await client.query<NativeSourceComparisonScope>(`SELECT object.id AS object_id,object.api_id AS object_api_id,run.id AS run_id,
    run.api_id AS check_id,run.inspection_id,manifest.sha256 AS manifest_hash,run.release_id,
    COALESCE((run.sealed_at IS NOT NULL AND run.run_state IN ('SUCCEEDED','PARTIAL')
      AND release.content_json->'textLayer'->>'sourceAuditProfileVersion'='SOURCE_AUDIT_V4_FULL_SOURCE_V1'),false) AS eligible
    FROM analysis_runs run JOIN objects object ON object.id=run.object_id
    JOIN input_manifests manifest ON manifest.id=run.manifest_id
    JOIN analysis_releases release ON release.release_id=run.release_id
    JOIN object_memberships access ON access.object_id=object.id AND access.user_id=$3
    JOIN inspector_users actor ON actor.id=access.user_id AND actor.enabled=true
    WHERE run.api_id=$2 AND run.mode='NORMAL' AND object.organization_id=$1
      AND access.revoked_at IS NULL AND access.permission_set @> ARRAY['READ']::text[]
      AND EXISTS(SELECT 1 FROM organization_memberships member WHERE member.organization_id=$1
        AND member.user_id=$3 AND member.revoked_at IS NULL)`, [actor.organizationId, checkId, actor.userId]);
  if (!rows.rows[0]) throw new NativeSourceComparisonError(404, "NOT_FOUND", "Проверка недоступна");
  return rows.rows[0];
}
