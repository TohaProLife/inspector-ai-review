/** Machine correctness probability is independent of OCR/linking scores and human review. */
export type MachineConfidenceKind = "CALIBRATED" | "NOT_ESTIMABLE" | "OUT_OF_DOMAIN";

export interface MachineConfidenceEnvelope {
  confidenceKind: MachineConfidenceKind;
  calibratedProbability: number | null;
  calibrationVersion: string | null;
  extractionScore: number | null;
  linkingScore: number | null;
}

export interface MachineConfidencePolicy {
  policyVersion: string;
  warningThreshold: number;
}

export const MACHINE_CONFIDENCE_POLICY_V1: Readonly<MachineConfidencePolicy> = Object.freeze({
  policyVersion: "machine-confidence-policy-v1",
  warningThreshold: 0.8,
});

export const NOT_ESTIMABLE_MACHINE_CONFIDENCE: Readonly<MachineConfidenceEnvelope> = Object.freeze({
  confidenceKind: "NOT_ESTIMABLE",
  calibratedProbability: null,
  calibrationVersion: null,
  extractionScore: null,
  linkingScore: null,
});

export type MachineConfidenceReason = "CALIBRATED_THRESHOLD_MET" | "BELOW_WARNING_THRESHOLD"
  | "CONFIDENCE_NOT_ESTIMABLE" | "CONFIDENCE_OUT_OF_DOMAIN" | "INVALID_CONFIDENCE_ENVELOPE"
  | "CALIBRATION_NOT_PINNED" | "CALIBRATION_VERSION_MISMATCH" | "EVIDENCE_NOT_QUALIFIED"
  | "TECHNICAL_FAILURE";

export interface MachineConfidencePresentation {
  machineDisposition: "CANDIDATE" | "WARNING" | "TECHNICAL_FAILURE";
  reasonCode: MachineConfidenceReason;
  confidence: MachineConfidenceEnvelope;
  policyVersion: string;
  warningThreshold: number;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === "object" && !Array.isArray(value);
const probability = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value) && value >= 0 && value <= 1;
const optionalScore = (value: unknown): value is number | null => value === null || probability(value);
const version = (value: unknown): value is string => typeof value === "string"
  && value.trim() === value && value.length > 0 && value.length <= 256;

/** Strict decoding prevents an old scalar or a model self-report becoming a calibrated probability. */
export function parseMachineConfidence(value: unknown): MachineConfidenceEnvelope | null {
  if (!record(value) || Object.keys(value).length !== 5
    || !["confidenceKind", "calibratedProbability", "calibrationVersion", "extractionScore", "linkingScore"]
      .every((key) => Object.hasOwn(value, key))
    || !optionalScore(value.extractionScore) || !optionalScore(value.linkingScore)) return null;
  const confidenceKind = value.confidenceKind;
  if (confidenceKind === "CALIBRATED") {
    if (!probability(value.calibratedProbability) || !version(value.calibrationVersion)) return null;
  } else if (confidenceKind === "NOT_ESTIMABLE" || confidenceKind === "OUT_OF_DOMAIN") {
    // Keeping a stale probability on OOD data invites accidental sorting/presentation as certainty.
    if (value.calibratedProbability !== null || value.calibrationVersion !== null) return null;
  } else return null;
  return { confidenceKind, calibratedProbability: value.calibratedProbability as number | null,
    calibrationVersion: value.calibrationVersion as string | null,
    extractionScore: value.extractionScore, linkingScore: value.linkingScore };
}

/**
 * Presentation only. A warning never changes severity, rule status or authenticated human decisions.
 * The release must independently pin calibrationVersion for the current rule/data domain before use.
 */
export function classifyMachineConfidence(input: {
  confidence: unknown;
  evidenceQualified: boolean;
  technicalFailure?: boolean;
  expectedCalibrationVersion?: string | null;
  policy?: Readonly<MachineConfidencePolicy>;
}): MachineConfidencePresentation {
  const policy = input.policy ?? MACHINE_CONFIDENCE_POLICY_V1;
  if (policy.policyVersion !== MACHINE_CONFIDENCE_POLICY_V1.policyVersion
    || policy.warningThreshold !== MACHINE_CONFIDENCE_POLICY_V1.warningThreshold) {
    throw new TypeError("Invalid machine confidence policy");
  }
  const decoded = parseMachineConfidence(input.confidence);
  const confidence = decoded ?? { ...NOT_ESTIMABLE_MACHINE_CONFIDENCE };
  const result = (machineDisposition: MachineConfidencePresentation["machineDisposition"],
    reasonCode: MachineConfidenceReason): MachineConfidencePresentation => ({ machineDisposition,
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
  return decoded.calibratedProbability! >= policy.warningThreshold
    ? result("WARNING", "CALIBRATED_THRESHOLD_MET")
    : result("CANDIDATE", "BELOW_WARNING_THRESHOLD");
}
