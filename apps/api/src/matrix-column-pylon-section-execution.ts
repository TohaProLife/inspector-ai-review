/** Seventh, scoped KR060 execution. DB/PDF/actor/latest-journal authority stays with protected loaders. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isProxy} from 'node:util/types';
import type {MatrixCoverage,ColumnPylonSectionLoaderPackage,ColumnPylonSectionExecutionComparisons,ColumnPylonSectionExecutionEvidence} from '@inspector-ai/contracts';
import {compareKr060ColumnPylonSection,columnPylonSectionPairKey,validateColumnPylonSectionReviewDecision} from './matrix-column-pylon-section-v2.js';
import {validateColumnPylonSectionRunSnapshot} from './matrix-column-pylon-section-run-snapshot.js';

type Data=any;
type Code='INVALID_INPUT'|'INPUT_LIMIT'|'INVALID_PACKAGE'|'INVALID_SNAPSHOT'|'INVALID_REGISTRY'|'INVALID_COMPARISONS'|'INVALID_EVIDENCE'|'INVALID_COVERAGE';
export class ColumnPylonSectionExecutionValidationError extends TypeError {constructor(public readonly code:Code){super(code);this.name='ColumnPylonSectionExecutionValidationError';}}
function fail(code:Code):never{throw new ColumnPylonSectionExecutionValidationError(code);}
const policies={PACKAGE:[67108864,2900000,68],SNAPSHOT:[524288,200000,64],REGISTRY:[524288,200000,64],COMPARISONS:[8388608,200000,64],EVIDENCE:[33554432,200000,64],COVERAGE:[8388608,200000,64]} as const;
function cp(a:string,b:string):number{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const n=x[i]!.codePointAt(0)!-y[i]!.codePointAt(0)!;if(n)return n;}return x.length-y.length;}
/** Descriptor-first native guard. No user getter/proxy/iterator/toJSON is called. */
function canonical(value:unknown,policy:keyof typeof policies='PACKAGE'):string{
 const [bytes,maxNodes,maxDepth]=policies[policy];let nodes=0,charged=0;const ancestors=new Set<object>();
 const add=(n:number)=>{charged+=n;if(charged>bytes)fail('INPUT_LIMIT');};
 const visit=(v:unknown,d:number):string=>{
  if(++nodes>maxNodes||d>maxDepth)fail('INPUT_LIMIT');
  if(v===null){add(4);return 'null';}if(typeof v==='boolean'){add(v?4:5);return String(v);}
  if(typeof v==='number'){if(!Number.isSafeInteger(v))fail('INVALID_INPUT');const s=String(v);add(s.length);return s;}
  if(typeof v==='string'){if(v.length>4000000)fail('INPUT_LIMIT');let count=0;for(const c of v){if(++count>2000000)fail('INPUT_LIMIT');const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)fail('INVALID_INPUT');}const s=JSON.stringify(v);add(Buffer.byteLength(s));return s;}
  if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))fail('INVALID_INPUT');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)fail('INVALID_INPUT');
  const desc=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(desc);if(names.some(k=>typeof k!=='string'))fail('INVALID_INPUT');let keys:string[];
  if(array){const n=desc.length?.value;if(!Number.isSafeInteger(n)||n<0)fail('INVALID_INPUT');if(n>32768)fail('INPUT_LIMIT');if(names.length!==n+1)fail('INVALID_INPUT');keys=Array.from({length:n},(_,i)=>String(i));}
  else{if(names.length>32768)fail('INPUT_LIMIT');keys=(names as string[]).sort(cp);}
  ancestors.add(v);add(2+Math.max(0,keys.length-1)+(array?0:keys.length));const out:string[]=[];
  for(const k of keys){const e=desc[k];if(!e?.enumerable||!Object.hasOwn(e,'value'))fail('INVALID_INPUT');out.push(array?visit(e.value,d+1):visit(k,d+1)+':'+visit(e.value,d+1));}ancestors.delete(v);return (array?'[':'{')+out.join(',')+(array?']':'}');
 };return visit(value,0);
}
const detached=(v:unknown,p:keyof typeof policies):Data=>JSON.parse(canonical(v,p));
const clone=(v:unknown):Data=>JSON.parse(canonical(v));
const hash=(v:unknown):string=>createHash('sha256').update(canonical(v),'utf8').digest('hex');
const eq=(a:unknown,b:unknown):boolean=>canonical(a)===canonical(b);
const omit=(v:Data,keys:string[]):Data=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
const exact=(v:Data,keys:string[]):boolean=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const schemas:Record<string,Data>={};
for(const name of ['matrix-column-pylon-section-execution.schema.json','matrix-column-pylon-section-loader.schema.json','matrix-column-pylon-section-v2.schema.json','matrix-column-pylon-section-run-snapshot.schema.json','document-text-v3.schema.json','column-pylon-dimension-literals.schema.json'])schemas[name]=JSON.parse(readFileSync(new URL('../../../packages/contracts/src/'+name,import.meta.url),'utf8'));
type ShapePlan={references:Map<string,[Data,string]>;patterns:Map<string,RegExp>};
/** Fixed-schema metadata only. Fresh private plan per top-level shape call. */
function shapeReference(n:Data,file:string,plan:ShapePlan):[Data,string]{
 const key=file+'\0'+n.$ref;
 if(plan.references.has(key))return plan.references.get(key)!;
 const [f,ptr]=n.$ref.split('#'),base=f||file;let ref=schemas[base];
 for(const k of (ptr||'').split('/').slice(1))ref=ref?.[k.replace(/~1/g,'/').replace(/~0/g,'~')];
 const resolved:[Data,string]=[ref,base];plan.references.set(key,resolved);return resolved;
}
function shapePattern(pattern:string,plan:ShapePlan):RegExp{
 let result=plan.patterns.get(pattern);
 if(result===undefined){result=new RegExp(pattern,'u');plan.patterns.set(pattern,result);}
 return result;
}
function shape(v:Data,n:Data,file:string,plan:ShapePlan={references:new Map(),patterns:new Map()}):boolean{
 if(n===true)return true;if(n===false)return false;
 if(n.$ref){const [ref,base]=shapeReference(n,file,plan);if(!ref||!shape(v,ref,base,plan))return false;}
 if(Object.hasOwn(n,'const')&&!eq(v,n.const))return false;if(n.enum&&!n.enum.some((x:Data)=>eq(v,x)))return false;
 if(n.oneOf&&n.oneOf.filter((x:Data)=>shape(v,x,file,plan)).length!==1)return false;if(n.anyOf&&!n.anyOf.some((x:Data)=>shape(v,x,file,plan)))return false;if(n.allOf&&!n.allOf.every((x:Data)=>shape(v,x,file,plan)))return false;
 if(n.if&&!shape(v,shape(v,n.if,file,plan)?n.then??true:n.else??true,file,plan))return false;
 if(n.type==='null')return v===null;
 if(n.type==='string'||n.pattern!==undefined&&n.type===undefined){if(typeof v!=='string'||Array.from(v).length<(n.minLength??0)||Array.from(v).length>(n.maxLength??Infinity)||n.pattern&&!shapePattern(n.pattern,plan).test(v))return false;if(n.format==='uuid'&&!/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}(?![\s\S])/u.test(v))return false;}
 else if(n.type==='integer'||n.type==='number'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<(n.minimum??-Infinity)||v>(n.maximum??Infinity))return false;}
 else if(n.type==='boolean'){if(typeof v!=='boolean')return false;}
 else if(n.type==='array'){if(!Array.isArray(v)||v.length<(n.minItems??0)||v.length>(n.maxItems??Infinity)||n.uniqueItems&&new Set(v.map((x:Data)=>canonical(x))).size!==v.length)return false;if(!v.every((x:Data,i:number)=>shape(x,n.prefixItems?.[i]??n.items??true,file,plan)))return false;}
 else if(n.type==='object'||n.properties){if(!v||typeof v!=='object'||Array.isArray(v))return false;const keys=Object.keys(v);if(keys.length>(n.maxProperties??Infinity)||(n.required??[]).some((k:string)=>!Object.hasOwn(v,k)))return false;for(const k of keys){if(n.propertyNames&&!shape(k,n.propertyNames,file,plan))return false;const sub=n.properties?.[k]??n.additionalProperties??true;if(!shape(v[k],sub,file,plan))return false;}}
 return true;
}
const dto=(v:Data,name:string,file='matrix-column-pylon-section-execution.schema.json')=>shape(v,schemas[file].$defs[name],file);
const whitespace=new Set([9,10,11,12,13,28,29,30,31,32,0x85,0xa0,0x1680,0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,0x2028,0x2029,0x202f,0x205f,0x3000]);
const cleanKeys=new Set(['entityKey','buildingKey','zoneKey','levelKey','memberKey','sectionKey','sourceFileId','objectId','objectApiId','checkId','linkGroupId','reference']);
function clean(v:Data):boolean{if(v===null||typeof v!=='object')return true;if(Array.isArray(v))return v.every(clean);return Object.entries(v).every(([k,x])=>{if(cleanKeys.has(k)&&typeof x==='string'){const chars=Array.from(x);if(!chars.length||whitespace.has(chars[0]!.codePointAt(0)!)||whitespace.has(chars[chars.length-1]!.codePointAt(0)!))return false;}return clean(x);});}
const REGISTRY:Data=JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-column-pylon-section-capabilities-v1.json',import.meta.url),'utf8'));
const REGISTRY_TEXT=canonical(REGISTRY);
export const columnPylonSectionCapabilityRegistry=clone(REGISTRY);
export const columnPylonSectionCapabilityRegistryHash=hash(REGISTRY);
const RULE=REGISTRY.entries[0].ruleId as string,GAP=REGISTRY.entries[0].partialGap as string;
function registry(r:Data):void{if(canonical(r)!==REGISTRY_TEXT)fail('INVALID_REGISTRY');}
function journal(j:Data):void{try{validateColumnPylonSectionReviewDecision(j);}catch(e){if((e as Data)?.code==='INPUT_LIMIT')fail('INPUT_LIMIT');fail('INVALID_PACKAGE');}}
function pairKey(j:Data):string{try{return columnPylonSectionPairKey({objectId:j.objectId,identity:j.projection.identity,expectedSourceFileId:j.projection.expected.sourceFileId,actualSourceFileId:j.projection.actual.sourceFileId});}catch{fail('INVALID_PACKAGE');}}
const originKey=(sourceFileId:string,target:Data)=>canonical([sourceFileId,target]);
function sourceList(sources:Data):void{if(!Array.isArray(sources)||sources.length>64||!sources.every(s=>dto(s,'source','matrix-column-pylon-section-v2.schema.json'))||!clean(sources))fail('INVALID_PACKAGE');let previous:string|undefined;for(const s of sources){if(previous!==undefined&&cp(previous,s.sourceFileId)>=0)fail('INVALID_PACKAGE');previous=s.sourceFileId;}}
function journalList(journals:Data,objectId?:string):void{if(!Array.isArray(journals)||journals.length>16)fail('INVALID_PACKAGE');let previous:string|undefined,object=objectId;const ids=new Set<string>();for(const j of journals){journal(j);if(object===undefined)object=j.objectId;if(j.objectId!==object||j.projection.expected.sourceFileId===j.projection.actual.sourceFileId||j.projection.expected.sourceSha256===j.projection.actual.sourceSha256||ids.has(j.id))fail('INVALID_PACKAGE');ids.add(j.id);const key=pairKey(j);if(previous!==undefined&&cp(previous,key)>=0)fail('INVALID_PACKAGE');previous=key;}}
function inclusion(sources:Data[],journals:Data[]):Data[]{
 const byId=new Map(sources.map(s=>[s.sourceFileId,s]));
 // Complete present-source SHA scan before ANY missing-operand classification.
 for(const j of journals)for(const side of [j.projection.expected,j.projection.actual]){const s=byId.get(side.sourceFileId);if(s&&s.sourceSha256!==side.sourceSha256)fail('INVALID_PACKAGE');}
 return journals.map(j=>{const sides=[j.projection.expected,j.projection.actual],src=sides.map(s=>byId.get(s.sourceFileId));const reason=src.some(s=>!s)?'SOURCE_NOT_IN_MANIFEST':sides.some((s,i)=>!src[i].review||src[i].review.decisionId!==s.sourceReviewDecisionId||src[i].review.contentHash!==s.sourceReviewContentHash)?'SOURCE_REVIEW_REFERENCE_CHANGED':null;return {pairKey:pairKey(j),decisionId:j.id,included:reason===null,exclusionReason:reason};});
}
/** Internal admission seam: DTO/ref consistency, never PDF/actor/latest-sequence authority. */
export function calculateColumnPylonSectionSnapshotInclusion(raw:unknown):Array<{pairKey:string;decisionId:string;included:boolean;exclusionReason:null|'SOURCE_NOT_IN_MANIFEST'|'SOURCE_REVIEW_REFERENCE_CHANGED'}>{const x=detached(raw,'PACKAGE');if(!exact(x,['currentSources','journals']))fail('INVALID_PACKAGE');sourceList(x.currentSources);journalList(x.journals);return clone(inclusion(x.currentSources,x.journals));}
function tokenTarget(q:Data):Data|null{if(q.mode==='NATIVE_SECTION_SELECTION_V1')return q.unit;const l=q.literalSnapshot;return {pageNumber:l.pageNumber,sourcePath:l.sourcePath,rawText:l.rawText,usedTextRangeCodePoints:l.tokens.unit.rangeCodePoints};}
const targetOnly=(v:Data)=>({pageNumber:v.pageNumber,sourcePath:v.sourcePath,rawText:v.rawText,usedTextRangeCodePoints:v.usedTextRangeCodePoints});
function approvedClaims(p:Data):void{
 const has=(s:Data,r:string)=>s.basis.some((b:Data)=>b.role===r);
 if(p.status!=='APPROVED'||p.pairAssertion!=='HUMAN_REVIEWED_SAME_MEMBER_SECTION_PD_RD')fail('INVALID_PACKAGE');
 for(const s of [p.expected,p.actual]){
  if(s.assertions.physicalMember!=='HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER_AND_SECTION'||!has(s,'PHYSICAL_MEMBER')||s.assertions.shape!=='HUMAN_REVIEWED_RECTANGLE'||!has(s,'SECTION_SHAPE')||s.assertions.dimensionMeaning!=='HUMAN_REVIEWED_GROSS_EXTERNAL_SECTION'||!has(s,'GROSS_SECTION')||s.assertions.unit!=='HUMAN_REVIEWED_EXPLICIT_MM'||s.unitScopeAssertion!=='HUMAN_REVIEWED_UNIT_APPLIES_TO_BOTH_SELECTED_DIMENSIONS')fail('INVALID_PACKAGE');
  const u=tokenTarget(s.selection);if(!u||!s.basis.some((b:Data)=>b.role==='UNIT'&&eq(targetOnly(b),targetOnly(u))))fail('INVALID_PACKAGE');
  if(s.selection.mode==='NATIVE_SECTION_SELECTION_V1'&&[s.selection.first,s.selection.second].some(t=>t.pageNumber!==u.pageNumber||!eq(t.sourcePath,u.sourcePath))&&!has(s,'UNIT_SCOPE'))fail('INVALID_PACKAGE');
 }
}
function packageRetained(p:Data):void{
 if(!dto(p,'loaderPackage','matrix-column-pylon-section-loader.schema.json')||!clean(p))fail('INVALID_PACKAGE');sourceList(p.sources);const journals=p.reviews.map((r:Data)=>r.journal);journalList(journals,p.objectId);
 const required=new Set<string>(),originMap=new Map<string,Data>();let previous:string|undefined;
 for(const o of p.origins){const key=originKey(o.sourceFileId,o.target);if(previous!==undefined&&cp(previous,key)>=0||o.objectId!==p.objectId)fail('INVALID_PACKAGE');previous=key;originMap.set(key,o);}
 const current=new Map(p.sources.map((s:Data)=>[s.sourceFileId,s]));
 for(const r of p.reviews){const j=r.journal,sides=[j.projection.expected,j.projection.actual],origins:Data[]=[];
  for(let i=0;i<2;i++){const side=sides[i],hist=r.historicalSources[i],key=originKey(side.sourceFileId,side.origin),o=originMap.get(key);required.add(key);if(!o||o.sourceSha256!==side.sourceSha256||hist.sourceFileId!==side.sourceFileId||hist.sourceSha256!==side.sourceSha256||!hist.review||hist.review.decisionId!==side.sourceReviewDecisionId||hist.review.contentHash!==side.sourceReviewContentHash||!eq(hist.stages,o.stages))fail('INVALID_PACKAGE');
   const s=current.get(side.sourceFileId) as Data;if(s&&s.sourceSha256!==side.sourceSha256)fail('INVALID_PACKAGE');
   for(const stages of [hist.review.pageStages,s?.review?.pageStages??{}])for(const k of Object.keys(stages))if(Number(k)>o.textArtifact.pageCount)fail('INVALID_PACKAGE');origins.push(o);
  }
  const result=compareKr060ColumnPylonSection({schemaVersion:'matrix-kr060-column-pylon-comparison-input-v2',objectId:p.objectId,identity:j.projection.identity,sources:r.historicalSources,origins,review:j});
  if(!eq(result.identity,j.projection.identity))fail('INVALID_PACKAGE');
  if(j.projection.status==='APPROVED'){approvedClaims(j.projection);if(result.status==='ABSTAIN'&&result.reasonCode!=='SOURCE_STAGE_UNVERIFIED')fail('INVALID_PACKAGE');}
  else if(result.status!=='ABSTAIN'||result.reasonCode!=='PAIR_REVIEW_UNAPPROVED')fail('INVALID_PACKAGE');
 }
 if(required.size!==p.origins.length||[...originMap.keys()].some(k=>!required.has(k)))fail('INVALID_PACKAGE');
}
function snapshotLinks(p:Data,s:Data):void{
 try{validateColumnPylonSectionRunSnapshot(s);}catch(e){if((e as Data)?.code==='INPUT_LIMIT')fail('INPUT_LIMIT');fail('INVALID_SNAPSHOT');}
 if(s.objectApiId!==p.objectId||s.inputManifestHash!==p.inputManifestHash||s.entries.length!==p.reviews.length)fail('INVALID_SNAPSHOT');
 const expected=inclusion(p.sources,p.reviews.map((r:Data)=>r.journal));
 for(let i=0;i<p.reviews.length;i++){const j=p.reviews[i].journal,e=s.entries[i],v=expected[i];if(e.pairKey!==v.pairKey||e.decisionId!==j.id||e.journalContentHash!==j.contentHash||e.projectionContentHash!==j.projection.contentHash||e.included!==v.included||e.exclusionReason!==v.exclusionReason)fail('INVALID_SNAPSHOT');}
}
function packageAndSnapshot(p:Data,s:Data):void{packageRetained(p);snapshotLinks(p,s);}
export function validateColumnPylonSectionLoaderPackage(raw:unknown,rawSnapshot:unknown):ColumnPylonSectionLoaderPackage{const p=detached(raw,'PACKAGE'),s=detached(rawSnapshot,'SNAPSHOT');packageAndSnapshot(p,s);return p;}
const common={schemaVersion:'matrix-column-pylon-section-execution-result-v1',ruleId:'matrix-kr-060-reviewed_rectangular_gross_section_area_decrease',ruleVersion:'1',parameterCode:'KR-060',comparisonVariant:'PD_RD'} as const;
function resultId(e:Data,r:Data):string{return hash({hashDomain:'matrix-column-pylon-section-execution-result-id-v1',objectId:e.objectId,inputManifestHash:e.inputManifestHash,capabilityRegistryHash:e.capabilityRegistryHash,pairReviewSnapshotHash:e.pairReviewSnapshotHash,result:omit(r,['id'])});}
function build(p:Data,s:Data):Data{
 const e:Data={schemaVersion:'matrix-column-pylon-section-comparisons-v1',purpose:'MACHINE_COMPARISON',objectId:p.objectId,inputManifestHash:p.inputManifestHash,capabilityRegistryHash:columnPylonSectionCapabilityRegistryHash,pairReviewSnapshotHash:s.contentHash,results:[]};
 const sources=new Map(p.sources.map((v:Data)=>[v.sourceFileId,v])),origins=new Map(p.origins.map((v:Data)=>[originKey(v.sourceFileId,v.target),v]));
 for(let i=0;i<p.reviews.length;i++){if(!s.entries[i].included)continue;const j=p.reviews[i].journal,pj=j.projection,sides=[pj.expected,pj.actual];const comparison=compareKr060ColumnPylonSection({schemaVersion:'matrix-kr060-column-pylon-comparison-input-v2',objectId:p.objectId,identity:pj.identity,sources:sides.map(side=>sources.get(side.sourceFileId)),origins:sides.map(side=>origins.get(originKey(side.sourceFileId,side.origin))),review:j});
  if(!eq(comparison.identity,pj.identity)||comparison.status==='ABSTAIN'&&!operational.has(comparison.reasonCode))fail('INVALID_PACKAGE');e.results.push({...common,kind:'SCOPED_COMPARISON',pairKey:s.entries[i].pairKey,identity:pj.identity,pairDecisionId:j.id,pairJournalContentHash:j.contentHash,pairProjectionContentHash:pj.contentHash,comparison});
 }
 if(!e.results.length)e.results.push({...common,kind:'UNBOUND_ATOM_ABSTENTION',reasonCode:'REVIEWED_COLUMN_PYLON_PAIR_MISSING',calibratedProbability:null});
 for(const r of e.results)r.id=resultId(e,r);validateEnvelope(e);return e;
}
export function buildColumnPylonSectionComparisons(raw:unknown,rawSnapshot:unknown,rawRegistry:unknown=REGISTRY):ColumnPylonSectionExecutionComparisons{const p=detached(raw,'PACKAGE'),s=detached(rawSnapshot,'SNAPSHOT'),r=detached(rawRegistry,'REGISTRY');registry(r);packageAndSnapshot(p,s);return build(p,s);}
const operational=new Set(['PAIR_REVIEW_UNAPPROVED','SOURCE_REVIEW_UNVERIFIED','SOURCE_SECTION_UNVERIFIED','SOURCE_STAGE_UNVERIFIED','SOURCE_LINK_UNVERIFIED','PHYSICAL_MEMBER_UNVERIFIED','SECTION_SHAPE_UNVERIFIED','DIMENSION_MEANING_UNVERIFIED','UNIT_UNVERIFIED','PAIR_APPLICABILITY_UNVERIFIED']);
function validateEnvelope(e:Data):void{
 if(!dto(e,'comparisons')||!clean(e)||e.capabilityRegistryHash!==columnPylonSectionCapabilityRegistryHash)fail('INVALID_COMPARISONS');let previous:string|undefined;const ids=new Set<string>();
 for(const r of e.results){if(ids.has(r.id))fail('INVALID_COMPARISONS');ids.add(r.id);
  if(r.kind==='UNBOUND_ATOM_ABSTENTION'){if(e.results.length!==1)fail('INVALID_COMPARISONS');}
  else{const c=r.comparison;if(previous!==undefined&&cp(previous,r.pairKey)>=0||!eq(r.identity,c.identity))fail('INVALID_COMPARISONS');previous=r.pairKey;
   if(c.status==='ABSTAIN'){if(!operational.has(c.reasonCode)||c.comparison!==null)fail('INVALID_COMPARISONS');}
   else{const v=c.comparison;if(v.pairDecisionId!==r.pairDecisionId||v.pairJournalContentHash!==r.pairJournalContentHash||v.pairProjectionContentHash!==r.pairProjectionContentHash||v.expected.sourceFileId===v.actual.sourceFileId||v.expected.sourceSha256===v.actual.sourceSha256)fail('INVALID_COMPARISONS');let key:string;try{key=columnPylonSectionPairKey({objectId:e.objectId,identity:r.identity,expectedSourceFileId:v.expected.sourceFileId,actualSourceFileId:v.actual.sourceFileId});}catch{fail('INVALID_COMPARISONS');}if(key!==r.pairKey)fail('INVALID_COMPARISONS');
    const a=BigInt(v.expectedAreaMm2),b=BigInt(v.actualAreaMm2);if(a>999999998000000001n||b>999999998000000001n||String(b-a)!==v.deltaAreaMm2)fail('INVALID_COMPARISONS');
    if((b<a)!==(c.status==='CANDIDATE')||(b>=a)!==(c.status==='NO_DECREASE_IN_REVIEWED_PAIR'))fail('INVALID_COMPARISONS');
   }
  }if(resultId(e,r)!==r.id)fail('INVALID_COMPARISONS');
 }
}
export function validateColumnPylonSectionComparisons(raw:unknown):ColumnPylonSectionExecutionComparisons{const e=detached(raw,'COMPARISONS');validateEnvelope(e);return e;}
function fragment(t:Data):Data{return {pageNumber:t.pageNumber,sourcePath:t.sourcePath,rawText:t.rawText,usedTextRangeCodePoints:t.usedTextRangeCodePoints,nativeBoxPointStrings:t.nativeBoxPointStrings,bboxMilliPoints:t.bboxMilliPoints,pageFrame:t.pageFrame};}
function evidence(p:Data,e:Data):Data[]{const out:Data[]=[];const journals=new Map(p.reviews.map((r:Data)=>[r.journal.id,r.journal]));
 for(const row of e.results){if(row.kind!=='SCOPED_COMPARISON'||row.comparison.status==='ABSTAIN')continue;const j=journals.get(row.pairDecisionId) as Data;
  for(const role of ['EXPECTED','ACTUAL']){const side=j.projection[role==='EXPECTED'?'expected':'actual'],q=side.selection;const groups:[string,Data][]=[];
   if(q.mode==='LITERAL_T77_V1'){const l=q.literalSnapshot;for(const [name,token] of [['FIRST_DIMENSION','first'],['SECOND_DIMENSION','second'],['EXPLICIT_UNIT','unit']])groups.push([name!,{...l,usedTextRangeCodePoints:l.tokens[token!].rangeCodePoints}]);}
   else groups.push(['FIRST_DIMENSION',q.first],['SECOND_DIMENSION',q.second],['EXPLICIT_UNIT',q.unit]);
   for(const b of side.basis)groups.push([b.role+'_BASIS',b]);
   for(const [fragmentRole,t] of groups)out.push({resultId:row.id,pairKey:row.pairKey,role,sourceFileId:side.sourceFileId,sourceSha256:side.sourceSha256,sourceReviewDecisionId:side.sourceReviewDecisionId,sourceReviewContentHash:side.sourceReviewContentHash,origin:side.origin,pairDecisionId:j.id,pairJournalContentHash:j.contentHash,pairProjectionContentHash:j.projection.contentHash,fragmentRole,fragment:fragment(t)});
  }
 }return out;}
