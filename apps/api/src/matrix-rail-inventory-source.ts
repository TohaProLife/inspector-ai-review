/** Independent T45 source-only rail grammar. No review, completeness or comparison authority. */
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {canonicalSourceDeclarationJson,extractSourceDeclarations} from './matrix-source-declarations.js';
import {readTableRowPage,type TableRowFragment} from './table-row-binding.js';
export const RAIL_INVENTORY_EXTRACTOR_VERSION='matrix-odi120-rail-inventory-source-v1';
export const RAIL_INVENTORY_POLICY_VERSION='matrix-odi120-rail-inventory-literals-v1';
type Box=[number,number,number,number];type Obj=Record<string,unknown>;
export type RailFeature='WC_FIXED_RAIL'|'WC_FOLDING_RAIL'|'BASIN_RAIL';
export interface RailSelection {pageNumber:number;regionBoxMilliPoints:Box;headerFragments:TableRowFragment[];scopeFragments:TableRowFragment[];endFragments:TableRowFragment[]}
export interface RailSourceInventory {schemaVersion:typeof RAIL_INVENTORY_EXTRACTOR_VERSION;extractorVersion:typeof RAIL_INVENTORY_EXTRACTOR_VERSION;policyVersion:typeof RAIL_INVENTORY_POLICY_VERSION;sourceFileId:string;sourceSha256:string;textArtifactHash:string;stage:'PD'|'RD';pageNumber:number;widthMilliPoints:number;heightMilliPoints:number;regionBoxMilliPoints:Box;headerFragments:TableRowFragment[];scopeFragments:TableRowFragment[];endFragments:TableRowFragment[];roomToken:string;featureRows:Array<{featureKey:RailFeature;fragments:TableRowFragment[]}>}
export type RailReason='INVALID_INPUT'|'INPUT_LIMIT'|'INVALID_TEXT_ARTIFACT'|'SOURCE_MISMATCH'|'STAGE_UNRESOLVED'|'INVALID_SELECTION'|'TEXT_LAYER_UNAVAILABLE'|'LINE_GEOMETRY_UNAVAILABLE'|'LINE_GEOMETRY_INCONSISTENT'|'REGION_LINE_LIMIT'|'REGION_BOUNDARY_CROSSED'|'AMBIGUOUS_LAYOUT'|'HEADER_UNVERIFIED'|'SCOPE_UNVERIFIED'|'END_UNVERIFIED'|'OUTSIDE_BODY_ROW'|'EMPTY_INVENTORY_UNVERIFIED'|'UNSUPPORTED_BODY_ROW'|'DUPLICATE_FEATURE';
export type RailResult={schemaVersion:'matrix-odi120-rail-inventory-source-result-v1';status:'ABSTAIN';reasonCode:RailReason}|{schemaVersion:'matrix-odi120-rail-inventory-source-result-v1';status:'RECONSTRUCTED';inventory:RailSourceInventory};
const HEADER='Перечень поручней доступного санузла',END='Конец перечня поручней доступного санузла',PREFIX='Санузел МГН: ';
const SCOPE=/^Санузел МГН: [A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}(?![\s\S])/u;
const PATTERNS:ReadonlyArray<readonly[RailFeature,readonly string[]]>=[['WC_FIXED_RAIL',['Поручень стационарный','для унитаза']],['WC_FOLDING_RAIL',['Поручень откидной','с бумагодержателем','для унитаза']],['BASIN_RAIL',['Поручень для раковины']]];
const VOCABULARY=new Set(PATTERNS.flatMap(([,lines])=>[...lines]));
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v),positive=(v:unknown):v is number=>integer(v)&&v>0;
const record=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!isProxy(v)&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,names:string[]):v is Obj=>record(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));
const trim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,'');
const scalarId=(v:unknown):v is string=>typeof v==='string'&&!!v&&trim(v)===v&&[...v].length<=200;
const forbiddenLine=/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u;
const sourceId=(v:unknown):v is string=>scalarId(v)&&!forbiddenLine.test(v);
const SHA=/^[a-f0-9]{64}(?![\s\S])/u;
const box=(v:unknown):v is Box=>Array.isArray(v)&&v.length===4&&v.every(integer)&&v[0]>=0&&v[1]>=0&&v[0]<v[2]&&v[1]<v[3];
const contains=(a:Box,b:Box)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
const intersects=(a:Box,b:Box)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
const copy=(f:TableRowFragment):TableRowFragment=>({...f,bboxMilliPoints:[...f.bboxMilliPoints]});
const abstain=(reasonCode:RailReason):RailResult=>({schemaVersion:'matrix-odi120-rail-inventory-source-result-v1',status:'ABSTAIN',reasonCode});
/** Frozen portable conventions: descriptor-first, zero proxy/getter calls, keys included in budgets. */
function native(raw:unknown):'VALID'|'INVALID'|'LIMIT'{let nodes=0,bytes=0,limited=false;const ancestors=new Set<object>();const limit=()=>{limited=true;return false;};
function visit(v:unknown,depth:number):boolean{if(++nodes>200000||depth>64)return limit();if(v===null||typeof v==='boolean')return true;if(typeof v==='number')return integer(v);if(typeof v==='string'){if(v.length>8000000)return limit();let points=0;for(const c of v){if(++points>2000000)return limit();const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}bytes+=Buffer.byteLength(v,'utf8');return bytes>8000000?limit():true;}
if(!v||typeof v!=='object'||isProxy(v)||ancestors.has(v))return false;const array=Array.isArray(v);if(array?Object.getPrototypeOf(v)!==Array.prototype:!record(v))return false;const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);if(names.some(n=>typeof n!=='string'))return false;let keys:string[];if(array){const count=ds.length?.value;if(!integer(count)||count<0)return false;if(count>32768)return limit();if(names.length!==count+1)return false;keys=Array.from({length:count},(_,i)=>String(i));}else{if(names.length>32768)return limit();keys=names as string[];}
ancestors.add(v);for(const key of keys){const d=ds[key];if(!d||!d.enumerable||!Object.hasOwn(d,'value')||(!array&&!visit(key,depth+1))||!visit(d.value,depth+1)){ancestors.delete(v);return false;}}ancestors.delete(v);return true;}
try{return visit(raw,0)?'VALID':limited?'LIMIT':'INVALID';}catch{return'INVALID';}}
export function railInventoryContentHash(inventory:RailSourceInventory):string{return createHash('sha256').update(canonicalSourceDeclarationJson({hashDomain:'matrix-odi120-rail-inventory-source-id-v1',inventory})).digest('hex');}
export function reconstructOdi120RailInventorySource(raw:unknown):RailResult{
const n=native(raw);if(n!=='VALID')return abstain(n==='LIMIT'?'INPUT_LIMIT':'INVALID_INPUT');
if(!exact(raw,['sourceFileId','sourceSha256','stage','pageStages','textArtifact','selection'])||!sourceId(raw.sourceFileId)||typeof raw.sourceSha256!=='string'||!SHA.test(raw.sourceSha256)||typeof raw.stage!=='string'||!record(raw.pageStages))return abstain('INVALID_INPUT');
const pageStages=raw.pageStages;if(Object.entries(pageStages).some(([p,s])=>!/^[1-9][0-9]{0,15}(?![\s\S])/u.test(p)||!positive(Number(p))||typeof s!=='string'||!['PD','RD','ID','UNRESOLVED'].includes(s)))return abstain('INVALID_INPUT');
const artifact=raw.textArtifact;if(!record(artifact)||!scalarId(artifact.sourceFileId)||typeof artifact.inputSha256!=='string'||!SHA.test(artifact.inputSha256))return abstain('INVALID_TEXT_ARTIFACT');
try{extractSourceDeclarations({objectId:'rail-source-full-envelope-validation',inputManifestHash:'0'.repeat(64),sources:[{sourceFileId:artifact.sourceFileId,sha256:artifact.inputSha256,stages:[]}],textArtifacts:[artifact]});}catch{return abstain('INVALID_TEXT_ARTIFACT');}
if((artifact.pageCount as number)>512)return abstain('INPUT_LIMIT');
if(raw.sourceFileId!==artifact.sourceFileId||raw.sourceSha256!==artifact.inputSha256)return abstain('SOURCE_MISMATCH');
if(Object.keys(pageStages).some(p=>Number(p)>(artifact.pageCount as number)))return abstain('INVALID_INPUT');
if((raw.stage!=='PD'&&raw.stage!=='RD')||Object.values(pageStages).some(s=>s!==raw.stage))return abstain('STAGE_UNRESOLVED');
const selection=raw.selection;if(!exact(selection,['pageNumber','regionBoxMilliPoints','headerFragments','scopeFragments','endFragments'])||!positive(selection.pageNumber)||selection.pageNumber>(artifact.pageCount as number)||!box(selection.regionBoxMilliPoints))return abstain('INVALID_SELECTION');
const anchors:TableRowFragment[]=[];for(const key of ['headerFragments','scopeFragments','endFragments']){const fragments=selection[key];if(!Array.isArray(fragments)||fragments.length!==1)return abstain('INVALID_SELECTION');const f=fragments[0];if(!exact(f,['pageNumber','blockIndex','lineIndex','rawText','bboxMilliPoints'])||!positive(f.pageNumber)||!integer(f.blockIndex)||f.blockIndex<0||!integer(f.lineIndex)||f.lineIndex<0||typeof f.rawText!=='string'||!trim(f.rawText)||[...f.rawText].length>8192||forbiddenLine.test(f.rawText)||!box(f.bboxMilliPoints))return abstain('INVALID_SELECTION');anchors.push(f as unknown as TableRowFragment);}
const page=(artifact.pages as Obj[])[selection.pageNumber-1],frame:Box=[0,0,page.widthMilliPoints as number,page.heightMilliPoints as number],region=selection.regionBoxMilliPoints;
if(!contains(frame,region)||anchors.some(f=>!contains(frame,f.bboxMilliPoints)||!contains(region,f.bboxMilliPoints))||region[0]!==0||region[2]!==page.widthMilliPoints||region[1]!==anchors[2].bboxMilliPoints[1]||region[3]!==anchors[0].bboxMilliPoints[3])return abstain('INVALID_SELECTION');
const read=readTableRowPage(page);if(read.status!=='READY')return abstain(read.reasonCode==='PAGE_LIMIT'?'INPUT_LIMIT':['TEXT_LAYER_UNAVAILABLE','LINE_GEOMETRY_UNAVAILABLE','LINE_GEOMETRY_INCONSISTENT'].includes(read.reasonCode)?read.reasonCode as RailReason:'INVALID_TEXT_ARTIFACT');
const touching=read.lines.filter(f=>!!trim(f.rawText)&&intersects(region,f.bboxMilliPoints));if(touching.length>128)return abstain('REGION_LINE_LIMIT');if(touching.some(f=>!contains(region,f.bboxMilliPoints)))return abstain('REGION_BOUNDARY_CROSSED');
const lines=[...touching].sort((a,b)=>b.bboxMilliPoints[1]-a.bboxMilliPoints[1]||a.bboxMilliPoints[0]-b.bboxMilliPoints[0]||a.blockIndex-b.blockIndex||a.lineIndex-b.lineIndex);for(let i=1;i<lines.length;i++){const gap=lines[i-1].bboxMilliPoints[1]-lines[i].bboxMilliPoints[3];if(gap<0||gap>30000)return abstain('AMBIGUOUS_LAYOUT');}
const matched=anchors.map(a=>lines.find(f=>canonicalSourceDeclarationJson(a)===canonicalSourceDeclarationJson(f))),[header,scope,end]=matched;
if(!header||header.rawText!==HEADER||lines[0]!==header||read.lines.filter(f=>f.rawText===HEADER).length!==1)return abstain('HEADER_UNVERIFIED');
if(!scope||!SCOPE.test(scope.rawText)||lines[1]!==scope||read.lines.filter(f=>SCOPE.test(f.rawText)).length!==1)return abstain('SCOPE_UNVERIFIED');
if(!end||end.rawText!==END||lines.at(-1)!==end||read.lines.filter(f=>f.rawText===END).length!==1)return abstain('END_UNVERIFIED');
const selected=new Set(lines);if(read.lines.some(f=>!selected.has(f)&&VOCABULARY.has(f.rawText)))return abstain('OUTSIDE_BODY_ROW');
const body=lines.slice(2,-1);if(!body.length)return abstain('EMPTY_INVENTORY_UNVERIFIED');
const featureRows:RailSourceInventory['featureRows']=[],seen=new Set<RailFeature>();let duplicate=false;
for(let i=0;i<body.length;){const pattern=PATTERNS.find(([,words])=>words.every((word,j)=>{const f=body[i+j];return f&&f.rawText===word&&f.blockIndex===body[i].blockIndex&&f.lineIndex===body[i].lineIndex+j;}));if(!pattern)return abstain('UNSUPPORTED_BODY_ROW');const[key,words]=pattern;if(seen.has(key))duplicate=true;seen.add(key);featureRows.push({featureKey:key,fragments:body.slice(i,i+words.length).map(copy)});i+=words.length;}
if(duplicate)return abstain('DUPLICATE_FEATURE');
const textArtifactHash=createHash('sha256').update(canonicalSourceDeclarationJson({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:artifact})).digest('hex');
return{schemaVersion:'matrix-odi120-rail-inventory-source-result-v1',status:'RECONSTRUCTED',inventory:{schemaVersion:RAIL_INVENTORY_EXTRACTOR_VERSION,extractorVersion:RAIL_INVENTORY_EXTRACTOR_VERSION,policyVersion:RAIL_INVENTORY_POLICY_VERSION,sourceFileId:raw.sourceFileId,sourceSha256:raw.sourceSha256,textArtifactHash,stage:raw.stage,pageNumber:read.pageNumber,widthMilliPoints:read.widthMilliPoints,heightMilliPoints:read.heightMilliPoints,regionBoxMilliPoints:[...region],headerFragments:[copy(header)],scopeFragments:[copy(scope)],endFragments:[copy(end)],roomToken:scope.rawText.slice(PREFIX.length),featureRows}};
}
