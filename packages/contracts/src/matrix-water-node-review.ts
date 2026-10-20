/** Source-local water-node review DTO. Neither shape nor human assertions prove
 * original-file, database, physical completeness or same-node authority. */
import {z} from 'zod';

export const WATER_NODE_REVIEW_VERSION='matrix-zu129-water-node-review-v1';
export const WATER_NODE_REVIEW_LIMITS=Object.freeze({claims:16,requestBytes:524288,materializedBytes:8000000,
 depth:64,nodes:200000,containerItems:32768,stringCodepoints:2000000,lineCodepoints:8192});
type Box=[number,number,number,number];
const safe=z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const positive=safe.positive(),nonnegative=safe.nonnegative();
const sha=z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const pyTrim=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const scalar=(s:string)=>{for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
const sourceLine=(s:string)=>scalar(s)&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s);
const key=(max:number)=>z.string().refine(s=>sourceLine(s)&&pyTrim(s)===s&&[...s].length>=1&&[...s].length<=max,'Unchanged Unicode scalar key required');
const reference=z.string().refine(s=>sourceLine(s)&&pyTrim(s)===s&&[...s].length>=8&&[...s].length<=1000,'Unchanged one-line8..1000CP reference required');
const line=z.string().refine(s=>sourceLine(s)&&!!pyTrim(s)&&[...s].length<=8192,'Complete original line required');
const token=z.string().regex(/^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}(?![\s\S])/u);
const box=z.tuple([nonnegative,nonnegative,nonnegative,nonnegative]).refine(b=>b[0]<b[2]&&b[1]<b[3],'Positive source box required');
const fragment=z.object({pageNumber:positive,blockIndex:nonnegative,lineIndex:nonnegative,rawText:line,bboxMilliPoints:box}).strict();
const one=z.array(fragment).length(1),four=z.array(fragment).length(4);
const identity=z.object({entityKey:key(200),buildingKey:key(200),nodeKey:key(200),service:z.literal('COLD_WATER'),
 accountingScope:z.literal('COMMON_BUILDING_INLET'),componentRole:z.literal('COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS')}).strict();
const mapping=z.object({kind:z.literal('HUMAN_REVIEWED_COLD_WATER_INLET_NODE_MAPPING'),sourceBuildingToken:key(200),
 sourceNodeToken:key(200),assertion:z.enum(['UNKNOWN','HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE'])}).strict();
const target=z.object({checkId:key(120),inputManifestHash:sha,textStageContentHash:sha,textArtifactHash:sha,inventoryContentHash:sha}).strict();
const selection=z.object({pageNumber:positive,regionBoxMilliPoints:box,headerFragments:one,scopeFragments:four,endFragments:one}).strict();
function contains(a:Box,b:Box):boolean{return a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];}
const inventory=z.object({schemaVersion:z.literal('matrix-zu129-water-node-source-v1'),extractorVersion:z.literal('matrix-zu129-water-node-source-v1'),
 policyVersion:z.literal('matrix-zu129-cold-water-inlet-literals-v1'),sourceFileId:key(200),sourceSha256:sha,textArtifactHash:sha,
 stage:z.enum(['PD','RD']),pageNumber:positive,widthMilliPoints:positive,heightMilliPoints:positive,regionBoxMilliPoints:box,
 headerFragments:one,scopeFragments:four,endFragments:one,buildingToken:token,nodeToken:token,
 service:z.literal('COLD_WATER'),accountingScope:z.literal('COMMON_BUILDING_INLET'),
 featureRows:z.array(z.object({featureKey:z.enum(['WATER_METER','STRAINER','SHUTOFF_VALVE']),fragments:one}).strict()).min(1).max(3),
}).strict().superRefine((s,ctx)=>{
 const frame:Box=[0,0,s.widthMilliPoints,s.heightMilliPoints];
 if(!contains(frame,s.regionBoxMilliPoints))ctx.addIssue({code:'custom',message:'Snapshot region outside own original frame'});
 for(const f of [...s.headerFragments,...s.scopeFragments,...s.endFragments,...s.featureRows.flatMap(row=>row.fragments)])
  if(f.pageNumber!==s.pageNumber||!contains(frame,f.bboxMilliPoints))
   ctx.addIssue({code:'custom',message:'Every snapshot fragment must retain its own original page/frame'});
});
const claimFields={target,selection,identity,nodeMapping:mapping,assertion:z.enum(['UNKNOWN','HUMAN_ASSERTED_COMPLETE']),reference};
const claimInput=z.object(claimFields).strict();
const claimDecision=z.object({...claimFields,inventorySnapshot:inventory}).strict();
const scopeInput=z.object({schemaVersion:z.literal(WATER_NODE_REVIEW_VERSION),claims:z.array(claimInput).max(16)}).strict();
const scopeDecision=z.object({schemaVersion:z.literal(WATER_NODE_REVIEW_VERSION),claims:z.array(claimDecision).max(16)}).strict();

