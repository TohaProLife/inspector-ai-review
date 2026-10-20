/** Frozen independent T44 expectations; no staged output imports. */
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {describe,it} from 'vitest';
import {compareOdi123CallInventories as compare} from '../src/matrix-odi123-call-inventory-comparison.js';
const D=new URL('../../../fixtures/matrix-call-comparison-v1/',import.meta.url);
const load=(n:string)=>JSON.parse(fs.readFileSync(new URL(n,D),'utf8'));
const manual=load('research-call-comparison-manual-goldens-v2.json'),supp=load('research-call-comparison-manual-section-supplement.json'),
 own=load('ts-independent-vectors-v2.json'),peer=load('research-odi123-independent-portable-probes.json'),association=load('ts-snapshot-association-vectors.json');
const base=manual.cases[0].input;
const native=own.nativeCases.map((c:any)=>{let x:any=structuredClone(base),calls=0;const touched=()=>{calls++;throw new Error('UNTRUSTED_ACCESSOR_EXECUTED')};
 switch(c.operation){
 case'rootProxy':x=new Proxy(x,{get:touched,ownKeys:touched,getOwnPropertyDescriptor:touched,getPrototypeOf:touched});break;
 case'reviewProxy':x.sources[0].review=new Proxy(x.sources[0].review,{get:touched,ownKeys:touched,getOwnPropertyDescriptor:touched,getPrototypeOf:touched});break;
 case'reviewGetter':Object.defineProperty(x.sources[0],'review',{enumerable:true,get:touched});break;
 case'indexGetter':Object.defineProperty(x.sources,'0',{enumerable:true,get:touched});break;
 case'hole':delete x.origins[0];break;
 case'arrayPrototype':Object.setPrototypeOf(x.sources,Object.create(Array.prototype));break;
 case'cycle':x.extra=x;break;
 case'sharedReference':{const same={ok:true};x.extra=[same,same];break;}
 case'symbol':x[Symbol('evil')]=true;break;
 case'nonenumerable':Object.defineProperty(x,'extra',{value:true,enumerable:false});break;
 case'prototype':Object.setPrototypeOf(x,{extra:true});break;
 case'bigint':x.extra=1n;break;
 case'unsafe':x.sources[0].review.callInventoryScope.claims[0].selection.pageNumber=9007199254740992;break;
 case'fraction':x.sources[0].review.callInventoryScope.claims[0].selection.pageNumber=1.5;break;
 case'surrogate':x.objectId='invalid\ud800';break;
 case'nan':x.extra=NaN;break;
 case'infinity':x.extra=Infinity;break;
 case'keyBytes':x.extra=Object.fromEntries(Array.from({length:32768},(_,i)=>['界'.repeat(90)+i,null]));break;
 case'nodes':x.extra=Array.from({length:20000},()=>({a:null,b:null,c:null,d:null,e:null,f:null}));break;
 case'depth':{let p=x;for(let i=0;i<66;i++){p.extra={};p=p.extra;}break;}
 case'stringLimit':x.extra='x'.repeat(2000001);break;
 case'container':x.extra=Array.from({length:32769},()=>null);break;
 default:throw new Error('Unknown own native vector');
 }return{c,x,calls:()=>calls};});

describe('ODI123 comparison independent portable wholeoutputs169 (overlaps accepted197)',()=>{
 for(const [suite,cases] of [['manual39v2',manual.cases],['valid-section2',supp.cases],['own56',own.cases],['peer54',peer.cases],['association18',association.cases]] as const)
  for(const c of cases)it(suite+': '+c.name,()=>{const input=structuredClone(c.input),before=structuredClone(input);assert.deepEqual(compare(input),c.expected);assert.deepEqual(input,before);});
});
describe('ODI123 native22 without user code execution',()=>{
 for(const {c,x,calls} of native)it(c.name,()=>{const actual=compare(x);assert.deepEqual(actual,{schemaVersion:'matrix-odi123-call-inventory-comparison-v1',status:'ABSTAIN',reasonCode:c.expectedReason,calibratedProbability:null});assert.equal(calls(),0);});
});
for(const c of manual.cases.filter((c:any)=>c.expected.status==='CANDIDATE'))it('detached result: '+c.name,()=>{
 const input=structuredClone(c.input),before=structuredClone(input),actual=compare(input);assert.equal(actual.status,'CANDIDATE');if(actual.status!=='CANDIDATE')throw Error('Expected candidate');
 actual.identity.roomKey='MUTATED_RESULT_ONLY';actual.expected.sourceFileId='MUTATED_RESULT_ONLY';actual.missingFeatureKeys[0]='MUTATED_RESULT_ONLY' as any;
 assert.deepEqual(input,before);assert.deepEqual(compare(input),c.expected);
});
it('legitimate repeated noncyclic identity object is permitted',()=>{
 const input=structuredClone(base);input.sources[0].review.callInventoryScope.claims[0].identity=input.identity;input.sources[1].review.callInventoryScope.claims[0].identity=input.identity;
 const before=structuredClone(input);assert.deepEqual(compare(input),manual.cases[0].expected);assert.deepEqual(input,before);
});
it('historical39 remains immutable; exactly two OTHER diagnostics explicitly amended',()=>{
 const old=load('research-call-comparison-manual-goldens.json');const difference=old.cases.filter((c:any,i:number)=>JSON.stringify(c.expected)!==JSON.stringify(manual.cases[i].expected));assert.equal(difference.length,2);
 for(const c of difference){assert.equal(c.expected.reasonCode,'SOURCE_SECTION_UNVERIFIED');const next=manual.cases.find((x:any)=>x.name===c.name);assert.deepEqual(next.input,c.input);assert.equal(next.expected.reasonCode,'INVALID_INPUT');}
});
it('committed fixture provenance pins every copied oracle byte',()=>{
 const hashes:Record<string,string>={
 'research-call-comparison-manual-goldens.json':'f9370d258e978538ca4c35b932cfd63eb4aef0588e9c4642c76c18171ba079db',
 'research-call-comparison-manual-goldens-v2.json':'b130aca12baf415472a9faeb7a0e64ea0157a95a00adfcd082daf52e607cb062',
 'research-call-comparison-manual-section-supplement.json':'e9032ae3301684112d04af832bab1b9e00a3ea992dca9e49e771efd8ffdb45bf',
 'ts-independent-vectors-v2.json':'dea36e3fc5d58b3933dd1c3118ec8ea2e22724d57a64dbdffb1544dd762ed48c',
 'research-odi123-independent-portable-probes.json':'8f6d9d8ea43b21228f9e6ed5bb3424387fbf46afa0c3a50fb8309a8abb3f9cc9',
 'ts-snapshot-association-vectors.json':'461d2523cbb39de6170631a885869bc94103b63fc2b2a1e7eaf75f77cb5ed9d7',
 'research-call-comparison-wire-approved.json':'a0e607885b65478b14df4232824574c649ce82ec5dffd256d1250d962740541f',
 'root-snapshot-association-clarification.json':'7ea544b126108466b923d7e51dbdbc9c0207a6bea4794ef7ef2e923ba897b17b'};
 assert.equal(Object.keys(hashes).length,8);for(const [name,expected] of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(name,D))).digest('hex'),expected);
});
