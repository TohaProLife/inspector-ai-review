import type { MatrixObservation } from "@inspector-ai/contracts";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { matrixPresentation, validateMatrixExecution } from "../src/matrix-execution.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { prepareMatrixFactBindings } from "../src/matrix-fact-bindings.js";
import { loadMatrixGoldenFixtures, type MatrixGoldenFixture } from "./matrix-golden-fixtures.js";
const goldenFixtures = loadMatrixGoldenFixtures();

type Box = MatrixObservation["bbox"];
type Fragment = { blockId: string; rawText: string; bbox: Box };
type Block = { text: string; bboxMilliPoints: number[]; lineBboxesMilliPoints?: number[][] };
type Page = { pageNumber: number; widthMilliPoints: number; heightMilliPoints: number; blocks: Block[] };

function fixture(): MatrixGoldenFixture {
  const golden = goldenFixtures.find(value => value.name === "pd-sidewalk-table:ground-with-decoys");
  if (!golden) throw new Error("PD sidewalk table golden missing");
  return structuredClone(golden);
}
function fact(value: MatrixGoldenFixture): MatrixObservation {
  const selected = value.execution.observations.find(item => item.attribute === "SIDEWALK_TILE_AREA" && item.stage === "PD");
  if (!selected) throw new Error("Ground sidewalk observation missing");
  return selected;
}
function page(value: MatrixGoldenFixture, selected = fact(value)): Page {
  const artifact = value.input.sources.find(source => source.sourceFileId === selected.sourceFileId)!.textArtifact!;
  return (artifact.pages as Page[]).find(item => item.pageNumber === selected.pageNumber)!;
}
function primary(selected: MatrixObservation): Fragment[] {
  return selected.evidenceFragments as Fragment[];
}
function rehash(value: MatrixGoldenFixture, selected = fact(value)) {
  const previous = selected.id;
  selected.id = sha256(canonicalJson({ sourceFileId: selected.sourceFileId, sourceSha256: selected.sourceSha256,
    stage: selected.stage, pageNumber: selected.pageNumber, blockIds: primary(selected).map(item => item.blockId),
    attribute: selected.attribute, value: selected.value, unit: selected.unit,
    ...(selected.contextFragments ? { contextFragments: selected.contextFragments } : {}) }));
  for (const result of value.execution.results) for (const key of ["expectedObservationId", "actualObservationId"] as const) {
    if (result[key] === previous) result[key] = selected.id;
  }
}
function rebuildPrimary(value: MatrixGoldenFixture) {
  const selected = fact(value), fragments = primary(selected), left = Math.min(...fragments.map(item => item.bbox.x));
  const top = Math.min(...fragments.map(item => item.bbox.y));
  selected.blockId = fragments[0].blockId;
  selected.rawText = fragments.map(item => item.rawText).join(" ");
  selected.bbox = { x: left, y: top,
    width: Math.max(...fragments.map(item => item.bbox.x + item.bbox.width)) - left,
    height: Math.max(...fragments.map(item => item.bbox.y + item.bbox.height)) - top };
  rehash(value, selected);
}
function originalBlock(value: MatrixGoldenFixture, fragment: Fragment) {
  return page(value).blocks[Number(fragment.blockId.split(":")[0])];
}
function replaceOriginalLine(value: MatrixGoldenFixture, fragment: Fragment, text: string) {
  const block = originalBlock(value, fragment), index = Number(fragment.blockId.split(":")[1]);
  const lines = block.text.split(/\r?\n/u);
  lines[index] = text;
  block.text = lines.join("\n");
  fragment.rawText = text;
}
function originalLine(value: MatrixGoldenFixture, text: string): Fragment {
  const original = page(value);
  for (const [blockIndex, block] of original.blocks.entries()) for (const [lineIndex, rawText] of block.text.split(/\r?\n/u).entries()) {
    if (rawText.trim() !== text) continue;
    const bounds = block.lineBboxesMilliPoints?.[lineIndex] ?? block.bboxMilliPoints;
    return { blockId: `${blockIndex}:${lineIndex}`, rawText: rawText.trim(), bbox: {
      x: bounds[0] / original.widthMilliPoints, y: 1 - bounds[3] / original.heightMilliPoints,
      width: (bounds[2] - bounds[0]) / original.widthMilliPoints,
      height: (bounds[3] - bounds[1]) / original.heightMilliPoints,
    } };
  }
  throw new Error(`Original decoy line missing: ${text}`);
}

