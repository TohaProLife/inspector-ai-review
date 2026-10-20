/** Mechanical source-line partition. Semantics and policy authority belong to its consumer. */
export const TABLE_ROW_BINDER_VERSION = "table-row-binding-v1";
type Box = [number, number, number, number];
type Range = [number, number];
type Role = "ROW_LABEL" | "VALUE";
interface Anchor { blockIndex:number; lineIndex:number; rawText:string }
interface Column { key:string; role:Role; xRangeMilliPoints:Range; headerAnchors:Anchor[]; unitAnchors:Anchor[] }
interface Row { key:string; yRangeMilliPoints:Range; labelAnchors:Anchor[]; valueLineCounts:Record<string,number> }
interface Policy { schemaVersion:"table-row-binding-policy-v1"; tableBoxMilliPoints:Box; columns:Column[]; rows:Row[]; maxLineGapMilliPoints:number }
export interface TableRowFragment { pageNumber:number; blockIndex:number; lineIndex:number; rawText:string; bboxMilliPoints:Box }
export type TableRowAbstentionReason = "INVALID_PAGE" | "PAGE_LIMIT" | "TEXT_LAYER_UNAVAILABLE" | "LINE_GEOMETRY_UNAVAILABLE"
  | "LINE_GEOMETRY_INCONSISTENT" | "TABLE_OUTSIDE_PAGE" | "TABLE_LINE_LIMIT" | "TABLE_BOUNDARY_CROSSING" | "OVERLAPPING_LINES"
  | "MISSING_ANCHOR" | "ANCHOR_MISMATCH" | "ANCHOR_OUTSIDE_CELL" | "ANCHOR_ORDER" | "DUPLICATE_ROW_LABEL"
  | "UNEXPECTED_LABEL_CONTENT" | "CELL_LINE_COUNT" | "DUPLICATE_CELL_CONTENT" | "AMBIGUOUS_CELL_LINES" | "MULTILINE_GAP" | "UNASSIGNED_CONTENT";
export type TableRowBindingResult = {
  schemaVersion:"table-row-binding-result-v1"; status:"ABSTAIN"; reasonCode:TableRowAbstentionReason; rows:[];
} | {
  schemaVersion:"table-row-binding-result-v1"; status:"BOUND"; tableBoxMilliPoints:Box;
  columns:Array<{key:string;role:Role;xRangeMilliPoints:Range;headerFragments:TableRowFragment[];unitFragments:TableRowFragment[]}>;
  rows:Array<{key:string;yRangeMilliPoints:Range;cells:Array<{columnKey:string;role:Role;fragments:TableRowFragment[]}>}>;
};
export class TableRowBindingPolicyError extends Error {}
const LIMIT = { columns:16, rows:512, anchors:32, cellLines:32, blocks:8192, lines:32768, tableLines:2048,
  lineCodepoints:8192, pageCodepoints:2_000_000, pageBytes:4_000_000, stringCodepoints:2_000_000, nodes:200_000, items:32768, bytes:8_000_000, depth:64 };
