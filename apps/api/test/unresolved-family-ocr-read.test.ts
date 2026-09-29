import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import type { InspectionRepository, PilotResultsRead } from "../src/repository.js";
import { InspectorStore } from "../src/store.js";

const hash = (character: string) => character.repeat(64);
const lead = {
  sourceFileId: "F0163", sourceSha256: hash("a"), textArtifactSha256: hash("b"),
  ocrStageSha256: hash("c"), ocrPageSha256: hash("d"), pageNumber: 7,
  stage: "RD" as const, sectionCode: "VK" as const,
  coordinateSystem: "IMAGE_TOP_LEFT_PIXELS" as const, lineIndex: 3,
  lineText: "труба ПВХ водоснабжение", score: 0.9,
  bboxPx: [10, 20, 300, 40] as [number, number, number, number],
  renderSha256: hash("e"), rendererProfileId: "pdfium-v1",
  providerProfileId: "paddle-v1", providerScript: "cyrillic",
  dpi: 200, widthPx: 1000, heightPx: 1400, leadSha256: hash("f"),
};
const sidecar: NonNullable<PilotResultsRead["unresolvedFamilyOcrReview"]> = {
  schemaVersion: "unresolved-family-ocr-review-v1",
  profileId: "unresolved-family-ocr-review-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("0"), ocrStageSha256: hash("c"),
  sourceStageArtifacts: [{ sourceFileId: "F0163", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }],
  codeRows: [
    { parameterCode: "AR-042", status: "ABSTAIN", reasonCodes: [
      "NO_EXACT_LINE_LEAD", "SOURCE_REVIEW_NOT_CURRENT_APPROVED"], leads: [] },
    { parameterCode: "IOS2-072", status: "ABSTAIN", reasonCodes: [
      "LEAD_NOT_VERIFIED_FACT", "OCR_TEXT_REQUIRES_VISUAL_REVIEW"], leads: [lead] },
    { parameterCode: "IOS3-075", status: "ABSTAIN", reasonCodes: [
      "NO_EXACT_LINE_LEAD", "OCR_PAGES_DEFERRED"], leads: [] },
  ], findingCount: null, parameterCoverage: null, contentHash: hash("1"),
};

describe("unresolved family OCR read response", () => {
  it("keeps the full versioned sidecar in authenticated pilot results", async () => {
    const actor = { sessionId: "session", userId: "reader", displayName: "Reader",
      organizationId: "organization", roles: ["INSPECTOR"], capabilities: ["READ"],
      csrfHash: "", expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as AuthenticatedActor;
    const identity: IdentityService = { login: async () => undefined,
      resolveSession: async (token) => token === "valid" ? actor : undefined,
      verifyCsrf: () => false, revokeSession: async () => {}, close: async () => {} };
    const memory = await InspectorStore.create();
    const repository = new Proxy(memory, { get(target, property) {
      if (property === "getPilotResults") return async (checkId: string,
        currentActor: AuthenticatedActor) => currentActor.userId === actor.userId
          && checkId === "CHK-1" ? { checkId, status: "READY", items: [],
            ocrHeatRows: null, unresolvedFamilyOcrReview: sidecar } : "FORBIDDEN";
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    } }) as InspectionRepository;
    const app = await buildApp({ repository, identityService: identity });
    try {
      const url = "/api/checks/CHK-1/pilot-results";
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      const response = await app.inject({ method: "GET", url,
        headers: { cookie: "inspector_session=valid" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().unresolvedFamilyOcrReview).toEqual(sidecar);
    } finally { await app.close(); }
  });
});
