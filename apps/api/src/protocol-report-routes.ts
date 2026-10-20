import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProtocolExport } from "@inspector-ai/contracts";
import type { AuthenticatedActor } from "./identity.js";
import type { InspectionRepository, ScopedReadResult } from "./repository.js";
import { fastifySchemaFor } from "./api-contract.js";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { buildProtocolReport, ProtocolReportError, protocolReportLimits, protocolReportTemplateVersion } from "./protocol-report-model.js";
import { renderProtocolReport } from "./protocol-report-renderer.js";

type Format = "pdf" | "docx" | "xml";
type ScopedReadResolver = <T>(request: FastifyRequest, reply: FastifyReply,
  read: (actor?: AuthenticatedActor) => ScopedReadResult<T> | Promise<ScopedReadResult<T>>,
) => Promise<{ value: T | undefined; actor?: AuthenticatedActor } | undefined>;
const mediaTypes: Record<Format, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xml: "application/xml",
};

/** Remove the mutable delivery/validity envelope from legacy snapshot reads. */
function frozenLegacyExport(value: ProtocolExport): ProtocolExport {
  const { validity: _validity, revocation: _revocation, snapshotHash: _hash, ...snapshot } = value;
  const { validity: _protocolValidity, revocation: _protocolRevocation, canonicalArtifact: _artifact, snapshotHash: _protocolHash, ...protocol } = snapshot.protocol;
  return { ...snapshot, protocol };
}

export function registerProtocolReportRoutes(app: FastifyInstance, options: { repository: InspectionRepository; resolveScopedRead: ScopedReadResolver }) {
  const { repository: store, resolveScopedRead } = options;
  let activeRenders = 0;
  app.get<{ Params: { id: string; format: Format } }>("/api/protocols/:id/artifacts/:format",
    { schema: fastifySchemaFor("downloadRenderedProtocolArtifact") }, async (request, reply) => {
      const resolved = await resolveScopedRead(request, reply, actor => store.getProtocolExport(request.params.id, actor));
      if (!resolved) return;
      if (!resolved.value) return reply.status(404).send({ error: "NOT_FOUND", message: "Протокол не найден" });
      const exported = resolved.value;
      const canonical = await store.getCanonicalProtocolArtifact?.(request.params.id, resolved.actor);
      if (canonical === "AUTH_REQUIRED") throw new Error("Canonical snapshot requires the same scoped identity");
      // A protocol that advertises a canonical artifact may never silently fall back to legacy JSON.
      if (!canonical && (exported.protocol.canonicalArtifact || exported.snapshotHash || exported.protocol.snapshotHash))
        return reply.status(409).send({ error: "PROTOCOL_CANONICAL_UNAVAILABLE", message: "Сохранённый canonical snapshot недоступен. Повторите скачивание после проверки хранилища." });
      try {
        let snapshot: ProtocolExport, snapshotJson: string, snapshotHash: string;
        if (canonical) {
          const { bytes, artifact } = canonical;
          if (bytes.length > protocolReportLimits.snapshotBytes)
            throw new ProtocolReportError("PROTOCOL_REPORT_LIMIT_EXCEEDED", "Снимок превышает лимит экспорта 8 MiB", 413);
          snapshotHash = sha256(bytes);
          if (artifact.protocolId !== request.params.id || artifact.format !== "JSON" || artifact.canonicalizationVersion !== "inspector-c14n-v1"
            || artifact.mediaType !== "application/json" || artifact.byteSize !== bytes.length || artifact.contentHash !== snapshotHash
            || exported.snapshotHash && exported.snapshotHash !== snapshotHash
            || exported.protocol.snapshotHash && exported.protocol.snapshotHash !== snapshotHash)
            throw new ProtocolReportError("PROTOCOL_SNAPSHOT_HASH_MISMATCH", "Контрольная сумма сохранённого протокола не совпала", 409);
          try { snapshotJson = new TextDecoder("utf-8", { fatal: true }).decode(bytes); snapshot = JSON.parse(snapshotJson) as ProtocolExport; }
          catch { throw new ProtocolReportError("PROTOCOL_SNAPSHOT_INVALID", "Сохранённый JSON протокола повреждён", 409); }
        } else {
          snapshot = frozenLegacyExport(exported);
          snapshotJson = canonicalJson(snapshot);
          snapshotHash = sha256(snapshotJson);
        }
        if (snapshot.protocol?.id !== request.params.id || snapshot.protocol?.checkId !== exported.protocol.checkId)
          throw new ProtocolReportError("PROTOCOL_SNAPSHOT_IDENTITY_MISMATCH", "Снимок относится к другой версии протокола", 409);
        const key = { protocolId: request.params.id, format: request.params.format, templateVersion: protocolReportTemplateVersion, snapshotHash };
        let content = await store.getRenderedProtocolArtifact?.(key, resolved.actor);
        if (content === "AUTH_REQUIRED") throw new Error("Rendered snapshot requires scoped identity");
        if (!content) {
          if (activeRenders >= 2) {
            reply.header("Retry-After", "2");
            return reply.status(503).send({ error: "PROTOCOL_RENDER_BUSY", message: "Формируются другие протоколы. Повторите скачивание через несколько секунд." });
          }
          activeRenders++;
          try {
            const document = buildProtocolReport(snapshot, snapshotJson, snapshotHash, Boolean(canonical));
            const bytes = await renderProtocolReport(document, key.format);
            if (!bytes.length || bytes.length > protocolReportLimits.artifactBytes)
              throw new ProtocolReportError("PROTOCOL_REPORT_LIMIT_EXCEEDED", "Файл превышает лимит экспорта 16 MiB; используйте JSON", 413);
            const rendered = { ...key, bytes, contentHash: sha256(bytes), mediaType: mediaTypes[key.format] };
            content = store.saveRenderedProtocolArtifact ? await store.saveRenderedProtocolArtifact(rendered, resolved.actor) : rendered;
            if (!content || content === "AUTH_REQUIRED")
              return reply.status(404).send({ error: "NOT_FOUND", message: "Протокол недоступен для сохранения экспортного файла" });
          } finally { activeRenders--; }
        }
        if (content.protocolId !== key.protocolId || content.format !== key.format || content.snapshotHash !== key.snapshotHash
          || content.templateVersion !== key.templateVersion || content.mediaType !== mediaTypes[key.format]
          || !content.bytes.length || content.bytes.length > protocolReportLimits.artifactBytes || sha256(content.bytes) !== content.contentHash)
          throw new ProtocolReportError("PROTOCOL_RENDER_HASH_MISMATCH", "Проверка целостности экспортного файла не пройдена", 409);
        const filenameId = exported.protocol.id.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 160);
        reply.header("Content-Disposition", `attachment; filename="protocol-${filenameId}-v${exported.protocol.version}.${key.format}"`);
        reply.header("ETag", `"sha256-${content.contentHash}"`);
        reply.header("X-Content-SHA256", content.contentHash);
        reply.header("X-Protocol-Snapshot-SHA256", snapshotHash);
        reply.header("X-Protocol-Template-Version", key.templateVersion);
        reply.header("X-Protocol-Validity", exported.validity ?? exported.protocol.validity ?? (snapshot.protocol.status === "DRAFT" ? "DRAFT" : "UNKNOWN"));
        reply.header("Cache-Control", "private, no-store");
        reply.header("X-Content-Type-Options", "nosniff");
        return reply.type(content.mediaType).send(content.bytes);
      } catch (error) {
        if (error instanceof ProtocolReportError)
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        throw error;
      }
    });
}
