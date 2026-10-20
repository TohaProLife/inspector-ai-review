import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import {matrixInventoryDefinitions,matrixInventoryConfigHash,matrixAnyPolicyForProfile,MATRIX_INVENTORY_READ_PROFILES} from '../src/matrix-inventory-profile.js';
import {matrixCallInventoryDefinitions,matrixCallInventoryConfigHash,matrixCompletePolicyForProfile,MATRIX_CALL_INVENTORY_PROFILE,MATRIX_CALL_INVENTORY_READ_PROFILES} from '../src/matrix-call-inventory-profile.js';
import {CALL_INVENTORY_CAPABILITY_REGISTRY,callInventoryCapabilityRegistryHash} from '../src/matrix-call-inventory-execution.js';
import {pythonAvailable,pythonExecutable,pythonEnv} from './python.js';
describe('actual additive v6 call inventory release',()=>{
 it('preserves every frozen v1-v5 profile and isolates scoped call policy',()=>{
  expect(matrixInventoryConfigHash).toBe('26f8a2d425296c27573c11358ad394c3c0cd911861bb9b2b11b88fe6c87fb060');
  expect(MATRIX_CALL_INVENTORY_READ_PROFILES).toEqual([...MATRIX_INVENTORY_READ_PROFILES,MATRIX_CALL_INVENTORY_PROFILE]);
  for(const profile of MATRIX_INVENTORY_READ_PROFILES)expect(matrixCompletePolicyForProfile(profile)).toEqual({...matrixAnyPolicyForProfile(profile),callInventoryComparisons:false});
  const {callInventoryExecution,...v5}=matrixCallInventoryDefinitions;expect(v5).toEqual(matrixInventoryDefinitions);
  expect(sha256(canonicalJson(v5))).toBe(matrixInventoryConfigHash);
  expect(callInventoryExecution.capabilityRegistryHash).toBe('86b0c1fef9f55bf5a6802c1747c9e59fd0f5ebb16c230a74d685b30c307f6e2d');
  expect(callInventoryCapabilityRegistryHash).toBe(callInventoryExecution.capabilityRegistryHash);
  expect(JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-call-inventory-capabilities-v1.json',import.meta.url),'utf8'))).toEqual(CALL_INVENTORY_CAPABILITY_REGISTRY);
  expect(matrixCompletePolicyForProfile(MATRIX_CALL_INVENTORY_PROFILE)).toMatchObject({adapterVersion:'6',inventoryComparisons:true,callInventoryComparisons:true,configHash:matrixCallInventoryConfigHash});
  expect(matrixCompletePolicyForProfile('unknown')).toBeNull();
 });
 it.skipIf(!pythonAvailable)('matches actual independently tested Python v6 policy/source pins and dispatches real v6',()=>{
  const proc=spawnSync(pythonExecutable,['-c',`import json,sys
from inspector_worker import durable_call_inventory_matrix as w
base=json.load(sys.stdin);ar,call=w._load_capability_registries();base['callInventoryExecution']=w._call_inventory_policy(call)
print(json.dumps({'definitions':base,'configHash':w._sha(base)}))`],{input:JSON.stringify(matrixInventoryDefinitions),encoding:'utf8',env:{...process.env,...pythonEnv},timeout:20_000,maxBuffer:4*1024*1024});
  expect(proc.status,proc.stderr).toBe(0);const parsed=JSON.parse(proc.stdout);expect(parsed.definitions).toEqual(matrixCallInventoryDefinitions);expect(parsed.configHash).toBe(matrixCallInventoryConfigHash);
  const adapter=readFileSync(new URL('../../../services/worker/inspector_worker/pilot_rule_adapter.py',import.meta.url),'utf8');expect(adapter).toContain('return execute_durable_call_inventory_matrix(lease, attempt)');
 });
});
