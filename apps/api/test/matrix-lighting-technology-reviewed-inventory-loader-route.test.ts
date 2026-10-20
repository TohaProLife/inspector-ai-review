/** Independent v5 worker transport boundary. Canonical body is opaque here; actual package semantics covered in real PostgreSQL test. */
import { randomUUID } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { RoutedInspectionRepository } from '../src/repository-factory.js';
import { InspectorStore } from '../src/store.js';
import type { InspectionRepository } from '../src/repository.js';
import type { PostgresInspectionRepository } from '../src/postgres-repository.js';
import { sha256 } from '../src/canonical-json.js';

it('worker inventory loader is authenticated, lease-scoped, canonical and read-only through routed adapter',async()=>{
  const canonical='{"schemaVersion":"matrix-reviewed-inventory-loader-inputs-v5","sources":[]}';
  const load=vi.fn().mockResolvedValue({kind:'available',canonical,contentHash:sha256(canonical),byteSize:Buffer.byteLength(canonical),inputManifestHash:'a'.repeat(64),schemaVersion:'matrix-reviewed-inventory-loader-inputs-v5'});
  const writes={recordSourceReviewCommand:vi.fn(),completeJob:vi.fn(),startCheckCommand:vi.fn()};
  const normal={getJobLightingTechnologyReviewedInventoryComparisonInputs:load,...writes,close:vi.fn()} as unknown as PostgresInspectionRepository;
  const repository=new RoutedInspectionRepository(await InspectorStore.create(),normal);
  const app=await buildApp({repository,workerToken:'isolated-worker-test-token'});
  try{
    const attemptId=randomUUID(),url=`/api/internal/v1/jobs/${randomUUID()}/lighting-technology-reviewed-inventory-comparison-inputs?attemptId=${attemptId}&fencingToken=7`;
    expect((await app.inject({url})).statusCode).toBe(401);expect(load).not.toHaveBeenCalled();
    expect((await app.inject({url,headers:{'x-worker-token':'wrong'}})).statusCode).toBe(401);expect(load).not.toHaveBeenCalled();
    const response=await app.inject({url,headers:{'x-worker-token':'isolated-worker-test-token'}});
    expect(response.statusCode).toBe(200);expect(response.body).toBe(canonical);expect(response.headers['x-content-sha256']).toBe(sha256(canonical));
    expect(response.headers['x-artifact-schema-version']).toBe('matrix-reviewed-inventory-loader-inputs-v5');expect(response.headers['x-input-manifest-sha256']).toBe('a'.repeat(64));
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-length']).toBe(String(Buffer.byteLength(canonical)));
    expect(load.mock.calls[0]![0]).toBe(url.split('/')[5]);
    expect(load.mock.calls[0]![1]).toEqual({attemptId,fencingToken:7});
    expect(load.mock.calls[0]![2].signal).toBeInstanceOf(AbortSignal);expect(load.mock.calls[0]![2].signal.aborted).toBe(false);
    for(const kind of ['not_found','stale_attempt','integrity_error','already_terminal']){
      load.mockResolvedValueOnce({kind,state:'SUCCEEDED'});const denied=await app.inject({url,headers:{'x-worker-token':'isolated-worker-test-token'}});
      expect(denied.statusCode).toBe(kind==='not_found'?404:kind==='integrity_error'?503:409);expect(denied.body).not.toContain(canonical);
    }
    for(const write of Object.values(writes))expect(write).not.toHaveBeenCalled();
  }finally{await app.close();}
});
it('worker loader rejects malformed lease queries before invoking repository',async()=>{
  const load=vi.fn();const app=await buildApp({repository:{getJobLightingTechnologyReviewedInventoryComparisonInputs:load} as unknown as InspectionRepository,workerToken:'test'});
  try{for(const query of ['attemptId=no&fencingToken=1',`attemptId=${randomUUID()}&fencingToken=0`,`attemptId=${randomUUID()}&fencingToken=9007199254740992`,`attemptId=${randomUUID()}&fencingToken=1&trusted=true`,`attemptId=${randomUUID()}&fencingToken=1&fencingToken=2`,`attemptId=${randomUUID()}&attemptId=${randomUUID()}&fencingToken=1`,'fencingToken=1','attemptId='+randomUUID()]){
    expect((await app.inject({url:`/api/internal/v1/jobs/job/lighting-technology-reviewed-inventory-comparison-inputs?${query}`,headers:{'x-worker-token':'test'}})).statusCode).toBe(400);
  }expect(load).not.toHaveBeenCalled();}finally{await app.close();}
});
