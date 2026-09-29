import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { buildPilotPz002Pz017ReleaseManifest } from "../src/postgres-repository.js";
import { pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2 } from "../src/pilot-rules.js";

const tableProfile = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v1";

describe("OCR table-row opt-in release", () => {
  it("pins distinct review-only rule profile and immutable config", () => {
    const previous = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V5",
      true, true, true, true, true);
    const enabled = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V5",
      true, true, true, true, true, true);
    const slot = enabled.manifest.providerSlots.find((item) => item.stageJobType === "RULE_EVALUATION");
    expect(previous.manifest.rules.definitions).not.toHaveProperty("ocrTableRows");
    expect(slot).toMatchObject({ profileId: tableProfile, adapterVersion: "7",
      configHash: sha256(canonicalJson(enabled.manifest.rules.definitions)) });
    expect(enabled.manifest.rules.definitions).toEqual(
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules);
    expect((enabled.manifest.rules.definitions as typeof pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules)
      .ocrTableRows).toEqual({
      ruleId: "pilot-ocr-table-rows-review", version: "1",
      extractionProfile: "conservative-ocr-table-rows-v1", disposition: "REVIEW_AID_ONLY",
    });
    expect(enabled.manifest.releaseId).not.toBe(previous.manifest.releaseId);
  });

  it("requires candidate OCR observations and bounded OCR v4/v5", () => {
    expect(() => buildPilotPz002Pz017ReleaseManifest(132, "V4", "V5",
      true, true, true, true, false, true)).toThrow(/require candidate family OCR observations/);
    expect(() => buildPilotPz002Pz017ReleaseManifest(132, "V4", "V3",
      true, true, true, true, true, true)).toThrow(/bounded OCR v4\/v5/);
    expect(buildPilotPz002Pz017ReleaseManifest(132, "V4", "V4",
      true, true, true, true, true, true).manifest.providerSlots.find((slot) =>
        slot.stageJobType === "RULE_EVALUATION")?.profileId).toBe(tableProfile);
  });

  it("pins v2 separately while keeping v1 release identity stable", () => {
    const v1 = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V5",
      true, true, true, true, true, true);
    const v2 = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V5",
      true, true, true, true, true, "v2");
    const slot = v2.manifest.providerSlots.find((item) => item.stageJobType === "RULE_EVALUATION");
    expect(slot).toMatchObject({ profileId: `${tableProfile.slice(0, -2)}v2`,
      adapterVersion: "8", configHash: sha256(canonicalJson(v2.manifest.rules.definitions)) });
    expect(v2.manifest.rules.definitions).toEqual(
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2);
    expect(v2.manifest.releaseId).not.toBe(v1.manifest.releaseId);
    expect(v1.manifest.rules.definitions).toEqual(
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules);
    expect(() => buildPilotPz002Pz017ReleaseManifest(132, "V4", "V3",
      true, true, true, true, true, "v2")).toThrow(/bounded OCR v4\/v5/);
  });
});
