/** Protected T83 journal pins. Caller owns actor/org authorization, transaction,
 * immutable run snapshot selection and original PDF verification outside locks. */
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
import type {PoolClient} from 'pg';
import type {ColumnPylonSectionV2Journal,ColumnPylonSectionV2Origin,ColumnPylonSectionV2Source} from '@inspector-ai/contracts';
import {canonicalJson,sha256} from './canonical-json.js';
import {validateColumnPylonSectionReviewDecision,columnPylonSectionPairKey,
 compareKr060ColumnPylonSection,validateColumnPylonSectionApprovedClaims} from './matrix-column-pylon-section-v2.js';
import {prepareColumnPylonSectionSource,ColumnPylonSectionInputError,
 type PreparedColumnPylonSectionSource} from './postgres-column-pylon-section-v2-inputs.js';
import type {OriginalPdfReference} from './verified-pdf-io.js';

export interface ColumnPylonSectionJournalRow {
 id:string;sequence_no:string;object_id:string;pair_key:string;
 expected_source_file_id:string;actual_source_file_id:string;
 expected_source_api_id:string;actual_source_api_id:string;
 expected_review_decision_id:string;actual_review_decision_id:string;
 previous_decision_id:string|null;previous_review_hash:string|null;
 projection_json:ColumnPylonSectionV2Journal['projection'];actor_id:string;content_hash:string;created_at:Date|string;
}
export interface VerifiedColumnPylonSectionJournalPin {
 journal:ColumnPylonSectionV2Journal;sequenceNo:string;pairKey:string;
 historicalSources:[ColumnPylonSectionV2Source,ColumnPylonSectionV2Source];
 origins:[ColumnPylonSectionV2Origin,ColumnPylonSectionV2Origin];
 references:OriginalPdfReference[];fingerprint:string;
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\s\S])/iu;
const SHA=/^[a-f0-9]{64}(?![\s\S])/u;
const MAX_SEQUENCE=9223372036854775807n;
function invalid():never{throw new ColumnPylonSectionInputError('KR060_INPUT_INTEGRITY');}
function limit():never{throw new ColumnPylonSectionInputError('KR060_INPUT_LIMIT');}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const rowsSql=`SELECT journal.*,expected.api_id AS expected_source_api_id,actual.api_id AS actual_source_api_id
 FROM matrix_column_pylon_section_v2_decisions journal
 JOIN source_files expected ON expected.id=journal.expected_source_file_id AND expected.object_id=journal.object_id
 JOIN source_files actual ON actual.id=journal.actual_source_file_id AND actual.object_id=journal.object_id`;
function selection(objectId:string,ids?:readonly string[]):{cte:string;values:unknown[]}{
 if(typeof objectId!=='string'||!UUID.test(objectId))invalid();
 if(ids!==undefined){
  if(!Array.isArray(ids)||ids.length>16||ids.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(ids).size!==ids.length)invalid();
  return{cte:`SELECT journal.* FROM matrix_column_pylon_section_v2_decisions journal
    WHERE journal.object_id=$1 AND journal.id=ANY($2::uuid[])`,values:[objectId,ids]};
 }
 return{cte:`SELECT DISTINCT ON (journal.pair_key) journal.*
   FROM matrix_column_pylon_section_v2_decisions journal WHERE journal.object_id=$1
   ORDER BY journal.pair_key,journal.sequence_no DESC`,values:[objectId]};
}
async function selectedRows(client:PoolClient,objectId:string,ids?:readonly string[],preparationBudget?:MatrixPreparationBudgetV13):Promise<ColumnPylonSectionJournalRow[]>{
 const {cte,values}=selection(objectId,ids);
 if(preparationBudget!==undefined)await preparationBudget.columnJournalRows(ids);
 const budget=(await client.query<{pair_count:number;bytes:string;max_bytes:string}>(`WITH selected AS (${cte})
  SELECT count(*)::int AS pair_count,COALESCE(sum(octet_length(projection_json::text)),0)::text AS bytes,
  COALESCE(max(octet_length(projection_json::text)),0)::text AS max_bytes FROM selected`,values)).rows;
 if(budget.length!==1)invalid();const b=budget[0]!,sum=Number(b.bytes),max=Number(b.max_bytes);
 if(!Number.isSafeInteger(b.pair_count)||b.pair_count<0||!Number.isSafeInteger(sum)||sum<0||!Number.isSafeInteger(max)||max<0)invalid();
 if(b.pair_count>16||sum>16*1048576||max>1048576)limit();
 if(ids!==undefined&&b.pair_count!==ids.length)invalid();
 const rows=(await client.query<ColumnPylonSectionJournalRow>(`WITH selected AS (${cte})
  SELECT selected.*,expected.api_id AS expected_source_api_id,actual.api_id AS actual_source_api_id
  FROM selected JOIN source_files expected ON expected.id=selected.expected_source_file_id AND expected.object_id=selected.object_id
  JOIN source_files actual ON actual.id=selected.actual_source_file_id AND actual.object_id=selected.object_id
  ORDER BY selected.pair_key`,values)).rows;
 if(rows.length!==b.pair_count)invalid();return rows;
}
/** All latest logical pairs, before any status/approval/source inclusion filter. */
export const loadLatestColumnPylonSectionJournalRows=(client:PoolClient,objectId:string,budget?:MatrixPreparationBudgetV13)=>budget===undefined?selectedRows(client,objectId):selectedRows(client,objectId,undefined,budget);
/** Exact historical IDs. No replacement with a newer/current object journal. */
export const loadPinnedColumnPylonSectionJournalRows=(client:PoolClient,objectId:string,ids:readonly string[],budget?:MatrixPreparationBudgetV13)=>budget===undefined?selectedRows(client,objectId,ids):selectedRows(client,objectId,ids,budget);

