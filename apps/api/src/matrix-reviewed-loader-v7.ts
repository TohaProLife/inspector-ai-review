/** Whole native parent admission, then unchanged six child validators and the
 * new all-retained child. No caller-provided budgets or identity conversion. */
import type {MatrixReviewedLoaderV7} from '@inspector-ai/contracts';
import {detachMatrixReviewedLoaderV7,canonicalMatrixReviewedLoaderV7,MatrixReviewedLoaderV7ValidationError} from './matrix-reviewed-loader-v7-native.js';
import {validateInventoryLoaderPackage} from './matrix-inventory-execution.js';
import {validateCallInventoryLoaderPackage} from './matrix-call-inventory-execution.js';
import {validateRailInventoryLoaderPackage} from './matrix-rail-inventory-execution.js';
import {validateWaterNodeLoaderPackage} from './matrix-water-node-execution.js';
import {validateLightingTechnologyLoaderPackage} from './matrix-lighting-technology-execution.js';
import {validateSteelComparisonLoaderPackage} from './matrix-steel-execution.js';
import {validateSteelApplicabilityRunSnapshot,validateSteelApplicabilitySnapshotProjectionLinks} from './matrix-steel-run-snapshot.js';
import {validateColumnPylonSectionLoaderPackage} from './matrix-column-pylon-section-execution.js';
import {validateColumnPylonSectionRunSnapshot} from './matrix-column-pylon-section-run-snapshot.js';
function invalid():never{throw new MatrixReviewedLoaderV7ValidationError('INVALID_PACKAGE');}
const keys=['schemaVersion','objectId','objectApiId','inputManifestHash','inventory','callInventory','railInventory','waterNode','lightingTechnology','steelComparison','steelApplicabilitySnapshot','columnPylonSection','columnPylonSectionSnapshot'];
const fields=['decisionId','contentHash','revisionStatus','approvalStatus','sectionCode','linkGroupId','pageStages'];
const same=(a:unknown,b:unknown)=>canonicalMatrixReviewedLoaderV7(a)===canonicalMatrixReviewedLoaderV7(b);
export function validateMatrixReviewedLoaderV7(raw:unknown):MatrixReviewedLoaderV7{
 const p=detachMatrixReviewedLoaderV7(raw)as any;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==keys.length||keys.some(k=>!Object.hasOwn(p,k))
  ||p.schemaVersion!=='matrix-reviewed-inventory-loader-inputs-v7'
  ||typeof p.objectId!=='string'||!/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}(?![\s\S])/u.test(p.objectId))invalid();
 const old=[validateInventoryLoaderPackage(p.inventory),validateCallInventoryLoaderPackage(p.callInventory),
  validateRailInventoryLoaderPackage(p.railInventory),validateWaterNodeLoaderPackage(p.waterNode),
  validateLightingTechnologyLoaderPackage(p.lightingTechnology),validateSteelComparisonLoaderPackage(p.steelComparison)];
 const common=(sources:any[])=>Object.fromEntries(sources.map(s=>[s.sourceFileId,{sourceFileId:s.sourceFileId,sourceSha256:s.sourceSha256,
  stages:s.stages,review:s.review?Object.fromEntries(fields.map(k=>[k,s.review[k]])):null}]));
 const reference=common(old[0]!.sources);
 for(const child of old)if(child.objectId!==p.objectId||child.inputManifestHash!==p.inputManifestHash||!same(reference,common(child.sources)))invalid();
 const steelSnapshot=validateSteelApplicabilityRunSnapshot(p.steelApplicabilitySnapshot);
 if(steelSnapshot.objectId!==p.objectId||steelSnapshot.inputManifestHash!==p.inputManifestHash)invalid();
 validateSteelApplicabilitySnapshotProjectionLinks(steelSnapshot,old[5]);
 const column=validateColumnPylonSectionLoaderPackage(p.columnPylonSection,p.columnPylonSectionSnapshot);
 const snapshot=validateColumnPylonSectionRunSnapshot(p.columnPylonSectionSnapshot);
 if(column.objectId!==p.objectApiId||column.inputManifestHash!==p.inputManifestHash||snapshot.objectId!==p.objectId
  ||snapshot.objectApiId!==p.objectApiId||snapshot.inputManifestHash!==p.inputManifestHash||!same(reference,common(column.sources)))invalid();
 return p as MatrixReviewedLoaderV7;
}
