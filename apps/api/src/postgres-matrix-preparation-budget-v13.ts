/** Resource precharge only. Caller owns checked client/object, actor authority,
 * repeatable-read snapshot and all semantic/release/PDF checks. No JSON bodies
 * leave PostgreSQL through this module. One factory per complete preparation. */
import type {PoolClient} from 'pg';
import {types as utilTypes} from 'node:util';
import {InventoryLoaderIntegrityError} from './matrix-inventory-loader.js';

export interface MatrixPreparationBudgetV13 {
 runById(runId:string):Promise<void>;
 runByCheck(checkId:string):Promise<void>;
 steelAdmission():Promise<void>;
 columnJournalRows(ids?:readonly string[]):Promise<void>;
 previousColumnJournal(pairKey:string,sequenceNo:string):Promise<void>;
 sourceReview(sourceInternalId:string,decisionId:string):Promise<void>;
}
const TOTAL=67108864,MAX_RUNS=129,MAX_SOURCES=64,MAX_JOURNALS=16,MAX_JOURNAL_BYTES=1048576;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\s\S])/iu;
const SHA=/^[a-f0-9]{64}(?![\s\S])/u;
function invalid():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_INTEGRITY');}
function limit():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_LIMIT');}
function uuid(value:unknown):string{
 if(typeof value!=='string'||!UUID.test(value))invalid();return value.toLowerCase();
}
function scalar(value:unknown):number{
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)invalid();return value;}
 if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,15})(?![\s\S])/u.test(value))invalid();
 const result=Number(value);if(!Number.isSafeInteger(result)||result<0)invalid();return result;
}
function exactIds(ids:readonly string[]):string[]{
 if(utilTypes.isProxy(ids)||!Array.isArray(ids)||Object.getPrototypeOf(ids)!==Array.prototype)invalid();
 const descriptors=Object.getOwnPropertyDescriptors(ids),length=Object.getOwnPropertyDescriptor(ids,'length');
 if(!length||!('value'in length)||typeof length.value!=='number'||!Number.isSafeInteger(length.value)||length.value<0)invalid();
 if(length.value>MAX_JOURNALS)limit();
 if(Reflect.ownKeys(descriptors).length!==length.value+1)invalid();
 const result:string[]=[];
 for(let i=0;i<length.value;i++){
  const item=descriptors[String(i)];if(!item||!('value'in item))invalid();result.push(uuid(item.value));
 }
 if(new Set(result).size!==result.length)invalid();return result;
}
/** The captured client is used unchanged for every query; no pool/raw-client
 * escape, recursive graph scan or caller-supplied authority callback. */
