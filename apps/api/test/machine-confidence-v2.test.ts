import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { classifyMachineConfidenceV2, MACHINE_CONFIDENCE_POLICY_V2 } from "../../../packages/contracts/src/machine-confidence-v2.js";
import { classifyMachineConfidence, MACHINE_CONFIDENCE_POLICY_V1, NOT_ESTIMABLE_MACHINE_CONFIDENCE,
  parseMachineConfidence, type MachineConfidenceEnvelope } from "../../../packages/contracts/src/machine-confidence.js";
import manual from "../../../fixtures/machine-confidence-v2/manual-goldens.json";

const envelope = (p: number): MachineConfidenceEnvelope => ({ confidenceKind: "CALIBRATED",
  calibratedProbability: p, calibrationVersion: "heldout-objects-rules-v1",
  extractionScore: 0.99, linkingScore: 0.95 });
const classify = (confidence: unknown, context: Record<string, unknown> = {}) => classifyMachineConfidenceV2({
  confidence, evidenceQualified: true, expectedCalibrationVersion: "heldout-objects-rules-v1", ...context });

test("v2 whole manual outputs, including raw exact 80% and adjacent greater float", () => {
  assert.equal(manual.cases.length, 18);
  for (const fixture of manual.cases) {
    assert.deepEqual(classifyMachineConfidenceV2(fixture.input), fixture.expected, fixture.id);
  }
  const p = 0.8000000000000002;
  assert.equal(p - 0.8, 2 ** -53);
  assert.equal((p * 100).toFixed(2), "80.00");
  assert.equal((0.8 * 100).toFixed(2), "80.00");
  assert.equal(classify(envelope(0.8)).machineDisposition, "CANDIDATE");
  assert.equal(classify(envelope(p)).machineDisposition, "WARNING");
});

test("native invalid probabilities, scores, versions, kinds, and scalar envelopes never promote", () => {
  for (const confidence of [undefined, true, "0.99", [], envelope(Number.NaN), envelope(Infinity),
    envelope(-Infinity), envelope(-0.1), envelope(1.01),
    { ...envelope(0.99), calibratedProbability: "0.99" },
    { ...envelope(0.99), extractionScore: Number.NaN }, { ...envelope(0.99), linkingScore: 1.01 },
    { ...envelope(0.99), calibrationVersion: "" }, { ...envelope(0.99), calibrationVersion: " padded" },
    { ...envelope(0.99), calibrationVersion: "padded " }, { ...envelope(0.99), calibrationVersion: "x".repeat(257) },
    { ...envelope(0.99), confidenceKind: "MODEL_SELF_REPORTED" }]) {
    const result = classify(confidence);
    assert.equal(result.machineDisposition, "CANDIDATE");
    assert.equal(result.reasonCode, "INVALID_CONFIDENCE_ENVELOPE");
    assert.deepEqual(result.confidence, NOT_ESTIMABLE_MACHINE_CONFIDENCE);
  }
});

test("pinned calibration and qualified evidence must be exact, independent inputs", () => {
  for (const expectedCalibrationVersion of [undefined, null, "", " padded", "x".repeat(257)]) {
    assert.equal(classify(envelope(1), { expectedCalibrationVersion }).reasonCode, "CALIBRATION_NOT_PINNED");
  }
  assert.equal(classify(envelope(1), { expectedCalibrationVersion: "heldout-objects-rules-v2" }).reasonCode,
    "CALIBRATION_VERSION_MISMATCH");
  for (const evidenceQualified of [false, null, undefined, 1, "true"]) {
    assert.equal(classify(envelope(1), { evidenceQualified }).reasonCode, "EVIDENCE_NOT_QUALIFIED");
  }
  assert.equal(classify(envelope(1), { technicalFailure: "true" }).machineDisposition, "WARNING");
});

