/** Independent T71 local PG: original PDFs and whole v2/manual snapshots; no steel DUT oracle. */
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
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
const root=new URL('../../../',import.meta.url),adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const manualBytes=readFileSync(new URL('fixtures/matrix-steel-execution-v1/qa-manual-whole-expectations.json',root));
expect(sha256(manualBytes)).toBe('4a5dfdb7fb40eb95f619d88eace539e46224cdc3caea90fab0ef2e348d123a94');
const manual=JSON.parse(manualBytes.toString()).validCases.find((c:any)=>c.name==='authored-original-directed-positive').package;
// Independent lexical ASCII serializer: old declaration domains use exact codepoint order, no locale sorting.
function literalCanonical(x:any):string{if(Array.isArray(x))return`[${x.map(literalCanonical).join(',')}]`;if(x&&typeof x==='object')return`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${literalCanonical(x[k])}`).join(',')}}`;return JSON.stringify(x);}
const textHash=(a:any)=>sha256(literalCanonical({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:a}));
const declarationId=(d:any)=>{const{id:_id,...body}=d;return sha256(literalCanonical({hashDomain:'matrix-source-declaration-id-v1',declaration:body}));};
const command=(actor:AuthenticatedActor)=>({actor,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()});
const success=(x:any)=>{expect(x.kind,JSON.stringify(x)).toBe('success');if(x.kind!=='success')throw Error('Command failed');return x.value;};
const scaffold=`import json,sys\nfrom inspector_worker.stage_scaffold import DEFAULT_STAGE_PROVIDER_REGISTRY\nx=json.load(sys.stdin)\njson.dump(DEFAULT_STAGE_PROVIDER_REGISTRY.execute(x['type'],x['lease'],x['attempt']),sys.stdout)`;
const execute=`import json,sys\nfrom unittest.mock import patch\nfrom inspector_worker import durable_matrix\nfrom inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter\nx=json.load(sys.stdin);artifacts={a['sourceFileId']:a for a in x['artifacts']}\nwith patch.object(durable_matrix,'download_text_artifact',side_effect=lambda lease,source,attempt:artifacts[source['sourceFileId']]):\n result=PilotPz002RuleAdapter().execute(x['lease'],x['attempt'])\njson.dump(result,sys.stdout,ensure_ascii=False)`;
(adminUrl?describe:describe.skip)('T71 authenticated original steel review persistence',{timeout:180000},()=>{
 const name=`steel_review_${randomUUID().replaceAll('-','')}`,org='steel-review-independent';let admin:Pool,db:Pool,repo:PostgresInspectionRepository,dir:string;
 let actor:AuthenticatedActor,noRead:AuthenticatedActor,noReview:AuthenticatedActor,stranger:AuthenticatedActor,objectId:string,otherObjectId:string,checkId:string;
 let files:any[],artifacts:any[],expectedSnapshots:any[],stored:any[]=[];
 async function user(objects:string[],permissions:any[]):Promise<AuthenticatedActor>{const u=await provisionLocalUser(db,{organizationSlug:org,login:`qa-${randomUUID()}`,displayName:'Synthetic steel reviewer',password:'Synthetic-Only-Test-2026!',objectApiIds:objects,objectPermissions:permissions});return{sessionId:randomUUID(),userId:u.id,organizationId:u.organizationId,displayName:'Synthetic steel reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'x',expiresAt:'2030-01-01T00:00:00Z'}as AuthenticatedActor;}
 beforeAll(async()=>{
  admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl!);url.pathname=`/${name}`;await runDatabaseMigrations(url.toString());db=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});dir=await mkdtemp(join(tmpdir(),'steel-review-'));
  repo=await PostgresInspectionRepository.create({connectionString:url.toString(),parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});
  objectId=(await repo.createObject({name:'T71 SYNTHETIC original steel declarations; human mapping fixture',address:'Москва'})).id;otherObjectId=(await repo.createObject({name:'T71 unrelated object',address:'Москва'})).id;
  actor=await user([objectId,otherObjectId],['READ','REVIEW_DECIDE','RUN']);noRead=await user([objectId],['REVIEW_DECIDE']);noReview=await user([objectId],['READ']);stranger=await user([],['READ','REVIEW_DECIDE']);
  files=manual.sources.map((s:any,i:number)=>{const pdf=readFileSync(new URL(`fixtures/matrix-steel-originals-v1/synthetic-steel-${i?'RD':'PD'}.pdf`,root));expect(sha256(pdf)).toBe(s.sourceSha256);return{id:`FIL-${randomUUID()}`,name:`T71-synthetic-${i?'RD':'PD'}.pdf`,stage:i?'RD':'PD',size:pdf.length,mimeType:'application/pdf',sha256:s.sourceSha256,scanStatus:'CLEAN',status:'STORED',storageKey:`original-${randomUUID()}.pdf`};});
  for(let i=0;i<2;i++){const path=join(dir,files[i].storageKey);await mkdir(dirname(path),{recursive:true});await writeFile(path,readFileSync(new URL(`fixtures/matrix-steel-originals-v1/synthetic-steel-${i?'RD':'PD'}.pdf`,root)));}
  await repo.registerIngestedFiles(objectId,files);
  artifacts=manual.origins.map((o:any,i:number)=>({...structuredClone(o.textArtifact),sourceFileId:files[i].id}));
  expectedSnapshots=manual.sources.map((s:any,i:number)=>{const d={...structuredClone(s.review.steelComparisonScope.claims[0].declarationSnapshot),sourceFileId:files[i].id,textArtifactHash:textHash(artifacts[i])};return{...d,id:declarationId(d)};});
 });
 afterAll(async()=>{await repo?.close();await db?.end();if(dir)await rm(dir,{recursive:true,force:true});if(admin)try{await admin.query('SET statement_timeout=10000');await admin.query('SET lock_timeout=5000');for(let i=0;i<100;i++){if((await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n===0)break;await new Promise(r=>setTimeout(r,20));}await admin.query(`DROP DATABASE IF EXISTS "${name}"`);}finally{await admin.end();}});
 const count=async()=>(await db.query('SELECT count(*)::int n FROM source_review_decisions')).rows[0].n;
 async function request(i=0){const read=await repo.getMatrixInventorySourcePages!(checkId,files[i].id,actor);if(!read||typeof read==='string')throw Error('Sealed v2 source missing');
  const original=manual.sources[i].review.steelComparisonScope.claims[0];const{declarationSnapshot:_snapshot,...claim}=structuredClone(original);
  const target={checkId,inputManifestHash:read.inputManifestHash,textStageContentHash:read.textStageContentHash,textArtifactHash:textHash(artifacts[i]),declarationId:expectedSnapshots[i].id};
  return{read,input:{sourceSha256:files[i].sha256,revisionStatus:'CURRENT' as const,approvalStatus:'APPROVED' as const,sectionCode:'KR' as const,linkGroupId:'synthetic-steel-link',pageStages:{},basis:{reference:'SYNTHETIC authenticated local test mapping; not professional approval'},expectedReviewHash:read.latestReviewHash,steelComparisonScope:{schemaVersion:'matrix-kr056-steel-review-v1' as const,claims:[{...claim,target}]}}};
 }
 function reviewHash(i:number,v:any){return sha256(canonicalJson({objectApiId:objectId,sourceFileApiId:files[i].id,sourceSha256:v.sourceSha256,revisionStatus:v.revisionStatus,approvalStatus:v.approvalStatus,linkGroupId:v.linkGroupId,...(v.sectionCode?{sectionCode:v.sectionCode}:{}),pageStages:v.pageStages,basis:v.basis,...Object.fromEntries(['matrixScope','inventoryScope','callInventoryScope','railInventoryScope','waterNodeScope','lightingTechnologyScope','steelComparisonScope'].filter(k=>v[k]!==undefined).map(k=>[k,v[k]])),actorId:actor.userId}));}
 it('seals an ordinary public v4 run on two original PDFs and exposes exact full v2 authenticated origins',async()=>{
  const flags=['INSPECTOR_MATRIX_LIGHTING_TECHNOLOGY_COMPARISONS','INSPECTOR_MATRIX_WATER_NODE_COMPARISONS','INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_OCR_LAYOUT','INSPECTOR_MATRIX_VISUAL_PROPOSALS'];const prior=flags.map(k=>process.env[k]);for(const k of flags)delete process.env[k];
  try{checkId=success(await repo.startCheckCommand(objectId,command(actor))).id;}finally{flags.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);}
  const types:string[]=[];
  for(let n=0;n<14;n++){const q=await db.query(`SELECT j.id,j.job_type FROM analysis_jobs j JOIN analysis_runs r ON r.id=j.run_id WHERE r.api_id=$1 AND j.state='READY' ORDER BY j.created_at,j.id LIMIT 1`,[checkId]);if(!q.rows.length)break;const job=q.rows[0];types.push(job.job_type);const acquired=await repo.claimJob(job.id,{workerId:'steel-review-it',capabilities:[job.job_type]});expect(acquired.kind).toBe('acquired');if(acquired.kind!=='acquired')throw Error('Lease missing');const lease=acquired.lease,attempt={attemptId:lease.attemptId,fencingToken:lease.fencingToken};let result:any;
   if(job.job_type==='ANALYSIS_INVENTORY')result={disposition:'MANIFEST_INVENTORIED',sourceCount:2,stageCounts:{PD:1,RD:1,ID:0}};
   else if(job.job_type==='DOCUMENT_TEXT_LAYER')result={disposition:'DOCUMENT_TEXT_LAYER_COMPLETED',sources:artifacts.map(a=>({sourceFileId:a.sourceFileId,inputSha256:a.inputSha256,status:'EXTRACTED',artifact:a}))};
   else if(job.job_type==='RULE_EVALUATION'){expect(lease.release.providerSlot).toMatchObject({profileId:'matrix-text-facts-evidence-v4',adapterVersion:'4'});const p=spawnSync(pythonExecutable,['-c',execute],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:48*1024*1024,env:{...process.env,...pythonEnv},input:JSON.stringify({lease,attempt,artifacts})});expect(p.status,p.stderr).toBe(0);result=JSON.parse(p.stdout);expect(result.sourceDeclarations.declarations).toEqual([...expectedSnapshots].sort((a,b)=>a.sourceFileId<b.sourceFileId?-1:a.sourceFileId>b.sourceFileId?1:0));}
   else if(job.job_type==='ANALYSIS_SEAL_UNSUPPORTED')result={disposition:'UNSUPPORTED_COVERAGE_SEALED'};
   else{const p=spawnSync(pythonExecutable,['-c',scaffold],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,...pythonEnv},input:JSON.stringify({type:job.job_type,lease,attempt})});expect(p.status,p.stderr).toBe(0);result=JSON.parse(p.stdout);expect(result.outputCount).toBe(0);}
   expect(await repo.completeJob(job.id,{...attempt,result})).toMatchObject({kind:'completed'});
  }
  expect(types).toHaveLength(9);expect(await repo.getCheck(checkId,actor)).toMatchObject({status:'PARTIAL',progress:100});
  for(let i=0;i<2;i++){const{read}=await request(i);expect(read.textArtifact).toEqual(artifacts[i]);expect(read.stage).toBe(i?'RD':'PD');expect(read.textArtifactHash).toBe(textHash(artifacts[i]));const a=await db.query('SELECT content_json,content_hash FROM analysis_text_artifacts WHERE source_file_id=(SELECT id FROM source_files WHERE api_id=$1)',[files[i].id]);expect(a.rows).toHaveLength(1);expect(a.rows[0].content_json).toEqual(artifacts[i]);expect(read.textStageContentHash).toBe(a.rows[0].content_hash.trim());expect(sha256(canonicalJson(a.rows[0].content_json))).toBe(read.textStageContentHash);expect(read.latestReviewHash).toBeNull();}
 });
 it('keeps omitted historical hashes byte-compatible and materializes both source snapshots server-side with idempotency',async()=>{
  const legacy={sourceSha256:files[1].sha256,revisionStatus:'UNKNOWN' as const,approvalStatus:'UNKNOWN' as const,linkGroupId:null,pageStages:{},basis:{reference:'Legacy source review without optional steel field'}};
  const old=success(await repo.recordSourceReviewCommand(objectId,files[1].id,legacy,command(actor)));expect(old).not.toHaveProperty('steelComparisonScope');expect(old.contentHash).toBe(reviewHash(1,old));
  const bytesBefore=canonicalJson((await db.query('SELECT content_json FROM analysis_text_artifacts ORDER BY input_sha256')).rows);
  for(let i=0;i<2;i++){const{input}=await request(i);const c=command(actor);const saved=success(await repo.recordSourceReviewCommand(objectId,files[i].id,input,c));stored[i]=saved;expect(saved.actorId).toBe(actor.userId);expect(saved.steelComparisonScope).toEqual({...input.steelComparisonScope,claims:[{...input.steelComparisonScope.claims[0],declarationSnapshot:expectedSnapshots[i]}]});expect(saved.contentHash).toBe(reviewHash(i,saved));expect(await repo.getSourceReview(objectId,files[i].id,actor)).toEqual(saved);expect(await repo.recordSourceReviewCommand(objectId,files[i].id,input,c)).toMatchObject({kind:'success',replayed:true,value:saved});}
  expect(canonicalJson((await db.query('SELECT content_json FROM analysis_text_artifacts ORDER BY input_sha256')).rows)).toBe(bytesBefore);
 });
 it('rejects stale, foreign, forged, unauthorized targets and mapping evidence before any insert',async()=>{
  const{input}=await request();const baseline=await count();const reject=async(raw:any,who=actor,object=objectId,file=files[0].id)=>{let out:any;try{out=await repo.recordSourceReviewCommand(object,file,raw,command(who));}catch{out={kind:'rejected'};}expect(out.kind).not.toBe('success');expect(await count()).toBe(baseline);};
  await reject({...input,expectedReviewHash:null});const{expectedReviewHash:_cas,...noCas}=input;await reject(noCas);await reject({...input,sourceSha256:'a'.repeat(64)});await reject(input,noReview);await reject(input,stranger);await reject(input,{...actor,organizationId:randomUUID()});await reject(input,actor,otherObjectId);await reject(input,actor,objectId,files[1].id);await reject(input,null as any);
  expect(await repo.getMatrixInventorySourcePages!(checkId,files[0].id,noRead)).toBeUndefined();expect(await repo.getSourceReview(objectId,files[0].id,noRead)).toBeUndefined();
  for(const key of ['checkId','inputManifestHash','textStageContentHash','textArtifactHash','declarationId']){const x:any=structuredClone(input);x.steelComparisonScope.claims[0].target[key]=key==='checkId'?'CHK-UNRELATED':'b'.repeat(64);await reject(x);}
  const forged:any=structuredClone(input);forged.steelComparisonScope.claims[0].declarationSnapshot=expectedSnapshots[0];await reject(forged);
  const raw=structuredClone(input);raw.steelComparisonScope.claims[0].memberMapping.scopeFragments[0].rawText+=' forged';await reject(raw);const box=structuredClone(input);box.steelComparisonScope.claims[0].memberMapping.scopeFragments[0].bboxMilliPoints[0]++;await reject(box);
 });
 it('rebuilds inherited steel with shared latest CAS, preserves sibling claims, withdraws explicitly and rejects corrupted history',async()=>{
  const{input}=await request();const{steelComparisonScope:_scope,expectedReviewHash:_cas,...legacy}=input;
  const siblings={inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[]},callInventoryScope:{schemaVersion:'matrix-odi123-call-inventory-review-v1',claims:[]},railInventoryScope:{schemaVersion:'matrix-odi120-rail-inventory-review-v1',claims:[]},waterNodeScope:{schemaVersion:'matrix-zu129-water-node-review-v1',claims:[]},lightingTechnologyScope:{schemaVersion:'matrix-zu130-lighting-technology-review-v1',claims:[]}};
  const edited=success(await repo.recordSourceReviewCommand(objectId,files[0].id,{...legacy,...siblings,approvalStatus:'UNKNOWN',expectedReviewHash:input.expectedReviewHash} as any,command(actor)));expect(edited).toMatchObject(siblings);expect(edited.steelComparisonScope).toEqual(stored[0].steelComparisonScope);expect(edited.contentHash).toBe(reviewHash(0,edited));
  const baseline=await count();expect((await repo.recordSourceReviewCommand(objectId,files[0].id,{...legacy,expectedReviewHash:stored[0].contentHash},command(actor))).kind).not.toBe('success');expect(await count()).toBe(baseline);
  const withdrawn=success(await repo.recordSourceReviewCommand(objectId,files[0].id,{...legacy,expectedReviewHash:edited.contentHash,steelComparisonScope:{schemaVersion:'matrix-kr056-steel-review-v1',claims:[]}},command(actor)));
  expect(withdrawn).toMatchObject(siblings);expect(withdrawn.steelComparisonScope.claims).toEqual([]);expect(withdrawn.contentHash).toBe(reviewHash(0,withdrawn));expect(await repo.getSourceReview(objectId,files[0].id,actor)).toEqual(withdrawn);
  await expect(db.query('UPDATE source_review_decisions SET steel_comparison_scope=NULL WHERE id=$1',[stored[0].id])).rejects.toThrow();
  await db.query(`INSERT INTO source_review_decisions SELECT (jsonb_populate_record(NULL::source_review_decisions,to_jsonb(r)||jsonb_build_object('id',$2::text,'content_hash',$3::text,'created_at','2031-01-01T00:00:00Z'))).* FROM source_review_decisions r WHERE r.id=$1`,[withdrawn.id,randomUUID(),'f'.repeat(64)]);
  const n=await count();expect(await repo.getSourceReview(objectId,files[0].id,actor)).toBeUndefined();expect((await repo.recordSourceReviewCommand(objectId,files[0].id,{...legacy,expectedReviewHash:'f'.repeat(64)},command(actor))).kind).not.toBe('success');expect(await count()).toBe(n);
 });
 it('never replays an authenticated original-snapshot response after the same actor loses object membership',async()=>{
  const reviewer=await user([objectId],['READ','REVIEW_DECIDE']);const{input}=await request(1);const c=command(reviewer);
  const saved=success(await repo.recordSourceReviewCommand(objectId,files[1].id,input,c));expect(saved.actorId).toBe(reviewer.userId);expect(saved.steelComparisonScope.claims[0].declarationSnapshot).toEqual(expectedSnapshots[1]);
  const baseline=await count();const revoked=await db.query(`UPDATE object_memberships SET revoked_at=now() WHERE user_id=$1 AND object_id=(SELECT id FROM objects WHERE api_id=$2) AND revoked_at IS NULL`,[reviewer.userId,objectId]);expect(revoked.rowCount).toBe(1);
  const replay=await repo.recordSourceReviewCommand(objectId,files[1].id,input,c);
  expect(replay.kind).not.toBe('success');expect(replay).not.toHaveProperty('value');expect(JSON.stringify(replay)).not.toContain('declarationSnapshot');expect(await count()).toBe(baseline);
 });
});
