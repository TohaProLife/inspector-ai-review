import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactFamilyReview } from "./App";
import type { PilotResultsRead } from "./api";

const codes = ["PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"];

const data: NonNullable<PilotResultsRead["factFamily"]> = {
  schemaVersion: "fact-family-proposals-v1",
  inputManifestHash: "a".repeat(64),
  objectId: "OBJ-1",
  facts: [{
    schemaVersion: "typed-fact-v1",
    factId: "b".repeat(64),
    parameterCode: "KR-058",
    stage: "RD",
    sourceFileId: "FILE-1",
    sourceSha256: "c".repeat(64),
    pageNumber: 7,
    rawValue: "180",
    rawUnit: "мм",
  }],
  comparisons: codes.map((parameterCode) => ({
    schemaVersion: "fact-comparison-result-v1",
    parameterCode,
    status: "ABSTAIN",
    reasonCodes: [parameterCode === "KR-058" ? "ENTITY_LINK_MISSING" : "REQUIRED_FACT_MISSING"],
  })),
  outputCount: 6,
  findingCount: 0,
  contentHash: "d".repeat(64),
};

describe("fact family review panel", () => {
  it("renders all five comparison statuses, reasons, and source-linked proposals without finding claims", () => {
    const html = renderToStaticMarkup(createElement(FactFamilyReview, { data, objectId: "OBJ-1" }));

    for (const code of codes) expect(html).toContain(code);
    expect(html.match(/Сравнение остановлено/g)).toHaveLength(5);
    expect(html).toContain("Соответствие элементов ПД и РД не подтверждено");
    expect(html).toContain("Предложений по фактам: 1. Статусов сравнения: 5. Находок: 0.");
    expect(html).toContain("180 мм");
    expect(html).toContain("Источник FILE-1 · страница PDF 7");
    expect(html).toContain("/api/objects/OBJ-1/files/FILE-1/pages/7/preview");
    expect(html).toContain("не создают находки, нарушения");
  });
});