describe("sidewalk table independent source boundary", () => {
  it("keeps only the ground tile area with five original lines and six mandatory context lines", () => {
    const value = fixture(), result = validateMatrixExecution(value.execution, value.input);
    expect(result).not.toBeNull();
    const observations = result!.observations.filter(item => item.attribute === "SIDEWALK_TILE_AREA");
    expect(observations).toHaveLength(1);
    const selected = observations[0];
    expect(selected).toMatchObject({ stage: "PD", value: "112", unit: "m2" });
    expect(primary(selected).map(item => item.rawText)).toEqual([
      "Тротуары пешеходные", "из бетонной плитки,", "по грунту", "- тип 3", "112 м²",
    ]);
    expect(selected.contextFragments).toHaveLength(6);
    expect(selected.contextFragments!.filter(item => item.role === "ATTRIBUTE_HEADER")).toHaveLength(3);
    expect(selected.contextFragments!.filter(item => item.role === "TABLE_SCOPE")).toHaveLength(3);
    expect(selected.contextFragments!.map(item => item.rawText.trim())).toEqual(expect.arrayContaining([
      "ВЕДОМОСТЬ ПРОЕЗДОВ, ТРОТУАРОВ,", "ДОРОЖЕК И ПЛОЩАДОК", "(в гр. ГПЗУ)",
      "Площадь", "покрытия, кв.м. в", "гр. ГПЗУ",
    ]));
    expect(selected.sourceFlags).toContain("TABLE_CONTEXT_UNVERIFIED");
    expect(result!.results.every(row => !row.qualified)).toBe(true);
    expect(result!.coverage.find(row => row.parameterCode === "SPZU-026")).toMatchObject({ executionStatus: "PARTIAL" });
    expect(matrixPresentation(result!).every(row => row.confidence.calibratedProbability === null)).toBe(true);
  });

  it("rejects forged caption, scope, header, page and geometry even after observation rehash", () => {
    const mutations: Array<(selected: MatrixObservation) => void> = [
      selected => { selected.contextFragments![0].rawText = "ВЕДОМОСТЬ ОЗЕЛЕНЕНИЯ"; },
      selected => { selected.contextFragments!.find(item => item.rawText === "(в гр. ГПЗУ)")!.rawText = "(на кровле автостоянки)"; },
      selected => { selected.contextFragments!.find(item => item.role === "ATTRIBUTE_HEADER")!.rawText = "Толщина"; },
      selected => { selected.contextFragments![0].pageNumber++; },
      selected => { selected.contextFragments![0].bbox.x += 0.001; },
      selected => { selected.contextFragments![0].role = "ATTRIBUTE_HEADER"; },
      selected => { selected.contextFragments!.reverse(); },
    ];
    for (const mutate of mutations) {
      const value = fixture(), selected = fact(value);
      mutate(selected); rehash(value);
      expect(validateMatrixExecution(value.execution, value.input)).toBeNull();
    }
  });

  it("rejects dropping caption lines, context or TABLE_CONTEXT_UNVERIFIED instead of silently trusting the row", () => {
    for (const mode of ["caption", "context", "flag", "context-and-flag", "duplicate-context", "nine-contexts"]) {
      const value = fixture(), selected = fact(value);
      if (mode === "caption") selected.contextFragments = selected.contextFragments!.filter(item => !item.rawText.includes("ВЕДОМОСТЬ") && item.rawText !== "ДОРОЖЕК И ПЛОЩАДОК");
      if (["context", "context-and-flag"].includes(mode)) delete selected.contextFragments;
      if (mode.includes("flag")) selected.sourceFlags = (selected.sourceFlags as string[]).filter(flag => flag !== "TABLE_CONTEXT_UNVERIFIED");
      if (mode === "duplicate-context") selected.contextFragments![1] = structuredClone(selected.contextFragments![0]);
      if (mode === "nine-contexts") selected.contextFragments!.push(...structuredClone(selected.contextFragments!.slice(0, 3)));
      rehash(value);
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("rejects real roof, vehicle, lawn and asphalt cells substituted into the ground row", () => {
    for (const text of ["372 м²", "8м²", "42 м²", "68 м²", "7 м²"]) {
      const value = fixture(), selected = fact(value), replacement = originalLine(value, text);
      primary(selected)[4] = replacement;
      selected.value = text.match(/^\d+/u)![0]; selected.rawValue = selected.value; selected.rawUnit = "м²";
      rebuildPrimary(value);
      expect(validateMatrixExecution(value.execution, value.input), text).toBeNull();
    }
  });

  it("rejects changed original table semantics even when worker fragments and IDs are forged to match", () => {
    for (const mode of ["caption", "scope", "area-header", "ground-label", "surface-type"]) {
      const value = fixture(), selected = fact(value);
      if (mode === "caption") replaceOriginalLine(value, selected.contextFragments![0], "ВЕДОМОСТЬ ПРОЕЗДОВ НА КРОВЛЕ");
      if (mode === "scope") replaceOriginalLine(value, selected.contextFragments!.find(item => item.rawText === "(в гр. ГПЗУ)")!, "(за гр. ГПЗУ)");
      if (mode === "area-header") replaceOriginalLine(value, selected.contextFragments!.find(item => item.rawText === "покрытия, кв.м. в")!, "озеленения, кв.м. в");
      if (mode === "ground-label") replaceOriginalLine(value, primary(selected)[2], "по кровле автостоянки");
      if (mode === "surface-type") replaceOriginalLine(value, primary(selected)[3], "- тип 3а");
      rebuildPrimary(value);
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("independently detects competing original values, headings, scope and type cells", () => {
    for (const mode of ["value", "header", "scope", "caption", "type"]) {
      const value = fixture(), selected = fact(value);
      const fragment = mode === "value" ? primary(selected)[4] : mode === "type" ? primary(selected)[3]
        : mode === "scope" ? selected.contextFragments!.find(item => item.rawText === "(в гр. ГПЗУ)")!
        : mode === "header" ? selected.contextFragments!.find(item => item.role === "ATTRIBUTE_HEADER")!
        : selected.contextFragments![0];
      page(value).blocks.push(structuredClone(originalBlock(value, fragment)));
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("requires exact line geometry and keeps values inside their ground-table column", () => {
    for (const mode of ["missing-label-lines", "missing-caption-lines", "value-column", "value-row", "type-column"]) {
      const value = fixture(), selected = fact(value), original = page(value);
      if (mode.startsWith("missing")) {
        const fragment = mode === "missing-label-lines" ? primary(selected)[0] : selected.contextFragments![0];
        delete originalBlock(value, fragment).lineBboxesMilliPoints;
      } else {
        const fragment = mode === "type-column" ? primary(selected)[3] : primary(selected)[4];
        const block = originalBlock(value, fragment), [left, bottom, right, top] = block.bboxMilliPoints;
        const dx = mode.endsWith("column") ? original.widthMilliPoints / 3 : 0;
        const dy = mode === "value-row" ? original.heightMilliPoints / 10 : 0;
        block.bboxMilliPoints = [left + dx, bottom + dy, right + dx, top + dy];
        block.lineBboxesMilliPoints = block.lineBboxesMilliPoints?.map(bounds => [bounds[0] + dx, bounds[1] + dy, bounds[2] + dx, bounds[3] + dy]);
        fragment.bbox = originalLine(value, fragment.rawText).bbox;
        rebuildPrimary(value);
      }
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("rejects worker qualification and approval metadata without an authenticated source decision", () => {
    for (const mode of ["qualification", "approval", "revision", "entity"]) {
      const value = fixture(), selected = fact(value);
      if (mode === "qualification") {
        const row = value.execution.results.find(item => item.parameterCode === "SPZU-026")!;
        row.qualified = true; row.machineStatus = "CANDIDATE"; row.reasonCode = "CATALOG_TRIGGER_MATCHED";
      }
      if (mode === "approval") value.execution.metadata.find(item => item.sourceFileId === selected.sourceFileId)!.approvalStatus = "APPROVED";
      if (mode === "revision") value.execution.metadata.find(item => item.sourceFileId === selected.sourceFileId)!.revisionStatus = "CURRENT";
      if (mode === "entity") selected.entityKey = "forged-reviewed-sidewalk";
      rehash(value);
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("derives a six-context review target and clears only its exactly matched table limitation", () => {
    const value = fixture(), selected = fact(value);
    const original = value.input.sources.find(source => source.sourceFileId === selected.sourceFileId)!;
    const evidence = deriveMatrixFactTarget(selected, original.textArtifact);
    expect(evidence).not.toBeNull(); expect(evidence!.fragmentsHash).toMatch(/^[a-f0-9]{64}$/u);
    const { fragmentsHash, ...targetEvidence } = evidence!;
    const rule = { ruleId: "matrix-spzu-026-sidewalk_tile_area", version: "1", parameterCode: "SPZU-026",
      attribute: "SIDEWALK_TILE_AREA", canonicalUnit: "m2" };
    const binding = { ruleId: rule.ruleId, ruleVersion: rule.version, parameterCode: rule.parameterCode,
      entityKey: "controlled-ground-sidewalk", reference: "Controlled original ground row independently reviewed",
      target: { ...targetEvidence, checkId: "CHK-IMMUTABLE-TABLE-ORIGIN", executionContentHash: "e".repeat(64) }, contexts: {},
      tableContextReview: { fragmentsHash: "f".repeat(64), reference: "Caption, GPZU scope and area header independently reviewed" } };
    const source = { sourceFileId: original.sourceFileId, sha256: original.sha256, textArtifact: original.textArtifact!,
      scopeProofs: { FACT_BINDINGS: { schemaVersion: "matrix-fact-scopes-v1", bindings: [binding],
        sourceFileId: original.sourceFileId, sourceSha256: original.sha256, objectId: value.input.objectId,
        inputManifestHash: value.input.inputManifestHash, status: "VERIFIED", reference: "Authenticated inspector fact review snapshot" } } };
    selected.sourceFlags = ["SOURCE_APPROVAL_UNKNOWN", "SOURCE_REVISION_UNKNOWN", "TABLE_CONTEXT_UNVERIFIED"];
    let resolver = prepareMatrixFactBindings(source, value.input, [rule])!;
    expect(resolver.entity(selected)).toBe(binding.entityKey);
    expect(resolver.effectiveFlags(selected, rule, rule.parameterCode)).toContain("TABLE_CONTEXT_UNVERIFIED");
    binding.tableContextReview.fragmentsHash = fragmentsHash!;
    resolver = prepareMatrixFactBindings(source, value.input, [rule])!;
    expect(resolver.effectiveFlags(selected, rule, rule.parameterCode)).toEqual(["SOURCE_APPROVAL_UNKNOWN", "SOURCE_REVISION_UNKNOWN"]);
    expect(selected.sourceFlags).toContain("TABLE_CONTEXT_UNVERIFIED");
    expect(resolver.proof(selected, rule, rule.parameterCode, "RULE_SCOPE_COMPLETE:" + rule.ruleId)).toBeNull();
    expect(resolver.proof(selected, rule, rule.parameterCode, "APPROVED_CHANGE_STATUS")).toBeNull();
    selected.contextFragments![0].rawText += " altered caption";
    expect(prepareMatrixFactBindings(source, value.input, [rule])!.entity(selected)).toBeNull();
  });
});
