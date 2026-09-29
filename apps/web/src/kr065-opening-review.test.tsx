import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Kr065OpeningReviewRead } from "./api";
import { Kr065OpeningReview } from "./Kr065OpeningReview";

const sha = (character: string) => character.repeat(64);
const anchor = { blockIndex: 3, lineIndex: 1,
  lineText: "Отверстие № 2 1200х800 мм", lineTextSha256: sha("a"),
  blockTextSha256: sha("b"), bboxMilliPoints: [10, 20, 300, 400] as [number, number, number, number] };
const provenance = { sourceFileId: "F0141", sourceSha256: sha("c"),
  textArtifactSha256: sha("d"), pageSha256: sha("e"), pageNumber: 23,
  sourceStage: "RD" as const, sourceSection: "KR" as const };
const data: Kr065OpeningReviewRead = {
  schemaVersion: "kr065-opening-proposals-v1", profileId: "kr065-opening-review-v1",
  purpose: "REVIEW_ONLY", objectId: "OBJ-1", inputManifestHash: sha("1"),
  sourceStageArtifacts: [{ sourceFileId: "F0141", sourceSha256: sha("c"),
    textArtifactSha256: sha("d") }],
  codeRows: [{ parameterCode: "KR-065", status: "ABSTAIN",
    reasonCodes: ["CONTOUR_ASSOCIATION_UNVERIFIED", "OCR_REQUIRED_DEFERRED",
      "DUPLICATE_ANCHOR_DEFERRED", "PROPOSAL_LIMIT_REACHED"],
    eligibleSourceCount: 1, textCandidatePageCount: 1, ocrRequiredPageCount: 2,
    oversizeAnchorLineCount: 1, duplicateAnchorCount: 1, proposalCount: 2,
    truncatedProposalCount: 1, abstentionCount: 1, truncatedAbstentionCount: 0,
    absenceConclusion: "NOT_AVAILABLE",
    proposals: [{ ...provenance, proposalKind: "OPENING_LABEL_DIMENSION_NAVIGATION",
      rawOpeningNumber: "2", rawDimensionsText: "1200х800 мм", rawAxes: null,
      rawLevel: null, drawingContourAssociation: "UNVERIFIED",
      detailAssociation: "UNVERIFIED", sameElementAssociation: "UNVERIFIED",
      reinforcementStatus: "NOT_ESTABLISHED", unauthorizedFillStatus: "NOT_ESTABLISHED",
      anchor, scopedSha256: sha("f") }],
    abstentions: [{ ...provenance, reasonCode: "DUPLICATE_OPENING_LABEL",
      anchor, scopedSha256: sha("0") }],
  }], findingCount: null, parameterCoverage: null, contentHash: sha("2"),
};

describe("KR-065 opening review", () => {
  it("renders only unverified text navigation with deferred and SHA provenance", () => {
    const html = renderToStaticMarkup(createElement(Kr065OpeningReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("КР-065: метки проёмов для ручного просмотра");
    expect(html).toContain("ABSTAIN");
    expect(html).toContain("Есть текстовые строки для ручного просмотра");
    expect(html).toContain("Номер на строке: «№ 2»");
    expect(html).toContain("Размер на строке: «1200х800 мм»");
    expect(html).toContain("принадлежность контуру не проверена");
    expect(html).toContain("Наличие усиления или неразрешённой заделки не установлено");
    expect(html).toContain("отложенных для распознавания страниц 2");
    expect(html).toContain("повторных меток 1");
    expect(html).toContain("скрытых из-за лимита подсказок 1");
    expect(html).toContain("Повторная метка проёма: контекст не установлен");
    expect(html).toContain("Текстовый блок 4");
    expect(html).toContain("строка SHA-256");
    expect(html).toContain("/api/objects/OBJ-1/files/F0141/pages/23/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0141/content");
    expect(html).not.toContain("UNVERIFIED");
    expect(html).not.toContain("NOT_ESTABLISHED");
  });

  it("hides PDF links when original source or text SHA does not match", () => {
    const altered: Kr065OpeningReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], sourceSha256: sha("9") }] };
    const html = renderToStaticMarkup(createElement(Kr065OpeningReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0141/pages/23/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0141/content");
  });

  it("does not claim to have found an opening when no proposals exist", () => {
    const empty: Kr065OpeningReviewRead = { ...data, codeRows: [{
      ...data.codeRows[0], eligibleSourceCount: 0, proposalCount: 0,
      proposals: [], abstentionCount: 0, abstentions: [],
      reasonCodes: ["SOURCE_REVIEW_REQUIRED", "NO_ELIGIBLE_REVIEWED_SOURCE"],
    }] };
    const html = renderToStaticMarkup(createElement(Kr065OpeningReview,
      { data: empty, objectId: "OBJ-1" }));
    expect(html).toContain("Текстовых подсказок для ручного просмотра нет");
    expect(html).not.toContain("Метка и размер найдены");
    expect(html).not.toContain("Есть текстовые строки для ручного просмотра");
  });
});
