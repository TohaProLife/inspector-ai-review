import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnresolvedFamilyOcrReviewRead } from "./api";
import { UnresolvedFamilyOcrReview } from "./UnresolvedFamilyOcrReview";

const hash = (character: string) => character.repeat(64);
const lead = { sourceFileId: "F0163", sourceSha256: hash("a"),
  textArtifactSha256: hash("b"), ocrStageSha256: hash("c"),
  ocrPageSha256: hash("d"), pageNumber: 7, stage: "RD" as const,
  sectionCode: "VK" as const, coordinateSystem: "IMAGE_TOP_LEFT_PIXELS" as const,
  lineIndex: 3, lineText: "Материал трубы ПВХ водоснабжение", score: 0.9,
  bboxPx: [10, 20, 300, 40] as [number, number, number, number],
  renderSha256: hash("e"), rendererProfileId: "pdfium-v1",
  providerProfileId: "paddle-v1", providerScript: "cyrillic", dpi: 200,
  widthPx: 1000, heightPx: 1400, leadSha256: hash("f") };
const data: UnresolvedFamilyOcrReviewRead = {
  schemaVersion: "unresolved-family-ocr-review-v1",
  profileId: "unresolved-family-ocr-review-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("0"), ocrStageSha256: hash("c"),
  sourceStageArtifacts: [{ sourceFileId: "F0163", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }],
  codeRows: [
    { parameterCode: "AR-042", status: "ABSTAIN", reasonCodes: [
      "NO_EXACT_LINE_LEAD", "SOURCE_REVIEW_NOT_CURRENT_APPROVED"], leads: [] },
    { parameterCode: "IOS2-072", status: "ABSTAIN", reasonCodes: [
      "LEAD_NOT_VERIFIED_FACT", "OCR_TEXT_REQUIRES_VISUAL_REVIEW"], leads: [lead] },
    { parameterCode: "IOS3-075", status: "ABSTAIN", reasonCodes: [
      "NO_EXACT_LINE_LEAD", "OCR_PAGES_DEFERRED"], leads: [] },
  ], findingCount: null, parameterCoverage: null, contentHash: hash("1"),
};

describe("unresolved family OCR review", () => {
  it("shows three abstentions, deferred reasons and line provenance with original PDF link", () => {
    const html = renderToStaticMarkup(createElement(UnresolvedFamilyOcrReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все три кода имеют статус ABSTAIN");
    expect(html).toContain("AR-042");
    expect(html).toContain("IOS2-072");
    expect(html).toContain("IOS3-075");
    expect(html).toContain("Нет подтверждения актуальной утверждённой редакции источника");
    expect(html).toContain("Часть страниц с OCR_REQUIRED отложена");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("OCR-строка 4");
    expect(html).toContain("оценка OCR 0.900");
    expect(html).toContain("OCR-страница SHA-256");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("Охват параметров здесь не определяется");
    expect(html).not.toContain("Подтвердить нарушение");
  });

  it("does not link unmatched source or OCR stage", () => {
    const altered = { ...data, sourceStageArtifacts: [{ ...data.sourceStageArtifacts[0],
      textArtifactSha256: hash("9") }] };
    const html = renderToStaticMarkup(createElement(UnresolvedFamilyOcrReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник или OCR stage не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
