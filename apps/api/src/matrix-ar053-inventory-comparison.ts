/** Source-bound AR-053 declared-region comparison. Requires authenticated immutable repository projection. */
import { isProxy } from "node:util/types";
import { z } from "zod";
import { matrixInventoryScopeDecisionSchema, sourceSectionCodes } from "@inspector-ai/contracts";
import { reconstructAr053InventorySource, inventoryContentHash } from "./matrix-inventory-source.js";
import { canonicalSourceDeclarationJson } from "./matrix-source-declarations.js";

const VERSION="matrix-ar053-inventory-comparison-v1";
const LIMIT={depth:64,nodes:200000,bytes:8000000,points:2000000,items:32768};
const scalar=(s:string)=>{for(const c of s){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
const pyTrim=(s:string)=>s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,"");
const key=(max:number)=>z.string().refine(s=>pyTrim(s)===s&&!!s&&[...s].length<=max&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s));
const sha=z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const identityFields={entityKey:key(200),componentRole:z.literal("PARTITION_SLAB_JOINT"),componentKey:key(200),zoneKey:key(200),
  operatingModeKey:z.literal("DECLARED_NOISE_PROTECTION_MEASURES"),measurementBasisKey:z.literal("SOURCE_AUTHORED_MEASURE_MEMBERSHIP")};
const identitySchema=z.object(identityFields).strict();
const pageStages=z.record(z.string(),z.enum(["PD","RD","ID","UNRESOLVED"])).refine(v=>Object.keys(v).every(k=>/^[1-9][0-9]{0,15}(?![\s\S])/u.test(k)&&Number.isSafeInteger(Number(k))));
const reviewSchema=z.object({decisionId:key(200),contentHash:sha,objectId:key(200),sourceFileId:key(200),sourceSha256:sha,actorId:key(200),
  revisionStatus:z.enum(["CURRENT","SUPERSEDED","UNKNOWN"]),approvalStatus:z.enum(["APPROVED","UNAPPROVED","UNKNOWN"]),
  sectionCode:z.enum(sourceSectionCodes).nullable(),linkGroupId:key(120).nullable(),pageStages,inventoryScope:matrixInventoryScopeDecisionSchema.nullable()}).strict();
const sourceSchema=z.object({sourceFileId:key(200),sourceSha256:sha,stages:z.array(z.enum(["PD","RD","ID","UNRESOLVED"])).max(4).refine(a=>new Set(a).size===a.length),
  reviewSnapshot:z.object({decisionId:key(200),contentHash:sha}).strict().nullable(),review:reviewSchema.nullable()}).strict()
  .refine(source=>(source.review===null)===(source.reviewSnapshot===null));
const originSchema=z.object({checkId:key(120),objectId:key(200),sourceFileId:key(200),sourceSha256:sha,inputManifestHash:sha,textStageContentHash:sha,
  textArtifactHash:sha,textArtifact:z.custom<Record<string,unknown>>(value=>!!value&&typeof value==="object"&&!Array.isArray(value))}).strict();
const inputSchema=z.object({schemaVersion:z.literal("matrix-ar053-inventory-input-v1"),objectId:key(200),inputManifestHash:sha,
  identity:identitySchema,sources:z.array(sourceSchema).max(64),origins:z.array(originSchema).max(128)}).strict();
type Input=z.infer<typeof inputSchema>;type Source=Input["sources"][number];
type Claim=NonNullable<NonNullable<Source["review"]>["inventoryScope"]>["claims"][number];
type Match={source:Source;claim:Claim};
export type ComparisonResult={schemaVersion:typeof VERSION;status:"ABSTAIN";reasonCode:string;calibratedProbability:null}|{
  schemaVersion:typeof VERSION;status:"CANDIDATE";ruleId:"matrix-ar-053-declared_joint_damping_tape_omission";ruleVersion:"1";parameterCode:"AR-053";
  reasonCode:"DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION";calibratedProbability:null;comparisonScope:"REVIEWED_DECLARED_REGIONS_ONLY";
  identity:Input["identity"];expected:ReturnType<typeof reference>;actual:ReturnType<typeof reference>;missingFeatureKeys:["DAMPING_TAPE"]};
