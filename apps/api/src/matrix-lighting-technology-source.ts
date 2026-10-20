import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalSourceDeclarationJson, extractSourceDeclarations } from "./matrix-source-declarations.js";
import { readTableRowPage, type TableRowFragment } from "./table-row-binding.js";

export const LIGHTING_TECHNOLOGY_EXTRACTOR_VERSION = "matrix-zu130-lighting-technology-source-v1";
export const LIGHTING_TECHNOLOGY_POLICY_VERSION = "matrix-zu130-explicit-lighting-technology-literals-v1";
type Json = Record<string, unknown>;
type Box = [number, number, number, number];
export type LightingTechnology = "LED" | "FLUORESCENT" | "INCANDESCENT";
export interface LightingTechnologyDeclaration {
  schemaVersion: "matrix-zu130-lighting-technology-declaration-v1";
  extractorVersion: typeof LIGHTING_TECHNOLOGY_EXTRACTOR_VERSION;
  bindingPolicyVersion: typeof LIGHTING_TECHNOLOGY_POLICY_VERSION;
  sourceFileId: string; sourceSha256: string; textArtifactHash: string; stage: "PD"|"RD"|"ID"|"UNRESOLVED";
  pageNumber: number; pageWidthMilliPoints: number; pageHeightMilliPoints: number; regionBoxMilliPoints: Box;
  technology: LightingTechnology; rawTechnology: string; positionLabel: string|null;
  scopeStatus: "NAMED_POSITION_LITERAL"|"UNBOUND_GROUP_DECLARATION";
  primaryFragments: TableRowFragment[]; authorityStatus: "SOURCE_DECLARED_UNVERIFIED"; calibratedProbability: null;
}
export type LightingTechnologySourceReason = "INVALID_INPUT"|"INPUT_LIMIT"|"INVALID_TEXT_ARTIFACT"|"SOURCE_MISMATCH"
  |"STAGE_CONFLICT"|"INVALID_SELECTION"|"SOURCE_TEXT_UNAVAILABLE"|"LINE_GEOMETRY_INCONSISTENT"
  |"SELECTION_MISMATCH"|"AMBIGUOUS_LAYOUT"|"DECLARATION_UNVERIFIED";
export type LightingTechnologySourceResult = {schemaVersion:"matrix-zu130-lighting-technology-source-result-v1";status:"ABSTAIN";reasonCode:LightingTechnologySourceReason}
  |{schemaVersion:"matrix-zu130-lighting-technology-source-result-v1";status:"RECONSTRUCTED";declaration:LightingTechnologyDeclaration};
const SCHEMA="matrix-zu130-lighting-technology-source-result-v1";
const stages=new Set(["PD","RD","ID","UNRESOLVED"]), SHA=/^[a-f0-9]{64}$(?![\s\S])/u;
const integer=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v);
const positive=(v:unknown):v is number=>integer(v)&&v>0;
const record=(v:unknown):v is Json=>!!v&&typeof v==="object"&&!types.isProxy(v)&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:string[]):v is Json=>record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const pyTrim=(v:string)=>v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,"");
const lineText=(v:unknown):v is string=>typeof v==="string"&&!/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v);
const key=(v:unknown):v is string=>lineText(v)&&v.length>0&&[...v].length<=200&&pyTrim(v)===v;
const box=(v:unknown,width:number,height:number):v is Box=>Array.isArray(v)&&v.length===4&&v.every(n=>integer(n)&&n>=0)
  &&v[0]<v[2]&&v[1]<v[3]&&v[2]<=width&&v[3]<=height;
const abstain=(reasonCode:LightingTechnologySourceReason):LightingTechnologySourceResult=>({schemaVersion:SCHEMA,status:"ABSTAIN",reasonCode});

