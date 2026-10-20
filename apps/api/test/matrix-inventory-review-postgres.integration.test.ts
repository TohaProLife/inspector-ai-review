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
x=json.load(sys.stdin);lease=x['lease'];sources=[]
for s in lease['inputs']['sourceFiles']:
 d=lease['inputs']['sourceDecisions'].get(s['sourceFileId']);sources.append({**s,**_reviewed_source(s,d),'scopeProofs':(d or {}).get('scopeProofs',{})})
args={'objectId':lease['objectId'],'inputManifestHash':lease['inputManifestHash'],'sources':sources,'textArtifacts':x['artifacts']}
json.dump({'execution':build_matrix_execution(object_id=lease['objectId'],input_manifest_hash=lease['inputManifestHash'],sources=sources,text_artifacts=x['artifacts']),
'projectConstraints':extract_project_constraints(lease['objectId'],lease['inputManifestHash'],sources,x['artifacts']),
'sourceDeclarations':(extract_source_declarations_v2(args) if x['v2'] else extract_source_declarations(args))},sys.stdout,ensure_ascii=False)`;

type Fixture={objectId:string;actor:AuthenticatedActor;files:any[];artifacts:any[]};
(adminUrl?describe:describe.skip)("authenticated immutable source inventory reviews PostgreSQL",{timeout:120_000},()=>{
  const databaseName=`inventory_it_${randomUUID().replaceAll("-","")}`;
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
  async function fixture(rd='rd-gasket'):Promise<Fixture>{
    const selectedOriginal={sources:['pd-both',rd].map(name=>{const row=authored.find((x:any)=>x.name===name);return {source:{file_id:row.sourceFileId,size_bytes:row.pdfBytes,stage:row.stage,sha256:row.sourceSha256},sourceArtifact:JSON.parse(readFileSync(new URL(row.artifact,fixtureRoot),'utf8'))};})};
    const object=await repository.createObject({name:"T40 SYNTHETIC ONLY inventory review fixture",address:"Москва"});
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
        const completion=(changed:any)=>repository.completeJob(job.id,{attemptId:lease.attemptId,fencingToken:lease.fencingToken,result:changed});
        const expectRejected=async(changed:any)=>{
          expect((await completion(changed)).kind).toBe("invalid_state");
          expect((await database.query("SELECT count(*)::int n FROM analysis_stage_artifacts WHERE job_id=$1",[job.id])).rows[0].n).toBe(0);
          expect((await database.query("SELECT count(*)::int n FROM machine_prediction_snapshots WHERE run_id=$1",[lease.runId])).rows[0].n).toBe(0);
        };
        if(attacks&&profile===MATRIX_PROFILE){
          for(const key of ["sourceDeclarations","projectConstraints"]){const changed=structuredClone(result);delete changed[key];await expectRejected(changed);}
          for(const field of ["criterion","minutes","rawValue","rawUnit","constructionLabelLines","headerFragments","unitFragments","bindingPolicyVersion","tableBoxMilliPoints","sourceSha256","textArtifactHash","pageNumber","entityKey","probability"]){
            const changed=structuredClone(result),fact=changed.sourceDeclarations.declarations[0];
            if(field.endsWith("Fragments"))fact[field][0].rawText+=" FORGED";
            else if(field==="constructionLabelLines")fact[field]=["Invented physical member"];
            else if(field==="tableBoxMilliPoints")fact[field][0]++;
            else fact[field]=field==="pageNumber"?1:field==="minutes"?999:field.endsWith("Hash")||field.endsWith("Sha256")?"f".repeat(64):"FORGED";
            fact.id=sourceDeclarationId(fact);await expectRejected(changed);
          }
          await expectRejected({...result,sourceDeclarations:{...all.sourceDeclarations,schemaVersion:"matrix-source-declarations-v1",extractorVersion:"matrix-source-declarations-v1"}});
          for(const declarations of [[],[...all.sourceDeclarations.declarations].reverse(),[...all.sourceDeclarations.declarations,all.sourceDeclarations.declarations[0]]])await expectRejected({...result,sourceDeclarations:{...all.sourceDeclarations,declarations}});
          const scalar=structuredClone(result);scalar.execution.sourceDeclarations=all.sourceDeclarations;await expectRejected(scalar);
          await expectRejected({...result,outputCount:result.outputCount+all.sourceDeclarations.declarations.length});
          await expectRejected({...result,providerConfigHash:"f".repeat(64)});
        }
        if(profile===MATRIX_STEEL_PROFILE)await expectRejected({...result,sourceDeclarations:{...all.sourceDeclarations,schemaVersion:"matrix-source-declarations-v2",extractorVersion:"matrix-source-declarations-v2"}});
        if(!policy.sourceDeclarations)await expectRejected({...result,sourceDeclarations:all.sourceDeclarations});
        if(!policy.projectConstraints)await expectRejected({...result,projectConstraints:all.projectConstraints});
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
  it('authenticates immutable text origin and materializes both inventories without scalar authority',async()=>{
    const f=await fixture(),initial=await run(f),before=await frozen(initial.checkId);
    for(let index=0;index<2;index++){
      const {pages,preview,input}=await request(f,initial.checkId,index);
      expect(pages.textArtifact).toEqual(f.artifacts[index]);expect(preview.result.status).toBe('RECONSTRUCTED');
      expect(await repository.getMatrixInventorySourcePages(initial.checkId,f.files[index].id,{...f.actor,userId:randomUUID()})).toBeUndefined();
      const result=await repository.recordSourceReviewCommand(f.objectId,f.files[index].id,input,command(f.actor));
      expect(result.kind).toBe('success');if(result.kind!=='success')throw Error('Review failed');
      expect(result.value.inventoryScope!.claims[0].inventorySnapshot.sourceFileId).toBe(f.files[index].id);
      expect(result.value.inventoryScope!.claims[0].inventorySnapshot.featureRows.map(x=>x.featureKey)).toEqual(index===0?['DAMPING_TAPE','ACOUSTIC_GASKET']:['ACOUSTIC_GASKET']);
      expect(await repository.getSourceReview(f.objectId,f.files[index].id,f.actor)).toEqual(result.value);
    }
    expect(await frozen(initial.checkId)).toEqual(before);
    const next=await run(f);expect(next.saved.execution.observations).toEqual(initial.saved.execution.observations);
    expect(next.saved.execution.results).toEqual(initial.saved.execution.results);expect(next.saved.execution.coverage).toEqual(initial.saved.execution.coverage);
    expect((await frozen(next.checkId)).submission).toBe(before.submission);
    expect((await database.query(`SELECT count(*)::int n FROM run_source_review_snapshots s JOIN analysis_runs r ON r.id=s.run_id WHERE r.api_id=$1`,[next.checkId])).rows[0].n).toBe(2);
    await repository.close();repository=await open();expect(await repository.getSourceReview(f.objectId,f.files[0].id,f.actor)).toHaveProperty("inventoryScope");
  });
  it('preserves on omission only under latest CAS, supports UNKNOWN statuses, and withdraws explicitly',async()=>{
    const f=await fixture(),initial=await run(f),{input}=await request(f,initial.checkId);
    const first=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,input,command(f.actor));if(first.kind!=='success')throw Error('Review failed');
    const {inventoryScope:_scope,expectedReviewHash:_cas,...legacy}=input;
    expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,legacy,command(f.actor))).toMatchObject({kind:'invalid_state',code:'SOURCE_REVIEW_STALE'});
    expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,expectedReviewHash:null},command(f.actor))).toMatchObject({kind:'invalid_state',code:'SOURCE_REVIEW_STALE'});
    const preserved=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,revisionStatus:'UNKNOWN',approvalStatus:'UNKNOWN',expectedReviewHash:first.value.contentHash},command(f.actor));
    expect(preserved.kind).toBe('success');if(preserved.kind!=='success')throw Error('Preserve failed');
    expect(preserved.value.inventoryScope).toEqual(first.value.inventoryScope);expect(preserved.value.approvalStatus).toBe('UNKNOWN');
    expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,pageStages:{'1':'UNRESOLVED'},expectedReviewHash:preserved.value.contentHash},command(f.actor))).toMatchObject({kind:'invalid_state',code:'SOURCE_STAGE_MISMATCH'});
    expect(await repository.getSourceReview(f.objectId,f.files[0].id,f.actor)).toEqual(preserved.value);
    const withdrawn=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,{...legacy,expectedReviewHash:preserved.value.contentHash,inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[]}},command(f.actor));
    expect(withdrawn.kind).toBe('success');if(withdrawn.kind!=='success')throw Error('Withdraw failed');expect(withdrawn.value.inventoryScope!.claims).toEqual([]);
    expect(await repository.getSourceReview(f.objectId,f.files[0].id,f.actor)).toMatchObject({inventoryScope:{claims:[]}});
    await expect(database.query('UPDATE source_review_decisions SET inventory_scope=NULL WHERE content_hash=$1',[first.value.contentHash])).rejects.toThrow();
    const concurrent=await Promise.all(['Конкурирующее решение первое','Конкурирующее решение второе'].map(reference=>repository.recordSourceReviewCommand(f.objectId,f.files[0].id,
      {...legacy,basis:{reference},expectedReviewHash:withdrawn.value.contentHash},command(f.actor))));
    expect(concurrent.filter(x=>x.kind==='success')).toHaveLength(1);expect(concurrent.filter(x=>x.kind==='invalid_state')).toHaveLength(1);

  });
  it('rejects stale/source/region/hash forgeries with zero partial review/audit/receipt writes',async()=>{
    const f=await fixture(),initial=await run(f),{input}=await request(f,initial.checkId);
    const count=async()=>Number((await database.query('SELECT count(*)::int n FROM source_review_decisions')).rows[0].n);
    const before=await count();
    for(const mutate of [
      (x:any)=>x.inventoryScope.claims[0].target.checkId='CHK-unknown',
      (x:any)=>x.inventoryScope.claims[0].target.inputManifestHash='f'.repeat(64),
      (x:any)=>x.inventoryScope.claims[0].target.textStageContentHash='f'.repeat(64),
      (x:any)=>x.inventoryScope.claims[0].target.textArtifactHash='f'.repeat(64),
      (x:any)=>x.inventoryScope.claims[0].target.inventoryContentHash='f'.repeat(64),
      (x:any)=>x.inventoryScope.claims[0].selection.headerFragments[0].rawText+=' FORGED',
      (x:any)=>x.inventoryScope.claims[0].selection.regionBoxMilliPoints[0]++,
    ]){
      const changed=structuredClone(input);mutate(changed);const cmd=command(f.actor);
      expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,changed,cmd)).toMatchObject({kind:'invalid_state',code:'INVENTORY_SNAPSHOT_MISMATCH'});
      expect(await count()).toBe(before);
      expect((await database.query('SELECT count(*)::int n FROM command_receipts WHERE idempotency_key=$1',[cmd.idempotencyKey])).rows[0].n).toBe(0);
    }
    const second=await fixture(),other=await run(second);const wrong=structuredClone(input);wrong.inventoryScope.claims[0].target.checkId=other.checkId;
    expect(await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,wrong,command(f.actor))).toMatchObject({kind:'invalid_state',code:'INVENTORY_SNAPSHOT_MISMATCH'});
  });
  it('requires sealed origin and nonempty resolved human completeness; preserves UNKNOWN unresolved evidence',async()=>{
    const pending=await fixture();const check=await repository.startCheck(pending.objectId);if(!check)throw Error('Missing pending check');
    expect(await repository.getMatrixInventorySourcePages(check.id,pending.files[0].id,pending.actor)).toBeUndefined();
    for(const variant of ['rd-no-rows','rd-unknown-only','rd-plural']){
      const f=await fixture(variant),initial=await run(f),{input}=await request(f,initial.checkId,1);
      const count=async()=>Number((await database.query('SELECT count(*)::int n FROM source_review_decisions')).rows[0].n),before=await count();
      expect(await repository.recordSourceReviewCommand(f.objectId,f.files[1].id,input,command(f.actor))).toMatchObject({kind:'invalid_state',code:'INVENTORY_INCOMPLETE'});
      expect(await count()).toBe(before);
      const unknown={...input,inventoryScope:{...input.inventoryScope,claims:input.inventoryScope.claims.map(c=>({...c,assertion:'UNKNOWN' as const}))}};
      const saved=await repository.recordSourceReviewCommand(f.objectId,f.files[1].id,unknown,command(f.actor));
      expect(saved.kind).toBe('success');if(saved.kind!=='success')throw Error('UNKNOWN failed');
      expect(saved.value.inventoryScope!.claims[0].assertion).toBe('UNKNOWN');
    }
    const rollback=readFileSync(new URL('../../../migrations/rollback/034_matrix_inventory_scope.sql',import.meta.url),'utf8');
    await expect(database.query(rollback)).rejects.toThrow(/inventory|history/i);
  });

  it('keeps omitted legacy review hash bytes and all four profile config hashes unchanged',async()=>{
    expect([MATRIX_LEGACY_PROFILE,MATRIX_CONSTRAINTS_PROFILE,MATRIX_STEEL_PROFILE,MATRIX_PROFILE].map(p=>matrixPolicyForProfile(p)!.configHash)).toEqual([
      '272a89eac185a2df8f1391384ddddb380779af8bf7b9a81cdf8056dc73371891','347c85ed3c0e8ef49346f53b58904b249ee59f1e79cf595098be70589524d8ab',
      '2536d3f36cb5c112a052c7f1ea782afc9b1c95d3d97862b7b4051db7d3eb14bd','aedbc793122525242dbdcd7b3b56c5ddf3e176869a1aa31137db11833d94181e']);
    const f=await fixture(),input={sourceSha256:f.files[0].sha256,revisionStatus:'UNKNOWN' as const,approvalStatus:'UNKNOWN' as const,
      linkGroupId:null,pageStages:{},basis:{reference:'Legacy source review remains unchanged'}};
    const result=await repository.recordSourceReviewCommand(f.objectId,f.files[0].id,input,command(f.actor));
    expect(result.kind).toBe('success');if(result.kind!=='success')throw Error('Legacy failed');
    expect(result.value).not.toHaveProperty('inventoryScope');
    expect(result.value.contentHash).toBe(sha256(canonicalJson({objectApiId:f.objectId,sourceFileApiId:f.files[0].id,...input,actorId:f.actor.userId})));
    expect(await repository.getSourceReview(f.objectId,f.files[0].id,f.actor)).toEqual(result.value);
    expect((await database.query('SELECT inventory_scope FROM source_review_decisions WHERE id=$1',[result.value.id])).rows[0].inventory_scope).toBeNull();
  });

});
