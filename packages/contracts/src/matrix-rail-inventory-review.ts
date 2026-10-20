/** Source-local reviewed rail inventory. Shape is neither authenticated source
 * reconstruction nor machine completeness, room identity or absence authority. */
import { z } from "zod";

export const RAIL_INVENTORY_REVIEW_VERSION = "matrix-odi120-rail-inventory-review-v1";
export const RAIL_INVENTORY_REVIEW_LIMITS = Object.freeze({ claims: 16, requestBytes: 524288,
  materializedBytes: 8000000, depth: 64, nodes: 200000, containerItems: 32768, lineCodepoints: 8192 });
type Box = [number, number, number, number];
const sha = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const positive = safeInteger.positive(), nonnegative = safeInteger.nonnegative();
const pyTrim = (s:string) => s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, "");
const scalar = (s:string) => {for (const c of s) {const n=c.codePointAt(0)!; if(n>=0xd800&&n<=0xdfff)return false;} return true;};
const sourceLine = (s:string) => scalar(s) && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s);
const key = (maximum:number) => z.string().refine(s=>sourceLine(s) && pyTrim(s)===s
  && [...s].length>=1 && [...s].length<=maximum, "Unchanged scalar identity string required");
const reference = z.string().refine(s=>sourceLine(s) && pyTrim(s)===s
  && [...s].length>=8 && [...s].length<=1000, "Reference requires8..1000 unchanged Unicode codepoints on one line");
const line = z.string().refine(s=>sourceLine(s) && !!pyTrim(s)
  && [...s].length<=RAIL_INVENTORY_REVIEW_LIMITS.lineCodepoints, "Complete original source line required");
const box = z.tuple([nonnegative,nonnegative,nonnegative,nonnegative]).refine(
  b=>b[0]<b[2]&&b[1]<b[3], "Positive box area required");
const fragment = z.object({pageNumber:positive,blockIndex:nonnegative,lineIndex:nonnegative,
  rawText:line,bboxMilliPoints:box}).strict();
const oneFragment = z.array(fragment).length(1);
const identity = z.object({entityKey:key(200),buildingKey:key(200),floorKey:key(200),roomKey:key(200),
  componentRole:z.literal("ACCESSIBLE_SANITARY_ROOM_RAIL_INVENTORY")}).strict();
const mapping = z.object({kind:z.literal("HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING"),sourceRoomToken:key(200),
  assertion:z.enum(["UNKNOWN","HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM"])}).strict();
const target = z.object({checkId:key(120),inputManifestHash:sha,textStageContentHash:sha,
  textArtifactHash:sha,inventoryContentHash:sha}).strict();
// Source-authenticated locator equality belongs to reconstruction, not guessed
// geometry. In particular, do not infer room identity from these original rows.
const selection = z.object({pageNumber:positive,regionBoxMilliPoints:box,
  headerFragments:oneFragment,scopeFragments:oneFragment,endFragments:oneFragment}).strict();
const sourceInventory = z.object({schemaVersion:z.literal("matrix-odi120-rail-inventory-source-v1"),
  extractorVersion:z.literal("matrix-odi120-rail-inventory-source-v1"),
  policyVersion:z.literal("matrix-odi120-rail-inventory-literals-v1"),
  sourceFileId:key(200),sourceSha256:sha,textArtifactHash:sha,stage:z.enum(["PD","RD"]),
  pageNumber:positive,widthMilliPoints:positive,heightMilliPoints:positive,regionBoxMilliPoints:box,
  headerFragments:oneFragment,scopeFragments:oneFragment,endFragments:oneFragment,roomToken:key(200),
  featureRows:z.array(z.object({featureKey:z.enum(["WC_FIXED_RAIL","WC_FOLDING_RAIL","BASIN_RAIL"]),
    fragments:z.array(fragment).min(1).max(3)}).strict()).min(1).max(3),
}).strict().superRefine((s,ctx)=>{
  const frame:Box=[0,0,s.widthMilliPoints,s.heightMilliPoints];
  if(!contains(frame,s.regionBoxMilliPoints))ctx.addIssue({code:"custom",message:"Snapshot region outside original page frame"});
  for(const f of [...s.headerFragments,...s.scopeFragments,...s.endFragments,...s.featureRows.flatMap(r=>r.fragments)]) {
    if(f.pageNumber!==s.pageNumber||!contains(frame,f.bboxMilliPoints))
      ctx.addIssue({code:"custom",message:"Snapshot fragment outside own original page/frame"});
  }
});
const claimFields={target,selection,identity,roomMapping:mapping,
  assertion:z.enum(["UNKNOWN","HUMAN_ASSERTED_COMPLETE"]),reference};
