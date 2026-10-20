import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository } from "../src/repository.js";
import { SourceOcrImportError } from "../src/source-ocr-import.js";
const actor: AuthenticatedActor = { userId: "USER", organizationId: "ORG", sessionId: "SESSION", displayName: "Synthetic reader",
  roles: ["INSPECTOR"], capabilities: [], csrfHash: "unused", expiresAt: "2030-01-01T00:00:00Z" };
const listUrl = "/api/checks/CHK/source-ocr-imports", importUrl = "/api/checks/CHK/sources/FIL/source-ocr-imports", reviewUrl = "/api/checks/CHK/source-ocr-reviews";
const headers = { cookie: "inspector_session=valid; inspector_csrf=csrf", "x-csrf-token": "csrf", "idempotency-key": "source-ocr-test-0001" };
const bundle = { schemaVersion: "source-ocr-import-bundle-v1", sourceSha256: "a".repeat(64), profileId: "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1",
  pages: [{ pageNumber: 1, pdfWidthMilliPoints: 100000, pdfHeightMilliPoints: 100000, rasterWidth: 100, rasterHeight: 100, renderSha256: "b".repeat(64), rawResponseJson: "{}" }] };
const reviewInput = { schemaVersion: "source-ocr-review-command-v1", importId: "12345678-1234-1234-1234-123456789abc", importContentHash: "c".repeat(64),
  pageNumber: 1, ordinal: 0, lineHash: "d".repeat(64), decision: "CONFIRMED", basis: "Сверено с исходником", expectedReviewHash: null };
const read = vi.fn(), capture = vi.fn(), review = vi.fn(); let app: FastifyInstance;
beforeEach(async () => {
  read.mockReset().mockResolvedValue({ schemaVersion: "source-ocr-import-workspace-v1", checkId: "CHK", canImport: false, canReview: false, availability: "READY", items: [], reviews: [] });
  capture.mockReset().mockResolvedValue({ value: { schemaVersion: "source-ocr-import-record-v1", id: "REC", contentHash: "e".repeat(64), derived: {
    p: null, factEligible: false, coverageDelta: 0, providerExecutionVerified: false, renderDerivationVerified: false } }, replayed: false });
  review.mockReset().mockResolvedValue({ value: { ...reviewInput, schemaVersion: "source-ocr-review-record-v1", contentHash: "f".repeat(64), humanTranscriptionOnly: true, p: null, factEligible: false, coverageDelta: 0 }, replayed: false });
  const identity: IdentityService = { login: async () => undefined, resolveSession: async token => token === "valid" ? actor : undefined,
    verifyCsrf: (_actor, token) => token === "csrf", revokeSession: async () => undefined, close: async () => undefined };
  app = await buildApp({ repository: { getSourceOcrImports: read, importSourceOcrCommand: capture, reviewSourceOcrCommand: review } as unknown as InspectionRepository, identityService: identity });
});
afterEach(async () => { await app.close(); });
it("requires session before existence, import or review", async () => {
  expect((await app.inject(listUrl)).statusCode).toBe(401);
  for (const url of [importUrl, reviewUrl]) expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
  expect(read).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
});
it.each([[importUrl, bundle], [reviewUrl, reviewInput]])("requires CSRF/key for %s", async (url, payload) => {
  expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie }, payload })).statusCode).toBe(403);
  expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie, "x-csrf-token": "csrf" }, payload })).statusCode).toBe(428);
});
it.each([null, [], {}, { ...bundle, schemaVersion: "unknown" }, { ...bundle, sourceSha256: "bad" }, { ...bundle, factEligible: true }, { ...bundle, pages: [] },
  { ...bundle, pages: [{ ...bundle.pages[0], imageUrl: "https://untrusted.invalid/image" }] }])("rejects malformed/imported trust fields before repository %j", async payload => {
  const response = await app.inject({ method: "POST", url: importUrl, headers: { ...headers, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  expect(response.statusCode, response.body).toBe(400); expect(capture).not.toHaveBeenCalled();
});
it.each([{ ...reviewInput, engineeringQualification: true }, { ...reviewInput, lineHash: "bad" }, { ...reviewInput, pageNumber: 0 },
  { ...reviewInput, ordinal: 10000 }, { ...reviewInput, basis: " " }, { ...reviewInput, basis: "abc\u0000" }, { ...reviewInput, basis: "abc\ud800" },
  { ...reviewInput, decision: "AUTO_CONFIRMED" }, { ...reviewInput, expectedReviewHash: "bad" }])("rejects ambiguous review %j", async payload => {
  expect((await app.inject({ method: "POST", url: reviewUrl, headers, payload })).statusCode).toBe(400); expect(review).not.toHaveBeenCalled();
});
it("preserves source-only and human-only fields with replay SHA/no-store headers through production serializer", async () => {
  const imported = await app.inject({ method: "POST", url: importUrl, headers, payload: bundle });
  expect(imported.statusCode, imported.body).toBe(201); expect(imported.headers["x-content-sha256"]).toBe("e".repeat(64));
  expect(imported.headers["cache-control"]).toBe("private, no-store"); expect(imported.json().derived).toMatchObject({ p: null, factEligible: false, coverageDelta: 0, providerExecutionVerified: false, renderDerivationVerified: false });
  expect(capture).toHaveBeenCalledWith("CHK", "FIL", bundle, expect.objectContaining({ actor }));
  const reviewed = await app.inject({ method: "POST", url: reviewUrl, headers, payload: reviewInput });
  expect(reviewed.statusCode).toBe(201); expect(reviewed.json()).toMatchObject({ humanTranscriptionOnly: true, p: null, factEligible: false, coverageDelta: 0 });
});
it("returns explicit source/state failures and scoped missing reads", async () => {
  read.mockResolvedValueOnce(undefined); expect((await app.inject({ url: listUrl, headers })).statusCode).toBe(404);
  capture.mockRejectedValueOnce(new SourceOcrImportError(409, "SOURCE_OCR_SOURCE_MISMATCH", "Другой исходник"));
  expect((await app.inject({ method: "POST", url: importUrl, headers, payload: bundle })).json()).toEqual({ error: "SOURCE_OCR_SOURCE_MISMATCH", message: "Другой исходник" });
  review.mockRejectedValueOnce(new Error("private-storage-detail"));
  const response = await app.inject({ method: "POST", url: reviewUrl, headers, payload: reviewInput }); expect(response.statusCode).toBe(503); expect(response.body).not.toContain("private-storage-detail");
});
it("documents authenticated bounded commands, replay and explicit integration boundary", async () => {
  const document = (await app.inject("/api/openapi.json")).json();
  for (const url of ["/checks/{id}/sources/{sourceFileId}/source-ocr-imports", "/checks/{id}/source-ocr-reviews"]) {
    const operation = document.paths[url].post; expect(operation.security).toEqual([{ sessionCookie: [] }]);
    expect(operation.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Idempotency-Key", required: true }), expect.objectContaining({ name: "X-CSRF-Token", required: true })]));
    expect(operation.responses["413"]).toBeDefined();
  }
});
