import { describe, it, expect } from "vitest";
import { compareInspectorEvidence, type InspectorReviewDetails } from "@inspector-ai/contracts";
import { validateInspectorReview } from "../src/inspector-review.js";
const details = (): InspectorReviewDetails => ({ entity: "Помещение 101, радиатор Р1", sameElementConfirmed: true,
  comparisonPair: "PD_RD", sources: ["PD", "RD"].map((stage, index) => ({ id: stage, sourceFileId: stage,
    sourceSha256: "a".repeat(64), stage: stage as "PD" | "RD", pageNumber: 1, sheet: "1", revision: "1",
    bbox: [0.1, 0.1, 0.2, 0.2], value: index ? "102" : "100", unit: "кВт", element: "Помещение 101, радиатор Р1" })),
  rule: { kind: "PERCENT", tolerance: 1, basis: "Пункт задания 4.2", condition: "Превышение допуска 1%" }, clarification: "", parts: [] });
describe("inspector evidence decisions", () => {
  it("keeps missing source, missing value, noncomparable, missing rule and equal values distinct", () => {
    const d = details();
    expect(compareInspectorEvidence(d.sources, d.rule)).toEqual({ status: "DIFFERENCE", delta: 2 });
    expect(compareInspectorEvidence(d.sources.slice(0, 1), d.rule).status).toBe("MISSING_DOCUMENT");
    d.sources[1].value = ""; expect(compareInspectorEvidence(d.sources, d.rule).status).toBe("MISSING_VALUE");
    d.sources[1].value = "100"; expect(compareInspectorEvidence(d.sources, d.rule).status).toBe("NO_DIFFERENCE");
    expect(compareInspectorEvidence(d.sources, null).status).toBe("RULE_REQUIRED");
    d.sources[1].unit = "Вт"; expect(compareInspectorEvidence(d.sources, d.rule).status).toBe("NOT_COMPARABLE");
  });
  it("requires declared pair, element, original boxes, rule and concurrency for confirmation", () => {
    expect(validateInspectorReview({ decision: "CONFIRM", details: details(), expectedDecisionHash: null })).toBeNull();
    for (const change of [(d: InspectorReviewDetails) => d.sameElementConfirmed = false,
      (d: InspectorReviewDetails) => d.comparisonPair = "PD_RD_ID",
      (d: InspectorReviewDetails) => d.sources[0].bbox = null,
      (d: InspectorReviewDetails) => d.sources[0].element = "Другой элемент",
      (d: InspectorReviewDetails) => d.rule = null]) {
      const d = details(); change(d); expect(validateInspectorReview({ decision: "CONFIRM", details: d, expectedDecisionHash: null })).toBeTruthy();
    }
    expect(validateInspectorReview({ decision: "CONFIRM", details: details() })).toBeTruthy();
  });
  it("compares only the explicitly selected pair while retaining the third source", () => {
    const d = details(); d.sources.push({...d.sources[1], id: "ID", stage: "ID", value: "", bbox: null});
    expect(validateInspectorReview({ decision: "CONFIRM", details: d, expectedDecisionHash: null })).toBeNull();
    d.comparisonPair = "PD_RD_ID";
    expect(validateInspectorReview({ decision: "CONFIRM", details: d, expectedDecisionHash: null })).toBeTruthy();
  });
  it("validates composite parts separately and rejects a false partial confirmation", () => {
    const d = details(); d.parts = [{ id: "a", description: "Замена Р1", decision: "CONFIRM", note: "Проверено по двум листам", evidenceIds: ["PD", "RD"] },
      { id: "b", description: "Размещение Р1", decision: "CLARIFY", note: "Требуется исполнительная схема", evidenceIds: ["PD"] }];
    expect(validateInspectorReview({ decision: "PARTIAL_CONFIRM", details: d, expectedDecisionHash: null })).toBeNull();
    d.parts[0].evidenceIds = ["PD"]; expect(validateInspectorReview({ decision: "PARTIAL_CONFIRM", details: d, expectedDecisionHash: null })).toBeTruthy();
  });
  it("does not treat division by zero or arbitrary text as a numeric delta", () => {
    const d = details(); d.sources[0].value = "0"; expect(compareInspectorEvidence(d.sources, d.rule).status).toBe("NOT_COMPARABLE");
    d.sources[0].value = "около 100"; expect(compareInspectorEvidence(d.sources, d.rule).status).toBe("NOT_COMPARABLE");
  });
});
