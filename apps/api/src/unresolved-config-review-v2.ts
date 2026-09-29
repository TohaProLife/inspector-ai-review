import { verifyUnresolvedConfigReviewCore, type UnresolvedConfigReviewCoreInput }
  from "./unresolved-config-review-core.js";
export { pinnedUnresolvedReviewConfigV2 } from "./unresolved-review-config-pinned-v2.js";

export const unresolvedReviewConfigV2Sha256 =
  "1c31aad1761af86273f421daef5fc04bfe7724c9bf07750a1f1b8b37be30a0e8";
export interface UnresolvedConfigReviewV2VerificationInput extends UnresolvedConfigReviewCoreInput {}

/** Rebuild every review row from the API-owned v2 descriptor and committed snapshots. */
export function verifyUnresolvedConfigReviewV2(input: UnresolvedConfigReviewV2VerificationInput): boolean {
  return verifyUnresolvedConfigReviewCore(input, "v2");
}
