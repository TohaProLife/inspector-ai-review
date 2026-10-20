/** Pure KR-056 comparison DTOs. A content hash never authenticates human authority. */
import type { SourceDeclarationFragment, MatrixSteelSourceDeclaration } from './matrix-source-declarations.js';
import type { SourceSectionCode } from './index.js';

export interface SteelComparisonIdentity {
  entityKey: string; buildingKey: string; zoneKey: string; memberKey: string;
  componentRole: 'DISTRIBUTION_BELT_I_BEAM';
}
export interface SteelComparisonOriginTarget {
  checkId: string; inputManifestHash: string; textStageContentHash: string; textArtifactHash: string;
}
export interface SteelComparisonTarget extends SteelComparisonOriginTarget { declarationId: string; }
export interface SteelComparisonMemberMapping {
  assertion: 'UNKNOWN' | 'HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER';
  identity: SteelComparisonIdentity; scopeFragments: SourceDeclarationFragment[]; reference: string;
}
export interface SteelComparisonScopeClaimRequest {
  target: SteelComparisonTarget; identity: SteelComparisonIdentity; memberMapping: SteelComparisonMemberMapping;
}
export interface SteelComparisonScopeClaimDecision extends SteelComparisonScopeClaimRequest {
  declarationSnapshot: MatrixSteelSourceDeclaration;
}
export interface SteelComparisonScopeRequest {
  schemaVersion: 'matrix-kr056-steel-review-v1'; claims: SteelComparisonScopeClaimRequest[];
}
export interface SteelComparisonScopeDecision {
  schemaVersion: 'matrix-kr056-steel-review-v1'; claims: SteelComparisonScopeClaimDecision[];
}
export interface SteelComparisonProductScope {
  role: 'DISTRIBUTION_BELT_I_BEAMS' | 'I_BEAM_GENERIC_DECLARATION'; productKind: 'I_BEAM';
  profile: string | null; count: number | null; tier: number | null;
  productStandard: string; gradeStandard: string;
}
export interface SteelComparisonReference {
  sourceFileId: string; sourceSha256: string; reviewDecisionId: string; reviewContentHash: string;
  target: SteelComparisonTarget; productScope: SteelComparisonProductScope;
}
export interface SteelComparisonApplicabilityDecision {
  schemaVersion: 'matrix-kr056-steel-applicability-decision-v1'; decisionId: string; contentHash: string;
  objectId: string; status: 'UNKNOWN' | 'APPROVED' | 'WITHDRAWN';
  authorityKind: 'HUMAN_REVIEWED_DECLARATION_APPLICABILITY'; identity: SteelComparisonIdentity;
  expected: SteelComparisonReference; actual: SteelComparisonReference;
  basis: {
    reference: string; expectedScopeFragments: SourceDeclarationFragment[]; actualScopeFragments: SourceDeclarationFragment[];
    catalogScope: 'ONLY_KR056_EXPLICIT_C345_TO_C245';
    standardsTreatment: 'RETAINED_DIFFERENCES_HUMAN_REVIEWED_NO_NORMATIVE_EQUIVALENCE';
    profilesTreatment: 'RETAINED_DIFFERENCES_NO_GEOMETRY_OR_STRENGTH_RANK';
  };
}
export type SteelComparisonStage = 'PD' | 'RD' | 'ID' | 'UNRESOLVED';
export interface SteelComparisonReview {
  decisionId: string; contentHash: string; revisionStatus: 'CURRENT' | 'SUPERSEDED' | 'UNKNOWN';
  approvalStatus: 'APPROVED' | 'UNAPPROVED' | 'UNKNOWN'; sectionCode: SourceSectionCode | null;
  linkGroupId: string | null; pageStages: Record<string, SteelComparisonStage>;
  steelComparisonScope: SteelComparisonScopeDecision | null;
}
export interface SteelComparisonSource {
  sourceFileId: string; sourceSha256: string; objectId: string; stages: SteelComparisonStage[];
  review: SteelComparisonReview | null;
}
export interface SteelComparisonOrigin {
  sourceFileId: string; sourceSha256: string; target: SteelComparisonOriginTarget;
  artifactContentSha256: string; textArtifact: Record<string, unknown>;
  stages: SteelComparisonStage[]; pageStages: Record<string, SteelComparisonStage>;
}
export interface SteelComparisonInput {
  schemaVersion: 'matrix-kr056-steel-comparison-input-v1'; objectId: string; inputManifestHash: string;
  identity: SteelComparisonIdentity; sources: SteelComparisonSource[]; origins: SteelComparisonOrigin[];
  applicabilityDecisions: SteelComparisonApplicabilityDecision[];
}
export type SteelComparisonAbstainReason = 'INVALID_INPUT' | 'INPUT_LIMIT' | 'SOURCE_PROVENANCE_UNVERIFIED'
  | 'DECLARATION_RECONSTRUCTION_UNVERIFIED' | 'APPLICABILITY_DECISION_UNVERIFIED'
  | 'REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING' | 'AMBIGUOUS_DECLARATION_SCOPE'
  | 'DUPLICATE_DECLARATION' | 'SOURCE_STAGE_UNVERIFIED' | 'SOURCE_REVIEW_UNVERIFIED'
  | 'SOURCE_SECTION_UNVERIFIED' | 'SOURCE_LINK_UNVERIFIED' | 'PHYSICAL_MEMBER_MAPPING_UNVERIFIED'
  | 'APPLICABILITY_DECISION_MISSING' | 'AMBIGUOUS_APPLICABILITY_DECISION'
  | 'UNSUPPORTED_CATEGORY_TRANSITION' | 'NEGATIVE_SCOPE_UNVERIFIED';
export type SteelComparisonResult = {
  schemaVersion: 'matrix-kr056-steel-comparison-v1'; status: 'ABSTAIN'; reasonCode: SteelComparisonAbstainReason;
  identity: SteelComparisonIdentity | null; comparison: null; calibratedProbability: null;
} | {
  schemaVersion: 'matrix-kr056-steel-comparison-v1'; status: 'CANDIDATE';
  reasonCode: 'EXPLICIT_C345_TO_C245_IN_REVIEWED_SAME_MEMBER'; identity: SteelComparisonIdentity;
  comparison: {
    scope: 'HUMAN_REVIEWED_PHYSICAL_MEMBER_AND_DECLARATION_APPLICABILITY_ONLY';
    expected: SteelComparisonReference; actual: SteelComparisonReference; expectedValue: 'С345'; actualValue: 'С245';
    applicabilityDecisionId: string; applicabilityDecisionContentHash: string;
  };
  calibratedProbability: null;
};
