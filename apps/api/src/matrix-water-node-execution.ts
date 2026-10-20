/** T53 staged typed execution. JSON consistency is not database/actor/PDF-byte authentication. */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {readFileSync} from 'node:fs';
import {canonicalSourceDeclarationJson as canonical,extractSourceDeclarations} from './matrix-source-declarations.js';
import {reconstructZu129WaterNodeSource,waterNodeInventoryContentHash} from './matrix-water-node-source.js';
import {sourceSectionCodes,type MatrixCoverage,type MatrixWaterNodeScopeDecision} from '@inspector-ai/contracts';
import {compareZu129WaterNodeInventories,projectWaterNodeScopeDecision,type WaterNodeIdentity,type WaterNodeComparison} from './matrix-water-node-comparison.js';

type Obj=Record<string,any>;
const RULE='matrix-zu-129-declared_cold_water_inlet_meter_omission';
const GAP='PARTIAL_SUBRULES_ONLY:REVIEWED_NAMED_COMMON_BUILDING_COLD_WATER_INLET_NODE_METER_MEMBERSHIP_OMISSION_ONLY;QUANTITIES_CAPACITY_DIAMETERS_APARTMENT_HOT_WATER_ELECTRICITY_HEAT_OTHER_NODES_GLOBAL_PHYSICAL_ABSENCE_AND_NORMATIVE_COMPLIANCE_UNSUPPORTED';
const CAP={parameterCode:'ZU-129',matrixCode:'M-129',ruleId:RULE,ruleVersion:'1',enabled:true,comparisonVariant:'PD_RD',family:'PRESENCE_SET',executionKind:'REVIEWED_NAMED_COLD_WATER_INLET_NODE',resultSchemaVersion:'matrix-zu129-water-node-comparison-v1',partialGap:GAP};
const REGISTRY={schemaVersion:'matrix-water-node-capabilities-v1',entries:[CAP]};
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
export const WATER_NODE_CAPABILITY_REGISTRY=copy(REGISTRY);
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const registryHash=hash(REGISTRY);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const codepointCompare=(a:string,b:string):number=>{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)!-y[i].codePointAt(0)!;if(d)return d;}return x.length-y.length;};
const fail=(why:string):never=>{throw new Error(`Water-node execution integrity: ${why}`);};
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const record=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!isProxy(v)&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:readonly string[]):v is Obj=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const trim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const key=(v:unknown,max=200):v is string=>typeof v==='string'&&!!v&&trim(v)===v&&[...v].length<=max&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}(?![\s\S])/u.test(v);
/** Descriptor-first and ancestor-only walk: harmless aliases accepted, cycles/proxies/accessors rejected without reading them. */
function native(raw:unknown):void{let nodes=0,bytes=0;const ancestors=new Set<object>();
 const visit=(v:unknown,depth:number):void=>{if(++nodes>200000||depth>64)fail('native limit');if(v===null||typeof v==='boolean')return;
  if(typeof v==='number'){if(!integer(v))fail('native integer');return;}
  if(typeof v==='string'){if(v.length>8000000)fail('native string limit');let points=0;for(const c of v){if(++points>2000000)fail('native string limit');const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)fail('Unicode scalar');}bytes+=Buffer.byteLength(v,'utf8');if(bytes>8000000)fail('native byte limit');return;}
  if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))fail('native object');const obj=v as object,array=Array.isArray(obj);
  if(array?Object.getPrototypeOf(obj)!==Array.prototype:!record(obj))fail('native prototype');const ds=Object.getOwnPropertyDescriptors(obj),names=Reflect.ownKeys(ds);if(names.some(k=>typeof k!=='string'))fail('native symbol');let keys:string[];
  if(array){const count=ds.length?.value;if(!integer(count)||count<0||count>32768||names.length!==count+1)fail('native array');keys=Array.from({length:count},(_,i)=>String(i));}
  else{if(names.length>32768)fail('native container');keys=names as string[];}
  ancestors.add(obj);for(const k of keys){const d=ds[k];if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail('native descriptor');if(!array)visit(k,depth+1);visit(d.value,depth+1);}ancestors.delete(obj);
 };visit(raw,0);
}
function identity(v:unknown):v is WaterNodeIdentity{return exact(v,['entityKey','buildingKey','nodeKey','service','accountingScope','componentRole'])&&['entityKey','buildingKey','nodeKey'].every(k=>key(v[k]))&&v.service==='COLD_WATER'&&v.accountingScope==='COMMON_BUILDING_INLET'&&v.componentRole==='COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS';}
const integrityReasons=new Set(['INVALID_INPUT','INPUT_LIMIT','SOURCE_PROVENANCE_UNVERIFIED','INVENTORY_RECONSTRUCTION_UNVERIFIED']);
const operationalReasons=new Set(['NODE_IDENTITY_CONFLICT','SOURCE_STAGE_UNVERIFIED','AMBIGUOUS_INVENTORY_SCOPE','MATCHED_INVENTORY_PAIR_UNVERIFIED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','LINK_SCOPE_UNVERIFIED','NODE_MAPPING_UNVERIFIED','HUMAN_COMPLETENESS_UNVERIFIED','NONEMPTY_CLOSED_REGION_UNVERIFIED','PD_REQUIREMENT_UNVERIFIED','NEGATIVE_SCOPE_UNVERIFIED']);
function registry(raw:unknown):void{native(raw);if(!same(raw,REGISTRY))fail('capability registry');}
function checkComparison(c:WaterNodeComparison):void{if(c.status==='ABSTAIN'&&integrityReasons.has(c.reasonCode))fail(c.reasonCode);}
function projection(pkg:Obj,id:WaterNodeIdentity):Obj{return{schemaVersion:'matrix-zu129-water-node-input-v1',objectId:pkg.objectId,inputManifestHash:pkg.inputManifestHash,identity:id,sources:pkg.sources,origins:pkg.origins};}
const sentinel:WaterNodeIdentity={entityKey:'wrapper-structural-boundary',buildingKey:'wrapper-structural-boundary',nodeKey:'wrapper-structural-boundary',service:'COLD_WATER',accountingScope:'COMMON_BUILDING_INLET',componentRole:'COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS'};
export interface WaterNodeLoaderReview extends Obj {waterNodeScope:MatrixWaterNodeScopeDecision|null}
export interface WaterNodeLoaderSource extends Obj {review:WaterNodeLoaderReview|null}
export interface WaterNodeLoaderPackage {schemaVersion:'matrix-zu129-water-node-loader-inputs-v1';objectId:string;inputManifestHash:string;sources:WaterNodeLoaderSource[];origins:Obj[];identities:WaterNodeIdentity[]}
export type WaterNodeInventoryLoaderPackage=WaterNodeLoaderPackage;
/** Every supplied origin and claim is reconstructed before any outcome, even if no identity will be compared. */
export function validateWaterNodeLoaderPackage(raw:unknown):WaterNodeLoaderPackage{
 native(raw);if(!exact(raw,['schemaVersion','objectId','inputManifestHash','sources','origins','identities'])||raw.schemaVersion!=='matrix-zu129-water-node-loader-inputs-v1'||!key(raw.objectId)||!sha(raw.inputManifestHash)||!Array.isArray(raw.sources)||raw.sources.length>64||!Array.isArray(raw.origins)||raw.origins.length>128||!Array.isArray(raw.identities)||raw.identities.length>128||!raw.identities.every(identity))fail('loader DTO');
 const pkg=raw as unknown as WaterNodeLoaderPackage;validateSources(pkg.sources);let count=0;
 for(const s of pkg.sources){const claims=s?.review?.waterNodeScope?.claims;if(Array.isArray(claims)){if(claims.length>16)fail('claim limit');count+=claims.length;}}if(count>128)fail('total claim limit');
 // The frozen domain comparator owns strict nested DTO validation and all association guards.
 checkComparison(compareZu129WaterNodeInventories(projection(pkg,sentinel)));
 const sources=new Map(pkg.sources.map(s=>[s.sourceFileId,s]));
 const origins=new Map<string,Obj>();
 for(const o of pkg.origins){const s=sources.get(o.sourceFileId);if(!s||o.objectId!==pkg.objectId||s.sourceSha256!==o.sourceSha256)fail('origin association');
  const tuple=canonical([o.sourceFileId,o.checkId]);if(origins.has(tuple))fail('duplicate origin');origins.set(tuple,o);
  extractSourceDeclarations({objectId:pkg.objectId,inputManifestHash:o.inputManifestHash,sources:[{sourceFileId:o.sourceFileId,sha256:o.sourceSha256,stages:[]}],textArtifacts:[o.textArtifact]});
  if(hash({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:o.textArtifact})!==o.textArtifactHash)fail('full origin hash');
 }
 const found=new Map<string,WaterNodeIdentity>();
 for(const s of pkg.sources){const r=s.review;if(!r)continue;
  for(const o of pkg.origins.filter(o=>o.sourceFileId===s.sourceFileId)){for(const p of Object.keys(r.pageStages)){if(Number(p)>o.textArtifact.pageCount)fail('page stage outside origin');}}
  for(const c of r.waterNodeScope?.claims??[]){const o=origins.get(canonical([s.sourceFileId,c.target.checkId]))??fail('claim missing origin');
   const snap=c.inventorySnapshot;
   const rebuilt=reconstructZu129WaterNodeSource({sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,stage:snap.stage,pageStages:{},textArtifact:o.textArtifact,selection:c.selection});
   if(rebuilt.status!=='RECONSTRUCTED'||!same(rebuilt.inventory,snap)||snap.textArtifactHash!==o.textArtifactHash||waterNodeInventoryContentHash(rebuilt.inventory)!==c.target.inventoryContentHash)fail('stored inventory reconstruction');
   found.set(canonical(c.identity),c.identity);
  }
 }
 const ids=[...found.entries()].sort(([a],[b])=>codepointCompare(a,b)).map(([,v])=>v);
 if(!same(ids,pkg.identities))fail('claim-derived identities');
 // Duplicate claims and every operational outcome are checked with the complete committed projection.
 for(const id of ids)checkComparison(compareZu129WaterNodeInventories(projection(pkg,id)));
 return copy(pkg);
}
type WaterNodeCommon={schemaVersion:'matrix-water-node-execution-result-v1';id:string;ruleId:typeof RULE;ruleVersion:'1';parameterCode:'ZU-129';comparisonVariant:'PD_RD'};
export type WaterNodeExecutionResult=WaterNodeCommon&({kind:'SCOPED_COMPARISON';identity:WaterNodeIdentity;comparison:WaterNodeComparison}|{kind:'UNBOUND_ATOM_ABSTENTION';reasonCode:'REVIEWED_WATER_NODE_IDENTITY_MISSING';calibratedProbability:null});
export interface WaterNodeComparisons {schemaVersion:'matrix-water-node-comparisons-v1';purpose:'MACHINE_COMPARISON';objectId:string;inputManifestHash:string;capabilityRegistryHash:string;results:WaterNodeExecutionResult[]}
export interface WaterNodeComparisonEvidence {resultId:string;role:'EXPECTED'|'ACTUAL';sourceFileId:string;sourceSha256:string;reviewDecisionId:string;reviewContentHash:string;inventoryContentHash:string;originCheckId:string;pageNumber:number;pageFrame:{widthMilliPoints:number;heightMilliPoints:number};fragmentRole:'HEADER'|'SCOPE'|'END'|'FEATURE';fragment:{pageNumber:number;blockIndex:number;lineIndex:number;rawText:string;bboxMilliPoints:[number,number,number,number]}}
function resultId(envelope:Pick<WaterNodeComparisons,'objectId'|'inputManifestHash'|'capabilityRegistryHash'>,result:Obj):string{const {id:_,...body}=result;return hash({hashDomain:'matrix-water-node-execution-result-id-v1',objectId:envelope.objectId,inputManifestHash:envelope.inputManifestHash,capabilityRegistryHash:envelope.capabilityRegistryHash,result:body});}
export function buildWaterNodeComparisons(raw:unknown,rawRegistry:unknown=REGISTRY):WaterNodeComparisons{
 registry(rawRegistry);const pkg=validateWaterNodeLoaderPackage(raw);
 const envelope:WaterNodeComparisons={schemaVersion:'matrix-water-node-comparisons-v1',purpose:'MACHINE_COMPARISON',objectId:pkg.objectId,inputManifestHash:pkg.inputManifestHash,capabilityRegistryHash:registryHash,results:[]};
 const common={schemaVersion:'matrix-water-node-execution-result-v1',ruleId:RULE,ruleVersion:'1',parameterCode:'ZU-129',comparisonVariant:'PD_RD'};
 const bodies:Obj[]=pkg.identities.length?pkg.identities.map(id=>({...common,kind:'SCOPED_COMPARISON',identity:copy(id),comparison:compareZu129WaterNodeInventories(projection(pkg,id))})): [{...common,kind:'UNBOUND_ATOM_ABSTENTION',reasonCode:'REVIEWED_WATER_NODE_IDENTITY_MISSING',calibratedProbability:null}];
 envelope.results=bodies.map(body=>({...body,id:resultId(envelope,body)} as WaterNodeExecutionResult));
 return validateWaterNodeComparisons(envelope);
}
function reference(v:unknown):boolean{return exact(v,['sourceFileId','sourceSha256','reviewDecisionId','reviewContentHash','inventoryContentHash'])&&key(v.sourceFileId)&&key(v.reviewDecisionId)&&sha(v.sourceSha256)&&sha(v.reviewContentHash)&&sha(v.inventoryContentHash);}
function comparison(v:unknown,id:WaterNodeIdentity):boolean{
 if(!record(v)||v.schemaVersion!=='matrix-zu129-water-node-comparison-v1'||v.calibratedProbability!==null)return false;
 if(v.status==='ABSTAIN')return exact(v,['schemaVersion','status','reasonCode','calibratedProbability'])&&operationalReasons.has(v.reasonCode);
 return exact(v,['schemaVersion','status','ruleId','ruleVersion','parameterCode','reasonCode','calibratedProbability','comparisonScope','identity','expected','actual','missingFeatureKeys'])&&v.status==='CANDIDATE'&&v.ruleId===RULE&&v.ruleVersion==='1'&&v.parameterCode==='ZU-129'&&v.reasonCode==='WATER_METER_NOT_LISTED_IN_REVIEWED_RD_NODE_COMPONENTS'&&v.comparisonScope==='REVIEWED_NAMED_COMMON_BUILDING_COLD_WATER_INLET_NODE_COMPONENTS_ONLY'&&identity(v.identity)&&same(v.identity,id)&&reference(v.expected)&&reference(v.actual)&&v.expected.sourceFileId!==v.actual.sourceFileId&&same(v.missingFeatureKeys,['WATER_METER']);
}
/** Structural/hash validation alone never authenticates source truth; complete/seal/read must independently rebuild. */
export function validateWaterNodeComparisons(raw:unknown):WaterNodeComparisons{
 native(raw);if(!exact(raw,['schemaVersion','purpose','objectId','inputManifestHash','capabilityRegistryHash','results'])||raw.schemaVersion!=='matrix-water-node-comparisons-v1'||raw.purpose!=='MACHINE_COMPARISON'||!key(raw.objectId)||!sha(raw.inputManifestHash)||raw.capabilityRegistryHash!==registryHash||!Array.isArray(raw.results)||!raw.results.length||raw.results.length>128)fail('envelope DTO');
 const envelope=raw as Obj;let previous:string|undefined;
 for(const r of envelope.results){if(!record(r)||r.schemaVersion!=='matrix-water-node-execution-result-v1'||r.ruleId!==RULE||r.ruleVersion!=='1'||r.parameterCode!=='ZU-129'||r.comparisonVariant!=='PD_RD'||!sha(r.id))fail('result DTO');
  if(r.kind==='UNBOUND_ATOM_ABSTENTION'){if(!exact(r,['schemaVersion','id','ruleId','ruleVersion','parameterCode','comparisonVariant','kind','reasonCode','calibratedProbability'])||envelope.results.length!==1||r.reasonCode!=='REVIEWED_WATER_NODE_IDENTITY_MISSING'||r.calibratedProbability!==null)fail('unbound result');}
  else if(r.kind==='SCOPED_COMPARISON'){if(!exact(r,['schemaVersion','id','ruleId','ruleVersion','parameterCode','comparisonVariant','kind','identity','comparison'])||!identity(r.identity)||!comparison(r.comparison,r.identity))fail('scoped result');const k=canonical(r.identity);if(previous!==undefined&&codepointCompare(k,previous)<=0)fail('result identity order');previous=k;}
  else fail('result kind');
  if(resultId(raw as unknown as WaterNodeComparisons,r)!==r.id)fail('result ID');
 }
 return copy(raw as unknown as WaterNodeComparisons);
}
const scalarRegistry=JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-execution-v1.json',import.meta.url),'utf8')) as {entries:Obj[]};
const counters=['implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures'];
export function mergeWaterNodeCoverage(raw:unknown,rawEnvelope:unknown,rawRegistry:unknown=REGISTRY):MatrixCoverage[]{
 native(raw);registry(rawRegistry);const envelope=validateWaterNodeComparisons(rawEnvelope);
 if(!Array.isArray(raw)||raw.length!==132||scalarRegistry.entries.length!==132||scalarRegistry.entries.some(e=>e.atomicRules.some((r:Obj)=>r.ruleId===RULE)))fail('coverage registry overlap/order');
 const rows=raw as Obj[];for(let i=0;i<rows.length;i++){const row=rows[i];if(!exact(row,['parameterCode',...counters,'executionStatus','reason'])||row.parameterCode!==scalarRegistry.entries[i].parameterCode||!counters.every(k=>integer(row[k])&&row[k]>=0)||!['UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE'].includes(row.executionStatus)||typeof row.reason!=='string')fail('coverage row');
 }
 const base=rows.find(r=>r.parameterCode==='ZU-129');if(!base||base.executionStatus!=='UNSUPPORTED'||!counters.every(k=>base[k]===0))fail('water node overlap');
 const successes=envelope.results.filter(r=>r.kind==='SCOPED_COMPARISON'&&r.comparison.status==='CANDIDATE').length;
 return copy(rows.map(row=>row.parameterCode!=='ZU-129'?row:{...row,implementedAtomicRules:1,enabledAtomicRules:1,evaluatedAtomicRules:1,successfulComparisons:successes,abstentions:envelope.results.length-successes,failures:0,executionStatus:'PARTIAL',reason:GAP})) as MatrixCoverage[];
}
export function waterNodeComparisonEvidence(rawPackage:unknown,rawEnvelope:unknown,rawRegistry:unknown=REGISTRY):WaterNodeComparisonEvidence[]{
 const pkg=validateWaterNodeLoaderPackage(rawPackage),envelope=validateWaterNodeComparisons(rawEnvelope),expected=buildWaterNodeComparisons(pkg,rawRegistry);if(!same(envelope,expected))fail('evidence envelope reconstruction');
 const items:Obj[]=[];
 for(const result of envelope.results){if(result.kind!=='SCOPED_COMPARISON'||result.comparison.status!=='CANDIDATE')continue;
  for(const role of ['EXPECTED','ACTUAL'] as const){const ref=result.comparison[role==='EXPECTED'?'expected':'actual'];const source=pkg.sources.find(s=>s.sourceFileId===ref.sourceFileId&&s.sourceSha256===ref.sourceSha256&&s.review?.decisionId===ref.reviewDecisionId&&s.review?.contentHash===ref.reviewContentHash);if(!source)fail('evidence source');
   const claims=(source!.review!.waterNodeScope?.claims??[]).filter((c:Obj)=>same(c.identity,result.identity)&&c.target.inventoryContentHash===ref.inventoryContentHash);if(claims.length!==1)fail('evidence claim');const claim=claims[0],inventory=claim.inventorySnapshot;
   const base={resultId:result.id,role,...ref,originCheckId:claim.target.checkId,pageNumber:inventory.pageNumber,pageFrame:{widthMilliPoints:inventory.widthMilliPoints,heightMilliPoints:inventory.heightMilliPoints}};
   const seen=new Set<string>();const add=(fragmentRole:string,fragment:Obj)=>{const k=canonical([fragmentRole,fragment]);if(!seen.has(k)){seen.add(k);items.push({...base,fragmentRole,fragment:copy(fragment)});}};
   for(const [field,kind] of [['headerFragments','HEADER'],['scopeFragments','SCOPE'],['endFragments','END']] as const)for(const f of inventory[field])add(kind,f);
   for(const row of inventory.featureRows)for(const f of row.fragments)add('FEATURE',f);
  }
 }
 return copy(items) as WaterNodeComparisonEvidence[];
}
/** Strict source DTO boundary; reconstruction/PDF/actor authority still requires full loader validation. */
function validateSources(raw:unknown):asserts raw is Obj[]{
 native(raw);if(!Array.isArray(raw)||raw.length>64)fail('identity sources');const ids=new Set<string>();let total=0;
 for(const s of raw as Obj[]){if(!exact(s,['sourceFileId','sourceSha256','stages','reviewSnapshot','review'])||!key(s.sourceFileId)||!sha(s.sourceSha256)||!Array.isArray(s.stages)||s.stages.length>4||s.stages.some((v:unknown)=>typeof v!=='string'||!['PD','RD','ID','UNRESOLVED'].includes(v))||new Set(s.stages).size!==s.stages.length||ids.has(s.sourceFileId))fail('identity source DTO');ids.add(s.sourceFileId);
  const r=s.review,rs=s.reviewSnapshot;if(r===null||rs===null){if(r!==null||rs!==null)fail('review null association');continue;}
  if(!exact(rs,['decisionId','contentHash'])||!key(rs.decisionId)||!sha(rs.contentHash)||!exact(r,['decisionId','contentHash','objectId','sourceFileId','sourceSha256','actorId','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages','waterNodeScope'])||!['decisionId','objectId','sourceFileId','actorId'].every(k=>key(r[k]))||!sha(r.contentHash)||!sha(r.sourceSha256)||!['CURRENT','SUPERSEDED','UNKNOWN'].includes(r.revisionStatus)||!['APPROVED','UNAPPROVED','UNKNOWN'].includes(r.approvalStatus)||(r.sectionCode!==null&&!(sourceSectionCodes as readonly unknown[]).includes(r.sectionCode))||(r.linkGroupId!==null&&!key(r.linkGroupId,120))||!record(r.pageStages)||!Object.entries(r.pageStages).every(([p,v])=>/^[1-9][0-9]{0,15}(?![\s\S])/u.test(p)&&integer(Number(p))&&Number(p)>0&&typeof v==='string'&&['PD','RD','ID','UNRESOLVED'].includes(v))||r.sourceFileId!==s.sourceFileId||r.sourceSha256!==s.sourceSha256||r.decisionId!==rs.decisionId||r.contentHash!==rs.contentHash)fail('identity review DTO/association');
  if(r.waterNodeScope!==null&&!projectWaterNodeScopeDecision(r.waterNodeScope))fail('identity scope DTO');const claims=r.waterNodeScope?.claims??[];total+=claims.length;if(total>128)fail('identity claim total');const seen=new Set<string>();
  for(const c of claims){if(c.inventorySnapshot.sourceFileId!==s.sourceFileId||c.inventorySnapshot.sourceSha256!==s.sourceSha256||seen.has(c.target.inventoryContentHash))fail('identity snapshot association/duplicate hash');seen.add(c.target.inventoryContentHash);}
 }
}
export function deriveWaterNodeIdentities(sources:WaterNodeLoaderPackage['sources']):WaterNodeIdentity[]{
 validateSources(sources);const ids=new Map<string,WaterNodeIdentity>();
 for(const s of sources)for(const c of s.review?.waterNodeScope?.claims??[])ids.set(canonical(c.identity),c.identity);
 return copy([...ids.entries()].sort(([a],[b])=>codepointCompare(a,b)).map(([,id])=>id));
}
export const validateWaterNodeComparisonsEnvelope=validateWaterNodeComparisons;
export const waterNodeCapabilityRegistryHash=registryHash;
