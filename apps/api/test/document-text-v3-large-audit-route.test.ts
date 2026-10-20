/** Independent T79 inject protocol expectations; no real HTTP/queue/browser claim. */
import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {RoutedInspectionRepository} from '../src/repository-factory.js';
import {InspectorStore} from '../src/store.js';
import {buildDocumentTextV3LargeAuditReleaseTextLayer} from '../src/document-text-v3-large-audit-release.js';
import type {AuthenticatedActor,IdentityService} from '../src/identity.js';
import type {PostgresInspectionRepository} from '../src/postgres-repository.js';
const root=new URL('../../../',import.meta.url),profile='SOURCE_AUDIT_V3_LARGE_VERTICAL_V1',policy='document-text-v3-large-source-bounds-v1';
const actor:AuthenticatedActor={sessionId:randomUUID(),userId:randomUUID(),organizationId:randomUUID(),displayName:'Independent source reader',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW','RUN_START'],csrfHash:'a'.repeat(64),expiresAt:'2030-01-01T00:00:00Z'};
const identity:IdentityService={login:async()=>undefined,resolveSession:async t=>t==='session'?actor:undefined,verifyCsrf:(_a,t)=>t==='csrf',revokeSession:async()=>undefined,close:async()=>undefined};
const headers={cookie:'inspector_session=session; inspector_csrf=csrf','x-csrf-token':'csrf','content-type':'application/json','idempotency-key':'qa-t79-large-start'};
const check={id:'CHK-LARGE',objectId:'OBJ-NORMAL',status:'PROCESSING',progress:0,currentStage:'Ожидание worker',startedAt:'2026-10-18T00:00:00Z',completedAt:null,mode:'NORMAL',modelVersion:null,rulesVersion:'matrix-132-v1',stats:{total:132,unsupported:132,candidates:0,confirmed:0,negativeVerified:0,notComparable:0,clarification:0,suspicion:0},purpose:'SOURCE_AUDIT_ONLY',sourceAuditProfileVersion:profile};
const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=(v:any)=>createHash('sha256').update(canonical(v)).digest('hex');
it('public new start keeps session/CSRF/RUN/idempotency, rejects extra and lossy body, forwards only explicit large selector',async()=>{
 const start=vi.fn().mockResolvedValue({kind:'success',value:check,replayed:false}),permission=vi.fn().mockResolvedValue(true),write=vi.fn(()=>{throw Error('No inline complete');});
 const normal={close:vi.fn(),hasObjectPermission:permission,startCheckCommand:start,completeJob:write}as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity}),url='/api/objects/OBJ-NORMAL/source-audit-v3-large-vertical-v1';
 try{
  expect((await app.inject({method:'POST',url,payload:{}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url,headers:{cookie:headers.cookie},payload:{}})).statusCode).toBe(403);
  const {'idempotency-key':_key,...noKey}=headers;
  expect((await app.inject({method:'POST',url,headers:noKey,payload:{}})).statusCode).toBe(428);
  for(const payload of ['{"sourceAuditV3Large":true}','{"x":0,"x":1}','{"x":1.0}'])expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(400);
  expect(start).not.toHaveBeenCalled();
  const good=await app.inject({method:'POST',url,headers,payload:{}});expect(good.statusCode,good.body).toBe(201);expect(good.json()).toEqual(check);expect(good.headers['cache-control']).toBe('private, no-store');
  expect(start).toHaveBeenCalledExactlyOnceWith('OBJ-NORMAL',expect.objectContaining({actor,idempotencyKey:headers['idempotency-key']}),{sourceAuditV3Large:true});
  permission.mockResolvedValueOnce(false);expect((await app.inject({method:'POST',url,headers,payload:{}})).statusCode).toBe(403);expect(start).toHaveBeenCalledTimes(1);expect(write).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('worker completion authenticates before parsing and strictly rejects duplicate/float/unknown DTO without repository callback',async()=>{
 const complete=vi.fn().mockResolvedValue({kind:'completed',check,replayed:false});
 const normal={close:vi.fn(),completeJob:complete}as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),workerToken:'t79-isolated-worker'}),url='/api/internal/v1/jobs/00000000-0000-4000-8000-000000000079/complete-source-audit-v3-large-v1';
 const worker={'x-worker-token':'t79-isolated-worker','content-type':'application/json'},value={attemptId:'attempt-79',fencingToken:1,result:{}};
 try{
  expect((await app.inject({method:'POST',url,headers:{'content-type':'application/json'},payload:'not-json'})).statusCode).toBe(401);
  for(const payload of ['{"attemptId":"a","fencingToken":1,"fencingToken":2,"result":{}}','{"attemptId":"a","fencingToken":1.0,"result":{}}','{"attemptId":"a","fencingToken":1,"result":{},"extra":0}','{"attemptId":"a","fencingToken":1,"result":{"x":1,"x":2}}'])expect((await app.inject({method:'POST',url,headers:worker,payload})).statusCode).toBe(400);
  expect(complete).not.toHaveBeenCalled();
  const response=await app.inject({method:'POST',url,headers:worker,payload:value});expect(response.statusCode,response.body).toBe(200);expect(response.json().status).toBe('COMPLETED');
  expect(complete).toHaveBeenCalledExactlyOnceWith('00000000-0000-4000-8000-000000000079',value,expect.objectContaining({sourceAuditProfileVersion:profile,signal:expect.any(AbortSignal)}));
  complete.mockResolvedValueOnce({kind:'invalid_state',code:'SOURCE_AUDIT_COMPLETION_PROFILE_MISMATCH',message:'Wrong persisted profile'});
  expect((await app.inject({method:'POST',url,headers:worker,payload:value})).statusCode).toBe(409);
 }finally{await app.close();}
});
it('new source GET serializes full native/raw original unchanged, authenticates actor, denies unavailable without writes',async()=>{
 const bytes=readFileSync(new URL('fixtures/document-text-v3-vertical-v1/qa-whole-manual-goldens.json',root));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe('acea8244f1c29256b4df0ca7ab8573c334ae6b196d24eb0b3f6a4abdb5f8735b');
 const artifact=structuredClone(JSON.parse(bytes.toString()).cases[0].artifact),layer=buildDocumentTextV3LargeAuditReleaseTextLayer();
 artifact.extractorProfile=structuredClone(layer.extractorProfile);artifact.extractorProfileHash=layer.extractorProfileHash;
 const expected={schemaVersion:'document-text-v3-large-source-read-v1',purpose:'SOURCE_AUDIT_ONLY',sourceAuditProfileVersion:profile,resourcePolicyVersion:policy,checkId:check.id,sourceFileId:artifact.sourceFileId,sourceSha256:artifact.inputSha256,inputManifestHash:'a'.repeat(64),textStageContentHash:hash(artifact),textArtifactByteSha256:hash(artifact),textArtifactContentHash:hash({hashDomain:'document-text-v3-content-v1',artifact}),extractorProfileHash:artifact.extractorProfileHash,stage:'PD',pageStages:{},latestReviewHash:null,authorityStatus:'SOURCE_DECLARED_UNVERIFIED',renderedVisibility:'UNVERIFIED',calibratedProbability:null,textArtifact:artifact};
 const before=structuredClone(expected),read=vi.fn().mockResolvedValue(expected),write=vi.fn(()=>{throw Error('Read-only source route');});
 const normal={close:vi.fn(),getDocumentTextV3LargeSource:read,recordSourceReviewCommand:write,startCheckCommand:write}as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity}),url=`/api/checks/${check.id}/source-text-v3-large-v1?sourceFileId=${encodeURIComponent(artifact.sourceFileId)}`;
 try{
  expect((await app.inject({method:'GET',url})).statusCode).toBe(401);expect(read).not.toHaveBeenCalled();
  const response=await app.inject({method:'GET',url,headers:{cookie:headers.cookie}});expect(response.statusCode,response.body).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store');expect(response.json()).toEqual(expected);expect(expected).toEqual(before);
  expect(read).toHaveBeenCalledExactlyOnceWith(check.id,artifact.sourceFileId,actor);
  read.mockResolvedValueOnce(undefined);expect((await app.inject({method:'GET',url,headers:{cookie:headers.cookie}})).statusCode).toBe(404);expect(write).not.toHaveBeenCalled();
 }finally{await app.close();}
});
