import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {compareZu130LightingTechnologies} from '../src/matrix-lighting-technology-comparison.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-lighting-technology-comparison-v1/qa-gate-regression-goldens.json',import.meta.url));
const M=JSON.parse(bytes.toString('utf8'));
describe('independent frozen lighting gate regressions',()=>{
 it('keeps native shape, association and reconstruction diagnostics separate',()=>{expect(M.gateCases).toHaveLength(5);for(const c of M.gateCases){const x=structuredClone(c.input),before=structuredClone(x);expect(compareZu130LightingTechnologies(x),c.name).toEqual(c.expected);expect(x).toEqual(before);}});
 it('enforces canonical snapshot shape before source reconstruction',()=>{expect(M.shapeCases).toHaveLength(5);for(const c of M.shapeCases){const x=structuredClone(c.input),before=structuredClone(x);expect(compareZu130LightingTechnologies(x),c.name).toEqual(c.expected);expect(x).toEqual(before);}});
});

it('keeps snapshot source association at full reconstruction gate6',()=>{const m=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-lighting-technology-comparison-v1/qa-snapshot-association-golden.json',import.meta.url),'utf8'));expect(m.cases).toHaveLength(1);for(const c of m.cases){const x=structuredClone(c.input),before=structuredClone(x);expect(compareZu130LightingTechnologies(x),c.name).toEqual(c.expected);expect(x).toEqual(before);}});

it('allows an unclaimed source without requiring an invented origin',()=>{const m=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-lighting-technology-comparison-v1/qa-unclaimed-source-golden.json',import.meta.url),'utf8'));expect(m.cases).toHaveLength(1);for(const c of m.cases){const x=structuredClone(c.input),before=structuredClone(x);expect(compareZu130LightingTechnologies(x),c.name).toEqual(c.expected);expect(x).toEqual(before);}});
