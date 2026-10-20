/** T43 staged independent implementation. Exact closed literal band; no completeness or comparison authority. */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { canonicalSourceDeclarationJson, extractSourceDeclarations } from "./matrix-source-declarations.js";
import { readTableRowPage, type TableRowFragment } from "./table-row-binding.js";

export const CALL_INVENTORY_EXTRACTOR_VERSION = "matrix-odi123-call-inventory-source-v1";
export const CALL_INVENTORY_POLICY_VERSION = "matrix-odi123-call-inventory-literals-v1";
type Box = [number, number, number, number];
type RecordValue = Record<string, unknown>;
export type CallInventoryFeature = "PERSONNEL_CALL_BUTTON" | "TWO_WAY_COMMUNICATION_SYSTEM";
export interface CallInventorySelection {
  pageNumber: number; regionBoxMilliPoints: Box;
  headerFragments: TableRowFragment[]; scopeFragments: TableRowFragment[]; endFragments: TableRowFragment[];
}
export interface CallSourceInventory {
  schemaVersion: "matrix-odi123-call-inventory-source-v1";
  extractorVersion: typeof CALL_INVENTORY_EXTRACTOR_VERSION;
  policyVersion: typeof CALL_INVENTORY_POLICY_VERSION;
  sourceFileId: string; sourceSha256: string; textArtifactHash: string; stage: "PD" | "RD";
  pageNumber: number; widthMilliPoints: number; heightMilliPoints: number; regionBoxMilliPoints: Box;
  headerFragments: TableRowFragment[]; scopeFragments: TableRowFragment[]; endFragments: TableRowFragment[];
  featureRows: Array<{featureKey: CallInventoryFeature; fragments: TableRowFragment[]}>;
  roomToken: string;
}
export type CallInventoryAbstention = "INVALID_INPUT" | "INPUT_LIMIT" | "INVALID_TEXT_ARTIFACT" | "SOURCE_MISMATCH"
  | "STAGE_UNRESOLVED" | "INVALID_SELECTION" | "TEXT_LAYER_UNAVAILABLE" | "LINE_GEOMETRY_UNAVAILABLE"
  | "LINE_GEOMETRY_INCONSISTENT" | "REGION_LINE_LIMIT" | "REGION_BOUNDARY_CROSSED" | "AMBIGUOUS_LAYOUT"
  | "HEADER_UNVERIFIED" | "SCOPE_UNVERIFIED" | "END_UNVERIFIED"
  | "EMPTY_INVENTORY_UNVERIFIED" | "UNSUPPORTED_BODY_ROW" | "DUPLICATE_FEATURE";
export type CallInventorySourceResult = {schemaVersion:"matrix-odi123-call-inventory-source-result-v1";status:"RECONSTRUCTED";inventory:CallSourceInventory}
  | {schemaVersion:"matrix-odi123-call-inventory-source-result-v1";status:"ABSTAIN";reasonCode:CallInventoryAbstention};
const HEADER = "Перечень оборудования системы вызова персонала";
const END = "Конец перечня оборудования системы вызова персонала";
const SCOPE_PREFIX = "Санузел МГН: ";
const SCOPE = /^Санузел МГН: [A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}(?![\s\S])/u;
const SHA = /^[a-f0-9]{64}(?![\s\S])/u;
const LIMIT = {depth:64,nodes:200000,bytes:8000000,points:2000000,items:32768};
const integer = (value:unknown):value is number => typeof value === "number" && Number.isSafeInteger(value);
const positive = (value:unknown):value is number => integer(value) && value > 0;
const record = (value:unknown):value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value)
  && !isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value:unknown,names:string[]):value is RecordValue => record(value)
  && Object.keys(value).length === names.length && names.every(name=>Object.hasOwn(value,name));
const scalar = (value:string) => {for(const c of value){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}return true;};
const pyTrim = (value:string) => value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,"");
const scalarId = (value:unknown):value is string => typeof value === "string" && !!value && pyTrim(value)===value && [...value].length<=200;
const sourceId = (value:unknown):value is string => scalarId(value) && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(value);
const box = (value:unknown):value is Box => Array.isArray(value) && value.length===4 && value.every(integer)
  && value[0]>=0 && value[1]>=0 && value[0]<value[2] && value[1]<value[3];
