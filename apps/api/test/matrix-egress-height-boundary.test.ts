import type { MatrixFactScopeBinding, MatrixObservation } from "@inspector-ai/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { matrixPresentation, matrixRegistry, validateMatrixExecution } from "../src/matrix-execution.js";
import { deriveMatrixFactTarget } from "../src/matrix-fact-scope.js";
import { computeMatrixCoverage, verifyMatrixAtomicResults } from "../src/matrix-rule-verifier.js";
import { loadMatrixGoldenFixtures, type MatrixGoldenFixture } from "./matrix-golden-fixtures.js";
import { pythonAvailable } from "./python.js";

const specs = {
  corridor: { ruleId: "matrix-ar-042-evacuation_corridor_clear_height", attribute: "EVACUATION_CORRIDOR_CLEAR_HEIGHT",
    label: "Высота эвакуационного коридора в свету", role: "EVACUATION_CORRIDOR_CLEARANCE", threshold: "2", actual: "1.99",
    basis: "CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION" },
  door: { ruleId: "matrix-ar-042-evacuation_door_clear_height", attribute: "EVACUATION_DOOR_CLEAR_HEIGHT",
    label: "Высота эвакуационной двери в свету", role: "EVACUATION_DOOR_CLEARANCE", threshold: "1.9", actual: "1.89",
    basis: "CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD" },
} as const;
type Kind = keyof typeof specs;
type Envelope = { bindings: MatrixFactScopeBinding[]; [key: string]: unknown };
type Fragment = { blockId: string; rawText: string; bbox: MatrixObservation["bbox"] };

function fixture(kind: Kind, scenario = "qualified"): MatrixGoldenFixture {
  const found = loadMatrixGoldenFixtures().find(value => value.name === `egress:${kind}:${scenario}`);
  if (!found) throw new Error(`Egress ${kind} v2 golden missing`);
  return structuredClone(found);
}
function envelope(value: MatrixGoldenFixture, sourceIndex: number): Envelope {
  const result = value.input.sources[sourceIndex].review!.scopeProofs!.FACT_BINDINGS as Envelope;
  if (!result?.bindings?.length) throw new Error("Exact-fact binding golden required");
  return result;
}
function binding(value: MatrixGoldenFixture, sourceIndex: number): MatrixFactScopeBinding {
  return envelope(value, sourceIndex).bindings[0];
}
function selectedFact(value: MatrixGoldenFixture, stage: "PD" | "RD"): MatrixObservation {
  return value.execution.observations.find(item => item.stage === stage)!;
}
function row(value: MatrixGoldenFixture, kind: Kind) {
  return value.execution.results.find(item => item.ruleId === specs[kind].ruleId)!;
}

/** Keep worker selectors and authenticated targets internally consistent, so lexical rejection is meaningful. */
function replaceOriginalLiteral(value: MatrixGoldenFixture, stage: "PD" | "RD", rawText: string,
  rawValue: string, rawUnit: string, normalizedValue?: string) {
  const fact = selectedFact(value, stage), previousId = fact.id;
  const source = value.input.sources.find(item => item.sourceFileId === fact.sourceFileId)!;
  const artifact = source.textArtifact!;
  const page = (artifact.pages as Array<{ pageNumber: number; blocks: Array<{ text: string }> }>)
    .find(item => item.pageNumber === fact.pageNumber)!;
  const fragments = fact.evidenceFragments as Fragment[];
  expect(fragments).toHaveLength(1);
  const [blockIndex, lineIndex] = fragments[0].blockId.split(":").map(Number);
  const lines = page.blocks[blockIndex].text.split(/\r?\n/u);
  lines[lineIndex] = rawText; page.blocks[blockIndex].text = lines.join("\n");
  fragments[0].rawText = rawText; fact.rawText = rawText; fact.rawValue = rawValue; fact.rawUnit = rawUnit;
  if (normalizedValue !== undefined) fact.value = normalizedValue;
  fact.id = sha256(canonicalJson({ sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
    stage: fact.stage, pageNumber: fact.pageNumber, blockIds: fragments.map(item => item.blockId),
    attribute: fact.attribute, value: fact.value, unit: fact.unit }));
  const target = deriveMatrixFactTarget(fact, artifact);
  expect(target).not.toBeNull();
  const review = (source.review!.scopeProofs!.FACT_BINDINGS as Envelope).bindings[0];
  Object.assign(review.target, { observationId: target!.observationId,
    evidenceHash: target!.evidenceHash, textArtifactHash: target!.textArtifactHash });
  for (const result of value.execution.results) {
    if (result.expectedObservationId === previousId) { result.expectedObservationId = fact.id; result.expectedValue = fact.value; }
    if (result.actualObservationId === previousId) { result.actualObservationId = fact.id; result.actualValue = fact.value; }
  }
}

