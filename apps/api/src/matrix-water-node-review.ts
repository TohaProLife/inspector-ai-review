/** Node-only bounded water-node review boundary. Internal consistency never
 * replaces authorized reconstruction from retained sealed original sources. */
import {isProxy} from 'node:util/types';
import {matrixWaterNodeScopeInputSchema,matrixWaterNodeScopeDecisionSchema,
 type MatrixWaterNodeScopeInput,type MatrixWaterNodeScopeDecision} from '@inspector-ai/contracts';
import {assertInventoryReviewNative,validateInventoryReviewJsonBytes,InventoryReviewValidationError} from './matrix-inventory-review.js';
import {waterNodeInventoryContentHash} from './matrix-water-node-source.js';
import {canonicalSourceDeclarationJson} from './matrix-source-declarations.js';

export class WaterNodeReviewValidationError extends Error {
 constructor(readonly code:'INVALID_INPUT'|'INPUT_LIMIT'|'DUPLICATE_INVENTORY'|'SNAPSHOT_MISMATCH'|'SOURCE_PROVENANCE_UNVERIFIED',message:string){super(message);}
}
function invalid(message:string):never{throw new WaterNodeReviewValidationError('INVALID_INPUT',message);}
function limit():never{throw new WaterNodeReviewValidationError('INPUT_LIMIT','Water-node review exceeds total bounded JSON limits');}
function nativeError(error:unknown):never{
 if(error instanceof InventoryReviewValidationError)
  throw new WaterNodeReviewValidationError(error.code==='INPUT_LIMIT'?'INPUT_LIMIT':'INVALID_INPUT',error.message);
 throw error;
}
/** Native preflight before getters/schema/canonicalization. One COMPLETE parent
 * REQUEST512KiB or MATERIALIZED8M budget, not16 separate per-claim budgets. */
export function assertWaterNodeReviewNative(raw:unknown,mode:'REQUEST'|'MATERIALIZED'='REQUEST'):void{
 try{assertInventoryReviewNative(raw,mode);}catch(error){nativeError(error);}
 // The generic guard proved descriptor-only plain JSON. Now count Unicode
 // codepoints of every original string and key before downstream processing.
 const pending:unknown[]=[raw];
 while(pending.length){const value=pending.pop();
  if(typeof value==='string'){let points=0;for(const _point of value)if(++points>2000000)limit();}
  else if(value&&typeof value==='object'){
   if(Array.isArray(value))pending.push(...value);
   else for(const [key,item] of Object.entries(value))pending.push(key,item);
  }
 }
}
export function assertWaterNodeMaterializedSourceReviewEnvelope(parentReviewHashBody:unknown):void{
 assertWaterNodeReviewNative(parentReviewHashBody,'MATERIALIZED');
}
export function validateWaterNodeReviewJsonBytes(bytes:Buffer):void{
 if(isProxy(bytes)||!Buffer.isBuffer(bytes))invalid('UTF-8 JSON bytes required');
 try{validateInventoryReviewJsonBytes(bytes);}catch(error){nativeError(error);}
}
function noDuplicates(scope:MatrixWaterNodeScopeInput|MatrixWaterNodeScopeDecision):void{
 const seen=new Set<string>();
 for(const claim of scope.claims){
  if(seen.has(claim.target.inventoryContentHash))
   throw new WaterNodeReviewValidationError('DUPLICATE_INVENTORY','Same water-node inventory claimed more than once');
  seen.add(claim.target.inventoryContentHash);
 }
}
export function parseWaterNodeScopeInput(raw:unknown):MatrixWaterNodeScopeInput{
 assertWaterNodeReviewNative(raw);
 const result=matrixWaterNodeScopeInputSchema.safeParse(raw);
 if(!result.success)invalid('Invalid water-node request shape');
 noDuplicates(result.data);return result.data;
}
export interface WaterNodeSourceAssociation{sourceFileId:string;sourceSha256:string}
const trim=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
/** Includes UNKNOWN/unrelated claims. Association must be supplied by the
 * authenticated server loader, never accepted as client authority. */
export function assertWaterNodeSnapshotAssociations(scope:MatrixWaterNodeScopeDecision,source:WaterNodeSourceAssociation):void{
 assertWaterNodeReviewNative({scope,source},'MATERIALIZED');
 const parsed=matrixWaterNodeScopeDecisionSchema.safeParse(scope);
 if(!parsed.success)invalid('Invalid water-node snapshot shape');
 const keys=Object.keys(source??{});
 if(!source||keys.length!==2||!keys.includes('sourceFileId')||!keys.includes('sourceSha256')
  ||typeof source.sourceFileId!=='string'||typeof source.sourceSha256!=='string'
  ||[...source.sourceFileId].length<1||[...source.sourceFileId].length>200||trim(source.sourceFileId)!==source.sourceFileId
  ||/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(source.sourceFileId)
  ||!/^[a-f0-9]{64}(?![\s\S])/u.test(source.sourceSha256))invalid('Exact enclosing source identity required');
 for(const c of parsed.data.claims)
  if(c.inventorySnapshot.sourceFileId!==source.sourceFileId||c.inventorySnapshot.sourceSha256!==source.sourceSha256)
   throw new WaterNodeReviewValidationError('SOURCE_PROVENANCE_UNVERIFIED','Water-node snapshot does not belong to enclosing source');
}
/** Validate shape, exact source association and internal full hashes/locators.
 * Caller still MUST independently reconstruct every claim before storing/using. */
export function parseWaterNodeScopeDecision(raw:unknown,source:WaterNodeSourceAssociation):MatrixWaterNodeScopeDecision{
 assertWaterNodeReviewNative(raw,'MATERIALIZED');
 const result=matrixWaterNodeScopeDecisionSchema.safeParse(raw);
 if(!result.success)invalid('Invalid materialized water-node shape');
 assertWaterNodeSnapshotAssociations(result.data,source);noDuplicates(result.data);
 for(const claim of result.data.claims){const snap=claim.inventorySnapshot;
  if(waterNodeInventoryContentHash(snap)!==claim.target.inventoryContentHash||snap.textArtifactHash!==claim.target.textArtifactHash
   ||canonicalSourceDeclarationJson(claim.selection)!==canonicalSourceDeclarationJson({pageNumber:snap.pageNumber,
    regionBoxMilliPoints:snap.regionBoxMilliPoints,headerFragments:snap.headerFragments,
    scopeFragments:snap.scopeFragments,endFragments:snap.endFragments}))
   throw new WaterNodeReviewValidationError('SNAPSHOT_MISMATCH','Water-node full inventory/target/selection mismatch');
 }
 return result.data;
}
/** Omission contributes no bytes/defaults/null to historical review preimages. */
export function waterNodeScopeHashFields(scope:MatrixWaterNodeScopeDecision|undefined):
 {waterNodeScope:MatrixWaterNodeScopeDecision}|Record<string,never>{
 return scope===undefined?{}:{waterNodeScope:scope};
}
