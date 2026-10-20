const id = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9_-]+$" } as const;
const json = { type: "object", additionalProperties: true } as const;
export const nativeCapacityApiSchemas = {
  NativeCapacityInput: { type: "object", additionalProperties: false,
    required: ["schemaVersion", "pdSourceFileId", "rdSourceFileId"], properties: {
      schemaVersion: { type: "string", const: "native-capacity-command-v1" }, pdSourceFileId: id, rdSourceFileId: id } },
  NativeCapacityRecord: json, NativeCapacityWorkspace: json,
};
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 422, 428, 429, 500, 503].map(code =>
  [String(code), { description: "Сверка недоступна, исходник не подтверждён или превышен лимит", schema: "ApiError" }]));
const shared = { fastifyPath: "/api/checks/:id/native-capacity-comparisons", openApiPath: "/checks/{id}/native-capacity-comparisons",
  params: { type: "object", additionalProperties: false, required: ["id"], properties: { id } },
  security: [{ sessionCookie: [] as string[] }] };
const commandHeaders = [{ name: "X-CSRF-Token", required: true, schema: { type: "string" }, description: "CSRF действующей сессии" },
      { name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 8, maxLength: 200 }, description: "Ключ повтора команды" }];
export const nativeCapacityApiOperations = [
  { ...shared, id: "listNativeCapacityComparisons", method: "get", summary: "История сверки заявленной вместимости по исходному тексту V4",
    responses: { ...errors, "200": { description: "Сохранённые source-only сверки; без инженерных решений", schema: "NativeCapacityWorkspace" } } },
  { ...shared, id: "compareNativeCapacity", method: "post", summary: "Сохранить сверку ПД/РД из двух полных V4 артефактов",
    bodySchema: "NativeCapacityInput", validateBody: false,
    openApiHeaders: commandHeaders,
    responses: { ...errors, "201": { description: "Неизменяемая source-only сверка либо её сохранённый повтор", schema: "NativeCapacityRecord" } } },
] as const;
