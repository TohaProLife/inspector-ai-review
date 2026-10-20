import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckRun, ProtocolExport, ProtocolVersion } from "@inspector-ai/contracts";
import { registerIaisPullRoutes, type IaisProtocolPullRead } from "../src/iais-pull-routes.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository, ProtocolCanonicalArtifactContent } from "../src/repository.js";
import { buildApp } from "../src/app.js";
import { apiOperationContracts } from "../src/api-contract.js";

const actor: AuthenticatedActor = { sessionId: "SESSION-IAIS", userId: "USER-IAIS", organizationId: "ORG-IAIS",
  displayName: "Synthetic scoped reader", roles: ["INSPECTOR"], capabilities: [], csrfHash: "unused", expiresAt: "2030-01-01T00:00:00Z" };
const stats = { total: 3, unsupported: 1, candidates: 1, confirmed: 1, negativeVerified: 0, notComparable: 0, clarification: 0, suspicion: 0 };
function fixture(): ProtocolExport {
  return {
    schemaVersion: "1.0",
    protocol: { id: "PRT-IAIS-FINAL", checkId: "CHK-IAIS", version: 2, status: "FINAL", createdAt: "2026-10-20T12:00:00.000Z", createdBy: "Frozen synthetic inspector", stats },
    findings: [],
    scope: { organizationId: "ORG-IAIS", object: { id: "OBJ-IAIS", name: "Frozen synthetic object", address: "Frozen address" },
      inspection: { id: "INS-IAIS", lifecycle: "FINALIZED", rowVersion: 5 }, run: { id: "CHK-IAIS", state: "PARTIAL" } },
    integrity: { inputManifestHash: "a".repeat(64), outputHash: "b".repeat(64), decisionSetHash: "c".repeat(64) },
    sources: [], coverage: { totalParameters: 3, executedParameters: 2, unsupportedParameters: 1, gapsHash: "d".repeat(64),
      gaps: [{ parameterId: 3, parameterCode: "QA-MISSING", parameterName: "Synthetic unsupported parameter", executionStatus: "UNSUPPORTED", reason: "MISSING_ID" }], acknowledgement: null },
  };
}
const headers = { cookie: "inspector_session=valid" };
const url = "/api/integrations/iais/protocols/PRT-IAIS-FINAL";

