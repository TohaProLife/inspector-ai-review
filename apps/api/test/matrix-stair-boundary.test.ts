import type { MatrixFactScopeBinding, MatrixObservation } from "@inspector-ai/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { matrixPresentation, matrixRegistry, validateMatrixExecution } from "../src/matrix-execution.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { computeMatrixCoverage, verifyMatrixAtomicResults } from "../src/matrix-rule-verifier.js";
import { validStairSourceBinding } from "../src/matrix-stair-prose.js";
import { loadMatrixGoldenFixtures, type MatrixGoldenFixture } from "./matrix-golden-fixtures.js";
import { pythonAvailable } from "./python.js";

const specs = {
  tread: { ruleId: "matrix-ar-048-stair_tread_depth", attribute: "STAIR_TREAD_DEPTH", family: "LOWER_BOUND",
    label: "Глубина проступи лестницы в свету", role: "STAIR_TREAD", threshold: "300", expected: "310", actual: "299",
    basis: "FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH" },
  riser: { ruleId: "matrix-ar-048-stair_riser_height", attribute: "STAIR_RISER_HEIGHT", family: "UPPER_BOUND",
    label: "Высота подступенка лестницы после отделки", role: "STAIR_RISER", threshold: "150", expected: "149", actual: "151",
    basis: "FINISHED_VERTICAL_RISER_HEIGHT" },
} as const;
type Kind = keyof typeof specs;
type Box = MatrixObservation["bbox"];
type Fragment = { blockId: string; rawText: string; bbox: Box };
type Block = { text: string; bboxMilliPoints: number[]; lineBboxesMilliPoints?: number[][] };
type Page = { pageNumber: number; widthMilliPoints: number; heightMilliPoints: number; blocks: Block[] };
type Envelope = { bindings: MatrixFactScopeBinding[]; [key: string]: unknown };
const scenarios = ["qualified", "equality", "baseline-outside", "norm-false", "missing-norm", "wrong-norm-threshold",
  "missing-step-identity", "nominal", "wrong-purpose", "mismatched-zone"] as const;

function fixture(kind: Kind, scenario: string = "qualified"): MatrixGoldenFixture {
  return named(`stair:${kind}:${scenario}`);
}
function named(name: string): MatrixGoldenFixture {
  const found = loadMatrixGoldenFixtures().find(item => item.name === name);
  if (!found) throw new Error(`Stair golden missing: ${name}`);
  return structuredClone(found);
}
function selected(value: MatrixGoldenFixture, stage: "PD" | "RD" = "RD"): MatrixObservation {
  const fact = value.execution.observations.find(item => item.stage === stage);
  if (!fact) throw new Error(`Stair fact missing: ${stage}`);
  return fact;
}
function row(value: MatrixGoldenFixture, kind: Kind) {
  return value.execution.results.find(item => item.ruleId === specs[kind].ruleId)!;
}
function envelope(value: MatrixGoldenFixture, index: number): Envelope {
  return value.input.sources[index].review!.scopeProofs!.FACT_BINDINGS as Envelope;
}
function binding(value: MatrixGoldenFixture, index: number) { return envelope(value, index).bindings[0]; }
function originalPage(value: MatrixGoldenFixture, fact = selected(value, "PD")): Page {
  const source = value.input.sources.find(item => item.sourceFileId === fact.sourceFileId)!;
  return (source.textArtifact!.pages as Page[]).find(item => item.pageNumber === fact.pageNumber)!;
}
function normalized(box: number[], page: Page): Box {
  return { x: box[0] / page.widthMilliPoints, y: 1 - box[3] / page.heightMilliPoints,
    width: (box[2] - box[0]) / page.widthMilliPoints, height: (box[3] - box[1]) / page.heightMilliPoints };
}
function primary(fact: MatrixObservation) { return fact.evidenceFragments as Fragment[]; }

/** Refresh authentic source fragments, IDs, result refs and portable targets after each forgery.
 * Rejections must reach lexical/geometry/rule checks, rather than an unrelated stale hash gate. */
