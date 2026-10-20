/** Node-only bounded validation for the separate rail inventory review sibling.
 * Snapshot consistency is not original PDF, DB review, stage or actor authority. */
import { matrixRailInventoryScopeInputSchema, matrixRailInventoryScopeDecisionSchema,
  type MatrixRailInventoryScopeInput, type MatrixRailInventoryScopeDecision } from "@inspector-ai/contracts";
import { assertInventoryReviewNative, validateInventoryReviewJsonBytes,
  InventoryReviewValidationError } from "./matrix-inventory-review.js";
import { railInventoryContentHash } from "./matrix-rail-inventory-source.js";
import { canonicalSourceDeclarationJson } from "./matrix-source-declarations.js";

export class RailInventoryReviewValidationError extends Error {
  constructor(readonly code:"INVALID_INPUT"|"INPUT_LIMIT"|"DUPLICATE_INVENTORY"|"SNAPSHOT_MISMATCH"
    |"SOURCE_PROVENANCE_UNVERIFIED", message:string){super(message);}
}
function invalid(message:string):never {throw new RailInventoryReviewValidationError("INVALID_INPUT",message);}
const limit=():never=>{throw new RailInventoryReviewValidationError("INPUT_LIMIT","Rail inventory review exceeds total bounded JSON limits");};
function nativeError(error:unknown):never {
  if(error instanceof InventoryReviewValidationError)
    throw new RailInventoryReviewValidationError(error.code==="INPUT_LIMIT"?"INPUT_LIMIT":"INVALID_INPUT",error.message);
  throw error;
}
/** Complete parent request<=512KiB / complete materialized source-review<=8MB.
 * No per-claim multiplication. Run before schema parsing or getter traversal. */
export function assertRailInventoryReviewNative(raw:unknown, mode:"REQUEST"|"MATERIALIZED"="REQUEST"):void {
  try{assertInventoryReviewNative(raw,mode);}catch(error){nativeError(error);}
  // Reused guard already proved plain descriptor-only acyclic JSON and safe
  // iteration; preserve portable per-string2M-codepoint budget as well.
  const pending:unknown[]=[raw];
  while(pending.length){const value=pending.pop();
    if(typeof value==="string") {let count=0;for(const _c of value)if(++count>2000000)limit();}
    else if(value&&typeof value==="object") {
      if(Array.isArray(value))pending.push(...value);
      else for(const [key,item] of Object.entries(value)){pending.push(key,item);}
    }
  }
}
export function assertRailMaterializedSourceReviewEnvelope(parentReviewHashBody:unknown):void {
  assertRailInventoryReviewNative(parentReviewHashBody,"MATERIALIZED");
}
export function validateRailInventoryReviewJsonBytes(bytes:Buffer):void {
  try{validateInventoryReviewJsonBytes(bytes);}catch(error){nativeError(error);}
}
function noDuplicates(scope:MatrixRailInventoryScopeInput|MatrixRailInventoryScopeDecision):void {
  const seen=new Set<string>();
  for(const claim of scope.claims){
    if(seen.has(claim.target.inventoryContentHash))
      throw new RailInventoryReviewValidationError("DUPLICATE_INVENTORY","Same rail inventory claimed more than once");
    seen.add(claim.target.inventoryContentHash);
  }
}
export function parseRailInventoryScopeInput(raw:unknown):MatrixRailInventoryScopeInput {
  assertRailInventoryReviewNative(raw);
  const parsed=matrixRailInventoryScopeInputSchema.safeParse(raw);
  if(!parsed.success)invalid("Invalid rail inventory request shape");
  noDuplicates(parsed.data);return parsed.data;
}
export interface RailInventorySourceAssociation {sourceFileId:string;sourceSha256:string}
/** Every claim, including UNKNOWN/unrelated identities, must name enclosing
 * source. Context comes from authenticated source loader, never client trust. */
export function assertRailInventorySnapshotAssociations(scope:MatrixRailInventoryScopeDecision,
  source:RailInventorySourceAssociation):void {
  assertRailInventoryReviewNative({scope,source},"MATERIALIZED");
  const parsed=matrixRailInventoryScopeDecisionSchema.safeParse(scope);
  if(!parsed.success)invalid("Invalid rail inventory snapshot shape");
  const keys=Object.keys(source??{});
  if(!source||keys.length!==2||!keys.includes("sourceFileId")||!keys.includes("sourceSha256")
    ||typeof source.sourceFileId!=="string"||typeof source.sourceSha256!=="string"
    ||![...source.sourceFileId].length||[...source.sourceFileId].length>200
    ||source.sourceFileId.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,"")!==source.sourceFileId
    ||/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(source.sourceFileId)
    ||!/^[a-f0-9]{64}(?![\s\S])/u.test(source.sourceSha256))invalid("Enclosing source identity required");
  for(const c of parsed.data.claims)if(c.inventorySnapshot.sourceFileId!==source.sourceFileId
    ||c.inventorySnapshot.sourceSha256!==source.sourceSha256)
    throw new RailInventoryReviewValidationError("SOURCE_PROVENANCE_UNVERIFIED","Rail snapshot does not belong to enclosing source");
}
/** Structural/internal hashes only. Caller MUST independently reconstruct ALL
 * inventories from retained sealed original source/text before storing/using. */
export function parseRailInventoryScopeDecision(raw:unknown, source:RailInventorySourceAssociation):MatrixRailInventoryScopeDecision {
  assertRailInventoryReviewNative(raw,"MATERIALIZED");
  const parsed=matrixRailInventoryScopeDecisionSchema.safeParse(raw);
  if(!parsed.success)invalid("Invalid materialized rail inventory shape");
  assertRailInventorySnapshotAssociations(parsed.data,source);
  noDuplicates(parsed.data);
  for(const c of parsed.data.claims){const s=c.inventorySnapshot;
    if(railInventoryContentHash(s)!==c.target.inventoryContentHash||s.textArtifactHash!==c.target.textArtifactHash
      ||canonicalSourceDeclarationJson(c.selection)!==canonicalSourceDeclarationJson({pageNumber:s.pageNumber,
        regionBoxMilliPoints:s.regionBoxMilliPoints,headerFragments:s.headerFragments,
        scopeFragments:s.scopeFragments,endFragments:s.endFragments}))
      throw new RailInventoryReviewValidationError("SNAPSHOT_MISMATCH","Rail inventory target/hash/full selection mismatch");
  }
  return parsed.data;
}
/** Omitted sibling contributes zero bytes to legacy source-review preimage. */
export function railInventoryScopeHashFields(scope:MatrixRailInventoryScopeDecision|undefined):
  {railInventoryScope:MatrixRailInventoryScopeDecision}|Record<string,never> {
  return scope===undefined?{}:{railInventoryScope:scope};
}
