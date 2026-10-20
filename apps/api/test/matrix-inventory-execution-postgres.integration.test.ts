import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { LocalObjectStorage } from "../src/storage.js";
import { MATRIX_INVENTORY_PROFILE, matrixAnyPolicyForProfile } from "../src/matrix-inventory-profile.js";
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
const fixtureRoot=new URL("../../../services/worker/tests/fixtures/matrix-inventory-v1/",import.meta.url);
const authored=JSON.parse(readFileSync(new URL("authored-manifest.json",fixtureRoot),"utf8"));
const inventoryOracle=JSON.parse(readFileSync(new URL("portable-goldens.json",fixtureRoot),"utf8"));
const original={sources:['pd-both','rd-gasket'].map(name=>{const row=authored.find((x:any)=>x.name===name);return {source:{file_id:row.sourceFileId,size_bytes:row.pdfBytes,stage:row.stage,sha256:row.sourceSha256},sourceArtifact:JSON.parse(readFileSync(new URL(row.artifact,fixtureRoot),'utf8'))};})};
const executionScript=`import json,sys
from inspector_worker.matrix_engine import build_matrix_execution
from inspector_worker.project_constraints import extract_project_constraints
from inspector_worker.source_declarations import extract_source_declarations
from inspector_worker.source_declarations_v2 import extract_source_declarations as extract_source_declarations_v2
from inspector_worker.durable_pz002 import _reviewed_source
from inspector_worker.inventory_execution import build_inventory_comparisons, merge_inventory_coverage
x=json.load(sys.stdin);lease=x['lease'];sources=[]
for s in lease['inputs']['sourceFiles']:
 d=lease['inputs']['sourceDecisions'].get(s['sourceFileId']);sources.append({**s,**_reviewed_source(s,d),'scopeProofs':(d or {}).get('scopeProofs',{})})
args={'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':x['artifacts']}
all={'execution':build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=x['artifacts']),
'projectConstraints':extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,x['artifacts']),
'sourceDeclarations':(extract_source_declarations_v2(args) if x['v2'] else extract_source_declarations(args))}
if x.get('inventoryInputs'):
 registry=x['capabilityRegistry']
 all['inventoryComparisons']=build_inventory_comparisons(x['inventoryInputs'],registry)
 all['effectiveCoverage']=merge_inventory_coverage(all['execution']['coverage'],all['inventoryComparisons'],registry)
json.dump(all,sys.stdout,ensure_ascii=False)`;

