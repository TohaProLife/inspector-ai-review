/** Typed machine comparison of reviewed declared regions; no scalar fact or physical absence claim. */
import type {MachineConfidencePresentation} from './machine-confidence.js';
export interface MatrixInventoryIdentity {entityKey:string;componentRole:'PARTITION_SLAB_JOINT';componentKey:string;zoneKey:string;operatingModeKey:'DECLARED_NOISE_PROTECTION_MEASURES';measurementBasisKey:'SOURCE_AUTHORED_MEASURE_MEMBERSHIP'}
export interface MatrixInventoryComparisonReference {sourceFileId:string;sourceSha256:string;reviewDecisionId:string;reviewContentHash:string;inventoryContentHash:string}
export type MatrixAr053InventoryComparison={schemaVersion:'matrix-ar053-inventory-comparison-v1';status:'ABSTAIN';reasonCode:string;calibratedProbability:null}|{
  schemaVersion:'matrix-ar053-inventory-comparison-v1';status:'CANDIDATE';ruleId:'matrix-ar-053-declared_joint_damping_tape_omission';ruleVersion:'1';parameterCode:'AR-053';reasonCode:'DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION';calibratedProbability:null;comparisonScope:'REVIEWED_DECLARED_REGIONS_ONLY';identity:MatrixInventoryIdentity;expected:MatrixInventoryComparisonReference;actual:MatrixInventoryComparisonReference;missingFeatureKeys:['DAMPING_TAPE']};
type Common={schemaVersion:'matrix-inventory-execution-result-v1';id:string;ruleId:'matrix-ar-053-declared_joint_damping_tape_omission';ruleVersion:'1';parameterCode:'AR-053';comparisonVariant:'PD_RD'};
export type MatrixInventoryExecutionResult=Common&({kind:'SCOPED_COMPARISON';identity:MatrixInventoryIdentity;comparison:MatrixAr053InventoryComparison}|{kind:'UNBOUND_ATOM_ABSTENTION';reasonCode:'REVIEWED_INVENTORY_IDENTITY_MISSING';calibratedProbability:null});
export interface MatrixInventoryComparisons {schemaVersion:'matrix-inventory-comparisons-v1';purpose:'MACHINE_COMPARISON';objectId:string;inputManifestHash:string;capabilityRegistryHash:string;results:MatrixInventoryExecutionResult[]}
export type MatrixInventoryPresentation={resultId:string}&MachineConfidencePresentation;
export interface MatrixInventoryComparisonEvidence {
  resultId:string;role:'EXPECTED'|'ACTUAL';sourceFileId:string;sourceSha256:string;
  reviewDecisionId:string;reviewContentHash:string;inventoryContentHash:string;originCheckId:string;
  pageNumber:number;pageFrame:{widthMilliPoints:number;heightMilliPoints:number};
  fragmentRole:'HEADER'|'SCOPE'|'FEATURE';
  fragment:{pageNumber:number;blockIndex:number;lineIndex:number;rawText:string;bboxMilliPoints:[number,number,number,number]};
}
