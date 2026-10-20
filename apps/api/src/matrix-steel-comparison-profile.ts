/** Additive v10. Historical v1-v9 definitions and decisions remain immutable. */
import {readFileSync} from 'node:fs';
import {historicalMatrixPolicyDefinitions} from './matrix-policy-history.js';
import {canonicalJson,sha256} from './canonical-json.js';
import {MATRIX_LIGHTING_TECHNOLOGY_PROFILE,matrixLightingTechnologyDefinitions,matrixLightingTechnologyConfigHash,
 MATRIX_LIGHTING_TECHNOLOGY_READ_PROFILES,matrixFullPolicyForProfile as legacyPolicy,selectMatrixRuntimePolicy as legacySelection} from './matrix-lighting-technology-profile.js';
import {steelComparisonCapabilityRegistry,steelComparisonCapabilityRegistryHash} from './matrix-steel-execution.js';
const source=(relative:string)=>sha256(readFileSync(new URL(relative,import.meta.url)));
export const MATRIX_STEEL_COMPARISON_PROFILE='matrix-text-facts-steel-comparison-v10';
export const MATRIX_STEEL_COMPARISON_ADAPTER_VERSION='10';
const matrixSteelComparisonDefinitionShape={...matrixLightingTechnologyDefinitions,steelExecution:{
 schemaVersion:'matrix-steel-comparisons-v1',purpose:'MACHINE_COMPARISON',
 baseProfileId:MATRIX_LIGHTING_TECHNOLOGY_PROFILE,baseConfigHash:matrixLightingTechnologyConfigHash,
 capabilityRegistry:steelComparisonCapabilityRegistry,capabilityRegistryHash:steelComparisonCapabilityRegistryHash,
 comparisonVersion:'matrix-kr056-steel-comparison-v1',
 comparisonSourceSha256:source('../../../services/worker/inspector_worker/steel_comparison.py'),
 sourceReconstructionVersion:'matrix-source-declarations-v1',
 sourceReconstructionSourceSha256:source('../../../services/worker/inspector_worker/source_declarations.py'),
 typedExecutionVersion:'matrix-steel-execution-v1',
 typedExecutionSourceSha256:source('../../../services/worker/inspector_worker/steel_execution.py'),
 durableWrapperVersion:'matrix-steel-execution-v1',
 durableWrapperSourceSha256:source('../../../services/worker/inspector_worker/durable_steel_comparison_matrix.py'),
 coveragePolicyVersion:'matrix-steel-coverage-v1',submissionPolicyVersion:'matrix-steel-submission-v1',hashPolicyVersion:'matrix-steel-comparison-result-json-v1',
 applicabilitySnapshotPolicyVersion:'matrix-steel-applicability-run-snapshot-v1',
 confidencePolicy:{policyVersion:'machine-confidence-policy-v2',warningThresholdBasisPoints:8000,thresholdComparison:'STRICTLY_GREATER',expectedCalibrationVersion:null,
  sourceSha256:source('../../../packages/contracts/src/machine-confidence-v2.ts')},
}};
/** Historical code runs only in its pinned archived distribution. */
export const matrixSteelComparisonDefinitions=historicalMatrixPolicyDefinitions(MATRIX_STEEL_COMPARISON_PROFILE,'ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6') as unknown as typeof matrixSteelComparisonDefinitionShape;
export const matrixSteelComparisonConfigHash=sha256(canonicalJson(matrixSteelComparisonDefinitions));
export const MATRIX_STEEL_COMPARISON_READ_PROFILES=[...MATRIX_LIGHTING_TECHNOLOGY_READ_PROFILES,MATRIX_STEEL_COMPARISON_PROFILE];
export function matrixFullPolicyForProfile(profile:string|null|undefined){
 if(profile===MATRIX_STEEL_COMPARISON_PROFILE)return {profileId:MATRIX_STEEL_COMPARISON_PROFILE,adapterVersion:MATRIX_STEEL_COMPARISON_ADAPTER_VERSION,
  definitions:matrixSteelComparisonDefinitions,configHash:matrixSteelComparisonConfigHash,projectConstraints:true,sourceDeclarations:true,
  sourceDeclarationsSchemaVersion:'matrix-source-declarations-v2' as const,inventoryComparisons:true,callInventoryComparisons:true,railInventoryComparisons:true,waterNodeComparisons:true,lightingTechnologyComparisons:true,steelComparisons:true};
 const legacy=legacyPolicy(profile);return legacy?{...legacy,steelComparisons:false}:null;
}
export function selectMatrixRuntimePolicy(flags:{steel?:boolean;lighting?:boolean;water?:boolean;rail:boolean;call:boolean;inventory:boolean}){
 if(flags.steel)return {profileId:MATRIX_STEEL_COMPARISON_PROFILE,adapterVersion:MATRIX_STEEL_COMPARISON_ADAPTER_VERSION,definitions:matrixSteelComparisonDefinitions,configHash:matrixSteelComparisonConfigHash};
 return legacySelection(flags);
}
