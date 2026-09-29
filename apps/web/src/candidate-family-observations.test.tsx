import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateFamilyObservations } from "./CandidateFamilyObservations";
import type { CandidateFamilyObservationsRead } from "./api";

const hash = (character: string) => character.repeat(64);
const codeRows: CandidateFamilyObservationsRead["codeRows"] = Array.from({ length: 47 }, (_, index) => ({
  parameterCode: index === 0 ? "PZ-002" : `TEST-${String(index).padStart(3, "0")}`,
  family: index === 1 ? "PRESENCE_SET" : "RELATIVE_DELTA",
  status: "REVIEW_ONLY",
  observationCount: index === 0 ? 1 : 0,
  reasonCodes: index === 0
    ? ["FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED", "OCR_REQUIRED_IN_SCOPE", "PREVIEW_BYTE_BUDGET_REACHED"]
    : ["NO_EXACT_LABEL_LEAD"],
}));

const observation: CandidateFamilyObservationsRead["observations"][number] = {
  schemaVersion: "candidate-family-observation-v1",
  observationId: hash("a"), status: "REVIEW_ONLY",
  parameterCode: "PZ-002", family: "RELATIVE_DELTA", attribute: "area",
  canonicalUnit: "m2", matchedLabel: "Общая площадь здания",
  rawValue: "11618,27", rawUnit: "м²", featureKey: null, scopeTokens: null,
  objectId: "OBJ-1", inputManifestHash: hash("b"),
  sourceFileId: "F0150", sourceSha256: hash("c"), artifactSha256: hash("d"),
  stage: "PD", sectionCode: "PZ", revisionStatus: "CURRENT", approvalStatus: "APPROVED",
  pageNumber: 26, lineText: "Общая площадь здания 11618,27 м²",
  blockTextSha256: hash("e"),
  locator: {
    kind: "DOCUMENT_TEXT_BLOCK_LINE", blockIndex: 4, lineIndex: 1,
    start: 23, end: 31, bboxMilliPoints: [1, 2, 3, 4],
  },
  leadSha256: hash("f"), candidateRulePackSha256: hash("1"),
  numericLabelPackSha256: hash("2"), classLabelPackSha256: hash("3"),
  presenceLabelPackSha256: hash("4"),
  typedFact: { factId: "do-not-show-as-confirmed-result" },
};

const data: CandidateFamilyObservationsRead = {
  schemaVersion: "candidate-family-observations-v1", purpose: "REVIEW_ONLY",
  inputManifestHash: hash("b"), objectId: "OBJ-1",
  candidateRulePackSha256: hash("1"), numericLabelPackSha256: hash("2"),
  classLabelPackSha256: hash("3"), presenceLabelPackSha256: hash("4"),
  codeRows, observations: [observation], outputCount: 1,
  findingCount: null, parameterCoverage: null, contentHash: hash("5"),
};

describe("candidate family observations panel", () => {
  it("renders all code rows, the source address and original line while withholding conclusions", () => {
    const html = renderToStaticMarkup(createElement(CandidateFamilyObservations, {
      data, objectId: "OBJ-1", parameterNames: { "PZ-002": "Площадь здания" },
    }));

    expect(html).toContain("Для всех 47 кодов вывод не сделан");
    expect(html).toContain("TEST-046");
    expect(html).toContain("PZ-002</strong> · Площадь здания · вывод не сделан");
    expect(html).toContain("Общая площадь здания: 11618,27 м²");
    expect(html).toContain("Источник F0150 · раздел PZ · страница PDF 26 · блок 5, строка 2");
    expect(html).toContain("Исходная строка: «Общая площадь здания 11618,27 м²»");
    expect(html).toContain("/api/objects/OBJ-1/files/F0150/pages/26/preview");
    expect(html).toContain("Находки и покрытие параметров этим этапом не определяются");
    expect(html).not.toContain("do-not-show-as-confirmed-result");
  });

  it("marks truncated and OCR-limited lists as incomplete, including empty code rows", () => {
    const html = renderToStaticMarkup(createElement(CandidateFamilyObservations, {
      data, objectId: "OBJ-1",
    }));

    expect(html).toContain("Кодов с ограниченным списком подсказок: 1");
    expect(html).toContain("Часть страниц требует распознавания");
    expect(html).toContain("Показаны не все подсказки");
    expect(html).toContain("Наблюдений нет. Это не подтверждает отсутствие параметра в документах.");
  });
});
