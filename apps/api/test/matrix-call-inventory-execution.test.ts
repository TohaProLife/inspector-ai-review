/** First independent TS wrapper baseline. Manual whole-output oracle frozen before code. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {canonicalSourceDeclarationJson as canonical} from '../src/matrix-source-declarations.js';
import {buildCallInventoryComparisons,validateCallInventoryLoaderPackage,validateCallInventoryComparisonsEnvelope,
 mergeCallInventoryCoverage,deriveCallInventoryIdentities,CALL_INVENTORY_CAPABILITY_REGISTRY,
 callInventoryCapabilityRegistryHash} from '../src/matrix-call-inventory-execution.js';
const oracle=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-call-execution-v1/root-call-execution-goldens.json',import.meta.url),'utf8'));
const clone=<T>(v:T):T=>structuredClone(v);
const pkg=()=>clone(oracle.cases[0].package);
const envelope=()=>clone(oracle.cases[0].expectedEnvelope);
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
function rehash(e:any){for(const row of e.results){const {id,...body}=row;row.id=hash({hashDomain:'matrix-call-inventory-execution-result-id-v1',objectId:e.objectId,inputManifestHash:e.inputManifestHash,capabilityRegistryHash:e.capabilityRegistryHash,result:body});}return e;}
describe('manual independent whole typed outputs',()=>{
 it('approved registry bytes and hash',()=>{expect(CALL_INVENTORY_CAPABILITY_REGISTRY).toEqual(oracle.capabilityRegistry);expect(callInventoryCapabilityRegistryHash).toBe(oracle.capabilityRegistryHash);});
 for(const c of oracle.cases)it(c.name,()=>{
  const before=clone(c.package);expect(validateCallInventoryLoaderPackage(c.package)).toEqual(c.package);
  expect(deriveCallInventoryIdentities(c.package.sources)).toEqual(c.package.identities);
  const result=buildCallInventoryComparisons(c.package);expect(result).toEqual(c.expectedEnvelope);
  expect(validateCallInventoryComparisonsEnvelope(result)).toEqual(result);
  expect(mergeCallInventoryCoverage(oracle.baseCoverage,result)).toEqual(c.expectedCoverage);
  expect(mergeCallInventoryCoverage(oracle.baseCoverage,result).filter(r=>r.parameterCode!=='ODI-123')).toEqual(oracle.baseCoverage.filter((r:any)=>r.parameterCode!=='ODI-123'));
  const permuted=clone(c.package);permuted.sources.reverse();permuted.origins.reverse();expect(buildCallInventoryComparisons(permuted)).toEqual(c.expectedEnvelope);expect(c.package).toEqual(before);
 });
 for(const c of oracle.integrityErrors)it('reject '+c.name,()=>expect(()=>buildCallInventoryComparisons(c.package)).toThrow());
});
const packageCases:{name:string;change:(x:any)=>void}[]=[
 {name:'unknown package field',change:x=>x.extra=true},
 {name:'duplicate source',change:x=>x.sources.push(clone(x.sources[0]))},
 {name:'duplicate origin',change:x=>x.origins.push(clone(x.origins[0]))},
 {name:'hidden identities',change:x=>x.identities=[]},
 {name:'extra identity',change:x=>x.identities.push({...x.identities[0],entityKey:'another'})},
 {name:'wrong review object',change:x=>x.sources[0].review.objectId='foreign'},
 {name:'wrong frozen review hash',change:x=>x.sources[0].reviewSnapshot.contentHash='0'.repeat(64)},
 {name:'unused origin corruption retained',change:x=>{for(const s of x.sources)s.review.callInventoryScope.claims=[];x.identities=[];x.origins[0].textArtifactHash='0'.repeat(64);}},
 {name:'UNKNOWN claim corruption retained',change:x=>{const c=x.sources[0].review.callInventoryScope.claims[0];c.assertion='UNKNOWN';c.inventorySnapshot.featureRows[0].fragments[0].rawText='forged';}},
 {name:'foreign artifact',change:x=>x.origins[0].textArtifact.sourceFileId='foreign'},
 {name:'unbound still validates all origins',change:x=>{for(const s of x.sources){s.review=null;s.reviewSnapshot=null;}x.identities=[];x.origins[0].objectId='foreign';}},
 {name:'inventory missing end locator',change:x=>delete x.sources[0].review.callInventoryScope.claims[0].selection.endFragments},
];
for(const c of packageCases)it('package integrity '+c.name,()=>{const x=pkg();c.change(x);expect(()=>validateCallInventoryLoaderPackage(x)).toThrow();});
for(const name of ['extra envelope key','stale ID','wrong hash','rehashed wrong candidate identity','rehashed same source','rehashed invalid reason','duplicate scoped identity','mixed unbound','wrong purpose'])it('typed output '+name,()=>{
 const e=envelope();switch(name){case'extra envelope key':e.extra=true;break;case'stale ID':e.results[0].id='0'.repeat(64);break;case'wrong hash':e.capabilityRegistryHash='0'.repeat(64);rehash(e);break;
 case'rehashed wrong candidate identity':e.results[0].comparison.identity.roomKey='another';rehash(e);break;
 case'rehashed same source':e.results[0].comparison.actual.sourceFileId=e.results[0].comparison.expected.sourceFileId;rehash(e);break;
 case'rehashed invalid reason':e.results[0].comparison={schemaVersion:'matrix-odi123-call-inventory-comparison-v1',status:'ABSTAIN',reasonCode:'INVALID_INPUT',calibratedProbability:null};rehash(e);break;
 case'duplicate scoped identity':e.results.push(clone(e.results[0]));break;
 case'mixed unbound':e.results.push(clone(oracle.cases.find((c:any)=>c.package.identities.length===0).expectedEnvelope.results[0]));rehash(e);break;
 case'wrong purpose':e.purpose='FINDING';break;}
 expect(()=>validateCallInventoryComparisonsEnvelope(e)).toThrow();
});
for(const name of ['short','reordered','duplicate','fraction','bool','unsafe','overlap','nonzero unsupported','unknown status','unknown row key'])it('coverage boundary '+name,()=>{
 const rows=clone(oracle.baseCoverage);const row=rows.find((r:any)=>r.parameterCode==='ODI-123');switch(name){case'short':rows.pop();break;case'reordered':rows.reverse();break;case'duplicate':rows[1]=clone(rows[0]);break;
 case'fraction':rows[0].failures=0.5;break;case'bool':rows[0].failures=true;break;case'unsafe':rows[0].failures=Number.MAX_SAFE_INTEGER+1;break;case'overlap':row.executionStatus='PARTIAL';row.implementedAtomicRules=1;break;
 case'nonzero unsupported':row.abstentions=1;break;case'unknown status':rows[0].executionStatus='OTHER';break;case'unknown row key':rows[0].hidden=true;break;}
 expect(()=>mergeCallInventoryCoverage(rows,envelope())).toThrow();
});
for(const name of ['root proxy','nested proxy','getter','index getter','hole','array property','symbol','nonenumerable','prototype','cycle','bigint','fraction','unsafe','surrogate','depth','nodes','container','key bytes','string points'])it('native zero traps '+name,()=>{
 let x:any=pkg(),traps=0;const touched=()=>{traps++;throw Error('user code');};switch(name){case'root proxy':x=new Proxy(x,{ownKeys:touched,get:touched,getPrototypeOf:touched});break;
 case'nested proxy':x.origins[0].textArtifact=new Proxy(x.origins[0].textArtifact,{ownKeys:touched,get:touched,getPrototypeOf:touched});break;
 case'getter':Object.defineProperty(x,'sources',{enumerable:true,get:touched});break;case'index getter':Object.defineProperty(x.sources,'0',{enumerable:true,get:touched});break;
 case'hole':delete x.sources[0];break;case'array property':x.sources.extra=true;break;case'symbol':x[Symbol('x')]=true;break;case'nonenumerable':Object.defineProperty(x,'extra',{value:true});break;
 case'prototype':Object.setPrototypeOf(x,{});break;case'cycle':x.extra=x;break;case'bigint':x.extra=1n;break;case'fraction':x.extra=0.5;break;case'unsafe':x.extra=Number.MAX_SAFE_INTEGER+1;break;case'surrogate':x.extra='\ud800';break;
 case'depth':{let p=x;for(let i=0;i<66;i++){p.extra={};p=p.extra;}break;}case'nodes':x.extra=Array.from({length:20000},()=>({a:null,b:null,c:null,d:null,e:null,f:null}));break;
 case'container':x.extra=Array(32769).fill(null);break;case'key bytes':x.extra=Object.fromEntries(Array.from({length:31000},(_,i)=>['界'.repeat(90)+i,null]));break;case'string points':x.extra='x'.repeat(2000001);break;}
 expect(()=>validateCallInventoryLoaderPackage(x)).toThrow();expect(traps).toBe(0);
});
it('detached loader result',()=>{const x=pkg(),before=clone(x),out=validateCallInventoryLoaderPackage(x);out.sources[0]!.review!.actorId='changed';out.origins[0]!.textArtifact.sourceFileId='changed';expect(x).toEqual(before);});
it('detached envelope result and coverage',()=>{const x=envelope(),before=clone(x),rows=clone(oracle.baseCoverage),old=clone(rows);const out=validateCallInventoryComparisonsEnvelope(x);out.results[0]!.id='changed';const merged=mergeCallInventoryCoverage(rows,x);merged[0]!.reason='changed';expect(x).toEqual(before);expect(rows).toEqual(old);});
it('registry cannot enable unsupported version',()=>{const r=clone(oracle.capabilityRegistry);r.entries[0].ruleVersion='2';expect(()=>buildCallInventoryComparisons(pkg(),r)).toThrow();});
