import {loadAuthenticatedInventoryPreparation} from '../src/matrix-inventory-loader.js';
import {buildCallInventoryComparisons} from '../src/matrix-call-inventory-execution.js';
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MatrixExecutionRead, MatrixFireResistanceSourceDeclaration, MatrixSourceDeclarationV2 } from "@inspector-ai/contracts";
import { runDatabaseMigrations } from "../src/database-migrations.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import { loadReferenceData } from "../src/reference-data.js";
import { provisionLocalUser } from "../src/user-provisioning.js";
import type { AuthenticatedActor } from "../src/identity.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { MATRIX_PROFILE, MATRIX_STEEL_PROFILE, MATRIX_CONSTRAINTS_PROFILE, MATRIX_LEGACY_PROFILE, matrixPolicyForProfile } from "../src/matrix-execution.js";
import { sourceDeclarationId } from "../src/matrix-source-declarations.js";
import { pythonExecutable, pythonEnv } from "./python.js";

const adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const fixtureRoot=new URL("../../../services/worker/tests/fixtures/matrix-call-inventory-v1/",import.meta.url);
const authored=JSON.parse(readFileSync(new URL("research-call-original-manifest-before-extraction.json",fixtureRoot),"utf8")).originals.map((x:any)=>({...x,sourceSha256:x.originalSha256,pdfBytes:x.originalBytes,artifact:`research-call-${x.name}.text.json`}));
const inventoryOracle=JSON.parse(readFileSync(new URL("research-call-authored-goldens.json",fixtureRoot),"utf8"));
const original={sources:['pd-button','rd-system'].map(name=>{const row=authored.find((x:any)=>x.name===name);return {source:{file_id:row.sourceFileId,size_bytes:row.pdfBytes,stage:row.stage,sha256:row.sourceSha256},sourceArtifact:JSON.parse(readFileSync(new URL(row.artifact,fixtureRoot),'utf8'))};})};
const executionScript=`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.project_constraints import extract_project_constraints
from inspector_worker.source_declarations import extract_source_declarations
from inspector_worker.source_declarations_v2 import extract_source_declarations as extract_source_declarations_v2
from inspector_worker.durable_pz002 import _reviewed_source
x=json.load(sys.stdin);lease=x['lease'];sources=[]
for s in lease['inputs']['sourceFiles']:
 d=lease['inputs']['sourceDecisions'].get(s['sourceFileId']);sources.append({**s,**_reviewed_source(s,d),'scopeProofs':(d or {}).get('scopeProofs',{})})
args={'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':x['artifacts']}
json.dump({'execution':build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=x['artifacts']),
'projectConstraints':extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,x['artifacts']),
'sourceDeclarations':(extract_source_declarations_v2(args) if x['v2'] else extract_source_declarations(args))},sys.stdout,ensure_ascii=False)`;

