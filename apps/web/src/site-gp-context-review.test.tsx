import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SiteGpContextReviewRead } from "./api";
import { SiteGpContextReview } from "./SiteGpContextReview";

const hash = (character: string) => character.repeat(64);
const lead = { sourceFileId: "F0163", sourceSha256: hash("a"),
  textArtifactSha256: hash("b"), pageNumber: 7, blockIndex: 3,
  lineIndex: 1, lineText: "План организации рельефа", blockTextSha256: hash("c"),
  bboxMilliPoints: [1000, 2000, 3000, 4000] as [number, number, number, number],
  sourceRole: "PD_GP_CONTEXT" as const, leadSha256: hash("d") };
const codes = ["SPZU-029", "SPZU-032", "SPZU-033", "SPZU-035", "SPZU-036"] as const;
const reasons = ["MAF_ITEM_IDENTITY_UNVERIFIED", "ROAD_LAYER_COMPOSITION_UNVERIFIED",
  "SLOPE_GEOMETRY_UNVERIFIED", "ZONE_INTERSECTION_UNVERIFIED",
  "FENCE_TYPE_HEIGHT_UNVERIFIED"];
const data: SiteGpContextReviewRead = {
  schemaVersion: "site-gp-context-run-review-v1",
  profileId: "site-gp-context-text-review-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("e"),
  sourceStageArtifacts: [{ sourceFileId: "F0163", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }],
  codeRows: codes.map((parameterCode, index) => ({ parameterCode,
    status: "ABSTAIN" as const,
    reasonCodes: ["LEAD_NOT_VERIFIED_FACT", reasons[index],
      ...(index === 2 ? ["OCR_REQUIRED_IN_SCOPE"] : ["NO_EXACT_LINE_LEAD"])],
    eligibleSourceCount: 1, textCandidatePageCount: 4, ocrRequiredPageCount: 2,
    leadCount: index === 2 ? 1 : 0, leads: index === 2 ? [lead] : [],
  })),
  findingCount: null, parameterCoverage: null, contentHash: hash("f"),
};

describe("site GP context review", () => {
  it("shows five abstentions, semantic gates and PDF line provenance", () => {
    const html = renderToStaticMarkup(createElement(SiteGpContextReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все пять кодов имеют статус ABSTAIN");
    for (const code of codes) expect(html).toContain(code);
    expect(html).toContain("Конкретный элемент МАФ не идентифицирован");
    expect(html).toContain("Геометрия уклонов не проверена");
    expect(html).toContain("Пересечение с охранной зоной не проверено");
    expect(html).toContain("Часть страниц требует отдельного OCR");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("текстовый блок 4");
    expect(html).toContain("строка 2");
    expect(html).toContain("PDF SHA-256");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("нет фактов, сравнения ПД/РД, замечаний или оценки охвата");
  });

  it("hides PDF link when source or text artifact does not match package", () => {
    const altered: SiteGpContextReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("0") }] };
    const html = renderToStaticMarkup(createElement(SiteGpContextReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Сохранённый источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
