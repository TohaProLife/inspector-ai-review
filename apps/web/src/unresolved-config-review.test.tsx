import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnresolvedConfigCode, UnresolvedConfigReviewRead } from "./api";
import { UnresolvedConfigReview } from "./UnresolvedConfigReview";

const hash = (character: string) => character.repeat(64);
const codes: UnresolvedConfigCode[] = ["PZ-003", "PZ-011", "PZ-019", "PZ-020",
  "SPZU-027", "SPZU-028", "AR-046", "PZ-005", "SPZU-031", "SPZU-033",
  "AR-042", "AR-047", "AR-048", "AR-051", "KR-060", "POS-084",
  "ODI-116", "ODI-117", "ODI-119"];
type Lead = UnresolvedConfigReviewRead["codeRows"][number]["leads"][number];
const lead: Lead = { sourceFileId: "F0163", sourceSha256: hash("a"),
  textArtifactSha256: hash("b"), sourceStage: "PD", sourceSection: "GP",
  pageNumber: 7, blockIndex: 3, lineIndex: 1, blockTextSha256: hash("c"),
  lineText: "Площадь участка", lineTextSha256: hash("d"),
  bboxMilliPoints: [1000, 2000, 3000, 4000], matchedAnchors: ["площадь"],
  locatorType: "TEXT_LINE_BBOX_ONLY", elementAssociationStatus: "UNVERIFIED",
  leadSha256: hash("e") };
const data: UnresolvedConfigReviewRead = {
  schemaVersion: "unresolved-config-run-review-v1",
  profileId: "unresolved-review-config-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("f"), configSha256: hash("1"),
  registrySha256: hash("2"), sourceStageArtifacts: [{ sourceFileId: "F0163",
    sourceSha256: hash("a"), textArtifactSha256: hash("b") }],
  codeRows: codes.map((parameterCode, index) => ({ parameterCode,
    candidateExtractorFamily: index < 7 ? "AREA_PROGRAM" as const
      : "DIMENSION_LAYOUT" as const,
    locatorType: "TEXT_LINE_BBOX_ONLY" as const,
    requiredProofGates: ["APPROVED_SOURCE_REVISIONS", "SAME_ELEMENT_OR_SPACE"],
    status: "ABSTAIN" as const,
    reasonCodes: index === 0 ? ["CONFIG_PINNED_REVIEW_ONLY", "ELEMENT_OR_SPACE_UNVERIFIED",
      "PD_RD_PAIR_UNVERIFIED", "OCR_REQUIRED_DEFERRED", "OVERSIZE_ANCHOR_LINE_DEFERRED",
      "LEAD_LIMIT_REACHED"] : ["CONFIG_PINNED_REVIEW_ONLY", "ELEMENT_OR_SPACE_UNVERIFIED",
      "PD_RD_PAIR_UNVERIFIED", "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT"],
    eligibleSourceCount: 1, textCandidatePageCount: 4,
    ocrRequiredPageCount: index === 0 ? 3 : 0,
    oversizeAnchorLineCount: index === 0 ? 2 : 0,
    leadCount: index === 0 ? 17 : 0, truncatedLeadCount: index === 0 ? 1 : 0,
    leadCountSemantics: "MATCHES_IN_SCANNED_TEXT_ONLY" as const,
    absenceConclusion: "NOT_AVAILABLE" as const,
    leads: index === 0 ? Array.from({ length: 16 }, (_, ordinal) => ({ ...lead,
      blockIndex: ordinal, leadSha256: hash(ordinal.toString(16)) })) : [],
  })),
  findingCount: null, parameterCoverage: null, contentHash: hash("0"),
};

describe("unresolved config review", () => {
  it("shows 19 abstentions, scanned-text limits and source-bound PDF address", () => {
    const html = renderToStaticMarkup(createElement(UnresolvedConfigReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все 19 кодов имеют статус ABSTAIN");
    for (const code of codes) expect(html).toContain(code);
    expect(html).toContain("Страницы с OCR_REQUIRED отложены");
    expect(html).toContain("отложенных страниц OCR_REQUIRED 3");
    expect(html).toContain("слишком длинных строк 2");
    expect(html).toContain("скрытых из-за лимита строк 1");
    expect(html).toContain("В просмотренном тексте строка-подсказка не найдена");
    expect(html).toContain("Вывод об отсутствии параметра недоступен");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("текстовый блок 1");
    expect(html).toContain("строка 2");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("Факты, замечания и охват не сформированы");
  });

  it("hides PDF links when source or text artifact hash differs", () => {
    const altered: UnresolvedConfigReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("9") }] };
    const html = renderToStaticMarkup(createElement(UnresolvedConfigReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });

  it("explains scanned-text and page-stage limits without exposing reason codes", () => {
    const unreviewed: UnresolvedConfigReviewRead = { ...data, codeRows: data.codeRows.map(
      (row) => ({ ...row, reasonCodes: ["NO_SCANNED_TEXT_IN_SCOPE",
        "PAGE_STAGE_UNRESOLVED_DEFERRED", "PAGE_STAGE_MAP_INCOMPLETE"] })) };
    const html = renderToStaticMarkup(createElement(UnresolvedConfigReview,
      { data: unreviewed, objectId: "OBJ-1" }));
    expect(html).toContain("Нет просмотренного текста в подходящих проверенных источниках");
    expect(html).toContain("Страницы с неподтверждённой стадией отложены");
    expect(html).toContain("Для части страниц не указана стадия");
    expect(html).not.toContain("NO_SCANNED_TEXT_IN_SCOPE");
    expect(html).not.toContain("PAGE_STAGE_UNRESOLVED_DEFERRED");
    expect(html).not.toContain("PAGE_STAGE_MAP_INCOMPLETE");
  });
});
