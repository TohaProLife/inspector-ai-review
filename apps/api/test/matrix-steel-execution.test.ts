/** Independent fixed whole-output oracle authored before typed steel execution. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {deriveSteelComparisonIdentities,validateSteelComparisonLoaderPackage,buildSteelComparisons,validateSteelComparisons,steelComparisonEvidence,mergeSteelComparisonCoverage,steelComparisonCapabilityRegistry,steelComparisonCapabilityRegistryHash} from '../src/matrix-steel-execution.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-steel-execution-v1/qa-manual-whole-expectations.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('4a5dfdb7fb40eb95f619d88eace539e46224cdc3caea90fab0ef2e348d123a94');
const M=JSON.parse(bytes.toString('utf8')),valid=M.validCases,invalid=M.integrityErrors;
const positive=()=>structuredClone(valid.find((c:any)=>c.name==='authored-original-directed-positive'));
const callError=(c:any)=>{switch(c.operation){case'build':return buildSteelComparisons(c.package,c.registry);case'validate':return validateSteelComparisons(c.envelope);case'evidence':return steelComparisonEvidence(c.package,c.envelope);case'merge':return mergeSteelComparisonCoverage(c.coverage,c.envelope);default:throw Error('unknown manual operation');}};
describe('independent pure typed steel execution',()=>{
 it('matches nine full packages, identities, envelopes, thirteen native fragments and all132 coverage rows',()=>{
  expect(valid).toHaveLength(9);
  for(const c of valid){const x=structuredClone(c),before=structuredClone(x);
   expect(deriveSteelComparisonIdentities(x.package.sources),c.name).toEqual(c.expected.identities);
   expect(validateSteelComparisonLoaderPackage(x.package),c.name).toEqual(c.expected.loaderPackage);
   const envelope=buildSteelComparisons(x.package);expect(envelope,c.name).toEqual(c.expected.envelope);expect(validateSteelComparisons(envelope),c.name).toEqual(c.expected.envelope);
   expect(steelComparisonEvidence(x.package,envelope),c.name).toEqual(c.expected.evidence);expect(mergeSteelComparisonCoverage(x.baseCoverage,envelope),c.name).toEqual(c.expected.coverage);expect(x,c.name).toEqual(before);
  }
  const c=positive();expect(c.expected.evidence).toHaveLength(13);expect(c.expected.envelope.results[0].comparison.calibratedProbability).toBeNull();
 },30000);
 it('throws for all twelve independently fixed integrity faults including masked stage forgery',()=>{expect(invalid).toHaveLength(12);for(const c of invalid){const x=structuredClone(c),before=structuredClone(x);expect(()=>callError(x),c.name).toThrow();expect(x,c.name).toEqual(before);}},30000);
 it('derives exact canonical identity order independent of supplied source/origin order and never caller filters',()=>{for(const c of valid){const x=structuredClone(c.package);x.sources.reverse();x.origins.reverse();x.applicabilityDecisions.reverse();expect(deriveSteelComparisonIdentities(x.sources),c.name).toEqual(c.expected.identities);expect(buildSteelComparisons(x),c.name).toEqual(c.expected.envelope);}const c=positive();c.package.identities=[];expect(()=>validateSteelComparisonLoaderPackage(c.package)).toThrow();},30000);
 it('returns deeply detached data through all six public functions',()=>{
  const c=positive(),before=structuredClone(c);const ids:any=deriveSteelComparisonIdentities(c.package.sources);ids[0].memberKey='changed';expect(c).toEqual(before);
  const pkg:any=validateSteelComparisonLoaderPackage(c.package);pkg.sources[0].review.steelComparisonScope.claims[0].declarationSnapshot.primaryFragments[0].rawText='changed';expect(c).toEqual(before);
  const env:any=buildSteelComparisons(c.package);env.results[0].comparison.comparison.expected.productScope.gradeStandard='changed';expect(c).toEqual(before);
  const checked:any=validateSteelComparisons(c.expected.envelope);checked.results[0].identity.memberKey='changed';expect(c).toEqual(before);
  const evidence:any=steelComparisonEvidence(c.package,c.expected.envelope);evidence[0].fragment.bboxMilliPoints[0]=1;evidence[0].target.checkId='changed';expect(c).toEqual(before);
  const coverage:any=mergeSteelComparisonCoverage(c.baseCoverage,c.expected.envelope);coverage[0].reason='changed';expect(c).toEqual(before);expect(buildSteelComparisons(c.package)).toEqual(c.expected.envelope);
 },30000);
 it('rejects hostile native trees without any getter or proxy effect',()=>{
  let calls=0;const accessor={};Object.defineProperty(accessor,'x',{enumerable:true,get(){calls++;throw Error('get')}});const proxy=new Proxy({}, {get(){calls++;throw Error('get')},ownKeys(){calls++;throw Error('keys')},getPrototypeOf(){calls++;throw Error('proto')}});const cycle:any={};cycle.self=cycle;
  const funcs=[(x:any)=>deriveSteelComparisonIdentities(x),(x:any)=>validateSteelComparisonLoaderPackage(x),(x:any)=>buildSteelComparisons(x),(x:any)=>validateSteelComparisons(x),(x:any)=>steelComparisonEvidence(x,positive().expected.envelope),(x:any)=>mergeSteelComparisonCoverage(x,positive().expected.envelope)];
  for(const f of funcs)for(const x of [accessor,proxy,cycle,{n:.5},{s:'\ud800'},new Array(1),{n:9007199254740992},{s:'x'.repeat(2000001)}])expect(()=>f(x)).toThrow();expect(calls).toBe(0);
  const c=positive();c.package['лишнее']=null;expect(()=>buildSteelComparisons(c.package)).toThrow();
 },30000);
 it('keeps private registry defaults immutable and preserves all131 unrelated coverage rows',()=>{
  const c=positive();expect(steelComparisonCapabilityRegistryHash).toBe(M.capabilityRegistryHash);expect(steelComparisonCapabilityRegistry).toEqual(M.capabilityRegistry);
  const exposed:any=steelComparisonCapabilityRegistry,previous=exposed.entries[0].enabled;try{try{exposed.entries[0].enabled=false;}catch{}expect(buildSteelComparisons(c.package)).toEqual(c.expected.envelope);}finally{try{exposed.entries[0].enabled=previous;}catch{}}
  const bad=structuredClone(M.capabilityRegistry);bad.entries[0].ruleVersion='changed';expect(()=>buildSteelComparisons(c.package,bad)).toThrow();const result=mergeSteelComparisonCoverage(c.baseCoverage,c.expected.envelope);expect(result.filter((v:any)=>v.parameterCode!=='KR-056')).toEqual(c.baseCoverage.filter((v:any)=>v.parameterCode!=='KR-056'));expect(result.find((v:any)=>v.parameterCode==='KR-056')).toEqual(c.expected.coverage.find((v:any)=>v.parameterCode==='KR-056'));
  const unsupported=valid.find((v:any)=>v.expected.envelope.results[0].kind==='UNBOUND_ATOM_ABSTENTION');expect(unsupported).toBeDefined();expect(unsupported.expected.evidence).toEqual([]);
 },30000);
 it('rejects explicitly null registry for build/evidence/merge while omitted uses private default',()=>{
  const c=positive(),before=structuredClone(c);
  expect(()=>buildSteelComparisons(c.package,null)).toThrow();
  expect(()=>steelComparisonEvidence(c.package,c.expected.envelope,null)).toThrow();
  expect(()=>mergeSteelComparisonCoverage(c.baseCoverage,c.expected.envelope,null)).toThrow();
  expect(buildSteelComparisons(c.package)).toEqual(c.expected.envelope);expect(c).toEqual(before);
 },30000);
});
