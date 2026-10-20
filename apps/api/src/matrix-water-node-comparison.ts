/** Pure ZU129 water-node projection consistency; server/original/review authority is separate. */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {sourceSectionCodes} from '@inspector-ai/contracts';
import {canonicalSourceDeclarationJson,extractSourceDeclarations} from './matrix-source-declarations.js';
import {reconstructZu129WaterNodeSource,waterNodeInventoryContentHash,type WaterNodeSelection,type WaterNodeSourceInventory} from './matrix-water-node-source.js';

type Obj=Record<string,unknown>;type Box=[number,number,number,number];
export interface WaterNodeIdentity {entityKey:string;buildingKey:string;nodeKey:string;service:'COLD_WATER';accountingScope:'COMMON_BUILDING_INLET';componentRole:'COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS'}
interface Target {checkId:string;inputManifestHash:string;textStageContentHash:string;textArtifactHash:string;inventoryContentHash:string}
interface NodeMapping {kind:'HUMAN_REVIEWED_COLD_WATER_INLET_NODE_MAPPING';sourceBuildingToken:string;sourceNodeToken:string;assertion:'UNKNOWN'|'HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE'}
export interface WaterNodeClaimRequest {target:Target;selection:WaterNodeSelection;identity:WaterNodeIdentity;nodeMapping:NodeMapping;assertion:'UNKNOWN'|'HUMAN_ASSERTED_COMPLETE';reference:string}
export interface WaterNodeScopeRequest {schemaVersion:'matrix-zu129-water-node-review-v1';claims:WaterNodeClaimRequest[]}
interface Claim extends WaterNodeClaimRequest {inventorySnapshot:WaterNodeSourceInventory}
interface ScopeDecision {schemaVersion:'matrix-zu129-water-node-review-v1';claims:Claim[]}
interface Review {decisionId:string;contentHash:string;objectId:string;sourceFileId:string;sourceSha256:string;actorId:string;revisionStatus:'CURRENT'|'SUPERSEDED'|'UNKNOWN';approvalStatus:'APPROVED'|'UNAPPROVED'|'UNKNOWN';sectionCode:string|null;linkGroupId:string|null;pageStages:Record<string,string>;waterNodeScope:ScopeDecision|null}
interface Source {sourceFileId:string;sourceSha256:string;stages:string[];reviewSnapshot:{decisionId:string;contentHash:string}|null;review:Review|null}
interface Origin {checkId:string;objectId:string;sourceFileId:string;sourceSha256:string;inputManifestHash:string;textStageContentHash:string;textArtifactHash:string;textArtifact:Obj}
interface Projection {schemaVersion:'matrix-zu129-water-node-input-v1';objectId:string;inputManifestHash:string;identity:WaterNodeIdentity;sources:Source[];origins:Origin[]}
interface Reference {sourceFileId:string;sourceSha256:string;reviewDecisionId:string;reviewContentHash:string;inventoryContentHash:string}
export type WaterNodeComparisonReason='INVALID_INPUT'|'INPUT_LIMIT'|'SOURCE_PROVENANCE_UNVERIFIED'|'NODE_IDENTITY_CONFLICT'|'SOURCE_STAGE_UNVERIFIED'|'AMBIGUOUS_INVENTORY_SCOPE'|'MATCHED_INVENTORY_PAIR_UNVERIFIED'|'SOURCE_REVIEW_UNVERIFIED'|'SOURCE_SECTION_UNVERIFIED'|'LINK_SCOPE_UNVERIFIED'|'INVENTORY_RECONSTRUCTION_UNVERIFIED'|'NODE_MAPPING_UNVERIFIED'|'HUMAN_COMPLETENESS_UNVERIFIED'|'NONEMPTY_CLOSED_REGION_UNVERIFIED'|'PD_REQUIREMENT_UNVERIFIED'|'NEGATIVE_SCOPE_UNVERIFIED';
export type WaterNodeComparison={schemaVersion:'matrix-zu129-water-node-comparison-v1';status:'ABSTAIN';reasonCode:WaterNodeComparisonReason;calibratedProbability:null}|{schemaVersion:'matrix-zu129-water-node-comparison-v1';status:'CANDIDATE';ruleId:'matrix-zu-129-declared_cold_water_inlet_meter_omission';ruleVersion:'1';parameterCode:'ZU-129';reasonCode:'WATER_METER_NOT_LISTED_IN_REVIEWED_RD_NODE_COMPONENTS';calibratedProbability:null;comparisonScope:'REVIEWED_NAMED_COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS_ONLY';identity:WaterNodeIdentity;expected:Reference;actual:Reference;missingFeatureKeys:['WATER_METER']};
const abstain=(reasonCode:WaterNodeComparisonReason):WaterNodeComparison=>({schemaVersion:'matrix-zu129-water-node-comparison-v1',status:'ABSTAIN',reasonCode,calibratedProbability:null});
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const positive=(v:unknown):v is number=>integer(v)&&v>0;
const record=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!isProxy(v)&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:readonly string[]):v is Obj=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const trim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const forbiddenLine=/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u;
const key=(v:unknown,max=200):v is string=>typeof v==='string'&&!!v&&trim(v)===v&&[...v].length<=max&&!forbiddenLine.test(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}(?![\s\S])/u.test(v);
const referenceLine=(v:unknown):v is string=>key(v,1000)&&[...v].length>=8;
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}(?![\s\S])/u.test(v);
const box=(v:unknown):v is Box=>Array.isArray(v)&&v.length===4&&v.every(integer)&&v[0]>=0&&v[1]>=0&&v[0]<v[2]&&v[1]<v[3];
const inside=(a:Box,b:Box)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
const same=(a:unknown,b:unknown)=>canonicalSourceDeclarationJson(a)===canonicalSourceDeclarationJson(b);
const deep=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;

