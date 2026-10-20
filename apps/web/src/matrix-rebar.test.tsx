import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOT_ESTIMABLE_MACHINE_CONFIDENCE, classifyMachineConfidence,
  type MatrixObservation, type MatrixExecutionRead, type MatrixFactScopeTarget } from "@inspector-ai/contracts";
import { MatrixFactScopeEditor, emptyMatrixFactScopeDraft, prepareMatrixFactScope, changeMatrixFactScopeEntity } from "./MatrixFactScopeEditor";
import { MatrixFactContext, MatrixRuleCandidates, matrixFactEvidence, matrixDisplayUnit } from "./MatrixExecutionPanel";
import { prepareMatrixFactScopeReviewInput } from "./MatrixFactScopeReview";
const h = (c: string) => c.repeat(64), rule = "matrix-kr-057-catalog_a500c_to_a400";
const fact: MatrixObservation = { id: h("1"), sourceFileId: "RD", sourceSha256: h("a"), stage: "RD", pageNumber: 4,
  blockId: "45:0", bbox: { x: .1, y: .3, width: .5, height: .02 },
  rawText: "Арматура всех конструкций класса А400 по ГОСТ 34028-2016.", rawValue: "А400", rawUnit: null,
  attribute: "WORKING_REINFORCEMENT_CLASS", value: "А400", unit: "rebar_catalog_example", entityKey: null,
  method: "TEXT_LAYER", extractorVersion: "matrix-text-facts-v1", parameterCodes: ["KR-057"],
  contextFragments: [{ pageNumber: 4, blockId: "1:3", rawText: "Внутренние монолитные лестницы подземной части",
    bbox: { x: .05, y: .05, width: .6, height: .02 }, role: "MATERIAL_SCOPE" }] };
const target: MatrixFactScopeTarget = { checkId: "CHK", executionContentHash: h("b"), observationId: fact.id,
  evidenceHash: h("c"), textArtifactHash: h("d") };
const reference = "Проверена исходная позиция рабочей арматуры лестницы";
function draft() {
  const d = emptyMatrixFactScopeDraft(rule);
  return { ...d, entityKey: "stair-member", reference, identityReviewed: true,
    identity: { componentKey: "stair-member", zoneKey: "underground-stair-1",
      operatingModeKey: "WORKING_NOT_CONSTRUCTIVE_ASSEMBLY_OR_EMBEDDED", measurementBasisKey: "DECLARED_REINFORCEMENT_CLASS" },
    contexts: Object.fromEntries(["APPROVED_CHANGE_STATUS", "REINFORCEMENT_APPLICATION_SCOPE", `ATOMIC_SUBRULE_SCOPE:${rule}`]
      .map(key => [key, { reviewed: true, reference, ...(key === "APPROVED_CHANGE_STATUS" ? { approvedChangeStatus: "ABSENT" as const } : {}) }])) };
}
describe("working reinforcement catalog example review", () => {
  it("requires a reviewed member, working function and categorical basis", () => {
    expect(prepareMatrixFactScope({ fact, target, draft: draft() }).error).toBeNull();
    for (const change of [{ operatingModeKey: "ASSEMBLY" }, { measurementBasisKey: "NUMERIC_GRADE_RANK" }, { componentKey: "" }, { zoneKey: "" }]) {
      const d = draft(); expect(prepareMatrixFactScope({ fact, target, draft: { ...d, identity: { ...d.identity, ...change } } }).scope).toBeNull();
    }
    const d = draft(); d.contexts.REINFORCEMENT_APPLICATION_SCOPE.reviewed = false;
    const partial = prepareMatrixFactScope({ fact, target, draft: d }).scope!;
    expect(partial.bindings[0].contexts).not.toHaveProperty("REINFORCEMENT_APPLICATION_SCOPE");
    expect(partial.bindings[0].contexts).toHaveProperty("APPROVED_CHANGE_STATUS");
  });
  it("clears confirmation after identity changes and keeps source UNKNOWN on save", () => {
    const d = draft(), changed = changeMatrixFactScopeEntity(d, "other-member");
    expect(changed.identityReviewed).toBe(false);
    expect(Object.values(changed.contexts).every(c => !c.reviewed)).toBe(true);
    const scope = prepareMatrixFactScope({ fact, target, draft: d }).scope!;
    expect(prepareMatrixFactScopeReviewInput({ objectId: "OBJ", fact, prior: null, scope, basisReference: reference,
      canReview: true, replaceLegacyConfirmed: false })).toMatchObject({ revisionStatus: "UNKNOWN", approvalStatus: "UNKNOWN", matrixScope: scope });
  });
  it("shows explicit scope and function without a preselected approval or table claim", () => {
    const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { fact, target, onChange: () => {} }));
    for (const text of ["Функция арматуры", "Позиция или группа рабочей арматуры", "Форшахта", "только явно указанный в каталоге переход А500С в А400"])
      expect(html).toContain(text);
    expect(html).not.toContain('checked=""'); expect(html).not.toContain("Связь строки с контекстом таблицы");
    const d = { ...draft(), tableContextReviewed: true, tableContextReference: reference };
    expect(prepareMatrixFactScope({ fact, target, fragmentsHash: h("e"), draft: d }).scope).toBeNull();
  });
  it("opens exact material context separately and displays a categorical unit", () => {
    const html = renderToStaticMarkup(createElement(MatrixFactContext, { fact, onSelect: () => {} }));
    expect(html).toContain("Область применения арматуры"); expect(html).not.toContain("Область таблицы");
    const primary = matrixFactEvidence(fact), context = matrixFactEvidence(fact, fact.contextFragments![0]);
    expect(context.value).toBe(fact.contextFragments![0].rawText); expect(context.bbox).not.toEqual(primary.bbox);
    expect(context.element).toBe("Применимость класса арматуры из исходного листа");
    expect(primary.unit).toBe("(класс)"); expect(matrixDisplayUnit("m")).toBe("m");
  });
  it("renders one uncalibrated candidate without a fabricated arithmetic delta", () => {
    const pd = { ...fact, id: h("2"), stage: "PD" as const, value: "А500С" };
    const data: MatrixExecutionRead = { checkId: "CHK", contentHash: h("e"), submission: null,
      execution: { schemaVersion: "matrix-execution-v1", objectId: "OBJ", inputManifestHash: h("f"), registryHash: h("0"),
        observations: [pd, fact], metadata: [], coverage: [], results: [{ ruleId: rule, ruleVersion: "1", parameterCode: "KR-057",
          entityKey: "stair-member", comparisonVariant: "PD_RD", executionStatus: "SUCCEEDED", machineStatus: "CANDIDATE",
          reasonCode: "CATALOG_TRIGGER_MATCHED", expectedObservationId: pd.id, actualObservationId: fact.id,
          expectedValue: pd.value, actualValue: fact.value, delta: null, qualified: true }] },
      presentation: [{ resultIndex: 0, ...classifyMachineConfidence({ evidenceQualified: true,
        confidence: NOT_ESTIMABLE_MACHINE_CONFIDENCE, expectedCalibrationVersion: "none" }) }] };
    const html = renderToStaticMarkup(createElement(MatrixRuleCandidates, { data, onSelect: () => {} }));
    expect(html).toContain("KR-057 · Кандидат"); expect(html).toContain("А500С (класс)"); expect(html).toContain("А400 (класс)");
    expect(html).toContain("Уверенность не измерена"); expect(html).not.toContain("Отклонение:");
    expect(html).not.toContain("Машинное предупреждение"); expect(html).not.toContain("rebar_catalog_example");
  });
});
