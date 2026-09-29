import { describe, expect, it } from "vitest";
import { sourceReviewSchema, sourceSectionCodes } from "@inspector-ai/contracts";
import { candidateFamilyPreviewSections } from "../src/candidate-family-preview.js";

const review = {
  sourceSha256: "a".repeat(64), revisionStatus: "CURRENT", approvalStatus: "APPROVED",
  linkGroupId: "building-1", pageStages: {}, basis: { reference: "Проверенный титульный лист" },
};

describe("reviewed source section", () => {
  it("accepts old input, explicit unknown, and each catalog section", () => {
    expect(sourceReviewSchema.parse(review)).not.toHaveProperty("sectionCode");
    expect(sourceReviewSchema.parse({ ...review, sectionCode: null }).sectionCode).toBeNull();
    for (const sectionCode of sourceSectionCodes) {
      expect(sourceReviewSchema.parse({ ...review, sectionCode }).sectionCode).toBe(sectionCode);
    }
  });

  it("rejects unreviewed or malformed section guesses", () => {
    for (const sectionCode of ["GUESSED", "ar", " AR ", "", 7]) {
      expect(sourceReviewSchema.safeParse({ ...review, sectionCode }).success).toBe(false);
    }
  });

  it("can represent every section in the pinned 47-code candidate policy", () => {
    const allowed = new Set<string>(sourceSectionCodes);
    const required = Object.values(candidateFamilyPreviewSections)
      .flatMap(({ PD, RD }) => [...PD, ...RD]);
    expect(required.length).toBeGreaterThan(47);
    expect([...new Set(required.filter((code) => !allowed.has(code)))]).toEqual([]);
  });
});
