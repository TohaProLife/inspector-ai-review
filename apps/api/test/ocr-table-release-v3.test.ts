import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { buildPilotPz002Pz017ReleaseManifest } from "../src/postgres-repository.js";
import {
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3,
} from "../src/pilot-rules.js";

const release = (tableProfile: boolean | "v2" | "v3", typedFacts = false) =>
  buildPilotPz002Pz017ReleaseManifest(132, "V4", "V5",
    true, true, true, true, true, tableProfile, typedFacts);

describe("OCR table-row v3 opt-in release", () => {
  it("pins distinct review-only v3 rules and leaves v1/v2 selections intact", () => {
    const v1 = release(true);
    const v2 = release("v2");
    const v3 = release("v3");
    const slot = v3.manifest.providerSlots.find((item) => item.stageJobType === "RULE_EVALUATION");
    expect(v1.manifest.rules.definitions).toEqual(
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules);
    expect(v2.manifest.rules.definitions).toEqual(
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2);
    expect(v3.manifest.rules.definitions).toEqual(
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3);
    expect((v3.manifest.rules.definitions as
      typeof pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3).ocrTableRows).toEqual({
      ruleId: "pilot-ocr-table-rows-review", version: "3",
      extractionProfile: "conservative-ocr-table-rows-v3",
      disposition: "REVIEW_AID_ONLY",
    });
    expect(slot).toMatchObject({
      profileId: "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3",
      adapterVersion: "9", configHash: sha256(canonicalJson(v3.manifest.rules.definitions)),
    });
    expect(new Set([v1.manifest.releaseId, v2.manifest.releaseId, v3.manifest.releaseId]).size).toBe(3);
  });

  it("keeps durable typed-fact opt-in independent of OCR table version", () => {
    const v3 = release("v3", true);
    expect(v3.manifest.reviewArtifacts).toEqual({
      ocrTypedFactCandidates: "ocr-typed-fact-candidates-v1",
    });
    expect(v3.manifest.releaseId).not.toBe(release("v3").manifest.releaseId);
    expect(() => buildPilotPz002Pz017ReleaseManifest(132, "V4", "V3",
      true, true, true, true, true, "v3")).toThrow(/bounded OCR v4\/v5/);
  });
});