/** Generic descriptor-first bounded integer JSON guard; no user callback is invoked. */
function native(raw:unknown):'VALID'|'INVALID'|'LIMIT'{let nodes=0,bytes=0,limited=false;const ancestors=new Set<object>();const limit=()=>{limited=true;return false;};
 function visit(v:unknown,depth:number):boolean{if(++nodes>200000||depth>64)return limit();if(v===null||typeof v==='boolean')return true;if(typeof v==='number')return integer(v);if(typeof v==='string'){if(v.length>8000000)return limit();let points=0;for(const c of v){if(++points>2000000)return limit();const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}bytes+=Buffer.byteLength(v,'utf8');return bytes>8000000?limit():true;}
  if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))return false;const array=Array.isArray(v);if(array?Object.getPrototypeOf(v)!==Array.prototype:!record(v))return false;const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);if(names.some(n=>typeof n!=='string'))return false;let keys:string[];
  if(array){const count=ds.length?.value;if(!integer(count)||count<0)return false;if(count>32768)return limit();if(names.length!==count+1)return false;keys=Array.from({length:count},(_,i)=>String(i));}else{if(names.length>32768)return limit();keys=names as string[];}
  ancestors.add(v);for(const k of keys){const d=ds[k];if(!d||!d.enumerable||!Object.hasOwn(d,'value')||(!array&&!visit(k,depth+1))||!visit(d.value,depth+1)){ancestors.delete(v);return false;}}ancestors.delete(v);return true;
 }try{return visit(raw,0)?'VALID':limited?'LIMIT':'INVALID';}catch{return'INVALID';}}
