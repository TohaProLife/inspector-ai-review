/** Protected composition only. Journal/parent authentication belongs to the
 * repository; original PDF bytes are verified outside database transactions. */
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
import type {PoolClient} from 'pg';
import type {ColumnPylonSectionV2Source,ColumnPylonSectionV2Origin,ColumnPylonSectionRunSnapshot} from '@inspector-ai/contracts';
import type {VerifiedColumnPylonSectionJournalPin} from './postgres-column-pylon-section-run-journals.js';
import {canonicalJson,sha256} from './canonical-json.js';
import {InventoryLoaderIntegrityError,type AuthenticatedInventoryPreparation} from './matrix-inventory-loader.js';
import {validateColumnPylonSectionLoaderPackage} from './matrix-column-pylon-section-execution.js';
import {validateColumnPylonSectionRunSnapshot} from './matrix-column-pylon-section-run-snapshot.js';
import {canonicalMatrixReviewedLoaderV7} from './matrix-reviewed-loader-v7-native.js';
import type {OriginalPdfReference} from './verified-pdf-io.js';
export type LoadColumnPylonSectionRunState=(client:PoolClient,input:{runId:string;objectId:string;inputManifestHash:string},budget?:MatrixPreparationBudgetV13)=>Promise<{
 objectApiId:string;snapshot:ColumnPylonSectionRunSnapshot;journals:VerifiedColumnPylonSectionJournalPin[];
}>;
function invalid():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_INTEGRITY');}
function limit():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_LIMIT');}
const same=(a:unknown,b:unknown)=>canonicalMatrixReviewedLoaderV7(a)===canonicalMatrixReviewedLoaderV7(b);
const fields=['decisionId','contentHash','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages']as const;
function cp(a:string,b:string):number{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const delta=x[i]!.codePointAt(0)!-y[i]!.codePointAt(0)!;if(delta)return delta;}return x.length-y.length;}
/** Exact common source metadata; full parent review was authenticated upstream. */
export function columnPylonSectionCurrentSources(sources:AuthenticatedInventoryPreparation['waterPackage']['sources']):ColumnPylonSectionV2Source[]{
 return sources.map(source=>({sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,
  stages:source.stages as ColumnPylonSectionV2Source['stages'],review:source.review
   ?Object.fromEntries(fields.map(key=>[key,source.review![key]]))as ColumnPylonSectionV2Source['review']:null,
 })).sort((a,b)=>cp(a.sourceFileId,b.sourceFileId));
}
export async function augmentColumnPylonSectionPreparation(client:PoolClient,base:AuthenticatedInventoryPreparation,
 loadPinnedState:LoadColumnPylonSectionRunState,budget?:MatrixPreparationBudgetV13):Promise<AuthenticatedInventoryPreparation>{
 if(budget!==undefined)await budget.runById(base.run.id);
 const pinned=budget===undefined
  ?await loadPinnedState(client,{runId:base.run.id,objectId:base.run.objectId,inputManifestHash:base.run.inputManifestHash})
  :await loadPinnedState(client,{runId:base.run.id,objectId:base.run.objectId,inputManifestHash:base.run.inputManifestHash},budget);
 const snapshot=validateColumnPylonSectionRunSnapshot(pinned.snapshot);
 if(snapshot.objectId!==base.run.objectId||snapshot.objectApiId!==pinned.objectApiId
  ||snapshot.inputManifestHash!==base.run.inputManifestHash||pinned.journals.length!==snapshot.entries.length)invalid();
 const origins=new Map<string,ColumnPylonSectionV2Origin>(),seen=new Set<string>();
 const references:OriginalPdfReference[]=[],pdfKeys=new Set<string>();let pdfBytes=0;
 const add=(reference:OriginalPdfReference)=>{
  if(typeof reference.storageKey!=='string'||!reference.storageKey||reference.storageKey.length>4096
   ||!/^[a-f0-9]{64}(?![\s\S])/u.test(reference.expectedSha256)||reference.expectedMediaType!=='application/pdf'
   ||!Number.isSafeInteger(reference.expectedByteSize)||reference.expectedByteSize<5)invalid();
  const key=canonicalJson(reference);if(pdfKeys.has(key))return;
  if(reference.expectedByteSize>64*1024*1024||pdfKeys.size>=64||pdfBytes+reference.expectedByteSize>128*1024*1024)limit();
  pdfKeys.add(key);pdfBytes+=reference.expectedByteSize;references.push({...reference});
 };
 for(const reference of base.references)add(reference);
 const proofs:unknown[]=[],reviews=[];
 for(let i=0;i<pinned.journals.length;i++){
  const pin=pinned.journals[i]!,entry=snapshot.entries[i];
  if(!entry||pin.pairKey!==entry.pairKey||pin.sequenceNo!==entry.sequenceNo||pin.journal.id!==entry.decisionId
   ||pin.journal.contentHash!==entry.journalContentHash||pin.journal.projection.contentHash!==entry.projectionContentHash
   ||pin.journal.objectId!==pinned.objectApiId||seen.has(pin.journal.id)||!/^[a-f0-9]{64}(?![\s\S])/u.test(pin.fingerprint))invalid();
  seen.add(pin.journal.id);
  for(const origin of pin.origins){const key=canonicalMatrixReviewedLoaderV7([origin.sourceFileId,origin.target]),old=origins.get(key);
   if(old&&!same(old,origin))invalid();if(!old)origins.set(key,origin);}
  reviews.push({journal:pin.journal,historicalSources:pin.historicalSources});
  proofs.push({pairKey:pin.pairKey,sequenceNo:pin.sequenceNo,fingerprint:pin.fingerprint});
  for(const reference of pin.references)add(reference);
 }
 const columnPylonSectionPackage=validateColumnPylonSectionLoaderPackage({schemaVersion:'matrix-kr060-column-pylon-loader-inputs-v1',
  objectId:pinned.objectApiId,inputManifestHash:base.run.inputManifestHash,sources:columnPylonSectionCurrentSources(base.waterPackage.sources),
  origins:[...origins].sort(([a],[b])=>cp(a,b)).map(([,origin])=>origin),reviews},snapshot);
 return Object.freeze({...base,columnPylonSectionPackage,columnPylonSectionSnapshot:snapshot,references,
  fingerprint:sha256(canonicalMatrixReviewedLoaderV7({base:base.fingerprint,columnPylonSectionPackage,snapshot,proofs,references}))});
}
