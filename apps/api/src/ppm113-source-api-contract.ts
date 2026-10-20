import { drainageSourceReferenceJsonSchema, drainageSourcePreviewInputJsonSchema,
  drainageSourcePreviewParams } from "./drainage-source-api-contract.js";

const literal = (value: string | number | null) => ({ type: value === null ? "null" : typeof value, const: value });
const closed = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false,
  required: Object.keys(properties), properties });
export const ppm113SourceCandidatesJsonSchema = closed({
  schemaVersion: literal("ppm113-source-candidates-v1"), policyVersion: literal("ppm113-named-ring-internal-diameter-literals-v1"),
  parameterCode: literal("PPM-113"), purpose: literal("SOURCE_REVIEW_ONLY"), provenance: literal("OCR_CACHE_UNVERIFIED"),
  probability: literal(null), validatedLineCount: { type: "integer", minimum: 0, maximum: 4096 },
  referenceLimit: literal(32), references: { type: "array", maxItems: 32, items: closed({
    ...drainageSourceReferenceJsonSchema.properties,
    rawReferenceType: literal("NAMED_VPV_RING_INTERNAL_DIAMETER"), ringId: { type: "string", minLength: 2, maxLength: 32 },
    rawValue: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,11})(?:[.,][0-9]{1,6})?$", maxLength: 19 },
    rawUnit: { type: "string", enum: ["мм", "см", "м"] },
    internalDiameterMm: { type: "string", pattern: "^[0-9]+(?:\\.[0-9]+)?$", minLength: 1, maxLength: 23 },
  }) }, truncated: { type: "boolean" }, reason: { anyOf: [literal(null), literal("NO_EXACT_NAMED_RING_INTERNAL_DIAMETER_LITERAL")] },
  findings: literal(null), parameterCoverage: literal(null),
});
export const ppm113SourceApiSchemas = { Ppm113SourcePreviewInput: drainageSourcePreviewInputJsonSchema,
  Ppm113SourceCandidates: ppm113SourceCandidatesJsonSchema };
const errors = Object.fromEntries([400,401,403,404,409,413,415,429,500,503].map(status =>
  [String(status), { description: "Ошибка доступа, текущего исходника или OCR-кэша", schema: "ApiError" as const }]));
const security = [{ sessionCookie: [] as string[] }];
const csrfHeaders = [{ name: "X-CSRF-Token", required: true,
  description: "CSRF действующей сессии; операция ничего не сохраняет", schema: { type: "string" } }];
export const ppm113SourceApiOperations = [{ id: "previewPpm113SourceCandidates", method: "post",
  fastifyPath: "/api/objects/:id/ppm113-source-candidates/preview", openApiPath: "/objects/{id}/ppm113-source-candidates/preview",
  summary: "Цитаты OCR с именованным кольцом ВПВ и внутренним диаметром; без инженерного сравнения",
  params: drainageSourcePreviewParams, bodySchema: "Ppm113SourcePreviewInput", validateBody: false,
  security, openApiHeaders: csrfHeaders,
  responses: { ...errors, "200": { description: "SOURCE_REVIEW_ONLY / p=null / неподтверждённый OCR", schema: "Ppm113SourceCandidates" } },
}] as const;
