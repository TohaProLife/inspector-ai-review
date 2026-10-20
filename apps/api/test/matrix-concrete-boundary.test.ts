import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { matrixDefinitions, matrixLegacyDefinitions, matrixPresentation, matrixRegistry,
  validateMatrixExecution } from "../src/matrix-execution.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const ruleId="matrix-kr-055-concrete_class",attribute="CONCRETE_CLASS";
type Fixture={execution:any;input:any};
const cache=new Map<string,Fixture>();
function fixture(mode="reviewed",actual="В25",expected="В30"):Fixture {
 const key=mode+actual+expected;
 if(!cache.has(key)) {
  const child=spawnSync(pythonExecutable,["-c",`import json,sys
sys.path.insert(0,'../../services/worker/tests')
from test_matrix_concrete_prose import fixture_args,reviewed_args
from inspector_worker.matrix_engine import build_matrix_execution
x=json.load(sys.stdin)
a=reviewed_args(expected=x['expected'],actual=x['actual']) if x['mode']=='reviewed' else fixture_args(full=x['mode']=='public',expected=x['expected'],actual=x['actual'])
e=build_matrix_execution(**a)
s=[dict(source,textArtifact=artifact,review={k:v for k,v in source.items() if k in ['revisionStatus','approvalStatus','sectionCode','pageStages','linkGroupId','scopeProofs']}) for source,artifact in zip(a['sources'],a['text_artifacts'])]
json.dump({'execution':e,'input':{'objectId':a['object_id'],'inputManifestHash':a['input_manifest_hash'],'sources':s}},sys.stdout,ensure_ascii=False)`],
   {input:JSON.stringify({mode,actual,expected}),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:30000,maxBuffer:16*1024*1024});
  if(child.status!==0)throw Error(child.stderr);
  cache.set(key,JSON.parse(child.stdout));
 }
 const value=structuredClone(cache.get(key)!);
 for(const source of value.input.sources)if(source.scopeProofs)source.review.scopeProofs=source.scopeProofs;
 return value;
}
function proseFacts(value:Fixture):any[]{return value.execution.observations.filter((f:any)=>f.attribute===attribute&&f.contextFragments?.some((p:any)=>p.role==="MATERIAL_SCOPE"));}
function fact(value:Fixture,stage="RD"):any {return proseFacts(value).find(f=>f.stage===stage);}
function row(value:Fixture):any {const ids=new Set(proseFacts(value).map(f=>f.id));return value.execution.results.find((r:any)=>r.ruleId===ruleId&&(ids.has(r.expectedObservationId)||ids.has(r.actualObservationId)));}
function rehash(value:Fixture,item:any){
 const previous=item.id;
 item.id=sha256(canonicalJson({sourceFileId:item.sourceFileId,sourceSha256:item.sourceSha256,stage:item.stage,pageNumber:item.pageNumber,
  blockIds:item.evidenceFragments.map((p:any)=>p.blockId),attribute:item.attribute,value:item.value,unit:item.unit,
  ...(item.contextFragments?{contextFragments:item.contextFragments}:{})}));
 for(const result of value.execution.results)for(const key of ["expectedObservationId","actualObservationId"])if(result[key]===previous)result[key]=item.id;
}
function context(value:Fixture,index:number,key:string):any {return value.input.sources[index].scopeProofs.FACT_BINDINGS.bindings.find((b:any)=>b.ruleId===ruleId).contexts[key];}

