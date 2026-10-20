import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {buildInventoryComparisons,mergeInventoryCoverage,INVENTORY_CAPABILITY_REGISTRY} from '../src/matrix-inventory-execution.js';
const fixture=(file:string)=>JSON.parse(readFileSync(new URL(`../../../fixtures/matrix-inventory-execution-v1/${file}`,import.meta.url),'utf8'));
const root=fixture('root-wrapper-goldens.json'),reviewed=fixture('reviewed-wrapper-goldens.json');
describe('independently authored typed inventory envelopes and coverage',()=>{
  for(const c of root.cases)it(`root oracle: ${c.name}`,()=>{
    expect(INVENTORY_CAPABILITY_REGISTRY).toEqual(root.capabilityRegistry);
    expect(buildInventoryComparisons(c.input)).toEqual(c.expected);
    const merged=mergeInventoryCoverage(reviewed.baseCoverage,c.expected);
    expect(merged.filter(row=>row.parameterCode!=='AR-053')).toEqual(reviewed.baseCoverage.filter((row:any)=>row.parameterCode!=='AR-053'));
  });
  for(const c of reviewed.cases)it(`reviewed independent oracle: ${c.name}`,()=>{
    const before=structuredClone(c),actual=buildInventoryComparisons(c.package);
    expect(actual).toEqual(c.expectedEnvelope);expect(mergeInventoryCoverage(reviewed.baseCoverage,actual)).toEqual(c.expectedCoverage);
    expect(c).toEqual(before);
    const permuted=structuredClone(c.package);permuted.sources.reverse();permuted.origins.reverse();
    expect(buildInventoryComparisons(permuted)).toEqual(c.expectedEnvelope);
  });
  for(const v of fixture('research-wrapper-adversarial-vectors.json').vectors)it(`adversarial wire: ${v.name}`,()=>{
    const run=()=>v.operation==='build'?buildInventoryComparisons(v.package):mergeInventoryCoverage(v.baseCoverage,v.envelope);
    if(v.expected==='REJECT')expect(run).toThrow();
    else {const rows=run();expect(Array.isArray(rows)).toBe(true);if(!Array.isArray(rows))throw new Error('Expected coverage rows');expect(rows[0]).toEqual(v.baseCoverage[0]);}
  });
});
