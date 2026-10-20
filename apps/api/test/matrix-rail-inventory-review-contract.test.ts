import {it} from 'vitest';
/** Frozen request-policy expectations; shape validation grants no source authority. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 matrixRailInventoryScopeInputSchema as requestSchema,
 matrixRailInventoryScopeDecisionSchema as decisionSchema,
 railInventoryScopeDecisionToInput as project,
} from '@inspector-ai/contracts';

it('frozen rail review boundary, original vectors and native limits',()=>{
const packet=JSON.parse(fs.readFileSync(new URL('../../../fixtures/matrix-rail-comparison-v1/ts-rail-comparison-manual-goldens.json',import.meta.url),'utf8'));
const original=JSON.stringify(packet);
const forbidden=packet.requestVectors.find((x:any)=>x.kind==='REQUEST_SERVER_FIELD_REJECTION');
assert.equal(requestSchema.safeParse(forbidden.request).success,false);
const vector=packet.requestVectors.find((x:any)=>x.kind==='DEEP_DECISION_TO_REQUEST_PROJECTION');
const input=structuredClone(vector.decision),result=project(input);
assert.deepEqual(result,vector.expectedRequest);
assert.equal(result.claims[0].assertion,'UNKNOWN');
assert.equal(result.claims[0].roomMapping.assertion,'UNKNOWN');
assert.ok(!('inventorySnapshot' in result.claims[0]));
result.claims[0].selection.headerFragments[0].bboxMilliPoints[0]++;
result.claims[0].identity.roomKey='MUTATED';
result.claims[0].target.checkId='MUTATED';
result.claims[0].roomMapping.sourceRoomToken='MUTATED';
assert.deepEqual(input,vector.decision);

let validDecisions=0;
for(const fixture of packet.fixtures.filter((x:any)=>x.expected.status==='CANDIDATE')) {
 for(const source of fixture.input.sources) {
  const scope=source.review?.railInventoryScope;
  if(scope===null||scope===undefined)continue;
  assert.equal(decisionSchema.safeParse(scope).success,true,fixture.name);
  const projected=project(scope);
  assert.equal(requestSchema.safeParse(projected).success,true);
  assert.equal(requestSchema.safeParse(scope).success,false,'Server snapshot forbidden on request');
  validDecisions++;
 }
}
const bad=structuredClone(vector.decision);
bad.claims[0].inventorySnapshot.featureRows[0].fragments.push(
 ...Array(3).fill(bad.claims[0].inventorySnapshot.featureRows[0].fragments[0]));
assert.equal(decisionSchema.safeParse(bad).success,false,'At most3 fragments per source feature');
const wrongRole=structuredClone(vector.expectedRequest);wrongRole.claims[0].identity.systemKind='PERSONNEL_CALL';
assert.equal(requestSchema.safeParse(wrongRole).success,false,'No call-domain identity field');
const page=structuredClone(vector.decision);page.claims[0].inventorySnapshot.featureRows[0].fragments[0].pageNumber++;
assert.equal(decisionSchema.safeParse(page).success,false,'Snapshot fragments must name own page');
assert.equal(JSON.stringify(packet),original);
});
