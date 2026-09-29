import { verifyUnresolvedConfigReviewCore, type UnresolvedConfigReviewCoreInput }
  from "./unresolved-config-review-core.js";
export { pinnedUnresolvedReviewConfigV3 } from "./unresolved-review-config-pinned-v3.js";

export const unresolvedReviewConfigV3Sha256 =
  "ca9fb46fa07a5ccb32f8176b88bebede90b5b30875a29257465da5259b84365a";
export interface UnresolvedConfigReviewV3VerificationInput extends UnresolvedConfigReviewCoreInput {}

/** Rebuild every review row from the API-owned v3 descriptor and committed snapshots. */
export function verifyUnresolvedConfigReviewV3(input: UnresolvedConfigReviewV3VerificationInput): boolean {
  return verifyUnresolvedConfigReviewCore(input, "v3");
}
