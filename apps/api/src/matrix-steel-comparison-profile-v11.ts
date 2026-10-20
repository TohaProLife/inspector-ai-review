/** Explicit current runtime. Historical v9/v10 retain accepted immutable identities. */
import {readFileSync} from 'node:fs';
import {canonicalJson,sha256} from './canonical-json.js';
import {MATRIX_LIGHTING_TECHNOLOGY_PROFILE,matrixLightingTechnologyCurrentDefinitions} from './matrix-lighting-technology-profile.js';
import {MATRIX_STEEL_COMPARISON_PROFILE,MATRIX_STEEL_COMPARISON_READ_PROFILES as historicalReadProfiles,
 matrixSteelComparisonDefinitions,matrixFullPolicyForProfile as archivedPolicy,selectMatrixRuntimePolicy as archivedSelection} from './matrix-steel-comparison-profile.js';
export {MATRIX_STEEL_COMPARISON_PROFILE} from './matrix-steel-comparison-profile.js';
export const MATRIX_STEEL_COMPARISON_V11_PROFILE='matrix-text-facts-steel-comparison-v11';
export const MATRIX_STEEL_COMPARISON_V11_ADAPTER_VERSION='11';
export const matrixSteelComparisonV11Definitions={...matrixLightingTechnologyCurrentDefinitions,steelExecution:{
 ...matrixSteelComparisonDefinitions.steelExecution,
 baseConfigHash:sha256(canonicalJson(matrixLightingTechnologyCurrentDefinitions)),
 durableWrapperSourceSha256:sha256(readFileSync(new URL('../../../services/worker/inspector_worker/durable_steel_comparison_matrix_v11.py',import.meta.url))),
}};
export const matrixSteelComparisonV11ConfigHash=sha256(canonicalJson(matrixSteelComparisonV11Definitions));
export const MATRIX_STEEL_COMPARISON_READ_PROFILES=[...historicalReadProfiles,MATRIX_STEEL_COMPARISON_V11_PROFILE];
export function isSteelComparisonProfile(profile:unknown):boolean {
 return profile===MATRIX_STEEL_COMPARISON_PROFILE||profile===MATRIX_STEEL_COMPARISON_V11_PROFILE;
}
export function matrixFullPolicyForProfile(profile:string|null|undefined){
 if(profile===MATRIX_STEEL_COMPARISON_V11_PROFILE)return {profileId:MATRIX_STEEL_COMPARISON_V11_PROFILE,
  adapterVersion:MATRIX_STEEL_COMPARISON_V11_ADAPTER_VERSION,definitions:matrixSteelComparisonV11Definitions,configHash:matrixSteelComparisonV11ConfigHash,
  projectConstraints:true,sourceDeclarations:true,sourceDeclarationsSchemaVersion:'matrix-source-declarations-v2' as const,
  inventoryComparisons:true,callInventoryComparisons:true,railInventoryComparisons:true,waterNodeComparisons:true,lightingTechnologyComparisons:true,steelComparisons:true};
 return archivedPolicy(profile);
}
/** Archived identities authorise authenticated reads, not execution in this installed program. */
export function isCurrentMatrixExecutionInstalled(profile:string|null|undefined):boolean {
 return profile!==MATRIX_LIGHTING_TECHNOLOGY_PROFILE&&profile!==MATRIX_STEEL_COMPARISON_PROFILE&&matrixFullPolicyForProfile(profile)!==null;
}
export function selectMatrixRuntimePolicy(flags:{steelV11?:boolean;steel?:boolean;lighting?:boolean;water?:boolean;rail:boolean;call:boolean;inventory:boolean}){
 if(flags.steelV11)return {profileId:MATRIX_STEEL_COMPARISON_V11_PROFILE,adapterVersion:MATRIX_STEEL_COMPARISON_V11_ADAPTER_VERSION,
  definitions:matrixSteelComparisonV11Definitions,configHash:matrixSteelComparisonV11ConfigHash};
 return archivedSelection(flags);
}
