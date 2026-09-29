import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository, OcrFactPairReview,
  OcrFactPairReviewInput } from "../src/repository.js";

const sha = "a".repeat(64);
const actor: AuthenticatedActor = {
  sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(),
  displayName: "Reviewer", roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
  csrfHash: sha, expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const input: OcrFactPairReviewInput = {
  schemaVersion: "ocr-fact-pair-review-v1", decision: "UNSURE",
  targetCheckId: "CHK-1", inputManifestHash: sha, objectId: "OBJ-1",
  parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
  pdFactId: "b".repeat(64), pdLocatorHash: "c".repeat(64),
  rdFactId: "d".repeat(64), rdLocatorHash: "e".repeat(64),
  entityKey: "building-1", context: "Здание целиком", linkGroupId: "group-1",
  basis: "Исходные листы требуют повторной предметной сверки.",
};
const item: OcrFactPairReview = {
  id: randomUUID(), checkId: "CHK-1", objectId: "OBJ-1", review: input,
  provenance: {
    artifactHash: sha,
    pdSourceFileId: "FIL-PD", pdSourceSha256: sha, pdSourceReviewHash: sha,
    rdSourceFileId: "FIL-RD", rdSourceSha256: sha, rdSourceReviewHash: sha,
  },
  eligibleForPairReview: false, actorId: actor.userId,
  contentHash: sha, createdAt: new Date().toISOString(),
};

describe("OCR fact pair review HTTP boundary", () => {
  let app: FastifyInstance;
  const get = vi.fn();
  const getSnapshots = vi.fn();
  const record = vi.fn();
  const url = "/api/checks/CHK-1/ocr-fact-pair-reviews";
  const headers = { cookie: "inspector_session=session; inspector_csrf=csrf",
    "x-csrf-token": "csrf", "idempotency-key": "ocr-pair-key-001" };

  beforeEach(async () => {
    get.mockReset().mockResolvedValue({ items: [item], canReview: true, candidates: [] });
    getSnapshots.mockReset().mockResolvedValue({ items: [] });
    record.mockReset().mockResolvedValue({ kind: "success", value: item, replayed: false });
    const identity: IdentityService = {
      login: async () => undefined,
      resolveSession: async (token) => token === "session" ? actor : undefined,
      verifyCsrf: (_actor, token) => token === "csrf",
      revokeSession: async () => undefined, close: async () => undefined,
    };
    app = await buildApp({ repository: { getOcrFactPairReviews: get,
      getOcrFactPairSnapshots: getSnapshots,
      recordOcrFactPairReviewCommand: record } as unknown as InspectionRepository,
    identityService: identity });
  });
  afterEach(async () => { await app.close(); });

  it("requires a session and returns review-only history", async () => {
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url,
      headers: { cookie: headers.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({ items: [{ eligibleForPairReview: false,
      review: { decision: "UNSURE" } }], candidates: [] });
    expect(get).toHaveBeenCalledWith("CHK-1", actor);
  });

  it("scopes immutable next-run pair snapshots to the session", async () => {
    const snapshotsUrl = "/api/checks/CHK-1/ocr-fact-pair-snapshots";
    expect((await app.inject({ method: "GET", url: snapshotsUrl })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: snapshotsUrl,
      headers: { cookie: headers.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(getSnapshots).toHaveBeenCalledWith("CHK-1", actor);
  });

  it("serializes an abstained target snapshot without inventing a rebound pair", async () => {
    getSnapshots.mockResolvedValueOnce({ items: [{
      decisionId: item.id, decisionContentHash: item.contentHash,
      actorId: actor.userId, originCheckId: "CHK-0", targetCheckId: "CHK-1",
      originReview: { ...input, targetCheckId: "CHK-0" },
      review: null, targetReviewHash: null, provenance: null,
      eligibleForPairReview: false, reasonCode: "TARGET_FACT_UNAVAILABLE",
    }] });
    const response = await app.inject({ method: "GET",
      url: "/api/checks/CHK-1/ocr-fact-pair-snapshots",
      headers: { cookie: headers.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([expect.objectContaining({
      review: null, provenance: null, targetReviewHash: null,
      eligibleForPairReview: false, reasonCode: "TARGET_FACT_UNAVAILABLE",
    })]);
  });

  it("serializes a synthetic rebound as review-only lineage", async () => {
    getSnapshots.mockResolvedValueOnce({ items: [{
      decisionId: item.id, decisionContentHash: item.contentHash,
      actorId: actor.userId, originCheckId: "CHK-0", targetCheckId: "CHK-1",
      originReview: { ...input, targetCheckId: "CHK-0" },
      review: input, targetReviewHash: sha, provenance: item.provenance,
      eligibleForPairReview: false, reasonCode: "REBOUND",
    }] });
    const response = await app.inject({ method: "GET",
      url: "/api/checks/CHK-1/ocr-fact-pair-snapshots",
      headers: { cookie: headers.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([expect.objectContaining({
      review: expect.objectContaining({ decision: "UNSURE" }),
      provenance: expect.objectContaining({ artifactHash: sha }),
      eligibleForPairReview: false, reasonCode: "REBOUND",
    })]);
  });

  it("requires CSRF and idempotency, rejects injected authority fields", async () => {
    expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url,
      headers: { cookie: headers.cookie }, payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url,
      headers: { cookie: headers.cookie, "x-csrf-token": "csrf" },
      payload: input })).statusCode).toBe(428);
    expect((await app.inject({ method: "POST", url, headers,
      payload: { ...input, approvedPair: true } })).statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
    const response = await app.inject({ method: "POST", url, headers, payload: input });
    expect(response.statusCode).toBe(201);
    expect(record).toHaveBeenCalledWith("CHK-1", input,
      expect.objectContaining({ actor, idempotencyKey: "ocr-pair-key-001" }));
  });

  it("does not turn an unverified pair into a finding", async () => {
    record.mockResolvedValueOnce({ kind: "invalid_state", code: "OCR_FACT_PAIR_NOT_VERIFIED",
      message: "Пара не соответствует проверенным фактам и источникам" });
    const response = await app.inject({ method: "POST", url, headers, payload: input });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "OCR_FACT_PAIR_NOT_VERIFIED" });
    expect(response.json()).not.toHaveProperty("finding");
  });
});
