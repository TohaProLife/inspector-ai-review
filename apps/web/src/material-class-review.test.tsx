import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MaterialClassReviewRead } from "./api";
import { MaterialClassReview } from "./MaterialClassReview";

const hash = (character: string) => character.repeat(64);
type MaterialLead = MaterialClassReviewRead["codeRows"][number]["leads"][number];
const lead = (kind: MaterialLead["leadKind"], lineText: string,
  actualProtectionStatus?: "NOT_ESTABLISHED"): MaterialLead => ({
  sourceFileId: "F0163", sourceSha256: hash("a"), textArtifactSha256: hash("b"),
  sourceStage: "PD", sourceRole: "KR_MATERIAL_NAVIGATION", pageNumber: 7,
  blockIndex: 3, lineIndex: 1, blockTextSha256: hash("c"), lineText,
  lineTextSha256: hash("d"), bboxMilliPoints: [1000, 2000, 3000, 4000],
  leadKind: kind, elementAssociationStatus: "UNVERIFIED",
  crossFileMatchStatus: "UNVERIFIED", ...(actualProtectionStatus
    ? { actualProtectionStatus } : {}), leadSha256: hash("e"),
});
const data: MaterialClassReviewRead = {
  schemaVersion: "material-class-run-review-v1",
  profileId: "material-class-text-navigation-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("f"),
  sourceStageArtifacts: [{ sourceFileId: "F0163", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }],
  codeRows: [
    { parameterCode: "KR-056", status: "ABSTAIN",
      reasonCodes: ["LEXICAL_NAVIGATION_ONLY", "ELEMENT_IDENTITY_UNVERIFIED",
        "PD_RD_PAIR_UNVERIFIED"], eligibleSourceCount: 1,
      textCandidatePageCount: 4, ocrRequiredPageCount: 2, leadCount: 1,
      leads: [lead("TABLE_HEADING_UNLINKED", "C345")] },
    { parameterCode: "KR-057", status: "ABSTAIN",
      reasonCodes: ["LEXICAL_NAVIGATION_ONLY", "ELEMENT_IDENTITY_UNVERIFIED",
        "PD_RD_PAIR_UNVERIFIED"], eligibleSourceCount: 1,
      textCandidatePageCount: 4, ocrRequiredPageCount: 2, leadCount: 1,
      leads: [lead("GENERAL_REQUIREMENT_UNLINKED", "Арматура А500С для конструкций")] },
    { parameterCode: "KR-066", status: "ABSTAIN",
      reasonCodes: ["LEXICAL_NAVIGATION_ONLY", "ELEMENT_IDENTITY_UNVERIFIED",
        "PD_RD_PAIR_UNVERIFIED"], eligibleSourceCount: 1,
      textCandidatePageCount: 4, ocrRequiredPageCount: 2, leadCount: 1,
      leads: [lead("PROTECTION_COMPOSITION_MENTION_UNVERIFIED",
        "Толщина огнезащитного покрытия", "NOT_ESTABLISHED")] },
  ], findingCount: null, parameterCoverage: null, contentHash: hash("0"),
};

describe("material class review", () => {
  it("shows three abstentions, lexical categories and unverified element/protection", () => {
    const html = renderToStaticMarkup(createElement(MaterialClassReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все три кода имеют статус ABSTAIN");
    expect(html).toContain("KR-056");
    expect(html).toContain("KR-057");
    expect(html).toContain("KR-066");
    expect(html).toContain("TABLE_HEADING_UNLINKED");
    expect(html).toContain("GENERAL_REQUIREMENT_UNLINKED");
    expect(html).toContain("PROTECTION_COMPOSITION_MENTION_UNVERIFIED");
    expect(html).toContain("Элемент: UNVERIFIED; сопоставление файлов: UNVERIFIED");
    expect(html).toContain("Фактическая огнезащита: <strong>NOT_ESTABLISHED</strong>");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("текстовый блок 4");
    expect(html).toContain("строка 2");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("Факты, сравнение, замечания и охват не сформированы");
  });

  it("hides PDF links when source or text artifact hash differs", () => {
    const altered: MaterialClassReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("1") }] };
    const html = renderToStaticMarkup(createElement(MaterialClassReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
