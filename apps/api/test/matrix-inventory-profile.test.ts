import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {canonicalJson,sha256} from '../src/canonical-json.js';
import {matrixAnyPolicyForProfile,matrixInventoryDefinitions,matrixInventoryConfigHash,MATRIX_INVENTORY_PROFILE,MATRIX_INVENTORY_READ_PROFILES} from '../src/matrix-inventory-profile.js';
import {matrixDefinitions,matrixConfigHash,matrixLegacyConfigHash,matrixSteelConfigHash,matrixConstraintsConfigHash,matrixPolicyForProfile,MATRIX_READ_PROFILES} from '../src/matrix-execution.js';
import {INVENTORY_CAPABILITY_REGISTRY,inventoryCapabilityRegistryHash} from '../src/matrix-inventory-execution.js';
import {pythonAvailable,pythonExecutable,pythonEnv} from './python.js';
describe('additive v5 typed inventory release boundary',()=>{
  it('pins four unchanged legacy profiles and a separate v5 policy',()=>{
    expect([matrixConfigHash,matrixSteelConfigHash,matrixConstraintsConfigHash,matrixLegacyConfigHash]).toEqual([
      'aedbc793122525242dbdcd7b3b56c5ddf3e176869a1aa31137db11833d94181e',
      '2536d3f36cb5c112a052c7f1ea782afc9b1c95d3d97862b7b4051db7d3eb14bd',
      '347c85ed3c0e8ef49346f53b58904b249ee59f1e79cf595098be70589524d8ab',
      '272a89eac185a2df8f1391384ddddb380779af8bf7b9a81cdf8056dc73371891']);
    expect(MATRIX_INVENTORY_READ_PROFILES).toEqual([...MATRIX_READ_PROFILES,MATRIX_INVENTORY_PROFILE]);
    for(const profile of MATRIX_READ_PROFILES)expect(matrixAnyPolicyForProfile(profile)).toEqual({...matrixPolicyForProfile(profile),inventoryComparisons:false});
    const {inventoryExecution,...legacy}=matrixInventoryDefinitions;expect(legacy).toEqual(matrixDefinitions);
    expect(sha256(canonicalJson(legacy))).toBe(matrixConfigHash);
    expect(inventoryExecution.capabilityRegistryHash).toBe('4041e18e6325759fc44fdbc2c67045130fd194ade42d208ba1fda24d8decd76a');
    expect(inventoryCapabilityRegistryHash).toBe(inventoryExecution.capabilityRegistryHash);
    expect(JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-inventory-capabilities-v1.json',import.meta.url),'utf8'))).toEqual(INVENTORY_CAPABILITY_REGISTRY);
    expect(matrixAnyPolicyForProfile(MATRIX_INVENTORY_PROFILE)).toMatchObject({adapterVersion:'5',inventoryComparisons:true,configHash:matrixInventoryConfigHash});
    expect(matrixAnyPolicyForProfile('unknown')).toBeNull();
  });
  it.skipIf(!pythonAvailable)('matches the actual Python worker policy and all source hashes after relocation',()=>{
    const result=spawnSync(pythonExecutable,['-c',`import json,sys,hashlib
from inspector_worker import durable_inventory_matrix as w
base=json.load(sys.stdin);registry=w._load_capability_registry();base['inventoryExecution']=w._inventory_policy(registry)
print(json.dumps({'definitions':base,'configHash':w._sha(base)}))`],{input:JSON.stringify(matrixDefinitions),encoding:'utf8',env:{...process.env,...pythonEnv},timeout:20_000,maxBuffer:4*1024*1024});
    expect(result.status,result.stderr).toBe(0);const parsed=JSON.parse(result.stdout);
    expect(parsed.definitions).toEqual(matrixInventoryDefinitions);expect(parsed.configHash).toBe(matrixInventoryConfigHash);
  });
});