const claimInput=z.object(claimFields).strict();
const claimDecision=z.object({...claimFields,inventorySnapshot:sourceInventory}).strict();
const scopeInput=z.object({schemaVersion:z.literal(RAIL_INVENTORY_REVIEW_VERSION),
  claims:z.array(claimInput).max(RAIL_INVENTORY_REVIEW_LIMITS.claims)}).strict();
const scopeDecision=z.object({schemaVersion:z.literal(RAIL_INVENTORY_REVIEW_VERSION),
  claims:z.array(claimDecision).max(RAIL_INVENTORY_REVIEW_LIMITS.claims)}).strict();
function contains(a:Box,b:Box):boolean{return a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];}

export type MatrixRailRoomIdentity=z.infer<typeof identity>;
export type MatrixRailRoomMapping=z.infer<typeof mapping>;
export type MatrixRailInventoryFragment=z.infer<typeof fragment>;
export type MatrixRailInventorySelection=z.infer<typeof selection>;
export type MatrixRailInventoryTarget=z.infer<typeof target>;
export type MatrixRailSourceInventory=z.infer<typeof sourceInventory>;
export type MatrixRailInventoryReviewClaimInput=z.infer<typeof claimInput>;
export type MatrixRailInventoryReviewClaimDecision=z.infer<typeof claimDecision>;
export type MatrixRailInventoryScopeInput=z.infer<typeof scopeInput>;
export type MatrixRailInventoryScopeDecision=z.infer<typeof scopeDecision>;
export const matrixRailRoomIdentitySchema=identity;
export const matrixRailRoomMappingSchema=mapping;
export const matrixRailInventoryFragmentSchema=fragment;
export const matrixRailInventorySelectionSchema=selection;
export const matrixRailInventoryTargetSchema=target;
export const matrixRailSourceInventorySchema=sourceInventory;
export const matrixRailInventoryReviewClaimInputSchema=claimInput;
export const matrixRailInventoryReviewClaimDecisionSchema=claimDecision;
export const matrixRailInventoryScopeInputSchema=scopeInput;
export const matrixRailInventoryScopeDecisionSchema=scopeDecision;

/** Browser-safe exact projection. Caller must use Node native preflight before
 * parsing untrusted native objects. No server snapshot can enter the request. */
export function railInventoryScopeDecisionToInput(scope:MatrixRailInventoryScopeDecision):MatrixRailInventoryScopeInput {
  const saved=scopeDecision.parse(scope);
  return scopeInput.parse({schemaVersion:saved.schemaVersion,claims:saved.claims.map(c=>({
    target:{checkId:c.target.checkId,inputManifestHash:c.target.inputManifestHash,
      textStageContentHash:c.target.textStageContentHash,textArtifactHash:c.target.textArtifactHash,
      inventoryContentHash:c.target.inventoryContentHash},
    selection:{pageNumber:c.selection.pageNumber,regionBoxMilliPoints:[...c.selection.regionBoxMilliPoints],
      headerFragments:c.selection.headerFragments.map(copyFragment),scopeFragments:c.selection.scopeFragments.map(copyFragment),
      endFragments:c.selection.endFragments.map(copyFragment)},
    identity:{entityKey:c.identity.entityKey,buildingKey:c.identity.buildingKey,floorKey:c.identity.floorKey,
      roomKey:c.identity.roomKey,componentRole:c.identity.componentRole},
    roomMapping:{kind:c.roomMapping.kind,sourceRoomToken:c.roomMapping.sourceRoomToken,assertion:c.roomMapping.assertion},
    assertion:c.assertion,reference:c.reference,
  }))});
}
function copyFragment(f:MatrixRailInventoryFragment):MatrixRailInventoryFragment {
  return {pageNumber:f.pageNumber,blockIndex:f.blockIndex,lineIndex:f.lineIndex,rawText:f.rawText,
    bboxMilliPoints:[...f.bboxMilliPoints]};
}
