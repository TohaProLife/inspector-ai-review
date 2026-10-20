import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {buildApp} from '../src/app.js';
import {RoutedInspectionRepository} from '../src/repository-factory.js';
import {InspectorStore} from '../src/store.js';
import type {PostgresInspectionRepository} from '../src/postgres-repository.js';
import type {AuthenticatedActor,IdentityService} from '../src/identity.js';
const actor:AuthenticatedActor={sessionId:randomUUID(),userId:randomUUID(),organizationId:randomUUID(),displayName:'Reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'a'.repeat(64),expiresAt:'2030-01-01T00:00:00Z'};
const identity:IdentityService={login:async()=>undefined,resolveSession:async t=>t==='session'?actor:undefined,verifyCsrf:(_a,t)=>t==='csrf',revokeSession:async()=>undefined,close:async()=>undefined};
const fixture=JSON.parse(readFileSync(new URL('../../../services/worker/tests/fixtures/matrix-call-inventory-v1/research-call-authored-goldens.json',import.meta.url),'utf8')).fixtures[0];
const selection=fixture.input.selection;
const pages={checkId:'CHK-NORMAL',sourceFileId:'FIL-1',sourceSha256:'a'.repeat(64),inputManifestHash:'b'.repeat(64),textStageContentHash:'c'.repeat(64),textArtifactHash:'d'.repeat(64),stage:'PD',pageStages:{},latestReviewHash:null,textArtifact:fixture.input.textArtifact};
const preview={checkId:'CHK-NORMAL',sourceFileId:'FIL-1',sourceSha256:'a'.repeat(64),latestReviewHash:null,result:{schemaVersion:'matrix-odi123-call-inventory-source-result-v1',status:'ABSTAIN',reasonCode:'EMPTY_INVENTORY_UNVERIFIED'}};
const prefix='/api/checks/CHK-NORMAL/source-files/FIL-1/';
const headers={cookie:'inspector_session=session; inspector_csrf=csrf','x-csrf-token':'csrf','content-type':'application/json'};
it('actual routed adapter forwards call explorer/preview with auth+CSRF, never review writes',async()=>{
 const normal={close:vi.fn().mockResolvedValue(undefined),getMatrixCallInventorySourcePages:vi.fn().mockResolvedValue(pages),previewMatrixCallInventorySource:vi.fn().mockResolvedValue(preview),recordSourceReviewCommand:vi.fn()} as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity});
 try{
  expect((await app.inject({url:prefix+'call-inventory-pages'})).statusCode).toBe(401);expect(normal.getMatrixCallInventorySourcePages).not.toHaveBeenCalled();
  const found=await app.inject({url:prefix+'call-inventory-pages',headers});expect(found.statusCode).toBe(200);expect(found.json()).toEqual(pages);expect(found.headers['cache-control']).toBe('private, no-store');
  expect(normal.getMatrixCallInventorySourcePages).toHaveBeenCalledExactlyOnceWith('CHK-NORMAL','FIL-1',actor);
  expect((await app.inject({method:'POST',url:prefix+'call-inventory-preview',headers:{cookie:headers.cookie},payload:{selection}})).statusCode).toBe(403);
  expect(normal.previewMatrixCallInventorySource).not.toHaveBeenCalled();
  const checked=await app.inject({method:'POST',url:prefix+'call-inventory-preview',headers,payload:{selection}});expect(checked.statusCode).toBe(200);expect(checked.json()).toEqual(preview);
  expect(normal.previewMatrixCallInventorySource).toHaveBeenCalledExactlyOnceWith('CHK-NORMAL','FIL-1',selection,actor);expect(normal.recordSourceReviewCommand).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('preparse rejects unknown/server fields, missing end and duplicate raw JSON names before AJV',async()=>{
 const normal={close:vi.fn().mockResolvedValue(undefined),previewMatrixCallInventorySource:vi.fn(),recordSourceReviewCommand:vi.fn(),hasObjectPermission:async()=>true} as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity});
 try{
  const noEnd=structuredClone(selection);delete noEnd.endFragments;
  for(const payload of [{selection,inventorySnapshot:{}},{selection:{...selection,complete:true}},{selection:noEnd},'{"selection":{},"selection":{}}']){
   const response=await app.inject({method:'POST',url:prefix+'call-inventory-preview',headers,payload});expect(response.statusCode).toBe(400);
  }
  const review={sourceSha256:'a'.repeat(64),revisionStatus:'UNKNOWN',approvalStatus:'UNKNOWN',linkGroupId:null,pageStages:{},basis:{reference:'Исходные строки просмотрены'},expectedReviewHash:null,callInventoryScope:{schemaVersion:'matrix-odi123-call-inventory-review-v1',claims:[],inventorySnapshot:{}}};
  expect((await app.inject({method:'POST',url:'/api/objects/OBJ-1/files/FIL-1/source-review',headers:{...headers,'idempotency-key':randomUUID()},payload:review})).statusCode).toBe(400);
  const raw=JSON.stringify({...review,callInventoryScope:{schemaVersion:'matrix-odi123-call-inventory-review-v1',claims:[]}}).replace('"pageStages":{}','"pageStages":{"__proto__":"PD"}');
  expect((await app.inject({method:'POST',url:'/api/objects/OBJ-1/files/FIL-1/source-review',headers:{...headers,'idempotency-key':randomUUID()},payload:raw})).statusCode).toBe(400);
  expect(normal.previewMatrixCallInventorySource).not.toHaveBeenCalled();expect(normal.recordSourceReviewCommand).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('demo call routes never fall through to durable data',async()=>{
 const demo=await InspectorStore.create();vi.spyOn(demo,'getCheck').mockReturnValue({id:'CHK-DEMO'} as never);
 const normal={close:vi.fn().mockResolvedValue(undefined),getMatrixCallInventorySourcePages:vi.fn(),previewMatrixCallInventorySource:vi.fn()} as unknown as PostgresInspectionRepository;
 const r=new RoutedInspectionRepository(demo,normal);expect(await r.getMatrixCallInventorySourcePages('CHK-DEMO','FIL-1',actor)).toBeUndefined();expect(await r.previewMatrixCallInventorySource('CHK-DEMO','FIL-1',selection,actor)).toBeUndefined();
 expect(normal.getMatrixCallInventorySourcePages).not.toHaveBeenCalled();expect(normal.previewMatrixCallInventorySource).not.toHaveBeenCalled();
});
