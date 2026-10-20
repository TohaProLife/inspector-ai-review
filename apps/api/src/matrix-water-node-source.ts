/** Source-local ZU129 cold-water inlet-node reconstruction; no review or comparison authority. */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {canonicalSourceDeclarationJson,extractSourceDeclarations} from './matrix-source-declarations.js';
import {readTableRowPage,type TableRowFragment} from './table-row-binding.js';

export const WATER_NODE_EXTRACTOR_VERSION='matrix-zu129-water-node-source-v1';
export const WATER_NODE_POLICY_VERSION='matrix-zu129-cold-water-inlet-literals-v1';
const RESULT_VERSION='matrix-zu129-water-node-source-result-v1';
type Box=[number,number,number,number];
type Obj=Record<string,unknown>;
export type WaterNodeFeature='WATER_METER'|'STRAINER'|'SHUTOFF_VALVE';
export interface WaterNodeSelection {
 pageNumber:number;regionBoxMilliPoints:Box;
 headerFragments:TableRowFragment[];scopeFragments:TableRowFragment[];endFragments:TableRowFragment[];
}
export interface WaterNodeSourceInventory extends WaterNodeSelection {
 schemaVersion:typeof WATER_NODE_EXTRACTOR_VERSION;extractorVersion:typeof WATER_NODE_EXTRACTOR_VERSION;
 policyVersion:typeof WATER_NODE_POLICY_VERSION;sourceFileId:string;sourceSha256:string;textArtifactHash:string;
 stage:'PD'|'RD';widthMilliPoints:number;heightMilliPoints:number;
 buildingToken:string;nodeToken:string;service:'COLD_WATER';accountingScope:'COMMON_BUILDING_INLET';
 featureRows:Array<{featureKey:WaterNodeFeature;fragments:TableRowFragment[]}>;
}
export type WaterNodeReason='INVALID_INPUT'|'INPUT_LIMIT'|'INVALID_TEXT_ARTIFACT'|'SOURCE_MISMATCH'|'STAGE_UNRESOLVED'|'INVALID_SELECTION'|'TEXT_LAYER_UNAVAILABLE'|'LINE_GEOMETRY_UNAVAILABLE'|'LINE_GEOMETRY_INCONSISTENT'|'REGION_LINE_LIMIT'|'REGION_BOUNDARY_CROSSED'|'AMBIGUOUS_LAYOUT'|'HEADER_UNVERIFIED'|'SCOPE_UNVERIFIED'|'END_UNVERIFIED'|'OUTSIDE_BODY_ROW'|'EMPTY_INVENTORY_UNVERIFIED'|'UNSUPPORTED_BODY_ROW'|'DUPLICATE_FEATURE';
export type WaterNodeResult=
 |{schemaVersion:typeof RESULT_VERSION;status:'ABSTAIN';reasonCode:WaterNodeReason}
 |{schemaVersion:typeof RESULT_VERSION;status:'RECONSTRUCTED';inventory:WaterNodeSourceInventory};
const HEADER='Состав общедомового вводного узла холодной воды';
const END='Конец состава общедомового вводного узла холодной воды';
const SCOPE_PREFIXES=['Здание:','Вводной узел:','Система:','Назначение:'];
const BUILDING=/^Здание: ([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})(?![\s\S])/u;
const NODE=/^Вводной узел: ([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})(?![\s\S])/u;
const FEATURES:ReadonlyArray<readonly[string,WaterNodeFeature]>=[['Счётчик холодной воды','WATER_METER'],['Фильтр сетчатый','STRAINER'],['Кран запорный','SHUTOFF_VALVE']];
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const positive=(v:unknown):v is number=>integer(v)&&v>0;
const record=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!isProxy(v)&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,names:string[]):v is Obj=>record(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));
const trim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const forbiddenLine=/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u;
const scalarId=(v:unknown):v is string=>typeof v==='string'&&!!v&&trim(v)===v&&[...v].length<=200;
const sourceId=(v:unknown):v is string=>scalarId(v)&&!forbiddenLine.test(v);
const SHA=/^[a-f0-9]{64}(?![\s\S])/u;
const box=(v:unknown):v is Box=>Array.isArray(v)&&v.length===4&&v.every(integer)&&v[0]>=0&&v[1]>=0&&v[0]<v[2]&&v[1]<v[3];
const contains=(a:Box,b:Box)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
const intersects=(a:Box,b:Box)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
const copy=(f:TableRowFragment):TableRowFragment=>({...f,bboxMilliPoints:[...f.bboxMilliPoints]});
const abstain=(reasonCode:WaterNodeReason):WaterNodeResult=>({schemaVersion:RESULT_VERSION,status:'ABSTAIN',reasonCode});

