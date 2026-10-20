/** Rail-domain preview; server reconstruction is still not human completeness. */
import type {MatrixRailInventoryTarget} from '@inspector-ai/contracts';
import type {RailResult} from './matrix-rail-inventory-source.js';
export interface MatrixRailInventoryPreviewRead {
 checkId:string;sourceFileId:string;sourceSha256:string;latestReviewHash:string|null;
 result:RailResult;target?:MatrixRailInventoryTarget;
}
