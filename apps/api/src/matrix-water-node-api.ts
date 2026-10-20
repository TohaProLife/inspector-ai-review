/** Water-node preview; reconstruction does not assert human completeness. */
import type {MatrixWaterNodeInventoryTarget} from '@inspector-ai/contracts';
import type {WaterNodeResult} from './matrix-water-node-source.js';
export interface MatrixWaterNodePreviewRead {
 checkId:string;sourceFileId:string;sourceSha256:string;latestReviewHash:string|null;
 result:WaterNodeResult;target?:MatrixWaterNodeInventoryTarget;
}
