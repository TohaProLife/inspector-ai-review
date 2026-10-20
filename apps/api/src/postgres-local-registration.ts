import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { LocalDocumentFrame, LocalDocumentRegistrationPacket, LocalDocumentRegistrationPreview,
  LocalDocumentRegistrationSaveInput, LocalDocumentRegistrationWorkspaceRead,
  PersistedLocalDocumentRegistrationReview } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import type { AuthenticatedActor } from "./identity.js";
import { evaluateLocalDocumentRegistration, localDocumentRegistrationDigest } from "./local-document-registration.js";
import type { AuditedMutationCommand, SourceFileContent } from "./repository.js";

export class LocalRegistrationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

interface Scope {
  object_id: string; inspection_id: string; lifecycle: "OPEN" | "FINALIZED";
  run_id: string | null; check_id: string | null; manifest_id: string | null; can_review: boolean;
}
interface ReviewRow {
  id: string; content_hash: string; previous_review_hash: string | null; registration_sha256: string;
  actor_user_id: string; created_at: Date | string; packet_json: LocalDocumentRegistrationPacket;
  result_json: PersistedLocalDocumentRegistrationReview["result"]; sequence: string; reason: string;
}
type Database = Pick<PoolClient, "query">;
const iso = (value: Date | string) => new Date(value).toISOString();
function error(status: number, code: string, message: string): never { throw new LocalRegistrationError(status, code, message); }

