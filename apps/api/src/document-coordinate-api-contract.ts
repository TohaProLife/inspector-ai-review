import { z } from "zod";
import { documentCoordinatePageFrameSchema, documentCoordinatePreviewInputSchema } from "@inspector-ai/contracts";
const string = { type: "string", minLength: 1, maxLength: 200 } as const;
const json = { type: "object", additionalProperties: true } as const;
export const documentCoordinateApiSchemas = {
  DocumentCoordinatePageFrame: z.toJSONSchema(documentCoordinatePageFrameSchema, { target: "draft-7", io: "input" }),
  DocumentCoordinatePreviewInput: z.toJSONSchema(documentCoordinatePreviewInputSchema, { target: "draft-7", io: "input" }),
  DocumentCoordinatePreviewRead: json,
};
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503].map(status =>
  [String(status), { description: "Ошибка проверки исходника или координатного черновика", schema: "ApiError" as const }]));
const security = [{ sessionCookie: [] as string[] }];
const csrfHeaders = [{ name: "X-CSRF-Token", required: true, description: "CSRF действующей сессии", schema: { type: "string" } }];
export const documentCoordinateApiOperations = [
  { id: "getDocumentCoordinateFrame", method: "get", fastifyPath: "/api/objects/:id/files/:sourceFileId/pages/:pageNumber/document-coordinate-frame",
    openApiPath: "/objects/{id}/files/{sourceFileId}/pages/{pageNumber}/document-coordinate-frame",
    summary: "Каноническая геометрия оригинала из текущего manifest для координатного черновика",
    params: { type: "object", additionalProperties: false, required: ["id", "sourceFileId", "pageNumber"], properties: {
      id: string, sourceFileId: string, pageNumber: { type: "string", pattern: "^[1-9][0-9]{0,4}$" } } },
    querystring: { type: "object", additionalProperties: false, required: ["checkId"], properties: { checkId: string } }, security,
    responses: { ...errors, "200": { description: "Проверенная геометрия страницы; без вымышленных этажа/этапа", schema: "DocumentCoordinatePageFrame" } } },
  { id: "previewDocumentCoordinates", method: "post", fastifyPath: "/api/objects/:id/document-coordinates/preview",
    openApiPath: "/objects/{id}/document-coordinates/preview", summary: "Расчёт по напечатанным координатам без сохранения и геодезического согласования",
    params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: string } },
    bodySchema: "DocumentCoordinatePreviewInput", validateBody: false, security,
    openApiHeaders: csrfHeaders,
    responses: { ...errors, "200": { description: "PREVIEW_ONLY: вычисление или предметный отказ, без machine facts", schema: "DocumentCoordinatePreviewRead" } } },
] as const;
