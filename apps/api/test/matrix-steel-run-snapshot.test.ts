/** Hand-authored stdlib hashes, frozen before snapshot implementation. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {buildSteelApplicabilityRunSnapshot,validateSteelApplicabilityRunSnapshot,
 validateSteelApplicabilitySnapshotProjectionLinks,steelApplicabilityProjectionMatchesSources} from '../src/matrix-steel-run-snapshot.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-steel-durable-v1/root-manual-snapshots.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('b3c9cb8f4281ea6e0e4e9c412e67fe8a4a3db52362845fe9ce01649a280d5e0f');
const manual=JSON.parse(bytes.toString());
describe('T73 immutable steel applicability run snapshot',()=>{
 it('matches every full independently authored hash, remains detached and preserves its inputs',()=>{
  for(const c of manual.validCases){const before=structuredClone(c);expect(buildSteelApplicabilityRunSnapshot(c.input)).toEqual(c.expectedSnapshot);
   expect(validateSteelApplicabilityRunSnapshot(c.expectedSnapshot)).toEqual(c.expectedSnapshot);
   expect(()=>validateSteelApplicabilitySnapshotProjectionLinks(c.expectedSnapshot,c.package)).not.toThrow();
   const actual=buildSteelApplicabilityRunSnapshot(c.input);actual.objectId='altered';expect(c).toEqual(before);}
 });
 it('requires canonical bounded BIGINT strings, sorted unique logical pairs and unique decision IDs',()=>{
  for(const value of manual.invalidSequenceValues){const c=structuredClone(manual.validCases[0]);c.input.entries[0].sequenceNo=value;expect(()=>buildSteelApplicabilityRunSnapshot(c.input)).toThrow();}
  for(const mutate of [(c:any)=>c.input.entries.push(structuredClone(c.input.entries[0])),
   (c:any)=>c.input.entries.reverse(),(c:any)=>{c.input.entries[1].decisionId=c.input.entries[0].decisionId;}]){
   const c=structuredClone(manual.validCases[4]);mutate(c);expect(()=>buildSteelApplicabilityRunSnapshot(c.input)).toThrow();}
 });
 it('rejects altered journal pointers and exact extra fields even when the projection remains unchanged',()=>{
  for(const mutate of [(s:any)=>s.entries[0].journalContentHash='a'.repeat(64),(s:any)=>s.entries[0].included=false,
   (s:any)=>s.entries[0].sequenceNo='4',(s:any)=>s.actorId='caller',(s:any)=>s.entries[0].status='APPROVED']){
   const s=structuredClone(manual.validCases[0].expectedSnapshot);mutate(s);expect(()=>validateSteelApplicabilityRunSnapshot(s)).toThrow();}
 });
 it('enforces included projection bijection, object/manifest, logical key and full projection hash links',()=>{
  const c=manual.validCases[0],excluded=manual.validCases[1];
  for(const [snapshot,pkg]of [[excluded.expectedSnapshot,c.package],[c.expectedSnapshot,excluded.package],
   [c.expectedSnapshot,{...c.package,objectId:'foreign'}],[c.expectedSnapshot,{...c.package,inputManifestHash:'0'.repeat(64)}]])
   expect(()=>validateSteelApplicabilitySnapshotProjectionLinks(snapshot,pkg)).toThrow();
  for(const mutate of [(s:any)=>s.entries[0].pairKey='0'.repeat(64),(s:any)=>s.entries[0].projectionContentHash='f'.repeat(64),
   (s:any)=>s.entries[0].decisionId='44444444-4444-4444-8444-444444444444']){
   const input=structuredClone(c.input);mutate(input);const s=buildSteelApplicabilityRunSnapshot(input);
   expect(()=>validateSteelApplicabilitySnapshotProjectionLinks(s,c.package)).toThrow();}
 });
 it('matches only exact run source review refs and retained declaration identity/target/product scope',()=>{
  const c=manual.validCases[0],projection=c.package.applicabilityDecisions[0];
  expect(steelApplicabilityProjectionMatchesSources(projection,c.package.sources)).toBe(true);
  for(const mutate of [(s:any[])=>s.pop(),(s:any[])=>s[1].review.contentHash='a'.repeat(64),
   (s:any[])=>s[0].review.decisionId='new-source-review',(s:any[])=>s[0].review.steelComparisonScope=null]){
   const sources=structuredClone(c.package.sources);mutate(sources);expect(steelApplicabilityProjectionMatchesSources(projection,sources)).toBe(false);}
 });
 it('native admits the whole boundary before getters or proxy callbacks and rejects cycles/oversize',()=>{
  const c=manual.validCases[0];let calls=0;const getter={...c.input};Object.defineProperty(getter,'entries',{enumerable:true,get(){calls++;return c.input.entries;}});
  expect(()=>buildSteelApplicabilityRunSnapshot(getter)).toThrow();expect(calls).toBe(0);
  const proxy=new Proxy(c.input,{ownKeys(){calls++;return Reflect.ownKeys(c.input);}});expect(()=>buildSteelApplicabilityRunSnapshot(proxy)).toThrow();expect(calls).toBe(0);
  const cyclic:any={...c.input};cyclic.entries=[cyclic];expect(()=>buildSteelApplicabilityRunSnapshot(cyclic)).toThrow();
  expect(()=>buildSteelApplicabilityRunSnapshot({...c.input,extra:'x'.repeat(524288)})).toThrow();
 });
});
