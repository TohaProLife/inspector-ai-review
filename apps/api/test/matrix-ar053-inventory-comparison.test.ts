import assert from 'node:assert/strict';
import fs from 'node:fs';
import {describe,it} from 'vitest';
import {compareAr053Inventories} from '../src/matrix-ar053-inventory-comparison.js';
const base=new URL('../../../services/worker/tests/fixtures/matrix-ar053-inventory-v1/',import.meta.url);
for(const name of ['paired-fixtures.json','additional-portable-native-vectors.json','review-red-vectors.json','prototype-json-red-vectors.json']){
 const data=JSON.parse(fs.readFileSync(new URL(name,base),'utf8'));
 describe(name,()=>{for(const c of data.cases)it(c.name,()=>{const before=JSON.stringify(c.input);assert.deepEqual(compareAr053Inventories(c.input),c.expected);assert.equal(JSON.stringify(c.input),before);});});
}
