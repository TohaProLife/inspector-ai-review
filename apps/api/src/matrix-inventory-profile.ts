/** Additive v5 policy. Four legacy definitions and config hashes stay unchanged. */
import {readFileSync} from 'node:fs';
import {canonicalJson,sha256} from './canonical-json.js';
import {matrixDefinitions,matrixConfigHash,matrixPolicyForProfile,MATRIX_READ_PROFILES} from './matrix-execution.js';
import {INVENTORY_CAPABILITY_REGISTRY,inventoryCapabilityRegistryHash} from './matrix-inventory-execution.js';
const source=(relative:string)=>sha256(readFileSync(new URL(relative,import.meta.url)));
export const MATRIX_INVENTORY_PROFILE='matrix-text-facts-inventory-v5';
export const MATRIX_INVENTORY_ADAPTER_VERSION='5';
export const matrixInventoryDefinitions={...matrixDefinitions,inventoryExecution:{
  schemaVersion:'matrix-inventory-comparisons-v1',purpose:'MACHINE_COMPARISON',
  baseProfileId:'matrix-text-facts-evidence-v4',baseConfigHash:matrixConfigHash,
  capabilityRegistry:INVENTORY_CAPABILITY_REGISTRY,capabilityRegistryHash:inventoryCapabilityRegistryHash,
  comparisonVersion:'matrix-ar053-inventory-comparison-v1',
  comparisonSourceSha256:source('../../../services/worker/inspector_worker/ar053_inventory_comparison.py'),
  sourceReconstructionVersion:'matrix-ar053-inventory-source-v1',
  sourceReconstructionSourceSha256:source('../../../services/worker/inspector_worker/inventory_source.py'),
  typedExecutionVersion:'matrix-inventory-execution-v1',
  typedExecutionSourceSha256:source('../../../services/worker/inspector_worker/inventory_execution.py'),
  durableWrapperVersion:'matrix-inventory-execution-v1',
  durableWrapperSourceSha256:source('../../../services/worker/inspector_worker/durable_inventory_matrix.py'),
  coveragePolicyVersion:'matrix-inventory-coverage-v1',submissionPolicyVersion:'matrix-inventory-submission-v1',hashPolicyVersion:'matrix-inventory-result-json-v1',
}};
export const matrixInventoryConfigHash=sha256(canonicalJson(matrixInventoryDefinitions));
export const MATRIX_INVENTORY_READ_PROFILES=[...MATRIX_READ_PROFILES,MATRIX_INVENTORY_PROFILE];
export function matrixAnyPolicyForProfile(profile:string|null|undefined){
  if(profile===MATRIX_INVENTORY_PROFILE)return {profileId:MATRIX_INVENTORY_PROFILE,adapterVersion:MATRIX_INVENTORY_ADAPTER_VERSION,definitions:matrixInventoryDefinitions,configHash:matrixInventoryConfigHash,projectConstraints:true,sourceDeclarations:true,sourceDeclarationsSchemaVersion:'matrix-source-declarations-v2' as const,inventoryComparisons:true};
  const legacy=matrixPolicyForProfile(profile);return legacy?{...legacy,inventoryComparisons:false}:null;
}
