import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindTableRows, readTableRowPage, TableRowBindingPolicyError } from "../src/table-row-binding.js";
const base = "../../../services/worker/tests/fixtures/table-row-binding-v1/";
const fixtures = ["fire-requirements-F0106-p51", "ground-areas-F0126-p20"].map(name=>({name,...JSON.parse(readFileSync(new URL(base+name+".json",import.meta.url),"utf8"))}));
const goldens = JSON.parse(readFileSync(new URL(base+"portable-goldens.json",import.meta.url),"utf8"));
const clone = (v:any):any=>JSON.parse(JSON.stringify(v));
const fire = ()=>clone(fixtures[0]);
const failure = (reasonCode:string)=>({schemaVersion:"table-row-binding-result-v1",status:"ABSTAIN",reasonCode,rows:[]});
function append(page:any,text:string,box:number[]) {
  page.blocks.push({text,bboxMilliPoints:[...box],lineBboxesMilliPoints:[[...box]]});page.quality.metrics.blockCount=page.blocks.length;
}
function replaceLine(page:any,block:number,line:number,raw:string) {const parts=page.blocks[block].text.split("\n");parts[line]=raw;page.blocks[block].text=parts.join("\n");}
describe("independent mechanical table row binding",()=>{
  for(const fixture of fixtures)it(`public source reader preserves every original line: ${fixture.name}`,()=>{
    const before=JSON.stringify(fixture.page),actual=readTableRowPage(fixture.page);
    expect(actual.status).toBe("READY");
    if(actual.status==="READY"){
      expect(actual.lines).toEqual(fixture.page.blocks.flatMap((block:any,blockIndex:number)=>block.text.split("\n").map((rawText:string,lineIndex:number)=>({
        pageNumber:fixture.page.pageNumber,blockIndex,lineIndex,rawText,bboxMilliPoints:block.lineBboxesMilliPoints[lineIndex]}))));
      actual.lines[0].bboxMilliPoints[0]++;
    }
    expect(JSON.stringify(fixture.page)).toBe(before);
  });
  it("public source reader rejects getters before source discovery",()=>{
    const f=fire();let calls=0;Object.defineProperty(f.page,"blocks",{enumerable:true,get(){calls++;throw Error("called");}});
    expect(readTableRowPage(f.page)).toEqual({schemaVersion:"table-row-source-lines-v1",status:"ABSTAIN",reasonCode:"INVALID_PAGE",lines:[]});expect(calls).toBe(0);
  });
  it("public source reader never returns partial lines on later geometry failure",()=>{
    const f=fire();delete f.page.blocks.at(-1).lineBboxesMilliPoints;
    expect(readTableRowPage(f.page)).toEqual({schemaVersion:"table-row-source-lines-v1",status:"ABSTAIN",reasonCode:"LINE_GEOMETRY_UNAVAILABLE",lines:[]});
  });
  for(const vector of goldens.vectors)it(`shared portable contract: ${vector.name}`,()=>{
    const input:any={page:clone(goldens.page),policy:clone(goldens.policy)};
    for(const operation of vector.operations){
      let parent=input[operation.target];
      for(const key of operation.path.slice(0,-1))parent=parent[key];
      const key=operation.path.at(-1);
      if(operation.op==="set")parent[key]=clone(operation.value);
      else if(operation.op==="delete")delete parent[key];
      else if(operation.op==="append")parent[key].push(clone(operation.value));
      else throw Error(`unknown fixture operation: ${operation.op}`);
    }
    const before=JSON.stringify(input);
    if(vector.expected.throws)expect(()=>bindTableRows(input.page,input.policy)).toThrow(TableRowBindingPolicyError);
    else expect(bindTableRows(input.page,input.policy)).toEqual(vector.expected);
    expect(JSON.stringify(input)).toBe(before);
  });
  for(const fixture of fixtures)it(`exact original fragments: ${fixture.name}`,()=>{
    const before=JSON.stringify(fixture),actual=bindTableRows(fixture.page,fixture.policy);
    expect(actual).toEqual(fixture.expected);expect(JSON.stringify(fixture)).toBe(before);
    expect(bindTableRows(fixture.page,fixture.policy)).toEqual(actual);
    if(actual.status==="BOUND")actual.rows[0].cells[0].fragments[0].bboxMilliPoints[0]++;
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it("retains distinct source labels, R versus REI and repeated values across rows",()=>{
    const f=fire(),r=bindTableRows(f.page,f.policy);expect(r.status).toBe("BOUND");
    if(r.status!=="BOUND")throw Error("fixture did not bind");
    expect(r.rows.map(row=>row.cells[1].fragments.map(p=>p.rawText))).toEqual([["R 120"],["REI 120"],["REI 150"],["REI 120"],["REI 120"],["REI 60"]]);
    expect(JSON.stringify(r)).not.toMatch(/confidence|probability|entityKey|parameterCode|approved|coverage/u);
  });
  it("requires exact source anchor text",()=>{const f=fire();f.policy.columns[1].unitAnchors[0].rawText="сек";expect(bindTableRows(f.page,f.policy)).toEqual(failure("ANCHOR_MISMATCH"));});
  it("does not pretend to interpret unit semantics",()=>{
    const f=fire();replaceLine(f.page,0,1,"сек");f.policy.columns[1].unitAnchors[0].rawText="сек";
    const r=bindTableRows(f.page,f.policy);expect(r.status).toBe("BOUND");
    if(r.status==="BOUND")expect(r.columns[1].unitFragments[0].rawText).toBe("сек");
  });
  it("rejects source lines crossing the selected table boundary",()=>{const f=fire();append(f.page,"extra",[549000,690000,551000,691000]);expect(bindTableRows(f.page,f.policy)).toEqual(failure("TABLE_BOUNDARY_CROSSING"));});
  it("ignores border-only contact outside the explicit table scope",()=>{const f=fire();append(f.page,"outside",[550000,690000,551000,691000]);expect(bindTableRows(f.page,f.policy)).toEqual(f.expected);});
  it("rejects a competing line in an unassigned gutter",()=>{const f=fire();append(f.page,"extra",[411000,690000,419000,691000]);expect(bindTableRows(f.page,f.policy)).toEqual(failure("UNASSIGNED_CONTENT"));});
  it("rejects coincident lines instead of choosing a convenient one",()=>{const f=fire();append(f.page,"duplicate",[465120,757728,494159,769728]);expect(bindTableRows(f.page,f.policy)).toEqual(failure("OVERLAPPING_LINES"));});
  it("rejects a duplicate whole row label",()=>{
    const f=fire(),text=f.policy.rows[0].labelAnchors[0].rawText;replaceLine(f.page,4,3,text);f.policy.rows[2].labelAnchors[0].rawText=text;
    expect(bindTableRows(f.page,f.policy)).toEqual(failure("DUPLICATE_ROW_LABEL"));
  });
  it("cannot borrow a value from the neighboring column",()=>{
    const f=fire();f.policy.columns[1].xRangeMilliPoints=[420000,450000];expect(bindTableRows(f.page,f.policy)).toEqual(failure("ANCHOR_OUTSIDE_CELL"));
  });
  it("requires declared multiline source order",()=>{const f=fire();f.policy.rows[1].labelAnchors.reverse();expect(bindTableRows(f.page,f.policy)).toEqual(failure("ANCHOR_ORDER"));});
  it("refuses malformed source geometry with no partial rows",()=>{const f=fire();delete f.page.blocks[0].lineBboxesMilliPoints;expect(bindTableRows(f.page,f.policy)).toEqual(failure("LINE_GEOMETRY_UNAVAILABLE"));});
  it("refuses a block box inconsistent with its original line union",()=>{const f=fire();f.page.blocks[0].bboxMilliPoints[0]--;expect(bindTableRows(f.page,f.policy)).toEqual(failure("LINE_GEOMETRY_INCONSISTENT"));});
  it("keeps unusable text separate from invalid input",()=>{const f=fire();f.page.quality.disposition="OCR_REQUIRED";expect(bindTableRows(f.page,f.policy)).toEqual(failure("TEXT_LAYER_UNAVAILABLE"));});
  it("rejects invalid policy before inspecting an invalid page",()=>{const f=fire();f.policy.rows[0].valueLineCounts.values=0;expect(()=>bindTableRows(null,f.policy)).toThrow(TableRowBindingPolicyError);});
  it("disallows one source anchor owning two roles",()=>{const f=fire();f.policy.columns[1].unitAnchors=clone(f.policy.columns[1].headerAnchors);expect(()=>bindTableRows(f.page,f.policy)).toThrow(TableRowBindingPolicyError);});
  it("accepts opaque Unicode keys without changing fragments",()=>{
    const f=fire();f.policy.columns[1].key="значение_β";for(const row of f.policy.rows){row.valueLineCounts={значение_β:1};}
    const r=bindTableRows(f.page,f.policy);expect(r.status).toBe("BOUND");if(r.status==="BOUND")expect(r.rows[0].cells[1].columnKey).toBe("значение_β");
  });
  it("preserves nonblank C1 source text including NEL",()=>{
    const f=fire();replaceLine(f.page,0,2,"raw\u0085\u007f\u009fvalue");
    const r=bindTableRows(f.page,f.policy);expect(r.status).toBe("BOUND");
    if(r.status==="BOUND")expect(r.rows[0].cells[1].fragments[0].rawText).toBe("raw\u0085\u007f\u009fvalue");
  });
  for(const key of ["bad\u0001key","bad\nkey","bad\u2028key","bad\ufffdkey"])it(`rejects malformed opaque policy key ${JSON.stringify(key)}`,()=>{
    const f=fire();f.policy.rows[0].key=key;expect(()=>bindTableRows(f.page,f.policy)).toThrow(TableRowBindingPolicyError);
  });
  it("rejects negative policy table origin",()=>{const f=fire();f.policy.tableBoxMilliPoints[0]=-1;expect(()=>bindTableRows(f.page,f.policy)).toThrow(TableRowBindingPolicyError);});
  it("rejects multiline quality reason codes",()=>{const f=fire();f.page.quality.reasonCodes=["bad\ncode"];expect(bindTableRows(f.page,f.policy)).toEqual(failure("INVALID_PAGE"));});
  it("validates full quality block count before OCR disposition",()=>{const f=fire();f.page.quality.metrics.blockCount++;f.page.quality.disposition="OCR_REQUIRED";expect(bindTableRows(f.page,f.policy)).toEqual(failure("INVALID_PAGE"));});
  it("reports unavailable geometry before per-line text budget",()=>{const f=fire();delete f.page.blocks[0].lineBboxesMilliPoints;f.page.blocks[0].text="x".repeat(8193);expect(bindTableRows(f.page,f.policy)).toEqual(failure("LINE_GEOMETRY_UNAVAILABLE"));});
  it("resolves every declared label before inspecting row cell counts",()=>{
    const f=fire();append(f.page,"extra",[500000,756000,510000,757000]);f.policy.rows[1].labelAnchors[0].rawText="wrong";
    expect(bindTableRows(f.page,f.policy)).toEqual(failure("ANCHOR_MISMATCH"));
  });
  it("counts dictionary keys within the portable node budget",()=>{
    const f=fire();f.page.extra=Array.from({length:30},()=>Object.fromEntries(Array.from({length:4000},(_,i)=>[`k${i}`,null])));
    expect(bindTableRows(f.page,f.policy)).toEqual(failure("PAGE_LIMIT"));
  });
  for(const kind of ["container","depth","nodes","bytes","blocks","line"] as const)it(`returns typed resource abstention: ${kind}`,()=>{
    const f=fire();
    if(kind==="container")f.page.extra=new Array(32769).fill(null);
    if(kind==="depth"){let nested:any=null;for(let i=0;i<66;i++)nested=[nested];f.page.extra=nested;}
    if(kind==="nodes")f.page.extra=Array.from({length:2100},()=>new Array(100).fill(null));
    if(kind==="bytes")f.page.extra="x".repeat(8_000_001);
    if(kind==="blocks"){f.page.blocks=Array.from({length:8193},()=>({text:"x",bboxMilliPoints:[1,1,2,2],lineBboxesMilliPoints:[[1,1,2,2]]}));f.page.quality.metrics.blockCount=8193;}
    if(kind==="line")f.page.blocks[0].text="x".repeat(8193);
    expect(bindTableRows(f.page,f.policy)).toEqual(failure("PAGE_LIMIT"));
  });
  it("binds the full512-row inventory with exact row ownership",()=>{
    const page:any=clone(goldens.page);page.heightMilliPoints=20000;page.blocks=[];
    append(page,"Label",[10,19900,100,19920]);append(page,"Amount",[400,19900,500,19920]);append(page,"u",[400,19850,450,19870]);
    const policy:any={schemaVersion:"table-row-binding-policy-v1",tableBoxMilliPoints:[0,0,600,20000],maxLineGapMilliPoints:0,
      columns:[{key:"labels",role:"ROW_LABEL",xRangeMilliPoints:[0,300],headerAnchors:[{blockIndex:0,lineIndex:0,rawText:"Label"}],unitAnchors:[]},
        {key:"values",role:"VALUE",xRangeMilliPoints:[350,600],headerAnchors:[{blockIndex:1,lineIndex:0,rawText:"Amount"}],unitAnchors:[{blockIndex:2,lineIndex:0,rawText:"u"}]}],rows:[]};
    for(let i=0;i<512;i++){const bottom=100+i*30;append(page,`row-${i}`,[10,bottom+2,100,bottom+20]);append(page,String(i%10),[400,bottom+2,450,bottom+20]);
      policy.rows.unshift({key:`r${i}`,yRangeMilliPoints:[bottom,bottom+25],labelAnchors:[{blockIndex:3+i*2,lineIndex:0,rawText:`row-${i}`}],valueLineCounts:{values:1}});}
    const r=bindTableRows(page,policy);expect(r.status).toBe("BOUND");
    if(r.status==="BOUND"){expect(r.rows).toHaveLength(512);for(let i=0;i<512;i++){
      const index=511-i;expect(r.rows[i].cells.map(c=>c.fragments.map(f=>[f.blockIndex,f.lineIndex,f.rawText]))).toEqual([[[3+index*2,0,`row-${index}`]],[[4+index*2,0,String(index%10)]]]);
    }}
  });
  for(const where of ["page","policy"] as const)it(`never invokes native ${where} getters`,()=>{
    const f=fire();let calls=0;Object.defineProperty(f[where],where==="page"?"blocks":"columns",{enumerable:true,get(){calls++;throw Error("getter executed");}});
    if(where==="page")expect(bindTableRows(f.page,f.policy)).toEqual(failure("INVALID_PAGE"));else expect(()=>bindTableRows(f.page,f.policy)).toThrow(TableRowBindingPolicyError);
    expect(calls).toBe(0);
  });
  for(const kind of ["sparse","extra","symbol","prototype","cycle","surrogate","fractional","unsafe"] as const)it(`rejects native source ${kind}`,()=>{
    const f=fire();
    if(kind==="sparse")delete f.page.blocks[0];
    if(kind==="extra")f.page.blocks.extra=true;
    if(kind==="symbol")f.page[Symbol("hidden")]=1;
    if(kind==="prototype")Object.setPrototypeOf(f.page,{custom:true});
    if(kind==="cycle")f.page.blocks.push(f.page);
    if(kind==="surrogate")f.page.blocks[0].text="\ud800";
    if(kind==="fractional")f.page.widthMilliPoints=.5;
    if(kind==="unsafe")f.page.widthMilliPoints=Number.MAX_SAFE_INTEGER+1;
    expect(bindTableRows(f.page,f.policy)).toEqual(failure("INVALID_PAGE"));
  });
});
