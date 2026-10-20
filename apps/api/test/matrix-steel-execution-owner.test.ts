/** Finite owner boundaries fixed before typed steel implementation; QA owns whole outputs. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {deriveSteelComparisonIdentities,validateSteelComparisonLoaderPackage,buildSteelComparisons,validateSteelComparisons,steelComparisonEvidence,mergeSteelComparisonCoverage} from '../src/matrix-steel-execution.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-steel-execution-v1/qa-manual-whole-expectations.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('4a5dfdb7fb40eb95f619d88eace539e46224cdc3caea90fab0ef2e348d123a94');
const manual=JSON.parse(bytes.toString()),positive=()=>structuredClone(manual.validCases[0]);
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const rehash=(e:any)=>{for(const r of e.results){const{id,...body}=r;r.id=createHash('sha256').update(canonical({hashDomain:'matrix-steel-execution-result-id-v1',objectId:e.objectId,inputManifestHash:e.inputManifestHash,capabilityRegistryHash:e.capabilityRegistryHash,result:body})).digest('hex');}return e;};
describe('steel typed execution owner boundaries',()=>{
 it('sorts Unicode identities by codepoint and keeps claims from unknown source eligibility',()=>{
  const p=positive().package;const values=['\u{10000}','\ue000'];for(const[i,s]of p.sources.entries()){s.stages=['UNRESOLVED'];s.review.approvalStatus='UNKNOWN';const c=s.review.steelComparisonScope.claims[0];c.identity.entityKey=values[i];c.memberMapping.identity=structuredClone(c.identity);}
  const before=structuredClone(p.sources),ids=deriveSteelComparisonIdentities(p.sources);expect(ids.map(i=>i.entityKey)).toEqual(['\ue000','\u{10000}']);expect(p.sources).toEqual(before);ids[0].memberKey='changed';expect(p.sources).toEqual(before);
 });
 it('validates whole sources and local snapshot associations before deriving any identity',()=>{
  for(const change of [(p:any)=>{p.sources[1].objectId='OTHER';},(p:any)=>{p.sources[0].sourceSha256='f'.repeat(64);},(p:any)=>{p.sources[0].review.steelComparisonScope.claims[0].declarationSnapshot.value='С245';},(p:any)=>{p.sources.push(structuredClone(p.sources[0]));}]){const p=positive().package;change(p);expect(()=>deriveSteelComparisonIdentities(p.sources)).toThrow();}
 });
 it('admits a genuinely empty unbound package and rejects a retained pair despite zero identities',()=>{
  const p=positive().package;p.sources=[];p.origins=[];p.applicabilityDecisions=[];p.identities=[];const e=buildSteelComparisons(p);expect(e.results).toHaveLength(1);expect(e.results[0].kind).toBe('UNBOUND_ATOM_ABSTENTION');expect(steelComparisonEvidence(p,e)).toEqual([]);
  const corrupt=positive().package;for(const s of corrupt.sources)s.review.steelComparisonScope.claims=[];corrupt.identities=[];expect(()=>validateSteelComparisonLoaderPackage(corrupt)).toThrow();
 });
 it('rejects candidate semantic forgery even after a complete row-ID rehash',()=>{
  for(const change of [(r:any)=>{r.comparison.identity.memberKey='OTHER';},(r:any)=>{r.comparison.calibratedProbability=.9;},(r:any)=>{r.comparison.comparison.actual.sourceSha256=r.comparison.comparison.expected.sourceSha256;},(r:any)=>{r.comparison.comparison.scope='NORMATIVE_EQUIVALENT';}]){const e=positive().expected.envelope;change(e.results[0]);expect(()=>validateSteelComparisons(rehash(e))).toThrow();}
 });
 it('rejects mixed, duplicate and unordered result kinds and identities',()=>{
  const c=positive();const duplicate=structuredClone(c.expected.envelope);duplicate.results.push(structuredClone(duplicate.results[0]));expect(()=>validateSteelComparisons(duplicate)).toThrow();
  const p=structuredClone(c.package);p.sources=[];p.origins=[];p.applicabilityDecisions=[];p.identities=[];const u=buildSteelComparisons(p);u.results.push(c.expected.envelope.results[0]);expect(()=>validateSteelComparisons(u)).toThrow();
 });
 it('preserves unrelated historical coverage even when counters have no relational ordering',()=>{
  const c=positive(),row=c.baseCoverage.find((r:any)=>r.parameterCode!=='KR-056');row.implementedAtomicRules=0;row.enabledAtomicRules=0;row.evaluatedAtomicRules=9;row.successfulComparisons=17;row.abstentions=3;row.failures=4;row.executionStatus='TECHNICAL_FAILURE';const before=structuredClone(c.baseCoverage),merged=mergeSteelComparisonCoverage(c.baseCoverage,c.expected.envelope);expect(merged.find(r=>r.parameterCode===row.parameterCode)).toEqual(row);expect(c.baseCoverage).toEqual(before);
 });
 it('distinguishes whole encoded UTF8 admission from later DTO rejection at exact8M',()=>{
  const p={padding:['\n'.repeat(1000000),'\n'.repeat(1000000),'\n'.repeat(1000000),'']};p.padding[3]='x'.repeat(8000000-Buffer.byteLength(JSON.stringify(p)));expect(Buffer.byteLength(JSON.stringify(p))).toBe(8000000);expect(()=>validateSteelComparisonLoaderPackage(p)).toThrow(/loader DTO/);p.padding[3]+='x';expect(()=>validateSteelComparisonLoaderPackage(p)).toThrow(/native LIMIT/);
 });
 it('preserves evidence roles and full original targets while detaching duplicate-role fragments',()=>{
  const c=positive(),before=structuredClone(c);const evidence=steelComparisonEvidence(c.package,c.expected.envelope);expect(evidence).toHaveLength(13);expect(evidence.map(e=>e.fragmentRole)).toEqual(['PRIMARY','DECLARATION_SCOPE','DECLARATION_SCOPE','DECLARATION_SCOPE','PHYSICAL_MEMBER_SCOPE','APPLICABILITY_BASIS','PRIMARY','PRIMARY','DECLARATION_SCOPE','DECLARATION_SCOPE','DECLARATION_SCOPE','PHYSICAL_MEMBER_SCOPE','APPLICABILITY_BASIS']);const a=evidence.find(e=>e.fragmentRole==='PRIMARY')!,b=evidence.find(e=>e.fragmentRole==='APPLICABILITY_BASIS')!;expect(a.fragment).toEqual(b.fragment);a.fragment.rawText='changed';expect(b.fragment.rawText).not.toBe('changed');expect(c).toEqual(before);
 });
});
