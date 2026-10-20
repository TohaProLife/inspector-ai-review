/** Independent T44 pure comparison of protected-loader metadata projections.
 * No database/source-byte authority, physical absence, equivalence or confidence.
 * Future loader must authenticate ALL retained origins/reviews/claims before use.
 */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {sourceSectionCodes} from '@inspector-ai/contracts';
import {reconstructOdi123CallInventorySource,callInventoryContentHash,
  type CallSourceInventory,type CallInventorySelection} from './matrix-call-inventory-source.js';

export const CALL_COMPARISON_VERSION='matrix-odi123-call-inventory-comparison-v1';
export const CALL_COMPARISON_RULE_ID='matrix-odi-123-declared_sanitary_room_personnel_call_button_omission';
type RecordValue=Record<string,unknown>;
type Box=[number,number,number,number];
export interface CallRoomIdentity {entityKey:string;buildingKey:string;floorKey:string;roomKey:string;
  componentRole:'ACCESSIBLE_SANITARY_ROOM_CALL_SYSTEM';systemKind:'PERSONNEL_CALL'}
interface OriginTarget {checkId:string;inputManifestHash:string;textStageContentHash:string;textArtifactHash:string;inventoryContentHash:string}
interface RoomMapping {kind:'HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING';sourceRoomToken:string;assertion:'UNKNOWN'|'HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'}
interface Claim {target:OriginTarget;selection:CallInventorySelection;identity:CallRoomIdentity;roomMapping:RoomMapping;
  assertion:'UNKNOWN'|'HUMAN_ASSERTED_COMPLETE';reference:string;inventorySnapshot:CallSourceInventory}
interface Review {decisionId:string;contentHash:string;objectId:string;sourceFileId:string;sourceSha256:string;actorId:string;
  revisionStatus:'CURRENT'|'SUPERSEDED'|'UNKNOWN';approvalStatus:'APPROVED'|'UNAPPROVED'|'UNKNOWN';
  sectionCode:string|null;linkGroupId:string|null;pageStages:Record<string,string>;
  callInventoryScope:null|{schemaVersion:'matrix-odi123-call-inventory-review-v1';claims:Claim[]}}
interface Source {sourceFileId:string;sourceSha256:string;stages:string[];reviewSnapshot:null|{decisionId:string;contentHash:string};review:Review|null}
interface Origin {checkId:string;objectId:string;sourceFileId:string;sourceSha256:string;inputManifestHash:string;
  textStageContentHash:string;textArtifactHash:string;textArtifact:RecordValue}
interface Projection {schemaVersion:'matrix-odi123-call-inventory-input-v1';objectId:string;inputManifestHash:string;
  identity:CallRoomIdentity;sources:Source[];origins:Origin[]}
export type CallComparisonReason='INVALID_INPUT'|'INPUT_LIMIT'|'SOURCE_PROVENANCE_UNVERIFIED'|'ROOM_IDENTITY_CONFLICT'
  |'SOURCE_STAGE_UNVERIFIED'|'AMBIGUOUS_INVENTORY_SCOPE'|'MATCHED_INVENTORY_PAIR_UNVERIFIED'|'SOURCE_REVIEW_UNVERIFIED'
  |'SOURCE_SECTION_UNVERIFIED'|'LINK_SCOPE_UNVERIFIED'|'INVENTORY_RECONSTRUCTION_UNVERIFIED'|'ROOM_MAPPING_UNVERIFIED'
  |'HUMAN_COMPLETENESS_UNVERIFIED'|'NONEMPTY_CLOSED_REGION_UNVERIFIED'|'PD_REQUIREMENT_UNVERIFIED'|'NEGATIVE_SCOPE_UNVERIFIED';
export interface CallInventoryReference {sourceFileId:string;sourceSha256:string;reviewDecisionId:string;reviewContentHash:string;inventoryContentHash:string}
export type CallComparisonResult={schemaVersion:typeof CALL_COMPARISON_VERSION;status:'ABSTAIN';reasonCode:CallComparisonReason;calibratedProbability:null}
  |{schemaVersion:typeof CALL_COMPARISON_VERSION;status:'CANDIDATE';ruleId:typeof CALL_COMPARISON_RULE_ID;ruleVersion:'1';
    parameterCode:'ODI-123';reasonCode:'PERSONNEL_CALL_BUTTON_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY';
    calibratedProbability:null;comparisonScope:'REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY';
    identity:CallRoomIdentity;expected:CallInventoryReference;actual:CallInventoryReference;missingFeatureKeys:['PERSONNEL_CALL_BUTTON']};
