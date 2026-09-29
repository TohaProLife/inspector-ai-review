import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SiteGpTableBlockRead, SiteGpTableRowReviewRead } from "./api";
import { SiteGpTableRowReview } from "./SiteGpTableRowReview";

const hash = (character: string) => character.repeat(64);
const block = (blockIndex: number, blockText: string): SiteGpTableBlockRead => ({
  blockIndex, blockText, blockTextSha256: hash("b"),
  bboxMilliPoints: [1000, 2000, 3000, 4000],
});
const origin = { sourceFileId: "F0163", sourceSha256: hash("a"),
  textArtifactSha256: hash("c"), pageNumber: 7,
  sourceRole: "PD_GP_TABLE" as const, scopedSha256: hash("d") };
const data: SiteGpTableRowReviewRead = {
  schemaVersion: "site-gp-table-row-proposals-v1",
  profileId: "site-gp-table-row-review-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("e"),
  sourceStageArtifacts: [{ sourceFileId: "F0163", sourceSha256: hash("a"),
    textArtifactSha256: hash("c") }],
  codeRows: [
    { parameterCode: "SPZU-029", status: "ABSTAIN",
      reasonCodes: ["REVIEW_ONLY_NOT_TYPED_FACT", "ROW_ASSOCIATION_UNVERIFIED"],
      eligibleSourceCount: 1, textCandidatePageCount: 4, ocrRequiredPageCount: 2,
      proposalCount: 1, abstentionCount: 0,
      proposals: [{ ...origin, proposalKind: "MAF_POSITION_NAME_ADJACENCY",
        rowAssociationStatus: "UNVERIFIED", reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"],
        rawQuantity: null, quantityStatus: "UNKNOWN", adjacencyEvidenceSha256: hash("f"),
        roles: { mafHeading: block(0, "Ведомость малых архитектурных форм"),
          positionHeader: block(1, "Поз."), nameHeader: block(2, "Наименование"),
          quantityHeader: block(3, "Кол. Примечание"), position: block(4, "3"),
          name: block(5, "Скамья") } }], abstentions: [] },
    { parameterCode: "SPZU-032", status: "ABSTAIN",
      reasonCodes: ["REVIEW_ONLY_NOT_TYPED_FACT", "ROW_ASSOCIATION_UNVERIFIED"],
      eligibleSourceCount: 1, textCandidatePageCount: 4, ocrRequiredPageCount: 2,
      proposalCount: 1, abstentionCount: 1,
      proposals: [{ ...origin, scopedSha256: hash("1"),
        proposalKind: "ROAD_LAYER_THICKNESS_ADJACENCY",
        rowAssociationStatus: "UNVERIFIED", reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"],
        unitInterpretationStatus: "UNVERIFIED", assemblyTypeStatus: "UNRESOLVED",
        adjacencyEvidenceSha256: hash("2"),
        roles: { roadHeading: block(6, "Конструкции дорожных одежд"),
          unitHeader: block(7, "Толщина слоя, м"), material: block(8, "Щебень"),
          thickness: block(9, "0,15") } }],
      abstentions: [{ ...origin, scopedSha256: hash("3"),
        reasonCode: "ROAD_LAYER_ALIGNMENT_AMBIGUOUS", anchor: block(10, "0,20"),
        abstentionSha256: hash("4") }] },
  ], findingCount: null, parameterCoverage: null, contentHash: hash("5"),
};

describe("site GP table row review", () => {
  it("shows ABSTAIN and block adjacency with unknown quantity and authenticated PDF links", () => {
    const html = renderToStaticMarkup(createElement(SiteGpTableRowReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Оба кода имеют статус ABSTAIN");
    expect(html).toContain("SPZU-029");
    expect(html).toContain("SPZU-032");
    expect(html).toContain("ROW_ASSOCIATION_UNVERIFIED");
    expect(html).toContain("Скамья");
    expect(html).toContain("Щебень");
    expect(html).toContain("Количество: неизвестно");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("блок 6");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("не установлены");
    expect(html).not.toContain("Подтвердить нарушение");
  });

  it("hides PDF links when source or text artifact hash differs", () => {
    const altered: SiteGpTableRowReviewRead = { ...data,
      sourceStageArtifacts: [{ ...data.sourceStageArtifacts[0],
        textArtifactSha256: hash("0") }] };
    const html = renderToStaticMarkup(createElement(SiteGpTableRowReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник соседства не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
