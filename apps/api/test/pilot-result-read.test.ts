import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import type { AuthenticatedActor, IdentityService } from "../src/identity.js";
import { projectOcrHeatRowsRead, projectPilotRuleResult, type PersistedOcrHeatRowsStage,
  type PersistedPilotResultRow } from "../src/pilot-result-read.js";
import { PostgresInspectionRepository } from "../src/postgres-repository.js";
import type { InspectionRepository } from "../src/repository.js";
import { InspectorStore } from "../src/store.js";

const base: PersistedPilotResultRow = {
  api_id: "RSLT-1", parameter_code: "PZ-017", rule_key: "pilot-pz-017-heat",
  rule_version: "1", execution_status: "SUCCEEDED", machine_status: "CLARIFICATION_REQUIRED",
  result_payload: {
    pdFacts: [{ stage: "PD", component: "HEATING", sourceFileId: "FIL-PD",
      inputSha256: "a".repeat(64), pageNumber: 23, rawValue: "0,331", rawUnit: "Гкал/ч",
      normalizedValue: "0.331", canonicalUnit: "Gcal/h", evidence: [{ text: "secret" }] }],
    rdFacts: [],
    comparison: { disposition: "ABSTAIN", reasonCode: "COMPONENT_BASIS_MISMATCH",
      finding: { secret: true } },
    evaluation: { machineStatus: "CLARIFICATION_REQUIRED",
      reasonCode: "COMPONENT_BASIS_MISMATCH", secret: "not exposed" },
    selectedManifestHash: "hidden",
  },
};

