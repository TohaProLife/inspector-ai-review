import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { matrixConfigHash, matrixDefinitions, matrixLegacyDefinitions, matrixPresentation, matrixRegistry,
  validateMatrixExecution } from "../src/matrix-execution.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { computeMatrixCoverage, verifyMatrixAtomicResults } from "../src/matrix-rule-verifier.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const ruleId="matrix-kr-057-catalog_a500c_to_a400", attribute="WORKING_REINFORCEMENT_CLASS";
const authorityKey="REINFORCEMENT_APPLICATION_SCOPE", atomicKey=`ATOMIC_SUBRULE_SCOPE:${ruleId}`;
type Fixture={execution:any;input:any};
const cache=new Map<string,Fixture>();
function fixture(mode="reviewed",actual="А400",expected="А500C"):Fixture {
  const key=mode+actual+expected;
  if(!cache.has(key)) {
    const child=spawnSync(pythonExecutable,["-c",`import json,sys
sys.path.insert(0,'../../services/worker/tests')
from test_matrix_rebar import fixture_args,reviewed_args
from inspector_worker.matrix_engine import build_matrix_execution
x=json.load(sys.stdin)
a=reviewed_args(actual=x['actual'],expected=x['expected']) if x['mode'] in ['reviewed','legacy'] else fixture_args(full=x['mode']=='public',actual=x['actual'],expected=x['expected'])
if x['mode']=='legacy':
 for source in a['sources']:
  b=source['scopeProofs']['FACT_BINDINGS']['bindings'][0]
  source['scopeProofs']={k:dict(v,status='VERIFIED',sourceFileId=source['sourceFileId'],sourceSha256=source['sha256'],objectId=a['object_id'],inputManifestHash=a['input_manifest_hash'],entityKey=b['entityKey']) for k,v in dict(b['contexts'],ENTITY_SCOPE={'reference':b['reference']}).items()}
e=build_matrix_execution(**a)
s=[dict(source,textArtifact=artifact,review={k:v for k,v in source.items() if k in ['revisionStatus','approvalStatus','sectionCode','pageStages','linkGroupId','scopeProofs']}) for source,artifact in zip(a['sources'],a['text_artifacts'])]
json.dump({'execution':e,'input':{'objectId':a['object_id'],'inputManifestHash':a['input_manifest_hash'],'sources':s}},sys.stdout,ensure_ascii=False)`],
      {input:JSON.stringify({mode,actual,expected}),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:30000,maxBuffer:16*1024*1024});
    if(child.status!==0)throw Error(child.stderr);
    cache.set(key,JSON.parse(child.stdout));
  }
  const result=structuredClone(cache.get(key)!);
  for(const source of result.input.sources)if(source.scopeProofs)source.review.scopeProofs=source.scopeProofs;
  return result;
}
function contexts(value:Fixture,index:number):any{return value.input.sources[index].scopeProofs.FACT_BINDINGS.bindings[0].contexts;}
function rehash(value:Fixture,index=1){
  const fact=value.execution.observations.find((f:any)=>f.attribute===attribute&&f.sourceFileId===value.input.sources[index].sourceFileId);
  const previous=fact.id;
  fact.id=sha256(canonicalJson({sourceFileId:fact.sourceFileId,sourceSha256:fact.sourceSha256,stage:fact.stage,pageNumber:fact.pageNumber,
    blockIds:fact.evidenceFragments.map((f:any)=>f.blockId),attribute:fact.attribute,value:fact.value,unit:fact.unit,
    ...(fact.contextFragments?{contextFragments:fact.contextFragments}:{})}));
  for(const result of value.execution.results)for(const key of ["expectedObservationId","actualObservationId"])if(result[key]===previous)result[key]=fact.id;
}
function zeroRow(value:Fixture){return value.execution.results.find((r:any)=>r.ruleId===ruleId);}
const required=["APPROVED_CHANGE_STATUS",authorityKey,atomicKey];

