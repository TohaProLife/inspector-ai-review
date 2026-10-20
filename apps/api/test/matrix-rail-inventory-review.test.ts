import {it} from 'vitest';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseRailInventoryScopeInput,parseRailInventoryScopeDecision,
 assertRailInventoryReviewNative,railInventoryScopeHashFields,RailInventoryReviewValidationError} from '../src/matrix-rail-inventory-review.js';
it('frozen rail review boundary, original vectors and native limits',()=>{
const packet=JSON.parse(fs.readFileSync(new URL('../../../fixtures/matrix-rail-comparison-v1/ts-rail-comparison-manual-goldens.json',import.meta.url),'utf8'));
const positive=packet.fixtures.find((x:any)=>x.expected.status==='CANDIDATE');
const source=positive.input.sources[0],scope=source.review.railInventoryScope;
const association={sourceFileId:source.sourceFileId,sourceSha256:source.sourceSha256};
const original=JSON.stringify(scope);
const parsed=parseRailInventoryScopeDecision(scope,association);
assert.deepEqual(parsed,scope);
parsed.claims[0].inventorySnapshot.featureRows[0].fragments[0].rawText='MUTATED';
assert.equal(JSON.stringify(scope),original);
let cases=1,traps=0;
function rejected(code:string,run:()=>unknown){assert.throws(run,(error:unknown)=>error instanceof RailInventoryReviewValidationError&&error.code===code);cases++;}
rejected('SOURCE_PROVENANCE_UNVERIFIED',()=>parseRailInventoryScopeDecision(scope,{...association,sourceFileId:'OTHER'}));
const forged=structuredClone(scope);forged.claims[0].inventorySnapshot.featureRows[0].fragments[0].rawText+=' ';
rejected('SNAPSHOT_MISMATCH',()=>parseRailInventoryScopeDecision(forged,association));
const duplicate=structuredClone(scope);duplicate.claims.push(structuredClone(duplicate.claims[0]));
rejected('DUPLICATE_INVENTORY',()=>parseRailInventoryScopeDecision(duplicate,association));
const getter:any={};Object.defineProperty(getter,'claims',{enumerable:true,get(){traps++;return [];}});
rejected('INVALID_INPUT',()=>parseRailInventoryScopeInput(getter));
const proxy=new Proxy({},{get(){traps++;throw Error('TRAP');},ownKeys(){traps++;throw Error('TRAP');},getPrototypeOf(){traps++;throw Error('TRAP');}});
rejected('INVALID_INPUT',()=>parseRailInventoryScopeInput(proxy));
const cyclic:any={};cyclic.self=cyclic;
rejected('INVALID_INPUT',()=>parseRailInventoryScopeInput(cyclic));
rejected('INPUT_LIMIT',()=>assertRailInventoryReviewNative({first:'я'.repeat(270000)}));
rejected('INPUT_LIMIT',()=>assertRailInventoryReviewNative({a:'я'.repeat(1400000),b:'я'.repeat(1400000),c:'я'.repeat(1400000)},'MATERIALIZED'));
assert.equal(traps,0);
assert.deepEqual(railInventoryScopeHashFields(undefined),{});
const withdrawn={schemaVersion:'matrix-odi120-rail-inventory-review-v1' as const,claims:[]};
assert.deepEqual(parseRailInventoryScopeInput(withdrawn),withdrawn);
assert.deepEqual(railInventoryScopeHashFields(withdrawn),{railInventoryScope:withdrawn});
cases+=3;
for(const fixture of packet.fixtures.filter((x:any)=>x.expected.status==='CANDIDATE'))for(const s of fixture.input.sources){
 if(!s.review?.railInventoryScope)continue;
 assert.deepEqual(parseRailInventoryScopeDecision(s.review.railInventoryScope,{sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256}),s.review.railInventoryScope);cases++;
}
});
