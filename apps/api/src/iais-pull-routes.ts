import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema } from "fastify";
import type { CheckRun, ProtocolExport, ProtocolVersion } from "@inspector-ai/contracts";
import type { AuthenticatedActor } from "./identity.js";
import type { InspectionRepository, ProtocolCanonicalArtifactContent } from "./repository.js";
import { canonicalJson, sha256 } from "./canonical-json.js";

export const IAIS_PULL_OPERATION_ID = "getIaisProtocolPull";
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export interface IaisProtocolPullRead {
  schemaVersion: "iais-pull-facade-v1";
  mode: "MOCK_PULL_FACADE";
  payloadPolicy: "FULL_SNAPSHOT_MOCK_ONLY";
  signature: { status: "NOT_CONFIGURED" };
  externalDelivery: { status: "NOT_CONFIRMED"; outboundRequests: 0 };
  protocol: { id: string; checkId: string; objectId: string; version: number; status: "FINAL"; snapshotHash: string };
  currentValidity: { status: "VALID"; checkedAt: string };
  readAt: string;
  canonicalSnapshot: {
    canonicalizationVersion: "inspector-c14n-v1"; encoding: "UTF-8";
    byteSize: number; contentHash: string; json: string;
  };
  formats: { canonicalJson: string; pdf: string; docx: string; xml: string };
  limitations: string[];
}

export interface IaisPullRouteOptions {
  repository: InspectionRepository;
  requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthenticatedActor | undefined>;
  schema?: FastifySchema;
  now?: () => Date;
}

function eligible(protocol: ProtocolVersion): boolean {
  return protocol.status === "FINAL" && protocol.validity === "VALID" && !protocol.revocation;
}

function normalCheck(check: CheckRun, protocol: ProtocolVersion): boolean {
  return check.mode === "NORMAL" && !check.purpose && check.id === protocol.checkId;
}

function artifactMatches(protocol: ProtocolVersion, canonical: ProtocolCanonicalArtifactContent, hash: string, bytes: Buffer): boolean {
  const artifact = canonical.artifact;
  const advertised = protocol.canonicalArtifact;
  return /^[a-f0-9]{64}$/.test(protocol.snapshotHash ?? "") && protocol.snapshotHash === hash
    && artifact.protocolId === protocol.id && artifact.format === "JSON" && artifact.mediaType === "application/json"
    && artifact.canonicalizationVersion === "inspector-c14n-v1" && artifact.byteSize === bytes.length
    && artifact.contentHash === hash && (!advertised || advertised.id === artifact.id
      && advertised.protocolId === protocol.id && advertised.format === "JSON" && advertised.mediaType === "application/json"
      && advertised.canonicalizationVersion === artifact.canonicalizationVersion
      && advertised.contentHash === hash && advertised.byteSize === bytes.length);
}

