import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { MatrixObservation } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { matrixPresentation, matrixRegistry, validateMatrixExecution } from "../src/matrix-execution.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { computeMatrixCoverage, verifyMatrixAtomicResults } from "../src/matrix-rule-verifier.js";
import { validFenceSourceBinding } from "../src/matrix-fence-prose.js";
import { loadMatrixGoldenFixtures, type MatrixGoldenFixture } from "./matrix-golden-fixtures.js";
import { pythonAvailable } from "./python.js";

type Block = { text: string; bboxMilliPoints: number[]; lineBboxesMilliPoints?: number[][] };
type Page = { blocks: Block[]; [key: string]: unknown };
const original = JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/pd-territory-fence-F0154-p14.json", import.meta.url), "utf8"));
const first = "По границе территории объекта проектом предусмотрена установка";
const second = "ограждения высотой 2,5 м, протяженностью 480,0 м с учетом длины ворот и";
function prose() {
  const page = structuredClone(original.page) as Page;
  const item = { parameterCodes: ["SPZU-036"], attribute: "TERRITORY_FENCE_HEIGHT", stage: "PD", unit: "m",
    rawValue: "2,5", rawUnit: "м", rawText: `${first} ${second}`, sourceFlags: [] as string[], contextFragments: undefined as unknown };
  const fragments = [{ blockId: "17:0" }, { blockId: "17:1" }];
  return { page, item, fragments };
}
const accepts = (value: ReturnType<typeof prose>) => validFenceSourceBinding(value.item, value.fragments, value.page);

