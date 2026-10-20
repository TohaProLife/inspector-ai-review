import {parseSteelComparisonScopeDecision} from "./matrix-steel-review.js";
import {parseWaterNodeScopeDecision} from './matrix-water-node-review.js';
import {deriveWaterNodeIdentities,validateWaterNodeLoaderPackage,waterNodeComparisonEvidence as buildWaterNodeEvidence,type WaterNodeInventoryLoaderPackage} from './matrix-water-node-execution.js';
import {parseRailInventoryScopeDecision} from './matrix-rail-inventory-review.js';
import {deriveRailInventoryIdentities,validateRailInventoryLoaderPackage,type RailInventoryLoaderPackage} from './matrix-rail-inventory-execution.js';
import {parseCallInventoryScopeDecision} from './matrix-call-inventory-review.js';
import {deriveCallInventoryIdentities,validateCallInventoryLoaderPackage,type CallInventoryLoaderPackage} from './matrix-call-inventory-execution.js';
/** Protected repository projection. No HTTP caller can provide reviews, snapshots or origins. */
import type { PoolClient } from "pg";
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
import { canonicalJson, sha256 } from "./canonical-json.js";
import { canonicalSourceDeclarationJson } from "./matrix-source-declarations.js";
import { parseInventoryScopeDecision } from "./matrix-inventory-review.js";
import { deriveInventoryIdentities, validateInventoryLoaderPackage,
  type InventoryLoaderPackage } from "./matrix-inventory-execution.js";
import { verifyOriginalPdfSet, withPdfIoBudget, type OriginalPdfReference,
  type VerifiedOriginalPdfReceipt } from "./verified-pdf-io.js";
import type { ObjectStorage } from "./storage.js";
import {matrixStoredReadPolicyForReleaseV13} from "./matrix-concrete-wall-profile-v13.js";

