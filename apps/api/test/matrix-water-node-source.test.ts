import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {reconstructZu129WaterNodeSource,waterNodeInventoryContentHash,WATER_NODE_EXTRACTOR_VERSION,WATER_NODE_POLICY_VERSION} from '../src/matrix-water-node-source.js';

const fixtureRoot=new URL('../../../services/worker/tests/fixtures/matrix-water-node-v1/',import.meta.url);
const pins=[['research-authored-goldens.json','48c84df4124fce90365c4964e8eae316b423bf7abadc4748b8f65a614a24b067'],['research-layout-clarification-goldens.json','58a75068d5c248192f1a49345c61365014fe64a8d9ec355ea3033057f256c020']] as const;
const fixtures=pins.flatMap(([name,sha])=>{const bytes=readFileSync(new URL(name,fixtureRoot));expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);return JSON.parse(bytes.toString('utf8')).fixtures as Array<{name:string;input:any;expected:any;expectedInventoryContentHash:string|null}>;});
const invalid=(reasonCode='INVALID_INPUT')=>({schemaVersion:'matrix-zu129-water-node-source-result-v1',status:'ABSTAIN',reasonCode});
const base=()=>structuredClone(fixtures[0].input);
const freeze=(v:any):any=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

describe('ZU129 water-node source frozen independent full outputs',()=>{
 it('uses distinct source-only versions and the complete independent fixture population',()=>{
  expect(WATER_NODE_EXTRACTOR_VERSION).toBe('matrix-zu129-water-node-source-v1');
  expect(WATER_NODE_POLICY_VERSION).toBe('matrix-zu129-cold-water-inlet-literals-v1');
  expect(fixtures).toHaveLength(53);
 });
 for(const fixture of fixtures)it(fixture.name,()=>{
  const input=structuredClone(fixture.input),before=JSON.stringify(input);
  const result=reconstructZu129WaterNodeSource(freeze(input));
  expect(result).toEqual(fixture.expected);expect(JSON.stringify(input)).toBe(before);
  if(result.status==='RECONSTRUCTED')expect(waterNodeInventoryContentHash(result.inventory)).toBe(fixture.expectedInventoryContentHash);
 });
 it('does not alias returned geometry or raw fragments into source material',()=>{
  const input=base(),before=JSON.stringify(input),result=reconstructZu129WaterNodeSource(input);
  expect(result.status).toBe('RECONSTRUCTED');if(result.status!=='RECONSTRUCTED')throw Error('Expected reconstructed fixture');
  result.inventory.regionBoxMilliPoints[0]=1;
  result.inventory.scopeFragments[0].bboxMilliPoints[0]=1;
  result.inventory.featureRows[0].fragments[0].rawText='edited view';
  expect(JSON.stringify(input)).toBe(before);
 });
});

describe('ZU129 hostile native boundary',()=>{
 for(const [name,value]of [
  ['undefined',undefined],['NaN',NaN],['infinity',Infinity],['fraction',1.5],['bigint',1n],['symbol',Symbol('x')],['function',()=>0],['date',new Date(0)],['null prototype',Object.create(null)],['custom prototype',Object.create({x:1})],['lone surrogate','\ud800'],
 ] as const)it(`rejects ${name}`,()=>expect(reconstructZu129WaterNodeSource(value)).toEqual(invalid()));
 it('rejects cycles and symbol/non-enumerable keys',()=>{
  const cycle:any={};cycle.self=cycle;
  for(const value of [cycle,Object.assign(base(),{[Symbol('x')]:1}),Object.defineProperty(base(),'hidden',{value:1})])expect(reconstructZu129WaterNodeSource(value)).toEqual(invalid());
 });
 it('rejects getters, proxies, toJSON and array accessors without callbacks',()=>{
  let calls=0;const trap=()=>{calls++;throw Error('Must never execute');};
  const getter=Object.defineProperty(base(),'selection',{enumerable:true,get:trap});
  const proxy=new Proxy(base(),{get:trap,ownKeys:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap});
  const json=Object.assign(base(),{toJSON:trap});
  const array:any[]=[0,1,2,3];Object.defineProperty(array,'0',{enumerable:true,get:trap});
  const withArray=base();withArray.selection.regionBoxMilliPoints=array;
  for(const value of [getter,proxy,json,withArray]){
   expect(reconstructZu129WaterNodeSource(value)).toEqual(invalid());
   expect(()=>waterNodeInventoryContentHash(value as any)).toThrow();
  }
  const revoked=Proxy.revocable(base(),{});revoked.revoke();expect(reconstructZu129WaterNodeSource(revoked.proxy)).toEqual(invalid());
  expect(()=>waterNodeInventoryContentHash(revoked.proxy)).toThrow();expect(calls).toBe(0);
 });
 it('rejects sparse and extended arrays before semantic access',()=>{
  for(const array of [new Array(4),Object.assign([0,1,2,3],{extra:1})]){
   const value=base();value.selection.regionBoxMilliPoints=array;expect(reconstructZu129WaterNodeSource(value)).toEqual(invalid());
  }
 });
 it('applies declared native budgets before exact envelope validation',()=>{
  let deep:any=null;for(let i=0;i<65;i++)deep=[deep];
  for(const value of [deep,new Array(32769).fill(null),'x'.repeat(2000001),['😀'.repeat(1000000),'😀'.repeat(1000000),'x'],Array.from({length:7000},()=>new Array(30).fill(null))]){
   expect(reconstructZu129WaterNodeSource(value)).toEqual(invalid('INPUT_LIMIT'));
   expect(()=>waterNodeInventoryContentHash(value as any)).toThrow();
  }
 });
 it('preserves exact case and source spelling of source-local tokens',()=>{
  const fixture=fixtures.find(f=>f.name==='pd-unicode-tokens')!;
  const result=reconstructZu129WaterNodeSource(fixture.input);expect(result).toEqual(fixture.expected);
  expect(result.status).toBe('RECONSTRUCTED');
  if(result.status==='RECONSTRUCTED')expect(result.inventory).not.toHaveProperty('complete');
 });
});
