import { beginNativeSourceComparisonCapture, lockNativeSourceComparisonHistory,
  assertNativeSourceComparisonHistoryBudget, nativeSourceComparisonBindingsMatch } from "./native-source-comparison-storage.js";
import { nativeSourceComparisonScope as scope, type NativeSourceComparisonScope as Scope } from "./postgres-native-source-comparison-scope.js";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { NativeCapacityCompareInput, NativeCapacityRecord, NativeCapacityWorkspace } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import type { AuthenticatedActor } from "./identity.js";
import type { AuditedMutationCommand } from "./repository.js";
import { compareNativeCapacity, verifyNativeCapacityComparisonHash } from "./native-capacity-comparison.js";
import { loadDocumentTextV4FullAuditSource } from "./postgres-document-text-v4-full-source.js";

import { NativeCapacityError, parseNativeCapacityInput } from "./native-capacity-input.js";
export { NativeCapacityError } from "./native-capacity-input.js";
const fail = (status: number, code: string, message: string): never => { throw new NativeCapacityError(status, code, message); };
const policy = "native-school-title-capacity-v1";
type Row = { id: string; content_text: string; content_hash: string; };
function read(row: Row, selected: Scope): NativeCapacityRecord {
  if (sha256(row.content_text) !== row.content_hash.trim()) fail(409, "NATIVE_CAPACITY_HASH_MISMATCH", "Сохранённая сверка повреждена");
  const value = JSON.parse(row.content_text) as Omit<NativeCapacityRecord, "contentHash">;
  if (value.schemaVersion !== "native-capacity-record-v1" || value.id !== row.id || value.objectId !== selected.object_api_id || value.checkId !== selected.check_id
    || value.bindings.inputManifestHash !== selected.manifest_hash.trim() || value.bindings.releaseId !== selected.release_id
    || value.comparison.purpose !== "SOURCE_ONLY" || value.comparison.p !== null || value.comparison.calibratedProbability !== null
    || value.comparison.factEligible !== false || value.comparison.coverageDelta !== 0
    || value.comparison.engineeringQualification !== false || value.comparison.completeConfiguration !== false
    || value.comparison.policyVersion !== policy
    || !verifyNativeCapacityComparisonHash(value.comparison) || !nativeSourceComparisonBindingsMatch(value))
    fail(409, "NATIVE_CAPACITY_IDENTITY_MISMATCH", "Сверка не соответствует сохранённой проверке");
  return { ...value, contentHash: row.content_hash.trim() };
}
export async function nativeCapacityWorkspace(client: PoolClient, checkId: string, actor: AuthenticatedActor): Promise<NativeCapacityWorkspace> {
  const selected = await scope(client, checkId, actor);
  const budget = (await client.query<{ count: string; bytes: string }>(`SELECT count(*)::text AS count,
    coalesce(sum(octet_length(content_text)),0)::text AS bytes FROM native_capacity_comparisons WHERE run_id=$1`, [selected.run_id])).rows[0];
  if (Number(budget.count) > 1000 || Number(budget.bytes) > 16777216)
    fail(413, "NATIVE_CAPACITY_RECORD_LIMIT", "История сверок превышает предел одного ответа");
  const rows = await client.query<Row>("SELECT id,content_text,content_hash FROM native_capacity_comparisons WHERE run_id=$1 ORDER BY created_at,id LIMIT 1001", [selected.run_id]);
  if (rows.rows.length > 1000) fail(413, "NATIVE_CAPACITY_RECORD_LIMIT", "Слишком много сохранённых сверок для одного ответа");
  return { schemaVersion: "native-capacity-workspace-v1", checkId, canCompare: selected.eligible,
    availability: selected.eligible ? "READY" : "SEALED_SOURCE_AUDIT_V4_REQUIRED", items: rows.rows.map(row => read(row, selected)) };
}
export async function captureNativeCapacity(client: PoolClient, checkId: string, input: NativeCapacityCompareInput,
  command: AuditedMutationCommand, scaffold: unknown): Promise<{ value: NativeCapacityRecord; replayed: boolean }> {
  input = parseNativeCapacityInput(input);
  const selected = await scope(client, checkId, command.actor);
  if (!selected.eligible) fail(409, "NATIVE_CAPACITY_SOURCE_AUDIT_REQUIRED", "Нужен завершённый полный аудит текстового слоя V4");
  const requestHash = sha256(canonicalJson({ checkId, input }));
  const operation = "NATIVE_CAPACITY_SOURCE_COMPARE";
  const receiptKey = [command.actor.userId, operation, "CHECK", checkId, command.idempotencyKey];
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [canonicalJson(receiptKey)]);
  const receipts = await client.query<{ request_hash: string; response_json: { value: NativeCapacityRecord } }>(`SELECT request_hash,response_json FROM command_receipts
    WHERE actor_user_id=$1 AND operation=$2 AND target_type=$3 AND target_id=$4 AND idempotency_key=$5`, receiptKey);
  if (receipts.rows[0]) {
    if (receipts.rows[0].request_hash.trim() !== requestHash) fail(409, "IDEMPOTENCY_CONFLICT", "Ключ команды использован для другой пары");
    // Re-read append-only bytes; do not trust a mutable command receipt as artifact storage.
    const saved = await client.query<Row>("SELECT id,content_text,content_hash FROM native_capacity_comparisons WHERE run_id=$1 AND id=$2", [selected.run_id, receipts.rows[0].response_json.value.id]);
    if (!saved.rows[0]) fail(409, "NATIVE_CAPACITY_ARTIFACT_UNAVAILABLE", "Сохранённая сверка недоступна");
    return { value: read(saved.rows[0], selected), replayed: true };
  }
  async function remember(value: NativeCapacityRecord, replayed: boolean) {
    await scope(client, checkId, command.actor);
    await client.query(`INSERT INTO command_receipts(actor_user_id,operation,target_type,target_id,idempotency_key,request_hash,response_status,response_json,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,201,$7::jsonb,'infinity'::timestamptz)`, [...receiptKey,requestHash,canonicalJson({ value })]);
    return { value, replayed };
  }
  const existing = await client.query<Row>(`SELECT comparison.id,comparison.content_text,comparison.content_hash FROM native_capacity_comparisons comparison
    JOIN source_files pd ON pd.id=comparison.pd_source_file_id JOIN source_files rd ON rd.id=comparison.rd_source_file_id
    WHERE comparison.run_id=$1 AND pd.api_id=$2 AND rd.api_id=$3 AND comparison.policy_version=$4`,
    [selected.run_id,input.pdSourceFileId,input.rdSourceFileId,policy]);
  if (existing.rows[0]) return remember(read(existing.rows[0], selected), true);
  const releaseCapture = beginNativeSourceComparisonCapture("CAPACITY");
  try {
  const pd = await loadDocumentTextV4FullAuditSource(client, selected.object_id, checkId, input.pdSourceFileId, scaffold);
  const rd = await loadDocumentTextV4FullAuditSource(client, selected.object_id, checkId, input.rdSourceFileId, scaffold);
  if (!pd || !rd) return fail(409, "NATIVE_CAPACITY_ARTIFACT_UNAVAILABLE", "Оба исходника должны входить в сохранённый полный аудит V4");
  if (pd.sourceFileId === rd.sourceFileId || pd.sourceSha256 === rd.sourceSha256)
    fail(422, "NATIVE_CAPACITY_IDENTICAL_SOURCE", "Выберите два разных исходных документа");
  const comparison = compareNativeCapacity(pd, rd);
  const body: Omit<NativeCapacityRecord, "contentHash"> = {
    schemaVersion: "native-capacity-record-v1", id: randomUUID(), objectId: selected.object_api_id, checkId,
    createdAt: new Date().toISOString(), createdBy: command.actor.userId, input,
    bindings: { inputManifestHash: selected.manifest_hash.trim(), releaseId: selected.release_id,
      pdSourceSha256: pd.sourceSha256, rdSourceSha256: rd.sourceSha256,
      pdTextArtifactHash: pd.textArtifactByteSha256, rdTextArtifactHash: rd.textArtifactByteSha256 }, comparison,
  };
  const json = canonicalJson(body), hash = sha256(json);
  if (Buffer.byteLength(json) > 16777216) fail(413, "NATIVE_CAPACITY_OUTPUT_LIMIT", "Сверка превышает лимит 16 MiB");
  const ids = (await client.query<{ id: string; api_id: string }>("SELECT id,api_id FROM source_files WHERE object_id=$1 AND api_id=ANY($2::text[])", [selected.object_id, [input.pdSourceFileId, input.rdSourceFileId]])).rows;
  await lockNativeSourceComparisonHistory(client, selected.run_id, "CAPACITY");
  const lockedWinner = await client.query<Row>(`SELECT comparison.id,comparison.content_text,comparison.content_hash FROM native_capacity_comparisons comparison
    JOIN source_files pd ON pd.id=comparison.pd_source_file_id JOIN source_files rd ON rd.id=comparison.rd_source_file_id
    WHERE comparison.run_id=$1 AND pd.api_id=$2 AND rd.api_id=$3 AND comparison.policy_version=$4`,
    [selected.run_id,input.pdSourceFileId,input.rdSourceFileId,policy]);
  if (lockedWinner.rows[0]) return await remember(read(lockedWinner.rows[0], selected), true);
  await assertNativeSourceComparisonHistoryBudget(client, selected.run_id, "CAPACITY", Buffer.byteLength(json));
  await client.query(`INSERT INTO native_capacity_comparisons(id,organization_id,object_id,run_id,pd_source_file_id,rd_source_file_id,
    policy_version,content_hash,content_text,content_json,actor_user_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text,($9::text)::jsonb,$10,$11) ON CONFLICT(run_id,pd_source_file_id,rd_source_file_id,policy_version) DO NOTHING`,
    [body.id,command.actor.organizationId,selected.object_id,selected.run_id,ids.find(source => source.api_id === input.pdSourceFileId)!.id,
      ids.find(source => source.api_id === input.rdSourceFileId)!.id,policy,hash,json,command.actor.userId,body.createdAt]);
  const saved = await client.query<Row>(`SELECT id,content_text,content_hash FROM native_capacity_comparisons WHERE run_id=$1
    AND pd_source_file_id=$2 AND rd_source_file_id=$3 AND policy_version=$4`, [selected.run_id,
    ids.find(source => source.api_id === input.pdSourceFileId)!.id,ids.find(source => source.api_id === input.rdSourceFileId)!.id,policy]);
  const value = read(saved.rows[0], selected);
  return await remember(value, value.id !== body.id);
  } finally { releaseCapture(); }
}
