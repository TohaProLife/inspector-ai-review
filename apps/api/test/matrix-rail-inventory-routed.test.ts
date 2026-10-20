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
const fixture=JSON.parse(readFileSync(new URL('../../../services/worker/tests/fixtures/matrix-rail-inventory-v1/research-rail-authored-goldens.json',import.meta.url),'utf8')).fixtures[0];
const selection=fixture.input.selection;
const pages={checkId:'CHK-NORMAL',sourceFileId:'FIL-1',sourceSha256:'a'.repeat(64),inputManifestHash:'b'.repeat(64),textStageContentHash:'c'.repeat(64),textArtifactHash:'d'.repeat(64),stage:'PD',pageStages:{},latestReviewHash:null,textArtifact:fixture.input.textArtifact};
const preview={checkId:'CHK-NORMAL',sourceFileId:'FIL-1',sourceSha256:'a'.repeat(64),latestReviewHash:null,result:{schemaVersion:'matrix-odi120-rail-inventory-source-result-v1',status:'ABSTAIN',reasonCode:'EMPTY_INVENTORY_UNVERIFIED'}};
const prefix='/api/checks/CHK-NORMAL/source-files/FIL-1/';
const headers={cookie:'inspector_session=session; inspector_csrf=csrf','x-csrf-token':'csrf','content-type':'application/json'};
it('actual routed adapter forwards rail explorer/preview with auth+CSRF, never review writes',async()=>{
 const normal={close:vi.fn().mockResolvedValue(undefined),getMatrixRailInventorySourcePages:vi.fn().mockResolvedValue(pages),previewMatrixRailInventorySource:vi.fn().mockResolvedValue(preview),recordSourceReviewCommand:vi.fn()} as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity});
 try{
  expect((await app.inject({url:prefix+'rail-inventory-pages'})).statusCode).toBe(401);expect(normal.getMatrixRailInventorySourcePages).not.toHaveBeenCalled();
  const found=await app.inject({url:prefix+'rail-inventory-pages',headers});expect(found.statusCode).toBe(200);expect(found.json()).toEqual(pages);expect(found.headers['cache-control']).toBe('private, no-store');
  expect(normal.getMatrixRailInventorySourcePages).toHaveBeenCalledExactlyOnceWith('CHK-NORMAL','FIL-1',actor);
  expect((await app.inject({method:'POST',url:prefix+'rail-inventory-preview',headers:{cookie:headers.cookie},payload:{selection}})).statusCode).toBe(403);
  expect(normal.previewMatrixRailInventorySource).not.toHaveBeenCalled();
  const checked=await app.inject({method:'POST',url:prefix+'rail-inventory-preview',headers,payload:{selection}});expect(checked.statusCode).toBe(200);expect(checked.json()).toEqual(preview);
  expect(normal.previewMatrixRailInventorySource).toHaveBeenCalledExactlyOnceWith('CHK-NORMAL','FIL-1',selection,actor);expect(normal.recordSourceReviewCommand).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('preparse rejects unknown/server fields, missing end and duplicate raw JSON names before AJV',async()=>{
 const normal={close:vi.fn().mockResolvedValue(undefined),previewMatrixRailInventorySource:vi.fn(),recordSourceReviewCommand:vi.fn(),hasObjectPermission:async()=>true} as unknown as PostgresInspectionRepository;
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal),identityService:identity});
 try{
  const noEnd=structuredClone(selection);delete noEnd.endFragments;
  for(const payload of [{selection,inventorySnapshot:{}},{selection:{...selection,complete:true}},{selection:noEnd},'{"selection":{},"selection":{}}']){
   const response=await app.inject({method:'POST',url:prefix+'rail-inventory-preview',headers,payload});expect(response.statusCode).toBe(400);
  }
  const review={sourceSha256:'a'.repeat(64),revisionStatus:'UNKNOWN',approvalStatus:'UNKNOWN',linkGroupId:null,pageStages:{},basis:{reference:'Исходные строки просмотрены'},expectedReviewHash:null,railInventoryScope:{schemaVersion:'matrix-odi120-rail-inventory-review-v1',claims:[],inventorySnapshot:{}}};
  expect((await app.inject({method:'POST',url:'/api/objects/OBJ-1/files/FIL-1/source-review',headers:{...headers,'idempotency-key':randomUUID()},payload:review})).statusCode).toBe(400);
  const raw=JSON.stringify({...review,railInventoryScope:{schemaVersion:'matrix-odi120-rail-inventory-review-v1',claims:[]}}).replace('"pageStages":{}','"pageStages":{"__proto__":"PD"}');
  expect((await app.inject({method:'POST',url:'/api/objects/OBJ-1/files/FIL-1/source-review',headers:{...headers,'idempotency-key':randomUUID()},payload:raw})).statusCode).toBe(400);
  expect(normal.previewMatrixRailInventorySource).not.toHaveBeenCalled();expect(normal.recordSourceReviewCommand).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('demo rail routes never fall through to durable data',async()=>{
 const demo=await InspectorStore.create();vi.spyOn(demo,'getCheck').mockReturnValue({id:'CHK-DEMO'} as never);
 const normal={close:vi.fn().mockResolvedValue(undefined),getMatrixRailInventorySourcePages:vi.fn(),previewMatrixRailInventorySource:vi.fn()} as unknown as PostgresInspectionRepository;
 const r=new RoutedInspectionRepository(demo,normal);expect(await r.getMatrixRailInventorySourcePages('CHK-DEMO','FIL-1',actor)).toBeUndefined();expect(await r.previewMatrixRailInventorySource('CHK-DEMO','FIL-1',selection,actor)).toBeUndefined();
 expect(normal.getMatrixRailInventorySourcePages).not.toHaveBeenCalled();expect(normal.previewMatrixRailInventorySource).not.toHaveBeenCalled();
});
