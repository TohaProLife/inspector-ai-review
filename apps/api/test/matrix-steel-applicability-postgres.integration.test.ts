/** Independent T72 local PG: original PDFs and whole v2/manual snapshots; no steel DUT oracle. */
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
(adminUrl?describe:describe.skip)('T72 authenticated steel applicability journal',{timeout:180000},()=>{
 const name=`steel_applicability_${randomUUID().replaceAll('-','')}`,org='steel-applicability-independent';let admin:Pool,db:Pool,repo:PostgresInspectionRepository,dir:string;
 let actor:AuthenticatedActor,noRead:AuthenticatedActor,noReview:AuthenticatedActor,stranger:AuthenticatedActor,objectId:string,otherObjectId:string,checkId:string;
 let files:any[],artifacts:any[],expectedSnapshots:any[],stored:any[]=[];
 async function user(objects:string[],permissions:any[]):Promise<AuthenticatedActor>{const u=await provisionLocalUser(db,{organizationSlug:org,login:`qa-${randomUUID()}`,displayName:'Synthetic steel reviewer',password:'Synthetic-Only-Test-2026!',objectApiIds:objects,objectPermissions:permissions});return{sessionId:randomUUID(),userId:u.id,organizationId:u.organizationId,displayName:'Synthetic steel reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'x',expiresAt:'2030-01-01T00:00:00Z'}as AuthenticatedActor;}
 beforeAll(async()=>{
  admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl!);url.pathname=`/${name}`;await runDatabaseMigrations(url.toString());db=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});dir=await mkdtemp(join(tmpdir(),'steel-review-'));
  repo=await PostgresInspectionRepository.create({connectionString:url.toString(),parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});
  objectId=(await repo.createObject({name:'T72 SYNTHETIC original steel declarations; human mapping fixture',address:'Москва'})).id;otherObjectId=(await repo.createObject({name:'T72 unrelated object',address:'Москва'})).id;
  actor=await user([objectId,otherObjectId],['READ','REVIEW_DECIDE','RUN']);noRead=await user([objectId],['REVIEW_DECIDE']);noReview=await user([objectId],['READ']);stranger=await user([],['READ','REVIEW_DECIDE']);
  files=manual.sources.map((s:any,i:number)=>{const pdf=readFileSync(new URL(`fixtures/matrix-steel-originals-v1/synthetic-steel-${i?'RD':'PD'}.pdf`,root));expect(sha256(pdf)).toBe(s.sourceSha256);return{id:`FIL-${randomUUID()}`,name:`T72-synthetic-${i?'RD':'PD'}.pdf`,stage:i?'RD':'PD',size:pdf.length,mimeType:'application/pdf',sha256:s.sourceSha256,scanStatus:'CLEAN',status:'STORED',storageKey:`original-${randomUUID()}.pdf`};});
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

 let unknown:any,approved:any,withdrawn:any,approvedCommand:any,approvedInput:any;
 const record=(input:any,c:any=command(actor),object=objectId)=>(repo as any).recordSteelApplicabilityReviewCommand(object,input,c);
 const read=(who:any=actor,object=objectId)=>(repo as any).getSteelApplicabilityReviews(object,who);
 const projectionHash=(p:any)=>{const{contentHash:_hash,...decision}=p;return sha256(literalCanonical({hashDomain:'matrix-kr056-steel-applicability-decision-json-v1',decision}));};
 const journalHash=(v:any)=>{const{contentHash:_hash,...decision}=v;return sha256(literalCanonical({hashDomain:'matrix-kr056-steel-applicability-review-journal-v1',decision}));};
 async function pairInput(status='UNKNOWN',cas:string|null=null){
  const refs=files.map((f,i)=>({sourceFileId:f.id,sourceSha256:f.sha256,reviewDecisionId:stored[i].id,reviewContentHash:stored[i].contentHash,target:stored[i].steelComparisonScope.claims[0].target,productScope:expectedSnapshots[i].productScope}));
  return{schemaVersion:'matrix-kr056-steel-applicability-review-v1',status,identity:structuredClone(manual.identities[0]),expected:structuredClone(refs[0]),actual:structuredClone(refs[1]),basis:structuredClone(manual.applicabilityDecisions[0].basis),expectedReviewHash:cas};
 }
 async function assertDecision(v:any,input:any,who=actor){
  const internal=(await db.query('SELECT id FROM objects WHERE api_id=$1',[objectId])).rows[0].id;
  expect(Object.keys(v).sort()).toEqual(['id','objectId','actorId','previousReviewHash','contentHash','projection','createdAt'].sort());
  expect(v).toMatchObject({objectId,actorId:who.userId,previousReviewHash:input.expectedReviewHash});expect(v.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(v.projection).toEqual({schemaVersion:'matrix-kr056-steel-applicability-decision-v1',decisionId:v.id,contentHash:projectionHash(v.projection),objectId:internal,status:input.status,authorityKind:'HUMAN_REVIEWED_DECLARATION_APPLICABILITY',identity:input.identity,expected:input.expected,actual:input.actual,basis:input.basis});
  expect(v.contentHash).toBe(journalHash(v));expect(v.contentHash).not.toBe(v.projection.contentHash);
 }
 async function writeCounts(){const names=['command_receipts','audit_events'];const rows:any={};for(const n of names)rows[n]=(await db.query(`SELECT count(*)::int n FROM ${n}`)).rows[0].n;const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%steel%applicability%'`)).rows;for(const t of tables)rows[t.tablename]=(await db.query(`SELECT count(*)::int n FROM "${t.tablename}"`)).rows[0].n;return rows;}
 it('seals ordinary original-v2 audit, materializes source claims, then records UNKNOWN to APPROVED with independent whole hashes and CAS',async()=>{
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
  for(let i=0;i<2;i++){const{input}=await request(i);stored[i]=success(await repo.recordSourceReviewCommand(objectId,files[i].id,input,command(actor)));expect(stored[i].steelComparisonScope.claims[0].declarationSnapshot).toEqual(expectedSnapshots[i]);}
  const sourceBytes=canonicalJson((await db.query('SELECT id,content_hash,steel_comparison_scope FROM source_review_decisions ORDER BY id')).rows);
  const first=await pairInput();unknown=success(await record(first));await assertDecision(unknown,first);
  approvedInput=await pairInput('APPROVED',unknown.contentHash);approvedCommand=command(actor);approved=success(await record(approvedInput,approvedCommand));await assertDecision(approved,approvedInput);
  expect(await read()).toEqual({items:[approved],canReview:true});expect(await record(approvedInput,approvedCommand)).toMatchObject({kind:'success',replayed:true,value:approved});
  expect(canonicalJson((await db.query('SELECT id,content_hash,steel_comparison_scope FROM source_review_decisions ORDER BY id')).rows)).toBe(sourceBytes);
 });
 it('rejects wrong CAS, pair/origin/product/basis/source/actor and changed original bytes before receipt, audit or journal writes',async()=>{
  const valid=await pairInput('APPROVED',approved.contentHash);
  const reject=async(input:any,who:any=actor,object=objectId)=>{const before=await writeCounts();let out:any;try{out=await record(input,command(who),object);}catch{out={kind:'rejected'};}expect(out.kind).not.toBe('success');expect(out).not.toHaveProperty('value');expect(await writeCounts()).toEqual(before);};
  await reject({...valid,expectedReviewHash:null});const stale=structuredClone(valid);stale.expected.reviewContentHash='a'.repeat(64);await reject(stale);
  const product=structuredClone(valid);product.actual.productScope.profile='FAKE-70';await reject(product);
  const raw=structuredClone(valid);raw.basis.expectedScopeFragments[0].rawText+=' forged';await reject(raw);
  const box=structuredClone(valid);box.basis.actualScopeFragments[0].bboxMilliPoints[0]++;await reject(box);
  const sha=structuredClone(valid);sha.actual.sourceSha256='b'.repeat(64);await reject(sha);
  const target=structuredClone(valid);target.expected.target.declarationId='c'.repeat(64);await reject(target);
  await reject(valid,noReview);await reject(valid,stranger);await reject(valid,null);await reject(valid,{...actor,organizationId:randomUUID()});await reject(valid,actor,otherObjectId);
  expect(await read(noRead)).toBeUndefined();expect(await read(stranger)).toBeUndefined();expect(await read(null)).toBeUndefined();
  const original=readFileSync(join(dir,files[1].storageKey));try{const changed=Buffer.from(original);changed[changed.length-1]^=1;await writeFile(join(dir,files[1].storageKey),changed);await reject(valid);}finally{await writeFile(join(dir,files[1].storageKey),original);}
  expect(await read()).toEqual({items:[approved],canReview:true});
 });
 it('keeps stale approved history after source claim revocation and permits exact terminal withdrawal without falling back',async()=>{
  const{input}=await request(0);const revoked=success(await repo.recordSourceReviewCommand(objectId,files[0].id,{...input,steelComparisonScope:{schemaVersion:'matrix-kr056-steel-review-v1',claims:[]}},command(actor)));expect(revoked.steelComparisonScope.claims).toEqual([]);
  expect(await read()).toEqual({items:[approved],canReview:true});await assertDecision(approved,approvedInput);
  const before=await writeCounts();expect((await record({...approvedInput,expectedReviewHash:approved.contentHash})).kind).not.toBe('success');expect(await writeCounts()).toEqual(before);
  const inputWithdraw={...structuredClone(approvedInput),status:'WITHDRAWN',expectedReviewHash:approved.contentHash};withdrawn=success(await record(inputWithdraw));await assertDecision(withdrawn,inputWithdraw);
  expect(withdrawn.projection.expected).toEqual(approved.projection.expected);expect(withdrawn.projection.actual).toEqual(approved.projection.actual);expect(withdrawn.projection.basis).toEqual(approved.projection.basis);
  expect(await read()).toEqual({items:[withdrawn],canReview:true});expect((await read()).items).not.toContainEqual(approved);
  const retarget=structuredClone(inputWithdraw);retarget.expectedReviewHash=withdrawn.contentHash;retarget.basis.reference+=' altered';const n=await writeCounts();expect((await record(retarget)).kind).not.toBe('success');expect(await writeCounts()).toEqual(n);
 });
 it('survives repository reopen, refuses corrupted whole hashes and freshly denies receipt replay after reviewer membership revocation',async()=>{
  await repo.close();const url=new URL(adminUrl!);url.pathname=`/${name}`;repo=await PostgresInspectionRepository.create({connectionString:url.toString(),parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:org,storage:new LocalObjectStorage(dir)});
  expect(await read()).toEqual({items:[withdrawn],canReview:true});
  // Restore source claim for a separate actor receipt; authority is synthetic local test state.
  const{input}=await request(0);stored[0]=success(await repo.recordSourceReviewCommand(objectId,files[0].id,input,command(actor)));
  const reviewer=await user([objectId],['READ','REVIEW_DECIDE']);const next=await pairInput('UNKNOWN',withdrawn.contentHash),c=command(reviewer);const saved=success(await record(next,c));await assertDecision(saved,next,reviewer);const count=await writeCounts();
  expect((await db.query(`UPDATE object_memberships SET revoked_at=now() WHERE user_id=$1 AND object_id=(SELECT id FROM objects WHERE api_id=$2) AND revoked_at IS NULL`,[reviewer.userId,objectId])).rowCount).toBe(1);
  const replay=await record(next,c);expect(replay.kind).not.toBe('success');expect(replay).not.toHaveProperty('value');expect(JSON.stringify(replay)).not.toContain('projection');expect(await writeCounts()).toEqual(count);
  expect(await read()).toEqual({items:[saved],canReview:true});
  const table='matrix_steel_applicability_decisions';
  const history=(await db.query(`SELECT * FROM ${table} ORDER BY sequence_no`)).rows;
  expect(history).toHaveLength(4);expect(history.map(r=>r.id)).toEqual([unknown.id,approved.id,withdrawn.id,saved.id]);
  expect(history.map(r=>r.previous_decision_id)).toEqual([null,unknown.id,approved.id,withdrawn.id]);
  expect(new Set(history.map(r=>r.pair_key.trim())).size).toBe(1);
  const internal=(await db.query('SELECT id FROM objects WHERE api_id=$1',[objectId])).rows[0].id;
  const pairKey=sha256(literalCanonical({hashDomain:'matrix-kr056-steel-applicability-pair-key-v1',objectId:internal,identity:next.identity,expectedSourceFileId:files[0].id,actualSourceFileId:files[1].id}));
  expect(history.every(r=>r.pair_key.trim()===pairKey)).toBe(true);
  await expect(db.query(`UPDATE ${table} SET projection_json='{}'::jsonb WHERE id=$1`,[approved.id])).rejects.toThrow();
  await expect(db.query(`DELETE FROM ${table} WHERE id=$1`,[approved.id])).rejects.toThrow();
  // Deliberate DBA fixture corruption: fresh sequence, self-consistent projection, wrong JOURNAL hash only.
  const forgedId=randomUUID(),forgedProjection={...structuredClone(saved.projection),decisionId:forgedId};forgedProjection.contentHash=projectionHash(forgedProjection);
  await db.query(`INSERT INTO ${table}(id,object_id,pair_key,expected_source_file_id,actual_source_file_id,expected_review_decision_id,actual_review_decision_id,previous_decision_id,previous_review_hash,projection_json,actor_id,content_hash,created_at)
   SELECT $2::uuid,object_id,pair_key,expected_source_file_id,actual_source_file_id,expected_review_decision_id,actual_review_decision_id,id,content_hash,$3::jsonb,actor_id,$4::text,$5::timestamptz FROM ${table} WHERE id=$1`,[saved.id,forgedId,JSON.stringify(forgedProjection),'f'.repeat(64),new Date().toISOString()]);
  let corruptRead:any;try{corruptRead=await read();}catch{corruptRead=undefined;}expect(corruptRead).toBeUndefined();
  const beforeBad=await writeCounts();let out:any;try{out=await record({...next,expectedReviewHash:'f'.repeat(64)});}catch{out={kind:'rejected'};}expect(out.kind).not.toBe('success');expect(out).not.toHaveProperty('value');expect(await writeCounts()).toEqual(beforeBad);
 });
});
