/** Additive v8 policy. Frozen v1-v7 definitions and source bytes remain exact. */
import {readFileSync} from 'node:fs';
import {canonicalJson,sha256} from './canonical-json.js';
import {MATRIX_RAIL_INVENTORY_PROFILE,matrixRailInventoryDefinitions,matrixRailInventoryConfigHash,
 MATRIX_RAIL_INVENTORY_READ_PROFILES,matrixFullPolicyForProfile as legacyPolicy,selectMatrixRuntimePolicy as legacySelection} from './matrix-rail-inventory-profile.js';
import {WATER_NODE_CAPABILITY_REGISTRY,waterNodeCapabilityRegistryHash} from './matrix-water-node-execution.js';
const source=(relative:string)=>sha256(readFileSync(new URL(relative,import.meta.url)));
export const MATRIX_WATER_NODE_PROFILE='matrix-text-facts-water-node-v8';
export const MATRIX_WATER_NODE_ADAPTER_VERSION='8';
export const matrixWaterNodeDefinitions={...matrixRailInventoryDefinitions,waterNodeExecution:{
 schemaVersion:'matrix-water-node-comparisons-v1',purpose:'MACHINE_COMPARISON',
 baseProfileId:MATRIX_RAIL_INVENTORY_PROFILE,baseConfigHash:matrixRailInventoryConfigHash,
 capabilityRegistry:WATER_NODE_CAPABILITY_REGISTRY,capabilityRegistryHash:waterNodeCapabilityRegistryHash,
 comparisonVersion:'matrix-zu129-water-node-comparison-v1',
 comparisonSourceSha256:source('../../../services/worker/inspector_worker/water_node_comparison.py'),
 sourceReconstructionVersion:'matrix-zu129-water-node-source-v1',
 sourceReconstructionSourceSha256:source('../../../services/worker/inspector_worker/water_node_source.py'),
 typedExecutionVersion:'matrix-water-node-execution-v1',
 typedExecutionSourceSha256:source('../../../services/worker/inspector_worker/water_node_execution.py'),
 durableWrapperVersion:'matrix-water-node-execution-v1',
 durableWrapperSourceSha256:source('../../../services/worker/inspector_worker/durable_water_node_matrix.py'),
 coveragePolicyVersion:'matrix-water-node-coverage-v1',submissionPolicyVersion:'matrix-water-node-submission-v1',hashPolicyVersion:'matrix-water-node-result-json-v1',
}};
export const matrixWaterNodeConfigHash=sha256(canonicalJson(matrixWaterNodeDefinitions));
export const MATRIX_WATER_NODE_READ_PROFILES=[...MATRIX_RAIL_INVENTORY_READ_PROFILES,MATRIX_WATER_NODE_PROFILE];
export function matrixFullPolicyForProfile(profile:string|null|undefined){
 if(profile===MATRIX_WATER_NODE_PROFILE)return {profileId:MATRIX_WATER_NODE_PROFILE,adapterVersion:MATRIX_WATER_NODE_ADAPTER_VERSION,
  definitions:matrixWaterNodeDefinitions,configHash:matrixWaterNodeConfigHash,projectConstraints:true,sourceDeclarations:true,
  sourceDeclarationsSchemaVersion:'matrix-source-declarations-v2' as const,inventoryComparisons:true,callInventoryComparisons:true,railInventoryComparisons:true,waterNodeComparisons:true};
 const legacy=legacyPolicy(profile);return legacy?{...legacy,waterNodeComparisons:false}:null;
}
/** Profile, adapter, definitions and hash are selected atomically. */
export function selectMatrixRuntimePolicy(flags:{water?:boolean;rail:boolean;call:boolean;inventory:boolean}){
 if(flags.water)return {profileId:MATRIX_WATER_NODE_PROFILE,adapterVersion:MATRIX_WATER_NODE_ADAPTER_VERSION,definitions:matrixWaterNodeDefinitions,configHash:matrixWaterNodeConfigHash};
 return legacySelection(flags);
}