const KEYS={
  identity:['entityKey','buildingKey','floorKey','roomKey','componentRole','systemKind'],
  fragment:['pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'],
  selection:['pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'],
  inventory:['schemaVersion','extractorVersion','policyVersion','sourceFileId','sourceSha256','textArtifactHash','stage','pageNumber',
    'widthMilliPoints','heightMilliPoints','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments','roomToken','featureRows'],
  target:['checkId','inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'],
  claim:['target','selection','identity','roomMapping','assertion','reference','inventorySnapshot'],
  review:['decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','callInventoryScope'],
  source:['sourceFileId','sourceSha256','stages','reviewSnapshot','review'],
  origin:['checkId','objectId','sourceFileId','sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash','textArtifact'],
  projection:['schemaVersion','objectId','inputManifestHash','identity','sources','origins']
};
const STAGES=['PD','RD','ID','UNRESOLVED'];
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const positive=(v:unknown):v is number=>integer(v)&&v>0;
const record=(v:unknown):v is RecordValue=>v!==null&&typeof v==='object'&&!isProxy(v)&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:string[]):v is RecordValue=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const member=(v:unknown,allowed:readonly string[]):v is string=>typeof v==='string'&&allowed.includes(v);
const pyTrim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const line=(v:unknown):v is string=>typeof v==='string'&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v);
const key=(v:unknown,max=200):v is string=>line(v)&&v.length>0&&[...v].length<=max&&pyTrim(v)===v;
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}(?![\s\S])/u.test(v);
const box=(v:unknown):v is Box=>Array.isArray(v)&&v.length===4&&v.every(integer)&&v[0]>=0&&v[1]>=0&&v[0]<v[2]&&v[1]<v[3];
const contains=(a:Box,b:Box)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
const fragment=(v:unknown):boolean=>exact(v,KEYS.fragment)&&positive(v.pageNumber)&&integer(v.blockIndex)&&v.blockIndex>=0
  &&integer(v.lineIndex)&&v.lineIndex>=0&&line(v.rawText)&&pyTrim(v.rawText).length>0&&[...v.rawText].length<=8192&&box(v.bboxMilliPoints);
const oneFragment=(v:unknown):v is RecordValue[]=>Array.isArray(v)&&v.length===1&&v.every(fragment);
const selection=(v:unknown):v is RecordValue=>exact(v,KEYS.selection)&&positive(v.pageNumber)&&box(v.regionBoxMilliPoints)
  &&oneFragment(v.headerFragments)&&oneFragment(v.scopeFragments)&&oneFragment(v.endFragments);
const identity=(v:unknown):v is RecordValue=>exact(v,KEYS.identity)&&['entityKey','buildingKey','floorKey','roomKey'].every(k=>key(v[k]))
  &&v.componentRole==='ACCESSIBLE_SANITARY_ROOM_CALL_SYSTEM'&&v.systemKind==='PERSONNEL_CALL';
