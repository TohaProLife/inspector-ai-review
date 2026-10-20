/** Generated from frozen matrix-steel-comparison.schema.json; no original or actor authentication here. */
import {z} from 'zod';
import type {SteelComparisonScopeRequest,SteelComparisonScopeDecision} from './matrix-steel-comparison.js';
const scalar=(s:string)=>{for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
const originalString=(min:number,max:number)=>z.string().refine(s=>scalar(s)&&[...s].length>=min&&[...s].length<=max,'Original scalar string required');
const unchangedKey=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'')===s&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s);
const shape_sha = originalString(0,2000000).regex(new RegExp("^[a-f0-9]{64}$","u"));
const shape_target = z.object({"checkId":originalString(1,120),"inputManifestHash":shape_sha,"textStageContentHash":shape_sha,"textArtifactHash":shape_sha,"declarationId":shape_sha}).strict();
const shape_key = originalString(1,200).refine(unchangedKey,"Unchanged scalar key required");
const shape_identity = z.object({"entityKey":shape_key,"buildingKey":shape_key,"zoneKey":shape_key,"memberKey":shape_key,"componentRole":z.literal("DISTRIBUTION_BELT_I_BEAM")}).strict();
const shape_bbox = z.tuple([z.number().int().min(0).max(9007199254740991),z.number().int().min(0).max(9007199254740991),z.number().int().min(0).max(9007199254740991),z.number().int().min(0).max(9007199254740991)]);
const shape_fragment = z.object({"pageNumber":z.number().int().min(1).max(512),"blockIndex":z.number().int().min(0).max(9007199254740991),"lineIndex":z.number().int().min(0).max(9007199254740991),"rawText":originalString(1,2000000),"bboxMilliPoints":shape_bbox}).strict();
const shape_reference = originalString(8,1000).refine(unchangedKey,"Unchanged scalar key required");
const shape_memberMapping = z.object({"assertion":z.enum(["UNKNOWN", "HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER"]),"identity":shape_identity,"scopeFragments":z.array(shape_fragment).min(1).max(16),"reference":shape_reference}).strict();
const shape_claimRequest = z.object({"target":shape_target,"identity":shape_identity,"memberMapping":shape_memberMapping}).strict();
const shape_scopeRequest = z.object({"schemaVersion":z.literal("matrix-kr056-steel-review-v1"),"claims":z.array(shape_claimRequest).min(0).max(16)}).strict();
const shape_originalSteelScope = z.union([z.object({"role":z.literal("DISTRIBUTION_BELT_I_BEAMS"),"productKind":z.literal("I_BEAM"),"profile":z.literal("70Б3"),"count":z.literal(3),"tier":z.literal(2),"productStandard":z.literal("ГОСТ Р 35087-2024"),"gradeStandard":z.literal("ГОСТ 27772-2015")}).strict(),z.object({"role":z.literal("I_BEAM_GENERIC_DECLARATION"),"productKind":z.literal("I_BEAM"),"profile":z.null(),"count":z.null(),"tier":z.null(),"productStandard":z.literal("ГОСТ Р 57837-2017"),"gradeStandard":z.literal("ГОСТ 27772-2021")}).strict()]);
const shape_declaration = z.object({"schemaVersion":z.literal("matrix-source-declaration-v1"),"id":shape_sha,"kind":z.literal("SOURCE_AUTHORED_STEEL_DECLARATION"),"extractorVersion":z.literal("matrix-steel-prose-v1"),"sourceFileId":shape_key,"sourceSha256":shape_sha,"textArtifactHash":shape_sha,"stage":z.enum(["PD", "RD"]),"pageNumber":z.number().int().min(1).max(512),"widthMilliPoints":z.number().int().min(1).max(9007199254740991),"heightMilliPoints":z.number().int().min(1).max(9007199254740991),"value":z.enum(["С245", "С345"]),"rawValue":z.enum(["C245", "С245", "C345", "С345"]),"rawUnit":z.null(),"canonicalUnit":z.literal("steel_catalog_example"),"entityKey":z.null(),"applicabilityStatus":z.literal("UNREVIEWED"),"primaryFragments":z.array(shape_fragment).min(1).max(2),"scopeFragments":z.array(shape_fragment).min(3).max(3),"productScope":shape_originalSteelScope}).strict();
const shape_claimDecision = z.object({"target":shape_target,"identity":shape_identity,"memberMapping":shape_memberMapping,"declarationSnapshot":shape_declaration}).strict();
const shape_scopeDecision = z.object({"schemaVersion":z.literal("matrix-kr056-steel-review-v1"),"claims":z.array(shape_claimDecision).min(0).max(16)}).strict();

export const matrixSteelComparisonScopeInputSchema=shape_scopeRequest;
export const matrixSteelComparisonScopeDecisionSchema=shape_scopeDecision;
export const matrixSteelComparisonIdentitySchema=shape_identity;
export const matrixSteelComparisonTargetSchema=shape_target;
export const matrixSteelComparisonSourceKeySchema=shape_key;
/** Detached browser projection. Node callers must native-preflight before this operation. */
export function steelComparisonScopeDecisionToInput(raw:SteelComparisonScopeDecision):SteelComparisonScopeRequest{
 const scope=matrixSteelComparisonScopeDecisionSchema.parse(raw);
 return matrixSteelComparisonScopeInputSchema.parse({schemaVersion:scope.schemaVersion,claims:scope.claims.map(({declarationSnapshot:_snapshot,...request})=>request)});
}