const abstain=(reasonCode:string):ComparisonResult=>({schemaVersion:VERSION,status:"ABSTAIN",reasonCode,calibratedProbability:null});
function native(input:unknown):"VALID"|"INVALID"|"LIMIT" {
  let nodes=0,bytes=0,limited=false;const parents=new Set<object>();const limit=()=>{limited=true;return false;};
  function visit(v:unknown,depth:number):boolean {
    if(++nodes>LIMIT.nodes||depth>LIMIT.depth)return limit();
    if(v===null||typeof v==="boolean")return true;
    if(typeof v==="number")return Number.isSafeInteger(v);
    if(typeof v==="string"){
      if(v.length>LIMIT.bytes)return limit();if(v.length>LIMIT.points){let points=0;for(const _ of v)if(++points>LIMIT.points)return limit();}
      if(!scalar(v))return false;bytes+=Buffer.byteLength(v,"utf8");return bytes>LIMIT.bytes?limit():true;
    }
    if(!v||typeof v!=="object"||isProxy(v)||parents.has(v))return false;
    const array=Array.isArray(v);if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))return false;
    const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);if(names.some(k=>typeof k!=="string"))return false;
    let keys:string[];
    if(array){const length=descriptors.length?.value;if(!Number.isSafeInteger(length)||length<0)return false;if(length>LIMIT.items)return limit();if(names.length!==length+1)return false;keys=Array.from({length},(_,i)=>String(i));}
    else{if(names.length>LIMIT.items)return limit();keys=names as string[];}
    parents.add(v);for(const k of keys){const d=descriptors[k];if(!d||!d.enumerable||!Object.hasOwn(d,"value")||(!array&&!visit(k,depth+1))||!visit(d.value,depth+1)){parents.delete(v);return false;}}
    parents.delete(v);return true;
  }
  try{return visit(input,0)?"VALID":limited?"LIMIT":"INVALID";}catch{return "INVALID";}
}
const originKey=(source:string,check:string)=>JSON.stringify([source,check]);
const sameIdentity=(claim:Claim,identity:Input["identity"])=>Object.keys(identityFields).every(k=>claim[k as keyof typeof identityFields]===identity[k as keyof typeof identityFields]);
function reference(match:Match){return {sourceFileId:match.source.sourceFileId,sourceSha256:match.source.sourceSha256,
  reviewDecisionId:match.source.review!.decisionId,reviewContentHash:match.source.review!.contentHash,inventoryContentHash:match.claim.target.inventoryContentHash};}

