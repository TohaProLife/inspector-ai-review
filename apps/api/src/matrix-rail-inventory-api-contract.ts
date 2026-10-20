import {z} from 'zod';
import {matrixRailInventoryScopeInputSchema,matrixRailInventoryScopeDecisionSchema,matrixRailInventorySelectionSchema,
 matrixRailInventoryTargetSchema,matrixRailSourceInventorySchema} from '@inspector-ai/contracts';
const json=(schema:z.ZodType,io:'input'|'output')=>z.toJSONSchema(schema,{target:'draft-7',io});
const string={type:'string',minLength:1,maxLength:200};
export const railInventoryApiSchemas={
 MatrixRailInventoryScopeInput:json(matrixRailInventoryScopeInputSchema,'input'),
 MatrixRailInventoryScopeDecision:json(matrixRailInventoryScopeDecisionSchema,'output'),
 MatrixRailInventoryPreviewInput:{type:'object',additionalProperties:false,required:['selection'],properties:{selection:json(matrixRailInventorySelectionSchema,'input')}},
 MatrixRailInventoryPreviewRead:{type:'object',additionalProperties:false,required:['checkId','sourceFileId','sourceSha256','latestReviewHash','result'],properties:{
 checkId:string,sourceFileId:string,sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},latestReviewHash:{type:'string',nullable:true},
 result:{oneOf:[{type:'object',additionalProperties:false,required:['schemaVersion','status','inventory'],properties:{schemaVersion:{const:'matrix-odi120-rail-inventory-source-result-v1'},status:{const:'RECONSTRUCTED'},inventory:json(matrixRailSourceInventorySchema,'output')}},
 {type:'object',additionalProperties:false,required:['schemaVersion','status','reasonCode'],properties:{schemaVersion:{const:'matrix-odi120-rail-inventory-source-result-v1'},status:{const:'ABSTAIN'},reasonCode:{type:'string'}}}]},target:json(matrixRailInventoryTargetSchema,'output')}}
};
const params={type:'object',additionalProperties:false,required:['id','sourceFileId'],properties:{id:string,sourceFileId:string}};
const errors={'401':{description:'Требуется сессия',schema:'ApiError'},'404':{description:'Источник недоступен',schema:'ApiError'},'500':{description:'Внутренняя ошибка',schema:'ApiError'}} as const;
const security:Record<string,string[]>[]=[{sessionCookie:[]}];
const prefix='/api/checks/:id/source-files/:sourceFileId/',open='/checks/{id}/source-files/{sourceFileId}/';
export const railInventoryApiOperations=[
 {id:'getMatrixRailInventorySourcePages',method:'get',fastifyPath:prefix+'rail-inventory-pages',openApiPath:open+'rail-inventory-pages',summary:'Исходные страницы перечня поручней',params,security,responses:{...errors,'200':{description:'Исходный текст',schema:'MatrixInventorySourcePagesRead'}}},
 {id:'previewMatrixRailInventorySource',method:'post',fastifyPath:prefix+'rail-inventory-preview',openApiPath:open+'rail-inventory-preview',summary:'Реконструкция перечня поручней без записи',params,bodySchema:'MatrixRailInventoryPreviewInput',security,responses:{...errors,'200':{description:'Предпросмотр исходного перечня',schema:'MatrixRailInventoryPreviewRead'},'400':{description:'Некорректная область',schema:'ApiError'},'403':{description:'CSRF',schema:'ApiError'},'413':{description:'Лимит запроса',schema:'ApiError'}}}
] as const;