export class InventoryLoaderIntegrityError extends Error {
  constructor(readonly code: "INVENTORY_INPUT_INTEGRITY" | "INVENTORY_INPUT_LIMIT" | "INVENTORY_INPUT_CHANGED") {
    super(code); this.name = "InventoryLoaderIntegrityError";
  }
}
function invalid(): never { throw new InventoryLoaderIntegrityError("INVENTORY_INPUT_INTEGRITY"); }
function limit(): never { throw new InventoryLoaderIntegrityError("INVENTORY_INPUT_LIMIT"); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: string): string => /^[a-f0-9]{64}(?![\s\S])/u.test(value) ? value : invalid();
const savedJson = (value: unknown): Record<string, unknown> => {
  const decoded: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return record(decoded) ? decoded : invalid();
};
function authenticatedJson(value: unknown, contentHash: string, byteSize: number | string): Record<string, unknown> {
  const parsed = savedJson(value), canonical = canonicalJson(parsed);
  if (Buffer.byteLength(canonical) > 8 * 1024 * 1024) limit();
  if (sha256(canonical) !== hash(contentHash.trim()) || Buffer.byteLength(canonical) !== Number(byteSize)) invalid();
  return parsed;
}
/** Authenticated by the unchanged repository helper, not by worker-provided metadata. */
export interface InventoryBaseInputs {
  inputManifestHash: string;
  sourceFiles: Array<{sourceFileId:string;objectId:string;sha256:string;byteSize:number;pageCount:number;
    mediaType:string;stages:string[];sectionCode:string|null}>;
  textArtifacts:Array<{sourceFileId:string;contentSha256:string;artifact:Record<string,unknown>}>;
  pdfStorageRefs:Record<string,{storageKey:string;sha256:string;byteSize:number}>;
}
export type AuthenticateInventoryBase = (client: PoolClient, runId: string, objectId: string) => Promise<InventoryBaseInputs | null>;
export interface AuthenticatedInventoryPreparation {
  readonly package: InventoryLoaderPackage;
  readonly callPackage: CallInventoryLoaderPackage;
  readonly railPackage: RailInventoryLoaderPackage;
  readonly waterPackage: WaterNodeInventoryLoaderPackage;
  readonly lightingPackage?: import("@inspector-ai/contracts").LightingTechnologyExecutionLoaderPackage;
  readonly steelPackage?: import("@inspector-ai/contracts").SteelComparisonExecutionLoaderPackage;
  readonly steelApplicabilitySnapshot?: import("@inspector-ai/contracts").SteelApplicabilityRunSnapshot;
  readonly columnPylonSectionPackage?: import("@inspector-ai/contracts").ColumnPylonSectionLoaderPackage;
  readonly columnPylonSectionSnapshot?: import("@inspector-ai/contracts").ColumnPylonSectionRunSnapshot;
  readonly fingerprint: string;
  readonly references: readonly OriginalPdfReference[];
  readonly release: Record<string, unknown>;
  readonly run: { id: string; checkId: string; objectId: string; inspectionId: string;
    releaseId: string; inputManifestHash: string };
}
interface RunRow {
  id:string;api_id:string;object_id:string;inspection_id:string;release_id:string;manifest_id:string;
  run_state:string;sealed_at:Date|string|null;output_hash:string|null;
  organization_id:string;object_api_id:string;manifest_hash:string;manifest_json:unknown;
  release_hash:string;release_size:string|number;release_json:unknown;
}
interface ReviewRow {
  source_internal_id:string;source_file_id:string;source_sha256:string;
  snapshot_decision_id:string|null;snapshot_hash:string|null;review_id:string|null;
  review_object_id:string|null;review_source_internal_id:string|null;review_source_sha256:string|null;
  revision_status:"CURRENT"|"SUPERSEDED"|"UNKNOWN"|null;
  approval_status:"APPROVED"|"UNAPPROVED"|"UNKNOWN"|null;
  link_group_id:string|null;section_code:string|null;
  page_stages:Record<string,"PD"|"RD"|"ID"|"UNRESOLVED">|null;
  basis_reference:string|null;actor_id:string|null;content_hash:string|null;
  matrix_scope:unknown|null;inventory_scope:unknown|null;call_inventory_scope:unknown|null;rail_inventory_scope:unknown|null;water_node_scope:unknown|null;lighting_technology_scope:unknown|null;steel_comparison_scope:unknown|null;
}
async function runIdentity(client:PoolClient, runId:string, objectId:string, organizationId:string):Promise<{row:RunRow;release:Record<string,unknown>;manifest:Record<string,unknown>}> {
  const selected=await client.query<RunRow>(`SELECT run.id,run.api_id,run.object_id,run.inspection_id,
    run.release_id,run.manifest_id,run.run_state,run.sealed_at,run.output_hash,object.organization_id,
    object.api_id AS object_api_id,manifest.sha256 AS manifest_hash,manifest.canonical_json AS manifest_json,
    release.content_hash AS release_hash,release.byte_size AS release_size,release.content_json AS release_json
    FROM analysis_runs run JOIN objects object ON object.id=run.object_id
    JOIN input_manifests manifest ON manifest.id=run.manifest_id AND manifest.inspection_id=run.inspection_id
    JOIN analysis_releases release ON release.release_id=run.release_id
    WHERE run.id=$1 AND run.object_id=$2 AND object.organization_id=$3`,[runId,objectId,organizationId]);
  if(selected.rows.length!==1)invalid(); const row=selected.rows[0]!;
  const release=authenticatedJson(row.release_json,row.release_hash,row.release_size);
  const manifest=savedJson(row.manifest_json);
  if(release.releaseId!==row.release_id||sha256(canonicalJson(manifest))!==hash(row.manifest_hash.trim()))invalid();
  return {row,release,manifest};
}
async function authenticatedStages(client:PoolClient,runId:string, releaseId:string, manifestHash:string) {
  const stages=await client.query<{id:string;job_id:string;job_type:string;content_json:unknown;
    content_hash:string;byte_size:number|string;input_manifest_hash:string;job_release_id:string;state:string}>(
    `SELECT stage.id,stage.job_id,stage.job_type,stage.content_json,stage.content_hash,stage.byte_size,
      stage.input_manifest_hash,job.release_id AS job_release_id,job.state
      FROM analysis_stage_artifacts stage JOIN analysis_jobs job ON job.id=stage.job_id AND job.run_id=stage.run_id
      WHERE stage.run_id=$1 ORDER BY stage.job_type,stage.id`,[runId]);
  const seen=new Set<string>();
  const identities=stages.rows.map(row=>{
    if(seen.has(row.job_type)||row.state!=="SUCCEEDED"||row.job_release_id!==releaseId||row.input_manifest_hash.trim()!==manifestHash)invalid();
    seen.add(row.job_type); authenticatedJson(row.content_json,row.content_hash,row.byte_size);
    return {id:row.id,jobId:row.job_id,jobType:row.job_type,contentHash:row.content_hash.trim(),byteSize:Number(row.byte_size)};
  });
  const dependencies=await client.query<{job_id:string;prerequisite_job_id:string;run_id:string}>(
    `SELECT job_id,prerequisite_job_id,run_id FROM analysis_job_dependencies WHERE run_id=$1 ORDER BY job_id,prerequisite_job_id`,[runId]);
  return {identities,dependencies:dependencies.rows};
}
/** A: caller supplies a bounded READ ONLY REPEATABLE READ client. No storage access here. */
export async function loadAuthenticatedInventoryPreparation(client:PoolClient, input:{runId:string;objectId:string;organizationId:string;
  requireSealed?:boolean}, authenticateBase:AuthenticateInventoryBase, sharedBudget?:MatrixPreparationBudgetV13):Promise<AuthenticatedInventoryPreparation> {
  // Bound full JSON transfer BEFORE materializing text/review arrays. One aggregate
  // budget covers consumer plus every distinct origin; stop rather than truncate.
  let projectedBytes=0;const chargedRuns=new Set<string>();
  async function chargeRun(runId:string){if(chargedRuns.has(runId))return;chargedRuns.add(runId);
    const counts=await client.query<{text_bytes:string;review_bytes:string;source_count:number;text_count:number}>(
      `SELECT (SELECT COALESCE(sum(GREATEST(byte_size,octet_length(content_json::text))),0)::text
         FROM analysis_text_artifacts WHERE run_id=$1) AS text_bytes,
       (SELECT COALESCE(sum(octet_length(to_jsonb(review)::text)),0)::text FROM run_source_review_snapshots snapshot
         JOIN source_review_decisions review ON review.id=snapshot.decision_id WHERE snapshot.run_id=$1) AS review_bytes,
       (SELECT count(*)::int FROM manifest_items item JOIN analysis_runs run ON run.manifest_id=item.manifest_id WHERE run.id=$1) AS source_count,
       (SELECT count(*)::int FROM analysis_text_artifacts WHERE run_id=$1) AS text_count`,[runId]);
    const row=counts.rows[0];if(!row||row.source_count>64||row.text_count>64)limit();
    const bytes=Number(row.text_bytes)+Number(row.review_bytes);if(!Number.isSafeInteger(bytes)||bytes<0)invalid();
    projectedBytes+=bytes;if(projectedBytes>64*1024*1024)limit();
  }
  if(sharedBudget)await sharedBudget.runById(input.runId);
  await chargeRun(input.runId);
  const scope=await runIdentity(client,input.runId,input.objectId,input.organizationId);
  if(input.requireSealed&&(!scope.row.sealed_at||!["PARTIAL","SUCCEEDED"].includes(scope.row.run_state)))invalid();
  const base=await authenticateBase(client,input.runId,input.objectId);
  if(!base||base.inputManifestHash!==scope.row.manifest_hash.trim()||base.sourceFiles.length<1||base.sourceFiles.length>64)invalid();
  const rows=await client.query<ReviewRow>(`SELECT source.id AS source_internal_id,source.api_id AS source_file_id,
    item.blob_sha256 AS source_sha256,snapshot.decision_id AS snapshot_decision_id,snapshot.decision_hash AS snapshot_hash,
    review.id AS review_id,review.object_id AS review_object_id,review.source_file_id AS review_source_internal_id,
    review.source_sha256 AS review_source_sha256,review.revision_status,review.approval_status,review.link_group_id,
    review.section_code,review.page_stages,review.basis_reference,review.actor_id,review.content_hash,
    review.matrix_scope,review.inventory_scope,review.call_inventory_scope,review.rail_inventory_scope,review.water_node_scope,review.lighting_technology_scope,review.steel_comparison_scope FROM analysis_runs run
    JOIN manifest_items item ON item.manifest_id=run.manifest_id JOIN source_files source ON source.id=item.source_file_id
    LEFT JOIN run_source_review_snapshots snapshot ON snapshot.run_id=run.id AND snapshot.source_file_id=source.id
    LEFT JOIN source_review_decisions review ON review.id=snapshot.decision_id
    WHERE run.id=$1 ORDER BY source.api_id`,[input.runId]);
  if(rows.rows.length!==base.sourceFiles.length)invalid();
  const sources:InventoryLoaderPackage["sources"]=[], callSources:CallInventoryLoaderPackage["sources"]=[], railSources:RailInventoryLoaderPackage["sources"]=[],waterSources:WaterNodeInventoryLoaderPackage["sources"]=[], origins:InventoryLoaderPackage["origins"]=[];
  const references=new Map<string,OriginalPdfReference>(), reviewBodies:unknown[]=[], originProofs:unknown[]=[];
  const sourceMap=new Map(base.sourceFiles.map(source=>[source.sourceFileId,source]));
  const seen=new Set<string>(),originKeys=new Set<string>(); let claims=0;
  function addReference(reference:{storageKey:string;sha256:string;byteSize:number}) {
    const key=canonicalJson([reference.storageKey,reference.sha256,reference.byteSize]);
    references.set(key,{storageKey:reference.storageKey,expectedSha256:reference.sha256,expectedByteSize:reference.byteSize,expectedMediaType:"application/pdf"});
    if(references.size>64||[...references.values()].reduce((n,row)=>n+row.expectedByteSize,0)>128*1024*1024)limit();
  }
  for(const source of base.sourceFiles){const ref=base.pdfStorageRefs[source.sourceFileId];
    if(source.mediaType!=="application/pdf"){if(ref||source.pageCount!==0||base.textArtifacts.some(item=>item.sourceFileId===source.sourceFileId))invalid();continue;}
    if(!ref||ref.sha256!==source.sha256||ref.byteSize!==source.byteSize)invalid();addReference(ref);}
  for(const row of rows.rows){
    const source=sourceMap.get(row.source_file_id);
    if(!source||seen.has(row.source_file_id)||source.sha256!==row.source_sha256.trim())invalid();seen.add(row.source_file_id);
    const projected:InventoryLoaderPackage["sources"][number]={sourceFileId:source.sourceFileId,sourceSha256:source.sha256,
      stages:source.stages as InventoryLoaderPackage["sources"][number]["stages"],reviewSnapshot:null,review:null};
    const callProjected:CallInventoryLoaderPackage["sources"][number]={...projected,review:null};
    const railProjected:RailInventoryLoaderPackage["sources"][number]={...projected,review:null};
    const waterProjected:WaterNodeInventoryLoaderPackage["sources"][number]={...projected,review:null};
    if(row.snapshot_decision_id!==null||row.snapshot_hash!==null){
      if(!row.review_id||row.review_id!==row.snapshot_decision_id||row.review_object_id!==input.objectId
        ||row.review_source_internal_id!==row.source_internal_id||row.review_source_sha256?.trim()!==source.sha256
        ||!row.actor_id||!row.revision_status||!row.approval_status||!row.page_stages||!row.basis_reference
        ||!row.content_hash||!row.snapshot_hash)invalid();
      const reviewBody={objectApiId:scope.row.object_api_id,sourceFileApiId:source.sourceFileId,sourceSha256:source.sha256,
        revisionStatus:row.revision_status,approvalStatus:row.approval_status,linkGroupId:row.link_group_id,
        ...(row.section_code?{sectionCode:row.section_code}:{}),pageStages:row.page_stages,basis:{reference:row.basis_reference},
        ...(row.matrix_scope?{matrixScope:row.matrix_scope}:{}),...(row.inventory_scope?{inventoryScope:row.inventory_scope}:{}),...(row.call_inventory_scope?{callInventoryScope:row.call_inventory_scope}:{}),...(row.rail_inventory_scope?{railInventoryScope:row.rail_inventory_scope}:{}),...(row.water_node_scope?{waterNodeScope:row.water_node_scope}:{}),...(row.lighting_technology_scope?{lightingTechnologyScope:row.lighting_technology_scope}:{}),...(row.steel_comparison_scope?{steelComparisonScope:row.steel_comparison_scope}:{}),actorId:row.actor_id};
      if(row.steel_comparison_scope)parseSteelComparisonScopeDecision(row.steel_comparison_scope,{sourceFileId:source.sourceFileId,sourceSha256:source.sha256});
      const reviewHash=sha256(canonicalJson(reviewBody));
      if(reviewHash!==row.content_hash.trim()||reviewHash!==row.snapshot_hash.trim())invalid();
      const inventoryScope=row.inventory_scope===null?null:parseInventoryScopeDecision(row.inventory_scope);
      const callInventoryScope=row.call_inventory_scope===null?null:parseCallInventoryScopeDecision(row.call_inventory_scope,{sourceFileId:source.sourceFileId,sourceSha256:source.sha256});
      const railInventoryScope=row.rail_inventory_scope===null?null:parseRailInventoryScopeDecision(row.rail_inventory_scope,{sourceFileId:source.sourceFileId,sourceSha256:source.sha256});
      const waterNodeScope=row.water_node_scope==null?null:parseWaterNodeScopeDecision(row.water_node_scope,{sourceFileId:source.sourceFileId,sourceSha256:source.sha256});
      projected.reviewSnapshot={decisionId:row.review_id,contentHash:reviewHash};
      projected.review={decisionId:row.review_id,contentHash:reviewHash,objectId:input.objectId,sourceFileId:source.sourceFileId,
        sourceSha256:source.sha256,actorId:row.actor_id,revisionStatus:row.revision_status,approvalStatus:row.approval_status,
        linkGroupId:row.link_group_id,sectionCode:row.section_code as NonNullable<typeof projected.review>["sectionCode"],
        pageStages:row.page_stages,inventoryScope};
      const {inventoryScope:_ar,...commonReview}=projected.review;
      callProjected.reviewSnapshot=projected.reviewSnapshot;
      callProjected.review={...commonReview,callInventoryScope};
      railProjected.reviewSnapshot=projected.reviewSnapshot;
      railProjected.review={...commonReview,railInventoryScope};
      waterProjected.reviewSnapshot=projected.reviewSnapshot;
      waterProjected.review={...commonReview,waterNodeScope};
      reviewBodies.push({decisionId:row.review_id,body:reviewBody});
      const allClaims=[...(inventoryScope?.claims??[]),...(callInventoryScope?.claims??[]),...(railInventoryScope?.claims??[]),...(waterNodeScope?.claims??[])];
      claims+=allClaims.length;if(claims>128)limit();
      for(const claim of allClaims){
        const key=canonicalJson([source.sourceFileId,claim.target.checkId]);if(originKeys.has(key))continue;
        originKeys.add(key);if(originKeys.size>128)limit();
        const selected=await client.query<{id:string}>(`SELECT id FROM analysis_runs WHERE api_id=$1 AND object_id=$2`,[claim.target.checkId,input.objectId]);
        if(selected.rows.length!==1||selected.rows[0]!.id===input.runId)invalid();
        const originId=selected.rows[0]!.id;
        if(sharedBudget)await sharedBudget.runById(originId);
        await chargeRun(originId);
        const originScope=await runIdentity(client,originId,input.objectId,input.organizationId);
        if(!originScope.row.sealed_at||!["PARTIAL","SUCCEEDED"].includes(originScope.row.run_state))invalid();
        const originBase=await authenticateBase(client,originId,input.objectId);
        const originSource=originBase?.sourceFiles.find(item=>item.sourceFileId===source.sourceFileId);
        const text=originBase?.textArtifacts.find(item=>item.sourceFileId===source.sourceFileId);
        const pdf=originBase?.pdfStorageRefs[source.sourceFileId];
        if(!originBase||!originSource||!text||!pdf||originSource.sha256!==source.sha256
          ||originBase.inputManifestHash!==claim.target.inputManifestHash||text.contentSha256!==claim.target.textStageContentHash)invalid();
        if(originSource.stages.length!==1||!['PD','RD'].includes(originSource.stages[0]!)
          ||allClaims.filter(item=>item.target.checkId===claim.target.checkId)
            .some(item=>item.inventorySnapshot.stage!==originSource.stages[0]))invalid();
        const textArtifactHash=sha256(canonicalSourceDeclarationJson({hashDomain:"matrix-source-declaration-text-artifact-v1",textArtifact:text.artifact}));
        if(textArtifactHash!==claim.target.textArtifactHash)invalid();
        for(const originSource of originBase.sourceFiles){const reference=originBase.pdfStorageRefs[originSource.sourceFileId];if(originSource.mediaType!=="application/pdf"){if(reference)invalid();continue;}if(!reference)invalid();addReference(reference);}
        const stages=await authenticatedStages(client,originId,originScope.row.release_id,originBase.inputManifestHash);
        const slots=originScope.release.providerSlots;
        const ruleSlots=Array.isArray(slots)?slots.filter(slot=>record(slot)&&slot.stageJobType==="RULE_EVALUATION"):[];
        const ruleSlot=ruleSlots.length===1?ruleSlots[0]:null;
        const policy=record(ruleSlot)&&typeof ruleSlot.profileId==="string"?matrixStoredReadPolicyForReleaseV13(originScope.release):null;
        if(!policy||!record(ruleSlot)||ruleSlot.status!=="CONFIGURED"||ruleSlot.providerKind!=="RULE_ENGINE"
          ||ruleSlot.adapterVersion!==policy.adapterVersion||ruleSlot.configHash!==policy.configHash
          ||!record(originScope.release.rules)||canonicalJson(originScope.release.rules.matrixDefinitions)!==canonicalJson(policy.definitions))invalid();
        const rule=stages.identities.filter(stage=>stage.jobType==="RULE_EVALUATION");
        if(rule.length!==1)invalid();
        // Seal jobs intentionally have no analysis_stage_artifacts row in legacy
        // profiles. Authenticate their actual terminal job/result instead.
        const seals=await client.query<{id:string;result_json:Record<string,unknown>}>(
          `SELECT id,result_json FROM analysis_jobs WHERE run_id=$1 AND job_type='ANALYSIS_SEAL_UNSUPPORTED'
           AND state='SUCCEEDED' AND release_id=$2 AND input_manifest_hash=$3`,[originId,originScope.row.release_id,originBase.inputManifestHash]);
        if(seals.rows.length!==1||seals.rows[0]!.result_json?.disposition!=="UNSUPPORTED_COVERAGE_SEALED")invalid();
        const snapshots=await client.query<{execution_hash:string;submission_hash:string;submission_bytes:Buffer}>(
          "SELECT execution_hash,submission_hash,submission_bytes FROM machine_prediction_snapshots WHERE run_id=$1",[originId]);
        const snapshot=snapshots.rows[0];
        if(snapshots.rows.length!==1||!snapshot||snapshot.execution_hash.trim()!==rule[0]!.contentHash
          ||sha256(snapshot.submission_bytes)!==snapshot.submission_hash.trim()
          ||originScope.row.output_hash?.trim()!==sha256(canonicalJson({executionHash:rule[0]!.contentHash,submissionHash:snapshot.submission_hash.trim()})))invalid();
        origins.push({checkId:claim.target.checkId,objectId:input.objectId,sourceFileId:source.sourceFileId,sourceSha256:source.sha256,
          inputManifestHash:originBase.inputManifestHash,textStageContentHash:text.contentSha256,textArtifactHash,textArtifact:text.artifact});
        originProofs.push({runId:originId,checkId:claim.target.checkId,releaseId:originScope.row.release_id,
          releaseHash:originScope.row.release_hash.trim(),manifestHash:originBase.inputManifestHash,sealedAt:new Date(originScope.row.sealed_at).toISOString(),
          outputHash:originScope.row.output_hash,stages,seal:seals.rows[0],sources:originBase.sourceFiles,pdfStorageRefs:originBase.pdfStorageRefs,
          textArtifacts:originBase.textArtifacts.map(item=>({sourceFileId:item.sourceFileId,contentSha256:item.contentSha256})),
          source:originSource,pdf,textStageContentHash:text.contentSha256,textArtifactHash});
      }
    } else if(row.review_id!==null)invalid();
    sources.push(projected);callSources.push(callProjected);railSources.push(railProjected);waterSources.push(waterProjected);
  }
  const projected:InventoryLoaderPackage={schemaVersion:"matrix-ar053-loader-inputs-v1",objectId:input.objectId,
    inputManifestHash:base.inputManifestHash,sources,origins,identities:deriveInventoryIdentities(sources)};
  if(Buffer.byteLength(canonicalJson(projected))>64*1024*1024)limit();
  const validated=validateInventoryLoaderPackage(projected);
  const callProjected:CallInventoryLoaderPackage={schemaVersion:'matrix-odi123-call-loader-inputs-v1',objectId:input.objectId,
    inputManifestHash:base.inputManifestHash,sources:callSources,origins,identities:deriveCallInventoryIdentities(callSources)};
  const validatedCall=validateCallInventoryLoaderPackage(callProjected);
  const railProjected:RailInventoryLoaderPackage={schemaVersion:"matrix-odi120-rail-loader-inputs-v1",objectId:input.objectId,
    inputManifestHash:base.inputManifestHash,sources:railSources,origins,identities:deriveRailInventoryIdentities(railSources)};
  const validatedRail=validateRailInventoryLoaderPackage(railProjected);
  const waterProjected:WaterNodeInventoryLoaderPackage={schemaVersion:"matrix-zu129-water-node-loader-inputs-v1",objectId:input.objectId,
    inputManifestHash:base.inputManifestHash,sources:waterSources,origins,identities:deriveWaterNodeIdentities(waterSources)};
  const validatedWater=validateWaterNodeLoaderPackage(waterProjected);
  const stages=await authenticatedStages(client,input.runId,scope.row.release_id,base.inputManifestHash);
  const proof={runId:input.runId,objectId:input.objectId,inspectionId:scope.row.inspection_id,manifestId:scope.row.manifest_id,
    manifestHash:base.inputManifestHash,releaseId:scope.row.release_id,releaseHash:scope.row.release_hash.trim(),sources:base.sourceFiles,
    pdfStorageRefs:base.pdfStorageRefs,textArtifacts:base.textArtifacts.map(text=>({sourceFileId:text.sourceFileId,contentSha256:text.contentSha256,
      byteSize:Buffer.byteLength(canonicalJson(text.artifact))})),reviewBodies,originProofs,stages};
  return Object.freeze({package:validated,callPackage:validatedCall,railPackage:validatedRail,waterPackage:validatedWater,fingerprint:sha256(canonicalJson(proof)),references:Object.freeze([...references.values()]),
    release:scope.release,run:{id:scope.row.id,checkId:scope.row.api_id,objectId:input.objectId,inspectionId:scope.row.inspection_id,
      releaseId:scope.row.release_id,inputManifestHash:base.inputManifestHash}});
}
/** B: no acquired DB client or write locks. This receipt cannot authorize a later write. */
export async function verifyInventoryPreparationPdfs(storage:ObjectStorage, prepared:AuthenticatedInventoryPreparation,
  options:{signal?:AbortSignal;leaseUntilEpochMs?:number}={}):Promise<readonly VerifiedOriginalPdfReceipt[]> {
  return withPdfIoBudget(signal=>verifyOriginalPdfSet({storage,references:prepared.references,signal}),options);
}
/** C: call after current authorization/scope/fence/lease locks, inside the write transaction. */
export function assertInventoryPreparationUnchanged(before:Pick<AuthenticatedInventoryPreparation,"fingerprint">,after:AuthenticatedInventoryPreparation):void {
  if(before.fingerprint!==after.fingerprint)throw new InventoryLoaderIntegrityError("INVENTORY_INPUT_CHANGED");
}

