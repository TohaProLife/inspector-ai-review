/** Additive v9: historical v1-v8 definitions keep their original confidence policy. */
import {readFileSync} from 'node:fs';
import {historicalMatrixPolicyDefinitions} from './matrix-policy-history.js';
import {canonicalJson,sha256} from './canonical-json.js';
import {MATRIX_WATER_NODE_PROFILE,matrixWaterNodeDefinitions,matrixWaterNodeConfigHash,
 MATRIX_WATER_NODE_READ_PROFILES,matrixFullPolicyForProfile as legacyPolicy,selectMatrixRuntimePolicy as legacySelection} from './matrix-water-node-profile.js';
import {LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY,lightingTechnologyCapabilityRegistryHash} from './matrix-lighting-technology-execution.js';
const source=(relative:string)=>sha256(readFileSync(new URL(relative,import.meta.url)));
export const MATRIX_LIGHTING_TECHNOLOGY_PROFILE='matrix-text-facts-lighting-technology-v9';
export const MATRIX_LIGHTING_TECHNOLOGY_ADAPTER_VERSION='9';
export const matrixLightingTechnologyCurrentDefinitions={...matrixWaterNodeDefinitions,lightingTechnologyExecution:{
 schemaVersion:'matrix-lighting-technology-comparisons-v1',purpose:'MACHINE_COMPARISON',
 baseProfileId:MATRIX_WATER_NODE_PROFILE,baseConfigHash:matrixWaterNodeConfigHash,
 capabilityRegistry:LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY,capabilityRegistryHash:lightingTechnologyCapabilityRegistryHash,
 comparisonVersion:'matrix-zu130-lighting-technology-comparison-v1',
 comparisonSourceSha256:source('../../../services/worker/inspector_worker/lighting_technology_comparison.py'),
 sourceReconstructionVersion:'matrix-zu130-lighting-technology-source-v3-v1',
 sourceReconstructionSourceSha256:source('../../../services/worker/inspector_worker/lighting_technology_source_v3.py'),
 documentTextV3ReaderSourceSha256:source('../../../services/worker/inspector_worker/document_text_v3.py'),
 typedExecutionVersion:'matrix-lighting-technology-execution-v1',
 typedExecutionSourceSha256:source('../../../services/worker/inspector_worker/lighting_technology_execution.py'),
 durableWrapperVersion:'matrix-lighting-technology-execution-v1',
 durableWrapperSourceSha256:source('../../../services/worker/inspector_worker/durable_lighting_technology_matrix.py'),
 coveragePolicyVersion:'matrix-lighting-technology-coverage-v1',submissionPolicyVersion:'matrix-lighting-technology-submission-v1',hashPolicyVersion:'matrix-lighting-technology-result-json-v1',
 confidencePolicy:{policyVersion:'machine-confidence-policy-v2',warningThresholdBasisPoints:8000,thresholdComparison:'STRICTLY_GREATER',expectedCalibrationVersion:null,
  sourceSha256:source('../../../packages/contracts/src/machine-confidence-v2.ts')},
}};
/** Accepted historical identity; current reader projection belongs to explicit v11 only. */
export const matrixLightingTechnologyDefinitions=historicalMatrixPolicyDefinitions(MATRIX_LIGHTING_TECHNOLOGY_PROFILE,'c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84') as unknown as typeof matrixLightingTechnologyCurrentDefinitions;
export const matrixLightingTechnologyConfigHash=sha256(canonicalJson(matrixLightingTechnologyDefinitions));
export const MATRIX_LIGHTING_TECHNOLOGY_READ_PROFILES=[...MATRIX_WATER_NODE_READ_PROFILES,MATRIX_LIGHTING_TECHNOLOGY_PROFILE];
export function matrixFullPolicyForProfile(profile:string|null|undefined){
 if(profile===MATRIX_LIGHTING_TECHNOLOGY_PROFILE)return {profileId:MATRIX_LIGHTING_TECHNOLOGY_PROFILE,adapterVersion:MATRIX_LIGHTING_TECHNOLOGY_ADAPTER_VERSION,
  definitions:matrixLightingTechnologyDefinitions,configHash:matrixLightingTechnologyConfigHash,projectConstraints:true,sourceDeclarations:true,
  sourceDeclarationsSchemaVersion:'matrix-source-declarations-v2' as const,inventoryComparisons:true,callInventoryComparisons:true,railInventoryComparisons:true,waterNodeComparisons:true,lightingTechnologyComparisons:true};
 const legacy=legacyPolicy(profile);return legacy?{...legacy,lightingTechnologyComparisons:false}:null;
}
export function selectMatrixRuntimePolicy(flags:{lighting?:boolean;water?:boolean;rail:boolean;call:boolean;inventory:boolean}){
 if(flags.lighting)return {profileId:MATRIX_LIGHTING_TECHNOLOGY_PROFILE,adapterVersion:MATRIX_LIGHTING_TECHNOLOGY_ADAPTER_VERSION,definitions:matrixLightingTechnologyDefinitions,configHash:matrixLightingTechnologyConfigHash};
 return legacySelection(flags);
}
