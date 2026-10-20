/** Output-only server assembly; protected SQL/release/PDF/origin authority remains with caller. */
import { bindMatrixSourceScope, matrixSourceScopeSchema, type MatrixSourceScope } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";
import { pinFrozenSourceManifestV13 } from "./matrix-frozen-source-manifest-v13.js";
import { validateConcreteWallWindowV13 } from "./matrix-concrete-wall-window-v13.js";
import type { MatrixConcreteWallV13Input } from "./matrix-concrete-wall-observations-v13.js";
import type { ImmutableSourceInputsV13 } from "./matrix-immutable-source-inputs-v13.js";

export class ScalarInputAssemblyV13Error extends TypeError {
  readonly code = "SCALAR_INPUT_ASSEMBLY_UNVERIFIED";
  constructor() { super("SCALAR_INPUT_ASSEMBLY_UNVERIFIED"); }
}
const fail = (): never => { throw new ScalarInputAssemblyV13Error(); };

/**
 * Called only after immutable source materialization and protected retained-origin
 * preparation. Does not discover/approve an origin or create a review decision.
 * Paths come from the existing authorized job source projection. No extra worker
 * lease field or inherited profile is changed by this internal pure assembly.
 */
export function assembleConcreteWallScalarInputV13(
  base: ImmutableSourceInputsV13,
  context: { objectId: string; runId: string; releaseId: string; inputManifestHash: string },
  origins: unknown,
  downloadPaths: Record<string, string>,
): MatrixConcreteWallV13Input {
  assertConcreteWallLeaseNativeV13({ base, context, origins, downloadPaths });
  if (base.metadata.inputManifestHash !== context.inputManifestHash
    || base.sourceFiles.length !== base.metadata.sources.length
    || base.textArtifacts.length !== base.sourceFiles.filter(source => source.mediaType === "application/pdf").length
    || Object.keys(downloadPaths).length !== base.sourceFiles.length) return fail();
  const metadata = pinFrozenSourceManifestV13({ inspectionId: base.metadata.inspectionId,
    inputManifestHash: context.inputManifestHash,
    manifest: { inspectionId: base.metadata.inspectionId,
      sources: base.metadata.sources.map(source => ({ sourceFileId: source.sourceFileId,
        sha256: source.sha256, stages: source.originalStages,
        sourceReviewHash: source.sourceReview?.reviewContentHash ?? null })) } });
  const sourceDecisions: Record<string, Record<string, unknown>> = Object.create(null);
  const sourceFiles = base.sourceFiles.map((source, index) => {
    const frozen = metadata.sources[index]!, saved = base.metadata.sources[index]!;
    if (source.sourceFileId !== frozen.sourceFileId || source.sha256 !== frozen.sha256
      || canonicalJson(source.stages) !== canonicalJson(frozen.stages)
      || source.pageCount !== saved.pageCount || !Object.hasOwn(downloadPaths, source.sourceFileId)
      || (source.mediaType === "application/pdf"
        ? base.textArtifacts.filter(item => item.sourceFileId === source.sourceFileId).length !== 1
        : source.pageCount !== 0 || base.textArtifacts.some(item => item.sourceFileId === source.sourceFileId))) return fail();
    const parent = saved.sourceReview;
    if (source.sectionCode !== (parent?.body.sectionCode ?? null)) return fail();
    if (parent !== null) {
      const body = parent.body;
      if (sha256(canonicalJson(body)) !== parent.reviewContentHash
        || body.sourceFileApiId !== source.sourceFileId || body.sourceSha256 !== source.sha256
        || body.objectApiId !== source.objectId) return fail();
      const scope = Object.hasOwn(body, "matrixScope") ? body.matrixScope : null;
      if (scope !== null && !matrixSourceScopeSchema.safeParse(scope).success) return fail();
      // Validate the raw scope, then preserve its immutable target bytes. Parsing
      // must never silently trim source/review identity before proof assembly.
      const proofs = bindMatrixSourceScope(scope as MatrixSourceScope | null, {
        sourceFileId: source.sourceFileId, sourceSha256: source.sha256,
        objectId: context.objectId, inputManifestHash: context.inputManifestHash,
        reviewContentHash: parent.reviewContentHash });
      if (Object.hasOwn(proofs, "FACT_BINDINGS")) proofs.FACT_BINDINGS!.reviewDecisionId = parent.reviewDecisionId;
      sourceDecisions[source.sourceFileId] = { sourceSha256: source.sha256,
        revisionStatus: body.revisionStatus, approvalStatus: body.approvalStatus,
        linkGroupId: body.linkGroupId, sectionCode: body.sectionCode ?? null,
        pageStages: body.pageStages, basis: body.basis, scopeProofs: proofs,
        reviewDecisionId: parent.reviewDecisionId, reviewContentHash: parent.reviewContentHash };
    }
    return { sourceFileId: source.sourceFileId, sha256: source.sha256, stages: [...source.stages],
      sectionCode: source.sectionCode, byteSize: source.byteSize, mediaType: source.mediaType,
      downloadPath: downloadPaths[source.sourceFileId] };
  });
  const window = validateConcreteWallWindowV13({ objectId: context.objectId, runId: context.runId,
    inputManifestHash: context.inputManifestHash, releaseId: context.releaseId,
    inputs: { sourceFiles, sourceDecisions, concreteWallOriginsV1: origins } });
  return { window, textArtifacts: structuredClone(base.textArtifacts.map(item => item.artifact)) };
}