describe("pilot result read projection", () => {
  it("keeps only verified locator/value and abstention fields", () => {
    expect(projectPilotRuleResult(base)).toEqual({
      resultId: "RSLT-1", parameterCode: "PZ-017", ruleKey: "pilot-pz-017-heat",
      ruleVersion: "1", executionStatus: "SUCCEEDED", machineStatus: "CLARIFICATION_REQUIRED",
      reasonCode: "COMPONENT_BASIS_MISMATCH",
      comparison: { disposition: "ABSTAIN", reasonCode: "COMPONENT_BASIS_MISMATCH" },
      facts: [{ stage: "PD", component: "HEATING", sourceFileId: "FIL-PD",
        sourceSha256: "a".repeat(64), pageNumber: 23, rawValue: "0,331", rawUnit: "Гкал/ч",
        value: "0.331", unit: "Gcal/h" }],
    });
  });

  it("maps persisted PZ-002 candidate values to source pages without inventing raw values", () => {
    const result = projectPilotRuleResult({ ...base, parameter_code: "PZ-002",
      rule_key: "pilot-pz-002-area", machine_status: "CANDIDATE",
      result_payload: { expectedValue: "100 м²", actualValue: "102 м²", secret: "not exposed",
        evidence: [
          { stage: "PD", fileId: "FIL-PD", sha256: "a".repeat(64), pdfPageNumber: 2 },
          { stage: "RD", fileId: "FIL-RD", sha256: "b".repeat(64), pdfPageNumber: 3 },
        ] } });
    expect(result.reasonCode).toBeNull();
    expect(result.facts.map(({ stage, value, rawValue, pageNumber }) =>
      ({ stage, value, rawValue, pageNumber }))).toEqual([
      { stage: "PD", value: "100", rawValue: null, pageNumber: 2 },
      { stage: "RD", value: "102", rawValue: null, pageNumber: 3 },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects malformed persisted heat locators", () => {
    expect(() => projectPilotRuleResult({ ...base,
      result_payload: { ...base.result_payload, pdFacts: [{ sourceFileId: "FIL-PD", pageNumber: 0 }] },
    })).toThrow(/Invalid persisted pilot/);
  });
});

const manifestHash = "a".repeat(64);
const configHash = "b".repeat(64);
const evidence = { role: "value", lineIndex: 4, text: "1 кВт (0.00086 Гкал/ч)",
  bboxPx: [10, 20, 100, 40], score: 0.91 };
const proposal = { sourceFileId: "FIL-1", inputSha256: "c".repeat(64), pageNumber: 2,
  stage: "RD", component: "HEATING", basis: "DESIGN_HEAT_RATE",
  values: { kW: "1", "Gcal/h": "0.00086" }, ocrPageContentHash: "d".repeat(64),
  renderSha256: "e".repeat(64), evidence: [evidence] };
const abstention = { sourceFileId: "FIL-1", inputSha256: "c".repeat(64), pageNumber: 2,
  lineIndex: 4, reasonCode: "OCR_SCORE_TOO_LOW", evidence: [evidence] };

function heatStage(rows: { proposals: unknown[]; abstentions: unknown[]; findingCount?: number }) {
  const content = { schemaVersion: "analysis-stage-result-v2", jobType: "RULE_EVALUATION",
    inputManifestHash: manifestHash, disposition: "RULES_EVALUATED", providerKind: "RULE_ENGINE",
    providerProfileId: "typed-pz002-pz017-ocr-heat-v1", providerConfigHash: configHash,
    outputCount: 3, analysis: { hidden: "not exposed" },
    ocrHeatRows: { schemaVersion: "ocr-heat-row-proposals-v1",
      profileId: "conservative-ocr-heat-rows-v1", inputManifestHash: manifestHash,
      proposals: rows.proposals, abstentions: rows.abstentions,
      findingCount: rows.findingCount ?? 0 } };
  const canonical = canonicalJson(content);
  return { content_json: content, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical, "utf8"), schema_version: "analysis-stage-result-v2",
    disposition: "RULES_EVALUATED", provider_profile_id: "typed-pz002-pz017-ocr-heat-v1",
    provider_config_hash: configHash, input_manifest_hash: manifestHash, output_count: 3,
    job_state: "SUCCEEDED" } satisfies PersistedOcrHeatRowsStage;
}

describe("committed OCR heat review read", () => {
  it("serializes evidence through authenticated pilot-results route", async () => {
    const actor = { sessionId: "session", userId: "reader", displayName: "Reader",
      organizationId: "organization", roles: ["INSPECTOR"], capabilities: ["READ"],
      csrfHash: "", expiresAt: new Date(Date.now() + 60_000).toISOString() } as AuthenticatedActor;
    const identity: IdentityService = { login: async () => undefined,
      resolveSession: async (token) => token === "valid" ? actor : undefined,
      verifyCsrf: () => false, revokeSession: async () => {}, close: async () => {} };
    const projected = projectOcrHeatRowsRead(heatStage({ proposals: [proposal],
      abstentions: [abstention] }), manifestHash, configHash);
    const memory = await InspectorStore.create();
    const repository = new Proxy(memory, { get(target, property) {
      if (property === "getPilotResults") return async (checkId: string,
        currentActor: AuthenticatedActor) => currentActor.userId === actor.userId
        && checkId === "CHK-1" ? { checkId, status: "READY", items: [], ocrHeatRows: projected }
          : "FORBIDDEN";
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    } }) as InspectionRepository;
    const app = await buildApp({ repository, identityService: identity });
    try {
      const url = "/api/checks/CHK-1/pilot-results";
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      const read = await app.inject({ method: "GET", url,
        headers: { cookie: "inspector_session=valid" } });
      expect(read.statusCode).toBe(200);
      expect(read.headers["cache-control"]).toBe("private, no-store");
      expect(read.json().ocrHeatRows).toEqual(projected);
      expect(read.json().items).toEqual([]);
      expect((await app.inject({ method: "GET", url: "/api/checks/CHK-denied/pilot-results",
        headers: { cookie: "inspector_session=valid" } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("returns bounded proposals and abstentions with source-line evidence", () => {
    const stage = heatStage({ proposals: [proposal], abstentions: [abstention] });
    const read = projectOcrHeatRowsRead(stage, manifestHash, configHash);
    expect(read).toEqual({ profileId: "conservative-ocr-heat-rows-v1",
      inputManifestHash: manifestHash, proposals: [proposal], abstentions: [abstention],
      findingCount: 0, proposalCount: 1, abstentionCount: 1, truncated: false });
    expect(JSON.stringify(read)).not.toContain("not exposed");
  });

  it("caps response while retaining full persisted counts", () => {
    const stage = heatStage({ proposals: [], abstentions: Array.from({ length: 65 }, () => abstention) });
    const read = projectOcrHeatRowsRead(stage, manifestHash, configHash);
    expect(read.abstentions).toHaveLength(64);
    expect(read.abstentionCount).toBe(65);
    expect(read.truncated).toBe(true);
  });

  it("rejects corrupt hashes, non-review findings, and malformed excluded rows", () => {
    const stage = heatStage({ proposals: [proposal], abstentions: [] });
    expect(() => projectOcrHeatRowsRead({ ...stage, content_hash: "0".repeat(64) },
      manifestHash, configHash)).toThrow(/integrity/);
    expect(() => projectOcrHeatRowsRead(heatStage({ proposals: [proposal],
      abstentions: [], findingCount: 1 }), manifestHash, configHash)).toThrow(/integrity/);
    const malformed = heatStage({ proposals: [], abstentions: [
      ...Array.from({ length: 64 }, () => abstention), { ...abstention, lineIndex: -1 },
    ] });
    expect(() => projectOcrHeatRowsRead(malformed, manifestHash, configHash)).toThrow(/invalid/i);
  });
});

describe("pilot results memory fallback", () => {
  it("reports a failed check as FAILED instead of READY", async () => {
    const actor = { sessionId: "session", userId: "reader", displayName: "Reader",
      organizationId: "organization", roles: ["INSPECTOR"], capabilities: ["READ"],
      csrfHash: "", expiresAt: new Date(Date.now() + 60_000).toISOString() } as AuthenticatedActor;
    const identity: IdentityService = { login: async () => undefined,
      resolveSession: async (token) => token === "valid" ? actor : undefined,
      verifyCsrf: () => false, revokeSession: async () => {}, close: async () => {} };
    const memory = await InspectorStore.create();
    const object = memory.createObject({ name: "Failed pilot", address: "Москва" });
    const check = memory.startCheck(object.id);
    expect(check).toBeDefined();
    check!.status = "FAILED";
    const app = await buildApp({ repository: memory, identityService: identity });
    try {
      const read = await app.inject({ method: "GET", url: `/api/checks/${check!.id}/pilot-results`,
        headers: { cookie: "inspector_session=valid" } });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toEqual({ checkId: check!.id, status: "FAILED", items: [], ocrHeatRows: null });
    } finally { await app.close(); }
  });
});

describe("legacy pilot result read", () => {
  it("accepts migration 012 PostgreSQL JSONB-text hash and returns null OCR review aid", async () => {
    const releaseText = '{"schemaVersion": "analysis-release-legacy-v1", "releaseId": "legacy", "lifecycle": "LEGACY", "externalNetworkAllowed": false}';
    const releaseContent = JSON.parse(releaseText) as Record<string, unknown>;
    expect(sha256(canonicalJson(releaseContent))).not.toBe(sha256(releaseText));
    const row = { run_state: "SUCCEEDED", can_read: true,
      release_content: releaseContent, release_schema_version: "analysis-release-legacy-v1",
      release_text: releaseText, release_content_hash: sha256(releaseText),
      release_byte_size: Buffer.byteLength(releaseText, "utf8"), manifest_hash: null,
      heat_stage: null, heat_stage_count: null,
      api_id: null, parameter_code: null, rule_key: null, rule_version: null,
      execution_status: null, machine_status: null, result_payload: null };
    const repository = Object.assign(Object.create(PostgresInspectionRepository.prototype), {
      organizationId: "organization", readQuery: async () => ({ rows: [row] }),
    }) as PostgresInspectionRepository;
    const actor = { organizationId: "organization", userId: "reader" } as AuthenticatedActor;
    expect(await repository.getPilotResults("CHK-legacy", actor)).toEqual({
      checkId: "CHK-legacy", status: "READY", items: [], ocrHeatRows: null,
    });
    row.release_content_hash = "0".repeat(64);
    await expect(repository.getPilotResults("CHK-legacy", actor)).rejects.toThrow(/integrity/);
  });
});
