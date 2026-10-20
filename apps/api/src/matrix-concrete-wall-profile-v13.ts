/** Guarded output-only v13 profile; no accepted capsule means unavailable. */
import { readFileSync } from "node:fs";
import { matrixColumnPylonSectionV12Definitions } from "./matrix-column-pylon-section-profile-v12.js";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { installedAcceptedMatrixBaseV12, historicalMatrixBaseV12IdentityV3 } from "./matrix-policy-history-v3.js";
import { matrixFullPolicyForProfile as previousPolicy, selectMatrixRuntimePolicy as previousSelection,
  isCurrentMatrixExecutionInstalled as previousInstalled, isSteelComparisonProfile as previousSteel,
  isColumnPylonSectionProfile as previousColumn, MATRIX_STEEL_COMPARISON_READ_PROFILES as previousReadProfiles,
} from "./matrix-column-pylon-section-profile-v12.js";
export { MATRIX_STEEL_COMPARISON_PROFILE, MATRIX_STEEL_COMPARISON_V11_PROFILE,
  MATRIX_COLUMN_PYLON_SECTION_V12_PROFILE } from "./matrix-column-pylon-section-profile-v12.js";

export const MATRIX_CONCRETE_WALL_V13_PROFILE = "matrix-text-facts-concrete-walls-v13";
export const MATRIX_CONCRETE_WALL_V13_ADAPTER_VERSION = "13";
const V12 = "matrix-text-facts-column-pylon-section-v12";
const modules = ["concrete_wall_native_v13.py", "concrete_wall_fact_scope_v13.py", "concrete_wall_matrix_engine_v13.py",
  "concrete_wall_prose_v1.py", "concrete_wall_scope_v1.py",
  "concrete_wall_transport_v13.py", "concrete_wall_execution_v13.py", "durable_concrete_wall_matrix_v13.py"] as const;
// ROOT's prepared final eight-source tuple, still blocked by absent accepted base.
const preparedSourcePins: Record<(typeof modules)[number], string> = {
  "concrete_wall_fact_scope_v13.py": "e126ade7dd85c6ec5ea9bb2b1aef72b708bb0eb0ab50c4b94dbe308dc61f09d9",
  "concrete_wall_matrix_engine_v13.py": "5224e76b50f396126aa3fee1c4cd6f81dfcfc14ae76c35f35fc9722fe595ce4f",
  "concrete_wall_native_v13.py": "4e5ffa98445ee365d419f1de58b38134c4b8a0b86249aecfaedb8a756b6a79dd",
  "concrete_wall_prose_v1.py": "24973dd12cfa53630efb22505f76279c9598aa686a9bd87ebbb99270e78c65c5",
  "concrete_wall_scope_v1.py": "2110a9372e34dc604d6a0128ef485ab19141c65f8a1cc59439b7a5c72887b94d",
  "concrete_wall_transport_v13.py": "fa6fbdb411a82db9175c6dbe3887051319e29266121b21a1edfc9fff3c8a39f3",
  "concrete_wall_execution_v13.py": "741a6601a3d15584c5a219225fa26bc4dd804c61d687ae3c0bbe89c6bdcf4902",
  "durable_concrete_wall_matrix_v13.py": "1d1e38a47fbcb7efd891bc6a5d89875bf33eafc1e3048483d259b30e7db586ff",
};

export function isConcreteWallProfileV13(profile: unknown): boolean { return profile === MATRIX_CONCRETE_WALL_V13_PROFILE; }
export function isSteelComparisonProfile(profile: unknown): boolean { return isConcreteWallProfileV13(profile) || previousSteel(profile); }
export function isColumnPylonSectionProfile(profile: unknown): boolean { return isConcreteWallProfileV13(profile) || previousColumn(profile); }
export const MATRIX_STEEL_COMPARISON_READ_PROFILES = [...previousReadProfiles, MATRIX_CONCRETE_WALL_V13_PROFILE];

/** Read actual installed bytes on each operation; no import-time v13 failure. */
function installedConcreteWallPolicyV13() {
  const base = installedAcceptedMatrixBaseV12();
  if (!base) return null;
  try {
    const current = previousPolicy(V12);
    if (!current || current.configHash !== base.configHash
      || canonicalJson(current.definitions) !== canonicalJson(base.definitions)
      || canonicalJson(matrixColumnPylonSectionV12Definitions) !== canonicalJson(base.definitions)) return null;
    const sourcePins = Object.fromEntries(modules.map(name => [name,
      sha256(readFileSync(new URL("../../../services/worker/inspector_worker/" + name, import.meta.url)))]));
    if (modules.some(name => sourcePins[name] !== preparedSourcePins[name])) return null;
    const concreteWallExecution = {
      schemaVersion: "matrix-concrete-wall-execution-v1", purpose: "MACHINE_COMPARISON",
      baseProfileId: V12, baseAdapterVersion: "12", baseConfigHash: base.configHash, sourcePins,
      extractorVersion: "matrix-concrete-wall-prose-v1", scopePolicyVersion: "matrix-concrete-wall-reviewed-pair-v1",
      scalarExecutionVersion: "matrix-concrete-wall-scalar-v13", durableWrapperVersion: "matrix-concrete-wall-durable-v13",
      loaderSchemaVersion: "matrix-reviewed-inventory-loader-inputs-v7",
      loaderResourcePolicy: { canonicalUtf8Bytes: 67_108_864, nodesIncludingKeys: 4_500_018,
        maximumDepth: 69, containerItems: 32_768, scalarStringCodePoints: 2_000_000 },
      originResourcePolicy: { canonicalUtf8Bytes: 524_288, nodesIncludingKeys: 200_000,
        maximumDepth: 64, containerItems: 32_768, scalarStringCodePoints: 2_000_000 },
      coveragePolicyVersion: "matrix-concrete-wall-scoped-partial-v1",
      inheritedPolicy: "ACCEPTED_V12_EXACT_NO_REGISTRY_OR_CONFIDENCE_CHANGE",
    };
    const definitions = { ...matrixColumnPylonSectionV12Definitions, concreteWallExecution };
    return { ...current, profileId: MATRIX_CONCRETE_WALL_V13_PROFILE, adapterVersion: MATRIX_CONCRETE_WALL_V13_ADAPTER_VERSION,
      definitions, configHash: sha256(canonicalJson(definitions)), concreteWallComparisons: true as const,
      installedIdentity: sha256(canonicalJson({ acceptedBase: base.installedIdentity, concreteWallExecution })) };
  } catch { return null; }
}