/** Read-only hackathon facade. Not an external delivery job or an IAIS production adapter. */
export function registerIaisPullRoutes(app: FastifyInstance, options: IaisPullRouteOptions): void {
  const { repository, requireActor } = options;
  app.get<{ Params: { id: string } }>("/api/integrations/iais/protocols/:id", {
    schema: options.schema ?? { params: { type: "object", required: ["id"], additionalProperties: false,
      properties: { id: { type: "string", minLength: 1, maxLength: 200 } } } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    // Deliberately do not use the public/demo-aware resolveScopedRead helper.
    const actor = await requireActor(request, reply);
    if (!actor) return;
    const unavailable = () => reply.status(503).send({ error: "IAIS_PULL_UNAVAILABLE", message: "Адаптер чтения протоколов недоступен" });
    const notFound = () => reply.status(404).send({ error: "NOT_FOUND", message: "Протокол недоступен" });
    const invalid = (error: string, message: string) => reply.status(409).send({ error, message });
    const protocol = await repository.getProtocol(request.params.id, actor);
    if (protocol === "AUTH_REQUIRED") return unavailable();
    if (!protocol) return notFound();
    if (protocol.id !== request.params.id || !eligible(protocol))
      return invalid("IAIS_PROTOCOL_NOT_ELIGIBLE", "Pull facade выдаёт только действующий FINAL-протокол");
    const check = await repository.getCheck(protocol.checkId, actor);
    if (check === "AUTH_REQUIRED") return unavailable();
    if (!check) return notFound();
    if (!normalCheck(check, protocol))
      return invalid("IAIS_NORMAL_PROTOCOL_REQUIRED", "Учебные версии и source-only audit не выдаются через ИАИС facade");
    if (!repository.getCanonicalProtocolArtifact) return unavailable();
    const canonical = await repository.getCanonicalProtocolArtifact(protocol.id, actor);
    if (canonical === "AUTH_REQUIRED") return unavailable();
    if (!canonical) return invalid("IAIS_CANONICAL_UNAVAILABLE", "Сохранённый canonical snapshot недоступен; fallback отключён");
    if (!Buffer.isBuffer(canonical.bytes) || canonical.bytes.length === 0)
      return invalid("IAIS_SNAPSHOT_INVALID", "Canonical snapshot повреждён");
    if (canonical.bytes.length > MAX_SNAPSHOT_BYTES)
      return reply.status(413).send({ error: "IAIS_SNAPSHOT_LIMIT_EXCEEDED", message: "Canonical snapshot превышает лимит 8 MiB" });
    // Own the bytes before subsequent awaits; response never aliases mutable caller Buffers.
    const bytes = Buffer.from(canonical.bytes), hash = sha256(bytes);
    if (!artifactMatches(protocol, canonical, hash, bytes))
      return invalid("IAIS_SNAPSHOT_HASH_MISMATCH", "Hash или identity canonical snapshot не совпали");
    let json: string, snapshot: ProtocolExport;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      snapshot = JSON.parse(json) as ProtocolExport;
      if (!snapshot || snapshot.schemaVersion !== "1.0" || !snapshot.protocol || !Array.isArray(snapshot.findings)
        || !Buffer.from(json, "utf8").equals(bytes) || canonicalJson(snapshot) !== json) throw Error("Noncanonical snapshot");
    } catch {
      return invalid("IAIS_SNAPSHOT_INVALID", "Snapshot не является валидным UTF-8 inspector-c14n-v1 JSON");
    }
    if (snapshot.protocol.id !== protocol.id || snapshot.protocol.checkId !== protocol.checkId
      || snapshot.protocol.version !== protocol.version || snapshot.protocol.status !== "FINAL"
      || !Number.isInteger(snapshot.protocol.version) || snapshot.protocol.version < 1)
      return invalid("IAIS_SNAPSHOT_IDENTITY_MISMATCH", "Snapshot относится к другой версии протокола");
    // A legacy snapshot without frozen scope is not enriched from live object metadata.
    if (!snapshot.scope || snapshot.scope.organizationId !== actor.organizationId
      || snapshot.scope.object?.id !== check.objectId || snapshot.scope.run?.id !== check.id
      || snapshot.scope.inspection?.lifecycle !== "FINALIZED")
      return invalid("IAIS_SNAPSHOT_SCOPE_MISMATCH", "Frozen scope отсутствует или не совпадает с доступным объектом NORMAL");

    // Recheck session and object scope immediately before delivery. No cross-system atomicity claim.
    const latestActor = await requireActor(request, reply);
    if (!latestActor) return;
    if (latestActor.userId !== actor.userId || latestActor.organizationId !== actor.organizationId || latestActor.sessionId !== actor.sessionId)
      return reply.status(401).send({ error: "AUTH_CHANGED", message: "Сессия изменилась во время чтения; повторите запрос" });
    const latestCheck = await repository.getCheck(protocol.checkId, latestActor);
    if (latestCheck === "AUTH_REQUIRED") return unavailable();
    if (!latestCheck) return notFound();
    if (!normalCheck(latestCheck, protocol) || latestCheck.objectId !== check.objectId)
      return invalid("IAIS_PROTOCOL_CHANGED", "Границы NORMAL-проверки изменились во время чтения");
    // Validity/object READ is the final repository read, minimizing the unavoidable revoke-after-check window.
    const latest = await repository.getProtocol(protocol.id, latestActor);
    if (latest === "AUTH_REQUIRED") return unavailable();
    if (!latest) return notFound();
    if (!eligible(latest) || latest.id !== protocol.id || latest.checkId !== protocol.checkId
      || latest.version !== protocol.version || !artifactMatches(latest, canonical, hash, bytes))
      return invalid("IAIS_PROTOCOL_CHANGED", "Статус или identity протокола изменились во время чтения");
    const readAt = (options.now?.() ?? new Date()).toISOString();
    const prefix = `/api/protocols/${encodeURIComponent(protocol.id)}`;
    const response: IaisProtocolPullRead = {
      schemaVersion: "iais-pull-facade-v1", mode: "MOCK_PULL_FACADE", payloadPolicy: "FULL_SNAPSHOT_MOCK_ONLY",
      signature: { status: "NOT_CONFIGURED" }, externalDelivery: { status: "NOT_CONFIRMED", outboundRequests: 0 },
      protocol: { id: protocol.id, checkId: protocol.checkId, objectId: check.objectId, version: protocol.version, status: "FINAL", snapshotHash: hash },
      currentValidity: { status: "VALID", checkedAt: readAt }, readAt,
      canonicalSnapshot: { canonicalizationVersion: "inspector-c14n-v1", encoding: "UTF-8", byteSize: bytes.length, contentHash: hash, json },
      formats: { canonicalJson: `${prefix}/artifacts/canonical-json`, pdf: `${prefix}/artifacts/pdf`, docx: `${prefix}/artifacts/docx`, xml: `${prefix}/artifacts/xml` },
      limitations: [
        "Хакатонный MOCK_PULL_FACADE; совместимость с production schema ИАИС не подтверждена.",
        "Полный frozen snapshot содержит отдельные кандидаты и технические пробелы; это не confirmed-only payload ИАИС.",
        "Подпись и внешняя доставка не настроены и не подтверждены; исходящих запросов нет.",
        "VALID проверен перед выдачей; отзыв после последней проверки возможен. Exactly-once и внешний приём не заявлены.",
      ],
    };
    reply.header("X-Protocol-Snapshot-SHA256", hash);
    reply.header("X-Protocol-Validity", "VALID");
    return response;
  });
}
