import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {canonicalJson} from '../src/canonical-json.js';
const mocks=vi.hoisted(()=>({load:vi.fn(),prepare:vi.fn()}));
vi.mock('../src/postgres-column-pylon-section-run-journals.js',()=>({loadPinnedColumnPylonSectionJournalRows:mocks.load,prepareColumnPylonSectionJournalPins:mocks.prepare}));
import {loadColumnPylonSectionRunState} from '../src/postgres-column-pylon-section-run-state.js';
const Q=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json',import.meta.url),'utf8'));
function fixture(){
 const c=structuredClone(Q.wholeCases[0]),s=c.snapshot;
 const input={runId:'22222222-2222-2222-2222-222222222222',objectId:s.objectId,inputManifestHash:s.inputManifestHash};
 const header={object_api_id:s.objectApiId,bytes:String(Buffer.byteLength(canonicalJson(s))),content_hash:s.contentHash,input_manifest_hash:s.inputManifestHash};
 const state={snapshot_json:s,content_hash:s.contentHash,input_manifest_hash:s.inputManifestHash,object_api_id:s.objectApiId};
 const entries=s.entries.map((e:any)=>({pair_key:e.pairKey,decision_id:e.decisionId,sequence_no:e.sequenceNo,journal_content_hash:e.journalContentHash,projection_content_hash:e.projectionContentHash,included:e.included,exclusion_reason:e.exclusionReason}));
 const pins=c.package.reviews.map((r:any)=>({...r,pairKey:entries[0].pair_key,sequenceNo:entries[0].sequence_no}));
 mocks.load.mockReset().mockResolvedValue(['EXACT_PINNED_ROWS']);mocks.prepare.mockReset().mockResolvedValue(pins);
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('AS bytes')?[header]:sql.includes('SELECT snapshot_json')?[state]:sql.includes('count(*)')?[{entry_count:entries.length}]:sql.includes('snapshot_entries')?entries:[]}));
 return{input,header,state,entries,pins,query,db:{query}as any};
}
describe('immutable PostgreSQL pair snapshot reader',()=>{
 it('returns exact stored snapshot and pins exact historical decision IDs, never latest',async()=>{
  const f=fixture();expect(await loadColumnPylonSectionRunState(f.db,f.input,{})).toEqual({objectApiId:f.header.object_api_id,snapshot:f.state.snapshot_json,journals:f.pins});
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith(f.db,f.input.objectId,f.entries.map((e:any)=>e.decision_id),undefined);
  expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(f.db,{objectId:f.input.objectId,objectApiId:f.header.object_api_id,rows:['EXACT_PINNED_ROWS']},{},undefined);
 });
 it('metadata, exact entry bijection and sequence tampering rejected',async()=>{
  for(const mode of ['headerhash','headerbytes','manifest','missingentry','entryhash','sequence','entryextra']){
   const f=fixture();
   if(mode==='headerhash')f.header.content_hash='0'.repeat(64);
   if(mode==='headerbytes')f.header.bytes='524289';
   if(mode==='manifest')f.header.input_manifest_hash='0'.repeat(64);
   if(mode==='missingentry')f.entries.pop();
   if(mode==='entryhash')f.entries[0].journal_content_hash='0'.repeat(64);
   if(mode==='sequence')f.entries[0].sequence_no='2';
   if(mode==='entryextra')f.entries.push({...f.entries[0],pair_key:'0'.repeat(64)});
   await expect(loadColumnPylonSectionRunState(f.db,f.input,{})).rejects.toThrow();
  }
 });
 it('entry count preflight rejects before unbounded entry transfer',async()=>{
  const f=fixture();f.query.mockImplementation(async(sql:string)=>({rows:sql.includes('AS bytes')?[f.header]:sql.includes('SELECT snapshot_json')?[f.state]:sql.includes('count(*)')?[{entry_count:17}]:f.entries}));
  await expect(loadColumnPylonSectionRunState(f.db,f.input,{})).rejects.toThrow();
  expect(f.query.mock.calls.some(([sql])=>sql.includes('SELECT pair_key'))).toBe(false);
 });
});