const record = (v:unknown):v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v:unknown, keys:string[]):v is Record<string,unknown> => record(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const integer = (v:unknown):v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonnegative = (v:unknown):v is number => integer(v) && v>=0;
const positive = (v:unknown):v is number => integer(v) && v>0;
// Python str.strip whitespace, including its four information separators and NEL.
const PY_SPACE = "\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const pyTrim = (s:string) => s.replace(new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`,"gu"),"");
const scalarString = (s:string) => { for(const c of s) { const n=c.codePointAt(0)!; if(n>=0xd800&&n<=0xdfff)return false; } return true; };
const sourceString = (s:string) => scalarString(s) && !/[\u0000-\u0008\u000b-\u001f\u2028\u2029\ufffd]/u.test(s);
function portable(value:unknown):"VALID"|"INVALID"|"LIMIT" {
  let nodes=0,bytes=0,limited=false; const ancestors=new Set<object>();
  function limit(){limited=true;return false;}
  function string(s:string) {
    if(s.length>LIMIT.bytes)return limit();
    if(s.length>LIMIT.stringCodepoints){let points=0;for(const c of s){if(++points>LIMIT.stringCodepoints)return limit();}}
    bytes+=Buffer.byteLength(s,"utf8");if(bytes>LIMIT.bytes)return limit();return scalarString(s);
  }
  function visit(v:unknown,depth:number):boolean {
    if(++nodes>LIMIT.nodes||depth>LIMIT.depth)return limit();
    if(v===null||typeof v==="boolean")return true;
    if(typeof v==="number")return integer(v);
    if(typeof v==="string")return string(v);
    if(!v||typeof v!=="object"||ancestors.has(v))return false;
    const array=Array.isArray(v);if(array?Object.getPrototypeOf(v)!==Array.prototype:!record(v))return false;
    if(array) {const length=Object.getOwnPropertyDescriptor(v,"length");if(!length||!nonnegative(length.value))return false;if(length.value>LIMIT.items)return limit();}
    const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors);
    if(keys.some(k=>typeof k!=="string"))return false;
    let names:string[];
    if(array) {
      const n=descriptors.length?.value;
      if(!nonnegative(n)||keys.length!==n+1)return false;
      names=Array.from({length:n},(_,i)=>String(i));
    } else { if(keys.length>LIMIT.items)return limit();names=keys as string[]; }
    ancestors.add(v);
    for(const k of names) {
      const d=descriptors[k];
      if(!d||!Object.hasOwn(d,"value")||!d.enumerable||(!array&&!visit(k,depth+1))||!visit(d.value,depth+1)) { ancestors.delete(v);return false; }
    }
    ancestors.delete(v);return true;
  }
  try{return visit(value,0)?"VALID":limited?"LIMIT":"INVALID";}catch{return "INVALID";}
}
const range = (v:unknown):v is Range => Array.isArray(v)&&v.length===2&&v.every(integer)&&v[0]<v[1];
const box = (v:unknown):v is Box => Array.isArray(v)&&v.length===4&&v.every(integer)&&v[0]<v[2]&&v[1]<v[3];
const contains=(a:Box,b:Box)=>a[0]<=b[0]&&a[1]<=b[1]&&a[2]>=b[2]&&a[3]>=b[3];
const intersects=(a:Box,b:Box)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
const ref=(a:{blockIndex:number;lineIndex:number})=>`${a.blockIndex}:${a.lineIndex}`;
const cmp=(a:TableRowFragment,b:TableRowFragment)=>{
  const av=[-a.bboxMilliPoints[3],a.bboxMilliPoints[0],-a.bboxMilliPoints[1],a.bboxMilliPoints[2],a.blockIndex,a.lineIndex];
  const bv=[-b.bboxMilliPoints[3],b.bboxMilliPoints[0],-b.bboxMilliPoints[1],b.bboxMilliPoints[2],b.blockIndex,b.lineIndex];
  for(let i=0;i<av.length;i++){if(av[i]<bv[i])return -1;if(av[i]>bv[i])return 1;}return 0;
};
const copy=(f:TableRowFragment):TableRowFragment=>({...f,bboxMilliPoints:[...f.bboxMilliPoints]});
const abstain=(reasonCode:TableRowAbstentionReason):TableRowBindingResult=>({schemaVersion:"table-row-binding-result-v1",status:"ABSTAIN",reasonCode,rows:[]});
function validatePolicy(raw:unknown):Policy {
  const fail=():never=>{throw new TableRowBindingPolicyError("Invalid table row binding policy");};
  if(portable(raw)!=="VALID"||!exact(raw,["schemaVersion","tableBoxMilliPoints","columns","rows","maxLineGapMilliPoints"]))return fail();
  if(raw.schemaVersion!=="table-row-binding-policy-v1"||!box(raw.tableBoxMilliPoints)||raw.tableBoxMilliPoints[0]<0||raw.tableBoxMilliPoints[1]<0||!nonnegative(raw.maxLineGapMilliPoints)
    ||!Array.isArray(raw.columns)||raw.columns.length<2||raw.columns.length>LIMIT.columns||!Array.isArray(raw.rows)||!raw.rows.length||raw.rows.length>LIMIT.rows)return fail();
  const table=raw.tableBoxMilliPoints,anchors=new Set<string>(),columnKeys=new Set<string>(),valueKeys:string[]=[];
  const key=(v:unknown)=>typeof v==="string"&&!!v&&sourceString(v)&&!v.includes("\n")&&[...v].length<=200&&pyTrim(v)===v;
  function anchorGroup(v:unknown,empty=false):boolean {
    if(!Array.isArray(v)||v.length>(LIMIT.anchors)||(!empty&&!v.length))return false;
    for(const a of v) {
      if(!exact(a,["blockIndex","lineIndex","rawText"])||!nonnegative(a.blockIndex)||!nonnegative(a.lineIndex)
        ||typeof a.rawText!=="string"||!sourceString(a.rawText)||!pyTrim(a.rawText)||a.rawText.includes("\n")||[...a.rawText].length>LIMIT.lineCodepoints)return false;
      const id=ref(a as unknown as Anchor);if(anchors.has(id))return false;anchors.add(id);
    }return true;
  }
  let labels=0,previousRight=table[0];
  for(const col of raw.columns) {
    if(!exact(col,["key","role","xRangeMilliPoints","headerAnchors","unitAnchors"])||!key(col.key)||columnKeys.has(col.key as string)
      ||!["ROW_LABEL","VALUE"].includes(col.role as string)||!range(col.xRangeMilliPoints))return fail();
    const [left,right]=col.xRangeMilliPoints;if(left<previousRight||left<table[0]||right>table[2])return fail();previousRight=right;
    columnKeys.add(col.key as string);
    if(!anchorGroup(col.headerAnchors))return fail();
    if(col.role==="ROW_LABEL") {labels++;if(!Array.isArray(col.unitAnchors)||col.unitAnchors.length)return fail();}
    else {valueKeys.push(col.key as string);if(!anchorGroup(col.unitAnchors))return fail();}
  }
  if(labels!==1||!valueKeys.length)return fail();
  const rowKeys=new Set<string>();let previousBottom=table[3],valueLines=0;
  for(const row of raw.rows) {
    if(!exact(row,["key","yRangeMilliPoints","labelAnchors","valueLineCounts"])||!key(row.key)||rowKeys.has(row.key as string)
      ||!range(row.yRangeMilliPoints)||!exact(row.valueLineCounts,valueKeys)||!anchorGroup(row.labelAnchors))return fail();
    const [bottom,top]=row.yRangeMilliPoints;if(bottom<table[1]||top>previousBottom||top>table[3])return fail();previousBottom=bottom;
    const counts=row.valueLineCounts;
    if(valueKeys.some(k=>!positive(counts[k])||(counts[k] as number)>LIMIT.cellLines))return fail();
    valueLines+=valueKeys.reduce((n,k)=>n+(counts[k] as number),0);
    rowKeys.add(row.key as string);
  }
  if(anchors.size>LIMIT.tableLines||anchors.size+valueLines>LIMIT.tableLines)return fail();
  return raw as unknown as Policy;
}
type PageRead={lines:TableRowFragment[];width:number;height:number}|{reason:TableRowAbstentionReason};
export type TableRowSourcePageRead = {
  schemaVersion:"table-row-source-lines-v1";status:"READY";pageNumber:number;
  widthMilliPoints:number;heightMilliPoints:number;lines:TableRowFragment[];
} | {schemaVersion:"table-row-source-lines-v1";status:"ABSTAIN";reasonCode:TableRowAbstentionReason;lines:[]};
function readPage(raw:unknown):PageRead {
  const portableStatus=portable(raw);if(portableStatus!=="VALID")return {reason:portableStatus==="LIMIT"?"PAGE_LIMIT":"INVALID_PAGE"};
  if(!exact(raw,["pageNumber","widthMilliPoints","heightMilliPoints","blocks","quality"]))return {reason:"INVALID_PAGE"};
  if(!positive(raw.pageNumber)||!positive(raw.widthMilliPoints)||!positive(raw.heightMilliPoints)||!Array.isArray(raw.blocks))return {reason:"INVALID_PAGE"};
  const quality=raw.quality;
  if(!exact(quality,["disposition","metrics","reasonCodes"])||!["TEXT_LAYER_CANDIDATE","OCR_REQUIRED"].includes(quality.disposition as string)
    ||!exact(quality.metrics,["alphanumericCharacterCount","blockCount","disallowedControlCharacterCount","nonWhitespaceCharacterCount","replacementCharacterCount"])
    ||!Object.values(quality.metrics).every(nonnegative)||quality.metrics.blockCount!==raw.blocks.length
    ||!Array.isArray(quality.reasonCodes)||!quality.reasonCodes.every(v=>typeof v==="string"&&sourceString(v)&&!v.includes("\n")))return {reason:"INVALID_PAGE"};
  if(quality.disposition!=="TEXT_LAYER_CANDIDATE")return {reason:"TEXT_LAYER_UNAVAILABLE"};
  if(raw.blocks.length>LIMIT.blocks)return {reason:"PAGE_LIMIT"};
  const frame:Box=[0,0,raw.widthMilliPoints,raw.heightMilliPoints],lines:TableRowFragment[]=[];let points=0,bytes=0;
  for(let bi=0;bi<raw.blocks.length;bi++) {
    const block=raw.blocks[bi];
    if(!record(block)||Object.keys(block).some(k=>!["text","bboxMilliPoints","lineBboxesMilliPoints"].includes(k))||typeof block.text!=="string"||!sourceString(block.text)
      ||!box(block.bboxMilliPoints)||!contains(frame,block.bboxMilliPoints))return {reason:"INVALID_PAGE"};
    if(!Object.hasOwn(block,"lineBboxesMilliPoints"))return {reason:"LINE_GEOMETRY_UNAVAILABLE"};
    const text=block.text.split("\n");points+=[...block.text].length;bytes+=Buffer.byteLength(block.text,"utf8");
    if(points>LIMIT.pageCodepoints||bytes>LIMIT.pageBytes||text.some(s=>[...s].length>LIMIT.lineCodepoints)||lines.length+text.length>LIMIT.lines)return {reason:"PAGE_LIMIT"};
    const boxes=block.lineBboxesMilliPoints;
    if(!Array.isArray(boxes)||boxes.length!==text.length||!boxes.every(b=>box(b)&&contains(frame,b)))return {reason:"INVALID_PAGE"};
    const union:Box=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
    if(union.some((v,i)=>v!==(block.bboxMilliPoints as Box)[i]))return {reason:"LINE_GEOMETRY_INCONSISTENT"};
    for(let li=0;li<text.length;li++)lines.push({pageNumber:raw.pageNumber,blockIndex:bi,lineIndex:li,rawText:text[li],bboxMilliPoints:[...boxes[li]] as Box});
  }
  return {lines,width:raw.widthMilliPoints,height:raw.heightMilliPoints};
}
/** Reuse the exact bounded page validation before consumers discover their own policy. */
export function readTableRowPage(page:unknown):TableRowSourcePageRead {
  const read=readPage(page);
  if("reason" in read)return {schemaVersion:"table-row-source-lines-v1",status:"ABSTAIN",reasonCode:read.reason,lines:[]};
  return {schemaVersion:"table-row-source-lines-v1",status:"READY",pageNumber:(page as {pageNumber:number}).pageNumber,
    widthMilliPoints:read.width,heightMilliPoints:read.height,lines:read.lines};
}
/** X sweep with compressed Y intervals: positive-area overlap in O(n log n). */
function overlapping(lines:TableRowFragment[]):boolean {
  const ys=[...new Set(lines.flatMap(f=>[f.bboxMilliPoints[1],f.bboxMilliPoints[3]]))].sort((a,b)=>a-b);
  const positions=new Map(ys.map((y,i)=>[y,i])),size=ys.length-1;
  if(size<=0)return false;
  const max=new Int32Array(size*4+4),lazy=new Int32Array(size*4+4);
  function change(node:number,left:number,right:number,from:number,to:number,delta:number):void {
    if(from<=left&&right<=to){max[node]+=delta;lazy[node]+=delta;return;}
    const mid=Math.floor((left+right)/2);
    if(from<=mid)change(node*2,left,mid,from,to,delta);
    if(to>mid)change(node*2+1,mid+1,right,from,to,delta);
    max[node]=lazy[node]+Math.max(max[node*2],max[node*2+1]);
  }
  function query(node:number,left:number,right:number,from:number,to:number,inherited=0):number {
    if(from<=left&&right<=to)return inherited+max[node];
    const mid=Math.floor((left+right)/2);let found=0;inherited+=lazy[node];
    if(from<=mid)found=Math.max(found,query(node*2,left,mid,from,to,inherited));
    if(to>mid)found=Math.max(found,query(node*2+1,mid+1,right,from,to,inherited));return found;
  }
  const events=lines.flatMap(f=>{const b=f.bboxMilliPoints,from=positions.get(b[1])!,to=positions.get(b[3])!-1;
    return [{x:b[0],delta:1,from,to},{x:b[2],delta:-1,from,to}];}).sort((a,b)=>a.x-b.x||a.delta-b.delta);
  for(const event of events){if(event.delta===1&&query(1,0,size-1,event.from,event.to)>0)return true;change(1,0,size-1,event.from,event.to,event.delta);}
  return false;
}
function containingBand<T>(items:T[],bounds:(item:T)=>Range,low:number,high:number):number {
  let left=0,right=items.length;
  while(left<right){const mid=Math.floor((left+right)/2);if(bounds(items[mid])[0]<=low)left=mid+1;else right=mid;}
  const index=left-1;return index>=0&&bounds(items[index])[1]>=high?index:-1;
}
export function bindTableRows(page:unknown,rawPolicy:unknown):TableRowBindingResult {
  const policy=validatePolicy(rawPolicy),read=readPage(page);if("reason" in read)return abstain(read.reason);
  if(!contains([0,0,read.width,read.height],policy.tableBoxMilliPoints))return abstain("TABLE_OUTSIDE_PAGE");
  const lines=read.lines.filter(f=>pyTrim(f.rawText)&&intersects(policy.tableBoxMilliPoints,f.bboxMilliPoints));
  if(lines.length>LIMIT.tableLines)return abstain("TABLE_LINE_LIMIT");
  if(lines.some(f=>!contains(policy.tableBoxMilliPoints,f.bboxMilliPoints)))return abstain("TABLE_BOUNDARY_CROSSING");
  if(overlapping(lines))return abstain("OVERLAPPING_LINES");
  const ascendingRows=[...policy.rows].reverse(),cellLines=new Map<string,Map<string,TableRowFragment[]>>();
  for(const row of policy.rows)cellLines.set(row.key,new Map(policy.columns.map(col=>[col.key,[]])));
  for(const line of lines){const b=line.bboxMilliPoints;
    const ci=containingBand(policy.columns,col=>col.xRangeMilliPoints,b[0],b[2]);
    const ri=containingBand(ascendingRows,row=>row.yRangeMilliPoints,b[1],b[3]);
    if(ci>=0&&ri>=0)cellLines.get(ascendingRows[ri].key)!.get(policy.columns[ci].key)!.push(line);
  }
  const lookup=new Map(read.lines.map(f=>[ref(f),f])),used=new Set<string>();
  function resolve(anchors:Anchor[],cell:Box):{fragments:TableRowFragment[]}|{reason:TableRowAbstentionReason} {
    const found:TableRowFragment[]=[];
    for(const a of anchors) {const f=lookup.get(ref(a));if(!f)return {reason:"MISSING_ANCHOR"};if(f.rawText!==a.rawText)return {reason:"ANCHOR_MISMATCH"};
      if(!contains(cell,f.bboxMilliPoints))return {reason:"ANCHOR_OUTSIDE_CELL"};found.push(f);}
    if(found.some((f,i)=>i>0&&cmp(found[i-1],f)>=0))return {reason:"ANCHOR_ORDER"};
    for(const f of found)used.add(ref(f));return {fragments:found};
  }
  const headerBottom=policy.rows[0].yRangeMilliPoints[1],columns:Extract<TableRowBindingResult,{status:"BOUND"}>["columns"]=[];
  for(const col of policy.columns) {
    const area:Box=[col.xRangeMilliPoints[0],headerBottom,col.xRangeMilliPoints[1],policy.tableBoxMilliPoints[3]];
    const headers=resolve(col.headerAnchors,area);if("reason" in headers)return abstain(headers.reason);
    const units=resolve(col.unitAnchors,area);if("reason" in units)return abstain(units.reason);
    columns.push({key:col.key,role:col.role,xRangeMilliPoints:[...col.xRangeMilliPoints],headerFragments:headers.fragments.map(copy),unitFragments:units.fragments.map(copy)});
  }
  const labelCol=policy.columns.find(c=>c.role==="ROW_LABEL")!,resolvedLabels=new Map<string,TableRowFragment[]>();
  for(const row of policy.rows) {
    const area:Box=[labelCol.xRangeMilliPoints[0],row.yRangeMilliPoints[0],labelCol.xRangeMilliPoints[1],row.yRangeMilliPoints[1]];
    const label=resolve(row.labelAnchors,area);if("reason" in label)return abstain(label.reason);resolvedLabels.set(row.key,label.fragments);
  }
  const seenLabels=new Set<string>(),rows:Extract<TableRowBindingResult,{status:"BOUND"}>["rows"]=[];
  for(const row of policy.rows) {
    const labels=resolvedLabels.get(row.key)!,labelSignature=JSON.stringify(labels.map(f=>f.rawText));
    if(seenLabels.has(labelSignature))return abstain("DUPLICATE_ROW_LABEL");seenLabels.add(labelSignature);
    const cells:typeof rows[number]["cells"]=[];
    for(const col of policy.columns) {
      const selected=cellLines.get(row.key)!.get(col.key)!.sort(cmp);
      if(col.role==="ROW_LABEL") {if(selected.length!==labels.length||selected.some((f,i)=>ref(f)!==ref(labels[i])))return abstain("UNEXPECTED_LABEL_CONTENT");}
      else if(selected.length!==row.valueLineCounts[col.key])return abstain("CELL_LINE_COUNT");
      if(new Set(selected.map(f=>f.rawText)).size!==selected.length)return abstain("DUPLICATE_CELL_CONTENT");
      if(col.role==="VALUE"&&selected.some((f,i)=>i>0&&selected[i-1].bboxMilliPoints[1]<f.bboxMilliPoints[3]))return abstain("AMBIGUOUS_CELL_LINES");
      if(selected.some((f,i)=>i>0&&selected[i-1].bboxMilliPoints[1]-f.bboxMilliPoints[3]>policy.maxLineGapMilliPoints))return abstain("MULTILINE_GAP");
      for(const f of selected)used.add(ref(f));cells.push({columnKey:col.key,role:col.role,fragments:selected.map(copy)});
    }
    rows.push({key:row.key,yRangeMilliPoints:[...row.yRangeMilliPoints],cells});
  }
  if(lines.some(f=>!used.has(ref(f))))return abstain("UNASSIGNED_CONTENT");
  return {schemaVersion:"table-row-binding-result-v1",status:"BOUND",tableBoxMilliPoints:[...policy.tableBoxMilliPoints],columns,rows};
}
