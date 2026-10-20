/** Pure journal construction and integrity. Repository must authenticate actor,
 * exact current/historical reviews, original PDF bytes, latest pair CAS and access. */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {SteelComparisonExecutionLoaderPackage,SteelComparisonIdentity} from '@inspector-ai/contracts';
import {matrixSteelApplicabilityReviewInputSchema,matrixSteelApplicabilityReviewDecisionSchema,STEEL_APPLICABILITY_REVIEW_LIMITS,
 type SteelApplicabilityReviewInput,type SteelApplicabilityReviewDecision} from '@inspector-ai/contracts';
import {steelComparisonExecutionInternal as internal,compareKr056SteelDeclarations} from './matrix-steel-comparison.js';
import {validateSteelComparisonLoaderPackage} from './matrix-steel-execution.js';

export type {SteelApplicabilityReviewInput,SteelApplicabilityReviewDecision};
export interface SteelApplicabilityReviewMaterializationContext {
 objectId:string; actorId:string; id:string; createdAt:string;
 previous:SteelApplicabilityReviewDecision|null;
 package:SteelComparisonExecutionLoaderPackage;
}
/** Shorter compatibility name for repository callers. */
export type SteelApplicabilityMaterializationContext=SteelApplicabilityReviewMaterializationContext;
export interface SteelApplicabilityPairKeyInput {
 objectId:string; identity:SteelComparisonIdentity; expectedSourceFileId:string; actualSourceFileId:string;
}
export type SteelApplicabilityReviewValidationCode='INVALID_INPUT'|'INPUT_LIMIT'|'INVALID_DECISION'|'INVALID_PACKAGE'|'STALE_REVIEW'|'PAIR_MISMATCH'|'WITHDRAWAL_MISMATCH'|'APPROVAL_NOT_ELIGIBLE';
export class SteelApplicabilityReviewValidationError extends TypeError {
 constructor(public readonly code:SteelApplicabilityReviewValidationCode,message:string){super(message);this.name='SteelApplicabilityReviewValidationError';}
}
const fail=(code:SteelApplicabilityReviewValidationCode,message:string):never=>{throw new SteelApplicabilityReviewValidationError(code,message);};
/** The sole native admission path: descriptor-first, no proxy/getter callbacks. */
const admit=(raw:unknown,bytes:number=STEEL_APPLICABILITY_REVIEW_LIMITS.materializedBytes):string=>{
 const checked=internal.native(raw,bytes);
 return checked.status==='VALID'?checked.canonical:fail(checked.status==='LIMIT'?'INPUT_LIMIT':'INVALID_INPUT','Steel applicability native JSON rejected');
};
const detached=<T>(encoded:string):T=>JSON.parse(encoded) as T;
const encoded=(value:unknown)=>admit(value);
const same=(a:unknown,b:unknown)=>encoded(a)===encoded(b);
const hash=(value:unknown)=>createHash('sha256').update(encoded(value),'utf8').digest('hex');
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function shape<T>(schema:z.ZodType<T>,raw:unknown):T{
 const result=schema.safeParse(raw);return result.success?result.data:fail('INVALID_INPUT','Steel applicability DTO rejected');
}
/** Detached strict request; object/actor/projection fields cannot be supplied. */
export function parseSteelApplicabilityReviewInput(raw:unknown):SteelApplicabilityReviewInput {
 const value=detached<unknown>(admit(raw,STEEL_APPLICABILITY_REVIEW_LIMITS.requestBytes));
 return shape(matrixSteelApplicabilityReviewInputSchema,value);
}
function decision(value:unknown):SteelApplicabilityReviewDecision {
 const d=shape(matrixSteelApplicabilityReviewDecisionSchema,value);
 const {contentHash:projectionHash,...projectionBody}=d.projection;
 const {contentHash:journalHash,...journalBody}=d;
 if(d.id!==d.projection.decisionId
  ||hash({hashDomain:'matrix-kr056-steel-applicability-decision-json-v1',decision:projectionBody})!==projectionHash
  ||hash({hashDomain:'matrix-kr056-steel-applicability-review-journal-v1',decision:journalBody})!==journalHash)
  fail('INVALID_DECISION','Steel applicability decision ID/hash mismatch');
 return d;
}
/** Local shape/hash validation only; no authentication of the actor or original. */
export function validateSteelApplicabilityReviewDecision(raw:unknown):SteelApplicabilityReviewDecision {
 return decision(detached<unknown>(admit(raw)));
}
function pairKey(value:unknown):string {
 if(!exact(value,['objectId','identity','expectedSourceFileId','actualSourceFileId'])||!internal.identity(value.identity))return fail('INVALID_INPUT','Steel applicability pair DTO rejected');
 // Reuse exact frozen key semantics without synthetic origins or declarations.
 const sourceKey=matrixSteelApplicabilityReviewDecisionSchema.shape.objectId;
 for(const key of ['objectId','expectedSourceFileId','actualSourceFileId'])if(!sourceKey.safeParse(value[key]).success)fail('INVALID_INPUT','Steel applicability pair key rejected');
 return hash({hashDomain:'matrix-kr056-steel-applicability-pair-key-v1',...value});
}
/** Logical pair excludes mutable review and origin hashes, keeping one revoke chain. */
export function steelApplicabilityPairKey(raw:unknown):string {return pairKey(detached<unknown>(admit(raw)));}
const logical=(objectId:string,value:SteelApplicabilityReviewInput|SteelApplicabilityReviewDecision['projection'])=>pairKey({objectId,identity:value.identity,expectedSourceFileId:value.expected.sourceFileId,actualSourceFileId:value.actual.sourceFileId});
const eligibilityReasons=new Set(['NEGATIVE_SCOPE_UNVERIFIED','UNSUPPORTED_CATEGORY_TRANSITION']);
export function materializeSteelApplicabilityReview(rawInput:unknown,rawContext:unknown):SteelApplicabilityReviewDecision {
 const input=parseSteelApplicabilityReviewInput(rawInput);
 // Admit the ENTIRE context once before reading any field or invoking a validator.
 const context=detached<unknown>(admit(rawContext));
 if(!exact(context,['objectId','actorId','id','createdAt','previous','package']))return fail('INVALID_INPUT','Steel applicability context DTO rejected');
 const head=matrixSteelApplicabilityReviewDecisionSchema.pick({id:true,objectId:true,actorId:true,createdAt:true});
 const metadata=shape(head,{id:context.id,objectId:context.objectId,actorId:context.actorId,createdAt:context.createdAt});
 let pkg:SteelComparisonExecutionLoaderPackage;
 try{pkg=validateSteelComparisonLoaderPackage(context.package);}catch{fail('INVALID_PACKAGE','Steel applicability full retained package rejected');}
 if(pkg!.applicabilityDecisions.length!==0)fail('INVALID_PACKAGE','Steel applicability save requires an empty pair-decision list');
 if(input.expected.sourceFileId===input.actual.sourceFileId||input.expected.sourceSha256===input.actual.sourceSha256)
  fail('PAIR_MISMATCH','Steel applicability requires distinct original source IDs and SHA values');
 const previous=context.previous===null?null:decision(context.previous);
 if(input.expectedReviewHash!==(previous?.contentHash??null))fail('STALE_REVIEW','Steel applicability latest journal hash changed');
 if(previous&&(previous.objectId!==metadata.objectId||previous.projection.objectId!==pkg!.objectId
   ||logical(pkg!.objectId,previous.projection)!==logical(pkg!.objectId,input)))fail('PAIR_MISMATCH','Steel applicability previous journal belongs to another pair');
 if(previous&&previous.id===metadata.id)fail('INVALID_DECISION','Steel applicability decision ID must be fresh');
 if(input.status==='WITHDRAWN'){
  if(!previous)fail('WITHDRAWAL_MISMATCH','Steel applicability withdrawal requires the prior journal');
  for(const key of ['identity','expected','actual','basis'] as const)if(!same(input[key],previous!.projection[key]))fail('WITHDRAWAL_MISMATCH','Steel applicability withdrawal cannot retarget the previous decision');
 }
 const projectionBody={schemaVersion:'matrix-kr056-steel-applicability-decision-v1' as const,decisionId:metadata.id,objectId:pkg!.objectId,status:input.status,
  authorityKind:'HUMAN_REVIEWED_DECLARATION_APPLICABILITY' as const,identity:input.identity,expected:input.expected,actual:input.actual,basis:input.basis};
 const projection={...projectionBody,contentHash:hash({hashDomain:'matrix-kr056-steel-applicability-decision-json-v1',decision:projectionBody})};
 // No fabricated snapshot or dummy identity: exact new pair goes through full T70 retention/original reconstruction.
 let complete:SteelComparisonExecutionLoaderPackage;
 try{complete=validateSteelComparisonLoaderPackage({...pkg!,applicabilityDecisions:[projection]});}
 catch{fail('INVALID_PACKAGE','Steel applicability new projection is not bound to the retained originals');}
 if(input.status==='APPROVED'){
  const outcome=compareKr056SteelDeclarations({schemaVersion:'matrix-kr056-steel-comparison-input-v1',objectId:complete!.objectId,
   inputManifestHash:complete!.inputManifestHash,identity:input.identity,sources:complete!.sources,origins:complete!.origins,applicabilityDecisions:complete!.applicabilityDecisions});
  if(outcome.status!=='CANDIDATE'&&!eligibilityReasons.has(outcome.reasonCode))fail('APPROVAL_NOT_ELIGIBLE',`Steel applicability approval ineligible: ${outcome.reasonCode}`);
 }
 const body={...metadata,previousReviewHash:input.expectedReviewHash,projection};
 const result={...body,contentHash:hash({hashDomain:'matrix-kr056-steel-applicability-review-journal-v1',decision:body})};
 // Enforce the final materialized envelope as a whole, including server additions.
 return validateSteelApplicabilityReviewDecision(result);
}
