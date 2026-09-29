import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { buildPilotPz002Pz017ReleaseManifest } from "../src/postgres-repository.js";
import { boundedOcrConfigHashV5, boundedOcrProfileIdV5 } from "../src/ocr-layout.js";
import { candidateFamilyOcrObservationsPolicy, candidateFamilyPreviewPolicy } from "../src/pilot-rules.js";

const profileId = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1";

describe("candidate-family OCR observations release", () => {
  it("pins review-only policy to same candidate and label packs as preview", () => {
    expect(candidateFamilyOcrObservationsPolicy).toMatchObject({
      ruleId: "pilot-candidate-family-ocr-observations", version: "1",
      extractionProfile: "candidate-family-ocr-observations-v1",
      codeCount: 47, disposition: "REVIEW_AID_ONLY",
    });
    for (const key of ["candidateRulePackSha256", "numericLabelPackSha256",
      "classLabelPackSha256", "presenceLabelPackSha256"] as const) {
      expect(candidateFamilyOcrObservationsPolicy[key]).toBe(candidateFamilyPreviewPolicy[key]);
    }
  });

  it("creates separate immutable opt-in release and leaves text-only release unchanged", () => {
    const previous = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V4",
      true, true, true, true);
    const enabled = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V4",
      true, true, true, true, true);
    const oldRulesSlot = previous.manifest.providerSlots.find((slot) => slot.stageJobType === "RULE_EVALUATION");
    const newRulesSlot = enabled.manifest.providerSlots.find((slot) => slot.stageJobType === "RULE_EVALUATION");
    expect(oldRulesSlot?.profileId).toBe("typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1");
    expect(oldRulesSlot?.adapterVersion).toBe("5");
    expect(previous.manifest.rules.definitions).not.toHaveProperty("candidateFamilyOcrObservations");
    expect(newRulesSlot?.profileId).toBe(profileId);
    expect(newRulesSlot?.adapterVersion).toBe("6");
    expect(enabled.manifest.rules.definitions).toMatchObject({
      candidateFamilyOcrObservations: candidateFamilyOcrObservationsPolicy,
    });
    expect(newRulesSlot?.configHash).toBe(sha256(canonicalJson(enabled.manifest.rules.definitions)));
    expect(enabled.manifest.releaseId).not.toBe(previous.manifest.releaseId);
    expect(enabled.contentHash).toBe(sha256(enabled.canonical));
  });

  it("requires text observations, fact family and supported OCR profile", () => {
    expect(() => buildPilotPz002Pz017ReleaseManifest(132, "V4", "V4",
      true, true, true, false, true)).toThrow(/require candidate observations/);
    expect(() => buildPilotPz002Pz017ReleaseManifest(132, "V4", "V2",
      true, true, true, true, true)).toThrow(/OCR v3, v4 or v5/);
    expect(() => buildPilotPz002Pz017ReleaseManifest(132, "V4", "V4",
      true, false, true, true, true)).toThrow(/fact family review/);
  });

  it("pins v5 OCR slot to a distinct opt-in release without changing rules", () => {
    const v4 = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V4",
      true, true, true, true, true);
    const v5 = buildPilotPz002Pz017ReleaseManifest(132, "V4", "V5",
      true, true, true, true, true);
    const slot = v5.manifest.providerSlots.find((item) => item.stageJobType === "DOCUMENT_OCR_LAYOUT");
    expect(slot).toMatchObject({ profileId: boundedOcrProfileIdV5,
      adapterVersion: "5", configHash: boundedOcrConfigHashV5 });
    expect(v5.manifest.rules.definitions).toEqual(v4.manifest.rules.definitions);
    expect(v5.manifest.releaseId).not.toBe(v4.manifest.releaseId);
  });
});
