import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {PoolClient} from 'pg';
import {augmentColumnPylonSectionPreparation,columnPylonSectionCurrentSources} from '../src/matrix-column-pylon-section-loader.js';
import {canonicalJson,sha256} from '../src/canonical-json.js';
const Q=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json',import.meta.url),'utf8'));
const clone=<T>(x:T):T=>structuredClone(x);
function input(index=0){
 const c=clone(Q.wholeCases[index]),p=c.package,s=c.snapshot;
 const references=[{storageKey:'synthetic/original.pdf',expectedSha256:'a'.repeat(64),expectedByteSize:1024,expectedMediaType:'application/pdf' as const}];
 const pins=p.reviews.map((r:any)=>{
  const entry=s.entries.find((e:any)=>e.decisionId===r.journal.id);
  return{...r,sequenceNo:entry.sequenceNo,pairKey:entry.pairKey,origins:[r.journal.projection.expected,r.journal.projection.actual].map((side:any)=>p.origins.find((o:any)=>o.sourceFileId===side.sourceFileId&&canonicalJson(o.target)===canonicalJson(side.origin))),references,fingerprint:'b'.repeat(64)};
 });
 const base:any={package:{objectId:s.objectId,inputManifestHash:p.inputManifestHash},callPackage:{},railPackage:{},waterPackage:{sources:clone(p.sources)},
  fingerprint:'c'.repeat(64),references,release:{},run:{id:'22222222-2222-2222-2222-222222222222',checkId:'CHK-SYNTHETIC',objectId:s.objectId,inputManifestHash:p.inputManifestHash}};
 return{c,base,state:{objectApiId:p.objectId,snapshot:s,journals:pins}};
}
describe('protected column/pylon run preparation composition',()=>{
 for(let i=0;i<Q.wholeCases.length;i++)it(`retains exact immutable package: ${Q.wholeCases[i].name}`,async()=>{
   const {c,base,state}=input(i),before=clone({base,state});
   const load=vi.fn().mockResolvedValue(state),db={} as PoolClient;
   const got=await augmentColumnPylonSectionPreparation(db,base,load);
   expect(got.columnPylonSectionPackage).toEqual(c.package);expect(got.columnPylonSectionSnapshot).toEqual(c.snapshot);
   expect(load).toHaveBeenCalledExactlyOnceWith(db,{runId:base.run.id,objectId:base.run.objectId,inputManifestHash:base.run.inputManifestHash});
   expect(got.references).toEqual(base.references);expect(got.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
   expect({base,state}).toEqual(before);
 });
 it('snapshot row/pin/sequence mismatches rejected before returning preparation',async()=>{
  for(const mode of ['missing','sequence','pair','hash','public','origin','source']){
   const {base,state}=input();
   if(mode==='missing')state.journals=[];
   if(mode==='sequence')state.journals[0].sequenceNo='9223372036854775807';
   if(mode==='pair')state.journals[0].pairKey='0'.repeat(64);
   if(mode==='hash')state.journals[0].fingerprint='bad';
   if(mode==='public')state.objectApiId='OBJ-FORGED';
   if(mode==='origin')state.journals[0].origins[0].textArtifact.pages[0].locatedLines[0].rawText='forged';
   if(mode==='source')base.waterPackage.sources[0].sourceSha256='0'.repeat(64);
   await expect(augmentColumnPylonSectionPreparation({}as PoolClient,base,async()=>state)).rejects.toThrow();
  }
 });
 it('reference set deduplicated, malformed metadata or over-aggregate refused',async()=>{
  const {base,state}=input();
  state.journals[0].references=[...base.references,{...base.references[0],storageKey:'another.pdf',expectedByteSize:64*1024*1024+1}];
  await expect(augmentColumnPylonSectionPreparation({}as PoolClient,base,async()=>state)).rejects.toThrow();
  state.journals[0].references=[{...base.references[0],expectedSha256:'wrong'}];
  await expect(augmentColumnPylonSectionPreparation({}as PoolClient,base,async()=>state)).rejects.toThrow();
 });
 it('common parent projection selects seven metadata fields, keeps review references and CP source order',()=>{
  const {base,c}=input();for(const s of base.waterPackage.sources){s.reviewSnapshot={opaque:true};if(s.review)s.review.extraProtectedScope=true;}
  expect(columnPylonSectionCurrentSources(base.waterPackage.sources)).toEqual(c.package.sources);
 });
});
