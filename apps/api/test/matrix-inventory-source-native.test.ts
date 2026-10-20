import assert from "node:assert/strict";
import fs from "node:fs";
import {it} from "vitest";
import { reconstructAr053InventorySource as reconstruct } from "../src/matrix-inventory-source.js";
const packet=JSON.parse(fs.readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-inventory-v1/portable-goldens.json",import.meta.url),"utf8"));
const base=()=>structuredClone(packet.fixtures[0].input);
it("native descriptors, strict limits, one-column geometry and detached output: 40 probes",()=>{
let passed=0;
function reason(name:string,input:unknown,expected:string) {
  assert.deepEqual(reconstruct(input),{schemaVersion:"matrix-inventory-source-result-v1",status:"ABSTAIN",reasonCode:expected},name);passed++;
}
let calls=0;
const getter=base();Object.defineProperty(getter,"selection",{enumerable:true,get(){calls++;throw Error("getter ran");}});
reason("getter",getter,"INVALID_INPUT");assert.equal(calls,0);
const proxy=new Proxy({}, {getPrototypeOf(){calls++;throw Error("proxy ran");},ownKeys(){calls++;throw Error("proxy ran");}});
reason("proxy",proxy,"INVALID_INPUT");assert.equal(calls,0);
for(const [name,value] of [["map",new Map()],["date",new Date()],["null-prototype",Object.create(null)],["custom-prototype",Object.create({})],["bigint",1n],["symbol",Symbol("x")]] as const)reason(name,value,"INVALID_INPUT");
for(const [name,value] of [["NaN",NaN],["infinity",Infinity],["negative-infinity",-Infinity],["unsafe",Number.MAX_SAFE_INTEGER+1],["fractional",.5]] as const){const input=base();input.selection.regionBoxMilliPoints[0]=value;reason(name,input,"INVALID_INPUT");}
const boolean=base();boolean.selection.regionBoxMilliPoints[0]=true;reason("boolean geometry",boolean,"INVALID_INPUT");
const cycle=base();cycle.extra=cycle;reason("cycle",cycle,"INVALID_INPUT");
const symbol=base();symbol[Symbol("hidden")]=1;reason("symbol property",symbol,"INVALID_INPUT");
const hidden=base();Object.defineProperty(hidden,"extra",{value:1,enumerable:false});reason("hidden property",hidden,"INVALID_INPUT");
const sparse=base();delete sparse.selection.regionBoxMilliPoints[0];reason("sparse array",sparse,"INVALID_INPUT");
const extraArray=base();extraArray.selection.regionBoxMilliPoints.foo=1;reason("extra array property",extraArray,"INVALID_INPUT");
const surrogate=base();surrogate["\ud800"]=1;reason("surrogate key",surrogate,"INVALID_INPUT");
const deep=base();let next:any={};deep.extra=next;for(let i=0;i<65;i++){next.child={};next=next.child;}reason("depth limit",deep,"INPUT_LIMIT");
const items=base();items.extra=Array(32769).fill(null);reason("container limit",items,"INPUT_LIMIT");
const points=base();points.extra="a".repeat(2000001);reason("string codepoint limit",points,"INPUT_LIMIT");
const mixedPoints=base();mixedPoints.extra="\ud800"+"a".repeat(2000000);reason("codepoint limit before surrogate",mixedPoints,"INPUT_LIMIT");
const bytes=base();bytes.extra=["😀".repeat(1000000),"😀".repeat(1000000)];reason("whole tree UTF8 limit",bytes,"INPUT_LIMIT");
const nodes=base();nodes.extra=Array.from({length:32768},()=>[0,1,2,3,4,5]);reason("whole tree node limit",nodes,"INPUT_LIMIT");
const ocr=base();ocr.textArtifact.pages[1].quality.disposition="OCR_REQUIRED";ocr.textArtifact.qualitySummary={textLayerCandidatePageCount:1,ocrRequiredPageCount:1};reason("selected OCR",ocr,"TEXT_LAYER_UNAVAILABLE");
const coarse=base();delete coarse.textArtifact.pages[1].blocks[0].lineBboxesMilliPoints;reason("selected coarse",coarse,"LINE_GEOMETRY_UNAVAILABLE");
const union=base();union.textArtifact.pages[1].blocks[0].bboxMilliPoints[0]--;reason("selected inconsistent union",union,"LINE_GEOMETRY_INCONSISTENT");
const control=base();control.textArtifact.pages[1].blocks[0].text+="\u0001";reason("selected control outside region",control,"INVALID_TEXT_ARTIFACT");
const mixed=base();mixed.pageStages={"1":"ID"};reason("unselected contradictory stage",mixed,"STAGE_UNRESOLVED");
const noncanonicalStage=base();noncanonicalStage.pageStages={"01":"PD"};reason("leading zero page key",noncanonicalStage,"INVALID_INPUT");
const wrongStage=base();wrongStage.stage="pd";reason("stage case",wrongStage,"STAGE_UNRESOLVED");

function manyRows(count:number,raw:string) {
  const input=base(),page=input.textArtifact.pages[1];page.heightMilliPoints=2000000;
  const text=[input.selection.headerFragments[0].rawText,input.selection.scopeFragments[0].rawText,...Array(count).fill(raw)];
  page.blocks=text.map((line:string,index:number)=>{
    const box=[60000,1900000-index*12000,600000,1908000-index*12000];
    return {text:line,bboxMilliPoints:[...box],lineBboxesMilliPoints:[[...box]]};
  });
  page.quality.metrics.blockCount=page.blocks.length;
  const fragment=(index:number)=>({pageNumber:2,blockIndex:index,lineIndex:0,rawText:text[index],bboxMilliPoints:[...page.blocks[index].bboxMilliPoints]});
  input.selection={pageNumber:2,regionBoxMilliPoints:[50000,100000,790000,1950000],headerFragments:[fragment(0)],scopeFragments:[fragment(1)]};
  return input;
}
const sixtyFour=reconstruct(manyRows(64,"Демпферная лента"));assert.equal(sixtyFour.status,"RECONSTRUCTED");
if(sixtyFour.status==="RECONSTRUCTED"){assert.equal(sixtyFour.inventory.featureRows.length,64);assert.equal(sixtyFour.inventory.unresolvedRows.length,63);}passed++;
reason("65 recognized rows",manyRows(65,"Демпферная лента"),"REGION_LINE_LIMIT");
const oneTwentyEight=reconstruct(manyRows(126,"Unknown row"));assert.equal(oneTwentyEight.status,"RECONSTRUCTED");
if(oneTwentyEight.status==="RECONSTRUCTED")assert.equal(oneTwentyEight.inventory.unresolvedRows.length,126);passed++;
reason("129 region lines",manyRows(127,"Unknown row"),"REGION_LINE_LIMIT");
const bands=manyRows(2,"Unknown row");const a=bands.textArtifact.pages[1].blocks[2],b=bands.textArtifact.pages[1].blocks[3];
b.bboxMilliPoints=[610000,a.bboxMilliPoints[1],700000,a.bboxMilliPoints[3]];b.lineBboxesMilliPoints=[[...b.bboxMilliPoints]];
reason("two columns sharing vertical band",bands,"AMBIGUOUS_LAYOUT");
const gap=manyRows(1,"Unknown row");gap.textArtifact.pages[1].blocks[2].bboxMilliPoints[1]-=40000;gap.textArtifact.pages[1].blocks[2].bboxMilliPoints[3]-=40000;gap.textArtifact.pages[1].blocks[2].lineBboxesMilliPoints=[[...gap.textArtifact.pages[1].blocks[2].bboxMilliPoints]];
reason("row gap",gap,"AMBIGUOUS_LAYOUT");
const mutable=base(),before=structuredClone(mutable),result=reconstruct(mutable);assert.deepEqual(mutable,before);assert.equal(result.status,"RECONSTRUCTED");
if(result.status==="RECONSTRUCTED") {
  result.inventory.regionBoxMilliPoints[0]++;result.inventory.headerFragments[0].bboxMilliPoints[0]++;result.inventory.featureRows[0].fragments[0].rawText="changed";
  assert.deepEqual(mutable,before);assert.deepEqual(reconstruct(mutable),packet.fixtures[0].expected);
}passed++;
assert.equal(passed,40);
});
