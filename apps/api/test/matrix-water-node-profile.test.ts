import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {MATRIX_WATER_NODE_PROFILE,MATRIX_WATER_NODE_ADAPTER_VERSION,matrixWaterNodeDefinitions,matrixWaterNodeConfigHash,matrixFullPolicyForProfile,selectMatrixRuntimePolicy} from '../src/matrix-water-node-profile.js';
import {MATRIX_RAIL_INVENTORY_PROFILE,matrixRailInventoryDefinitions,matrixRailInventoryConfigHash} from '../src/matrix-rail-inventory-profile.js';
import {pythonExecutable,pythonEnv} from './python.js';
it('v8 wraps byte-identical v7 definitions; every legacy selection retains policy',()=>{
 const {waterNodeExecution,...base}=matrixWaterNodeDefinitions;expect(base).toEqual(matrixRailInventoryDefinitions);expect(matrixRailInventoryConfigHash).toBe('35be151bd0eff262bb7e19feb2b91c6d6e5e0f70ea41dee43f05ea331ebdcd36');expect(waterNodeExecution.baseConfigHash).toBe(matrixRailInventoryConfigHash);
 expect(selectMatrixRuntimePolicy({water:true,rail:true,call:true,inventory:true})).toEqual({profileId:MATRIX_WATER_NODE_PROFILE,adapterVersion:MATRIX_WATER_NODE_ADAPTER_VERSION,definitions:matrixWaterNodeDefinitions,configHash:matrixWaterNodeConfigHash});
 expect(selectMatrixRuntimePolicy({water:false,rail:true,call:true,inventory:true}).profileId).toBe(MATRIX_RAIL_INVENTORY_PROFILE);expect(matrixFullPolicyForProfile(MATRIX_RAIL_INVENTORY_PROFILE)?.waterNodeComparisons).toBe(false);expect(matrixFullPolicyForProfile(MATRIX_WATER_NODE_PROFILE)?.waterNodeComparisons).toBe(true);
});
it('independent Python policy graph/config exact including all runtime pins',()=>{
 const script=`import json,sys\nsys.path.insert(0,'services/worker/tests')\nimport test_durable_water_node_matrix as qa\nl,_,_=qa.bundle()\nprint(json.dumps({'definitions':l['release']['rules']['matrixDefinitions'],'configHash':l['release']['providerSlot']['configHash']}))`;
 const result=spawnSync(pythonExecutable,['-c',script],{cwd:new URL('../../../',import.meta.url),env:{...process.env,...pythonEnv},encoding:'utf8',timeout:30000,maxBuffer:8000000});expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual({definitions:matrixWaterNodeDefinitions,configHash:matrixWaterNodeConfigHash});
});
