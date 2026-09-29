import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository, OcrRowApplicabilityReview,
  OcrRowApplicabilityReviewInput } from "../src/repository.js";

const sha = "a".repeat(64);
const actor: AuthenticatedActor = {
  sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(),
  displayName: "Reviewer", roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
  csrfHash: sha, expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const input: OcrRowApplicabilityReviewInput = {
  schemaVersion: "ocr-row-applicability-review-v1", decision: "UNSURE",
  targetCheckId: "CHK-1", sourceFileId: "FIL-1", sourceSha256: sha,
  pageNumber: 9, renderSha256: sha, ocrStageSha256: sha,
  rowFingerprint: sha, transcriptionDecisionId: randomUUID(),
  transcriptionDecisionHash: sha, sourceReviewDecisionId: randomUUID(),
  sourceReviewDecisionHash: sha, parameterCode: "PZ-002",
  attribute: "BUILDING_TOTAL_AREA", stage: "RD", entityKey: "building-1",
  context: "Здание целиком; область применения не установлена.",
  basis: "Проверка исходного листа пока не подтверждает применение строки.",
};
const item: OcrRowApplicabilityReview = {
  id: randomUUID(), checkId: "CHK-1", objectId: "OBJ-1", review: input,
  provenance: {
    targetCheckId: "CHK-1", objectId: "OBJ-1", inputManifestHash: sha,
    originInputManifestHash: sha, sourceFileId: "FIL-1", sourceSha256: sha,
    pageNumber: 9, ocrPageContentHash: sha, renderSha256: sha,
    ocrStageSha256: sha, tableRowsContentHash: sha, rowFingerprint: sha,
    transcriptionDecisionId: input.transcriptionDecisionId,
    transcriptionDecisionHash: sha, sourceReviewDecisionId: input.sourceReviewDecisionId,
    sourceReviewDecisionHash: sha, sectionCode: "AR",
  },
  eligibleForFactReview: false, actorId: actor.userId,
  contentHash: sha, createdAt: new Date().toISOString(),
};

describe("OCR row applicability HTTP boundary", () => {
  let app: FastifyInstance;
  let repository: Partial<InspectionRepository>;
  const get = vi.fn();
  const record = vi.fn();
  const url = "/api/checks/CHK-1/ocr-row-applicability-reviews";
  const headers = { cookie: "inspector_session=session; inspector_csrf=csrf",
    "x-csrf-token": "csrf", "idempotency-key": "applicability-key-001" };

  beforeEach(async () => {
    get.mockReset().mockResolvedValue({ items: [item], canReview: true, candidates: [] });
    record.mockReset().mockResolvedValue({ kind: "success", value: item, replayed: false });
    const identity: IdentityService = {
      login: async () => undefined,
      resolveSession: async (token) => token === "session" ? actor : undefined,
      verifyCsrf: (_actor, token) => token === "csrf",
      revokeSession: async () => undefined, close: async () => undefined,
    };
    repository = { getOcrRowApplicabilityReviews: get,
      recordOcrRowApplicabilityReviewCommand: record };
    app = await buildApp({ repository: repository as InspectionRepository,
      identityService: identity });
  });
  afterEach(async () => { await app.close(); });

  it("scopes read to session and keeps negative decision out of facts", async () => {
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url,
      headers: { cookie: headers.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({ items: [{ eligibleForFactReview: false,
      review: { decision: "UNSURE" } }] });
    expect(get).toHaveBeenCalledWith("CHK-1", actor);
  });

  it("requires CSRF and idempotency and rejects added authority fields", async () => {
    expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url,
      headers: { cookie: headers.cookie }, payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url,
      headers: { cookie: headers.cookie, "x-csrf-token": "csrf" },
      payload: input })).statusCode).toBe(428);
    expect((await app.inject({ method: "POST", url, headers,
      payload: { ...input, verifiedFact: true } })).statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
    const response = await app.inject({ method: "POST", url, headers, payload: input });
    expect(response.statusCode).toBe(201);
    expect(record).toHaveBeenCalledWith("CHK-1", input,
      expect.objectContaining({ actor, idempotencyKey: "applicability-key-001" }));
  });
});
