import fs from 'node:fs';import assert from 'node:assert/strict';import {it} from 'vitest';
import {buildInventoryComparisons,mergeInventoryCoverage}from'../src/matrix-inventory-execution.js';
it('rejects 24 native/resource attacks without getters or proxy traps; no alias and exact source caps',()=>{
const fixture=JSON.parse(fs.readFileSync(new URL('../../../fixtures/matrix-inventory-execution-v1/reviewed-wrapper-goldens.json',import.meta.url),'utf8'));
const seed=fixture.cases[0].package,cap=fixture.capabilityRegistry;let invocations=0;
const getter={};Object.defineProperty(getter,'sources',{enumerable:true,get(){invocations++;throw Error('getter executed')}});
const proxy=new Proxy({},{ownKeys(){invocations++;throw Error('proxy trap executed')}});
const nonenum={};Object.defineProperty(nonenum,'x',{value:1,enumerable:false});
const symbolkey:any={};symbolkey[Symbol('x')]=1;const sparse=Array(2);const extra:any=[];extra.field=1;const cycle:any={};cycle.self=cycle;
class Custom{value=1};let deep:any=null;for(let i=0;i<65;i++)deep={child:deep};
const cases:[string,unknown][]=[['undefined',undefined],['function',()=>1],['symbol',Symbol('x')],['bigint',1n],['date',new Date()],['map',new Map()],['set',new Set()],['custom',new Custom()],['getter',getter],['proxy',proxy],['nonenumerable',nonenum],['symbolkey',symbolkey],['sparse',sparse],['arrayextra',extra],['cycle',cycle],['nan',NaN],['infinity',Infinity],['unsafe',2**53],['surrogate',{x:'\ud800'}],['depth65',deep],['container32769',Array(32769).fill(null)],['codepoints2000001',{x:'x'.repeat(2000001)}],['utf8key-budget',{a:'x'.repeat(2000000),b:'x'.repeat(2000000),c:'x'.repeat(2000000),d:'x'.repeat(2000000)}],['nodes200000',Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),Array(30000).fill(null)]))]];
const results=cases.map(([name,input])=>{assert.throws(()=>buildInventoryComparisons(input,cap),name);return{name,status:'REJECTED'}});assert.equal(invocations,0);
const before=structuredClone(seed),output=buildInventoryComparisons(seed,cap);(output.results[0] as any).identity.entityKey='mutated';assert.deepEqual(seed,before);
const base=structuredClone(fixture.baseCoverage),env=structuredClone(fixture.cases[0].expectedEnvelope),merged=mergeInventoryCoverage(base,env,cap);merged[0].reason='mutated';assert.deepEqual(base,fixture.baseCoverage);assert.deepEqual(env,fixture.cases[0].expectedEnvelope);
const boundary=structuredClone(seed);boundary.origins=[];boundary.identities=[];boundary.sources=Array.from({length:64},(_,i)=>({sourceFileId:'source-'+i,sourceSha256:'0'.repeat(64),stages:[],review:null,reviewSnapshot:null}));assert.equal(buildInventoryComparisons(boundary,cap).results[0].kind,'UNBOUND_ATOM_ABSTENTION');boundary.sources.push({...boundary.sources[0],sourceFileId:'source-64'});assert.throws(()=>buildInventoryComparisons(boundary,cap));
const summary={status:'PASS',rejectedHostAndResourceCases:results.length,getterOrProxyInvocations:invocations,noAlias:true,sources64Boundary:'PASS',sources65Rejection:'PASS',results};

assert.equal(summary.status,'PASS');
});
