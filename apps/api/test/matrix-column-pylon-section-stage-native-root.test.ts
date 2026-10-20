/** Stage output retains frozen legacy fractional normalized PDF geometry.
 * The strict safe-integer 13-field loader is a separate boundary. */
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import {canonicalMatrixReviewedLoaderV7} from '../src/matrix-reviewed-loader-v7-native.js';

let guard:(value:unknown)=>void;
beforeAll(async()=>{guard=(await import('../src/matrix-column-pylon-section-stage-native.js')).assertColumnPylonSectionStageNative;});
const fixture=new URL('../../../fixtures/matrix-column-pylon-section-execution-v1/actual-full-original-worker-result-v12.json',import.meta.url);
it('admits exact actual worker output including unchanged legacy fractional geometry',()=>{
 const value=JSON.parse(readFileSync(fixture,'utf8')),before=JSON.stringify(value);
 expect(value.execution.observations.some((x:any)=>!Number.isInteger(x.bbox.y))).toBe(true);
 expect(()=>canonicalMatrixReviewedLoaderV7(value)).toThrow();
 expect(()=>guard(value)).not.toThrow();expect(JSON.stringify(value)).toBe(before);
 expect(()=>canonicalMatrixReviewedLoaderV7(value.columnPylonSectionComparisons)).not.toThrow();
 expect(()=>canonicalMatrixReviewedLoaderV7(value.columnPylonSectionSnapshot)).not.toThrow();
});
it('retains finite fractional values exactly and rejects unsafe or nonfinite values',()=>{
 for(const number of [0,0.7676168757126568,1e-7,-1.25,Number.MAX_SAFE_INTEGER])expect(()=>guard({number})).not.toThrow();
 for(const number of [NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1])expect(()=>guard({number})).toThrow();
});
it('rejects callbacks, proxies, cycles, sparse arrays and nonplain values without invoking callbacks',()=>{
 let callbacks=0;const accessor=Object.defineProperty({},'value',{enumerable:true,get(){callbacks++;return 1;}});
 const proxy=new Proxy({},{ownKeys(){callbacks++;return[];}}),cycle:any={};cycle.self=cycle;
 for(const value of [accessor,{nested:accessor},proxy,{nested:proxy},cycle,Array(1),new Date(),{toJSON(){callbacks++;return{};}},{[Symbol('x')]:1}])expect(()=>guard(value)).toThrow();
 expect(callbacks).toBe(0);
});
it('retains ASCII-key and scalar Unicode rules with fixed aggregate limits',()=>{
 expect(()=>guard({label:'Колонна 😀'})).not.toThrow();
 for(const value of [{'é':1},{text:'\ud800'},Array(32769).fill(0),{a:'x'.repeat(2_000_001)},Object.fromEntries(['a','b','c','d','e'].map(k=>[k,'x'.repeat(2_000_000)]))])expect(()=>guard(value)).toThrow();
});
