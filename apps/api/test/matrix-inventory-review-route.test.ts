import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AuthenticatedActor,IdentityService } from '../src/identity.js';
import type { InspectionRepository } from '../src/repository.js';
const actor:AuthenticatedActor={sessionId:randomUUID(),userId:randomUUID(),organizationId:randomUUID(),displayName:'Reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'a'.repeat(64),expiresAt:'2030-01-01T00:00:00Z'};
const headers={cookie:'inspector_session=session; inspector_csrf=csrf','x-csrf-token':'csrf','content-type':'application/json'};
const selection={pageNumber:1,regionBoxMilliPoints:[0,0,100000,100000],headerFragments:[{pageNumber:1,blockIndex:0,lineIndex:0,rawText:'header',bboxMilliPoints:[1,1,20,20]}],scopeFragments:[{pageNumber:1,blockIndex:1,lineIndex:0,rawText:'scope',bboxMilliPoints:[1,25,20,40]}]};
let app:FastifyInstance;
const preview=vi.fn(),pages=vi.fn(),record=vi.fn();
beforeEach(async()=>{
  preview.mockReset().mockResolvedValue({checkId:'CHK-1',sourceFileId:'FIL-1',sourceSha256:'a'.repeat(64),result:{schemaVersion:'matrix-inventory-source-result-v1',status:'ABSTAIN',reasonCode:'NO_ROWS'}});
  pages.mockReset().mockResolvedValue(undefined);record.mockReset();
  const identity:IdentityService={login:async()=>undefined,resolveSession:async token=>token==='session'?actor:undefined,verifyCsrf:(_actor,token)=>token==='csrf',revokeSession:async()=>undefined,close:async()=>undefined};
  app=await buildApp({repository:{previewMatrixInventorySource:preview,getMatrixInventorySourcePages:pages,recordSourceReviewCommand:record,hasObjectPermission:async()=>true} as unknown as InspectionRepository,identityService:identity});
});
afterEach(async()=>{await app.close();});
it('requires authenticated READ adapter and CSRF without requesting review writes',async()=>{
  const url='/api/checks/CHK-1/source-inventory-preview';
  expect((await app.inject({method:'POST',url,payload:{sourceFileId:'FIL-1',selection}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url,headers:{cookie:headers.cookie},payload:{sourceFileId:'FIL-1',selection}})).statusCode).toBe(403);
  const response=await app.inject({method:'POST',url,headers,payload:{sourceFileId:'FIL-1',selection}});
  expect(response.statusCode).toBe(200);expect(response.json().result.status).toBe('ABSTAIN');expect(preview).toHaveBeenCalledExactlyOnceWith('CHK-1','FIL-1',selection,actor);expect(record).not.toHaveBeenCalled();
});
it.each(['{"sourceFileId":"FIL-1","sourceFileId":"FIL-2","selection":{}}','{"sourceFileId":"FIL-1","source\\u0046ileId":"FIL-2","selection":{}}','{"sourceFileId":"FIL-1","selection":{"pageNumber":1,"pageNumber":2}}'])('rejects duplicate JSON names before framework parse: %s',async payload=>{
  const response=await app.inject({method:'POST',url:'/api/checks/CHK-1/source-inventory-preview',headers,payload});expect(response.statusCode).toBe(400);expect(response.json().error).toBe('INVENTORY_INVALID_INPUT');expect(preview).not.toHaveBeenCalled();expect(record).not.toHaveBeenCalled();
});
it('rejects oversized wire bytes and deep JSON before source reconstruction',async()=>{
  for(const payload of [JSON.stringify({padding:'a'.repeat(524288)}),'['.repeat(66)+'0'+']'.repeat(66)]){
    const response=await app.inject({method:'POST',url:'/api/checks/CHK-1/source-inventory-preview',headers,payload});expect(response.statusCode).toBe(413);expect(preview).not.toHaveBeenCalled();expect(record).not.toHaveBeenCalled();
  }
});
it('rejects server-supplied snapshot and unknown selection fields',async()=>{
  for(const payload of [{sourceFileId:'FIL-1',selection,inventorySnapshot:{}},{sourceFileId:'FIL-1',selection:{...selection,complete:true}}]){
    const response=await app.inject({method:'POST',url:'/api/checks/CHK-1/source-inventory-preview',headers,payload});expect(response.statusCode).toBe(400);expect(preview).not.toHaveBeenCalled();
  }
});
it('GET explorer requires auth and unavailable source does not disclose text',async()=>{
  const url='/api/checks/CHK-1/source-inventory-pages?sourceFileId=FIL-1';expect((await app.inject({url})).statusCode).toBe(401);
  expect((await app.inject({url,headers})).statusCode).toBe(404);expect(pages).toHaveBeenCalledExactlyOnceWith('CHK-1','FIL-1',actor);expect(record).not.toHaveBeenCalled();
});
it('rejects untrusted decision snapshots on whole-review request before AJV strips unknown properties',async()=>{
  const payload={sourceSha256:'a'.repeat(64),revisionStatus:'UNKNOWN',approvalStatus:'UNKNOWN',linkGroupId:null,pageStages:{},basis:{reference:'Исходные строки просмотрены'},expectedReviewHash:null,
    inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[],inventorySnapshot:{}}};
  const response=await app.inject({method:'POST',url:'/api/objects/OBJ-1/files/FIL-1/source-review',headers:{...headers,'idempotency-key':randomUUID()},payload});
  expect(response.statusCode).toBe(400);expect(record).not.toHaveBeenCalled();
});
