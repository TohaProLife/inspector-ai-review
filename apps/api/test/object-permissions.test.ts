import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectionObject } from "@inspector-ai/contracts";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor } from "../src/identity.js";
import type { InspectionRepository } from "../src/repository.js";
import { projectObjectPermissions } from "../src/object-permissions.js";

const actor = { userId: "reader", organizationId: "org", sessionId: "session", displayName: "Reader",
  roles: ["SUPERVISOR"], capabilities: ["SOURCE_REVIEW"], csrfHash: "hash", expiresAt: "2030-01-01T00:00:00Z" } as AuthenticatedActor;
const object = { id: "OBJ-ACCESS", name: "Test", address: "Test address", status: "FINALIZED", inspectionLifecycle: "FINALIZED",
  createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", activeCheckId: "CHK-ACCESS", stages: [], fileCount: 1, pageCount: 1,
  stats: { total: 132, unsupported: 132, candidates: 0, confirmed: 0, negativeVerified: 0, notComparable: 0, clarification: 0, suspicion: 0 } } as InspectionObject;
const workspaceAcl = new Set(["READ", "UPLOAD", "RUN", "REVIEW_DECIDE", "FINALIZE"]);
const headers = { cookie: "inspector_session=session; inspector_csrf=csrf", "x-csrf-token": "csrf", "idempotency-key": "access-test" };

describe("object lifecycle and scoped action permissions", () => {
  it("keeps an open-workspace supervisor read-only after FINAL without granting REVOKE", () => {
    const before = [...workspaceAcl];
    const result = projectObjectPermissions(object, actor, workspaceAcl);
    expect(result.permissions).toEqual({ upload: false, review: false, run: false, finalize: false, revoke: false });
    expect(result.readOnlyReason).toContain("финализирована");
    expect(result.revokeUnavailableReason).toContain("нет права");
    expect([...workspaceAcl]).toEqual(before);
  });
  it("requires both the explicit object ACL and supervisory role for revoke", () => {
    const acl = new Set([...workspaceAcl, "REVOKE"]);
    expect(projectObjectPermissions(object, actor, acl).permissions.revoke).toBe(true);
    expect(projectObjectPermissions(object, { ...actor, roles: ["INSPECTOR"] }, acl).permissions.revoke).toBe(false);
    expect(projectObjectPermissions({ ...object, status: "PARTIAL", inspectionLifecycle: "OPEN" }, actor, acl).permissions.revoke).toBe(false);
  });
  it("does not let a role replace missing object action permissions", () => {
    const result = projectObjectPermissions({ ...object, inspectionLifecycle: "OPEN", status: "PARTIAL" }, actor, new Set(["READ"]));
    expect(result.permissions).toEqual({ upload: false, review: false, run: false, finalize: false, revoke: false });
  });
});

describe("serialized access DTO and finalized upload guard", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); });
  async function setup() {
    const persist = vi.fn();
    app = await buildApp({ repository: {
      getObject: async (id: string, who?: AuthenticatedActor) => !who ? "AUTH_REQUIRED" : id === object.id ? object : undefined,
      listSourceFiles: async (id: string) => id === object.id ? [] : undefined,
      hasObjectPermission: async (_id: string, _actor: AuthenticatedActor, permission: string) => workspaceAcl.has(permission),
      registerIngestedFilesCommand: persist,
    } as unknown as InspectionRepository, identityService: {
      login: async () => undefined, resolveSession: async token => token === "session" ? actor : undefined,
      verifyCsrf: (_actor, value) => value === "csrf", revokeSession: async () => undefined, close: async () => undefined,
    } });
    return persist;
  }
  it("preserves real lifecycle/permissions through Fastify response serialization", async () => {
    await setup();
    const result = await app!.inject({ url: `/api/objects/${object.id}`, headers });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ inspectionLifecycle: "FINALIZED", permissions: { run: false, revoke: false },
      readOnlyReason: expect.stringContaining("финализирована"), revokeUnavailableReason: expect.stringContaining("нет права") });
    const files = await app!.inject({ url: `/api/objects/${object.id}/files`, headers });
    expect(files.statusCode, files.body).toBe(200);
    expect(files.json()).toMatchObject({ items: [], inspectionLifecycle: "FINALIZED", permissions: { upload: false, review: false, run: false },
      readOnlyReason: expect.stringContaining("финализирована") });
  }, 20_000);
  it("refuses a finalized upload with 409 before multipart processing or persistence", async () => {
    const persist = await setup();
    const result = await app!.inject({ method: "POST", url: `/api/objects/${object.id}/files?stage=PD`, headers });
    expect(result.statusCode, result.body).toBe(409);
    expect(result.json()).toMatchObject({ error: "INSPECTION_FINALIZED", message: expect.stringContaining("финализирована") });
    expect(persist).not.toHaveBeenCalled();
    const hidden = await app!.inject({ url: "/api/objects/unknown", headers });
    expect(hidden.statusCode).toBe(404);
  }, 20_000);
});
