import fs from 'node:fs';
import {it} from 'vitest';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildRailInventoryComparisons,validateRailInventoryComparisons,validateRailInventoryLoaderPackage,deriveRailInventoryIdentities,mergeRailInventoryCoverage,railInventoryComparisonEvidence} from '../src/matrix-rail-inventory-execution.js';
const dir=fileURLToPath(new URL('../../../fixtures/matrix-rail-execution-v1/',import.meta.url));
const read=(n:string)=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const manual=read('ts-rail-execution-wire-manual-goldens.json'),probes=read('ts-rail-execution-adversarial-probes.json'),nativePlan=read('ts-rail-execution-native-plan.json'),evidence=read('ts-rail-execution-manual-evidence-golden.json');
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const base=manual.validCases[0].package;
const claim=(x:any)=>x.sources[1].review.railInventoryScope.claims[0];
let assertions=0,traps=0;
function eq(a:unknown,b:unknown){assertions++;assert.deepEqual(a,b);}
function throws(run:()=>unknown){assertions++;assert.throws(run);}
function check(name:string,group:string,run:()=>void){it(`${group}: ${name}`,run);}
for(const f of manual.validCases)check(f.name,'manual-whole',()=>{const input=clone(f.package),before=JSON.stringify(input),actual=buildRailInventoryComparisons(input);eq(actual,f.expectedEnvelope);eq(validateRailInventoryComparisons(actual),f.expectedEnvelope);eq(mergeRailInventoryCoverage(manual.baseV6EffectiveCoverage,actual),f.expectedCoverage);eq(JSON.stringify(input),before);eq(deriveRailInventoryIdentities(input.sources),input.identities);});
for(const f of manual.integrityErrors)check(f.name,'manual-integrity',()=>{const input=clone(f.package),before=JSON.stringify(input);throws(()=>buildRailInventoryComparisons(input));eq(JSON.stringify(input),before);});
for(const f of probes.probes)check(f.name,'portable',()=>{const before=JSON.stringify(f);const invoke=()=>{switch(f.operation){case 'build':return buildRailInventoryComparisons(f.package);case 'evidence':return railInventoryComparisonEvidence(f.package??base,f.envelope??manual.validCases[0].expectedEnvelope);case 'validate':return validateRailInventoryComparisons(f.envelope);case 'merge':return mergeRailInventoryCoverage(f.coverage,manual.validCases[0].expectedEnvelope);case 'registry':return buildRailInventoryComparisons(base,f.registry);default:throw Error('unknown probe operation');}};if(f.expected==='THROW_INTEGRITY')throws(invoke);else eq(invoke(),f.envelope);eq(JSON.stringify(f),before);});
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
for(const f of nativePlan.nativeCases)check(f.name,'native',()=>{assertions++;assert.ok(builders[f.name]);throws(()=>buildRailInventoryComparisons(builders[f.name]()));if(f.traps!==undefined)eq(traps,f.traps);});
check('all12 original evidence fragments exact','evidence',()=>{eq(railInventoryComparisonEvidence(base,manual.validCases[0].expectedEnvelope),evidence.expectedEvidence);eq(evidence.expectedEvidence.length,12);});
check('all output graphs detached from inputs and prior outputs','alias',()=>{const input=clone(base),before=JSON.stringify(input);const a=buildRailInventoryComparisons(input),b=buildRailInventoryComparisons(input);if(a.results[0].kind!=='SCOPED_COMPARISON'||a.results[0].comparison.status!=='CANDIDATE')throw Error('expected candidate');a.results[0].identity.roomKey='MUTATED';a.results[0].comparison.expected.sourceFileId='MUTATED';eq(b,manual.validCases[0].expectedEnvelope);eq(JSON.stringify(input),before);const loaded=validateRailInventoryLoaderPackage(input);loaded.origins[0].textArtifact.pages[0].widthMilliPoints=1;eq(JSON.stringify(input),before);const e=railInventoryComparisonEvidence(input,b);e[0].fragment.bboxMilliPoints[0]=999;eq(railInventoryComparisonEvidence(input,b),evidence.expectedEvidence);const c=mergeRailInventoryCoverage(manual.baseV6EffectiveCoverage,b);c[0].reason='MUTATED';eq(mergeRailInventoryCoverage(manual.baseV6EffectiveCoverage,b),manual.validCases[0].expectedCoverage);});
check('harmless input graph alias accepted without source mutation','alias',()=>{const input=clone(base);input.sources[1].review.railInventoryScope.claims[0].identity=input.sources[0].review.railInventoryScope.claims[0].identity;input.identities[0]=input.sources[0].review.railInventoryScope.claims[0].identity;eq(buildRailInventoryComparisons(input),manual.validCases[0].expectedEnvelope);});
check('committed source and origin iteration order do not alter result IDs','determinism',()=>{const x=clone(base);x.sources.reverse();x.origins.reverse();eq(buildRailInventoryComparisons(x),manual.validCases[0].expectedEnvelope);});
check('merged coverage preserves other131literal rows and input bytes','coverage',()=>{const input=clone(manual.baseV6EffectiveCoverage),before=JSON.stringify(input),merged=mergeRailInventoryCoverage(input,manual.validCases[0].expectedEnvelope);eq(JSON.stringify(input),before);eq(merged.filter((r:any)=>r.parameterCode!=='ODI-120'),input.filter((r:any)=>r.parameterCode!=='ODI-120'));});

const schemaSupplement=read('ts-rail-execution-schema-amendment-expectations.json');
for(const f of schemaSupplement.probes)check(f.name,'schema-and-Unicode',()=>{if(f.operation==='build'){eq(buildRailInventoryComparisons(f.package),f.expectedEnvelope);eq(validateRailInventoryComparisons(f.expectedEnvelope),f.expectedEnvelope);eq(deriveRailInventoryIdentities(f.package.sources),f.package.identities);}else if(f.operation==='merge')eq(mergeRailInventoryCoverage(f.coverage,f.envelope),f.expectedCoverage);else throws(()=>mergeRailInventoryCoverage(f.coverage,f.envelope));});
for(const filename of ['researchpy-rail-execution-independent-probes.json','researchpy-rail-execution-cross-added-manual-probes.json','ts-rail-execution-boundary-clarification-probes.json','researchpy-rail-execution-cross-clarified-manual-probes.json'])for(const f of read(filename).fixtures)check(f.name,filename,()=>{const before=JSON.stringify(f.input);const run=()=>{switch(f.operation){case 'build':return f.registry===undefined?buildRailInventoryComparisons(f.input):buildRailInventoryComparisons(f.input,f.registry);case 'derive':return deriveRailInventoryIdentities(f.input);case 'validateEnvelope':return validateRailInventoryComparisons(f.input);case 'merge':return mergeRailInventoryCoverage(f.input.baseCoverage,f.input.envelope,f.registry);default:throw Error('Unknown peer operation');}};if(f.throws)throws(run);else eq(run(),f.expected);eq(JSON.stringify(f.input),before);});
