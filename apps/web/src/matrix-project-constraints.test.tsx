import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MatrixProjectConstraint, MatrixProjectConstraints as ConstraintsArtifact } from "@inspector-ai/contracts";
import { MatrixProjectConstraints, projectConstraintEvidence } from "./MatrixProjectConstraints";

const fact: MatrixProjectConstraint = {
  schemaVersion: "matrix-project-constraint-v1", id: "1".repeat(64), kind: "PROJECT_AUTHORED_CONSTRAINT",
  relation: "GE", attribute: "DOOR_CLEAR_OPENING_WIDTH", limitValue: "0.9", canonicalUnit: "m",
  sourceFileId: "FIL-PROJECT-BOUND", sourceSha256: "a".repeat(64), textArtifactHash: "b".repeat(64),
  stage: "PD", pageNumber: 22, widthMilliPoints: 600000, heightMilliPoints: 800000,
  extractorVersion: "matrix-project-bound-prose-v1", entityKey: null, applicabilityStatus: "UNREVIEWED",
  componentClass: "ACCESSIBLE_ROUTE_DOOR_OPENING", measurementBasis: "CLEAR_OPENING_WITH_LEAF_OPEN",
  fragments: [{ blockIndex: 3, lineIndex: 0, rawText: "открытом дверном полотне. Следующее условие.",
    bboxMilliPoints: [60000, 640000, 540000, 656000], usedTextRange: { start: 0, end: 25 } }],
};
const artifact: ConstraintsArtifact = { schemaVersion: "matrix-project-constraints-v1", objectId: "OBJ-BOUND",
  inputManifestHash: "c".repeat(64), extractorVersion: "matrix-project-bound-prose-v1", purpose: "EVIDENCE_ONLY", constraints: [fact] };

describe("separate project constraints", () => {
  it("shows the minimum, open-leaf basis, unresolved applicability and intact unused tail", () => {
    const html = renderToStaticMarkup(createElement(MatrixProjectConstraints, { artifact, objectId: artifact.objectId, files: [], query: "" }));
    expect(html).toContain("не менее 0.9 м");
    expect(html).toContain("При открытом дверном полотне");
    expect(html).toContain("Кандидат проектного ограничения");
    expect(html).toContain("Применимость к конкретному элементу не проверена");
    expect(html).toContain("<mark>открытом дверном полотне.</mark> Следующее условие.");
    expect(html).toContain("Открыть условие · PDF 22 · фрагмент 1");
    expect(html).not.toMatch(/Машинное предупреждение|80%|Нет отклонения|подтверждённая ошибка/);
  });
  it("derives the original line locator without claiming an exact measured width", () => {
    const evidence = projectConstraintEvidence(fact, 0);
    expect(evidence).toMatchObject({ sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
      pageNumber: 22, stage: "PD", unit: "", value: "открытом дверном полотне.", revision: null,
      element: "Применимость проектного условия к проёму не проверена" });
    const expected = [.1, .18, .9, .2];
    evidence.bbox!.forEach((value, i) => expect(value).toBeCloseTo(expected[i]));
    const astral = structuredClone(fact);
    astral.fragments[0].rawText = "😀 строка";
    astral.fragments[0].usedTextRange = { start: 0, end: 1 };
    expect(projectConstraintEvidence(astral, 0).value).toBe("😀");
  });
  it("keeps historical runs without a constraint artifact unchanged and filters new evidence", () => {
    expect(renderToStaticMarkup(createElement(MatrixProjectConstraints, { objectId: artifact.objectId, files: [], query: "" }))).toBe("");
    const html = renderToStaticMarkup(createElement(MatrixProjectConstraints, { artifact, objectId: artifact.objectId, files: [], query: "не найдено" }));
    expect(html).toContain("Проектных ограничений: 0 / 1");
    expect(html).not.toContain("Открыть условие");
    expect(html).toContain("Полнота поиска по документам не подтверждена");
  });
});