type Fixture={objectId:string;actor:AuthenticatedActor;files:any[];artifacts:any[]};
(adminUrl?describe:describe.skip)("authenticated immutable call inventory reviews PostgreSQL",{timeout:120_000},()=>{
  const databaseName=`call_inventory_it_${randomUUID().replaceAll("-","")}`;
  let admin:Pool,database:Pool,repository:PostgresInspectionRepository,connection:string;
  const previousOcr=process.env.INSPECTOR_MATRIX_OCR_LAYOUT;
  async function open(){const reference=await loadReferenceData();return PostgresInspectionRepository.create({connectionString:connection,parameters:reference.parameters,analysisProfile:"MATRIX_V1",organizationSlug:"inventory-review-it"});}
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
  async function fixture(rd='rd-system'):Promise<Fixture>{
    const selectedOriginal={sources:['pd-button',rd].map(name=>{const row=authored.find((x:any)=>x.name===name);return {source:{file_id:row.sourceFileId,size_bytes:row.pdfBytes,stage:row.stage,sha256:row.sourceSha256},sourceArtifact:JSON.parse(readFileSync(new URL(row.artifact,fixtureRoot),'utf8'))};})};
    const object=await repository.createObject({name:"T44 SYNTHETIC ONLY call review fixture",address:"Москва"});
    const user=await provisionLocalUser(database,{organizationSlug:"inventory-review-it",login:`evidence-${randomUUID()}`,displayName:"Evidence reviewer",password:"Evidence-Test-2026!",objectApiIds:[object.id],objectPermissions:["READ","REVIEW_DECIDE"]});
    const actor:AuthenticatedActor={sessionId:randomUUID(),userId:user.id,organizationId:user.organizationId,displayName:"Evidence reviewer",roles:["INSPECTOR"],capabilities:["SOURCE_REVIEW"],csrfHash:"x",expiresAt:"2030-01-01T00:00:00Z"};
    const files:any[]=selectedOriginal.sources.map((row:any)=>({id:`FIL-${randomUUID()}`,name:`${row.source.file_id}-original.pdf`,size:row.source.size_bytes,stage:row.source.stage,mimeType:"application/pdf",sha256:row.source.sha256,scanStatus:"CLEAN",status:"STORED",storageKey:`objects/${object.id}/${row.source.file_id}.pdf`}));
    await repository.registerIngestedFiles(object.id,files);
    const artifacts=selectedOriginal.sources.map((row:any,index:number)=>({...structuredClone(row.sourceArtifact),sourceFileId:files[index].id}));
    return {objectId:object.id,actor,files,artifacts};
  }
  async function read(checkId:string,actor:AuthenticatedActor):Promise<MatrixExecutionRead>{const result=await repository.getMatrixExecution(checkId,actor);if(!result||typeof result==="string")throw Error("Saved declaration execution missing");return result;}
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
      if(!ready.rows.length)break;const job=ready.rows[0];const claim=await repository.claimJob(job.id,{workerId:"inventory-review-it",capabilities:[job.job_type]});
      expect(claim.kind).toBe("acquired");if(claim.kind!=="acquired")throw Error("Claim failed");const lease=claim.lease;let result:any;
      if(job.job_type==="ANALYSIS_INVENTORY")result={disposition:"MANIFEST_INVENTORIED",sourceCount:2,stageCounts:{PD:1,RD:1,ID:0}};
      else if(job.job_type==="DOCUMENT_TEXT_LAYER")result={disposition:"DOCUMENT_TEXT_LAYER_COMPLETED",sources:f.artifacts.map(artifact=>({sourceFileId:artifact.sourceFileId,inputSha256:artifact.inputSha256,status:"EXTRACTED",artifact}))};
      else if(job.job_type==="RULE_EVALUATION"){
        const proc=spawnSync(pythonExecutable,["-c",executionScript],{input:JSON.stringify({lease,artifacts:f.artifacts,v2:profile===MATRIX_PROFILE}),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:30000,maxBuffer:48*1024*1024});
        expect(proc.status,proc.stderr).toBe(0);const all=JSON.parse(proc.stdout);
        result={schemaVersion:"analysis-stage-result-v2",jobType:job.job_type,inputManifestHash:lease.inputManifestHash,disposition:"RULES_EVALUATED",providerKind:"RULE_ENGINE",providerProfileId:policy.profileId,providerConfigHash:policy.configHash,outputCount:all.execution.results.length,execution:all.execution,...(policy.projectConstraints?{projectConstraints:all.projectConstraints}:{}),...(policy.sourceDeclarations?{sourceDeclarations:all.sourceDeclarations}:{})};
        accepted=structuredClone(result);
      }else if(job.job_type==="ANALYSIS_SEAL_UNSUPPORTED")result={disposition:"UNSUPPORTED_COVERAGE_SEALED",workerId:"inventory-review-it"};
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
  const command=(actor:AuthenticatedActor)=>({actor,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()});
  async function request(f:Fixture,checkId:string,index=0){
    const pages=await repository.getMatrixCallInventorySourcePages(checkId,f.files[index].id,f.actor);
    if(!pages||typeof pages==='string')throw Error('Pages unavailable');
    const originalFixture=inventoryOracle.fixtures.find((x:any)=>x.name===authored.find((r:any)=>r.sourceSha256===f.files[index].sha256).name);
    const selected=originalFixture.expected.inventory;
    const selection={pageNumber:selected.pageNumber,regionBoxMilliPoints:selected.regionBoxMilliPoints,
      headerFragments:selected.headerFragments,scopeFragments:selected.scopeFragments,endFragments:selected.endFragments};
    const preview=await repository.previewMatrixCallInventorySource(checkId,f.files[index].id,selection,f.actor);
    if(!preview||typeof preview==='string'||!preview.target||preview.result.status!=='RECONSTRUCTED')throw Error('Preview unavailable');
    return {pages,preview,input:{sourceSha256:f.files[index].sha256,revisionStatus:'CURRENT' as const,approvalStatus:'APPROVED' as const,
      linkGroupId:'same-room',sectionCode:'SS' as const,pageStages:{},basis:{reference:'Проверены исходные строки перечня'},expectedReviewHash:pages.latestReviewHash,
      callInventoryScope:{schemaVersion:'matrix-odi123-call-inventory-review-v1' as const,claims:[{target:preview.target,selection,
        identity:{entityKey:'accessible-room-one',buildingKey:'building-one',floorKey:'floor-one',roomKey:'room-one',componentRole:'ACCESSIBLE_SANITARY_ROOM_CALL_SYSTEM' as const,systemKind:'PERSONNEL_CALL' as const},
        roomMapping:{kind:'HUMAN_REVIEWED_ACCESSIBLE_ROOM_MAPPING' as const,sourceRoomToken:selected.roomToken,assertion:'HUMAN_ASSERTED_SAME_ACCESSIBLE_ROOM' as const},
        assertion:'HUMAN_ASSERTED_COMPLETE' as const,reference:'Просмотрены все исходные строки области'}]}}};
  }

  it('materializes exact original call inventories and binds full review hashes without scalar authority',async()=>{
    const f=await fixture(),initial=await run(f),before=await frozen(initial.checkId);
    for(let i=0;i<2;i++){
      const {pages,preview,input}=await request(f,initial.checkId,i);
      expect(pages.textArtifact).toEqual(f.artifacts[i]);
      expect(await repository.getMatrixCallInventorySourcePages(initial.checkId,f.files[i].id,{...f.actor,userId:randomUUID()})).toBeUndefined();
      const cmd=command(f.actor),saved=await repository.recordSourceReviewCommand(f.objectId,f.files[i].id,input,cmd);
      expect(saved.kind).toBe('success');if(saved.kind!=='success')throw Error(JSON.stringify(saved));
      expect(saved.value.callInventoryScope!.claims[0].inventorySnapshot).toEqual(preview.result.status==='RECONSTRUCTED'?preview.result.inventory:null);
      expect(saved.value.callInventoryScope!.claims[0].inventorySnapshot.featureRows.map(r=>r.featureKey)).toEqual(i===0?['PERSONNEL_CALL_BUTTON']:['TWO_WAY_COMMUNICATION_SYSTEM']);
      expect(await repository.getSourceReview(f.objectId,f.files[i].id,f.actor)).toEqual(saved.value);
      expect(await repository.recordSourceReviewCommand(f.objectId,f.files[i].id,input,cmd)).toMatchObject({kind:'success',replayed:true,value:saved.value});
    }
    expect(await frozen(initial.checkId)).toEqual(before);
    const next=await run(f);expect(next.saved.execution.observations).toEqual(initial.saved.execution.observations);expect(next.saved.execution.results).toEqual(initial.saved.execution.results);expect(next.saved.execution.coverage).toEqual(initial.saved.execution.coverage);expect((await frozen(next.checkId)).submission).toBe(before.submission);
    const target=(await database.query('SELECT id,object_id FROM analysis_runs WHERE api_id=$1',[next.checkId])).rows[0];
    const client=await database.connect();
    try{
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const prepared=await loadAuthenticatedInventoryPreparation(client,{runId:target.id,objectId:target.object_id,organizationId:f.actor.organizationId,requireSealed:true},(c,r,o)=>(repository as any).loadAuthenticatedZu127GenericInputs(c,r,o));
      expect(prepared.package.sources).toHaveLength(2);expect(prepared.callPackage.sources).toHaveLength(2);expect(prepared.callPackage.origins).toHaveLength(2);expect(prepared.callPackage.identities).toHaveLength(1);
      const result=buildCallInventoryComparisons(prepared.callPackage);expect(result.results).toHaveLength(1);expect(result.results[0]).toMatchObject({kind:'SCOPED_COMPARISON',comparison:{status:'CANDIDATE',calibratedProbability:null,missingFeatureKeys:['PERSONNEL_CALL_BUTTON']}});
      const row=result.results[0];if(row.kind!=='SCOPED_COMPARISON'||row.comparison.status!=='CANDIDATE')throw Error('Candidate missing');
      expect([row.comparison.expected.sourceFileId,row.comparison.actual.sourceFileId]).toEqual(f.files.map(x=>x.id));
    }finally{await client.query('ROLLBACK');client.release();}

    await repository.close();repository=await open();expect(await repository.getSourceReview(f.objectId,f.files[0].id,f.actor)).toHaveProperty('callInventoryScope');
  });
  it('preserves omitted call sibling only under latest CAS, UNKNOWN mapping/completeness, and explicit withdrawal',async()=>{
    const f=await fixture(),initial=await run(f),{input}=await request(f,initial.checkId);
    const first=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,input,command(f.actor));if(first.kind!=='success')throw Error(JSON.stringify(first));
    const {callInventoryScope:_scope,expectedReviewHash:_cas,...legacy}=input;
    expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,legacy,command(f.actor))).toMatchObject({kind:'invalid_state',code:'SOURCE_REVIEW_STALE'});
    expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,expectedReviewHash:null},command(f.actor))).toMatchObject({kind:'invalid_state',code:'SOURCE_REVIEW_STALE'});
    const unknown=structuredClone(input);unknown.expectedReviewHash=first.value.contentHash;unknown.callInventoryScope.claims[0].assertion='UNKNOWN' as any;unknown.callInventoryScope.claims[0].roomMapping.assertion='UNKNOWN' as any;
    const second=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,unknown,command(f.actor));if(second.kind!=='success')throw Error(JSON.stringify(second));
    expect(second.value.callInventoryScope!.claims[0]).toMatchObject({assertion:'UNKNOWN',roomMapping:{assertion:'UNKNOWN'}});
    const preserved=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,approvalStatus:'UNKNOWN',expectedReviewHash:second.value.contentHash},command(f.actor));if(preserved.kind!=='success')throw Error(JSON.stringify(preserved));
    expect(preserved.value.callInventoryScope).toEqual(second.value.callInventoryScope);
    const withdrawn=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,expectedReviewHash:preserved.value.contentHash,callInventoryScope:{schemaVersion:'matrix-odi123-call-inventory-review-v1',claims:[]}},command(f.actor));if(withdrawn.kind!=='success')throw Error(JSON.stringify(withdrawn));
    expect(withdrawn.value.callInventoryScope!.claims).toEqual([]);
    await expect(database.query('UPDATE source_review_decisions SET call_inventory_scope=NULL WHERE id=$1',[first.value.id])).rejects.toThrow();
    const concurrent=await Promise.all(['Concurrent call review first','Concurrent call review second'].map(reference=>repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,basis:{reference},expectedReviewHash:withdrawn.value.contentHash},command(f.actor))));
    expect(concurrent.filter(x=>x.kind==='success')).toHaveLength(1);expect(concurrent.filter(x=>x.kind==='invalid_state')).toHaveLength(1);
    await expect(database.query(readFileSync(new URL('../../../migrations/rollback/035_matrix_call_inventory_scope.sql',import.meta.url),'utf8'))).rejects.toThrow(/call|history/i);
  });
  it('rejects forged target/selection/end and cross-object origins with zero partial writes',async()=>{
    const f=await fixture(),initial=await run(f),{input}=await request(f,initial.checkId);
    const before=Number((await database.query('SELECT count(*)::int n FROM source_review_decisions')).rows[0].n);
    for(const mutate of [
      (x:any)=>x.callInventoryScope.claims[0].target.checkId='CHK-unknown',
      ...['inputManifestHash','textStageContentHash','textArtifactHash','inventoryContentHash'].map(k=>(x:any)=>x.callInventoryScope.claims[0].target[k]='f'.repeat(64)),
      ...['headerFragments','scopeFragments','endFragments'].map(k=>(x:any)=>x.callInventoryScope.claims[0].selection[k][0].rawText+=' forged'),
      (x:any)=>x.callInventoryScope.claims[0].selection.regionBoxMilliPoints[0]++
    ]){
      const changed=structuredClone(input);mutate(changed);const cmd=command(f.actor);
      expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,changed,cmd)).toMatchObject({kind:'invalid_state',code:'CALL_INVENTORY_SNAPSHOT_MISMATCH'});
      expect(Number((await database.query('SELECT count(*)::int n FROM source_review_decisions')).rows[0].n)).toBe(before);
      expect((await database.query('SELECT count(*)::int n FROM command_receipts WHERE idempotency_key=$1',[cmd.idempotencyKey])).rows[0].n).toBe(0);
    }
    const other=await fixture(),origin=await run(other),changed=structuredClone(input);changed.callInventoryScope.claims[0].target.checkId=origin.checkId;
    expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,changed,command(f.actor))).toMatchObject({kind:'invalid_state',code:'CALL_INVENTORY_SNAPSHOT_MISMATCH'});
    const injected:any=structuredClone(input);injected.callInventoryScope.claims[0].inventorySnapshot={};await expect(repository.recordSourceReviewCommand(f.objectId,f.files[0].id,injected,command(f.actor))).rejects.toThrow();
    const pending=await repository.startCheck(f.objectId);if(!pending)throw Error('Pending missing');expect(await repository.getMatrixCallInventorySourcePages(pending.id,f.files[0].id,f.actor)).toBeUndefined();
  });
  it('preserves absent legacy preimage and binds empty withdrawal as a distinct new history row',async()=>{
    const f=await fixture(),input={sourceSha256:f.files[0].sha256,revisionStatus:'UNKNOWN' as const,approvalStatus:'UNKNOWN' as const,linkGroupId:null,pageStages:{},basis:{reference:'Legacy call source review unchanged'}};
    const first=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,input,command(f.actor));if(first.kind!=='success')throw Error(JSON.stringify(first));
    expect(first.value).not.toHaveProperty('callInventoryScope');expect(first.value.contentHash).toBe(sha256(canonicalJson({objectApiId:f.objectId,sourceFileApiId:f.files[0].id,...input,actorId:f.actor.userId})));
    const second=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...input,expectedReviewHash:first.value.contentHash,callInventoryScope:{schemaVersion:'matrix-odi123-call-inventory-review-v1',claims:[]}},command(f.actor));if(second.kind!=='success')throw Error(JSON.stringify(second));
    expect(second.value.contentHash).not.toBe(first.value.contentHash);expect(await repository.getSourceReview(f.objectId,f.files[0].id,f.actor)).toEqual(second.value);
  });
});
