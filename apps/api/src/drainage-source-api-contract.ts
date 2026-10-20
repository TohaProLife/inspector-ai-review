import { DRAINAGE_CACHE_MAX_BYTES } from "./drainage-source-preview.js";

const str = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum: number, maximum: number) => ({ type: "integer", minimum, maximum });
const literal = (value: string | number | boolean | null) => ({
  type: value === null ? "null" : typeof value === "number" ? "integer" : typeof value, const: value });
const closed = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false,
  required: Object.keys(properties), properties });
const sha = { type: "string", pattern: "^[a-f0-9]{64}$", minLength: 64, maxLength: 64 };
const sourceId = { ...str(128), pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" };
const span = { type: "array", minItems: 2, maxItems: 2, items: integer(0, 500) };
const bbox = { type: "array", minItems: 4, maxItems: 4, items: integer(0, 32768) };
const declaredOcr = closed({ providerProfileId: str(200), script: str(32), score: { type: "number", minimum: 0, maximum: 1 } });
const declaredGeometry = closed({ status: literal("DECLARED_UNVERIFIED"), overlayPermitted: literal(false),
  renderSha256: sha, rendererProfileId: str(200), dpi: integer(1, 1200), widthPx: integer(1, 32768), heightPx: integer(1, 32768), bboxPx: bbox });
export const drainageSourceReferenceJsonSchema = closed({ status: literal("SOURCE_CANDIDATE"), provenance: literal("OCR_CACHE_UNVERIFIED"),
  probability: { type: "null" }, rawReferenceType: { type: "string", enum: ["DRAINAGE_PLAN_REFERENCE", "DRAINAGE_TRAY_REFERENCE", "DRAINAGE_PIPE_REFERENCE", "TUBULAR_DRAINAGE_REFERENCE"] },
  rawOcrText: { type: "string", maxLength: 500 }, matchedText: str(500), matchedSpanCodepoints: span,
  cacheSha256: sha, cacheJsonPointer: { type: "string", pattern: "^/artifact/lines/(0|[1-9][0-9]{0,3})/text$" },
  sourceFileId: sourceId, sourcePdfSha256: sha, declaredCachePage: integer(1, 100000), declaredOcr, declaredGeometry });
export const drainageSourceCandidatesJsonSchema = closed({ schemaVersion: literal("drainage-source-candidates-v1"),
  policyVersion: literal("drainage-raw-reference-literals-v1"), purpose: literal("SOURCE_REVIEW_ONLY"), provenance: literal("OCR_CACHE_UNVERIFIED"),
  probability: { type: "null" }, validatedLineCount: integer(0, 4096), referenceLimit: literal(32),
  references: { type: "array", maxItems: 32, items: drainageSourceReferenceJsonSchema }, truncated: { type: "boolean" },
  findings: { type: "null" }, parameterCoverage: { type: "null" } });
export const drainageSourcePreviewInputJsonSchema = closed({ checkId: { ...str(200), pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" },
  sourceFileId: sourceId, declaredCachePage: integer(1, 100000),
  cacheJson: { type: "string", maxLength: DRAINAGE_CACHE_MAX_BYTES, description: "Exact cache JSON text; UTF-8 bytes <=1048576, checked without reserialization. Declared OCR/render metadata remains unverified." } });
export const drainageSourceApiSchemas = {
  DrainageSourcePreviewInput: drainageSourcePreviewInputJsonSchema,
  DrainageSourceCandidates: drainageSourceCandidatesJsonSchema,
};
export const drainageSourcePreviewParams = closed({ id: { ...str(200), pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" } });
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 429, 500, 503].map(status =>
  [String(status), { description: "Ошибка доступа, текущей проверки или закрытого OCR-кэша", schema: "ApiError" as const }]));
const security = [{ sessionCookie: [] as string[] }];
const csrfHeaders = [{ name: "X-CSRF-Token", required: true,
  description: "CSRF действующей сессии; операция ничего не сохраняет", schema: { type: "string" } }];
export const drainageSourceApiOperations = [{ id: "previewDrainageSourceCandidates", method: "post",
  fastifyPath: "/api/objects/:id/drainage-source-candidates/preview", openApiPath: "/objects/{id}/drainage-source-candidates/preview",
  summary: "Непроверенные цитаты OCR-кэша для просмотра исходника; без сохранения, findings и coverage",
  params: drainageSourcePreviewParams, bodySchema: "DrainageSourcePreviewInput", validateBody: false,
  security, openApiHeaders: csrfHeaders,
  responses: { ...errors, "200": { description: "SOURCE_REVIEW_ONLY / OCR_CACHE_UNVERIFIED; geometry overlay forbidden", schema: "DrainageSourceCandidates" } },
}] as const;
