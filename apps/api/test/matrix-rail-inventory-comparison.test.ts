/** Frozen whole-output populations; no comparator-derived expected values. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it} from 'vitest';
import {compareOdi120RailInventories} from '../src/matrix-rail-inventory-comparison.js';
const fixture=new URL('../../../fixtures/matrix-rail-comparison-v1/',import.meta.url);
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,fixture),'utf8'));
const packets=[['shared-manual',read('ts-rail-comparison-manual-goldens.json').fixtures],['python-independent',read('researchpy-independent-portable-probes.json').fixtures],['typescript-clarified',read('ts-additional-portable-expectations-clarified-v2.json').vectors]]as const;
describe('ODI120 rail reviewed-region comparison full frozen outputs',()=>{
 for(const[population,cases]of packets)for(const c of cases)it(population+': '+c.name,()=>{const x=structuredClone(c.input),before=structuredClone(x);assert.deepEqual(compareOdi120RailInventories(x),c.expected);assert.deepEqual(x,before);});
 it('keeps frozen fixture bytes and historical original diagnostics',()=>{const provenance=read('provenance.json');for(const[n,h]of Object.entries(provenance.files))assert.equal(createHash('sha256').update(fs.readFileSync(new URL(n,fixture))).digest('hex'),h);const old=read('ts-additional-portable-expectations.json').vectors,current=packets[2][1];assert.equal(old.length,52);const changed=[];for(let i=0;i<old.length;i++){assert.equal(old[i].name,current[i].name);assert.deepEqual(old[i].input,current[i].input);if(JSON.stringify(old[i].expected)!==JSON.stringify(current[i].expected)){changed.push(old[i].name);assert.equal(old[i].expected.reasonCode,'INVALID_INPUT');assert.equal(current[i].expected.reasonCode,'SOURCE_PROVENANCE_UNVERIFIED');}}assert.deepEqual(changed,['duplicate committed source','duplicate retained origin']);});
});
