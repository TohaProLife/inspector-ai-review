/** Adds full original-v2 steel provenance to an authenticated run preparation.
 * The repository owns pinned journal authority and PDF byte verification outside transactions. */
import type {PoolClient} from 'pg';
import type {SteelApplicabilityReviewDecision,SteelApplicabilityRunSnapshot,SteelComparisonSource,
 SteelComparisonOrigin} from '@inspector-ai/contracts';
import {canonicalJson,sha256} from './canonical-json.js';
import {InventoryLoaderIntegrityError,type AuthenticatedInventoryPreparation} from './matrix-inventory-loader.js';
import {steelComparisonExecutionInternal as internal} from './matrix-steel-comparison.js';
import {parseSteelComparisonScopeDecision} from './matrix-steel-review.js';
import {deriveSteelComparisonIdentities,validateSteelComparisonLoaderPackage} from './matrix-steel-execution.js';
import {validateSteelApplicabilityReviewDecision,steelApplicabilityPairKey} from './matrix-steel-applicability-review.js';
import {validateSteelApplicabilityRunSnapshot,validateSteelApplicabilitySnapshotProjectionLinks,
 steelApplicabilityProjectionMatchesSources} from './matrix-steel-run-snapshot.js';
import type {LoadSteelApplicabilityOrigin} from './postgres-steel-applicability-inputs.js';
import type {OriginalPdfReference} from './verified-pdf-io.js';
export interface VerifiedSteelJournalPin{
 decision:SteelApplicabilityReviewDecision;expectedSourceInternalId:string;actualSourceInternalId:string;
 references:readonly OriginalPdfReference[];fingerprint:string;
}
export type LoadSteelApplicabilityRunState=(client:PoolClient,input:{runId:string;objectId:string;inputManifestHash:string})=>Promise<{
 objectApiId:string;snapshot:SteelApplicabilityRunSnapshot;journals:VerifiedSteelJournalPin[];
}>;
function invalid():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_INTEGRITY');}
function limit():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_LIMIT');}
const admit=(raw:unknown):void=>{const result=internal.native(raw,8000000);if(result.status!=='VALID'){if(result.status==='LIMIT')limit();invalid();}};
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
interface RunScopeRow{source_internal_id:string;source_file_id:string;decision_id:string|null;decision_hash:string|null;steel_comparison_scope:unknown;}
export async function augmentSteelComparisonPreparation(client:PoolClient,base:AuthenticatedInventoryPreparation,
 loadOrigin:LoadSteelApplicabilityOrigin,loadPinnedState:LoadSteelApplicabilityRunState):Promise<AuthenticatedInventoryPreparation>{
 // Charge retained source JSON before PostgreSQL transfers it to the process.
 const budget=(await client.query<{source_count:number;steel_scope_bytes:string}>(`SELECT count(*)::int AS source_count,
   COALESCE(sum(octet_length(COALESCE(review.steel_comparison_scope::text,'null'))),0)::text AS steel_scope_bytes
   FROM analysis_runs run JOIN manifest_items item ON item.manifest_id=run.manifest_id
   JOIN source_files source ON source.id=item.source_file_id
   LEFT JOIN run_source_review_snapshots snapshot ON snapshot.run_id=run.id AND snapshot.source_file_id=source.id
   LEFT JOIN source_review_decisions review ON review.id=snapshot.decision_id WHERE run.id=$1`,[base.run.id])).rows;
 if(budget.length!==1)invalid();let bytes=Number(budget[0]!.steel_scope_bytes);
 if(!Number.isSafeInteger(bytes)||bytes<0||bytes>8000000||budget[0]!.source_count>64)limit();
 if(budget[0]!.source_count!==base.waterPackage.sources.length)invalid();
 const rows=(await client.query<RunScopeRow>(`SELECT source.id AS source_internal_id,source.api_id AS source_file_id,
   snapshot.decision_id,snapshot.decision_hash,review.steel_comparison_scope
   FROM analysis_runs run JOIN manifest_items item ON item.manifest_id=run.manifest_id
   JOIN source_files source ON source.id=item.source_file_id
   LEFT JOIN run_source_review_snapshots snapshot ON snapshot.run_id=run.id AND snapshot.source_file_id=source.id
   LEFT JOIN source_review_decisions review ON review.id=snapshot.decision_id WHERE run.id=$1 ORDER BY source.api_id`,[base.run.id])).rows;
 admit(rows);if(rows.length!==base.waterPackage.sources.length)invalid();
 const byId=new Map(rows.map(row=>[row.source_file_id,row]));if(byId.size!==rows.length)invalid();
 const sources:SteelComparisonSource[]=base.waterPackage.sources.map(source=>{
  const row=byId.get(source.sourceFileId);if(!row||!row.source_internal_id)invalid();
  const association={sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,objectId:base.run.objectId,
   stages:source.stages as SteelComparisonSource['stages']};
  if(!source.review){if(row.decision_id!==null||row.decision_hash!==null||row.steel_comparison_scope!==null||source.reviewSnapshot!==null)invalid();return {...association,review:null};}
  const r=source.review;if(row.decision_id!==r.decisionId||row.decision_hash?.trim()!==r.contentHash
   ||source.reviewSnapshot?.decisionId!==r.decisionId||source.reviewSnapshot.contentHash!==r.contentHash
   ||r.objectId!==base.run.objectId||r.sourceFileId!==source.sourceFileId||r.sourceSha256!==source.sourceSha256)invalid();
  return {...association,review:{decisionId:r.decisionId,contentHash:r.contentHash,revisionStatus:r.revisionStatus,
   approvalStatus:r.approvalStatus,sectionCode:r.sectionCode,linkGroupId:r.linkGroupId,pageStages:r.pageStages,
   steelComparisonScope:row.steel_comparison_scope===null?null:parseSteelComparisonScopeDecision(row.steel_comparison_scope,
    {sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256})}};
 });
 const origins:SteelComparisonOrigin[]=[],cache=new Map<string,Awaited<ReturnType<LoadSteelApplicabilityOrigin>>>();let claims=0;
 for(const source of sources)for(const claim of source.review?.steelComparisonScope?.claims??[]){
  if(++claims>128)limit();const key=canonicalJson([source.sourceFileId,claim.target.checkId]);let origin=cache.get(key);
  if(!cache.has(key)){
   if(cache.size>=128)limit();
   const sizes=(await client.query<{bytes:string}>(`SELECT GREATEST(text.byte_size,octet_length(text.content_json::text))::text AS bytes
     FROM analysis_runs run JOIN analysis_text_artifacts text ON text.run_id=run.id
     JOIN source_files source ON source.id=text.source_file_id
     WHERE run.object_id=$1 AND run.api_id=$2 AND source.api_id=$3`,[base.run.objectId,claim.target.checkId,source.sourceFileId])).rows;
   if(sizes.length!==1)invalid();const size=Number(sizes[0]!.bytes);if(!Number.isSafeInteger(size)||size<1)invalid();bytes+=size;if(bytes>8000000)limit();
   origin=await loadOrigin(client,base.run.objectId,claim.target.checkId,source.sourceFileId);if(!origin)invalid();admit(origin);cache.set(key,origin);
  }
  if(!origin||origin.source.sourceFileId!==source.sourceFileId||origin.source.sha256!==source.sourceSha256
   ||origin.inputManifestHash!==claim.target.inputManifestHash||origin.textStageContentHash!==claim.target.textStageContentHash
   ||origin.textArtifactHash!==claim.target.textArtifactHash)invalid();
  const {declarationId:_,...target}=claim.target;
  if(!origins.some(o=>o.sourceFileId===source.sourceFileId&&same(o.target,target)))origins.push({sourceFileId:source.sourceFileId,
   sourceSha256:source.sourceSha256,target,artifactContentSha256:origin.textStageContentHash,textArtifact:origin.textArtifact,
   stages:origin.source.stages as SteelComparisonOrigin['stages'],pageStages:origin.originalPageStages as SteelComparisonOrigin['pageStages']});
 }
 // Validate every retained run source claim before considering applicability inclusion.
 const scoped=validateSteelComparisonLoaderPackage({schemaVersion:'matrix-kr056-steel-loader-inputs-v1',objectId:base.run.objectId,
  inputManifestHash:base.run.inputManifestHash,sources,origins,identities:deriveSteelComparisonIdentities(sources),applicabilityDecisions:[]});
 const pinned=await loadPinnedState(client,{runId:base.run.id,objectId:base.run.objectId,inputManifestHash:base.run.inputManifestHash});admit(pinned);
 const snapshot=validateSteelApplicabilityRunSnapshot(pinned.snapshot);
 if(snapshot.objectId!==base.run.objectId||snapshot.inputManifestHash!==base.run.inputManifestHash||pinned.journals.length!==snapshot.entries.length)invalid();
 const seen=new Set<string>(),projections:typeof scoped.applicabilityDecisions=[],proofs:unknown[]=[];
 const references:OriginalPdfReference[]=[];const pdfKeys=new Set<string>();let pdfBytes=0;
 function addReference(ref:OriginalPdfReference){
  if(!ref||typeof ref.storageKey!=='string'||!ref.storageKey||!Number.isSafeInteger(ref.expectedByteSize)||ref.expectedByteSize<5
   ||ref.expectedMediaType!=='application/pdf'||!/^[a-f0-9]{64}(?![\s\S])/u.test(ref.expectedSha256))invalid();
  const key=canonicalJson(ref);if(pdfKeys.has(key))return;pdfKeys.add(key);pdfBytes+=ref.expectedByteSize;
  if(pdfKeys.size>64||pdfBytes>128*1024*1024)limit();references.push({...ref});
 }
 for(const ref of base.references)addReference(ref);
 for(const pin of pinned.journals){
  const d=validateSteelApplicabilityReviewDecision(pin.decision),entry=snapshot.entries.find(e=>e.decisionId===d.id);
  if(!entry||seen.has(d.id)||d.objectId!==pinned.objectApiId||d.projection.objectId!==base.run.objectId
   ||entry.journalContentHash!==d.contentHash||entry.projectionContentHash!==d.projection.contentHash
   ||!/^[a-f0-9]{64}(?![\s\S])/u.test(pin.fingerprint))invalid();seen.add(d.id);
  if(entry.pairKey!==steelApplicabilityPairKey({objectId:base.run.objectId,identity:d.projection.identity,
   expectedSourceFileId:d.projection.expected.sourceFileId,actualSourceFileId:d.projection.actual.sourceFileId}))invalid();
  const expectedRow=byId.get(d.projection.expected.sourceFileId),actualRow=byId.get(d.projection.actual.sourceFileId);
  if(expectedRow&&expectedRow.source_internal_id!==pin.expectedSourceInternalId||actualRow&&actualRow.source_internal_id!==pin.actualSourceInternalId)invalid();
  const included=steelApplicabilityProjectionMatchesSources(d.projection,scoped.sources);if(included!==entry.included)invalid();
  if(included)projections.push(d.projection);
  for(const ref of pin.references)addReference(ref);proofs.push({decision:d,fingerprint:pin.fingerprint});
 }
 const steelPackage=validateSteelComparisonLoaderPackage({...scoped,applicabilityDecisions:projections});
 validateSteelApplicabilitySnapshotProjectionLinks(snapshot,steelPackage);
 return Object.freeze({...base,steelPackage,steelApplicabilitySnapshot:snapshot,references,
  fingerprint:sha256(canonicalJson({base:base.fingerprint,steelPackage,snapshot,proofs,references}))});
}
