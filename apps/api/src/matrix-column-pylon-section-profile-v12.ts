/** Current seven-domain runtime, with finite accepted historical read policies. */
import {readFileSync} from 'node:fs';
import {canonicalJson,sha256} from './canonical-json.js';
import {historicalMatrixPolicyDefinitionsV2} from './matrix-policy-history-v2.js';
import {matrixFullPolicyForProfile as previousPolicy,selectMatrixRuntimePolicy as previousSelection,
 isSteelComparisonProfile as previousSteel,MATRIX_STEEL_COMPARISON_READ_PROFILES as previousReadProfiles,matrixSteelComparisonV11Definitions} from './matrix-steel-comparison-profile-v11.js';
import {columnPylonSectionCapabilityRegistry,columnPylonSectionCapabilityRegistryHash} from './matrix-column-pylon-section-execution.js';
export {MATRIX_STEEL_COMPARISON_PROFILE,MATRIX_STEEL_COMPARISON_V11_PROFILE} from './matrix-steel-comparison-profile-v11.js';
export const MATRIX_COLUMN_PYLON_SECTION_V12_PROFILE='matrix-text-facts-column-pylon-section-v12';
export const MATRIX_COLUMN_PYLON_SECTION_V12_ADAPTER_VERSION='12';
const baseProfileId='matrix-text-facts-steel-comparison-v11';
const baseConfigHash='3b23ac656edb37a6dbbc0b8da21c912db87f8bac29cde4623a032bad6f0586d7';
const source=(relative:string)=>sha256(readFileSync(new URL(relative,import.meta.url)));
type PreviousDefinitions=NonNullable<ReturnType<typeof previousPolicy>>['definitions'];
const base=historicalMatrixPolicyDefinitionsV2(baseProfileId,baseConfigHash) as typeof matrixSteelComparisonV11Definitions|null;
if(!base)throw Error('Frozen v11 policy unavailable');
export const matrixColumnPylonSectionV12Definitions={...base,columnPylonSectionExecution:{
 schemaVersion:'matrix-column-pylon-section-comparisons-v1',purpose:'MACHINE_COMPARISON',baseProfileId,baseConfigHash,
 capabilityRegistry:columnPylonSectionCapabilityRegistry,capabilityRegistryHash:columnPylonSectionCapabilityRegistryHash,
 comparisonVersion:'matrix-kr060-column-pylon-comparison-v2',
 comparisonSourceSha256:source('../../../services/worker/inspector_worker/column_pylon_section_v2.py'),
 literalExtractorSourceSha256:source('../../../services/worker/inspector_worker/column_pylon_dimension_literals.py'),
 sourceReconstructionVersion:'document-text-v3-large-source-bounds-v1',
 sourceReconstructionSourceSha256:source('../../../services/worker/inspector_worker/document_text_v3.py'),
 typedExecutionVersion:'matrix-column-pylon-section-execution-v1',
 typedExecutionSourceSha256:source('../../../services/worker/inspector_worker/column_pylon_section_execution.py'),
 runSnapshotPolicyVersion:'matrix-kr060-column-pylon-run-snapshot-v1',
 runSnapshotSourceSha256:source('../../../services/worker/inspector_worker/column_pylon_section_run_snapshot.py'),
 scalarExecutionVersion:'matrix-scalar-prepared-v12-operation-local-v1',
 scalarExecutionSourceSha256:source('../../../services/worker/inspector_worker/matrix_scalar_prepared_v12.py'),
 scalarLegacyEngineSourceSha256:source('../../../services/worker/inspector_worker/matrix_engine.py'),
 durableWrapperVersion:'matrix-column-pylon-section-durable-v12',
 durableWrapperSourceSha256:source('../../../services/worker/inspector_worker/durable_column_pylon_section_matrix_v12.py'),
 loaderSchemaVersion:'matrix-reviewed-inventory-loader-inputs-v7',
 loaderResourcePolicy:{canonicalUtf8Bytes:67108864,nodesIncludingKeys:4500018,maximumDepth:69,containerItems:32768,scalarStringCodePoints:2000000},
 coveragePolicyVersion:'matrix-column-pylon-section-coverage-v1',submissionPolicyVersion:'matrix-column-pylon-section-submission-v1',
 hashPolicyVersion:'matrix-column-pylon-section-execution-result-id-v1',
 confidencePolicy:{policyVersion:'machine-confidence-policy-v2',warningThresholdBasisPoints:8000,thresholdComparison:'STRICTLY_GREATER',expectedCalibrationVersion:null,
  sourceSha256:source('../../../packages/contracts/src/machine-confidence-v2.ts')},
}};
export const matrixColumnPylonSectionV12ConfigHash=sha256(canonicalJson(matrixColumnPylonSectionV12Definitions));
export const MATRIX_STEEL_COMPARISON_READ_PROFILES=[...previousReadProfiles,MATRIX_COLUMN_PYLON_SECTION_V12_PROFILE];
const history=new Map([
 ['matrix-text-facts-lighting-technology-v9','c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84'],
 ['matrix-text-facts-steel-comparison-v10','ea3cd0eb880c3d07c04a61ec794e5edf201657c06582bf8409fcf8a882aed7d6'],
 [baseProfileId,baseConfigHash],
]);
export function isColumnPylonSectionProfile(profile:unknown):boolean{return profile===MATRIX_COLUMN_PYLON_SECTION_V12_PROFILE;}
export function isSteelComparisonProfile(profile:unknown):boolean{return isColumnPylonSectionProfile(profile)||previousSteel(profile);}
export function matrixFullPolicyForProfile(profile:string|null|undefined){
 if(profile===MATRIX_COLUMN_PYLON_SECTION_V12_PROFILE)return {
  ...previousPolicy(baseProfileId)!,profileId:MATRIX_COLUMN_PYLON_SECTION_V12_PROFILE,
  adapterVersion:MATRIX_COLUMN_PYLON_SECTION_V12_ADAPTER_VERSION,definitions:matrixColumnPylonSectionV12Definitions,
  configHash:matrixColumnPylonSectionV12ConfigHash,columnPylonSectionComparisons:true,
 };
 const previous=previousPolicy(profile);if(!previous)return null;
 const hash=profile?history.get(profile):undefined;
 return {...previous,...(hash?{definitions:historicalMatrixPolicyDefinitionsV2(profile,hash)! as PreviousDefinitions,configHash:hash}:{}),columnPylonSectionComparisons:false};
}
/** Archived identities permit authenticated replay, never new execution here. */
export function isCurrentMatrixExecutionInstalled(profile:string|null|undefined):boolean {
 return typeof profile==='string'&&!history.has(profile)&&matrixFullPolicyForProfile(profile)!==null;
}
export function selectMatrixRuntimePolicy(flags:{columnPylonSectionV12?:boolean;steelV11?:boolean;steel?:boolean;lighting?:boolean;water?:boolean;rail:boolean;call:boolean;inventory:boolean}){
 if(flags.columnPylonSectionV12)return{profileId:MATRIX_COLUMN_PYLON_SECTION_V12_PROFILE,adapterVersion:MATRIX_COLUMN_PYLON_SECTION_V12_ADAPTER_VERSION,
  definitions:matrixColumnPylonSectionV12Definitions,configHash:matrixColumnPylonSectionV12ConfigHash};
 return previousSelection(flags);
}
