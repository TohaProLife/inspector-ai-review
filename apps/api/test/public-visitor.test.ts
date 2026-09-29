import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";

const objectIds = ["OBJ-PUBLIC-001", "OBJ-PUBLIC-002", "OBJ-PUBLIC-003"];
const actor: AuthenticatedActor = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  displayName: "Публичный просмотр",
  roles: ["CURATOR"], capabilities: [], csrfHash: "a".repeat(64),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe("public visitor admission", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); });

  it("does not expose visitor admission without an exact deployment allowlist", async () => {
    const create = vi.fn().mockResolvedValue({ actor, sessionToken: "session-token", csrfToken: "csrf-token" });
    const identity: IdentityService = {
      login: async () => undefined, createPublicVisitorSession: create,
      resolveSession: async () => undefined, verifyCsrf: () => false,
      revokeSession: async () => undefined, close: async () => undefined,
    };
    app = await buildApp({ identityService: identity });
    const response = await app.inject({ method: "POST", url: "/api/auth/public-visitor" });
    expect(response.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it("issues a scoped read-only session for three configured public objects", async () => {
    const create = vi.fn().mockResolvedValue({ actor, sessionToken: "session-token", csrfToken: "csrf-token" });
    const identity: IdentityService = {
      login: async () => undefined, createPublicVisitorSession: create,
      resolveSession: async () => undefined, verifyCsrf: () => false,
      revokeSession: async () => undefined, close: async () => undefined,
    };
    app = await buildApp({ identityService: identity, publicReviewObjectIds: objectIds });
    const response = await app.inject({ method: "POST", url: "/api/auth/public-visitor" });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ displayName: "Публичный просмотр",
      roles: ["CURATOR"], capabilities: [] });
    expect(create).toHaveBeenCalledWith(objectIds);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["set-cookie"]).toEqual(expect.arrayContaining([
      expect.stringContaining("inspector_session="),
      expect.stringContaining("inspector_csrf="),
    ]));
  });
});