/** Evidence points at authenticated frozen inventory lines; never scalar observation IDs. */
export function inventoryComparisonEvidence(prepared:AuthenticatedInventoryPreparation,envelope:import("./matrix-inventory-execution.js").InventoryComparisons):
  import("@inspector-ai/contracts").MatrixInventoryComparisonEvidence[] {
  const output:import("@inspector-ai/contracts").MatrixInventoryComparisonEvidence[]=[];
  for(const result of envelope.results){
    if(result.kind!=="SCOPED_COMPARISON"||result.comparison.status!=="CANDIDATE")continue;
    for(const role of ["EXPECTED","ACTUAL"] as const){
      const reference=role==="EXPECTED"?result.comparison.expected:result.comparison.actual;
      const source=prepared.package.sources.filter(s=>s.sourceFileId===reference.sourceFileId&&s.sourceSha256===reference.sourceSha256);
      if(source.length!==1)invalid();const review=source[0]!.review;
      if(!review||review.decisionId!==reference.reviewDecisionId||review.contentHash!==reference.reviewContentHash)invalid();
      const claims=(review.inventoryScope?.claims??[]).filter(c=>c.target.inventoryContentHash===reference.inventoryContentHash
        &&["entityKey","componentRole","componentKey","zoneKey","operatingModeKey","measurementBasisKey"].every(k=>
          c[k as keyof typeof c]===result.identity[k as keyof typeof result.identity]));
      if(claims.length!==1)invalid();const claim=claims[0]!,inventory=claim.inventorySnapshot;
      const origin=prepared.package.origins.filter(o=>o.checkId===claim.target.checkId&&o.sourceFileId===reference.sourceFileId
        &&o.sourceSha256===reference.sourceSha256&&o.inputManifestHash===claim.target.inputManifestHash
        &&o.textStageContentHash===claim.target.textStageContentHash&&o.textArtifactHash===claim.target.textArtifactHash);
      if(origin.length!==1||inventory.unresolvedRows.length)invalid();
      const seen=new Set<string>();
      const fragments=[...inventory.headerFragments.map(fragment=>({fragmentRole:"HEADER" as const,fragment})),
        ...inventory.scopeFragments.map(fragment=>({fragmentRole:"SCOPE" as const,fragment})),
        ...inventory.featureRows.flatMap(row=>row.fragments.map(fragment=>({fragmentRole:"FEATURE" as const,fragment})))];
      for(const item of fragments){const key=canonicalJson(item.fragment);if(seen.has(key))continue;seen.add(key);
        output.push({resultId:result.id,role,...reference,originCheckId:claim.target.checkId,pageNumber:inventory.pageNumber,
          pageFrame:{widthMilliPoints:inventory.widthMilliPoints,heightMilliPoints:inventory.heightMilliPoints},...item});}
    }
  }
  return output;
}

