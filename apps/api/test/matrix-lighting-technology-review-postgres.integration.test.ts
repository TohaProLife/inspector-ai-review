/** Independent local-PG expectations frozen before first owned execution.
 * Original PDFs/full native v3 from T65 manual; no source consumer as oracle. */
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import {runDatabaseMigrations} from '../src/database-migrations.js';
import {PostgresInspectionRepository} from '../src/postgres-repository.js';
import {loadReferenceData} from '../src/reference-data.js';
import {LocalObjectStorage} from '../src/storage.js';
import {provisionLocalUser} from '../src/user-provisioning.js';
import type {AuthenticatedActor} from '../src/identity.js';
import {pythonExecutable,pythonEnv} from './python.js';

const adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL,root=new URL('../../../',import.meta.url);
const manualBytes=readFileSync(new URL('fixtures/matrix-lighting-technology-execution-v1/qa-manual-execution-goldens.json',root));
expect(sha256(manualBytes)).toBe('264c3ed29f73f03a65e2e286b85ce6a6e91f8b4b76e42e019b6930fa6b85390e');
const manual=JSON.parse(manualBytes.toString()).validCases[0].package;
const domainHash=(a:unknown)=>sha256(canonicalJson({hashDomain:'document-text-v3-content-v1',artifact:a}));
const declarationHash=(d:unknown)=>sha256(canonicalJson({hashDomain:'matrix-zu130-lighting-technology-v3-source-id-v1',declaration:d}));
const scaffold=`import json,sys\nfrom inspector_worker.stage_scaffold import DEFAULT_STAGE_PROVIDER_REGISTRY\nx=json.load(sys.stdin)\njson.dump(DEFAULT_STAGE_PROVIDER_REGISTRY.execute(x['type'],x['lease'],x['attempt']),sys.stdout)`;
const command=(actor:AuthenticatedActor)=>({actor,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()});
const success=(value:any)=>{expect(value.kind,JSON.stringify(value)).toBe('success');if(value.kind!=='success')throw Error('Expected success');return value.value;};

