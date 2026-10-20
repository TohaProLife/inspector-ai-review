/** Authenticated immutable-run snapshot storage. Caller owns org/actor/lease
 * scope and transaction. Historical IDs are never replaced by latest reviews. */
import type {PoolClient} from 'pg';
import {canonicalJson} from './canonical-json.js';
import {InventoryLoaderIntegrityError} from './matrix-inventory-loader.js';
import {validateColumnPylonSectionRunSnapshot} from './matrix-column-pylon-section-run-snapshot.js';
import {loadPinnedColumnPylonSectionJournalRows,prepareColumnPylonSectionJournalPins} from './postgres-column-pylon-section-run-journals.js';
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
function invalid():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_INTEGRITY');}
function limit():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_LIMIT');}
export async function loadColumnPylonSectionRunState(client:PoolClient,input:{runId:string;objectId:string;inputManifestHash:string},scaffold:unknown,budget?:MatrixPreparationBudgetV13){
 if(budget)await budget.runById(input.runId);
 const headers=(await client.query<{object_api_id:string;bytes:string;content_hash:string;input_manifest_hash:string}>(`SELECT object.api_id AS object_api_id,
  octet_length(state.snapshot_json::text)::text AS bytes,state.content_hash,manifest.sha256 AS input_manifest_hash
  FROM run_column_pylon_section_snapshot_states state JOIN analysis_runs run ON run.id=state.run_id AND run.object_id=state.object_id
  JOIN objects object ON object.id=run.object_id JOIN input_manifests manifest ON manifest.id=run.manifest_id
  WHERE state.run_id=$1 AND state.object_id=$2`,[input.runId,input.objectId])).rows;
 if(headers.length!==1)invalid();const header=headers[0]!,bytes=Number(header.bytes);
 if(!Number.isSafeInteger(bytes)||bytes<1)invalid();if(bytes>524288)limit();
 if(header.input_manifest_hash.trim()!==input.inputManifestHash)invalid();
 const states=(await client.query<{snapshot_json:unknown;content_hash:string;input_manifest_hash:string;object_api_id:string}>(
  `SELECT snapshot_json,content_hash,input_manifest_hash,object_api_id FROM run_column_pylon_section_snapshot_states WHERE run_id=$1 AND object_id=$2`,[input.runId,input.objectId])).rows;
 if(states.length!==1)invalid();const state=states[0]!,snapshot=validateColumnPylonSectionRunSnapshot(state.snapshot_json);
 if(snapshot.objectId!==input.objectId||snapshot.objectApiId!==header.object_api_id||snapshot.objectApiId!==state.object_api_id
  ||snapshot.inputManifestHash!==input.inputManifestHash||state.input_manifest_hash.trim()!==input.inputManifestHash
  ||snapshot.contentHash!==state.content_hash.trim()||snapshot.contentHash!==header.content_hash.trim())invalid();
 const counts=(await client.query<{entry_count:number}>(`SELECT count(*)::int AS entry_count FROM run_column_pylon_section_snapshot_entries WHERE run_id=$1 AND object_id=$2`,[input.runId,input.objectId])).rows;
 if(counts.length!==1||!Number.isSafeInteger(counts[0]!.entry_count)||counts[0]!.entry_count<0)invalid();
 if(counts[0]!.entry_count>16)limit();if(counts[0]!.entry_count!==snapshot.entries.length)invalid();
 const rows=(await client.query<{pair_key:string;decision_id:string;sequence_no:string;journal_content_hash:string;projection_content_hash:string;included:boolean;exclusion_reason:string|null}>(
  `SELECT pair_key,decision_id,sequence_no,journal_content_hash,projection_content_hash,included,exclusion_reason
   FROM run_column_pylon_section_snapshot_entries WHERE run_id=$1 AND object_id=$2 ORDER BY pair_key`,[input.runId,input.objectId])).rows;
 const entries=rows.map(row=>({pairKey:row.pair_key.trim(),decisionId:row.decision_id,sequenceNo:row.sequence_no,
  journalContentHash:row.journal_content_hash.trim(),projectionContentHash:row.projection_content_hash.trim(),included:row.included,exclusionReason:row.exclusion_reason}));
 if(canonicalJson(entries)!==canonicalJson(snapshot.entries))invalid();
 const selected=await loadPinnedColumnPylonSectionJournalRows(client,input.objectId,snapshot.entries.map(e=>e.decisionId),budget);
 const journals=await prepareColumnPylonSectionJournalPins(client,{objectId:input.objectId,objectApiId:snapshot.objectApiId,rows:selected},scaffold,budget);
 if(journals.length!==entries.length)invalid();
 for(let i=0;i<journals.length;i++){const pin=journals[i]!,entry=entries[i]!;
  if(pin.journal.id!==entry.decisionId||pin.pairKey!==entry.pairKey||pin.sequenceNo!==entry.sequenceNo
   ||pin.journal.contentHash!==entry.journalContentHash||pin.journal.projection.contentHash!==entry.projectionContentHash)invalid();}
 return{objectApiId:snapshot.objectApiId,snapshot,journals};
}
