import { readFileSync } from "node:fs";

const documents = new Map(["matrix-column-pylon-section-v2.schema.json",
  "column-pylon-dimension-literals.schema.json","document-text-v3.schema.json"].map(name =>
  [name,JSON.parse(readFileSync(new URL(`../../../packages/contracts/src/${name}`,import.meta.url),"utf8"))]));
const canonical = documents.get("matrix-column-pylon-section-v2.schema.json");
/** Inline only three allowlisted local canonical documents; no remote or inferred references. */
function inline(value: any, document: any, depth = 0): any {
  if (depth > 60) throw Error("KR060 schema recursion");
  if (Array.isArray(value)) return value.map(item => inline(item,document,depth+1));
  if (!value || typeof value !== "object") return value;
  if (value.$ref) {
    const [file,pointer] = value.$ref.split("#"), target = file ? documents.get(file) : document;
    if (!target || pointer && !/^\/(?:\$defs|definitions)\//.test(pointer)) throw Error("KR060 unsupported schema reference");
    const node = pointer ? pointer.slice(1).split("/").reduce((part: any,key: string) => part?.[key],target) : target;
    if (!node) throw Error("KR060 missing schema reference");
    return inline(node,target,depth+1);
  }
  const output = Object.fromEntries(Object.entries(value).filter(([key]) => !["$id","$schema","prefixItems"].includes(key)
      && !(value.prefixItems && key === "items"))
    .map(([key,child]) => [key,inline(child,document,depth+1)]));
  // Existing Fastify AJV uses Draft7. Project the exact closed 2020 tuple into its equivalent syntax.
  if (value.prefixItems) {
    if (!Array.isArray(value.prefixItems) || value.items !== false) throw Error("KR060 unsupported tuple schema");
    output.items = inline(value.prefixItems,document,depth+1); output.additionalItems = false;
  }
  return output;
}
export const columnPylonSectionV2ApiSchemas = {
  ColumnPylonSectionV2Request:inline(canonical.$defs.request,canonical),
  ColumnPylonSectionV2Journal:inline(canonical.$defs.journal,canonical),
  ColumnPylonSectionV2ReviewList:inline(canonical.$defs.reviewList,canonical),
  ColumnPylonSectionV2SourcePreview:inline(canonical.$defs.sourcePreview,canonical),
  ColumnPylonSectionV2ComparisonPreviewRequest:inline(canonical.$defs.comparisonPreviewRequest,canonical),
  ColumnPylonSectionV2Result:inline(canonical.$defs.result,canonical),
};
const id = { type:"string",minLength:1,maxLength:200 };
const params = { type:"object",additionalProperties:false,required:["id"],properties:{id} };
const security: Record<string,string[]>[] = [{ sessionCookie:[] }];
const error = (description: string) => ({ description,schema:"ApiError" as const });
const errors = { "400":error("Некорректный запрос"),"401":error("Требуется сессия"),
  "403":error("Нет права или CSRF"),"404":error("Объект или источник отсутствует либо недоступен"),
  "409":error("Решение, исходники или доступ изменились"),"413":error("Превышен фиксированный лимит"),
  "500":error("Внутренняя ошибка"),"503":error("Хранилище недоступно") };
const csrf = { name:"X-CSRF-Token",required:true,description:"CSRF текущей сессии",schema:{type:"string"} };
const reviewHeaders = [csrf,{name:"Idempotency-Key",required:true,
  description:"Уникальная команда оценки пары",schema:{type:"string",minLength:8,maxLength:200}}];
const previewHeaders = [csrf];
export const columnPylonSectionV2ApiOperations = [{
  id:"getColumnPylonSectionV2Source",method:"get",fastifyPath:"/api/checks/:id/column-pylon-section-source-v2",
  openApiPath:"/checks/{id}/column-pylon-section-source-v2",summary:"Проверить источник размеров колонн/пилонов",params,
  querystring:{type:"object",additionalProperties:false,required:["sourceFileId"],properties:{sourceFileId:id}},security,
  responses:{...errors,"200":{description:"Исходный текст и точная привязка; без инженерного подтверждения",schema:"ColumnPylonSectionV2SourcePreview"}},
},{
  id:"getColumnPylonSectionV2Reviews",method:"get",fastifyPath:"/api/objects/:id/column-pylon-section-reviews-v2",
  openApiPath:"/objects/{id}/column-pylon-section-reviews-v2",summary:"Последние решения по парам сечений",params,security,
  responses:{...errors,"200":{description:"Неизменяемый журнал и право оценки",schema:"ColumnPylonSectionV2ReviewList"}},
},{
  id:"recordColumnPylonSectionV2Review",method:"post",fastifyPath:"/api/objects/:id/column-pylon-section-reviews-v2",
  openApiPath:"/objects/{id}/column-pylon-section-reviews-v2",summary:"Сохранить явную оценку пары сечений",params,security,
  bodySchema:"ColumnPylonSectionV2Request",openApiHeaders:reviewHeaders,
  responses:{...errors,"201":{description:"Новая или повторённая запись",schema:"ColumnPylonSectionV2Journal"},"428":error("Требуется Idempotency-Key")},
},{
  id:"previewColumnPylonSectionV2Comparison",method:"post",fastifyPath:"/api/objects/:id/column-pylon-section-comparison-v2",
  openApiPath:"/objects/{id}/column-pylon-section-comparison-v2",summary:"Сравнить одну явно рассмотренную пару сечений",params,security,
  bodySchema:"ColumnPylonSectionV2ComparisonPreviewRequest",openApiHeaders:previewHeaders,
  responses:{...errors,"200":{description:"Кандидат либо ограниченный вывод по одной паре",schema:"ColumnPylonSectionV2Result"}},
}] as const;
