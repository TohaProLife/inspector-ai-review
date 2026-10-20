/** Node-only bounded source-local lighting review boundary. Internal snapshot
 * consistency does not replace reconstruction from authorized sealed origins. */
import {isProxy} from 'node:util/types';
import {matrixLightingTechnologyScopeInputSchema,matrixLightingTechnologyScopeDecisionSchema,
 type MatrixLightingTechnologyScopeInput,type MatrixLightingTechnologyScopeDecision} from '@inspector-ai/contracts';
import {assertInventoryReviewNative,validateInventoryReviewJsonBytes,InventoryReviewValidationError} from './matrix-inventory-review.js';
import {validateLightingTechnologyScopeRequest,projectLightingTechnologyScopeDecision} from './matrix-lighting-technology-comparison.js';

export class LightingTechnologyReviewValidationError extends Error{
 constructor(readonly code:'INVALID_INPUT'|'INPUT_LIMIT'|'DUPLICATE_DECLARATION'|'SNAPSHOT_MISMATCH'|'SOURCE_PROVENANCE_UNVERIFIED',message:string){super(message);}
}
function invalid(message:string):never{throw new LightingTechnologyReviewValidationError('INVALID_INPUT',message);}
function nativeError(error:unknown):never{
 if(error instanceof InventoryReviewValidationError)throw new LightingTechnologyReviewValidationError(error.code==='INPUT_LIMIT'?'INPUT_LIMIT':'INVALID_INPUT',error.message);
 throw error;
}
/** Complete parent budget, never16 independent per-claim allocations. */
export function assertLightingTechnologyReviewNative(raw:unknown,mode:'REQUEST'|'MATERIALIZED'='REQUEST'):void{
 try{assertInventoryReviewNative(raw,mode);}catch(error){nativeError(error);}
 // Descriptor-first generic preflight has established callback-free plain JSON.
 const pending:unknown[]=[raw];
 while(pending.length){const value=pending.pop();
  if(typeof value==='string'){let points=0;for(const _point of value)if(++points>2000000)throw new LightingTechnologyReviewValidationError('INPUT_LIMIT','Lighting review exceeds total bounded JSON limits');}
  else if(value&&typeof value==='object'){
   if(Array.isArray(value))pending.push(...value);else for(const [key,item] of Object.entries(value))pending.push(key,item);
  }
 }
}
export function assertLightingTechnologyMaterializedSourceReviewEnvelope(parent:unknown):void{assertLightingTechnologyReviewNative(parent,'MATERIALIZED');}
export function validateLightingTechnologyReviewJsonBytes(bytes:Buffer):void{
 if(isProxy(bytes)||!Buffer.isBuffer(bytes))invalid('UTF-8 JSON bytes required');
 try{validateInventoryReviewJsonBytes(bytes);}catch(error){nativeError(error);}
}
function noDuplicates(scope:MatrixLightingTechnologyScopeInput|MatrixLightingTechnologyScopeDecision):void{
 const seen=new Set<string>();for(const c of scope.claims){if(seen.has(c.target.declarationContentHash))
  throw new LightingTechnologyReviewValidationError('DUPLICATE_DECLARATION','Same lighting declaration claimed more than once');seen.add(c.target.declarationContentHash);}
}
export function parseLightingTechnologyScopeInput(raw:unknown):MatrixLightingTechnologyScopeInput{
 assertLightingTechnologyReviewNative(raw);const parsed=matrixLightingTechnologyScopeInputSchema.safeParse(raw);
 if(!parsed.success)invalid('Invalid lighting scope request shape');noDuplicates(parsed.data);
 const validated=validateLightingTechnologyScopeRequest(parsed.data);if(validated===null)invalid('Invalid lighting scope request');return validated;
}
export interface LightingTechnologySourceAssociation{sourceFileId:string;sourceSha256:string}
/** Includes UNKNOWN and unrelated claims. Source association is server-supplied. */
export function assertLightingTechnologySnapshotAssociations(scope:MatrixLightingTechnologyScopeDecision,source:LightingTechnologySourceAssociation):void{
 assertLightingTechnologyReviewNative({scope,source},'MATERIALIZED');const parsed=matrixLightingTechnologyScopeDecisionSchema.safeParse(scope);
 if(!parsed.success)invalid('Invalid lighting scope decision shape');
 // Reuse the exact source key and SHA schemas without fabricating a source artifact.
 const sourceShape=matrixLightingTechnologyScopeDecisionSchema.shape.claims.element.shape.declarationSnapshot;
 const keys=Object.keys(source??{});
 if(!source||keys.length!==2||!keys.includes('sourceFileId')||!keys.includes('sourceSha256')
  ||!sourceShape.shape.sourceFileId.safeParse(source.sourceFileId).success||!sourceShape.shape.sourceSha256.safeParse(source.sourceSha256).success)invalid('Exact enclosing source identity required');
 for(const c of parsed.data.claims)if(c.declarationSnapshot.sourceFileId!==source.sourceFileId||c.declarationSnapshot.sourceSha256!==source.sourceSha256)
  throw new LightingTechnologyReviewValidationError('SOURCE_PROVENANCE_UNVERIFIED','Lighting declaration does not belong to enclosing source');
}
/** Full standalone T63 hash/parser checks plus exact target/selection via T64.
 * Repository MUST still reconstruct every claim against retained full originals. */
export function parseLightingTechnologyScopeDecision(raw:unknown,source:LightingTechnologySourceAssociation):MatrixLightingTechnologyScopeDecision{
 assertLightingTechnologyReviewNative(raw,'MATERIALIZED');const parsed=matrixLightingTechnologyScopeDecisionSchema.safeParse(raw);
 if(!parsed.success)invalid('Invalid materialized lighting scope shape');assertLightingTechnologySnapshotAssociations(parsed.data,source);noDuplicates(parsed.data);
 if(projectLightingTechnologyScopeDecision(parsed.data)===null)throw new LightingTechnologyReviewValidationError('SNAPSHOT_MISMATCH','Lighting declaration full hash/target/selection mismatch');
 return parsed.data;
}
/** Omission adds no defaults/null/bytes to historical source-review preimages. */
export function lightingTechnologyScopeHashFields(scope:MatrixLightingTechnologyScopeDecision|undefined):
 {lightingTechnologyScope:MatrixLightingTechnologyScopeDecision}|Record<string,never>{return scope===undefined?{}:{lightingTechnologyScope:scope};}
