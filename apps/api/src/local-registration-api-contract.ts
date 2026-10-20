const string = { type: "string", minLength: 1, maxLength: 256 } as const;
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const json = { type: "object", additionalProperties: true } as const;
const frameProperties = { sourceFileId: string, sourceSha256: sha,
  pdfPageNumber: { type: "integer", minimum: 1, maximum: 10_000 }, pageFrameSha256: sha,
  coordinateSpace: { type: "string", enum: ["CANONICAL_VISIBLE_NORMALIZED"] },
  visibleWidthPt: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
  visibleHeightPt: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
  rotate: { type: "integer", enum: [0, 90, 180, 270] }, objectKey: string, floorKey: string, phaseKey: string, revisionKey: string };

export const localRegistrationApiSchemas = {
  LocalRegistrationFrame: { type: "object", additionalProperties: false,
    required: Object.keys(frameProperties), properties: frameProperties },
  LocalRegistrationPreviewInput: { type: "object", additionalProperties: false, required: ["checkId", "packet"],
    properties: { checkId: string, packet: json } },
  LocalRegistrationSaveInput: { type: "object", additionalProperties: false,
    required: ["schemaVersion", "checkId", "packet", "expectedReviewHash", "originalsReviewed", "stableReferencesConfirmed", "scopeConfirmed", "reason"],
    properties: { schemaVersion: { type: "string", enum: ["local-document-registration-review-command-v1"] },
      checkId: string, packet: json, expectedReviewHash: { ...sha, nullable: true },
      originalsReviewed: { type: "boolean", enum: [true] }, stableReferencesConfirmed: { type: "boolean", enum: [true] },
      scopeConfirmed: { type: "boolean", enum: [true] }, reason: { type: "string", minLength: 3, maxLength: 2000 } } },
  LocalRegistrationPreviewRead: { type: "object", additionalProperties: false, required: ["status", "result"],
    properties: { status: { type: "string", enum: ["PREVIEW_ONLY"] }, result: json } },
  LocalRegistrationWorkspaceRead: { type: "object", additionalProperties: false,
    required: ["objectId", "checkId", "lifecycle", "canReview", "expectedReviewHash", "latest", "history"],
    properties: { objectId: string, checkId: { ...string, nullable: true }, lifecycle: { type: "string", enum: ["OPEN", "FINALIZED"] },
      canReview: { type: "boolean" }, expectedReviewHash: { ...sha, nullable: true }, latest: { ...json, nullable: true },
      history: { type: "array", maxItems: 20, items: json } } },
  LocalRegistrationReviewRead: json,
} as const;

const objectParams = { type: "object", additionalProperties: false, required: ["id"], properties: { id: string } };
const responses = { "400": { description: "Ошибка входных данных", schema: "ApiError" },
  "401": { description: "Требуется действующая сессия", schema: "ApiError" },
  "403": { description: "Нет права или CSRF не подтверждён", schema: "ApiError" },
  "404": { description: "Объект или источник недоступен", schema: "ApiError" },
  "409": { description: "Run, lifecycle или ключ команды изменился", schema: "ApiError" },
  "412": { description: "Последнее решение изменилось", schema: "ApiError" },
  "415": { description: "Источник не PDF", schema: "ApiError" },
  "422": { description: "Исходная геометрия или привязка не подтверждены", schema: "ApiError" },
  "428": { description: "Отсутствует ключ команды", schema: "ApiError" },
  "429": { description: "Проверка страниц занята", schema: "ApiError" },
  "503": { description: "Durable geometry или storage недоступны", schema: "ApiError" },
  "500": { description: "Внутренняя ошибка", schema: "ApiError" } } as const;
const security = [{ sessionCookie: [] as string[] }];
const csrfHeaders = [{ name: "X-CSRF-Token", required: true, description: "CSRF серверной сессии", schema: { type: "string" } }];
const commandHeaders = [...csrfHeaders,
  { name: "Idempotency-Key", required: true, description: "Ключ команды; expectedReviewHash обязателен в body", schema: { type: "string" } }];
export const localRegistrationApiOperations = [
  { id: "getLocalRegistrationFrame", method: "get", fastifyPath: "/api/objects/:id/files/:sourceFileId/pages/:pageNumber/local-registration-frame",
    openApiPath: "/objects/{id}/files/{sourceFileId}/pages/{pageNumber}/local-registration-frame",
    summary: "Проверить SHA оригинала и каноническую геометрию страницы для локальной регистрации",
    params: { type: "object", additionalProperties: false, required: ["id", "sourceFileId", "pageNumber"],
      properties: { id: string, sourceFileId: string, pageNumber: { type: "string", pattern: "^[1-9][0-9]{0,4}$" } } },
    querystring: { type: "object", additionalProperties: false, required: ["floorKey", "phaseKey"], properties: { floorKey: string, phaseKey: string } },
    security, responses: { ...responses, "200": { description: "SHA-bound frame; этаж и этап подлежат ручной проверке", schema: "LocalRegistrationFrame" } } },
  { id: "getLocalRegistrationWorkspace", method: "get", fastifyPath: "/api/objects/:id/local-registrations",
    openApiPath: "/objects/{id}/local-registrations", summary: "Прочитать сохранённую локальную регистрацию текущего run и историю",
    params: objectParams, security, responses: { ...responses,
      "200": { description: "Append-only решения, отдельно от machine results", schema: "LocalRegistrationWorkspaceRead" } } },
  { id: "previewLocalRegistration", method: "post", fastifyPath: "/api/objects/:id/local-registrations/preview",
    openApiPath: "/objects/{id}/local-registrations/preview", summary: "Предварительный расчёт локальной регистрации без сохранения решения",
    params: objectParams, bodySchema: "LocalRegistrationPreviewInput", security,
    openApiHeaders: csrfHeaders,
    responses: { ...responses, "200": { description: "Только PREVIEW_ONLY, включая предметный abstention", schema: "LocalRegistrationPreviewRead" } } },
  { id: "saveLocalRegistrationReview", method: "post", fastifyPath: "/api/objects/:id/local-registrations/reviews",
    openApiPath: "/objects/{id}/local-registrations/reviews", summary: "Сохранить authenticated append-only решение по локальным опорам",
    params: objectParams, bodySchema: "LocalRegistrationSaveInput", security,
    openApiHeaders: commandHeaders,
    responses: { ...responses, "201": { description: "Сохранённое решение или точный replay", schema: "LocalRegistrationReviewRead" } } },
] as const;
