import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { pilotFactFamilyPackHash, pilotFactFamilyRules,
  pilotPz002Pz017OcrHeatFactFamilyRules } from "../src/pilot-rules.js";
import { verifyFactFamilyProposals } from "../src/fact-family-proposals.js";

describe("pinned fact family release", () => {
  it("keeps the API rule copy identical to the worker's catalog-bound pack", () => {
    const path = fileURLToPath(new URL("../../../services/worker/rules/fact-family-pilot-v1.json", import.meta.url));
    const pack = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(pack.rules).toEqual(pilotFactFamilyRules);
    expect(sha256(canonicalJson(pack))).toBe(pilotFactFamilyPackHash);
    expect(pilotPz002Pz017OcrHeatFactFamilyRules.factFamily).toMatchObject({
      packSha256: pilotFactFamilyPackHash,
      disposition: "REVIEW_AID_ONLY",
      rules: pilotFactFamilyRules,
    });
  });

  it("admits five honest abstentions with no source facts or finding", () => {
    const objectId = "OBJECT-EMPTY";
    const inputManifestHash = "e".repeat(64);
    const comparisons = pilotFactFamilyRules.map((rule) => {
      const comparison = {
        schemaVersion: "fact-comparison-result-v1", ruleId: rule.ruleId,
        ruleVersion: rule.version, objectId, parameterCode: rule.parameterCode,
        attribute: rule.attribute, expectedStage: rule.expectedStage,
        actualStage: rule.actualStage, canonicalUnit: rule.canonicalUnit,
        status: "ABSTAIN", reasonCodes: ["REQUIRED_FACT_MISSING"],
        expectedFactId: null, actualFactId: null, normalizedExpected: null,
        normalizedActual: null, comparison: null,
      };
      return { ...comparison, contentHash: sha256(canonicalJson(comparison)) };
    });
    const payload = { schemaVersion: "fact-family-proposals-v1", inputManifestHash, objectId,
      facts: [], comparisons, outputCount: 5, findingCount: 0 };
    const result = { ...payload, contentHash: sha256(canonicalJson(payload)) };
    const input = { objectId, inputManifestHash, sourceFiles: [], sourceReviews: {},
      textArtifacts: {}, result, rules: [...pilotFactFamilyRules], entityLinks: [] };
    expect(verifyFactFamilyProposals(input)).toBe(true);
    expect(verifyFactFamilyProposals({ ...input, result: { ...result, findingCount: 1 } })).toBe(false);
  });
});
