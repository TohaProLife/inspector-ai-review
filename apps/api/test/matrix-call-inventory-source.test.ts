/** Independent frozen full-output source oracles; no comparison or approval authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {describe,it} from 'vitest';
import {reconstructOdi123CallInventorySource as reconstruct,callInventoryContentHash} from '../src/matrix-call-inventory-source.js';
const base=new URL('../../../services/worker/tests/fixtures/matrix-call-inventory-v1/',import.meta.url);
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,base),'utf8'));
const originals=read('research-call-authored-goldens.json');
const packets=[['original',originals.fixtures],['portable',read('research-odi123-independent-portable-probes-second.json').cases],['wire',read('root-source-baseline-v2.json').cases],['mixed',read('research-odi123-mixed-gate-vectors-first.json').cases]] as const;
const hash=(bytes:Buffer|string)=>crypto.createHash('sha256').update(bytes).digest('hex');
const canonical=(value:any):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
describe('ODI123 source: independent exact originals, portable inputs and ordered gates',()=>{
 for(const [group,cases] of packets)for(const c of cases)it(group+': '+c.name,()=>{const input=structuredClone(c.input),before=structuredClone(input);assert.deepEqual(reconstruct(input),c.expected);assert.deepEqual(input,before);});
 it('retains all13 original PDF bytes and full canonical artifacts',()=>{
  const manifest=read('research-call-original-manifest-before-extraction.json'),extracted=read('research-call-extraction-first-receipt.json');assert.equal(manifest.originals.length,13);assert.equal(extracted.status,'PASS');
  for(const source of manifest.originals){const bytes=fs.readFileSync(new URL(source.originalPdf,base));assert.equal(bytes.length,source.originalBytes);assert.equal(hash(bytes),source.originalSha256);const artifact=extracted.originals.find((x:any)=>x.name===source.name);assert.ok(artifact);const full=fs.readFileSync(new URL(artifact.fullCanonicalFile,base));assert.equal(hash(full),artifact.fullCanonicalFileSha256);assert.deepEqual(JSON.parse(full.toString()),originals.fixtures.find((x:any)=>x.name===source.name).input.textArtifact);}
 });
 for(const c of originals.fixtures.filter((x:any)=>x.expected.status==='RECONSTRUCTED'))it('detached fragments, domain hash and no extra authority: '+c.name,()=>{
  const input=structuredClone(c.input),before=structuredClone(input),result=reconstruct(input);assert.equal(result.status,'RECONSTRUCTED');if(result.status!=='RECONSTRUCTED')throw Error('Unexpected abstention');
  assert.equal(callInventoryContentHash(result.inventory),hash(canonical({hashDomain:'matrix-odi123-call-inventory-source-id-v1',inventory:c.expected.inventory})));
  result.inventory.headerFragments[0].bboxMilliPoints[0]++;result.inventory.scopeFragments[0].rawText='MUTATED OUTPUT';result.inventory.featureRows[0].fragments[0].bboxMilliPoints[0]++;result.inventory.regionBoxMilliPoints[0]++;
  assert.deepEqual(input,before);assert.deepEqual(reconstruct(input),c.expected);
  for(const key of ['entityKey','complete','assertion','approved','qualified','ruleId','parameterCode','confidence','calibratedProbability','physicalAbsence','coverage'])assert.ok(!(key in c.expected.inventory));
 });
});
const natives=read('audit-broad-approved-vectors.json').nativeCases;
describe('ODI123 source: native values rejected before user code access',()=>{
 for(const c of natives)it(c.name,()=>{
  const x:any=structuredClone(originals.fixtures[0].input);let input:any=x,traps=0;const touched=()=>{traps++;throw Error('User code executed');};
  switch(c.operation){
   case'rootProxy':input=new Proxy(x,{get:touched,ownKeys:touched,getPrototypeOf:touched,getOwnPropertyDescriptor:touched});break;
   case'nestedProxy':x.textArtifact.pages[0]=new Proxy(x.textArtifact.pages[0],{get:touched,ownKeys:touched,getPrototypeOf:touched,getOwnPropertyDescriptor:touched});break;
   case'rootGetter':Object.defineProperty(x,'stage',{get:touched,enumerable:true});break;
   case'arrayGetter':Object.defineProperty(x.textArtifact.pages,'0',{get:touched,enumerable:true});break;
   case'arrayHole':delete x.textArtifact.pages[0];break;
   case'cycle':x.extra=x;break;
   case'arrayExtra':x.textArtifact.pages.extra=true;break;
   case'prototype':Object.setPrototypeOf(x,{evil:true});break;
   case'symbol':x[Symbol('extra')]=true;break;
   case'nonenumerable':Object.defineProperty(x,'extra',{value:true,enumerable:false});break;
   case'bigint':x.extra=1n;break;
   case'nan':x.selection.pageNumber=NaN;break;
   case'infinity':x.selection.pageNumber=Infinity;break;
   case'unsafe':x.selection.pageNumber=9007199254740992;break;
   case'keyBytes':x.extra=Object.fromEntries(Array.from({length:32768},(_,i)=>['界'.repeat(90)+i,null]));break;
   case'depth':{let p=x;for(let i=0;i<66;i++){p.extra={};p=p.extra;}break;}
   case'nodes':x.extra=Array.from({length:20000},()=>({a:null,b:null,c:null,d:null,e:null,f:null}));break;
   case'stringLimit':x.extra='x'.repeat(2000001);break;
   case'container':x.extra=Array.from({length:32769},()=>null);break;
   default:throw Error('Unknown frozen native operation');
  }
  const result=reconstruct(input);assert.equal(result.status,'ABSTAIN');if(result.status!=='ABSTAIN')throw Error('Unexpected reconstruction');assert.ok(c.expectedReasons.includes(result.reasonCode));assert.equal(traps,0);
 });
});
