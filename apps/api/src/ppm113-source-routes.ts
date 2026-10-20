import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./identity.js";
import { LocalRegistrationError, type PostgresLocalRegistrationService } from "./postgres-local-registration.js";
import { drainageSourcePreviewParams } from "./drainage-source-api-contract.js";
import { DRAINAGE_PREVIEW_BODY_LIMIT, DrainageSourceCandidateInputError,
  parseDrainageSourcePreviewInput } from "./drainage-source-preview.js";
import { ppm113SourceCandidatesJsonSchema } from "./ppm113-source-api-contract.js";
import { previewPpm113SourceCache } from "./ppm113-source-preview.js";

export function registerPpm113SourceRoutes(app: FastifyInstance, options: {
  service?: Pick<PostgresLocalRegistrationService, "coordinateSourceReference">;
  requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedActor | undefined>;
  verifyCsrf: (request: FastifyRequest, reply: FastifyReply, actor: AuthenticatedActor) => boolean;
}): void {
  app.post<{ Params: { id: string }; Body: unknown }>("/api/objects/:id/ppm113-source-candidates/preview", {
    bodyLimit: DRAINAGE_PREVIEW_BODY_LIMIT,
    schema: { params: drainageSourcePreviewParams, response: { 200: ppm113SourceCandidatesJsonSchema } },
  }, async (request, reply) => {
    const actor = await options.requireActor(request, reply);
    if (!actor || !options.verifyCsrf(request, reply, actor)) return;
    reply.header("Cache-Control", "private, no-store");
    try {
      const input = parseDrainageSourcePreviewInput(request.body);
      if (!options.service) throw new LocalRegistrationError(503, "PPM113_PREVIEW_UNAVAILABLE", "Хранилище исходников недоступно");
      const file = await options.service.coordinateSourceReference(request.params.id, input.sourceFileId, input.checkId, actor);
      if (!/^[a-f0-9]{64}$/.test(file.sha256) || file.sha256.length !== 64 || file.mediaType !== "application/pdf")
        throw new Error("INVALID_TRUSTED_SOURCE_REFERENCE");
      const value = previewPpm113SourceCache(input, file.sha256);
      const current = await options.service.coordinateSourceReference(request.params.id, input.sourceFileId, input.checkId, actor);
      if (current.sha256 !== file.sha256 || current.storageKey !== file.storageKey
        || current.byteSize !== file.byteSize || current.mediaType !== file.mediaType)
        throw new LocalRegistrationError(409, "SOURCE_CHANGED", "Исходный файл изменился; обновите проверку");
      return value;
    } catch (error) {
      if (error instanceof LocalRegistrationError)
        return reply.status(error.status).send({ error: error.code, message: error.message });
      if (error instanceof DrainageSourceCandidateInputError)
        return reply.status(error.code === "CACHE_SIZE_LIMIT" ? 413 : 400)
          .send({ error: error.code, message: "Некорректный OCR-кэш или привязка источника" });
      request.log.error({ code: "PPM113_PREVIEW_UNAVAILABLE" }, "PPM113 source preview failed");
      return reply.status(503).send({ error: "PPM113_PREVIEW_UNAVAILABLE", message: "Не удалось проверить OCR-кэш" });
    }
  });
}
