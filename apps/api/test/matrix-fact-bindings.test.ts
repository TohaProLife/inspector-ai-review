import {describe,it,expect} from 'vitest';
import {loadMatrixGoldenFixtures} from './matrix-golden-fixtures.js';
const goldenFixtures = loadMatrixGoldenFixtures();
import {deriveMatrixFactTarget} from '../src/matrix-fact-scope.js';
import {prepareMatrixFactBindings} from '../src/matrix-fact-bindings.js';
const rule={ruleId:'matrix-kr-055-concrete_class',version:'1',parameterCode:'KR-055',attribute:'CONCRETE_CLASS',canonicalUnit:'B_CLASS'};
function fixture(){
 const golden=structuredClone(goldenFixtures.find(f=>f.name==='pd-concrete-table:previous-header')!);
 const fact=golden.execution.observations.find(f=>f.stage==='PD'&&f.contextFragments?.length)!;
 const original=golden.input.sources.find(s=>s.sourceFileId===fact.sourceFileId)!;
 const target=deriveMatrixFactTarget(fact,original.textArtifact)!;
 const binding={ruleId:rule.ruleId,ruleVersion:rule.version,parameterCode:rule.parameterCode,entityKey:'slab-1',
  reference:'Synthetic original row and underground slab checked',
  target:{...target,checkId:'CHK-ORIGIN',executionContentHash:'e'.repeat(64)},contexts:{}};
 delete (binding.target as any).fragmentsHash;
 const source={sourceFileId:original.sourceFileId,sha256:original.sha256,textArtifact:original.textArtifact!,scopeProofs:{FACT_BINDINGS:{
  schemaVersion:'matrix-fact-scopes-v1',bindings:[binding],sourceFileId:original.sourceFileId,sourceSha256:original.sha256,
  objectId:golden.input.objectId,inputManifestHash:golden.input.inputManifestHash,status:'VERIFIED',reference:'Authenticated inspector source review snapshot'}}};
 return {golden,fact,target,binding,source};
}
describe('per-fact proof resolution',()=>{
 it('binds only the selected row and preserves the raw table limitation',()=>{
  const x=fixture(),resolver=prepareMatrixFactBindings(x.source,x.golden.input,[rule])!;
  expect(resolver.entity(x.fact)).toBe('slab-1');
  const other=x.golden.execution.observations.find(f=>f.stage==='PD'&&f.id!==x.fact.id)!;
  expect(resolver.entity(other)).toBeNull();expect(resolver.proof(other,rule,rule.parameterCode,'ENTITY_SCOPE')).toBeNull();
  expect(resolver.effectiveFlags(x.fact,rule,rule.parameterCode)).toContain('TABLE_CONTEXT_UNVERIFIED');
 });
 it('uses table review only for the selected fact and cannot clear source status flags',()=>{
  const x=fixture();Object.assign(x.binding,{tableContextReview:{fragmentsHash:x.target.fragmentsHash,reference:'Synthetic header and scope checked'}});
  x.fact.sourceFlags=['SOURCE_APPROVAL_UNKNOWN','TABLE_CONTEXT_UNVERIFIED'];
  const resolver=prepareMatrixFactBindings(x.source,x.golden.input,[rule])!;
  expect(resolver.effectiveFlags(x.fact,rule,rule.parameterCode)).toEqual(['SOURCE_APPROVAL_UNKNOWN']);
  expect(x.fact.sourceFlags).toContain('TABLE_CONTEXT_UNVERIFIED');
  expect(resolver.proof(x.fact,rule,rule.parameterCode,'RULE_SCOPE_COMPLETE:'+rule.ruleId)).toBeNull();
 });
 it('does not reuse a binding after a page frame or a selected fragment changes',()=>{
  for(const change of ['frame','fragment']){
   const x=fixture();if(change==='frame')(x.source.textArtifact.pages as any[])[0].widthMilliPoints+=1;
   else x.fact.contextFragments![0].rawText+=' modified';
   expect(prepareMatrixFactBindings(x.source,x.golden.input,[rule])!.entity(x.fact)).toBeNull();
  }
 });
 it('rejects a foreign manifest and disables whole-file fallback for an empty list',()=>{
  const x=fixture();x.source.scopeProofs.FACT_BINDINGS.inputManifestHash='f'.repeat(64);
  expect(()=>prepareMatrixFactBindings(x.source,x.golden.input,[rule])).toThrow('provenance');
  x.source.scopeProofs.FACT_BINDINGS.inputManifestHash=x.golden.input.inputManifestHash;
  x.source.scopeProofs.FACT_BINDINGS.bindings=[];
  expect(prepareMatrixFactBindings(x.source,x.golden.input,[rule])!.entity(x.fact)).toBeNull();
 });
});
