import assert from "node:assert/strict";
import { test } from "vitest";
import { classifyMachineConfidence, MACHINE_CONFIDENCE_POLICY_V1,
  NOT_ESTIMABLE_MACHINE_CONFIDENCE, parseMachineConfidence,
  type MachineConfidenceEnvelope } from "../../../packages/contracts/src/machine-confidence.js";

const envelope = (p: number): MachineConfidenceEnvelope => ({ confidenceKind: "CALIBRATED",
  calibratedProbability: p, calibrationVersion: "heldout-objects-rules-v1",
  extractionScore: 0.99, linkingScore: 0.95 });
const classify = (p: number) => classifyMachineConfidence({ confidence: envelope(p),
  evidenceQualified: true, expectedCalibrationVersion: "heldout-objects-rules-v1" });

test("raw calibrated threshold: 0.7996 stays candidate, exactly 0.80 is warning", () => {
  assert.equal(classify(0.7996).machineDisposition, "CANDIDATE");
  assert.equal(classify(0.7996).reasonCode, "BELOW_WARNING_THRESHOLD");
  assert.equal(classify(0.8).machineDisposition, "WARNING");
  assert.equal(classify(0.8).reasonCode, "CALIBRATED_THRESHOLD_MET");
  assert.equal(classify(1).machineDisposition, "WARNING");
  assert.equal(classify(0).machineDisposition, "CANDIDATE");
  assert.equal(MACHINE_CONFIDENCE_POLICY_V1.warningThreshold, 0.8);
});

test("null, legacy scalars, self-reported probability and invalid values never promote", () => {
  for (const confidence of [null, 0.99, { confidence: 0.99 }, { ...envelope(0.99), selfReported: true },
    envelope(Number.NaN), envelope(Infinity), envelope(-0.1), envelope(1.01),
    { ...envelope(0.99), extractionScore: 42 }, { ...envelope(0.99), calibrationVersion: "" }]) {
    const result = classifyMachineConfidence({ confidence, evidenceQualified: true,
      expectedCalibrationVersion: "heldout-objects-rules-v1" });
    assert.equal(result.machineDisposition, "CANDIDATE");
    assert.equal(result.reasonCode, "INVALID_CONFIDENCE_ENVELOPE");
    assert.equal(result.confidence.calibratedProbability, null);
  }
});

test("OOD and NOT_ESTIMABLE keep null probability despite high OCR/linking scores", () => {
  for (const confidenceKind of ["NOT_ESTIMABLE", "OUT_OF_DOMAIN"] as const) {
    const confidence = { ...NOT_ESTIMABLE_MACHINE_CONFIDENCE, confidenceKind,
      extractionScore: 1, linkingScore: 1 };
    const result = classifyMachineConfidence({ confidence, evidenceQualified: true });
    assert.equal(result.machineDisposition, "CANDIDATE");
    assert.equal(result.confidence.calibratedProbability, null);
    assert.equal(result.reasonCode, confidenceKind === "OUT_OF_DOMAIN"
      ? "CONFIDENCE_OUT_OF_DOMAIN" : "CONFIDENCE_NOT_ESTIMABLE");
    assert.equal(parseMachineConfidence({ ...confidence, calibratedProbability: 0.99 }), null);
  }
});

test("calibration independently pinned for release and qualified evidence both required", () => {
  const confidence = envelope(0.99);
  assert.equal(classifyMachineConfidence({ confidence, evidenceQualified: true }).reasonCode,
    "CALIBRATION_NOT_PINNED");
  assert.equal(classifyMachineConfidence({ confidence, evidenceQualified: true,
    expectedCalibrationVersion: "other-domain-v2" }).reasonCode, "CALIBRATION_VERSION_MISMATCH");
  assert.equal(classifyMachineConfidence({ confidence, evidenceQualified: false,
    expectedCalibrationVersion: confidence.calibrationVersion }).reasonCode, "EVIDENCE_NOT_QUALIFIED");
});

test("technical failure remains distinct; no human CONFIRMED value is manufactured", () => {
  const result = classifyMachineConfidence({ confidence: envelope(0.99), evidenceQualified: true,
    expectedCalibrationVersion: "heldout-objects-rules-v1", technicalFailure: true });
  assert.equal(result.machineDisposition, "TECHNICAL_FAILURE");
  assert.equal(result.reasonCode, "TECHNICAL_FAILURE");
  assert.equal(Object.hasOwn(result, "reviewStatus"), false);
  assert.equal(Object.hasOwn(result, "severity"), false);
  assert.throws(() => classifyMachineConfidence({ confidence: envelope(1), evidenceQualified: true,
    policy: { policyVersion: "bad", warningThreshold: Number.NaN } }), /Invalid machine confidence policy/);
  assert.throws(() => classifyMachineConfidence({ confidence: envelope(1), evidenceQualified: true,
    policy: { policyVersion: "machine-confidence-policy-v1", warningThreshold: 0.7 } }), /Invalid machine confidence policy/);
});