describe("territory fence independent source grammar", () => {
  it("accepts complete original F0154 page and its real paragraph indent without inventing review", () => {
    const value = prose();
    expect(value.page.blocks).toHaveLength(23);
    expect(value.page.blocks[17].lineBboxesMilliPoints!.slice(0, 2)).toEqual([
      [134720, 228780, 570253, 242760], [99320, 210300, 570575, 224280]]);
    expect(accepts(value)).toBe(true);
    expect(value.item.contextFragments).toBeUndefined();
  });

  it("requires exact whole-line labels and six case-sensitive unit aliases", () => {
    for (const unit of ["м", "m", "мм", "mm", "см", "cm"]) {
      const value = prose(); value.item.stage = "RD"; value.item.rawUnit = unit;
      value.item.rawText = `ВЫСОТА ОГРАЖДЕНИЯ ТЕРРИТОРИИ: 2,5 ${unit}`;
      expect(validFenceSourceBinding(value.item, [{ blockId: "0:0" }], value.page), unit).toBe(true);
    }
    for (const text of ["Высота ограждения: 2,5 м", "Высота ограждения территории: не менее 2,5 м",
      "Высота ограждения территории: 2,5-3 м", "Высота ограждения территории: 2,5 или 3 м",
      "Высота ограждения территории: 2,5 м; длина 480 м", "Высота ограждения территории: 2,5±0,1 м",
      "Высота ограждения территории: 2 500 м", "Высота ограждения территории: м 2,5"]) {
      const value = prose(); value.item.rawText = text;
      expect(validFenceSourceBinding(value.item, [{ blockId: "0:0" }], value.page), text).toBe(false);
    }
    for (const unit of ["М", "M", "ММ", "MM", "СМ", "CM"]) {
      const value = prose(); value.item.rawText = `Высота ограждения территории: 2,5 ${unit}`; value.item.rawUnit = unit;
      expect(validFenceSourceBinding(value.item, [{ blockId: "0:0" }], value.page), unit).toBe(false);
    }
  });

  it("accepts exact indent, right edge, height and gap boundaries, rejects next milli-point", () => {
    for (const [field, number, good] of [["indent", 0, true], ["indent", 40000, true], ["indent", -1, false],
      ["indent", 40001, false], ["right", 2000, true], ["right", -2000, true], ["right", 2001, false],
      ["right", -2001, false], ["height", 1000, true], ["height", -1000, true], ["height", 1001, false],
      ["height", -1001, false], ["gap", 0, true], ["gap", 18000, true], ["gap", -1, false], ["gap", 18001, false]] as const) {
      const value = prose(), boxes = value.page.blocks[17].lineBboxesMilliPoints!, a = boxes[0], b = boxes[1];
      if (field === "indent") a[0] = b[0] + number;
      if (field === "right") a[2] = b[2] + number;
      if (field === "height") a[3] += number;
      if (field === "gap") {
        const delta = a[1] - b[3] - number;
        for (const box of boxes.slice(1)) { box[1] += delta; box[3] += delta; }
      }
      expect(accepts(value), `${field}:${number}`).toBe(good);
    }
  });

  it("rejects coarse, malformed, cross-block, nonconsecutive or reordered evidence", () => {
    for (const mode of ["coarse", "missing", "zero", "nan", "reversed", "cross-block", "blank-between", "third-fragment"]) {
      const value = prose(), block = value.page.blocks[17];
      if (mode === "coarse") delete block.lineBboxesMilliPoints;
      if (mode === "missing") block.lineBboxesMilliPoints = [];
      if (mode === "zero") block.lineBboxesMilliPoints![0][2] = block.lineBboxesMilliPoints![0][0];
      if (mode === "nan") block.lineBboxesMilliPoints![0][0] = NaN;
      if (mode === "reversed") value.fragments.reverse();
      if (mode === "cross-block") {
        const parts = block.text.split("\n");
        block.text = parts[0];
        value.page.blocks.push({ text: parts[1], bboxMilliPoints: block.lineBboxesMilliPoints![1],
          lineBboxesMilliPoints: [block.lineBboxesMilliPoints![1]] });
        value.fragments[1].blockId = `${value.page.blocks.length - 1}:0`;
      }
      if (mode === "blank-between") {
        block.text = block.text.replace("\n", "\n\n");
        block.lineBboxesMilliPoints!.splice(1, 0, block.lineBboxesMilliPoints![0].slice()); value.fragments[1].blockId = "17:2";
      }
      if (mode === "third-fragment") value.fragments.push({ blockId: "17:2" });
      expect(accepts(value), mode).toBe(false);
    }
  });

  it("rejects competing malformed first anchors, second rows and intervening exact/coarse/unboxed rows", () => {
    for (const [text, bbox, lines] of [
      ["По границе территории объекта другая конструкция", [1, 1, 100, 100], true],
      [second, [1, 1, 100, 100], true],
      ["иной показатель", [200000, 225000, 300000, 228000], true],
      ["иной показатель\nдругая строка", [200000, 225000, 300000, 228000], false],
      ["неизвестная геометрия", [], false],
    ] as const) {
      const value = prose(), block: Block = { text, bboxMilliPoints: [...bbox] };
      if (lines) block.lineBboxesMilliPoints = [[...bbox]];
      value.page.blocks.push(block); expect(accepts(value), text).toBe(false);
    }
  });

  it("parses both numbers but exposes height only; rejects range, alternative and unit case in either", () => {
    for (const text of [second.replace("2,5", "не менее 2,5"), second.replace("2,5", "2,5-3"),
      second.replace("480,0", "480 или 500"), second.replace("480,0", "4 800"), second.replace("480,0 м", "480,0 М"),
      second.replace("2,5 м", "2,5 М"), second + "."]) {
      const value = prose(); value.page.blocks[17].text = value.page.blocks[17].text.split("\n").map((line, index) => index === 1 ? text : line).join("\n");
      expect(accepts(value), text).toBe(false);
    }
    const length = prose(); length.item.rawValue = "480,0"; expect(accepts(length)).toBe(false);
    const folded = prose(); folded.page.blocks[17].text = folded.page.blocks[17].text.toLocaleUpperCase().replace(/М/gu, "м");
    expect(accepts(folded)).toBe(true);
  });

  it("never accepts RD prose, context fragments, table flags or another parameter", () => {
    for (const mode of ["RD", "ID", "context", "table", "parameter", "unit", "attribute"]) {
      const value = prose();
      if (mode === "RD" || mode === "ID") value.item.stage = mode;
      if (mode === "context") value.item.contextFragments = [];
      if (mode === "table") value.item.sourceFlags.push("TABLE_CONTEXT_UNVERIFIED");
      if (mode === "parameter") value.item.parameterCodes.push("AR-048");
      if (mode === "unit") value.item.unit = "mm";
      if (mode === "attribute") value.item.attribute = "FENCE_LENGTH";
      expect(accepts(value), mode).toBe(false);
    }
  });
});