describe("concrete independent cross-page source boundary",()=>{
 beforeAll(()=>{fixture();fixture("public");fixture("unreviewed");},60_000);
 it("accepts full161 originals, exact previous-page header and abstention without inferring load-bearing identity",()=>{
  const v=fixture("public"),before=canonicalJson(v),checked=validateMatrixExecution(v.execution,v.input);
  expect(checked).not.toBeNull();expect(v.input.sources.map((s:any)=>s.textArtifact.pageCount)).toEqual([139,22]);
  expect(proseFacts(v).map(f=>[f.stage,f.pageNumber,f.value,f.rawValue,f.rawUnit,f.unit,f.entityKey])).toEqual([
   ["PD",50,"В30","В30","B_CLASS","B_CLASS",null],["RD",4,"В30","В30","B_CLASS","B_CLASS",null]]);
  expect(proseFacts(v).map(f=>f.contextFragments.map((p:any)=>[p.pageNumber,p.blockId,p.role]))).toEqual([
   [[49,"10:0","ATTRIBUTE_HEADER"],[49,"10:1","ATTRIBUTE_HEADER"],[50,"0:0","MATERIAL_SCOPE"]],[[4,"1:3","MATERIAL_SCOPE"]]]);
  expect(proseFacts(v).every(f=>f.evidenceFragments.length===1&&!f.sourceFlags.includes("TABLE_CONTEXT_UNVERIFIED"))).toBe(true);
  expect(checked!.results.filter(r=>r.parameterCode==="KR-055").every(r=>!r.qualified)).toBe(true);
  expect(canonicalJson(v)).toBe(before);
 },30_000);
 it("reviewed30/25 is a partial candidate with numeric delta-5 and no calibrated probability",()=>{
  const v=fixture(),checked=validateMatrixExecution(v.execution,v.input);expect(checked).not.toBeNull();
  expect(row(v)).toMatchObject({qualified:true,machineStatus:"CANDIDATE",reasonCode:"CATALOG_TRIGGER_MATCHED",delta:"-5"});
  expect(checked!.coverage.find(c=>c.parameterCode==="KR-055")!.executionStatus).toBe("PARTIAL");
  expect(matrixPresentation(checked!).every(p=>p.confidence.calibratedProbability===null)).toBe(true);
 });
 it("equal reviewed30/30 cannot establish negative completeness",()=>{
  const v=fixture("reviewed","В30");expect(validateMatrixExecution(v.execution,v.input)).not.toBeNull();
  expect(row(v)).toMatchObject({qualified:false,machineStatus:"CLARIFICATION_REQUIRED",reasonCode:"NEGATIVE_SCOPE_UNVERIFIED",delta:"0"});
 });
 for(const stage of ["PD","RD"])for(const attack of ["missing","reordered","role","raw","bbox","page","extra","wrong-source","value","raw-value","raw-unit","forged-identity"])
  it(`${stage} rejects source/context ${attack} after recomputing observation ID`,()=>{
   const v=fixture("unreviewed"),f=fact(v,stage);
   if(attack==="missing")f.contextFragments.pop();
   if(attack==="reordered")f.contextFragments=[f.contextFragments.at(-1),...f.contextFragments.slice(0,-1),f.contextFragments.at(-1)];
   if(attack==="role")f.contextFragments[0].role="TABLE_SCOPE";
   if(attack==="raw")f.contextFragments[0].rawText+=" ";
   if(attack==="bbox")f.contextFragments[0].bbox.x+=.00001;
   if(attack==="page")f.contextFragments[0].pageNumber=stage==="PD"?2:2;
   if(attack==="extra")f.contextFragments[0].sourceFileId="foreign-source";
   if(attack==="wrong-source"){f.sourceFileId=stage==="PD"?v.input.sources[1].sourceFileId:v.input.sources[0].sourceFileId;f.sourceSha256=stage==="PD"?v.input.sources[1].sha256:v.input.sources[0].sha256;}
   if(attack==="value")f.value="B35";
   if(attack==="raw-value")f.rawValue="B25";
   if(attack==="raw-unit")f.rawUnit=null;
   if(attack==="forged-identity")f.componentRole="MONOLITHIC_LOAD_BEARING_STAIR";
   rehash(v,f);expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
  });
 it("a valid portable hash never makes a foreign header or wrong header stage applicable",()=>{
  for(const attack of ["header-stage","header-page","wrong-header","coarse","missing-header","duplicate-header"]){
   const v=fixture("unreviewed"),f=fact(v,"PD"),s=v.input.sources[0],a=s.textArtifact;
   if(attack==="header-stage")s.review.pageStages={1:"RD"};
   if(attack==="header-page")f.contextFragments[0].pageNumber=2;
   if(attack==="wrong-header")a.pages[0].blocks[10].text=a.pages[0].blocks[10].text.replace(/тяжелого\s+бетона/u,"легкого бетона");
   if(attack==="coarse")delete a.pages[0].blocks[10].lineBboxesMilliPoints;
   if(attack==="missing-header")a.pages[0].blocks[10].text="Неподтверждённый класс бетона";
   if(attack==="duplicate-header")a.pages[0].blocks.push(structuredClone(a.pages[0].blocks[10]));
   rehash(v,f);expect(validateMatrixExecution(v.execution,v.input),attack).toBeNull();
   if(attack!=="header-stage")expect(deriveMatrixFactTarget(f,a),attack).toBeNull();
  }
 });
 for(const index of [0,1])for(const key of ["ELEMENT_IDENTITY","MATERIAL_CLASS_BASIS"])
  it(`requires authenticated source binding ${index}:${key}`,()=>{
   const v=fixture();delete v.input.sources[index].scopeProofs.FACT_BINDINGS.bindings.find((b:any)=>b.ruleId===ruleId).contexts[key];
   expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
  });
 for(const index of [0,1])for(const field of ["componentRole","componentKey","zoneKey","operatingModeKey","measurementBasisKey"])
  it(`rejects mismatched element field ${index}:${field}`,()=>{const v=fixture();context(v,index,"ELEMENT_IDENTITY")[field]="another-element";expect(validateMatrixExecution(v.execution,v.input)).toBeNull();});
 for(const index of [0,1])for(const field of ["attribute","canonicalUnit","measurementBasisKey"])
  it(`rejects unsupported strength basis ${index}:${field}`,()=>{const v=fixture();context(v,index,"MATERIAL_CLASS_BASIS")[field]="another-basis";expect(validateMatrixExecution(v.execution,v.input)).toBeNull();});
 it("whole-file proofs cannot substitute either bound original concrete fact",()=>{
  const v=fixture();for(const s of v.input.sources){const b=s.scopeProofs.FACT_BINDINGS.bindings.find((b:any)=>b.ruleId===ruleId);
   s.review.scopeProofs=s.scopeProofs=Object.fromEntries(Object.entries({...b.contexts,ENTITY_SCOPE:{reference:b.reference}}).map(([key,details])=>[key,
    {...details as any,status:"VERIFIED",sourceFileId:s.sourceFileId,sourceSha256:s.sha256,objectId:v.input.objectId,inputManifestHash:v.input.inputManifestHash,entityKey:b.entityKey}]));}
  expect(validateMatrixExecution(v.execution,v.input)).toBeNull();
 });
 it("existing six PD table facts remain byte-identical observations",()=>{
  const full=fixture("public"),compact=fixture("unreviewed");
  const old=full.execution.observations.filter((f:any)=>f.attribute===attribute&&f.sourceFlags.includes("TABLE_CONTEXT_UNVERIFIED"));
  expect(old).toHaveLength(6);
  expect(old.every((f:any)=>!f.contextFragments?.some((p:any)=>p.role==="MATERIAL_SCOPE"))).toBe(true);
  // Frozen pre-integration source research: F0106 original table facts, not newly derived expectations.
  expect(old.map((f:any)=>f.id)).toEqual([
   "729d37d305fa2705b244967b579bffad911bdf689bb09e6824a45e8731d7ce1e",
   "fbde416081384bedb4dc07c1200bec51fc789474b6b3f9abaedede9839586d00",
   "0bb938d15880eb84c0f41913117894624302ac418b708423b72f2e3a5a8b1eff",
   "096745faec69fc5d37d6b937dc93afe4fa54c044d849cdce73dba48e51f86488",
   "789715b733ae05a552854e8e618097eba534753125a748f01ab98cf64026950b",
   "344b0330aadc37b0e77f236b879f7e2723b20dd133689a2fc2c65fe669215d3b"]);
  expect(sha256(canonicalJson(old))).toBe("e9aa49ca43ece2fdb0c31407dbb68f6d4ca71602de2f1775a733eb6fbca2d7ee");
  expect(validateMatrixExecution(compact.execution,compact.input)).not.toBeNull();
 });
 it("pins independent concrete parser without altering registry counts",()=>{
  expect((matrixDefinitions as any).concreteProse.extractorVersion).toBe("matrix-concrete-prose-v1");
  expect((matrixLegacyDefinitions as any).concreteProse).toEqual((matrixDefinitions as any).concreteProse);
  expect(matrixRegistry.entries.filter(e=>e.atomicRules.length)).toHaveLength(55);
  expect(matrixRegistry.entries.flatMap(e=>e.atomicRules)).toHaveLength(63);
 });
});
