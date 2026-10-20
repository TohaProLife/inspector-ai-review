import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MatrixFactScope, MatrixFactScopeTarget, MatrixObservation } from "@inspector-ai/contracts";
import registry from "../../../services/worker/rules/matrix-execution-v1.json";
import { MatrixFactScopeEditor, changeMatrixFactScopeEntity, emptyMatrixFactScopeDraft,
  matrixFactScopeRules, matrixFactScopeContextLabel, prepareMatrixFactScope, removeMatrixFactScopeBinding } from "./MatrixFactScopeEditor";

const hash = (character: string) => character.repeat(64);
const reference = "Исходный лист и указанная позиция проверены";
const contextReference = "Условие проверено по оригиналу листа 2";

function fixture(attribute = "CONCRETE_CLASS") {
  const entry = registry.entries.find(item => item.atomicRules.some(rule => rule.enabled && rule.attribute === attribute))!;
  const rule = entry.atomicRules.find(item => item.enabled && item.attribute === attribute)!;
  const fact: MatrixObservation = { id: hash("1"), sourceFileId: "FIL-PD", sourceSha256: hash("a"), stage: "PD",
    pageNumber: 2, blockId: "1:0", bbox: { x: .1, y: .2, width: .3, height: .1 }, rawText: "Исходное значение: 100",
    attribute, value: "100", unit: rule.canonicalUnit, entityKey: null, method: "TEXT_LAYER",
    extractorVersion: "matrix-text-facts-v1", parameterCodes: [entry.parameterCode], sourceFlags: ["SOURCE_APPROVAL_UNKNOWN"] };
  const target: MatrixFactScopeTarget = { checkId: "CHK-ORIGIN", executionContentHash: hash("b"),
    observationId: fact.id, evidenceHash: hash("c"), textArtifactHash: hash("d") };
  const draft = { ...emptyMatrixFactScopeDraft(rule.ruleId), entityKey: "building/slab-1", reference, identityReviewed: true };
  return { fact, target, draft, rule };
}

function withContexts(value: ReturnType<typeof fixture>) {
  return { ...value.draft, contexts: Object.fromEntries(value.rule.requiredContext.map(key => [key,
    { reviewed: true, reference: contextReference }])) };
}

