/** Generated from canonical matrix-steel-applicability-review.schema.json (a74d425950d416b4cc50502472b7d602984efa609e7df7c9059db1778ebb1a52).
 * Browser shape validation only. Hash consistency, original and actor authentication belong to distinct server boundaries. */
import {z} from 'zod';
const scalar=(s:string)=>{for(const c of s){const cp=c.codePointAt(0)!;if(cp>=0xd800&&cp<=0xdfff)return false;}return true;};
const pyTrim=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const raw=(minimum:number,maximum:number)=>z.string().refine(s=>scalar(s)&&[...s].length>=minimum&&[...s].length<=maximum,'Original scalar string required');
const key=(minimum:number,maximum:number)=>raw(minimum,maximum).refine(s=>pyTrim(s)===s&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s),'Unchanged clean key/reference required');
const sha=z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const canonicalUtcMilliseconds=(s:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?![\s\S])/u.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const steelKey=key(1,200);
const steelIdentity=z.object({"entityKey":steelKey,"buildingKey":steelKey,"zoneKey":steelKey,"memberKey":steelKey,"componentRole":z.literal("DISTRIBUTION_BELT_I_BEAM")}).strict();
const steelSha=sha;
const steelTarget=z.object({"checkId":key(1,120),"inputManifestHash":steelSha,"textStageContentHash":steelSha,"textArtifactHash":steelSha,"declarationId":steelSha}).strict();
const steelProductScope=z.object({"role":z.enum(["DISTRIBUTION_BELT_I_BEAMS","I_BEAM_GENERIC_DECLARATION"]),"productKind":z.literal("I_BEAM"),"profile":z.union([key(1,200),z.null()]),"count":z.union([z.number().int().min(1).max(9007199254740991),z.null()]),"tier":z.union([z.number().int().min(1).max(9007199254740991),z.null()]),"productStandard":key(1,200),"gradeStandard":key(1,200)}).strict();
const steelReferencePair=z.object({"sourceFileId":steelKey,"sourceSha256":steelSha,"reviewDecisionId":steelKey,"reviewContentHash":steelSha,"target":steelTarget,"productScope":steelProductScope}).strict();
const steelReference=key(8,1000);
const steelBbox=z.tuple([z.number().int().min(0).max(9007199254740991),z.number().int().min(0).max(9007199254740991),z.number().int().min(0).max(9007199254740991),z.number().int().min(0).max(9007199254740991)]);
const steelFragment=z.object({"pageNumber":z.number().int().min(1).max(512),"blockIndex":z.number().int().min(0).max(9007199254740991),"lineIndex":z.number().int().min(0).max(9007199254740991),"rawText":raw(1,2000000),"bboxMilliPoints":steelBbox}).strict();
const steelBasis=z.object({"reference":steelReference,"expectedScopeFragments":z.array(steelFragment).min(1).max(16),"actualScopeFragments":z.array(steelFragment).min(1).max(16),"catalogScope":z.literal("ONLY_KR056_EXPLICIT_C345_TO_C245"),"standardsTreatment":z.literal("RETAINED_DIFFERENCES_HUMAN_REVIEWED_NO_NORMATIVE_EQUIVALENCE"),"profilesTreatment":z.literal("RETAINED_DIFFERENCES_NO_GEOMETRY_OR_STRENGTH_RANK")}).strict();
const reviewRequest=z.object({"schemaVersion":z.literal("matrix-kr056-steel-applicability-review-v1"),"status":z.enum(["UNKNOWN","APPROVED","WITHDRAWN"]),"identity":steelIdentity,"expected":steelReferencePair,"actual":steelReferencePair,"basis":steelBasis,"expectedReviewHash":z.union([steelSha,z.null()])}).strict();
const steelApplicabilityDecision=z.object({"schemaVersion":z.literal("matrix-kr056-steel-applicability-decision-v1"),"decisionId":steelKey,"contentHash":steelSha,"objectId":steelKey,"status":z.enum(["UNKNOWN","APPROVED","WITHDRAWN"]),"authorityKind":z.literal("HUMAN_REVIEWED_DECLARATION_APPLICABILITY"),"identity":steelIdentity,"expected":steelReferencePair,"actual":steelReferencePair,"basis":steelBasis}).strict();
const reviewDecision=z.object({"id":z.uuid(),"objectId":steelKey,"actorId":z.uuid(),"previousReviewHash":z.union([steelSha,z.null()]),"contentHash":steelSha,"projection":steelApplicabilityDecision,"createdAt":z.string().refine(canonicalUtcMilliseconds,"Canonical UTC milliseconds required")}).strict();
export const matrixSteelApplicabilityReviewInputSchema=reviewRequest;
export const matrixSteelApplicabilityReviewDecisionSchema=reviewDecision;
export type SteelApplicabilityReviewInput=z.infer<typeof matrixSteelApplicabilityReviewInputSchema>;
export type SteelApplicabilityReviewDecision=z.infer<typeof matrixSteelApplicabilityReviewDecisionSchema>;
export const STEEL_APPLICABILITY_REVIEW_LIMITS=Object.freeze({requestBytes:524288,materializedBytes:8000000,nodes:200000,depth:64,containerItems:32768,stringCodepoints:2000000,latestPairs:16});
