const id = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9_-]+$" } as const;
const json = { type: "object", additionalProperties: true } as const;
export const sourceOcrImportApiSchemas = { SourceOcrImportBundle: json, SourceOcrImportRecord: json, SourceOcrImportWorkspace: json,
  SourceOcrReviewInput: json, SourceOcrReviewRecord: json };
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 422, 428, 429, 500, 503].map(code =>
  [String(code), { description: "Импорт/проверка OCR недоступны, вход не подтверждён или превышен лимит", schema: "ApiError" }]));
const shared = { security: [{ sessionCookie: [] as string[] }] };
const commandHeaders = [{ name: "X-CSRF-Token", required: true, schema: { type: "string" }, description: "CSRF действующей сессии" },
  { name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 8, maxLength: 200 }, description: "Ключ повтора команды" }];
const params = { type: "object", additionalProperties: false, required: ["id"], properties: { id } } as const;
export const sourceOcrImportApiOperations = [
  { ...shared, id: "listSourceOcrImports", method: "get", fastifyPath: "/api/checks/:id/source-ocr-imports", openApiPath: "/checks/{id}/source-ocr-imports", params,
    summary: "История отдельных импортов OCR и ручной сверки текста; исходный V4 не меняется",
    responses: { ...errors, "200": { description: "Неподтверждённые импорты и журнал ручной сверки", schema: "SourceOcrImportWorkspace" } } },
  { ...shared, id: "importSourceOcr", method: "post", fastifyPath: "/api/checks/:id/sources/:sourceFileId/source-ocr-imports", openApiPath: "/checks/{id}/sources/{sourceFileId}/source-ocr-imports",
    params: { type: "object", additionalProperties: false, required: ["id", "sourceFileId"], properties: { id, sourceFileId: id } },
    summary: "Импорт сохранённых OCR responses для точного набора пропусков V4 (без запуска провайдера)", bodySchema: "SourceOcrImportBundle", validateBody: false,
    openApiHeaders: commandHeaders, responses: { ...errors, "201": { description: "Отдельный неизменяемый импорт; p=null, coverageDelta=0", schema: "SourceOcrImportRecord" } } },
  { ...shared, id: "reviewSourceOcr", method: "post", fastifyPath: "/api/checks/:id/source-ocr-reviews", openApiPath: "/checks/{id}/source-ocr-reviews", params,
    summary: "Сохранить только ручную сверку точной OCR-строки с исходником", bodySchema: "SourceOcrReviewInput", validateBody: false,
    openApiHeaders: commandHeaders, responses: { ...errors, "201": { description: "Журнал ручной сверки; инженерный статус и coverage не меняются", schema: "SourceOcrReviewRecord" } } },
] as const;
