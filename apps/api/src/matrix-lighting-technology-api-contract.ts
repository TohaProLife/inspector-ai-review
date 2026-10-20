import {readFileSync} from 'node:fs';
const names=['matrix-lighting-technology-source-v3.schema.json','matrix-lighting-technology-comparison.schema.json','document-text-v3.schema.json','matrix-lighting-technology-execution.schema.json'];
const documents=new Map(names.map(name=>[name,JSON.parse(readFileSync(new URL('../../../packages/contracts/src/'+name,import.meta.url),'utf8'))]));
function inline(value:any,document:any,depth=0):any{
 if(depth>40)throw Error('Lighting API schema recursion');
 if(Array.isArray(value))return value.map(v=>inline(v,document,depth+1));
 if(!value||typeof value!=='object')return value;
 if(value.$ref){const [file,pointer]=value.$ref.split('#'),target=file?documents.get(file):document;
  if(!target||!pointer?.startsWith('/definitions/'))throw Error('Unknown lighting API schema reference');
  const node=pointer.slice(1).split('/').reduce((d:any,k:string)=>d?.[k],target);if(!node)throw Error('Missing lighting API schema node');return inline(node,target,depth+1);}
 return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='$id'&&k!=='$schema').map(([k,v])=>[k,inline(v,document,depth+1)]));
}
const source=documents.get(names[0]),comparison=documents.get(names[1]),execution=documents.get(names[3]);
const id={type:'string',minLength:1,maxLength:200},sha={type:'string',pattern:'^[a-f0-9]{64}$'};
export const lightingTechnologyApiSchemas={
 MatrixLightingTechnologyComparisons:inline(execution.definitions.comparisons,execution),
 MatrixLightingTechnologyComparisonEvidence:inline(execution.definitions.evidence,execution),
 LightingTechnologyPreviewInput:{type:'object',additionalProperties:false,required:['selection'],properties:{selection:inline(source.definitions.selection,source)}},
 LightingTechnologyPreviewRead:{type:'object',additionalProperties:false,required:['checkId','sourceFileId','sourceSha256','latestReviewHash','result'],properties:{checkId:id,sourceFileId:id,sourceSha256:sha,latestReviewHash:{anyOf:[sha,{type:'null'}]},result:inline(source.definitions.result,source),target:inline(comparison.definitions.target,comparison)}},
 SourceAuditV3Input:{type:'object',additionalProperties:false,properties:{}},
 MatrixLightingTechnologyScopeInput:inline(comparison.definitions.scopeRequest,comparison),
 MatrixLightingTechnologyScopeDecision:inline(comparison.definitions.scopeDecision,comparison),
};
const security:Record<string,string[]>[]=[{sessionCookie:[]}];
const errors={'400':{description:'Некорректный запрос',schema:'ApiError'},'401':{description:'Требуется сессия',schema:'ApiError'},'403':{description:'Нет права или CSRF',schema:'ApiError'},'404':{description:'Источник недоступен',schema:'ApiError'},'500':{description:'Внутренняя ошибка',schema:'ApiError'}} as const;
const auditHeaders=[{name:'Idempotency-Key',required:true,description:'Уникальная команда подготовки исходного текста',schema:{type:'string',minLength:8,maxLength:200}},{name:'X-CSRF-Token',required:true,description:'CSRF текущей сессии',schema:{type:'string'}}];
export const lightingTechnologyApiOperations=[
 {id:'previewMatrixLightingTechnologySource',method:'post',fastifyPath:'/api/checks/:id/source-files/:sourceFileId/lighting-technology-preview',openApiPath:'/checks/{id}/source-files/{sourceFileId}/lighting-technology-preview',summary:'Проверить буквальное указание технологии по полному сохранённому PDF-тексту',params:{type:'object',additionalProperties:false,required:['id','sourceFileId'],properties:{id,sourceFileId:id}},bodySchema:'LightingTechnologyPreviewInput',security,responses:{...errors,'200':{description:'Исходное указание; без подтверждения корректности проекта',schema:'LightingTechnologyPreviewRead'}}},
 {id:'startSourceAuditV3',method:'post',fastifyPath:'/api/objects/:id/source-audit-v3',openApiPath:'/objects/{id}/source-audit-v3',summary:'Подготовить полный исходный PDF-текст v3 без машинных выводов',params:{type:'object',additionalProperties:false,required:['id'],properties:{id}},bodySchema:'SourceAuditV3Input',security,openApiHeaders:auditHeaders,responses:{...errors,'201':{description:'Аудит исходников поставлен в очередь',schema:'CheckRun'},'409':{description:'Конфликт режима или idempotency',schema:'ApiError'},'428':{description:'Требуется Idempotency-Key',schema:'ApiError'},'503':{description:'Надёжный запуск недоступен',schema:'ApiError'}}},
] as const;
