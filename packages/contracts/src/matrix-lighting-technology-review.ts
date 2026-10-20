/** Browser-safe source-local lighting review shape. Human mappings and supplied
 * snapshots never authenticate original sources or engineering authority. */
import {z} from 'zod';
export const LIGHTING_TECHNOLOGY_REVIEW_VERSION='matrix-zu130-lighting-technology-review-v1';
export const LIGHTING_TECHNOLOGY_REVIEW_LIMITS=Object.freeze({claims:16,requestBytes:524288,materializedBytes:8000000,
 depth:64,nodes:200000,containerItems:32768,stringCodepoints:2000000});
const safe=z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const positive=safe.positive(),nonnegative=safe.nonnegative();
const sha=z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const pyTrim=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const scalar=(s:string)=>{for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
const line=(s:string)=>scalar(s)&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s);
const key=(max:number,min=1)=>z.string().refine(s=>line(s)&&pyTrim(s)===s&&[...s].length>=min&&[...s].length<=max,'Unchanged Unicode scalar key required');
const raw=(min:number,max:number)=>z.string().refine(s=>scalar(s)&&[...s].length>=min&&[...s].length<=max,'Original Unicode scalar string required');
const token=z.string().regex(/^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}(?![\s\S])/u);
const page=positive.max(512);
const path=z.array(nonnegative.max(32767)).min(1).max(64);
const rawText=raw(1,2000000);
const selectedFragment=z.object({sourcePath:path,rawText}).strict();
const selectedFragments=z.union([z.tuple([selectedFragment]),z.tuple([selectedFragment,selectedFragment])]);
const selection=z.object({pageNumber:page,fragments:selectedFragments}).strict();
const box=z.tuple([nonnegative,nonnegative,nonnegative,nonnegative]);
const decimal=raw(1,64).refine(s=>/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?(?![\s\S])/u.test(s),'Native decimal representation required');
const nativeBox=z.tuple([decimal,decimal,decimal,decimal]);
const primaryFragment=z.object({pageNumber:page,sourcePath:path,rawText,nativeBoxPointStrings:nativeBox,bboxMilliPoints:box,
 usedTextRange:z.object({start:nonnegative,end:positive}).strict()}).strict();
const primaryFragments=z.union([z.tuple([primaryFragment]),z.tuple([primaryFragment,primaryFragment])]);
const declaration=z.object({schemaVersion:z.literal('matrix-zu130-lighting-technology-v3-declaration-v1'),
 extractorVersion:z.literal('matrix-zu130-lighting-technology-source-v3-v1'),bindingPolicyVersion:z.literal('matrix-zu130-explicit-lighting-technology-v3-literals-v1'),
 sourceFileId:key(200),sourceSha256:sha,textArtifactHash:sha,extractorProfileHash:sha,stage:z.enum(['PD','RD','ID','UNRESOLVED']),pageNumber:page,
 pageWidthMilliPoints:positive,pageHeightMilliPoints:positive,
 nativeFrame:z.object({coordinateSystem:z.literal('PDFMINER_LAYOUT_POINTS'),visibleBoxPointStrings:nativeBox}).strict(),
 regionBoxMilliPoints:box,technology:z.enum(['LED','FLUORESCENT','INCANDESCENT']),rawTechnology:raw(1,200),positionLabel:raw(1,80).nullable(),
 scopeStatus:z.enum(['NAMED_POSITION_LITERAL','UNBOUND_GROUP_DECLARATION']),primaryFragments,
 authorityStatus:z.literal('SOURCE_DECLARED_UNVERIFIED'),renderedVisibility:z.literal('UNVERIFIED'),calibratedProbability:z.null()}).strict();
const identity=z.object({entityKey:key(200),buildingKey:key(200),systemKey:key(200),positionKey:key(200),componentRole:z.literal('LUMINAIRE_LIGHT_SOURCE')}).strict();
const mapping=z.object({kind:z.literal('HUMAN_REVIEWED_LIGHTING_POSITION_MAPPING'),sourcePositionLabel:token,
 assertion:z.enum(['UNKNOWN','HUMAN_ASSERTED_SAME_LUMINAIRE_LIGHT_SOURCE_POSITION'])}).strict();
const target=z.object({checkId:key(120),inputManifestHash:sha,textStageContentHash:sha,textArtifactHash:sha,declarationContentHash:sha}).strict();
const fields={target,selection,identity,positionMapping:mapping,reference:key(1000,8)};
const claimInput=z.object(fields).strict(),claimDecision=z.object({...fields,declarationSnapshot:declaration}).strict();
const scopeInput=z.object({schemaVersion:z.literal(LIGHTING_TECHNOLOGY_REVIEW_VERSION),claims:z.array(claimInput).max(16)}).strict();
const scopeDecision=z.object({schemaVersion:z.literal(LIGHTING_TECHNOLOGY_REVIEW_VERSION),claims:z.array(claimDecision).max(16)}).strict();
export type MatrixLightingTechnologyScopeInput=z.infer<typeof scopeInput>;
export type MatrixLightingTechnologyScopeDecision=z.infer<typeof scopeDecision>;
export type MatrixLightingTechnologyReviewClaimInput=z.infer<typeof claimInput>;
export type MatrixLightingTechnologyReviewClaimDecision=z.infer<typeof claimDecision>;
export const matrixLightingTechnologyIdentitySchema=identity;
export const matrixLightingTechnologyPositionMappingSchema=mapping;
export const matrixLightingTechnologySelectionSchema=selection;
export const matrixLightingTechnologyTargetSchema=target;
export const matrixLightingTechnologyDeclarationSchema=declaration;
export const matrixLightingTechnologyReviewClaimInputSchema=claimInput;
export const matrixLightingTechnologyReviewClaimDecisionSchema=claimDecision;
export const matrixLightingTechnologyScopeInputSchema=scopeInput;
export const matrixLightingTechnologyScopeDecisionSchema=scopeDecision;
/** Explicit deep request projection. Node callers must native-preflight first.
 * This browser operation performs no original/source/hash authentication. */
export function lightingTechnologyScopeDecisionToInput(scope:MatrixLightingTechnologyScopeDecision):MatrixLightingTechnologyScopeInput{
 const saved=scopeDecision.parse(scope);
 return scopeInput.parse({schemaVersion:saved.schemaVersion,claims:saved.claims.map(c=>({
  target:{checkId:c.target.checkId,inputManifestHash:c.target.inputManifestHash,textStageContentHash:c.target.textStageContentHash,
   textArtifactHash:c.target.textArtifactHash,declarationContentHash:c.target.declarationContentHash},
  selection:{pageNumber:c.selection.pageNumber,fragments:c.selection.fragments.map(f=>({sourcePath:[...f.sourcePath],rawText:f.rawText}))},
  identity:{entityKey:c.identity.entityKey,buildingKey:c.identity.buildingKey,systemKey:c.identity.systemKey,positionKey:c.identity.positionKey,componentRole:c.identity.componentRole},
  positionMapping:{kind:c.positionMapping.kind,sourcePositionLabel:c.positionMapping.sourcePositionLabel,assertion:c.positionMapping.assertion},reference:c.reference,
 }))});
}
