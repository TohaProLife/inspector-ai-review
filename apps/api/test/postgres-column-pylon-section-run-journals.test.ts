/** Bounded SQL adapter tests; mocked private parent/origin loader is not DB/PDF authentication proof. */
import {readFileSync} from 'node:fs';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {loadLatestColumnPylonSectionJournalRows,loadPinnedColumnPylonSectionJournalRows,
 prepareColumnPylonSectionJournalPins} from '../src/postgres-column-pylon-section-run-journals.js';
import {columnPylonSectionPairKey} from '../src/matrix-column-pylon-section-v2.js';
const mocked=vi.hoisted(()=>({prepare:vi.fn()}));
vi.mock('../src/postgres-column-pylon-section-v2-inputs.js',async importOriginal=>({
 ...await importOriginal<object>(),prepareColumnPylonSectionSource:mocked.prepare,
}));
const fixture=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-v2/owner-manual-whole.json',import.meta.url),'utf8')).cases[1].input;
const internal='11111111-1111-4111-8111-111111111111';
function row(){const j=fixture.review,p=j.projection;return{id:j.id,sequence_no:'1',object_id:internal,
 pair_key:columnPylonSectionPairKey({objectId:j.objectId,identity:p.identity,expectedSourceFileId:p.expected.sourceFileId,actualSourceFileId:p.actual.sourceFileId}),
 expected_source_file_id:'22222222-2222-4222-8222-222222222222',actual_source_file_id:'33333333-3333-4333-8333-333333333333',
 expected_source_api_id:p.expected.sourceFileId,actual_source_api_id:p.actual.sourceFileId,
 expected_review_decision_id:p.expected.sourceReviewDecisionId,actual_review_decision_id:p.actual.sourceReviewDecisionId,
 previous_decision_id:j.previousDecisionId,previous_review_hash:j.previousReviewHash,projection_json:p,actor_id:j.actorId,content_hash:j.contentHash,created_at:j.createdAt};}
function client(query:ReturnType<typeof vi.fn>){return{query} as unknown as PoolClient;}
function bytes(){return{rows:[{source_count:1,bytes:'1024'}]};}
beforeEach(()=>{mocked.prepare.mockReset();mocked.prepare.mockImplementation(async(_c,input)=>{const i=fixture.sources.findIndex((s:any)=>s.sourceFileId===input.sourceFileId);return{source:structuredClone(fixture.sources[i]),origin:structuredClone(fixture.origins[i]),sourceInternalId:i===0?row().expected_source_file_id:row().actual_source_file_id,reference:{storageKey:`sql-only-${i}.pdf`,expectedSha256:fixture.sources[i].sourceSha256,expectedByteSize:5,expectedMediaType:'application/pdf'},fingerprint:String(i).repeat(64)};});});
describe('T83 private journal pin adapter',()=>{
 it('bounds all latest pairs before row transfer or status filtering',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{pair_count:17,bytes:'20',max_bytes:'10'}]});
  await expect(loadLatestColumnPylonSectionJournalRows(client(query),internal)).rejects.toMatchObject({code:'KR060_INPUT_LIMIT'});
  expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][0]).not.toContain("status='APPROVED'");
 });
 it('bounds projection bytes before transfer',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{pair_count:1,bytes:'1048577',max_bytes:'1048577'}]});
  await expect(loadLatestColumnPylonSectionJournalRows(client(query),internal)).rejects.toMatchObject({code:'KR060_INPUT_LIMIT'});expect(query).toHaveBeenCalledTimes(1);
 });
 it('historical exact-ID selection never uses a latest/status query; absent IDs fail',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{pair_count:0,bytes:'0',max_bytes:'0'}]});
  await expect(loadPinnedColumnPylonSectionJournalRows(client(query),internal,[fixture.review.id])).rejects.toMatchObject({code:'KR060_INPUT_INTEGRITY'});
  expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][0]).toContain('ANY');expect(query.mock.calls[0][0]).not.toContain('DISTINCT ON');
 });
 it('rejects forged metadata before origin access',async()=>{
  const query=vi.fn();await expect(prepareColumnPylonSectionJournalPins(client(query),{objectId:internal,objectApiId:fixture.objectId,rows:[{...row(),pair_key:'f'.repeat(64)}]},{})).rejects.toMatchObject({code:'KR060_INPUT_INTEGRITY'});expect(mocked.prepare).not.toHaveBeenCalled();
 });
 it('bounds immediate predecessor JSON before transfer or original access',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{pair_count:1,bytes:'1048577',max_bytes:'1048577'}]});
  await expect(prepareColumnPylonSectionJournalPins(client(query),{objectId:internal,objectApiId:fixture.objectId,rows:[row()]},{})).rejects.toMatchObject({code:'KR060_INPUT_LIMIT'});
  expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][0]).toContain('octet_length');expect(mocked.prepare).not.toHaveBeenCalled();
 });
 it('rejects original size before private original transfer',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{pair_count:0,bytes:'0',max_bytes:'0'}]}).mockResolvedValueOnce({rows:[{source_count:1,bytes:'32000001'}]});
  await expect(prepareColumnPylonSectionJournalPins(client(query),{objectId:internal,objectApiId:fixture.objectId,rows:[row()]},{})).rejects.toMatchObject({code:'KR060_INPUT_LIMIT'});expect(mocked.prepare).not.toHaveBeenCalled();
 });
 it('retains exact expected/actual historical pair and original refs in fixed order',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{pair_count:0,bytes:'0',max_bytes:'0'}]}).mockResolvedValueOnce(bytes()).mockResolvedValueOnce(bytes());
  const pins=await prepareColumnPylonSectionJournalPins(client(query),{objectId:internal,objectApiId:fixture.objectId,rows:[row()]},{});
  expect(pins).toHaveLength(1);expect(pins[0]).toMatchObject({journal:fixture.review,sequenceNo:'1',pairKey:row().pair_key,historicalSources:fixture.sources,origins:fixture.origins});
  expect(pins[0].references).toHaveLength(2);expect(pins[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(mocked.prepare.mock.calls.map(c=>c[1].historicalReviewDecisionId)).toEqual([fixture.review.projection.expected.sourceReviewDecisionId,fixture.review.projection.actual.sourceReviewDecisionId]);
 });
});