export function columnPylonSectionComparisonEvidence(raw:unknown,rawSnapshot:unknown,rawEnvelope:unknown,rawRegistry:unknown=REGISTRY):ColumnPylonSectionExecutionEvidence[]{const p=detached(raw,'PACKAGE'),s=detached(rawSnapshot,'SNAPSHOT'),e=detached(rawEnvelope,'COMPARISONS'),r=detached(rawRegistry,'REGISTRY');registry(r);packageAndSnapshot(p,s);validateEnvelope(e);if(!eq(e,build(p,s)))fail('INVALID_EVIDENCE');const rows=evidence(p,e);canonical(rows,'EVIDENCE');if(!dto(rows,'evidenceList'))fail('INVALID_EVIDENCE');return clone(rows);}
const scalar=JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-execution-v1.json',import.meta.url),'utf8'));
const priorTypedRuleIds=new Set(["matrix-ar-053-declared_joint_damping_tape_omission","matrix-odi-123-declared_sanitary_room_personnel_call_button_omission","matrix-odi-120-declared_accessible_room_wc_rails_omission","matrix-zu-129-declared_cold_water_inlet_meter_omission","matrix-zu-130-declared_led_technology_replacement","matrix-kr-056-reviewed_steel_catalog_transition"]);
const counters=['implementedAtomicRules','enabledAtomicRules','evaluatedAtomicRules','successfulComparisons','abstentions','failures'];
export function mergeColumnPylonSectionCoverage(rawRows:unknown,rawEnvelope:unknown,rawRegistry:unknown=REGISTRY):MatrixCoverage[]{const rows=detached(rawRows,'COVERAGE'),e=detached(rawEnvelope,'COMPARISONS'),r=detached(rawRegistry,'REGISTRY');registry(r);validateEnvelope(e);
 if(!Array.isArray(rows)||rows.length!==132||scalar.entries.length!==132||priorTypedRuleIds.has(RULE)||scalar.entries.some((x:Data)=>x.atomicRules.some((a:Data)=>a.ruleId===RULE)))fail('INVALID_COVERAGE');
 for(let i=0;i<rows.length;i++){const row=rows[i];if(!exact(row,['parameterCode',...counters,'executionStatus','reason'])||row.parameterCode!==scalar.entries[i].parameterCode||!counters.every(k=>Number.isSafeInteger(row[k])&&row[k]>=0)||!['UNSUPPORTED','PARTIAL','EVALUATED','TECHNICAL_FAILURE'].includes(row.executionStatus)||typeof row.reason!=='string')fail('INVALID_COVERAGE');}
 const old=rows.find((x:Data)=>x.parameterCode==='KR-060');if(!old||old.executionStatus!=='UNSUPPORTED'||!counters.every(k=>old[k]===0))fail('INVALID_COVERAGE');const success=e.results.filter((x:Data)=>x.kind==='SCOPED_COMPARISON'&&x.comparison.status!=='ABSTAIN').length;
 return rows.map((row:Data)=>row.parameterCode==='KR-060'?{...row,implementedAtomicRules:1,enabledAtomicRules:1,evaluatedAtomicRules:1,successfulComparisons:success,abstentions:e.results.length-success,failures:0,executionStatus:'PARTIAL',reason:GAP}:row) as MatrixCoverage[];
}
