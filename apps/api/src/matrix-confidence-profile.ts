/** Presentation dispatch follows the authenticated immutable runtime profile. */
import {classifyMachineConfidenceV2,MACHINE_CONFIDENCE_POLICY_V2,NOT_ESTIMABLE_MACHINE_CONFIDENCE,type MatrixExecution} from '@inspector-ai/contracts';
import {matrixPresentation} from './matrix-execution.js';
import {matrixInventoryDefinitions} from './matrix-inventory-profile.js';
import {isSteelComparisonProfile} from './matrix-concrete-wall-profile-v13.js';
import {MATRIX_LIGHTING_TECHNOLOGY_PROFILE} from './matrix-lighting-technology-profile.js';
export function matrixConfidencePolicyForProfile(profile:string|null|undefined){
 return (profile===MATRIX_LIGHTING_TECHNOLOGY_PROFILE||isSteelComparisonProfile(profile))?MACHINE_CONFIDENCE_POLICY_V2:matrixInventoryDefinitions.confidencePolicy;
}
export function matrixPresentationForProfile(execution:MatrixExecution,profile:string|null|undefined){
 if(profile!==MATRIX_LIGHTING_TECHNOLOGY_PROFILE&&!isSteelComparisonProfile(profile))return matrixPresentation(execution);
 return execution.results.map((result,resultIndex)=>({resultIndex,...classifyMachineConfidenceV2({
  confidence:NOT_ESTIMABLE_MACHINE_CONFIDENCE,evidenceQualified:result.qualified,
  technicalFailure:result.executionStatus==='FAILED',expectedCalibrationVersion:null})}));
}
