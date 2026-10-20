/** Additive v7 policy. Frozen v1-v6 definitions keep their original bytes. */
import {readFileSync} from 'node:fs';
import {canonicalJson,sha256} from './canonical-json.js';
import {MATRIX_PROFILE,matrixDefinitions,matrixConfigHash} from './matrix-execution.js';
import {MATRIX_INVENTORY_PROFILE,matrixInventoryDefinitions,matrixInventoryConfigHash} from './matrix-inventory-profile.js';
import {MATRIX_CALL_INVENTORY_PROFILE,MATRIX_CALL_INVENTORY_ADAPTER_VERSION,matrixCallInventoryDefinitions,matrixCallInventoryConfigHash,matrixCompletePolicyForProfile,MATRIX_CALL_INVENTORY_READ_PROFILES} from './matrix-call-inventory-profile.js';
import {RAIL_INVENTORY_CAPABILITY_REGISTRY,railInventoryCapabilityRegistryHash} from './matrix-rail-inventory-execution.js';
const source=(relative:string)=>sha256(readFileSync(new URL(relative,import.meta.url)));
export const MATRIX_RAIL_INVENTORY_PROFILE='matrix-text-facts-rail-inventory-v7';
export const MATRIX_RAIL_INVENTORY_ADAPTER_VERSION='7';
export const matrixRailInventoryDefinitions={...matrixCallInventoryDefinitions,railExecution:{
 schemaVersion:'matrix-rail-inventory-comparisons-v1',purpose:'MACHINE_COMPARISON',
 baseProfileId:MATRIX_CALL_INVENTORY_PROFILE,baseConfigHash:matrixCallInventoryConfigHash,
 capabilityRegistry:RAIL_INVENTORY_CAPABILITY_REGISTRY,capabilityRegistryHash:railInventoryCapabilityRegistryHash,
 comparisonVersion:'matrix-odi120-rail-inventory-comparison-v1',
 comparisonSourceSha256:source('../../../services/worker/inspector_worker/rail_inventory_comparison.py'),
 sourceReconstructionVersion:'matrix-odi120-rail-inventory-source-v1',
 sourceReconstructionSourceSha256:source('../../../services/worker/inspector_worker/rail_inventory_source.py'),
 typedExecutionVersion:'matrix-rail-inventory-execution-v1',
 typedExecutionSourceSha256:source('../../../services/worker/inspector_worker/rail_inventory_execution.py'),
 durableWrapperVersion:'matrix-rail-inventory-execution-v1',
 durableWrapperSourceSha256:source('../../../services/worker/inspector_worker/durable_rail_inventory_matrix.py'),
 coveragePolicyVersion:'matrix-rail-inventory-coverage-v1',submissionPolicyVersion:'matrix-rail-inventory-submission-v1',hashPolicyVersion:'matrix-rail-inventory-result-json-v1',
}};
export const matrixRailInventoryConfigHash=sha256(canonicalJson(matrixRailInventoryDefinitions));
export const MATRIX_RAIL_INVENTORY_READ_PROFILES=[...MATRIX_CALL_INVENTORY_READ_PROFILES,MATRIX_RAIL_INVENTORY_PROFILE];
export function matrixFullPolicyForProfile(profile:string|null|undefined){
 if(profile===MATRIX_RAIL_INVENTORY_PROFILE)return {profileId:MATRIX_RAIL_INVENTORY_PROFILE,adapterVersion:MATRIX_RAIL_INVENTORY_ADAPTER_VERSION,definitions:matrixRailInventoryDefinitions,configHash:matrixRailInventoryConfigHash,projectConstraints:true,sourceDeclarations:true,sourceDeclarationsSchemaVersion:'matrix-source-declarations-v2' as const,inventoryComparisons:true,callInventoryComparisons:true,railInventoryComparisons:true};
 const legacy=matrixCompletePolicyForProfile(profile);return legacy?{...legacy,railInventoryComparisons:false}:null;
}
/** Select rules and slot identity together; later profiles include every earlier domain. */
export function selectMatrixRuntimePolicy(flags:{rail:boolean;call:boolean;inventory:boolean}){
 if(flags.rail)return {profileId:MATRIX_RAIL_INVENTORY_PROFILE,adapterVersion:MATRIX_RAIL_INVENTORY_ADAPTER_VERSION,definitions:matrixRailInventoryDefinitions,configHash:matrixRailInventoryConfigHash};
 if(flags.call)return {profileId:MATRIX_CALL_INVENTORY_PROFILE,adapterVersion:MATRIX_CALL_INVENTORY_ADAPTER_VERSION,definitions:matrixCallInventoryDefinitions,configHash:matrixCallInventoryConfigHash};
 if(flags.inventory)return {profileId:MATRIX_INVENTORY_PROFILE,adapterVersion:'5',definitions:matrixInventoryDefinitions,configHash:matrixInventoryConfigHash};
 return {profileId:MATRIX_PROFILE,adapterVersion:'4',definitions:matrixDefinitions,configHash:matrixConfigHash};
}
