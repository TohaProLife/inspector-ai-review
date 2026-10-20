/** Host-native adversarial cases remain native; no JSON transport claims. */
import assert from 'node:assert/strict';import fs from 'node:fs';import {describe,it} from 'vitest';
import {reconstructOdi120RailInventorySource as reconstruct} from '../src/matrix-rail-inventory-source.js';
const fixture=new URL('../../../services/worker/tests/fixtures/matrix-rail-inventory-v1/',import.meta.url),read=(n:string)=>JSON.parse(fs.readFileSync(new URL(n,fixture),'utf8'));
const golden=read('research-rail-authored-goldens.json').fixtures.find((f:any)=>f.name==='pd-both'),base=()=>structuredClone(golden.input);
describe('ODI120 rail descriptor/native/resource boundaries',()=>{
 for(const[name,reason]of read('researchpy-cross-native-plan.json').cases)it(name,()=>{
  let x:any=base(),input:any=x,traps=0;const touched=()=>{traps++;throw Error('User code must not execute')};
  switch(name){
   case'root proxy':input=new Proxy(x,{get:touched,getPrototypeOf:touched,ownKeys:touched,getOwnPropertyDescriptor:touched});break;
   case'revoked proxy':{const r=Proxy.revocable(x,{});r.revoke();input=r.proxy;break;}
   case'nested page proxy':x.textArtifact.pages[0]=new Proxy(x.textArtifact.pages[0],{get:touched,getPrototypeOf:touched,ownKeys:touched});break;
   case'root accessor':Object.defineProperty(x,'stage',{enumerable:true,get:touched});break;
   case'block accessor':Object.defineProperty(x.textArtifact.pages[0].blocks[0],'text',{enumerable:true,get:touched});break;
   case'array element accessor':Object.defineProperty(x.textArtifact.pages,'0',{enumerable:true,get:touched});break;
   case'sparse array':delete x.selection.regionBoxMilliPoints[1];break;
   case'array extra own key':x.selection.regionBoxMilliPoints.extra=true;break;
   case'symbol key':x[Symbol('extra')]=true;break;
   case'nonenumerable extra key':Object.defineProperty(x,'extra',{value:true,enumerable:false});break;
   case'custom prototype':Object.setPrototypeOf(x,{a:1});break;
   case'cycle':x.extra=x;break;
   case'unsafe integer':x.selection.pageNumber=2**53;break;
   case'nan':x.selection.pageNumber=NaN;break;
   case'lone surrogate':x.sourceFileId='\ud800';break;
   case'container cap':x.extra=Array(32769).fill(null);break;
   case'codepoint cap':x.extra='x'.repeat(2000001);break;
   case'UTF8 key bytes':x.extra=Object.fromEntries(Array.from({length:4},(_,i)=>['x'.repeat(1999999)+i,null]));break;
   case'node cap including keys':x.extra=Array.from({length:5},()=>Object.fromEntries(Array.from({length:20000},(_,i)=>[String(i),null])));break;
   case'depth cap':{let v:any[]=[];x.extra=v;for(let i=0;i<65;i++){const n:any[]=[];v.push(n);v=n}break;}
   case'legitimate array alias':x.selection.headerFragments[0].bboxMilliPoints=x.textArtifact.pages[0].blocks[0].lineBboxesMilliPoints[0];break;
   case'output deep detached and repeatable':{const before=structuredClone(x),first=reconstruct(x),second=reconstruct(x);assert.equal(first.status,'RECONSTRUCTED');if(first.status!=='RECONSTRUCTED')throw Error('Unexpected abstention');first.inventory.featureRows[0].fragments[0].bboxMilliPoints[0]=1;first.inventory.headerFragments[0].rawText='MUTATED';first.inventory.regionBoxMilliPoints[0]=1;assert.deepEqual(x,before);assert.deepEqual(second,golden.expected);assert.deepEqual(reconstruct(x),golden.expected);assert.equal(traps,0);return;}
   default:throw Error('Unknown frozen native case');
  }
  assert.deepEqual(reconstruct(input),reason==='RECONSTRUCTED'?golden.expected:{schemaVersion:'matrix-odi120-rail-inventory-source-result-v1',status:'ABSTAIN',reasonCode:reason});assert.equal(traps,0);
 });
});
