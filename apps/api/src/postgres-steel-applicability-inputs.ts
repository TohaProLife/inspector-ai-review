/** Protected DB preparation for a journal save/read. Actor/access and PDF bytes are
 * authenticated by the repository; every origin callback must authenticate a sealed run. */
import type {PoolClient} from 'pg';
import type {MatrixPreparationBudgetV13} from './postgres-matrix-preparation-budget-v13.js';
import {matrixSteelComparisonSourceKeySchema,type SteelComparisonReference,type SteelComparisonSource,
 type SteelComparisonOrigin,type SteelComparisonExecutionLoaderPackage} from '@inspector-ai/contracts';
import {canonicalJson,sha256} from './canonical-json.js';
import {steelComparisonExecutionInternal as internal} from './matrix-steel-comparison.js';
import {parseSteelComparisonScopeDecision} from './matrix-steel-review.js';
import {deriveSteelComparisonIdentities,validateSteelComparisonLoaderPackage} from './matrix-steel-execution.js';
import type {OriginalPdfReference} from './verified-pdf-io.js';

export class SteelApplicabilityInputIntegrityError extends Error{
 constructor(readonly code:'STEEL_APPLICABILITY_INPUT_INTEGRITY'|'STEEL_APPLICABILITY_INPUT_LIMIT'|'STEEL_APPLICABILITY_SOURCE_STALE'){
  super(code);this.name='SteelApplicabilityInputIntegrityError';
 }
}
function invalid():never{throw new SteelApplicabilityInputIntegrityError('STEEL_APPLICABILITY_INPUT_INTEGRITY');}
function stale():never{throw new SteelApplicabilityInputIntegrityError('STEEL_APPLICABILITY_SOURCE_STALE');}
const admit=(raw:unknown,limit=8000000):void=>{const checked=internal.native(raw,limit);if(checked.status!=='VALID')throw new SteelApplicabilityInputIntegrityError(checked.status==='LIMIT'?'STEEL_APPLICABILITY_INPUT_LIMIT':'STEEL_APPLICABILITY_INPUT_INTEGRITY');};
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
export interface SteelApplicabilitySourceOrigin{
 source:{sourceFileId:string;sha256:string;stages:string[]};
 inputManifestHash:string;textStageContentHash:string;textArtifactHash:string;textArtifact:Record<string,unknown>;
 originalPageStages:Record<string,string>;
}
export type LoadSteelApplicabilityOrigin=(client:PoolClient,objectId:string,checkId:string,sourceFileId:string)=>Promise<SteelApplicabilitySourceOrigin|null>;
export interface PrepareSteelApplicabilityInput{
 objectId:string;objectApiId:string;expected:SteelComparisonReference;actual:SteelComparisonReference;mode:'CURRENT'|'HISTORICAL';
}
export interface PreparedSteelApplicabilityInputs{
 package:SteelComparisonExecutionLoaderPackage;references:readonly OriginalPdfReference[];fingerprint:string;
 expectedSourceInternalId:string;actualSourceInternalId:string;
}
interface SourceRow{
 source_internal_id:string;source_file_id:string;object_id:string;sha256:string;stages:string[];
 storage_key:string;byte_size:string|number;media_type:string;latest_review_id:string|null;
}
interface ReviewRow{
 id:string;object_id:string;source_file_id:string;source_sha256:string;revision_status:string;approval_status:string;
 link_group_id:string|null;section_code:string|null;page_stages:Record<string,string>;basis_reference:string;actor_id:string;
 matrix_scope:unknown|null;inventory_scope:unknown|null;call_inventory_scope:unknown|null;rail_inventory_scope:unknown|null;
 water_node_scope:unknown|null;lighting_technology_scope:unknown|null;steel_comparison_scope:unknown|null;content_hash:string;
}
function reviewProjection(row:ReviewRow,source:SourceRow,input:PrepareSteelApplicabilityInput):SteelComparisonSource['review']{
 const body={objectApiId:input.objectApiId,sourceFileApiId:source.source_file_id,sourceSha256:row.source_sha256.trim(),
  revisionStatus:row.revision_status,approvalStatus:row.approval_status,linkGroupId:row.link_group_id,
  ...(row.section_code?{sectionCode:row.section_code}:{}),pageStages:row.page_stages,basis:{reference:row.basis_reference},
  ...(row.matrix_scope?{matrixScope:row.matrix_scope}:{}),...(row.inventory_scope?{inventoryScope:row.inventory_scope}:{}),
  ...(row.call_inventory_scope?{callInventoryScope:row.call_inventory_scope}:{}),...(row.rail_inventory_scope?{railInventoryScope:row.rail_inventory_scope}:{}),
  ...(row.water_node_scope?{waterNodeScope:row.water_node_scope}:{}),...(row.lighting_technology_scope?{lightingTechnologyScope:row.lighting_technology_scope}:{}),
  ...(row.steel_comparison_scope?{steelComparisonScope:row.steel_comparison_scope}:{}),actorId:row.actor_id};
 if(sha256(canonicalJson(body))!==row.content_hash.trim())invalid();
 const steel=row.steel_comparison_scope===null?null:parseSteelComparisonScopeDecision(row.steel_comparison_scope,
  {sourceFileId:source.source_file_id,sourceSha256:source.sha256.trim()});
 return {decisionId:row.id,contentHash:row.content_hash.trim(),revisionStatus:row.revision_status,approvalStatus:row.approval_status,
  sectionCode:row.section_code,linkGroupId:row.link_group_id,pageStages:row.page_stages,steelComparisonScope:steel} as SteelComparisonSource['review'];
}
/** No source classification or declaration snapshot is accepted from an HTTP caller. */
export async function prepareSteelApplicabilityInputs(client:PoolClient,raw:PrepareSteelApplicabilityInput,
 loadOrigin:LoadSteelApplicabilityOrigin,budget?:MatrixPreparationBudgetV13):Promise<PreparedSteelApplicabilityInputs>{
 admit(raw,524288);
 if(!raw||Object.keys(raw).sort().join('|')!==['objectId','objectApiId','expected','actual','mode'].sort().join('|')
  ||!matrixSteelComparisonSourceKeySchema.safeParse(raw.objectId).success||!matrixSteelComparisonSourceKeySchema.safeParse(raw.objectApiId).success
  ||!internal.referenceShape(raw.expected)||!internal.referenceShape(raw.actual)||!['CURRENT','HISTORICAL'].includes(raw.mode)
  ||raw.expected.sourceFileId===raw.actual.sourceFileId||raw.expected.sourceSha256===raw.actual.sourceSha256)invalid();
 const input=JSON.parse(canonicalJson(raw)) as PrepareSteelApplicabilityInput;
 const sources:SteelComparisonSource[]=[],origins:SteelComparisonOrigin[]=[],references:OriginalPdfReference[]=[],sourceIds:string[]=[];
 for(const ref of [input.expected,input.actual]){
  const selected=await client.query<SourceRow>(`SELECT source.id AS source_internal_id,source.api_id AS source_file_id,
    source.object_id,blob.sha256,blob.storage_key,blob.byte_size,blob.media_type,
    ARRAY(SELECT stage.stage FROM source_file_stages stage WHERE stage.source_file_id=source.id ORDER BY stage.stage) AS stages,
    (SELECT review.id FROM source_review_decisions review WHERE review.source_file_id=source.id ORDER BY review.created_at DESC,review.id DESC LIMIT 1) AS latest_review_id
    FROM source_files source JOIN blobs blob ON blob.id=source.blob_id WHERE source.object_id=$1 AND source.api_id=$2`,[input.objectId,ref.sourceFileId]);
  if(selected.rows.length!==1)invalid();admit(selected.rows);const row=selected.rows[0]!;
  if(row.object_id!==input.objectId||row.source_file_id!==ref.sourceFileId||row.sha256.trim()!==ref.sourceSha256)invalid();
  if(input.mode==='CURRENT'&&row.latest_review_id!==ref.reviewDecisionId)stale();
  if(budget)await budget.sourceReview(row.source_internal_id,ref.reviewDecisionId);
  const reviews=await client.query<ReviewRow>(`SELECT id,object_id,source_file_id,source_sha256,revision_status,approval_status,
    link_group_id,section_code,page_stages,basis_reference,actor_id,matrix_scope,inventory_scope,call_inventory_scope,
    rail_inventory_scope,water_node_scope,lighting_technology_scope,steel_comparison_scope,content_hash
    FROM source_review_decisions WHERE id=$1 AND object_id=$2 AND source_file_id=$3`,[ref.reviewDecisionId,input.objectId,row.source_internal_id]);
  if(reviews.rows.length!==1)invalid();admit(reviews.rows);const review=reviews.rows[0]!;
  if(review.id!==ref.reviewDecisionId||review.object_id!==input.objectId||review.source_file_id!==row.source_internal_id
   ||review.source_sha256.trim()!==ref.sourceSha256||review.content_hash.trim()!==ref.reviewContentHash)invalid();
  const projected=reviewProjection(review,row,input);
  sources.push({sourceFileId:ref.sourceFileId,sourceSha256:ref.sourceSha256,objectId:input.objectId,stages:row.stages,review:projected} as SteelComparisonSource);
  sourceIds.push(row.source_internal_id);
  const byteSize=Number(row.byte_size);
  if(!Number.isSafeInteger(byteSize)||byteSize<5||row.media_type!=='application/pdf'||!row.storage_key)invalid();
  references.push({storageKey:row.storage_key,expectedSha256:ref.sourceSha256,expectedByteSize:byteSize,expectedMediaType:'application/pdf'});
 }
 const cache=new Map<string,SteelApplicabilitySourceOrigin>();
 for(const source of sources)for(const claim of source.review?.steelComparisonScope?.claims??[]){
  const key=canonicalJson([source.sourceFileId,claim.target.checkId]);let origin=cache.get(key);
  if(!origin){const loaded=await loadOrigin(client,input.objectId,claim.target.checkId,source.sourceFileId);if(!loaded)invalid();admit(loaded);origin=loaded;cache.set(key,origin);}
  if(origin.source.sourceFileId!==source.sourceFileId||origin.source.sha256!==source.sourceSha256
   ||origin.inputManifestHash!==claim.target.inputManifestHash||origin.textStageContentHash!==claim.target.textStageContentHash
   ||origin.textArtifactHash!==claim.target.textArtifactHash)invalid();
  const {declarationId:_id,...target}=claim.target;
  if(!origins.some(o=>o.sourceFileId===source.sourceFileId&&same(o.target,target)))origins.push({sourceFileId:source.sourceFileId,
   sourceSha256:source.sourceSha256,target,artifactContentSha256:origin.textStageContentHash,textArtifact:origin.textArtifact,
   stages:origin.source.stages,pageStages:origin.originalPageStages} as SteelComparisonOrigin);
  admit({sources,origins});
 }
 const pkg=validateSteelComparisonLoaderPackage({schemaVersion:'matrix-kr056-steel-loader-inputs-v1',objectId:input.objectId,
  // Internal journal anchor only: no new run or manifest is invented by this preparation.
  inputManifestHash:input.expected.target.inputManifestHash,sources,origins,applicabilityDecisions:[],identities:deriveSteelComparisonIdentities(sources)});
 // Validate the requested declaration references even if their identity is currently operationally ineligible.
 for(const ref of [input.expected,input.actual]){
  const source=pkg.sources.find(s=>s.sourceFileId===ref.sourceFileId)!;
  const found=source.review?.steelComparisonScope?.claims.filter(c=>same(c.target,ref.target)&&same(c.declarationSnapshot.productScope,ref.productScope));
  if(found?.length!==1)invalid();
  const stage=ref===input.expected?'PD':'RD';if(found[0]!.declarationSnapshot.stage!==stage)invalid();
 }
 const body={package:pkg,references,expectedSourceInternalId:sourceIds[0]!,actualSourceInternalId:sourceIds[1]!};
 admit(body);return {...body,fingerprint:sha256(canonicalJson(body))};
}