const ruleId = "matrix-spzu-036-territory_fence_height", atomic = `ATOMIC_SUBRULE_SCOPE:${ruleId}`;
function golden(name = "binding:2.4"): MatrixGoldenFixture {
  const value = loadMatrixGoldenFixtures().find(item => item.name === `fence:${name}`);
  if (!value) throw new Error(`Fence golden missing: ${name}`);
  return structuredClone(value);
}
function contexts(value: MatrixGoldenFixture, index: number): Record<string, any> {
  const proofs = value.input.sources[index].review!.scopeProofs! as Record<string, any>;
  return proofs.FACT_BINDINGS?.bindings[0].contexts ?? proofs;
}
/** Recompute all provenance and portable selectors so lexical forgeries reach the independent boundary. */
function refresh(value: MatrixGoldenFixture, stage = "RD") {
  const fact = value.execution.observations.find(item => item.stage === stage)!;
  const source = value.input.sources.find(item => item.sourceFileId === fact.sourceFileId)!;
  const page = (source.textArtifact!.pages as any[]).find(item => item.pageNumber === fact.pageNumber)!;
  const previous = fact.id, boxes: number[][] = [];
  const normalized = (box: number[]) => ({ x: box[0] / page.widthMilliPoints, y: 1 - box[3] / page.heightMilliPoints,
    width: (box[2] - box[0]) / page.widthMilliPoints, height: (box[3] - box[1]) / page.heightMilliPoints });
  const fragments = fact.evidenceFragments as Array<{ blockId: string; rawText: string; bbox: MatrixObservation["bbox"] }>;
  for (const fragment of fragments) {
    const [bi, li] = fragment.blockId.split(":").map(Number), block = page.blocks[bi];
    fragment.rawText = block.text.split(/\r?\n/u)[li];
    const box = block.lineBboxesMilliPoints?.[li] ?? block.bboxMilliPoints;
    fragment.bbox = normalized(box); boxes.push(box);
  }
  fact.rawText = fragments.map(item => item.rawText).join(" "); fact.blockId = fragments[0].blockId;
  fact.bbox = normalized([Math.min(...boxes.map(box => box[0])), Math.min(...boxes.map(box => box[1])),
    Math.max(...boxes.map(box => box[2])), Math.max(...boxes.map(box => box[3]))]);
  fact.id = sha256(canonicalJson({ sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
    stage: fact.stage, pageNumber: fact.pageNumber, blockIds: fragments.map(item => item.blockId),
    attribute: fact.attribute, value: fact.value, unit: fact.unit }));
  const target = deriveMatrixFactTarget(fact, source.textArtifact!);
  expect(target, "Canonical fragments still yield an authentic portable selector").not.toBeNull();
  const envelope = source.review?.scopeProofs?.FACT_BINDINGS as Record<string, any> | undefined;
  const binding = envelope?.bindings.find((item: any) => item.target.observationId === previous);
  if (binding) Object.assign(binding.target, { observationId: target!.observationId,
    evidenceHash: target!.evidenceHash, textArtifactHash: target!.textArtifactHash });
  for (const row of value.execution.results) {
    if (row.expectedObservationId === previous) { row.expectedObservationId = fact.id; row.expectedValue = fact.value; }
    if (row.actualObservationId === previous) { row.actualObservationId = fact.id; row.actualValue = fact.value; }
  }
}

