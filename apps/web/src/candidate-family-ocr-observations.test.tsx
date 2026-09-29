import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateFamilyOcrObservations } from "./CandidateFamilyOcrObservations";
import type { CandidateFamilyOcrObservationsRead } from "./api";

const hash = (character: string) => character.repeat(64);

const lead: CandidateFamilyOcrObservationsRead["codeRows"][number]["candidateLeads"][number] = {
  schemaVersion: "candidate-family-ocr-lead-v1", status: "CANDIDATE", purpose: "REVIEW_ONLY",
  parameterCode: "PZ-002", family: "RELATIVE_DELTA", attribute: "area",
  canonicalUnit: "m2", matchedLabel: "Общая площадь здания", rawValue: "11618,27",
  rawUnit: "м²", featureKey: null, scopeTokens: null,
  sourceFileId: "F0150", sourceSha256: hash("c"), ocrArtifactSha256: hash("d"),
  ocrPageSha256: hash("e"), objectId: "OBJ-1", inputManifestHash: hash("b"),
  stage: "PD", sectionCode: "PZ", revisionStatus: "CURRENT", approvalStatus: "APPROVED",
  pageNumber: 26, coordinateSystem: "IMAGE_TOP_LEFT_PIXELS",
  lineText: "Общая площадь здания 11618,27 м²",
  locator: {
    kind: "DOCUMENT_OCR_LINE", lineIndex: 3, start: 23, end: 31,
    bboxPx: [41, 52, 260, 75], score: 0.9348,
    renderSha256: hash("f"), rendererProfileId: "render-v1",
    providerProfileId: "ocr-v1", providerScript: "cyrillic",
    dpi: 144, widthPx: 2048, heightPx: 1536,
  },
  leadSha256: hash("1"),
};

const data: CandidateFamilyOcrObservationsRead = {
  schemaVersion: "candidate-family-ocr-observations-v1", inputManifestHash: hash("b"),
  objectId: "OBJ-1", scope: "RUN_COMMITTED_OCR", purpose: "REVIEW_ONLY",
  ocrArtifactSha256: hash("d"), candidateRulePackSha256: hash("2"),
  numericLabelPackSha256: hash("3"), classLabelPackSha256: hash("4"),
  presenceLabelPackSha256: hash("5"),
  codeRows: Array.from({ length: 47 }, (_, index) => ({
    parameterCode: index === 0 ? "PZ-002" : `TEST-${String(index).padStart(3, "0")}`,
    family: index === 1 ? "PRESENCE_SET" : "RELATIVE_DELTA", ruleId: `RULE-${index}`,
    status: "ABSTAIN", reasonCodes: index === 0
      ? ["FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED", "OCR_DEFERRED_IN_SCOPE", "LEAD_LIMIT_REACHED"]
      : ["NO_EXACT_OCR_LABEL_LEAD"],
    eligibleSourceCount: 2, ocrProcessedPageCount: index === 0 ? 1 : 0,
    ocrDeferredPageCount: index === 0 ? 3 : 0,
    leadCount: index === 0 ? 1 : 0, candidateLeads: index === 0 ? [lead] : [],
  })),
  findingCount: null, parameterCoverage: null, outputCount: 47, contentHash: hash("6"),
};

describe("candidate family OCR observations panel", () => {
  it("shows collapsed review-only groups, OCR geometry, source link and provenance without a finding", () => {
    const html = renderToStaticMarkup(createElement(CandidateFamilyOcrObservations, {
      data, objectId: "OBJ-1", parameterNames: { "PZ-002": "Площадь здания" },
    }));

    expect(html).toContain("Для всех 47 кодов вывод не сделан (ABSTAIN)");
    expect(html).toContain("не является подтверждённым фактом или находкой");
    expect(html).toContain("<details>");
    expect(html).toContain("Просмотреть OCR-подсказки: 1 · кодов с подсказками: 1 · семейств: 2");
    expect(html).toContain("TEST-046");
    expect(html).toContain("PZ-002</strong> · Площадь здания · ABSTAIN");
    expect(html).toContain("Обработано OCR-страниц: 1. Ожидают OCR: 3");
    expect(html).toContain("OCR-строка 4 · оценка OCR 0.935");
    expect(html).toContain("Рамка OCR [41, 52, 260, 75] · координаты изображения: IMAGE_TOP_LEFT_PIXELS");
    expect(html).toContain("Исходная OCR-строка: «Общая площадь здания 11618,27 м²»");
    expect(html).toContain("/api/objects/OBJ-1/files/F0150/pages/26/preview");
    expect(html).toContain("SHA-256 файла <code title=\"");
    expect(html).toContain("Показаны не все подсказки");
  });

  it("does not imply absent parameter when OCR produced no leads", () => {
    const html = renderToStaticMarkup(createElement(CandidateFamilyOcrObservations, {
      data: { ...data, codeRows: data.codeRows.map((row) => ({
        ...row, leadCount: 0, candidateLeads: [], reasonCodes: ["NO_EXACT_OCR_LABEL_LEAD"],
      })) },
      objectId: "OBJ-1",
    }));
    expect(html).toContain("Просмотреть OCR-подсказки: 0 · кодов с подсказками: 0");
    expect(html).toContain("OCR-подсказок нет. Это не подтверждает отсутствие параметра в документах.");
  });
});
