/** Independent frozen start-command ordering: authenticated persisted replay precedes new-runtime availability. */
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {runDatabaseMigrations} from '../src/database-migrations.js';
import {PostgresInspectionRepository} from '../src/postgres-repository.js';
import {LocalObjectStorage} from '../src/storage.js';
import {loadReferenceData} from '../src/reference-data.js';
import {provisionLocalUser} from '../src/user-provisioning.js';
import {sha256} from '../src/canonical-json.js';
import type {AuthenticatedActor} from '../src/identity.js';
const adminUrl=process.env.INSPECTOR_POSTGRES_ADMIN_URL;
const flagKeys=['INSPECTOR_MATRIX_STEEL_COMPARISONS_V11','INSPECTOR_MATRIX_STEEL_COMPARISONS','INSPECTOR_MATRIX_LIGHTING_TECHNOLOGY_COMPARISONS','INSPECTOR_MATRIX_WATER_NODE_COMPARISONS','INSPECTOR_MATRIX_RAIL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_CALL_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_INVENTORY_COMPARISONS','INSPECTOR_MATRIX_OCR_LAYOUT','INSPECTOR_MATRIX_VISUAL_PROPOSALS'];
async function selected<T>(flag:string,fn:()=>Promise<T>):Promise<T>{const old=flagKeys.map(k=>process.env[k]);for(const k of flagKeys)delete process.env[k];process.env[flag]='1';try{return await fn();}finally{flagKeys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}}
const archived=['INSPECTOR_MATRIX_LIGHTING_TECHNOLOGY_COMPARISONS','INSPECTOR_MATRIX_STEEL_COMPARISONS'];
(adminUrl?describe:describe.skip)('T80 authenticated persisted replay under unavailable historical runtime',{timeout:90000},()=>{
 const name=`matrix_v11_replay_${randomUUID().replaceAll('-','')}`;let admin:Pool,db:Pool,repo:PostgresInspectionRepository,dir:string,objectId:string,actor:AuthenticatedActor,stranger:AuthenticatedActor,original:any,c:any;
 const command=(who:AuthenticatedActor)=>({actor:who,idempotencyKey:randomUUID(),requestId:randomUUID(),traceId:randomUUID()});
 beforeAll(async()=>{
  admin=new Pool({connectionString:adminUrl,max:1,connectionTimeoutMillis:5000,query_timeout:20000});await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl!);url.pathname=`/${name}`;await runDatabaseMigrations(url.toString());db=new Pool({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:20000});dir=await mkdtemp(join(tmpdir(),'matrix-v11-replay-'));
  repo=await PostgresInspectionRepository.create({connectionString:url.toString(),parameters:(await loadReferenceData()).parameters,analysisProfile:'MATRIX_V1',organizationSlug:'matrix-v11-replay',storage:new LocalObjectStorage(dir)});objectId=(await repo.createObject({name:'Synthetic command replay boundary',address:'Москва'})).id;
  async function user(objects:string[]):Promise<AuthenticatedActor>{const u=await provisionLocalUser(db,{organizationSlug:'matrix-v11-replay',login:`qa-${randomUUID()}`,displayName:'Synthetic replay actor',password:'Synthetic-Only-Test-2026!',objectApiIds:objects,objectPermissions:['READ','RUN']});return{sessionId:randomUUID(),userId:u.id,organizationId:u.organizationId,displayName:'Synthetic replay actor',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'x',expiresAt:'2030-01-01T00:00:00Z'}as AuthenticatedActor;}
  actor=await user([objectId]);stranger=await user([]);const bytes=readFileSync(new URL('../../../fixtures/matrix-steel-originals-v1/synthetic-steel-PD.pdf',import.meta.url));const key=`original-${randomUUID()}.pdf`;await writeFile(join(dir,key),bytes);await repo.registerIngestedFiles(objectId,[{id:`FIL-${randomUUID()}`,name:'Synthetic-PD.pdf',stage:'PD',size:bytes.length,mimeType:'application/pdf',sha256:sha256(bytes),scanStatus:'CLEAN',status:'STORED',storageKey:key}]);
  c=command(actor);const started=await selected('INSPECTOR_MATRIX_STEEL_COMPARISONS_V11',()=>repo.startCheckCommand(objectId,c,{analysisMode:'FULL'}));expect(started.kind).toBe('success');if(started.kind!=='success')throw Error('Setup start rejected');expect(started.replayed).toBe(false);original=started.value;
 });
 afterAll(async()=>{await repo?.close();await db?.end();if(dir)await rm(dir,{recursive:true,force:true});if(admin)try{await admin.query('SET statement_timeout=10000');await admin.query('SET lock_timeout=5000');for(let i=0;i<100;i++){if((await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n===0)break;await new Promise(r=>setTimeout(r,20));}await admin.query(`DROP DATABASE IF EXISTS "${name}"`);}finally{await admin.end();}});
 const counts=async()=>(await db.query('SELECT (SELECT count(*)::int FROM analysis_runs) runs,(SELECT count(*)::int FROM analysis_jobs) jobs,(SELECT count(*)::int FROM run_steel_applicability_snapshot_states) snapshots')).rows[0];
 it('replays the same persisted current11 command after selecting each archived runtime without new queue or snapshot',async()=>{const before=await counts();for(const flag of archived){const replay=await selected(flag,()=>repo.startCheckCommand(objectId,c,{analysisMode:'FULL'}));expect(replay).toMatchObject({kind:'success',replayed:true});if(replay.kind!=='success')throw Error('Replay rejected');expect(replay.value).toEqual(original);expect(await counts()).toEqual(before);}});
 it('keeps persisted requestHash conflict visible under each archived runtime',async()=>{const before=await counts();for(const flag of archived){expect(await selected(flag,()=>repo.startCheckCommand(objectId,c,{analysisMode:'SAMPLE'}))).toEqual({kind:'idempotency_conflict'});expect(await counts()).toEqual(before);}});
 it('checks current scope before runtime availability while refusing a fresh authorized archived start',async()=>{const before=await counts();for(const flag of archived){expect(await selected(flag,()=>repo.startCheckCommand(objectId,command(actor),{analysisMode:'FULL'}))).toMatchObject({kind:'invalid_state',code:'MATRIX_RUNTIME_NOT_INSTALLED'});expect(await selected(flag,()=>repo.startCheckCommand(objectId,command(stranger),{analysisMode:'FULL'}))).toEqual({kind:'not_found'});expect(await selected(flag,()=>repo.startCheckCommand(`OBJ-${randomUUID()}`,command(actor),{analysisMode:'FULL'}))).toEqual({kind:'not_found'});expect(await counts()).toEqual(before);}});
});
