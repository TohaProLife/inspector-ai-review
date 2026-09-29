import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnresolvedConfigCodeV2, UnresolvedConfigReviewV2Read } from "./api";
import { UnresolvedConfigReviewV2 } from "./UnresolvedConfigReviewV2";

const hash = (character: string) => character.repeat(64);
const codes: UnresolvedConfigCodeV2[] = ["SPZU-026", "AR-052", "IOS2-072",
  "IOS3-075", "ZU-130", "AR-043", "IOS5-080", "PPM-106", "PPM-108", "PPM-110"];
type Lead = UnresolvedConfigReviewV2Read["codeRows"][number]["leads"][number];
const lead: Lead = { sourceFileId: "F0163", sourceSha256: hash("a"),
  textArtifactSha256: hash("b"), sourceStage: "PD", sourceSection: "GP",
  pageNumber: 7, blockIndex: 3, lineIndex: 1, blockTextSha256: hash("c"),
  lineText: "Площадь покрытия", lineTextSha256: hash("d"),
  bboxMilliPoints: [1000, 2000, 3000, 4000], matchedAnchors: ["покрытия"],
  locatorType: "TEXT_LINE_BBOX_ONLY", elementAssociationStatus: "UNVERIFIED",
  leadSha256: hash("e") };
const data: UnresolvedConfigReviewV2Read = {
  schemaVersion: "unresolved-config-run-review-v2",
  profileId: "unresolved-review-config-v2", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("f"), configSha256: hash("1"),
  registrySha256: hash("2"), sourceStageArtifacts: [{ sourceFileId: "F0163",
    sourceSha256: hash("a"), textArtifactSha256: hash("b") }],
  codeRows: codes.map((parameterCode, index) => ({ parameterCode,
    candidateExtractorFamily: index < 5 ? "DOCUMENT_APPROVAL" as const
      : "SAFETY_COVERAGE" as const,
    locatorType: "TEXT_LINE_BBOX_ONLY" as const,
    requiredProofGates: index < 5 ? ["APPROVAL_DOCUMENT", "APPROVAL_AUTHORITY_DATE_SCOPE"]
      : ["APPLICABLE_NORM", "DRAWING_GEOMETRY"],
    status: "ABSTAIN" as const,
    reasonCodes: index === 0 ? ["CONFIG_PINNED_REVIEW_ONLY", "OCR_REQUIRED_DEFERRED",
      "PAGE_STAGE_UNRESOLVED_DEFERRED", "ELEMENT_OR_SPACE_UNVERIFIED",
      "PD_RD_PAIR_UNVERIFIED"] : ["CONFIG_PINNED_REVIEW_ONLY",
      "ELEMENT_OR_SPACE_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED",
      "NO_SCANNED_TEXT_IN_SCOPE"],
    eligibleSourceCount: index === 0 ? 1 : 0,
    textCandidatePageCount: index === 0 ? 1 : 0,
    ocrRequiredPageCount: index === 0 ? 2 : 0,
    oversizeAnchorLineCount: 0, leadCount: index === 0 ? 1 : 0,
    truncatedLeadCount: 0, leadCountSemantics: "MATCHES_IN_SCANNED_TEXT_ONLY" as const,
    absenceConclusion: "NOT_AVAILABLE" as const,
    leads: index === 0 ? [lead] : [],
  })), findingCount: null, parameterCoverage: null, contentHash: hash("0"),
};

describe("unresolved config review v2", () => {
  it("shows 10 abstentions, approval/norm/geometry gaps and SHA source address", () => {
    const html = renderToStaticMarkup(createElement(UnresolvedConfigReviewV2,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все 10 кодов имеют статус ABSTAIN");
    for (const code of codes) expect(html).toContain(code);
    expect(html).toContain("согласование, применимую норму, геометрию чертежа");
    expect(html).toContain("документ согласования");
    expect(html).toContain("орган, дата и область действия согласования");
    expect(html).toContain("применимая норма");
    expect(html).toContain("геометрия чертежа");
    expect(html).toContain("Страницы с неясной стадией отложены");
    expect(html).toContain("отложенных страниц, которым нужно распознавание текста, 2");
    expect(html).not.toContain("OCR_REQUIRED");
    expect(html).not.toContain("UNVERIFIED");
    expect(html).toContain("Подходящий текст для просмотра отсутствует");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("текстовый блок 4");
    expect(html).toContain("строка 2");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("Факты, замечания и охват не сформированы");
  });

  it("hides PDF links when source or text artifact hash differs", () => {
    const altered: UnresolvedConfigReviewV2Read = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("9") }] };
    const html = renderToStaticMarkup(createElement(UnresolvedConfigReviewV2,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
