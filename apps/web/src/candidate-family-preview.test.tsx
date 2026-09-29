import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateFamilyPreview } from "./CandidateFamilyPreview";
import type { CandidateFamilyPreviewRead } from "./api";

const row: CandidateFamilyPreviewRead["codeRows"][number] = {
  parameterCode: "PZ-002", family: "RELATIVE_DELTA", status: "ABSTAIN",
  reasonCodes: ["FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED", "OCR_REQUIRED_IN_SCOPE"],
  eligibleSourceCount: 1, textScannedPageCount: 20, ocrRequiredPageCount: 2,
  leadCount: 1, candidateLeads: [{
    leadSha256: "a".repeat(64), sourceFileId: "F0150", sourceSha256: "b".repeat(64),
    pageNumber: 26, stage: "PD", sectionCode: "PZ",
    matchedLabel: "Общая площадь здания", rawValue: "11618,27", rawUnit: "м²",
    lineText: "Общая площадь здания 11618,27 м²",
  }],
};

const data: CandidateFamilyPreviewRead = {
  schemaVersion: "candidate-family-preview-v1", inputManifestHash: "c".repeat(64),
  objectId: "OBJ-1", scope: "RUN_COMMITTED_SOURCES", purpose: "REVIEW_ONLY",
  candidateRulePackSha256: "d".repeat(64), codeRows: [row],
  findingCount: null, parameterCoverage: null, outputCount: 47,
  contentHash: "e".repeat(64),
};

describe("candidate family review panel", () => {
  it("shows the abstention and opens the SHA-bound source page without claiming a finding", () => {
    const html = renderToStaticMarkup(createElement(CandidateFamilyPreview, {
      data, objectId: "OBJ-1", parameterNames: { "PZ-002": "Площадь здания" },
    }));

    expect(html).toContain("<strong>PZ-002</strong> · Площадь здания");
    expect(html).toContain("вывод не сделан");
    expect(html).toContain("Часть страниц требует распознавания");
    expect(html).toContain("Общая площадь здания 11618,27 м²");
    expect(html).toContain("Источник F0150 · страница PDF 26 · SHA-256 bbbbbbbbbbbb…");
    expect(html).toContain("/api/objects/OBJ-1/files/F0150/pages/26/preview");
    expect(html).toContain("не подтверждают факт, расхождение, отсутствие элемента или покрытие параметра");
  });
});