const contains = (outer:Box,inner:Box) => outer[0]<=inner[0]&&outer[1]<=inner[1]&&outer[2]>=inner[2]&&outer[3]>=inner[3];
const intersects = (a:Box,b:Box) => a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
const copy = (fragment:TableRowFragment):TableRowFragment => ({...fragment,bboxMilliPoints:[...fragment.bboxMilliPoints]});
const ref = (fragment:TableRowFragment) => `${fragment.blockIndex}:${fragment.lineIndex}`;
const abstain = (reasonCode:CallInventoryAbstention):CallInventorySourceResult => ({schemaVersion:"matrix-odi123-call-inventory-source-result-v1",status:"ABSTAIN",reasonCode});

/** Inspect descriptors before values; bound the entire tree before source traversal or hashing. */
function portable(input:unknown):"VALID"|"INVALID"|"LIMIT" {
  let nodes=0,bytes=0,limited=false; const parents=new Set<object>();
  const limit=()=>{limited=true;return false;};
  function visit(value:unknown,depth:number):boolean {
    if(++nodes>LIMIT.nodes||depth>LIMIT.depth)return limit();
    if(value===null||typeof value==="boolean")return true;
    if(typeof value==="number")return integer(value);
    if(typeof value==="string") {
      if(value.length>LIMIT.bytes)return limit();
      if(value.length>LIMIT.points){let points=0;for(const _ of value)if(++points>LIMIT.points)return limit();}
      if(!scalar(value))return false;
      bytes+=Buffer.byteLength(value,"utf8");return bytes>LIMIT.bytes?limit():true;
    }
    if(!value||typeof value!=="object"||isProxy(value)||parents.has(value))return false;
    const array=Array.isArray(value);
    if(array?Object.getPrototypeOf(value)!==Array.prototype:!record(value))return false;
    const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
    if(names.some(name=>typeof name!=="string"))return false;
    let keys:string[];
    if(array) {
      const length=descriptors.length?.value;
      if(!integer(length)||length<0)return false;
      if(length>LIMIT.items)return limit();
      if(names.length!==length+1)return false;
      keys=Array.from({length},(_,index)=>String(index));
    } else {
      if(names.length>LIMIT.items)return limit();keys=names as string[];
    }
    parents.add(value);
    for(const name of keys) {
      const descriptor=descriptors[name];
      if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,"value")
        ||(!array&&!visit(name,depth+1))||!visit(descriptor.value,depth+1)){parents.delete(value);return false;}
    }
    parents.delete(value);return true;
  }
  try{return visit(input,0)?"VALID":limited?"LIMIT":"INVALID";}catch{return "INVALID";}
}

/** Hash domain is deliberately the existing whole source-text domain, never just the crop. */
export function callInventoryContentHash(inventory:CallSourceInventory):string {
  return createHash("sha256").update(canonicalSourceDeclarationJson({hashDomain:"matrix-odi123-call-inventory-source-id-v1",inventory})).digest("hex");
}