export function matrixFullPolicyForProfile(profile: string | null | undefined) {
  if(isConcreteWallProfileV13(profile))return installedConcreteWallPolicyV13();
  const old=previousPolicy(profile);
  if(profile!==V12||!old)return old;
  const history=historicalMatrixBaseV12IdentityV3();
  return history?{...old,definitions:history.definitions as typeof old.definitions,configHash:history.configHash}:old;
}

// Original delivery V13 release, observed before the bounded non-PDF transport
// correction. A finite whole-release identity admits persisted reads only;
// neither this hash nor its old source tuple declares an installed runtime.
export const historicalConcreteWallReadIdentityV13 = Object.freeze({
  releaseId: "release:matrix-v1:4b4b5d5a0b688c08be7e18ef",
  contentHash: "1d31856863b1fc69badd591657d45f5f2beb28f1e07dc8c5f80ab195e3aa3544",
  byteSize: 110249,
  configHash: "28756ccdcb644045c08f6543fe07cfe58732939ca62cc68e4833d5f5740e3448",
  transportSourceHash: "b9088bdc5a93babc9cf85ded0ba5a6f006896819b980f4bea8e4d3a618786640",
});

/** Only authenticated sealed-result/origin readers may call this resolver.
 * Claim, stage completion and new-release construction use current policy above.
 */
export function matrixStoredReadPolicyForReleaseV13(release: unknown) {
  if (!release || typeof release !== "object" || Array.isArray(release)) return null;
  const manifest = release as Record<string, unknown>;
  if (!Array.isArray(manifest.providerSlots)) return null;
  const slots = manifest.providerSlots.filter(slot => slot && typeof slot === "object"
    && slot.stageJobType === "RULE_EVALUATION");
  if (slots.length !== 1) return null;
  const slot = slots[0] as Record<string, unknown>;
  if (typeof slot.profileId !== "string") return null;
  const current = matrixFullPolicyForProfile(slot.profileId);
  if (!current || !isConcreteWallProfileV13(slot.profileId)) return current;
  const rules = manifest.rules as { matrixDefinitions?: unknown } | undefined;
  if (slot.configHash === current.configHash) return slot.status === "CONFIGURED" && slot.providerKind === "RULE_ENGINE"
    && slot.adapterVersion === current.adapterVersion
    && canonicalJson(rules?.matrixDefinitions) === canonicalJson(current.definitions) ? current : null;
  const historical = historicalConcreteWallReadIdentityV13;
  const canonical = canonicalJson(manifest);
  if (manifest.releaseId !== historical.releaseId || sha256(canonical) !== historical.contentHash
    || Buffer.byteLength(canonical, "utf8") !== historical.byteSize || slot.configHash !== historical.configHash
    || slot.adapterVersion !== MATRIX_CONCRETE_WALL_V13_ADAPTER_VERSION
    || slot.status !== "CONFIGURED" || slot.providerKind !== "RULE_ENGINE") return null;
  // Reconstruct every inherited definition and all eight source pins; changing
  // another source, registry, confidence field or arbitrary release metadata
  // cannot fit this historical identity.
  const definitions = structuredClone(current.definitions) as typeof current.definitions & {
    concreteWallExecution: { sourcePins: Record<string, string> } };
  definitions.concreteWallExecution.sourcePins["concrete_wall_transport_v13.py"] = historical.transportSourceHash;
  if (sha256(canonicalJson(definitions)) !== historical.configHash
    || canonicalJson(rules?.matrixDefinitions) !== canonicalJson(definitions)) return null;
  return { ...current, definitions, configHash: historical.configHash };
}
export function matrixConcreteWallInstalledIdentityV13(): string | null {
  return installedConcreteWallPolicyV13()?.installedIdentity ?? null;
}
export function isCurrentMatrixExecutionInstalled(profile: string | null | undefined): boolean {
  return isConcreteWallProfileV13(profile) ? installedConcreteWallPolicyV13() !== null : previousInstalled(profile);
}
export function selectMatrixRuntimePolicy(flags: Parameters<typeof previousSelection>[0] & { concreteWallV13?: boolean }) {
  return flags.concreteWallV13 ? installedConcreteWallPolicyV13() : previousSelection(flags);
}
