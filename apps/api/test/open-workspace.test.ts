import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";

const actor: AuthenticatedActor = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  displayName: "Рабочее место",
  roles: ["SUPERVISOR"], capabilities: ["OBJECT_CREATE", "REVIEW_DECIDE", "SOURCE_REVIEW"],
  csrfHash: "a".repeat(64), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe("open workspace admission", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); });

  it("stays unavailable unless explicitly enabled", async () => {
    const create = vi.fn().mockResolvedValue({ actor, sessionToken: "session-token", csrfToken: "csrf-token" });
    const identity: IdentityService = {
      login: async () => undefined, createOpenWorkspaceSession: create,
      resolveSession: async () => undefined, verifyCsrf: () => false,
      revokeSession: async () => undefined, close: async () => undefined,
    };
    app = await buildApp({ identityService: identity });
    const response = await app.inject({ method: "POST", url: "/api/auth/open-workspace" });
    expect(response.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it("issues an auditable workspace session without password and disables login", async () => {
    const create = vi.fn().mockResolvedValue({ actor, sessionToken: "session-token", csrfToken: "csrf-token" });
    const identity: IdentityService = {
      login: vi.fn(), createOpenWorkspaceSession: create,
      resolveSession: async (token) => token === "session-token" ? actor : undefined,
      verifyCsrf: () => true, revokeSession: async () => undefined, close: async () => undefined,
    };
    app = await buildApp({ identityService: identity, openWorkspace: true });
    const response = await app.inject({ method: "POST", url: "/api/auth/open-workspace" });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ displayName: "Рабочее место",
      roles: ["SUPERVISOR"], capabilities: ["OBJECT_CREATE", "REVIEW_DECIDE", "SOURCE_REVIEW"] });
    expect(response.headers["set-cookie"]).toEqual(expect.arrayContaining([
      expect.stringContaining("inspector_session="), expect.stringContaining("inspector_csrf="),
    ]));
    const login = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { login: "someone", password: "long-password-123" } });
    expect(login.statusCode).toBe(404);
    expect(identity.login).not.toHaveBeenCalled();
  });
});