function refreshSource(value: MatrixGoldenFixture, sourceId: string) {
  const source = value.input.sources.find(item => item.sourceFileId === sourceId)!;
  const artifact = source.textArtifact!;
  for (const fact of value.execution.observations.filter(item => item.sourceFileId === sourceId)) {
    const previous = fact.id, page = originalPage(value, fact), boxes: number[][] = [];
    for (const fragment of primary(fact)) {
      const [bi, li] = fragment.blockId.split(":").map(Number), block = page.blocks[bi];
      fragment.rawText = block.text.split(/\r?\n/u)[li];
      const box = block.lineBboxesMilliPoints?.[li] ?? block.bboxMilliPoints;
      fragment.bbox = normalized(box, page); boxes.push(box);
    }
    fact.blockId = primary(fact)[0].blockId;
    fact.rawText = primary(fact).map(item => item.rawText).join(" ");
    fact.bbox = normalized([Math.min(...boxes.map(box => box[0])), Math.min(...boxes.map(box => box[1])),
      Math.max(...boxes.map(box => box[2])), Math.max(...boxes.map(box => box[3]))], page);
    fact.id = sha256(canonicalJson({ sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
      stage: fact.stage, pageNumber: fact.pageNumber, blockIds: primary(fact).map(item => item.blockId),
      attribute: fact.attribute, value: fact.value, unit: fact.unit,
      ...(fact.contextFragments ? { contextFragments: fact.contextFragments } : {}) }));
    const target = deriveMatrixFactTarget(fact, artifact);
    expect(target, "Forgery has valid canonical fragment provenance and portable target").not.toBeNull();
    const scopes = source.review?.scopeProofs?.FACT_BINDINGS as Envelope | undefined;
    const scope = scopes?.bindings.find(item => item.target.observationId === previous);
    if (scope) Object.assign(scope.target, { observationId: target!.observationId,
      evidenceHash: target!.evidenceHash, textArtifactHash: target!.textArtifactHash });
    for (const result of value.execution.results) {
      if (result.expectedObservationId === previous) { result.expectedObservationId = fact.id; result.expectedValue = fact.value; }
      if (result.actualObservationId === previous) { result.actualObservationId = fact.id; result.actualValue = fact.value; }
    }
  }
}
function changeLiteral(value: MatrixGoldenFixture, text: string, rawValue?: string, rawUnit?: string) {
  const fact = selected(value), page = originalPage(value, fact);
  page.blocks[0].text = text;
  if (rawValue !== undefined) fact.rawValue = rawValue;
  if (rawUnit !== undefined) fact.rawUnit = rawUnit;
  refreshSource(value, fact.sourceFileId);
}
function prose() { return named("stair:public-prose"); }
function proseAccepted(value: MatrixGoldenFixture) {
  const page = originalPage(value);
  return value.execution.observations.every(fact => validStairSourceBinding(fact, primary(fact), page));
}
function move(block: Block, dx = 0, dy = 0) {
  for (const box of [block.bboxMilliPoints, ...(block.lineBboxesMilliPoints ?? [])]) {
    box[0] += dx; box[2] += dx; box[1] += dy; box[3] += dy;
  }
}
function refreshProse(value: MatrixGoldenFixture) { refreshSource(value, selected(value, "PD").sourceFileId); }

