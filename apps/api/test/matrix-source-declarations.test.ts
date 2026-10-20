import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { canonicalSourceDeclarationJson, extractSourceDeclarations, sourceDeclarationId,
  validateSourceDeclarations, type SourceDeclarationInput } from "../src/matrix-source-declarations.js";
import { MATRIX_STEEL_PROFILE as MATRIX_PROFILE, MATRIX_CONSTRAINTS_PROFILE, MATRIX_LEGACY_PROFILE, matrixPolicyForProfile,
  matrixSteelConfigHash as matrixConfigHash, matrixConstraintsConfigHash, matrixLegacyConfigHash, validateMatrixExecution } from "../src/matrix-execution.js";
import { pythonAvailable, pythonExecutable, pythonEnv } from "./python.js";

const fixture = JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-full43-fixture.json",import.meta.url),"utf8"));
function input(): SourceDeclarationInput {
  return {objectId:"OBJ-NOVOSLOBODSKAYA",inputManifestHash:"a".repeat(64),
    sources:fixture.sources.map((row:any)=>({sourceFileId:row.source.file_id,sha256:row.source.sha256,
      stages:[row.source.stage],sectionCode:row.source.section})),
    textArtifacts:fixture.sources.map((row:any)=>structuredClone(row.sourceArtifact))};
}
const extract = () => extractSourceDeclarations(input());
function python(script:string,x:unknown){
  const result=spawnSync(pythonExecutable,["-c",script],{input:JSON.stringify(x),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:20000,maxBuffer:32*1024*1024});
  expect(result.status,result.stderr).toBe(0);return JSON.parse(result.stdout);
}
const hash=(v:unknown)=>createHash("sha256").update(canonicalSourceDeclarationJson(v)).digest("hex");

