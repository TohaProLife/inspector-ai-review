import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalDocumentFrame, LocalDocumentRegistrationPacket, LocalDocumentRegistrationPreviewInput,
  LocalDocumentRegistrationSaveInput } from "@inspector-ai/contracts";
import { fastifySchemaFor } from "./api-contract.js";
import type { AuthenticatedActor } from "./identity.js";
import { readLocalRegistrationPageFrame } from "./local-registration-page-frame.js";
import { LocalRegistrationError, type PostgresLocalRegistrationService } from "./postgres-local-registration.js";
import { PdfPreviewError } from "./pdf-preview.js";
import type { AuditedMutationCommand } from "./repository.js";
import type { ObjectStorage } from "./storage.js";
import { readVerifiedOriginalPdf } from "./verified-pdf-storage.js";

export function registerLocalRegistrationRoutes(app: FastifyInstance, options: {
  service?: PostgresLocalRegistrationService; storage: ObjectStorage;
  requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedActor | undefined>;
  verifyCsrf: (request: FastifyRequest, reply: FastifyReply, actor: AuthenticatedActor) => boolean;
  requireIdempotencyKey: (request: FastifyRequest, reply: FastifyReply) => string | undefined;
  auditedCommand: (request: FastifyRequest, actor: AuthenticatedActor, key: string) => AuditedMutationCommand;
}) {
  const available = () => options.service ?? (() => { throw new LocalRegistrationError(503,
    "LOCAL_REGISTRATION_UNAVAILABLE", "Хранилище локальных регистраций недоступно"); })();
  const sendError = (caught: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (caught instanceof LocalRegistrationError || caught instanceof PdfPreviewError) {
      return reply.status(caught.status).send({ error: caught.code, message: caught.message });
    }
    request.log.error({ err: caught }, "local registration request failed");
    return reply.status(503).send({ error: "LOCAL_REGISTRATION_UNAVAILABLE", message: "Не удалось проверить исходные документы или сохранить привязку" });
  };
  const frame = async (objectId: string, sourceFileId: string, page: number, floorKey: string,
    phaseKey: string, actor: AuthenticatedActor): Promise<LocalDocumentFrame> => {
    const file = await available().sourceReference(objectId, sourceFileId, actor);
    const sourceBytes = await readVerifiedOriginalPdf({ storage: options.storage, storageKey: file.storageKey,
      expectedSha256: file.sha256, expectedByteSize: file.byteSize, expectedMediaType: "application/pdf" });
    return readLocalRegistrationPageFrame({ sourceBytes, expectedSourceSha256: file.sha256, sourceFileId,
      objectId, pdfPageNumber: page, floorKey, phaseKey });
  };
  const frames = async (objectId: string, packet: LocalDocumentRegistrationPacket,
    actor: AuthenticatedActor): Promise<[LocalDocumentFrame, LocalDocumentFrame]> => {
    const result: LocalDocumentFrame[] = [];
    for (const selected of [packet?.sourceFrame, packet?.targetFrame]) {
      if (!selected || typeof selected.sourceFileId !== "string" || selected.sourceFileId.length > 256
        || !Number.isSafeInteger(selected.pdfPageNumber) || typeof selected.floorKey !== "string" || typeof selected.phaseKey !== "string") {
        throw new LocalRegistrationError(400, "INVALID_REGISTRATION_PACKET", "Не заданы адреса исходных страниц");
      }
      result.push(await frame(objectId, selected.sourceFileId, selected.pdfPageNumber, selected.floorKey, selected.phaseKey, actor));
    }
    return result as [LocalDocumentFrame, LocalDocumentFrame];
  };
  app.get<{ Params: { id: string; sourceFileId: string; pageNumber: string }; Querystring: { floorKey: string; phaseKey: string } }>(
    "/api/objects/:id/files/:sourceFileId/pages/:pageNumber/local-registration-frame",
    { schema: fastifySchemaFor("getLocalRegistrationFrame") }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor) return;
      try {
        const result = await frame(request.params.id, request.params.sourceFileId, Number(request.params.pageNumber),
          request.query.floorKey, request.query.phaseKey, actor);
        reply.header("Cache-Control", "private, no-store"); return result;
      } catch (caught) { return sendError(caught, request, reply); }
    });
  app.get<{ Params: { id: string } }>("/api/objects/:id/local-registrations",
    { schema: fastifySchemaFor("getLocalRegistrationWorkspace") }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor) return;
      try { reply.header("Cache-Control", "private, no-store"); return await available().workspace(request.params.id, actor); }
      catch (caught) { return sendError(caught, request, reply); }
    });
  app.post<{ Params: { id: string }; Body: LocalDocumentRegistrationPreviewInput }>("/api/objects/:id/local-registrations/preview",
    { schema: fastifySchemaFor("previewLocalRegistration"), bodyLimit: 128 * 1024 }, async (request, reply) => {
      const actor = await options.requireActor(request, reply);
      if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      try { return await available().preview(request.params.id, request.body.checkId, request.body.packet,
        await frames(request.params.id, request.body.packet, actor), actor); }
      catch (caught) { return sendError(caught, request, reply); }
    });
  app.post<{ Params: { id: string }; Body: LocalDocumentRegistrationSaveInput }>("/api/objects/:id/local-registrations/reviews",
    { schema: fastifySchemaFor("saveLocalRegistrationReview"), bodyLimit: 128 * 1024 }, async (request, reply) => {
      const actor = await options.requireActor(request, reply);
      if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      const key = options.requireIdempotencyKey(request, reply); if (!key) return;
      try {
        const saved = await available().save(request.params.id, request.body,
          await frames(request.params.id, request.body.packet, actor), options.auditedCommand(request, actor, key));
        reply.header("ETag", `"${saved.value.contentHash}"`); reply.header("Cache-Control", "private, no-store");
        if (saved.replayed) reply.header("Idempotency-Replayed", "true");
        return reply.status(201).send(saved.value);
      } catch (caught) { return sendError(caught, request, reply); }
    });
}
