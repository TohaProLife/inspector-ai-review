import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository } from "../src/repository.js";

const actor: AuthenticatedActor = {
  sessionId: randomUUID(), userId: randomUUID(), organizationId: randomUUID(),
  displayName: "Reviewer", roles: ["INSPECTOR"], capabilities: [],
  csrfHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe("opt-in OCR_ROW typed fact review endpoint", () => {
  let app: FastifyInstance;
  const get = vi.fn();
  const base = "/api/checks/CHK-1/ocr-typed-facts";
  const opted = `${base}?profile=ocr-typed-fact-candidates-v1`;

  beforeEach(async () => {
    get.mockReset().mockResolvedValue({ schemaVersion: "ocr-typed-fact-candidates-v1",
      items: [], snapshotCount: 0, abstainedCount: 0,
      findingCount: 0, coverageCount: 0 });
    const identity: IdentityService = {
      login: async () => undefined,
      resolveSession: async (token) => token === "session" ? actor : undefined,
      verifyCsrf: () => true,
      revokeSession: async () => undefined, close: async () => undefined,
    };
    app = await buildApp({ repository: {
      getOcrTypedFactCandidates: get,
    } as unknown as InspectionRepository, identityService: identity });
  });
  afterEach(async () => { await app.close(); });

  it("stays off without exact profile and requires authenticated scope", async () => {
    expect((await app.inject({ method: "GET", url: base,
      headers: { cookie: "inspector_session=session" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `${base}?profile=typed-fact-v1`,
      headers: { cookie: "inspector_session=session" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: opted })).statusCode).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns only review candidates with explicit zero domain effects", async () => {
    const result = await app.inject({ method: "GET", url: opted,
      headers: { cookie: "inspector_session=session" } });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.json()).toEqual({ schemaVersion: "ocr-typed-fact-candidates-v1",
      items: [], snapshotCount: 0, abstainedCount: 0,
      findingCount: 0, coverageCount: 0 });
    expect(get).toHaveBeenCalledWith("CHK-1", actor);
  });

  it("serializes the versioned OCR_ROW locator without retyping it as TEXT_BLOCK", async () => {
    const hash = "a".repeat(64);
    const evidence = (role: string) => ({ role, lineIndex: 0,
      text: "84,9 м²", bboxPx: [1, 2, 3, 4], score: 0.95 });
    get.mockResolvedValueOnce({ schemaVersion: "ocr-typed-fact-candidates-v1",
      snapshotCount: 1, abstainedCount: 0, findingCount: 0, coverageCount: 0,
      items: [{ schemaVersion: "typed-fact-v2", factId: hash,
        targetCheckId: "CHK-1", inputManifestHash: hash,
        objectId: "OBJ-1", sourceFileId: "FIL-1", sourceSha256: hash,
        stage: "RD", pageNumber: 9, parameterCode: "PZ-002",
        attribute: "BUILDING_TOTAL_AREA", entityKey: "building-1",
        context: "Синтетический контекст", rawText: "Общая площадь здания\t84,9 м²",
        rawValue: "84,9", rawUnit: "м²", locator: {
          kind: "OCR_ROW", originInputManifestHash: hash,
          ocrPageContentHash: hash, renderSha256: hash, ocrStageSha256: hash,
          tableRowsContentHash: hash, rowFingerprint: hash,
          transcriptionDecisionId: randomUUID(), transcriptionDecisionHash: hash,
          sourceReviewDecisionId: randomUUID(), sourceReviewDecisionHash: hash,
          applicabilityDecisionId: randomUUID(), applicabilityDecisionHash: hash,
          targetSnapshotHash: hash, originCheckId: "CHK-ORIGIN", sectionCode: "AR",
          labelEvidence: evidence("rowLabel"), valueEvidence: evidence("rawValue"),
        } }],
    });
    const response = await app.inject({ method: "GET", url: opted,
      headers: { cookie: "inspector_session=session" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ findingCount: 0, coverageCount: 0,
      items: [{ schemaVersion: "typed-fact-v2",
        locator: { kind: "OCR_ROW", targetSnapshotHash: hash,
          applicabilityDecisionHash: hash } }] });
  });
});
