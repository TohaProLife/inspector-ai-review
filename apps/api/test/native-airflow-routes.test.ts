import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository } from "../src/repository.js";
import { NativeSourceComparisonError as NativeAirflowError } from "../src/native-source-comparison-error.js";

const actor: AuthenticatedActor = { userId: "USER", organizationId: "ORG", sessionId: "SESSION", displayName: "Synthetic reader",
  roles: ["INSPECTOR"], capabilities: [], csrfHash: "unused", expiresAt: "2030-01-01T00:00:00Z" };
const url = "/api/checks/CHK-AIRFLOW/native-airflow-comparisons";
const input = { schemaVersion: "native-airflow-command-v1", pdSourceFileId: "FIL-PD", rdSourceFileId: "FIL-RD", selection: { pdSystemId: "П17", rdSystemIds: ["П17.1", "П17.2"] } };
const headers = { cookie: "inspector_session=valid; inspector_csrf=csrf-test", "x-csrf-token": "csrf-test", "idempotency-key": "airflow-test-0001" };
let app: FastifyInstance;
const read = vi.fn(), compare = vi.fn();
beforeEach(async () => {
  read.mockReset().mockResolvedValue({ schemaVersion: "native-airflow-workspace-v1", checkId: "CHK-AIRFLOW", canCompare: true, availability: "READY", items: [] });
  compare.mockReset().mockResolvedValue({ value: { schemaVersion: "native-airflow-record-v1", id: "RECORD", contentHash: "a".repeat(64), comparison: { p: null, factEligible: false, coverageDelta: 0 } }, replayed: false });
  const identity: IdentityService = { login: async () => undefined, resolveSession: async token => token === "valid" ? actor : undefined,
    verifyCsrf: (_actor, token) => token === "csrf-test", revokeSession: async () => undefined, close: async () => undefined };
  app = await buildApp({ repository: { getNativeAirflowComparisons: read, compareNativeAirflowCommand: compare } as unknown as InspectionRepository, identityService: identity });
});
afterEach(async () => { await app.close(); });
it("requires real session before reading check existence or mutating", async () => {
  expect((await app.inject(url)).statusCode).toBe(401);
  expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
  expect(read).not.toHaveBeenCalled(); expect(compare).not.toHaveBeenCalled();
});
it("requires CSRF and an idempotency key before mutation", async () => {
  expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie, "idempotency-key": headers["idempotency-key"] }, payload: input })).statusCode).toBe(403);
  expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie, "x-csrf-token": "csrf-test" }, payload: input })).statusCode).toBe(428);
  expect(compare).not.toHaveBeenCalled();
});
it.each([null, [], {}, { ...input, p: 0.99 }, { ...input, schemaVersion: "v2" }, { ...input, pdSourceFileId: "FIL/escape" }, { ...input, rdSourceFileId: "" }, { ...input, selection: null },
  { ...input, selection: { ...input.selection, extra: true } }, { ...input, selection: { ...input.selection, pdSystemId: "P17" } },
  { ...input, selection: { ...input.selection, rdSystemIds: ["П17.1", "П17.1"] } }, { ...input, selection: { ...input.selection, rdSystemIds: [] } },
  { ...input, selection: { ...input.selection, rdSystemIds: Array.from({length: 17}, (_,i) => `П17.${i + 1}`) } }])("rejects malformed or client-authored analysis payload %j", async payload => {
  const response = await app.inject({ method: "POST", url, headers: { ...headers, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  expect(response.statusCode, response.body).toBe(400); expect(compare).not.toHaveBeenCalled();
});
it("refuses self-comparison and oversized commands before repository", async () => {
  expect((await app.inject({ method: "POST", url, headers, payload: { ...input, rdSourceFileId: input.pdSourceFileId } })).statusCode).toBe(422);
  expect((await app.inject({ method: "POST", url, headers, payload: { ...input, extra: "x".repeat(5000) } })).statusCode).toBe(413);
  expect(compare).not.toHaveBeenCalled();
});
it("retains nullable probability and all source-only fields through actual app serializer", async () => {
  const response = await app.inject({ method: "POST", url, headers, payload: input });
  expect(response.statusCode, response.body).toBe(201); expect(response.headers["idempotency-replayed"]).toBe("false");
  expect(response.headers["x-content-sha256"]).toBe("a".repeat(64)); expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.json().comparison).toEqual({ p: null, factEligible: false, coverageDelta: 0 });
  expect(compare).toHaveBeenCalledWith("CHK-AIRFLOW", input, expect.objectContaining({ actor, idempotencyKey: headers["idempotency-key"] }));
  compare.mockResolvedValueOnce({ value: response.json(), replayed: true });
  expect((await app.inject({ method: "POST", url, headers, payload: input })).headers["idempotency-replayed"]).toBe("true");
});
it("returns scoped history and explicit integrity/source failures", async () => {
  const response = await app.inject({ url, headers }); expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ checkId: "CHK-AIRFLOW", items: [], canCompare: true });
  read.mockResolvedValueOnce(undefined); expect((await app.inject({ url, headers })).statusCode).toBe(404);
  compare.mockRejectedValueOnce(new NativeAirflowError(409, "NATIVE_AIRFLOW_ARTIFACT_UNAVAILABLE", "Артефакт недоступен"));
  const failed = await app.inject({ method: "POST", url, headers, payload: input }); expect(failed.statusCode).toBe(409);
  expect(failed.json()).toEqual({ error: "NATIVE_AIRFLOW_ARTIFACT_UNAVAILABLE", message: "Артефакт недоступен" });
});
it("publishes authenticated read and CSRF/idempotency guarded write contracts", async () => {
  const document = (await app.inject("/api/openapi.json")).json();
  const operations = document.paths["/checks/{id}/native-airflow-comparisons"];
  expect(operations.get.security).toEqual([{ sessionCookie: [] }]);
  expect(operations.post.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "X-CSRF-Token", required: true }), expect.objectContaining({ name: "Idempotency-Key", required: true })]));
  expect(operations.post.responses["428"]).toBeDefined();
  expect(document.components.schemas.NativeAirflowInput.additionalProperties).toBe(false);
});