test("fixed v2 policy rejects historical, altered, and invalid policy values before presentation", () => {
  assert.deepEqual(MACHINE_CONFIDENCE_POLICY_V2,
    { policyVersion: "machine-confidence-policy-v2", warningThreshold: 0.8 });
  assert.equal(Object.isFrozen(MACHINE_CONFIDENCE_POLICY_V2), true);
  for (const policy of [MACHINE_CONFIDENCE_POLICY_V1,
    { policyVersion: "bad", warningThreshold: 0.8 },
    { policyVersion: "machine-confidence-policy-v2", warningThreshold: 0.7 },
    { policyVersion: "machine-confidence-policy-v2", warningThreshold: 0.8000000000000002 },
    { policyVersion: "machine-confidence-policy-v2", warningThreshold: Number.NaN },
    { policyVersion: "machine-confidence-policy-v2", warningThreshold: Infinity }]) {
    assert.throws(() => classifyMachineConfidenceV2({ confidence: envelope(1), evidenceQualified: true,
      technicalFailure: true, policy }), /Invalid machine confidence policy/);
  }
});

test("returned envelopes are detached; no score or human decision becomes correctness probability", () => {
  const confidence = envelope(0.99);
  const before = structuredClone(confidence);
  const input = Object.freeze({ confidence: Object.freeze(confidence), evidenceQualified: true,
    expectedCalibrationVersion: confidence.calibrationVersion });
  const result = classifyMachineConfidenceV2(input);
  assert.deepEqual(confidence, before);
  assert.notEqual(result.confidence, confidence);
  result.confidence.calibratedProbability = 0;
  assert.equal(confidence.calibratedProbability, 0.99);
  assert.equal(Object.hasOwn(result, "reviewStatus"), false);
  assert.equal(Object.hasOwn(result, "severity"), false);
  assert.equal(Object.hasOwn(result, "ruleStatus"), false);
  for (const confidenceKind of ["NOT_ESTIMABLE", "OUT_OF_DOMAIN"] as const) {
    const unknown = { ...NOT_ESTIMABLE_MACHINE_CONFIDENCE, confidenceKind, extractionScore: 1, linkingScore: 1 };
    const candidate = classify(unknown);
    assert.equal(candidate.machineDisposition, "CANDIDATE");
    assert.equal(candidate.confidence.calibratedProbability, null);
    assert.equal(parseMachineConfidence({ ...unknown, calibratedProbability: 0.99 }), null);
  }
});

test("technical failures remain distinct and preserve valid diagnostics without decisions", () => {
  for (const confidence of [envelope(1), null, { ...NOT_ESTIMABLE_MACHINE_CONFIDENCE, confidenceKind: "OUT_OF_DOMAIN" }]) {
    const result = classify(confidence, { technicalFailure: true, evidenceQualified: false,
      expectedCalibrationVersion: null });
    assert.equal(result.machineDisposition, "TECHNICAL_FAILURE");
    assert.equal(result.reasonCode, "TECHNICAL_FAILURE");
    assert.equal(Object.hasOwn(result, "reviewStatus"), false);
  }
});

test("frozen v1 source/test bytes and historical exact-cutoff behavior remain unchanged", () => {
  for (const [path, expected] of [
    ["../../../packages/contracts/src/machine-confidence.ts", "5aec2863be23a3eb69b9b0cf5d5cf4aa4c59c075116af4d715ffc0820423a398"],
    ["./machine-confidence.test.ts", "26a03ef05cfa42e882d100f226d03d5e27ac1c2242285ee3c4c90f428bb9ea4c"],
  ]) assert.equal(createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex"), expected);
  const input = { confidence: envelope(0.8), evidenceQualified: true,
    expectedCalibrationVersion: "heldout-objects-rules-v1" };
  assert.equal(classifyMachineConfidence(input).machineDisposition, "WARNING");
  assert.equal(classifyMachineConfidenceV2(input).machineDisposition, "CANDIDATE");
  assert.equal(classifyMachineConfidence(input).policyVersion, "machine-confidence-policy-v1");
});
