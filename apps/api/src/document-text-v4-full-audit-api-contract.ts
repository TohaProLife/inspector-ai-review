import { readFileSync } from "node:fs";

const audit = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v4-full-audit.schema.json", import.meta.url), "utf8"));
const native = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v4.schema.json", import.meta.url), "utf8"));
/** Inline only allowlisted local canonical nodes. No network references or copied wire DTO. */
function inline(value: any, document: any, depth = 0): any {
  if (depth > 40) throw Error("Cyclic large source-audit schema");
  if (Array.isArray(value)) return value.map(item => inline(item, document, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (value.$ref) {
    const [file, pointer] = value.$ref.split("#");
    const target = file === "document-text-v4.schema.json" ? native : file === "" ? document : undefined;
    if (!target || !pointer?.startsWith("/definitions/")) throw Error("Unsupported large source-audit schema reference");
    const node = pointer.slice(1).split("/").reduce((current: any, key: string) => current?.[key], target);
    if (!node) throw Error("Missing large source-audit schema reference");
    return inline(node, target, depth + 1);
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$id" && key !== "$schema").map(([key, child]) => [key, inline(child, document, depth + 1)]));
}
export const documentTextV4FullAuditApiSchemas = {
  DocumentTextV4FullAuditSourceRead: inline(audit.definitions.sourceRead, audit),
  DocumentTextV4FullAuditPageBatchRead: inline(audit.definitions.pageBatchRead, audit),
  SourceAuditV4FullSourceInput: inline(audit.definitions.startInput, audit),
  DocumentTextV4FullAuditCompleteInput: inline(audit.definitions.completeTransportInput, audit),
};
const id = { type: "string", minLength: 1, maxLength: 200 };
const security: Record<string, string[]>[] = [{ sessionCookie: [] }];
const workerSecurity: Record<string, string[]>[] = [{ workerToken: [] }];
const errors = {
  "400": { description: "Некорректный запрос", schema: "ApiError" },
  "401": { description: "Требуется сессия", schema: "ApiError" },
  "403": { description: "Нет права или CSRF", schema: "ApiError" },
  "404": { description: "Источник отсутствует или недоступен", schema: "ApiError" },
  "500": { description: "Внутренняя ошибка", schema: "ApiError" },
} as const;
const auditHeaders = [{ name: "Idempotency-Key", required: true, description: "Уникальная команда большого аудита исходников", schema: { type: "string", minLength: 8, maxLength: 200 } }, { name: "X-CSRF-Token", required: true, description: "CSRF текущей сессии", schema: { type: "string" } }];
export const documentTextV4FullAuditInternalOperations = [{
  id: "completeSourceAuditV4Full", method: "post", fastifyPath: "/api/internal/v1/jobs/:id/complete-source-audit-v4-full-source-v1", openApiPath: "/internal/v1/jobs/{id}/complete-source-audit-v4-full-source-v1",
  summary: "Завершить DOCUMENT_TEXT_LAYER явного большого аудита исходников",
  params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
  bodySchema: "DocumentTextV4FullAuditCompleteInput", security: workerSecurity,
  responses: { "200": { description: "Завершение или терминальное состояние", schema: "JobControlResponse" }, "400": errors["400"], "401": errors["401"], "404": errors["404"], "409": { description: "Устаревшая попытка или несовместимый профиль", schema: "ApiError" }, "413": { description: "Превышен фиксированный лимит", schema: "ApiError" }, "503": { description: "Durable jobs недоступны", schema: "ApiError" } },
}] as const;
export const documentTextV4FullAuditApiOperations = [{
  id: "startSourceAuditV4FullSource", method: "post", fastifyPath: "/api/objects/:id/source-audit-v4-full-source-v1", openApiPath: "/objects/{id}/source-audit-v4-full-source-v1",
  summary: "Подготовить полный исходный PDF-текст с вертикальными строками в отдельном большом аудите",
  params: { type: "object", additionalProperties: false, required: ["id"], properties: { id } },
  bodySchema: "SourceAuditV4FullSourceInput", security,
  openApiHeaders: auditHeaders,
  responses: { ...errors, "201": { description: "Большой аудит исходников поставлен в очередь", schema: "CheckRun" }, "409": { description: "Конфликт режима или idempotency", schema: "ApiError" }, "428": { description: "Требуется Idempotency-Key", schema: "ApiError" }, "503": { description: "Надёжный запуск недоступен", schema: "ApiError" } },
}, {
  id: "getDocumentTextV4FullSource", method: "get", fastifyPath: "/api/checks/:id/source-text-v4-full-source-v1", openApiPath: "/checks/{id}/source-text-v4-full-source-v1",
  summary: "Полный сохранённый исходный текст большого аудита; видимость и проектная достоверность не подтверждены",
  params: { type: "object", additionalProperties: false, required: ["id"], properties: { id } },
  querystring: { type: "object", additionalProperties: false, required: ["sourceFileId"], properties: { sourceFileId: id } },
  security, responses: { "200": { description: "Полный source audit; без машинных выводов", schema: "DocumentTextV4FullAuditSourceRead" }, "400": errors["400"], "401": errors["401"], "404": errors["404"], "500": errors["500"] },
} , {
  id: "getDocumentTextV4FullSourcePageBatch", method: "get", fastifyPath: "/api/checks/:id/source-text-v4-full-source-v1/pages", openApiPath: "/checks/{id}/source-text-v4-full-source-v1/pages",
  summary: "Пакет исходных страниц полного сохранённого аудита; абсолютные номера и общий hash",
  params: { type: "object", additionalProperties: false, required: ["id"], properties: { id } },
  querystring: { type: "object", additionalProperties: false, required: ["sourceFileId", "startPage", "pageLimit"], properties: {
    sourceFileId: id, startPage: { type: "integer", minimum: 1, maximum: 1024 }, pageLimit: { type: "integer", minimum: 1, maximum: 128 },
    expectedArtifactContentHash: { type: "string", pattern: "^[a-f0-9]{64}$", minLength: 64, maxLength: 64 }
  } },
  security, responses: { "200": { description: "Пакет полного authenticated artifact", schema: "DocumentTextV4FullAuditPageBatchRead" }, "400": errors["400"], "401": errors["401"], "404": errors["404"], "409": { description: "Пакет вне диапазона или изменился artifact hash", schema: "ApiError" }, "500": errors["500"] },
}] as const;
