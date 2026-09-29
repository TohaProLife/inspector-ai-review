import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OcrTableRowsReview } from "./OcrTableRowsReview";
import type { OcrTableRowsRead } from "./api";

const hash = (character: string) => character.repeat(64);
const data: OcrTableRowsRead = {
  profileId: "conservative-ocr-table-rows-v1", inputManifestHash: hash("a"),
  proposals: [{
    sourceFileId: "F0150", inputSha256: hash("b"), pageNumber: 26,
    ocrPageContentHash: hash("c"), renderSha256: hash("d"),
    headerEvidence: [
      { role: "labelHeader", lineIndex: 0, text: "Наименование", bboxPx: [10, 20, 100, 40], score: 0.99 },
      { role: "valueHeader", lineIndex: 1, text: "Значение", bboxPx: [200, 20, 300, 40], score: 0.98 },
    ],
    labelEvidence: { role: "rowLabel", lineIndex: 2, text: "Общая площадь", bboxPx: [10, 60, 100, 80], score: 0.94 },
    valueEvidence: { role: "rawValue", lineIndex: 3, text: "11 618,27 м²", bboxPx: [200, 60, 300, 80], score: 0.93 },
  }],
  abstentions: [{ sourceFileId: "F0150", inputSha256: hash("b"), pageNumber: 27,
    lineIndex: null, reasonCode: "TWO_COLUMN_HEADER_UNRESOLVED" }],
  findingCount: 0, proposalCount: 1, abstentionCount: 1, truncated: true,
};

describe("OCR table rows review", () => {
  it("shows joined v3 label and both original OCR lines with geometry and scores", () => {
    const proposal = structuredClone(data.proposals[0]);
    proposal.labelContinuationEvidence = [{ role: "rowLabelContinuation", lineIndex: 4,
      text: "здания", bboxPx: [12, 80, 90, 100], score: 0.88 }];
    const html = renderToStaticMarkup(createElement(OcrTableRowsReview, {
      data: { ...data, profileId: "conservative-ocr-table-rows-v3", proposals: [proposal],
        abstentions: [{ ...data.abstentions[0], reasonCode: "ROW_LABEL_CONTINUATION_AMBIGUOUS" }] },
      objectId: "OBJ-1",
    }));
    expect(html).toContain("OCR прочитал: «Общая площадь здания»");
    expect(html).toContain("Подпись собрана из двух отдельных OCR-строк");
    expect(html).toContain("Подпись строки · OCR-строка 3");
    expect(html).toContain("Продолжение подписи строки · OCR-строка 5");
    expect(html).toContain("Оценка OCR 0.880 · рамка [12, 80, 90, 100] px");
    expect(html).toContain("Продолжение подписи нельзя однозначно связать со строкой");
  });

  it("shows only raw OCR, page provenance, abstention and truncation", () => {
    const html = renderToStaticMarkup(createElement(OcrTableRowsReview, { data, objectId: "OBJ-1" }));
    expect(html).toContain("Только для ручной проверки");
    expect(html).toContain("не становятся нормализованными фактами или находками");
    expect(html).toContain("Предложений: 1. Воздержаний: 1");
    expect(html).toContain("Список сокращён");
    expect(html).toContain("OCR прочитал: «Общая площадь» · «11 618,27 м²»");
    expect(html).toContain("Оценка OCR 0.930 · рамка [200, 60, 300, 80] px");
    expect(html).toContain("Источник SHA-256");
    expect(html).toContain("OCR-страница SHA-256");
    expect(html).toContain("Рендер SHA-256");
    expect(html).toContain("Два столбца не распознаны однозначно");
    expect(html).toContain("/api/objects/OBJ-1/files/F0150/pages/26/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0150/pages/27/preview");
    expect(html).not.toContain("PZ-002");
  });

  it("does not equate empty OCR list with absent table data", () => {
    const html = renderToStaticMarkup(createElement(OcrTableRowsReview, {
      data: { ...data, proposals: [], abstentions: [], proposalCount: 0, abstentionCount: 0, truncated: false },
      objectId: "OBJ-1",
    }));
    expect(html).toContain("Предложений нет. Это не подтверждает отсутствие табличных данных.");
    expect(html).toContain("Воздержаний в сохранённом результате нет.");
  });
});