/** Descriptor-first native guard: no accessor/proxy/serialization callbacks. */
function portable(input:unknown):"VALID"|"INVALID"|"LIMIT" {
  let nodes=0,bytes=0,limited=false;const parents=new Set<object>();
  function limit(){limited=true;return false;}
  function visit(v:unknown,depth:number):boolean {
    if(++nodes>200000||depth>64)return limit();
    if(v===null||typeof v==="boolean")return true;
    if(typeof v==="number")return integer(v);
    if(typeof v==="string") {
      if(v.length>8000000)return limit();let points=0;
      for(const c of v){if(++points>2000000)return limit();const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)return false;}
      bytes+=Buffer.byteLength(v,"utf8");return bytes>8000000?limit():true;
    }
    if(!v||typeof v!=="object"||types.isProxy(v)||parents.has(v))return false;
    const array=Array.isArray(v);if(array?Object.getPrototypeOf(v)!==Array.prototype:!record(v))return false;
    const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);
    if(names.some(n=>typeof n!=="string"))return false;
    let keys:string[];
    if(array){const length=descriptors.length?.value;if(!integer(length)||length<0)return false;
      if(length>32768)return limit();if(names.length!==length+1)return false;keys=Array.from({length},(_,i)=>String(i));}
    else {if(names.length>32768)return limit();keys=names as string[];}
    parents.add(v);
    for(const name of keys){const d=descriptors[name];if(!d||!d.enumerable||!Object.hasOwn(d,"value")
      ||(!array&&!visit(name,depth+1))||!visit(d.value,depth+1)){parents.delete(v);return false;}}
    parents.delete(v);return true;
  }
  try{return visit(input,0)?"VALID":limited?"LIMIT":"INVALID";}catch{return "INVALID";}
}
const hash=(v:unknown)=>createHash("sha256").update(canonicalSourceDeclarationJson(v)).digest("hex");
export function lightingTechnologyDeclarationContentHash(declaration:unknown):string {
  if(portable(declaration)!=="VALID")throw Error("lighting declaration is not bounded portable JSON");
  return hash({hashDomain:"matrix-zu130-lighting-technology-source-id-v1",declaration});
}
const aliases=new Map<string,LightingTechnology>([
  ["LED","LED"],["светодиодный","LED"],["светодиодные","LED"],
  ["FLUORESCENT","FLUORESCENT"],["люминесцентный","FLUORESCENT"],["люминесцентные","FLUORESCENT"],
  ["INCANDESCENT","INCANDESCENT"],["лампа накаливания","INCANDESCENT"],["лампы накаливания","INCANDESCENT"],
]);
const named=/^Светильник +([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})\. Источник +света: ([^\r\n\t]+)\.$(?![\s\S])/u;
const first=/^Светотехническое +оборудование +приняты +с +энергосберегающими +источниками +света$(?![\s\S])/u;
const second=/^\(([^()\r\n\t]+)\), на базе продукции компании «([^«»()\x22\x27\r\n\t]{1,200})»\.$(?![\s\S])/u;
const ref=(f:TableRowFragment)=>`${f.blockIndex}:${f.lineIndex}`;
const order=(a:TableRowFragment,b:TableRowFragment)=>b.bboxMilliPoints[3]-a.bboxMilliPoints[3]
  ||a.bboxMilliPoints[0]-b.bboxMilliPoints[0]||a.blockIndex-b.blockIndex||a.lineIndex-b.lineIndex;

