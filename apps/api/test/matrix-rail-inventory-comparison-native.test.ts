/** Own-runtime hostile/native/request/alias checks; frozen plan independent of implementation. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {it} from 'vitest';
import {compareOdi120RailInventories,projectRailInventoryScopeDecision,validateRailInventoryScopeRequest} from '../src/matrix-rail-inventory-comparison.js';
const fixture=new URL('../../../fixtures/matrix-rail-comparison-v1/',import.meta.url);
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL(name,fixture),'utf8'));
const manual=read('ts-rail-comparison-manual-goldens.json'),nativePlan=read('ts-native-expectations.json');
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const base=manual.fixtures[0].input;
const claim=(x:any)=>x.sources[1].review.railInventoryScope.claims[0];
let traps=0;
function eq(actual:unknown,expected:unknown){assert.deepEqual(actual,expected);}
function check(name:string,group:string,run:()=>void){it(group+': '+name,run);}
const invalid=(reason:string)=>({schemaVersion:'matrix-odi120-rail-inventory-comparison-v1',status:'ABSTAIN',reasonCode:reason,calibratedProbability:null});
function proxy(){return new Proxy({},Object.fromEntries(['get','ownKeys','getPrototypeOf','getOwnPropertyDescriptor','has','set','defineProperty'].map(k=>[k,()=>{traps++;throw Error('TRAP MUST NOT RUN');}])));}
const builders:Record<string,()=>unknown>={
 'root getter':()=>{const x=clone(base);Object.defineProperty(x,'objectId',{enumerable:true,get(){traps++;throw Error('GETTER MUST NOT RUN');}});return x;},
 'nested snapshot getter':()=>{const x=clone(base);Object.defineProperty(claim(x).inventorySnapshot,'sourceFileId',{enumerable:true,get(){traps++;throw Error('GETTER MUST NOT RUN');}});return x;},
 'root proxy':()=>proxy(),
 'nested source proxy':()=>{const x=clone(base);x.sources[1]=proxy();return x;},
 'revoked proxy':()=>{const {proxy,revoke}=Proxy.revocable({},{});revoke();return proxy;},
 'cycle':()=>{const x=clone(base);x.cycle=x;return x;},
 'sparse source array':()=>{const x=clone(base);delete x.sources[1];return x;},
 'array extra property':()=>{const x=clone(base);x.sources.extra=1;return x;},
 'hidden own field':()=>{const x=clone(base);Object.defineProperty(x,'hidden',{value:1,enumerable:false});return x;},
 'symbol key':()=>{const x=clone(base);x[Symbol('hidden')]=1;return x;},
 'null prototype object':()=>Object.assign(Object.create(null),clone(base)),
 'Date object':()=>{const x=clone(base);x.untrusted=new Date(0);return x;},
 'lone surrogate value':()=>{const x=clone(base);x.untrusted='\ud800';return x;},
 'lone surrogate key':()=>{const x=clone(base);x['\ud800']=1;return x;},
 'NaN':()=>{const x=clone(base);x.untrusted=NaN;return x;},
 'bigint':()=>{const x=clone(base);x.untrusted=1n;return x;},
 'unsafe integer':()=>{const x=clone(base);x.untrusted=9007199254740992;return x;},
 'fractional numeric':()=>{const x=clone(base);x.untrusted=0.5;return x;},
 'native depth65':()=>{let v:any=null;for(let i=0;i<65;i++)v={next:v};return v;},
 'native container32769':()=>Array(32769).fill(null),
 'native nodes200001':()=>({payload:Array.from({length:7},()=>Array(30000).fill(null))}),
 'UTF8 key bytes8000001':()=>Object.fromEntries(Array.from({length:5},(_,i)=>['Ж'.repeat(900000)+i,null])),
 'string codepoints2000001':()=>({untrusted:'x'.repeat(2000001)}),
 'sources65':()=>{const x=clone(base);x.sources=Array.from({length:65},()=>clone(base.sources[0]));return x;},
 'origins129':()=>{const x=clone(base);x.origins=Array.from({length:129},()=>clone(base.origins[0]));return x;},
 'claims17':()=>{const x=clone(base);x.sources[1].review.railInventoryScope.claims=Array.from({length:17},()=>clone(claim(base)));return x;},
 'totalclaims129':()=>{const x=clone(base);x.sources=Array.from({length:9},(_,i)=>{const s=clone(base.sources[1]);s.review.railInventoryScope.claims=Array.from({length:i===8?1:16},()=>clone(claim(base)));return s;});return x;}
};
for(const f of nativePlan.cases){check(f.name,'native',()=>{assert.ok(builders[f.name],'native case builder is required');eq(compareOdi120RailInventories(builders[f.name]()),invalid(f.expected));if(f.traps!==undefined)eq(traps,f.traps);});}
for(const f of manual.requestVectors){check(f.name,'request-policy',()=>{if(f.kind==='REQUEST_SERVER_FIELD_REJECTION')eq(validateRailInventoryScopeRequest(f.request),null);else{const input=clone(f.decision),before=JSON.stringify(input),projected=projectRailInventoryScopeDecision(input);eq(projected,f.expectedRequest);eq(JSON.stringify(input),before);eq(validateRailInventoryScopeRequest(projected),f.expectedRequest);assert.ok(projected);projected!.claims[0].target.checkId='MUTATED OUTPUT ONLY';projected!.claims[0].selection.headerFragments[0].bboxMilliPoints[0]=123;eq(JSON.stringify(input),before);eq(projected!.claims[0].assertion,'UNKNOWN');eq(projected!.claims[0].roomMapping.assertion,'UNKNOWN');}});}
check('candidate output nested identity and refs do not alias input','immutability',()=>{const input=clone(base),before=JSON.stringify(input),a=compareOdi120RailInventories(input);assert.equal(a.status,'CANDIDATE');if(a.status!=='CANDIDATE')throw Error('candidate required');a.identity.roomKey='MUTATED RESULT';a.expected.sourceFileId='MUTATED RESULT';a.missingFeatureKeys.reverse();eq(JSON.stringify(input),before);eq(compareOdi120RailInventories(input),manual.fixtures[0].expected);});
check('pure supplied metadata success does not claim genuine DB authority','trust-boundary',()=>{const x=clone(base);x.inputManifestHash='7'.repeat(64);eq(compareOdi120RailInventories(x),manual.fixtures[0].expected);});