/** Separate append-only geometry service; never writes machine findings, coverage or protocol decisions. */
export class PostgresLocalRegistrationService {
  private readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 4 });
    this.pool.on("error", () => { /* Queries fail explicitly; an idle disconnect must not terminate API. */ });
  }
  async close(): Promise<void> { await this.pool.end(); }

  private async scope(database: Database, objectId: string, actor: AuthenticatedActor, lock = false): Promise<Scope> {
    const rows = await database.query<Scope>(
      `SELECT object.id AS object_id, inspection.id AS inspection_id, inspection.lifecycle,
         run.id AS run_id, run.api_id AS check_id, run.manifest_id,
         (access.permission_set @> ARRAY['READ','REVIEW_DECIDE']::text[] AND EXISTS (
           SELECT 1 FROM organization_memberships reviewer WHERE reviewer.organization_id = object.organization_id
             AND reviewer.user_id = $3 AND reviewer.revoked_at IS NULL AND
             (reviewer.role IN ('INSPECTOR','SUPERVISOR') OR reviewer.capabilities @> ARRAY['REVIEW_DECIDE']::text[])
         )) AS can_review
       FROM objects object JOIN inspections inspection ON inspection.object_id = object.id
       JOIN object_memberships access ON access.object_id = object.id AND access.user_id = $3
       JOIN inspector_users actor ON actor.id = $3 AND actor.enabled = true
       LEFT JOIN analysis_runs run ON run.id = inspection.active_run_id
       WHERE object.organization_id = $1 AND object.api_id = $2 AND inspection.mode = 'NORMAL'
         AND access.revoked_at IS NULL AND access.permission_set @> ARRAY['READ']::text[]
         AND EXISTS (SELECT 1 FROM organization_memberships member WHERE member.organization_id = object.organization_id
           AND member.user_id = $3 AND member.revoked_at IS NULL)
       ${lock ? "FOR UPDATE OF inspection" : ""}`,
      [actor.organizationId, objectId, actor.userId]);
    return rows.rows[0] ?? error(404, "NOT_FOUND", "Объект недоступен");
  }

  async sourceReference(objectId: string, sourceFileId: string, actor: AuthenticatedActor): Promise<SourceFileContent> {
    const selected = await this.scope(this.pool, objectId, actor);
    const source = await this.pool.query<{ canonical_name: string; storage_key: string; byte_size: string; sha256: string; media_type: string }>(
      `SELECT source.canonical_name, blob.storage_key, blob.byte_size, blob.sha256, blob.media_type
       FROM source_files source JOIN blobs blob ON blob.id = source.blob_id AND blob.object_id = source.object_id
       WHERE source.object_id = $1 AND source.api_id = $2 AND blob.scan_status = 'CLEAN'`, [selected.object_id, sourceFileId]);
    const value = source.rows[0] ?? error(404, "NOT_FOUND", "Исходный файл недоступен");
    if (value.media_type !== "application/pdf") error(415, "UNSUPPORTED_FORMAT", "Привязка доступна только для PDF");
    return { name: value.canonical_name, storageKey: value.storage_key, byteSize: Number(value.byte_size),
      sha256: value.sha256.trim(), mediaType: value.media_type };
  }

  /** Read-only single-document preview, bound to the selected active check and manifest. */
  async coordinateSourceReference(objectId: string, sourceFileId: string, checkId: string, actor: AuthenticatedActor): Promise<SourceFileContent> {
    const selected = await this.scope(this.pool, objectId, actor);
    if (!selected.check_id || selected.check_id !== checkId || !selected.manifest_id)
      error(409, "CHECK_CHANGED", "Текущая проверка объекта изменилась; откройте оригинал заново");
    const source = await this.pool.query<{ canonical_name: string; storage_key: string; byte_size: string; sha256: string; media_type: string }>(
      `SELECT source.canonical_name, blob.storage_key, blob.byte_size, blob.sha256, blob.media_type
       FROM source_files source JOIN blobs blob ON blob.id = source.blob_id AND blob.object_id = source.object_id
       JOIN manifest_items item ON item.source_file_id = source.id AND item.manifest_id = $3 AND item.blob_sha256 = blob.sha256
       WHERE source.object_id = $1 AND source.api_id = $2 AND blob.scan_status = 'CLEAN'`,
      [selected.object_id, sourceFileId, selected.manifest_id]);
    const value = source.rows[0] ?? error(404, "SOURCE_NOT_IN_ACTIVE_MANIFEST", "Исходный файл отсутствует в выбранной проверке");
    if (value.media_type !== "application/pdf") error(415, "UNSUPPORTED_FORMAT", "Координатный черновик доступен только для PDF");
    return { name: value.canonical_name, storageKey: value.storage_key, byteSize: Number(value.byte_size),
      sha256: value.sha256.trim(), mediaType: value.media_type };
  }

  private reviewValue(row: ReviewRow, objectId: string, checkId: string): PersistedLocalDocumentRegistrationReview {
    return { reviewId: row.id, actorId: row.actor_user_id, reviewedAt: iso(row.created_at),
      registrationSha256: row.registration_sha256.trim(), contentHash: row.content_hash.trim(),
      previousReviewHash: row.previous_review_hash?.trim() ?? null, objectId, checkId,
      packet: row.packet_json, result: row.result_json, reason: row.reason };
  }

  async workspace(objectId: string, actor: AuthenticatedActor): Promise<LocalDocumentRegistrationWorkspaceRead> {
    const selected = await this.scope(this.pool, objectId, actor);
    const rows = selected.run_id ? await this.pool.query<ReviewRow>(
      `SELECT * FROM local_document_registration_reviews WHERE organization_id = $1 AND object_id = $2
       AND run_id = $3 ORDER BY sequence DESC LIMIT 20`, [actor.organizationId, selected.object_id, selected.run_id]) : { rows: [] };
    const latest = rows.rows[0] && selected.check_id ? this.reviewValue(rows.rows[0], objectId, selected.check_id) : null;
    return { objectId, checkId: selected.check_id, lifecycle: selected.lifecycle, canReview: selected.can_review,
      expectedReviewHash: latest?.contentHash ?? null, latest,
      history: rows.rows.map((row) => ({ reviewId: row.id, contentHash: row.content_hash.trim(),
        registrationSha256: row.registration_sha256.trim(), actorId: row.actor_user_id, reviewedAt: iso(row.created_at) })) };
  }

  private async sourceManifestIds(database: Database, selected: Scope, packet: LocalDocumentRegistrationPacket): Promise<[string, string]> {
    const ids: string[] = [];
    for (const frame of [packet.sourceFrame, packet.targetFrame]) {
      const matched = await database.query<{ id: string }>(
        `SELECT source.id FROM source_files source JOIN blobs blob ON blob.id = source.blob_id
         JOIN manifest_items item ON item.source_file_id = source.id AND item.manifest_id = $1
         WHERE source.object_id = $2 AND source.api_id = $3 AND blob.sha256 = $4 AND item.blob_sha256 = $4
           AND blob.scan_status = 'CLEAN' AND blob.media_type = 'application/pdf'`,
        [selected.manifest_id, selected.object_id, frame.sourceFileId, frame.sourceSha256]);
      ids.push(matched.rows[0]?.id ?? error(409, "SOURCE_NOT_IN_ACTIVE_MANIFEST", "Исходный SHA не входит в текущую проверку"));
    }
    return ids as [string, string];
  }

  private compute(packet: LocalDocumentRegistrationPacket, frames: [LocalDocumentFrame, LocalDocumentFrame]) {
    // pdfinfo reports boxes at 0.01 pt precision; zero uncertainty would suppress this known bound.
    if (!(packet.sourceLocalizationUncertaintyPt >= 0.01) || !(packet.targetLocalizationUncertaintyPt >= 0.01)) {
      error(422, "PAGE_FRAME_PRECISION_UNACCOUNTED", "Погрешность постановки опор должна учитывать точность страницы: минимум 0.01 пункта");
    }
    return evaluateLocalDocumentRegistration(packet, { sourceFrame: frames[0], targetFrame: frames[1],
      reviewedRegistrationSha256: localDocumentRegistrationDigest(packet) });
  }

  async preview(objectId: string, checkId: string, packet: LocalDocumentRegistrationPacket,
    frames: [LocalDocumentFrame, LocalDocumentFrame], actor: AuthenticatedActor): Promise<LocalDocumentRegistrationPreview> {
    const selected = await this.scope(this.pool, objectId, actor);
    if (!selected.run_id || selected.check_id !== checkId) error(409, "STALE_ANALYSIS_RUN", "Текущая проверка изменилась; обновите листы");
    await this.sourceManifestIds(this.pool, selected, packet);
    return { status: "PREVIEW_ONLY", result: this.compute(packet, frames) };
  }

  async save(objectId: string, input: LocalDocumentRegistrationSaveInput, frames: [LocalDocumentFrame, LocalDocumentFrame],
    command: AuditedMutationCommand): Promise<{ value: PersistedLocalDocumentRegistrationReview; replayed: boolean }> {
    if (input?.schemaVersion !== "local-document-registration-review-command-v1"
      || typeof input.checkId !== "string" || input.checkId.length < 1 || input.checkId.length > 256
      || !(input.expectedReviewHash === null || /^[a-f0-9]{64}$/.test(input.expectedReviewHash))
      || input.originalsReviewed !== true || input.stableReferencesConfirmed !== true || input.scopeConfirmed !== true
      || typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 2000) {
      error(400, "INVALID_REGISTRATION_REVIEW", "Проверьте адрес проверки, основание и подтверждения по оригиналам");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await this.scope(client, objectId, command.actor, true);
      if (!selected.can_review) error(403, "REVIEW_FORBIDDEN", "Нет права принимать решение по привязке");
      if (selected.run_id) await client.query("SELECT id FROM analysis_runs WHERE id = $1 FOR UPDATE", [selected.run_id]);
      const operation = "LOCAL_DOCUMENT_REGISTRATION_REVIEW"; const targetType = "OBJECT";
      const requestHash = sha256(canonicalJson({ objectId, input }));
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [canonicalJson({ actorUserId: command.actor.userId,
        operation, targetType, targetId: objectId, idempotencyKey: command.idempotencyKey })]);
      const receipt = await client.query<{ request_hash: string; response_json: { value: PersistedLocalDocumentRegistrationReview } }>(
        `SELECT request_hash, response_json FROM command_receipts WHERE actor_user_id = $1 AND operation = $2
         AND target_type = $3 AND target_id = $4 AND idempotency_key = $5`,
        [command.actor.userId, operation, targetType, objectId, command.idempotencyKey]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash.trim() !== requestHash) error(409, "IDEMPOTENCY_CONFLICT", "Ключ команды уже использован с другим содержимым");
        await client.query("COMMIT"); return { value: receipt.rows[0].response_json.value, replayed: true };
      }
      if (selected.lifecycle !== "OPEN") error(409, "INSPECTION_FINALIZED", "Проверка завершена; новое решение недоступно");
      if (!selected.run_id || selected.check_id !== input.checkId) error(409, "STALE_ANALYSIS_RUN", "Текущая проверка изменилась");
      const previous = await client.query<ReviewRow>(`SELECT * FROM local_document_registration_reviews
        WHERE run_id = $1 ORDER BY sequence DESC LIMIT 1`, [selected.run_id]);
      const before = previous.rows[0]; const previousReviewHash = before?.content_hash.trim() ?? null;
      if (previousReviewHash !== input.expectedReviewHash) error(412, "LOCAL_REGISTRATION_CHANGED", "Решение по привязке изменилось; обновите данные");
      const sourceIds = await this.sourceManifestIds(client, selected, input.packet);
      const result = this.compute(input.packet, frames);
      if (result.status !== "REGISTERED_RELATIVE") error(422, result.reasonCode, "Привязка не прошла проверку модели, опор или погрешности");
      const reviewId = randomUUID(); const reviewedAt = new Date().toISOString();
      const contentHash = sha256(canonicalJson({ schemaVersion: "local-document-registration-review-v1", reviewId, objectId,
        checkId: input.checkId, packet: input.packet, registrationSha256: result.registrationSha256,
        actorId: command.actor.userId, reviewedAt, previousReviewHash, reason: input.reason }));
      const value: PersistedLocalDocumentRegistrationReview = { reviewId, objectId, checkId: input.checkId,
        packet: input.packet, result, registrationSha256: result.registrationSha256, contentHash,
        actorId: command.actor.userId, reviewedAt, previousReviewHash, reason: input.reason };
      await client.query(`INSERT INTO local_document_registration_reviews (id,organization_id,object_id,inspection_id,run_id,
        source_file_id,target_file_id,sequence,registration_sha256,content_hash,previous_review_hash,packet_json,result_json,
        actor_user_id,reason,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)`,
      [reviewId, command.actor.organizationId, selected.object_id, selected.inspection_id, selected.run_id, sourceIds[0], sourceIds[1],
        Number(before?.sequence ?? 0) + 1, result.registrationSha256, contentHash, previousReviewHash,
        canonicalJson(input.packet), canonicalJson(result), command.actor.userId, input.reason, reviewedAt]);
      await client.query(`INSERT INTO command_receipts (actor_user_id,operation,target_type,target_id,idempotency_key,
        request_hash,response_status,response_json,expires_at) VALUES ($1,$2,$3,$4,$5,$6,201,$7::jsonb,'infinity'::timestamptz)`,
      [command.actor.userId, operation, targetType, objectId, command.idempotencyKey, requestHash, canonicalJson({ value })]);
      await this.audit(client, command, selected, objectId, value);
      await client.query("COMMIT"); return { value, replayed: false };
    } catch (failure) { await client.query("ROLLBACK"); throw failure; }
    finally { client.release(); }
  }

  private async audit(client: PoolClient, command: AuditedMutationCommand, scope: Scope, objectId: string,
    value: PersistedLocalDocumentRegistrationReview): Promise<void> {
    const organizationId = command.actor.organizationId;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [organizationId]);
    const previous = await client.query<{ event_hash: string }>(`SELECT event_hash FROM audit_events
      WHERE organization_id = $1 ORDER BY created_at DESC,id DESC LIMIT 1`, [organizationId]);
    const previousEventHash = previous.rows[0]?.event_hash ?? null;
    const createdAt = new Date().toISOString(); const action = "LOCAL_DOCUMENT_REGISTRATION_REVIEW";
    const beforeRef = value.previousReviewHash ? { contentHash: value.previousReviewHash } : null;
    const afterRef = { reviewId: value.reviewId, contentHash: value.contentHash, registrationSha256: value.registrationSha256 };
    const eventHash = sha256(canonicalJson({ organizationId, objectId: scope.object_id, inspectionId: scope.inspection_id,
      actorUserId: command.actor.userId, action, targetType: "OBJECT", targetId: objectId, beforeRef, afterRef,
      reason: value.reason, requestId: command.requestId, traceId: command.traceId, previousEventHash, createdAt }));
    await client.query(`INSERT INTO audit_events (organization_id,object_id,inspection_id,actor_user_id,action,target_type,
      target_id,before_ref,after_ref,reason,request_id,trace_id,ip_address,user_agent,previous_event_hash,event_hash,created_at)
      VALUES ($1,$2,$3,$4,$5,'OBJECT',$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [organizationId, scope.object_id, scope.inspection_id, command.actor.userId, action, objectId,
      beforeRef ? canonicalJson(beforeRef) : null, canonicalJson(afterRef), value.reason, command.requestId, command.traceId,
      command.ipAddress ?? null, command.userAgent ?? null, previousEventHash, eventHash, createdAt]);
  }
}