export function createMatrixPreparationBudgetV13(client:PoolClient,objectId:string):MatrixPreparationBudgetV13{
 const object=uuid(objectId);
 let chargedBytes=0,failed=false,failure:unknown,tail:Promise<void>=Promise.resolve();
 const runs=new Set<string>(),checks=new Map<string,string>(),selected=new Set<string>(),previous=new Set<string>();
 const journalCharges=new Map<string,number>(),reviews=new Map<string,string>();
 const selections=new Set<string>(),previousSelections=new Set<string>();
 let steelAdmissionCharged=false;
 function charge(amount:number):void{
  if(!Number.isSafeInteger(amount)||amount<0)invalid();if(amount>TOTAL-chargedBytes)limit();chargedBytes+=amount;
 }
 function serial(operation:()=>Promise<void>):Promise<void>{
  const next=tail.then(async()=>{
   if(failed)throw failure;
   try{await operation();}catch(error){failed=true;failure=error;throw error;}
  });
  tail=next.catch(()=>{});return next;
 }
 async function runById(rawId:string):Promise<void>{
  const id=uuid(rawId);if(runs.has(id))return;if(runs.size>=MAX_RUNS)limit();
  // The first result is fixed scalar metadata only; enforce cardinality before
  // expensive JSON byte aggregation, and before any caller transfers a body.
  const counts=(await client.query<{id:string;source_count:unknown;text_count:unknown;bad_review_count:unknown;steel_entry_count:unknown;bad_steel_entry_count:unknown}>(`SELECT run.id,
   (SELECT count(*) FROM manifest_items item WHERE item.manifest_id=run.manifest_id)::text AS source_count,
   (SELECT count(*) FROM analysis_text_artifacts text WHERE text.run_id=run.id)::text AS text_count,
   (SELECT count(*) FROM run_source_review_snapshots snapshot
    LEFT JOIN source_review_decisions review ON review.id=snapshot.decision_id
      AND review.object_id=run.object_id AND review.source_file_id=snapshot.source_file_id
    WHERE snapshot.run_id=run.id AND snapshot.decision_id IS NOT NULL AND review.id IS NULL)::text AS bad_review_count,
   (SELECT count(*) FROM run_steel_applicability_snapshot_entries entry WHERE entry.run_id=run.id)::text AS steel_entry_count,
   (SELECT count(*) FROM run_steel_applicability_snapshot_entries entry
    LEFT JOIN matrix_steel_applicability_decisions journal ON journal.id=entry.decision_id
     AND journal.object_id=run.object_id AND journal.pair_key=entry.pair_key AND journal.sequence_no=entry.sequence_no
    WHERE entry.run_id=run.id AND journal.id IS NULL)::text AS bad_steel_entry_count
   FROM analysis_runs run WHERE run.id=$1 AND run.object_id=$2`,[id,object])).rows;
  if(counts.length!==1||uuid(counts[0]!.id)!==id)invalid();const count=counts[0]!;
  const sources=scalar(count.source_count),texts=scalar(count.text_count);
  if(sources>MAX_SOURCES||texts>MAX_SOURCES)limit();if(scalar(count.bad_review_count)!==0||scalar(count.bad_steel_entry_count)!==0)invalid();
  if(scalar(count.steel_entry_count)>MAX_JOURNALS)limit();
  const totals=(await client.query<{total_bytes:unknown}>(`WITH scoped_run AS (SELECT run.* FROM analysis_runs run WHERE run.id=$1 AND run.object_id=$2),
   steel_selected AS (SELECT journal.* FROM scoped_run run
    JOIN run_steel_applicability_snapshot_entries entry ON entry.run_id=run.id
    JOIN matrix_steel_applicability_decisions journal ON journal.id=entry.decision_id
     AND journal.object_id=run.object_id AND journal.pair_key=entry.pair_key AND journal.sequence_no=entry.sequence_no),
   steel_ids AS (SELECT id FROM steel_selected UNION
    SELECT predecessor.id FROM steel_selected selected JOIN LATERAL (
     SELECT journal.id FROM matrix_steel_applicability_decisions journal
      WHERE journal.object_id=selected.object_id AND journal.pair_key=selected.pair_key
       AND journal.sequence_no<selected.sequence_no ORDER BY journal.sequence_no DESC LIMIT 1
    ) predecessor ON true),
   steel_journals AS (SELECT journal.* FROM matrix_steel_applicability_decisions journal
    JOIN steel_ids ids ON ids.id=journal.id JOIN scoped_run run ON run.object_id=journal.object_id),
   steel_review_refs AS (SELECT expected_review_decision_id AS id,expected_source_file_id AS source_id FROM steel_journals
    UNION SELECT actual_review_decision_id,actual_source_file_id FROM steel_journals)
   SELECT (
   COALESCE((SELECT sum(GREATEST(text.byte_size,octet_length(text.content_json::text)))
    FROM analysis_text_artifacts text WHERE text.run_id=run.id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(snapshot)::text)+COALESCE(octet_length(to_jsonb(review)::text),0))
    FROM run_source_review_snapshots snapshot LEFT JOIN source_review_decisions review
      ON review.id=snapshot.decision_id AND review.object_id=run.object_id AND review.source_file_id=snapshot.source_file_id
    WHERE snapshot.run_id=run.id),0)
   +COALESCE((SELECT octet_length(manifest.canonical_json::text) FROM input_manifests manifest
    WHERE manifest.id=run.manifest_id AND manifest.inspection_id=run.inspection_id),0)
   +COALESCE((SELECT GREATEST(release.byte_size,octet_length(release.content_json::text))
    FROM analysis_releases release WHERE release.release_id=run.release_id),0)
   +COALESCE((SELECT sum(octet_length(job.result_json::text)) FROM analysis_jobs job
    WHERE job.run_id=run.id AND job.object_id=run.object_id),0)
   +COALESCE((SELECT sum(GREATEST(stage.byte_size,octet_length(stage.content_json::text)))
    FROM analysis_stage_artifacts stage WHERE stage.run_id=run.id),0)
   +COALESCE((SELECT sum(octet_length(machine.submission_bytes)+octet_length(machine.metadata::text))
    FROM machine_prediction_snapshots machine WHERE machine.run_id=run.id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(result)::text))
    FROM rule_results result WHERE result.run_id=run.id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(coverage)::text))
    FROM parameter_coverage coverage WHERE coverage.run_id=run.id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(state)::text)) FROM run_column_pylon_section_snapshot_states state
    WHERE state.run_id=run.id AND state.object_id=run.object_id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(entry)::text)) FROM run_column_pylon_section_snapshot_entries entry
    WHERE entry.run_id=run.id AND entry.object_id=run.object_id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(state)::text)) FROM run_steel_applicability_snapshot_states state
    WHERE state.run_id=run.id AND state.object_id=run.object_id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(entry)::text)) FROM run_steel_applicability_snapshot_entries entry
    WHERE entry.run_id=run.id),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(journal)::text)) FROM steel_journals journal),0)
   +COALESCE((SELECT sum(octet_length(to_jsonb(review)::text)) FROM steel_review_refs ref
    JOIN source_review_decisions review ON review.id=ref.id AND review.source_file_id=ref.source_id
     AND review.object_id=run.object_id),0)
   )::text AS total_bytes FROM scoped_run run`,[id,object])).rows;
  if(totals.length!==1)invalid();charge(scalar(totals[0]!.total_bytes));runs.add(id);
 }
 async function runByCheck(checkId:string):Promise<void>{
  if(typeof checkId!=='string'||checkId.length<1||checkId.length>200||checkId.trim()!==checkId
   ||/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufffd]/u.test(checkId))invalid();
  const cached=checks.get(checkId);if(cached){await runById(cached);return;}
  const rows=(await client.query<{id:string}>(`SELECT run.id FROM analysis_runs run
   WHERE run.object_id=$1 AND run.api_id=$2`,[object,checkId])).rows;
  if(rows.length!==1)invalid();const id=uuid(rows[0]!.id);await runById(id);checks.set(checkId,id);
 }
 async function steelAdmission():Promise<void>{
  if(steelAdmissionCharged)return;
  // Latest logical pairs are counted before status/ref filtering. Only scalar
  // metadata leaves SQL; caller retains its RR snapshot or inspection lock.
  const counts=(await client.query<{selected_count:unknown;source_count:unknown}>(`WITH selected AS (
   SELECT DISTINCT ON (journal.pair_key) journal.id FROM matrix_steel_applicability_decisions journal
    WHERE journal.object_id=$1 ORDER BY journal.pair_key,journal.sequence_no DESC)
   SELECT count(*)::text AS selected_count,
    (SELECT count(*) FROM source_files source WHERE source.object_id=$1)::text AS source_count FROM selected`,[object])).rows;
  if(counts.length!==1)invalid();const count=scalar(counts[0]!.selected_count),sources=scalar(counts[0]!.source_count);
  if(count>MAX_JOURNALS||sources>MAX_SOURCES)limit();
  // UNION charges every selected row and its immediate same-object/same-pair
  // predecessor once. The existing 8M limit is on projection_json, not rows;
  // steel rows do not inherit the unrelated column journal 1MiB row limit.
  const cte=`WITH selected AS (
   SELECT DISTINCT ON (journal.pair_key) journal.id,journal.object_id,journal.pair_key,journal.sequence_no
    FROM matrix_steel_applicability_decisions journal WHERE journal.object_id=$1
    ORDER BY journal.pair_key,journal.sequence_no DESC),
   ids AS (SELECT id FROM selected UNION SELECT predecessor.id FROM selected JOIN LATERAL (
    SELECT journal.id FROM matrix_steel_applicability_decisions journal
     WHERE journal.object_id=selected.object_id AND journal.pair_key=selected.pair_key
      AND journal.sequence_no<selected.sequence_no ORDER BY journal.sequence_no DESC LIMIT 1
   ) predecessor ON true),
   journals AS (SELECT journal.* FROM matrix_steel_applicability_decisions journal JOIN ids ON ids.id=journal.id
    WHERE journal.object_id=$1)`;
  const totals=(await client.query<{selected_count:unknown;whole_count:unknown;total_bytes:unknown}>(`${cte}
   SELECT (SELECT count(*) FROM selected)::text AS selected_count,count(*)::text AS whole_count,
    COALESCE(sum(octet_length(to_jsonb(journals)::text)),0)::text AS total_bytes FROM journals`,[object])).rows;
  if(totals.length!==1)invalid();const total=totals[0]!,whole=scalar(total.whole_count);
  if(scalar(total.selected_count)!==count||whole<count||whole>count*2)invalid();charge(scalar(total.total_bytes));
  const refs=(await client.query<{decision_id:string;source_id:string}>(`${cte}
   SELECT expected_review_decision_id AS decision_id,expected_source_file_id AS source_id FROM journals
   UNION SELECT actual_review_decision_id,actual_source_file_id FROM journals
   ORDER BY decision_id,source_id LIMIT 65`,[object])).rows;
  if(refs.length>MAX_JOURNALS*4)limit();
  const exact=new Map<string,string>();
  for(const ref of refs){
   const decision=uuid(ref.decision_id),source=uuid(ref.source_id),old=exact.get(decision);
   if(old!==undefined&&old!==source)invalid();exact.set(decision,source);
  }
  // Exact full parent rows are charged through the shared review cache before
  // prepareSteelApplicabilityInputs transfers them. No nested serial() call.
  for(const [decision,source] of exact)await sourceReview(source,decision);
  steelAdmissionCharged=true;
 }
 function journalRows(rows:readonly {id:string;bytes:unknown}[],category:Set<string>):void{
  const prospective=new Set(category),ids=new Set<string>();let amount=0;
  for(const row of rows){
   const id=uuid(row.id),bytes=scalar(row.bytes);if(ids.has(id))invalid();ids.add(id);prospective.add(id);
   if(bytes>MAX_JOURNAL_BYTES)limit();const old=journalCharges.get(id);
   if(old!==undefined){if(old!==bytes)invalid();}else amount+=bytes;
  }
  if(prospective.size>MAX_JOURNALS)limit();charge(amount);
  for(const row of rows){const id=uuid(row.id);category.add(id);journalCharges.set(id,scalar(row.bytes));}
 }
 async function columnJournalRows(ids?:readonly string[]):Promise<void>{
  const exact=ids===undefined?undefined:exactIds(ids),key=exact===undefined?'latest':exact.slice().sort().join(',');
  if(selections.has(key))return;
  const cte=exact===undefined?`SELECT DISTINCT ON (journal.pair_key) journal.*
   FROM matrix_column_pylon_section_v2_decisions journal WHERE journal.object_id=$1
   ORDER BY journal.pair_key,journal.sequence_no DESC`:`SELECT journal.* FROM matrix_column_pylon_section_v2_decisions journal
   WHERE journal.object_id=$1 AND journal.id=ANY($2::uuid[])`;
  const values=exact===undefined?[object]:[object,exact];
  const totals=(await client.query<{row_count:unknown;total_bytes:unknown;max_bytes:unknown}>(`WITH selected AS (${cte})
   SELECT count(*)::text AS row_count,COALESCE(sum(octet_length(to_jsonb(selected)::text)),0)::text AS total_bytes,
    COALESCE(max(octet_length(to_jsonb(selected)::text)),0)::text AS max_bytes FROM selected`,values)).rows;
  if(totals.length!==1)invalid();const row=totals[0]!,count=scalar(row.row_count),sum=scalar(row.total_bytes),max=scalar(row.max_bytes);
  if(count>MAX_JOURNALS||max>MAX_JOURNAL_BYTES||sum>TOTAL)limit();if(exact!==undefined&&count!==exact.length)invalid();
  const rows=(await client.query<{id:string;bytes:unknown}>(`WITH selected AS (${cte})
   SELECT id,octet_length(to_jsonb(selected)::text)::text AS bytes FROM selected ORDER BY id`,values)).rows;
  if(rows.length!==count)invalid();if(rows.reduce((n,r)=>n+scalar(r.bytes),0)!==sum)invalid();
  journalRows(rows,selected);selections.add(key);
 }
 async function previousColumnJournal(pairKey:string,sequenceNo:string):Promise<void>{
  if(typeof pairKey!=='string'||!SHA.test(pairKey)||typeof sequenceNo!=='string'
   ||!/^[1-9][0-9]{0,18}(?![\s\S])/u.test(sequenceNo)
   ||sequenceNo.length===19&&sequenceNo>'9223372036854775807')invalid();
  const key=pairKey+':'+sequenceNo;if(previousSelections.has(key))return;
  const rows=(await client.query<{id:string;bytes:unknown}>(`SELECT journal.id,
   octet_length(to_jsonb(journal)::text)::text AS bytes FROM matrix_column_pylon_section_v2_decisions journal
   WHERE journal.object_id=$1 AND journal.pair_key=$2 AND journal.sequence_no<$3::bigint
   ORDER BY journal.sequence_no DESC LIMIT 1`,[object,pairKey,sequenceNo])).rows;
  if(rows.length>1)invalid();journalRows(rows,previous);previousSelections.add(key);
 }
 async function sourceReview(sourceInternalId:string,decisionId:string):Promise<void>{
  const source=uuid(sourceInternalId),decision=uuid(decisionId),old=reviews.get(decision);
  if(old!==undefined){if(old!==source)invalid();return;}
  const rows=(await client.query<{id:string;bytes:unknown}>(`SELECT review.id,
   octet_length(to_jsonb(review)::text)::text AS bytes FROM source_review_decisions review
   JOIN source_files source ON source.id=review.source_file_id AND source.object_id=review.object_id
   WHERE review.object_id=$1 AND review.source_file_id=$2 AND review.id=$3`,[object,source,decision])).rows;
  if(rows.length!==1||uuid(rows[0]!.id)!==decision)invalid();charge(scalar(rows[0]!.bytes));reviews.set(decision,source);
 }
 return Object.freeze({
  runById:(id:string)=>serial(()=>runById(id)),runByCheck:(id:string)=>serial(()=>runByCheck(id)),
  steelAdmission:()=>serial(steelAdmission),
  columnJournalRows:(ids?:readonly string[])=>serial(()=>columnJournalRows(ids)),
  previousColumnJournal:(key:string,sequence:string)=>serial(()=>previousColumnJournal(key,sequence)),
  sourceReview:(source:string,decision:string)=>serial(()=>sourceReview(source,decision)),
 });
}
