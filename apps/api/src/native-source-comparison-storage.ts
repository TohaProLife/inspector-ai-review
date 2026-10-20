import type { PoolClient } from "pg";
import type { NativeCapacityRecord, NativeAirflowRecord } from "@inspector-ai/contracts";
import { NativeSourceComparisonError } from "./native-source-comparison-error.js";

type Kind = "CAPACITY" | "AIRFLOW";
const tables = { CAPACITY: "native_capacity_comparisons", AIRFLOW: "native_airflow_comparisons" } as const;
export const nativeSourceHistoryLimits = { records: 1000, bytes: 16 * 1024 * 1024 } as const;
let activeCaptures = 0;
/** Both lanes share one memory budget; release in the caller's finally block. */
export function beginNativeSourceComparisonCapture(kind: Kind): () => void {
  if (activeCaptures >= 2) throw new NativeSourceComparisonError(503, `NATIVE_${kind}_BUSY`, "Выполняются другие сверки. Повторите через несколько секунд");
  activeCaptures++;
  let released = false;
  return () => { if (!released) { released = true; activeCaptures--; } };
}
/** Must precede the second winner lookup and history budget check in the same transaction. */
export async function lockNativeSourceComparisonHistory(client: PoolClient, runId: string, kind: Kind): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`native-source-history:${kind}:${runId}`]);
}
/** Called only for a genuinely new winner while holding the run history lock. */
export async function assertNativeSourceComparisonHistoryBudget(client: PoolClient, runId: string, kind: Kind, newBytes: number): Promise<void> {
  const budget = (await client.query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,
    coalesce(sum(octet_length(content_text)),0)::text AS bytes FROM ${tables[kind]} WHERE run_id=$1`, [runId])).rows[0];
  if (!Number.isSafeInteger(newBytes) || newBytes < 1 || !budget
    || BigInt(budget.count) >= BigInt(nativeSourceHistoryLimits.records)
    || BigInt(budget.bytes) + BigInt(newBytes) > BigInt(nativeSourceHistoryLimits.bytes))
    throw new NativeSourceComparisonError(413, `NATIVE_${kind}_RECORD_LIMIT`, "Лимит сохранённой истории этой проверки исчерпан. Ранее сохранённые сверки доступны для чтения");
}
/** Integrity hash is insufficient: also bind every nested source/evidence address to the saved command. */
export function nativeSourceComparisonBindingsMatch(record: Omit<NativeCapacityRecord | NativeAirflowRecord, "contentHash">): boolean {
  const comparison = record.comparison;
  const matches = (line: { inputRole: string; sourceFileId: string; sourceSha256: string; textArtifactContentHash: string }, role: "PD" | "RD") => {
    if (comparison.status !== "COMPARED") return false;
    const source = comparison.sources[role];
    return line.inputRole === role && line.sourceFileId === source.sourceFileId && line.sourceSha256 === source.sourceSha256
      && line.textArtifactContentHash === source.textArtifactContentHash;
  };
  if (comparison.status === "ABSTAIN") {
    // Capacity preserves excluded fragments even on abstention. They still refer to the explicit input roles.
    return !("excludedTitleFragments" in comparison) || comparison.excludedTitleFragments.every(line => {
      const pd = line.inputRole === "PD";
      return line.sourceFileId === (pd ? record.input.pdSourceFileId : record.input.rdSourceFileId)
        && line.sourceSha256 === (pd ? record.bindings.pdSourceSha256 : record.bindings.rdSourceSha256);
    });
  }
  if (comparison.status !== "COMPARED") return false;
  for (const role of ["PD", "RD"] as const) {
    const source = comparison.sources[role], pd = role === "PD";
    if (!source || source.checkId !== record.checkId || source.sourceFileId !== (pd ? record.input.pdSourceFileId : record.input.rdSourceFileId)
      || source.sourceSha256 !== (pd ? record.bindings.pdSourceSha256 : record.bindings.rdSourceSha256)
      || source.inputManifestHash !== record.bindings.inputManifestHash
      || source.textArtifactByteSha256 !== (pd ? record.bindings.pdTextArtifactHash : record.bindings.rdTextArtifactHash)
      || source.selectedRole !== role || !Array.isArray(comparison.quotes[role]) || !comparison.quotes[role].length
      || !comparison.quotes[role].every(line => matches(line, role))) return false;
    if ("references" in comparison && (!Array.isArray(comparison.references[role])
      || !comparison.references[role].every(line => matches(line, role)))) return false;
  }
  return !("excludedTitleFragments" in comparison)
    || comparison.excludedTitleFragments.every(line => matches(line, line.inputRole));
}
