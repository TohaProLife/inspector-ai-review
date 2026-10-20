import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import {matrixInventoryDefinitions,matrixInventoryConfigHash,matrixAnyPolicyForProfile,MATRIX_INVENTORY_READ_PROFILES} from '../src/matrix-inventory-profile.js';
import {matrixCallInventoryDefinitions,matrixCallInventoryConfigHash,matrixCompletePolicyForProfile,MATRIX_CALL_INVENTORY_READ_PROFILES} from '../src/matrix-call-inventory-profile.js';
import {matrixRailInventoryDefinitions,matrixRailInventoryConfigHash,matrixFullPolicyForProfile,MATRIX_RAIL_INVENTORY_PROFILE,MATRIX_RAIL_INVENTORY_READ_PROFILES} from '../src/matrix-rail-inventory-profile.js';
import {RAIL_INVENTORY_CAPABILITY_REGISTRY,railInventoryCapabilityRegistryHash} from '../src/matrix-rail-inventory-execution.js';
import {pythonAvailable,pythonExecutable,pythonEnv} from './python.js';
describe('actual additive v7 rail inventory release',()=>{
 it('preserves every frozen v1-v6 profile and isolates rail policy',()=>{
  expect(matrixCallInventoryConfigHash).toBe('dcb6df67d8fa876e090bcaf58452d32098f409e569ee4cecfe66abf0db0cf3ad');
  expect(MATRIX_RAIL_INVENTORY_READ_PROFILES).toEqual([...MATRIX_CALL_INVENTORY_READ_PROFILES,MATRIX_RAIL_INVENTORY_PROFILE]);
  for(const profile of MATRIX_CALL_INVENTORY_READ_PROFILES)expect(matrixFullPolicyForProfile(profile)).toEqual({...matrixCompletePolicyForProfile(profile),railInventoryComparisons:false});
  const {railExecution,...v6}=matrixRailInventoryDefinitions;expect(v6).toEqual(matrixCallInventoryDefinitions);
  expect(sha256(canonicalJson(v6))).toBe(matrixCallInventoryConfigHash);
  expect(railExecution.capabilityRegistryHash).toBe('1a50046599c3c2c0965919a33615da4254dc9e0a1e05f4bedb723d94de2be409');
  expect(railInventoryCapabilityRegistryHash).toBe(railExecution.capabilityRegistryHash);
  expect(JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-rail-inventory-capabilities-v1.json',import.meta.url),'utf8'))).toEqual(RAIL_INVENTORY_CAPABILITY_REGISTRY);
  expect(matrixFullPolicyForProfile(MATRIX_RAIL_INVENTORY_PROFILE)).toMatchObject({adapterVersion:'7',inventoryComparisons:true,callInventoryComparisons:true,railInventoryComparisons:true,configHash:matrixRailInventoryConfigHash});
  expect(matrixFullPolicyForProfile('unknown')).toBeNull();
 });
 it.skipIf(!pythonAvailable)('matches actual independently tested Python v7 policy/source pins and dispatches real v7',()=>{
  const proc=spawnSync(pythonExecutable,['-c',`import json,sys
from inspector_worker import durable_rail_inventory_matrix as w
base=json.load(sys.stdin);ar,call,rail=w._load_capability_registries();base['railExecution']=w._rail_inventory_policy(rail)
print(json.dumps({'definitions':base,'configHash':w._sha(base)}))`],{input:JSON.stringify(matrixCallInventoryDefinitions),encoding:'utf8',env:{...process.env,...pythonEnv},timeout:20_000,maxBuffer:4*1024*1024});
  expect(proc.status,proc.stderr).toBe(0);const parsed=JSON.parse(proc.stdout);expect(parsed.definitions).toEqual(matrixRailInventoryDefinitions);expect(parsed.configHash).toBe(matrixRailInventoryConfigHash);
  const adapter=readFileSync(new URL('../../../services/worker/inspector_worker/pilot_rule_adapter.py',import.meta.url),'utf8');expect(adapter).toContain('return execute_durable_rail_inventory_matrix(lease, attempt)');
 });
});
