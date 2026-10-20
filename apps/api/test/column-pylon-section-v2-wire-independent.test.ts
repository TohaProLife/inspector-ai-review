import { describe,it,expect } from 'vitest';
import { normalizeColumnPylonSectionReviewWire,parseColumnPylonSectionReviewWire } from '../src/matrix-column-pylon-section-v2-wire.js';
describe('independent closed review transport',()=>{it('rejects absent closed input',()=>{expect(normalizeColumnPylonSectionReviewWire(null)).toEqual({status:'ABSTAIN',reasonCode:'INVALID_INPUT'});expect(parseColumnPylonSectionReviewWire(Buffer.from('{}'))).toEqual({status:'ABSTAIN',reasonCode:'INVALID_INPUT'});});});

import { readFileSync } from 'node:fs';
const helper=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-v2-v1/qa-independent-helper-goldens.json',import.meta.url),'utf8'));
function canonical(value:any):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort((a,b)=>{const x=[...a].map(c=>c.codePointAt(0)!);const y=[...b].map(c=>c.codePointAt(0)!);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]!-y[i]!;return x.length-y.length;}).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
const invalid={status:'ABSTAIN',reasonCode:'INVALID_INPUT'};const limit={status:'ABSTAIN',reasonCode:'INPUT_LIMIT'};
describe('fixed native and integer-only strict wire',()=>{
 it('preserves exact detached valid UNKNOWN APPROVED WITHDRAWN canonical DTOs',()=>{
  for(const c of helper.cases){const input=structuredClone(c.expectedRequest);const before=structuredClone(input);const expected={status:'VALID',value:c.expectedRequest,canonical:canonical(c.expectedRequest)};expect(normalizeColumnPylonSectionReviewWire(input)).toEqual(expected);expect(parseColumnPylonSectionReviewWire(Buffer.from(JSON.stringify(input)))).toEqual(expected);expect(parseColumnPylonSectionReviewWire(Buffer.from(' \n'+JSON.stringify(input)+'\t'))).toEqual(expected);const result=normalizeColumnPylonSectionReviewWire(input);if(result.status==='VALID')result.value.reference='changed';expect(input).toEqual(before);}
 });
 it('rejects duplicate keys at every level, fractional/exponent lexemes, BOM, bad UTF8, trailing JSON and unknown fields',()=>{
  const input=helper.cases[0].expectedRequest;const raw=JSON.stringify(input);const duplicateRoot=raw.replace('{','{"status":"'+input.status+'",');const duplicateNested=raw.replace('"expected":{','"expected":{"reference":"duplicate",');const fraction=raw.replace(/"pageNumber":\d+/,'"pageNumber":1.0');const exponent=raw.replace(/"pageNumber":\d+/,'"pageNumber":1e3');expect(fraction).not.toBe(raw);expect(exponent).not.toBe(raw);
  for(const text of [duplicateRoot,duplicateNested,fraction,exponent,'\uFEFF'+raw,raw+'{}',JSON.stringify({...input,extra:1})])expect(parseColumnPylonSectionReviewWire(Buffer.from(text))).toEqual(invalid);
  for(const rawBytes of [Buffer.from([0xc3,0x28]),Buffer.from([0xed,0xa0,0x80])])expect(parseColumnPylonSectionReviewWire(rawBytes)).toEqual(invalid);
 });
 it('native descriptor-first guards leave all hostile callbacks untouched',()=>{
  let calls=0;const accessor=Object.defineProperty({},'status',{enumerable:true,get(){calls++;return 'UNKNOWN';}});const proxy=new Proxy({},{ownKeys(){calls++;throw Error('trap');},get(){calls++;throw Error('trap');},getPrototypeOf(){calls++;throw Error('trap');}});const cycle:any={};cycle.self=cycle;const sparse=new Array(2);sparse[1]=1;
  for(const value of [accessor,proxy,cycle,{x:sparse},{x:'\udfff'},{x:1.5},{x:NaN},{x:9007199254740992},Object.create({custom:true}),{toJSON(){calls++;return {};}}])expect(normalizeColumnPylonSectionReviewWire(value)).toEqual(invalid);
  expect(calls).toBe(0);
 });
 it('enforces raw request bytes, canonical request bytes, depth and container budgets before shape',()=>{
  expect(parseColumnPylonSectionReviewWire(Buffer.alloc(524289,32))).toEqual(limit);
  expect(normalizeColumnPylonSectionReviewWire({x:'a'.repeat(524289)})).toEqual(limit);
  let deep:unknown=null;for(let i=0;i<65;i++)deep={x:deep};
  expect(normalizeColumnPylonSectionReviewWire(deep)).toEqual(limit);expect(normalizeColumnPylonSectionReviewWire({x:Array(32769).fill(0)})).toEqual(limit);
 });
});
