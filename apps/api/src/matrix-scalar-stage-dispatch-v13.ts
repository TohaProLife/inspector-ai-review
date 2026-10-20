/**
 * OUTPUT ONLY. Internal selection after authenticated persisted policy admission.
 * This helper neither validates a release nor declares an installed runtime.
 * Historical execution permission, exact config/definitions/source closure,
 * scope, immutable origins and accepted-base admission remain caller duties.
 */
import { validateMatrixExecution } from "./matrix-execution.js";
import { validateMatrixExecutionV13 } from "./matrix-execution-v13.js";
import type { MatrixConcreteWallV13Input } from "./matrix-concrete-wall-observations-v13.js";

export type MatrixLegacyScalarStageInput = Parameters<typeof validateMatrixExecution>[1];

// Exact literal from the frozen adapter-wire contract; no accepted policy implied.
const CONCRETE_WALL_PROFILE_V13 = "matrix-text-facts-concrete-walls-v13";

/**
 * Never pass a worker-result profile as persistedProfileId. The authenticated
 * caller must supply the saved release's already verified exact policy identity.
 * Both validators receive their original arguments, without clone or conversion.
 * Unknown identities and missing selected inputs refuse without trying another
 * validator. An old validator's exception is deliberately not swallowed here.
 */
export function validateMatrixScalarStageForProfileV13(
  persistedProfileId: unknown,
  rawExecution: unknown,
  legacyInput: MatrixLegacyScalarStageInput | undefined,
  concreteWallInput: MatrixConcreteWallV13Input | undefined,
): ReturnType<typeof validateMatrixExecution> {
  if (persistedProfileId === CONCRETE_WALL_PROFILE_V13) {
    return concreteWallInput === undefined
      ? null
      : validateMatrixExecutionV13(rawExecution, concreteWallInput);
  }
  switch (persistedProfileId) {
    case "matrix-text-facts-v1":
    case "matrix-text-facts-constraints-v2":
    case "matrix-text-facts-evidence-v3":
    case "matrix-text-facts-evidence-v4":
    case "matrix-text-facts-inventory-v5":
    case "matrix-text-facts-call-inventory-v6":
    case "matrix-text-facts-rail-inventory-v7":
    case "matrix-text-facts-water-node-v8":
    case "matrix-text-facts-lighting-technology-v9":
    case "matrix-text-facts-steel-comparison-v10":
    case "matrix-text-facts-steel-comparison-v11":
    case "matrix-text-facts-column-pylon-section-v12":
      return legacyInput === undefined
        ? null
        : validateMatrixExecution(rawExecution, legacyInput);
    default:
      return null;
  }
}
