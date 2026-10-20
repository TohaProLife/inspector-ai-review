import { readFileSync } from "node:fs";

const audit = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v3-audit.schema.json", import.meta.url), "utf8"));
const native = JSON.parse(readFileSync(new URL("../../../packages/contracts/src/document-text-v3.schema.json", import.meta.url), "utf8"));
/** Inline only the two local canonical schemas. No network resolution or parallel DTO. */
function inline(value: any, document: any, depth = 0): any {
  if (depth > 32) throw Error("Cyclic source-audit schema");
  if (Array.isArray(value)) return value.map(item => inline(item, document, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (value.$ref) {
    const [file, pointer] = value.$ref.split("#");
    const target = file === "document-text-v3.schema.json" ? native : file === "" ? document : undefined;
    if (!target || !pointer?.startsWith("/definitions/")) throw Error("Unsupported source-audit schema reference");
    const node = pointer.slice(1).split("/").reduce((current: any, key: string) => current?.[key], target);
    if (!node) throw Error("Missing source-audit schema reference");
    return inline(node, target, depth + 1);
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$id" && key !== "$schema")
    .map(([key, child]) => [key, inline(child, document, depth + 1)]));
}
export const documentTextV3AuditApiSchemas = { DocumentTextV3AuditSourceRead: inline(audit.definitions.sourceRead, audit) };
const id = { type: "string", minLength: 1, maxLength: 200 };
const security: Record<string, string[]>[] = [{ sessionCookie: [] }];
export const documentTextV3AuditApiOperations = [{
  id: "getDocumentTextV3Source", method: "get", fastifyPath: "/api/checks/:id/source-text-v3", openApiPath: "/checks/{id}/source-text-v3",
  summary: "Полный сохранённый исходный текст v3; видимость и проектная достоверность не подтверждены",
  params: { type: "object", additionalProperties: false, required: ["id"], properties: { id } },
  querystring: { type: "object", additionalProperties: false, required: ["sourceFileId"], properties: { sourceFileId: id } },
  security, responses: {
    "200": { description: "Source audit; без машинных выводов", schema: "DocumentTextV3AuditSourceRead" },
    "400": { description: "Некорректный запрос", schema: "ApiError" },
    "401": { description: "Требуется сессия", schema: "ApiError" },
    "404": { description: "Источник отсутствует или недоступен", schema: "ApiError" },
    "500": { description: "Внутренняя ошибка", schema: "ApiError" },
  },
}] as const;