describe("IAIS mock pull facade scoped HTTP", () => {
  let app: FastifyInstance, snapshot: ProtocolExport, protocol: ProtocolVersion, check: CheckRun;
  let canonical: ProtocolCanonicalArtifactContent | undefined, sessionActor: AuthenticatedActor | undefined;
  let clock: number;
  const getProtocol = vi.fn(), getCheck = vi.fn(), getCanonical = vi.fn(), requireActor = vi.fn();
  const getFindings = vi.fn(() => { throw Error("Mutable findings must not be read"); });
  const getExport = vi.fn(() => { throw Error("Legacy or mutable envelope must not be read"); });
  const saveArtifact = vi.fn(() => { throw Error("Pull must not persist bytes or state"); });
  let network: ReturnType<typeof vi.spyOn>;
  function seal(value: ProtocolExport, raw = canonicalJson(value)) {
    const bytes = Buffer.from(raw), hash = sha256(bytes);
    canonical = { artifact: { id: "ART-IAIS-CANONICAL", protocolId: "PRT-IAIS-FINAL", format: "JSON", mediaType: "application/json",
      canonicalizationVersion: "inspector-c14n-v1", byteSize: bytes.length, contentHash: hash, createdAt: value.protocol.createdAt }, bytes };
    protocol = { ...structuredClone(value.protocol), snapshotHash: hash, validity: "VALID", revocation: null, canonicalArtifact: canonical.artifact };
  }
  beforeEach(async () => {
    snapshot = fixture(); seal(snapshot); sessionActor = actor; clock = Date.parse("2026-10-20T13:00:00.000Z");
    check = { id: "CHK-IAIS", objectId: "OBJ-IAIS", status: "FINALIZED", progress: 100, currentStage: "Synthetic frozen fixture", startedAt: snapshot.protocol.createdAt,
      completedAt: snapshot.protocol.createdAt, mode: "NORMAL", modelVersion: null, rulesVersion: "synthetic-only", stats };
    getProtocol.mockReset().mockImplementation(async (id, who) => who?.userId === actor.userId && who?.organizationId === actor.organizationId && id === protocol.id ? structuredClone(protocol) : undefined);
    getCheck.mockReset().mockImplementation(async (id, who) => who?.userId === actor.userId && who?.organizationId === actor.organizationId && id === check.id ? structuredClone(check) : undefined);
    getCanonical.mockReset().mockImplementation(async (_id, who) => who === actor ? canonical : undefined);
    getFindings.mockClear(); getExport.mockClear(); saveArtifact.mockClear(); requireActor.mockReset();
    network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Outbound network forbidden in pull facade"));
    app = Fastify(); await app.register(cookie);
    requireActor.mockImplementation(async (request, reply) => {
      const who = request.cookies.inspector_session === "valid" ? sessionActor : undefined;
      if (!who) { reply.status(401).send({ error: "AUTH_REQUIRED", message: "Session required" }); return undefined; }
      return who;
    });
    registerIaisPullRoutes(app, { repository: { getProtocol, getCheck, getCanonicalProtocolArtifact: getCanonical,
      getFindings, getProtocolExport: getExport, saveRenderedProtocolArtifact: saveArtifact } as unknown as InspectionRepository,
      requireActor, now: () => new Date(clock++) });
    await app.ready();
  });
  afterEach(async () => { await app.close(); network.mockRestore(); });

  it("returns exact saved canonical bytes in explicit mock envelope; links stay local; no mutations/network", async () => {
    const response = await app.inject({ url, headers });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<IaisProtocolPullRead>();
    expect(body).toMatchObject({ schemaVersion: "iais-pull-facade-v1", mode: "MOCK_PULL_FACADE", payloadPolicy: "FULL_SNAPSHOT_MOCK_ONLY",
      signature: { status: "NOT_CONFIGURED" }, externalDelivery: { status: "NOT_CONFIRMED", outboundRequests: 0 },
      protocol: { id: "PRT-IAIS-FINAL", checkId: "CHK-IAIS", objectId: "OBJ-IAIS", version: 2, status: "FINAL", snapshotHash: protocol.snapshotHash },
      currentValidity: { status: "VALID", checkedAt: "2026-10-20T13:00:00.000Z" }, readAt: "2026-10-20T13:00:00.000Z" });
    expect(Buffer.from(body.canonicalSnapshot.json)).toEqual(canonical!.bytes);
    expect(sha256(Buffer.from(body.canonicalSnapshot.json))).toBe(body.canonicalSnapshot.contentHash);
    expect(body.canonicalSnapshot.byteSize).toBe(canonical!.bytes.length);
    expect(JSON.parse(body.canonicalSnapshot.json)).toEqual(snapshot);
    expect(body.formats).toEqual({ canonicalJson: "/api/protocols/PRT-IAIS-FINAL/artifacts/canonical-json", pdf: "/api/protocols/PRT-IAIS-FINAL/artifacts/pdf",
      docx: "/api/protocols/PRT-IAIS-FINAL/artifacts/docx", xml: "/api/protocols/PRT-IAIS-FINAL/artifacts/xml" });
    expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-protocol-snapshot-sha256"]).toBe(protocol.snapshotHash); expect(response.headers["x-protocol-validity"]).toBe("VALID");
    expect(response.headers.etag).toBeUndefined();
    const repeated = (await app.inject({ url, headers })).json<IaisProtocolPullRead>();
    expect(repeated.canonicalSnapshot).toEqual(body.canonicalSnapshot); expect(repeated.readAt).not.toBe(body.readAt);
    expect(requireActor).toHaveBeenCalledTimes(4); expect(getProtocol).toHaveBeenCalledTimes(4); expect(getCheck).toHaveBeenCalledTimes(4);
    expect(getCanonical).toHaveBeenCalledTimes(2); expect(getFindings).not.toHaveBeenCalled(); expect(getExport).not.toHaveBeenCalled();
    expect(saveArtifact).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });

  it("authenticates before any existence read, even for unknown ids", async () => {
    for (const id of ["PRT-IAIS-FINAL", "FOREIGN", "missing"]) expect((await app.inject(`/api/integrations/iais/protocols/${id}`)).statusCode).toBe(401);
    expect(getProtocol).not.toHaveBeenCalled(); expect(getCheck).not.toHaveBeenCalled(); expect(getCanonical).not.toHaveBeenCalled();
  });

  it("returns same scoped 404 for foreign organization, foreign user and missing protocol", async () => {
    for (const who of [{ ...actor, userId: "FOREIGN" }, { ...actor, organizationId: "FOREIGN" }]) {
      sessionActor = who; const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ error: "NOT_FOUND", message: "Протокол недоступен" });
    }
    sessionActor = actor; expect((await app.inject({ url: url.replace("PRT-IAIS-FINAL", "missing"), headers })).statusCode).toBe(404);
    expect(getCanonical).not.toHaveBeenCalled();
  });

  it.each([
    { status: "DRAFT", validity: "DRAFT" }, { validity: "REVOKED" }, { validity: undefined },
    { revocation: { id: "REV", reasonCode: "OTHER", comment: "Synthetic revoked protocol", revokedAt: "2026-10-20T12:01:00Z", revokedBy: "reader", replacementProtocolId: "NEW" } },
  ])("refuses draft/revoked/unknown validity before artifact read: %j", async mutation => {
    protocol = { ...protocol, ...mutation } as ProtocolVersion;
    const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(409); expect(response.json().error).toBe("IAIS_PROTOCOL_NOT_ELIGIBLE");
    expect(getCanonical).not.toHaveBeenCalled();
  });

  it.each(["DEMO_SEED", "SOURCE_AUDIT_ONLY"])("refuses %s without fallback or canonical read", async mode => {
    if (mode === "DEMO_SEED") check.mode = "DEMO_SEED"; else check.purpose = "SOURCE_AUDIT_ONLY";
    expect((await app.inject({ url, headers })).statusCode).toBe(409); expect(getCanonical).not.toHaveBeenCalled(); expect(getExport).not.toHaveBeenCalled();
  });

  it("refuses unavailable canonical and oversized bytes without legacy reconstruction", async () => {
    canonical = undefined;
    let response = await app.inject({ url, headers }); expect(response.statusCode).toBe(409); expect(response.json().error).toBe("IAIS_CANONICAL_UNAVAILABLE");
    seal(snapshot); canonical!.bytes = Buffer.alloc(8388609);
    response = await app.inject({ url, headers }); expect(response.statusCode).toBe(413); expect(getExport).not.toHaveBeenCalled();
  });

  it.each(["hash", "size", "protocolId", "advertisedHash", "format", "version"])("refuses wrong canonical metadata: %s", async kind => {
    if (kind === "hash") canonical!.artifact.contentHash = "0".repeat(64);
    if (kind === "size") canonical!.artifact.byteSize++;
    if (kind === "protocolId") canonical!.artifact.protocolId = "FOREIGN";
    if (kind === "advertisedHash") protocol.snapshotHash = "0".repeat(64);
    if (kind === "format") canonical!.artifact.canonicalizationVersion = "unknown" as "inspector-c14n-v1";
    if (kind === "version") protocol.canonicalArtifact = { ...canonical!.artifact, id: "FOREIGN-ARTIFACT" };
    const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(409); expect(response.json().error).toBe("IAIS_SNAPSHOT_HASH_MISMATCH");
  });

  it.each(["invalid-json", "whitespace", "duplicate-key", "invalid-utf8", "utf8-bom"])("refuses hashed but noncanonical %s", async kind => {
    if (kind === "invalid-json") seal(snapshot, "{");
    if (kind === "utf8-bom") seal(snapshot, `\uFEFF${canonicalJson(snapshot)}`);
    if (kind === "whitespace") seal(snapshot, ` ${canonicalJson(snapshot)}`);
    if (kind === "duplicate-key") seal(snapshot, canonicalJson(snapshot).replace('"schemaVersion":"1.0"', '"schemaVersion":"0.0","schemaVersion":"1.0"'));
    if (kind === "invalid-utf8") {
      canonical!.bytes = Buffer.from([0xff]); canonical!.artifact.contentHash = sha256(canonical!.bytes); canonical!.artifact.byteSize = 1; protocol.snapshotHash = canonical!.artifact.contentHash;
    }
    const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(409); expect(response.json().error).toBe("IAIS_SNAPSHOT_INVALID");
  });

  it.each(["protocol-id", "check-id", "version", "status", "organization", "object", "run", "scope-missing"])("refuses self-consistent hash with wrong frozen identity: %s", async kind => {
    if (kind === "protocol-id") snapshot.protocol.id = "FOREIGN";
    if (kind === "check-id") snapshot.protocol.checkId = "FOREIGN";
    if (kind === "version") snapshot.protocol.version = 9;
    if (kind === "status") snapshot.protocol.status = "DRAFT";
    if (kind === "organization") snapshot.scope!.organizationId = "FOREIGN";
    if (kind === "object") snapshot.scope!.object.id = "FOREIGN";
    if (kind === "run") snapshot.scope!.run.id = "FOREIGN";
    if (kind === "scope-missing") delete snapshot.scope;
    const expectedProtocol = structuredClone(protocol); seal(snapshot);
    protocol = { ...expectedProtocol, snapshotHash: canonical!.artifact.contentHash, canonicalArtifact: canonical!.artifact };
    const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(409);
    expect(["IAIS_SNAPSHOT_IDENTITY_MISMATCH", "IAIS_SNAPSHOT_SCOPE_MISMATCH"]).toContain(response.json().error);
  });

  it.each(["revoked", "read-revoked", "hash-changed", "mode-changed", "session-expired", "session-changed"])("rechecks just before delivery and refuses %s", async kind => {
    getCanonical.mockImplementationOnce(async () => {
      if (kind === "revoked") protocol.validity = "REVOKED";
      if (kind === "read-revoked") getProtocol.mockResolvedValue(undefined);
      if (kind === "hash-changed") protocol.snapshotHash = "0".repeat(64);
      if (kind === "mode-changed") check.mode = "DEMO_SEED";
      if (kind === "session-expired") sessionActor = undefined;
      if (kind === "session-changed") sessionActor = { ...actor, sessionId: "DIFFERENT" };
      return canonical;
    });
    const response = await app.inject({ url, headers }); expect([401, 404, 409]).toContain(response.statusCode);
    expect(response.json()).not.toHaveProperty("canonicalSnapshot"); expect(response.headers["x-protocol-validity"]).toBeUndefined();
  });

  it("performs final protocol validity read after the final check read", async () => {
    getCheck.mockImplementationOnce(async () => structuredClone(check)).mockImplementationOnce(async () => {
      protocol.validity = "REVOKED"; return structuredClone(check);
    });
    const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(409); expect(response.json().error).toBe("IAIS_PROTOCOL_CHANGED");
  });

  it("fails closed when a scoped repository requests identity again", async () => {
    getProtocol.mockResolvedValue("AUTH_REQUIRED"); expect((await app.inject({ url, headers })).statusCode).toBe(503);
    expect(getCanonical).not.toHaveBeenCalled();
  });
});

