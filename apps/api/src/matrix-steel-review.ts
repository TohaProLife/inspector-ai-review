/** Node source-local boundary. Repository must reconstruct every retained original. */
import {isProxy} from 'node:util/types';
import type {SteelComparisonScopeRequest,SteelComparisonScopeDecision} from '@inspector-ai/contracts';
import {matrixSteelComparisonScopeInputSchema,matrixSteelComparisonScopeDecisionSchema,matrixSteelComparisonSourceKeySchema} from '@inspector-ai/contracts';
import {assertInventoryReviewNative,InventoryReviewValidationError} from './matrix-inventory-review.js';
import {validateSteelComparisonScopeRequest,projectSteelComparisonScopeDecision} from './matrix-steel-comparison.js';

export class SteelComparisonReviewValidationError extends Error{
 constructor(readonly code:'INVALID_INPUT'|'INPUT_LIMIT'|'DUPLICATE_DECLARATION'|'SNAPSHOT_MISMATCH'|'SOURCE_PROVENANCE_UNVERIFIED',message:string){super(message);this.name='SteelComparisonReviewValidationError';}
}
function fail(code:SteelComparisonReviewValidationError['code'],message:string):never{throw new SteelComparisonReviewValidationError(code,message);}
/** Charge the complete parent envelope once; descriptor-first admission runs before traversal. */
export function assertSteelComparisonReviewNative(raw:unknown,mode:'REQUEST'|'MATERIALIZED'='REQUEST'):void{
 try{assertInventoryReviewNative(raw,mode);}catch(error){
  if(error instanceof InventoryReviewValidationError)fail(error.code==='INPUT_LIMIT'?'INPUT_LIMIT':'INVALID_INPUT',error.message);
  throw error;
 }
 const pending:unknown[]=[raw];
 while(pending.length){const value=pending.pop();
  if(typeof value==='string'){let points=0;for(const _point of value)if(++points>2000000)fail('INPUT_LIMIT','Steel review string exceeds native bound');}
  else if(value&&typeof value==='object'){
   if(Array.isArray(value))pending.push(...value);
   else for(const [key,item] of Object.entries(value)){
    if(!/^[\x00-\x7f]*$/.test(key))fail('INVALID_INPUT','ASCII object keys required');pending.push(key,item);
   }
  }
 }
}
function noDuplicates(scope:SteelComparisonScopeRequest|SteelComparisonScopeDecision):void{
 const seen=new Set<string>();for(const claim of scope.claims){if(seen.has(claim.target.declarationId))fail('DUPLICATE_DECLARATION','Steel declaration claimed more than once');seen.add(claim.target.declarationId);}
}
export function parseSteelComparisonScopeInput(raw:unknown):SteelComparisonScopeRequest{
 assertSteelComparisonReviewNative(raw);const parsed=matrixSteelComparisonScopeInputSchema.safeParse(raw);
 if(!parsed.success)fail('INVALID_INPUT','Invalid steel scope request');noDuplicates(parsed.data);
 const request=validateSteelComparisonScopeRequest(parsed.data);if(request===null)fail('INVALID_INPUT','Steel scope request failed exact validation');return request;
}
export function parseSteelComparisonScopeDecision(raw:unknown,source:{sourceFileId:string;sourceSha256:string}):SteelComparisonScopeDecision{
 assertSteelComparisonReviewNative({scope:raw,source},'MATERIALIZED');
 const parsed=matrixSteelComparisonScopeDecisionSchema.safeParse(raw);if(!parsed.success)fail('INVALID_INPUT','Invalid steel scope decision');
 // Do not inspect an untrusted association before native admission.
 if(!source||isProxy(source)||Object.keys(source).length!==2||!Object.hasOwn(source,'sourceFileId')||!Object.hasOwn(source,'sourceSha256')
  ||!matrixSteelComparisonSourceKeySchema.safeParse(source.sourceFileId).success
  ||typeof source.sourceSha256!=='string'||!/^[a-f0-9]{64}$(?![\s\S])/u.test(source.sourceSha256))fail('INVALID_INPUT','Exact source association required');
 noDuplicates(parsed.data);
 for(const claim of parsed.data.claims)if(claim.declarationSnapshot.sourceFileId!==source.sourceFileId||claim.declarationSnapshot.sourceSha256!==source.sourceSha256)
  fail('SOURCE_PROVENANCE_UNVERIFIED','Steel declaration belongs to another source');
 if(projectSteelComparisonScopeDecision(parsed.data)===null)fail('SNAPSHOT_MISMATCH','Steel declaration hash or target mismatch');
 return parsed.data;
}
/** Omission must add no default or null to any historical hash preimage. */
export function steelComparisonScopeHashFields(scope:SteelComparisonScopeDecision|undefined):{steelComparisonScope:SteelComparisonScopeDecision}|Record<string,never>{
 return scope===undefined?{}:{steelComparisonScope:scope};
}
