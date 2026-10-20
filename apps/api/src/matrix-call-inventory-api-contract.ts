import {z} from 'zod';
import {matrixCallInventoryScopeInputSchema,matrixCallInventoryScopeDecisionSchema,matrixCallInventorySelectionSchema,
 matrixCallInventoryTargetSchema,matrixCallSourceInventorySchema} from '@inspector-ai/contracts';
const json=(schema:z.ZodType,io:'input'|'output')=>z.toJSONSchema(schema,{target:'draft-7',io});
const string={type:'string',minLength:1,maxLength:200};
export const callInventoryApiSchemas={
 MatrixCallInventoryScopeInput:json(matrixCallInventoryScopeInputSchema,'input'),
 MatrixCallInventoryScopeDecision:json(matrixCallInventoryScopeDecisionSchema,'output'),
 MatrixCallInventoryPreviewInput:{type:'object',additionalProperties:false,required:['selection'],properties:{selection:json(matrixCallInventorySelectionSchema,'input')}},
 MatrixCallInventoryPreviewRead:{type:'object',additionalProperties:false,required:['checkId','sourceFileId','sourceSha256','latestReviewHash','result'],properties:{
 checkId:string,sourceFileId:string,sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'},latestReviewHash:{type:'string',nullable:true},
 result:{oneOf:[{type:'object',additionalProperties:false,required:['schemaVersion','status','inventory'],properties:{schemaVersion:{const:'matrix-odi123-call-inventory-source-result-v1'},status:{const:'RECONSTRUCTED'},inventory:json(matrixCallSourceInventorySchema,'output')}},
 {type:'object',additionalProperties:false,required:['schemaVersion','status','reasonCode'],properties:{schemaVersion:{const:'matrix-odi123-call-inventory-source-result-v1'},status:{const:'ABSTAIN'},reasonCode:{type:'string'}}}]},target:json(matrixCallInventoryTargetSchema,'output')}}
};
const params={type:'object',additionalProperties:false,required:['id','sourceFileId'],properties:{id:string,sourceFileId:string}};
const errors={'401':{description:'Требуется сессия',schema:'ApiError'},'404':{description:'Источник недоступен',schema:'ApiError'},'500':{description:'Внутренняя ошибка',schema:'ApiError'}} as const;
const security:Record<string,string[]>[]=[{sessionCookie:[]}];
const prefix='/api/checks/:id/source-files/:sourceFileId/',open='/checks/{id}/source-files/{sourceFileId}/';
export const callInventoryApiOperations=[
 {id:'getMatrixCallInventorySourcePages',method:'get',fastifyPath:prefix+'call-inventory-pages',openApiPath:open+'call-inventory-pages',summary:'Исходные страницы перечня вызова',params,security,responses:{...errors,'200':{description:'Исходный текст',schema:'MatrixInventorySourcePagesRead'}}},
 {id:'previewMatrixCallInventorySource',method:'post',fastifyPath:prefix+'call-inventory-preview',openApiPath:open+'call-inventory-preview',summary:'Реконструкция перечня вызова без записи',params,bodySchema:'MatrixCallInventoryPreviewInput',security,responses:{...errors,'200':{description:'Предпросмотр исходного перечня',schema:'MatrixCallInventoryPreviewRead'},'400':{description:'Некорректная область',schema:'ApiError'},'403':{description:'CSRF',schema:'ApiError'},'413':{description:'Лимит запроса',schema:'ApiError'}}}
] as const;