describe.skipIf(!pythonAvailable)("territory fence independent execution boundary", () => {
  beforeAll(() => { loadMatrixGoldenFixtures(); }, 60_000);

  it("accepts 16 real Python review scenarios while preserving partial coverage and uncalibrated confidence", () => {
    for (const kind of ["binding", "whole"]) {
      for (const actual of ["2.4", "2.5", "2.6", "2.499999999999999999"]) {
        const value = golden(`${kind}:${actual}`), checked = validateMatrixExecution(value.execution, value.input);
        expect(checked, `${kind}:${actual}`).not.toBeNull();
        const row = checked!.results.find(item => item.ruleId === ruleId)!;
        expect(row.qualified).toBe(actual === "2.4" || actual === "2.499999999999999999");
        expect(checked!.coverage.find(item => item.parameterCode === "SPZU-036")).toMatchObject({
          executionStatus: "PARTIAL", implementedAtomicRules: 1 });
        expect(matrixPresentation(checked!).every(item => item.confidence.calibratedProbability === null)).toBe(true);
      }
      for (const key of ["APPROVED_CHANGE_STATUS", "FENCE_TYPE_IDENTITY", "ZONE_IDENTITY", atomic]) {
        const value = golden(`${kind}:missing:${key}`);
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${key}`).not.toBeNull();
        expect(value.execution.results.find(item => item.ruleId === ruleId)!.qualified).toBe(false);
      }
    }
  });

  it("accepts full public page as one height fact without entity, review, length or qualified comparison", () => {
    const value = golden("public-prose"), checked = validateMatrixExecution(value.execution, value.input);
    expect(checked).not.toBeNull(); expect(checked!.observations).toHaveLength(1);
    expect(checked!.observations[0]).toMatchObject({ attribute: "TERRITORY_FENCE_HEIGHT", value: "2.5", unit: "m", entityKey: null });
    expect((checked!.observations[0].evidenceFragments as Array<{ blockId: string }>).map(item => item.blockId)).toEqual(["17:0", "17:1"]);
    expect(checked!.observations[0].contextFragments).toBeUndefined();
    expect(checked!.results.every(item => !item.qualified)).toBe(true);
  });

  it("rejects mutated reviewed identities, equally wrong basis/mode and approved change", () => {
    for (const kind of ["binding", "whole"]) for (const index of [0, 1]) {
      for (const field of ["componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey", "componentRole"]) {
        const value = golden(`${kind}:2.4`); contexts(value, index)[atomic][field] = "other-scope";
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${index}:${field}`).toBeNull();
      }
      for (const approved of [true, null]) {
        const value = golden(`${kind}:2.4`); contexts(value, index).APPROVED_CHANGE_STATUS.approvedChangePresent = approved;
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${index}:approved=${approved}`).toBeNull();
      }
    }
    for (const field of ["operatingModeKey", "measurementBasisKey"]) {
      const value = golden(); for (const index of [0, 1]) contexts(value, index)[atomic][field] = "equally-wrong";
      expect(validateMatrixExecution(value.execution, value.input), field).toBeNull();
    }
  });

  it("rejects lexical forgery after authentic source, result and portable target refresh", () => {
    for (const text of ["Высота ограждения территории: не менее 2.4 м", "Высота ограждения территории: 2.4-3 м",
      "Высота ограждения территории: 2.4 или 3 м", "Высота ограждения территории: 2.4 м, длина 480 м",
      "Высота ограждения территории: 2.4 М", "Высота ограждения лестницы: 2.4 м"]) {
      const value = golden(), fact = value.execution.observations.find(item => item.stage === "RD")!;
      (value.input.sources[1].textArtifact!.pages as any[])[0].blocks[0].text = text;
      if (text.endsWith("М")) fact.rawUnit = "М";
      refresh(value);
      expect(verifyMatrixAtomicResults(value.execution, value.input, matrixRegistry), "Review and arithmetic remain valid").toBe(true);
      expect(validateMatrixExecution(value.execution, value.input), text).toBeNull();
    }
    const value = golden("public-prose");
    (value.input.sources[0].textArtifact!.pages as any[])[0].blocks[17].lineBboxesMilliPoints[0][0] = 139321;
    refresh(value, "PD"); expect(validateMatrixExecution(value.execution, value.input)).toBeNull();
  });

  it("rejects policy removal and all definition widening even after registry rehash", () => {
    for (const mode of ["both", "known-id", "known-attribute", "legacy-role", "threshold", "label", "units", "family",
      "sections", "expected-sections", "variants", "gap", "entry-family", "required-context", "policy-extra", "enabled",
      "purpose", "scope", "canonical-unit", "value-kind", "allowed-values", "second-rule"]) {
      const value = golden(), registry = structuredClone(matrixRegistry) as any;
      const entry = registry.entries.find((item: any) => item.parameterCode === "SPZU-036"), rule = entry.atomicRules[0];
      if (["both", "known-id", "known-attribute"].includes(mode)) {
        delete rule.subruleContext; rule.requiredContext = [];
        if (mode === "known-id") rule.attribute = "OTHER_HEIGHT";
        if (mode === "known-attribute") rule.ruleId = "matrix-other-height";
      }
      if (mode === "legacy-role") { rule.subruleContext.componentRole = "POTABLE_WATER_PUMP"; rule.requiredContext = [atomic]; }
      if (mode === "threshold") rule.threshold = { value: "2", unit: "m", strict: true };
      if (mode === "label") rule.labels = ["Высота ограды"];
      if (mode === "units") rule.unitAliases.reverse();
      if (mode === "family") rule.family = "DIFFERENT";
      if (mode === "sections") rule.actualSections.push("OTHER");
      if (mode === "expected-sections") rule.expectedSections.reverse();
      if (mode === "variants") { rule.allowedStagePairs.push(["PD", "ID"]); rule.comparisonVariants.push("PD_ID"); }
      if (mode === "gap") entry.gap = "COMPLETE";
      if (mode === "entry-family") entry.family = "DECREASE";
      if (mode === "required-context") rule.requiredContext.reverse();
      if (mode === "policy-extra") rule.subruleContext.allowNominal = true;
      if (mode === "enabled") rule.enabled = false;
      if (mode === "purpose") rule.comparisonPurpose = "NORMATIVE";
      if (mode === "scope") rule.scopePolicy = "AUTO";
      if (mode === "canonical-unit") rule.canonicalUnit = "mm";
      if (mode === "value-kind") rule.valueKind = "INTEGER";
      if (mode === "allowed-values") rule.allowedValues = ["2.4"];
      if (mode === "second-rule") entry.atomicRules.push({ ...rule, ruleId: "matrix-other-fence" });
      value.execution.registryHash = sha256(canonicalJson(registry));
      expect(() => computeMatrixCoverage(value.execution, value.input, registry), mode).toThrow();
      expect(verifyMatrixAtomicResults(value.execution, value.input, registry), mode).toBe(false);
    }
  });
});
