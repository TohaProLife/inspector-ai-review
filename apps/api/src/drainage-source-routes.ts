import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./identity.js";
import { LocalRegistrationError, type PostgresLocalRegistrationService } from "./postgres-local-registration.js";
import { drainageSourceCandidatesJsonSchema, drainageSourcePreviewParams } from "./drainage-source-api-contract.js";
import { DRAINAGE_PREVIEW_BODY_LIMIT, DrainageSourceCandidateInputError,
  parseDrainageSourcePreviewInput, previewDrainageSourceCache } from "./drainage-source-preview.js";

/** Ephemeral navigation preview; service exposes only its existing authenticated READ method. */
export function registerDrainageSourceRoutes(app: FastifyInstance, options: {
  service?: Pick<PostgresLocalRegistrationService, "coordinateSourceReference">;
  requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedActor | undefined>;
  verifyCsrf: (request: FastifyRequest, reply: FastifyReply, actor: AuthenticatedActor) => boolean;
}): void {
  app.post<{ Params: { id: string }; Body: unknown }>("/api/objects/:id/drainage-source-candidates/preview", {
    bodyLimit: DRAINAGE_PREVIEW_BODY_LIMIT,
    // Input is validated without Ajv coercion/removal. This is also the OpenAPI response schema.
    schema: { params: drainageSourcePreviewParams, response: { 200: drainageSourceCandidatesJsonSchema } },
  }, async (request, reply) => {
    const actor = await options.requireActor(request, reply);
    if (!actor || !options.verifyCsrf(request, reply, actor)) return;
    reply.header("Cache-Control", "private, no-store");
    try {
      const input = parseDrainageSourcePreviewInput(request.body);
      if (!options.service) throw new LocalRegistrationError(503, "DRAINAGE_PREVIEW_UNAVAILABLE", "Хранилище исходников недоступно");
      const file = await options.service.coordinateSourceReference(request.params.id, input.sourceFileId, input.checkId, actor);
      if (!/^[a-f0-9]{64}$/.test(file.sha256) || file.sha256.length !== 64 || file.mediaType !== "application/pdf")
        throw new Error("INVALID_TRUSTED_SOURCE_REFERENCE");
      const value = previewDrainageSourceCache(input, file.sha256);
      // Recheck active check/manifest and current READ membership after processing. No cached authorization.
      const current = await options.service.coordinateSourceReference(request.params.id, input.sourceFileId, input.checkId, actor);
      if (current.sha256 !== file.sha256 || current.storageKey !== file.storageKey
        || current.byteSize !== file.byteSize || current.mediaType !== file.mediaType)
        throw new LocalRegistrationError(409, "SOURCE_CHANGED", "Исходный файл изменился; обновите проверку");
      return value;
    } catch (error) {
      if (error instanceof LocalRegistrationError)
        return reply.status(error.status).send({ error: error.code, message: error.message });
      if (error instanceof DrainageSourceCandidateInputError)
        return reply.status(error.code === "CACHE_SIZE_LIMIT" ? 413 : 400).send({ error: error.code, message: "Некорректный OCR-кэш или привязка источника" });
      // Never include supplied OCR text/cache or arbitrary exception messages in logs.
      request.log.error({ code: "DRAINAGE_PREVIEW_UNAVAILABLE" }, "drainage source preview failed");
      return reply.status(503).send({ error: "DRAINAGE_PREVIEW_UNAVAILABLE", message: "Не удалось проверить OCR-кэш" });
    }
  });
}
