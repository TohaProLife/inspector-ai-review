/** Additive v6 policy; frozen v1-v5 definitions retain exact bytes and hashes. */
import {readFileSync} from 'node:fs';
import {canonicalJson,sha256} from './canonical-json.js';
import {matrixInventoryDefinitions,matrixInventoryConfigHash,matrixAnyPolicyForProfile,MATRIX_INVENTORY_READ_PROFILES,MATRIX_INVENTORY_PROFILE} from './matrix-inventory-profile.js';
import {CALL_INVENTORY_CAPABILITY_REGISTRY,callInventoryCapabilityRegistryHash} from './matrix-call-inventory-execution.js';
const source=(relative:string)=>sha256(readFileSync(new URL(relative,import.meta.url)));
export const MATRIX_CALL_INVENTORY_PROFILE='matrix-text-facts-call-inventory-v6';
export const MATRIX_CALL_INVENTORY_ADAPTER_VERSION='6';
export const matrixCallInventoryDefinitions={...matrixInventoryDefinitions,callInventoryExecution:{
 schemaVersion:'matrix-call-inventory-comparisons-v1',purpose:'MACHINE_COMPARISON',
 baseProfileId:MATRIX_INVENTORY_PROFILE,baseConfigHash:matrixInventoryConfigHash,
 capabilityRegistry:CALL_INVENTORY_CAPABILITY_REGISTRY,capabilityRegistryHash:callInventoryCapabilityRegistryHash,
 comparisonVersion:'matrix-odi123-call-inventory-comparison-v1',
 comparisonSourceSha256:source('../../../services/worker/inspector_worker/odi123_call_inventory_comparison.py'),
 sourceReconstructionVersion:'matrix-odi123-call-inventory-source-v1',
 sourceReconstructionSourceSha256:source('../../../services/worker/inspector_worker/call_inventory_source.py'),
 typedExecutionVersion:'matrix-call-inventory-execution-v1',
 typedExecutionSourceSha256:source('../../../services/worker/inspector_worker/call_inventory_execution.py'),
 durableWrapperVersion:'matrix-call-inventory-execution-v1',
 durableWrapperSourceSha256:source('../../../services/worker/inspector_worker/durable_call_inventory_matrix.py'),
 coveragePolicyVersion:'matrix-call-inventory-coverage-v1',submissionPolicyVersion:'matrix-call-inventory-submission-v1',hashPolicyVersion:'matrix-call-inventory-result-json-v1',
}};
export const matrixCallInventoryConfigHash=sha256(canonicalJson(matrixCallInventoryDefinitions));
export const MATRIX_CALL_INVENTORY_READ_PROFILES=[...MATRIX_INVENTORY_READ_PROFILES,MATRIX_CALL_INVENTORY_PROFILE];
export function matrixCompletePolicyForProfile(profile:string|null|undefined){
 if(profile===MATRIX_CALL_INVENTORY_PROFILE)return {profileId:MATRIX_CALL_INVENTORY_PROFILE,adapterVersion:MATRIX_CALL_INVENTORY_ADAPTER_VERSION,definitions:matrixCallInventoryDefinitions,configHash:matrixCallInventoryConfigHash,projectConstraints:true,sourceDeclarations:true,sourceDeclarationsSchemaVersion:'matrix-source-declarations-v2' as const,inventoryComparisons:true,callInventoryComparisons:true};
 const legacy=matrixAnyPolicyForProfile(profile);return legacy?{...legacy,callInventoryComparisons:false}:null;
}
