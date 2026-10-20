import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { historicalConcreteWallReadIdentityV13, matrixStoredReadPolicyForReleaseV13,
  matrixFullPolicyForProfile, MATRIX_CONCRETE_WALL_V13_PROFILE,
  selectMatrixRuntimePolicy } from "../src/matrix-concrete-wall-profile-v13.js";

function release(old: boolean): Record<string, any> {
  const current = matrixFullPolicyForProfile(MATRIX_CONCRETE_WALL_V13_PROFILE)!;
  expect(current).not.toBeNull();
  const definitions = structuredClone(current.definitions) as Record<string, any>;
  if (old) definitions.concreteWallExecution.sourcePins["concrete_wall_transport_v13.py"] = historicalConcreteWallReadIdentityV13.transportSourceHash;
  const slots = [["DOCUMENT_RENDER", "RENDERER"], ["DOCUMENT_OCR_LAYOUT", "OCR_LAYOUT"],
    ["DOCUMENT_METADATA", "METADATA_EXTRACTOR"], ["DOCUMENT_LINKING", "LINKING_POLICY"],
    ["ENTITY_EXTRACTION", "ENTITY_EXTRACTION_MODEL"], ["RULE_EVALUATION", "RULE_ENGINE"],
    ["EVIDENCE_VALIDATION", "EVIDENCE_VALIDATOR"]];
  const configHash = sha256(canonicalJson(definitions));
  return identify({ schemaVersion: "analysis-release-v1", lifecycle: "DRAFT", externalNetworkAllowed: false,
    textLayer: { artifactSchemaVersion: "document-text-v2", qualityPolicyVersion: "text-layer-quality-v2" },
    rules: { catalogVersion: "matrix-132-v1", parameterCount: 132, executionStatus: "PILOT", matrixDefinitions: definitions },
    providerSlots: slots.map(([stageJobType, providerKind]) => ({ stageJobType, providerKind,
      status: stageJobType === "RULE_EVALUATION" ? "CONFIGURED" : "UNCONFIGURED",
      profileId: stageJobType === "RULE_EVALUATION" ? current.profileId : null,
      adapterVersion: stageJobType === "RULE_EVALUATION" ? current.adapterVersion : null,
      artifactHash: null, configHash: stageJobType === "RULE_EVALUATION" ? configHash : null,
      licenseId: null, resourceProfile: stageJobType === "RULE_EVALUATION" ? "CPU" : null })) });
}
function identify(value: Record<string, any>) {
  const { releaseId: _oldId, ...identity } = value;
  return { ...identity, releaseId: `release:matrix-v1:${sha256(canonicalJson(identity)).slice(0, 24)}` };
}
describe("finite stored V13 read policy", () => {
  it("authenticates the original whole frozen release and preserves its definitions", () => {
    const original = release(true), canonical = canonicalJson(original);
    expect(original.releaseId).toBe(historicalConcreteWallReadIdentityV13.releaseId);
    expect(sha256(canonical)).toBe(historicalConcreteWallReadIdentityV13.contentHash);
    expect(Buffer.byteLength(canonical)).toBe(historicalConcreteWallReadIdentityV13.byteSize);
    const resolved = matrixStoredReadPolicyForReleaseV13(original);
    expect(resolved?.configHash).toBe(historicalConcreteWallReadIdentityV13.configHash);
    expect(canonicalJson(resolved?.definitions)).toBe(canonicalJson(original.rules.matrixDefinitions));
    expect(canonicalJson(original)).toBe(canonical);
  });
  it.each(["source", "registry", "confidence", "metadata", "config"])("rejects a self-consistently rehashed historical forgery: %s", field => {
    const forged = release(true);
    if (field === "source") forged.rules.matrixDefinitions.concreteWallExecution.sourcePins["concrete_wall_scope_v1.py"] = "0".repeat(64);
    if (field === "registry") forged.rules.catalogVersion = "forged-registry";
    if (field === "confidence") forged.rules.matrixDefinitions.columnPylonSectionExecution.confidencePolicy.warningThresholdBasisPoints = 0;
    if (field === "metadata") forged.externalNetworkAllowed = true;
    if (field === "config") forged.providerSlots.find((s: any) => s.stageJobType === "RULE_EVALUATION").configHash = "0".repeat(64);
    else forged.providerSlots.find((s: any) => s.stageJobType === "RULE_EVALUATION").configHash = sha256(canonicalJson(forged.rules.matrixDefinitions));
    expect(matrixStoredReadPolicyForReleaseV13(identify(forged))).toBeNull();
  });
  it("keeps execution selection on the current source tuple while admitting current stored reads", () => {
    const current = matrixFullPolicyForProfile(MATRIX_CONCRETE_WALL_V13_PROFILE)!;
    expect(current.configHash).not.toBe(historicalConcreteWallReadIdentityV13.configHash);
    expect(selectMatrixRuntimePolicy({ concreteWallV13: true, rail: false, call: false, inventory: false })?.configHash).toBe(current.configHash);
    expect(matrixStoredReadPolicyForReleaseV13(release(false))?.configHash).toBe(current.configHash);
    const forgedCurrent = release(false); forgedCurrent.rules.matrixDefinitions.concreteWallExecution.inheritedPolicy = "FORGED";
    expect(matrixStoredReadPolicyForReleaseV13(identify(forgedCurrent))).toBeNull();
  });
});
