/** KR-060 source-only journal/preview. No run, rule result or coverage is changed here. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthenticatedActor } from "./identity.js";
import type { AuditedMutationCommand, AuditedMutationCommandResult } from "./repository.js";
import type {
  ColumnPylonSectionV2Journal as Journal, ColumnPylonSectionV2Request as Request,
  ColumnPylonSectionV2Result as Result, ColumnPylonSectionV2ReviewList,
  ColumnPylonSectionV2SourcePreview, ColumnPylonSectionV2SideRequest,
} from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import {
  parseColumnPylonSectionReviewInput, validateColumnPylonSectionReviewDecision,
  validateColumnPylonSectionApprovedClaims,
  columnPylonSectionPairKey, materializeColumnPylonSectionReview, compareKr060ColumnPylonSection,
} from "./matrix-column-pylon-section-v2.js";
import { extractColumnPylonDimensionLiterals } from "./column-pylon-dimension-literals.js";
import { prepareColumnPylonSectionSource, ColumnPylonSectionInputError,
  type PreparedColumnPylonSectionSource } from "./postgres-column-pylon-section-v2-inputs.js";
import { ColumnPylonSectionOriginMemo } from "./postgres-column-pylon-section-v2-origin.js";
import { withPdfIoBudget, verifyOriginalPdfSet, type OriginalPdfReference } from "./verified-pdf-io.js";
import type { ObjectStorage } from "./storage.js";

const TABLE = "matrix_column_pylon_section_v2_decisions";
export const COLUMN_PYLON_SECTION_OPERATION = "KR060_COLUMN_PYLON_SECTION_V2_REVIEW";
export const COLUMN_PYLON_SECTION_TARGET = "KR060_COLUMN_PYLON_SECTION_V2";
interface Row {
  id: string; sequence_no: string; object_id: string; pair_key: string;
  expected_source_file_id: string; actual_source_file_id: string;
  expected_source_api_id: string; actual_source_api_id: string;
  expected_review_decision_id: string; actual_review_decision_id: string;
  previous_decision_id: string | null; previous_review_hash: string | null;
  projection_json: Journal["projection"]; actor_id: string; content_hash: string; created_at: Date | string;
}
const selectRows = `SELECT journal.*,expected.api_id AS expected_source_api_id,actual.api_id AS actual_source_api_id
  FROM ${TABLE} journal JOIN source_files expected ON expected.id=journal.expected_source_file_id
    AND expected.object_id=journal.object_id
  JOIN source_files actual ON actual.id=journal.actual_source_file_id AND actual.object_id=journal.object_id`;
interface Access { object_id: string; inspection_id: string | null; can_review: boolean }
export interface ColumnPylonSectionRepositoryPorts {
  organizationId: string;
  unconfiguredScaffold: unknown;
  storage?: ObjectStorage;
  transact<T>(signal: AbortSignal, operation: (client: PoolClient) => Promise<T>): Promise<T>;
  lockReceipt(client: PoolClient, command: AuditedMutationCommand, targetId: string): Promise<void>;
  getReceipt(client: PoolClient, command: AuditedMutationCommand, targetId: string): Promise<{
    requestHash: string; response: { value: Journal };
  } | null | undefined>;
  insertReceipt(client: PoolClient, command: AuditedMutationCommand, targetId: string,
    requestHash: string, value: Journal): Promise<void>;
  audit(client: PoolClient, command: AuditedMutationCommand, access: Access,
    targetId: string, previous: Journal | null, value: Journal, reference: string): Promise<void>;
}
function invalid(): never { throw new ColumnPylonSectionInputError("KR060_INPUT_INTEGRITY"); }
function fingerprint(value: unknown): string { return sha256(canonicalJson(value)); }
function state(code: string) {
  return { kind: "invalid_state" as const, code,
    message: "Исходники, доступ или решение пары изменились. Обновите данные и проверьте привязки." };
}
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }

export class ColumnPylonSectionV2Repository {
  constructor(private readonly ports: ColumnPylonSectionRepositoryPorts) {}

  /** Fresh session, user, organization and object permissions. Locks linearize revocation and commit. */
  private async access(client: PoolClient, objectApiId: string, actor: AuthenticatedActor, write: boolean): Promise<Access | null> {
    if (!actor || actor.organizationId !== this.ports.organizationId) return null;
    const rows = (await client.query<{ object_id: string; permission_set: string[] }>(`SELECT object.id AS object_id,access.permission_set
      FROM objects object JOIN object_memberships access ON access.object_id=object.id
      JOIN inspector_users account ON account.id=access.user_id AND account.enabled=true
      JOIN user_sessions session ON session.user_id=account.id AND session.id=$4
        AND session.auth_version=account.auth_version AND session.revoked_at IS NULL AND session.expires_at>now()
      WHERE object.organization_id=$1 AND object.api_id=$2 AND access.user_id=$3
        AND access.revoked_at IS NULL AND access.permission_set @> ARRAY['READ']::text[]
      FOR SHARE OF access,account,session`, [this.ports.organizationId,objectApiId,actor.userId,actor.sessionId])).rows;
    if (rows.length !== 1) return null;
    const memberships = (await client.query<{ capabilities: string[] }>(`SELECT capabilities FROM organization_memberships
      WHERE organization_id=$1 AND user_id=$2 AND revoked_at IS NULL ORDER BY role FOR SHARE`,
    [this.ports.organizationId,actor.userId])).rows;
    if (!memberships.length) return null;
    const canDecide = actor.capabilities.includes("SOURCE_REVIEW")
      && memberships.some(row => row.capabilities.includes("SOURCE_REVIEW"))
      && rows[0]!.permission_set.includes("REVIEW_DECIDE");
    const inspections = (await client.query<{ id: string }>(`SELECT id FROM inspections
      WHERE object_id=$1 AND lifecycle='OPEN'${write ? " FOR UPDATE" : " FOR SHARE"}`, [rows[0]!.object_id])).rows;
    if (inspections.length > 1) invalid();
    if (write && (!canDecide || inspections.length !== 1)) return null;
    return { object_id: rows[0]!.object_id, inspection_id: inspections[0]?.id ?? null,
      can_review: canDecide && inspections.length === 1 };
  }

  private decode(row: Row, objectId: string, objectApiId: string): Journal {
    if (row.object_id !== objectId || !/^[1-9][0-9]*$/.test(String(row.sequence_no))) invalid();
    const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
    const value = validateColumnPylonSectionReviewDecision({ schemaVersion: "matrix-kr060-column-pylon-pair-journal-v2",
      id: row.id, objectId: objectApiId, actorId: row.actor_id, createdAt,
      previousDecisionId: row.previous_decision_id, previousReviewHash: row.previous_review_hash?.trim() ?? null,
      projection: row.projection_json, contentHash: row.content_hash.trim() });
    const expectedPair = columnPylonSectionPairKey({ objectId: objectApiId, identity: value.projection.identity,
      expectedSourceFileId: value.projection.expected.sourceFileId, actualSourceFileId: value.projection.actual.sourceFileId });
    if (value.projection.decisionId !== row.id || value.projection.objectId !== objectApiId
      || expectedPair !== row.pair_key.trim() || row.expected_source_file_id === row.actual_source_file_id
      || value.projection.expected.sourceFileId !== row.expected_source_api_id
      || value.projection.actual.sourceFileId !== row.actual_source_api_id
      || value.projection.expected.sourceReviewDecisionId !== row.expected_review_decision_id
      || value.projection.actual.sourceReviewDecisionId !== row.actual_review_decision_id) invalid();
    return value;
  }
  private async chain(client: PoolClient, row: Row, objectId: string, objectApiId: string): Promise<Journal> {
    const value = this.decode(row,objectId,objectApiId);
    const previous = (await client.query<Row>(`${selectRows} WHERE journal.object_id=$1 AND journal.pair_key=$2
      AND journal.sequence_no<$3 ORDER BY journal.sequence_no DESC LIMIT 1`, [objectId,row.pair_key,row.sequence_no])).rows[0];
    if (previous) {
      const prior = this.decode(previous,objectId,objectApiId);
      if (value.previousDecisionId !== prior.id || value.previousReviewHash !== prior.contentHash) invalid();
      if (value.projection.status === "WITHDRAWN") {
        const payload = (projection: Journal["projection"]) => {
          const { decisionId:_id,status:_status,contentHash:_hash,...fields } = projection; return fields;
        };
        if (!same(payload(value.projection),payload(prior.projection))) invalid();
      }
    } else if (value.previousDecisionId !== null || value.previousReviewHash !== null || value.projection.status === "WITHDRAWN") invalid();
    return value;
  }
  private async operands(client: PoolClient, access: Access, objectApiId: string,
    expected: Pick<ColumnPylonSectionV2SideRequest,"sourceFileId"|"origin"|"sourceReviewDecisionId">,
    actual: Pick<ColumnPylonSectionV2SideRequest,"sourceFileId"|"origin"|"sourceReviewDecisionId">,
    historical: boolean, originMemo?: ColumnPylonSectionOriginMemo): Promise<PreparedColumnPylonSectionSource[]> {
    const values: PreparedColumnPylonSectionSource[] = [];
    for (const side of [expected,actual]) values.push(await prepareColumnPylonSectionSource(client,{
      objectId: access.object_id, objectApiId, sourceFileId: side.sourceFileId, checkId: side.origin.checkId,
      ...(historical ? { historicalReviewDecisionId: side.sourceReviewDecisionId } : {}),
    },this.ports.unconfiguredScaffold,undefined,originMemo));
    if (values[0]!.sourceInternalId === values[1]!.sourceInternalId
      || values[0]!.source.sourceSha256 === values[1]!.source.sourceSha256) invalid();
    return values;
  }
  private async stored(client: PoolClient, row: Row, access: Access, objectApiId: string,
    originMemo?: ColumnPylonSectionOriginMemo) {
    const value = await this.chain(client,row,access.object_id,objectApiId);
    const operands = await this.operands(client,access,objectApiId,value.projection.expected,value.projection.actual,true,originMemo);
    if (operands[0]!.sourceInternalId !== row.expected_source_file_id
      || operands[1]!.sourceInternalId !== row.actual_source_file_id) invalid();
    const result = compareKr060ColumnPylonSection({ schemaVersion: "matrix-kr060-column-pylon-comparison-input-v2",
      objectId: objectApiId, identity: value.projection.identity,
      sources: operands.map(item => item.source), origins: operands.map(item => item.origin), review: value });
    if (value.projection.status === "APPROVED") validateColumnPylonSectionApprovedClaims(value);
    // Source upload-stage membership can change after an immutable decision. Its historical
    // fragments/parents must still reconstruct, and exact revocation must remain possible.
    // Fresh comparison below evaluates current stages again and never inherits approval.
    if (value.projection.status === "APPROVED" ? result.status === "ABSTAIN" && result.reasonCode !== "SOURCE_STAGE_UNVERIFIED"
      : result.status !== "ABSTAIN" || result.reasonCode !== "PAIR_REVIEW_UNAPPROVED") invalid();
    return { value, fingerprint: fingerprint({ value, operands: operands.map(item => item.fingerprint) }) };
  }

  async record(objectApiId: string, raw: Request, command: AuditedMutationCommand):
    Promise<AuditedMutationCommandResult<Journal>> {
    if (!command.actor.capabilities.includes("SOURCE_REVIEW")) return { kind: "forbidden" };
    const input = parseColumnPylonSectionReviewInput(raw);
    if (!input) return state("KR060_INVALID_INPUT");
    try {
      const pairKey = columnPylonSectionPairKey({ objectId: objectApiId, identity: input.identity,
        expectedSourceFileId: input.expected.sourceFileId, actualSourceFileId: input.actual.sourceFileId });
      const targetId = `${objectApiId}:${pairKey}`, requestHash = fingerprint({ objectApiId,input });
      return await withPdfIoBudget(async signal => {
      const prepare = async (client: PoolClient) => {
        const access = await this.access(client,objectApiId,command.actor,true);
        if (!access) return { kind: "not_found" } as const;
        await this.ports.lockReceipt(client,command,targetId);
        const receipt = await this.ports.getReceipt(client,command,targetId);
        if (receipt) {
          if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
          const value = validateColumnPylonSectionReviewDecision(receipt.response.value);
          if (value.objectId !== objectApiId || value.actorId !== command.actor.userId
            || columnPylonSectionPairKey({ objectId:objectApiId,identity:value.projection.identity,
              expectedSourceFileId:value.projection.expected.sourceFileId,actualSourceFileId:value.projection.actual.sourceFileId }) !== pairKey) invalid();
          return { kind: "success", value, replayed: true } as const;
        }
        const row = (await client.query<Row>(`${selectRows} WHERE journal.object_id=$1 AND journal.pair_key=$2
          ORDER BY journal.sequence_no DESC LIMIT 1`,[access.object_id,pairKey])).rows[0];
        // Per prepare/client only: C always reconstructs independently of A/PDF.
        const originMemo = new ColumnPylonSectionOriginMemo(client,this.ports.unconfiguredScaffold);
        const previous = row ? await this.stored(client,row,access,objectApiId,originMemo) : null;
        if (input.expectedReviewHash !== (previous?.value.contentHash ?? null)) return state("KR060_STALE_REVIEW");
        if (!previous) {
          const count = (await client.query<{ n: number }>(`SELECT count(DISTINCT pair_key)::int n FROM ${TABLE} WHERE object_id=$1`,[access.object_id])).rows[0]!.n;
          if (count >= 16) throw new ColumnPylonSectionInputError("KR060_INPUT_LIMIT");
        }
        const operands = await this.operands(client,access,objectApiId,input.expected,input.actual,input.status === "WITHDRAWN",originMemo);
        return { kind: "prepared" as const, access, previous: previous?.value ?? null, operands,
          fingerprint: fingerprint({ previous:previous?.fingerprint ?? null,operands:operands.map(item => item.fingerprint) }) };
      };
      const first = await this.ports.transact(signal,prepare);
      if (first.kind !== "prepared") return first;
      // Exact revocation is possible even if PDF storage is unavailable. Immutable DB reconstruction remains mandatory.
      if (input.status !== "WITHDRAWN") await this.verify(first.operands.map(item => item.reference),signal);
      return this.ports.transact(signal,async client => {
        const fresh = await prepare(client);
        if (fresh.kind !== "prepared") return fresh;
        if (fresh.fingerprint !== first.fingerprint) return state("KR060_INPUT_CHANGED");
        const value = materializeColumnPylonSectionReview(input,{ objectId:objectApiId,actorId:command.actor.userId,
          id:randomUUID(),createdAt:new Date().toISOString(),mode:input.status === "WITHDRAWN" ? "HISTORICAL" : "CURRENT",
          previous:fresh.previous,sources:fresh.operands.map(item => item.source),origins:fresh.operands.map(item => item.origin) });
        await client.query(`INSERT INTO ${TABLE}(id,object_id,pair_key,expected_source_file_id,actual_source_file_id,
          expected_review_decision_id,actual_review_decision_id,previous_decision_id,previous_review_hash,
          projection_json,actor_id,content_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::timestamptz)`,
        [value.id,fresh.access.object_id,pairKey,fresh.operands[0]!.sourceInternalId,fresh.operands[1]!.sourceInternalId,
          value.projection.expected.sourceReviewDecisionId,value.projection.actual.sourceReviewDecisionId,
          value.previousDecisionId,value.previousReviewHash,JSON.stringify(value.projection),command.actor.userId,value.contentHash,value.createdAt]);
        await this.ports.insertReceipt(client,command,targetId,requestHash,value);
        await this.ports.audit(client,command,fresh.access,targetId,fresh.previous,value,input.reference);
        return { kind:"success",value,replayed:false } as const;
      });
    }); } catch (error) { return this.failure(error); }
  }
  private async verify(references: OriginalPdfReference[], signal: AbortSignal): Promise<void> {
    if (!this.ports.storage) invalid();
    await verifyOriginalPdfSet({ storage:this.ports.storage,references,signal });
  }
  private failure(error: unknown): ReturnType<typeof state> {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
    if (code && /^(?:KR060_|PDF_|INVALID_|INPUT_LIMIT|STALE_REVIEW|PAIR_MISMATCH|WITHDRAWAL_MISMATCH|APPROVAL_NOT_ELIGIBLE)/.test(code))
      return state(code.startsWith("KR060_") ? code : `KR060_${code}`);
    throw error;
  }

  async list(objectApiId: string, actor: AuthenticatedActor): Promise<ColumnPylonSectionV2ReviewList | undefined> {
    try { return await withPdfIoBudget(signal => this.ports.transact(signal,async client => {
      const access = await this.access(client,objectApiId,actor,false); if (!access) return undefined;
      const rows = (await client.query<Row>(`${selectRows} WHERE journal.id IN (
        SELECT DISTINCT ON(pair_key) id FROM ${TABLE} WHERE object_id=$1 ORDER BY pair_key,sequence_no DESC)
        ORDER BY journal.sequence_no DESC LIMIT 17`,[access.object_id])).rows;
      if (rows.length > 16) throw new ColumnPylonSectionInputError("KR060_INPUT_LIMIT");
      const items: Journal[] = [];
      for (const row of rows) items.push((await this.stored(client,row,access,objectApiId)).value);
      return { items,canReview:access.can_review };
    })); } catch (error) { this.failure(error); return undefined; }
  }
  async sourcePreview(checkId: string, sourceFileId: string, actor: AuthenticatedActor): Promise<ColumnPylonSectionV2SourcePreview | undefined> {
    try { return await withPdfIoBudget(async signal => {
      const prepare = async (client: PoolClient) => {
        const objects = (await client.query<{ api_id: string }>(`SELECT object.api_id FROM analysis_runs run
          JOIN objects object ON object.id=run.object_id WHERE run.api_id=$1 AND object.organization_id=$2`,[checkId,this.ports.organizationId])).rows;
        if (objects.length !== 1) return null;
        const objectApiId = objects[0]!.api_id, access = await this.access(client,objectApiId,actor,false);
        if (!access) return null;
        const prepared = await prepareColumnPylonSectionSource(client,{ objectId:access.object_id,objectApiId,sourceFileId,checkId },this.ports.unconfiguredScaffold);
        return { objectApiId,prepared };
      };
      const first = await this.ports.transact(signal,prepare); if (!first) return undefined;
      await this.verify([first.prepared.reference],signal);
      const fresh = await this.ports.transact(signal,prepare);
      if (!fresh || fresh.prepared.fingerprint !== first.prepared.fingerprint) return undefined;
      const source = fresh.prepared.source;
      return { schemaVersion:"matrix-kr060-column-pylon-source-preview-v2",objectId:fresh.objectApiId,
        sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,origin:fresh.prepared.origin.target,
        stage:source.stages.length === 1 ? source.stages[0]! : "UNRESOLVED",pageStages:source.review?.pageStages ?? {},
        latestReviewHash:source.review?.contentHash ?? null,extraction:extractColumnPylonDimensionLiterals(fresh.prepared.origin.textArtifact),
        nativeSelectionPolicyVersion:"column-pylon-native-section-selection-v1" };
    }); } catch (error) { this.failure(error); return undefined; }
  }
  async comparison(objectApiId: string, reviewDecisionId: string, actor: AuthenticatedActor):
    Promise<Result | ReturnType<typeof state> | undefined> {
    try { return await withPdfIoBudget(async signal => {
      const prepare = async (client: PoolClient) => {
        const access = await this.access(client,objectApiId,actor,false); if (!access) return null;
        const rows = (await client.query<Row>(`${selectRows} WHERE journal.object_id=$1 AND journal.id=$2`,[access.object_id,reviewDecisionId])).rows;
        if (rows.length !== 1) return null;
        const row = rows[0]!;
        const latest = (await client.query<{ id: string }>(`SELECT id FROM ${TABLE} WHERE object_id=$1 AND pair_key=$2 ORDER BY sequence_no DESC LIMIT 1`,[access.object_id,row.pair_key])).rows[0];
        if (latest?.id !== reviewDecisionId) return state("KR060_STALE_REVIEW");
        const stored = await this.stored(client,row,access,objectApiId);
        const operands = await this.operands(client,access,objectApiId,stored.value.projection.expected,stored.value.projection.actual,false);
        return { kind:"prepared" as const,value:stored.value,operands,
          fingerprint:fingerprint({ stored:stored.fingerprint,current:operands.map(item => item.fingerprint) }) };
      };
      const first = await this.ports.transact(signal,prepare);
      if (!first || first.kind !== "prepared") return first ?? undefined;
      await this.verify(first.operands.map(item => item.reference),signal);
      const fresh = await this.ports.transact(signal,prepare);
      if (!fresh || fresh.kind !== "prepared") return fresh ?? undefined;
      if (first.fingerprint !== fresh.fingerprint) return state("KR060_INPUT_CHANGED");
      return compareKr060ColumnPylonSection({ schemaVersion:"matrix-kr060-column-pylon-comparison-input-v2",
        objectId:objectApiId,identity:fresh.value.projection.identity,sources:fresh.operands.map(item => item.source),
        origins:fresh.operands.map(item => item.origin),review:fresh.value });
    }); } catch (error) { return this.failure(error); }
  }
}
