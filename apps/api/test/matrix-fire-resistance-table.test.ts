import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {extractFireResistanceCandidates} from "../src/matrix-fire-resistance-table.js";
const fixture=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/table-row-binding-v1/fire-requirements-F0106-p51.json",import.meta.url),"utf8"));
const clone=(v:any):any=>JSON.parse(JSON.stringify(v));
function replace(page:any,blockIndex:number,lineIndex:number,raw:string){const lines=page.blocks[blockIndex].text.split("\n");lines[lineIndex]=raw;page.blocks[blockIndex].text=lines.join("\n");}
describe("independent source-authored fire resistance table",()=>{
  for(const stage of ["PD","RD"])it(`retains the six distinct source categories for ${stage}`,()=>{
    const before=JSON.stringify(fixture.page),actual=extractFireResistanceCandidates(fixture.page,stage);
    expect(actual.map(f=>[f.criterion,f.minutes])).toEqual([["R",120],["REI",120],["REI",150],["REI",120],["REI",120],["REI",60]]);
    for(let i=0;i<6;i++){
      expect(actual[i].primaryFragments).toEqual(fixture.expected.rows[i].cells[1].fragments);
      expect(actual[i].scopeFragments).toEqual(fixture.expected.rows[i].cells[0].fragments);
      expect(actual[i].constructionLabelLines).toEqual(fixture.expected.rows[i].cells[0].fragments.map((f:any)=>f.rawText));
    }
    expect(actual[2].constructionLabelLines).toEqual(["Лифтовые и лестничные шахты"]);
    expect(JSON.stringify(actual)).not.toMatch(/confidence|probability|parameterCode|qualified|approved|entityKey|protectionComposition/u);
    actual[0].primaryFragments[0].bboxMilliPoints[0]++;expect(JSON.stringify(fixture.page)).toBe(before);
  });
  it("discovers by content and geometry instead of page number",()=>{const page=clone(fixture.page);page.pageNumber=7;expect(extractFireResistanceCandidates(page,"PD")).toHaveLength(6);expect(extractFireResistanceCandidates(page,"PD")[0].primaryFragments[0].pageNumber).toBe(7);});
  it("accepts another authentic numeric literal without using expected values as anchors",()=>{const page=clone(fixture.page);replace(page,0,2,"REI 765");const actual=extractFireResistanceCandidates(page,"PD");expect(actual).toHaveLength(6);expect([actual[0].criterion,actual[0].minutes]).toEqual(["REI",765]);});
  for(const raw of ["R 0","R 0120","R -1","R 1.5","R 1e2","R >=120","R 120/150","EI 120","Р 120","R\t120","R 120"," R 120","R 120 ","R 9007199254740992"])it(`abstains for unsupported value grammar ${JSON.stringify(raw)}`,()=>{const page=clone(fixture.page);replace(page,0,2,raw);expect(extractFireResistanceCandidates(page,"PD")).toEqual([]);});
  it("preserves lower damaged cover glyphs without interpreting them",()=>{expect(fixture.page.blocks[13].text).toContain("Þ»");expect(extractFireResistanceCandidates(fixture.page,"PD")).toHaveLength(6);});
  it("abstains for nonliteral unit",()=>{const page=clone(fixture.page);replace(page,0,1,"сек");expect(extractFireResistanceCandidates(page,"PD")).toEqual([]);});
  it("refuses a duplicated matching header anywhere on the complete page",()=>{const page=clone(fixture.page);page.blocks.push(clone(page.blocks[2]));page.quality.metrics.blockCount++;expect(extractFireResistanceCandidates(page,"PD")).toEqual([]);});
  it("rejects hostile page getters before discovery",()=>{const page=clone(fixture.page);let calls=0;Object.defineProperty(page,"blocks",{enumerable:true,get(){calls++;throw Error("called");}});expect(extractFireResistanceCandidates(page,"PD")).toEqual([]);expect(calls).toBe(0);});
  for(const stage of ["ID","UNRESOLVED","pd",null,{},["PD"]])it(`does not infer a permitted stage ${JSON.stringify(stage)}`,()=>{expect(extractFireResistanceCandidates(fixture.page,stage)).toEqual([]);});
});

const portable=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-fire-table-v1/portable-goldens.json",import.meta.url),"utf8"));
function applyOperation(page:any,operation:any):void {
  const union=(block:any)=>{const boxes=block.lineBboxesMilliPoints;block.bboxMilliPoints=[Math.min(...boxes.map((b:any)=>b[0])),Math.min(...boxes.map((b:any)=>b[1])),Math.max(...boxes.map((b:any)=>b[2])),Math.max(...boxes.map((b:any)=>b[3]))];};
  if(operation.op==="set"||operation.op==="delete"){
    const parent=operation.path.slice(0,-1).reduce((value:any,key:any)=>value[key],page),key=operation.path.at(-1);
    if(operation.op==="set")parent[key]=clone(operation.value);else delete parent[key];
  }else if(operation.op==="replace-line")replace(page,operation.blockIndex,operation.lineIndex,operation.rawText);
  else if(operation.op==="append"){page.blocks.push(clone(operation.block));page.quality.metrics.blockCount++;}
  else if(operation.op==="move-line"){const block=page.blocks[operation.blockIndex];block.lineBboxesMilliPoints[operation.lineIndex]=clone(operation.box);union(block);}
  else if(operation.op==="translate")for(const block of page.blocks){for(const box of [block.bboxMilliPoints,...block.lineBboxesMilliPoints])for(let i=0;i<4;i++)box[i]+=i%2===0?operation.x:operation.y;}
  else throw Error(`Unknown golden operation ${operation.op}`);
}
describe("shared independent fire-table oracle",()=>{
  for(const vector of portable.vectors)it(vector.name,()=>{
    const page=clone(portable.page);for(const operation of vector.operations)applyOperation(page,operation);
    const before=JSON.stringify(page),actual=extractFireResistanceCandidates(page,vector.stage);
    expect(actual).toEqual(vector.expected);expect(JSON.stringify(page)).toBe(before);
  });
  it("finds only the original six rows across the complete 139-page canonical artifact",()=>{
    const full=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-fire-table-v1/F0106-full.text.json",import.meta.url),"utf8"));
    expect(full.pages).toHaveLength(139);
    const found=full.pages.flatMap((page:any)=>extractFireResistanceCandidates(page,"PD"));
    expect(found).toEqual(portable.vectors.find((v:any)=>v.name==="original").expected);
  });
  it("returns detached boxes between candidates and successive calls",()=>{
    const first=extractFireResistanceCandidates(portable.page,"PD"),before=clone(first);
    for(const field of ["primaryFragments","scopeFragments","headerFragments","unitFragments"] as const){
      first[0][field][0].bboxMilliPoints[0]++;
      expect(first[1][field]).toEqual(before[1][field]);
    }
    first[0].tableBoxMilliPoints[0]++;
    expect(first[1].tableBoxMilliPoints).toEqual(before[1].tableBoxMilliPoints);
    expect(extractFireResistanceCandidates(portable.page,"PD")).toEqual(before);
  });
});
