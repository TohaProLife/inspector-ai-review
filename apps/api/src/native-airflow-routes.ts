import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./identity.js";
import type { AuditedMutationCommand, InspectionRepository } from "./repository.js";
import { fastifySchemaFor } from "./api-contract.js";
import { parseNativeAirflowInput } from "./native-airflow-input.js";

import { NativeSourceComparisonError as NativeAirflowError } from "./native-source-comparison-error.js";

export function registerNativeAirflowRoutes(app: FastifyInstance, options: {
  repository: InspectionRepository;
  requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedActor | undefined>;
  verifyCsrf: (request: FastifyRequest, reply: FastifyReply, actor: AuthenticatedActor) => boolean;
  requireIdempotencyKey: (request: FastifyRequest, reply: FastifyReply) => string | undefined;
  auditedCommand: (request: FastifyRequest, actor: AuthenticatedActor, key: string) => AuditedMutationCommand;
}) {
  const fail = (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof NativeAirflowError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    request.log.error({ err: error }, "native airflow comparison unavailable");
    return reply.status(503).send({ error: "NATIVE_AIRFLOW_UNAVAILABLE", message: "Не удалось проверить и сохранить сверку исходников" });
  };
  const unavailable = (reply: FastifyReply) => reply.status(503).send({ error: "NATIVE_AIRFLOW_UNAVAILABLE", message: "Для сохранения сверки нужно хранилище PostgreSQL" });
  app.get<{ Params: { id: string } }>("/api/checks/:id/native-airflow-comparisons",
    { schema: fastifySchemaFor("listNativeAirflowComparisons") }, async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await options.requireActor(request, reply); if (!actor) return;
      if (!options.repository.getNativeAirflowComparisons) return unavailable(reply);
      try {
        const value = await options.repository.getNativeAirflowComparisons(request.params.id, actor);
        if (value === "AUTH_REQUIRED") return unavailable(reply);
        if (!value) return reply.status(404).send({ error: "NOT_FOUND", message: "Проверка недоступна" });
        return value;
      } catch (error) { return fail(error, request, reply); }
    });
  app.post<{ Params: { id: string }; Body: unknown }>("/api/checks/:id/native-airflow-comparisons",
    { schema: fastifySchemaFor("compareNativeAirflow"), bodyLimit: 4096 }, async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const actor = await options.requireActor(request, reply); if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      const key = options.requireIdempotencyKey(request, reply); if (!key) return;
      if (!options.repository.compareNativeAirflowCommand) return unavailable(reply);
      try {
        const input = parseNativeAirflowInput(request.body);
        const { value, replayed } = await options.repository.compareNativeAirflowCommand(request.params.id, input, options.auditedCommand(request, actor, key));
        reply.header("Idempotency-Replayed", String(replayed)); reply.header("X-Content-SHA256", value.contentHash);
        return reply.status(201).send(value);
      } catch (error) { return fail(error, request, reply); }
    });
}
