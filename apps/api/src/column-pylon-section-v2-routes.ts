import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./identity.js";
import type { AuditedMutationCommand, InspectionRepository } from "./repository.js";
import type { ColumnPylonSectionV2Request } from "@inspector-ai/contracts";
import { fastifySchemaFor } from "./api-contract.js";
import { parseColumnPylonSectionReviewWire } from "./matrix-column-pylon-section-v2-wire.js";
import { validateInventoryReviewJsonBytes } from "./matrix-inventory-review.js";

export class ColumnPylonSectionWireError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INPUT_LIMIT") { super(code); }
}

/** Retain integer lexemes and duplicate decoded keys before Fastify/AJV can normalize input. */
async function reviewPreParsing(_request: FastifyRequest, _reply: FastifyReply, payload: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of payload) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 524288) throw new ColumnPylonSectionWireError("INPUT_LIMIT");
    chunks.push(bytes);
  }
  const parsed = parseColumnPylonSectionReviewWire(Buffer.concat(chunks));
  if (parsed.status !== "VALID") throw new ColumnPylonSectionWireError(parsed.reasonCode);
  const bytes = Buffer.from(parsed.canonical);
  const stream = Readable.from([bytes]) as Readable & { receivedEncodedLength: number };
  stream.receivedEncodedLength = length;
  return stream;
}

/** This transport has one string field and no numeric values. Reject extras/duplicates before AJV. */
async function comparisonPreParsing(_request: FastifyRequest, _reply: FastifyReply, payload: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of payload) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += bytes.length;
    if (length > 1024) throw new ColumnPylonSectionWireError("INPUT_LIMIT"); chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  try {
    validateInventoryReviewJsonBytes(bytes);
    const text = new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1
      || !("reviewDecisionId" in value) || typeof value.reviewDecisionId !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/iu.test(value.reviewDecisionId))
      throw new ColumnPylonSectionWireError("INVALID_INPUT");
  } catch { throw new ColumnPylonSectionWireError("INVALID_INPUT"); }
  const stream = Readable.from([bytes]) as Readable & { receivedEncodedLength: number };
  stream.receivedEncodedLength = length; return stream;
}

function failedState(reply: FastifyReply, result: { code: string; message: string }) {
  const status = /(?:INPUT_LIMIT|PDF_IO_LIMIT|PDF_STREAM_OVERSIZE)$/.test(result.code) ? 413
    : /PDF_(?:IO_BUSY|IO_DEADLINE|IO_CANCELLED|STORAGE_UNAVAILABLE)$/.test(result.code) ? 503 : 409;
  return reply.status(status).send({ error: result.code, message: result.message });
}

export function registerColumnPylonSectionV2Routes(app: FastifyInstance, options: {
  repository: InspectionRepository;
  requireActor(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedActor | undefined>;
  verifyCsrf(request: FastifyRequest, reply: FastifyReply, actor: AuthenticatedActor): boolean;
  requireIdempotencyKey(request: FastifyRequest, reply: FastifyReply): string | undefined;
  auditedCommand(request: FastifyRequest, actor: AuthenticatedActor, idempotencyKey: string): AuditedMutationCommand;
}) {
  const store = options.repository;
  const unavailable = (reply: FastifyReply) => reply.status(503).send({ error: "KR060_UNAVAILABLE", message: "Хранилище пар сечений недоступно" });
  const missing = (reply: FastifyReply) => reply.status(404).send({ error: "NOT_FOUND", message: "Объект, источник или проверенное решение не найдены" });
  app.get<{ Params: { id: string }; Querystring: { sourceFileId: string } }>(
    "/api/checks/:id/column-pylon-section-source-v2", { schema: fastifySchemaFor("getColumnPylonSectionV2Source") }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor) return;
      if (!store.getColumnPylonSectionV2Source) return unavailable(reply);
      const value = await store.getColumnPylonSectionV2Source(request.params.id, request.query.sourceFileId, actor);
      if (!value) return missing(reply);
      reply.header("Cache-Control", "private, no-store"); return value;
    });
  app.get<{ Params: { id: string } }>("/api/objects/:id/column-pylon-section-reviews-v2",
    { schema: fastifySchemaFor("getColumnPylonSectionV2Reviews") }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor) return;
      if (!store.getColumnPylonSectionV2Reviews) return unavailable(reply);
      const value = await store.getColumnPylonSectionV2Reviews(request.params.id, actor);
      if (!value) return missing(reply);
      reply.header("Cache-Control", "private, no-store"); return value;
    });
  app.post<{ Params: { id: string }; Body: ColumnPylonSectionV2Request }>("/api/objects/:id/column-pylon-section-reviews-v2",
    { schema: fastifySchemaFor("recordColumnPylonSectionV2Review"), bodyLimit: 524288, preParsing: reviewPreParsing }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      if (!actor.capabilities.includes("SOURCE_REVIEW") || !(await store.hasObjectPermission(request.params.id, actor, "REVIEW_DECIDE")))
        return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права оценивать пару сечений" });
      const key = options.requireIdempotencyKey(request, reply); if (!key) return;
      if (!store.recordColumnPylonSectionV2ReviewCommand) return unavailable(reply);
      const result = await store.recordColumnPylonSectionV2ReviewCommand(request.params.id, request.body, options.auditedCommand(request, actor, key));
      if (result.kind === "not_found") return missing(reply);
      if (result.kind === "forbidden") return reply.status(403).send({ error: "FORBIDDEN", message: "Нет права оценивать пару сечений" });
      if (result.kind === "idempotency_conflict") return reply.status(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "Ключ повтора уже использован" });
      if (result.kind === "invalid_state") return failedState(reply, result);
      if (result.replayed) reply.header("Idempotency-Replayed", "true");
      reply.header("Cache-Control", "private, no-store"); return reply.status(201).send(result.value);
    });
  app.post<{ Params: { id: string }; Body: { reviewDecisionId: string } }>("/api/objects/:id/column-pylon-section-comparison-v2",
    { schema: fastifySchemaFor("previewColumnPylonSectionV2Comparison"), bodyLimit: 1024, preParsing:comparisonPreParsing }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      if (!store.previewColumnPylonSectionV2Comparison) return unavailable(reply);
      const value = await store.previewColumnPylonSectionV2Comparison(request.params.id, request.body.reviewDecisionId, actor);
      if (!value) return missing(reply);
      if ("kind" in value && value.kind === "invalid_state") return failedState(reply, value);
      reply.header("Cache-Control", "private, no-store"); return value;
    });
}
