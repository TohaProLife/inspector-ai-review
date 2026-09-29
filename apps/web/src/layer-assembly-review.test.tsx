import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LayerAssemblyReviewRead } from "./api";
import { LayerAssemblyReview } from "./LayerAssemblyReview";

const hash = (character: string) => character.repeat(64);
const locator = (lineText: string) => ({ blockIndex: 2, lineIndex: 0,
  lineText, lineTextSha256: hash("c"), blockTextSha256: hash("d"),
  bboxMilliPoints: [100, 200, 300, 400] as [number, number, number, number] });
type Proposal = LayerAssemblyReviewRead["codeRows"][number]["proposals"][number];
const roofProposal: Proposal = { sourceFileId: "F0156", sourceSha256: hash("a"),
  textArtifactSha256: hash("b"), pageSha256: hash("e"), pageNumber: 17,
  sourceStage: "PD", sourceSection: "AR",
  proposalKind: "ROOF_MATERIAL_THICKNESS_NEIGHBORHOOD",
  rowAssociationStatus: "UNVERIFIED", typeAssociationStatus: "UNVERIFIED",
  zoneAssociationStatus: "UNVERIFIED", rawThickness: null, rawQuantity: null,
  roles: { heading: locator("Конструкция кровли"),
    material: locator("Минераловатные плиты"), thickness: locator("50 мм") },
  scopedSha256: hash("f") };
const rows: LayerAssemblyReviewRead["codeRows"] = ["SPZU-032", "AR-044", "ZU-125"]
  .map((parameterCode, index) => ({
    parameterCode: parameterCode as "SPZU-032" | "AR-044" | "ZU-125",
    status: "ABSTAIN" as const,
    reasonCodes: index === 0 ? ["EXISTING_SITE_GP_TABLE_ROW_REVIEW",
      "ROW_ASSOCIATION_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED"]
      : ["ROW_ASSOCIATION_UNVERIFIED", "OCR_REQUIRED_DEFERRED",
        "PD_RD_PAIR_UNVERIFIED"],
    eligibleSourceCount: 1, textCandidatePageCount: 1,
    ocrRequiredPageCount: index === 0 ? 0 : 2,
    oversizeAnchorLineCount: 1, proposalCount: index === 0 ? 0 : 1,
    truncatedProposalCount: 0, abstentionCount: index === 2 ? 1 : 0,
    truncatedAbstentionCount: 0, absenceConclusion: "NOT_AVAILABLE" as const,
    proposals: index === 0 ? [] : [index === 1 ? roofProposal : {
      ...roofProposal, proposalKind: "WALL_MATERIAL_THICKNESS_NEIGHBORHOOD" as const,
      roles: { type: locator("Тип 2"), material: locator("Минераловатные плиты"),
        thickness: locator("50 мм") },
      scopedSha256: hash("9") }],
    abstentions: index === 2 ? [{ sourceFileId: "F0156", sourceSha256: hash("a"),
      textArtifactSha256: hash("b"), pageSha256: hash("e"), pageNumber: 17,
      sourceStage: "PD" as const, sourceSection: "AR",
      reasonCode: "MATERIAL_THICKNESS_ROW_UNVERIFIED",
      anchor: locator("Соседняя строка"), scopedSha256: hash("8") }] : [],
  }));
const data: LayerAssemblyReviewRead = {
  schemaVersion: "layer-assembly-proposals-v1",
  profileId: "layer-assembly-review-v1", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("1"),
  sourceStageArtifacts: [{ sourceFileId: "F0156", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }], codeRows: rows,
  findingCount: null, parameterCoverage: null, contentHash: hash("2"),
};

describe("layer assembly review", () => {
  it("shows three abstentions, deferred OCR and unverified role locators", () => {
    const html = renderToStaticMarkup(createElement(LayerAssemblyReview,
      { data, objectId: "OBJ-1" }));
    for (const code of ["SPZU-032", "AR-044", "ZU-125"]) expect(html).toContain(code);
    expect(html).toContain("Все три кода имеют статус ABSTAIN");
    expect(html).toContain("Для дорожных покрытий есть отдельный просмотр строк таблицы ГП");
    expect(html).toContain("Строки дорожных покрытий просматриваются в отдельном разделе ГП");
    expect(html).toContain("Страницы, которым нужно распознавание текста, отложены");
    expect(html).toContain("отложенных для распознавания страниц 2");
    expect(html).toContain("Соседняя размерная строка без проверенной привязки");
    expect(html).toContain("Толщина и количество не определены");
    expect(html).toContain("Текстовый блок 3");
    expect(html).toContain("строка 1");
    expect(html).not.toContain("Между типом");
    expect(html).toContain("Связь материала и соседней размерной строки не проверена");
    expect(html).toContain("/api/objects/OBJ-1/files/F0156/pages/17/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0156/content");
    expect(html).not.toContain("rawThickness");
    expect(html).not.toContain("UNVERIFIED");
  });

  it("hides PDF links if source or text artifact SHA is not bound", () => {
    const altered: LayerAssemblyReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("0") }] };
    const html = renderToStaticMarkup(createElement(LayerAssemblyReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0156/pages/17/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0156/content");
  });
});
