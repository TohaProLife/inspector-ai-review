/** T46 independent ODI120 pure comparison. Supplied projection consistency is not DB authority. */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {sourceSectionCodes} from '@inspector-ai/contracts';
import {canonicalSourceDeclarationJson} from './matrix-source-declarations.js';
import {reconstructOdi120RailInventorySource,railInventoryContentHash,type RailSelection,type RailSourceInventory} from './matrix-rail-inventory-source.js';

type Obj=Record<string,unknown>; type Box=[number,number,number,number];
export interface RailRoomIdentity {entityKey:string;buildingKey:string;floorKey:string;roomKey:string;componentRole:'ACCESSIBLE_SANITARY_ROOM_RAIL_INVENTORY'}
interface Target {checkId:string;inputManifestHash:string;textStageContentHash:string;textArtifactHash:string;inventoryContentHash:string}
interface RoomMapping {kind:'HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING';sourceRoomToken:string;assertion:'UNKNOWN'|'HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'}
export interface RailClaimRequest {target:Target;selection:RailSelection;identity:RailRoomIdentity;roomMapping:RoomMapping;assertion:'UNKNOWN'|'HUMAN_ASSERTED_COMPLETE';reference:string}
export interface RailScopeRequest {schemaVersion:'matrix-odi120-rail-inventory-review-v1';claims:RailClaimRequest[]}
interface Claim extends RailClaimRequest {inventorySnapshot:RailSourceInventory}
interface ScopeDecision {schemaVersion:'matrix-odi120-rail-inventory-review-v1';claims:Claim[]}
interface Review {decisionId:string;contentHash:string;objectId:string;sourceFileId:string;sourceSha256:string;actorId:string;revisionStatus:'CURRENT'|'SUPERSEDED'|'UNKNOWN';approvalStatus:'APPROVED'|'UNAPPROVED'|'UNKNOWN';sectionCode:string|null;linkGroupId:string|null;pageStages:Record<string,string>;railInventoryScope:ScopeDecision|null}
interface Source {sourceFileId:string;sourceSha256:string;stages:string[];reviewSnapshot:{decisionId:string;contentHash:string}|null;review:Review|null}
interface Origin {checkId:string;objectId:string;sourceFileId:string;sourceSha256:string;inputManifestHash:string;textStageContentHash:string;textArtifactHash:string;textArtifact:Obj}
interface Projection {schemaVersion:'matrix-odi120-rail-inventory-input-v1';objectId:string;inputManifestHash:string;identity:RailRoomIdentity;sources:Source[];origins:Origin[]}
interface Reference {sourceFileId:string;sourceSha256:string;reviewDecisionId:string;reviewContentHash:string;inventoryContentHash:string}
export type RailComparisonReason='INVALID_INPUT'|'INPUT_LIMIT'|'SOURCE_PROVENANCE_UNVERIFIED'|'ROOM_IDENTITY_CONFLICT'|'SOURCE_STAGE_UNVERIFIED'|'AMBIGUOUS_INVENTORY_SCOPE'|'MATCHED_INVENTORY_PAIR_UNVERIFIED'|'SOURCE_REVIEW_UNVERIFIED'|'SOURCE_SECTION_UNVERIFIED'|'LINK_SCOPE_UNVERIFIED'|'INVENTORY_RECONSTRUCTION_UNVERIFIED'|'ROOM_MAPPING_UNVERIFIED'|'HUMAN_COMPLETENESS_UNVERIFIED'|'NONEMPTY_CLOSED_REGION_UNVERIFIED'|'PD_REQUIREMENT_UNVERIFIED'|'NEGATIVE_SCOPE_UNVERIFIED';
export type RailComparison={schemaVersion:'matrix-odi120-rail-inventory-comparison-v1';status:'ABSTAIN';reasonCode:RailComparisonReason;calibratedProbability:null}|{schemaVersion:'matrix-odi120-rail-inventory-comparison-v1';status:'CANDIDATE';ruleId:'matrix-odi-120-declared_accessible_room_wc_rails_omission';ruleVersion:'1';parameterCode:'ODI-120';reasonCode:'BOTH_WC_RAIL_TYPES_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY';calibratedProbability:null;comparisonScope:'REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY';identity:RailRoomIdentity;expected:Reference;actual:Reference;missingFeatureKeys:['WC_FIXED_RAIL','WC_FOLDING_RAIL']};
const ABSTAIN=(reasonCode:RailComparisonReason):RailComparison=>({schemaVersion:'matrix-odi120-rail-inventory-comparison-v1',status:'ABSTAIN',reasonCode,calibratedProbability:null});
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const positive=(v:unknown):v is number=>integer(v)&&v>0;
const record=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!isProxy(v)&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:readonly string[]):v is Obj=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const trim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const forbiddenLine=/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u;
const key=(v:unknown,max=200):v is string=>typeof v==='string'&&!!v&&trim(v)===v&&[...v].length<=max&&!forbiddenLine.test(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}(?![\s\S])/u.test(v);
const line=(v:unknown,max:number,min=1):v is string=>typeof v==='string'&&trim(v)===v&&[...v].length>=min&&[...v].length<=max&&!forbiddenLine.test(v)&&!!trim(v);
const box=(v:unknown):v is Box=>Array.isArray(v)&&v.length===4&&v.every(integer)&&v[0]>=0&&v[1]>=0&&v[0]<v[2]&&v[1]<v[3];
const inside=(frame:Box,b:Box)=>frame[0]<=b[0]&&frame[1]<=b[1]&&frame[2]>=b[2]&&frame[3]>=b[3];
const same=(a:unknown,b:unknown)=>canonicalSourceDeclarationJson(a)===canonicalSourceDeclarationJson(b);
const deep=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
/** Descriptor-first generic native boundary. Reject proxies without triggering traps, including revoked proxies. */
function native(raw:unknown):'VALID'|'INVALID'|'LIMIT'{let nodes=0,bytes=0,limited=false;const ancestors=new Set<object>();const limit=()=>{limited=true;return false;};
 function visit(v:unknown,depth:number):boolean {if(++nodes>200000||depth>64)return limit();if(v===null||typeof v==='boolean')return true;if(typeof v==='number')return integer(v);if(typeof v==='string'){if(v.length>8000000)return limit();let points=0;for(const c of v){if(++points>2000000)return limit();const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}bytes+=Buffer.byteLength(v,'utf8');return bytes>8000000?limit():true;}
  if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))return false;const array=Array.isArray(v);if(array?Object.getPrototypeOf(v)!==Array.prototype:!record(v))return false;const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);if(names.some(n=>typeof n!=='string'))return false;let keys:string[];if(array){const count=descriptors.length?.value;if(!integer(count)||count<0)return false;if(count>32768)return limit();if(names.length!==count+1)return false;keys=Array.from({length:count},(_,i)=>String(i));}else{if(names.length>32768)return limit();keys=names as string[];}
  ancestors.add(v);for(const k of keys){const d=descriptors[k];if(!d||!d.enumerable||!Object.hasOwn(d,'value')||(!array&&!visit(k,depth+1))||!visit(d.value,depth+1)){ancestors.delete(v);return false;}}ancestors.delete(v);return true;
 }try{return visit(raw,0)?'VALID':limited?'LIMIT':'INVALID';}catch{return'INVALID';}}