(adminUrl?describe:describe.skip)('T66 ordinary public audit to immutable lighting review PostgreSQL',{timeout:180_000},()=>{
 const name=`lighting_review_${randomUUID().replaceAll('-','')}`;let admin:Pool,db:Pool,repo:PostgresInspectionRepository,dir:string;
 let actor:AuthenticatedActor,noRead:AuthenticatedActor,noReview:AuthenticatedActor,stranger:AuthenticatedActor,objectId:string,otherObjectId:string,checkId:string;
 let files:any[],artifacts:any[],expectedDeclarations:any[],stored:any[]=[];const org='lighting-review-independent';
 async function user(objects:string[],permissions:any[]):Promise<AuthenticatedActor>{const u=await provisionLocalUser(db,{organizationSlug:org,login:`qa-${randomUUID()}`,displayName:'Synthetic lighting reviewer',password:'Synthetic-Only-Test-2026!',objectApiIds:objects,objectPermissions:permissions});return {sessionId:randomUUID(),userId:u.id,organizationId:u.organizationId,displayName:'Synthetic lighting reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'x',expiresAt:'2030-01-01T00:00:00Z'} as AuthenticatedActor;}
 beforeAll(async()=>{
  admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});await admin.query(`CREATE DATABASE "${name}"`);
  const url=new URL(adminUrl!);url.pathname=`/${name}`;await runDatabaseMigrations(url.toString());db=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});dir=await mkdtemp(join(tmpdir(),'lighting-review-'));
  repo=await PostgresInspectionRepository.create({connectionString:url.toString(),parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});
  objectId=(await repo.createObject({name:'T66 SYNTHETIC human mappings; original-backed source declarations',address:'Москва'})).id;
  otherObjectId=(await repo.createObject({name:'T66 unrelated object',address:'Москва'})).id;
  actor=await user([objectId,otherObjectId],['READ','REVIEW_DECIDE','RUN']);noRead=await user([objectId],['REVIEW_DECIDE']);noReview=await user([objectId],['READ']);stranger=await user([],['READ','REVIEW_DECIDE']);
  files=manual.sources.map((s:any,i:number)=>{const original=readFileSync(new URL(`fixtures/matrix-lighting-technology-source-v1/research-${i?'named-fluorescent':'named-led'}.pdf`,root));expect(sha256(original)).toBe(s.sourceSha256);return {id:`FIL-${randomUUID()}`,name:`T66-${i?'RD-FLUORESCENT':'PD-LED'}.pdf`,stage:i?'RD':'PD',size:original.length,mimeType:'application/pdf',sha256:s.sourceSha256,scanStatus:'CLEAN',status:'STORED',storageKey:`authored-${randomUUID()}.pdf`};});
  await repo.registerIngestedFiles(objectId,files);
  artifacts=manual.origins.map((o:any,i:number)=>({...structuredClone(o.textArtifact),sourceFileId:files[i].id}));
  expectedDeclarations=manual.sources.map((s:any,i:number)=>({...structuredClone(s.review.lightingTechnologyScope.claims[0].declarationSnapshot),sourceFileId:files[i].id,textArtifactHash:domainHash(artifacts[i])}));
 });
 afterAll(async()=>{await repo?.close();await db?.end();if(dir)await rm(dir,{recursive:true,force:true});if(admin)try{await admin.query('SET statement_timeout=10000');await admin.query('SET lock_timeout=5000');for(let i=0;i<100;i++){if((await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n===0)break;await new Promise(r=>setTimeout(r,20));}await admin.query(`DROP DATABASE IF EXISTS "${name}"`);}finally{await admin.end();}});
 const count=async()=>(await db.query('SELECT count(*)::int n FROM source_review_decisions')).rows[0].n;
 async function request(i=0){const read=await repo.getDocumentTextV3Source(checkId,files[i].id,actor);if(!read||typeof read==='string')throw Error('Sealed native source missing');const selection=structuredClone(manual.sources[i].review.lightingTechnologyScope.claims[0].selection);const preview=await repo.previewMatrixLightingTechnologySource!(checkId,files[i].id,selection,actor);if(!preview||typeof preview==='string'||!preview.target||preview.result.status!=='RECONSTRUCTED')throw Error('Native preview missing');const {declarationSnapshot:_snapshot,...claim}=structuredClone(manual.sources[i].review.lightingTechnologyScope.claims[0]);return {read,preview,input:{sourceSha256:files[i].sha256,revisionStatus:'CURRENT' as const,approvalStatus:'APPROVED' as const,sectionCode:i?'EOM' as const:'IOS1' as const,linkGroupId:'synthetic-lighting-link',pageStages:{},basis:{reference:'SYNTHETIC inspected original source lines, no physical finding'},expectedReviewHash:read.latestReviewHash,lightingTechnologyScope:{schemaVersion:'matrix-zu130-lighting-technology-review-v1' as const,claims:[{...claim,target:preview.target,selection}]}}};}
 function reviewHash(i:number,value:any){return sha256(canonicalJson({objectApiId:objectId,sourceFileApiId:files[i].id,sourceSha256:value.sourceSha256,revisionStatus:value.revisionStatus,approvalStatus:value.approvalStatus,linkGroupId:value.linkGroupId,...(value.sectionCode?{sectionCode:value.sectionCode}:{}),pageStages:value.pageStages,basis:value.basis,...(value.inventoryScope?{inventoryScope:value.inventoryScope}:{}),...(value.callInventoryScope?{callInventoryScope:value.callInventoryScope}:{}),...(value.railInventoryScope?{railInventoryScope:value.railInventoryScope}:{}),...(value.waterNodeScope?{waterNodeScope:value.waterNodeScope}:{}),...(value.lightingTechnologyScope?{lightingTechnologyScope:value.lightingTechnologyScope}:{}),actorId:actor.userId}));}
 it('starts public per-request source audit in ordinary MATRIX_V1 and seals all nine jobs without engineering adapters',async()=>{
  const c=command(actor);const started=await repo.startCheckCommand(objectId,c,{sourceAuditV3:true});checkId=success(started).id;expect(await repo.startCheckCommand(objectId,c,{sourceAuditV3:true})).toMatchObject({kind:'success',replayed:true,value:{id:checkId}});
  expect(await repo.startCheckCommand(objectId,c)).toMatchObject({kind:'idempotency_conflict'});
  expect(await repo.previewMatrixLightingTechnologySource!(checkId,files[0].id,manual.sources[0].review.lightingTechnologyScope.claims[0].selection,actor)).toBeUndefined();
  const types:string[]=[];
  for(let n=0;n<12;n++){
   const q=await db.query(`SELECT j.id,j.job_type FROM analysis_jobs j JOIN analysis_runs r ON r.id=j.run_id WHERE r.api_id=$1 AND j.state='READY' ORDER BY j.created_at,j.id LIMIT 1`,[checkId]);if(!q.rows.length)break;const job=q.rows[0];types.push(job.job_type);
   const acquired=await repo.claimJob(job.id,{workerId:'lighting-review-it',capabilities:[job.job_type]});expect(acquired.kind).toBe('acquired');if(acquired.kind!=='acquired')throw Error('Lease missing');const lease=acquired.lease,attempt={attemptId:lease.attemptId,fencingToken:lease.fencingToken};
   expect((lease.release as any).textLayer).toMatchObject({artifactSchemaVersion:'document-text-v3',purpose:'SOURCE_AUDIT_ONLY'});expect((lease.release as any).rules.executionStatus).toBe('UNCONFIGURED');
   let result:any;if(job.job_type==='ANALYSIS_INVENTORY')result={disposition:'MANIFEST_INVENTORIED',sourceCount:2,stageCounts:{PD:1,RD:1,ID:0}};
   else if(job.job_type==='DOCUMENT_TEXT_LAYER')result={disposition:'DOCUMENT_TEXT_LAYER_COMPLETED',purpose:'SOURCE_AUDIT_ONLY',workerId:'lighting-review-it',sources:artifacts.map(a=>({sourceFileId:a.sourceFileId,inputSha256:a.inputSha256,status:'EXTRACTED',artifact:a}))};
   else if(job.job_type==='ANALYSIS_SEAL_UNSUPPORTED')result={disposition:'UNSUPPORTED_COVERAGE_SEALED'};
   else{expect(lease.release.providerSlot?.status).toBe('UNCONFIGURED');const p=spawnSync(pythonExecutable,['-c',scaffold],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,...pythonEnv},input:JSON.stringify({type:job.job_type,lease,attempt})});expect(p.status,p.stderr).toBe(0);result=JSON.parse(p.stdout);expect(result.outputCount).toBe(0);}
   expect(await repo.completeJob(job.id,{...attempt,result})).toMatchObject({kind:'completed'});
  }
  expect(types).toHaveLength(9);expect(types).toContain('ANALYSIS_SEAL_UNSUPPORTED');expect(await repo.getCheck(checkId,actor)).toMatchObject({status:'PARTIAL',progress:100});
  expect((await db.query('SELECT count(*)::int n FROM parameter_coverage WHERE execution_rollup=\'UNSUPPORTED\'')).rows[0].n).toBe(132);expect((await db.query('SELECT 1 FROM rule_results')).rows).toHaveLength(0);
  for(let i=0;i<2;i++){const {read,preview}=await request(i);expect(read.textArtifact).toEqual(artifacts[i]);expect(preview.result).toEqual({schemaVersion:'matrix-zu130-lighting-technology-source-v3-result-v1',status:'RECONSTRUCTED',declaration:expectedDeclarations[i]});expect(preview.target).toEqual({checkId,inputManifestHash:read.inputManifestHash,textStageContentHash:read.textStageContentHash,textArtifactHash:domainHash(artifacts[i]),declarationContentHash:declarationHash(expectedDeclarations[i])});expect(preview.latestReviewHash).toBeNull();}
 });
 it('preserves absent historical preimage; server materializes both full original snapshots and exact full hashes',async()=>{
  const legacy={sourceSha256:files[1].sha256,revisionStatus:'UNKNOWN' as const,approvalStatus:'UNKNOWN' as const,linkGroupId:null,pageStages:{},basis:{reference:'Legacy source review before optional lighting field'}};
  const old=success(await repo.recordSourceReviewCommand(objectId,files[1].id,legacy,command(actor)));expect(old).not.toHaveProperty('lightingTechnologyScope');expect(old.contentHash).toBe(reviewHash(1,old));
  const before=canonicalJson((await db.query('SELECT content_json FROM analysis_text_artifacts ORDER BY input_sha256')).rows);
  for(let i=0;i<2;i++){const {input}=await request(i);const c=command(actor),saved=success(await repo.recordSourceReviewCommand(objectId,files[i].id,input,c));stored[i]=saved;expect(saved.lightingTechnologyScope.claims[0].declarationSnapshot).toEqual(expectedDeclarations[i]);expect(saved.contentHash).toBe(reviewHash(i,saved));expect(await repo.getSourceReview(objectId,files[i].id,actor)).toEqual(saved);expect(await repo.recordSourceReviewCommand(objectId,files[i].id,input,c)).toMatchObject({kind:'success',replayed:true,value:saved});}
  expect(canonicalJson((await db.query('SELECT content_json FROM analysis_text_artifacts ORDER BY input_sha256')).rows)).toBe(before);
 });
 it('rejects stale, foreign, forged, unauthorized requests before insertion',async()=>{
  const {input}=await request();const baseline=await count();
  const reject=async(raw:any,who=actor,object=objectId,file=files[0].id)=>{let out:any;try{out=await repo.recordSourceReviewCommand(object,file,raw,command(who));}catch{out={kind:'rejected'};}expect(out.kind).not.toBe('success');expect(await count()).toBe(baseline);};
  await reject({...input,expectedReviewHash:null});const {expectedReviewHash:_cas,...noCas}=input;await reject(noCas);await reject({...input,sourceSha256:'a'.repeat(64)});
  await reject(input,noReview);await reject(input,stranger);await reject(input,{...actor,organizationId:randomUUID()});await reject(input,actor,otherObjectId);
  const selection=input.lightingTechnologyScope.claims[0].selection;expect(await repo.previewMatrixLightingTechnologySource!(checkId,files[0].id,selection,noRead)).toBeUndefined();expect(await repo.previewMatrixLightingTechnologySource!(checkId,files[0].id,selection,stranger)).toBeUndefined();
  for(const key of ['checkId','inputManifestHash','textStageContentHash','textArtifactHash','declarationContentHash']){const x=structuredClone(input);(x.lightingTechnologyScope.claims[0].target as any)[key]=key==='checkId'?'CHK-UNRELATED':'b'.repeat(64);await reject(x);}
  const forged:any=structuredClone(input);forged.lightingTechnologyScope.claims[0].declarationSnapshot=expectedDeclarations[0];await reject(forged);
  const raw=structuredClone(input);raw.lightingTechnologyScope.claims[0].selection.fragments[0].rawText+=' forged';await reject(raw);
  await reject({...input,pageStages:{'1':'RD'}});
 });
 it('requires latest CAS for inheritance, preserves old siblings, explicitly withdraws, and refuses corrupted historical full hash',async()=>{
  const {input}=await request();const {lightingTechnologyScope:_scope,expectedReviewHash:_cas,...legacy}=input;
  const siblings={inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[]},callInventoryScope:{schemaVersion:'matrix-odi123-call-inventory-review-v1',claims:[]},railInventoryScope:{schemaVersion:'matrix-odi120-rail-inventory-v1',claims:[]},waterNodeScope:{schemaVersion:'matrix-zu129-water-node-review-v1',claims:[]}};
  // Old sibling exact version uses its public immutable review schema.
  siblings.railInventoryScope.schemaVersion='matrix-odi120-rail-inventory-review-v1';
  const edited=success(await repo.recordSourceReviewCommand(objectId,files[0].id,{...legacy,...siblings,approvalStatus:'UNKNOWN',expectedReviewHash:input.expectedReviewHash} as any,command(actor)));
  expect(edited).toMatchObject(siblings);expect(edited.lightingTechnologyScope).toEqual(stored[0].lightingTechnologyScope);expect(edited.contentHash).toBe(reviewHash(0,edited));
  const withdrawn=success(await repo.recordSourceReviewCommand(objectId,files[0].id,{...legacy,expectedReviewHash:edited.contentHash,lightingTechnologyScope:{schemaVersion:'matrix-zu130-lighting-technology-review-v1',claims:[]}},command(actor)));
  expect(withdrawn.lightingTechnologyScope.claims).toEqual([]);expect(withdrawn).toMatchObject(siblings);expect(withdrawn.contentHash).toBe(reviewHash(0,withdrawn));expect(await repo.getSourceReview(objectId,files[0].id,actor)).toEqual(withdrawn);
  await expect(db.query('UPDATE source_review_decisions SET lighting_technology_scope=NULL WHERE id=$1',[stored[0].id])).rejects.toThrow();
  await db.query(`INSERT INTO source_review_decisions SELECT (jsonb_populate_record(NULL::source_review_decisions,to_jsonb(r)||jsonb_build_object('id',$2::text,'content_hash',$3::text,'created_at','2031-01-01T00:00:00Z'))).* FROM source_review_decisions r WHERE r.id=$1`,[withdrawn.id,randomUUID(),'f'.repeat(64)]);
  const n=await count();expect(await repo.getSourceReview(objectId,files[0].id,actor)).toBeUndefined();expect((await repo.recordSourceReviewCommand(objectId,files[0].id,{...legacy,expectedReviewHash:'f'.repeat(64)},command(actor))).kind).not.toBe('success');expect(await count()).toBe(n);
 });
});