function decode(row:ColumnPylonSectionJournalRow,objectId:string,objectApiId:string):ColumnPylonSectionV2Journal{
 if(row.object_id!==objectId||typeof row.sequence_no!=='string'||!/^[1-9][0-9]{0,18}(?![\s\S])/u.test(row.sequence_no)
  ||BigInt(row.sequence_no)>MAX_SEQUENCE)invalid();
 const createdAt=row.created_at instanceof Date?row.created_at.toISOString():row.created_at;
 let journal:ColumnPylonSectionV2Journal;
 try{journal=validateColumnPylonSectionReviewDecision({schemaVersion:'matrix-kr060-column-pylon-pair-journal-v2',
  id:row.id,objectId:objectApiId,actorId:row.actor_id,createdAt,previousDecisionId:row.previous_decision_id,
  previousReviewHash:row.previous_review_hash?.trim()??null,projection:row.projection_json,contentHash:row.content_hash.trim()});}
 catch{invalid();}
 const p=journal.projection,key=columnPylonSectionPairKey({objectId:objectApiId,identity:p.identity,
  expectedSourceFileId:p.expected.sourceFileId,actualSourceFileId:p.actual.sourceFileId});
 if(key!==row.pair_key.trim()||!UUID.test(row.expected_source_file_id)||!UUID.test(row.actual_source_file_id)
  ||row.expected_source_file_id===row.actual_source_file_id||p.expected.sourceFileId!==row.expected_source_api_id
  ||p.actual.sourceFileId!==row.actual_source_api_id||p.expected.sourceReviewDecisionId!==row.expected_review_decision_id
  ||p.actual.sourceReviewDecisionId!==row.actual_review_decision_id)invalid();
 return journal;
}
function withdrawalBody(p:ColumnPylonSectionV2Journal['projection']){
 const {decisionId:_id,status:_status,contentHash:_hash,...body}=p;return body;
}
/** Complete retained historical contexts first. No PDF I/O or current inclusion decision here. */
export async function prepareColumnPylonSectionJournalPins(client:PoolClient,input:{objectId:string;objectApiId:string;rows:readonly ColumnPylonSectionJournalRow[]},scaffold:unknown,budget?:MatrixPreparationBudgetV13):Promise<VerifiedColumnPylonSectionJournalPin[]>{
 if(!UUID.test(input.objectId)||typeof input.objectApiId!=='string'||!input.objectApiId||!Array.isArray(input.rows)||input.rows.length>16)invalid();
 const pins:VerifiedColumnPylonSectionJournalPin[]=[],seen=new Set<string>(),cache=new Map<string,PreparedColumnPylonSectionSource>();
 const retainedOrigins=new Map<string,ColumnPylonSectionV2Origin>();
 const charged=new Set<string>();let originalBytes=0,previousKey:string|undefined;
 for(const row of input.rows){
  const journal=decode(row,input.objectId,input.objectApiId),key=row.pair_key.trim();
  if(previousKey!==undefined&&key<=previousKey||seen.has(journal.id))invalid();previousKey=key;seen.add(journal.id);
  if(budget!==undefined)await budget.previousColumnJournal(key,row.sequence_no);
  const previousBudget=(await client.query<{pair_count:number;bytes:string;max_bytes:string}>(`WITH previous AS (
   SELECT journal.projection_json FROM matrix_column_pylon_section_v2_decisions journal
   WHERE journal.object_id=$1 AND journal.pair_key=$2 AND journal.sequence_no<$3
   ORDER BY journal.sequence_no DESC LIMIT 1)
   SELECT count(*)::int AS pair_count,COALESCE(sum(octet_length(projection_json::text)),0)::text AS bytes,
   COALESCE(max(octet_length(projection_json::text)),0)::text AS max_bytes FROM previous`,[input.objectId,key,row.sequence_no])).rows;
  if(previousBudget.length!==1)invalid();
  const pb=previousBudget[0]!,previousBytes=Number(pb.bytes),previousMax=Number(pb.max_bytes);
  if(!Number.isSafeInteger(pb.pair_count)||pb.pair_count<0||pb.pair_count>1
   ||!Number.isSafeInteger(previousBytes)||previousBytes<0||!Number.isSafeInteger(previousMax)||previousMax<0)invalid();
  if(previousBytes>1048576||previousMax>1048576)limit();
  const previousRows=pb.pair_count?(await client.query<ColumnPylonSectionJournalRow>(`${rowsSql}
   WHERE journal.object_id=$1 AND journal.pair_key=$2 AND journal.sequence_no<$3
   ORDER BY journal.sequence_no DESC LIMIT 1`,[input.objectId,key,row.sequence_no])).rows:[];
  if(previousRows.length!==pb.pair_count)invalid();const previous=previousRows[0]?decode(previousRows[0],input.objectId,input.objectApiId):null;
  if(previous){
   if(journal.previousDecisionId!==previous.id||journal.previousReviewHash!==previous.contentHash
    ||journal.projection.status==='WITHDRAWN'&&!same(withdrawalBody(journal.projection),withdrawalBody(previous.projection)))invalid();
  }else if(journal.previousDecisionId!==null||journal.previousReviewHash!==null||journal.projection.status==='WITHDRAWN')invalid();
  const operands:PreparedColumnPylonSectionSource[]=[];
  for(const side of [journal.projection.expected,journal.projection.actual]){
   const originKey=canonicalJson([side.sourceFileId,side.origin]);
   if(!charged.has(originKey)){
    if(charged.size>=32)limit();
    const sizes=(await client.query<{source_count:number;bytes:string}>(`SELECT count(*)::int AS source_count,
      COALESCE(sum(GREATEST(text.byte_size,octet_length(text.content_json::text))),0)::text AS bytes
     FROM analysis_runs run JOIN analysis_text_artifacts text ON text.run_id=run.id
     JOIN source_files source ON source.id=text.source_file_id AND source.object_id=run.object_id
     WHERE run.object_id=$1 AND run.api_id=$2 AND source.api_id=$3`,[input.objectId,side.origin.checkId,side.sourceFileId])).rows;
    if(sizes.length!==1||sizes[0]!.source_count!==1)invalid();const bytes=Number(sizes[0]!.bytes);
    if(!Number.isSafeInteger(bytes)||bytes<1)invalid();if(bytes>32000000||originalBytes+bytes>67108864)limit();
    originalBytes+=bytes;charged.add(originKey);
   }
   const cacheKey=canonicalJson([originKey,side.sourceReviewDecisionId]);let prepared=cache.get(cacheKey);
   if(!prepared){prepared=budget===undefined
    ?await prepareColumnPylonSectionSource(client,{objectId:input.objectId,objectApiId:input.objectApiId,
    sourceFileId:side.sourceFileId,checkId:side.origin.checkId,historicalReviewDecisionId:side.sourceReviewDecisionId},scaffold)
    :await prepareColumnPylonSectionSource(client,{objectId:input.objectId,objectApiId:input.objectApiId,
    sourceFileId:side.sourceFileId,checkId:side.origin.checkId,historicalReviewDecisionId:side.sourceReviewDecisionId},scaffold,budget);
    // A single immutable text origin may have several historical parent-review
    // contexts. Retain its full body once, rather than once per review pointer.
    const retained=retainedOrigins.get(originKey);
    if(retained){if(!same(retained,prepared.origin))invalid();prepared={...prepared,origin:retained};}
    else retainedOrigins.set(originKey,prepared.origin);
    cache.set(cacheKey,prepared);
   }
   if(!same(prepared.origin.target,side.origin)||prepared.source.sourceFileId!==side.sourceFileId
    ||prepared.source.sourceSha256!==side.sourceSha256||prepared.source.review?.decisionId!==side.sourceReviewDecisionId
    ||prepared.source.review.contentHash!==side.sourceReviewContentHash||!SHA.test(prepared.fingerprint))invalid();
   operands.push(prepared);
  }
  const expected=operands[0]!,actual=operands[1]!;
  if(expected.sourceInternalId!==row.expected_source_file_id||actual.sourceInternalId!==row.actual_source_file_id)invalid();
  const historicalSources:[ColumnPylonSectionV2Source,ColumnPylonSectionV2Source]=[expected.source,actual.source];
  const origins:[ColumnPylonSectionV2Origin,ColumnPylonSectionV2Origin]=[expected.origin,actual.origin];
  const result=compareKr060ColumnPylonSection({schemaVersion:'matrix-kr060-column-pylon-comparison-input-v2',
   objectId:input.objectApiId,identity:journal.projection.identity,sources:historicalSources,origins,review:journal});
  if(journal.projection.status==='APPROVED'){
   validateColumnPylonSectionApprovedClaims(journal);
   if(result.status==='ABSTAIN'&&result.reasonCode!=='SOURCE_STAGE_UNVERIFIED')invalid();
  }else if(result.status!=='ABSTAIN'||result.reasonCode!=='PAIR_REVIEW_UNAPPROVED')invalid();
  const references=[expected.reference,actual.reference];
  pins.push({journal,sequenceNo:row.sequence_no,pairKey:key,historicalSources,origins,references,
   fingerprint:sha256(canonicalJson({journal,sequenceNo:row.sequence_no,pairKey:key,operands:operands.map(o=>o.fingerprint),references}))});
 }
 return pins;
}