const pageStages=(v:unknown):v is RecordValue=>record(v)&&Object.entries(v).every(([k,s])=>/^[1-9][0-9]{0,15}(?![\s\S])/u.test(k)&&positive(Number(k))&&member(s,STAGES));
function snapshot(v:unknown):boolean {
  if(!exact(v,KEYS.inventory)||v.schemaVersion!=='matrix-odi123-call-inventory-source-v1'||v.extractorVersion!=='matrix-odi123-call-inventory-source-v1'
    ||v.policyVersion!=='matrix-odi123-call-inventory-literals-v1'||!key(v.sourceFileId)||!sha(v.sourceSha256)||!sha(v.textArtifactHash)
    ||!member(v.stage,['PD','RD'])||!positive(v.pageNumber)||!positive(v.widthMilliPoints)||!positive(v.heightMilliPoints)
    ||!box(v.regionBoxMilliPoints)||!oneFragment(v.headerFragments)||!oneFragment(v.scopeFragments)||!oneFragment(v.endFragments)
    ||!key(v.roomToken)||!Array.isArray(v.featureRows)||v.featureRows.length<1||v.featureRows.length>2)return false;
  const frame:Box=[0,0,v.widthMilliPoints,v.heightMilliPoints];
  if(!contains(frame,v.regionBoxMilliPoints))return false;
  const fragments=[...v.headerFragments,...v.scopeFragments,...v.endFragments];
  for(const row of v.featureRows){
    if(!exact(row,['featureKey','fragments'])||!member(row.featureKey,['PERSONNEL_CALL_BUTTON','TWO_WAY_COMMUNICATION_SYSTEM'])||!oneFragment(row.fragments))return false;
    fragments.push(...row.fragments);
  }
  return fragments.every(f=>f.pageNumber===v.pageNumber&&contains(frame,f.bboxMilliPoints as Box));
}
function claim(v:unknown):boolean {
  return exact(v,KEYS.claim)&&exact(v.target,KEYS.target)&&key(v.target.checkId,120)
    &&['inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'].every(k=>sha((v.target as RecordValue)[k]))
    &&selection(v.selection)&&identity(v.identity)
    &&exact(v.roomMapping,['kind','sourceRoomToken','assertion'])&&v.roomMapping.kind==='HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING'
    &&key(v.roomMapping.sourceRoomToken)&&member(v.roomMapping.assertion,['UNKNOWN','HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'])
    &&member(v.assertion,['UNKNOWN','HUMAN_ASSERTED_COMPLETE'])&&line(v.reference)&&pyTrim(v.reference)===v.reference
    &&[...v.reference].length>=8&&[...v.reference].length<=1000&&snapshot(v.inventorySnapshot);
}
function review(v:unknown):boolean {
  return exact(v,KEYS.review)&&['decisionId','objectId','sourceFileId','actorId'].every(k=>key(v[k]))&&sha(v.contentHash)&&sha(v.sourceSha256)
    &&member(v.revisionStatus,['CURRENT','SUPERSEDED','UNKNOWN'])&&member(v.approvalStatus,['APPROVED','UNAPPROVED','UNKNOWN'])
    &&(v.sectionCode===null||member(v.sectionCode,sourceSectionCodes))&&(v.linkGroupId===null||key(v.linkGroupId,120))&&pageStages(v.pageStages)
    &&(v.callInventoryScope===null||(exact(v.callInventoryScope,['schemaVersion','claims'])&&v.callInventoryScope.schemaVersion==='matrix-odi123-call-inventory-review-v1'
      &&Array.isArray(v.callInventoryScope.claims)&&v.callInventoryScope.claims.every(claim)));
}
function source(v:unknown):boolean {
  return exact(v,KEYS.source)&&key(v.sourceFileId)&&sha(v.sourceSha256)&&Array.isArray(v.stages)&&v.stages.every(s=>member(s,STAGES))
    &&new Set(v.stages).size===v.stages.length&&((v.review===null&&v.reviewSnapshot===null)
      ||(review(v.review)&&exact(v.reviewSnapshot,['decisionId','contentHash'])&&key(v.reviewSnapshot.decisionId)&&sha(v.reviewSnapshot.contentHash)));
}
function origin(v:unknown):boolean {
  return exact(v,KEYS.origin)&&key(v.checkId,120)&&key(v.objectId)&&key(v.sourceFileId)
    &&['sourceSha256','inputManifestHash','textStageContentHash','textArtifactHash'].every(k=>sha(v[k]))&&record(v.textArtifact);
}

