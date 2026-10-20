import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MatrixExecutionRead, MatrixSourceDeclarations } from "@inspector-ai/contracts";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { MATRIX_STEEL_PROFILE as MATRIX_PROFILE, MATRIX_CONSTRAINTS_PROFILE, MATRIX_LEGACY_PROFILE, matrixPolicyForProfile } from "../src/matrix-execution.js";
import { sourceDeclarationId } from "../src/matrix-source-declarations.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const original=JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-full43-fixture.json",import.meta.url),"utf8"));
const executionScript=`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.project_constraints import extract_project_constraints
from inspector_worker.source_declarations import extract_source_declarations
from inspector_worker.durable_pz002 import _reviewed_source
x=json.load(sys.stdin);lease=x['lease'];sources=[]
for s in lease['inputs']['sourceFiles']:
 d=lease['inputs']['sourceDecisions'].get(s['sourceFileId']);sources.append({**s,**_reviewed_source(s,d),'scopeProofs':(d or {}).get('scopeProofs',{})})
args={'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':x['artifacts']}
json.dump({'execution':build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=x['artifacts']),
'projectConstraints':extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,x['artifacts']),
'sourceDeclarations':extract_source_declarations(args)},sys.stdout,ensure_ascii=False)`;

type Fixture={objectId:string;actor:AuthenticatedActor;files:any[];artifacts:any[]};
(adminUrl?describe:describe.skip)("immutable source declaration evidence PostgreSQL",{timeout:60_000},()=>{
  const databaseName=`declaration_it_${randomUUID().replaceAll("-","")}`;
  let admin:Pool,database:Pool,repository:PostgresInspectionRepository,connection:string;
  const previousOcr=process.env.INSPECTOR_MATRIX_OCR_LAYOUT;
  async function open(){const reference=await loadReferenceData();return PostgresInspectionRepository.create({connectionString:connection,parameters:reference.parameters,analysisProfile:"MATRIX_V1",organizationSlug:"declaration-it"});}
  beforeAll(async()=>{
    delete process.env.INSPECTOR_MATRIX_OCR_LAYOUT;
    admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url=new URL(adminUrl!);url.pathname=`/${databaseName}`;connection=url.toString();
    await runDatabaseMigrations(connection);
    database=new Pool({connectionString:connection,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});
    repository=await open();
  });
  afterAll(async()=>{
    if(previousOcr===undefined)delete process.env.INSPECTOR_MATRIX_OCR_LAYOUT;else process.env.INSPECTOR_MATRIX_OCR_LAYOUT=previousOcr;
    await repository?.close();await database?.end();
    if(admin)try{await admin.query("SET statement_timeout=10000");await admin.query("SET lock_timeout=5000");
      expect((await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1",[databaseName])).rows[0].n).toBe(0);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    }finally{await admin.end();}
  });
  async function fixture():Promise<Fixture>{
    const object=await repository.createObject({name:"Public original steel source declaration fixture",address:"Москва"});
    const user=await provisionLocalUser(database,{organizationSlug:"declaration-it",login:`evidence-${randomUUID()}`,displayName:"Evidence reviewer",password:"Evidence-Test-2026!",objectApiIds:[object.id],objectPermissions:["READ","REVIEW_DECIDE"]});
    const actor:AuthenticatedActor={sessionId:randomUUID(),userId:user.id,organizationId:user.organizationId,displayName:"Evidence reviewer",roles:["INSPECTOR"],capabilities:["SOURCE_REVIEW"],csrfHash:"x",expiresAt:"2030-01-01T00:00:00Z"};
    const files=original.sources.map((row:any)=>({id:`FIL-${randomUUID()}`,name:`${row.source.file_id}-original.pdf`,size:row.source.size_bytes,stage:row.source.stage,mimeType:"application/pdf",sha256:row.source.sha256,scanStatus:"CLEAN",status:"STORED",storageKey:`objects/${object.id}/${row.source.file_id}.pdf`}));
    await repository.registerIngestedFiles(object.id,files);
    const artifacts=original.sources.map((row:any,index:number)=>({...structuredClone(row.sourceArtifact),sourceFileId:files[index].id}));
    return {objectId:object.id,actor,files,artifacts};
  }
  async function read(checkId:string,actor:AuthenticatedActor):Promise<MatrixExecutionRead & {sourceDeclarations?:MatrixSourceDeclarations}>{const result=await repository.getMatrixExecution(checkId,actor);if(!result||typeof result==="string")throw Error("Saved declaration execution missing");return result as MatrixExecutionRead & {sourceDeclarations?:MatrixSourceDeclarations};}
  async function run(f:Fixture,profile=MATRIX_PROFILE,attacks=false){
    const policy=matrixPolicyForProfile(profile)!;
    const owner=repository as any,base=owner.ensureAnalysisRelease.bind(repository);
    const spy=vi.spyOn(owner,"ensureAnalysisRelease").mockImplementation(async(...args:any[])=>{
      const release=await base(...args);const {releaseId:_id,...previous}=release.manifest;
      const identity={...previous,rules:{...previous.rules,matrixDefinitions:policy.definitions},providerSlots:previous.providerSlots.map((slot:any)=>slot.stageJobType==="RULE_EVALUATION"?{...slot,profileId:policy.profileId,adapterVersion:policy.adapterVersion,configHash:policy.configHash}:slot)};
      const manifest={...identity,releaseId:`release:matrix-v1:${sha256(canonicalJson(identity)).slice(0,24)}`},text=canonicalJson(manifest);
      await args[0].query(`INSERT INTO analysis_releases(release_id,schema_version,lifecycle,content_hash,byte_size,content_json,external_network_allowed)
        VALUES($1,'analysis-release-v1','DRAFT',$2,$3,$4::jsonb,false) ON CONFLICT DO NOTHING`,[manifest.releaseId,sha256(text),Buffer.byteLength(text),text]);
      return {manifest,canonical:text,contentHash:sha256(text),byteSize:Buffer.byteLength(text)};
    });
    let check;try{check=await repository.startCheck(f.objectId);}finally{spy.mockRestore();}
    if(!check)throw Error("Check missing");
    const scaffold:Record<string,string[]>={DOCUMENT_RENDER:["PROVIDER_NOT_CONFIGURED","RENDERER_PROFILE_NOT_SELECTED","RENDERER"],DOCUMENT_OCR_LAYOUT:["PROVIDER_NOT_CONFIGURED","OCR_LAYOUT_PROFILE_NOT_SELECTED","OCR_LAYOUT"],DOCUMENT_METADATA:["PROVIDER_NOT_CONFIGURED","METADATA_PROFILE_NOT_SELECTED","METADATA_EXTRACTOR"],DOCUMENT_LINKING:["POLICY_NOT_CONFIGURED","LINKING_POLICY_NOT_SELECTED","LINKING_POLICY"],ENTITY_EXTRACTION:["PROVIDER_NOT_CONFIGURED","ENTITY_EXTRACTION_PROFILE_NOT_SELECTED","ENTITY_EXTRACTION_MODEL"],EVIDENCE_VALIDATION:["NO_MACHINE_RESULTS","RULE_RESULTS_UNAVAILABLE","EVIDENCE_VALIDATOR"]};
    let accepted:any;
    for(let step=0;step<16;step++){
      const ready=await database.query(`SELECT job.id,job.job_type FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.state='READY' ORDER BY job.created_at LIMIT 1`,[check.id]);
      if(!ready.rows.length)break;const job=ready.rows[0];const claim=await repository.claimJob(job.id,{workerId:"declaration-it",capabilities:[job.job_type]});
      expect(claim.kind).toBe("acquired");if(claim.kind!=="acquired")throw Error("Claim failed");const lease=claim.lease;let result:any;
      if(job.job_type==="ANALYSIS_INVENTORY")result={disposition:"MANIFEST_INVENTORIED",sourceCount:2,stageCounts:{PD:1,RD:1,ID:0}};
      else if(job.job_type==="DOCUMENT_TEXT_LAYER")result={disposition:"DOCUMENT_TEXT_LAYER_COMPLETED",sources:f.artifacts.map(artifact=>({sourceFileId:artifact.sourceFileId,inputSha256:artifact.inputSha256,status:"EXTRACTED",artifact}))};
      else if(job.job_type==="RULE_EVALUATION"){
        const proc=spawnSync(pythonExecutable,["-c",executionScript],{input:JSON.stringify({lease,artifacts:f.artifacts}),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:20000,maxBuffer:32*1024*1024});
        expect(proc.status,proc.stderr).toBe(0);const all=JSON.parse(proc.stdout);
        result={schemaVersion:"analysis-stage-result-v2",jobType:job.job_type,inputManifestHash:lease.inputManifestHash,disposition:"RULES_EVALUATED",providerKind:"RULE_ENGINE",providerProfileId:policy.profileId,providerConfigHash:policy.configHash,outputCount:all.execution.results.length,execution:all.execution,...(policy.projectConstraints?{projectConstraints:all.projectConstraints}:{}),...(policy.sourceDeclarations?{sourceDeclarations:all.sourceDeclarations}:{})};
        const completion=(changed:any)=>repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result:changed});
        const expectRejected=async(changed:any)=>{
          expect((await completion(changed)).kind).toBe("invalid_state");
          expect((await database.query("SELECT count(*)::int n FROM analysis_stage_artifacts WHERE job_id=$1",[job.id])).rows[0].n).toBe(0);
          expect((await database.query("SELECT count(*)::int n FROM machine_prediction_snapshots WHERE run_id=$1",[lease.runId])).rows[0].n).toBe(0);
        };
        if(attacks&&policy.sourceDeclarations){
          for(const key of ["sourceDeclarations","projectConstraints"]){const changed=structuredClone(result);delete changed[key];await expectRejected(changed);}
          for(const field of ["value","productScope","rawText","sourceSha256","textArtifactHash","pageNumber","entityKey","probability"]){
            const changed=structuredClone(result),fact=changed.sourceDeclarations.declarations[0];
            if(field==="rawText")fact.primaryFragments[0].rawText+=" FORGED";
            else if(field==="productScope")fact.productScope.tier=9;
            else fact[field]=field==="pageNumber"?1:field==="value"?"С345":field.endsWith("Hash")||field.endsWith("Sha256")?"f".repeat(64):"FORGED";
            fact.id=sourceDeclarationId(fact);await expectRejected(changed);
          }
          for(const declarations of [[],[...all.sourceDeclarations.declarations].reverse(),[...all.sourceDeclarations.declarations,all.sourceDeclarations.declarations[0]]])await expectRejected({...result,sourceDeclarations:{...all.sourceDeclarations,declarations}});
          const scalar=structuredClone(result);scalar.execution.sourceDeclarations=all.sourceDeclarations;await expectRejected(scalar);
          await expectRejected({...result,outputCount:result.outputCount+all.sourceDeclarations.declarations.length});
          await expectRejected({...result,providerConfigHash:"f".repeat(64)});
        }
        if(!policy.sourceDeclarations)await expectRejected({...result,sourceDeclarations:all.sourceDeclarations});
        if(!policy.projectConstraints)await expectRejected({...result,projectConstraints:all.projectConstraints});
        accepted=structuredClone(result);
      }else if(job.job_type==="ANALYSIS_SEAL_UNSUPPORTED")result={disposition:"UNSUPPORTED_COVERAGE_SEALED",workerId:"declaration-it"};
      else{const fields=scaffold[job.job_type];if(!fields)throw Error(`Unexpected job ${job.job_type}`);const [disposition,reasonCode,providerKind]=fields;result={schemaVersion:"analysis-stage-result-v1",jobType:job.job_type,inputManifestHash:lease.inputManifestHash,disposition,reasonCode,providerKind,providerProfileId:null,providerConfigHash:null,outputCount:0};}
      const done=await repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result});expect(done.kind,job.job_type+":"+JSON.stringify(done)).toBe("completed");
    }
    const saved=await read(check.id,f.actor);expect(await repository.getCheck(check.id,f.actor)).toMatchObject({status:"PARTIAL",progress:100});
    return {checkId:check.id,saved,accepted};
  }
  async function frozen(checkId:string){
    const saved=await database.query(`SELECT stage.content_json,stage.content_hash,snapshot.submission_bytes,snapshot.submission_hash FROM analysis_runs run JOIN analysis_stage_artifacts stage ON stage.run_id=run.id AND stage.job_type='RULE_EVALUATION' JOIN machine_prediction_snapshots snapshot ON snapshot.run_id=run.id WHERE run.api_id=$1`,[checkId]);
    const row=saved.rows[0];expect(sha256(canonicalJson(row.content_json))).toBe(row.content_hash.trim());expect(sha256(row.submission_bytes)).toBe(row.submission_hash.trim());
    return {content:canonicalJson(row.content_json),hash:row.content_hash.trim(),submission:row.submission_bytes.toString("utf8"),submissionHash:row.submission_hash.trim()};
  }
  it("seals independently reconstructed full43 source declarations, rejects rehashed forgeries atomically and exposes zero qualification/review targets",async()=>{
    const f=await fixture(),result=await run(f,MATRIX_PROFILE,true),out=result.saved;
    expect(out.sourceDeclarations?.declarations.map(d=>[d.stage,d.pageNumber,d.value,d.primaryFragments.length,d.scopeFragments.length]).sort()).toEqual([["PD",14,"С245",1,3],["RD",4,"С245",2,3]]);
    expect(out.sourceDeclarations?.declarations.every(d=>d.entityKey===null&&d.applicabilityStatus==="UNREVIEWED")).toBe(true);
    expect(out.execution.results.filter(r=>r.qualified)).toHaveLength(0);expect(out.execution.coverage).toHaveLength(132);
    expect(out.execution.coverage.filter(c=>c.executionStatus==="UNSUPPORTED")).toHaveLength(77);
    expect(out.execution).not.toHaveProperty("sourceDeclarations");expect(out.execution.observations.some(o=>(o as any).productScope)).toBe(false);
    const targets=await repository.getMatrixFactTargets(result.checkId,f.actor);if(!targets||typeof targets==="string")throw Error("Targets missing");
    const ids=new Set(out.sourceDeclarations!.declarations.map(d=>d.id));expect(targets.items.some(t=>ids.has(t.target.observationId))).toBe(false);
    for(const file of f.files)expect(await repository.getSourceReview(f.objectId,file.id,f.actor)).toBeUndefined();
    const before=await frozen(result.checkId);await repository.close();repository=await open();
    expect(canonicalJson(await read(result.checkId,f.actor))).toBe(canonicalJson(out));expect(await frozen(result.checkId)).toEqual(before);
    expect(await repository.getMatrixExecution(result.checkId,{...f.actor,userId:randomUUID()})).toBeUndefined();
    await expect(database.query("UPDATE analysis_stage_artifacts SET content_json='{}' WHERE provider_profile_id=$1",[MATRIX_PROFILE])).rejects.toThrow();
  });
  it("retains v1/v2 saved profile semantics, exact scalar IDs/coverage/submission and historical hashes across v3 and API restart",async()=>{
    const f=await fixture(),old=[];
    for(const profile of [MATRIX_LEGACY_PROFILE,MATRIX_CONSTRAINTS_PROFILE,MATRIX_PROFILE])old.push(await run(f,profile));
    const [v1,v2,v3]=old;
    expect(v1.saved).not.toHaveProperty("projectConstraints");expect(v1.saved).not.toHaveProperty("sourceDeclarations");
    expect(v2.saved.projectConstraints).toMatchObject({purpose:"EVIDENCE_ONLY"});expect(v2.saved).not.toHaveProperty("sourceDeclarations");expect(v3.saved.sourceDeclarations?.declarations).toHaveLength(2);
    expect(v1.saved.execution.observations).toEqual(v3.saved.execution.observations);expect(v2.saved.execution.observations).toEqual(v3.saved.execution.observations);
    expect(v1.saved.execution.results).toEqual(v3.saved.execution.results);expect(v1.saved.execution.coverage).toEqual(v3.saved.execution.coverage);
    const snapshots=await Promise.all(old.map(r=>frozen(r.checkId)));expect(snapshots[0].submission).toBe(snapshots[2].submission);expect(snapshots[1].submission).toBe(snapshots[2].submission);expect(new Set(snapshots.map(s=>s.hash)).size).toBe(3);
    await repository.close();repository=await open();
    for(const [i,r] of old.entries()){expect(canonicalJson(await read(r.checkId,f.actor))).toBe(canonicalJson(r.saved));expect(await frozen(r.checkId)).toEqual(snapshots[i]);}
  });
  it("retains stricter source-review API stage guards without granting declarations approval",async()=>{
    const f=await fixture(),baseline=await run(f),pd=f.files.find(file=>file.stage==="PD")!;
    const before=await frozen(baseline.checkId);
    for(const stage of ["PD","UNRESOLVED"] as const){
      const saved=await repository.recordSourceReviewCommand(f.objectId,pd.id,{sourceSha256:pd.sha256,revisionStatus:"UNKNOWN",approvalStatus:"UNKNOWN",linkGroupId:null,sectionCode:"KR",pageStages:{14:stage},basis:{reference:"Single-stage source must retain existing API restriction"},expectedReviewHash:null},{actor:f.actor,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()});
      expect(saved).toMatchObject({kind:"invalid_state",code:"SOURCE_STAGE_MISMATCH"});
    }
    expect(await repository.getSourceReview(f.objectId,pd.id,f.actor)).toBeUndefined();
    expect((await read(baseline.checkId,f.actor)).sourceDeclarations?.declarations).toHaveLength(2);
    expect(await frozen(baseline.checkId)).toEqual(before);
  });
});
