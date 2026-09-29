import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import { projectCandidateFamilyOcrObservationsRead, projectCandidateFamilyObservationsRead,
  projectCandidateFamilyPreviewRead, projectFactFamilyRead, projectOcrHeatRowsRead,
  type PersistedOcrHeatRowsStage } from "../src/pilot-result-read.js";
import type { InspectionRepository } from "../src/repository.js";
import { InspectorStore } from "../src/store.js";

const profile = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1";
const manifestHash = "a".repeat(64);
const configHash = "b".repeat(64);

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
  return JSON.stringify(value);
}

function stage(overrides: Record<string, unknown> = {}): PersistedOcrHeatRowsStage {
  const value = {
    schemaVersion: "candidate-family-ocr-observations-v1", inputManifestHash: manifestHash,
    objectId: "OBJ-1", scope: "RUN_COMMITTED_OCR", purpose: "REVIEW_ONLY",
    ocrArtifactSha256: "c".repeat(64), candidateRulePackSha256: "d".repeat(64),
    numericLabelPackSha256: "e".repeat(64), classLabelPackSha256: "f".repeat(64),
    presenceLabelPackSha256: "1".repeat(64),
    codeRows: Array.from({ length: 47 }, (_, index) => ({
      parameterCode: `PZ-${String(index + 1).padStart(3, "0")}`,
      family: "DIFFERENT", ruleId: `rule-${index}`, status: "ABSTAIN",
      reasonCodes: ["NO_ELIGIBLE_REVIEWED_SOURCE"], eligibleSourceCount: 0,
      ocrProcessedPageCount: 0, ocrDeferredPageCount: 0, leadCount: 0, candidateLeads: [],
    })),
    findingCount: null, parameterCoverage: null, outputCount: 47, ...overrides,
  };
  const ocr = { ...value, contentHash: sha256(workerJson(value)) };
  const content = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
    inputManifestHash: manifestHash, disposition: "RULES_EVALUATED", providerKind: "RULE_ENGINE",
    providerProfileId: profile, providerConfigHash: configHash, outputCount: 7,
    candidateFamilyOcrObservations: ocr, analysis: { hidden: "not exposed" },
    ocrHeatRows: { schemaVersion: "ocr-heat-row-proposals-v1",
      profileId: "conservative-ocr-heat-rows-v1", inputManifestHash: manifestHash,
      proposals: [], abstentions: [], findingCount: 0 },
    factFamily: { schemaVersion: "fact-family-proposals-v1", inputManifestHash: manifestHash,
      objectId: "OBJ-1", facts: [], comparisons: [], outputCount: 0,
      findingCount: 0, contentHash: "6".repeat(64) },
    candidateFamilyPreview: { schemaVersion: "candidate-family-preview-v1",
      inputManifestHash: manifestHash, objectId: "OBJ-1", codeRows: [],
      findingCount: null, parameterCoverage: null, outputCount: 47,
      contentHash: "7".repeat(64) },
    candidateFamilyObservations: { schemaVersion: "candidate-family-observations-v1",
      inputManifestHash: manifestHash, objectId: "OBJ-1", codeRows: [], observations: [],
      findingCount: null, parameterCoverage: null, outputCount: 0,
      contentHash: "8".repeat(64) } };
  const canonical = canonicalJson(content);
  return { content_json: content, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical, "utf8"), schema_version: "analysis-stage-result-v2",
    disposition: "RULES_EVALUATED", provider_profile_id: profile,
    provider_config_hash: configHash, input_manifest_hash: manifestHash, output_count: 7,
    job_state: "SUCCEEDED" };
}

