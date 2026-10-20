import { randomUUID } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { RoutedInspectionRepository } from '../src/repository-factory.js';
import { InspectorStore } from '../src/store.js';
import type { InspectionRepository } from '../src/repository.js';
import type { PostgresInspectionRepository } from '../src/postgres-repository.js';
import { sha256 } from '../src/canonical-json.js';

it('worker inventory loader is authenticated, lease-scoped, canonical and read-only through routed adapter',async()=>{
  const canonical='{"schemaVersion":"matrix-reviewed-inventory-loader-inputs-v4","sources":[]}';
  const load=vi.fn().mockResolvedValue({kind:'available',canonical,contentHash:sha256(canonical),byteSize:Buffer.byteLength(canonical),inputManifestHash:'a'.repeat(64),schemaVersion:'matrix-reviewed-inventory-loader-inputs-v4'});
  const normal={getJobWaterNodeReviewedInventoryComparisonInputs:load,close:vi.fn()} as unknown as PostgresInspectionRepository;
  const repository=new RoutedInspectionRepository(await InspectorStore.create(),normal);
  const app=await buildApp({repository,workerToken:'isolated-worker-test-token'});
  try{
    const attemptId=randomUUID(),url=`/api/internal/v1/jobs/${randomUUID()}/water-node-reviewed-inventory-comparison-inputs?attemptId=${attemptId}&fencingToken=7`;
    expect((await app.inject({url})).statusCode).toBe(401);expect(load).not.toHaveBeenCalled();
    expect((await app.inject({url,headers:{'x-worker-token':'wrong'}})).statusCode).toBe(401);expect(load).not.toHaveBeenCalled();
    const response=await app.inject({url,headers:{'x-worker-token':'isolated-worker-test-token'}});
    expect(response.statusCode).toBe(200);expect(response.body).toBe(canonical);expect(response.headers['x-content-sha256']).toBe(sha256(canonical));
    expect(response.headers['x-artifact-schema-version']).toBe('matrix-reviewed-inventory-loader-inputs-v4');expect(response.headers['x-input-manifest-sha256']).toBe('a'.repeat(64));
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(load.mock.calls[0]![1]).toEqual({attemptId,fencingToken:7});
    expect(load.mock.calls[0]![2].signal).toBeInstanceOf(AbortSignal);expect(load.mock.calls[0]![2].signal.aborted).toBe(false);
    for(const kind of ['not_found','stale_attempt','integrity_error','already_terminal']){
      load.mockResolvedValueOnce({kind,state:'SUCCEEDED'});const denied=await app.inject({url,headers:{'x-worker-token':'isolated-worker-test-token'}});
      expect(denied.statusCode).toBe(kind==='not_found'?404:kind==='integrity_error'?503:409);expect(denied.body).not.toContain(canonical);
    }
  }finally{await app.close();}
});
it('worker loader rejects malformed lease queries before invoking repository',async()=>{
  const load=vi.fn();const app=await buildApp({repository:{getJobWaterNodeReviewedInventoryComparisonInputs:load} as unknown as InspectionRepository,workerToken:'test'});
  try{for(const query of ['attemptId=no&fencingToken=1',`attemptId=${randomUUID()}&fencingToken=0`,`attemptId=${randomUUID()}&fencingToken=9007199254740992`,`attemptId=${randomUUID()}&fencingToken=1&trusted=true`,`attemptId=${randomUUID()}&fencingToken=1&fencingToken=2`]){
    expect((await app.inject({url:`/api/internal/v1/jobs/job/water-node-reviewed-inventory-comparison-inputs?${query}`,headers:{'x-worker-token':'test'}})).statusCode).toBe(400);
  }expect(load).not.toHaveBeenCalled();}finally{await app.close();}
});
