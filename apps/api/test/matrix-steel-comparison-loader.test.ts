/** Frozen original-backed projections; callbacks stand in for separate authenticated repository seams. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {describe,it,expect} from 'vitest';
import {augmentSteelComparisonPreparation} from '../src/matrix-steel-comparison-loader.js';
import {canonicalJson,sha256} from '../src/canonical-json.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-steel-durable-v1/root-manual-protected-loader.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('15c3029e3c4b41f495dc139ded7e3f69ee50e2d595c97e9d1d663516009b92ab');
const m0=JSON.parse(bytes.toString());
function harness(){
 const m=structuredClone(m0);let origins=0,pins=0,oversize=false;
 const client={query:async(sql:string)=>{
  if(sql.includes('steel_scope_bytes'))return {rows:[{source_count:2,steel_scope_bytes:oversize?'8000001':'1000'}]};
  if(sql.includes('FROM analysis_runs run JOIN manifest_items item'))return {rows:m.sourceRows};
  if(sql.includes('GREATEST(text.byte_size'))return {rows:[{bytes:'20000'}]};
  throw Error('Unexpected query '+sql);
 }} as unknown as PoolClient;
 const load=async(_client:PoolClient,_object:string,_check:string,sid:string)=>{origins++;const i=m.expectedPackage.sources.findIndex((s:any)=>s.sourceFileId===sid);return structuredClone(m.originRows[i]);};
 const state=async()=>{pins++;return structuredClone(m.state);};
 return {m,client,load,state,counts:()=>({origins,pins}),oversize:()=>{oversize=true;}};
}
const rehash=(s:any)=>{const {contentHash:_,...body}=s;s.contentHash=sha256(canonicalJson({hashDomain:'matrix-kr056-steel-applicability-run-snapshot-json-v1',snapshot:body}));};
describe('T73 protected six-domain steel augmentation',()=>{
 it('rebuilds complete manually authored steel package and deduplicated original references',async()=>{
  const h=harness(),before=structuredClone(h.m);const actual=await augmentSteelComparisonPreparation(h.client,h.m.base,h.load,h.state);
  expect(actual.steelPackage).toEqual(h.m.expectedPackage);expect(actual.steelApplicabilitySnapshot).toEqual(h.m.state.snapshot);
  expect(actual.references).toEqual(h.m.expectedReferences);expect(actual.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(h.counts()).toEqual({origins:2,pins:1});expect(h.m).toEqual(before);
  expect((await augmentSteelComparisonPreparation(h.client,h.m.base,h.load,h.state)).fingerprint).toBe(actual.fingerprint);
 });
 it('retains excluded historical journal for audit while omitting stale projection and original run remains frozen',async()=>{
  const h=harness();h.m.state.snapshot.entries[0].included=false;rehash(h.m.state.snapshot);
  const source=h.m.base.waterPackage.sources[0],row=h.m.sourceRows[0];source.review.decisionId='new-review';source.review.contentHash='a'.repeat(64);
  source.reviewSnapshot={decisionId:'new-review',contentHash:'a'.repeat(64)};row.decision_id='new-review';row.decision_hash='a'.repeat(64);
  const actual=await augmentSteelComparisonPreparation(h.client,h.m.base,h.load,h.state);
  expect(actual.steelPackage!.applicabilityDecisions).toEqual([]);expect(actual.steelApplicabilitySnapshot!.entries).toHaveLength(1);
  expect(actual.references).toEqual(h.m.expectedReferences);
  const wrong=harness();wrong.m.state.snapshot.entries[0].included=false;rehash(wrong.m.state.snapshot);
  await expect(augmentSteelComparisonPreparation(wrong.client,wrong.m.base,wrong.load,wrong.state)).rejects.toThrow();
 });
 it('rejects snapshot/journal linkage, metadata/source/original tamper and precharges oversize before origin transfer',async()=>{
  for(const mutate of [(m:any)=>m.state.journals[0].decision.actorId='44444444-4444-4444-8444-444444444444',
   (m:any)=>m.state.snapshot.entries[0].journalContentHash='a'.repeat(64),
   (m:any)=>m.state.journals[0].expectedSourceInternalId='foreign',
   (m:any)=>m.sourceRows[0].decision_hash='b'.repeat(64),
   (m:any)=>m.originRows[0].source.sha256='c'.repeat(64)]){
   const h=harness();mutate(h.m);await expect(augmentSteelComparisonPreparation(h.client,h.m.base,h.load,h.state)).rejects.toThrow();}
  const h=harness();h.oversize();await expect(augmentSteelComparisonPreparation(h.client,h.m.base,h.load,h.state)).rejects.toThrow();expect(h.counts().origins).toBe(0);
 });
});
