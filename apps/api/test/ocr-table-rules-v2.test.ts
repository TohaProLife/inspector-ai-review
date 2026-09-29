import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import {
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2,
} from "../src/pilot-rules.js";

describe("pinned OCR table row rule definitions", () => {
  it("keeps v1 unchanged and pins a separate review-only v2 policy", () => {
    expect(pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules.ocrTableRows).toEqual({
      ruleId: "pilot-ocr-table-rows-review",
      version: "1",
      extractionProfile: "conservative-ocr-table-rows-v1",
      disposition: "REVIEW_AID_ONLY",
    });
    expect(pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2.ocrTableRows).toEqual({
      ruleId: "pilot-ocr-table-rows-review",
      version: "2",
      extractionProfile: "conservative-ocr-table-rows-v2",
      disposition: "REVIEW_AID_ONLY",
    });
    const { ocrTableRows: previousPolicy, ...previousRules } =
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules;
    const { ocrTableRows: nextPolicy, ...nextRules } =
      pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2;
    expect(previousRules).toEqual(nextRules);
    expect(previousPolicy).not.toEqual(nextPolicy);
    expect(sha256(canonicalJson(pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2)))
      .not.toBe(sha256(canonicalJson(pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules)));
  });
});
