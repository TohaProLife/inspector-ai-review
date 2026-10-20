import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticatedActor } from "./identity.js";
import type { ObjectStorage } from "./storage.js";
import { fastifySchemaFor } from "./api-contract.js";
import { readCanonicalPdfPageFrame } from "./canonical-pdf-page-frame.js";
import { parseDocumentCoordinateInput, previewDocumentCoordinates, DocumentCoordinateInputError } from "./document-coordinate-preview.js";
import { LocalRegistrationError, type PostgresLocalRegistrationService } from "./postgres-local-registration.js";
import { PdfPreviewError } from "./pdf-preview.js";
import { readVerifiedOriginalPdf } from "./verified-pdf-storage.js";

export function registerDocumentCoordinateRoutes(app: FastifyInstance, options: {
  service?: Pick<PostgresLocalRegistrationService, "coordinateSourceReference">; storage: ObjectStorage;
  requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedActor | undefined>;
  verifyCsrf: (request: FastifyRequest, reply: FastifyReply, actor: AuthenticatedActor) => boolean;
}) {
  const originalFrame = async (objectId: string, sourceFileId: string, checkId: string, pageNumber: number, actor: AuthenticatedActor) => {
    if (!options.service) throw new LocalRegistrationError(503, "COORDINATE_PREVIEW_UNAVAILABLE", "Хранилище исходников недоступно");
    const file = await options.service.coordinateSourceReference(objectId, sourceFileId, checkId, actor);
    const sourceBytes = await readVerifiedOriginalPdf({ storage: options.storage, storageKey: file.storageKey,
      expectedSha256: file.sha256, expectedByteSize: file.byteSize, expectedMediaType: "application/pdf" });
    const frame = await readCanonicalPdfPageFrame({ sourceBytes, expectedSourceSha256: file.sha256, sourceFileId, pdfPageNumber: pageNumber });
    // Storage and Poppler can take time. Recheck active run/manifest after the read as well.
    const current = await options.service.coordinateSourceReference(objectId, sourceFileId, checkId, actor);
    if (current.sha256 !== file.sha256 || current.storageKey !== file.storageKey || current.byteSize !== file.byteSize)
      throw new LocalRegistrationError(409, "SOURCE_CHANGED", "Исходный файл изменился; откройте страницу заново");
    return frame;
  };
  const fail = (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof LocalRegistrationError || error instanceof PdfPreviewError)
      return reply.status(error.status).send({ error: error.code, message: error.message });
    if (error instanceof DocumentCoordinateInputError)
      return reply.status(error.code === "INPUT_LIMIT" ? 413 : 400).send({ error: error.code, message: error.message });
    request.log.error({ err: error }, "coordinate preview failed");
    return reply.status(503).send({ error: "COORDINATE_PREVIEW_UNAVAILABLE", message: "Не удалось проверить оригинал для координатного черновика" });
  };
  app.get<{Params: {id: string; sourceFileId: string; pageNumber: string}; Querystring: {checkId: string}}>(
    "/api/objects/:id/files/:sourceFileId/pages/:pageNumber/document-coordinate-frame",
    { schema: fastifySchemaFor("getDocumentCoordinateFrame") }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor) return;
      try {
        const value = await originalFrame(request.params.id, request.params.sourceFileId, request.query.checkId, Number(request.params.pageNumber), actor);
        reply.header("Cache-Control", "private, no-store"); return value;
      } catch (error) { return fail(error, request, reply); }
    });
  app.post<{Params: {id: string}; Body: unknown}>("/api/objects/:id/document-coordinates/preview",
    { schema: fastifySchemaFor("previewDocumentCoordinates"), bodyLimit: 128 * 1024 }, async (request, reply) => {
      const actor = await options.requireActor(request, reply); if (!actor || !options.verifyCsrf(request, reply, actor)) return;
      try {
        const input = parseDocumentCoordinateInput(request.body);
        const frame = await originalFrame(request.params.id, input.sourceFrame.sourceFileId, input.checkId, input.sourceFrame.pdfPageNumber, actor);
        reply.header("Cache-Control", "private, no-store"); return previewDocumentCoordinates(input, frame);
      } catch (error) { return fail(error, request, reply); }
    });
}