const STAGES=['PD','RD','ID','UNRESOLVED'];
function identity(v:unknown):v is WaterNodeIdentity{return exact(v,['entityKey','buildingKey','nodeKey','service','accountingScope','componentRole'])&&['entityKey','buildingKey','nodeKey'].every(k=>key(v[k]))&&v.service==='COLD_WATER'&&v.accountingScope==='COMMON_BUILDING_INLET'&&v.componentRole==='COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS';}
function pageStages(v:unknown):boolean{return record(v)&&Object.entries(v).every(([p,s])=>/^[1-9][0-9]{0,15}(?![\s\S])/u.test(p)&&positive(Number(p))&&typeof s==='string'&&STAGES.includes(s));}
function fragment(v:unknown,page?:number,frame?:Box):boolean{return exact(v,['pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'])&&positive(v.pageNumber)&&(page===undefined||v.pageNumber===page)&&integer(v.blockIndex)&&v.blockIndex>=0&&integer(v.lineIndex)&&v.lineIndex>=0&&typeof v.rawText==='string'&&!!trim(v.rawText)&&[...v.rawText].length<=8192&&!forbiddenLine.test(v.rawText)&&box(v.bboxMilliPoints)&&(!frame||inside(frame,v.bboxMilliPoints));}
function anchors(v:Obj,page?:number,frame?:Box):boolean{return ([['headerFragments',1],['scopeFragments',4],['endFragments',1]] as const).every(([k,n])=>Array.isArray(v[k])&&v[k].length===n&&v[k].every(f=>fragment(f,page,frame)));}
function selection(v:unknown):boolean{return exact(v,['pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'])&&positive(v.pageNumber)&&box(v.regionBoxMilliPoints)&&anchors(v);}
function snapshot(v:unknown):v is WaterNodeSourceInventory{
 if(!exact(v,['schemaVersion','extractorVersion','policyVersion','sourceFileId','sourceSha256','textArtifactHash','stage','pageNumber','widthMilliPoints','heightMilliPoints','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments','buildingToken','nodeToken','service','accountingScope','featureRows'])||v.schemaVersion!=='matrix-zu129-water-node-source-v1'||v.extractorVersion!==v.schemaVersion||v.policyVersion!=='matrix-zu129-cold-water-inlet-literals-v1'||!key(v.sourceFileId)||!sha(v.sourceSha256)||!sha(v.textArtifactHash)||(v.stage!=='PD'&&v.stage!=='RD')||!positive(v.pageNumber)||!positive(v.widthMilliPoints)||!positive(v.heightMilliPoints)||!box(v.regionBoxMilliPoints)||!token(v.buildingToken)||!token(v.nodeToken)||v.service!=='COLD_WATER'||v.accountingScope!=='COMMON_BUILDING_INLET')return false;
 const frame:Box=[0,0,v.widthMilliPoints,v.heightMilliPoints];if(!inside(frame,v.regionBoxMilliPoints)||!anchors(v,v.pageNumber,frame))return false;
 return Array.isArray(v.featureRows)&&v.featureRows.length>=1&&v.featureRows.length<=3&&v.featureRows.every(r=>exact(r,['featureKey','fragments'])&&typeof r.featureKey==='string'&&['WATER_METER','STRAINER','SHUTOFF_VALVE'].includes(r.featureKey)&&Array.isArray(r.fragments)&&r.fragments.length===1&&r.fragments.every(f=>fragment(f,v.pageNumber as number,frame)));
}
function target(v:unknown):boolean{return exact(v,['checkId','inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'])&&key(v.checkId,120)&&['inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'].every(k=>sha(v[k]));}
function mapping(v:unknown):boolean{return exact(v,['kind','sourceBuildingToken','sourceNodeToken','assertion'])&&v.kind==='HUMAN_REVIEWED_COLD_WATER_INLET_NODE_MAPPING'&&key(v.sourceBuildingToken)&&key(v.sourceNodeToken)&&(v.assertion==='UNKNOWN'||v.assertion==='HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE');}
function claim(v:unknown,decision:boolean):boolean{return exact(v,decision?['target','selection','identity','nodeMapping','assertion','reference','inventorySnapshot']:['target','selection','identity','nodeMapping','assertion','reference'])&&target(v.target)&&selection(v.selection)&&identity(v.identity)&&mapping(v.nodeMapping)&&(v.assertion==='UNKNOWN'||v.assertion==='HUMAN_ASSERTED_COMPLETE')&&referenceLine(v.reference)&&(!decision||snapshot(v.inventorySnapshot));}
function scope(v:unknown,decision:boolean):boolean{return exact(v,['schemaVersion','claims'])&&v.schemaVersion==='matrix-zu129-water-node-review-v1'&&Array.isArray(v.claims)&&v.claims.length<=16&&v.claims.every(c=>claim(c,decision));}
function source(v:unknown):boolean{
 if(!exact(v,['sourceFileId','sourceSha256','stages','reviewSnapshot','review'])||!key(v.sourceFileId)||!sha(v.sourceSha256)||!Array.isArray(v.stages)||v.stages.length>4||v.stages.some(s=>typeof s!=='string'||!STAGES.includes(s))||new Set(v.stages).size!==v.stages.length)return false;
 if(v.review===null||v.reviewSnapshot===null)return v.review===null&&v.reviewSnapshot===null;const s=v.reviewSnapshot,r=v.review;
 return exact(s,['decisionId','contentHash'])&&key(s.decisionId)&&sha(s.contentHash)&&exact(r,['decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','waterNodeScope'])&&['decisionId','objectId','sourceFileId','actorId'].every(k=>key(r[k]))&&sha(r.contentHash)&&sha(r.sourceSha256)&&typeof r.revisionStatus==='string'&&['CURRENT','SUPERSEDED','UNKNOWN'].includes(r.revisionStatus)&&typeof r.approvalStatus==='string'&&['APPROVED','UNAPPROVED','UNKNOWN'].includes(r.approvalStatus)&&(r.sectionCode===null||(typeof r.sectionCode==='string'&&(sourceSectionCodes as readonly string[]).includes(r.sectionCode)))&&(r.linkGroupId===null||key(r.linkGroupId,120))&&pageStages(r.pageStages)&&(r.waterNodeScope===null||scope(r.waterNodeScope,true));
}
function origin(v:unknown):boolean{return exact(v,['checkId','objectId','sourceFileId','sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash','textArtifact'])&&key(v.checkId,120)&&key(v.objectId)&&key(v.sourceFileId)&&['sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash'].every(k=>sha(v[k]))&&record(v.textArtifact);}
function collectionLimit(v:unknown):boolean{if(!record(v))return false;if(Array.isArray(v.sources)&&v.sources.length>64||Array.isArray(v.origins)&&v.origins.length>128)return true;let total=0;if(Array.isArray(v.sources))for(const s of v.sources){if(!record(s)||!record(s.review)||!record(s.review.waterNodeScope)||!Array.isArray(s.review.waterNodeScope.claims))continue;const count=s.review.waterNodeScope.claims.length;if(count>16)return true;total+=count;if(total>128)return true;}return false;}
function projection(v:unknown):v is Projection{return exact(v,['schemaVersion','objectId','inputManifestHash','identity','sources','origins'])&&v.schemaVersion==='matrix-zu129-water-node-input-v1'&&key(v.objectId)&&sha(v.inputManifestHash)&&identity(v.identity)&&Array.isArray(v.sources)&&v.sources.every(source)&&Array.isArray(v.origins)&&v.origins.every(origin);}
interface Entry {source:Source;review:Review;claim:Claim;origin:Origin;stage:string}
const originKey=(id:string,check:string)=>JSON.stringify([id,check]);
const reference=(e:Entry):Reference=>({sourceFileId:e.source.sourceFileId,sourceSha256:e.source.sourceSha256,reviewDecisionId:e.review.decisionId,reviewContentHash:e.review.contentHash,inventoryContentHash:e.claim.target.inventoryContentHash});
export function compareZu129WaterNodeInventories(raw:unknown):WaterNodeComparison{
 const checked=native(raw);if(checked!=='VALID')return abstain(checked==='LIMIT'?'INPUT_LIMIT':'INVALID_INPUT');if(collectionLimit(raw))return abstain('INPUT_LIMIT');if(!projection(raw))return abstain('INVALID_INPUT');
 const sources=new Map(raw.sources.map(s=>[s.sourceFileId,s])),origins=new Map(raw.origins.map(o=>[originKey(o.sourceFileId,o.checkId),o]));
 if(sources.size!==raw.sources.length||origins.size!==raw.origins.length)return abstain('SOURCE_PROVENANCE_UNVERIFIED');
 for(const o of raw.origins){const s=sources.get(o.sourceFileId);if(!s||o.objectId!==raw.objectId||o.sourceSha256!==s.sourceSha256)return abstain('SOURCE_PROVENANCE_UNVERIFIED');}
 const all:Entry[]=[];
 for(const s of raw.sources){const r=s.review;if(!r)continue;if(r.objectId!==raw.objectId||r.sourceFileId!==s.sourceFileId||r.sourceSha256!==s.sourceSha256||r.decisionId!==s.reviewSnapshot!.decisionId||r.contentHash!==s.reviewSnapshot!.contentHash)return abstain('SOURCE_PROVENANCE_UNVERIFIED');
  for(const c of r.waterNodeScope?.claims??[]){const o=origins.get(originKey(s.sourceFileId,c.target.checkId));if(!o||c.inventorySnapshot.sourceFileId!==s.sourceFileId||c.inventorySnapshot.sourceSha256!==s.sourceSha256||c.target.inputManifestHash!==o.inputManifestHash||c.target.textStageContentHash!==o.textStageContentHash||c.target.textArtifactHash!==o.textArtifactHash)return abstain('SOURCE_PROVENANCE_UNVERIFIED');all.push({source:s,review:r,claim:c,origin:o,stage:s.stages.length===1?s.stages[0]:''});}
 }
 // Every retained original is checked, including unclaimed and unrelated originals.
 for(const o of raw.origins){try{extractSourceDeclarations({objectId:raw.objectId,inputManifestHash:o.inputManifestHash,sources:[{sourceFileId:o.sourceFileId,sha256:o.sourceSha256,stages:[]}],textArtifacts:[o.textArtifact]});if((o.textArtifact.pageCount as number)>512||createHash('sha256').update(canonicalSourceDeclarationJson({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:o.textArtifact})).digest('hex')!==o.textArtifactHash)return abstain('SOURCE_PROVENANCE_UNVERIFIED');}catch{return abstain('SOURCE_PROVENANCE_UNVERIFIED');}}
 if(all.some(e=>(e.stage!=='PD'&&e.stage!=='RD')||Object.values(e.review.pageStages).some(s=>s!==e.stage)))return abstain('SOURCE_STAGE_UNVERIFIED');
 for(const e of all){const rebuilt=reconstructZu129WaterNodeSource({sourceFileId:e.source.sourceFileId,sourceSha256:e.source.sourceSha256,stage:e.stage,pageStages:e.review.pageStages,textArtifact:e.origin.textArtifact,selection:e.claim.selection});if(rebuilt.status!=='RECONSTRUCTED'||!same(rebuilt.inventory,e.claim.inventorySnapshot)||waterNodeInventoryContentHash(rebuilt.inventory)!==e.claim.target.inventoryContentHash)return abstain('INVENTORY_RECONSTRUCTION_UNVERIFIED');}
 const requested=raw.identity,selected=all.filter(e=>e.claim.identity.entityKey===requested.entityKey||(e.claim.identity.buildingKey===requested.buildingKey&&e.claim.identity.nodeKey===requested.nodeKey));
 if(selected.some(e=>!same(e.claim.identity,requested)))return abstain('NODE_IDENTITY_CONFLICT');const pd=selected.filter(e=>e.stage==='PD'),rd=selected.filter(e=>e.stage==='RD');
 for(const entries of [pd,rd])if(new Set(entries.map(e=>e.claim.target.inventoryContentHash)).size!==entries.length)return abstain('INVALID_INPUT');
 if(pd.length>1||rd.length>1)return abstain('AMBIGUOUS_INVENTORY_SCOPE');if(pd.length!==1||rd.length!==1||pd[0].source.sourceFileId===rd[0].source.sourceFileId)return abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED');
 const expected=pd[0],actual=rd[0],pair=[expected,actual];if(pair.some(e=>e.review.revisionStatus!=='CURRENT'||e.review.approvalStatus!=='APPROVED'))return abstain('SOURCE_REVIEW_UNVERIFIED');
 if(expected.review.sectionCode!=='ZU'||actual.review.sectionCode!=='IOS2')return abstain('SOURCE_SECTION_UNVERIFIED');if(!expected.review.linkGroupId||expected.review.linkGroupId!==actual.review.linkGroupId)return abstain('LINK_SCOPE_UNVERIFIED');
 if(pair.some(e=>e.claim.nodeMapping.assertion!=='HUMAN_ASSERTED_SAME_COLD_WATER_INLET_NODE'||e.claim.nodeMapping.sourceBuildingToken!==e.claim.inventorySnapshot.buildingToken||e.claim.nodeMapping.sourceNodeToken!==e.claim.inventorySnapshot.nodeToken))return abstain('NODE_MAPPING_UNVERIFIED');
 if(pair.some(e=>e.claim.assertion!=='HUMAN_ASSERTED_COMPLETE'))return abstain('HUMAN_COMPLETENESS_UNVERIFIED');if(pair.some(e=>e.claim.inventorySnapshot.featureRows.length===0))return abstain('NONEMPTY_CLOSED_REGION_UNVERIFIED');
 const pkeys=new Set(expected.claim.inventorySnapshot.featureRows.map(r=>r.featureKey)),rkeys=new Set(actual.claim.inventorySnapshot.featureRows.map(r=>r.featureKey));if(!pkeys.has('WATER_METER'))return abstain('PD_REQUIREMENT_UNVERIFIED');if(rkeys.has('WATER_METER')||(!rkeys.has('STRAINER')&&!rkeys.has('SHUTOFF_VALVE')))return abstain('NEGATIVE_SCOPE_UNVERIFIED');
 return{schemaVersion:'matrix-zu129-water-node-comparison-v1',status:'CANDIDATE',ruleId:'matrix-zu-129-declared_cold_water_inlet_meter_omission',ruleVersion:'1',parameterCode:'ZU-129',reasonCode:'WATER_METER_NOT_LISTED_IN_REVIEWED_RD_NODE_COMPONENTS',calibratedProbability:null,comparisonScope:'REVIEWED_NAMED_COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS_ONLY',identity:deep(requested),expected:reference(expected),actual:reference(actual),missingFeatureKeys:['WATER_METER']};
}
/** Scope DTO staging only; no original or persisted-review authority. */
export function validateWaterNodeScopeRequest(raw:unknown):WaterNodeScopeRequest|null{
 if(native(raw)!=='VALID'||!scope(raw,false))return null;const value=raw as unknown as WaterNodeScopeRequest;if(new Set(value.claims.map(c=>c.target.inventoryContentHash)).size!==value.claims.length)return null;return deep(value);
}
export function projectWaterNodeScopeDecision(raw:unknown):WaterNodeScopeRequest|null{
 if(native(raw)!=='VALID'||!scope(raw,true))return null;const value=raw as unknown as ScopeDecision;if(new Set(value.claims.map(c=>c.target.inventoryContentHash)).size!==value.claims.length)return null;
 const first=value.claims[0]?.inventorySnapshot;
 for(const c of value.claims){const s=c.inventorySnapshot;if(s.sourceFileId!==first!.sourceFileId||s.sourceSha256!==first!.sourceSha256||c.target.textArtifactHash!==s.textArtifactHash||c.target.inventoryContentHash!==waterNodeInventoryContentHash(s)||!same(c.selection,{pageNumber:s.pageNumber,regionBoxMilliPoints:s.regionBoxMilliPoints,headerFragments:s.headerFragments,scopeFragments:s.scopeFragments,endFragments:s.endFragments}))return null;}
 return{schemaVersion:value.schemaVersion,claims:value.claims.map(c=>({target:deep(c.target),selection:deep(c.selection),identity:deep(c.identity),nodeMapping:deep(c.nodeMapping),assertion:c.assertion,reference:c.reference}))};
}
