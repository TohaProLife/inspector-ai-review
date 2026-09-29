import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository, OcrFactPairQuantityReviewInput } from "../src/repository.js";

const sha = "a".repeat(64);
const actor: AuthenticatedActor = {
  sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(),
  displayName: "Reviewer", roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
  csrfHash: sha, expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const input: OcrFactPairQuantityReviewInput = {
  schemaVersion: "ocr-fact-pair-quantity-review-v1", decision: "UNSURE",
  targetCheckId: "CHK-1", inputManifestHash: sha, objectId: "OBJ-1",
  parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
  entityKey: "building-1", context: "Здание целиком",
  pdFactId: "b".repeat(64), pdLocatorHash: "c".repeat(64),
  rdFactId: "d".repeat(64), rdLocatorHash: "e".repeat(64),
  pairDecisionId: randomUUID(), pairTargetReviewHash: "f".repeat(64),
  pdDenominatorAffirmed: false, pdPageNumber: 1, rdPageNumber: 2,
  basis: { scope: "Границы объекта пока не совпадают",
    quantityType: "Тип величины требует сверки",
    period: "Период ещё не подтверждён",
    aggregation: "Суммирование требует проверки" },
};

describe("OCR fact pair quantity HTTP boundary", () => {
  let app: FastifyInstance;
  const get = vi.fn();
  const getComparison = vi.fn();
  const record = vi.fn();
  const url = "/api/checks/CHK-1/ocr-fact-pair-quantity-reviews";
  const cookie = "inspector_session=session; inspector_csrf=csrf";
  const headers = { cookie, "x-csrf-token": "csrf",
    "idempotency-key": "ocr-quantity-key-001" };

  beforeEach(async () => {
    get.mockReset().mockResolvedValue({ items: [], effectiveItems: [], candidates: [],
      canReview: false, reasonCode: "OCR_QUANTITY_SNAPSHOT_REQUIRED" });
    getComparison.mockReset().mockResolvedValue({ items: [] });
    record.mockReset().mockResolvedValue({ kind: "invalid_state",
      code: "OCR_QUANTITY_SNAPSHOT_REQUIRED",
      message: "Нужен повторный запуск после подтверждения пары" });
    const identity: IdentityService = {
      login: async () => undefined,
      resolveSession: async (token) => token === "session" ? actor : undefined,
      verifyCsrf: (_actor, token) => token === "csrf",
      revokeSession: async () => undefined, close: async () => undefined,
    };
    app = await buildApp({ repository: {
      getOcrFactPairQuantityReviews: get,
      getOcrFactPairComparisonPreviews: getComparison,
      recordOcrFactPairQuantityReviewCommand: record,
    } as unknown as InspectionRepository, identityService: identity });
  });
  afterEach(async () => { await app.close(); });

  it("requires session and reports missing immutable pair snapshot", async () => {
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({ items: [], effectiveItems: [], candidates: [],
      canReview: false, reasonCode: "OCR_QUANTITY_SNAPSHOT_REQUIRED" });
    expect(get).toHaveBeenCalledWith("CHK-1", actor);
  });

  it("requires CSRF and idempotency; rejects client authority fields", async () => {
    expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { cookie },
      payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url,
      headers: { cookie, "x-csrf-token": "csrf" }, payload: input })).statusCode).toBe(428);
    expect((await app.inject({ method: "POST", url, headers,
      payload: { ...input, evidenceHash: sha } })).statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("returns abstention without comparison or finding", async () => {
    const response = await app.inject({ method: "POST", url, headers, payload: input });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "OCR_QUANTITY_SNAPSHOT_REQUIRED" });
    expect(response.json()).not.toHaveProperty("comparison");
    expect(response.json()).not.toHaveProperty("finding");
    expect(record).toHaveBeenCalledWith("CHK-1", input,
      expect.objectContaining({ actor, idempotencyKey: "ocr-quantity-key-001" }));
  });

  it("keeps numerical comparison a separate authenticated read-only preview", async () => {
    const previewUrl = "/api/checks/CHK-1/ocr-fact-pair-comparison-previews";
    expect((await app.inject({ method: "GET", url: previewUrl })).statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: previewUrl,
      headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({ items: [] });
    expect(getComparison).toHaveBeenCalledWith("CHK-1", actor);
  });
});
