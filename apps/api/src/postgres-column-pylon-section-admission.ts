/** V12 admission. Complete retained journal provenance is checked before any
 * inclusion decision. PDF verification and the enclosing run transaction are
 * deliberately caller-owned. */
import type {PoolClient} from 'pg';
import type {AuthenticatedActor} from './identity.js';
import type {ColumnPylonSectionV2Source} from '@inspector-ai/contracts';
import {InventoryLoaderIntegrityError} from './matrix-inventory-loader.js';
import {canonicalJson,sha256} from './canonical-json.js';
import {canonicalMatrixReviewedLoaderV7} from './matrix-reviewed-loader-v7-native.js';
import {loadLatestColumnPylonSectionJournalRows,prepareColumnPylonSectionJournalPins} from './postgres-column-pylon-section-run-journals.js';
import {calculateColumnPylonSectionSnapshotInclusion} from './matrix-column-pylon-section-execution.js';
import {buildColumnPylonSectionRunSnapshot} from './matrix-column-pylon-section-run-snapshot.js';
function invalid():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_INTEGRITY');}
function limit():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_LIMIT');}
interface Context{organizationId:string;objectApiId:string;actor?:AuthenticatedActor;lock?:boolean;}
export async function prepareColumnPylonSectionAdmission(client:PoolClient,input:Context,scaffold:unknown){
 const actor=input.actor;if(!actor||actor.organizationId!==input.organizationId)invalid();
 const access=(await client.query<{object_id:string}>(`SELECT object.id AS object_id FROM objects object
  JOIN object_memberships access ON access.object_id=object.id AND access.user_id=$3
  JOIN inspector_users account ON account.id=access.user_id AND account.enabled=true
  JOIN user_sessions session ON session.id=$4 AND session.user_id=account.id AND session.auth_version=account.auth_version
   AND session.revoked_at IS NULL AND session.expires_at>now()
  WHERE object.organization_id=$1 AND object.api_id=$2 AND access.revoked_at IS NULL
   AND access.permission_set @> ARRAY['READ','RUN']::text[]
   AND EXISTS(SELECT 1 FROM inspections inspection WHERE inspection.object_id=object.id AND inspection.lifecycle='OPEN')
   AND EXISTS(SELECT 1 FROM organization_memberships membership WHERE membership.organization_id=object.organization_id
    AND membership.user_id=account.id AND membership.revoked_at IS NULL
    AND (membership.role IN ('INSPECTOR','SUPERVISOR') OR membership.capabilities @> ARRAY['RUN_START']::text[]))
  ${input.lock?'FOR SHARE OF access,account,session':''}`,[input.organizationId,input.objectApiId,actor.userId,actor.sessionId])).rows;
 if(access.length!==1)invalid();const objectId=access[0]!.object_id;
 const budget=(await client.query<{source_count:number;review_bytes:string}>(`SELECT count(*)::int AS source_count,
  COALESCE(sum(octet_length(COALESCE(review.page_stages::text,'null'))),0)::text AS review_bytes
  FROM source_files source LEFT JOIN LATERAL(SELECT page_stages FROM source_review_decisions
   WHERE source_file_id=source.id ORDER BY created_at DESC,id DESC LIMIT 1)review ON true WHERE source.object_id=$1`,[objectId])).rows;
 if(budget.length!==1)invalid();const bytes=Number(budget[0]!.review_bytes);
 if(!Number.isSafeInteger(bytes)||bytes<0)invalid();if(budget[0]!.source_count>64||bytes>8*1024*1024)limit();
 const rows=(await client.query<{source_file_id:string;source_sha256:string;stages:ColumnPylonSectionV2Source['stages'];
  decision_id:string|null;content_hash:string|null;revision_status:any;approval_status:any;section_code:any;link_group_id:string|null;page_stages:Record<string,any>|null}>(
  `SELECT source.api_id AS source_file_id,blob.sha256 AS source_sha256,
   ARRAY(SELECT stage.stage FROM source_file_stages stage WHERE stage.source_file_id=source.id ORDER BY stage.stage) AS stages,
   review.id AS decision_id,review.content_hash,review.revision_status,review.approval_status,review.section_code,review.link_group_id,review.page_stages
   FROM source_files source JOIN blobs blob ON blob.id=source.blob_id
   LEFT JOIN LATERAL(SELECT id,content_hash,revision_status,approval_status,section_code,link_group_id,page_stages
    FROM source_review_decisions WHERE source_file_id=source.id ORDER BY created_at DESC,id DESC LIMIT 1)review ON true
   WHERE source.object_id=$1 ORDER BY source.api_id COLLATE "C"`,[objectId])).rows;
 if(rows.length!==budget[0]!.source_count)invalid();
 const sources:ColumnPylonSectionV2Source[]=rows.map(row=>({sourceFileId:row.source_file_id,sourceSha256:row.source_sha256.trim(),stages:row.stages,
  review:row.decision_id===null?null:{decisionId:row.decision_id,contentHash:row.content_hash?.trim()??'',revisionStatus:row.revision_status,
   approvalStatus:row.approval_status,sectionCode:row.section_code,linkGroupId:row.link_group_id,pageStages:row.page_stages??{}}}));
 const journals=await prepareColumnPylonSectionJournalPins(client,{objectId,objectApiId:input.objectApiId,
  rows:await loadLatestColumnPylonSectionJournalRows(client,objectId)},scaffold);
 const included=calculateColumnPylonSectionSnapshotInclusion({currentSources:sources,journals:journals.map(pin=>pin.journal)});
 const entries=journals.map((pin,i)=>({...included[i]!,sequenceNo:pin.sequenceNo,journalContentHash:pin.journal.contentHash,
  projectionContentHash:pin.journal.projection.contentHash}));
 const references=journals.flatMap(pin=>pin.references);
 const fingerprint=sha256(canonicalMatrixReviewedLoaderV7({objectId,objectApiId:input.objectApiId,sources,entries,
  proofs:journals.map(pin=>pin.fingerprint),references}));
 return{objectId,sources,entries,references,fingerprint};
}
export async function persistColumnPylonSectionRunSnapshot(client:PoolClient,input:Context&{runId:string;objectId:string;inputManifestHash:string;
 before:Awaited<ReturnType<typeof prepareColumnPylonSectionAdmission>>},scaffold:unknown){
 const fresh=await prepareColumnPylonSectionAdmission(client,{...input,lock:true},scaffold);
 if(fresh.objectId!==input.objectId||fresh.fingerprint!==input.before.fingerprint)
  throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_CHANGED');
 // Match the actual immutable run pointers, never a fresh latest-review guess.
 const saved=(await client.query<{source_file_id:string;source_sha256:string;decision_id:string|null;decision_hash:string|null}>(
  `SELECT source.api_id AS source_file_id,item.blob_sha256 AS source_sha256,snapshot.decision_id,snapshot.decision_hash
   FROM analysis_runs run JOIN manifest_items item ON item.manifest_id=run.manifest_id
   JOIN source_files source ON source.id=item.source_file_id AND source.object_id=run.object_id
   LEFT JOIN run_source_review_snapshots snapshot ON snapshot.run_id=run.id AND snapshot.source_file_id=source.id
   WHERE run.id=$1 AND run.object_id=$2 ORDER BY source.api_id COLLATE "C"`,[input.runId,input.objectId])).rows;
 const common=(sources:typeof fresh.sources)=>sources.map(s=>({source_file_id:s.sourceFileId,source_sha256:s.sourceSha256,
  decision_id:s.review?.decisionId??null,decision_hash:s.review?.contentHash??null}));
 if(canonicalJson(saved.map(row=>({...row,source_sha256:row.source_sha256.trim(),decision_hash:row.decision_hash?.trim()??null})))!==canonicalJson(common(fresh.sources)))invalid();
 const snapshot=buildColumnPylonSectionRunSnapshot({objectId:input.objectId,objectApiId:input.objectApiId,inputManifestHash:input.inputManifestHash,entries:fresh.entries});
 await client.query(`INSERT INTO run_column_pylon_section_snapshot_states(run_id,object_id,object_api_id,input_manifest_hash,content_hash,snapshot_json)
  VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[input.runId,input.objectId,input.objectApiId,input.inputManifestHash,snapshot.contentHash,canonicalJson(snapshot)]);
 for(const entry of snapshot.entries)await client.query(`INSERT INTO run_column_pylon_section_snapshot_entries
  (run_id,object_id,pair_key,decision_id,sequence_no,journal_content_hash,projection_content_hash,included,exclusion_reason)
  VALUES($1,$2,$3,$4,$5::bigint,$6,$7,$8,$9)`,[input.runId,input.objectId,entry.pairKey,entry.decisionId,entry.sequenceNo,
  entry.journalContentHash,entry.projectionContentHash,entry.included,entry.exclusionReason]);
 return snapshot;
}