describe.skipIf(!pythonAvailable)("stair dimensions independent source boundary", () => {
  beforeAll(() => { loadMatrixGoldenFixtures(); }, 60_000);

  it("independently accepts all 20 reviewed Python scenarios without manufacturing completeness or probability", () => {
    for (const kind of ["tread", "riser"] as const) for (const scenario of scenarios) {
      const value = fixture(kind, scenario), checked = validateMatrixExecution(value.execution, value.input);
      expect(checked, `${kind}:${scenario}`).not.toBeNull();
      expect(row(value, kind).qualified).toBe(scenario === "qualified");
      expect(checked!.coverage.find(item => item.parameterCode === "AR-048")).toMatchObject({
        executionStatus: "PARTIAL", implementedAtomicRules: 2, successfulComparisons: scenario === "qualified" ? 1 : 0 });
      expect(matrixPresentation(checked!).every(item => item.confidence.calibratedProbability === null)).toBe(true);
      if (scenario === "equality") expect(row(value, kind).reasonCode).toBe("NEGATIVE_SCOPE_UNVERIFIED");
      if (scenario === "baseline-outside") expect(row(value, kind).reasonCode).toBe("PROJECT_BASELINE_OUTSIDE_BOUND");
      if (scenario === "qualified") {
        const context = binding(value, 1).contexts[`ATOMIC_SUBRULE_SCOPE:${specs[kind].ruleId}`];
        expect(context).toMatchObject({ componentRole: specs[kind].role, operatingModeKey: "EVACUATION",
          measurementBasisKey: specs[kind].basis });
        expect(row(value, kind)).toMatchObject({ machineStatus: "CANDIDATE", expectedValue: specs[kind].expected,
          actualValue: specs[kind].actual, delta: kind === "tread" ? "-1" : "1" });
      }
    }
  });

  it("accepts the tracked public page with exact two-line provenance but no reviewed entity or qualified comparison", () => {
    const value = prose();
    expect(proseAccepted(value)).toBe(true);
    expect(validateMatrixExecution(value.execution, value.input)).not.toBeNull();
    expect(value.execution.observations).toHaveLength(2);
    expect(new Set(value.execution.observations.map(item => `${item.attribute}:${item.value}`)))
      .toEqual(new Set(["STAIR_TREAD_DEPTH:300", "STAIR_RISER_HEIGHT:150"]));
    for (const fact of value.execution.observations) {
      expect(primary(fact).map(item => item.blockId)).toEqual(["15:0", "16:0"]);
      expect(fact.entityKey).toBeNull(); expect(fact.contextFragments).toBeUndefined();
      expect(fact.sourceFlags).not.toContain("TABLE_CONTEXT_UNVERIFIED");
    }
    expect(value.execution.results.every(item => !item.qualified)).toBe(true);
  });

  it("accepts exact 0/18000 gap, 2000 left and 1000 height boundaries, rejects the next milli-point", () => {
    for (const [dx, dy, accepted] of [[0, 10081, true], [0, -7919, true], [0, 10082, false], [0, -7920, false],
      [2000, 0, true], [-2000, 0, true], [2001, 0, false], [-2001, 0, false]] as const) {
      const value = prose(); move(originalPage(value).blocks[16], dx, dy); refreshProse(value);
      expect(proseAccepted(value), `left=${dx}, shift=${dy}`).toBe(accepted);
      expect(validateMatrixExecution(value.execution, value.input) !== null, `boundary=${dx}:${dy}`).toBe(accepted);
    }
    for (const [height, accepted] of [[1000, true], [-1000, true], [1001, false], [-1001, false]] as const) {
      const value = prose(), block = originalPage(value).blocks[16];
      for (const box of [block.bboxMilliPoints, ...(block.lineBboxesMilliPoints ?? [])]) box[1] -= height;
      refreshProse(value);
      expect(proseAccepted(value), `height=${height}`).toBe(accepted);
      expect(validateMatrixExecution(value.execution, value.input) !== null).toBe(accepted);
    }
  });

  it("uses single-line block boxes as exact geometry, while rejecting coarse multi-line fallback boxes", () => {
    const single = prose();
    for (const index of [15, 16]) delete originalPage(single).blocks[index].lineBboxesMilliPoints;
    refreshProse(single);
    expect(proseAccepted(single)).toBe(true);
    expect(validateMatrixExecution(single.execution, single.input)).not.toBeNull();
    const coarse = prose(), page = originalPage(coarse);
    page.blocks[15].text += "\n" + page.blocks[16].text;
    page.blocks[15].bboxMilliPoints = [85095, 325214, 537769, 363375];
    delete page.blocks[15].lineBboxesMilliPoints;
    for (const fact of coarse.execution.observations) primary(fact)[1].blockId = "15:1";
    page.blocks[16].text = ""; refreshProse(coarse);
    expect(proseAccepted(coarse)).toBe(false);
    expect(validateMatrixExecution(coarse.execution, coarse.input)).toBeNull();
  });

  it("rejects intervening exact or coarse lines and any second competing first/second clause", () => {
    for (const mode of ["intervening", "coarse", "first", "second", "malformed-anchor"]) {
      const value = prose(), page = originalPage(value);
      if (mode === "intervening" || mode === "coarse") page.blocks.push({
        text: mode === "coarse" ? "другая\nстрока" : "другая строка",
        bboxMilliPoints: [100000, 341000, 200000, 345000],
        ...(mode === "intervening" ? { lineBboxesMilliPoints: [[100000, 341000, 200000, 345000]] } : {}) });
      else {
        const block = structuredClone(page.blocks[mode === "second" ? 16 : 15]);
        if (mode === "malformed-anchor") block.text = "Ширина проступей ступеней предусмотрена не менее 0,3 м, а высота подъема";
        move(block, 0, 100000); page.blocks.push(block);
      }
      refreshProse(value);
      expect(proseAccepted(value), mode).toBe(false);
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("rejects reversed/third evidence fragments even after rebuilding observation identities", () => {
    for (const mode of ["reversed", "third"] as const) {
      const value = prose();
      for (const fact of value.execution.observations) {
        if (mode === "reversed") primary(fact).reverse();
        else primary(fact).push({ blockId: "14:0", rawText: "", bbox: fact.bbox });
      }
      refreshProse(value);
      expect(proseAccepted(value), mode).toBe(false);
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("uses physical order rather than array order and rejects reversed vertical placement", () => {
    const reordered = prose(), page = originalPage(reordered), length = page.blocks.length;
    page.blocks.reverse();
    for (const fact of reordered.execution.observations) for (const fragment of primary(fact)) {
      const [bi, li] = fragment.blockId.split(":").map(Number); fragment.blockId = `${length - 1 - bi}:${li}`;
    }
    for (const metadata of reordered.execution.metadata) for (const stamp of metadata.stampCandidates as Array<{ blockId: string }>) {
      const [bi, li] = stamp.blockId.split(":").map(Number); stamp.blockId = `${length - 1 - bi}:${li}`;
    }
    refreshProse(reordered);
    expect(proseAccepted(reordered)).toBe(true);
    expect(validateMatrixExecution(reordered.execution, reordered.input)).not.toBeNull();
    const reversed = prose(); move(originalPage(reversed).blocks[16], 0, 30000); refreshProse(reversed);
    expect(proseAccepted(reversed)).toBe(false);
    expect(validateMatrixExecution(reversed.execution, reversed.input)).toBeNull();
  });

  it("matches Python whitespace around the prose hyphen and preserves literal suffix restrictions", () => {
    for (const text of ["ступеней-0,15м.", "СТУПЕНЕЙ-0,15м. УКЛОНЫ ЛЕСТНИЦ-1:2. СТАЛЬНЫЕ ОГРАЖДЕНИЯ ЛЕСТНИЧНЫХ"]) {
      const value = prose(); originalPage(value).blocks[16].text = text; refreshProse(value);
      expect(proseAccepted(value), text).toBe(true);
      expect(validateMatrixExecution(value.execution, value.input), text).not.toBeNull();
    }
  });

  it("rejects bounds, ranges, alternatives, wrong units and changed slope tails in original prose", () => {
    for (const [index, text] of [[15, "Ширина проступей ступеней предусмотрена не менее 0,3 м, а высота подъема"],
      [15, "Ширина проступей ступеней предусмотрена 0,3 или 0,4 м, а высота подъема"],
      [15, "Ширина проступей ступеней предусмотрена 0,3 М, а высота подъема"],
      [16, "ступеней - 0,15м. Уклоны лестниц - 1:3. Стальные ограждения лестничных"],
      [16, "ступеней - 0,15м. Допустимо 0,17м."], [16, "ступеней - 0,15-0,17м."],
      [16, "ступеней - 0,15кВт."], [16, "ступеней - 0,15М."]] as const) {
      const value = prose(); originalPage(value).blocks[index].text = text;
      if (text.includes("0,15М")) for (const fact of value.execution.observations) if (fact.attribute === specs.riser.attribute) fact.rawUnit = "М";
      refreshProse(value);
      expect(proseAccepted(value), text).toBe(false);
      expect(validateMatrixExecution(value.execution, value.input), text).toBeNull();
    }
  });

  it("requires the exact AR-048 attribute/stage/unit contract without table or borrowed context markers", () => {
    for (const mode of ["foreign-code", "extra-code", "other-attribute", "id-stage", "unresolved-stage", "canonical-unit",
      "table-flag", "context-fragment", "missing-box", "zero-box"]) {
      const value = prose(), fact = selected(value, "PD"), page = originalPage(value);
      if (mode === "foreign-code") fact.parameterCodes = ["AR-042"];
      if (mode === "extra-code") (fact.parameterCodes as string[]).push("AR-042");
      if (mode === "other-attribute") fact.attribute = "EVACUATION_DOOR_CLEAR_HEIGHT";
      if (mode === "id-stage") fact.stage = "ID";
      if (mode === "unresolved-stage") fact.stage = "UNRESOLVED";
      if (mode === "canonical-unit") fact.unit = "m";
      if (mode === "table-flag") (fact.sourceFlags as string[]).push("TABLE_CONTEXT_UNVERIFIED");
      if (mode === "context-fragment") fact.contextFragments = [{ pageNumber: 1, role: "TABLE_SCOPE",
        blockId: "14:0", rawText: page.blocks[14].text, bbox: fact.bbox }];
      if (mode === "missing-box") {
        delete page.blocks[15].lineBboxesMilliPoints;
        page.blocks[15].bboxMilliPoints = [];
      }
      if (mode === "zero-box") page.blocks[15].lineBboxesMilliPoints = [[85095, 349335, 500439, 349335]];
      expect(validStairSourceBinding(fact, primary(fact), page), mode).toBe(false);
    }
  });

  it("accepts exact six unit aliases and case-folded labels after refreshing portable targets", () => {
    for (const kind of ["tread", "riser"] as const) for (const [unit, divisor] of [["мм", 1], ["mm", 1], ["м", 1000],
      ["m", 1000], ["см", 10], ["cm", 10]] as const) {
      const value = fixture(kind), raw = String(Number(specs[kind].actual) / divisor);
      changeLiteral(value, `${specs[kind].label.toLocaleUpperCase()}: ${raw} ${unit}`, raw, unit);
      expect(validateMatrixExecution(value.execution, value.input), `${kind}:${unit}`).not.toBeNull();
    }
  });

  it("rejects forged literal decoys with fresh valid selectors, original source text and result references", () => {
    for (const kind of ["tread", "riser"] as const) {
      const spec = specs[kind];
      for (const text of [`Высота ступени: ${spec.actual} мм`, `${spec.label}: не менее ${spec.actual} мм`,
        `${spec.label}: ${spec.actual}-310 мм`, `${spec.label}: ${spec.actual} или 310 мм`,
        `${spec.label}: ${spec.actual} мм дополнительный текст`, `${spec.label}: ${spec.actual}±5 мм`,
        `${spec.label}: ${spec.actual} ММ`, `${spec.label}: мм ${spec.actual}`]) {
        const value = fixture(kind); changeLiteral(value, text, spec.actual, text.endsWith("ММ") ? "ММ" : "мм");
        expect(validateMatrixExecution(value.execution, value.input), text).toBeNull();
      }
      const thousands = fixture(kind), fact = selected(thousands);
      fact.rawValue = `0 ${spec.actual}`;
      changeLiteral(thousands, `${spec.label}: ${fact.rawValue} мм`);
      expect(verifyMatrixAtomicResults(thousands.execution, thousands.input, matrixRegistry), "Value and exact targets still match").toBe(true);
      expect(validStairSourceBinding(fact, primary(fact), originalPage(thousands, fact))).toBe(false);
      expect(validateMatrixExecution(thousands.execution, thousands.input)).toBeNull();
    }
  });

  it("rejects generic header/value joins even when the fragments and fact targets are authentic", () => {
    for (const kind of ["tread", "riser"] as const) {
      const value = fixture(kind), fact = selected(value), page = originalPage(value, fact);
      const a = [1000, 20000, 300000, 30000], b = [310000, 20000, 400000, 30000];
      page.blocks = [{ text: specs[kind].label, bboxMilliPoints: a, lineBboxesMilliPoints: [a.slice()] },
        { text: `${specs[kind].actual} мм`, bboxMilliPoints: b, lineBboxesMilliPoints: [b.slice()] }];
      fact.evidenceFragments = [{ blockId: "0:0", rawText: "", bbox: fact.bbox }, { blockId: "1:0", rawText: "", bbox: fact.bbox }];
      refreshSource(value, fact.sourceFileId);
      expect(verifyMatrixAtomicResults(value.execution, value.input, matrixRegistry), "Arithmetic/targets still match").toBe(true);
      expect(validateMatrixExecution(value.execution, value.input), kind).toBeNull();
    }
  });

  it("rejects qualifying claims after norm/step proof or any of the four exact identities change", () => {
    for (const kind of ["tread", "riser"] as const) for (const index of [0, 1]) {
      const key = `ATOMIC_SUBRULE_SCOPE:${specs[kind].ruleId}`;
      for (const field of ["componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey", "componentRole"] as const) {
        const value = fixture(kind); binding(value, index).contexts[key][field] = "other-reviewed-scope";
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${index}:${field}`).toBeNull();
      }
      for (const missing of ["NORM_APPLICABILITY_VERIFIED", "STAIR_FLIGHT_STEP_IDENTITY", key]) {
        const value = fixture(kind); delete binding(value, index).contexts[missing];
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${index}:${missing}`).toBeNull();
      }
      for (const [field, bad] of [["applicable", false], ["parameterCode", "AR-042"], ["attribute", "OTHER_HEIGHT"],
        ["threshold", kind === "tread" ? "0.3" : "0.15"], ["canonicalUnit", "m"]] as const) {
        const value = fixture(kind);
        (binding(value, index).contexts.NORM_APPLICABILITY_VERIFIED as Record<string, unknown>)[field] = bad;
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${index}:${field}`).toBeNull();
      }
    }
  });

  it("rejects equally wrong bases/modes, neighbouring-atom borrowing, unknown originals and forged completeness", () => {
    for (const kind of ["tread", "riser"] as const) {
      const key = `ATOMIC_SUBRULE_SCOPE:${specs[kind].ruleId}`, other = specs[kind === "tread" ? "riser" : "tread"];
      for (const wrong of [{ operatingModeKey: "ORDINARY_STAIR" }, { measurementBasisKey: "NOMINAL_DIMENSION" },
        { measurementBasisKey: other.basis }]) {
        const value = fixture(kind);
        for (const index of [0, 1]) Object.assign(binding(value, index).contexts[key], wrong);
        expect(validateMatrixExecution(value.execution, value.input), JSON.stringify(wrong)).toBeNull();
      }
      for (const mode of ["rule", "target", "empty", "unknown", "section", "pair", "complete"]) {
        const value = fixture(kind);
        if (mode === "rule") binding(value, 1).ruleId = other.ruleId;
        if (mode === "target") binding(value, 1).target.observationId = selected(value, "PD").id;
        if (mode === "empty") envelope(value, 1).bindings = [];
        if (mode === "unknown") value.input.sources[1].review!.approvalStatus = "UNKNOWN";
        if (mode === "section") value.input.sources[1].review!.sectionCode = "OTHER";
        if (mode === "pair") row(value, kind).comparisonVariant = "PD_ID";
        if (mode === "complete") value.execution.coverage.find(item => item.parameterCode === "AR-048")!.executionStatus = "EVALUATED";
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${mode}`).toBeNull();
      }
    }
  });

  it("rejects worker-supplied probability/confidence extras on execution, result or observation", () => {
    for (const surface of ["execution", "result", "observation"] as const) {
      for (const key of ["probability", "confidence", "calibratedProbability"]) {
        const value = fixture("tread"), target = surface === "execution" ? value.execution
          : surface === "result" ? row(value, "tread") : selected(value);
        (target as unknown as Record<string, unknown>)[key] = key === "confidence"
          ? { calibratedProbability: 0.99, calibrationVersion: "invented-by-worker" } : 0.99;
        expect(validateMatrixExecution(value.execution, value.input), `${surface}:${key}`).toBeNull();
      }
    }
    const value = fixture("tread"), checked = validateMatrixExecution(value.execution, value.input);
    expect(checked).not.toBeNull();
    expect(matrixPresentation(checked!).every(item => item.confidence.calibratedProbability === null)).toBe(true);
  });

  it("rejects widened stair policy and removing both typed context and own ATOMIC gate after rehashing the registry", () => {
    type MutableRegistry = { entries: Array<{ parameterCode: string; family: unknown; gap: unknown;
      atomicRules: Array<Record<string, any>> }> };
    for (const kind of ["tread", "riser"] as const) for (const mode of ["both", "known-rule-only", "known-attribute-only", "legacy-role",
      "threshold", "label", "units", "family", "sections", "variants", "gap", "entry-family"]) {
      const value = fixture(kind), registry = structuredClone(matrixRegistry) as unknown as MutableRegistry;
      const entry = registry.entries.find(item => item.parameterCode === "AR-048")!;
      const rule = entry.atomicRules.find(item => item.ruleId === specs[kind].ruleId)!;
      if (["both", "known-rule-only", "known-attribute-only"].includes(mode)) {
        delete rule.subruleContext; rule.requiredContext = ["NORM_APPLICABILITY_VERIFIED", "STAIR_FLIGHT_STEP_IDENTITY"];
        if (mode === "known-rule-only") rule.attribute = "OTHER_DIMENSION";
        if (mode === "known-attribute-only") rule.ruleId = "matrix-other-dimension";
      }
      if (mode === "legacy-role") { rule.subruleContext.componentRole = "POTABLE_WATER_PUMP";
        Object.assign(rule, { family: "DECREASE", threshold: null, requiredContext: [`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`] }); }
      if (mode === "threshold") rule.threshold.value = "280";
      if (mode === "label") rule.labels = ["Размер ступени"];
      if (mode === "units") rule.unitAliases = ["мм", "ММ"];
      if (mode === "family") rule.family = specs[kind].family === "LOWER_BOUND" ? "UPPER_BOUND" : "LOWER_BOUND";
      if (mode === "sections") rule.actualSections = ["OTHER"];
      if (mode === "variants") { rule.allowedStagePairs.push(["PD", "ID"]); rule.comparisonVariants.push("PD_ID"); }
      if (mode === "gap") entry.gap = "ALL_PARAMETERS_IMPLEMENTED";
      if (mode === "entry-family") entry.family = specs[kind].family;
      value.execution.registryHash = sha256(canonicalJson(registry));
      expect(() => computeMatrixCoverage(value.execution, value.input, registry), `${kind}:${mode}`).toThrow();
      expect(verifyMatrixAtomicResults(value.execution, value.input, registry), `${kind}:${mode}`).toBe(false);
    }
  });
});
