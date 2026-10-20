const string = { type: "string" } as const;
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
export const iaisPullApiSchemas = {
  IaisProtocolPull: { type: "object", additionalProperties: false,
    required: ["schemaVersion", "mode", "payloadPolicy", "signature", "externalDelivery", "protocol", "currentValidity", "readAt", "canonicalSnapshot", "formats", "limitations"],
    properties: {
      schemaVersion: { const: "iais-pull-facade-v1", type: "string" }, mode: { const: "MOCK_PULL_FACADE", type: "string" },
      payloadPolicy: { const: "FULL_SNAPSHOT_MOCK_ONLY", type: "string" },
      signature: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { const: "NOT_CONFIGURED", type: "string" } } },
      externalDelivery: { type: "object", additionalProperties: false, required: ["status", "outboundRequests"], properties: { status: { const: "NOT_CONFIRMED", type: "string" }, outboundRequests: { type: "integer", const: 0 } } },
      protocol: { type: "object", additionalProperties: false, required: ["id", "checkId", "objectId", "version", "status", "snapshotHash"],
        properties: { id: string, checkId: string, objectId: string, version: { type: "integer", minimum: 1 }, status: { type: "string", const: "FINAL" }, snapshotHash: hash } },
      currentValidity: { type: "object", additionalProperties: false, required: ["status", "checkedAt"], properties: { status: { type: "string", const: "VALID" }, checkedAt: { type: "string", format: "date-time" } } },
      readAt: { type: "string", format: "date-time" },
      canonicalSnapshot: { type: "object", additionalProperties: false, required: ["canonicalizationVersion", "encoding", "byteSize", "contentHash", "json"],
        properties: { canonicalizationVersion: { type: "string", const: "inspector-c14n-v1" }, encoding: { type: "string", const: "UTF-8" }, byteSize: { type: "integer", minimum: 1, maximum: 8388608 }, contentHash: hash, json: string } },
      formats: { type: "object", additionalProperties: false, required: ["canonicalJson", "pdf", "docx", "xml"], properties: { canonicalJson: string, pdf: string, docx: string, xml: string } },
      limitations: { type: "array", items: string },
    } },
} as const;
export const iaisPullApiOperations = [{
  id: "getIaisProtocolPull", method: "get", fastifyPath: "/api/integrations/iais/protocols/:id", openApiPath: "/integrations/iais/protocols/{id}",
  summary: "Хакатонный тестовый pull facade действующего FINAL-протокола; без внешней доставки и подписи",
  params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", minLength: 1, maxLength: 200 } } },
  security: [{ sessionCookie: [] }] as Array<Record<string, string[]>>,
  responses: { "200": { description: "MOCK_PULL_FACADE: точные canonical JSON bytes в UTF-8 строке и ссылки на представления", schema: "IaisProtocolPull" },
    ...Object.fromEntries([400, 401, 404, 409, 413, 500, 503].map(code => [String(code), { description: "Протокол недоступен, отозван или его canonical snapshot не прошёл проверку", schema: "ApiError" }])) },
}] as const;
