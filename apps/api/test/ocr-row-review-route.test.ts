import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type {
  InspectionRepository, OcrRowTranscriptionReview,
  OcrRowTranscriptionReviewInput,
} from "../src/repository.js";

const hash = "a".repeat(64);
const stageHash = "b".repeat(64);
const rowHash = "c".repeat(64);
const actor: AuthenticatedActor = {
  sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(),
  displayName: "Reviewer", roles: ["INSPECTOR"], capabilities: ["REVIEW_DECIDE"],
  csrfHash: hash, expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const input: OcrRowTranscriptionReviewInput = {
  schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: stageHash,
  rowFingerprint: rowHash, decision: "REJECTED", reviewedLabel: null,
  reviewedValue: null, reviewedUnit: null,
  basis: "Лист просмотрен вручную, чтение OCR отклонено.",
};
const evidence = (role: "labelHeader" | "valueHeader" | "rowLabel" | "rawValue", lineIndex: number) => ({
  role, lineIndex, text: role, bboxPx: [1, 2, 3, 4], score: 0.9,
});
const provenance: OcrRowTranscriptionReview["provenance"] = {
  ocrStageSha256: stageHash, tableRowsContentHash: hash,
  rowFingerprint: rowHash, inputManifestHash: hash,
  sourceFileId: "FIL-1", sourceSha256: hash, pageNumber: 9,
  ocrPageContentHash: hash, renderSha256: hash,
  headerEvidence: [evidence("labelHeader", 0), evidence("valueHeader", 1)],
  labelEvidence: evidence("rowLabel", 2), valueEvidence: evidence("rawValue", 3),
};
const item: OcrRowTranscriptionReview = {
  id: randomUUID(), checkId: "CHK-1", objectId: "OBJ-1",
  review: input, provenance, actorId: actor.userId,
  contentHash: hash, createdAt: new Date().toISOString(),
};
const proposal = {
  sourceFileId: "FIL-1", inputSha256: hash, pageNumber: 9,
  ocrPageContentHash: hash, renderSha256: hash,
  headerEvidence: [evidence("labelHeader", 0), evidence("valueHeader", 1)],
  labelEvidence: evidence("rowLabel", 2), valueEvidence: evidence("rawValue", 3),
};

describe("OCR row review HTTP boundary", () => {
  let app: FastifyInstance;
  let repository: Partial<InspectionRepository>;
  const get = vi.fn();
  const record = vi.fn();
  const headers = {
    cookie: "inspector_session=session; inspector_csrf=csrf",
    "x-csrf-token": "csrf", "idempotency-key": "review-key-001",
  };

  beforeEach(async () => {
    get.mockReset().mockResolvedValue({ items: [item], canReview: true,
      ocrStageSha256: stageHash, candidates: [{ rowFingerprint: rowHash, proposal }] });
    record.mockReset().mockResolvedValue({ kind: "success", value: item, replayed: false });
    const identity: IdentityService = {
      login: async () => undefined,
      resolveSession: async (token) => token === "session" ? actor : undefined,
      verifyCsrf: (_actor, token) => token === "csrf",
      revokeSession: async () => undefined,
      close: async () => undefined,
    };
    repository = {
      getOcrRowTranscriptionReviews: get,
      recordOcrRowTranscriptionReviewCommand: record,
    };
    app = await buildApp({ repository: repository as InspectionRepository, identityService: identity });
  });

  afterEach(async () => { await app.close(); });

  it("requires session and exposes verified candidates with immutable review history", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/checks/CHK-1/ocr-row-reviews" });
    expect(anonymous.statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/checks/CHK-1/ocr-row-reviews",
      headers: { cookie: headers.cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({ ocrStageSha256: stageHash,
      candidates: [{ rowFingerprint: rowHash, proposal: { pageNumber: 9 } }],
      items: [{ review: { decision: "REJECTED" }, provenance: { sourceSha256: hash, pageNumber: 9 } }] });
    expect(response.json()).not.toHaveProperty("parameterCode");
    expect(get).toHaveBeenCalledWith("CHK-1", actor);
  });

  it("requires CSRF and idempotency, rejects extra authority fields, passes exact input", async () => {
    const url = "/api/checks/CHK-1/ocr-row-reviews";
    expect((await app.inject({ method: "POST", url, payload: input })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { cookie: headers.cookie },
      payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url,
      headers: { cookie: headers.cookie, "x-csrf-token": "csrf" },
      payload: input })).statusCode).toBe(428);
    expect((await app.inject({ method: "POST", url, headers,
      payload: { ...input, parameterCode: "PZ-004" } })).statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();

    const response = await app.inject({ method: "POST", url, headers, payload: input });
    expect(response.statusCode).toBe(201);
    expect(response.json().review).toEqual(input);
    expect(response.json()).not.toHaveProperty("typedFact");
    expect(record).toHaveBeenCalledWith("CHK-1", input,
      expect.objectContaining({ actor, idempotencyKey: "review-key-001" }));
  });

  it("maps repository conflict and unavailable states without writing a decision", async () => {
    record.mockResolvedValueOnce({ kind: "idempotency_conflict" });
    const conflict = await app.inject({ method: "POST", url: "/api/checks/CHK-1/ocr-row-reviews",
      headers, payload: input });
    expect(conflict.statusCode).toBe(409);
    get.mockResolvedValueOnce(undefined);
    const missing = await app.inject({ method: "GET", url: "/api/checks/CHK-1/ocr-row-reviews",
      headers: { cookie: headers.cookie } });
    expect(missing.statusCode).toBe(404);
    repository.getOcrRowTranscriptionReviews = undefined;
    repository.recordOcrRowTranscriptionReviewCommand = undefined;
    const readUnavailable = await app.inject({ method: "GET", url: "/api/checks/CHK-1/ocr-row-reviews",
      headers: { cookie: headers.cookie } });
    const writeUnavailable = await app.inject({ method: "POST", url: "/api/checks/CHK-1/ocr-row-reviews",
      headers, payload: input });
    expect(readUnavailable.statusCode).toBe(503);
    expect(writeUnavailable.statusCode).toBe(503);
  });
});
