/** Explicit KR060 v2 pair review. Pure validation does not authenticate DB, actors or PDF bytes. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isProxy} from 'node:util/types';
import type {ColumnPylonSectionV2Request,ColumnPylonSectionV2Journal,ColumnPylonSectionV2Result} from '@inspector-ai/contracts';
import {readDocumentTextV3LargeArtifact} from './document-text-v3.js';
import {extractColumnPylonDimensionLiterals} from './column-pylon-dimension-literals.js';

type Data=any;
type Code='INVALID_INPUT'|'INPUT_LIMIT'|'INVALID_PACKAGE'|'INVALID_DECISION'|'STALE_REVIEW'|'PAIR_MISMATCH'|'WITHDRAWAL_MISMATCH'|'APPROVAL_NOT_ELIGIBLE';
export class ColumnPylonSectionReviewValidationError extends TypeError {constructor(public readonly code:Code){super(code);this.name='ColumnPylonSectionReviewValidationError';}}
function fail(code:Code):never{throw new ColumnPylonSectionReviewValidationError(code);}
const policies={REQUEST:[524288,200000,64],JOURNAL:[1048576,200000,64],WHOLE:[67108864,2900000,68]} as const;
function cpCompare(a:string,b:string):number{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i]!.codePointAt(0)!-y[i]!.codePointAt(0)!;if(d)return d;}return x.length-y.length;}
function canonical(value:unknown,policy:keyof typeof policies='WHOLE'):string{
 const [bytes,maxNodes,maxDepth]=policies[policy];let nodes=0,charged=0;const ancestors=new Set<object>();
 const add=(n:number)=>{charged+=n;if(charged>bytes)fail('INPUT_LIMIT');};
 const visit=(v:unknown,d:number):string=>{
  if(++nodes>maxNodes||d>maxDepth)fail('INPUT_LIMIT');
  if(v===null){add(4);return 'null';}if(typeof v==='boolean'){add(v?4:5);return String(v);}
  if(typeof v==='number'){if(!Number.isSafeInteger(v))fail('INVALID_INPUT');const s=String(v);add(s.length);return s;}
  if(typeof v==='string'){if(v.length>4000000)fail('INPUT_LIMIT');let n=0;for(const c of v){if(++n>2000000)fail('INPUT_LIMIT');const cp=c.codePointAt(0)!;if(cp>=0xd800&&cp<=0xdfff)fail('INVALID_INPUT');}const s=JSON.stringify(v);add(Buffer.byteLength(s));return s;}
  if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))fail('INVALID_INPUT');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)fail('INVALID_INPUT');
  const desc=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(desc);if(names.some(k=>typeof k!=='string'))fail('INVALID_INPUT');let keys:string[];
  if(array){const n=desc.length?.value;if(!Number.isSafeInteger(n)||n<0)fail('INVALID_INPUT');if(n>32768)fail('INPUT_LIMIT');if(names.length!==n+1)fail('INVALID_INPUT');keys=Array.from({length:n},(_,i)=>String(i));}
  else{if(names.length>32768)fail('INPUT_LIMIT');keys=(names as string[]).sort(cpCompare);}
  ancestors.add(v);add(2+Math.max(0,keys.length-1)+(array?0:keys.length));const out:string[]=[];
  for(const k of keys){const entry=desc[k];if(!entry?.enumerable||!Object.hasOwn(entry,'value'))fail('INVALID_INPUT');out.push(array?visit(entry.value,d+1):visit(k,d+1)+':'+visit(entry.value,d+1));}ancestors.delete(v);return (array?'[':'{')+out.join(',')+(array?']':'}');
 };return visit(value,0);
}
function detach(v:unknown,p:keyof typeof policies):Data{return JSON.parse(canonical(v,p));}
function hash(v:unknown):string{return createHash('sha256').update(canonical(v)).digest('hex');}
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const schemas:Record<string,Data>={};
for(const name of ['matrix-column-pylon-section-v2.schema.json','document-text-v3.schema.json','column-pylon-dimension-literals.schema.json'])schemas[name]=JSON.parse(readFileSync(new URL('../../../packages/contracts/src/'+name,import.meta.url),'utf8'));
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
function shape(v:Data,n:Data,file='matrix-column-pylon-section-v2.schema.json',plan:ShapePlan={references:new Map(),patterns:new Map()}):boolean{
 if(n===false)return false;if(n===true)return true;
 if(n.$ref){const [ref,base]=shapeReference(n,file,plan);return !!ref&&shape(v,ref,base,plan);}
 if(Object.hasOwn(n,'const'))return equal(v,n.const);if(n.enum)return n.enum.some((x:Data)=>equal(v,x));
 if(n.oneOf)return n.oneOf.filter((x:Data)=>shape(v,x,file,plan)).length===1;if(n.anyOf)return n.anyOf.some((x:Data)=>shape(v,x,file,plan));if(n.allOf)return n.allOf.every((x:Data)=>shape(v,x,file,plan));
 if(n.type==='null')return v===null;
 if(n.type==='string'||n.type===undefined&&n.pattern!==undefined){if(typeof v!=='string')return false;const len=Array.from(v).length;if(len<(n.minLength??0)||len>(n.maxLength??Infinity)||n.pattern&&!shapePattern(n.pattern,plan).test(v))return false;if(n.format==='uuid'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))return false;return true;}
 if(n.type==='integer'||n.type==='number')return typeof v==='number'&&Number.isSafeInteger(v)&&v>=(n.minimum??-Infinity)&&v<=(n.maximum??Infinity);
 if(n.type==='boolean')return typeof v==='boolean';
 if(n.type==='array'){if(!Array.isArray(v)||v.length<(n.minItems??0)||v.length>(n.maxItems??Infinity))return false;if(n.uniqueItems&&new Set(v.map((x:Data)=>canonical(x))).size!==v.length)return false;return v.every((x:Data,i:number)=>shape(x,n.prefixItems?.[i]??n.items??true,file,plan));}
 if(n.type==='object'){if(!v||typeof v!=='object'||Array.isArray(v))return false;const keys=Object.keys(v);if(keys.length>(n.maxProperties??Infinity)||(n.required||[]).some((k:string)=>!Object.hasOwn(v,k)))return false;return keys.every(k=>(!n.propertyNames||shape(k,n.propertyNames,file,plan))&&(n.properties?.[k]?shape(v[k],n.properties[k],file,plan):n.additionalProperties===false?false:typeof n.additionalProperties==='object'?shape(v[k],n.additionalProperties,file,plan):true));}
 return false;
}
function dto(v:Data,name:string):boolean{return shape(v,schemas['matrix-column-pylon-section-v2.schema.json'].$defs[name]);}
function clean(v:string):boolean{const chars=Array.from(v);return chars.length>0&&!ws.has(chars[0]!.codePointAt(0)!)&&!ws.has(chars[chars.length-1]!.codePointAt(0)!);}
function cleanKnown(v:Data):boolean{if(v===null||typeof v!=='object')return true;if(Array.isArray(v))return v.every(cleanKnown);return Object.entries(v).every(([k,x])=>!['entityKey','buildingKey','zoneKey','levelKey','memberKey','sectionKey','sourceFileId','objectId','checkId','linkGroupId','reference'].includes(k)||typeof x!=='string'||clean(x))&&Object.values(v).every(cleanKnown);}
function calendar(v:string):boolean{try{return new Date(v).toISOString()===v;}catch{return false;}}
const omit=(v:Data,keys:string[])=>Object.fromEntries(Object.entries(v).filter(([k])=>!keys.includes(k)));
const projectionHash=(p:Data)=>hash({hashDomain:'matrix-kr060-column-pylon-pair-projection-json-v2',projection:omit(p,['contentHash'])});
const journalHash=(j:Data)=>hash({hashDomain:'matrix-kr060-column-pylon-pair-journal-json-v2',journal:omit(j,['contentHash'])});
function validJournal(j:Data):boolean{return dto(j,'journal')&&cleanKnown(j)&&calendar(j.createdAt)&&j.id===j.projection.decisionId&&j.objectId===j.projection.objectId&&(j.previousDecisionId===null)===(j.previousReviewHash===null)&&j.id!==j.previousDecisionId&&j.contentHash!==j.previousReviewHash&&(j.projection.status!=='WITHDRAWN'||j.previousDecisionId!==null)&&projectionHash(j.projection)===j.projection.contentHash&&journalHash(j)===j.contentHash;}
export function parseColumnPylonSectionReviewInput(v:unknown):ColumnPylonSectionV2Request|null{try{const x=detach(v,'REQUEST');return dto(x,'request')&&cleanKnown(x)?x:null;}catch{return null;}}
export function validateColumnPylonSectionReviewDecision(v:unknown):ColumnPylonSectionV2Journal{const j=detach(v,'JOURNAL');if(!validJournal(j)||!standaloneSide(j.projection.expected)||!standaloneSide(j.projection.actual))fail('INVALID_DECISION');return j;}
function tokenSelection(t:Data):Data{return omit(t,['nativeBoxPointStrings','bboxMilliPoints','pageFrame','value']);}
function requestSide(s:Data):Data{const selection=s.selection.mode==='LITERAL_T77_V1'?omit(s.selection,['literalSnapshot']):{mode:s.selection.mode,first:tokenSelection(s.selection.first),second:tokenSelection(s.selection.second),unit:s.selection.unit===null?null:tokenSelection(s.selection.unit)};return {...s,selection,basis:s.basis.map((b:Data)=>omit(b,['nativeBoxPointStrings','bboxMilliPoints','pageFrame']))};}
function project(j:Data):Data{const p=j.projection;return {schemaVersion:'matrix-kr060-column-pylon-pair-review-input-v2',status:p.status,identity:p.identity,expected:requestSide(p.expected),actual:requestSide(p.actual),pairAssertion:p.pairAssertion,reference:p.reference,expectedReviewHash:j.contentHash};}
export function projectColumnPylonSectionReviewDecision(v:unknown):ColumnPylonSectionV2Request|null{try{return project(validateColumnPylonSectionReviewDecision(v));}catch{return null;}}
export function columnPylonSectionPairKey(v:unknown):string{const x=detach(v,'REQUEST');if(!x||Array.isArray(x)||Object.keys(x).length!==4||!dto(x.objectId,'key')||!clean(x.objectId)||!dto(x.identity,'identity')||!cleanKnown(x.identity)||!dto(x.expectedSourceFileId,'key')||!dto(x.actualSourceFileId,'key')||!clean(x.expectedSourceFileId)||!clean(x.actualSourceFileId)||x.expectedSourceFileId===x.actualSourceFileId)fail('INVALID_INPUT');return hash({hashDomain:'matrix-kr060-column-pylon-pair-key-v2',...x});}
function retained(x:Data,sides:Data[]|null):boolean{
 if(x.sources.length!==x.origins.length||new Set(x.sources.map((s:Data)=>s.sourceFileId)).size!==x.sources.length||new Set(x.origins.map((s:Data)=>s.sourceFileId)).size!==x.origins.length)return false;
 if(sides&&(x.sources.length!==2||sides[0].sourceFileId===sides[1].sourceFileId||sides[0].sourceSha256===sides[1].sourceSha256))return false;
 if(!sides&&x.sources.some((s:Data,i:number)=>i>0&&cpCompare(x.sources[i-1].sourceFileId,s.sourceFileId)>=0))return false;
 for(let i=0;i<x.sources.length;i++){
  const s=x.sources[i],o=x.origins[i],a=o.textArtifact,t=o.target;if(s.sourceFileId!==o.sourceFileId||s.sourceSha256!==o.sourceSha256||o.objectId!==x.objectId||a.sourceFileId!==s.sourceFileId||a.inputSha256!==s.sourceSha256)return false;
  const read=readDocumentTextV3LargeArtifact(a);if(read.status!=='VALID'||read.contentHash!==t.textArtifactContentHash||hash(a)!==t.textArtifactByteSha256||t.textStageContentHash!==t.textArtifactByteSha256||a.extractorProfileHash!==t.extractorProfileHash||a.extractorProfile.traversalPolicyVersion!=='pdfminer-analyzed-figures-boxes-flow-none-vertical-v1')return false;
  for(const stages of [o.pageStages,s.review?.pageStages??{}])if(Object.keys(stages).some(k=>!Number.isSafeInteger(Number(k))||Number(k)>a.pageCount))return false;
  if(sides){const side=sides[i];if(side.sourceFileId!==s.sourceFileId||side.sourceSha256!==s.sourceSha256||!equal(side.origin,t))return false;}
 }return true;
}
const ws=new Set([9,10,11,12,13,28,29,30,31,32,0x85,0xa0,0x1680,0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,0x2028,0x2029,0x202f,0x205f,0x3000]);
const digit=(v:string|undefined)=>v!==undefined&&v>='0'&&v<='9';
function located(o:Data,t:Data):Data|null{const p=o.textArtifact.pages[t.pageNumber-1];if(!p||p.pageNumber!==t.pageNumber||p.quality.disposition!=='TEXT_LAYER_CANDIDATE'||p.unlocatedLines.length)return null;const l=p.locatedLines.find((l:Data)=>equal(l.sourcePath,t.sourcePath));if(!l||l.rawText!==t.rawText)return null;const chars=Array.from(l.rawText),[lo,hi]=t.usedTextRangeCodePoints;if(lo>=hi||hi>chars.length)return null;return {...t,nativeBoxPointStrings:l.nativeBoxPointStrings,bboxMilliPoints:l.bboxMilliPoints,pageFrame:{widthMilliPoints:p.widthMilliPoints,heightMilliPoints:p.heightMilliPoints,nativeFrame:p.nativeFrame}};}
function tokenValue(t:Data,unit:boolean):string|null{const chars=Array.from(t.rawText) as string[],[lo,hi]=t.usedTextRangeCodePoints;if(lo>=hi||hi>chars.length)return null;const value=chars.slice(lo,hi).join(''),left=chars[lo-1],right=chars[hi];if(unit){if(value!=='мм'||left!==undefined&&!ws.has(left.codePointAt(0)!)&&!digit(left)&&!'=:([{;,.'.includes(left)||right!==undefined&&!ws.has(right.codePointAt(0)!)&&!',.;:)]}'.includes(right))return null;}
 else if(!/^[1-9][0-9]{0,8}$(?![\s\S])/u.test(value)||digit(left)||digit(right)||left!==undefined&&'+-−'.includes(left)||left!==undefined&&'.,'.includes(left)&&digit(chars[lo-2])||right!==undefined&&'.,'.includes(right)&&digit(chars[hi+1]))return null;
 return value;}
function token(o:Data,t:Data,unit:boolean):Data|null{const b=located(o,t),value=tokenValue(t,unit);return b&&value!==null?{...b,value}:null;}
const sameTarget=(a:Data,b:Data)=>a.pageNumber===b.pageNumber&&equal(a.sourcePath,b.sourcePath);
function overlap(a:Data,b:Data):boolean{return sameTarget(a,b)&&a.usedTextRangeCodePoints[0]<b.usedTextRangeCodePoints[1]&&b.usedTextRangeCodePoints[0]<a.usedTextRangeCodePoints[1];}
function selectionSnapshot(s:Data,o:Data):Data|null{
 const q=s.selection;
 if(q.mode==='LITERAL_T77_V1'){const r=extractColumnPylonDimensionLiterals(o.textArtifact);if(r.status!=='SOURCE_LITERALS')return null;const literal=r.literals.find(l=>l.pageNumber===q.pageNumber&&equal(l.sourcePath,q.sourcePath));if(!literal)return null;const h=hash({hashDomain:'matrix-kr060-column-pylon-literal-v1',sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,textArtifactContentHash:o.target.textArtifactContentHash,literal});if(h!==q.literalContentHash)return null;return {...omit(q,['literalSnapshot']),literalSnapshot:literal};}
 const first=token(o,tokenSelection(q.first),false),second=token(o,tokenSelection(q.second),false),unit=q.unit===null?null:token(o,tokenSelection(q.unit),true);if(!first||!second||q.unit!==null&&!unit||overlap(first,second)||unit&&(overlap(first,unit)||overlap(second,unit)))return null;
 const out={mode:q.mode,first,second,unit};return {...out,selectionContentHash:hash({hashDomain:'matrix-kr060-column-pylon-native-selection-v1',sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,textArtifactContentHash:o.target.textArtifactContentHash,selection:out})};
}
function standaloneSide(s:Data):boolean{
 const q=s.selection;
 if(q.mode==='LITERAL_T77_V1'){
  const l=q.literalSnapshot,chars=Array.from(l.rawText),range=l.usedTextRangeCodePoints;
  if(l.pageNumber!==q.pageNumber||!equal(l.sourcePath,q.sourcePath)||range[0]>=range[1]||range[1]>chars.length)return false;
  for(const t of Object.values(l.tokens) as Data[]){const [lo,hi]=t.rangeCodePoints;if(lo>=hi||hi>chars.length||chars.slice(lo,hi).join('')!==t.raw)return false;}
  if(hash({hashDomain:'matrix-kr060-column-pylon-literal-v1',sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,textArtifactContentHash:s.origin.textArtifactContentHash,literal:l})!==q.literalContentHash)return false;
 }else{
  if(tokenValue(q.first,false)!==q.first.value||tokenValue(q.second,false)!==q.second.value||q.unit!==null&&tokenValue(q.unit,true)!==q.unit.value||overlap(q.first,q.second)||q.unit&&(overlap(q.first,q.unit)||overlap(q.second,q.unit)))return false;
  if(hash({hashDomain:'matrix-kr060-column-pylon-native-selection-v1',sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,textArtifactContentHash:s.origin.textArtifactContentHash,selection:omit(q,['selectionContentHash'])})!==q.selectionContentHash)return false;
 }
 const seen=new Set<string>();for(const b of s.basis){const [lo,hi]=b.usedTextRangeCodePoints,key=canonical([b.role,b.pageNumber,b.sourcePath,b.usedTextRangeCodePoints]);if(lo>=hi||hi>Array.from(b.rawText).length||seen.has(key))return false;seen.add(key);}return true;
}
function basisSnapshot(s:Data,o:Data):Data[]|null{const out:Data[]=[],seen=new Set<string>();for(const b of s.basis){const q=omit(b,['nativeBoxPointStrings','bboxMilliPoints','pageFrame']),key=canonical([q.role,q.pageNumber,q.sourcePath,q.usedTextRangeCodePoints]);const v=located(o,q);if(!v||seen.has(key))return null;seen.add(key);out.push(v);}return out;}
function stage(s:Data,page:number):string{return s.pageStages?.[String(page)]??(s.stages.length===1?s.stages[0]:'UNRESOLVED');}
function unitTarget(q:Data):Data|null{if(q.mode!=='LITERAL_T77_V1')return q.unit;const l=q.literalSnapshot;return {pageNumber:l.pageNumber,sourcePath:l.sourcePath,rawText:l.rawText,usedTextRangeCodePoints:l.tokens.unit.rangeCodePoints};}
function eligibility(x:Data,p:Data):string|null{
 const sides=[p.expected,p.actual],sources=x.sources;
 for(let i=0;i<2;i++){const r=sources[i].review;if(!r||r.decisionId!==sides[i].sourceReviewDecisionId||r.contentHash!==sides[i].sourceReviewContentHash)return 'STALE_SOURCE_REVIEW';}
 if(sources.some((s:Data)=>s.review.revisionStatus!=='CURRENT'||s.review.approvalStatus!=='APPROVED'))return 'SOURCE_REVIEW_UNVERIFIED';
 if(sources[0].review.sectionCode!=='KR'||sources[1].review.sectionCode!=='KJ')return 'SOURCE_SECTION_UNVERIFIED';
 for(let i=0;i<2;i++){const q=sides[i].selection,pages=q.mode==='LITERAL_T77_V1'?[q.pageNumber]:[q.first.pageNumber,q.second.pageNumber,...(q.unit?[q.unit.pageNumber]:[])];for(const page of pages){if(stage(x.origins[i],page)!==(i===0?'PD':'RD')||stage({stages:sources[i].stages,pageStages:sources[i].review.pageStages},page)!==(i===0?'PD':'RD'))return 'SOURCE_STAGE_UNVERIFIED';}}
 if(!sources[0].review.linkGroupId||sources[0].review.linkGroupId!==sources[1].review.linkGroupId)return 'SOURCE_LINK_UNVERIFIED';
 return claimEligibility(p);
}
function claimEligibility(p:Data):string|null{
 const sides=[p.expected,p.actual];
 const has=(s:Data,r:string)=>s.basis.some((b:Data)=>b.role===r);
 if(sides.some(s=>s.assertions.physicalMember!=='HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER_AND_SECTION'||!has(s,'PHYSICAL_MEMBER')))return 'PHYSICAL_MEMBER_UNVERIFIED';
 if(sides.some(s=>s.assertions.shape!=='HUMAN_REVIEWED_RECTANGLE'||!has(s,'SECTION_SHAPE')))return 'SECTION_SHAPE_UNVERIFIED';
 if(sides.some(s=>s.assertions.dimensionMeaning!=='HUMAN_REVIEWED_GROSS_EXTERNAL_SECTION'||!has(s,'GROSS_SECTION')))return 'DIMENSION_MEANING_UNVERIFIED';
 for(const s of sides){const q=s.selection,u=unitTarget(q);if(s.assertions.unit!=='HUMAN_REVIEWED_EXPLICIT_MM'||s.unitScopeAssertion!=='HUMAN_REVIEWED_UNIT_APPLIES_TO_BOTH_SELECTED_DIMENSIONS'||!u||!s.basis.some((b:Data)=>b.role==='UNIT'&&equal(omit(b,['role','nativeBoxPointStrings','bboxMilliPoints','pageFrame']),tokenSelection(u))))return 'UNIT_UNVERIFIED';if(q.mode!=='LITERAL_T77_V1'&&(!sameTarget(q.first,u)||!sameTarget(q.second,u))&&!has(s,'UNIT_SCOPE'))return 'UNIT_UNVERIFIED';}
 if(p.pairAssertion!=='HUMAN_REVIEWED_SAME_MEMBER_SECTION_PD_RD')return 'PAIR_APPLICABILITY_UNVERIFIED';return null;
}
/** API-internal consistency only. Does not certify current metadata, actor, DB sequence or PDF. */
export function validateColumnPylonSectionApprovedClaims(value:unknown):void{
 const j=validateColumnPylonSectionReviewDecision(value);
 if(j.projection.status!=='APPROVED'||claimEligibility(j.projection)!==null)fail('INVALID_DECISION');
}
function abstain(reasonCode:string,identity:Data=null):ColumnPylonSectionV2Result{return {schemaVersion:'matrix-kr060-column-pylon-comparison-v2',status:'ABSTAIN',reasonCode,identity,comparison:null,calibratedProbability:null} as ColumnPylonSectionV2Result;}
function sourceReference(s:Data):Data{const q=s.selection;return {...omit(s,['assertions','unitScopeAssertion','reference','basis','selection']),selection:q.mode==='LITERAL_T77_V1'?omit(q,['literalSnapshot']):{mode:q.mode,first:tokenSelection(q.first),second:tokenSelection(q.second),unit:q.unit===null?null:tokenSelection(q.unit),selectionContentHash:q.selectionContentHash}};}
export function compareKr060ColumnPylonSection(v:unknown):ColumnPylonSectionV2Result{
 let x:Data;try{x=detach(v,'WHOLE');}catch(e){return abstain(e instanceof ColumnPylonSectionReviewValidationError&&e.code==='INPUT_LIMIT'?'INPUT_LIMIT':'INVALID_INPUT');}
 try{if(!dto(x,'comparisonInput')||!cleanKnown(x))return abstain('INVALID_INPUT');const id=x.identity,j=x.review,p=j?.projection,sides=p?[p.expected,p.actual]:null;
  if(!retained(x,sides))return abstain('SOURCE_PROVENANCE_UNVERIFIED',id);
  if(j&&(!validJournal(j)||j.objectId!==x.objectId||!equal(p.identity,id)))return abstain('PAIR_REVIEW_UNVERIFIED',id);
  if(sides){for(let i=0;i<2;i++){const q=selectionSnapshot(sides[i],x.origins[i]);if(!q||!equal(q,sides[i].selection))return abstain('SELECTION_RECONSTRUCTION_UNVERIFIED',id);}for(let i=0;i<2;i++){const b=basisSnapshot(sides[i],x.origins[i]);if(!b||!equal(b,sides[i].basis))return abstain('BASIS_RECONSTRUCTION_UNVERIFIED',id);}}
  if(!j)return abstain('PAIR_REVIEW_MISSING',id);if(p.status!=='APPROVED')return abstain('PAIR_REVIEW_UNAPPROVED',id);const reason=eligibility(x,p);if(reason)return abstain(reason,id);
  const area=(s:Data)=>{const q=s.selection;return q.mode==='LITERAL_T77_V1'?BigInt(q.literalSnapshot.tokens.first.raw)*BigInt(q.literalSnapshot.tokens.second.raw):BigInt(q.first.value)*BigInt(q.second.value);};const a=area(p.expected),b=area(p.actual),comparison={scope:'ONE_HUMAN_REVIEWED_RECTANGULAR_GROSS_SECTION_PD_RD',expected:sourceReference(p.expected),actual:sourceReference(p.actual),expectedAreaMm2:String(a),actualAreaMm2:String(b),deltaAreaMm2:String(b-a),pairDecisionId:j.id,pairProjectionContentHash:p.contentHash,pairJournalContentHash:j.contentHash};
  return {schemaVersion:'matrix-kr060-column-pylon-comparison-v2',status:b<a?'CANDIDATE':'NO_DECREASE_IN_REVIEWED_PAIR',reasonCode:b<a?'REVIEWED_RECTANGULAR_GROSS_SECTION_AREA_DECREASE':'REVIEWED_PAIR_HAS_NO_AREA_DECREASE',identity:id,comparison,...(b<a?{expertReviewRequired:true}:{}),calibratedProbability:null} as ColumnPylonSectionV2Result;
 }catch{return abstain('INVALID_INPUT');}
}
export function materializeColumnPylonSectionReview(input:unknown,context:unknown):ColumnPylonSectionV2Journal{
 const request=detach(input,'REQUEST'),ctx=detach(context,'WHOLE');if(!dto(request,'request')||!cleanKnown(request)||!dto(ctx,'materializationContext')||!cleanKnown(ctx)||!calendar(ctx.createdAt))fail('INVALID_INPUT');
 const previous=ctx.previous;if(previous&&!validJournal(previous))fail('INVALID_DECISION');if(request.expectedReviewHash!==(previous?.contentHash??null))fail('STALE_REVIEW');
 const key=(p:Data)=>columnPylonSectionPairKey({objectId:ctx.objectId,identity:p.identity,expectedSourceFileId:p.expected.sourceFileId,actualSourceFileId:p.actual.sourceFileId});
 if(previous&&(previous.objectId!==ctx.objectId||previous.id===ctx.id||key(previous.projection)!==key(request)))fail('PAIR_MISMATCH');
 if(!retained(ctx,[request.expected,request.actual]))fail('INVALID_PACKAGE');
 const withdraw=request.status==='WITHDRAWN';if(withdraw){if(!previous||ctx.mode!=='HISTORICAL'||!equal(omit(request,['status','expectedReviewHash']),omit(project(previous),['status','expectedReviewHash'])))fail('WITHDRAWAL_MISMATCH');}else if(ctx.mode!=='CURRENT')fail('INVALID_PACKAGE');
 const sides=[];for(let i=0;i<2;i++){const s=i===0?request.expected:request.actual,q=selectionSnapshot(s,ctx.origins[i]),b=basisSnapshot(s,ctx.origins[i]);if(!q||!b)fail('INVALID_PACKAGE');sides.push({...s,selection:q,basis:b});}
 if(withdraw&&(!equal(sides[0],previous.projection.expected)||!equal(sides[1],previous.projection.actual)))fail('WITHDRAWAL_MISMATCH');
 if(!withdraw){for(let i=0;i<2;i++){const r=ctx.sources[i].review;if(!r||r.decisionId!==sides[i].sourceReviewDecisionId||r.contentHash!==sides[i].sourceReviewContentHash)fail('STALE_REVIEW');}if(request.status==='APPROVED'&&eligibility(ctx,{...request,expected:sides[0],actual:sides[1]}))fail('APPROVAL_NOT_ELIGIBLE');}
 const p:Data={schemaVersion:'matrix-kr060-column-pylon-pair-projection-v2',decisionId:ctx.id,objectId:ctx.objectId,status:request.status,identity:request.identity,expected:sides[0],actual:sides[1],pairAssertion:request.pairAssertion,reference:request.reference};p.contentHash=projectionHash(p);
 const j:Data={schemaVersion:'matrix-kr060-column-pylon-pair-journal-v2',id:ctx.id,objectId:ctx.objectId,actorId:ctx.actorId,createdAt:ctx.createdAt,previousDecisionId:previous?.id??null,previousReviewHash:previous?.contentHash??null,projection:p};j.contentHash=journalHash(j);return validateColumnPylonSectionReviewDecision(j);
}
