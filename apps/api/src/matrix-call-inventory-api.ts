/** Call-domain preview; server reconstruction is still not human completeness. */
import type {MatrixCallInventoryTarget} from '@inspector-ai/contracts';
import type {CallInventorySourceResult} from './matrix-call-inventory-source.js';
export interface MatrixCallInventoryPreviewRead {
 checkId:string;sourceFileId:string;sourceSha256:string;latestReviewHash:string|null;
 result:CallInventorySourceResult;target?:MatrixCallInventoryTarget;
}
