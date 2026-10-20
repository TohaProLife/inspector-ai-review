import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {extractColumnPylonDimensionLiterals as extract} from '../src/column-pylon-dimension-literals.js';
const ROOT=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const MANUAL=readFileSync(resolve(ROOT,'fixtures/column-pylon-dimension-literals-v1/qa-manual-whole-expectations-v2.json'));
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
expect(digest(MANUAL)).toBe('9c625ad63366bdaa426754e52cce7962886590bbb6b69f6cba946373748d69e0');
const m=JSON.parse(MANUAL.toString('utf8'));
describe('T77 independent complete-source literal-only expectations',()=>{
 it('both complete original transcripts yield ALL six/zero whole outputs, full hashes and no mutation',()=>{
  for(const c of m.wholeCases){const b=readFileSync(resolve(ROOT,c.inputFile));expect(digest(b)).toBe(c.inputFileSha256);const a=JSON.parse(b.toString('utf8')),before=structuredClone(a);expect(extract(a)).toEqual(c.expected);expect(a).toEqual(before);}
 },30000);
 it('preserves original record order, duplicate raw distinct paths, signs, astral codepoint offsets and detached outputs',()=>{
  const c=m.syntheticCases[0],a=structuredClone(c.input),before=structuredClone(a),result:any=extract(a);expect(result).toEqual(c.expected);expect(result.literals.map((x:any)=>x.sourcePath)).toEqual([[1,0],[2,0],[8,0],[9,0]]);expect(result.literals[0].tokens.scope.raw).toBe('🚧\u00a0Корпус');expect(result.literals.map((x:any)=>x.tokens.level.raw)).toEqual(['-0','+0','0','0']);result.literals[0].sourcePath[0]=777;result.extractorProfile.pdfminerVersion='forged';expect(a).toEqual(before);
 });
 it('unsupported language including raw8193 skips, exact128 supported retained and129 refuses whole without prefix',()=>{
  for(const i of [1,3,4]){const c=m.syntheticCases[i];expect(extract(c.input)).toEqual(c.expected);}
 });
 it('eligible page only, unlocated precedence, empty/OCR excluded without absence certificate',()=>{const c=m.syntheticCases[2];expect(extract(c.input)).toEqual(c.expected);});
 it('valid selected literals cannot hide malformed unrelated last page, quality, path or full profile',()=>{for(const c of m.invalidWholeCases)expect(extract(c.input)).toEqual(c.expected);});
 it('rejects native traps without callbacks and fails finite limits before semantic inspection',()=>{
  let callbacks=0;const getter={};Object.defineProperty(getter,'pages',{enumerable:true,get(){callbacks++;throw Error('getter');}});
  const proxy=new Proxy({},{ownKeys(){callbacks++;throw Error('proxy');}});const json={toJSON(){callbacks++;throw Error('toJSON');}};
  const hidden={};Object.defineProperty(hidden,'x',{value:1});const symbolic={[Symbol('x')]:1};const sparse=Array(1);const cycle:any={};cycle.x=cycle;
  for(const value of [getter,proxy,json,hidden,symbolic,sparse,cycle,0.5,NaN,Infinity,9007199254740992,'\ud800'])expect(extract(value)).toEqual(m.nativeExpected);
  expect(callbacks).toBe(0);for(const value of [{pages:Array(513).fill(null)},'a'.repeat(2000001),Array(32769).fill(0)])expect(extract(value)).toEqual(m.limitExpected);
 });
});