const STAGES=['PD','RD','ID','UNRESOLVED'];
function identity(v:unknown):v is RailRoomIdentity{return exact(v,['entityKey','buildingKey','floorKey','roomKey','componentRole'])&&['entityKey','buildingKey','floorKey','roomKey'].every(k=>key(v[k]))&&v.componentRole==='ACCESSIBLE_SANITARY_ROOM_RAIL_INVENTORY';}
function pageStages(v:unknown):boolean{return record(v)&&Object.entries(v).every(([p,s])=>/^[1-9][0-9]{0,15}(?![\s\S])/u.test(p)&&positive(Number(p))&&typeof s==='string'&&STAGES.includes(s));}
function fragment(v:unknown,page?:number,frame?:Box):boolean{return exact(v,['pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'])&&positive(v.pageNumber)&&(page===undefined||v.pageNumber===page)&&integer(v.blockIndex)&&v.blockIndex>=0&&integer(v.lineIndex)&&v.lineIndex>=0&&typeof v.rawText==='string'&&!!trim(v.rawText)&&[...v.rawText].length<=8192&&!forbiddenLine.test(v.rawText)&&box(v.bboxMilliPoints)&&(!frame||inside(frame,v.bboxMilliPoints));}
function selection(v:unknown):boolean{return exact(v,['pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'])&&positive(v.pageNumber)&&box(v.regionBoxMilliPoints)&&['headerFragments','scopeFragments','endFragments'].every(k=>Array.isArray(v[k])&&v[k].length===1&&v[k].every(f=>fragment(f)));}
function snapshot(v:unknown):v is RailSourceInventory {
 if(!exact(v,['schemaVersion','extractorVersion','policyVersion','sourceFileId','sourceSha256','textArtifactHash','stage','pageNumber','widthMilliPoints','heightMilliPoints','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments','roomToken','featureRows'])||v.schemaVersion!=='matrix-odi120-rail-inventory-source-v1'||v.extractorVersion!==v.schemaVersion||v.policyVersion!=='matrix-odi120-rail-inventory-literals-v1'||!key(v.sourceFileId)||!sha(v.sourceSha256)||!sha(v.textArtifactHash)||(v.stage!=='PD'&&v.stage!=='RD')||!positive(v.pageNumber)||!positive(v.widthMilliPoints)||!positive(v.heightMilliPoints)||!box(v.regionBoxMilliPoints)||!key(v.roomToken))return false;
 const frame:Box=[0,0,v.widthMilliPoints,v.heightMilliPoints];if(!inside(frame,v.regionBoxMilliPoints))return false;
 if(!['headerFragments','scopeFragments','endFragments'].every(k=>Array.isArray(v[k])&&v[k].length===1&&v[k].every(f=>fragment(f,v.pageNumber as number,frame))))return false;
 return Array.isArray(v.featureRows)&&v.featureRows.length>=1&&v.featureRows.length<=3&&v.featureRows.every(r=>exact(r,['featureKey','fragments'])&&typeof r.featureKey==='string'&&['WC_FIXED_RAIL','WC_FOLDING_RAIL','BASIN_RAIL'].includes(r.featureKey)&&Array.isArray(r.fragments)&&r.fragments.length>=1&&r.fragments.length<=3&&r.fragments.every(f=>fragment(f,v.pageNumber as number,frame)));
}
function target(v:unknown):v is Target{return exact(v,['checkId','inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'])&&key(v.checkId,120)&&['inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'].every(k=>sha(v[k]));}
function mapping(v:unknown):boolean{return exact(v,['kind','sourceRoomToken','assertion'])&&v.kind==='HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING'&&key(v.sourceRoomToken)&&(v.assertion==='UNKNOWN'||v.assertion==='HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM');}
function claim(v:unknown,decision:boolean):boolean{return exact(v,decision?['target','selection','identity','roomMapping','assertion','reference','inventorySnapshot']:['target','selection','identity','roomMapping','assertion','reference'])&&target(v.target)&&selection(v.selection)&&identity(v.identity)&&mapping(v.roomMapping)&&(v.assertion==='UNKNOWN'||v.assertion==='HUMAN_ASSERTED_COMPLETE')&&line(v.reference,1000,8)&&(!decision||snapshot(v.inventorySnapshot));}
function scope(v:unknown,decision:boolean):boolean{return exact(v,['schemaVersion','claims'])&&v.schemaVersion==='matrix-odi120-rail-inventory-review-v1'&&Array.isArray(v.claims)&&v.claims.length<=16&&v.claims.every(c=>claim(c,decision));}
function source(v:unknown):boolean{
 if(!exact(v,['sourceFileId','sourceSha256','stages','reviewSnapshot','review'])||!key(v.sourceFileId)||!sha(v.sourceSha256)||!Array.isArray(v.stages)||v.stages.length>4||v.stages.some(s=>typeof s!=='string'||!STAGES.includes(s))||new Set(v.stages).size!==v.stages.length)return false;
 if(v.review===null||v.reviewSnapshot===null)return v.review===null&&v.reviewSnapshot===null;
 const s=v.reviewSnapshot,r=v.review;
 return exact(s,['decisionId','contentHash'])&&key(s.decisionId)&&sha(s.contentHash)&&exact(r,['decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','railInventoryScope'])&&['decisionId','objectId','sourceFileId','actorId'].every(k=>key(r[k]))&&sha(r.contentHash)&&sha(r.sourceSha256)&&typeof r.revisionStatus==='string'&&['CURRENT','SUPERSEDED','UNKNOWN'].includes(r.revisionStatus)&&typeof r.approvalStatus==='string'&&['APPROVED','UNAPPROVED','UNKNOWN'].includes(r.approvalStatus)&&(r.sectionCode===null||(typeof r.sectionCode==='string'&&(sourceSectionCodes as readonly string[]).includes(r.sectionCode)))&&(r.linkGroupId===null||key(r.linkGroupId,120))&&pageStages(r.pageStages)&&(r.railInventoryScope===null||scope(r.railInventoryScope,true));
}
function origin(v:unknown):boolean{return exact(v,['checkId','objectId','sourceFileId','sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash','textArtifact'])&&key(v.checkId,120)&&key(v.objectId)&&key(v.sourceFileId)&&['sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash'].every(k=>sha(v[k]))&&record(v.textArtifact);}
function collectionLimit(raw:unknown):boolean{
 if(!record(raw))return false;if(Array.isArray(raw.sources)&&raw.sources.length>64||Array.isArray(raw.origins)&&raw.origins.length>128)return true;
 let total=0;if(Array.isArray(raw.sources))for(const s of raw.sources){if(!record(s)||!record(s.review)||!record(s.review.railInventoryScope)||!Array.isArray(s.review.railInventoryScope.claims))continue;const count=s.review.railInventoryScope.claims.length;if(count>16)return true;total+=count;if(total>128)return true;}return false;
}
function projection(v:unknown):v is Projection{return exact(v,['schemaVersion','objectId','inputManifestHash','identity','sources','origins'])&&v.schemaVersion==='matrix-odi120-rail-inventory-input-v1'&&key(v.objectId)&&sha(v.inputManifestHash)&&identity(v.identity)&&Array.isArray(v.sources)&&v.sources.every(source)&&Array.isArray(v.origins)&&v.origins.every(origin);}
interface Entry {source:Source;review:Review;claim:Claim;origin:Origin;stage:string}
function reference(e:Entry):Reference{return{sourceFileId:e.source.sourceFileId,sourceSha256:e.source.sourceSha256,reviewDecisionId:e.review.decisionId,reviewContentHash:e.review.contentHash,inventoryContentHash:e.claim.target.inventoryContentHash};}
export function compareOdi120RailInventories(raw:unknown):RailComparison{
 const n=native(raw);if(n!=='VALID')return ABSTAIN(n==='LIMIT'?'INPUT_LIMIT':'INVALID_INPUT');
 if(collectionLimit(raw))return ABSTAIN('INPUT_LIMIT');if(!projection(raw))return ABSTAIN('INVALID_INPUT');
 const sources=new Map(raw.sources.map(s=>[s.sourceFileId,s])),origins=new Map(raw.origins.map(o=>[JSON.stringify([o.sourceFileId,o.checkId]),o]));
 if(sources.size!==raw.sources.length||origins.size!==raw.origins.length)return ABSTAIN('SOURCE_PROVENANCE_UNVERIFIED');
 // Every origin association, even orphan/unselected, precedes identity/eligibility.
 for(const o of raw.origins){const s=sources.get(o.sourceFileId);if(!s||o.objectId!==raw.objectId||o.sourceSha256!==s.sourceSha256)return ABSTAIN('SOURCE_PROVENANCE_UNVERIFIED');}
 const all:Entry[]=[];
 for(const s of raw.sources){const r=s.review;if(!r)continue;if(r.objectId!==raw.objectId||r.sourceFileId!==s.sourceFileId||r.sourceSha256!==s.sourceSha256||r.decisionId!==s.reviewSnapshot!.decisionId||r.contentHash!==s.reviewSnapshot!.contentHash)return ABSTAIN('SOURCE_PROVENANCE_UNVERIFIED');
  for(const c of r.railInventoryScope?.claims??[]){const o=origins.get(JSON.stringify([s.sourceFileId,c.target.checkId]));if(c.inventorySnapshot.sourceFileId!==s.sourceFileId||c.inventorySnapshot.sourceSha256!==s.sourceSha256||!o||c.target.inputManifestHash!==o.inputManifestHash||c.target.textStageContentHash!==o.textStageContentHash||c.target.textArtifactHash!==o.textArtifactHash)return ABSTAIN('SOURCE_PROVENANCE_UNVERIFIED');all.push({source:s,review:r,claim:c,origin:o,stage:s.stages.length===1?s.stages[0]:''});}
 }
 const requested=raw.identity;
 const selected=all.filter(e=>{const id=e.claim.identity;return id.entityKey===requested.entityKey||(id.buildingKey===requested.buildingKey&&id.floorKey===requested.floorKey&&id.roomKey===requested.roomKey);});
 if(selected.some(e=>!same(e.claim.identity,requested)))return ABSTAIN('ROOM_IDENTITY_CONFLICT');
 if(selected.some(e=>(e.stage!=='PD'&&e.stage!=='RD')||Object.values(e.review.pageStages).some(s=>s!==e.stage)))return ABSTAIN('SOURCE_STAGE_UNVERIFIED');
 const pd=selected.filter(e=>e.stage==='PD'),rd=selected.filter(e=>e.stage==='RD');
 // Duplicate scan over BOTH stages first; no UNKNOWN or superseded filtering.
 for(const entries of [pd,rd])if(new Set(entries.map(e=>e.claim.target.inventoryContentHash)).size!==entries.length)return ABSTAIN('INVALID_INPUT');
 if(pd.length>1||rd.length>1)return ABSTAIN('AMBIGUOUS_INVENTORY_SCOPE');
 if(pd.length!==1||rd.length!==1||pd[0].source.sourceFileId===rd[0].source.sourceFileId)return ABSTAIN('MATCHED_INVENTORY_PAIR_UNVERIFIED');
 const expected=pd[0],actual=rd[0],pair=[expected,actual];
 if(pair.some(e=>e.review.revisionStatus!=='CURRENT'||e.review.approvalStatus!=='APPROVED'))return ABSTAIN('SOURCE_REVIEW_UNVERIFIED');
 if(expected.review.sectionCode!=='ODI'||actual.review.sectionCode!=='AR')return ABSTAIN('SOURCE_SECTION_UNVERIFIED');
 if(!expected.review.linkGroupId||expected.review.linkGroupId!==actual.review.linkGroupId)return ABSTAIN('LINK_SCOPE_UNVERIFIED');
 for(const e of pair){const rebuilt=reconstructOdi120RailInventorySource({sourceFileId:e.source.sourceFileId,sourceSha256:e.source.sourceSha256,stage:e.stage,pageStages:e.review.pageStages,textArtifact:e.origin.textArtifact,selection:e.claim.selection});
  if(rebuilt.status!=='RECONSTRUCTED'||createHash('sha256').update(canonicalSourceDeclarationJson({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:e.origin.textArtifact})).digest('hex')!==e.origin.textArtifactHash||!same(rebuilt.inventory,e.claim.inventorySnapshot)||railInventoryContentHash(rebuilt.inventory)!==e.claim.target.inventoryContentHash)return ABSTAIN('INVENTORY_RECONSTRUCTION_UNVERIFIED');
 }
 if(pair.some(e=>e.claim.roomMapping.assertion!=='HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'||e.claim.roomMapping.sourceRoomToken!==e.claim.inventorySnapshot.roomToken))return ABSTAIN('ROOM_MAPPING_UNVERIFIED');
 if(pair.some(e=>e.claim.assertion!=='HUMAN_ASSERTED_COMPLETE'))return ABSTAIN('HUMAN_COMPLETENESS_UNVERIFIED');
 if(pair.some(e=>e.claim.inventorySnapshot.featureRows.length===0))return ABSTAIN('NONEMPTY_CLOSED_REGION_UNVERIFIED');
 const pkeys=new Set(expected.claim.inventorySnapshot.featureRows.map(r=>r.featureKey)),rkeys=new Set(actual.claim.inventorySnapshot.featureRows.map(r=>r.featureKey));
 if(!pkeys.has('WC_FIXED_RAIL')||!pkeys.has('WC_FOLDING_RAIL'))return ABSTAIN('PD_REQUIREMENT_UNVERIFIED');
 if(rkeys.has('WC_FIXED_RAIL')||rkeys.has('WC_FOLDING_RAIL')||!rkeys.has('BASIN_RAIL'))return ABSTAIN('NEGATIVE_SCOPE_UNVERIFIED');
 return{schemaVersion:'matrix-odi120-rail-inventory-comparison-v1',status:'CANDIDATE',ruleId:'matrix-odi-120-declared_accessible_room_wc_rails_omission',ruleVersion:'1',parameterCode:'ODI-120',reasonCode:'BOTH_WC_RAIL_TYPES_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY',calibratedProbability:null,comparisonScope:'REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY',identity:deep(requested),expected:reference(expected),actual:reference(actual),missingFeatureKeys:['WC_FIXED_RAIL','WC_FOLDING_RAIL']};
}
/** Staged request boundary only. Parent-total budgets/server materialization belong to future API integration. */
export function validateRailInventoryScopeRequest(raw:unknown):RailScopeRequest|null{return native(raw)==='VALID'&&scope(raw,false)?deep(raw as unknown as RailScopeRequest):null;}
export function projectRailInventoryScopeDecision(raw:unknown):RailScopeRequest|null{
 if(native(raw)!=='VALID'||!scope(raw,true))return null;
 const decision=raw as unknown as ScopeDecision;
 return{schemaVersion:decision.schemaVersion,claims:decision.claims.map(c=>({target:deep(c.target),selection:deep(c.selection),identity:deep(c.identity),roomMapping:deep(c.roomMapping),assertion:c.assertion,reference:c.reference}))};
}
