import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import * as policy from '../src/matrix-column-pylon-section-profile-v12.js';
import capsule from '../src/matrix-policy-history-v2.json' with {type:'json'};
const root=resolve(import.meta.dirname,'../../..');
const template=JSON.parse(readFileSync(resolve(root,'fixtures/portable-historical-tests-v1/root-v12-policy-template.json'),'utf8'));
const scalarPolicyExtension=JSON.parse(readFileSync(resolve(root,'fixtures/matrix-column-pylon-section-execution-v1/scalar-prepared-v12-policy-extension.json'),'utf8'));
function materialize(value:any):any {
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  if(Object.keys(value).join()==='$SOURCE_SHA256')return sha256(readFileSync(resolve(root,value.$SOURCE_SHA256)));
  if(Object.keys(value).join()==='$JSON_FILE')return JSON.parse(readFileSync(resolve(root,value.$JSON_FILE),'utf8'));
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,materialize(v)]));
 }
 return Array.isArray(value)?value.map(materialize):value;
}
describe('own v12 immutable runtime policy',()=>{
 it('full new definitions equal pre-wrapper manual template over exact accepted v11',()=>{
  const old=capsule.entries.find(x=>x.profileId===template.baseProfileId)!;
  const expected={...old.definitions,columnPylonSectionExecution:materialize({...template.columnPylonSectionExecution,...scalarPolicyExtension})};
  expect(policy.matrixColumnPylonSectionV12Definitions).toEqual(expected);
  expect(sha256(canonicalJson(old.definitions))).toBe(template.baseConfigHash);
  expect(policy.matrixColumnPylonSectionV12ConfigHash).toBe(sha256(canonicalJson(expected)));
  expect(policy.matrixFullPolicyForProfile(template.profileId)).toMatchObject({profileId:template.profileId,adapterVersion:'12',definitions:expected,columnPylonSectionComparisons:true,steelComparisons:true});
 });
 it('all three exact historical definitions retained only for reads',()=>{
  for(const old of capsule.entries){
   const actual=policy.matrixFullPolicyForProfile(old.profileId)!;
   expect(actual.definitions).toEqual(old.definitions);expect(actual.configHash).toBe(old.configHash);
   expect(actual.columnPylonSectionComparisons).toBe(false);
   expect(policy.isCurrentMatrixExecutionInstalled(old.profileId)).toBe(false);
  }
  expect(policy.isCurrentMatrixExecutionInstalled(template.profileId)).toBe(true);
  expect(policy.matrixFullPolicyForProfile('unknown')).toBeNull();
 });
 it('new flag selects explicit v12, no accidental new fields in archived policies',()=>{
  const flags={columnPylonSectionV12:true,steelV11:true,rail:true,call:true,inventory:true};
  expect(policy.selectMatrixRuntimePolicy(flags)).toEqual({profileId:template.profileId,adapterVersion:'12',definitions:policy.matrixColumnPylonSectionV12Definitions,configHash:policy.matrixColumnPylonSectionV12ConfigHash});
  expect(policy.isSteelComparisonProfile(template.profileId)).toBe(true);
  expect(policy.isColumnPylonSectionProfile(template.profileId)).toBe(true);
  expect(policy.isColumnPylonSectionProfile(template.baseProfileId)).toBe(false);
 });
});
