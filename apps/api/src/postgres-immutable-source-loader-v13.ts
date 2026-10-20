/** Output-only bridge for the existing seven-domain preparation's base input. */
import type { PoolClient } from "pg";
import { captureImmutableSourceQueryV13 } from "./postgres-immutable-source-query-v13.js";
import { ImmutableSourceInputsV13Error, materializeImmutableSourceInputsV13,
  type ImmutableSourceInputsV13 } from "./matrix-immutable-source-inputs-v13.js";

export interface LoadedImmutableSourceInputsV13 extends ImmutableSourceInputsV13 {
  readonly inputManifestHash: string;
}

/**
 * The caller supplies its checked, scoped transaction client. This function is
 * structurally compatible with AuthenticateInventoryBase without importing that
 * runtime or invoking its public readers. Full historical parent metadata stays
 * available for scalar assembly; the seven existing typed validators retain
 * responsibility for their own scopes, snapshots and origins.
 *
 * Release identity here comes from the actual scoped run join, never a worker
 * DTO. The caller independently admits the complete persisted release policy.
 * No original-PDF I/O, current eligibility or actor authorization occurs here.
 */
export async function loadImmutableSourceInputsV13(
  client: PoolClient, runId: string, objectId: string,
): Promise<LoadedImmutableSourceInputsV13 | null> {
  const capture = await captureImmutableSourceQueryV13(client, runId, objectId);
  if (capture === null) return null;
  const releaseId = capture.rows[0]?.run_release_id;
  if (typeof releaseId !== "string" || releaseId.length === 0) throw new ImmutableSourceInputsV13Error();
  const base = materializeImmutableSourceInputsV13(capture, { runId, objectId, releaseId });
  return { ...base, inputManifestHash: base.metadata.inputManifestHash };
}