describe("source declarations evidence-only independent source boundary",()=>{
  it("retains full43 original pages, source product scopes, actual OTHER and raw aliases",()=>{
    const x=input(),before=JSON.stringify(x),out=extractSourceDeclarations(x);
    expect((x.textArtifacts as any[]).map(a=>a.pageCount)).toEqual([29,14]);
    expect(out).toMatchObject({purpose:"EVIDENCE_ONLY",objectId:x.objectId,inputManifestHash:x.inputManifestHash});
    expect(out.declarations.map(f=>[f.sourceFileId,f.pageNumber,f.value,f.rawValue,f.primaryFragments.length,f.scopeFragments.length]))
      .toEqual([["F0105",14,"С245","C245",1,3],["F0145",4,"С245","С245",2,3]]);
    expect(out.declarations[0].productScope).toMatchObject({profile:"70Б3",count:3,tier:2});
    expect(out.declarations[1].productScope).toMatchObject({profile:null,count:null,tier:null});
    expect((x.sources[1] as any).sectionCode).toBe("OTHER");
    expect(out.declarations.every(f=>f.entityKey===null&&f.applicabilityStatus==="UNREVIEWED"&&f.rawUnit===null)).toBe(true);
    expect(out.declarations.map(f=>f.id)).toEqual(["3b285595049fcfc171a0f5e89bec7008daf91d87f02df7f9754d110403294725","6529a76c34fa9b687f35722dd6eae3bf6dd5ccf43ba3d9c238ddb3ad99003502"]);
    expect(JSON.stringify(x)).toBe(before);
    for(const f of out.declarations){expect(f.id).toBe(sourceDeclarationId(f));expect(f.textArtifactHash).toBe(hash({hashDomain:"matrix-source-declaration-text-artifact-v1",textArtifact:(x.textArtifacts as any[]).find(a=>a.sourceFileId===f.sourceFileId)}));}
  });
  (pythonAvailable?it:it.skip)("matches independent Python full-envelope payload byte-for-byte",()=>{
    const x=input(),out=extractSourceDeclarations(x);
    const expected=python("import json,sys\nfrom inspector_worker.source_declarations import extract_source_declarations\njson.dump(extract_source_declarations(json.load(sys.stdin)),sys.stdout,ensure_ascii=False)",x);
    expect(canonicalSourceDeclarationJson(out)).toBe(canonicalSourceDeclarationJson(expected));
  });
  it("uses ASCII lexical object key order and scalar Unicode portable hashing",()=>{
    expect(canonicalSourceDeclarationJson({"2":"С245","10":"😀","a":3})).toBe('{"10":"😀","2":"С245","a":3}');
    expect(canonicalSourceDeclarationJson({x:2**53-1})).toBe('{"x":9007199254740991}');
    for(const bad of [1.25,NaN,Infinity,2**53,undefined,()=>{},"\ud800",{"é":2},new Date(),new Map()]) expect(()=>canonicalSourceDeclarationJson(bad)).toThrow();
    const sparse=new Array(1),accessor=Object.defineProperty({},"x",{enumerable:true,get(){throw Error("getter invoked");}}),extra:any[]=[];Object.assign(extra,{x:1});
    for(const bad of [sparse,accessor,extra])expect(()=>canonicalSourceDeclarationJson(bad)).toThrow();
    const symbol:any={a:1};symbol[Symbol()]=2;expect(()=>canonicalSourceDeclarationJson(symbol)).toThrow();
    const cycle:any={};cycle.x=cycle;expect(()=>canonicalSourceDeclarationJson(cycle)).toThrow();
    let deep:any=0;for(let i=0;i<65;i++)deep={x:deep};expect(()=>canonicalSourceDeclarationJson(deep)).toThrow();
  });
  it.each(["value","rawValue","sourceFileId","sourceSha256","textArtifactHash","stage","pageNumber","widthMilliPoints","entityKey","applicabilityStatus","productScope","primaryFragments","scopeFragments"])("rehashing changed %s cannot forge a committed declaration",key=>{
    const out=structuredClone(extract()) as any,f=out.declarations[0];
    const changes:any={value:"С345",rawValue:"C345",sourceFileId:"other",sourceSha256:"f".repeat(64),textArtifactHash:"b".repeat(64),stage:"RD",pageNumber:13,widthMilliPoints:600001,entityKey:"same-member",applicabilityStatus:"APPROVED",productScope:{...f.productScope,tier:1},primaryFragments:f.primaryFragments.map((p:any)=>({...p,rawText:p.rawText+"!"})),scopeFragments:[...f.scopeFragments].reverse()};
    const before=f.id;f[key]=changes[key];f.id=sourceDeclarationId(f);expect(f.id).not.toBe(before);expect(validateSourceDeclarations(out,input())).toBeNull();
  });
  it.each(["attribute","parameterCode","ruleId","probability","calibratedProbability","qualified","reviewTarget","measurementBasis"])("forbids injected executable field %s even with recomputed ID",key=>{
    const out=structuredClone(extract()) as any;out.declarations[0][key]="FORGED";out.declarations[0].id=sourceDeclarationId(out.declarations[0]);expect(validateSourceDeclarations(out,input())).toBeNull();
  });
  it("rejects dropped, extra, reordered and wrong envelope declarations",()=>{
    const out=extract();
    for(const declarations of [[],out.declarations.slice(1),[...out.declarations].reverse(),[...out.declarations,out.declarations[0]]])expect(validateSourceDeclarations({...out,declarations},input())).toBeNull();
    for(const patch of [{purpose:"COMPARISON"},{objectId:"wrong"},{inputManifestHash:"f".repeat(64)},{schemaVersion:"other"},{probability:0.9}])expect(validateSourceDeclarations({...out,...patch},input())).toBeNull();
  });
  it.each([[],["ID"],["UNRESOLVED"],["PD","RD"]].map(stages=>({stages})))("abstains on source stages $stages",({stages})=>{
    const x=input();for(const source of x.sources as any[])source.stages=stages;expect(extractSourceDeclarations(x).declarations).toEqual([]);
  });
  it("handles missing artifacts normally, single-stage consistent pageStages and entire-source conflict",()=>{
    const x=input();x.textArtifacts=[];expect(extractSourceDeclarations(x).declarations).toEqual([]);
    const y=input();(y.sources[0] as any).pageStages={14:"PD"};expect(extractSourceDeclarations(y).declarations).toHaveLength(2);
    (y.sources[0] as any).pageStages={1:"UNRESOLVED"};expect(extractSourceDeclarations(y).declarations.map(f=>f.sourceFileId)).toEqual(["F0145"]);
    (y.sources[0] as any).stages=["PD","RD"];(y.sources[0] as any).pageStages={14:"PD"};expect(extractSourceDeclarations(y).declarations.map(f=>f.sourceFileId)).toEqual(["F0145"]);
  });
  it.each([null,[],{"0":"PD"},{"01":"PD"},{"30":"PD"},{"1":"UNKNOWN"},{"9007199254740992":"PD"}])("rejects invalid pageStages %j",pageStages=>{const x=input();(x.sources[0] as any).pageStages=pageStages;expect(()=>extractSourceDeclarations(x)).toThrow();});
  it.each(["duplicate-source","duplicate-artifact","orphan-artifact","sha","object","stage-shape","stage-code","duplicate-stage","empty-id","padded-id","surrogate-id","bad-page","renumber","bad-count","out-box","float","extra-envelope","bad-metrics","line-count","invalid-unicode","source-extra-array"])("fails malformed supplied input %s before stage filtering",kind=>{
    const x=input() as any,a=x.textArtifacts[0],s=x.sources[0];
    const mutate:Record<string,()=>void>={
      "duplicate-source":()=>x.sources.push(s),"duplicate-artifact":()=>x.textArtifacts.push(a),"orphan-artifact":()=>a.sourceFileId="unknown",
      sha:()=>a.inputSha256="f".repeat(64),object:()=>s.objectId="wrong","stage-shape":()=>s.stages=null,"stage-code":()=>s.stages=["TYPO"],"duplicate-stage":()=>s.stages=["PD","PD"],
      "empty-id":()=>s.sourceFileId="","padded-id":()=>s.sourceFileId=" F0105","surrogate-id":()=>s.sourceFileId="\ud800",
      "bad-page":()=>a.pages[0].widthMilliPoints=0,renumber:()=>a.pages[0].pageNumber=2,"bad-count":()=>a.pageCount--,
      "out-box":()=>a.pages[0].blocks[0].bboxMilliPoints[2]=a.pages[0].widthMilliPoints+1,float:()=>a.pages[0].blocks[0].bboxMilliPoints[0]=1.1,
      "extra-envelope":()=>a.extra=0,"bad-metrics":()=>a.pages[0].quality.metrics.blockCount="bad","line-count":()=>a.pages[0].blocks[0].lineBboxesMilliPoints=[],
      "invalid-unicode":()=>a.pages[0].blocks[0].text="\ud800","source-extra-array":()=>x.sources.extra=0};
    mutate[kind]();expect(()=>extractSourceDeclarations(x)).toThrow();
    if(!["stage-shape","stage-code","duplicate-stage"].includes(kind)){s.stages=["ID"];expect(()=>extractSourceDeclarations(x)).toThrow();}
  });
  it("a valid but coarse/inconsistent original line geometry abstains rather than inventing a location",()=>{
    const x=input() as any;const block=x.textArtifacts[0].pages[13].blocks[30];delete block.lineBboxesMilliPoints;
    expect(extractSourceDeclarations(x).declarations.map(f=>f.sourceFileId)).toEqual(["F0145"]);
    const y=input() as any;y.textArtifacts[0].pages[13].blocks[30].lineBboxesMilliPoints[0][0]++;
    expect(extractSourceDeclarations(y).declarations.map(f=>f.sourceFileId)).toEqual(["F0145"]);
  });
  it("rejects source and stage array accessors without invoking any getter",()=>{
    for(const field of ["sourceFileId","sha256","stages","pageStages"]){const x=input();let calls=0;
      Object.defineProperty(x.sources[0],field,{enumerable:true,get(){calls++;return field==="stages"?["PD"]:{};}});
      expect(()=>extractSourceDeclarations(x)).toThrow();expect(calls).toBe(0);
    }
    for(const field of ["sources","textArtifacts"] as const){const x=input();let calls=0;
      Object.defineProperty(x[field],"0",{enumerable:true,get(){calls++;return {};}});
      expect(()=>extractSourceDeclarations(x)).toThrow();expect(calls).toBe(0);
    }
    const x=input();let calls=0;Object.defineProperty((x.sources[0] as any).stages,"0",{enumerable:true,get(){calls++;return "PD";}});
    expect(()=>extractSourceDeclarations(x)).toThrow();expect(calls).toBe(0);
  });
  it("matches Python strip semantics for native source identifiers and sorts supplementary source IDs by code point",()=>{
    for(const prefix of ["\u0085","\u001c","\u001f","\u00a0"]){const x=input();x.objectId=prefix+x.objectId;expect(()=>extractSourceDeclarations(x)).toThrow();}
    const x=input();x.objectId="\ufeff"+x.objectId;expect(extractSourceDeclarations(x).declarations).toHaveLength(2);
    for(const [i,sid] of ["\u{10000}","\ue000"].entries()){(x.sources[i] as any).sourceFileId=sid;(x.textArtifacts[i] as any).sourceFileId=sid;}
    expect(extractSourceDeclarations(x).declarations.map(f=>f.sourceFileId)).toEqual(["\ue000","\u{10000}"]);
  });
  it("preserves explicit v2/v1 pins and versioned capability requirements",()=>{
    expect(MATRIX_PROFILE).toBe("matrix-text-facts-evidence-v3");expect(matrixConfigHash).not.toBe(matrixConstraintsConfigHash);
    expect(matrixConstraintsConfigHash).toBe("347c85ed3c0e8ef49346f53b58904b249ee59f1e79cf595098be70589524d8ab");
    expect(matrixLegacyConfigHash).toBe("272a89eac185a2df8f1391384ddddb380779af8bf7b9a81cdf8056dc73371891");
    expect(matrixPolicyForProfile(MATRIX_PROFILE)).toMatchObject({adapterVersion:"3",projectConstraints:true,sourceDeclarations:true});
    expect(matrixPolicyForProfile(MATRIX_CONSTRAINTS_PROFILE)).toMatchObject({adapterVersion:"2",projectConstraints:true,sourceDeclarations:false});
    expect(matrixPolicyForProfile(MATRIX_LEGACY_PROFILE)).toMatchObject({adapterVersion:"1",projectConstraints:false,sourceDeclarations:false});
    expect(matrixPolicyForProfile(MATRIX_CONSTRAINTS_PROFILE)!.definitions).not.toHaveProperty("sourceDeclarations");
    expect(matrixPolicyForProfile(MATRIX_LEGACY_PROFILE)!.definitions).not.toHaveProperty("projectConstraints");
    expect(matrixPolicyForProfile("matrix-unknown")).toBeNull();
  });
  (pythonAvailable?it:it.skip)("never changes exact scalar facts/IDs, results, coverage or submission, nor admits declaration fields into scalar payloads",()=>{
    const x=input();const baseline=python(`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.source_declarations import extract_source_declarations
x=json.load(sys.stdin)
a=build_matrix_execution(object_id=x['objectId'],input_manifest_hash=x['inputManifestHash'],sources=x['sources'],text_artifacts=x['textArtifacts'])
extract_source_declarations(x)
b=build_matrix_execution(object_id=x['objectId'],input_manifest_hash=x['inputManifestHash'],sources=x['sources'],text_artifacts=x['textArtifacts'])
json.dump({'before':a,'after':b},sys.stdout,ensure_ascii=False)`,x);
    expect(baseline.after).toEqual(baseline.before);
    const sources=(x.sources as any[]).map(s=>({...s,review:{revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",sectionCode:s.sectionCode},textArtifact:(x.textArtifacts as any[]).find(a=>a.sourceFileId===s.sourceFileId)}));
    expect(validateMatrixExecution(baseline.before,{objectId:x.objectId,inputManifestHash:x.inputManifestHash,sources})).not.toBeNull();
    for(const key of ["sourceDeclarations","declarations","productScope"]){const forged={...baseline.before,[key]:extract()};expect(validateMatrixExecution(forged,{objectId:x.objectId,inputManifestHash:x.inputManifestHash,sources})).toBeNull();}
    for(const key of ["sourceDeclarations","declarations","productScope","declarationId","primaryFragments","scopeFragments","applicabilityStatus"]){const forged=structuredClone(baseline.before);forged.results[0][key]="forged";expect(validateMatrixExecution(forged,{objectId:x.objectId,inputManifestHash:x.inputManifestHash,sources})).toBeNull();}
    if(baseline.before.observations.length)for(const key of ["productScope","declarationId","primaryFragments","scopeFragments","applicabilityStatus"]){const forged=structuredClone(baseline.before);forged.observations[0][key]="forged";expect(validateMatrixExecution(forged,{objectId:x.objectId,inputManifestHash:x.inputManifestHash,sources})).toBeNull();}
  });
});

const wrapperGolden=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-wrapper-golden.json",import.meta.url),"utf8"));
const boundaries=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-wrapper-boundary-goldens.json",import.meta.url),"utf8"));
function setPath(value:any,path:Array<string|number>,next:unknown){let target=value;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)!]=structuredClone(next);}
describe("frozen independent Python wrapper adversarial shared goldens",()=>{
  it.each(boundaries.cases as any[])("$name",test=>{
    const x=structuredClone(wrapperGolden.input),raw=structuredClone(wrapperGolden.expected),op=test.operation;
    if(op.kind==="set-input-path")setPath(x,op.path,op.value);
    else if(op.kind==="source-stage-policy"){x.sources[op.sourceIndex].stages=op.stages;x.sources[op.sourceIndex].pageStages=op.pageStages;}
    else if(op.kind==="rename-source"){const source=x.sources[op.sourceIndex],artifact=x.textArtifacts.find((a:any)=>a.sourceFileId===source.sourceFileId);source.sourceFileId=op.sourceFileId;artifact.sourceFileId=op.sourceFileId;}
    else if(op.kind==="forge-declaration-path"){const d=raw.declarations[op.declarationIndex];setPath(d,op.path,op.value);if(op.recomputeId)d.id=sourceDeclarationId(d);}
    else if(op.kind!=="raw-output")throw Error("Unknown frozen boundary operation");
    if(test.expected==="THROW_VALUE_ERROR")expect(()=>extractSourceDeclarations(x)).toThrow();
    else if(op.kind==="forge-declaration-path"||op.kind==="raw-output")expect(validateSourceDeclarations(op.kind==="raw-output"?op.raw:raw,x)).toEqual(test.expected);
    else expect(extractSourceDeclarations(x)).toEqual(test.expected);
  });
});