describe("per-fact scope draft preparation", () => {
  it("selects only enabled rules with matching attribute, canonical unit and declared parameter", () => {
    const { fact, rule } = fixture();
    expect(matrixFactScopeRules(fact).map(item => item.ruleId)).toContain(rule.ruleId);
    expect(matrixFactScopeRules({ ...fact, unit: "unrelated" })).toEqual([]);
    expect(matrixFactScopeRules({ ...fact, parameterCodes: [] })).toEqual([]);
    expect(matrixFactScopeRules({ ...fact, parameterCodes: ["UNKNOWN"] })).toEqual([]);
    expect(matrixFactScopeRules({ ...fact, method: "OCR" as "TEXT_LAYER" })).toEqual([]);
    expect(matrixFactScopeRules(fact).every(item => item.enabled)).toBe(true);
    for (const entry of registry.entries) for (const rule of entry.atomicRules.filter(item => item.enabled))
      for (const key of rule.requiredContext) expect(matrixFactScopeContextLabel(key), key).toBeTruthy();
  });

  it("requires explicit identity review and a matching trusted target; entity-only binding adds no proofs", () => {
    const value = fixture();
    const result = prepareMatrixFactScope(value);
    expect(result.error).toBeNull();
    expect(result.scope!.bindings[0]).toMatchObject({ ruleId: value.rule.ruleId, ruleVersion: value.rule.version,
      parameterCode: "KR-055", entityKey: value.draft.entityKey, target: value.target, contexts: {} });
    expect(result.scope!.bindings[0]).not.toHaveProperty("tableContextReview");
    for (const draft of [{ ...value.draft, identityReviewed: false }, { ...value.draft, reference: "short" },
      { ...value.draft, entityKey: " " }, { ...value.draft, ruleId: "unknown" }])
      expect(prepareMatrixFactScope({ ...value, draft }).scope).toBeNull();
    expect(prepareMatrixFactScope({ ...value, target: { ...value.target, observationId: hash("2") } }).scope).toBeNull();
    expect(prepareMatrixFactScope({ ...value, target: { ...value.target, evidenceHash: "invalid" } }).scope).toBeNull();
  });

  it("requires each checked condition's own reference; unchecked partial data creates no condition", () => {
    const value = fixture();
    const draft = withContexts(value);
    expect(Object.keys(prepareMatrixFactScope({ ...value, draft }).scope!.bindings[0].contexts))
      .toEqual(value.rule.requiredContext);
    const key = value.rule.requiredContext[0];
    draft.contexts[key] = { reviewed: true, reference: "short" };
    expect(prepareMatrixFactScope({ ...value, draft }).scope).toBeNull();
    draft.contexts[key] = { reviewed: false, reference: "short" };
    expect(prepareMatrixFactScope({ ...value, draft }).scope!.bindings[0].contexts[key]).toBeUndefined();
    expect(prepareMatrixFactScope({ ...value, draft: { ...draft, contexts: {
      ...draft.contexts, UNKNOWN_CONTEXT: { reviewed: true, reference: contextReference },
    } } }).scope).toBeNull();
    for (const key of ["RULE_SCOPE_COMPLETE:some-rule", "PARAMETER_SCOPE_COMPLETE:KR-055"])
      expect(prepareMatrixFactScope({ ...value, draft: { ...value.draft,
        contexts: { [key]: { reviewed: true, reference: contextReference } } } }).scope).toBeNull();
  });

  it("derives normative policy from registry and never asserts applicability without a separate check", () => {
    const value = fixture("FIRE_ACCESS_ROAD_WIDTH"), key = "NORM_APPLICABILITY_VERIFIED";
    const draft = { ...value.draft, contexts: { [key]: { reviewed: true, reference: contextReference, applicable: false } } };
    expect(prepareMatrixFactScope({ ...value, draft }).scope).toBeNull();
    draft.contexts[key].applicable = true;
    Object.assign(draft.contexts[key], { threshold: "0", parameterCode: "OTHER", canonicalUnit: "wrong" });
    expect(prepareMatrixFactScope({ ...value, draft }).scope!.bindings[0].contexts[key]).toEqual({
      reference: contextReference, applicable: true, parameterCode: "SPZU-030", attribute: value.fact.attribute,
      threshold: value.rule.threshold!.value, canonicalUnit: value.rule.canonicalUnit,
    });
  });

  it("requires all four checked subrule identities and takes component role only from registry", () => {
    const value = fixture("PUMP_FLOW_RATE"), key = value.rule.requiredContext[0];
    const draft = { ...withContexts(value), identity: { componentKey: "pump-P1" } };
    expect(prepareMatrixFactScope({ ...value, draft }).scope).toBeNull();
    Object.assign(draft.identity, { zoneKey: "zone-A", operatingModeKey: "design-point-1", measurementBasisKey: "working-point-1" });
    const context = prepareMatrixFactScope({ ...value, draft }).scope!.bindings[0].contexts[key];
    expect(context).toMatchObject({ ...draft.identity, componentRole: "POTABLE_WATER_PUMP", parameterCode: "IOS2-073",
      attribute: "PUMP_FLOW_RATE", canonicalUnit: "m3/h" });
    expect(context).not.toHaveProperty("status");
    expect(context).not.toHaveProperty("inputManifestHash");
  });

  it("requires explicit TU limit, approval status and thermal reduction details", () => {
    const limit = fixture("DESIGN_ELECTRIC_POWER"), key = "TECHNICAL_CONDITIONS_LIMIT";
    for (const limitValue of ["", "-5", "1e3", "text"])
      expect(prepareMatrixFactScope({ ...limit, draft: { ...limit.draft, contexts: { [key]: {
        reviewed: true, reference: contextReference, limitValue,
      } } } }).scope).toBeNull();
    expect(prepareMatrixFactScope({ ...limit, draft: { ...limit.draft, contexts: { [key]: {
      reviewed: true, reference: contextReference, limitValue: "1000,50",
    } } } }).scope!.bindings[0].contexts[key]).toEqual({ reference: contextReference, limitValue: "1000.50", canonicalUnit: "kW" });
    const approval = fixture("BUILDING_VOLUME");
    for (const approvedChangeStatus of ["ABSENT", "PRESENT"] as const)
      expect(prepareMatrixFactScope({ ...approval, draft: { ...approval.draft, contexts: { APPROVED_CHANGE_STATUS: {
        reviewed: true, reference: contextReference, approvedChangeStatus,
      } } } }).scope!.bindings[0].contexts.APPROVED_CHANGE_STATUS.approvedChangePresent).toBe(approvedChangeStatus === "PRESENT");
    expect(prepareMatrixFactScope({ ...approval, draft: { ...approval.draft, contexts: { APPROVED_CHANGE_STATUS: {
      reviewed: true, reference: contextReference,
    } } } }).scope).toBeNull();
    const thermal = fixture("WALL_INSULATION_THICKNESS");
    expect(prepareMatrixFactScope({ ...thermal, draft: { ...thermal.draft, contexts: { THERMAL_RESISTANCE_REDUCTION_VERIFIED: {
      reviewed: true, reference: contextReference,
    } } } }).scope).toBeNull();
  });

  it("keeps tile-area approval separate from the surface, zone and ground-roof identity", () => {
    const value=fixture("SIDEWALK_TILE_AREA"), atomic=`ATOMIC_SUBRULE_SCOPE:${value.rule.ruleId}`;
    const draft={...withContexts(value),identity:{componentKey:"tile-type-3",zoneKey:"yard-A",
      operatingModeKey:"ground",measurementBasisKey:"net-paving-area"}};
    expect(prepareMatrixFactScope({...value,draft}).scope).toBeNull();
    Object.assign(draft.contexts.APPROVED_CHANGE_STATUS,{approvedChangeStatus:"ABSENT"});
    const result=prepareMatrixFactScope({...value,draft});expect(result.error).toBeNull();
    const contexts=result.scope!.bindings[0].contexts;
    expect(contexts.APPROVED_CHANGE_STATUS).toEqual({reference:contextReference,approvedChangePresent:false});
    expect(contexts.SURFACE_TYPE_IDENTITY).toEqual({reference:contextReference});
    expect(contexts.ZONE_IDENTITY).toEqual({reference:contextReference});
    expect(contexts[atomic]).toMatchObject({...draft.identity,componentRole:"SIDEWALK_TILE_PAVING",
      attribute:"SIDEWALK_TILE_AREA",canonicalUnit:"m2",parameterCode:"SPZU-026"});
    const changed=changeMatrixFactScopeEntity(draft,"another-yard");
    expect(changed.identity).toEqual({});expect(Object.values(changed.contexts).every(c=>!c.reviewed)).toBe(true);
  });

  it.each([
    ["EVACUATION_CORRIDOR_CLEAR_HEIGHT", "EVACUATION_CORRIDOR_CLEARANCE", "CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION", "2"],
    ["EVACUATION_DOOR_CLEAR_HEIGHT", "EVACUATION_DOOR_CLEARANCE", "CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD", "1.9"],
  ])("requires explicit evacuation purpose, clear-height basis and independent norm for %s", (attribute, role, basis, threshold) => {
    const value = fixture(attribute), atomic = `ATOMIC_SUBRULE_SCOPE:${value.rule.ruleId}`;
    const draft = { ...withContexts(value), identity: { componentKey: "route-component-1", zoneKey: "floor-1-route-A",
      operatingModeKey: "EVACUATION", measurementBasisKey: basis } };
    expect(prepareMatrixFactScope({ ...value, draft }).scope).toBeNull();
    Object.assign(draft.contexts.NORM_APPLICABILITY_VERIFIED, { applicable: true });
    const prepared = prepareMatrixFactScope({ ...value, draft });
    expect(prepared.error).toBeNull();
    expect(prepared.scope!.bindings[0].contexts[atomic]).toMatchObject({ ...draft.identity,
      componentRole: role, parameterCode: "AR-042", attribute, canonicalUnit: "m" });
    expect(prepared.scope!.bindings[0].contexts.NORM_APPLICABILITY_VERIFIED).toEqual({
      reference: contextReference, applicable: true, parameterCode: "AR-042", attribute, threshold, canonicalUnit: "m" });
    for (const identity of [{ ...draft.identity, operatingModeKey: "ORDINARY_ROOM" },
      { ...draft.identity, operatingModeKey: "" }, { ...draft.identity, measurementBasisKey: "NOMINAL_OPENING" },
      { ...draft.identity, measurementBasisKey: "" }])
      expect(prepareMatrixFactScope({ ...value, draft: { ...draft, identity } }).scope).toBeNull();
    const noNorm = { ...draft, contexts: { ...draft.contexts,
      NORM_APPLICABILITY_VERIFIED: { ...draft.contexts.NORM_APPLICABILITY_VERIFIED, reviewed: false } } };
    expect(prepareMatrixFactScope({ ...value, draft: noNorm }).scope!.bindings[0].contexts)
      .not.toHaveProperty("NORM_APPLICABILITY_VERIFIED");
    const changed = changeMatrixFactScopeEntity(draft, "route-component-2");
    expect(changed.identity).toEqual({});
    expect(Object.values(changed.contexts).every(c => !c.reviewed)).toBe(true);
  });

  it("requires explicit territory boundary, ground-to-top basis and separate fence type review", () => {
    const value = fixture("TERRITORY_FENCE_HEIGHT"), atomic = `ATOMIC_SUBRULE_SCOPE:${value.rule.ruleId}`;
    const draft = { ...withContexts(value), identity: { componentKey: "boundary-segment-A", zoneKey: "site-A",
      operatingModeKey: "TERRITORY_BOUNDARY", measurementBasisKey: "FINISHED_GROUND_TO_FENCE_TOP" } };
    Object.assign(draft.contexts.APPROVED_CHANGE_STATUS, { approvedChangeStatus: "ABSENT" });
    const prepared = prepareMatrixFactScope({ ...value, draft });
    expect(prepared.error).toBeNull();
    expect(prepared.scope!.bindings[0].contexts[atomic]).toMatchObject({ ...draft.identity,
      componentRole: "TERRITORY_FENCE_SEGMENT", parameterCode: "SPZU-036", attribute: "TERRITORY_FENCE_HEIGHT", canonicalUnit: "m" });
    expect(prepared.scope!.bindings[0].contexts.FENCE_TYPE_IDENTITY).toEqual({ reference: contextReference });
    expect(prepared.scope!.bindings[0].contexts.APPROVED_CHANGE_STATUS.approvedChangePresent).toBe(false);
    for (const identity of [{ ...draft.identity, operatingModeKey: "ROOF_EDGE" },
      { ...draft.identity, measurementBasisKey: "PANEL_HEIGHT" }, { ...draft.identity, operatingModeKey: "" }])
      expect(prepareMatrixFactScope({ ...value, draft: { ...draft, identity } }).scope).toBeNull();
    const missingType = { ...draft, contexts: { ...draft.contexts,
      FENCE_TYPE_IDENTITY: { ...draft.contexts.FENCE_TYPE_IDENTITY, reviewed: false } } };
    expect(prepareMatrixFactScope({ ...value, draft: missingType }).scope!.bindings[0].contexts).not.toHaveProperty("FENCE_TYPE_IDENTITY");
    const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { ...value, onChange: () => {} }));
    expect(html).toContain('aria-label="Назначение ограждения"');
    expect(html).toContain('aria-label="База измерения ограждения"');
    expect(html.match(/<option value="" selected="">Не установлено<\/option>/gu)).toHaveLength(3);
    expect(html).toContain("Тип и функция ограждения территории");
    expect(html).toContain("От поверхности готового грунта до верха ограждения");
    expect(html).not.toContain('checked=""');
  });

  it.each([
    ["STAIR_TREAD_DEPTH", "STAIR_TREAD", "FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH", "300"],
    ["STAIR_RISER_HEIGHT", "STAIR_RISER", "FINISHED_VERTICAL_RISER_HEIGHT", "150"],
  ])("requires explicit evacuation purpose, finished-step basis and independent norm for %s", (attribute, role, basis, threshold) => {
    const value = fixture(attribute), atomic = `ATOMIC_SUBRULE_SCOPE:${value.rule.ruleId}`;
    const draft = { ...withContexts(value), identity: { componentKey: "route-component-1", zoneKey: "floor-1-route-A",
      operatingModeKey: "EVACUATION", measurementBasisKey: basis } };
    expect(prepareMatrixFactScope({ ...value, draft }).scope).toBeNull();
    Object.assign(draft.contexts.NORM_APPLICABILITY_VERIFIED, { applicable: true });
    const prepared = prepareMatrixFactScope({ ...value, draft });
    expect(prepared.error).toBeNull();
    expect(prepared.scope!.bindings[0].contexts[atomic]).toMatchObject({ ...draft.identity,
      componentRole: role, parameterCode: "AR-048", attribute, canonicalUnit: "mm" });
    expect(prepared.scope!.bindings[0].contexts.NORM_APPLICABILITY_VERIFIED).toEqual({
      reference: contextReference, applicable: true, parameterCode: "AR-048", attribute, threshold, canonicalUnit: "mm" });
    for (const identity of [{ ...draft.identity, operatingModeKey: "ORDINARY_ROOM" },
      { ...draft.identity, operatingModeKey: "" }, { ...draft.identity, measurementBasisKey: "NOMINAL_OPENING" },
      { ...draft.identity, measurementBasisKey: "" }])
      expect(prepareMatrixFactScope({ ...value, draft: { ...draft, identity } }).scope).toBeNull();
    const noNorm = { ...draft, contexts: { ...draft.contexts,
      NORM_APPLICABILITY_VERIFIED: { ...draft.contexts.NORM_APPLICABILITY_VERIFIED, reviewed: false } } };
    expect(prepareMatrixFactScope({ ...value, draft: noNorm }).scope!.bindings[0].contexts)
      .not.toHaveProperty("NORM_APPLICABILITY_VERIFIED");
    const changed = changeMatrixFactScopeEntity(draft, "route-component-2");
    expect(changed.identity).toEqual({});
    expect(Object.values(changed.contexts).every(c => !c.reviewed)).toBe(true);
  });

  it("binds table review only to explicit checked fragments and a separate human reference", () => {
    const value = fixture();
    value.fact.contextFragments = [{ pageNumber: 1, blockId: "0:0", bbox: value.fact.bbox,
      rawText: "Класс бетона по прочности", role: "ATTRIBUTE_HEADER" }];
    const draft = { ...value.draft, tableContextReviewed: true, tableContextReference: "Проверен заголовок на листе 1" };
    expect(prepareMatrixFactScope({ ...value, draft }).scope).toBeNull();
    expect(prepareMatrixFactScope({ ...value, draft, fragmentsHash: hash("e") }).scope!.bindings[0].tableContextReview)
      .toEqual({ fragmentsHash: hash("e"), reference: draft.tableContextReference });
    expect(prepareMatrixFactScope({ ...value, draft: { ...draft, tableContextReference: "short" }, fragmentsHash: hash("e") }).scope).toBeNull();
    expect(prepareMatrixFactScope({ ...value, draft: { ...draft, tableContextReviewed: false }, fragmentsHash: hash("e") })
      .scope!.bindings[0]).not.toHaveProperty("tableContextReview");
    expect(value.fact.sourceFlags).toEqual(["SOURCE_APPROVAL_UNKNOWN"]);
  });

  it("replaces only one fact-rule pair, removes stale context/table claims and preserves other bindings immutably", () => {
    const value = fixture();
    const original = prepareMatrixFactScope({ ...value, draft: withContexts(value) }).scope!;
    original.bindings[0].tableContextReview = { fragmentsHash: hash("e"), reference: contextReference };
    const other = { ...structuredClone(original.bindings[0]), target: { ...value.target, observationId: hash("2") }, entityKey: "another-slab" };
    original.bindings.push(other);
    const before = structuredClone(original);
    const next = prepareMatrixFactScope({ ...value, value: original }).scope!;
    expect(next.bindings).toHaveLength(2);
    expect(next.bindings[0]).toEqual(other);
    expect(next.bindings[1].contexts).toEqual({});
    expect(next.bindings[1]).not.toHaveProperty("tableContextReview");
    expect(original).toEqual(before);
    const conflict: MatrixFactScope = { ...original, bindings: [original.bindings[0],
      { ...original.bindings[0], ruleId: "another-rule" }] };
    expect(prepareMatrixFactScope({ ...value, value: conflict,
      draft: { ...value.draft, entityKey: "different-entity" } }).scope).toBeNull();
    const removed = removeMatrixFactScopeBinding(original, value.fact.id, value.rule.ruleId);
    expect(removed.bindings).toEqual([other]);
    expect(removeMatrixFactScopeBinding(removed, other.target.observationId, other.ruleId))
      .toEqual({ schemaVersion: "matrix-fact-scopes-v1", bindings: [] });
  });

  it("clears reviewed identity and all checks when entity changes, retaining no previous position identity", () => {
    const value = fixture("PUMP_FLOW_RATE");
    const draft = { ...withContexts(value), identity: { componentKey: "pump-P1", zoneKey: "A", operatingModeKey: "normal",
      measurementBasisKey: "point-1" }, drawingSectionReviewed: true, tableContextReviewed: true };
    const changed = changeMatrixFactScopeEntity(draft, "building/pump-P2");
    expect(changed).toMatchObject({ entityKey: "building/pump-P2", identityReviewed: false, identity: {},
      drawingSectionReviewed: false, tableContextReviewed: false });
    expect(Object.values(changed.contexts).every(context => !context.reviewed)).toBe(true);
    expect(draft.identityReviewed).toBe(true);
    expect(prepareMatrixFactScope({ ...value, draft: changed }).scope).toBeNull();
    expect(prepareMatrixFactScope({ ...value, draft: { ...changed, identityReviewed: true } }).scope!.bindings[0].contexts).toEqual({});
  });

  it("adds a separate drawing section only with explicit section review and original reference", () => {
    const value = fixture();
    const draft = { ...value.draft, drawingSection: value.rule.expectedSections[0],
      drawingSectionReference: contextReference, drawingSectionReviewed: false };
    expect(prepareMatrixFactScope({ ...value, draft }).scope!.bindings[0].contexts).not.toHaveProperty("DRAWING_SECTION_VERIFIED");
    expect(prepareMatrixFactScope({ ...value, draft: { ...draft, drawingSectionReviewed: true } })
      .scope!.bindings[0].contexts.DRAWING_SECTION_VERIFIED).toEqual({ reference: contextReference, drawingSection: draft.drawingSection });
    expect(prepareMatrixFactScope({ ...value, draft: { ...draft, drawingSectionReviewed: true, drawingSection: "UNKNOWN" } }).scope).toBeNull();
  });
});