type Fixture={objectId:string;actor:AuthenticatedActor;files:any[];artifacts:any[]};
(adminUrl?describe:describe.skip)("typed inventory machine execution PostgreSQL",{timeout:120_000},()=>{
  const databaseName=`inventory_exec_it_${randomUUID().replaceAll("-","")}`;
  let admin:Pool,database:Pool,repository:PostgresInspectionRepository,connection:string,storageRoot:string;
  const previousOcr=process.env.INSPECTOR_MATRIX_OCR_LAYOUT;
  async function open(){const reference=await loadReferenceData();return PostgresInspectionRepository.create({connectionString:connection,parameters:reference.parameters,analysisProfile:"MATRIX_V1",organizationSlug:"inventory-review-it",storage:new LocalObjectStorage(storageRoot)});}
  beforeAll(async()=>{
    delete process.env.INSPECTOR_MATRIX_OCR_LAYOUT;
    storageRoot=await mkdtemp(join(tmpdir(),"matrix-inventory-exec-"));
    admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url=new URL(adminUrl!);url.pathname=`/${databaseName}`;connection=url.toString();
    await runDatabaseMigrations(connection);
    database=new Pool({connectionString:connection,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});
    repository=await open();
  });
  afterAll(async()=>{
    if(previousOcr===undefined)delete process.env.INSPECTOR_MATRIX_OCR_LAYOUT;else process.env.INSPECTOR_MATRIX_OCR_LAYOUT=previousOcr;
    await repository?.close();await database?.end();if(storageRoot)await rm(storageRoot,{recursive:true,force:true});
    if(admin)try{await admin.query("SET statement_timeout=10000");await admin.query("SET lock_timeout=5000");
      expect((await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1",[databaseName])).rows[0].n).toBe(0);
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    }finally{await admin.end();}
  });
  async function fixture(rd='rd-gasket'):Promise<Fixture>{
    const selectedOriginal={sources:['pd-both',rd].map(name=>{const row=authored.find((x:any)=>x.name===name);return {source:{file_id:row.sourceFileId,size_bytes:row.pdfBytes,stage:row.stage,sha256:row.sourceSha256},sourceArtifact:JSON.parse(readFileSync(new URL(row.artifact,fixtureRoot),'utf8'))};})};
    const object=await repository.createObject({name:"T42 SYNTHETIC ONLY machine inventory fixture",address:"Москва"});
    const user=await provisionLocalUser(database,{organizationSlug:"inventory-review-it",login:`evidence-${randomUUID()}`,displayName:"Evidence reviewer",password:"Evidence-Test-2026!",objectApiIds:[object.id],objectPermissions:["READ","REVIEW_DECIDE"]});
    const actor:AuthenticatedActor={sessionId:randomUUID(),userId:user.id,organizationId:user.organizationId,displayName:"Evidence reviewer",roles:["INSPECTOR"],capabilities:["SOURCE_REVIEW"],csrfHash:"x",expiresAt:"2030-01-01T00:00:00Z"};
    const files:any[]=selectedOriginal.sources.map((row:any)=>({id:`FIL-${randomUUID()}`,name:`${row.source.file_id}-original.pdf`,size:row.source.size_bytes,stage:row.source.stage,mimeType:"application/pdf",sha256:row.source.sha256,scanStatus:"CLEAN",status:"STORED",storageKey:`objects/${object.id}/${row.source.file_id}.pdf`}));
    for(let i=0;i<files.length;i++){const row=authored.find((x:any)=>x.sourceSha256===files[i].sha256);const target=join(storageRoot,files[i].storageKey);
      await mkdir(dirname(target),{recursive:true});await copyFile(new URL(row.pdf,fixtureRoot),target);}
    await repository.registerIngestedFiles(object.id,files);
    const artifacts=selectedOriginal.sources.map((row:any,index:number)=>({...structuredClone(row.sourceArtifact),sourceFileId:files[index].id}));
    return {objectId:object.id,actor,files,artifacts};
  }
  async function read(checkId:string,actor:AuthenticatedActor):Promise<MatrixExecutionRead>{const result=await repository.getMatrixExecution(checkId,actor);if(!result||typeof result==="string")throw Error("Saved declaration execution missing");return result;}
  async function run(f:Fixture,profile=MATRIX_PROFILE,attacks=false,onRule?:(data:{job:any;lease:any;result:any})=>Promise<void>){
    const policy=matrixAnyPolicyForProfile(profile)!;
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
        let inventoryInputs:any;
        if(profile===MATRIX_INVENTORY_PROFILE){const loaded=await repository.getJobInventoryComparisonInputs(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken});
          expect(loaded.kind).toBe("available");if(loaded.kind!=="available")throw Error("Protected loader failed");
          expect(loaded.contentHash).toBe(sha256(loaded.canonical));inventoryInputs=JSON.parse(loaded.canonical);
          expect(await repository.getJobInventoryComparisonInputs(job.id,{attemptId:randomUUID(),fencingToken:lease.fencingToken})).toMatchObject({kind:"stale_attempt"});}
        const proc=spawnSync(pythonExecutable,["-c",executionScript],{input:JSON.stringify({lease,artifacts:f.artifacts,v2:profile===MATRIX_PROFILE||profile===MATRIX_INVENTORY_PROFILE,inventoryInputs,capabilityRegistry:JSON.parse(readFileSync(new URL("../../../services/worker/rules/matrix-inventory-capabilities-v1.json",import.meta.url),"utf8"))}),encoding:"utf8",env:{...process.env,...pythonEnv},timeout:30000,maxBuffer:48*1024*1024});
        expect(proc.status,proc.stderr).toBe(0);const all=JSON.parse(proc.stdout);
        result={schemaVersion:"analysis-stage-result-v2",jobType:job.job_type,inputManifestHash:lease.inputManifestHash,disposition:"RULES_EVALUATED",providerKind:"RULE_ENGINE",providerProfileId:policy.profileId,providerConfigHash:policy.configHash,outputCount:all.execution.results.length+(all.inventoryComparisons?.results.length??0),execution:all.execution,...(all.inventoryComparisons?{inventoryComparisons:all.inventoryComparisons,effectiveCoverage:all.effectiveCoverage}:{}),...(policy.projectConstraints?{projectConstraints:all.projectConstraints}:{}),...(policy.sourceDeclarations?{sourceDeclarations:all.sourceDeclarations}:{})};
        const completion=(changed:any)=>repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result:changed});
        const expectRejected=async(changed:any)=>{
          expect((await completion(changed)).kind).toBe("invalid_state");
          expect((await database.query("SELECT count(*)::int n FROM analysis_stage_artifacts WHERE job_id=$1",[job.id])).rows[0].n).toBe(0);
          expect((await database.query("SELECT count(*)::int n FROM machine_prediction_snapshots WHERE run_id=$1",[lease.runId])).rows[0].n).toBe(0);
        };
        if(attacks&&profile===MATRIX_INVENTORY_PROFILE){
          for(const key of ["inventoryComparisons","effectiveCoverage"]){const changed=structuredClone(result);delete changed[key];await expectRejected(changed);}
          const forged=structuredClone(result);forged.inventoryComparisons.results[0].calibratedProbability=1;await expectRejected(forged);
          await expectRejected({...result,outputCount:result.outputCount-1});
          const scalar=structuredClone(result);scalar.execution.inventoryComparisons=all.inventoryComparisons;await expectRejected(scalar);
        }
        if(onRule)await onRule({job,lease,result});
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
    const pages=await repository.getMatrixInventorySourcePages(checkId,f.files[index].id,f.actor);
    if(!pages||typeof pages==='string')throw Error('Pages unavailable');
    const originalFixture=inventoryOracle.fixtures.find((x:any)=>x.name===authored.find((r:any)=>r.sourceSha256===f.files[index].sha256).name);
    const selected=originalFixture.expected.inventory;
    const selection={pageNumber:selected.pageNumber,regionBoxMilliPoints:selected.regionBoxMilliPoints,
      headerFragments:selected.headerFragments,scopeFragments:selected.scopeFragments};
    const preview=await repository.previewMatrixInventorySource(checkId,f.files[index].id,selection,f.actor);
    if(!preview||typeof preview==='string'||!preview.target||preview.result.status!=='RECONSTRUCTED')throw Error('Preview unavailable');
    return {pages,preview,input:{sourceSha256:f.files[index].sha256,revisionStatus:'CURRENT' as const,approvalStatus:'APPROVED' as const,
      linkGroupId:'same-joint',sectionCode:'AR' as const,pageStages:{},basis:{reference:'Проверены исходные строки перечня'},expectedReviewHash:pages.latestReviewHash,
      inventoryScope:{schemaVersion:'matrix-inventory-review-v1' as const,claims:[{target:preview.target,selection,
        entityKey:'joint-one',componentRole:'PARTITION_SLAB_JOINT' as const,componentKey:'partition-one',zoneKey:'floor-one',
        operatingModeKey:'DECLARED_NOISE_PROTECTION_MEASURES' as const,measurementBasisKey:'SOURCE_AUTHORED_MEASURE_MEMBERSHIP' as const,
        assertion:'HUMAN_ASSERTED_COMPLETE' as const,reference:'Просмотрены все исходные строки области'}]}}};
  }
  it('executes unbound0 / reviewed1 / withdrawn0 / restored1; preserves frozen history and exact old scalar rows',async()=>{
    const f=await fixture(),initial=await run(f),legacy=await frozen(initial.checkId);
    const unknown=await run(f,MATRIX_INVENTORY_PROFILE,true);
    const count=(saved:MatrixExecutionRead)=>saved.inventoryComparisons!.results.filter(r=>r.kind==='SCOPED_COMPARISON'&&r.comparison.status==='CANDIDATE').length;
    expect(count(unknown.saved)).toBe(0);expect(unknown.saved.inventoryComparisons!.results[0].kind).toBe('UNBOUND_ATOM_ABSTENTION');
    expect(unknown.saved.execution).toEqual(initial.saved.execution);
    expect(unknown.saved.effectiveCoverage!.filter(c=>c.executionStatus==='UNSUPPORTED')).toHaveLength(76);
    const reviewInputs:any[]=[];
    for(let index=0;index<2;index++){const {input}=await request(f,initial.checkId,index);reviewInputs.push(input);
      expect((await repository.recordSourceReviewCommand(f.objectId,f.files[index].id,input,command(f.actor))).kind).toBe('success');}
    const positive=await run(f,MATRIX_INVENTORY_PROFILE,true),positiveFrozen=await frozen(positive.checkId);
    expect(count(positive.saved)).toBe(1);expect(positive.saved.inventoryComparisonEvidence!.length).toBe(7);
    expect(positive.saved.inventoryComparisons!.results[0]).toMatchObject({comparison:{status:'CANDIDATE',calibratedProbability:null}});
    const submission=JSON.parse(positiveFrozen.submission);expect(submission.checks.slice(0,-1)).toEqual(JSON.parse(legacy.submission).checks);
    expect(submission.checks.at(-1)).toMatchObject({parameter_code:'M-053',pd_value:null,rd_value:null,id_value:null,
      violation_label:'COMPARISON_IMPOSSIBLE',protocol_status:'COMPARISON_IMPOSSIBLE',evidence:[]});
    expect(await repository.getSubmission(positive.checkId,f.actor)).toEqual(submission);
    expect((await repository.getCoverage(positive.checkId,f.actor) as any[]).find(c=>c.parameterCode==='AR-053').atomic).toEqual(positive.saved.effectiveCoverage!.find(c=>c.parameterCode==='AR-053'));
    const latest=await repository.getSourceReview(f.objectId,f.files[1].id,f.actor);if(!latest||typeof latest==='string')throw Error('Missing review');
    const withdrawn=await repository.recordSourceReviewCommand(f.objectId,f.files[1].id,{...reviewInputs[1],expectedReviewHash:latest.contentHash,
      inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[]}},command(f.actor));expect(withdrawn.kind).toBe('success');
    const negative=await run(f,MATRIX_INVENTORY_PROFILE);expect(count(negative.saved)).toBe(0);
    expect(await frozen(positive.checkId)).toEqual(positiveFrozen);expect(count(await read(positive.checkId,f.actor))).toBe(1);
    if(withdrawn.kind!=='success')throw Error('Withdrawal failed');
    expect((await repository.recordSourceReviewCommand(f.objectId,f.files[1].id,{...reviewInputs[1],expectedReviewHash:withdrawn.value.contentHash},command(f.actor))).kind).toBe('success');
    const restored=await run(f,MATRIX_INVENTORY_PROFILE);expect(count(restored.saved)).toBe(1);
    await repository.close();repository=await open();expect(count(await read(restored.checkId,f.actor))).toBe(1);
    expect(await repository.getMatrixExecution(restored.checkId,{...f.actor,userId:randomUUID()})).toBeUndefined();
    expect(await repository.getMatrixExecution(restored.checkId,{...f.actor,organizationId:randomUUID()})).toBeUndefined();
    // Deliberate corruption in this disposable DB: independent readback rejects
    // reinterpreted metadata and invented persisted member identity, not just hashes.
    const restoredRun=(await database.query('SELECT id FROM analysis_runs WHERE api_id=$1',[restored.checkId])).rows[0].id;
    const snapshot=(await database.query('SELECT metadata FROM machine_prediction_snapshots WHERE run_id=$1',[restoredRun])).rows[0];
    await database.query('ALTER TABLE machine_prediction_snapshots DISABLE TRIGGER USER');
    try{await database.query('UPDATE machine_prediction_snapshots SET metadata=$2::jsonb WHERE run_id=$1',[restoredRun,JSON.stringify({...snapshot.metadata,officialIdsVerified:true})]);
      expect(await repository.getMatrixExecution(restored.checkId,f.actor)).toBeUndefined();
      expect(await repository.getSubmission(restored.checkId,f.actor)).toBeUndefined();
    }finally{await database.query('UPDATE machine_prediction_snapshots SET metadata=$2::jsonb WHERE run_id=$1',[restoredRun,JSON.stringify(snapshot.metadata)]);
      await database.query('ALTER TABLE machine_prediction_snapshots ENABLE TRIGGER USER');}
    const typedRow=(await database.query("SELECT id,entity_key FROM rule_results WHERE run_id=$1 AND parameter_code='AR-053'",[restoredRun])).rows[0];
    await database.query('ALTER TABLE rule_results DISABLE TRIGGER USER');
    try{await database.query('UPDATE rule_results SET entity_key=$2::jsonb WHERE id=$1',[typedRow.id,JSON.stringify({inventedMember:'FORGED'})]);
      expect(await repository.getMatrixExecution(restored.checkId,f.actor)).toBeUndefined();
      expect(await repository.getCoverage(restored.checkId,f.actor)).toBeUndefined();
    }finally{await database.query('UPDATE rule_results SET entity_key=$2::jsonb WHERE id=$1',[typedRow.id,JSON.stringify(typedRow.entity_key)]);
      await database.query('ALTER TABLE rule_results ENABLE TRIGGER USER');}
    const frozenReview=(await database.query('SELECT review.id,review.basis_reference FROM source_review_decisions review JOIN run_source_review_snapshots s ON s.decision_id=review.id WHERE s.run_id=$1 LIMIT 1',[restoredRun])).rows[0];
    await database.query('ALTER TABLE source_review_decisions DISABLE TRIGGER USER');
    try{await database.query('UPDATE source_review_decisions SET basis_reference=$2 WHERE id=$1',[frozenReview.id,'FORGED LEGACY HASH PREIMAGE']);
      expect(await repository.getMatrixExecution(restored.checkId,f.actor)).toBeUndefined();
    }finally{await database.query('UPDATE source_review_decisions SET basis_reference=$2 WHERE id=$1',[frozenReview.id,frozenReview.basis_reference]);
      await database.query('ALTER TABLE source_review_decisions ENABLE TRIGGER USER');}
    // Original PDF substitution invalidates all protected read surfaces, without touching immutable rows.
    const originalBytes=readFileSync(join(storageRoot,f.files[0].storageKey));
    await writeFile(join(storageRoot,f.files[0].storageKey),Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(originalBytes.length-5)]));
    expect(await repository.getMatrixExecution(restored.checkId,f.actor)).toBeUndefined();
    expect(await repository.getSubmission(restored.checkId,f.actor)).toBeUndefined();
    expect(await repository.getCoverage(restored.checkId,f.actor)).toBeUndefined();
    await writeFile(join(storageRoot,f.files[0].storageKey),originalBytes);
    expect(count(await read(restored.checkId,f.actor))).toBe(1);
  });
  it('awaits cancellation cleanup; rejects live fence change and committed text corruption between A and C with zero result writes',async()=>{
    const f=await fixture();
    await run(f,MATRIX_INVENTORY_PROFILE,false,async({job,lease,result})=>{
      const complete=(signal?:AbortSignal)=>repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result},{signal});
      const unchanged=async()=>{
        expect((await database.query('SELECT count(*)::int n FROM analysis_stage_artifacts WHERE job_id=$1',[job.id])).rows[0].n).toBe(0);
        expect((await database.query('SELECT count(*)::int n FROM machine_prediction_snapshots WHERE run_id=$1',[lease.runId])).rows[0].n).toBe(0);
        expect((await database.query('SELECT state FROM analysis_jobs WHERE id=$1',[job.id])).rows[0].state).toBe('LEASED');
        expect((await database.query('SELECT state FROM job_attempts WHERE id=$1',[lease.attemptId])).rows[0].state).toBe('LEASED');
      };
      const already=new AbortController();already.abort();expect((await complete(already.signal)).kind).toBe('invalid_state');await unchanged();
      const storage=(repository as any).storage as LocalObjectStorage,originalGet=storage.getFile.bind(storage);
      async function blocked(operation:(gate:{opened:Promise<void>;release:()=>void;body:()=>any})=>Promise<void>){
        let release!:()=>void,opened!:()=>void,body:any;
        const barrier=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>opened=resolve);
        let first=true;const spy=vi.spyOn(storage,'getFile').mockImplementation(async(key,options)=>{
          const file=await originalGet(key,options);if(first){first=false;body=file.body;opened();await barrier;}return file;
        });
        try{await operation({opened:started,release,body:()=>body});}finally{release();spy.mockRestore();}
      }
      await blocked(async gate=>{
        const controller=new AbortController(),pending=complete(controller.signal);
        try{await gate.opened;
          // External storage is awaited with no transaction or inspection lock.
          await database.query('SELECT id FROM inspections WHERE id=$1 FOR UPDATE NOWAIT',[lease.inspectionId]);
          controller.abort();gate.release();expect((await pending).kind).toBe('invalid_state');
          expect(gate.body().closed).toBe(true);await unchanged();}finally{gate.release();await pending;}
      });
      await blocked(async gate=>{
        const pending=complete();try{await gate.opened;
          await database.query('UPDATE analysis_jobs SET fencing_token=fencing_token+1 WHERE id=$1',[job.id]);gate.release();
          expect((await pending).kind).toBe('stale_attempt');await unchanged();
        }finally{gate.release();await pending;await database.query('UPDATE analysis_jobs SET fencing_token=$2 WHERE id=$1',[job.id,lease.fencingToken]);}
      });
      await blocked(async gate=>{
        const pending=complete();let saved:any,disabled=false;
        try{await gate.opened;
          saved=(await database.query('SELECT id,content_json,content_hash,byte_size FROM analysis_text_artifacts WHERE run_id=$1 ORDER BY id LIMIT 1',[lease.runId])).rows[0];
          const changed=structuredClone(saved.content_json);changed.pages[0].blocks[0].text+=' FORGED DURING EXTERNAL IO';const canonical=canonicalJson(changed);
          // Deliberate superuser corruption of this DISPOSABLE database. The
          // immutable production trigger would already reject an ordinary write.
          await database.query('ALTER TABLE analysis_text_artifacts DISABLE TRIGGER USER');disabled=true;
          await database.query('UPDATE analysis_text_artifacts SET content_json=$2::jsonb,content_hash=$3,byte_size=$4 WHERE id=$1',
            [saved.id,canonical,sha256(canonical),Buffer.byteLength(canonical)]);
          gate.release();expect((await pending).kind).toBe('invalid_state');await unchanged();
        }finally{gate.release();await pending;
          if(saved&&disabled)await database.query('UPDATE analysis_text_artifacts SET content_json=$2::jsonb,content_hash=$3,byte_size=$4 WHERE id=$1',
            [saved.id,JSON.stringify(saved.content_json),saved.content_hash,saved.byte_size]);
          if(disabled)await database.query('ALTER TABLE analysis_text_artifacts ENABLE TRIGGER USER');}
      });
    });
  });

});
