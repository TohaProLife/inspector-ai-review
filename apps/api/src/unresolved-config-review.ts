import { verifyUnresolvedConfigReviewCore, type UnresolvedConfigReviewCoreInput }
  from "./unresolved-config-review-core.js";
export { pinnedUnresolvedReviewConfig } from "./unresolved-review-config-pinned.js";

export const unresolvedReviewConfigSha256 =
  "c5aedccb8752ef365ea18298e1ed222f97abd207607b8caf5a18f23fd547bc85";
export interface UnresolvedConfigReviewVerificationInput extends UnresolvedConfigReviewCoreInput {}

/** Rebuild every review row from the API-owned v1 descriptor and committed snapshots. */
export function verifyUnresolvedConfigReview(input: UnresolvedConfigReviewVerificationInput): boolean {
  return verifyUnresolvedConfigReviewCore(input, "v1");
}
