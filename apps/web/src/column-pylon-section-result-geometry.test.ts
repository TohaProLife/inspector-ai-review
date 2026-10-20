import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {columnPylonSectionResultEvidence as evidence} from './column-pylon-section-result-evidence';
const oracle=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json',import.meta.url),'utf8'));
function check(change:(item:any)=>void){const c=structuredClone(oracle.wholeCases[0]),env=c.expected.envelope,item=c.expected.evidence[0];change(item);return evidence({objectId:env.objectId,inputManifestHash:env.inputManifestHash},env,c.snapshot,env.results[0],item);}
it('saved native frame and declared mpt width cannot contradict each other',()=>expect(check(e=>e.fragment.pageFrame.widthMilliPoints++)).toBeNull());
it('saved whole-line native frame and mpt bbox must use exact v3 quantization',()=>expect(check(e=>e.fragment.bboxMilliPoints[0]++)).toBeNull());
it('native source path index above frozen v3 index32767 is not a valid target',()=>expect(check(e=>{e.fragmentRole='UNIT_BASIS';e.fragment.sourcePath=[32768];})).toBeNull());