describe("IAIS production app serialization and published contract", () => {
  let app: FastifyInstance;
  const snapshot = fixture();
  const bytes = Buffer.from(canonicalJson(snapshot)), contentHash = sha256(bytes);
  const canonical: ProtocolCanonicalArtifactContent = { bytes, artifact: {
    id: "ART-IAIS-APP", protocolId: snapshot.protocol.id, format: "JSON", mediaType: "application/json",
    canonicalizationVersion: "inspector-c14n-v1", byteSize: bytes.length, contentHash, createdAt: snapshot.protocol.createdAt,
  } };
  let currentActor: AuthenticatedActor | undefined;
  const getProtocol = vi.fn(), getCheck = vi.fn(), getCanonical = vi.fn();
  beforeEach(async () => {
    currentActor = actor;
    getProtocol.mockReset().mockImplementation(async (id, who) => id === snapshot.protocol.id && who?.organizationId === actor.organizationId
      && who?.userId === actor.userId ? { ...structuredClone(snapshot.protocol), snapshotHash: contentHash, validity: "VALID", canonicalArtifact: canonical.artifact } : undefined);
    getCheck.mockReset().mockImplementation(async (id, who) => id === snapshot.protocol.checkId && who?.organizationId === actor.organizationId
      && who?.userId === actor.userId ? { id, objectId: "OBJ-IAIS", mode: "NORMAL" } : undefined);
    getCanonical.mockReset().mockImplementation(async (_id, who) => who === actor ? canonical : undefined);
    const identity: IdentityService = { login: async () => undefined,
      resolveSession: async token => token === "valid" ? currentActor : undefined, verifyCsrf: () => false,
      revokeSession: async () => undefined, close: async () => undefined };
    app = await buildApp({ repository: { getProtocol, getCheck, getCanonicalProtocolArtifact: getCanonical } as unknown as InspectionRepository,
      identityService: identity });
  });
  afterEach(async () => { await app.close(); });

  it("preserves every envelope field and exact canonical UTF-8 through the bound production serializer", async () => {
    const response = await app.inject({ url, headers });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<IaisProtocolPullRead>();
    expect(Object.keys(body).sort()).toEqual(["schemaVersion", "mode", "payloadPolicy", "signature", "externalDelivery", "protocol",
      "currentValidity", "readAt", "canonicalSnapshot", "formats", "limitations"].sort());
    expect(body).toMatchObject({ schemaVersion: "iais-pull-facade-v1", mode: "MOCK_PULL_FACADE", payloadPolicy: "FULL_SNAPSHOT_MOCK_ONLY",
      signature: { status: "NOT_CONFIGURED" }, externalDelivery: { status: "NOT_CONFIRMED", outboundRequests: 0 },
      protocol: { id: snapshot.protocol.id, checkId: snapshot.protocol.checkId, objectId: "OBJ-IAIS", version: 2, status: "FINAL", snapshotHash: contentHash },
      currentValidity: { status: "VALID", checkedAt: body.readAt },
      canonicalSnapshot: { canonicalizationVersion: "inspector-c14n-v1", encoding: "UTF-8", byteSize: bytes.length, contentHash } });
    expect(new Date(body.readAt).toISOString()).toBe(body.readAt);
    expect(Buffer.from(body.canonicalSnapshot.json, "utf8")).toEqual(bytes);
    expect(sha256(Buffer.from(body.canonicalSnapshot.json, "utf8"))).toBe(body.protocol.snapshotHash);
    expect(JSON.parse(body.canonicalSnapshot.json)).toEqual(snapshot);
    expect(body.formats).toEqual({ canonicalJson: "/api/protocols/PRT-IAIS-FINAL/artifacts/canonical-json", pdf: "/api/protocols/PRT-IAIS-FINAL/artifacts/pdf",
      docx: "/api/protocols/PRT-IAIS-FINAL/artifacts/docx", xml: "/api/protocols/PRT-IAIS-FINAL/artifacts/xml" });
    expect(body.limitations.length).toBeGreaterThan(0);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-protocol-snapshot-sha256"]).toBe(contentHash);
    expect(response.headers["x-protocol-validity"]).toBe("VALID");
    const again = await app.inject({ url, headers });
    expect(again.statusCode).toBe(200); expect(again.json().canonicalSnapshot).toEqual(body.canonicalSnapshot);
  });

  it("uses production session auth before existence and preserves the scoped error serializer", async () => {
    for (const path of [url, "/api/integrations/iais/protocols/missing"]) {
      const unauth = await app.inject(path); expect(unauth.statusCode, unauth.body).toBe(401);
      expect(unauth.json()).toMatchObject({ error: "AUTH_REQUIRED", message: expect.any(String) });
    }
    expect(getProtocol).not.toHaveBeenCalled(); expect(getCheck).not.toHaveBeenCalled(); expect(getCanonical).not.toHaveBeenCalled();
    currentActor = { ...actor, organizationId: "FOREIGN-ORG" };
    const foreign = await app.inject({ url, headers }); expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: "NOT_FOUND", message: "Протокол недоступен" });
    expect(foreign.headers["cache-control"]).toBe("private, no-store");
    expect(getCanonical).not.toHaveBeenCalled();
  });

  it("publishes one cookie-protected GET with explicit mock metadata, mandatory nested fields and all refusal statuses", async () => {
    const response = await app.inject("/api/openapi.json"); expect(response.statusCode).toBe(200);
    const document = response.json();
    const path = document.paths["/integrations/iais/protocols/{id}"];
    expect(Object.keys(path)).toEqual(["get"]);
    const operation = path.get;
    expect(operation.operationId).toBe("getIaisProtocolPull"); expect(operation.security).toEqual([{ sessionCookie: [] }]);
    expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "id", in: "path", required: true,
      schema: expect.objectContaining({ type: "string", minLength: 1, maxLength: 200 }) }));
    expect(operation.requestBody).toBeUndefined();
    expect(document.components.securitySchemes.sessionCookie).toEqual({ type: "apiKey", in: "cookie", name: "inspector_session" });
    expect(operation.responses["200"].content["application/json"].schema).toEqual({ $ref: "#/components/schemas/IaisProtocolPull" });
    for (const status of [400, 401, 404, 409, 413, 500, 503]) expect(operation.responses[String(status)].content["application/json"].schema)
      .toEqual({ $ref: "#/components/schemas/ApiError" });
    const schema = document.components.schemas.IaisProtocolPull;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["schemaVersion", "mode", "payloadPolicy", "signature", "externalDelivery", "protocol", "currentValidity", "readAt", "canonicalSnapshot", "formats", "limitations"]);
    const p = schema.properties;
    expect(p.mode.const).toBe("MOCK_PULL_FACADE"); expect(p.payloadPolicy.const).toBe("FULL_SNAPSHOT_MOCK_ONLY");
    expect(p.signature.required).toEqual(["status"]); expect(p.signature.properties.status.const).toBe("NOT_CONFIGURED");
    expect(p.externalDelivery.required).toEqual(["status", "outboundRequests"]);
    expect(p.externalDelivery.properties.status.const).toBe("NOT_CONFIRMED"); expect(p.externalDelivery.properties.outboundRequests.const).toBe(0);
    expect(p.protocol.required).toEqual(["id", "checkId", "objectId", "version", "status", "snapshotHash"]);
    expect(p.protocol.properties.status.const).toBe("FINAL"); expect(p.protocol.properties.snapshotHash.pattern).toBe("^[a-f0-9]{64}$");
    expect(p.currentValidity.required).toEqual(["status", "checkedAt"]); expect(p.currentValidity.properties.status.const).toBe("VALID");
    expect(p.currentValidity.properties.checkedAt.format).toBe("date-time"); expect(p.readAt.format).toBe("date-time");
    expect(p.canonicalSnapshot.required).toEqual(["canonicalizationVersion", "encoding", "byteSize", "contentHash", "json"]);
    expect(p.canonicalSnapshot.properties.byteSize.maximum).toBe(8388608);
    expect(p.formats.required).toEqual(["canonicalJson", "pdf", "docx", "xml"]);
    expect(apiOperationContracts.filter(candidate => candidate.id === "getIaisProtocolPull")).toHaveLength(1);
  });
});