/** Exact source rows in a declared region. Reconstruction grants no completeness or absence authority. */
export function reconstructOdi123CallInventorySource(input:unknown):CallInventorySourceResult {
  const native=portable(input);if(native!=="VALID")return abstain(native==="LIMIT"?"INPUT_LIMIT":"INVALID_INPUT");
  if(!exact(input,["sourceFileId","sourceSha256","stage","pageStages","textArtifact","selection"])
    ||!sourceId(input.sourceFileId)||typeof input.sourceSha256!=="string"||!SHA.test(input.sourceSha256)||typeof input.stage!=="string"||!record(input.pageStages))return abstain("INVALID_INPUT");
  const pageStages=input.pageStages;
  if(Object.entries(pageStages).some(([page,stage])=>!/^[1-9][0-9]{0,15}(?![\s\S])/u.test(page)||!positive(Number(page))
    ||typeof stage!=="string"||!["PD","RD","ID","UNRESOLVED"].includes(stage)))return abstain("INVALID_INPUT");
  const artifact=input.textArtifact;
  if(!record(artifact)||!scalarId(artifact.sourceFileId)||typeof artifact.inputSha256!=="string"||!SHA.test(artifact.inputSha256))return abstain("INVALID_TEXT_ARTIFACT");
  try {
    // Reuse frozen full-envelope validator. Empty stage list deliberately requests no declaration discovery.
    extractSourceDeclarations({objectId:"call-inventory-source-validation",inputManifestHash:"0".repeat(64),
      sources:[{sourceFileId:artifact.sourceFileId,sha256:artifact.inputSha256,stages:[]}],textArtifacts:[artifact]});
  } catch {return abstain("INVALID_TEXT_ARTIFACT");}
  if((artifact.pageCount as number)>512)return abstain("INPUT_LIMIT");
  if(Object.keys(pageStages).some(page=>Number(page)>(artifact.pageCount as number)))return abstain("INVALID_INPUT");
  if(input.sourceFileId!==artifact.sourceFileId||input.sourceSha256!==artifact.inputSha256)return abstain("SOURCE_MISMATCH");
  if((input.stage!=="PD"&&input.stage!=="RD")||Object.values(pageStages).some(stage=>stage!==input.stage))return abstain("STAGE_UNRESOLVED");
  const selection=input.selection;
  if(!exact(selection,["pageNumber","regionBoxMilliPoints","headerFragments","scopeFragments","endFragments"])
    ||!positive(selection.pageNumber)||selection.pageNumber>(artifact.pageCount as number)||!box(selection.regionBoxMilliPoints)
    ||!Array.isArray(selection.headerFragments)||selection.headerFragments.length!==1||!Array.isArray(selection.scopeFragments)||selection.scopeFragments.length!==1||!Array.isArray(selection.endFragments)||selection.endFragments.length!==1)return abstain("INVALID_SELECTION");
  for(const fragment of [...selection.headerFragments,...selection.scopeFragments,...selection.endFragments]) {
    if(!exact(fragment,["pageNumber","blockIndex","lineIndex","rawText","bboxMilliPoints"])
      ||!positive(fragment.pageNumber)||!integer(fragment.blockIndex)||fragment.blockIndex<0
      ||!integer(fragment.lineIndex)||fragment.lineIndex<0||typeof fragment.rawText!=="string"||!pyTrim(fragment.rawText)||[...fragment.rawText].length>8192
      ||/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(fragment.rawText)||!box(fragment.bboxMilliPoints))return abstain("INVALID_SELECTION");
  }
  const page=(artifact.pages as RecordValue[])[selection.pageNumber-1];
  if(!contains([0,0,page.widthMilliPoints as number,page.heightMilliPoints as number],selection.regionBoxMilliPoints))return abstain("INVALID_SELECTION");
  if([...selection.headerFragments,...selection.scopeFragments,...selection.endFragments].some(fragment=>!contains([0,0,page.widthMilliPoints as number,page.heightMilliPoints as number],fragment.bboxMilliPoints)||!contains(selection.regionBoxMilliPoints as Box,fragment.bboxMilliPoints)))return abstain("INVALID_SELECTION");
  const requestedRegion=selection.regionBoxMilliPoints;
  if(requestedRegion[0]!==0||requestedRegion[2]!==page.widthMilliPoints
    ||requestedRegion[1]!==selection.endFragments[0].bboxMilliPoints[1]
    ||requestedRegion[3]!==selection.headerFragments[0].bboxMilliPoints[3])return abstain("INVALID_SELECTION");
  const read=readTableRowPage(page);
  if(read.status!=="READY") {
    const reason:CallInventoryAbstention=read.reasonCode==="PAGE_LIMIT"?"INPUT_LIMIT":
      ["TEXT_LAYER_UNAVAILABLE","LINE_GEOMETRY_UNAVAILABLE","LINE_GEOMETRY_INCONSISTENT"].includes(read.reasonCode)?read.reasonCode as CallInventoryAbstention:"INVALID_TEXT_ARTIFACT";
    return abstain(reason);
  }
  const region=selection.regionBoxMilliPoints;
  const touching=read.lines.filter(line=>!!pyTrim(line.rawText)&&intersects(region,line.bboxMilliPoints));
  if(touching.length>128)return abstain("REGION_LINE_LIMIT");
  if(touching.some(line=>!contains(region,line.bboxMilliPoints)))return abstain("REGION_BOUNDARY_CROSSED");
  // One-column grammar: even non-overlapping X boxes with shared vertical band are ambiguous.
  const lines=[...touching].sort((a,b)=>b.bboxMilliPoints[1]-a.bboxMilliPoints[1]||a.bboxMilliPoints[0]-b.bboxMilliPoints[0]||a.blockIndex-b.blockIndex||a.lineIndex-b.lineIndex);
  for(let i=1;i<lines.length;i++) {
    const gap=lines[i-1].bboxMilliPoints[1]-lines[i].bboxMilliPoints[3];
    if(gap<0||gap>30000)return abstain("AMBIGUOUS_LAYOUT");
  }
  const findAnchor=(raw:unknown):TableRowFragment|undefined=> {
    const fragment=raw as TableRowFragment;
    return lines.find(line=>ref(line)===ref(fragment)&&canonicalSourceDeclarationJson(line)===canonicalSourceDeclarationJson(fragment));
  };
  const header=findAnchor(selection.headerFragments[0]),scope=findAnchor(selection.scopeFragments[0]),end=findAnchor(selection.endFragments[0]);
  const pageLines=read.lines.filter(line=>!!pyTrim(line.rawText));
  if(!header||header.rawText!==HEADER||pageLines.filter(line=>line.rawText===HEADER).length!==1||lines[0]!==header)return abstain("HEADER_UNVERIFIED");
  if(!scope||!SCOPE.test(scope.rawText)||pageLines.filter(line=>SCOPE.test(line.rawText)).length!==1||lines[1]!==scope)return abstain("SCOPE_UNVERIFIED");
  if(!end||end.rawText!==END||pageLines.filter(line=>line.rawText===END).length!==1||lines[lines.length-1]!==end)return abstain("END_UNVERIFIED");
  const body=lines.slice(2,-1);
  if(!body.length)return abstain("EMPTY_INVENTORY_UNVERIFIED");
  const feature=(line:TableRowFragment):CallInventoryFeature|undefined=>line.rawText==="Кнопка вызова персонала"?"PERSONNEL_CALL_BUTTON":line.rawText==="Система двусторонней связи"?"TWO_WAY_COMMUNICATION_SYSTEM":undefined;
  if(body.some(line=>!feature(line)))return abstain("UNSUPPORTED_BODY_ROW");
  const featureRows:CallSourceInventory["featureRows"]=[],seen=new Set<CallInventoryFeature>();
  for(const line of body){const featureKey=feature(line)!;
    if(seen.has(featureKey))return abstain("DUPLICATE_FEATURE");seen.add(featureKey);
    featureRows.push({featureKey,fragments:[copy(line)]});
  }
  const textArtifactHash=createHash("sha256").update(canonicalSourceDeclarationJson({hashDomain:"matrix-source-declaration-text-artifact-v1",textArtifact:artifact})).digest("hex");
  return {schemaVersion:"matrix-odi123-call-inventory-source-result-v1",status:"RECONSTRUCTED",inventory:{
    schemaVersion:"matrix-odi123-call-inventory-source-v1",extractorVersion:CALL_INVENTORY_EXTRACTOR_VERSION,policyVersion:CALL_INVENTORY_POLICY_VERSION,
    sourceFileId:input.sourceFileId,sourceSha256:input.sourceSha256,textArtifactHash,stage:input.stage,
    pageNumber:read.pageNumber,widthMilliPoints:read.widthMilliPoints,heightMilliPoints:read.heightMilliPoints,
    regionBoxMilliPoints:[...region],headerFragments:[copy(header)],scopeFragments:[copy(scope)],endFragments:[copy(end)],roomToken:scope.rawText.slice(SCOPE_PREFIX.length),featureRows}};
}
