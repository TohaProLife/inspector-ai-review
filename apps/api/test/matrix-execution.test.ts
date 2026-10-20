import { loadMatrixGoldenFixtures } from "./matrix-golden-fixtures.js";
const goldenFixtures = loadMatrixGoldenFixtures();
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { pythonExecutable, pythonEnv } from "./python.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { buildMatrixSubmission, matrixRegistry, matrixRegistryHash, matrixPresentation,
  validateMatrixExecution } from "../src/matrix-execution.js";

function fixture(texts?: string[]) {
  const sources = ["PD","RD"].map((stage,index)=>({sourceFileId:`source-${index}`,sha256:String(index+1).repeat(64),
    stages:[stage],revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",sectionCode:index?"AR":"PZ"}));
  const artifacts=sources.map((source,index)=>({schemaVersion:"document-text-v2",sourceFileId:source.sourceFileId,
    inputSha256:source.sha256,coordinateSystem:"PDF_BOTTOM_LEFT_MILLI_POINTS",pageCount:1,textPageCount:1,
    qualityPolicyVersion:"text-layer-quality-v2",qualitySummary:{textLayerCandidatePageCount:1,ocrRequiredPageCount:0},
    pages:[{pageNumber:1,widthMilliPoints:600000,heightMilliPoints:800000,
      blocks:[{bboxMilliPoints:[1000,20000,550000,30000],text:texts?.[index]??`Общая площадь здания: ${index?103:100} м²`}],
      quality:{disposition:"TEXT_LAYER_CANDIDATE"}}]}));
  const process=spawnSync(pythonExecutable,["-c",`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.text_layer import qualify_page_text
x=json.load(sys.stdin)
for artifact in x['artifacts']:
    for page in artifact['pages']:
        page['quality']=qualify_page_text([b['text'] for b in page['blocks']])
    artifact['qualitySummary']={'textLayerCandidatePageCount':sum(p['quality']['disposition']=='TEXT_LAYER_CANDIDATE' for p in artifact['pages']),'ocrRequiredPageCount':sum(p['quality']['disposition']=='OCR_REQUIRED' for p in artifact['pages'])}
json.dump(build_matrix_execution(object_id='object',input_manifest_hash='a'*64,sources=x['sources'],text_artifacts=x['artifacts']),sys.stdout,ensure_ascii=False)`],
    {input:JSON.stringify({sources,artifacts}),encoding:"utf8",env:{...globalThis.process.env,...pythonEnv}});
  if(process.status!==0)throw new Error(process.stderr);
  return {execution:JSON.parse(process.stdout),input:{objectId:"object",inputManifestHash:"a".repeat(64),
    sources:sources.map((source,index)=>({...source,review:{revisionStatus:source.revisionStatus,approvalStatus:source.approvalStatus,sectionCode:source.sectionCode},textArtifact:artifacts[index]}))}};
}
describe("matrix immutable execution boundary",()=>{
  it("rejects bounds smuggled into the legacy exact observation or execution shape",()=>{
    const value=fixture();
    expect(validateMatrixExecution(value.execution,value.input)).not.toBeNull();
    for(const relation of ["GE","LE","EQ","UNKNOWN"]){
      const forged=structuredClone(value.execution);forged.observations[0].relation=relation;
      expect(validateMatrixExecution(forged,value.input)).toBeNull();
    }
    for(const field of ["limitValue","constraintId"]){
      const forged=structuredClone(value.execution);forged.observations[0][field]="0.9";
      expect(validateMatrixExecution(forged,value.input)).toBeNull();
    }
    for(const field of ["projectConstraints","constraints"]){
      const forged=structuredClone(value.execution);forged[field]=[];
      expect(validateMatrixExecution(forged,value.input)).toBeNull();
    }
  });
  function tableFixture() {
    const value=goldenFixtures.find(f=>f.name==="pd-concrete-table:previous-header");
    if(!value)throw Error("PD continuation table golden missing");
    return structuredClone(value);
  }
  function rehashFact(value:ReturnType<typeof tableFixture>,fact:typeof value.execution.observations[number]) {
    const previous=fact.id;
    fact.id=sha256(canonicalJson({sourceFileId:fact.sourceFileId,sourceSha256:fact.sourceSha256,stage:fact.stage,
      pageNumber:fact.pageNumber,blockIds:(fact.evidenceFragments as Array<{blockId:string}>).map(f=>f.blockId),
      attribute:fact.attribute,value:fact.value,unit:fact.unit,...(fact.contextFragments?{contextFragments:fact.contextFragments}:{})}));
    for(const result of value.execution.results)for(const key of ["expectedObservationId","actualObservationId"] as const)
      if(result[key]===previous)result[key]=fact.id;
  }
  it("binds PD continuation-table facts to both original pages without qualifying table scope",()=>{
    const value=tableFixture(),result=validateMatrixExecution(value.execution,value.input);
    expect(result).not.toBeNull();
    const facts=result!.observations.filter(f=>f.contextFragments?.length);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some(f=>f.contextFragments!.some(c=>c.pageNumber===f.pageNumber-1))).toBe(true);
    expect(facts.every(f=>(f.sourceFlags as string[]).includes("TABLE_CONTEXT_UNVERIFIED"))).toBe(true);
    expect(result!.results.filter(r=>r.parameterCode==="KR-055").every(r=>!r.qualified)).toBe(true);
  });
  it("rejects modified context text, page, role or geometry even with fresh observation hashes",()=>{
    for(const mutate of [
      (f:any)=>{f.contextFragments[0].rawText="Придуманный заголовок";},
      (f:any)=>{f.contextFragments[0].pageNumber=f.pageNumber;},
      (f:any)=>{f.contextFragments[0].bbox.x+=.001;},
      (f:any)=>{f.contextFragments[0].role="TABLE_SCOPE";},
      (f:any)=>{f.contextFragments[0].extra="not allowed";},
    ]) {
      const value=tableFixture(),fact=value.execution.observations.find(f=>f.contextFragments?.length)!;
      mutate(fact);rehashFact(value,fact);expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
    }
  });
  it("rejects removing the table limitation, including removing the context and rehashing",()=>{
    for(const removeContext of [false,true]) {
      const value=tableFixture(),fact=value.execution.observations.find(f=>f.contextFragments?.length)!;
      fact.sourceFlags=(fact.sourceFlags as string[]).filter(f=>f!=="TABLE_CONTEXT_UNVERIFIED");
      if(removeContext)delete fact.contextFragments;
      rehashFact(value,fact);expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
    }
  });
  it("independently rejects competing original headers and extra aligned table columns",()=>{
    for(const duplicateHeader of [true,false]) {
      const value=tableFixture(),fact=value.execution.observations.find(f=>f.contextFragments?.length)!;
      const source=value.input.sources.find(s=>s.sourceFileId===fact.sourceFileId)!;
      const pages=source.textArtifact!.pages as Array<{pageNumber:number;blocks:Array<any>}>;
      if(duplicateHeader) {
        const context=fact.contextFragments![0],page=pages.find(p=>p.pageNumber===context.pageNumber)!;
        page.blocks.push(structuredClone(page.blocks[Number(context.blockId.split(":")[0])]));
      } else {
        const page=pages.find(p=>p.pageNumber===fact.pageNumber)!,[bi,li]=fact.blockId.split(":").map(Number);
        const b=page.blocks[bi].lineBboxesMilliPoints[li];
        page.blocks.push({text:"Дополнительная колонка",bboxMilliPoints:[350000,b[1],400000,b[3]]});
      }
      expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
    }
  });
  it("extracts only the named slab thickness from a compound slab and capital statement",()=>{
    const value=fixture(["Толщина плиты перекрытия: 250 мм",
      "Толщина ж/б плиты перекрытия подземного этажа - 250мм, ж/б капители толщиной - 500мм."]);
    const result=validateMatrixExecution(value.execution,value.input);
    expect(result).not.toBeNull();
    const facts=result!.observations.filter(f=>f.attribute==="SLAB_THICKNESS"&&f.stage==="RD");
    expect(facts).toHaveLength(1);expect(facts[0].value).toBe("250");expect(facts[0].rawText).toContain("500мм");
  });
  it("binds the slab table to its thickness header and underground scope",()=>{
    const value=structuredClone(goldenFixtures.find(f=>f.name==="pd-slab-table:companion-rows")!);
    const result=validateMatrixExecution(value.execution,value.input);
    expect(result).not.toBeNull();
    const fact=result!.observations.find(f=>f.stage==="PD"&&f.attribute==="SLAB_THICKNESS")!;
    expect(fact.value).toBe("250");expect(fact.contextFragments?.map(c=>c.role)).toEqual(["ATTRIBUTE_HEADER","TABLE_SCOPE"]);
    expect(fact.sourceFlags).toContain("TABLE_CONTEXT_UNVERIFIED");
    expect(result!.results.filter(r=>r.parameterCode==="KR-059").every(r=>!r.qualified)).toBe(true);
  });
  it("rejects forged slab scope, duplicate rows and extra aligned values",()=>{
    for(const mode of ["scope","duplicate-row","extra-value","remove-context"]) {
      const value=structuredClone(goldenFixtures.find(f=>f.name==="pd-slab-table:single-row")!);
      const fact=value.execution.observations.find(f=>f.stage==="PD"&&f.attribute==="SLAB_THICKNESS")!;
      const artifact=value.input.sources.find(s=>s.sourceFileId===fact.sourceFileId)!.textArtifact!;
      const page=(artifact.pages as Array<any>)[0];
      if(mode==="scope") { fact.contextFragments![1].rawText="Надземная часть";rehashFact(value,fact); }
      if(mode==="remove-context") { delete fact.contextFragments;fact.sourceFlags=(fact.sourceFlags as string[]).filter(f=>f!=="TABLE_CONTEXT_UNVERIFIED");rehashFact(value,fact); }
      if(mode==="duplicate-row") page.blocks.push({text:"- Перекрытия -3 и -4 этажей",bboxMilliPoints:[117120,630000,271919,642000]});
      if(mode==="extra-value") page.blocks.push({text:"- 500мм",bboxMilliPoints:[450000,662208,480000,674208]});
      expect(validateMatrixExecution(value.execution,value.input),mode).toBeNull();
    }
  });
  it("keeps the capital value independent and abstains on ambiguous compound thickness statements",()=>{
    for(const capital of ["500","800"]) {
      const value=fixture(["Нет значения ПД",`Толщина ж/б плиты перекрытия подземного этажа - 25см, ж/б капители толщиной - ${capital}мм.`]);
      expect(value.execution.observations.filter((f:any)=>f.stage==="RD").map((f:any)=>f.value)).toEqual(["250"]);
      expect(validateMatrixExecution(value.execution,value.input)).not.toBeNull();
    }
    for(const text of ["Толщина ж/б плиты перекрытия подземного этажа - 250 или 300мм, ж/б капители толщиной - 500мм.",
      "Толщина ж/б плиты перекрытия подземного этажа - 250мм, ж/б капители толщиной - 500мм. Неизвестное дополнение",
      "Толщина ж/б капители подземного этажа - 500мм, ж/б плиты перекрытия толщиной - 250мм."]){
      const value=fixture(["Нет значения ПД",text]);expect(value.execution.observations).toHaveLength(0);
      expect(validateMatrixExecution(value.execution,value.input)).not.toBeNull();
    }
  });
  it("validates all Python atomic and source-bound golden observations",()=>{
    for(const f of goldenFixtures) expect(validateMatrixExecution(f.execution,f.input),f.name).not.toBeNull();
  },30000);
  it("pins all132 entries and matches Python registry hashing",()=>{
    expect(matrixRegistry.entries).toHaveLength(132);
    const value=fixture(); expect(value.execution.registryHash).toBe(matrixRegistryHash);
  });
  it("rejects generic count aliases outside the explicit equipment subrule grammar",()=>{
    const original=goldenFixtures.find(f=>f.name==="atomic:matrix-ios4-077-radiator_section_count")!;
    const value=structuredClone(original);
    const fact=value.execution.observations.find(f=>f.stage==="PD"&&f.attribute==="RADIATOR_SECTION_COUNT")!;
    const source=value.input.sources.find(s=>s.sourceFileId===fact.sourceFileId)!;
    const old=String(fact.rawUnit);
    fact.rawUnit="ед.";fact.rawText=fact.rawText.replace(old,"ед.");
    for(const fragment of fact.evidenceFragments as Array<{rawText:string}>)fragment.rawText=fragment.rawText.replace(old,"ед.");
    const pages=source.textArtifact!.pages as Array<{blocks:Array<{text:string}>}>;
    for(const block of pages[0].blocks)block.text=block.text.replace(old,"ед.");
    expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
  });
  it("retains unknown-source observations without inventing comparisons or probabilities",()=>{
    const value=fixture(); const result=validateMatrixExecution(value.execution,value.input);
    expect(result).not.toBeNull();expect(result!.observations).toHaveLength(2);
    expect(result!.coverage).toHaveLength(132);
    expect(result!.coverage.reduce((n,c)=>n+c.successfulComparisons,0)).toBe(0);
    expect(matrixPresentation(result!).every(p=>p.machineDisposition==="CANDIDATE"
      && p.confidence.calibratedProbability===null)).toBe(true);
    expect(buildMatrixSubmission(result!,"object").checks.every(r=>r.violation_label==="COMPARISON_IMPOSSIBLE")).toBe(true);
  });
  it("rejects foreign sources, changed text, wrong stage, injected qualification and unknown rules",()=>{
    for(const mutate of [
      (x:any)=>{x.observations[0].sourceFileId="foreign";},
      (x:any)=>{x.observations[0].evidenceFragments[0].rawText="forged";},
      (x:any)=>{x.observations[0].stage="ID";},
      (x:any)=>{x.results[0].qualified=true;},
      (x:any)=>{x.results[0].ruleId="foreign-rule";},
      (x:any)=>{x.metadata[0].approvalStatus="APPROVED";},
      (x:any)=>{x.metadata[0].pageCount=999;},
    ]) {const value=fixture();mutate(value.execution);expect(validateMatrixExecution(value.execution,value.input)).toBeNull();}
  });
  it("independently binds the exact RD concrete-strength sentence with separate F/W grades",()=>{
    const value=fixture(["Класс бетона: В40","Класс бетона по прочности на сжатие В40, марка по морозостойкости F150, марка по водонепроницаемости W8."]);
    const result=validateMatrixExecution(value.execution,value.input);
    expect(result).not.toBeNull();
    expect(result!.observations.filter(o=>o.attribute==="CONCRETE_CLASS"&&o.stage==="RD")).toHaveLength(1);
    expect(result!.observations.find(o=>o.stage==="RD")?.value).toBe("В40");
    expect(result!.coverage.reduce((n,c)=>n+c.successfulComparisons,0)).toBe(0);
  });
  it("abstains on concrete-surface classes and alternative concrete grades",()=>{
    for(const text of ["Класс бетонных поверхностей А6", "Класс бетона по прочности на сжатие В40 или В60", "Класс бетона по прочности на сжатие В40, неизвестная марка F150"]){
      const value=fixture(["Нет исходного значения",text]);
      expect(value.execution.observations).toHaveLength(0);
      expect(validateMatrixExecution(value.execution,value.input)).not.toBeNull();
    }
  });
});