/** ODI123 evidence includes the explicit source-authored end delimiter. */
export function callInventoryComparisonEvidence(prepared:AuthenticatedInventoryPreparation,envelope:import('./matrix-call-inventory-execution.js').CallInventoryComparisons):import('@inspector-ai/contracts').MatrixCallInventoryComparisonEvidence[] {
  const output:import('@inspector-ai/contracts').MatrixCallInventoryComparisonEvidence[]=[];
  for(const result of envelope.results){
    if(result.kind!=='SCOPED_COMPARISON'||result.comparison.status!=='CANDIDATE')continue;
    for(const role of ['EXPECTED','ACTUAL'] as const){
      const reference=role==='EXPECTED'?result.comparison.expected:result.comparison.actual;
      const sources=prepared.callPackage.sources.filter(s=>s.sourceFileId===reference.sourceFileId&&s.sourceSha256===reference.sourceSha256);
      if(sources.length!==1)invalid();const review=sources[0]!.review;
      if(!review||review.decisionId!==reference.reviewDecisionId||review.contentHash!==reference.reviewContentHash)invalid();
      const claims=(review.callInventoryScope?.claims??[]).filter(c=>c.target.inventoryContentHash===reference.inventoryContentHash&&canonicalJson(c.identity)===canonicalJson(result.identity));
      if(claims.length!==1)invalid();const claim=claims[0]!,inventory=claim.inventorySnapshot;
      const origins=prepared.callPackage.origins.filter(o=>o.checkId===claim.target.checkId&&o.sourceFileId===reference.sourceFileId&&o.sourceSha256===reference.sourceSha256
        &&o.inputManifestHash===claim.target.inputManifestHash&&o.textStageContentHash===claim.target.textStageContentHash&&o.textArtifactHash===claim.target.textArtifactHash);
      if(origins.length!==1)invalid();
      const fragments=[...inventory.headerFragments.map(fragment=>({fragmentRole:'HEADER' as const,fragment})),
        ...inventory.scopeFragments.map(fragment=>({fragmentRole:'SCOPE' as const,fragment})),
        ...inventory.endFragments.map(fragment=>({fragmentRole:'END' as const,fragment})),
        ...inventory.featureRows.flatMap(row=>row.fragments.map(fragment=>({fragmentRole:'FEATURE' as const,fragment})))];
      const seen=new Set<string>();
      for(const item of fragments){const key=canonicalJson(item.fragment);if(seen.has(key))continue;seen.add(key);
        output.push({resultId:result.id,role,...reference,originCheckId:claim.target.checkId,pageNumber:inventory.pageNumber,
          pageFrame:{widthMilliPoints:inventory.widthMilliPoints,heightMilliPoints:inventory.heightMilliPoints},...item});}
    }
  }
  return output;
}

