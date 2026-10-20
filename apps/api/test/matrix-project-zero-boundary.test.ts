import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { matrixConfigHash, matrixDefinitions, matrixLegacyDefinitions, matrixPresentation, matrixRegistry,
  validateMatrixExecution } from "../src/matrix-execution.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { computeMatrixCoverage, verifyMatrixAtomicResults } from "../src/matrix-rule-verifier.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const ruleId="matrix-pz-009-declared_project_zero_absolute_elevation", attribute="PROJECT_ZERO_ABSOLUTE_ELEVATION";
const authorityKey="PROJECT_ZERO_GEODETIC_AUTHORITY", atomicKey=`ATOMIC_SUBRULE_SCOPE:${ruleId}`;
type Fixture={execution:any;input:any};
const cache=new Map<string,Fixture>();
function fixture(mode="reviewed",actual="159.96"):Fixture {
  const key=mode+actual;
  if(!cache.has(key)) {
    const child=spawnSync(pythonExecutable,["-c",`import json,sys
sys.path.insert(0,'../../services/worker/tests')
from test_matrix_project_zero import fixture_args,reviewed_args
from inspector_worker.matrix_engine import build_matrix_execution
x=json.load(sys.stdin)
a=reviewed_args(actual=x['actual']) if x['mode']=='reviewed' else fixture_args(full=x['mode']=='public',actual=x['actual'])
e=build_matrix_execution(**a)
s=[dict(source,textArtifact=artifact,review={k:v for k,v in source.items() if k in ['revisionStatus','approvalStatus','sectionCode','pageStages','linkGroupId','scopeProofs']}) for source,artifact in zip(a['sources'],a['text_artifacts'])]
json.dump({'execution':e,'input':{'objectId':a['object_id'],'inputManifestHash':a['input_manifest_hash'],'sources':s}},sys.stdout,ensure_ascii=False)`],
      {input:JSON.stringify({mode,actual}),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:30000,maxBuffer:16*1024*1024});
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

describe("project zero independent source and typed-authority boundary",()=>{
  beforeAll(()=>{fixture();fixture("public");fixture("unreviewed");});
  it("preserves full35 public pages, two real scalar observations and absent authority",()=>{
    const value=fixture("public"),before=canonicalJson(value),checked=validateMatrixExecution(value.execution,value.input);
    expect(checked).not.toBeNull();expect(value.input.sources.map((s:any)=>s.textArtifact.pageCount)).toEqual([13,22]);
    const facts=checked!.observations.filter(f=>f.attribute===attribute);
    expect(facts.map(f=>[f.stage,f.pageNumber,f.value,f.rawUnit,f.entityKey])).toEqual([["PD",13,"159.95","м",null],["RD",4,"159.95","метрах",null]]);
    expect(facts[1].contextFragments!.map(f=>[f.blockId,f.role])).toEqual([["32:18","UNIT_DECLARATION"],["32:19","UNIT_DECLARATION"]]);
    expect(facts[1].sourceFlags).not.toContain("TABLE_CONTEXT_UNVERIFIED");
    expect(checked!.results.filter(r=>r.parameterCode==="PZ-009").every(r=>!r.qualified)).toBe(true);
    expect(canonicalJson(value)).toBe(before);
  });
  it.each(["-159.96","+159,9600","-0.000"])("admits signed value only through original adopted-zero grammar: %s",actual=>{
    const value=fixture("unreviewed",actual);expect(validateMatrixExecution(value.execution,value.input)).not.toBeNull();
  });
  it.each(["159.96","159.95"])("requires typed reviewed datum and retains negative-scope gate: %s",actual=>{
    const value=fixture("reviewed",actual),checked=validateMatrixExecution(value.execution,value.input);
    expect(checked).not.toBeNull();const row=zeroRow(value);
    expect(row).toMatchObject(actual==="159.96"?{machineStatus:"CANDIDATE",qualified:true}:{machineStatus:"CLARIFICATION_REQUIRED",reasonCode:"NEGATIVE_SCOPE_UNVERIFIED",qualified:false});
    const coverage=checked!.coverage.find(r=>r.parameterCode==="PZ-009")!;
    expect(coverage.executionStatus).toBe("PARTIAL");
    const presented=matrixPresentation(checked!);
    expect(presented.every(f=>f.confidence.calibratedProbability===null)).toBe(true);
  });
  for(const index of [0,1])for(const key of required)it(`rejects qualified forgery after removing ${index}:${key}`,()=>{
    const value=fixture();delete contexts(value,index)[key];expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
  });
  for(const index of [0,1])for(const field of ["componentRole","componentKey","zoneKey","operatingModeKey","measurementBasisKey"])
    it(`independently rejects changed reviewed identity ${index}:${field}`,()=>{
      const value=fixture();contexts(value,index)[atomicKey][field]="another-reviewed-identity";
      expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
    });
  for(const index of [0,1])for(const field of ["sourceFileId","sourceSha256","pageNumber","reviewContentHash"])
    it(`rejects stale or foreign authority ${index}:${field}`,()=>{
      const value=fixture();contexts(value,index)[authorityKey].projectZeroAuthority[field]=field==="pageNumber"?2:field==="sourceFileId"?"foreign-source":"0".repeat(64);
      expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
    });
  for(const field of ["checkId","executionContentHash","observationId","evidenceHash","textArtifactHash"])
    it(`compares complete saved PD target field: ${field}`,()=>{
      const value=fixture();contexts(value,1)[authorityKey].projectZeroAuthority.target[field]=field==="checkId"?"foreign-run":"0".repeat(64);
      expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
    });
  it("protects server provenance, rejects free reference and stale later PD review",()=>{
    for(const mutate of [
      (v:Fixture)=>{delete contexts(v,0)[authorityKey].projectZeroAuthority;},
      (v:Fixture)=>{delete v.input.sources[0].scopeProofs.FACT_BINDINGS.reviewContentHash;},
      (v:Fixture)=>{v.input.sources[0].scopeProofs.FACT_BINDINGS.reviewContentHash="0".repeat(64);},
      (v:Fixture)=>{contexts(v,0)[authorityKey].serverReviewContentHash="e".repeat(64);},
      (v:Fixture)=>{contexts(v,0)[authorityKey].bindingTarget=contexts(v,0)[authorityKey].projectZeroAuthority.target;},
      (v:Fixture)=>{for(const s of v.input.sources)s.scopeProofs.FACT_BINDINGS.reviewContentHash=null;},
    ]){const value=fixture();mutate(value);expect(validateMatrixExecution(value.execution,value.input)).toBeNull();}
  });
  it("whole-file reviews cannot classify geodetic authority",()=>{
    const value=fixture();
    for(const s of value.input.sources){
      const binding=s.scopeProofs.FACT_BINDINGS.bindings[0];
      s.review.scopeProofs=s.scopeProofs=Object.fromEntries(Object.entries({...binding.contexts,ENTITY_SCOPE:{reference:binding.reference}}).map(([key,details])=>[key,
        {...details as any,status:"VERIFIED",sourceFileId:s.sourceFileId,sourceSha256:s.sha256,objectId:value.input.objectId,inputManifestHash:value.input.inputManifestHash,entityKey:binding.entityKey}]));
    }
    expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
  });
  it("rejects forged UNIT_DECLARATION selectors after observation-ID recomputation",()=>{
    for(const mutate of [
      (f:any)=>{f.contextFragments[0].role="TABLE_SCOPE";},(f:any)=>{f.contextFragments.reverse();},
      (f:any)=>{f.contextFragments.pop();},(f:any)=>{delete f.contextFragments;},
      (f:any)=>{f.contextFragments[0].rawText=f.contextFragments[0].rawText.trim()+" ";},
      (f:any)=>{f.contextFragments[0].bbox.x+=.00001;},(f:any)=>{f.contextFragments[0].pageNumber=2;},
      (f:any)=>{f.contextFragments[0].extra="ignored-unit";},
    ]){
      const value=fixture("unreviewed"),fact=value.execution.observations.find((f:any)=>f.attribute===attribute&&f.stage==="RD");
      mutate(fact);rehash(value);expect(validateMatrixExecution(value.execution,value.input)).toBeNull();
    }
  });
  it("rejects recomputed primary forgeries, scoped wording and missing original geometry",()=>{
    for(const mode of ["trim-source","generic-label","floor","range","unit","coarse","value","datum-claim"]){
      const value=fixture("unreviewed"),source=value.input.sources[0],page=source.textArtifact.pages[0];
      const fact=value.execution.observations.find((f:any)=>f.attribute===attribute&&f.stage==="PD");
      if(mode==="trim-source")fact.evidenceFragments[0].rawText=fact.evidenceFragments[0].rawText.trim();
      if(mode==="generic-label"){page.blocks[0].text=page.blocks[0].text.replace("За относительную отметку","Абсолютная отметка проектного нуля:");fact.evidenceFragments[0].rawText=fact.evidenceFragments[0].rawText.replace("За относительную отметку","Абсолютная отметка проектного нуля:");}
      if(mode==="floor"){page.blocks[0].text=page.blocks[0].text.replace("1-м этаже","2-м этаже");fact.evidenceFragments[1].rawText=fact.evidenceFragments[1].rawText.replace("1-м этаже","2-м этаже");}
      if(mode==="range"){page.blocks[0].text=page.blocks[0].text.replace("159,95","159,95–160");fact.evidenceFragments[0].rawText=fact.evidenceFragments[0].rawText.replace("159,95","159,95–160");}
      if(mode==="unit")fact.rawUnit="метрах";
      if(mode==="coarse")delete page.blocks[0].lineBboxesMilliPoints;
      if(mode==="value")fact.value="159.94";
      if(mode==="datum-claim")fact.datumName="Baltic-datum-invented";
      fact.rawText=fact.evidenceFragments.map((f:any)=>f.rawText).join(" ");rehash(value,0);
      expect(validateMatrixExecution(value.execution,value.input),mode).toBeNull();
    }
  });
  it("pins helper in both execution definitions without adding constraints to scalar legacy",()=>{
    expect(matrixDefinitions.projectZeroProse).toEqual({extractorVersion:"matrix-project-zero-prose-v1",sourceSha256:"ed2b9f29364b90a4334668c6acda5316a7b83c8c239e211b542a0e914682c37f"});
    expect(matrixLegacyDefinitions.projectZeroProse).toEqual(matrixDefinitions.projectZeroProse);
    expect(matrixLegacyDefinitions).not.toHaveProperty("projectConstraints");expect(matrixConfigHash).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("rejects registry policy widening even when caller recomputes registry hash",()=>{
    for(const mode of ["remove-policy","remove-authority","english-units","threshold","other-attribute","other-rule"]){
      const value=fixture(),registry=structuredClone(matrixRegistry),rule=registry.entries.find(e=>e.parameterCode==="PZ-009")!.atomicRules[0];
      if(mode==="remove-policy")delete rule.subruleContext;
      if(mode==="remove-authority")rule.requiredContext=rule.requiredContext.filter(key=>key!==authorityKey);
      if(mode==="english-units")rule.unitAliases=["m"];
      if(mode==="threshold")rule.threshold={value:"1",unit:"m",strict:true};
      if(mode==="other-attribute")rule.attribute="OTHER_ATTRIBUTE";
      if(mode==="other-rule")rule.ruleId="other-rule";
      value.execution.registryHash=sha256(canonicalJson(registry));
      expect(verifyMatrixAtomicResults(value.execution,value.input,registry),mode).toBe(false);
      expect(()=>computeMatrixCoverage(value.execution,value.input,registry)).toThrow();
    }
  });
  it("hashes full original artifact and unit roles into portable fact targets",()=>{
    const value=fixture("unreviewed"),fact=value.execution.observations.find((f:any)=>f.attribute===attribute&&f.stage==="RD"),artifact=value.input.sources[1].textArtifact;
    const target=deriveMatrixFactTarget(fact,artifact);expect(target?.fragmentsHash).toMatch(/^[a-f0-9]{64}$/u);
    const changed=structuredClone(artifact);changed.pages[0].blocks[0].text+=" ";
    expect(deriveMatrixFactTarget(fact,changed)?.textArtifactHash).not.toBe(target!.textArtifactHash);
    const altered=structuredClone(fact);altered.contextFragments[0].role="TABLE_SCOPE";
    expect(deriveMatrixFactTarget(altered,artifact)?.evidenceHash).not.toBe(target!.evidenceHash);
  });
});
