import { NOT_ESTIMABLE_MACHINE_CONFIDENCE, parseMachineConfidence,
  type MachineConfidencePolicy, type MachineConfidencePresentation,
  type MachineConfidenceReason } from "./machine-confidence.js";

/** Strictly greater than 80%. Historical policy v1 remains unchanged. */
export const MACHINE_CONFIDENCE_POLICY_V2: Readonly<MachineConfidencePolicy> = Object.freeze({
  policyVersion: "machine-confidence-policy-v2",
  warningThreshold: 0.8,
});

export type MachineConfidenceReasonV2 = Exclude<MachineConfidenceReason,
  "CALIBRATED_THRESHOLD_MET" | "BELOW_WARNING_THRESHOLD">
  | "CALIBRATED_THRESHOLD_EXCEEDED" | "AT_OR_BELOW_WARNING_THRESHOLD";

export interface MachineConfidencePresentationV2 extends Omit<MachineConfidencePresentation, "reasonCode"> {
  reasonCode: MachineConfidenceReasonV2;
}

const version = (value: unknown): value is string => typeof value === "string"
  && value.trim() === value && value.length > 0 && value.length <= 256;

/**
 * Presentation only: never changes rule severity, status or authenticated human decisions.
 * The release independently pins calibration for the rule/data domain; scores are diagnostic.
 * Uses the established five-field decoder. Rounded percentages never decide promotion.
 */
export function classifyMachineConfidenceV2(input: {
  confidence: unknown;
  evidenceQualified: boolean;
  technicalFailure?: boolean;
  expectedCalibrationVersion?: string | null;
  policy?: Readonly<MachineConfidencePolicy>;
}): MachineConfidencePresentationV2 {
  const policy = input.policy ?? MACHINE_CONFIDENCE_POLICY_V2;
  if (policy.policyVersion !== MACHINE_CONFIDENCE_POLICY_V2.policyVersion
    || policy.warningThreshold !== MACHINE_CONFIDENCE_POLICY_V2.warningThreshold) {
    throw new TypeError("Invalid machine confidence policy");
  }
  const decoded = parseMachineConfidence(input.confidence);
  const confidence = decoded ?? { ...NOT_ESTIMABLE_MACHINE_CONFIDENCE };
  const result = (machineDisposition: MachineConfidencePresentationV2["machineDisposition"],
    reasonCode: MachineConfidenceReasonV2): MachineConfidencePresentationV2 => ({ machineDisposition,
    reasonCode, confidence, policyVersion: policy.policyVersion, warningThreshold: policy.warningThreshold });
  if (input.technicalFailure === true) return result("TECHNICAL_FAILURE", "TECHNICAL_FAILURE");
  if (!decoded) return result("CANDIDATE", "INVALID_CONFIDENCE_ENVELOPE");
  if (decoded.confidenceKind === "OUT_OF_DOMAIN") return result("CANDIDATE", "CONFIDENCE_OUT_OF_DOMAIN");
  if (decoded.confidenceKind === "NOT_ESTIMABLE") return result("CANDIDATE", "CONFIDENCE_NOT_ESTIMABLE");
  if (!version(input.expectedCalibrationVersion)) return result("CANDIDATE", "CALIBRATION_NOT_PINNED");
  if (decoded.calibrationVersion !== input.expectedCalibrationVersion) {
    return result("CANDIDATE", "CALIBRATION_VERSION_MISMATCH");
  }
  if (input.evidenceQualified !== true) return result("CANDIDATE", "EVIDENCE_NOT_QUALIFIED");
  return decoded.calibratedProbability! > policy.warningThreshold
    ? result("WARNING", "CALIBRATED_THRESHOLD_EXCEEDED")
    : result("CANDIDATE", "AT_OR_BELOW_WARNING_THRESHOLD");
}
