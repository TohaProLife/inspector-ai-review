import { InventoryLoaderIntegrityError } from "./matrix-inventory-loader.js";
import { FrozenSourceManifestV13Error } from "./matrix-frozen-source-manifest-v13.js";
import { ImmutableSourceInputsV13Error } from "./matrix-immutable-source-inputs-v13.js";
import { ScalarInputAssemblyV13Error } from "./matrix-scalar-input-assembly-v13.js";
import { SourceSnapshotCompositionV13Error } from "./matrix-source-snapshot-composition-v13.js";
import { SourceReviewParentPinsV13Error } from "./matrix-source-review-parent-pins-v13.js";
import { ConcreteWallV13ConsistencyError } from "./matrix-concrete-wall-window-v13.js";
import { ConcreteWallNativeV13Error } from "./matrix-concrete-wall-native-v13.js";

/** Known deterministic data errors only. Database/network/storage races remain retryable. */
export function terminalClaimInputError(error: unknown): string | undefined {
  if (error instanceof InventoryLoaderIntegrityError)
    return error.code === "INVENTORY_INPUT_INTEGRITY" || error.code === "INVENTORY_INPUT_LIMIT" ? error.code : undefined;
  if (error instanceof FrozenSourceManifestV13Error || error instanceof ImmutableSourceInputsV13Error
    || error instanceof ScalarInputAssemblyV13Error || error instanceof SourceSnapshotCompositionV13Error
    || error instanceof SourceReviewParentPinsV13Error || error instanceof ConcreteWallV13ConsistencyError
    || error instanceof ConcreteWallNativeV13Error) return "CLAIM_INPUT_INTEGRITY";
  return undefined;
}
