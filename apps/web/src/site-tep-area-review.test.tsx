import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SiteTepAreaReviewRead } from "./api";
import { SiteTepAreaReview } from "./SiteTepAreaReview";

const hash = (character: string) => character.repeat(64);
const lead = { sourceFileId: "F0163", sourceSha256: hash("a"),
  textArtifactSha256: hash("b"), pageNumber: 7, blockIndex: 3,
  lineIndex: 1, lineText: "Площадь застройки", blockTextSha256: hash("c"),
  bboxMilliPoints: [1000, 2000, 3000, 4000] as [number, number, number, number],
  sourceRole: "PD_GP_TEP" as const, leadSha256: hash("d") };
const data: SiteTepAreaReviewRead = {
  schemaVersion: "site-tep-area-run-review-v1",
  profileId: "site-tep-area-text-review-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("e"),
  sourceStageArtifacts: [{ sourceFileId: "F0163", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }],
  codeRows: [
    { parameterCode: "PZ-001", status: "ABSTAIN",
      reasonCodes: ["LEAD_NOT_VERIFIED_FACT", "OCR_REQUIRED_IN_SCOPE"],
      eligibleSourceCount: 1, textCandidatePageCount: 4, ocrRequiredPageCount: 2,
      leadCount: 1, leads: [lead] },
    { parameterCode: "SPZU-026", status: "ABSTAIN",
      reasonCodes: ["LEAD_NOT_VERIFIED_FACT", "PAVING_MATERIAL_UNRESOLVED",
        "NO_EXACT_LINE_LEAD"],
      eligibleSourceCount: 1, textCandidatePageCount: 4, ocrRequiredPageCount: 2,
      leadCount: 0, leads: [] },
    { parameterCode: "SPZU-027", status: "ABSTAIN",
      reasonCodes: ["LEAD_NOT_VERIFIED_FACT", "SOURCE_REVIEW_REQUIRED",
        "NO_EXACT_LINE_LEAD"],
      eligibleSourceCount: 0, textCandidatePageCount: 0, ocrRequiredPageCount: 0,
      leadCount: 0, leads: [] },
  ], findingCount: null, parameterCoverage: null, contentHash: hash("f"),
};

describe("site TEP area review", () => {
  it("shows three ABSTAIN rows and source address without turning labels into facts", () => {
    const html = renderToStaticMarkup(createElement(SiteTepAreaReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все три кода имеют статус ABSTAIN");
    expect(html).toContain("PZ-001");
    expect(html).toContain("SPZU-026");
    expect(html).toContain("SPZU-027");
    expect(html).toContain("По общей подписи покрытий нельзя определить материал");
    expect(html).toContain("Часть страниц требует отдельного OCR");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("текстовый блок 4");
    expect(html).toContain("строка 2");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("нет фактов, замечаний или оценки охвата");
    expect(html).not.toContain("Подтвердить нарушение");
  });

  it("hides PDF link when source or text artifact does not match package", () => {
    const altered: SiteTepAreaReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("0") }] };
    const html = renderToStaticMarkup(createElement(SiteTepAreaReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Сохранённый источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