export type MatrixWaterNodeIdentity=z.infer<typeof identity>;
export type MatrixWaterNodeMapping=z.infer<typeof mapping>;
export type MatrixWaterNodeInventoryFragment=z.infer<typeof fragment>;
export type MatrixWaterNodeInventorySelection=z.infer<typeof selection>;
export type MatrixWaterNodeInventoryTarget=z.infer<typeof target>;
export type MatrixWaterNodeSourceInventory=z.infer<typeof inventory>;
export type MatrixWaterNodeReviewClaimInput=z.infer<typeof claimInput>;
export type MatrixWaterNodeReviewClaimDecision=z.infer<typeof claimDecision>;
export type MatrixWaterNodeScopeInput=z.infer<typeof scopeInput>;
export type MatrixWaterNodeScopeDecision=z.infer<typeof scopeDecision>;
export const matrixWaterNodeIdentitySchema=identity;
export const matrixWaterNodeMappingSchema=mapping;
export const matrixWaterNodeInventoryFragmentSchema=fragment;
export const matrixWaterNodeInventorySelectionSchema=selection;
export const matrixWaterNodeInventoryTargetSchema=target;
export const matrixWaterNodeSourceInventorySchema=inventory;
export const matrixWaterNodeReviewClaimInputSchema=claimInput;
export const matrixWaterNodeReviewClaimDecisionSchema=claimDecision;
export const matrixWaterNodeScopeInputSchema=scopeInput;
export const matrixWaterNodeScopeDecisionSchema=scopeDecision;

/** Browser-safe strict deep projection. Node MUST native-preflight untrusted
 * host objects before Zod parsing. Hash/original verification is server-only. */
export function waterNodeScopeDecisionToInput(scope:MatrixWaterNodeScopeDecision):MatrixWaterNodeScopeInput {
 const saved=scopeDecision.parse(scope);
 return scopeInput.parse({schemaVersion:saved.schemaVersion,claims:saved.claims.map(c=>({
  target:{checkId:c.target.checkId,inputManifestHash:c.target.inputManifestHash,textStageContentHash:c.target.textStageContentHash,
   textArtifactHash:c.target.textArtifactHash,inventoryContentHash:c.target.inventoryContentHash},
  selection:{pageNumber:c.selection.pageNumber,regionBoxMilliPoints:[...c.selection.regionBoxMilliPoints],
   headerFragments:c.selection.headerFragments.map(copyFragment),scopeFragments:c.selection.scopeFragments.map(copyFragment),
   endFragments:c.selection.endFragments.map(copyFragment)},
  identity:{entityKey:c.identity.entityKey,buildingKey:c.identity.buildingKey,nodeKey:c.identity.nodeKey,service:c.identity.service,
   accountingScope:c.identity.accountingScope,componentRole:c.identity.componentRole},
  nodeMapping:{kind:c.nodeMapping.kind,sourceBuildingToken:c.nodeMapping.sourceBuildingToken,sourceNodeToken:c.nodeMapping.sourceNodeToken,
   assertion:c.nodeMapping.assertion},assertion:c.assertion,reference:c.reference,
 }))});
}
function copyFragment(f:MatrixWaterNodeInventoryFragment):MatrixWaterNodeInventoryFragment {
 return {pageNumber:f.pageNumber,blockIndex:f.blockIndex,lineIndex:f.lineIndex,rawText:f.rawText,bboxMilliPoints:[...f.bboxMilliPoints]};
}