/** Descriptor-first whole-tree guard. No getter/proxy/coercion is executed. */
function portable(input:unknown):'VALID'|'INVALID'|'LIMIT' {
  let nodes=0,bytes=0,limited=false;const parents=new Set<object>();
  const limit=()=>{limited=true;return false;};
  function visit(value:unknown,depth:number):boolean {
    if(++nodes>200000||depth>64)return limit();
    if(value===null||typeof value==='boolean')return true;
    if(typeof value==='number')return integer(value);
    if(typeof value==='string'){
      if(value.length>8000000)return limit();
      let points=0;for(const c of value){if(++points>2000000)return limit();const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}
      bytes+=Buffer.byteLength(value,'utf8');return bytes>8000000?limit():true;
    }
    if(value===null||typeof value!=='object'||isProxy(value)||parents.has(value))return false;
    const array=Array.isArray(value);
    if(array?Object.getPrototypeOf(value)!==Array.prototype:!record(value))return false;
    const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
    if(names.some(n=>typeof n!=='string'))return false;
    let keys:string[];
    if(array){const length=descriptors.length?.value;if(!integer(length)||length<0)return false;if(length>32768)return limit();
      if(names.length!==length+1)return false;keys=Array.from({length},(_,i)=>String(i));}
    else {if(names.length>32768)return limit();keys=names as string[];}
    parents.add(value);
    for(const k of keys){const d=descriptors[k];if(!d||!d.enumerable||!Object.hasOwn(d,'value')||(!array&&!visit(k,depth+1))||!visit(d.value,depth+1)){parents.delete(value);return false;}}
    parents.delete(value);return true;
  }
  try{return visit(input,0)?'VALID':limited?'LIMIT':'INVALID';}catch{return 'INVALID';}
}
/** Collection budgets precede DTO interpretation, after the native tree is safe. */
function collectionLimit(input:unknown):boolean {
  if(!record(input))return false;
  if(Array.isArray(input.sources)&&input.sources.length>64||Array.isArray(input.origins)&&input.origins.length>128)return true;
  let count=0;
  if(Array.isArray(input.sources))for(const s of input.sources){
    if(!record(s)||!record(s.review)||!record(s.review.callInventoryScope)||!Array.isArray(s.review.callInventoryScope.claims))continue;
    const length=s.review.callInventoryScope.claims.length;count+=length;if(length>16||count>128)return true;
  }
  return false;
}
const abstain=(reasonCode:CallComparisonReason):CallComparisonResult=>({schemaVersion:CALL_COMPARISON_VERSION,status:'ABSTAIN',reasonCode,calibratedProbability:null});
function canonical(v:unknown):string {
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  const o=v as RecordValue;
  // Codepoint lexical order, independent of locale and UTF16 surrogate ordering.
  const order=(a:string,b:string)=>{const aa=Array.from(a),bb=Array.from(b);for(let i=0;i<Math.min(aa.length,bb.length);i++){
    const delta=aa[i]!.codePointAt(0)!-bb[i]!.codePointAt(0)!;if(delta)return delta;}return aa.length-bb.length;};
  return '{'+Object.keys(o).sort(order).map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
}
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const textHash=(textArtifact:unknown)=>createHash('sha256').update(canonical({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact})).digest('hex');
const physical=(a:CallRoomIdentity,b:CallRoomIdentity)=>a.buildingKey===b.buildingKey&&a.floorKey===b.floorKey&&a.roomKey===b.roomKey;
const inventoryReference=(s:Source,c:Claim):CallInventoryReference=>({sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,
  reviewDecisionId:s.review!.decisionId,reviewContentHash:s.review!.contentHash,inventoryContentHash:c.target.inventoryContentHash});

