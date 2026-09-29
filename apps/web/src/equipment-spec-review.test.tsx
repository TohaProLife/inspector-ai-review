import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EquipmentSpecReviewRead } from "./api";
import { EquipmentSpecReview } from "./EquipmentSpecReview";

const hash = (character: string) => character.repeat(64);
type EquipmentLead = EquipmentSpecReviewRead["codeRows"][number]["leads"][number];
const lead = (kind: EquipmentLead["leadKind"], lineText: string,
  stage: "PD" | "RD"): EquipmentLead => ({
  sourceFileId: "F0163", sourceSha256: hash("a"), textArtifactSha256: hash("b"),
  sourceStage: stage, sourceRole: "OV_EQUIPMENT_NAVIGATION", pageNumber: 7,
  blockIndex: 3, lineIndex: 1, blockTextSha256: hash("c"), lineText,
  lineTextSha256: hash("d"), bboxMilliPoints: [1000, 2000, 3000, 4000],
  leadKind: kind, rowAssociationStatus: "UNVERIFIED",
  systemAssignmentStatus: "UNVERIFIED", leadSha256: hash("e"),
});
const data: EquipmentSpecReviewRead = {
  schemaVersion: "equipment-spec-run-review-v1",
  profileId: "equipment-spec-text-navigation-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("f"),
  sourceStageArtifacts: [{ sourceFileId: "F0163", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }],
  codeRows: [
    { parameterCode: "IOS4-077", status: "ABSTAIN",
      reasonCodes: ["LEXICAL_NAVIGATION_ONLY", "ROW_ASSOCIATION_UNVERIFIED",
        "PD_RD_PAIR_UNVERIFIED"], eligibleSourceCount: 1,
      textCandidatePageCount: 4, ocrRequiredPageCount: 2, leadCount: 1,
      leads: [lead("SCHEDULE_TOKEN", "Радиатор PRADO Classic", "PD")] },
    { parameterCode: "IOS4-079", status: "ABSTAIN",
      reasonCodes: ["LEXICAL_NAVIGATION_ONLY", "ROW_ASSOCIATION_UNVERIFIED",
        "PD_RD_PAIR_UNVERIFIED"], eligibleSourceCount: 1,
      textCandidatePageCount: 4, ocrRequiredPageCount: 2, leadCount: 1,
      leads: [lead("CALCULATION_PROSE", "Давление вентилятора", "RD")] },
    { parameterCode: "PPM-112", status: "ABSTAIN",
      reasonCodes: ["LEXICAL_NAVIGATION_ONLY", "ROW_ASSOCIATION_UNVERIFIED",
        "PD_RD_PAIR_UNVERIFIED"], eligibleSourceCount: 1,
      textCandidatePageCount: 4, ocrRequiredPageCount: 2, leadCount: 1,
      leads: [lead("REGISTER_PROSE", "Дымоудаление", "PD")] },
  ], findingCount: null, parameterCoverage: null, contentHash: hash("0"),
};

describe("equipment spec review", () => {
  it("shows three abstentions, lead kinds and unverified row/system boundaries", () => {
    const html = renderToStaticMarkup(createElement(EquipmentSpecReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все три кода имеют статус ABSTAIN");
    expect(html).toContain("IOS4-077");
    expect(html).toContain("IOS4-079");
    expect(html).toContain("PPM-112");
    expect(html).toContain("SCHEDULE_TOKEN");
    expect(html).toContain("CALCULATION_PROSE");
    expect(html).toContain("REGISTER_PROSE");
    expect(html).toContain("Строка и система: UNVERIFIED");
    expect(html).toContain("Пара ПД/РД не подтверждена");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("текстовый блок 4");
    expect(html).toContain("строка 2");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("Факты, сравнение, замечания и охват не сформированы");
  });

  it("hides PDF links when source or text artifact hash differs", () => {
    const altered: EquipmentSpecReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("1") }] };
    const html = renderToStaticMarkup(createElement(EquipmentSpecReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
