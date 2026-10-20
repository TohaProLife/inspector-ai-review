import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {reconstructLightingTechnologySource,lightingTechnologyDeclarationContentHash} from '../src/matrix-lighting-technology-source.js';
const root=new URL('../../../fixtures/matrix-lighting-technology-source-v1/',import.meta.url);
const bytes=readFileSync(new URL('research-authored-goldens.json',root));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('e5340b5bd776432af6349436387298998df2d0da44b087932c681b30971be59a');
const cases=JSON.parse(bytes.toString('utf8')).cases as Array<{name:string;input:any;expected:any;expectedDeclarationContentHash:string|null}>;
describe('independent original-backed lighting declaration source whole outputs',()=>{
 for(const c of cases)it(c.name,()=>{
  const input=structuredClone(c.input),before=JSON.stringify(input);
  const actual=reconstructLightingTechnologySource(input);
  expect(actual).toEqual(c.expected);expect(JSON.stringify(input)).toBe(before);
  if(actual.status==='RECONSTRUCTED')expect(lightingTechnologyDeclarationContentHash(actual.declaration)).toBe(c.expectedDeclarationContentHash);
 });
});
