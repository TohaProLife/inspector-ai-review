import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./identity.js";
import type { AuditedMutationCommand, InspectionRepository } from "./repository.js";
import { fastifySchemaFor } from "./api-contract.js";
import { parseSourceOcrImportBundle, SourceOcrImportError } from "./source-ocr-import.js";
import { parseSourceOcrReview } from "./postgres-source-ocr-import.js";
import { NativeSourceComparisonError } from "./native-source-comparison-error.js";

export function registerSourceOcrImportRoutes(app: FastifyInstance, options: {
  repository: InspectionRepository;
  requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedActor | undefined>;
  verifyCsrf: (request: FastifyRequest, reply: FastifyReply, actor: AuthenticatedActor) => boolean;
  requireIdempotencyKey: (request: FastifyRequest, reply: FastifyReply) => string | undefined;
  auditedCommand: (request: FastifyRequest, actor: AuthenticatedActor, key: string) => AuditedMutationCommand;
}) {
  const fail = (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof SourceOcrImportError || error instanceof NativeSourceComparisonError)
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    request.log.error({ err: error }, "source OCR import unavailable");
    return reply.status(503).send({ error: "SOURCE_OCR_UNAVAILABLE", message: "Не удалось проверить OCR и сохранить историю" });
  };
  const unavailable = (reply: FastifyReply) => reply.status(503).send({ error: "SOURCE_OCR_UNAVAILABLE", message: "Для истории OCR нужно хранилище PostgreSQL" });
  app.get<{ Params: { id: string } }>("/api/checks/:id/source-ocr-imports", { schema: fastifySchemaFor("listSourceOcrImports") }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const actor = await options.requireActor(request, reply); if (!actor) return;
    if (!options.repository.getSourceOcrImports) return unavailable(reply);
    try {
      const value = await options.repository.getSourceOcrImports(request.params.id, actor);
      if (value === "AUTH_REQUIRED") return unavailable(reply);
      if (!value) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
      return value;
    } catch (error) { return fail(error, request, reply); }
  });
  app.post<{ Params: { id: string; sourceFileId: string }; Body: unknown }>("/api/checks/:id/sources/:sourceFileId/source-ocr-imports",
    { schema: fastifySchemaFor("importSourceOcr"), bodyLimit: 8388608 }, async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await options.requireActor(request, reply); if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      const key = options.requireIdempotencyKey(request, reply); if (!key) return;
      if (!options.repository.importSourceOcrCommand) return unavailable(reply);
      try {
        const result = await options.repository.importSourceOcrCommand(request.params.id, request.params.sourceFileId,
          parseSourceOcrImportBundle(request.body), options.auditedCommand(request, actor, key));
        reply.header("Idempotency-Replayed", String(result.replayed)); reply.header("X-Content-SHA256", result.value.contentHash);
        return reply.status(201).send(result.value);
      } catch (error) { return fail(error, request, reply); }
    });
  app.post<{ Params: { id: string }; Body: unknown }>("/api/checks/:id/source-ocr-reviews",
    { schema: fastifySchemaFor("reviewSourceOcr"), bodyLimit: 16384 }, async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await options.requireActor(request, reply); if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      const key = options.requireIdempotencyKey(request, reply); if (!key) return;
      if (!options.repository.reviewSourceOcrCommand) return unavailable(reply);
      try {
        const result = await options.repository.reviewSourceOcrCommand(request.params.id, parseSourceOcrReview(request.body), options.auditedCommand(request, actor, key));
        reply.header("Idempotency-Replayed", String(result.replayed)); reply.header("X-Content-SHA256", result.value.contentHash);
        return reply.status(201).send(result.value);
      } catch (error) { return fail(error, request, reply); }
    });
}