describe("rebar independent categorical source and application boundary",()=>{
  beforeAll(()=>{fixture();fixture("public");fixture("unreviewed");},60_000);
  it("preserves full161 pages, original glyphs, all scope fragments and public abstention",()=>{
    const v=fixture("public"),before=canonicalJson(v),checked=validateMatrixExecution(v.execution,v.input);
    expect(checked).not.toBeNull();expect(v.input.sources.map((s:any)=>s.textArtifact.pageCount)).toEqual([139,22]);
    const facts=checked!.observations.filter(f=>f.attribute===attribute);
    expect(facts.map(f=>[f.stage,f.pageNumber,f.value,f.rawValue,f.rawUnit,f.unit,f.entityKey])).toEqual([
      ["PD",50,"А500С","А500C",null,"rebar_catalog_example",null],["RD",4,"А500С","А500С",null,"rebar_catalog_example",null]]);
    expect(facts.map(f=>(f.evidenceFragments as unknown[]).length)).toEqual([2,1]);
    expect(facts.map(f=>f.contextFragments!.map(p=>[p.blockId,p.role]))).toEqual([
      [["0:0","MATERIAL_SCOPE"],["3:0","MATERIAL_SCOPE"]],[["1:3","MATERIAL_SCOPE"],["44:0","MATERIAL_SCOPE"],["32:11","MATERIAL_SCOPE"]]]);
    expect(facts.every(f=>!(f.sourceFlags as string[]).includes("TABLE_CONTEXT_UNVERIFIED"))).toBe(true);
    expect(checked!.results.filter(r=>r.parameterCode==="KR-057").every(r=>!r.qualified)).toBe(true);
    expect(canonicalJson(v)).toBe(before);
  });
  it.each([["А500C","А400","CANDIDATE","CATALOG_TRIGGER_MATCHED",true],["А500C","А500С","CLARIFICATION_REQUIRED","NEGATIVE_SCOPE_UNVERIFIED",false],
    ["А400","А500С","NOT_COMPARABLE","UNSUPPORTED_CATEGORY_TRANSITION",false],["А400","А400","CLARIFICATION_REQUIRED","NEGATIVE_SCOPE_UNVERIFIED",false]])
    ("directed example %s → %s never produces ordinal delta",(expected,actual,status,reason,qualified)=>{
      const v=fixture("reviewed",actual as string,expected as string),checked=validateMatrixExecution(v.execution,v.input);
      expect(checked).not.toBeNull();expect(zeroRow(v)).toMatchObject({machineStatus:status,reasonCode:reason,qualified,delta:null});
      expect(checked!.coverage.find(c=>c.parameterCode==="KR-057")!.executionStatus).toBe("PARTIAL");
      expect(matrixPresentation(checked!).every(p=>p.confidence.calibratedProbability===null)).toBe(true);
    });
  for(const index of [0,1])for(const key of required)it(`rejects missing authenticated application proof ${index}:${key}`,()=>{
    const v=fixture();delete contexts(v,index)[key];expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
  });
  for(const index of [0,1])for(const field of ["componentRole","componentKey","zoneKey","operatingModeKey","measurementBasisKey"])
    it(`rejects other working member, assembly role or numeric basis ${index}:${field}`,()=>{
      const v=fixture();contexts(v,index)[atomicKey][field]="another-unconfirmed-member";expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
    });
  it("whole-file scope cannot substitute material position bindings",()=>{
    const v=fixture();for(const s of v.input.sources){const b=s.scopeProofs.FACT_BINDINGS.bindings[0];
      s.review.scopeProofs=s.scopeProofs=Object.fromEntries(Object.entries({...b.contexts,ENTITY_SCOPE:{reference:b.reference}}).map(([key,detail])=>[key,
        {...detail as any,status:"VERIFIED",sourceFileId:s.sourceFileId,sourceSha256:s.sha256,objectId:v.input.objectId,inputManifestHash:v.input.inputManifestHash,entityKey:b.entityKey}]));}
    expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
  });
  it("accepts authentic legacy whole-file UNKNOWN while refusing qualification from those proofs",()=>{
    const v=fixture("legacy");expect(validateMatrixExecution(v.execution,v.input)).not.toBeNull();
    expect(zeroRow(v)).toMatchObject({qualified:false,reasonCode:"CONTEXT_UNVERIFIED:REINFORCEMENT_APPLICATION_SCOPE"});
    zeroRow(v).qualified=true;zeroRow(v).machineStatus="CANDIDATE";zeroRow(v).reasonCode="CATALOG_TRIGGER_MATCHED";
    expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
  });
  it("rejects original-context forgeries even after worker recomputes observation ID",()=>{
    for(const mutate of [(f:any)=>{f.contextFragments.pop();},(f:any)=>{delete f.contextFragments;},
      (f:any)=>{f.contextFragments.reverse();},(f:any)=>{f.contextFragments[0].role="TABLE_SCOPE";},
      (f:any)=>{f.contextFragments[0].rawText+=" ";},(f:any)=>{f.contextFragments[0].bbox.x+=.00001;},
      (f:any)=>{f.contextFragments[0].pageNumber=2;},(f:any)=>{f.contextFragments[0].extra=true;},
      (f:any)=>{f.rawUnit="rebar_catalog_example";},(f:any)=>{f.value="А500С";},(f:any)=>{f.value="400";},
      (f:any)=>{f.applicationScope="working";}]){
      const v=fixture("unreviewed"),f=v.execution.observations.find((f:any)=>f.attribute===attribute&&f.stage==="RD");mutate(f);rehash(v);
      expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
    }
  });
  it("null raw units do not leak into any other attribute",()=>{
    const v=fixture("unreviewed"),fact=v.execution.observations[0],artifact=v.input.sources[0].textArtifact;
    expect(deriveMatrixFactTarget(fact,artifact)).not.toBeNull();
    for(const patch of [{attribute:"OTHER"},{unit:"class"},{rawUnit:""}])expect(deriveMatrixFactTarget({...fact,...patch},artifact)).toBeNull();
  });
  it("portable selector independently reconstructs exact grammar, scope and original bytes",()=>{
    const v=fixture("unreviewed"),fact=v.execution.observations.find((f:any)=>f.attribute===attribute&&f.stage==="RD"),artifact=v.input.sources[1].textArtifact;
    expect(deriveMatrixFactTarget(fact,artifact)).not.toBeNull();
    for(const change of ["role","text","order","extra","raw-value","unit","coarse","fake-label"]){
      const f=structuredClone(fact),a=structuredClone(artifact);
      if(change==="role")f.contextFragments[0].role="ATTRIBUTE_HEADER";
      if(change==="text")f.contextFragments[0].rawText+=" ";
      if(change==="order")f.contextFragments.reverse();
      if(change==="extra")f.contextFragments.push(f.contextFragments[0]);
      if(change==="raw-value")f.rawValue="A400";
      if(change==="unit")f.rawUnit="class";
      if(change==="coarse")delete a.pages[0].blocks[45].lineBboxesMilliPoints;
      if(change==="fake-label"){a.pages[0].blocks[45].text="Класс рабочей арматуры: А400";f.evidenceFragments[0].rawText=a.pages[0].blocks[45].text;f.rawText=f.evidenceFragments[0].rawText;}
      expect(deriveMatrixFactTarget(f,a),change).toBeNull();
    }
  });
  it("strict registry cannot widen grades, ranks, comparison direction or identity policy",()=>{
    for(const [key,changed] of [["family","DIFFERENT"],["allowedValues",["А500С","А400","А240"]],["canonicalUnit","class"],
      ["requiredContext",[]],["subruleContext",undefined],["unitAliases",["class"]],["labels",["Арматура"]]] as const){
      const v=fixture(),r=structuredClone(matrixRegistry),rule=r.entries.find(e=>e.parameterCode==="KR-057")!.atomicRules[0];
      (rule as Record<string,unknown>)[key]=changed;v.execution.registryHash=sha256(canonicalJson(r));
      expect(verifyMatrixAtomicResults(v.execution,v.input,r)).toBe(false);expect(()=>computeMatrixCoverage(v.execution,v.input,r)).toThrow();
    }
  });
  it("pins categorical prose in current and current-compatible scalar legacy definitions",()=>{
    expect(matrixDefinitions.rebarProse.extractorVersion).toBe("matrix-rebar-prose-v1");
    expect(matrixDefinitions.rebarProse.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(matrixLegacyDefinitions.rebarProse).toEqual(matrixDefinitions.rebarProse);
    expect(matrixLegacyDefinitions).not.toHaveProperty("projectConstraints");
  });
});
