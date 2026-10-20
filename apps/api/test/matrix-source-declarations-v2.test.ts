import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { canonicalSourceDeclarationJson, extractSourceDeclarations, sourceDeclarationId, type SourceDeclarationInput } from "../src/matrix-source-declarations.js";
import { extractSourceDeclarationsV2, validateSourceDeclarationsV2 } from "../src/matrix-source-declarations-v2.js";
import { MATRIX_PROFILE, MATRIX_STEEL_PROFILE, MATRIX_CONSTRAINTS_PROFILE, MATRIX_LEGACY_PROFILE, MATRIX_READ_PROFILES, matrixConfigHash, matrixSteelConfigHash, matrixConstraintsConfigHash, matrixLegacyConfigHash, matrixDefinitions, matrixPolicyForProfile, buildMatrixSubmission, validateMatrixExecution } from "../src/matrix-execution.js";
import { pythonAvailable, pythonEnv, pythonExecutable } from "./python.js";

const full=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-fire-table-v1/F0106-full.text.json",import.meta.url),"utf8"));
const steel=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-full43-fixture.json",import.meta.url),"utf8"));
function input():SourceDeclarationInput{return {objectId:"OBJ-FIRE-EVIDENCE",inputManifestHash:"a".repeat(64),
  sources:[{sourceFileId:full.sourceFileId,sha256:full.inputSha256,stages:["PD"],sectionCode:"KR"}],textArtifacts:[structuredClone(full)]};}
function withSteel():SourceDeclarationInput{const x=input();for(const row of steel.sources){x.sources.push({sourceFileId:row.source.file_id,sha256:row.source.sha256,stages:[row.source.stage],sectionCode:row.source.section});x.textArtifacts.push(structuredClone(row.sourceArtifact));}return x;}
const fire=(out:ReturnType<typeof extractSourceDeclarationsV2>)=>out.declarations.filter(d=>d.kind==="SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION");
function python(script:string,x:unknown){const r=spawnSync(pythonExecutable,["-c",script],{input:JSON.stringify(x),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:25000,maxBuffer:48*1024*1024});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}