/** ODI120 evidence includes the explicit source-authored end delimiter. */
export function railInventoryComparisonEvidence(prepared:AuthenticatedInventoryPreparation,envelope:import('./matrix-rail-inventory-execution.js').RailInventoryComparisons):import('@inspector-ai/contracts').MatrixRailInventoryComparisonEvidence[] {
  const output:import('@inspector-ai/contracts').MatrixRailInventoryComparisonEvidence[]=[];
  for(const result of envelope.results){
    if(result.kind!=='SCOPED_COMPARISON'||result.comparison.status!=='CANDIDATE')continue;
    for(const role of ['EXPECTED','ACTUAL'] as const){
      const reference=role==='EXPECTED'?result.comparison.expected:result.comparison.actual;
      const sources=prepared.railPackage.sources.filter(s=>s.sourceFileId===reference.sourceFileId&&s.sourceSha256===reference.sourceSha256);
      if(sources.length!==1)invalid();const review=sources[0]!.review;
      if(!review||review.decisionId!==reference.reviewDecisionId||review.contentHash!==reference.reviewContentHash)invalid();
      const claims=(review.railInventoryScope?.claims??[]).filter(c=>c.target.inventoryContentHash===reference.inventoryContentHash&&canonicalJson(c.identity)===canonicalJson(result.identity));
      if(claims.length!==1)invalid();const claim=claims[0]!,inventory=claim.inventorySnapshot;
      const origins=prepared.railPackage.origins.filter(o=>o.checkId===claim.target.checkId&&o.sourceFileId===reference.sourceFileId&&o.sourceSha256===reference.sourceSha256
        &&o.inputManifestHash===claim.target.inputManifestHash&&o.textStageContentHash===claim.target.textStageContentHash&&o.textArtifactHash===claim.target.textArtifactHash);
      if(origins.length!==1)invalid();
      const fragments=[...inventory.headerFragments.map(fragment=>({fragmentRole:'HEADER' as const,fragment})),
        ...inventory.scopeFragments.map(fragment=>({fragmentRole:'SCOPE' as const,fragment})),
        ...inventory.endFragments.map(fragment=>({fragmentRole:'END' as const,fragment})),
        ...inventory.featureRows.flatMap(row=>row.fragments.map(fragment=>({fragmentRole:'FEATURE' as const,fragment})))];
      const seen=new Set<string>();
      for(const item of fragments){const key=canonicalJson(item.fragment);if(seen.has(key))continue;seen.add(key);
        output.push({resultId:result.id,role,...reference,originCheckId:claim.target.checkId,pageNumber:inventory.pageNumber,
          pageFrame:{widthMilliPoints:inventory.widthMilliPoints,heightMilliPoints:inventory.heightMilliPoints},...item});}
    }
  }
  return output;
}

/** Full typed rebuild authenticates each water-node evidence locator. */
export function waterNodeComparisonEvidence(prepared:AuthenticatedInventoryPreparation,envelope:import('./matrix-water-node-execution.js').WaterNodeComparisons):import('@inspector-ai/contracts').MatrixWaterNodeComparisonEvidence[] {
 return buildWaterNodeEvidence(prepared.waterPackage,envelope);
}
