import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {RoutedInspectionRepository} from '../src/repository-factory.js';
import {InspectorStore} from '../src/store.js';
import type {PostgresInspectionRepository} from '../src/postgres-repository.js';
import type {AuthenticatedActor,IdentityService} from '../src/identity.js';

// Expected protocol authored before route implementation; no producer computes this oracle.
const actor:AuthenticatedActor={sessionId:randomUUID(),userId:randomUUID(),organizationId:randomUUID(),displayName:'Reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW','RUN_START'],csrfHash:'a'.repeat(64),expiresAt:'2030-01-01T00:00:00Z'};
const identity:IdentityService={login:async()=>undefined,resolveSession:async t=>t==='session'?actor:undefined,verifyCsrf:(_a,t)=>t==='csrf',revokeSession:async()=>undefined,close:async()=>undefined};
const headers={cookie:'inspector_session=session; inspector_csrf=csrf','x-csrf-token':'csrf','content-type':'application/json','idempotency-key':'qa-source-audit-key'};
const selection={pageNumber:1,fragments:[{sourcePath:[0,0],rawText:'Светильник L1. Источник света: LED.\n'}]};
const preview={checkId:'CHK-NORMAL',sourceFileId:'FIL-1',sourceSha256:'a'.repeat(64),latestReviewHash:null,result:{schemaVersion:'matrix-zu130-lighting-technology-source-v3-result-v1',status:'ABSTAIN',reasonCode:'STAGE_CONFLICT'}};
it('lighting preview requires session/CSRF, forwards exact selection, remains read-only and rejects lossy JSON',async()=>{
 const normal={close:vi.fn().mockResolvedValue(undefined),previewMatrixLightingTechnologySource:vi.fn().mockResolvedValue(preview),recordSourceReviewCommand:vi.fn()} as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity});
 const url='/api/checks/CHK-NORMAL/source-files/FIL-1/lighting-technology-preview';
 try{
  expect((await app.inject({method:'POST',url,payload:{selection}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url,headers:{cookie:headers.cookie},payload:{selection}})).statusCode).toBe(403);
  expect(normal.previewMatrixLightingTechnologySource).not.toHaveBeenCalled();
  const response=await app.inject({method:'POST',url,headers,payload:{selection}});
  expect(response.statusCode,response.body).toBe(200);expect(response.json()).toEqual(preview);expect(response.headers['cache-control']).toBe('private, no-store');
  expect(normal.previewMatrixLightingTechnologySource).toHaveBeenCalledExactlyOnceWith('CHK-NORMAL','FIL-1',selection,actor);
  for(const payload of [{selection,sourceSha256:'b'.repeat(64)},{selection:{...selection,geometry:[0,0,1,1]}},'{"selection":{},"selection":{}}']) expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(400);
  normal.previewMatrixLightingTechnologySource=vi.fn().mockResolvedValue(undefined);
  expect((await app.inject({method:'POST',url,headers,payload:{selection}})).statusCode).toBe(404);
  expect(normal.recordSourceReviewCommand).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('public source audit requires RUN, CSRF and idempotency; explicitly requests audit release and never completes inline',async()=>{
 const check={id:'CHK-AUDIT',objectId:'OBJ-NORMAL',status:'PROCESSING',progress:0,currentStage:'Ожидание worker',startedAt:'2026-10-18T00:00:00Z',completedAt:null,mode:'NORMAL',modelVersion:null,rulesVersion:'matrix-132-v1',stats:{total:132,unsupported:132,candidates:0,confirmed:0,negativeVerified:0,notComparable:0,clarification:0,suspicion:0}};
 const normal={close:vi.fn().mockResolvedValue(undefined),getObject:vi.fn().mockResolvedValue({id:'OBJ-NORMAL',fileCount:1}),hasObjectPermission:vi.fn().mockResolvedValue(true),startCheckCommand:vi.fn().mockResolvedValue({kind:'success',value:check,replayed:false}),completeCheck:vi.fn()} as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity}),url='/api/objects/OBJ-NORMAL/source-audit-v3';
 try{
  expect((await app.inject({method:'POST',url,payload:{}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url,headers:{cookie:headers.cookie},payload:{}})).statusCode).toBe(403);
  const {'idempotency-key':_key,...noKey}=headers;
  expect((await app.inject({method:'POST',url,headers:noKey,payload:{}})).statusCode).toBe(428);
  expect(normal.startCheckCommand).not.toHaveBeenCalled();
  const response=await app.inject({method:'POST',url,headers,payload:{}});expect(response.statusCode,response.body).toBe(201);expect(response.json()).toEqual(check);
  expect(normal.startCheckCommand).toHaveBeenCalledWith('OBJ-NORMAL',expect.objectContaining({actor,idempotencyKey:'qa-source-audit-key'}),{sourceAuditV3:true});
  expect(normal.completeCheck).not.toHaveBeenCalled();
  vi.mocked(normal.hasObjectPermission).mockResolvedValueOnce(false);
  expect((await app.inject({method:'POST',url,headers,payload:{}})).statusCode).toBe(403);
  vi.mocked(normal.startCheckCommand).mockResolvedValueOnce({kind:'invalid_state',code:'ACTIVE_ANALYSIS_MODE_CONFLICT',message:'Другой режим'});
  expect((await app.inject({method:'POST',url,headers,payload:{}})).statusCode).toBe(409);
 }finally{await app.close();}
});
