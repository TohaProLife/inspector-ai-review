import {z} from 'zod';
import {matrixWaterNodeScopeInputSchema,matrixWaterNodeScopeDecisionSchema,matrixWaterNodeInventorySelectionSchema,
 matrixWaterNodeInventoryTargetSchema,matrixWaterNodeSourceInventorySchema} from '@inspector-ai/contracts';
const json=(schema:z.ZodType,io:'input'|'output')=>z.toJSONSchema(schema,{target:'draft-7',io});
const string={type:'string',minLength:1,maxLength:200};
export const waterNodeApiSchemas={
 MatrixWaterNodeScopeInput:json(matrixWaterNodeScopeInputSchema,'input'),
 MatrixWaterNodeScopeDecision:json(matrixWaterNodeScopeDecisionSchema,'output'),
 MatrixWaterNodePreviewInput:{type:'object',additionalProperties:false,required:['selection'],properties:{selection:json(matrixWaterNodeInventorySelectionSchema,'input')}},
 MatrixWaterNodePreviewRead:{type:'object',additionalProperties:false,required:['checkId','sourceFileId','sourceSha256','latestReviewHash','result'],properties:{
 checkId:string,sourceFileId:string,sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},latestReviewHash:{type:'string',nullable:true},
 result:{oneOf:[{type:'object',additionalProperties:false,required:['schemaVersion','status','inventory'],properties:{schemaVersion:{const:'matrix-zu129-water-node-source-result-v1'},status:{const:'RECONSTRUCTED'},inventory:json(matrixWaterNodeSourceInventorySchema,'output')}},
 {type:'object',additionalProperties:false,required:['schemaVersion','status','reasonCode'],properties:{schemaVersion:{const:'matrix-zu129-water-node-source-result-v1'},status:{const:'ABSTAIN'},reasonCode:{type:'string'}}}]},target:json(matrixWaterNodeInventoryTargetSchema,'output')}}
};
const params={type:'object',additionalProperties:false,required:['id','sourceFileId'],properties:{id:string,sourceFileId:string}};
const errors={'401':{description:'Требуется сессия',schema:'ApiError'},'404':{description:'Источник недоступен',schema:'ApiError'},'500':{description:'Внутренняя ошибка',schema:'ApiError'}} as const;
const security:Record<string,string[]>[]=[{sessionCookie:[]}];
const prefix='/api/checks/:id/source-files/:sourceFileId/',open='/checks/{id}/source-files/{sourceFileId}/';
export const waterNodeApiOperations=[
 {id:'getMatrixWaterNodeSourcePages',method:'get',fastifyPath:prefix+'water-node-pages',openApiPath:open+'water-node-pages',summary:'Исходные страницы состава вводного узла ХВС',params,security,responses:{...errors,'200':{description:'Исходный текст',schema:'MatrixInventorySourcePagesRead'}}},
 {id:'previewMatrixWaterNodeSource',method:'post',fastifyPath:prefix+'water-node-preview',openApiPath:open+'water-node-preview',summary:'Реконструкция состава вводного узла ХВС без записи',params,bodySchema:'MatrixWaterNodePreviewInput',security,responses:{...errors,'200':{description:'Предпросмотр исходного перечня',schema:'MatrixWaterNodePreviewRead'},'400':{description:'Некорректная область',schema:'ApiError'},'403':{description:'CSRF',schema:'ApiError'},'413':{description:'Лимит запроса',schema:'ApiError'}}}
] as const;
