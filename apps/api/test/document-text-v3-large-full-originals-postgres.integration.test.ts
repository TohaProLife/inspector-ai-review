/** T79 full-source isolated PG proof. Actual repository/Python; no remote HTTP queue claim. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {runDatabaseMigrations} from '../src/database-migrations.js';
import {PostgresInspectionRepository} from '../src/postgres-repository.js';
import {LocalObjectStorage} from '../src/storage.js';
import {loadReferenceData} from '../src/reference-data.js';
import {provisionLocalUser} from '../src/user-provisioning.js';
import type {AuthenticatedActor} from '../src/identity.js';
import {pythonExecutable,pythonEnv} from './python.js';
const root=new URL('../../../',import.meta.url),adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const manifestPath=process.env.INSPECTOR_T79_ORIGINALS_MANIFEST??'/tmp/matrix-t76-real-sources-private.json';
const profile='SOURCE_AUDIT_V3_LARGE_VERTICAL_V1' as const,policy='document-text-v3-large-source-bounds-v1';
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
function canonical(v:any):string{return v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
const domainHash=(artifact:any)=>sha(canonical({hashDomain:'document-text-v3-content-v1',artifact}));
const literals=[
 {id:'F0106',pdfSha:'ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655',artifactSha:'6801bed2814742d5f217205bd052664854b0fa5148dcb1749080de467971036e',pages:139,lines:27522},
 {id:'F0141',pdfSha:'421a34429325f424d3e29086810b1283e805d9bb3c75646508e5434b248e5d5f',artifactSha:'a45ad0a73a5ba1a1c601f6f190c0cb976c7f989afac0e04fcbfae223d71ddbb0',pages:32,lines:10303},
];
const processor=`import json,sys,shutil,os\nfrom pathlib import Path\nfrom unittest.mock import patch\nfrom inspector_worker import durable_text_v3_large as mod\nx=json.load(sys.stdin)\ndef download(path,destination,expected_sha,expected_size,attempt):\n original=Path(x['paths'][path]);assert original.stat().st_size==expected_size;shutil.copyfile(original,destination)\nos.environ.pop('INSPECTOR_DURABLE_TEXT_CACHE_ROOT',None)\nwith patch.object(mod,'_download_source',side_effect=download):\n result=mod.process_document_text_layer_v3_large(x['lease'],x['attempt'],'t79-full-originals')\njson.dump(result,sys.stdout,ensure_ascii=False,separators=(',',':'))`;
const scaffold=`import json,sys\nfrom inspector_worker.stage_scaffold import DEFAULT_STAGE_PROVIDER_REGISTRY\nx=json.load(sys.stdin)\njson.dump(DEFAULT_STAGE_PROVIDER_REGISTRY.execute(x['type'],x['lease'],x['attempt']),sys.stdout)`;
async function python(script:string,input:any,timeout:number){return await new Promise<any>((resolve,reject)=>{
 const child=spawn(pythonExecutable,['-c',script],{cwd:root,env:{...process.env,...pythonEnv},stdio:['pipe','pipe','pipe']});let size=0;const out:Buffer[]=[],err:Buffer[]=[];
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Actual full-original processor timeout'));},timeout);
 child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>33554432){child.kill('SIGKILL');reject(Error('Processor stdout exceeds closed result bound'));}else out.push(b);});child.stderr.on('data',(b:Buffer)=>err.push(b));
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error(`Actual processor exit ${code}: ${Buffer.concat(err).toString().slice(-4000)}`));else try{resolve(JSON.parse(Buffer.concat(out).toString('utf8')));}catch(e){reject(e);}});child.stdin.end(JSON.stringify(input));
 });}
// Original PDFs and the private path manifest are external prerequisites; never package them.
const missingOriginalPrerequisites:string[]=existsSync(manifestPath)?[]:['originals manifest'];
if(adminUrl&&missingOriginalPrerequisites.length===0){
 const sourceInputs=JSON.parse(readFileSync(manifestPath,'utf8')).sources;
 for(const spec of literals){const source=sourceInputs.find((s:any)=>s.sourceFileId===spec.id);if(source?.originalPath&&!existsSync(source.originalPath))missingOriginalPrerequisites.push(spec.id+' original PDF');}
}
const fullOriginalSuite=adminUrl&&missingOriginalPrerequisites.length===0?describe:describe.skip;
fullOriginalSuite('T79 two complete real originals through isolated NORMAL source audit'+(!adminUrl?' [requires INSPECTOR_POSTGRES_ADMIN_URL]':missingOriginalPrerequisites.length?' [missing external prerequisite: '+missingOriginalPrerequisites.join(', ')+']':''),{timeout:240000},()=>{
 const name=`qa_t79_full_${randomUUID().replaceAll('-','')}`,org='qa-t79-full';let admin:Pool,db:Pool,repo:PostgresInspectionRepository,dir:string,actor:AuthenticatedActor,objectId:string,checkId:string;
 let files:any[]=[],manuals:any[]=[],originalPaths:string[]=[],dbUrl:string;
 beforeAll(async()=>{
  expect(statSync(manifestPath).mode&0o077).toBe(0);const sources=JSON.parse(readFileSync(manifestPath,'utf8')).sources;
  for(const spec of literals){const found=sources.find((s:any)=>s.sourceFileId===spec.id);expect(found?.originalSha256).toBe(spec.pdfSha);expect(sha(readFileSync(found.originalPath))).toBe(spec.pdfSha);originalPaths.push(found.originalPath);
   const bytes=readFileSync(new URL(`fixtures/portable-historical-tests-v1/root-full-original-${spec.id}.v3.json`,root));expect(sha(bytes)).toBe(spec.artifactSha);const artifact=JSON.parse(bytes.toString());expect(artifact.sourceFileId).toBe(spec.id);expect(artifact.inputSha256).toBe(spec.pdfSha);expect(artifact.pageCount).toBe(spec.pages);expect(artifact.pages.reduce((n:number,p:any)=>n+p.locatedLines.length,0)).toBe(spec.lines);manuals.push(artifact);}
  admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl!);url.pathname=`/${name}`;dbUrl=url.toString();await runDatabaseMigrations(dbUrl);db=new Pool({connectionString:dbUrl,statement_timeout:60000,query_timeout:65000});dir=await mkdtemp(join(tmpdir(),'qa-t79-full-'));
  repo=await PostgresInspectionRepository.create({connectionString:dbUrl,parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});
  objectId=(await repo.createObject({name:'T79 complete supplied originals; source audit only',address:'Isolated disposable test'})).id;
  const u=await provisionLocalUser(db,{organizationSlug:org,login:`qa-${randomUUID()}`,displayName:'Full source audit reader',password:'Synthetic-Only-T79-2026!',objectApiIds:[objectId],objectPermissions:['READ','RUN','REVIEW_DECIDE']});actor={sessionId:randomUUID(),userId:u.id,organizationId:u.organizationId,displayName:'Full source audit reader',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW','RUN_START'],csrfHash:'x',expiresAt:'2030-01-01T00:00:00Z'} as AuthenticatedActor;
  files=literals.map((s,i)=>({id:`FIL-${randomUUID()}`,name:`${s.id}-full-original.pdf`,stage:i?'RD':'PD',size:statSync(originalPaths[i]).size,mimeType:'application/pdf',sha256:s.pdfSha,scanStatus:'CLEAN',status:'STORED',storageKey:`original-${randomUUID()}.pdf`}));for(let i=0;i<files.length;i++)await copyFile(originalPaths[i],join(dir,files[i].storageKey));await repo.registerIngestedFiles(objectId,files);
 });
 afterAll(async()=>{await repo?.close();await db?.end();if(dir)await rm(dir,{recursive:true,force:true});if(admin)try{expect((await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n).toBe(0);await admin.query(`DROP DATABASE IF EXISTS "${name}"`);}finally{await admin.end();}});
 async function claim(type:string){const rows=(await db.query("SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.job_type=$2 AND job.state='READY'",[checkId,type])).rows;expect(rows).toHaveLength(1);const acquired=await repo.claimJob(rows[0].id,{workerId:'t79-full-originals',capabilities:[type as any]});expect(acquired.kind).toBe('acquired');if(acquired.kind!=='acquired')throw Error('No current claim');return{id:rows[0].id,lease:acquired.lease as any,attempt:{attemptId:acquired.lease.attemptId,fencingToken:acquired.lease.fencingToken}};}
 it('extracts and persists both full originals, completes9 jobs, seals and reopens exact full native history',async()=>{
  const started=await repo.startCheckCommand(objectId,{actor,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()},{sourceAuditV3Large:true});expect(started.kind).toBe('success');if(started.kind!=='success')throw Error('Normal audit start failed');checkId=started.value.id;expect(started.value).toMatchObject({mode:'NORMAL',purpose:'SOURCE_AUDIT_ONLY',sourceAuditProfileVersion:profile});
  const inv=await claim('ANALYSIS_INVENTORY');expect(inv.lease.release.rules.executionStatus).toBe('UNCONFIGURED');expect(inv.lease.release.textLayer).toMatchObject({resourcePolicyVersion:policy,extractorProfile:manuals[0].extractorProfile,extractorProfileHash:manuals[0].extractorProfileHash});expect(manuals[0].extractorProfile).toEqual(manuals[1].extractorProfile);
  expect((await repo.completeJob(inv.id,{...inv.attempt,result:{disposition:'MANIFEST_INVENTORIED',sourceCount:2,stageCounts:{PD:1,RD:1,ID:0}}})).kind).toBe('completed');
  const text=await claim('DOCUMENT_TEXT_LAYER'),paths=Object.fromEntries(text.lease.inputs.sourceFiles.map((s:any)=>[s.downloadPath,originalPaths[files.findIndex(f=>f.id===s.sourceFileId)]]));
  const result=await python(processor,{lease:text.lease,attempt:text.attempt,paths},150000);expect(result.sources).toHaveLength(2);expect(result.resourcePolicyVersion).toBe(policy);
  const expected=manuals.map((a,i)=>({...a,sourceFileId:files[i].id}));
  for(let i=0;i<2;i++){const a=result.sources.find((s:any)=>s.sourceFileId===files[i].id).artifact;expect(canonical(a)).toBe(canonical(expected[i]));expect(a.pageCount).toBe(literals[i].pages);expect(a.pages.map((p:any)=>p.pageNumber)).toEqual(Array.from({length:literals[i].pages},(_,n)=>n+1));}
  expect((await repo.completeJob(text.id,{...text.attempt,result},{sourceAuditProfileVersion:profile})).kind).toBe('completed');
  for(const type of ['DOCUMENT_RENDER','DOCUMENT_METADATA','DOCUMENT_LINKING','ENTITY_EXTRACTION','RULE_EVALUATION','EVIDENCE_VALIDATION']){const job=await claim(type);expect(job.lease.release.providerSlot?.status).toBe('UNCONFIGURED');const value=await python(scaffold,{type,...job},30000);expect(value.outputCount).toBe(0);expect((await repo.completeJob(job.id,{...job.attempt,result:value})).kind).toBe('completed');}
  const seal=await claim('ANALYSIS_SEAL_UNSUPPORTED');expect((await repo.completeJob(seal.id,{...seal.attempt,result:{disposition:'UNSUPPORTED_COVERAGE_SEALED'}})).kind).toBe('completed');
  expect(await repo.getCheck(checkId,actor)).toMatchObject({status:'PARTIAL',progress:100,purpose:'SOURCE_AUDIT_ONLY',sourceAuditProfileVersion:profile});expect((await db.query('SELECT count(*)::int n FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.state=\'SUCCEEDED\'',[checkId])).rows[0].n).toBe(9);
  expect((await db.query('SELECT count(*)::int n FROM parameter_coverage WHERE execution_rollup=\'UNSUPPORTED\'')).rows[0].n).toBe(132);expect((await db.query('SELECT count(*)::int n FROM rule_results')).rows[0].n).toBe(0);
  const historical:string[]=[];
  for(let i=0;i<2;i++){const value:any=await repo.getDocumentTextV3LargeSource(checkId,files[i].id,actor),plain=sha(canonical(expected[i]));expect(value).toBeDefined();expect(canonical(value.textArtifact)).toBe(canonical(expected[i]));expect(value).toMatchObject({resourcePolicyVersion:policy,sourceFileId:files[i].id,sourceSha256:literals[i].pdfSha,textArtifactByteSha256:plain,textStageContentHash:plain,textArtifactContentHash:domainHash(expected[i]),calibratedProbability:null,authorityStatus:'SOURCE_DECLARED_UNVERIFIED',renderedVisibility:'UNVERIFIED'});historical.push(canonical(value));
   const row=(await db.query('SELECT text.* FROM analysis_text_artifacts text JOIN analysis_runs run ON run.id=text.run_id WHERE run.api_id=$1 AND text.input_sha256=$2',[checkId,literals[i].pdfSha])).rows[0];expect(row.resource_policy_version).toBe(policy);expect(row.byte_size).toBe(Buffer.byteLength(canonical(expected[i]),'utf8'));expect(row.content_hash.trim()).toBe(plain);expect(canonical(row.content_json)).toBe(canonical(expected[i]));}
  await repo.close();repo=await PostgresInspectionRepository.create({connectionString:dbUrl,parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});for(let i=0;i<2;i++)expect(canonical(await repo.getDocumentTextV3LargeSource(checkId,files[i].id,actor))).toBe(historical[i]);
  console.info(JSON.stringify({status:'PASS_FULL_ORIGINALS_REPOSITORY_PYTHON_NOT_REMOTE_HTTP',sources:literals.map((s,i)=>({source:s.id,pages:s.pages,locatedLines:s.lines,rawNativeWholeEquality:true,canonicalBytes:Buffer.byteLength(canonical(expected[i]),'utf8'),domainHash:domainHash(expected[i])})),jobs:9,unsupported:132,ruleRows:0,reopenExact:true,onlyExpectedSubstitution:'sourceFileId',standWrites:0}));
 });
});