function stageWithLead(): PersistedOcrHeatRowsStage {
  const base = stage();
  const rows = (base.content_json as { candidateFamilyOcrObservations: {
    codeRows: Array<Record<string, unknown>>;
  } }).candidateFamilyOcrObservations.codeRows;
  const lead = { schemaVersion: "candidate-family-ocr-lead-v1", status: "CANDIDATE",
    purpose: "REVIEW_ONLY", parameterCode: "PZ-001", family: "DIFFERENT",
    attribute: "area", canonicalUnit: "m2", matchedLabel: "Площадь", rawValue: "12",
    rawUnit: "м²", featureKey: null, scopeTokens: null, sourceFileId: "FIL-1",
    sourceSha256: "3".repeat(64), ocrArtifactSha256: "c".repeat(64),
    ocrPageSha256: "4".repeat(64), objectId: "OBJ-1", inputManifestHash: manifestHash,
    stage: "PD", sectionCode: "SPZU", revisionStatus: "CURRENT",
    approvalStatus: "APPROVED", pageNumber: 2, coordinateSystem: "IMAGE_TOP_LEFT_PIXELS",
    lineText: "Площадь 12", locator: { kind: "DOCUMENT_OCR_LINE", lineIndex: 0,
      start: 9, end: 11, bboxPx: [10, 20, 100, 40], score: 0.91,
      renderSha256: "5".repeat(64), rendererProfileId: "render-v1",
      providerProfileId: "ocr-v1", providerScript: "cyrillic", dpi: 180,
      widthPx: 1000, heightPx: 1500 } };
  return stage({ codeRows: [{ ...rows[0], leadCount: 1,
    candidateLeads: [{ ...lead, leadSha256: sha256(workerJson(lead)) }] }, ...rows.slice(1)] });
}

describe("committed OCR candidate review read", () => {
  it("projects only saved opt-in review sidecar", () => {
    const saved = stage();
    const read = projectCandidateFamilyOcrObservationsRead(saved, manifestHash, configHash);
    expect(read.codeRows).toHaveLength(47);
    expect(read.codeRows.every((row) => row.status === "ABSTAIN")).toBe(true);
    expect(read.findingCount).toBeNull();
    expect(read.parameterCoverage).toBeNull();
    expect(JSON.stringify(read)).not.toContain("hidden");
  });

  it("keeps existing read projections available under seven-output opt-in profile", () => {
    const saved = stage();
    expect(projectOcrHeatRowsRead(saved, manifestHash, configHash).findingCount).toBe(0);
    expect(projectFactFamilyRead(saved, manifestHash, configHash).facts).toEqual([]);
    expect(projectCandidateFamilyPreviewRead(saved, manifestHash, configHash).findingCount).toBeNull();
    expect(projectCandidateFamilyObservationsRead(saved, manifestHash, configHash)
      .observations).toEqual([]);
  });

  it("rejects profile, stage hash, count, manifest and policy tampering", () => {
    const saved = stage();
    for (const changed of [
      { ...saved, provider_profile_id: "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1" },
      { ...saved, content_hash: "0".repeat(64) },
      { ...saved, output_count: 6 },
      { ...saved, job_state: "FAILED" },
    ]) expect(() => projectCandidateFamilyOcrObservationsRead(changed,
      manifestHash, configHash)).toThrow(/integrity/);
    expect(() => projectCandidateFamilyOcrObservationsRead(saved, "2".repeat(64),
      configHash)).toThrow(/integrity/);
    expect(() => projectCandidateFamilyOcrObservationsRead(stage({ findingCount: 0 }),
      manifestHash, configHash)).toThrow(/integrity/);
    expect(() => projectCandidateFamilyOcrObservationsRead(stage({ codeRows: [] }),
      manifestHash, configHash)).toThrow(/integrity/);
  });

  it("serializes typed OCR leads through authenticated pilot-results read", async () => {
    const actor = { sessionId: "session", userId: "reader", displayName: "Reader",
      organizationId: "organization", roles: ["INSPECTOR"], capabilities: ["READ"],
      csrfHash: "", expiresAt: new Date(Date.now() + 60_000).toISOString() } as AuthenticatedActor;
    const identity: IdentityService = { login: async () => undefined,
      resolveSession: async (token) => token === "valid" ? actor : undefined,
      verifyCsrf: () => false, revokeSession: async () => {}, close: async () => {} };
    const projected = projectCandidateFamilyOcrObservationsRead(stageWithLead(), manifestHash, configHash);
    const memory = await InspectorStore.create();
    const repository = new Proxy(memory, { get(target, property) {
      if (property === "getPilotResults") return async (checkId: string,
        currentActor: AuthenticatedActor) => currentActor.userId === actor.userId
        && checkId === "CHK-1" ? { checkId, status: "READY", items: [], ocrHeatRows: null,
          candidateFamilyOcrObservations: projected } : "FORBIDDEN";
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
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.json().candidateFamilyOcrObservations).toEqual(projected);
      expect(response.json().candidateFamilyOcrObservations.codeRows[0].candidateLeads[0]
        .locator.bboxPx).toEqual([10, 20, 100, 40]);
      expect((await app.inject({ method: "GET", url: "/api/checks/CHK-denied/pilot-results",
        headers: { cookie: "inspector_session=valid" } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
