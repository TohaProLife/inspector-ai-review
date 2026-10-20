import {describe,it,expect} from 'vitest';
import {canonicalMatrixReviewedLoaderV7,detachMatrixReviewedLoaderV7} from '../src/matrix-reviewed-loader-v7-native.js';
const rejected=(input:unknown,code='INVALID_INPUT')=>expect(()=>canonicalMatrixReviewedLoaderV7(input)).toThrowError(expect.objectContaining({code}));
describe('T83 fixed aggregate parent native boundary',()=>{
 it('rejects proxies and accessors without invoking caller code',()=>{
  let touched=0;const proxy=new Proxy({}, {ownKeys(){touched++;throw Error('caller');}});
  const accessor=Object.defineProperty({},'secret',{enumerable:true,get(){touched++;return 1;}});
  const revoked=Proxy.revocable({},{});revoked.revoke();
  for(const input of [proxy,accessor,revoked.proxy])rejected(input);expect(touched).toBe(0);
 });
 it('rejects sparse/extended arrays, custom prototypes, symbols, hidden fields, cycles and non-native scalar types',()=>{
  const cycle:any={};cycle.a=cycle;const hidden=Object.defineProperty({},'x',{value:1});const array=[1];Object.assign(array,{extra:2});
  for(const input of [new Array(2),array,new Date(),Object.create({x:1}),{[Symbol('x')]:1},hidden,cycle,1n,undefined,()=>1,0.5,NaN,Infinity,9007199254740992,'\ud800'])rejected(input);
 });
 it('uses codepoint order and exact detached JSON without normalizing strings',()=>{
  const raw={z:' ё \u{10000}', y:'\n',a:[true,null,-9007199254740991]};
  expect(canonicalMatrixReviewedLoaderV7(raw)).toBe('{"a":[true,null,-9007199254740991],"y":"\\n","z":" ё \u{10000}"}');
  const copy=detachMatrixReviewedLoaderV7(raw);expect(copy).toEqual(raw);expect(copy).not.toBe(raw);
 });
 it('allows maximum depth69; next edge fails',()=>{
  let at:unknown=0;for(let i=0;i<69;i++)at=[at];expect(()=>canonicalMatrixReviewedLoaderV7(at)).not.toThrow();rejected([at],'INPUT_LIMIT');
 });
 it('allows32768 container elements; next item fails',()=>{
  expect(()=>canonicalMatrixReviewedLoaderV7(Array(32768).fill(null))).not.toThrow();rejected(Array(32769).fill(null),'INPUT_LIMIT');
 });
 it('charges exact fixed aggregate4500018nodes including keys, rather than reusing a smaller child budget',()=>{
  const chunk=Array(32768).fill(0),raw=Array(137).fill(chunk);raw.push(Array(10663).fill(0));
  expect(()=>canonicalMatrixReviewedLoaderV7(raw)).not.toThrow();raw[137].push(0);rejected(raw,'INPUT_LIMIT');
 });
 it('charges serialized UTF8 punctuation/escaping under64MiB; per-string cap remains2M codepoints',()=>{
  const piece='x'.repeat(2000000);rejected(Array(34).fill(piece),'INPUT_LIMIT');rejected(piece+'x','INPUT_LIMIT');
 });
});
