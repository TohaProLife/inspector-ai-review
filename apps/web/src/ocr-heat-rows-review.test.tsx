import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OcrHeatRowsReview } from "./App";
import type { OcrHeatRowsRead } from "./api";

const data: OcrHeatRowsRead = {
  profileId: "conservative-ocr-heat-rows-v1",
  inputManifestHash: "a".repeat(64),
  findingCount: 0,
  proposalCount: 1,
  abstentionCount: 1,
  truncated: false,
  proposals: [{
    sourceFileId: "FILE-1",
    inputSha256: "b".repeat(64),
    pageNumber: 7,
    stage: "RD",
    component: "DHW",
    basis: "MAX_INCLUDING_CIRCULATION",
    values: { kW: "123.4", "Gcal/h": "0.106" },
    ocrPageContentHash: "c".repeat(64),
    renderSha256: "d".repeat(64),
    evidence: [{ role: "value", lineIndex: 13, text: "123,4 кВт <ошибка OCR>",
      bboxPx: [10, 20, 50, 40], score: 0.91 }],
  }],
  abstentions: [{
    sourceFileId: "FILE-2",
    inputSha256: "e".repeat(64),
    pageNumber: 8,
    lineIndex: 4,
    reasonCode: "PAIRED_UNITS_CONTRADICT",
    evidence: [{ role: "value", lineIndex: 4, text: "11 кВт (1 Гкал/ч)",
      bboxPx: [2, 3, 15, 12], score: 0.83 }],
  }],
};

describe("OCR heat row review aid", () => {
  it("keeps proposed values and abstentions distinct from facts and links original pages", () => {
    const html = renderToStaticMarkup(createElement(OcrHeatRowsReview, {
      data, objectId: "OBJ-1", onSources: () => undefined,
    }));

    expect(html).toContain("Непроверенные подсказки OCR");
    expect(html).toContain("не создают проверенные факты");
    expect(html).toContain("ГВС · Максимальный расход с учётом циркуляции");
    expect(html).toContain("123,4 кВт · 0,106 Гкал/ч");
    expect(html).toContain("123,4 кВт &lt;ошибка OCR&gt;");
    expect(html).toContain("Пара кВт и Гкал/ч противоречит пересчёту: 1");
    expect(html).toContain("источник FILE-2 · страница PDF 8 · строка 5");
    expect(html).toContain("/api/objects/OBJ-1/files/FILE-1/pages/7/preview");
    expect(html).toContain("Сверить OCR с источником");
  });

  it("states when response lists are truncated", () => {
    const html = renderToStaticMarkup(createElement(OcrHeatRowsReview, {
      data: { ...data, proposalCount: 12, abstentionCount: 20, truncated: true },
      objectId: "OBJ-1",
    }));

    expect(html).toContain("Список сокращён");
    expect(html).toContain("Причины перечислены только для показанных строк");
    expect(html).toContain("Всего: предложения — 12, воздержания — 20. В списке: предложения — 1, воздержания — 1.");
  });
});
