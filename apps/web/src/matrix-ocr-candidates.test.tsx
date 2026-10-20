import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatrixOcrCandidate, SourceFileSummary } from "@inspector-ai/contracts";
import { MatrixOcrCandidates, matrixFactEvidence, matrixFactMatchesQuery } from "./MatrixExecutionPanel";

const candidate: MatrixOcrCandidate = { id: "ocr-candidate-synthetic", sourceFileId: "FIL-OCR", sourceSha256: "a".repeat(64),
  stage: "UNRESOLVED", pageNumber: 13, lineIndex: 2, blockId: "ocr:2", renderSha256: "b".repeat(64), ocrPageContentHash: "c".repeat(64),
  bbox: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }, coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED",
  rawText: "Общая площадь здания: 12,5 м²", rawValue: "12,5", rawUnit: "м²", value: "12.5", unit: "m2",
  attribute: "BUILDING_TOTAL_AREA", parameterCodes: ["PZ-002"], entityKey: null, method: "OCR", status: "CANDIDATE",
  extractorVersion: "matrix-ocr-literal-candidates-v1", sourceFlags: ["OCR_TRANSCRIPTION_UNVERIFIED", "SOURCE_APPROVAL_UNKNOWN"] };
const file: SourceFileSummary = { id: "FIL-OCR", name: "Тестовый скан ПЗ.pdf", sha256: candidate.sourceSha256, size: 100,
  stages: ["PD", "RD"], pageCount: 15, registeredAt: "2026-10-17T00:00:00Z", review: null };

describe("separate OCR candidate presentation", () => {
  it("keeps unverified transcription visible with source, page, render hash and original action", () => {
    const html = renderToStaticMarkup(createElement(MatrixOcrCandidates, { candidates: [candidate], files: [file], query: "", onSelect: () => {} }));
    expect(html).toContain("OCR-транскрипция не проверена"); expect(html).toContain("Тестовый скан ПЗ.pdf");
    expect(html).toContain("PDF 13 · строка OCR 3"); expect(html).toContain("Стадия не установлена");
    expect(html).toContain(candidate.rawText); expect(html).toContain("12.5 m2");
    expect(html).toContain(candidate.renderSha256); expect(html).toContain(candidate.ocrPageContentHash);
    expect(html).toContain("Сверить OCR с исходным фрагментом"); expect(html).toContain("Согласование неизвестно");
    expect(html).not.toContain("≥80%"); expect(html).not.toContain("Машинное предупреждение");
    const missingFlag = renderToStaticMarkup(createElement(MatrixOcrCandidates, { candidates: [{ ...candidate, sourceFlags: [] }], files: [], query: "", onSelect: () => {} }));
    expect(missingFlag).toContain("Ограничения: OCR-транскрипция не проверена");
  });

  it("searches raw text, exact value, parameter and source without treating zero matches as absence", () => {
    for (const query of ["скан ПЗ", "fil-ocr", "PZ-002", "12.5", "площадь", "unresolved"]) {
      expect(matrixFactMatchesQuery(candidate, query, [file])).toBe(true);
    }
    const html = renderToStaticMarkup(createElement(MatrixOcrCandidates, { candidates: [candidate], files: [file], query: "нет совпадения", onSelect: () => {} }));
    expect(html).toContain("Кандидатов OCR: 0 / 1"); expect(html).toContain("Это не доказывает отсутствие значений");
    expect(html).not.toContain("<article");
  });

  it("passes the canonical visible top-left bbox into original viewer without a second y flip", () => {
    const evidence = matrixFactEvidence(candidate);
    expect(evidence).toMatchObject({ sourceFileId: candidate.sourceFileId, sourceSha256: candidate.sourceSha256,
      stage: "UNRESOLVED", pageNumber: 13, value: "12.5", unit: "m2" });
    expect(evidence.bbox?.[0]).toBeCloseTo(0.1); expect(evidence.bbox?.[1]).toBeCloseTo(0.2);
    expect(evidence.bbox?.[2]).toBeCloseTo(0.6); expect(evidence.bbox?.[3]).toBeCloseTo(0.3);
    expect(evidence.element).toBe("Область элемента не подтверждена");
  });
});
