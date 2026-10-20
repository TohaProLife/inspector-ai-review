/** Independent manual DB preimages over frozen T70 original-backed artifacts. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {describe,it,expect} from 'vitest';
import {prepareSteelApplicabilityInputs} from '../src/postgres-steel-applicability-inputs.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-steel-applicability-review-v1/source-context-manual.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('ec69921ce3a7902980814399f593c432dce01ba5a6156fd90acd5bbc8feeea11');
const frozen=JSON.parse(bytes.toString());
function harness(){
 const m=structuredClone(frozen),calls:{origins:number;queries:number}={origins:0,queries:0};
 const client={query:async(sql:string,args:any[])=>{calls.queries++;if(sql.includes('FROM source_files source'))return {rows:m.sourceRows.filter((s:any)=>s.source_file_id===args[1])};if(sql.includes('FROM source_review_decisions'))return {rows:m.reviewRows.filter((s:any)=>s.id===args[0]&&s.object_id===args[1]&&s.source_file_id===args[2])};throw Error('Unexpected query');}} as unknown as PoolClient;
 const load=async(_client:PoolClient,_object:string,check:string,source:string)=>{calls.origins++;const i=m.sourceRows.findIndex((s:any)=>s.source_file_id===source);expect(check).toBe(m.request[i?'actual':'expected'].target.checkId);return structuredClone(m.originRows[i]);};
 return {m,calls,client,load};
}
describe('T72 authenticated steel source input preparation',()=>{
 it('reconstructs entire exact manual package and immutable original references, detached and deterministic',async()=>{
  const {m,calls,client,load}=harness(),before=structuredClone(m);const actual=await prepareSteelApplicabilityInputs(client,m.request,load);
  expect(actual.package).toEqual(m.expectedPackage);expect(actual.references).toEqual(m.expectedReferences);
  expect(actual.expectedSourceInternalId).toBe(m.expectedSourceInternalId);expect(actual.actualSourceInternalId).toBe(m.actualSourceInternalId);
  expect(actual.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(calls.origins).toBe(2);expect(m).toEqual(before);
  expect((await prepareSteelApplicabilityInputs(client,m.request,load)).fingerprint).toBe(actual.fingerprint);
  actual.package.sources[0]!.sourceFileId='changed';expect(m).toEqual(before);
 });
 it('requires both latest source refs for current saves while retaining exact historical originals for withdrawal',async()=>{
  const {m,calls,client,load}=harness();m.sourceRows[1].latest_review_id='new-review-after-claim-withdrawal';
  await expect(prepareSteelApplicabilityInputs(client,m.request,load)).rejects.toThrow();
  const historical=await prepareSteelApplicabilityInputs(client,{...m.request,mode:'HISTORICAL'},load);
  expect(historical.package).toEqual(m.expectedPackage);expect(calls.origins).toBeGreaterThanOrEqual(2);
 });
 it('refuses forged full review preimages, wrong original association and wrong target before returning inputs',async()=>{
  for(const mutate of [(m:any)=>m.reviewRows[0].basis_reference+=' altered',(m:any)=>m.reviewRows[1].content_hash='f'.repeat(64),(m:any)=>m.originRows[0].source.sha256='e'.repeat(64),(m:any)=>m.originRows[1].textStageContentHash='d'.repeat(64),(m:any)=>m.request.expected.productScope.profile='foreign-profile']){
   const {m,client,load}=harness();mutate(m);await expect(prepareSteelApplicabilityInputs(client,m.request,load)).rejects.toThrow();
  }
 });
 it('native admits whole request before querying and refuses retained forged snapshot even outside requested identity',async()=>{
  const {m,calls,client,load}=harness();let getters=0;const bad={...m.request};Object.defineProperty(bad,'expected',{enumerable:true,get:()=>{getters++;return m.request.expected;}});
  await expect(prepareSteelApplicabilityInputs(client,bad,load)).rejects.toThrow();expect(getters).toBe(0);expect(calls.queries).toBe(0);
  const changed=harness();changed.m.reviewRows[0].steel_comparison_scope.claims[0].declarationSnapshot.value='С245';
  await expect(prepareSteelApplicabilityInputs(changed.client,changed.m.request,changed.load)).rejects.toThrow();
 });
});
