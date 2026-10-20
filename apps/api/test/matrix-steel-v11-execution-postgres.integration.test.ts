/** Independent T80 current11 local PG: original PDFs and whole v2/manual snapshots; no steel DUT oracle. */
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
import {MATRIX_STEEL_COMPARISON_V11_PROFILE} from '../src/matrix-steel-comparison-profile-v11.js';
expect(MATRIX_STEEL_COMPARISON_V11_PROFILE).toBe('matrix-text-facts-steel-comparison-v11');
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
(adminUrl?describe:describe.skip)('T80 current11 authenticated original steel execution',{timeout:180000},()=>{
 const name=`steel_v11_execution_${randomUUID().replaceAll('-','')}`,org='steel-v11-independent';let admin:Pool,db:Pool,repo:PostgresInspectionRepository,dir:string;
 let actor:AuthenticatedActor,noRead:AuthenticatedActor,noReview:AuthenticatedActor,stranger:AuthenticatedActor,objectId:string,otherObjectId:string,checkId:string;
 let files:any[],artifacts:any[],expectedSnapshots:any[],stored:any[]=[];
 async function user(objects:string[],permissions:any[]):Promise<AuthenticatedActor>{const u=await provisionLocalUser(db,{organizationSlug:org,login:`qa-${randomUUID()}`,displayName:'Synthetic steel reviewer',password:'Synthetic-Only-Test-2026!',objectApiIds:objects,objectPermissions:permissions});return{sessionId:randomUUID(),userId:u.id,organizationId:u.organizationId,displayName:'Synthetic steel reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'x',expiresAt:'2030-01-01T00:00:00Z'}as AuthenticatedActor;}
 beforeAll(async()=>{
  admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl!);url.pathname=`/${name}`;await runDatabaseMigrations(url.toString());db=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});dir=await mkdtemp(join(tmpdir(),'steel-review-'));
  repo=await PostgresInspectionRepository.create({connectionString:url.toString(),parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});
  objectId=(await repo.createObject({name:'T73 SYNTHETIC original steel declarations; human mapping fixture',address:'Москва'})).id;otherObjectId=(await repo.createObject({name:'T73 unrelated object',address:'Москва'})).id;
  actor=await user([objectId,otherObjectId],['READ','REVIEW_DECIDE','RUN']);noRead=await user([objectId],['REVIEW_DECIDE']);noReview=await user([objectId],['READ']);stranger=await user([],['READ','REVIEW_DECIDE']);
  files=manual.sources.map((s:any,i:number)=>{const pdf=readFileSync(new URL(`fixtures/matrix-steel-originals-v1/synthetic-steel-${i?'RD':'PD'}.pdf`,root));expect(sha256(pdf)).toBe(s.sourceSha256);return{id:`FIL-${randomUUID()}`,name:`T73-synthetic-${i?'RD':'PD'}.pdf`,stage:i?'RD':'PD',size:pdf.length,mimeType:'application/pdf',sha256:s.sourceSha256,scanStatus:'CLEAN',status:'STORED',storageKey:`original-${randomUUID()}.pdf`};});
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

 const allManual=JSON.parse(manualBytes.toString());
 const snapshotHash=(s:any)=>{const{contentHash:_hash,...snapshot}=s;return sha256(literalCanonical({hashDomain:'matrix-kr056-steel-applicability-run-snapshot-json-v1',snapshot}));};
 let latestPair:any,positive:any,positiveBefore:any;const runs:any[]=[];
 const pairRecord=(input:any)=>(repo as any).recordSteelApplicabilityReviewCommand(objectId,input,command(actor));
 async function pair(status='APPROVED',cas:string|null=latestPair?.contentHash??null){
  const refs=files.map((f,i)=>({sourceFileId:f.id,sourceSha256:f.sha256,reviewDecisionId:stored[i].id,reviewContentHash:stored[i].contentHash,target:stored[i].steelComparisonScope.claims[0].target,productScope:expectedSnapshots[i].productScope}));
  const input={schemaVersion:'matrix-kr056-steel-applicability-review-v1',status,identity:structuredClone(manual.identities[0]),expected:refs[0],actual:refs[1],basis:structuredClone(manual.applicabilityDecisions[0].basis),expectedReviewHash:cas};
  latestPair=success(await pairRecord(input));return latestPair;
 }
 function expectedEnvelope(caseName:string,object:string,manifest:string,p:any){
  const value=structuredClone(allManual.validCases.find((c:any)=>c.name===caseName).expected.envelope);value.objectId=object;value.inputManifestHash=manifest;
  for(const row of value.results){if(row.comparison?.status==='CANDIDATE'){row.comparison.comparison.expected=structuredClone(p.projection.expected);row.comparison.comparison.actual=structuredClone(p.projection.actual);row.comparison.comparison.applicabilityDecisionId=p.id;row.comparison.comparison.applicabilityDecisionContentHash=p.projection.contentHash;}
   const{id:_id,...result}=row;row.id=sha256(literalCanonical({hashDomain:'matrix-steel-execution-result-id-v1',objectId:object,inputManifestHash:manifest,capabilityRegistryHash:value.capabilityRegistryHash,result}));}
  return value;
 }
 function expectedEvidence(envelope:any,p:any){return structuredClone(allManual.validCases.find((c:any)=>c.name==='authored-original-directed-positive').expected.evidence).map((e:any)=>{const ref=e.role==='EXPECTED'?p.projection.expected:p.projection.actual;return{...e,resultId:envelope.results[0].id,sourceFileId:ref.sourceFileId,sourceSha256:ref.sourceSha256,reviewDecisionId:ref.reviewDecisionId,reviewContentHash:ref.reviewContentHash,target:structuredClone(ref.target),applicabilityDecisionId:p.id,applicabilityDecisionContentHash:p.projection.contentHash};});}
 async function frozen(id:string){const row=(await db.query(`SELECT a.content_json,a.content_hash,s.submission_bytes,s.submission_hash FROM analysis_runs r JOIN analysis_stage_artifacts a ON a.run_id=r.id AND a.job_type='RULE_EVALUATION' JOIN machine_prediction_snapshots s ON s.run_id=r.id WHERE r.api_id=$1`,[id])).rows[0];expect(sha256(canonicalJson(row.content_json))).toBe(row.content_hash.trim());expect(sha256(row.submission_bytes)).toBe(row.submission_hash.trim());return{body:canonicalJson(row.content_json),hash:row.content_hash.trim(),submission:row.submission_bytes.toString('utf8'),submissionHash:row.submission_hash.trim()};}
 async function saved(id:string){const v=await repo.getMatrixExecution(id,actor);if(!v||typeof v==='string')throw Error('Sealed v11 read missing');return v as any;}
 const steelScript=`import json,sys\nfrom unittest.mock import patch\nfrom inspector_worker import durable_steel_comparison_matrix_v11 as worker\nfrom inspector_worker.pilot_rule_adapter import PilotPz002RuleAdapter\nx=json.load(sys.stdin);artifacts={a['sourceFileId']:a for a in x['artifacts']}\nwith patch.object(worker,'download_reviewed_inventory_comparison_inputs',return_value=x['loader']),patch.object(worker,'download_text_artifact',side_effect=lambda lease,source,attempt:artifacts[source['sourceFileId']]):\n result=PilotPz002RuleAdapter().execute(x['lease'],x['attempt'])\njson.dump(result,sys.stdout,ensure_ascii=False)`;

 async function withTamperedSnapshot(id:string,check:()=>Promise<void>){
  const state=(await db.query(`SELECT s.* FROM run_steel_applicability_snapshot_states s JOIN analysis_runs r ON r.id=s.run_id WHERE r.api_id=$1`,[id])).rows[0];expect(state).toBeTruthy();const forged=structuredClone(state.snapshot_json);forged.entries[0].journalContentHash='f'.repeat(64);forged.contentHash=snapshotHash(forged);
  const replace=async(body:any,hash:string)=>{const c=await db.connect();try{await c.query('BEGIN');await c.query('ALTER TABLE run_steel_applicability_snapshot_states DISABLE TRIGGER run_steel_applicability_snapshot_states_immutable');await c.query('UPDATE run_steel_applicability_snapshot_states SET snapshot_json=$2::jsonb,content_hash=$3 WHERE run_id=$1',[state.run_id,JSON.stringify(body),hash]);await c.query('ALTER TABLE run_steel_applicability_snapshot_states ENABLE TRIGGER run_steel_applicability_snapshot_states_immutable');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  try{await replace(forged,forged.contentHash);await check();}finally{await replace(state.snapshot_json,state.content_hash.trim());}
 }
 async function start(){const flags=['INSPECTOR_MATRIX_STEEL_COMPARISONS_V11','INSPECTOR_MATRIX_STEEL_COMPARISONS','INSPECTOR_MATRIX_LIGHTING_TECHNOLOGY_COMPARISONS','INSPECTOR_MATRIX_WATER_NODE_COMPARISONS','INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_OCR_LAYOUT','INSPECTOR_MATRIX_VISUAL_PROPOSALS'];const prior=flags.map(k=>process.env[k]);for(const f of flags)delete process.env[f];process.env[flags[0]]='1';try{return success(await repo.startCheckCommand(objectId,command(actor))).id;}finally{flags.forEach((f,i)=>prior[i]===undefined?delete process.env[f]:process.env[f]=prior[i]);}}
 async function run(caseName:string,included:boolean,attacks=false){const pairAtAdmission=structuredClone(latestPair),id=await start(),types:string[]=[];let accepted:any,loaderSnapshot:any;
  for(let n=0;n<14;n++){const q=await db.query(`SELECT j.id,j.job_type FROM analysis_jobs j JOIN analysis_runs r ON r.id=j.run_id WHERE r.api_id=$1 AND j.state='READY' ORDER BY j.created_at,j.id LIMIT 1`,[id]);if(!q.rows.length)break;const job=q.rows[0];types.push(job.job_type);const acquired=await repo.claimJob(job.id,{workerId:'steel-execution-it',capabilities:[job.job_type]});expect(acquired.kind).toBe('acquired');if(acquired.kind!=='acquired')throw Error('Lease missing');const lease=acquired.lease,attempt={attemptId:lease.attemptId,fencingToken:lease.fencingToken};let result:any;
   if(job.job_type==='ANALYSIS_INVENTORY')result={disposition:'MANIFEST_INVENTORIED',sourceCount:2,stageCounts:{PD:1,RD:1,ID:0}};
   else if(job.job_type==='DOCUMENT_TEXT_LAYER')result={disposition:'DOCUMENT_TEXT_LAYER_COMPLETED',sources:artifacts.map(a=>({sourceFileId:a.sourceFileId,inputSha256:a.inputSha256,status:'EXTRACTED',artifact:a}))};
   else if(job.job_type==='RULE_EVALUATION'){
    expect(lease.release.providerSlot).toMatchObject({profileId:'matrix-text-facts-steel-comparison-v11',adapterVersion:'11',configHash:'3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7'});
    const method=(repo as any).getJobSteelReviewedInventoryComparisonInputs.bind(repo);
    expect(await method(job.id,{...attempt,attemptId:randomUUID()})).toMatchObject({kind:'stale_attempt'});expect(await method(job.id,{...attempt,fencingToken:attempt.fencingToken+1})).toMatchObject({kind:'stale_attempt'});
    const aborted=new AbortController();aborted.abort();expect((await method(job.id,attempt,{signal:aborted.signal})).kind).not.toBe('available');
    if(attacks){const bytes=readFileSync(join(dir,files[0].storageKey));try{await writeFile(join(dir,files[0].storageKey),Buffer.alloc(bytes.length,32));expect((await method(job.id,attempt)).kind).not.toBe('available');}finally{await writeFile(join(dir,files[0].storageKey),bytes);}}
    const loaded=await method(job.id,attempt);expect(loaded.kind).toBe('available');if(loaded.kind!=='available')throw Error('Protected v6 loader unavailable');expect(loaded.schemaVersion).toBe('matrix-reviewed-inventory-loader-inputs-v6');expect(loaded.contentHash).toBe(sha256(loaded.canonical));const loader=JSON.parse(loaded.canonical);
    expect(Object.keys(loader).sort()).toEqual(['schemaVersion','objectId','inputManifestHash','inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison','steelApplicabilitySnapshot'].sort());
    for(const key of ['inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison']){expect(loader[key].objectId).toBe(lease.objectId);expect(loader[key].inputManifestHash).toBe(lease.inputManifestHash);expect(loader[key].sources.map((s:any)=>[s.sourceFileId,s.sourceSha256,s.stages])).toEqual(loader.steelComparison.sources.map((s:any)=>[s.sourceFileId,s.sourceSha256,s.stages]));}
    const sequence=(await db.query('SELECT sequence_no::text FROM matrix_steel_applicability_decisions WHERE id=$1',[pairAtAdmission.id])).rows[0].sequence_no;
    const pairKey=sha256(literalCanonical({hashDomain:'matrix-kr056-steel-applicability-pair-key-v1',objectId:lease.objectId,identity:pairAtAdmission.projection.identity,expectedSourceFileId:files[0].id,actualSourceFileId:files[1].id}));
    const snapshotBody={schemaVersion:'matrix-steel-applicability-run-snapshot-v1',objectId:lease.objectId,inputManifestHash:lease.inputManifestHash,entries:[{pairKey,decisionId:pairAtAdmission.id,sequenceNo:sequence,journalContentHash:pairAtAdmission.contentHash,projectionContentHash:pairAtAdmission.projection.contentHash,included}]};
    loaderSnapshot={...snapshotBody,contentHash:snapshotHash(snapshotBody)};expect(loader.steelApplicabilitySnapshot).toEqual(loaderSnapshot);expect(loader.steelComparison.applicabilityDecisions).toEqual(included?[pairAtAdmission.projection]:[]);
    const state=(await db.query(`SELECT s.* FROM run_steel_applicability_snapshot_states s JOIN analysis_runs r ON r.id=s.run_id WHERE r.api_id=$1`,[id])).rows[0];expect(state.snapshot_json).toEqual(loaderSnapshot);expect(state.content_hash.trim()).toBe(loaderSnapshot.contentHash);expect(state.input_manifest_hash.trim()).toBe(lease.inputManifestHash);expect(state.object_id).toBe(lease.objectId);
    const entries=(await db.query('SELECT pair_key,decision_id,sequence_no::text,journal_content_hash,projection_content_hash,included FROM run_steel_applicability_snapshot_entries WHERE run_id=$1 ORDER BY pair_key',[state.run_id])).rows.map(e=>({pairKey:e.pair_key.trim(),decisionId:e.decision_id,sequenceNo:e.sequence_no,journalContentHash:e.journal_content_hash.trim(),projectionContentHash:e.projection_content_hash.trim(),included:e.included}));expect(entries).toEqual(loaderSnapshot.entries);
    if(attacks)await withTamperedSnapshot(id,async()=>{expect((await method(job.id,attempt)).kind).not.toBe('available');expect((await db.query('SELECT 1 FROM analysis_stage_artifacts WHERE job_id=$1',[job.id])).rows).toHaveLength(0);});

    expect(await repo.getJobLightingTechnologyReviewedInventoryComparisonInputs(job.id,attempt)).toMatchObject({kind:'integrity_error'});
    const p=spawnSync(pythonExecutable,['-c',steelScript],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:48*1024*1024,env:{...process.env,...pythonEnv},input:JSON.stringify({lease,attempt,loader,artifacts})});expect(p.status,p.stderr).toBe(0);result=JSON.parse(p.stdout);
    const keys=['inventoryComparisons','callInventoryComparisons','railInventoryComparisons','waterNodeComparisons','lightingTechnologyComparisons','steelComparisons'];expect(result.execution.results).toHaveLength(63);expect(result.outputCount).toBe(69);expect(result.outputCount).toBe(result.execution.results.length+keys.reduce((sum,k)=>sum+result[k].results.length,0));
    expect(result.steelApplicabilitySnapshot).toEqual(loaderSnapshot);const expected=expectedEnvelope(caseName,lease.objectId,lease.inputManifestHash,pairAtAdmission);expect(result.steelComparisons).toEqual(expected);
    expect(result.effectiveCoverage.filter((c:any)=>c.implementedAtomicRules>0)).toHaveLength(61);expect(result.effectiveCoverage.reduce((n:number,c:any)=>n+c.implementedAtomicRules,0)).toBe(69);expect(result.effectiveCoverage.filter((c:any)=>c.executionStatus==='UNSUPPORTED')).toHaveLength(71);expect(result.effectiveCoverage.find((c:any)=>c.parameterCode==='KR-056')).toMatchObject({executionStatus:'PARTIAL',implementedAtomicRules:1,enabledAtomicRules:1,evaluatedAtomicRules:1,failures:0});
    for(const key of keys.slice(0,5))expect(result[key].results).toMatchObject([{kind:'UNBOUND_ATOM_ABSTENTION',calibratedProbability:null}]);
    if(attacks){const reject=async(v:any)=>{expect((await repo.completeJob(job.id,{...attempt,result:v})).kind).toBe('invalid_state');expect((await db.query('SELECT 1 FROM analysis_stage_artifacts WHERE job_id=$1',[job.id])).rows).toHaveLength(0);};
     for(const key of ['steelComparisons','steelApplicabilitySnapshot']){const v=structuredClone(result);delete v[key];await reject(v);}
     for(const change of [(v:any)=>v.outputCount--,(v:any)=>v.steelComparisons.results[0].comparison.calibratedProbability=.99,(v:any)=>v.steelComparisons.results[0].id='f'.repeat(64),(v:any)=>v.steelApplicabilitySnapshot.contentHash='e'.repeat(64),(v:any)=>{v.steelApplicabilitySnapshot.entries[0].included=false;v.steelApplicabilitySnapshot.contentHash=snapshotHash(v.steelApplicabilitySnapshot);},(v:any)=>{const e=v.steelComparisons,r=e.results[0];r.comparison.comparison.expected.sourceSha256='f'.repeat(64);const{id:_id,...body}=r;r.id=sha256(literalCanonical({hashDomain:'matrix-steel-execution-result-id-v1',objectId:e.objectId,inputManifestHash:e.inputManifestHash,capabilityRegistryHash:e.capabilityRegistryHash,result:body}));}]){const v=structuredClone(result);change(v);await reject(v);}
     expect((await repo.completeJob(job.id,{...attempt,fencingToken:attempt.fencingToken+1,result})).kind).toBe('stale_attempt');
    }
    accepted=result;
   }else if(job.job_type==='ANALYSIS_SEAL_UNSUPPORTED')result={disposition:'UNSUPPORTED_COVERAGE_SEALED'};
   else{const p=spawnSync(pythonExecutable,['-c',scaffold],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,...pythonEnv},input:JSON.stringify({type:job.job_type,lease,attempt})});expect(p.status,p.stderr).toBe(0);result=JSON.parse(p.stdout);expect(result.outputCount).toBe(0);}
   expect(await repo.completeJob(job.id,{...attempt,result})).toMatchObject({kind:'completed'});
  }
  expect(types).toHaveLength(9);expect(await repo.getCheck(id,actor)).toMatchObject({status:'PARTIAL',progress:100});const read=await saved(id);expect(read.steelApplicabilitySnapshot).toEqual(loaderSnapshot);expect(read.steelComparisons).toEqual(accepted.steelComparisons);
  const candidate=accepted.steelComparisons.results[0].comparison.status==='CANDIDATE';expect(read.steelComparisonEvidence).toEqual(candidate?expectedEvidence(accepted.steelComparisons,pairAtAdmission):[]);
  const out={checkId:id,saved:read,accepted,snapshot:loaderSnapshot,pair:pairAtAdmission};runs.push(out);return out;
 }
 it('seals original ordinary v4 sources, saves source and pair reviews, then executes/adopts exact v11 candidate with immutable snapshot and null confidence',async()=>{
  const flags=['INSPECTOR_MATRIX_STEEL_COMPARISONS_V11','INSPECTOR_MATRIX_STEEL_COMPARISONS','INSPECTOR_MATRIX_LIGHTING_TECHNOLOGY_COMPARISONS','INSPECTOR_MATRIX_WATER_NODE_COMPARISONS','INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_OCR_LAYOUT','INSPECTOR_MATRIX_VISUAL_PROPOSALS'];const prior=flags.map(k=>process.env[k]);for(const k of flags)delete process.env[k];
  try{
   for(const oldFlag of ['INSPECTOR_MATRIX_LIGHTING_TECHNOLOGY_COMPARISONS','INSPECTOR_MATRIX_STEEL_COMPARISONS']){process.env[oldFlag]='1';const rejected:any=await repo.startCheckCommand(objectId,command(actor));expect(rejected).toMatchObject({kind:'invalid_state',code:'MATRIX_RUNTIME_NOT_INSTALLED'});delete process.env[oldFlag];expect((await db.query('SELECT count(*)::int n FROM analysis_runs')).rows[0].n).toBe(0);expect((await db.query('SELECT count(*)::int n FROM run_steel_applicability_snapshot_states')).rows[0].n).toBe(0);}
   checkId=success(await repo.startCheckCommand(objectId,command(actor))).id;}finally{flags.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);}
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
  for(let i=0;i<2;i++){const{input}=await request(i);stored[i]=success(await repo.recordSourceReviewCommand(objectId,files[i].id,input,command(actor)));expect(stored[i].steelComparisonScope.claims[0].declarationSnapshot).toEqual(expectedSnapshots[i]);}
  await pair();positive=await run('authored-original-directed-positive',true,true);positiveBefore=await frozen(positive.checkId);
  expect(positive.saved.steelComparisonEvidence).toHaveLength(13);expect(await repo.getSubmission(positive.checkId,actor)).toEqual(JSON.parse(positiveBefore.submission));
  expect(JSON.parse(positiveBefore.submission).checks.at(-1)).toMatchObject({parameter_code:'M-056',pd_value:null,rd_value:null,id_value:null,violation_label:'COMPARISON_IMPOSSIBLE',protocol_status:'COMPARISON_IMPOSSIBLE',evidence:[]});
 });
 it('pins latest UNKNOWN and WITHDRAWN without fallback; a stale source excludes old approval until a new exact approval restores candidate',async()=>{
  await pair('UNKNOWN');await run('pair-unknown-operational',true);
  await pair('WITHDRAWN');await run('pair-withdrawn-operational',true);
  await pair('APPROVED');await run('authored-original-directed-positive',true);
  const{input}=await request(1);stored[1]=success(await repo.recordSourceReviewCommand(objectId,files[1].id,{...input,basis:{reference:'SYNTHETIC latest metadata edit; old pair refs remain historical'}},command(actor)));
  await run('pair-missing-operational',false);
  await pair('APPROVED');await run('authored-original-directed-positive',true);
  for(const r of runs){expect(r.accepted.effectiveCoverage.filter((c:any)=>c.parameterCode!=='KR-056')).toEqual(positive.accepted.effectiveCoverage.filter((c:any)=>c.parameterCode!=='KR-056'));}
  expect(await frozen(positive.checkId)).toEqual(positiveBefore);expect(await saved(positive.checkId)).toEqual(positive.saved);
 });
 it('preserves sealed execution/submission and exact journal snapshot after reopen, refuses changed original bytes and unauthorized reads',async()=>{
  await repo.close();const url=new URL(adminUrl!);url.pathname=`/${name}`;repo=await PostgresInspectionRepository.create({connectionString:url.toString(),parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});
  for(const r of runs){expect(await saved(r.checkId)).toEqual(r.saved);expect(await repo.getSubmission(r.checkId,actor)).toEqual(JSON.parse((await frozen(r.checkId)).submission));}
  expect(await frozen(positive.checkId)).toEqual(positiveBefore);
  const bytes=readFileSync(join(dir,files[0].storageKey));try{await writeFile(join(dir,files[0].storageKey),Buffer.alloc(bytes.length,32));expect(await repo.getMatrixExecution(positive.checkId,actor)).toBeUndefined();expect(await repo.getSubmission(positive.checkId,actor)).toBeUndefined();}finally{await writeFile(join(dir,files[0].storageKey),bytes);}
  expect(await repo.getMatrixExecution(positive.checkId,stranger)).toBeUndefined();expect(await repo.getSubmission(positive.checkId,noRead)).toBeUndefined();
  const runId=(await db.query('SELECT id FROM analysis_runs WHERE api_id=$1',[positive.checkId])).rows[0].id;
  await expect(db.query(`UPDATE run_steel_applicability_snapshot_states SET content_hash=$2 WHERE run_id=$1`,[runId,'e'.repeat(64)])).rejects.toThrow();await expect(db.query('DELETE FROM run_steel_applicability_snapshot_entries WHERE run_id=$1',[runId])).rejects.toThrow();
  await withTamperedSnapshot(positive.checkId,async()=>{expect(await repo.getMatrixExecution(positive.checkId,actor)).toBeUndefined();expect(await repo.getSubmission(positive.checkId,actor)).toBeUndefined();});
  expect(await saved(positive.checkId)).toEqual(positive.saved);expect(await frozen(positive.checkId)).toEqual(positiveBefore);
 });
});
