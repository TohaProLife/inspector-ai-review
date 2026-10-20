import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SourceOcrImportBundle, SourceOcrImportRecord, SourceOcrImportWorkspace, SourceOcrReviewInput, SourceOcrReviewRecord } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import type { AuthenticatedActor } from "./identity.js";
import type { AuditedMutationCommand } from "./repository.js";
import { nativeSourceComparisonScope as scope, type NativeSourceComparisonScope as Scope } from "./postgres-native-source-comparison-scope.js";
import { loadDocumentTextV4FullAuditSource } from "./postgres-document-text-v4-full-source.js";
import { deriveSourceOcrImport, parseSourceOcrImportBundle, SourceOcrImportError, verifySourceOcrImportDerivedHash } from "./source-ocr-import.js";

type Row = { id: string; content_text: string; content_hash: string };
const fail = (status: number, code: string, message: string): never => { throw new SourceOcrImportError(status, code, message); };
const policy = "source-ocr-import-v1";
const SHA = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
let activeImports = 0;
export type VerifyOcrOriginal = (reference: { storageKey: string; expectedSha256: string; expectedByteSize: number; expectedMediaType: "application/pdf" }) => Promise<void>;

async function permissions(client: PoolClient, selected: Scope, actor: AuthenticatedActor) {
  const access = (await client.query<{ permission_set: string[] }>("SELECT permission_set FROM object_memberships WHERE object_id=$1 AND user_id=$2 AND revoked_at IS NULL", [selected.object_id, actor.userId])).rows[0]?.permission_set ?? [];
  return { canImport: selected.eligible && actor.capabilities.includes("RUN_START") && access.includes("RUN"),
    canReview: selected.eligible && actor.capabilities.includes("SOURCE_REVIEW") && access.includes("REVIEW_DECIDE") };
}
function readImport(row: Row, selected: Scope): SourceOcrImportRecord {
  if (sha256(row.content_text) !== row.content_hash.trim()) return fail(409, "SOURCE_OCR_HASH_MISMATCH", "Импорт OCR повреждён");
  const value = JSON.parse(row.content_text) as Omit<SourceOcrImportRecord, "contentHash">;
  if (value.schemaVersion !== "source-ocr-import-record-v1" || value.id !== row.id || value.checkId !== selected.check_id
    || value.objectId !== selected.object_api_id || value.bindings.releaseId !== selected.release_id
    || value.bindings.inputManifestHash !== selected.manifest_hash.trim() || value.bindings.originalBytesVerified !== true
    || !SHA.test(value.bindings.sourceSha256) || !SHA.test(value.bindings.textArtifactByteSha256)
    || !SHA.test(value.bindings.textArtifactContentHash) || value.derived.sourceSha256 !== value.bindings.sourceSha256
    || value.derived.policyVersion !== policy || value.derived.providerExecutionVerified !== false
    || value.derived.renderDerivationVerified !== false || value.derived.p !== null || value.derived.factEligible !== false
    || value.derived.coverageDelta !== 0 || !verifySourceOcrImportDerivedHash(value.derived))
    return fail(409, "SOURCE_OCR_IDENTITY_MISMATCH", "Импорт OCR не соответствует сохранённой проверке");
  return { ...value, contentHash: row.content_hash.trim() };
}
function readReview(row: Row, selected: Scope, imports: SourceOcrImportRecord[]): SourceOcrReviewRecord {
  if (sha256(row.content_text) !== row.content_hash.trim()) return fail(409, "SOURCE_OCR_REVIEW_HASH_MISMATCH", "Журнал проверки OCR повреждён");
  const value = JSON.parse(row.content_text) as Omit<SourceOcrReviewRecord, "contentHash">;
  const parent = imports.find(item => item.id === value.importId);
  const line = parent?.derived.pages.find(page => page.pageNumber === value.pageNumber)?.lines.find(item => item.ordinal === value.ordinal);
  if (value.schemaVersion !== "source-ocr-review-record-v1" || value.id !== row.id || value.objectId !== selected.object_api_id
    || value.checkId !== selected.check_id || value.sourceFileId !== parent?.sourceFileId || !line || line.lineHash !== value.lineHash
    || parent?.contentHash !== value.importContentHash || value.humanTranscriptionOnly !== true
    || value.p !== null || value.factEligible !== false || value.coverageDelta !== 0
    || !["CONFIRMED", "REJECTED"].includes(value.decision)) return fail(409, "SOURCE_OCR_REVIEW_IDENTITY_MISMATCH", "Решение OCR не соответствует строке импорта");
  return { ...value, contentHash: row.content_hash.trim() };
}
async function importRows(client: PoolClient, selected: Scope) {
  const budget = (await client.query<{ count: string; bytes: string }>("SELECT count(*)::text AS count,coalesce(sum(octet_length(content_text)),0)::text AS bytes FROM source_ocr_imports WHERE run_id=$1", [selected.run_id])).rows[0];
  if (BigInt(budget.count) > 8n || BigInt(budget.bytes) > 16777216n) return fail(413, "SOURCE_OCR_HISTORY_LIMIT", "История импорта превышает лимит");
  return (await client.query<Row>("SELECT id,content_text,content_hash FROM source_ocr_imports WHERE run_id=$1 ORDER BY created_at,id LIMIT 9", [selected.run_id])).rows.map(row => readImport(row, selected));
}
export async function sourceOcrWorkspace(client: PoolClient, checkId: string, actor: AuthenticatedActor): Promise<SourceOcrImportWorkspace> {
  const selected = await scope(client, checkId, actor), access = await permissions(client, selected, actor);
  const items = await importRows(client, selected);
  const budget = (await client.query<{ count: string; bytes: string }>("SELECT count(*)::text AS count,coalesce(sum(octet_length(content_text)),0)::text AS bytes FROM source_ocr_reviews WHERE run_id=$1", [selected.run_id])).rows[0];
  if (BigInt(budget.count) > 1000n || BigInt(budget.bytes) > 8388608n) return fail(413, "SOURCE_OCR_REVIEW_LIMIT", "Журнал проверки OCR превышает лимит");
  const reviews = (await client.query<Row>("SELECT id,content_text,content_hash FROM source_ocr_reviews WHERE run_id=$1 ORDER BY sequence LIMIT 1001", [selected.run_id])).rows.map(row => readReview(row, selected, items));
  const previous = new Map<string, string>();
  for (const review of reviews) {
    const key = `${review.importId}:${review.pageNumber}:${review.ordinal}`;
    if (review.expectedReviewHash !== (previous.get(key) ?? null)) return fail(409, "SOURCE_OCR_REVIEW_CHAIN_MISMATCH", "Последовательность решений OCR повреждена");
    previous.set(key, review.contentHash);
  }
  return { schemaVersion: "source-ocr-import-workspace-v1", checkId, ...access,
    availability: selected.eligible ? "READY" : "SEALED_SOURCE_AUDIT_V4_REQUIRED", items, reviews };
}
async function receipt(client: PoolClient, command: AuditedMutationCommand, operation: string, checkId: string, requestHash: string) {
  const key = [command.actor.userId, operation, "CHECK", checkId, command.idempotencyKey];
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [canonicalJson(key)]);
  const previous = (await client.query<{ request_hash: string; response_json: { id: string } }>(`SELECT request_hash,response_json FROM command_receipts
    WHERE actor_user_id=$1 AND operation=$2 AND target_type=$3 AND target_id=$4 AND idempotency_key=$5`, key)).rows[0];
  if (previous && previous.request_hash.trim() !== requestHash) return fail(409, "IDEMPOTENCY_CONFLICT", "Ключ команды использован для другого импорта или решения");
  return { previousId: previous?.response_json.id,
    remember: async (id: string) => { await client.query(`INSERT INTO command_receipts(actor_user_id,operation,target_type,target_id,idempotency_key,request_hash,response_status,response_json,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,201,$7::jsonb,'infinity'::timestamptz)`, [...key, requestHash, canonicalJson({ id })]); } };
}
export async function captureSourceOcrImport(client: PoolClient, checkId: string, sourceFileId: string, rawInput: SourceOcrImportBundle,
  command: AuditedMutationCommand, scaffold: unknown, verifyOriginal: VerifyOcrOriginal): Promise<{ value: SourceOcrImportRecord; replayed: boolean }> {
  const selected = await scope(client, checkId, command.actor), access = await permissions(client, selected, command.actor);
  if (!selected.eligible) return fail(409, "SOURCE_OCR_SOURCE_AUDIT_REQUIRED", "Нужен завершённый полный аудит V4");
  if (!access.canImport) return fail(403, "FORBIDDEN", "Нужно разрешение запуска проверок для импорта OCR");
  const input = parseSourceOcrImportBundle(rawInput);
  const commandReceipt = await receipt(client, command, "SOURCE_OCR_IMPORT", checkId, sha256(canonicalJson({ checkId, sourceFileId, input })));
  const items = await importRows(client, selected);
  if (commandReceipt.previousId) {
    const value = items.find(item => item.id === commandReceipt.previousId);
    if (!value) return fail(409, "SOURCE_OCR_IMPORT_UNAVAILABLE", "Сохранённый импорт недоступен");
    return { value, replayed: true };
  }
  if (activeImports >= 1) return fail(503, "SOURCE_OCR_BUSY", "Выполняется другой импорт OCR. Повторите через несколько секунд");
  activeImports++;
  try {
    const origin = await loadDocumentTextV4FullAuditSource(client, selected.object_id, checkId, sourceFileId, scaffold);
    if (!origin) return fail(409, "SOURCE_OCR_ARTIFACT_UNAVAILABLE", "Исходник не входит в полный аудит V4");
    const derived = deriveSourceOcrImport(input, origin);
    const source = (await client.query<{ id: string; storage_key: string; byte_size: string; sha256: string }>(`SELECT source.id,blob.storage_key,blob.byte_size,blob.sha256 FROM source_files source
      JOIN blobs blob ON blob.id=source.blob_id WHERE source.object_id=$1 AND source.api_id=$2 AND blob.object_id=$1
      AND blob.scan_status='CLEAN' AND blob.media_type='application/pdf'`, [selected.object_id, sourceFileId])).rows[0];
    if (!source || source.sha256.trim() !== origin.sourceSha256) return fail(409, "SOURCE_OCR_SOURCE_MISMATCH", "Исходный PDF недоступен");
    await verifyOriginal({ storageKey: source.storage_key, expectedSha256: origin.sourceSha256, expectedByteSize: Number(source.byte_size), expectedMediaType: "application/pdf" });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`source-ocr-history:${selected.run_id}`]);
    if (!(await permissions(client, await scope(client, checkId, command.actor), command.actor)).canImport)
      return fail(403, "FORBIDDEN", "Право импорта OCR отозвано");
    const winner = (await client.query<Row>("SELECT id,content_text,content_hash FROM source_ocr_imports WHERE run_id=$1 AND source_file_id=$2 AND policy_version=$3 AND bundle_hash=$4", [selected.run_id, source.id, policy, derived.bundleHash])).rows[0];
    if (winner) { const value = readImport(winner, selected); await commandReceipt.remember(value.id); return { value, replayed: true }; }
    const body: Omit<SourceOcrImportRecord, "contentHash"> = { schemaVersion: "source-ocr-import-record-v1", id: randomUUID(), objectId: selected.object_api_id,
      checkId, sourceFileId, createdAt: new Date().toISOString(), createdBy: command.actor.userId,
      bindings: { releaseId: selected.release_id, inputManifestHash: selected.manifest_hash.trim(), sourceSha256: origin.sourceSha256,
        textArtifactByteSha256: origin.textArtifactByteSha256, textArtifactContentHash: origin.textArtifactContentHash, originalBytesVerified: true }, derived };
    const text = canonicalJson(body), hash = sha256(text), bytes = Buffer.byteLength(text);
    const budget = (await client.query<{ count: string; bytes: string }>("SELECT count(*)::text AS count,coalesce(sum(octet_length(content_text)),0)::text AS bytes FROM source_ocr_imports WHERE run_id=$1", [selected.run_id])).rows[0];
    if (bytes > 16777216 || BigInt(budget.count) >= 8n || BigInt(budget.bytes) + BigInt(bytes) > 16777216n)
      return fail(413, "SOURCE_OCR_HISTORY_LIMIT", "Лимит новых импортов исчерпан. Сохранённая история доступна для чтения");
    await client.query(`INSERT INTO source_ocr_imports(id,organization_id,object_id,run_id,source_file_id,policy_version,bundle_hash,content_hash,content_text,content_json,actor_user_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,($9::text)::jsonb,$10,$11)`, [body.id, command.actor.organizationId, selected.object_id, selected.run_id,
      source.id, policy, derived.bundleHash, hash, text, body.createdBy, body.createdAt]);
    await commandReceipt.remember(body.id);
    return { value: { ...body, contentHash: hash }, replayed: false };
  } finally { activeImports--; }
}
export function parseSourceOcrReview(value: unknown): SourceOcrReviewInput {
  const keys = ["schemaVersion", "importId", "importContentHash", "pageNumber", "ordinal", "lineHash", "decision", "basis", "expectedReviewHash"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    return fail(400, "SOURCE_OCR_REVIEW_INPUT", "Неверная команда проверки строки OCR");
  const item = value as SourceOcrReviewInput;
  if (item.schemaVersion !== "source-ocr-review-command-v1" || typeof item.importId !== "string" || !UUID.test(item.importId)
    || typeof item.importContentHash !== "string" || !SHA.test(item.importContentHash) || typeof item.lineHash !== "string" || !SHA.test(item.lineHash)
    || !Number.isSafeInteger(item.pageNumber) || item.pageNumber < 1 || item.pageNumber > 1024
    || !Number.isSafeInteger(item.ordinal) || item.ordinal < 0 || item.ordinal > 9999
    || !["CONFIRMED", "REJECTED"].includes(item.decision) || typeof item.basis !== "string" || item.basis.trim().length < 3 || item.basis.length > 2000
    || /[\u0000\uD800-\uDFFF]/u.test(item.basis)
    || item.expectedReviewHash !== null && (typeof item.expectedReviewHash !== "string" || !SHA.test(item.expectedReviewHash)))
    return fail(400, "SOURCE_OCR_REVIEW_INPUT", "Укажите строку, решение и основание проверки");
  return item;
}
export async function captureSourceOcrReview(client: PoolClient, checkId: string, rawInput: SourceOcrReviewInput, command: AuditedMutationCommand,
  verifyOriginal: VerifyOcrOriginal): Promise<{ value: SourceOcrReviewRecord; replayed: boolean }> {
  const selected = await scope(client, checkId, command.actor), access = await permissions(client, selected, command.actor);
  if (!access.canReview) return fail(403, "FORBIDDEN", "Нужно разрешение проверки исходных данных");
  const input = parseSourceOcrReview(rawInput);
  const commandReceipt = await receipt(client, command, "SOURCE_OCR_TRANSCRIPTION_REVIEW", checkId, sha256(canonicalJson({ checkId, input })));
  const imports = await importRows(client, selected), parent = imports.find(item => item.id === input.importId);
  const line = parent?.derived.pages.find(page => page.pageNumber === input.pageNumber)?.lines.find(item => item.ordinal === input.ordinal);
  if (!parent || parent.contentHash !== input.importContentHash || line?.lineHash !== input.lineHash) return fail(409, "SOURCE_OCR_LINE_MISMATCH", "Строка OCR изменилась или недоступна");
  if (commandReceipt.previousId) {
    const row = (await client.query<Row>("SELECT id,content_text,content_hash FROM source_ocr_reviews WHERE run_id=$1 AND id=$2", [selected.run_id, commandReceipt.previousId])).rows[0];
    if (!row) return fail(409, "SOURCE_OCR_REVIEW_UNAVAILABLE", "Решение недоступно");
    return { value: readReview(row, selected, imports), replayed: true };
  }
  if (activeImports >= 1) return fail(503, "SOURCE_OCR_BUSY", "Выполняется другая проверка OCR. Повторите через несколько секунд");
  activeImports++;
  try {
  const source = (await client.query<{ storage_key: string; byte_size: string; sha256: string }>(`SELECT blob.storage_key,blob.byte_size,blob.sha256 FROM source_files source
    JOIN blobs blob ON blob.id=source.blob_id WHERE source.object_id=$1 AND source.api_id=$2 AND blob.object_id=$1
    AND blob.scan_status='CLEAN' AND blob.media_type='application/pdf'`, [selected.object_id, parent.sourceFileId])).rows[0];
  if (!source || source.sha256.trim() !== parent.bindings.sourceSha256) return fail(409, "SOURCE_OCR_SOURCE_MISMATCH", "Исходный PDF недоступен");
  await verifyOriginal({ storageKey: source.storage_key, expectedSha256: parent.bindings.sourceSha256,
    expectedByteSize: Number(source.byte_size), expectedMediaType: "application/pdf" });
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`source-ocr-review-history:${selected.run_id}`]);
  const previous = (await client.query<{ content_hash: string }>("SELECT content_hash FROM source_ocr_reviews WHERE import_id=$1 AND page_number=$2 AND line_ordinal=$3 ORDER BY sequence DESC LIMIT 1", [input.importId, input.pageNumber, input.ordinal])).rows[0]?.content_hash.trim() ?? null;
  if (input.expectedReviewHash !== previous) return fail(409, "SOURCE_OCR_REVIEW_CONFLICT", "Другой инспектор уже проверил строку. Обновите историю");
  const body: Omit<SourceOcrReviewRecord, "contentHash"> = { ...input, schemaVersion: "source-ocr-review-record-v1", id: randomUUID(), objectId: selected.object_api_id,
    checkId, sourceFileId: parent.sourceFileId, createdAt: new Date().toISOString(), createdBy: command.actor.userId, humanTranscriptionOnly: true, p: null, factEligible: false, coverageDelta: 0 };
  const text = canonicalJson(body), hash = sha256(text), bytes = Buffer.byteLength(text);
  const budget = (await client.query<{ count: string; bytes: string }>("SELECT count(*)::text AS count,coalesce(sum(octet_length(content_text)),0)::text AS bytes FROM source_ocr_reviews WHERE run_id=$1", [selected.run_id])).rows[0];
  if (bytes > 16384 || BigInt(budget.count) >= 1000n || BigInt(budget.bytes) + BigInt(bytes) > 8388608n)
    return fail(413, "SOURCE_OCR_REVIEW_LIMIT", "Лимит новых решений OCR исчерпан. История доступна для чтения");
  if (!(await permissions(client, await scope(client, checkId, command.actor), command.actor)).canReview)
    return fail(403, "FORBIDDEN", "Право проверки OCR отозвано");
  await client.query(`INSERT INTO source_ocr_reviews(id,import_id,organization_id,object_id,run_id,page_number,line_ordinal,content_hash,content_text,content_json,actor_user_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,($9::text)::jsonb,$10,$11)`, [body.id, input.importId, command.actor.organizationId, selected.object_id, selected.run_id,
    input.pageNumber, input.ordinal, hash, text, body.createdBy, body.createdAt]);
  await commandReceipt.remember(body.id);
  return { value: { ...body, contentHash: hash }, replayed: false };
  } finally { activeImports--; }
}