describe.skipIf(!pythonAvailable)("egress height independent source boundary", () => {
  beforeAll(() => { loadMatrixGoldenFixtures(); }, 60_000);

  it("accepts two narrowly reviewed literal height atoms while retaining partial scope and uncalibrated candidates", () => {
    for (const kind of ["corridor", "door"] as const) {
      const value = fixture(kind), verified = validateMatrixExecution(value.execution, value.input);
      expect(verified, kind).not.toBeNull();
      expect(verified!.observations).toHaveLength(2);
      expect(row(value, kind)).toMatchObject({ parameterCode: "AR-042", comparisonVariant: "PD_RD",
        machineStatus: "CANDIDATE", reasonCode: "CATALOG_TRIGGER_MATCHED", qualified: true,
        expectedValue: "2.1", actualValue: specs[kind].actual });
      for (const index of [0, 1]) {
        const scope = binding(value, index), atomic = scope.contexts[`ATOMIC_SUBRULE_SCOPE:${specs[kind].ruleId}`];
        expect(scope.ruleId).toBe(specs[kind].ruleId);
        expect(Object.keys(scope.contexts)).toHaveLength(3);
        expect(scope.contexts.NORM_APPLICABILITY_VERIFIED).toMatchObject({ applicable: true, parameterCode: "AR-042",
          attribute: specs[kind].attribute, threshold: specs[kind].threshold, canonicalUnit: "m" });
        expect(atomic).toMatchObject({ componentRole: specs[kind].role, operatingModeKey: "EVACUATION",
          measurementBasisKey: specs[kind].basis });
      }
      expect(verified!.coverage.find(item => item.parameterCode === "AR-042")).toMatchObject({
        executionStatus: "PARTIAL", implementedAtomicRules: 2, successfulComparisons: 1 });
      expect(matrixPresentation(verified!).every(item => item.confidence.calibratedProbability === null)).toBe(true);
    }
  });

  it("accepts independently recomputed abstentions at the exact bound, outside the project baseline and without each reviewed condition", () => {
    const reasons: Record<string, string> = { equality: "NEGATIVE_SCOPE_UNVERIFIED", "baseline-below": "PROJECT_BASELINE_OUTSIDE_BOUND",
      "norm-false": "CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED", "missing-norm": "CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED",
      "wrong-norm-threshold": "CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED" };
    for (const kind of ["corridor", "door"] as const) for (const scenario of ["equality", "baseline-below", "norm-false", "missing-norm",
      "wrong-norm-threshold", "nominal", "wrong-purpose", "mismatched-zone"]) {
      const value = fixture(kind, scenario);
      expect(validateMatrixExecution(value.execution, value.input), `${kind}:${scenario}`).not.toBeNull();
      expect(row(value, kind)).toMatchObject({ qualified: false, reasonCode: reasons[scenario]
        ?? `CONTEXT_UNVERIFIED:ATOMIC_SUBRULE_SCOPE:${specs[kind].ruleId}` });
      expect(value.execution.coverage.find(item => item.parameterCode === "AR-042")!.executionStatus).toBe("PARTIAL");
    }
  });

  it("accepts original millimetres and centimetres only after exact conversion into metres and fresh fact targets", () => {
    for (const [kind, rawValue, rawUnit] of [["corridor", "1990", "мм"], ["door", "189", "см"]] as const) {
      const value = fixture(kind);
      replaceOriginalLiteral(value, "RD", `${specs[kind].label}: ${rawValue} ${rawUnit}`, rawValue, rawUnit);
      expect(validateMatrixExecution(value.execution, value.input), kind).not.toBeNull();
      expect(row(value, kind).actualValue).toBe(specs[kind].actual);
    }
  });

  it("rejects candidate claims when either exact fact lacks its own applicable norm, threshold, attribute or unit", () => {
    for (const kind of ["corridor", "door"] as const) for (const sourceIndex of [0, 1]) {
      const changes: Array<[string, unknown]> = [["applicable", false], ["applicable", undefined],
        ["parameterCode", "AR-040"], ["attribute", specs[kind === "door" ? "corridor" : "door"].attribute],
        ["threshold", kind === "door" ? "2" : "2.0"], ["canonicalUnit", "mm"]];
      for (const [field, changed] of changes) {
        const value = fixture(kind), context = binding(value, sourceIndex).contexts.NORM_APPLICABILITY_VERIFIED;
        if (changed === undefined) delete (context as Record<string, unknown>)[field];
        else (context as Record<string, unknown>)[field] = changed;
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${sourceIndex}:${field}`).toBeNull();
      }
    }
  });

  it("requires route proof and four matched identities with the selected physical basis, even if both sides agree on a wrong basis", () => {
    for (const kind of ["corridor", "door"] as const) {
      const key = `ATOMIC_SUBRULE_SCOPE:${specs[kind].ruleId}`;
      for (const missing of ["EVACUATION_ROUTE_IDENTITY", key]) {
        const value = fixture(kind); delete binding(value, 1).contexts[missing];
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${missing}`).toBeNull();
      }
      for (const field of ["componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey", "componentRole"] as const) {
        const value = fixture(kind); binding(value, 1).contexts[key][field] = "different-component-or-physical-basis";
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${field}`).toBeNull();
      }
      for (const wrong of [{ operatingModeKey: "NON_EVACUATION" }, { measurementBasisKey: "NOMINAL_ROOM_HEIGHT" },
        { measurementBasisKey: specs[kind === "door" ? "corridor" : "door"].basis }]) {
        const value = fixture(kind);
        for (const index of [0, 1]) Object.assign(binding(value, index).contexts[key], wrong);
        expect(validateMatrixExecution(value.execution, value.input), `${kind}:${JSON.stringify(wrong)}`).toBeNull();
      }
    }
  });

  it("rejects neighbouring-atom borrowing, empty fact scopes and unapproved or superseded originals", () => {
    for (const kind of ["corridor", "door"] as const) for (const mode of ["other-rule", "other-role", "empty",
      "replayed-source", "unapproved", "superseded", "different-pair", "foreign-target"]) {
      const value = fixture(kind), scope = binding(value, 1), other = specs[kind === "door" ? "corridor" : "door"];
      if (mode === "other-rule") scope.ruleId = other.ruleId;
      if (mode === "other-role") scope.contexts[`ATOMIC_SUBRULE_SCOPE:${specs[kind].ruleId}`].componentRole = other.role;
      if (mode === "empty") envelope(value, 1).bindings = [];
      if (mode === "replayed-source") envelope(value, 1).sourceSha256 = value.input.sources[0].sha256;
      if (mode === "foreign-target") scope.target.observationId = selectedFact(value, "PD").id;
      if (mode === "unapproved") value.input.sources[1].review!.approvalStatus = "UNKNOWN";
      if (mode === "superseded") value.input.sources[1].review!.revisionStatus = "SUPERSEDED";
      if (mode === "different-pair") row(value, kind).comparisonVariant = "PD_ID";
      expect(validateMatrixExecution(value.execution, value.input), `${kind}:${mode}`).toBeNull();
    }
  });

  it("rejects room, rough-opening and nominal leaf dimensions masquerading as original clear-height facts", () => {
    const decoys = [["corridor", "Высота помещения: 1.99 м"], ["corridor", "Высота строительного проёма: 1.99 м"],
      ["door", "Высота полотна двери: 1.89 м"], ["corridor", "Высота эвакуационного коридора в свету: от 1.99 до 2.1 м"],
      ["door", "Высота эвакуационной двери в свету: 1.89 или 2.1 м"]] as const;
    for (const [kind, rawText] of decoys) {
      const value = fixture(kind);
      replaceOriginalLiteral(value, "RD", rawText, specs[kind].actual, "м");
      expect(validateMatrixExecution(value.execution, value.input), rawText).toBeNull();
    }
  });

  it("does not permit worker coverage, geometry or evidence replacement to create verified height findings", () => {
    for (const mode of ["complete", "extra-comparison", "geometry", "raw-value", "original", "id-reuse"]) {
      const value = fixture("corridor"), fact = selectedFact(value, "RD");
      if (mode === "complete") value.execution.coverage.find(item => item.parameterCode === "AR-042")!.executionStatus = "EVALUATED";
      if (mode === "extra-comparison") value.execution.coverage.find(item => item.parameterCode === "AR-042")!.successfulComparisons++;
      if (mode === "geometry") fact.bbox.x += 0.001;
      if (mode === "raw-value") fact.rawValue = "2.01";
      if (mode === "original") (value.input.sources[1].textArtifact!.pages as Array<{ blocks: Array<{ text: string }> }>)[0].blocks[0].text = "Высота помещения: 1.99 м";
      if (mode === "id-reuse") row(value, "corridor").actualObservationId = selectedFact(value, "PD").id;
      expect(validateMatrixExecution(value.execution, value.input), mode).toBeNull();
    }
  });

  it("rejects stripping the known height policy and atomic proof together or falling back to an older decrease role", () => {
    type MutableRegistry = { entries: Array<{ parameterCode: string; atomicRules: Array<Record<string, unknown>> }> };
    for (const kind of ["corridor", "door"] as const) for (const mode of ["both-identities", "known-rule-only", "known-attribute-only", "legacy-role"]) {
      const value = fixture(kind), registry = structuredClone(matrixRegistry) as unknown as MutableRegistry;
      const rule = registry.entries.find(entry => entry.parameterCode === "AR-042")!.atomicRules
        .find(item => item.ruleId === specs[kind].ruleId)!;
      if (mode === "legacy-role") {
        (rule.subruleContext as Record<string, unknown>).componentRole = "POTABLE_WATER_PUMP";
        Object.assign(rule, { family: "DECREASE", threshold: null, requiredContext: [`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`] });
      } else {
        delete rule.subruleContext; rule.requiredContext = ["NORM_APPLICABILITY_VERIFIED", "EVACUATION_ROUTE_IDENTITY"];
        if (mode === "known-rule-only") rule.attribute = "ROOM_HEIGHT";
        if (mode === "known-attribute-only") rule.ruleId = "matrix-unrelated-height";
      }
      // Rehash the proposed registry so rejection cannot be caused by the outer digest gate.
      value.execution.registryHash = sha256(canonicalJson(registry));
      expect(() => computeMatrixCoverage(value.execution, value.input, registry), `${kind}:${mode}`)
        .toThrow(mode === "legacy-role" ? "Invalid subrule context" : "Missing egress height policy");
      expect(verifyMatrixAtomicResults(value.execution, value.input, registry), `${kind}:${mode}`).toBe(false);
    }
  });
});
