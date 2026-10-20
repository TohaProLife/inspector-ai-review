/** Additional full-v3 origin projection; never coerces v3 into the old four v2 packages. */
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
import type {PoolClient} from 'pg';
import type {LightingTechnologyExecutionLoaderPackage} from '@inspector-ai/contracts';
import {canonicalJson,sha256} from './canonical-json.js';
import {InventoryLoaderIntegrityError,type AuthenticatedInventoryPreparation} from './matrix-inventory-loader.js';
import {parseLightingTechnologyScopeDecision} from './matrix-lighting-technology-review.js';
import {deriveLightingTechnologyIdentities,validateLightingTechnologyLoaderPackage} from './matrix-lighting-technology-execution.js';
import {loadDocumentTextV3AuditSource} from './postgres-document-text-v3-source.js';
function invalid():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_INTEGRITY');}
function limit():never{throw new InventoryLoaderIntegrityError('INVENTORY_INPUT_LIMIT');}
export async function augmentLightingTechnologyPreparation(client:PoolClient,base:AuthenticatedInventoryPreparation,scaffold:unknown,budget?:MatrixPreparationBudgetV13):Promise<AuthenticatedInventoryPreparation>{
 if(budget!==undefined)await budget.runById(base.run.id);
 const rows=(await client.query<{source_file_id:string;decision_id:string|null;decision_hash:string|null;lighting_technology_scope:unknown}>(
  `SELECT source.api_id AS source_file_id,snapshot.decision_id,snapshot.decision_hash,review.lighting_technology_scope
   FROM analysis_runs run JOIN manifest_items item ON item.manifest_id=run.manifest_id
   JOIN source_files source ON source.id=item.source_file_id
   LEFT JOIN run_source_review_snapshots snapshot ON snapshot.run_id=run.id AND snapshot.source_file_id=source.id
   LEFT JOIN source_review_decisions review ON review.id=snapshot.decision_id WHERE run.id=$1 ORDER BY source.api_id`,[base.run.id])).rows;
 if(rows.length!==base.waterPackage.sources.length)invalid();
 const byId=new Map(rows.map(r=>[r.source_file_id,r]));if(byId.size!==rows.length)invalid();
 const sources:LightingTechnologyExecutionLoaderPackage['sources']=base.waterPackage.sources.map(source=>{
  const row=byId.get(source.sourceFileId);if(!row)invalid();
  const association={sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,stages:source.stages,reviewSnapshot:source.reviewSnapshot};
  if(!source.review){if(row.decision_id!==null||row.decision_hash!==null||row.lighting_technology_scope!==null)invalid();return {...association,review:null};}
  if(row.decision_id!==source.review.decisionId||row.decision_hash?.trim()!==source.review.contentHash)invalid();
  const r=source.review;
  const common={decisionId:r.decisionId,contentHash:r.contentHash,objectId:r.objectId,sourceFileId:r.sourceFileId,sourceSha256:r.sourceSha256,actorId:r.actorId,revisionStatus:r.revisionStatus,approvalStatus:r.approvalStatus,linkGroupId:r.linkGroupId,sectionCode:r.sectionCode,pageStages:r.pageStages};
  return {...association,review:{...common,lightingTechnologyScope:row.lighting_technology_scope===null?null:parseLightingTechnologyScopeDecision(row.lighting_technology_scope,{sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256})}};
 });
 const origins:LightingTechnologyExecutionLoaderPackage['origins']=[],proofs:unknown[]=[],seen=new Set<string>();
 let bytes=Buffer.byteLength(canonicalJson(sources)),claims=0;if(bytes>8*1024*1024)limit();
 for(const source of sources)for(const claim of source.review?.lightingTechnologyScope?.claims??[]){
  if(++claims>128)limit();
  const key=canonicalJson([claim.target.checkId,source.sourceFileId]);if(seen.has(key))continue;seen.add(key);if(seen.size>128)limit();
  // Charge the selected full artifact before transferring JSON out of PostgreSQL.
  const sizes=(await client.query<{bytes:string}>(`SELECT GREATEST(text.byte_size,octet_length(text.content_json::text))::text AS bytes
    FROM analysis_runs run JOIN analysis_text_artifacts text ON text.run_id=run.id
    JOIN source_files source ON source.id=text.source_file_id
    WHERE run.object_id=$1 AND run.api_id=$2 AND source.api_id=$3 AND text.schema_version='document-text-v3'`,[base.run.objectId,claim.target.checkId,source.sourceFileId])).rows;
  if(sizes.length!==1)invalid();const size=Number(sizes[0]!.bytes);if(!Number.isSafeInteger(size)||size<1)invalid();bytes+=size;if(bytes>8*1024*1024)limit();
  const read=budget===undefined
   ?await loadDocumentTextV3AuditSource(client,base.run.objectId,claim.target.checkId,source.sourceFileId,scaffold)
   :await loadDocumentTextV3AuditSource(client,base.run.objectId,claim.target.checkId,source.sourceFileId,scaffold,budget);
  if(!read||read.sourceSha256!==source.sourceSha256||read.inputManifestHash!==claim.target.inputManifestHash
   ||read.textStageContentHash!==claim.target.textStageContentHash||read.textArtifactContentHash!==claim.target.textArtifactHash)invalid();
  origins.push({checkId:read.checkId,objectId:base.package.objectId,sourceFileId:read.sourceFileId,sourceSha256:read.sourceSha256,
   inputManifestHash:read.inputManifestHash,textStageContentHash:read.textStageContentHash,textArtifactHash:read.textArtifactContentHash,textArtifact:read.textArtifact});
  proofs.push({checkId:read.checkId,sourceFileId:read.sourceFileId,artifactHash:read.textArtifactContentHash,stageHash:read.textStageContentHash,extractorProfileHash:read.extractorProfileHash});
 }
 const lightingPackage=validateLightingTechnologyLoaderPackage({schemaVersion:'matrix-zu130-lighting-technology-loader-inputs-v1',objectId:base.package.objectId,
  inputManifestHash:base.package.inputManifestHash,sources,origins,identities:deriveLightingTechnologyIdentities(sources)});
 return Object.freeze({...base,lightingPackage,fingerprint:sha256(canonicalJson({base:base.fingerprint,lightingPackage,proofs}))});
}
