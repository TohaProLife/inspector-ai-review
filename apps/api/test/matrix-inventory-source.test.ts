import assert from "node:assert/strict";
import fs from "node:fs";
import {describe,it} from "vitest";
import {reconstructAr053InventorySource,inventoryContentHash} from "../src/matrix-inventory-source.js";
const packet=JSON.parse(fs.readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-inventory-v1/portable-goldens.json",import.meta.url),"utf8"));
describe("source inventory: independently authored whole-source oracles",()=>{
for(const fixture of packet.fixtures)it(fixture.name,()=>{
 const input=structuredClone(fixture.input),before=structuredClone(input),actual=reconstructAr053InventorySource(input);
 assert.deepEqual(input,before);assert.deepEqual(actual,fixture.expected);assert.equal(actual.status,"RECONSTRUCTED");
 if(actual.status==="RECONSTRUCTED")assert.equal(inventoryContentHash(actual.inventory),fixture.expectedInventoryContentHash);
});
for(const vector of packet.validationVectors)it(vector.name,()=>{
 const input=structuredClone(packet.fixtures.find((f:{name:string})=>f.name===vector.base).input);
 for(const operation of vector.operations){let target=input;for(const key of operation.path.slice(0,-1))target=target[key];target[operation.path.at(-1)]=operation.value;}
 assert.deepEqual(reconstructAr053InventorySource(input),vector.expected);
});
});
