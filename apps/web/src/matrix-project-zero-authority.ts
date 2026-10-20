import { matrixFactScopeSchema, matrixProjectZeroAuthoritySchema,
  type MatrixFactScopeTarget, type MatrixObservation, type MatrixProjectZeroAuthority,
  type SourceFileSummary, type SourceReviewDecision } from "@inspector-ai/contracts";

export const PROJECT_ZERO_RULE = "matrix-pz-009-declared_project_zero_absolute_elevation";
export const PROJECT_ZERO_AUTHORITY = "PROJECT_ZERO_GEODETIC_AUTHORITY";
export const PROJECT_ZERO_BASIS = "FINISHED_FLOOR_PROJECT_ZERO_TO_APPROVED_ABSOLUTE_DATUM";
export interface ProjectZeroAuthorityOption {
  key: string;
  label: string;
  authority: MatrixProjectZeroAuthority;
}
export function sameProjectZeroTarget(a: MatrixFactScopeTarget, b: MatrixFactScopeTarget): boolean {
  return (["checkId", "executionContentHash", "observationId", "evidenceHash", "textArtifactHash"] as const)
    .every(key => a[key] === b[key]);
}
export function ownProjectZeroAuthority(fact: MatrixObservation, target: MatrixFactScopeTarget): MatrixProjectZeroAuthority {
  return matrixProjectZeroAuthoritySchema.parse({ kind: "APPROVED_PD_GEODETIC_BASIS", sourceFileId: fact.sourceFileId,
    sourceSha256: fact.sourceSha256, pageNumber: fact.pageNumber, target });
}
/** Read only explicit current PD claims. Approval or a filename alone never declares authority. */
export function projectZeroAuthorityOptions(objectId: string, file: SourceFileSummary,
  review: SourceReviewDecision | null): ProjectZeroAuthorityOption[] {
  if (!review || review.objectId !== objectId || review.sourceFileId !== file.id || review.sourceSha256 !== file.sha256
    || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED"
    || !/^[a-f0-9]{64}$/u.test(review.contentHash) || !file.stages.includes("PD")) return [];
  const scope = matrixFactScopeSchema.safeParse(review.matrixScope);
  if (!scope.success) return [];
  return scope.data.bindings.flatMap(binding => {
    const authority = binding.contexts[PROJECT_ZERO_AUTHORITY]?.projectZeroAuthority;
    if (binding.ruleId !== PROJECT_ZERO_RULE || binding.ruleVersion !== "1" || binding.parameterCode !== "PZ-009"
      || !authority || authority.reviewContentHash !== undefined || authority.sourceFileId !== file.id
      || authority.sourceSha256 !== file.sha256 || !sameProjectZeroTarget(authority.target, binding.target)
      || (review.pageStages[String(authority.pageNumber)] ?? (file.stages.length === 1 ? file.stages[0] : null)) !== "PD") return [];
    return [{ key: `${file.id}:${review.contentHash}:${binding.target.observationId}`,
      label: `${file.name} · ПД · PDF ${authority.pageNumber} · ${binding.entityKey}`,
      authority: { ...authority, reviewContentHash: review.contentHash } }];
  });
}