describe("fact editor presentation", () => {
  it("shows original address, separate unchecked reviews and draft-only explanation without hash dumps", () => {
    const value = fixture();
    value.fact.contextFragments = [{ pageNumber: 1, blockId: "0:0", rawText: "Заголовок", bbox: value.fact.bbox, role: "ATTRIBUTE_HEADER" }];
    const onChange = vi.fn();
    const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { ...value, fragmentsHash: hash("e"), onChange }));
    expect(html).toContain("Исходный PDF: FIL-PD · PD · страница 2 · строка 1:0");
    expect(html).toContain("только после сохранения решения по источнику и нового запуска");
    expect(html).toContain("Неотмеченные условия останутся неподтверждёнными");
    expect(html).toContain("Связь этой строки со всеми контекстными фрагментами таблицы проверена");
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain(value.target.evidenceHash);
    expect(html).not.toContain(value.target.textArtifactHash);
    expect(html).not.toContain("RULE_SCOPE_COMPLETE");
    expect(html).not.toContain("PARAMETER_SCOPE_COMPLETE");
    expect(html).toContain("Добавить привязку в черновик</button>");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["EVACUATION_CORRIDOR_CLEAR_HEIGHT", "EVACUATION_DOOR_CLEAR_HEIGHT"])(
    "leaves purpose and clear-height basis unselected for %s", attribute => {
      const value = fixture(attribute);
      const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { ...value, onChange: () => {} }));
      expect(html).toContain('aria-label="Назначение пути"');
      expect(html).toContain('aria-label="База измерения высоты"');
      expect(html.match(/<option value="" selected="">Не установлено<\/option>/gu)).toHaveLength(2);
      expect(html).toContain("Маршрут эвакуации подтверждён");
      expect(html).toContain(attribute.includes("CORRIDOR")
        ? "От чистого пола до нижнего препятствия" : "От чистого пола до верха свободного проёма");
      expect(html).not.toContain('checked=""');
      expect(html).toContain("Применимость нормативного требования");
    });

  it.each(["STAIR_TREAD_DEPTH", "STAIR_RISER_HEIGHT"])(
    "leaves purpose and finished-step basis unselected for %s", attribute => {
      const value = fixture(attribute);
      const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { ...value, onChange: () => {} }));
      expect(html).toContain('aria-label="Назначение лестницы"');
      expect(html).toContain('aria-label="База измерения ступени"');
      expect(html.match(/<option value="" selected="">Не установлено<\/option>/gu)).toHaveLength(2);
      expect(html).toContain("Маршрут эвакуации подтверждён");
      expect(html).toContain(attribute === "STAIR_TREAD_DEPTH"
        ? "Горизонтальная глубина проступи в свету после отделки" : "Вертикальная высота подступенка после отделки");
      expect(html).not.toContain('checked=""');
      expect(html).toContain("Применимость нормативного требования");
    });

  it("renders disabled state, missing table target and explicit per-binding removal", () => {
    const value = fixture();
    value.fact.contextFragments = [{ pageNumber: 1, blockId: "0:0", rawText: "Заголовок", bbox: value.fact.bbox, role: "ATTRIBUTE_HEADER" }];
    const scope = prepareMatrixFactScope(value).scope!;
    const html = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { ...value, value: scope, disabled: true, onChange: () => {} }));
    expect(html).toContain('<fieldset disabled="">');
    expect(html).toContain("Адрес контекстных фрагментов ещё не получен");
    expect(html).toContain("Удалить привязку KR-055 · building/slab-1");
    expect(html).toContain("Привязки в черновике: 1");
    expect(html).toContain("Контекст таблицы: не подтверждён");
    const unknown = renderToStaticMarkup(createElement(MatrixFactScopeEditor, { ...value,
      fact: { ...value.fact, attribute: "UNKNOWN" }, onChange: () => {} }));
    expect(unknown).toContain("нет доступного исполняемого правила");
  });
});