/** Compare projected frozen reviews only. A future protected loader supplies authority. */
export function compareOdi123CallInventories(input:unknown):CallComparisonResult {
  const native=portable(input);if(native!=='VALID')return abstain(native==='LIMIT'?'INPUT_LIMIT':'INVALID_INPUT');
  if(collectionLimit(input))return abstain('INPUT_LIMIT');
  if(!exact(input,KEYS.projection)||input.schemaVersion!=='matrix-odi123-call-inventory-input-v1'||!key(input.objectId)||!sha(input.inputManifestHash)
    ||!identity(input.identity)||!Array.isArray(input.sources)||!input.sources.every(source)||!Array.isArray(input.origins)||!input.origins.every(origin))return abstain('INVALID_INPUT');
  const p=input as unknown as Projection;
  const sources=new Map(p.sources.map(s=>[s.sourceFileId,s]));
  const origins=new Map(p.origins.map(o=>[canonical([o.sourceFileId,o.checkId]),o]));
  if(sources.size!==p.sources.length||origins.size!==p.origins.length)return abstain('INVALID_INPUT');
  for(const o of p.origins){const s=sources.get(o.sourceFileId);if(!s||o.objectId!==p.objectId||o.sourceSha256!==s.sourceSha256)return abstain('SOURCE_PROVENANCE_UNVERIFIED');}
  const collected:Array<{source:Source;claim:Claim;origin:Origin}>=[];
  for(const s of p.sources){const r=s.review;if(!r)continue;
    if(r.decisionId!==s.reviewSnapshot!.decisionId||r.contentHash!==s.reviewSnapshot!.contentHash||r.objectId!==p.objectId
      ||r.sourceFileId!==s.sourceFileId||r.sourceSha256!==s.sourceSha256)return abstain('SOURCE_PROVENANCE_UNVERIFIED');
    for(const c of r.callInventoryScope?.claims??[]){
      const o=origins.get(canonical([s.sourceFileId,c.target.checkId]));
      if(!o||c.target.inputManifestHash!==o.inputManifestHash||c.target.textStageContentHash!==o.textStageContentHash||c.target.textArtifactHash!==o.textArtifactHash
        ||c.inventorySnapshot.sourceFileId!==s.sourceFileId||c.inventorySnapshot.sourceSha256!==s.sourceSha256)return abstain('SOURCE_PROVENANCE_UNVERIFIED');
      if(c.identity.entityKey===p.identity.entityKey||physical(c.identity,p.identity))collected.push({source:s,claim:c,origin:o});
    }
  }
  if(collected.some(c=>!equal(c.claim.identity,p.identity)))return abstain('ROOM_IDENTITY_CONFLICT');
  for(const c of collected)if(c.source.stages.length!==1||!['PD','RD'].includes(c.source.stages[0]!)
    ||Object.values(c.source.review!.pageStages).some(stage=>stage!==c.source.stages[0]))return abstain('SOURCE_STAGE_UNVERIFIED');
  const groups={PD:[] as typeof collected,RD:[] as typeof collected};
  for(const c of collected)groups[c.source.stages[0] as 'PD'|'RD'].push(c);
  for(const group of Object.values(groups)){const hashes=group.map(c=>c.claim.target.inventoryContentHash);if(new Set(hashes).size!==hashes.length)return abstain('INVALID_INPUT');}
  if(Object.values(groups).some(group=>group.length>1))return abstain('AMBIGUOUS_INVENTORY_SCOPE');
  const pd=groups.PD[0],rd=groups.RD[0];
  if(!pd||!rd||pd.source.sourceFileId===rd.source.sourceFileId)return abstain('MATCHED_INVENTORY_PAIR_UNVERIFIED');
  const pair=[pd,rd];
  if(pair.some(c=>c.source.review!.revisionStatus!=='CURRENT'||c.source.review!.approvalStatus!=='APPROVED'))return abstain('SOURCE_REVIEW_UNVERIFIED');
  if(!['SS','ODI'].includes(pd.source.review!.sectionCode??'')||rd.source.review!.sectionCode!=='SS')return abstain('SOURCE_SECTION_UNVERIFIED');
  if(!pd.source.review!.linkGroupId||pd.source.review!.linkGroupId!==rd.source.review!.linkGroupId)return abstain('LINK_SCOPE_UNVERIFIED');
  const inventories:CallSourceInventory[]=[];
  for(const c of pair){
    const reconstructed=reconstructOdi123CallInventorySource({sourceFileId:c.source.sourceFileId,sourceSha256:c.source.sourceSha256,
      stage:c.source.stages[0],pageStages:c.source.review!.pageStages,textArtifact:c.origin.textArtifact,selection:c.claim.selection});
    if(reconstructed.status!=='RECONSTRUCTED'||textHash(c.origin.textArtifact)!==c.origin.textArtifactHash
      ||!equal(reconstructed.inventory,c.claim.inventorySnapshot)||callInventoryContentHash(reconstructed.inventory)!==c.claim.target.inventoryContentHash)
      return abstain('INVENTORY_RECONSTRUCTION_UNVERIFIED');
    inventories.push(reconstructed.inventory);
  }
  if(pair.some((c,i)=>c.claim.roomMapping.sourceRoomToken!==inventories[i]!.roomToken||c.claim.roomMapping.assertion!=='HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM'))return abstain('ROOM_MAPPING_UNVERIFIED');
  if(pair.some(c=>c.claim.assertion!=='HUMAN_ASSERTED_COMPLETE'))return abstain('HUMAN_COMPLETENESS_UNVERIFIED');
  if(inventories.some(i=>i.featureRows.length===0))return abstain('NONEMPTY_CLOSED_REGION_UNVERIFIED');
  const pdKeys=inventories[0]!.featureRows.map(r=>r.featureKey),rdKeys=inventories[1]!.featureRows.map(r=>r.featureKey);
  if(!pdKeys.includes('PERSONNEL_CALL_BUTTON'))return abstain('PD_REQUIREMENT_UNVERIFIED');
  if(rdKeys.includes('PERSONNEL_CALL_BUTTON')||!rdKeys.includes('TWO_WAY_COMMUNICATION_SYSTEM'))return abstain('NEGATIVE_SCOPE_UNVERIFIED');
  return {schemaVersion:CALL_COMPARISON_VERSION,status:'CANDIDATE',ruleId:CALL_COMPARISON_RULE_ID,ruleVersion:'1',parameterCode:'ODI-123',
    reasonCode:'PERSONNEL_CALL_BUTTON_NOT_LISTED_IN_REVIEWED_RD_ROOM_INVENTORY',calibratedProbability:null,
    comparisonScope:'REVIEWED_NAMED_ACCESSIBLE_ROOM_DECLARED_REGIONS_ONLY',identity:{...p.identity},
    expected:inventoryReference(pd.source,pd.claim),actual:inventoryReference(rd.source,rd.claim),missingFeatureKeys:['PERSONNEL_CALL_BUTTON']};
}
