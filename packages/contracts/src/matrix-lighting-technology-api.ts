import type {LightingTechnologyV3Result} from './matrix-lighting-technology-source-v3.js';
import type {LightingTechnologyComparisonTarget} from './matrix-lighting-technology-comparison.js';
export interface MatrixLightingTechnologyPreviewRead {
 checkId:string;sourceFileId:string;sourceSha256:string;latestReviewHash:string|null;
 result:LightingTechnologyV3Result;target?:LightingTechnologyComparisonTarget;
}
