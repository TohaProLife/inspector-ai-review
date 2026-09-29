import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnresolvedFamilyReviewRead } from "./api";
import { UnresolvedFamilyReview } from "./UnresolvedFamilyReview";

const hash = (character: string) => character.repeat(64);
const lead = { sourceFileId: "F0202", sourceSha256: hash("a"), textArtifactSha256: hash("b"),
  pageNumber: 7, blockIndex: 3, lineIndex: 1, lineText: "Материал трубы ПВХ",
  blockTextSha256: hash("c"), bboxMilliPoints: [1000, 2000, 3000, 4000] as [number, number, number, number],
  leadSha256: hash("d") };
const data: UnresolvedFamilyReviewRead = {
  schemaVersion: "unresolved-family-run-review-v1", profileId: "unresolved-family-text-review-v1",
  purpose: "REVIEW_ONLY", objectId: "0be85adc-8c66-465f-82b5-0e982dcc0782", inputManifestHash: hash("e"),
  sourceStageArtifacts: [{ sourceFileId: "F0202", sourceSha256: hash("a"),
    textArtifactSha256: hash("b") }],
  codeRows: [
    { parameterCode: "AR-042", status: "ABSTAIN", reasonCodes: ["OCR_REQUIRED_IN_SCOPE"], leads: [] },
    { parameterCode: "IOS2-072", status: "ABSTAIN", reasonCodes: ["LEAD_NOT_VERIFIED_FACT"],
      leads: [lead] },
    { parameterCode: "IOS3-075", status: "ABSTAIN", reasonCodes: ["LEAD_LIMIT_REACHED"],
      leads: [] },
  ],
  findingCount: null, parameterCoverage: null, contentHash: hash("f"),
};

describe("unresolved family review", () => {
  it("shows all three ABSTAIN codes, source provenance and original PDF, without findings", () => {
    const html = renderToStaticMarkup(createElement(UnresolvedFamilyReview,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("AR-042");
    expect(html).toContain("IOS2-072");
    expect(html).toContain("IOS3-075");
    expect(html).toContain("Все три кода имеют статус ABSTAIN");
    expect(html).toContain("Строк-подсказок: 1");
    expect(html).toContain("На части нужных страниц требуется адресный OCR");
    expect(html).toContain("Строка требует проверки смысла и применимости");
    expect(html).toContain("По нему нельзя судить о полноте документа");
    expect(html).toContain("Материал трубы ПВХ");
    expect(html).toContain("текстовый блок 4");
    expect(html).toContain("строка 2");
    expect(html).toContain("/api/objects/OBJ-1/files/F0202/pages/7/preview");
    expect(html).toContain("PDF SHA-256");
    expect(html).toContain("текстовый артефакт SHA-256");
    expect(html).toContain("Охват параметров здесь не определяется");
    expect(html).not.toContain("Сохранить");
    expect(html).not.toContain("Подтвердить нарушение");
  });

  it("hides page link when source and text artifact do not match committed provenance", () => {
    const altered: UnresolvedFamilyReviewRead = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("0") }] };
    const html = renderToStaticMarkup(createElement(UnresolvedFamilyReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Сохранённый источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0202/pages/7/preview");
  });

  it("marks incomplete packet without inventing missing code rows", () => {
    const altered: UnresolvedFamilyReviewRead = { ...data, codeRows: [data.codeRows[0]] };
    const html = renderToStaticMarkup(createElement(UnresolvedFamilyReview,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Пакет строк неполный");
    expect(html).not.toContain("Строки-подсказки IOS2-072");
  });
});