/** Descriptor-first generic integer JSON boundary; never evaluate user callbacks. */
function native(raw:unknown):'VALID'|'INVALID'|'LIMIT'{
 let nodes=0,bytes=0,limited=false;const ancestors=new Set<object>();
 const limit=()=>{limited=true;return false;};
 function visit(v:unknown,depth:number):boolean{
  if(++nodes>200000||depth>64)return limit();
  if(v===null||typeof v==='boolean')return true;
  if(typeof v==='number')return integer(v);
  if(typeof v==='string'){
   if(v.length>8000000)return limit();let points=0;
   for(const c of v){if(++points>2000000)return limit();const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}
   bytes+=Buffer.byteLength(v,'utf8');return bytes>8000000?limit():true;
  }
  if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))return false;
  const array=Array.isArray(v);
  if(array?Object.getPrototypeOf(v)!==Array.prototype:!record(v))return false;
  const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);
  if(names.some(n=>typeof n!=='string'))return false;
  let keys:string[];
  if(array){
   const count=ds.length?.value;if(!integer(count)||count<0)return false;
   if(count>32768)return limit();if(names.length!==count+1)return false;
   keys=Array.from({length:count},(_,i)=>String(i));
  }else{if(names.length>32768)return limit();keys=names as string[];}
  ancestors.add(v);
  for(const key of keys){
   const d=ds[key];
   if(!d||!d.enumerable||!Object.hasOwn(d,'value')||(!array&&!visit(key,depth+1))||!visit(d.value,depth+1)){
    ancestors.delete(v);return false;
   }
  }
  ancestors.delete(v);return true;
 }
 try{return visit(raw,0)?'VALID':limited?'LIMIT':'INVALID';}catch{return'INVALID';}
}
export function waterNodeInventoryContentHash(inventory:WaterNodeSourceInventory):string{
 if(native(inventory)!=='VALID')throw new TypeError('Water-node inventory is not bounded native JSON');
 return createHash('sha256').update(canonicalSourceDeclarationJson({hashDomain:'matrix-zu129-water-node-source-id-v1',inventory})).digest('hex');
}
export function reconstructZu129WaterNodeSource(raw:unknown):WaterNodeResult{
 const checked=native(raw);if(checked!=='VALID')return abstain(checked==='LIMIT'?'INPUT_LIMIT':'INVALID_INPUT');
 if(!exact(raw,['sourceFileId','sourceSha256','stage','pageStages','textArtifact','selection'])||!sourceId(raw.sourceFileId)||typeof raw.sourceSha256!=='string'||!SHA.test(raw.sourceSha256)||typeof raw.stage!=='string'||!record(raw.pageStages))return abstain('INVALID_INPUT');
 const pageStages=raw.pageStages;
 if(Object.entries(pageStages).some(([p,s])=>!/^[1-9][0-9]{0,15}(?![\s\S])/u.test(p)||!positive(Number(p))||typeof s!=='string'||!['PD','RD','ID','UNRESOLVED'].includes(s)))return abstain('INVALID_INPUT');
 const artifact=raw.textArtifact;
 if(!record(artifact)||!scalarId(artifact.sourceFileId)||typeof artifact.inputSha256!=='string'||!SHA.test(artifact.inputSha256))return abstain('INVALID_TEXT_ARTIFACT');
 try{extractSourceDeclarations({objectId:'water-node-source-full-envelope-validation',inputManifestHash:'0'.repeat(64),sources:[{sourceFileId:artifact.sourceFileId,sha256:artifact.inputSha256,stages:[]}],textArtifacts:[artifact]});}catch{return abstain('INVALID_TEXT_ARTIFACT');}
 if((artifact.pageCount as number)>512)return abstain('INPUT_LIMIT');
 if(raw.sourceFileId!==artifact.sourceFileId||raw.sourceSha256!==artifact.inputSha256)return abstain('SOURCE_MISMATCH');
 if(Object.keys(pageStages).some(p=>Number(p)>(artifact.pageCount as number)))return abstain('INVALID_INPUT');
 if((raw.stage!=='PD'&&raw.stage!=='RD')||Object.values(pageStages).some(s=>s!==raw.stage))return abstain('STAGE_UNRESOLVED');
 const selection=raw.selection;
 if(!exact(selection,['pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'])||!positive(selection.pageNumber)||selection.pageNumber>(artifact.pageCount as number)||!box(selection.regionBoxMilliPoints))return abstain('INVALID_SELECTION');
 const anchors:TableRowFragment[]=[];
 for(const [key,count]of [['headerFragments',1],['scopeFragments',4],['endFragments',1]] as const){
  const fragments=selection[key];if(!Array.isArray(fragments)||fragments.length!==count)return abstain('INVALID_SELECTION');
  for(const f of fragments){
   if(!exact(f,['pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'])||!positive(f.pageNumber)||!integer(f.blockIndex)||f.blockIndex<0||!integer(f.lineIndex)||f.lineIndex<0||typeof f.rawText!=='string'||!trim(f.rawText)||[...f.rawText].length>8192||forbiddenLine.test(f.rawText)||!box(f.bboxMilliPoints))return abstain('INVALID_SELECTION');
   anchors.push(f as unknown as TableRowFragment);
  }
 }
 const page=(artifact.pages as Obj[])[selection.pageNumber-1];
 const frame:Box=[0,0,page.widthMilliPoints as number,page.heightMilliPoints as number],region=selection.regionBoxMilliPoints;
 if(!contains(frame,region)||anchors.some(f=>!contains(frame,f.bboxMilliPoints)||!contains(region,f.bboxMilliPoints))||region[0]!==0||region[2]!==page.widthMilliPoints||region[1]!==anchors[5].bboxMilliPoints[1]||region[3]!==anchors[0].bboxMilliPoints[3])return abstain('INVALID_SELECTION');
 const read=readTableRowPage(page);
 if(read.status!=='READY')return abstain(read.reasonCode==='PAGE_LIMIT'?'INPUT_LIMIT':['TEXT_LAYER_UNAVAILABLE','LINE_GEOMETRY_UNAVAILABLE','LINE_GEOMETRY_INCONSISTENT'].includes(read.reasonCode)?read.reasonCode as WaterNodeReason:'INVALID_TEXT_ARTIFACT');
 const nonempty=read.lines.filter(f=>!!trim(f.rawText)),touching=nonempty.filter(f=>intersects(region,f.bboxMilliPoints));
 if(touching.length>128)return abstain('REGION_LINE_LIMIT');
 if(touching.some(f=>!contains(region,f.bboxMilliPoints)))return abstain('REGION_BOUNDARY_CROSSED');
 const lines=[...touching].sort((a,b)=>b.bboxMilliPoints[1]-a.bboxMilliPoints[1]||a.bboxMilliPoints[0]-b.bboxMilliPoints[0]||a.blockIndex-b.blockIndex||a.lineIndex-b.lineIndex);
 for(let i=1;i<lines.length;i++){
  const gap=lines[i-1].bboxMilliPoints[1]-lines[i].bboxMilliPoints[3];
  if(gap<0||gap>30000)return abstain('AMBIGUOUS_LAYOUT');
 }
 const matched=anchors.map(a=>lines.find(f=>canonicalSourceDeclarationJson(a)===canonicalSourceDeclarationJson(f)));
 const header=matched[0],scopes=matched.slice(1,5),end=matched[5];
 if(!header||header.rawText!==HEADER||lines[0]!==header||nonempty.filter(f=>f.rawText===HEADER).length!==1)return abstain('HEADER_UNVERIFIED');
 const building=scopes[0]?.rawText.match(BUILDING),node=scopes[1]?.rawText.match(NODE);
 if(scopes.some((f,i)=>!f||lines[i+1]!==f)||!building||!node||scopes[2]?.rawText!=='Система: ХВС'||scopes[3]?.rawText!=='Назначение: общедомовой учёт'||SCOPE_PREFIXES.some(prefix=>nonempty.filter(f=>f.rawText.startsWith(prefix)).length!==1))return abstain('SCOPE_UNVERIFIED');
 if(!end||end.rawText!==END||lines.at(-1)!==end||nonempty.filter(f=>f.rawText===END).length!==1)return abstain('END_UNVERIFIED');
 const selected=new Set(lines);
 if(nonempty.some(f=>!selected.has(f)))return abstain('OUTSIDE_BODY_ROW');
 const body=lines.slice(5,-1);if(!body.length)return abstain('EMPTY_INVENTORY_UNVERIFIED');
 const featureRows:WaterNodeSourceInventory['featureRows']=[],seen=new Set<WaterNodeFeature>();let duplicate=false;
 for(const f of body){
  const feature=FEATURES.find(([literal])=>literal===f.rawText);
  if(!feature)return abstain('UNSUPPORTED_BODY_ROW');
  if(seen.has(feature[1]))duplicate=true;seen.add(feature[1]);
  featureRows.push({featureKey:feature[1],fragments:[copy(f)]});
 }
 if(duplicate)return abstain('DUPLICATE_FEATURE');
 const textArtifactHash=createHash('sha256').update(canonicalSourceDeclarationJson({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:artifact})).digest('hex');
 return{schemaVersion:RESULT_VERSION,status:'RECONSTRUCTED',inventory:{
  schemaVersion:WATER_NODE_EXTRACTOR_VERSION,extractorVersion:WATER_NODE_EXTRACTOR_VERSION,policyVersion:WATER_NODE_POLICY_VERSION,
  sourceFileId:raw.sourceFileId,sourceSha256:raw.sourceSha256,textArtifactHash,stage:raw.stage,
  pageNumber:read.pageNumber,widthMilliPoints:read.widthMilliPoints,heightMilliPoints:read.heightMilliPoints,
  regionBoxMilliPoints:[...region],headerFragments:[copy(header)],scopeFragments:scopes.map(f=>copy(f!)),endFragments:[copy(end)],
  buildingToken:building[1],nodeToken:node[1],service:'COLD_WATER',accountingScope:'COMMON_BUILDING_INLET',featureRows,
 }};
}