export function reconstructLightingTechnologySource(input:unknown):LightingTechnologySourceResult {
  const native=portable(input);if(native!=="VALID")return abstain(native==="LIMIT"?"INPUT_LIMIT":"INVALID_INPUT");
  if(!exact(input,["sourceFileId","sourceSha256","stage","pageStages","textArtifact","selection"])
    ||!key(input.sourceFileId)||typeof input.sourceSha256!=="string"||!SHA.test(input.sourceSha256)
    ||typeof input.stage!=="string"||!stages.has(input.stage)||!record(input.pageStages))return abstain("INVALID_INPUT");
  const pageStages=input.pageStages;
  if(Object.entries(pageStages).some(([p,s])=>!/^[1-9][0-9]{0,15}$(?![\s\S])/u.test(p)||!positive(Number(p))||typeof s!=="string"||!stages.has(s)))return abstain("INVALID_INPUT");
  const artifact=input.textArtifact;
  if(!record(artifact)||!key(artifact.sourceFileId)||typeof artifact.inputSha256!=="string"||!SHA.test(artifact.inputSha256))return abstain("INVALID_TEXT_ARTIFACT");
  try {extractSourceDeclarations({objectId:"lighting-source-validation",inputManifestHash:"0".repeat(64),
    sources:[{sourceFileId:artifact.sourceFileId,sha256:artifact.inputSha256,stages:[]}],textArtifacts:[artifact]});}
  catch{return abstain("INVALID_TEXT_ARTIFACT");}
  const pages=artifact.pages as Json[],pageCount=artifact.pageCount as number;
  if(pageCount>512||pages.reduce((n,p)=>n+(p.blocks as Json[]).reduce((n,b)=>n+(b.text as string).split("\n").length,0),0)>100000)return abstain("INPUT_LIMIT");
  if(input.sourceFileId!==artifact.sourceFileId||input.sourceSha256!==artifact.inputSha256)return abstain("SOURCE_MISMATCH");
  if(Object.keys(pageStages).some(p=>Number(p)>pageCount))return abstain("INVALID_INPUT");
  if(Object.values(pageStages).some(s=>s!=="UNRESOLVED"&&s!==input.stage))return abstain("STAGE_CONFLICT");
  const selection=input.selection;
  if(!exact(selection,["pageNumber","fragments"])||!positive(selection.pageNumber)||selection.pageNumber>pageCount
    ||!Array.isArray(selection.fragments)||![1,2].includes(selection.fragments.length))return abstain("INVALID_SELECTION");
  const page=pages[selection.pageNumber-1],width=page.widthMilliPoints as number,height=page.heightMilliPoints as number;
  for(const f of selection.fragments)if(!exact(f,["pageNumber","blockIndex","lineIndex","rawText","bboxMilliPoints"])
    ||!positive(f.pageNumber)||f.pageNumber!==selection.pageNumber||!integer(f.blockIndex)||f.blockIndex<0
    ||!integer(f.lineIndex)||f.lineIndex<0||!lineText(f.rawText)||!pyTrim(f.rawText)||[...f.rawText].length>8192
    ||!box(f.bboxMilliPoints,width,height))return abstain("INVALID_SELECTION");
  const fragments=selection.fragments as unknown as TableRowFragment[];
  if(new Set(fragments.map(ref)).size!==fragments.length||fragments.some((f,i)=>i>0&&order(fragments[i-1],f)>0))return abstain("INVALID_SELECTION");
  const read=readTableRowPage(page);
  if(read.status!=="READY")return abstain(read.reasonCode==="PAGE_LIMIT"?"INPUT_LIMIT":
    ["TEXT_LAYER_UNAVAILABLE","LINE_GEOMETRY_UNAVAILABLE"].includes(read.reasonCode)?"SOURCE_TEXT_UNAVAILABLE":
    read.reasonCode==="LINE_GEOMETRY_INCONSISTENT"?"LINE_GEOMETRY_INCONSISTENT":"INVALID_TEXT_ARTIFACT");
  const sourceLines=new Map(read.lines.map(f=>[ref(f),f]));
  if(fragments.some(f=>canonicalSourceDeclarationJson(sourceLines.get(ref(f))??null)!==canonicalSourceDeclarationJson(f)))return abstain("SELECTION_MISMATCH");
  const boxes=fragments.map(f=>f.bboxMilliPoints),region:Box=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
  const selected=new Set(fragments.map(ref));
  if(read.lines.some(f=>!selected.has(ref(f))&&!!pyTrim(f.rawText)&&region[0]<=f.bboxMilliPoints[2]&&f.bboxMilliPoints[0]<=region[2]
    &&region[1]<=f.bboxMilliPoints[3]&&f.bboxMilliPoints[1]<=region[3]))return abstain("AMBIGUOUS_LAYOUT");
  let positionLabel:string|null,rawTechnology:string;
  if(fragments.length===2){const [a,b]=boxes;
    // Real group:12000/12000mpt heights,14160indent,10080vertical gap.
    if(boxes.some(v=>v[3]-v[1]<9000||v[3]-v[1]>14000)||Math.abs((a[3]-a[1])-(b[3]-b[1]))>1000
      ||Math.abs(a[0]-b[0])>16000||a[2]<b[2]||a[1]-b[3]<0||a[1]-b[3]>18000
      ||(fragments[0].blockIndex===fragments[1].blockIndex&&fragments[1].lineIndex!==fragments[0].lineIndex+1))return abstain("AMBIGUOUS_LAYOUT");
    const match=second.exec(fragments[1].rawText);
    if(!first.test(fragments[0].rawText)||!match||!pyTrim(match[2])||pyTrim(match[2])!==match[2])return abstain("DECLARATION_UNVERIFIED");
    rawTechnology=match[1];positionLabel=null;
  }else {const match=named.exec(fragments[0].rawText);if(!match)return abstain("DECLARATION_UNVERIFIED");positionLabel=match[1];rawTechnology=match[2];}
  const technology=aliases.get(rawTechnology);if(!technology)return abstain("DECLARATION_UNVERIFIED");
  return {schemaVersion:SCHEMA,status:"RECONSTRUCTED",declaration:{schemaVersion:"matrix-zu130-lighting-technology-declaration-v1",
    extractorVersion:LIGHTING_TECHNOLOGY_EXTRACTOR_VERSION,bindingPolicyVersion:LIGHTING_TECHNOLOGY_POLICY_VERSION,
    sourceFileId:input.sourceFileId,sourceSha256:input.sourceSha256,textArtifactHash:hash({hashDomain:"matrix-source-declaration-text-artifact-v1",textArtifact:artifact}),
    stage:(pageStages[String(selection.pageNumber)]??input.stage) as LightingTechnologyDeclaration["stage"],pageNumber:selection.pageNumber,
    pageWidthMilliPoints:width,pageHeightMilliPoints:height,regionBoxMilliPoints:region,technology,rawTechnology,positionLabel,
    scopeStatus:positionLabel===null?"UNBOUND_GROUP_DECLARATION":"NAMED_POSITION_LITERAL",primaryFragments:structuredClone(fragments),
    authorityStatus:"SOURCE_DECLARED_UNVERIFIED",calibratedProbability:null}};
}