describe("v2 independent source-authored fire table boundary",{timeout:20_000},()=>{
  it("keeps exact old release hashes and explicit four-profile sibling capabilities",()=>{
    expect(MATRIX_PROFILE).toBe("matrix-text-facts-evidence-v4");expect(MATRIX_READ_PROFILES).toEqual([MATRIX_PROFILE,MATRIX_STEEL_PROFILE,MATRIX_CONSTRAINTS_PROFILE,MATRIX_LEGACY_PROFILE]);
    expect(matrixSteelConfigHash).toBe("2536d3f36cb5c112a052c7f1ea782afc9b1c95d3d97862b7b4051db7d3eb14bd");
    expect(matrixConstraintsConfigHash).toBe("347c85ed3c0e8ef49346f53b58904b249ee59f1e79cf595098be70589524d8ab");
    expect(matrixLegacyConfigHash).toBe("272a89eac185a2df8f1391384ddddb380779af8bf7b9a81cdf8056dc73371891");
    expect(matrixConfigHash).not.toBe(matrixSteelConfigHash);
    expect(matrixPolicyForProfile(MATRIX_PROFILE)).toMatchObject({adapterVersion:"4",projectConstraints:true,sourceDeclarations:true,sourceDeclarationsSchemaVersion:"matrix-source-declarations-v2"});
    expect(matrixPolicyForProfile(MATRIX_STEEL_PROFILE)).toMatchObject({adapterVersion:"3",sourceDeclarationsSchemaVersion:"matrix-source-declarations-v1"});
    expect(matrixPolicyForProfile(MATRIX_CONSTRAINTS_PROFILE)).toMatchObject({adapterVersion:"2",sourceDeclarations:false,sourceDeclarationsSchemaVersion:null});
    expect(matrixPolicyForProfile(MATRIX_LEGACY_PROFILE)).toMatchObject({adapterVersion:"1",projectConstraints:false,sourceDeclarations:false,sourceDeclarationsSchemaVersion:null});
  });
  it("pins every transitive Python extractor dependency only in v4 definitions",()=>{
    expect(matrixDefinitions.sourceDeclarations).toMatchObject({schemaVersion:"matrix-source-declarations-v2",extractorVersion:"matrix-source-declarations-v2",
      sourceSha256:"79ffc4c1c31c64aceda65c8c8414d634bfd62e15a093fe1459ffb2bac7390a0a",
      legacyExtractorVersion:"matrix-source-declarations-v1",legacySourceSha256:"e093dcb39481769588155beb92810a4f581f77e9ae00387552328f749ca9217e",
      fireExtractorVersion:"matrix-fire-resistance-table-v1",fireSourceSha256:"130cb332ef2accb15af25181f9925bf1111c7d77fa06e179dd8191711ccdd152",
      tableBindingVersion:"table-row-binding-v1",tableBindingSourceSha256:"7ff23a3740addce6b40f24fc8fde2b56b5d171e944f8d44942ad0acb725ae91f",
      bindingPolicyVersion:"matrix-fire-resistance-upper-table-v1",purpose:"EVIDENCE_ONLY"});
    expect(matrixPolicyForProfile(MATRIX_STEEL_PROFILE)!.definitions).not.toHaveProperty("sourceDeclarations.legacySourceSha256");
  });
  it("preserves complete139 pages, all six source values, full labels/headers/unit and original geometry",()=>{
    const x=input(),before=canonicalSourceDeclarationJson(x),out=extractSourceDeclarationsV2(x),rows=fire(out);
    expect((x.textArtifacts[0] as any).pageCount).toBe(139);
    expect(out).toMatchObject({schemaVersion:"matrix-source-declarations-v2",extractorVersion:"matrix-source-declarations-v2",purpose:"EVIDENCE_ONLY"});
    expect(rows).toHaveLength(6);
    expect(rows.map(d=>[d.criterion,d.minutes]).sort()).toEqual([["R",120],["REI",120],["REI",120],["REI",120],["REI",150],["REI",60]].sort());
    for(const row of rows){
      expect(row).toMatchObject({pageNumber:51,entityKey:null,applicabilityStatus:"UNREVIEWED",canonicalUnit:"min",rawUnit:"мин",bindingPolicyVersion:"matrix-fire-resistance-upper-table-v1"});
      expect(row.primaryFragments).toHaveLength(1);expect(row.scopeFragments.length).toBe(row.constructionLabelLines.length);
      expect(row.headerFragments.map(f=>f.rawText)).toEqual(["Наименование строительной конструкции","Предел огнестойкости,"]);
      expect(row.unitFragments.map(f=>f.rawText)).toEqual(["мин"]);
      expect([...row.primaryFragments,...row.scopeFragments,...row.headerFragments,...row.unitFragments].every(f=>f.pageNumber===51)).toBe(true);
      expect(row.id).toBe(sourceDeclarationId(row as any));
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["attribute","parameterCode","ruleId","value","probability","productScope"]));
    }
    expect(rows.find(d=>d.scopeFragments.length===2)?.constructionLabelLines).toEqual(["Перекрытия  междуэтажные,  разделяющие  здание  на","пожарные отсеки"]);
    expect(canonicalSourceDeclarationJson(x)).toBe(before);expect(validateSourceDeclarationsV2(out,x)).toEqual(out);
  });
  it("retains byte-identical steel v1 bodies and IDs when adding independent fire evidence",()=>{
    const x=withSteel(),legacy=extractSourceDeclarations(x),out=extractSourceDeclarationsV2(x);
    expect(out.declarations.filter(d=>d.kind==="SOURCE_AUTHORED_STEEL_DECLARATION")).toEqual(legacy.declarations);
    expect(legacy.declarations.map(d=>d.id)).toEqual(["3b285595049fcfc171a0f5e89bec7008daf91d87f02df7f9754d110403294725","6529a76c34fa9b687f35722dd6eae3bf6dd5ccf43ba3d9c238ddb3ad99003502"]);
    expect(fire(out)).toHaveLength(6);
  });
  it("matches independent full182 hand-assembled wrapper golden, including all eight portable IDs",()=>{
    const golden=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-fire-table-v1/wrapper-golden.json",import.meta.url),"utf8"));
    const x=withSteel();x.objectId=golden.expected.objectId;x.inputManifestHash=golden.expected.inputManifestHash;
    expect(canonicalSourceDeclarationJson(extractSourceDeclarationsV2(x))).toBe(canonicalSourceDeclarationJson(golden.expected));
  });
  (pythonAvailable?it:it.skip)("matches independent Python v2 full-source payload and portable IDs",()=>{
    const x=withSteel(),out=extractSourceDeclarationsV2(x),expected=python("import json,sys\nfrom inspector_worker.source_declarations_v2 import extract_source_declarations\njson.dump(extract_source_declarations(json.load(sys.stdin)),sys.stdout,ensure_ascii=False)",x);
    expect(canonicalSourceDeclarationJson(out)).toBe(canonicalSourceDeclarationJson(expected));
  });
  it.each(["criterion","minutes","rawValue","rawUnit","canonicalUnit","constructionLabelLines","primaryFragments","scopeFragments","headerFragments","unitFragments","bindingPolicyVersion","tableBoxMilliPoints","sourceFileId","sourceSha256","textArtifactHash","stage","pageNumber","widthMilliPoints","heightMilliPoints","entityKey","applicabilityStatus"])("rejects rehashed declaration forgery %s",field=>{
    const x=input(),out=extractSourceDeclarationsV2(x) as any,row=out.declarations[0];
    if(field.endsWith("Fragments")){row[field]=row[field].map((f:any)=>({...f,rawText:f.rawText+" FORGED"}));}
    else if(field==="constructionLabelLines")row[field]=["Invented physical member"];
    else if(field==="tableBoxMilliPoints")row[field]=row[field].map((n:number)=>n+1);
    else if(field==="minutes")row[field]=999;
    else if(["pageNumber","widthMilliPoints","heightMilliPoints"].includes(field))row[field]++;
    else row[field]=field.endsWith("Hash")||field.endsWith("Sha256")?"f".repeat(64):"FORGED";
    row.id=sourceDeclarationId(row);expect(validateSourceDeclarationsV2(out,x)).toBeNull();
  });
  it.each(["value","attribute","parameterCode","ruleId","qualified","confidence","probability","calibratedProbability","memberIdentity","productScope","relation","minimum","approvedApplicability","achievedFireResistance","externalNormAuthority","tablePolicyHash"])("rejects injected semantic authority %s even with valid ID",key=>{
    const x=input(),out=extractSourceDeclarationsV2(x) as any;out.declarations[0][key]="FORGED";out.declarations[0].id=sourceDeclarationId(out.declarations[0]);expect(validateSourceDeclarationsV2(out,x)).toBeNull();
  });
  it("rejects partial, duplicate, reordered and extra output, and wrong sibling version",()=>{
    const x=input(),out=extractSourceDeclarationsV2(x);
    for(const declarations of [[],out.declarations.slice(1),[...out.declarations].reverse(),[...out.declarations,out.declarations[0]]])expect(validateSourceDeclarationsV2({...out,declarations},x)).toBeNull();
    for(const patch of [{schemaVersion:"matrix-source-declarations-v1"},{extractorVersion:"matrix-source-declarations-v1"},{objectId:"wrong"},{inputManifestHash:"f".repeat(64)},{purpose:"EXECUTION"},{confidence:1}])expect(validateSourceDeclarationsV2({...out,...patch},x)).toBeNull();
  });
  it("policy derives from source anchors, never from expected numeric values or value coordinates",()=>{
    const x=input() as any,page=x.textArtifacts[0].pages[50],baseline=fire(extractSourceDeclarationsV2(x));
    page.blocks[0].text=page.blocks[0].text.replace("R 120","R 999");
    const changed=fire(extractSourceDeclarationsV2(x));expect(changed).toHaveLength(6);
    expect(changed.find(d=>d.criterion==="R")?.minutes).toBe(999);
    expect(changed.map(d=>d.tableBoxMilliPoints)).toEqual(baseline.map(d=>d.tableBoxMilliPoints));
    page.blocks[0].text=page.blocks[0].text.replace("R 999","R 099");expect(fire(extractSourceDeclarationsV2(x))).toEqual([]);
  });
  it.each([[],["ID"],["UNRESOLVED"],["PD","RD"]].map(stages=>({stages})))("retains stage abstention for $stages",({stages})=>{const x=input() as any;x.sources[0].stages=stages;expect(extractSourceDeclarationsV2(x).declarations).toEqual([]);});
  it("uses no source-ID, source-SHA, page-number, section or human-approval allowlist",()=>{
    const x=input() as any,a=x.textArtifacts[0],s=x.sources[0];
    s.sourceFileId=a.sourceFileId="SYNTHETIC-FIRE-RELOCATED";s.sha256=a.inputSha256="e".repeat(64);s.sectionCode="OTHER";
    [a.pages[0],a.pages[50]]=[a.pages[50],a.pages[0]];a.pages.forEach((p:any,i:number)=>p.pageNumber=i+1);
    const rows=fire(extractSourceDeclarationsV2(x));expect(rows).toHaveLength(6);expect(rows.every(d=>d.pageNumber===1&&d.sourceFileId===s.sourceFileId&&d.sourceSha256===s.sha256&&d.applicabilityStatus==="UNREVIEWED")).toBe(true);
    s.stages=["RD"];const rd=fire(extractSourceDeclarationsV2(x));expect(rd).toHaveLength(6);expect(rd.every(d=>d.stage==="RD")).toBe(true);
  });
  it("retains missing-artifact empty and entire-source pageStages conflict, without inferred review",()=>{
    const x=input() as any;x.sources[0].pageStages={51:"PD"};expect(fire(extractSourceDeclarationsV2(x))).toHaveLength(6);
    x.sources[0].pageStages={1:"UNRESOLVED"};expect(extractSourceDeclarationsV2(x).declarations).toEqual([]);
    x.sources[0].pageStages={};x.textArtifacts=[];expect(extractSourceDeclarationsV2(x).declarations).toEqual([]);
  });
  it.each(["duplicate-source","duplicate-artifact","orphan","sha","bad-count","float","bad-pages","unknown-stage","invalid-pageStages"])("retains full-input failure for %s before any extraction",kind=>{
    const x=input() as any,a=x.textArtifacts[0];const mutations:Record<string,()=>void>={"duplicate-source":()=>x.sources.push(x.sources[0]),"duplicate-artifact":()=>x.textArtifacts.push(a),orphan:()=>a.sourceFileId="orphan",sha:()=>a.inputSha256="f".repeat(64),"bad-count":()=>a.pageCount--,float:()=>a.pages[0].widthMilliPoints+=0.5,"bad-pages":()=>a.pages.reverse(),"unknown-stage":()=>x.sources[0].stages=["TYPO"],"invalid-pageStages":()=>x.sources[0].pageStages={140:"PD"}};
    mutations[kind]();expect(()=>extractSourceDeclarationsV2(x)).toThrow();expect(validateSourceDeclarationsV2({},x)).toBeNull();
  });
  (pythonAvailable?it:it.skip)("keeps scalar IDs/results/coverage/submission unchanged and rejects every reserved fire field",()=>{
    const x=input();const baseline=python(`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.source_declarations_v2 import extract_source_declarations
x=json.load(sys.stdin)
a=build_matrix_execution(object_id=x['objectId'],input_manifest_hash=x['inputManifestHash'],sources=x['sources'],text_artifacts=x['textArtifacts'])
extract_source_declarations(x)
b=build_matrix_execution(object_id=x['objectId'],input_manifest_hash=x['inputManifestHash'],sources=x['sources'],text_artifacts=x['textArtifacts'])
json.dump({'before':a,'after':b},sys.stdout,ensure_ascii=False)`,x);
    expect(baseline.after).toEqual(baseline.before);expect(buildMatrixSubmission(baseline.before,x.objectId)).toEqual(buildMatrixSubmission(baseline.after,x.objectId));
    const sources=(x.sources as any[]).map(s=>({...s,review:{revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",sectionCode:s.sectionCode},textArtifact:(x.textArtifacts as any[]).find(a=>a.sourceFileId===s.sourceFileId)}));
    const context={objectId:x.objectId,inputManifestHash:x.inputManifestHash,sources};
    expect(validateMatrixExecution(baseline.before,context)).not.toBeNull();
    expect(baseline.before.observations.length).toBeGreaterThan(0);expect(baseline.before.results.length).toBeGreaterThan(0);
    for(const field of ["criterion","minutes","constructionLabelLines","headerFragments","unitFragments","bindingPolicyVersion","tableBoxMilliPoints","tablePolicyHash"]){
      for(const placement of ["root","observation","result"]){const forged=structuredClone(baseline.before);
        const row=placement==="root"?forged:placement==="observation"?forged.observations[0]:forged.results[0];
        row[field]=field==="minutes"?120:"FORGED";
        // Existing scalar IDs remain valid: these extra fields were never part of their signed preimage.
        expect(validateMatrixExecution(forged,context)).toBeNull();
      }
    }
  });
  it("rejects accessor inputs before invoking getters, including source stages and full artifact leaves",()=>{
    for(const target of ["stage","source","array","artifact"]){const x=input() as any;let calls=0;const get=()=>{calls++;return "PD";};
      if(target==="stage")Object.defineProperty(x.sources[0].stages,"0",{enumerable:true,get});
      if(target==="source")Object.defineProperty(x.sources[0],"pageStages",{enumerable:true,get});
      if(target==="array")Object.defineProperty(x.textArtifacts,"0",{enumerable:true,get});
      if(target==="artifact")Object.defineProperty(x.textArtifacts[0].pages[0],"widthMilliPoints",{enumerable:true,get});
      expect(()=>extractSourceDeclarationsV2(x)).toThrow();expect(calls).toBe(0);
    }
  });
});

const legacyGolden=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-wrapper-golden.json",import.meta.url),"utf8"));
const legacyAttacks=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-wrapper-boundary-goldens.json",import.meta.url),"utf8"));
function v2Envelope(value:any){return value&&typeof value==="object"?{...value,schemaVersion:"matrix-source-declarations-v2",extractorVersion:"matrix-source-declarations-v2"}:value;}
function setPath(value:any,path:Array<string|number>,next:unknown){let target=value;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)!]=structuredClone(next);}
describe("v2 preserves 87 frozen full-input and rehashed-steel boundary goldens",()=>{
  it.each(legacyAttacks.cases as any[])("$name",test=>{
    const x=structuredClone(legacyGolden.input),raw=v2Envelope(structuredClone(legacyGolden.expected)),op=test.operation;
    if(op.kind==="set-input-path")setPath(x,op.path,op.value);
    else if(op.kind==="source-stage-policy"){x.sources[op.sourceIndex].stages=op.stages;x.sources[op.sourceIndex].pageStages=op.pageStages;}
    else if(op.kind==="rename-source"){const source=x.sources[op.sourceIndex],artifact=x.textArtifacts.find((a:any)=>a.sourceFileId===source.sourceFileId);source.sourceFileId=op.sourceFileId;artifact.sourceFileId=op.sourceFileId;}
    else if(op.kind==="forge-declaration-path"){const d=raw.declarations[op.declarationIndex];setPath(d,op.path,op.value);if(op.recomputeId)d.id=sourceDeclarationId(d);}
    else if(op.kind!=="raw-output")throw Error("Unknown frozen boundary operation");
    if(test.expected==="THROW_VALUE_ERROR")expect(()=>extractSourceDeclarationsV2(x)).toThrow();
    else if(op.kind==="forge-declaration-path"||op.kind==="raw-output")expect(validateSourceDeclarationsV2(op.kind==="raw-output"?v2Envelope(op.raw):raw,x)).toEqual(test.expected);
    else expect(extractSourceDeclarationsV2(x)).toEqual(v2Envelope(test.expected));
  });
});