export function compareAr053Inventories(raw:unknown):ComparisonResult {
  const guard=native(raw);if(guard!=="VALID")return abstain(guard==="LIMIT"?"INPUT_LIMIT":"INVALID_INPUT");
  // Collection budgets apply before item DTO parsing; inner T40 snapshot shape bounds stay structural.
  if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
    const data=raw as Record<string,unknown>;
    if((Array.isArray(data.sources)&&data.sources.length>64)||(Array.isArray(data.origins)&&data.origins.length>128))return abstain("INPUT_LIMIT");
    let total=0;
    if(Array.isArray(data.sources))for(const s of data.sources)if(s&&typeof s==="object"&&!Array.isArray(s)){
      const review=(s as Record<string,unknown>).review;
      if(review&&typeof review==="object"&&!Array.isArray(review)){
        const scope=(review as Record<string,unknown>).inventoryScope;
        if(scope&&typeof scope==="object"&&!Array.isArray(scope)){
          const claims=(scope as Record<string,unknown>).claims;
          if(Array.isArray(claims)){if(claims.length>16)return abstain("INPUT_LIMIT");total+=claims.length;}
        }
      }
    }
    if(total>128)return abstain("INPUT_LIMIT");
  }
  // Zod records omit own __proto__ keys. Check the original map before parsing,
  // and preserve full origin artifacts above for the frozen source validator.
  if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
    const data=raw as Record<string,unknown>;
    if(Array.isArray(data.sources))for(const s of data.sources)if(s&&typeof s==="object"&&!Array.isArray(s)){
      const review=(s as Record<string,unknown>).review;
      if(review&&typeof review==="object"&&!Array.isArray(review)){
        const stages=(review as Record<string,unknown>).pageStages;
        if(stages&&typeof stages==="object"&&!Array.isArray(stages)
          &&Object.keys(stages).some(k=>!/^[1-9][0-9]{0,15}(?![\s\S])/u.test(k)||!Number.isSafeInteger(Number(k))))return abstain("INVALID_INPUT");
      }
    }
  }
  const parsed=inputSchema.safeParse(raw);if(!parsed.success)return abstain("INVALID_INPUT");const input=parsed.data;
  if(input.sources.reduce((n,s)=>n+(s.review?.inventoryScope?.claims.length??0),0)>128)return abstain("INPUT_LIMIT");
  const sources=new Map(input.sources.map(s=>[s.sourceFileId,s]));
  const origins=new Map(input.origins.map(o=>[originKey(o.sourceFileId,o.checkId),o]));
  if(sources.size!==input.sources.length||origins.size!==input.origins.length)return abstain("INVALID_INPUT");
  for(const origin of input.origins){const source=sources.get(origin.sourceFileId);
    if(!source||origin.objectId!==input.objectId||origin.sourceSha256!==source.sourceSha256)return abstain("SOURCE_PROVENANCE_UNVERIFIED");}
  for(const source of input.sources){const review=source.review,snapshot=source.reviewSnapshot;
    if((review===null)!==(snapshot===null))return abstain("SOURCE_PROVENANCE_UNVERIFIED");if(!review||!snapshot)continue;
    if(review.objectId!==input.objectId||review.sourceFileId!==source.sourceFileId||review.sourceSha256!==source.sourceSha256
      ||review.decisionId!==snapshot.decisionId||review.contentHash!==snapshot.contentHash)return abstain("SOURCE_PROVENANCE_UNVERIFIED");
    for(const claim of review.inventoryScope?.claims??[]){const origin=origins.get(originKey(source.sourceFileId,claim.target.checkId));
      if(!origin||origin.inputManifestHash!==claim.target.inputManifestHash||origin.textStageContentHash!==claim.target.textStageContentHash
        ||origin.textArtifactHash!==claim.target.textArtifactHash)return abstain("SOURCE_PROVENANCE_UNVERIFIED");}
  }
  const matches:Match[]=input.sources.flatMap(source=>(source.review?.inventoryScope?.claims??[]).filter(claim=>sameIdentity(claim,input.identity)).map(claim=>({source,claim})));
  for(const {source} of matches)if(source.stages.length!==1||!["PD","RD"].includes(source.stages[0])
    ||Object.values(source.review!.pageStages).some(stage=>stage!==source.stages[0]))return abstain("SOURCE_STAGE_UNVERIFIED");
  const byStage={PD:matches.filter(m=>m.source.stages[0]==="PD"),RD:matches.filter(m=>m.source.stages[0]==="RD")};
  for(const group of Object.values(byStage)){
    const hashes=new Set(group.map(m=>m.claim.target.inventoryContentHash));
    if(hashes.size!==group.length)return abstain("INVALID_INPUT");
  }
  if(Object.values(byStage).some(group=>group.length>1))return abstain("AMBIGUOUS_INVENTORY_SCOPE");
  if(byStage.PD.length!==1||byStage.RD.length!==1||byStage.PD[0].source.sourceFileId===byStage.RD[0].source.sourceFileId)return abstain("MATCHED_INVENTORY_PAIR_UNVERIFIED");
  const pd=byStage.PD[0],rd=byStage.RD[0],pair=[pd,rd];
  if(pair.some(m=>m.source.review!.revisionStatus!=="CURRENT"||m.source.review!.approvalStatus!=="APPROVED"))return abstain("SOURCE_REVIEW_UNVERIFIED");
  if(pair.some(m=>m.source.review!.sectionCode!=="AR"))return abstain("SOURCE_SECTION_UNVERIFIED");
  if(!pd.source.review!.linkGroupId||pd.source.review!.linkGroupId!==rd.source.review!.linkGroupId)return abstain("LINK_SCOPE_UNVERIFIED");
  for(const {source,claim} of pair){const origin=origins.get(originKey(source.sourceFileId,claim.target.checkId))!;
    try{const reconstructed=reconstructAr053InventorySource({sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256,stage:source.stages[0],pageStages:source.review!.pageStages,
      textArtifact:origin.textArtifact,selection:claim.selection});
      if(reconstructed.status!=="RECONSTRUCTED"||inventoryContentHash(reconstructed.inventory)!==claim.target.inventoryContentHash
        ||reconstructed.inventory.textArtifactHash!==origin.textArtifactHash
        ||canonicalSourceDeclarationJson(reconstructed.inventory)!==canonicalSourceDeclarationJson(claim.inventorySnapshot))return abstain("INVENTORY_RECONSTRUCTION_UNVERIFIED");
    }catch{return abstain("INVENTORY_RECONSTRUCTION_UNVERIFIED");}
  }
  if(pair.some(m=>m.claim.assertion!=="HUMAN_ASSERTED_COMPLETE"))return abstain("HUMAN_COMPLETENESS_UNVERIFIED");
  if(pair.some(m=>!m.claim.inventorySnapshot.featureRows.length||m.claim.inventorySnapshot.unresolvedRows.length))return abstain("NONEMPTY_CLOSED_REGION_UNVERIFIED");
  if(!pd.claim.inventorySnapshot.featureRows.some(r=>r.featureKey==="DAMPING_TAPE"))return abstain("PD_REQUIREMENT_UNVERIFIED");
  if(rd.claim.inventorySnapshot.featureRows.some(r=>r.featureKey==="DAMPING_TAPE"))return abstain("NEGATIVE_SCOPE_UNVERIFIED");
  return {schemaVersion:VERSION,status:"CANDIDATE",ruleId:"matrix-ar-053-declared_joint_damping_tape_omission",ruleVersion:"1",parameterCode:"AR-053",
    reasonCode:"DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION",calibratedProbability:null,comparisonScope:"REVIEWED_DECLARED_REGIONS_ONLY",
    identity:{...input.identity},expected:reference(pd),actual:reference(rd),missingFeatureKeys:["DAMPING_TAPE"]};
}
