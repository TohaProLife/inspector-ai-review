import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository, ProtocolCanonicalArtifactContent, ProtocolRenderedArtifactContent } from "../src/repository.js";
import { reportFixture } from "./protocol-report-fixture.js";

describe("protocol rendered downloads HTTP", () => {
  let app: FastifyInstance, canonical: ProtocolCanonicalArtifactContent | undefined;
  let revoked = false; const cache = new Map<string, ProtocolRenderedArtifactContent>();
  const actor: AuthenticatedActor = { sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(), displayName: "Тестовый инспектор",
    roles: ["INSPECTOR"], capabilities: [], csrfHash: "a".repeat(64), expiresAt: "2030-01-01T00:00:00.000Z" };
  const snapshot = reportFixture();
  const scoped = vi.fn(), readCanonical = vi.fn(), save = vi.fn();
  const headers = { cookie: "inspector_session=session" };
  beforeEach(async () => {
    revoked = false; cache.clear();
    const bytes = Buffer.from(canonicalJson(snapshot)), contentHash = sha256(bytes);
    canonical = { artifact: { id: randomUUID(), protocolId: snapshot.protocol.id, format: "JSON", mediaType: "application/json", canonicalizationVersion: "inspector-c14n-v1",
      byteSize: bytes.length, contentHash, createdAt: snapshot.protocol.createdAt }, bytes };
    scoped.mockReset().mockImplementation(async (id: string, who?: AuthenticatedActor) => !who ? "AUTH_REQUIRED" : id === snapshot.protocol.id
      ? { ...structuredClone(snapshot), snapshotHash: contentHash, validity: revoked ? "REVOKED" : "VALID" } : undefined);
    readCanonical.mockReset().mockImplementation(async (_id, who) => who === actor ? canonical : "AUTH_REQUIRED");
    save.mockReset().mockImplementation(async (content: ProtocolRenderedArtifactContent) => { cache.set(content.format, content); return content; });
    const identity: IdentityService = { login: async () => undefined, resolveSession: async token => token === "session" ? actor : undefined,
      verifyCsrf: () => false, revokeSession: async () => undefined, close: async () => undefined };
    app = await buildApp({ repository: { getProtocolExport: scoped, getCanonicalProtocolArtifact: readCanonical,
      getRenderedProtocolArtifact: async (key: { format: string }) => cache.get(key.format), saveRenderedProtocolArtifact: save } as unknown as InspectionRepository,
      identityService: identity });
  });
  afterEach(async () => { await app.close(); });
  it.each(["pdf", "docx", "xml"] as const)("downloads valid immutable %s with provenance and exact repeat bytes", async format => {
    const response = await app.inject({ method: "GET", url: `/api/protocols/PR-EXPORT/artifacts/${format}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(format === "docx" ? "wordprocessingml" : `application/${format}`);
    expect(response.headers["content-disposition"]).toContain(`v3.${format}`);
    expect(response.headers["x-content-sha256"]).toBe(sha256(response.rawPayload));
    expect(response.headers["x-protocol-snapshot-sha256"]).toBe(canonical!.artifact.contentHash);
    expect(response.headers["x-protocol-validity"]).toBe("VALID");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.rawPayload.subarray(0, format === "pdf" ? 5 : 2).toString()).toBe(format === "pdf" ? "%PDF-" : format === "docx" ? "PK" : "<?");
    revoked = true;
    const again = await app.inject({ method: "GET", url: `/api/protocols/PR-EXPORT/artifacts/${format}`, headers });
    expect(again.statusCode).toBe(200); expect(again.rawPayload).toEqual(response.rawPayload);
    expect(again.headers["x-protocol-validity"]).toBe("REVOKED"); expect(save).toHaveBeenCalledTimes(1);
    expect(readCanonical).toHaveBeenCalledWith("PR-EXPORT", actor);
  });
  it("requires scoped identity before revealing existence, does not expose foreign or invalid formats", async () => {
    expect((await app.inject("/api/protocols/PR-EXPORT/artifacts/pdf")).statusCode).toBe(401);
    expect(readCanonical).not.toHaveBeenCalled();
    expect((await app.inject({ url: "/api/protocols/foreign/artifacts/pdf", headers })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/protocols/PR-EXPORT/artifacts/html", headers })).statusCode).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("refuses missing or corrupted canonical artifacts rather than falling back", async () => {
    canonical = undefined;
    let response = await app.inject({ url: "/api/protocols/PR-EXPORT/artifacts/xml", headers });
    expect(response.statusCode).toBe(409); expect(response.json().error).toBe("PROTOCOL_CANONICAL_UNAVAILABLE");
    const bytes = Buffer.from("{}"); canonical = { bytes, artifact: { id: "broken", protocolId: "PR-EXPORT", format: "JSON", mediaType: "application/json",
      canonicalizationVersion: "inspector-c14n-v1", byteSize: 2, contentHash: "0".repeat(64), createdAt: snapshot.protocol.createdAt } };
    response = await app.inject({ url: "/api/protocols/PR-EXPORT/artifacts/xml", headers });
    expect(response.statusCode).toBe(409); expect(response.json().error).toBe("PROTOCOL_SNAPSHOT_HASH_MISMATCH");
    expect(save).not.toHaveBeenCalled();
  });
  it("checks cached artifact bytes and source identity before delivery", async () => {
    const response = await app.inject({ url: "/api/protocols/PR-EXPORT/artifacts/xml", headers }); expect(response.statusCode).toBe(200);
    cache.get("xml")!.bytes = Buffer.from("tampered");
    const corrupted = await app.inject({ url: "/api/protocols/PR-EXPORT/artifacts/xml", headers });
    expect(corrupted.statusCode).toBe(409); expect(corrupted.json().error).toBe("PROTOCOL_RENDER_HASH_MISMATCH");
  });
});
