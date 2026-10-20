import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatrixSourceDeclarations as Artifact, MatrixSteelSourceDeclaration, SourceFileSummary } from "@inspector-ai/contracts";
import { MatrixSourceDeclarations, sourceDeclarationEvidence, sourceDeclarationMatchesQuery, sourceDeclarationScopeLabel, sourceDeclarationViewerKey } from "./MatrixSourceDeclarations";

const golden = JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/research-parser-golden.json", import.meta.url), "utf8"));
const declarations: MatrixSteelSourceDeclaration[] = ["F0105", "F0145"].map((sid, i) => {
  const vector = golden.cases.find((c: any) => c.name === `original-${sid}`);
  const page = golden.sources.find((s: any) => s.sourceFileId === sid).page;
  return { schemaVersion: "matrix-source-declaration-v1", kind: "SOURCE_AUTHORED_STEEL_DECLARATION", id: String(i + 1).repeat(64),
    extractorVersion: "matrix-steel-prose-v1", sourceFileId: sid, sourceSha256: (i ? "b" : "a").repeat(64), textArtifactHash: "c".repeat(64),
    stage: vector.stage, pageNumber: page.pageNumber, widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints,
    entityKey: null, applicabilityStatus: "UNREVIEWED", ...structuredClone(vector.expected[0]) };
});
const artifact: Artifact = { schemaVersion: "matrix-source-declarations-v1", extractorVersion: "matrix-source-declarations-v1",
  objectId: "OBJ-STEEL", inputManifestHash: "d".repeat(64), purpose: "EVIDENCE_ONLY", declarations };
const files: SourceFileSummary[] = declarations.map((fact, i) => ({ id: fact.sourceFileId, sha256: fact.sourceSha256, name: i ? "РД материалы.pdf" : "ПД пояс.pdf",
  size: 1000, stages: [fact.stage], pageCount: i ? 14 : 29, registeredAt: "2026-10-18T00:00:00Z", review: null }));
const render = (query = "", current: Artifact | undefined = artifact) => renderToStaticMarkup(createElement(MatrixSourceDeclarations,
  { artifact: current, objectId: "OBJ-STEEL", files, query, sections: { F0105: "KR", F0145: "OTHER" } }));

describe("source material declarations stay evidence-only", () => {
  it("keeps different product scopes, raw glyphs, real section and all neighboring clauses visible", () => {
    const html = render();
    for (const text of ["Класс стали: C245", "запись класса С245", "3 двутавра 70Б3, ярус 2", "профиль, количество и ярус в декларации не указаны",
      "РД · Раздел: OTHER · PDF 4", "Деклараций материалов: 2 / 2", "Принадлежность одному элементу и применимость не проверены",
      "Число деклараций не увеличивает машинное покрытие", "Ст20", "А500С", "ГОСТ 27772-2015", "ГОСТ 27772-2021"]) expect(html).toContain(text);
    for (const fact of declarations) for (const part of [...fact.primaryFragments, ...fact.scopeFragments]) {
      expect(html).toContain(part.rawText.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
    }
    expect(html).not.toMatch(/Машинное предупреждение|80%|Нет отклонения|NEGATIVE_VERIFIED|Подтвердить|Сохранить|Привязать|одинаковый элемент/i);
    expect((html.match(/<button/g) ?? []).length).toBe(9);
  });
  it("searches Latin and Cyrillic grade aliases, exact scope, original neighbors and source metadata", () => {
    for (const query of ["C245", "С245"]) expect(render(query)).toContain("Деклараций материалов: 2 / 2");
    for (const query of ["70Б3", "ярус 2", "ПД пояс.pdf", "KR"]) {
      const html = render(query); expect(html).toContain("Деклараций материалов: 1 / 2"); expect(html).not.toContain("Раздел: OTHER");
    }
    for (const query of ["Ст20", "А500С", "OTHER", "ГОСТ Р 57837-2017", "РД материалы.pdf"]) {
      const html = render(query); expect(html).toContain("Деклараций материалов: 1 / 2"); expect(html).not.toContain("ярус 2");
    }
    expect(sourceDeclarationMatchesQuery(declarations[0], " С345 ", files)).toBe(false);
  });
  it("distinguishes no extracted declarations from complete material inventory", () => {
    for (const html of [render("нет такого материала"), render("", { ...artifact, declarations: [] })]) {
      expect(html).toContain("Полнота поиска материалов по документам не подтверждена");
      expect(html).not.toContain("<button");
    }
    expect(renderToStaticMarkup(createElement(MatrixSourceDeclarations, { objectId: "OLD", files, query: "" }))).toBe("");
  });
  for (const fact of declarations) for (const kind of ["primary", "scope"] as const) {
    it(`${fact.sourceFileId} ${kind} uses each original PDF frame, full raw line and no fabricated member`, () => {
      const fragments = kind === "primary" ? fact.primaryFragments : fact.scopeFragments;
      for (const [index, fragment] of fragments.entries()) {
        const evidence = sourceDeclarationEvidence(fact, kind, index);
        expect(evidence).toMatchObject({ sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256, stage: fact.stage,
          pageNumber: fragment.pageNumber, value: fragment.rawText, unit: "", sheet: null, revision: null,
          element: "Принадлежность одному элементу и применимость не проверены" });
        const b = fragment.bboxMilliPoints, w = fact.widthMilliPoints, h = fact.heightMilliPoints;
        expect(evidence.bbox).toEqual([b[0] / w, 1 - b[3] / h, b[2] / w, 1 - b[1] / h]);
      }
      expect(() => sourceDeclarationEvidence(fact, kind, fragments.length)).toThrow(RangeError);
    });
  }
  it("invalidates viewer identity across source, page, fragment, artifact and object changes", () => {
    const original = sourceDeclarationViewerKey("OBJ", declarations[0], "primary", 0);
    for (const next of [sourceDeclarationViewerKey("OBJ", declarations[1], "primary", 0),
      sourceDeclarationViewerKey("NEW", declarations[0], "primary", 0),
      sourceDeclarationViewerKey("OBJ", { ...declarations[0], pageNumber: 15 }, "primary", 0),
      sourceDeclarationViewerKey("OBJ", { ...declarations[0], id: "e".repeat(64) }, "primary", 0),
      sourceDeclarationViewerKey("OBJ", declarations[0], "scope", 0),
      sourceDeclarationViewerKey("OBJ", declarations[0], "primary", 1)]) expect(next).not.toBe(original);
    expect(sourceDeclarationScopeLabel(declarations[0])).not.toBe(sourceDeclarationScopeLabel(declarations[1]));
  });
});
