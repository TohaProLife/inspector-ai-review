/** Transport-only: durable admission/full parent authenticity are separately PG tested. */
import {expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {RoutedInspectionRepository} from '../src/repository-factory.js';
import {InspectorStore} from '../src/store.js';
it('new worker route delegates only exact authenticated lease and preserves canonical bytes and headers',async()=>{
 const attemptId=randomUUID(),canonical='{"schemaVersion":"matrix-reviewed-inventory-loader-inputs-v7","synthetic":"КР"}',hash=createHash('sha256').update(canonical).digest('hex');
 let calls=0,received:unknown,kind='available';
 const normal={close:async()=>undefined,getJobColumnPylonSectionReviewedInventoryComparisonInputs:async(jobId:string,input:unknown,options:any)=>{
  calls++;received={jobId,input,hasSignal:options.signal instanceof AbortSignal};return kind==='available'?{kind,canonical,contentHash:hash,byteSize:Buffer.byteLength(canonical),inputManifestHash:'b'.repeat(64),schemaVersion:'matrix-reviewed-inventory-loader-inputs-v7'}:{kind};
 }};
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal as any),workerToken:'synthetic-t83-worker-route-token'});
 const path='/api/internal/v1/jobs/JOB-T83/column-pylon-section-reviewed-inventory-comparison-inputs',query=`?attemptId=${attemptId}&fencingToken=1`,headers={'x-worker-token':'synthetic-t83-worker-route-token'};
 try{
  expect((await app.inject({url:path+query})).statusCode).toBe(401);expect(calls).toBe(0);
  for(const bad of [query+'&other=1',query+`&attemptId=${attemptId}`,`?attemptId=${attemptId}&fencingToken=0`,`?attemptId=${attemptId}&fencingToken=9007199254740992`,`?attemptId=bad&fencingToken=1`])expect((await app.inject({url:path+bad,headers})).statusCode).toBe(400);
  expect(calls).toBe(0);const response=await app.inject({url:path+query,headers});expect(response.statusCode,response.body).toBe(200);
  expect(response.rawPayload).toEqual(Buffer.from(canonical));expect(response.headers['content-length']).toBe(String(Buffer.byteLength(canonical)));
  expect(response.headers['x-content-sha256']).toBe(hash);expect(response.headers['x-input-manifest-sha256']).toBe('b'.repeat(64));expect(response.headers['x-artifact-schema-version']).toBe('matrix-reviewed-inventory-loader-inputs-v7');expect(response.headers['cache-control']).toBe('private, no-store');
  expect(received).toEqual({jobId:'JOB-T83',input:{attemptId,fencingToken:1},hasSignal:true});
  for(const [value,status,error]of [['not_found',404,'NOT_FOUND'],['stale_attempt',409,'STALE_ATTEMPT'],['already_terminal',409,'JOB_TERMINAL'],['integrity_error',503,'ARTIFACT_INTEGRITY_ERROR']]as const){kind=value;const response=await app.inject({url:path+query,headers});expect(response.statusCode).toBe(status);expect(response.json().error).toBe(error);}
 }finally{await app.close();}
});
