import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type {
  BinaryUploadRecord,
  CheckRun,
  CheckStats,
  CreateObjectInput,
  DecisionInput,
  DecisionType,
  FinalizeCheckInput,
  Finding,
  FindingStatus,
  InspectionObject,
  ObjectStatus,
  ParameterCatalogItem,
  ParameterCoverageItem,
  ProtocolArtifactSummary,
  ProtocolExport,
  ProtocolRevocationResult,
  ProtocolRevocationSummary,
  ProtocolVersion,
  RevokeProtocolInput,
  StageSummary,
  SourceReviewDecision,
  SourceReviewInput,
  SourceFileSummary,
} from "@inspector-ai/contracts";
import type {
  AnalysisJobType,
  AuditedMutationCommand,
  AuditedMutationCommandResult,
  DecisionResult,
  FinalizeResult,
  FinalizeCheckCommand,
  FinalizeCheckCommandResult,
  InspectionRepository,
  JobAttemptInput,
  JobClaimInput,
  JobClaimResult,
  JobCompleteInput,
  JobCompleteResult,
  JobFailInput,
  JobFailResult,
  JobHeartbeatResult,
  JobInputResult,
  JobOcrLayoutArtifactResult,
  JobTextArtifactResult,
  JobLease,
  FactEntityLinkDecision,
  FactEntityLinkReviewInput,
  ReviewedFactEntityLink,
  OcrLayoutPageRead,
  OcrLayoutRead,
  OcrTableRowsRead,
  OcrRowTranscriptionReview,
  OcrRowTranscriptionReviewInput,
  OcrRowApplicabilityReview,
  OcrRowApplicabilityCandidate,
  OcrRowApplicabilityReviewInput,
  OcrFactPairReview,
  OcrFactPairCandidate,
  OcrFactPairSnapshot,
  OcrFactPairQuantityReview,
  OcrFactPairQuantityCandidate,
  OcrTypedFactV2Read,
  PilotResultsScopedRead,
  ProtocolCanonicalArtifactContent,
  RegisteredIngestedDocumentFile,
  ReviewDecisionCommand,
  ReviewDecisionCommandResult,
  ReviewFindingResult,
  ReviewCandidateDecisionInput,
  ReviewCandidateDecisionRead,
  RevokeProtocolCommand,
  RevokeProtocolCommandResult,
  ScopedReadResult,
  SubmissionResult,
  VisualProposalReview,
  VisualProposalReviewInput,
} from "./repository.js";
import type { AuthenticatedActor } from "./identity.js";
import { canonicalJson, sha256 } from "./canonical-json.js";
import type { ObjectStorage } from "./storage.js";
import { readVerifiedOriginalPdf } from "./verified-pdf-storage.js";
import { verifyZu127GenericStageV3 } from "./zu127-generic-stage-v3.js";
import { assertAnalysisJobQueue, resolveAnalysisJobQueue, ZU127_GENERIC_V3_CONFIG_HASH,
  ZU127_GENERIC_V3_PROFILE_ID, ZU127_GENERIC_V3_QUEUE,
  ZU127_POPPLER_V2_QUEUE } from "./zu127-queue-policy.js";
import { pilotPz002Rules, pilotPz002Pz017Rules, pilotPz002Pz017OcrHeatRules,
  pilotPz002Pz017OcrHeatFactFamilyRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidatePreviewRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidateObservationsRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3,
  pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableUnresolvedRulesV1 } from "./pilot-rules.js";
import { verifiedReviewedFactEntityLinks, verifyFactFamilyProposals } from "./fact-family-proposals.js";
import { candidateFamilyPreviewSections, candidateFamilyPreviewSpecs,
  verifyCandidateFamilyPreview } from "./candidate-family-preview.js";
import { verifyCandidateFamilyObservations } from "./candidate-family-observations.js";
import { verifyReviewCandidates } from "./review-candidates.js";
import { verifyUnresolvedFamilyRunReview } from "./unresolved-family-run-review.js";
import { verifyUnresolvedFamilyOcrReview } from "./unresolved-family-ocr-review.js";
import { verifySiteTepAreaReview } from "./site-tep-area-review.js";
import { verifySiteGpContextReview } from "./site-gp-context-review.js";
import { verifySiteGpTableRowReview } from "./site-gp-table-row-review.js";
import { verifyEquipmentSpecReview } from "./equipment-spec-review.js";
import { verifyMaterialClassReview } from "./material-class-review.js";
import { verifyLayerAssemblyProposals } from "./layer-assembly-proposals.js";
import { verifyKr065OpeningProposals } from "./kr065-opening-proposals.js";
import { pinnedUnresolvedReviewConfig, unresolvedReviewConfigSha256,
  verifyUnresolvedConfigReview } from "./unresolved-config-review.js";
import { pinnedUnresolvedReviewConfigV2, verifyUnresolvedConfigReviewV2 }
  from "./unresolved-config-review-v2.js";
import { pinnedUnresolvedReviewConfigV3, verifyUnresolvedConfigReviewV3 }
  from "./unresolved-config-review-v3.js";
import { verifyCandidateFamilyOcrObservations } from "./candidate-family-ocr-observations.js";
import { verifyOcrTableRows } from "./ocr-table-rows.js";
import { validateOcrRowTranscriptionReview } from "./ocr-row-transcription-review.js";
import { validateOcrRowApplicabilityReview,
  type OcrRowApplicabilityVerificationContext } from "./ocr-row-applicability-review.js";
import { buildOcrTypedFactV2, validateOcrTypedFactV2 } from "./ocr-typed-fact-v2.js";
import { validateOcrFactPairReview, type OcrFactPairReviewInput,
  type OcrFactPairReviewVerificationContext } from "./ocr-fact-pair-review.js";
import { ocrFactPairQuantityCatalogFor, validateOcrFactPairQuantityReview,
  type OcrFactPairQuantityReviewInput } from "./ocr-fact-pair-quantity-review.js";
import { buildOcrFactPairComparisonPreview,
  type OcrFactPairComparisonPreview } from "./ocr-fact-pair-comparison.js";
import { validateOcrHeatRowProposals, type OcrHeatStageEnvelope } from "./ocr-heat-row-proposals.js";
import { verifyPilotPz002Candidate, type PilotCandidateSource, type VerifiedPilotCandidate } from "./pilot-candidate.js";
import { verifyPilotHeatAnalysis } from "./pilot-heat.js";
import { projectCandidateFamilyOcrObservationsRead, projectCandidateFamilyObservationsRead,
  projectCandidateFamilyPreviewRead,
  projectFactFamilyRead, projectOcrHeatRowsRead, projectPilotRuleResult,
  projectUnresolvedFamilyReviewRead,
  type PersistedOcrHeatRowsStage, type PersistedPilotResultRow } from "./pilot-result-read.js";
import { projectOcrLayoutPage, projectOcrLayoutRead,
  type PersistedOcrLayoutRow } from "./ocr-layout-read.js";
import {
  boundedOcrConfigHash, boundedOcrProfileId, boundedOcrConfigHashV2,
  boundedOcrProfileIdV2, boundedOcrConfigHashV3, boundedOcrProfileIdV3,
  boundedOcrConfigHashV4, boundedOcrProfileIdV4,
  boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrConfigHashV6, boundedOcrProfileIdV6,
  selectBoundedOcrV6Pages,
  validateBoundedOcrStageResult, validateBoundedOcrV6StageResult,
  type OcrV6ExpectedSource,
} from "./ocr-layout.js";
import {
  legacyVisualProposalConfigHash,
  legacyVisualProposalProfileId,
  validateVisualProposalStageResult,
  v2VisualProposalConfigHash,
  v2VisualProposalProfileId,
  v3VisualProposalConfigHash,
  v3VisualProposalProfileId,
  v5VisualProposalConfigHash,
  v5VisualProposalProfileId,
  v6VisualProposalConfigHash,
  v6VisualProposalProfileId,
  visualProposalConfigHash,
  visualProposalProfileId,
} from "./visual-proposal.js";

interface ObjectRow extends QueryResultRow {
  id: string;
  api_id: string;
  name: string;
  address: string;
  display_status: ObjectStatus;
  file_count: number;
  page_count: number;
  stats: CheckStats;
  created_at: Date | string;
  updated_at: Date | string;
  active_check_id: string | null;
  stages: StageSummary[];
}

interface CheckRow extends QueryResultRow {
  api_id: string;
  object_api_id: string;
  display_status: ObjectStatus;
  progress: number;
  current_stage: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  mode: "NORMAL";
  model_version: string | null;
  rules_version: string;
  stats: CheckStats;
  inspection_lifecycle: "OPEN" | "FINALIZED";
  inspection_row_version: string | number;
  gaps: ParameterCoverageItem[] | string;
  decision_set: FinalizationDecisionItem[] | string;
}

interface FinalizationDecisionItem {
  itemId: string;
  lifecycle: "ACTIVE" | "SUPERSEDED";
  projectionStatus: string;
  rowVersion: number;
  evidenceFingerprint: string;
  decision: {
    id: string;
    action: DecisionType;
    reasonCode: string;
    comment: string | null;
    actorId: string;
    evidenceFingerprint: string;
  } | null;
}

interface UploadRow extends QueryResultRow {
  id: string;
  api_id: string;
  object_api_id: string;
  created_at: Date | string;
}

interface UploadFileRow extends QueryResultRow {
  api_file_id: string;
  client_name: string;
  supplied_stage: "PD" | "RD" | "ID";
  ingest_status: "STORED" | "DUPLICATE";
  byte_size: string | number;
  media_type: string;
  sha256: string;
}

type StoredFindingPayload = Omit<Finding, "id" | "checkId" | "status" | "decision">;

interface FindingRow extends QueryResultRow {
  api_id: string;
  check_api_id: string;
  projection_status: "PENDING" | "CONFIRMED_VIOLATION" | "NEGATIVE_VERIFIED" | "CLARIFICATION_REQUIRED";
  machine_status: FindingStatus;
  result_payload: StoredFindingPayload | string;
  decision_action: DecisionType | null;
  decision_reason_code: string | null;
  decision_comment: string | null;
  decision_actor_id: string | null;
  decision_actor_name: string | null;
  decision_created_at: Date | string | null;
  row_version: string | number;
  evidence_fingerprint: string;
  lifecycle: "ACTIVE" | "SUPERSEDED";
  result_fingerprint: string | null;
  decision_id: string | null;
  decision_evidence_fingerprint: string | null;
}

interface ProtocolRow extends QueryResultRow {
  api_id: string;
  check_api_id: string;
  version: number;
  kind: "DRAFT" | "FINAL";
  snapshot_json: ProtocolExport | string;
  snapshot_hash: string;
  created_by: string;
  created_at: Date | string;
  run_stats: CheckStats | string;
  revocation_api_id: string | null;
  revocation_reason_code: ProtocolRevocationSummary["reasonCode"] | null;
  revocation_comment: string | null;
  revoked_at: Date | string | null;
  revoked_by: string | null;
  replacement_protocol_api_id: string | null;
  artifact_api_id: string | null;
  artifact_byte_size: string | number | null;
  artifact_content_hash: string | null;
  artifact_created_at: Date | string | null;
}

interface ProtocolArtifactRow extends QueryResultRow {
  api_id: string;
  protocol_api_id: string;
  byte_size: string | number;
  content_hash: string;
  content_bytes: Buffer;
  created_at: Date | string;
}

interface PostgresRepositoryOptions {
  connectionString: string;
  parameters: ParameterCatalogItem[];
  organizationSlug?: string;
  organizationName?: string;
  onPoolError?: (error: Error) => void;
  analysisProfile?: "SCAFFOLD" | "PILOT_PZ002" | "PILOT_PZ002_PZ017";
  visualProfile?: "V4" | "V5" | "V6";
  /** Shared API-owned storage; required only for the isolated ZU-127 v3 result. */
  storage?: ObjectStorage;
}

const objectSelect = `
  SELECT
    o.id,
    o.api_id,
    o.name,
    o.address,
    o.display_status,
    o.file_count,
    GREATEST(o.page_count, COALESCE(page_totals.total, 0)) AS page_count,
    o.stats,
    o.created_at,
    o.updated_at,
    active_run.api_id AS active_check_id,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'stage', summary.stage,
          'fileCount', summary.file_count,
          'pageCount', GREATEST(summary.page_count, CASE summary.stage
            WHEN 'PD' THEN COALESCE(page_totals.pd, 0)
            WHEN 'RD' THEN COALESCE(page_totals.rd, 0)
            WHEN 'ID' THEN COALESCE(page_totals.id, 0)
            ELSE 0 END),
          'status', summary.completeness
        )
        ORDER BY CASE summary.stage WHEN 'PD' THEN 1 WHEN 'RD' THEN 2 WHEN 'ID' THEN 3 ELSE 4 END
      )
      FROM object_stage_summaries summary
      WHERE summary.object_id = o.id
    ), '[]'::jsonb) AS stages
  FROM objects o
  JOIN inspections inspection ON inspection.object_id = o.id
  LEFT JOIN analysis_runs active_run ON active_run.id = inspection.active_run_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(latest.page_count), 0)::integer AS total,
           COALESCE(SUM(latest.page_count) FILTER (WHERE 'PD' = ANY(stages.stage_values)), 0)::integer AS pd,
           COALESCE(SUM(latest.page_count) FILTER (WHERE 'RD' = ANY(stages.stage_values)), 0)::integer AS rd,
           COALESCE(SUM(latest.page_count) FILTER (WHERE 'ID' = ANY(stages.stage_values)), 0)::integer AS id
    FROM source_files source
    JOIN blobs blob ON blob.id = source.blob_id
    LEFT JOIN LATERAL (
      SELECT artifact.page_count
      FROM analysis_text_artifacts artifact
      WHERE artifact.source_file_id = source.id AND artifact.input_sha256 = blob.sha256
      ORDER BY artifact.created_at DESC, artifact.id DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(binding.stage) AS stage_values
      FROM source_file_stages binding WHERE binding.source_file_id = source.id
    ) stages ON true
    WHERE source.object_id = o.id
  ) page_totals ON true
`;

const checkSelect = `
  SELECT
    run.api_id,
    object.api_id AS object_api_id,
    run.display_status,
    run.progress,
    run.current_stage,
    run.started_at,
    run.completed_at,
    run.mode,
    run.model_version,
    run.rules_version,
    run.stats,
    inspection.lifecycle AS inspection_lifecycle,
    inspection.row_version AS inspection_row_version,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'parameterId', coverage.parameter_id,
          'parameterCode', coverage.parameter_code,
          'parameterName', coverage.parameter_name,
          'executionStatus', coverage.execution_rollup,
          'reason', coverage.reason
        )
        ORDER BY coverage.parameter_id, coverage.parameter_code
      )
      FROM parameter_coverage coverage
      WHERE coverage.run_id = run.id
    ), '[]'::jsonb) AS gaps,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'itemId', item.api_id,
          'lifecycle', item.lifecycle,
          'projectionStatus', item.projection_status,
          'rowVersion', item.row_version,
          'evidenceFingerprint', item.evidence_fingerprint,
          'decision', CASE WHEN decision.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', decision.id,
            'action', decision.action,
            'reasonCode', decision.reason_code,
            'comment', decision.comment,
            'actorId', decision.actor_id,
            'evidenceFingerprint', decision.evidence_fingerprint
          ) END
        )
        ORDER BY item.api_id
      )
      FROM review_items item
      LEFT JOIN LATERAL (
        SELECT id, action, reason_code, comment, actor_id, evidence_fingerprint
        FROM review_decisions
        WHERE review_item_id = item.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) decision ON true
      WHERE item.run_id = run.id
    ), '[]'::jsonb) AS decision_set
  FROM analysis_runs run
  JOIN inspections inspection ON inspection.id = run.inspection_id
  JOIN objects object ON object.id = run.object_id
`;

const findingSelect = `
  SELECT
    item.api_id,
    run.api_id AS check_api_id,
    item.projection_status,
    item.lifecycle,
    result.machine_status,
    result.evidence_fingerprint AS result_fingerprint,
    result.result_payload,
    decision.id AS decision_id,
    decision.action AS decision_action,
    decision.reason_code AS decision_reason_code,
    decision.comment AS decision_comment,
    decision.actor_id AS decision_actor_id,
    actor.display_name AS decision_actor_name,
    decision.created_at AS decision_created_at,
    decision.evidence_fingerprint AS decision_evidence_fingerprint,
    item.row_version,
    item.evidence_fingerprint
  FROM review_items item
  JOIN rule_results result ON result.id = item.result_id
  JOIN analysis_runs run ON run.id = item.run_id
  JOIN objects object ON object.id = run.object_id
  LEFT JOIN LATERAL (
    SELECT id, action, reason_code, comment, actor_id, created_at, evidence_fingerprint
    FROM review_decisions
    WHERE review_item_id = item.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ) decision ON true
  LEFT JOIN inspector_users actor ON actor.id::text = decision.actor_id
`;

const protocolSelect = `
  SELECT
    protocol.api_id,
    run.api_id AS check_api_id,
    protocol.version,
    protocol.kind,
    protocol.snapshot_json,
    protocol.snapshot_hash,
    protocol.created_by,
    protocol.created_at,
    run.stats AS run_stats,
    revocation.api_id AS revocation_api_id,
    revocation.reason_code AS revocation_reason_code,
    revocation.comment AS revocation_comment,
    revocation.created_at AS revoked_at,
    revoker.display_name AS revoked_by,
    replacement.api_id AS replacement_protocol_api_id,
    artifact.api_id AS artifact_api_id,
    artifact.byte_size AS artifact_byte_size,
    artifact.content_hash AS artifact_content_hash,
    artifact.created_at AS artifact_created_at
  FROM inspection_protocol_versions protocol
  JOIN inspections inspection ON inspection.id = protocol.inspection_id
  JOIN analysis_runs run ON run.id = protocol.run_id
  JOIN objects object ON object.id = run.object_id
  LEFT JOIN protocol_revocations revocation ON revocation.protocol_id = protocol.id
  LEFT JOIN inspector_users revoker ON revoker.id = revocation.actor_user_id
  LEFT JOIN inspection_protocol_versions replacement ON replacement.id = revocation.replacement_protocol_id
  LEFT JOIN protocol_artifacts artifact
    ON artifact.protocol_id = protocol.id
   AND artifact.format = 'JSON'
   AND artifact.canonicalization_version = 'inspector-c14n-v1'
`;

const retryableReadErrorCodes = new Set([
  "08000",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
  "ECONNRESET",
  "EPIPE",
]);

function blankStats(total = 0): CheckStats {
  return {
    total,
    unsupported: 0,
    candidates: 0,
    confirmed: 0,
    negativeVerified: 0,
    notComparable: 0,
    clarification: 0,
    suspicion: 0,
  };
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validateInventoryResult(
  result: Record<string, unknown>,
  expected: { sourceCount: number; stageCounts: Record<"PD" | "RD" | "ID", number> },
): boolean {
  if (result.disposition !== "MANIFEST_INVENTORIED" || result.sourceCount !== expected.sourceCount) return false;
  const stageCounts = result.stageCounts;
  if (!stageCounts || typeof stageCounts !== "object" || Array.isArray(stageCounts)) return false;
  return (["PD", "RD", "ID"] as const).every((stage) => {
    const value = (stageCounts as Record<string, unknown>)[stage];
    return isNonNegativeInteger(value) && value === expected.stageCounts[stage];
  });
}

const OCR_TABLE_PROFILE = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v1";
const OCR_TABLE_PROFILE_V2 = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v2";
const OCR_TABLE_PROFILE_V3 = "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3";
const UNRESOLVED_FAMILY_PROFILE = `${OCR_TABLE_PROFILE_V3}-unresolved-review-v1`;
const UNRESOLVED_FAMILY_OCR_PROFILE = "typed-pz002-pz017-ocr-v6-unresolved-family-review-v1";
const SITE_TEP_AREA_PROFILE = "typed-pz002-pz017-site-tep-area-review-v1";
const SITE_GP_CONTEXT_PROFILE = "typed-pz002-pz017-site-gp-context-review-v1";
const SITE_GP_TABLE_ROW_PROFILE = "typed-pz002-pz017-site-gp-table-row-review-v1";
const EQUIPMENT_SPEC_PROFILE = "typed-pz002-pz017-equipment-spec-review-v1";
const MATERIAL_CLASS_PROFILE = "typed-pz002-pz017-material-class-review-v1";
const LAYER_ASSEMBLY_PROFILE = "typed-pz002-pz017-layer-assembly-review-v1";
const KR065_OPENING_PROFILE = "typed-pz002-pz017-kr065-opening-review-v1";
const KR065_OPENING_RULES = {
  ...pilotPz002Pz017Rules,
  kr065OpeningReview: {
    ruleId: "pilot-kr065-opening-review-v1", version: "1",
    extractionProfile: "kr065-opening-review-v1", codeCount: 1,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const LAYER_ASSEMBLY_RULES = {
  ...pilotPz002Pz017Rules,
  layerAssemblyReview: {
    ruleId: "pilot-layer-assembly-review-v1", version: "1",
    extractionProfile: "layer-assembly-review-v1", codeCount: 3,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const UNRESOLVED_CONFIG_PROFILE = "typed-pz002-pz017-unresolved-config-review-v1";
const UNRESOLVED_CONFIG_PROFILE_V2 = "typed-pz002-pz017-unresolved-config-review-v2";
const UNRESOLVED_CONFIG_PROFILE_V3 = "typed-pz002-pz017-unresolved-config-review-v3";
const UNRESOLVED_CONFIG_RULES = {
  ...pilotPz002Pz017Rules,
  unresolvedConfigReview: {
    ruleId: "pilot-unresolved-config-review", version: "1",
    extractionProfile: "unresolved-review-config-v1",
    configSha256: unresolvedReviewConfigSha256, codeCount: 19,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const UNRESOLVED_CONFIG_RULES_V2 = {
  ...pilotPz002Pz017Rules,
  unresolvedConfigReviewV2: {
    ruleId: "pilot-unresolved-config-review-v2", version: "1",
    extractionProfile: "unresolved-review-config-v2",
    configSha256: "1c31aad1761af86273f421daef5fc04bfe7724c9bf07750a1f1b8b37be30a0e8",
    codeCount: 10, disposition: "REVIEW_AID_ONLY",
  },
} as const;
const UNRESOLVED_CONFIG_RULES_V3 = {
  ...pilotPz002Pz017Rules,
  unresolvedConfigReviewV3: {
    ruleId: "pilot-unresolved-config-review-v3", version: "1",
    extractionProfile: "unresolved-review-config-v3",
    configSha256: "ca9fb46fa07a5ccb32f8176b88bebede90b5b30875a29257465da5259b84365a",
    codeCount: 7, disposition: "REVIEW_AID_ONLY",
  },
} as const;
type UnresolvedConfigVerificationInput = Parameters<typeof verifyUnresolvedConfigReview>[0];
type UnresolvedConfigReviewKey = "unresolvedConfigReview" | "unresolvedConfigReviewV2"
  | "unresolvedConfigReviewV3";
type UnresolvedConfigRuleKey = "unresolvedConfig" | "unresolvedConfigV2"
  | "unresolvedConfigV3";
interface UnresolvedConfigDescriptor {
  profileId: string;
  sidecarKey: UnresolvedConfigReviewKey;
  configKey: UnresolvedConfigRuleKey;
  definitions: Record<string, unknown>;
  pinnedConfig: unknown;
  verify: (input: UnresolvedConfigVerificationInput) => boolean;
  sealError: string;
  readStageError: string;
  readAidError: string;
}
const UNRESOLVED_CONFIG_DESCRIPTORS: readonly UnresolvedConfigDescriptor[] = [
  { profileId: UNRESOLVED_CONFIG_PROFILE, sidecarKey: "unresolvedConfigReview",
    configKey: "unresolvedConfig", definitions: UNRESOLVED_CONFIG_RULES,
    pinnedConfig: pinnedUnresolvedReviewConfig, verify: verifyUnresolvedConfigReview,
    sealError: "pilot release cannot seal unresolved config review aid",
    readStageError: "Unresolved config rule stage integrity check failed",
    readAidError: "Unresolved config review aid integrity check failed" },
  { profileId: UNRESOLVED_CONFIG_PROFILE_V2, sidecarKey: "unresolvedConfigReviewV2",
    configKey: "unresolvedConfigV2", definitions: UNRESOLVED_CONFIG_RULES_V2,
    pinnedConfig: pinnedUnresolvedReviewConfigV2, verify: verifyUnresolvedConfigReviewV2,
    sealError: "pilot release cannot seal unresolved config v2 review aid",
    readStageError: "Unresolved config v2 rule stage integrity check failed",
    readAidError: "Unresolved config v2 review aid integrity check failed" },
  { profileId: UNRESOLVED_CONFIG_PROFILE_V3, sidecarKey: "unresolvedConfigReviewV3",
    configKey: "unresolvedConfigV3", definitions: UNRESOLVED_CONFIG_RULES_V3,
    pinnedConfig: pinnedUnresolvedReviewConfigV3, verify: verifyUnresolvedConfigReviewV3,
    sealError: "pilot release cannot seal unresolved config v3 review aid",
    readStageError: "Unresolved config v3 rule stage integrity check failed",
    readAidError: "Unresolved config v3 review aid integrity check failed" },
];
const unresolvedConfigDescriptorFor = (profileId: unknown): UnresolvedConfigDescriptor | null =>
  UNRESOLVED_CONFIG_DESCRIPTORS.find((descriptor) => descriptor.profileId === profileId) ?? null;
const unresolvedConfigSidecarKeys = UNRESOLVED_CONFIG_DESCRIPTORS
  .map((descriptor) => descriptor.sidecarKey);
function hasOnlySelectedUnresolvedSidecar(result: Record<string, unknown>,
  descriptor: UnresolvedConfigDescriptor | null): boolean {
  return unresolvedConfigSidecarKeys.every((key) =>
    (key in result) === (descriptor?.sidecarKey === key));
}
function verifyPinnedUnresolvedConfigReview(
  descriptor: UnresolvedConfigDescriptor,
  rules: unknown,
  configHash: string | null,
  input: Omit<UnresolvedConfigVerificationInput, "config" | "result">,
  result: Record<string, unknown>,
): boolean {
  if (!isRecord(rules) || !configHash
    || !hasOnlySelectedUnresolvedSidecar(result, descriptor)
    || canonicalJson(rules.definitions) !== canonicalJson(descriptor.definitions)
    || sha256(canonicalJson(descriptor.definitions)) !== configHash
    || canonicalJson(rules[descriptor.configKey]) !== canonicalJson(descriptor.pinnedConfig)) {
    return false;
  }
  return descriptor.verify({ ...input,
    config: rules[descriptor.configKey], result: result[descriptor.sidecarKey] });
}
const MATERIAL_CLASS_RULES = {
  ...pilotPz002Pz017Rules,
  materialClassReview: {
    ruleId: "pilot-material-class-review", version: "1",
    extractionProfile: "material-class-text-navigation-v1", codeCount: 3,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const EQUIPMENT_SPEC_RULES = {
  ...pilotPz002Pz017Rules,
  equipmentSpecReview: {
    ruleId: "pilot-equipment-spec-review", version: "1",
    extractionProfile: "equipment-spec-text-navigation-v1", codeCount: 3,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const SITE_GP_TABLE_ROW_RULES = {
  ...pilotPz002Pz017Rules,
  siteGpTableRowReview: {
    ruleId: "pilot-site-gp-table-row-review", version: "1",
    extractionProfile: "site-gp-table-row-review-v1", codeCount: 2,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const SITE_GP_CONTEXT_RULES = {
  ...pilotPz002Pz017Rules,
  siteGpContextReview: {
    ruleId: "pilot-site-gp-context-review", version: "1",
    extractionProfile: "site-gp-context-text-review-v1", codeCount: 5,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const SITE_TEP_AREA_RULES = {
  ...pilotPz002Pz017Rules,
  siteTepAreaReview: {
    ruleId: "pilot-site-tep-area-review", version: "1",
    extractionProfile: "site-tep-area-text-review-v1", codeCount: 3,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
const UNRESOLVED_FAMILY_OCR_RULES = {
  ...pilotPz002Pz017Rules,
  unresolvedFamilyOcrReview: {
    ruleId: "pilot-unresolved-family-ocr-review", version: "1",
    extractionProfile: "unresolved-family-ocr-review-v1", codeCount: 3,
    disposition: "REVIEW_AID_ONLY",
  },
} as const;
type OcrTableVersion = boolean | "v2" | "v3";
const isOcrTableProfile = (profileId: string | null | undefined):
  profileId is typeof OCR_TABLE_PROFILE | typeof OCR_TABLE_PROFILE_V2
    | typeof OCR_TABLE_PROFILE_V3 | typeof UNRESOLVED_FAMILY_PROFILE =>
  profileId === OCR_TABLE_PROFILE || profileId === OCR_TABLE_PROFILE_V2
  || profileId === OCR_TABLE_PROFILE_V3 || profileId === UNRESOLVED_FAMILY_PROFILE;
const ocrTableVersionForProfile = (profileId: string | null | undefined): OcrTableVersion =>
  profileId === OCR_TABLE_PROFILE_V3 || profileId === UNRESOLVED_FAMILY_PROFILE
    ? "v3" : profileId === OCR_TABLE_PROFILE_V2 ? "v2"
    : profileId === OCR_TABLE_PROFILE;
function verifyPinnedOcrTableRows(result: unknown, stage: OcrHeatStageEnvelope,
  manifestHash: string, ruleProfileId: string): boolean {
  if (!isRecord(result) || !isOcrTableProfile(ruleProfileId)) return false;
  const version = ruleProfileId === OCR_TABLE_PROFILE_V3
    || ruleProfileId === UNRESOLVED_FAMILY_PROFILE ? "v3"
    : ruleProfileId === OCR_TABLE_PROFILE_V2 ? "v2" : "v1";
  return result.schemaVersion === `ocr-table-row-proposals-${version}`
    && result.profileId === `conservative-ocr-table-rows-${version}`
    && verifyOcrTableRows(result, stage, manifestHash);
}
const MAX_TEXT_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_STAGE_ARTIFACT_BYTES = 64 * 1024;
const TEXT_QUALITY_POLICY_VERSION = "text-layer-quality-v2" as const;
type TextQualityPolicyVersion = "text-layer-quality-v1" | typeof TEXT_QUALITY_POLICY_VERSION;

type ScaffoldJobType =
  | "DOCUMENT_RENDER"
  | "DOCUMENT_OCR_LAYOUT"
  | "DOCUMENT_METADATA"
  | "DOCUMENT_LINKING"
  | "ENTITY_EXTRACTION"
  | "RULE_EVALUATION"
  | "EVIDENCE_VALIDATION";

interface StageScaffoldContract {
  disposition: "PROVIDER_NOT_CONFIGURED" | "POLICY_NOT_CONFIGURED" | "UNSUPPORTED_RULESET" | "NO_MACHINE_RESULTS";
  reasonCode: string;
  providerKind: string;
}

interface ReleaseProviderSlot {
  stageJobType: ScaffoldJobType;
  providerKind: string;
  status: "UNCONFIGURED" | "CONFIGURED";
  profileId: string | null;
  adapterVersion: string | null;
  artifactHash: null;
  configHash: string | null;
  licenseId: null;
  resourceProfile: string | null;
}

interface AnalysisReleaseManifest {
  schemaVersion: "analysis-release-v1";
  releaseId: string;
  lifecycle: "SCAFFOLD" | "DRAFT";
  externalNetworkAllowed: false;
  textLayer: {
    artifactSchemaVersion: "document-text-v2";
    qualityPolicyVersion: TextQualityPolicyVersion;
  };
  rules: {
    catalogVersion: "matrix-132-v1";
    parameterCount: number;
    executionStatus: "UNCONFIGURED" | "PILOT";
    definitions?: typeof pilotPz002Rules | typeof pilotPz002Pz017Rules
      | typeof pilotPz002Pz017OcrHeatRules | typeof pilotPz002Pz017OcrHeatFactFamilyRules
      | typeof pilotPz002Pz017OcrHeatFactFamilyCandidatePreviewRules
      | typeof pilotPz002Pz017OcrHeatFactFamilyCandidateObservationsRules
      | typeof pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules;
  };
  providerSlots: ReleaseProviderSlot[];
  reviewArtifacts?: { ocrTypedFactCandidates: "ocr-typed-fact-candidates-v1" };
}

const STAGE_SCAFFOLD_CONTRACTS: Record<ScaffoldJobType, StageScaffoldContract> = {
  DOCUMENT_RENDER: {
    disposition: "PROVIDER_NOT_CONFIGURED",
    reasonCode: "RENDERER_PROFILE_NOT_SELECTED",
    providerKind: "RENDERER",
  },
  DOCUMENT_OCR_LAYOUT: {
    disposition: "PROVIDER_NOT_CONFIGURED",
    reasonCode: "OCR_LAYOUT_PROFILE_NOT_SELECTED",
    providerKind: "OCR_LAYOUT",
  },
  DOCUMENT_METADATA: {
    disposition: "PROVIDER_NOT_CONFIGURED",
    reasonCode: "METADATA_PROFILE_NOT_SELECTED",
    providerKind: "METADATA_EXTRACTOR",
  },
  DOCUMENT_LINKING: {
    disposition: "POLICY_NOT_CONFIGURED",
    reasonCode: "LINKING_POLICY_NOT_SELECTED",
    providerKind: "LINKING_POLICY",
  },
  ENTITY_EXTRACTION: {
    disposition: "PROVIDER_NOT_CONFIGURED",
    reasonCode: "ENTITY_EXTRACTION_PROFILE_NOT_SELECTED",
    providerKind: "ENTITY_EXTRACTION_MODEL",
  },
  RULE_EVALUATION: {
    disposition: "UNSUPPORTED_RULESET",
    reasonCode: "EXECUTABLE_RULES_NOT_CONFIGURED",
    providerKind: "RULE_ENGINE",
  },
  EVIDENCE_VALIDATION: {
    disposition: "NO_MACHINE_RESULTS",
    reasonCode: "RULE_RESULTS_UNAVAILABLE",
    providerKind: "EVIDENCE_VALIDATOR",
  },
};

const ACTIVE_STAGE_LABELS: Record<AnalysisJobType, string> = {
  ANALYSIS_INVENTORY: "Инвентаризация immutable manifest",
  DOCUMENT_TEXT_LAYER: "Извлечение PDF text layer",
  DOCUMENT_RENDER: "Рендер страниц",
  DOCUMENT_OCR_LAYOUT: "OCR и layout extraction",
  DOCUMENT_METADATA: "Извлечение метаданных",
  DOCUMENT_LINKING: "Связывание редакций и комплектов",
  ENTITY_EXTRACTION: "Извлечение параметров",
  RULE_EVALUATION: "Проверка применимости и правил",
  EVIDENCE_VALIDATION: "Валидация evidence",
  ANALYSIS_SEAL_UNSUPPORTED: "Формирование coverage",
};

const COMPLETED_STAGE_LABELS: Record<Exclude<AnalysisJobType, "ANALYSIS_SEAL_UNSUPPORTED">, string> = {
  ANALYSIS_INVENTORY: "Manifest inventory завершён",
  DOCUMENT_TEXT_LAYER: "PDF text layer сохранён",
  DOCUMENT_RENDER: "Стадия render зафиксирована",
  DOCUMENT_OCR_LAYOUT: "Стадия OCR/layout зафиксирована",
  DOCUMENT_METADATA: "Стадия metadata зафиксирована",
  DOCUMENT_LINKING: "Стадия linking зафиксирована",
  ENTITY_EXTRACTION: "Стадия extraction зафиксирована",
  RULE_EVALUATION: "Стадия rules зафиксирована",
  EVIDENCE_VALIDATION: "Стадия evidence зафиксирована",
};

function buildScaffoldReleaseManifest(parameterCount: number): {
  manifest: AnalysisReleaseManifest;
  canonical: string;
  contentHash: string;
  byteSize: number;
} {
  const providerSlots = (Object.keys(STAGE_SCAFFOLD_CONTRACTS) as ScaffoldJobType[]).map((stageJobType) => ({
    stageJobType,
    providerKind: STAGE_SCAFFOLD_CONTRACTS[stageJobType].providerKind,
    status: "UNCONFIGURED" as const,
    profileId: null,
    adapterVersion: null,
    artifactHash: null,
    configHash: null,
    licenseId: null,
    resourceProfile: null,
  }));
  const identity = {
    schemaVersion: "analysis-release-v1" as const,
    lifecycle: "SCAFFOLD" as const,
    externalNetworkAllowed: false as const,
    textLayer: {
      artifactSchemaVersion: "document-text-v2" as const,
      qualityPolicyVersion: TEXT_QUALITY_POLICY_VERSION,
    },
    rules: {
      catalogVersion: "matrix-132-v1" as const,
      parameterCount,
      executionStatus: "UNCONFIGURED" as const,
    },
    providerSlots,
  };
  const releaseId = `release:scaffold:${sha256(canonicalJson(identity)).slice(0, 24)}`;
  const manifest: AnalysisReleaseManifest = { ...identity, releaseId };
  const canonical = canonicalJson(manifest);
  return {
    manifest,
    canonical,
    contentHash: sha256(canonical),
    byteSize: Buffer.byteLength(canonical, "utf8"),
  };
}

function buildPilotPz002ReleaseManifest(parameterCount: number, visualProfile: "V4" | "V5" | "V6" = "V4"): ReturnType<typeof buildScaffoldReleaseManifest> {
  const scaffold = buildScaffoldReleaseManifest(parameterCount).manifest;
  const configHash = sha256(canonicalJson(pilotPz002Rules));
  const identity = {
    schemaVersion: "analysis-release-v1" as const,
    lifecycle: "DRAFT" as const,
    externalNetworkAllowed: false as const,
    textLayer: scaffold.textLayer,
    rules: {
      catalogVersion: "matrix-132-v1" as const,
      parameterCount,
      executionStatus: "PILOT" as const,
      definitions: pilotPz002Rules,
    },
    providerSlots: scaffold.providerSlots.map((slot) => slot.stageJobType === "ENTITY_EXTRACTION"
      ? {
          ...slot,
          status: "CONFIGURED" as const,
          profileId: visualProfile === "V6" ? v6VisualProposalProfileId
            : visualProfile === "V5" ? v5VisualProposalProfileId : visualProposalProfileId,
          adapterVersion: visualProfile === "V6" ? "6" : visualProfile === "V5" ? "5" : "4",
          configHash: visualProfile === "V6" ? v6VisualProposalConfigHash
            : visualProfile === "V5" ? v5VisualProposalConfigHash : visualProposalConfigHash,
          resourceProfile: "CPU",
        }
      : slot.stageJobType === "RULE_EVALUATION"
      ? {
          ...slot,
          status: "CONFIGURED" as const,
          profileId: "typed-pz002-v1",
          adapterVersion: "1",
          configHash,
          resourceProfile: "CPU",
        }
      : slot),
  };
  const releaseId = `release:pz002:${sha256(canonicalJson(identity)).slice(0, 24)}`;
  const manifest: AnalysisReleaseManifest = { ...identity, releaseId };
  const canonical = canonicalJson(manifest);
  return { manifest, canonical, contentHash: sha256(canonical), byteSize: Buffer.byteLength(canonical, "utf8") };
}

/**
 * Immutable, review-only release descriptor for the isolated ZU-127 Poppler v3
 * stage. It is deliberately not selected by ensureAnalysisRelease: a normal
 * run must never persist a dedicated-queue job before its consumer and
 * independent durable result verifier are installed.
 */
export function buildZu127GenericV3ReleaseManifest(
  parameterCount: number,
): ReturnType<typeof buildScaffoldReleaseManifest> {
  const scaffold = buildScaffoldReleaseManifest(parameterCount).manifest;
  const identity = {
    schemaVersion: "analysis-release-v1" as const,
    lifecycle: "DRAFT" as const,
    externalNetworkAllowed: false as const,
    textLayer: scaffold.textLayer,
    rules: {
      catalogVersion: "matrix-132-v1" as const,
      parameterCount,
      executionStatus: "PILOT" as const,
    },
    providerSlots: scaffold.providerSlots.map((slot) => slot.stageJobType === "RULE_EVALUATION"
      ? { ...slot,
          status: "CONFIGURED" as const,
          profileId: ZU127_GENERIC_V3_PROFILE_ID,
          adapterVersion: "3",
          configHash: ZU127_GENERIC_V3_CONFIG_HASH,
          resourceProfile: "CPU" }
      : slot),
  };
  const releaseId = `release:zu127-generic-v3:${sha256(canonicalJson(identity)).slice(0, 24)}`;
  const manifest: AnalysisReleaseManifest = { ...identity, releaseId };
  const canonical = canonicalJson(manifest);
  return { manifest, canonical, contentHash: sha256(canonical),
    byteSize: Buffer.byteLength(canonical, "utf8") };
}

export function buildPilotPz002Pz017ReleaseManifest(
  parameterCount: number, visualProfile: "V4" | "V5" | "V6" = "V4",
  ocrProfile: "V1" | "V2" | "V3" | "V4" | "V5" | "V6" = "V1",
  ocrHeatRows = false,
  factFamily = false,
  candidatePreview = false,
  candidateObservations = false,
  candidateFamilyOcrObservations = false,
  ocrTableRows: OcrTableVersion = false,
  ocrTypedFactCandidates = false,
  unresolvedFamilyReview = false,
  unresolvedFamilyOcrReview = false,
  siteTepAreaReview = false,
  siteGpContextReview = false,
  siteGpTableRowReview = false,
  equipmentSpecReview = false,
  materialClassReview = false,
  unresolvedConfigReview = false,
  unresolvedConfigReviewV2 = false,
  unresolvedConfigReviewV3 = false,
  layerAssemblyReview = false,
  kr065OpeningReview = false,
): ReturnType<typeof buildScaffoldReleaseManifest> {
  if (ocrProfile === "V6" && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview)) {
    throw new Error("OCR v6 requires a separate release without OCR heat/table consumers");
  }
  if (unresolvedFamilyOcrReview && (ocrProfile !== "V6" || ocrHeatRows || factFamily
    || candidatePreview || candidateObservations || candidateFamilyOcrObservations
    || ocrTableRows || ocrTypedFactCandidates || unresolvedFamilyReview)) {
    throw new Error("Unresolved family OCR review requires OCR v6 without legacy OCR consumers");
  }
  if (siteTepAreaReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteGpContextReview || siteGpTableRowReview || equipmentSpecReview
    || materialClassReview || unresolvedConfigReview)) {
    throw new Error("Site TEP area review requires a separate release without OCR review consumers");
  }
  if (siteGpContextReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpTableRowReview || equipmentSpecReview
    || materialClassReview || unresolvedConfigReview)) {
    throw new Error("Site GP context review requires a separate release without OCR review consumers");
  }
  if (siteGpTableRowReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || equipmentSpecReview
    || materialClassReview || unresolvedConfigReview)) {
    throw new Error("Site GP table row review requires a separate release without OCR review consumers");
  }
  if (equipmentSpecReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || siteGpTableRowReview
    || materialClassReview || unresolvedConfigReview)) {
    throw new Error("Equipment spec review requires a separate release without OCR review consumers");
  }
  if (materialClassReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || siteGpTableRowReview
    || equipmentSpecReview || unresolvedConfigReview)) {
    throw new Error("Material class review requires a separate release without OCR review consumers");
  }
  if (unresolvedConfigReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || siteGpTableRowReview
    || equipmentSpecReview || materialClassReview)) {
    throw new Error("Unresolved config review requires an exclusive release");
  }
  if (unresolvedConfigReviewV2 && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || siteGpTableRowReview
    || equipmentSpecReview || materialClassReview || unresolvedConfigReview)) {
    throw new Error("Unresolved config review v2 requires an exclusive release");
  }
  if (unresolvedConfigReviewV3 && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || siteGpTableRowReview
    || equipmentSpecReview || materialClassReview || unresolvedConfigReview
    || unresolvedConfigReviewV2)) {
    throw new Error("Unresolved config review v3 requires an exclusive release");
  }
  if (layerAssemblyReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || siteGpTableRowReview
    || equipmentSpecReview || materialClassReview || unresolvedConfigReview
    || unresolvedConfigReviewV2 || unresolvedConfigReviewV3 || kr065OpeningReview)) {
    throw new Error("Layer assembly review requires an exclusive release");
  }
  if (kr065OpeningReview && (ocrHeatRows || factFamily || candidatePreview
    || candidateObservations || candidateFamilyOcrObservations || ocrTableRows
    || ocrTypedFactCandidates || unresolvedFamilyReview || unresolvedFamilyOcrReview
    || siteTepAreaReview || siteGpContextReview || siteGpTableRowReview
    || equipmentSpecReview || materialClassReview || unresolvedConfigReview
    || unresolvedConfigReviewV2 || unresolvedConfigReviewV3 || layerAssemblyReview)) {
    throw new Error("KR-065 opening review requires an exclusive release");
  }
  if (ocrHeatRows && !["V3", "V4", "V5"].includes(ocrProfile)) {
    throw new Error("OCR heat review requires bounded OCR v3, v4 or v5");
  }
  if (factFamily && !ocrHeatRows) throw new Error("Fact family review requires OCR heat review");
  if (candidatePreview && !factFamily) throw new Error("Candidate family preview requires fact family review");
  if (candidateObservations && !candidatePreview) throw new Error("Candidate family observations require preview");
  if (candidateFamilyOcrObservations && (!candidateObservations || !factFamily || !ocrHeatRows
    || !["V3", "V4", "V5"].includes(ocrProfile))) {
    throw new Error("Candidate family OCR observations require candidate observations, fact family and OCR v3/v4/v5");
  }
  if (ocrTableRows && (!candidateFamilyOcrObservations || !["V4", "V5"].includes(ocrProfile))) {
    throw new Error("OCR table rows require candidate family OCR observations and bounded OCR v4/v5");
  }
  if (ocrTypedFactCandidates && !ocrTableRows) {
    throw new Error("OCR typed fact candidates require OCR table rows");
  }
  if (unresolvedFamilyReview && ocrTableRows !== "v3") {
    throw new Error("Unresolved family review requires OCR table rows v3");
  }
  const previous = buildPilotPz002ReleaseManifest(parameterCount, visualProfile).manifest;
  const { releaseId: _previousReleaseId, ...previousIdentity } = previous;
  const definitions = kr065OpeningReview ? KR065_OPENING_RULES
    : layerAssemblyReview ? LAYER_ASSEMBLY_RULES
    : unresolvedConfigReviewV3 ? UNRESOLVED_CONFIG_RULES_V3
    : unresolvedConfigReviewV2 ? UNRESOLVED_CONFIG_RULES_V2
    : unresolvedConfigReview ? UNRESOLVED_CONFIG_RULES
    : materialClassReview ? MATERIAL_CLASS_RULES
    : equipmentSpecReview ? EQUIPMENT_SPEC_RULES
    : siteGpTableRowReview ? SITE_GP_TABLE_ROW_RULES
    : siteGpContextReview ? SITE_GP_CONTEXT_RULES
    : siteTepAreaReview ? SITE_TEP_AREA_RULES
    : unresolvedFamilyOcrReview ? UNRESOLVED_FAMILY_OCR_RULES
    : unresolvedFamilyReview
    ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableUnresolvedRulesV1
    : ocrTableRows === "v3"
    ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3
    : ocrTableRows === "v2" ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2
    : ocrTableRows ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules
    : candidateFamilyOcrObservations
    ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules
    : candidateObservations ? pilotPz002Pz017OcrHeatFactFamilyCandidateObservationsRules
    : candidatePreview ? pilotPz002Pz017OcrHeatFactFamilyCandidatePreviewRules
    : factFamily ? pilotPz002Pz017OcrHeatFactFamilyRules
    : ocrHeatRows ? pilotPz002Pz017OcrHeatRules : pilotPz002Pz017Rules;
  const configHash = sha256(canonicalJson(definitions));
  const identity = {
    ...previousIdentity,
    ...(ocrTypedFactCandidates ? { reviewArtifacts: {
      ocrTypedFactCandidates: "ocr-typed-fact-candidates-v1" as const,
    } } : {}),
    rules: { ...previous.rules, definitions,
      ...(unresolvedConfigReview ? { unresolvedConfig: pinnedUnresolvedReviewConfig } : {}),
      ...(unresolvedConfigReviewV2 ? { unresolvedConfigV2: pinnedUnresolvedReviewConfigV2 } : {}),
      ...(unresolvedConfigReviewV3 ? { unresolvedConfigV3: pinnedUnresolvedReviewConfigV3 } : {}) },
    providerSlots: previous.providerSlots.map((slot) => slot.stageJobType === "RULE_EVALUATION"
      ? { ...slot, profileId: kr065OpeningReview ? KR065_OPENING_PROFILE
        : layerAssemblyReview ? LAYER_ASSEMBLY_PROFILE
        : unresolvedConfigReviewV3 ? UNRESOLVED_CONFIG_PROFILE_V3
        : unresolvedConfigReviewV2 ? UNRESOLVED_CONFIG_PROFILE_V2
        : unresolvedConfigReview ? UNRESOLVED_CONFIG_PROFILE
        : materialClassReview ? MATERIAL_CLASS_PROFILE
        : equipmentSpecReview ? EQUIPMENT_SPEC_PROFILE
        : siteGpTableRowReview ? SITE_GP_TABLE_ROW_PROFILE
        : siteGpContextReview ? SITE_GP_CONTEXT_PROFILE
        : siteTepAreaReview ? SITE_TEP_AREA_PROFILE
        : unresolvedFamilyOcrReview ? UNRESOLVED_FAMILY_OCR_PROFILE
        : unresolvedFamilyReview ? UNRESOLVED_FAMILY_PROFILE
        : ocrTableRows === "v3" ? OCR_TABLE_PROFILE_V3
        : ocrTableRows === "v2" ? OCR_TABLE_PROFILE_V2
        : ocrTableRows ? OCR_TABLE_PROFILE
        : candidateFamilyOcrObservations
          ? "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
        : candidateObservations
          ? "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
        : candidatePreview ? "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
        : factFamily ? "typed-pz002-pz017-ocr-heat-fact-family-v1"
        : ocrHeatRows ? "typed-pz002-pz017-ocr-heat-v1" : "typed-pz002-pz017-v1",
          adapterVersion: kr065OpeningReview ? "21" : layerAssemblyReview ? "20" : unresolvedConfigReviewV3 ? "19" : unresolvedConfigReviewV2 ? "18" : unresolvedConfigReview ? "17" : materialClassReview ? "16" : equipmentSpecReview ? "15" : siteGpTableRowReview ? "14" : siteGpContextReview ? "13" : siteTepAreaReview ? "12" : unresolvedFamilyOcrReview ? "11" : unresolvedFamilyReview ? "10" : ocrTableRows === "v3" ? "9" : ocrTableRows === "v2" ? "8"
            : ocrTableRows ? "7" : candidateFamilyOcrObservations ? "6"
            : candidateObservations ? "5" : candidatePreview ? "4"
            : factFamily ? "3" : ocrHeatRows ? "2" : "1", configHash }
      : slot.stageJobType === "DOCUMENT_OCR_LAYOUT"
        ? { ...slot, status: "CONFIGURED" as const,
            profileId: ocrProfile === "V6" ? boundedOcrProfileIdV6
              : ocrProfile === "V5" ? boundedOcrProfileIdV5
              : ocrProfile === "V4" ? boundedOcrProfileIdV4
              : ocrProfile === "V3" ? boundedOcrProfileIdV3
              : ocrProfile === "V2" ? boundedOcrProfileIdV2 : boundedOcrProfileId,
            adapterVersion: ocrProfile === "V6" ? "6" : ocrProfile === "V5" ? "5" : ocrProfile === "V4" ? "4"
              : ocrProfile === "V3" ? "3"
              : ocrProfile === "V2" ? "2" : "1",
            configHash: ocrProfile === "V6" ? boundedOcrConfigHashV6
              : ocrProfile === "V5" ? boundedOcrConfigHashV5
              : ocrProfile === "V4" ? boundedOcrConfigHashV4
              : ocrProfile === "V3" ? boundedOcrConfigHashV3
              : ocrProfile === "V2" ? boundedOcrConfigHashV2 : boundedOcrConfigHash,
            resourceProfile: "CPU" }
        : slot),
  };
  const releaseId = `release:pz002-pz017:${sha256(canonicalJson(identity)).slice(0, 24)}`;
  const manifest: AnalysisReleaseManifest = { ...identity, releaseId };
  const canonical = canonicalJson(manifest);
  return { manifest, canonical, contentHash: sha256(canonical), byteSize: Buffer.byteLength(canonical, "utf8") };
}

function isScaffoldJobType(jobType: AnalysisJobType): jobType is ScaffoldJobType {
  return Object.prototype.hasOwnProperty.call(STAGE_SCAFFOLD_CONTRACTS, jobType);
}

function buildExpectedScaffoldResult(
  jobType: ScaffoldJobType,
  inputManifestHash: string,
): Record<string, unknown> {
  const contract = STAGE_SCAFFOLD_CONTRACTS[jobType];
  return {
    schemaVersion: "analysis-stage-result-v1",
    jobType,
    inputManifestHash,
    disposition: contract.disposition,
    reasonCode: contract.reasonCode,
    providerKind: contract.providerKind,
    providerProfileId: null,
    providerConfigHash: null,
    outputCount: 0,
  };
}

interface PageTextQuality {
  disposition: "TEXT_LAYER_CANDIDATE" | "OCR_REQUIRED";
  reasonCodes: Array<"EMPTY_TEXT_LAYER" | "NO_ALPHANUMERIC_TEXT" | "TEXT_DECODING_ANOMALY">;
  metrics: {
    blockCount: number;
    nonWhitespaceCharacterCount: number;
    alphanumericCharacterCount: number;
    replacementCharacterCount: number;
    disallowedControlCharacterCount: number;
  };
}

interface DocumentTextArtifact {
  schemaVersion: "document-text-v1" | "document-text-v2";
  sourceFileId: string;
  inputSha256: string;
  coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS";
  pageCount: number;
  textPageCount: number;
  qualityPolicyVersion?: TextQualityPolicyVersion;
  qualitySummary?: {
    textLayerCandidatePageCount: number;
    ocrRequiredPageCount: number;
  };
  pages: Array<{
    pageNumber: number;
    widthMilliPoints: number;
    heightMilliPoints: number;
    blocks: Array<{
      bboxMilliPoints: [number, number, number, number];
      lineBboxesMilliPoints?: Array<[number, number, number, number]>;
      text: string;
    }>;
    quality?: PageTextQuality;
  }>;
}

interface ExpectedTextSource {
  id: string;
  apiId: string;
  sha256: string;
  mediaType: string;
}

interface ValidatedTextArtifact {
  id: string;
  source: ExpectedTextSource;
  artifact: DocumentTextArtifact;
  canonical: string;
  contentHash: string;
  byteSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerSlotForJob(
  releaseManifest: Record<string, unknown>,
  jobType: AnalysisJobType,
): JobLease["release"]["providerSlot"] {
  if (!Array.isArray(releaseManifest.providerSlots)) return null;
  const slot = releaseManifest.providerSlots.find(
    (candidate) => isRecord(candidate) && candidate.stageJobType === jobType,
  );
  if (!isRecord(slot)) return null;
  return {
    stageJobType: jobType,
    providerKind: String(slot.providerKind),
    status: slot.status === "CONFIGURED" ? "CONFIGURED" : "UNCONFIGURED",
    profileId: typeof slot.profileId === "string" ? slot.profileId : null,
    adapterVersion: typeof slot.adapterVersion === "string" ? slot.adapterVersion : null,
    artifactHash: typeof slot.artifactHash === "string" ? slot.artifactHash : null,
    configHash: typeof slot.configHash === "string" ? slot.configHash : null,
    licenseId: typeof slot.licenseId === "string" ? slot.licenseId : null,
    resourceProfile: typeof slot.resourceProfile === "string" ? slot.resourceProfile : null,
  };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTextPolicyWhitespace(character: string): boolean {
  return /^[\t\n\v\f\r\u001c-\u001f\u0085]$/u.test(character)
    || /[\p{Zs}\p{Zl}\p{Zp}]/u.test(character);
}

function qualifyPageText(blocks: Array<{ text: string }>,
  policyVersion: TextQualityPolicyVersion): PageTextQuality {
  const text = blocks.map((block) => block.text).join("\n");
  let nonWhitespaceCharacterCount = 0;
  let alphanumericCharacterCount = 0;
  let replacementCharacterCount = 0;
  let disallowedControlCharacterCount = 0;
  for (const character of text) {
    if (!isTextPolicyWhitespace(character)) nonWhitespaceCharacterCount += 1;
    if (/[\p{L}\p{N}]/u.test(character)) alphanumericCharacterCount += 1;
    if (character === "\uFFFD") replacementCharacterCount += 1;
    if (/\p{Cc}/u.test(character) && !["\n", "\r", "\t"].includes(character)) {
      disallowedControlCharacterCount += 1;
    }
  }
  const reasonCodes: PageTextQuality["reasonCodes"] = [];
  if (nonWhitespaceCharacterCount === 0) {
    reasonCodes.push("EMPTY_TEXT_LAYER");
  } else {
    if (alphanumericCharacterCount === 0) reasonCodes.push("NO_ALPHANUMERIC_TEXT");
    if (replacementCharacterCount > 0 || disallowedControlCharacterCount > 0
      || policyVersion === TEXT_QUALITY_POLICY_VERSION && /\(cid:[0-9]+\)/u.test(text)) {
      reasonCodes.push("TEXT_DECODING_ANOMALY");
    }
  }
  return {
    disposition: reasonCodes.length > 0 ? "OCR_REQUIRED" : "TEXT_LAYER_CANDIDATE",
    reasonCodes,
    metrics: {
      blockCount: blocks.length,
      nonWhitespaceCharacterCount,
      alphanumericCharacterCount,
      replacementCharacterCount,
      disallowedControlCharacterCount,
    },
  };
}

function validateDocumentTextArtifact(
  value: unknown,
  source: ExpectedTextSource,
  releaseTextLayer: AnalysisReleaseManifest["textLayer"],
): { artifact: DocumentTextArtifact; canonical: string; contentHash: string; byteSize: number } | undefined {
  if (!isRecord(value)) return undefined;
  const isV2 = value.schemaVersion === "document-text-v2";
  if (value.schemaVersion !== releaseTextLayer.artifactSchemaVersion) return undefined;
  const topLevelKeys = isV2
    ? [
      "schemaVersion", "sourceFileId", "inputSha256", "coordinateSystem",
      "pageCount", "textPageCount", "qualityPolicyVersion", "qualitySummary", "pages",
    ]
    : [
      "schemaVersion", "sourceFileId", "inputSha256", "coordinateSystem",
      "pageCount", "textPageCount", "pages",
    ];
  if (!hasExactKeys(value, topLevelKeys)) return undefined;
  if (
    !["document-text-v1", "document-text-v2"].includes(String(value.schemaVersion))
    || value.sourceFileId !== source.apiId
    || value.inputSha256 !== source.sha256
    || value.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || !Number.isInteger(value.pageCount)
    || Number(value.pageCount) < 1
    || !Number.isInteger(value.textPageCount)
    || Number(value.textPageCount) < 0
    || Number(value.textPageCount) > Number(value.pageCount)
    || !Array.isArray(value.pages)
    || value.pages.length !== value.pageCount
  ) return undefined;

  if (isV2 && value.qualityPolicyVersion !== releaseTextLayer.qualityPolicyVersion) return undefined;

  let countedTextPages = 0;
  let textLayerCandidatePageCount = 0;
  for (let pageIndex = 0; pageIndex < value.pages.length; pageIndex += 1) {
    const page = value.pages[pageIndex];
    const pageKeys = isV2
      ? ["pageNumber", "widthMilliPoints", "heightMilliPoints", "blocks", "quality"]
      : ["pageNumber", "widthMilliPoints", "heightMilliPoints", "blocks"];
    if (!isRecord(page) || !hasExactKeys(page, pageKeys)) {
      return undefined;
    }
    if (
      page.pageNumber !== pageIndex + 1
      || !Number.isInteger(page.widthMilliPoints)
      || Number(page.widthMilliPoints) <= 0
      || !Number.isInteger(page.heightMilliPoints)
      || Number(page.heightMilliPoints) <= 0
      || !Array.isArray(page.blocks)
    ) return undefined;
    if (page.blocks.length > 0) countedTextPages += 1;
    for (const block of page.blocks) {
      if (!isRecord(block) || !hasExactKeys(block,
        isV2 && "lineBboxesMilliPoints" in block
          ? ["bboxMilliPoints", "lineBboxesMilliPoints", "text"]
          : ["bboxMilliPoints", "text"])) return undefined;
      const bbox = block.bboxMilliPoints;
      if (
        !Array.isArray(bbox)
        || bbox.length !== 4
        || !bbox.every((coordinate) => Number.isInteger(coordinate))
        || Number(bbox[0]) < 0
        || Number(bbox[1]) < 0
        || Number(bbox[2]) < Number(bbox[0])
        || Number(bbox[3]) < Number(bbox[1])
        || Number(bbox[2]) > Number(page.widthMilliPoints)
        || Number(bbox[3]) > Number(page.heightMilliPoints)
        || typeof block.text !== "string"
        || block.text.length === 0
      ) return undefined;
      if ("lineBboxesMilliPoints" in block) {
        const lineBoxes = block.lineBboxesMilliPoints;
        if (!isV2 || !Array.isArray(lineBoxes)
          || lineBoxes.length !== block.text.split(/\r\n|\n|\r/u).length
          || lineBoxes.some((lineBox) => !Array.isArray(lineBox)
            || lineBox.length !== 4
            || lineBox.some((coordinate) => !Number.isInteger(coordinate))
            || Number(lineBox[0]) < Number(bbox[0])
            || Number(lineBox[1]) < Number(bbox[1])
            || Number(lineBox[2]) > Number(bbox[2])
            || Number(lineBox[3]) > Number(bbox[3])
            || Number(lineBox[2]) < Number(lineBox[0])
            || Number(lineBox[3]) < Number(lineBox[1]))) return undefined;
      }
    }
    if (isV2) {
      const expectedQuality = qualifyPageText(page.blocks as Array<{ text: string }>,
        value.qualityPolicyVersion as TextQualityPolicyVersion);
      if (!isRecord(page.quality) || canonicalJson(page.quality) !== canonicalJson(expectedQuality)) return undefined;
      if (expectedQuality.disposition === "TEXT_LAYER_CANDIDATE") textLayerCandidatePageCount += 1;
    }
  }
  if (countedTextPages !== value.textPageCount) return undefined;
  if (isV2) {
    const expectedSummary = {
      textLayerCandidatePageCount,
      ocrRequiredPageCount: value.pages.length - textLayerCandidatePageCount,
    };
    if (!isRecord(value.qualitySummary) || canonicalJson(value.qualitySummary) !== canonicalJson(expectedSummary)) {
      return undefined;
    }
  }
  const artifact = value as unknown as DocumentTextArtifact;
  const canonical = canonicalJson(artifact);
  const byteSize = Buffer.byteLength(canonical, "utf8");
  if (byteSize < 1 || byteSize > MAX_TEXT_ARTIFACT_BYTES) return undefined;
  return { artifact, canonical, contentHash: sha256(canonical), byteSize };
}

function validateDocumentTextResult(
  result: Record<string, unknown>,
  expectedSources: ExpectedTextSource[],
  releaseTextLayer: AnalysisReleaseManifest["textLayer"],
): {
  artifacts: ValidatedTextArtifact[];
  storedResult: Record<string, unknown>;
} | undefined {
  if (result.disposition !== "DOCUMENT_TEXT_LAYER_COMPLETED" || !Array.isArray(result.sources)) return undefined;
  if (result.sources.length !== expectedSources.length) return undefined;
  const expectedById = new Map(expectedSources.map((source) => [source.apiId, source]));
  const seen = new Set<string>();
  const artifacts: ValidatedTextArtifact[] = [];
  const storedSources: Array<Record<string, unknown>> = [];
  let totalArtifactBytes = 0;

  for (const item of result.sources) {
    if (!isRecord(item)) return undefined;
    const sourceFileId = item.sourceFileId;
    const source = typeof sourceFileId === "string" ? expectedById.get(sourceFileId) : undefined;
    if (!source || seen.has(source.apiId) || item.inputSha256 !== source.sha256) return undefined;
    seen.add(source.apiId);

    if (item.status === "EXTRACTED") {
      const validated = validateDocumentTextArtifact(item.artifact, source, releaseTextLayer);
      if (!validated) return undefined;
      const artifactId = randomUUID();
      totalArtifactBytes += validated.byteSize;
      if (totalArtifactBytes > MAX_TEXT_ARTIFACT_BYTES) return undefined;
      artifacts.push({ id: artifactId, source, ...validated });
      storedSources.push({
        sourceFileId: source.apiId,
        inputSha256: source.sha256,
        status: "EXTRACTED",
        artifactId,
        schemaVersion: validated.artifact.schemaVersion,
        contentHash: validated.contentHash,
        byteSize: validated.byteSize,
        pageCount: validated.artifact.pageCount,
        textPageCount: validated.artifact.textPageCount,
        ...(validated.artifact.schemaVersion === "document-text-v2"
          ? { qualitySummary: validated.artifact.qualitySummary }
          : {}),
      });
      continue;
    }
    if (
      item.status !== "SKIPPED_UNSUPPORTED_FORMAT"
      || source.mediaType === "application/pdf"
      || typeof item.reason !== "string"
      || item.reason.length < 1
      || item.reason.length > 500
    ) return undefined;
    storedSources.push({
      sourceFileId: source.apiId,
      inputSha256: source.sha256,
      status: "SKIPPED_UNSUPPORTED_FORMAT",
      reason: item.reason,
    });
  }

  return {
    artifacts,
    storedResult: {
      disposition: "DOCUMENT_TEXT_LAYER_COMPLETED",
      sourceCount: expectedSources.length,
      extractedCount: artifacts.length,
      skippedCount: expectedSources.length - artifacts.length,
      ocrRequiredPageCount: countOcrRequiredPages(artifacts),
      sources: storedSources,
      ...(typeof result.workerId === "string" && result.workerId.length <= 200 ? { workerId: result.workerId } : {}),
    },
  };
}

function validateScaffoldStageResult(
  result: Record<string, unknown>,
  jobType: ScaffoldJobType,
  inputManifestHash: string,
): {
  id: string;
  canonical: string;
  contentHash: string;
  byteSize: number;
  storedResult: Record<string, unknown>;
} | undefined {
  const expected = buildExpectedScaffoldResult(jobType, inputManifestHash);
  if (canonicalJson(result) !== canonicalJson(expected)) return undefined;
  const canonical = canonicalJson(expected);
  const byteSize = Buffer.byteLength(canonical, "utf8");
  if (byteSize < 1 || byteSize > MAX_STAGE_ARTIFACT_BYTES) return undefined;
  const id = randomUUID();
  const contentHash = sha256(canonical);
  return {
    id,
    canonical,
    contentHash,
    byteSize,
    storedResult: {
      schemaVersion: expected.schemaVersion,
      artifactId: id,
      disposition: expected.disposition,
      reasonCode: expected.reasonCode,
      providerKind: expected.providerKind,
      providerProfileId: null,
      providerConfigHash: null,
      outputCount: 0,
      contentHash,
      byteSize,
    },
  };
}

function validatePilotPz002StageResult(
  result: Record<string, unknown>,
  manifestHash: string,
  objectId: string,
  sources: Array<{ apiId: string; sha256: string }>,
  configHash: string,
  verifiedCandidate: VerifiedPilotCandidate | null,
  profileId: "typed-pz002-v1" | "typed-pz002-pz017-v1"
    | "typed-pz002-pz017-ocr-heat-v1" | "typed-pz002-pz017-ocr-heat-fact-family-v1"
    | "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
    | "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
    | "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
    | typeof OCR_TABLE_PROFILE | typeof OCR_TABLE_PROFILE_V2 | typeof OCR_TABLE_PROFILE_V3
    | typeof UNRESOLVED_FAMILY_PROFILE | typeof UNRESOLVED_FAMILY_OCR_PROFILE
    | typeof SITE_TEP_AREA_PROFILE | typeof SITE_GP_CONTEXT_PROFILE
    | typeof SITE_GP_TABLE_ROW_PROFILE | typeof EQUIPMENT_SPEC_PROFILE
    | typeof MATERIAL_CLASS_PROFILE | typeof UNRESOLVED_CONFIG_PROFILE
    | typeof UNRESOLVED_CONFIG_PROFILE_V2 | typeof UNRESOLVED_CONFIG_PROFILE_V3
    | typeof LAYER_ASSEMBLY_PROFILE | typeof KR065_OPENING_PROFILE,
  verifiedHeat: boolean,
  verifiedOcrHeat: boolean,
  verifiedFactFamily: boolean,
  verifiedCandidatePreview: boolean,
  verifiedCandidateObservations: boolean,
  verifiedReviewCandidates: boolean,
  verifiedCandidateOcrObservations: boolean,
  verifiedOcrTableRows: boolean,
  verifiedUnresolvedFamilyReview: boolean,
  verifiedUnresolvedFamilyOcrReview: boolean,
  verifiedSiteTepAreaReview: boolean,
  verifiedSiteGpContextReview: boolean,
  verifiedSiteGpTableRowReview: boolean,
  verifiedEquipmentSpecReview: boolean,
  verifiedMaterialClassReview: boolean,
  verifiedUnresolvedConfigReview: boolean,
  verifiedLayerAssemblyReview: boolean,
  verifiedKr065OpeningReview: boolean,
): {
  id: string;
  canonical: string;
  contentHash: string;
  byteSize: number;
  reasonCode: string;
  storedResult: Record<string, unknown>;
} | undefined {
  if (
    result.schemaVersion !== "analysis-stage-result-v2"
    || result.jobType !== "RULE_EVALUATION"
    || result.inputManifestHash !== manifestHash
    || result.disposition !== "RULES_EVALUATED"
    || result.providerKind !== "RULE_ENGINE"
    || result.providerProfileId !== profileId
    || result.providerConfigHash !== configHash
    || result.outputCount !== (profileId === "typed-pz002-v1" ? 1
      : profileId === UNRESOLVED_FAMILY_OCR_PROFILE || profileId === SITE_TEP_AREA_PROFILE
        || profileId === SITE_GP_CONTEXT_PROFILE || profileId === SITE_GP_TABLE_ROW_PROFILE
        || profileId === EQUIPMENT_SPEC_PROFILE || profileId === MATERIAL_CLASS_PROFILE
        || profileId === UNRESOLVED_CONFIG_PROFILE
        || profileId === UNRESOLVED_CONFIG_PROFILE_V2
        || profileId === UNRESOLVED_CONFIG_PROFILE_V3
        || profileId === LAYER_ASSEMBLY_PROFILE
        || profileId === KR065_OPENING_PROFILE ? 3
      : profileId === UNRESOLVED_FAMILY_PROFILE ? 9
      : isOcrTableProfile(profileId) ? 8
      : profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1" ? 7
      : profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1" ? 6
      : profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1" ? 5
      : profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1" ? 4
      : profileId === "typed-pz002-pz017-ocr-heat-v1" ? 3 : 2)
    || !isRecord(result.analysis)
  ) return undefined;
  if (profileId !== "typed-pz002-v1" ? !verifiedHeat : "heatLoad" in result) return undefined;
  if (["typed-pz002-pz017-ocr-heat-v1", "typed-pz002-pz017-ocr-heat-fact-family-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1",
    OCR_TABLE_PROFILE, OCR_TABLE_PROFILE_V2, OCR_TABLE_PROFILE_V3, UNRESOLVED_FAMILY_PROFILE]
    .includes(profileId)
    ? !verifiedOcrHeat : "ocrHeatRows" in result) return undefined;
  if (["typed-pz002-pz017-ocr-heat-fact-family-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1",
    OCR_TABLE_PROFILE, OCR_TABLE_PROFILE_V2, OCR_TABLE_PROFILE_V3, UNRESOLVED_FAMILY_PROFILE].includes(profileId)
    ? !verifiedFactFamily : "factFamily" in result) return undefined;
  if (["typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1",
    OCR_TABLE_PROFILE, OCR_TABLE_PROFILE_V2, OCR_TABLE_PROFILE_V3, UNRESOLVED_FAMILY_PROFILE].includes(profileId)
    ? !verifiedCandidatePreview : "candidateFamilyPreview" in result) return undefined;
  if (["typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
    "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1",
    OCR_TABLE_PROFILE, OCR_TABLE_PROFILE_V2, OCR_TABLE_PROFILE_V3, UNRESOLVED_FAMILY_PROFILE].includes(profileId)
    ? !verifiedCandidateObservations : "candidateFamilyObservations" in result) return undefined;
  if ("reviewCandidates" in result && !verifiedReviewCandidates) return undefined;
  if (["typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1",
    OCR_TABLE_PROFILE, OCR_TABLE_PROFILE_V2, OCR_TABLE_PROFILE_V3, UNRESOLVED_FAMILY_PROFILE].includes(profileId)
    ? !verifiedCandidateOcrObservations : "candidateFamilyOcrObservations" in result) return undefined;
  if (isOcrTableProfile(profileId)
    ? !verifiedOcrTableRows : "ocrTableRows" in result) return undefined;
  if (profileId === UNRESOLVED_FAMILY_PROFILE
    ? !verifiedUnresolvedFamilyReview : "unresolvedFamilyReview" in result) return undefined;
  if (profileId === UNRESOLVED_FAMILY_OCR_PROFILE
    ? !verifiedUnresolvedFamilyOcrReview : "unresolvedFamilyOcrReview" in result) return undefined;
  if (profileId === SITE_TEP_AREA_PROFILE
    ? !verifiedSiteTepAreaReview : "siteTepAreaReview" in result) return undefined;
  if (profileId === SITE_GP_CONTEXT_PROFILE
    ? !verifiedSiteGpContextReview : "siteGpContextReview" in result) return undefined;
  if (profileId === SITE_GP_TABLE_ROW_PROFILE
    ? !verifiedSiteGpTableRowReview : "siteGpTableRowReview" in result) return undefined;
  if (profileId === EQUIPMENT_SPEC_PROFILE
    ? !verifiedEquipmentSpecReview : "equipmentSpecReview" in result) return undefined;
  if (profileId === MATERIAL_CLASS_PROFILE
    ? !verifiedMaterialClassReview : "materialClassReview" in result) return undefined;
  const unresolvedDescriptor = unresolvedConfigDescriptorFor(profileId);
  if (!hasOnlySelectedUnresolvedSidecar(result, unresolvedDescriptor)
    || (unresolvedDescriptor !== null && !verifiedUnresolvedConfigReview)) return undefined;
  if (profileId === LAYER_ASSEMBLY_PROFILE
    ? !verifiedLayerAssemblyReview : "layerAssemblyReview" in result) return undefined;
  if (profileId === KR065_OPENING_PROFILE
    ? !verifiedKr065OpeningReview : "kr065OpeningReview" in result) return undefined;
  const analysis = result.analysis;
  const sourceHashes = new Map(sources.map((source) => [source.apiId, source.sha256.trim()]));
  if (
    analysis.schemaVersion !== "pz-002-analysis-v1"
    || analysis.objectId !== objectId
    || analysis.selectedManifestHash !== manifestHash
    || !Array.isArray(analysis.selectedFileIds)
    || canonicalJson([...analysis.selectedFileIds].sort()) !== canonicalJson([...sourceHashes.keys()].sort())
    || !isRecord(analysis.route)
    || !Array.isArray(analysis.extractedFacts)
    || !Array.isArray(analysis.ocrArtifacts)
    || !isRecord(analysis.evaluation)
  ) return undefined;
  const evaluation = analysis.evaluation;
  if (
    evaluation.schemaVersion !== "typed-rule-result-v1"
    || evaluation.ruleId !== "pilot-pz-002-area"
    || evaluation.ruleVersion !== "1"
    || evaluation.parameterCode !== "PZ-002"
    || evaluation.objectId !== objectId
    || evaluation.executionStatus !== "SUCCEEDED"
    || !["MISSING_EVIDENCE", "NOT_COMPARABLE", "CLARIFICATION_REQUIRED", "CANDIDATE"].includes(String(evaluation.machineStatus))
    || typeof evaluation.reasonCode !== "string"
    || !evaluation.reasonCode
    || !Array.isArray(evaluation.evidence)
    || evaluation.evidence.length > 100
  ) return undefined;
  if (evaluation.machineStatus === "CANDIDATE" && !verifiedCandidate) return undefined;
  for (const item of evaluation.evidence) {
    if (!isRecord(item) || typeof item.sourceFileId !== "string"
      || item.inputSha256 !== sourceHashes.get(item.sourceFileId)
      || !Number.isInteger(item.pageNumber) || Number(item.pageNumber) < 1) return undefined;
  }
  const canonical = canonicalJson(result);
  const byteSize = Buffer.byteLength(canonical, "utf8");
  if (byteSize < 1 || byteSize > 8 * 1024 * 1024) return undefined;
  const id = randomUUID();
  const contentHash = sha256(canonical);
  const unresolvedSidecar = unresolvedDescriptor
    ? result[unresolvedDescriptor.sidecarKey] : null;
  return {
    id, canonical, contentHash, byteSize,
    reasonCode: evaluation.reasonCode,
    storedResult: {
      schemaVersion: result.schemaVersion,
      artifactId: id,
      disposition: result.disposition,
      outputCount: result.outputCount,
      parameterCode: "PZ-002",
      machineStatus: evaluation.machineStatus,
      reasonCode: evaluation.reasonCode,
      ...(profileId !== "typed-pz002-v1" && isRecord(result.heatLoad)
        && isRecord(result.heatLoad.evaluation)
        ? { heatParameterCode: "PZ-017", heatMachineStatus: result.heatLoad.evaluation.machineStatus,
            heatReasonCode: result.heatLoad.evaluation.reasonCode }
        : {}),
      ...(["typed-pz002-pz017-ocr-heat-v1", "typed-pz002-pz017-ocr-heat-fact-family-v1",
        "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
        "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
        "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1",
        OCR_TABLE_PROFILE, OCR_TABLE_PROFILE_V2, OCR_TABLE_PROFILE_V3, UNRESOLVED_FAMILY_PROFILE]
        .includes(profileId) && isRecord(result.ocrHeatRows)
        ? { ocrHeatReviewAidProposalCount: Array.isArray(result.ocrHeatRows.proposals)
            ? result.ocrHeatRows.proposals.length : 0 }
        : {}),
      ...(["typed-pz002-pz017-ocr-heat-fact-family-v1",
        "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
        "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
        "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1",
        OCR_TABLE_PROFILE, OCR_TABLE_PROFILE_V2, OCR_TABLE_PROFILE_V3, UNRESOLVED_FAMILY_PROFILE].includes(profileId)
        && isRecord(result.factFamily)
        ? { factFamilyReviewAidFactCount: Array.isArray(result.factFamily.facts)
            ? result.factFamily.facts.length : 0 }
        : {}),
      contentHash,
      byteSize,
      ...(isOcrTableProfile(profileId) && isRecord(result.ocrTableRows)
        ? { ocrTableReviewAidProposalCount: Array.isArray(result.ocrTableRows.proposals)
            ? result.ocrTableRows.proposals.length : 0 }
        : {}),
      ...(profileId === UNRESOLVED_FAMILY_PROFILE && isRecord(result.unresolvedFamilyReview)
        ? { unresolvedFamilyReviewLeadCount: Array.isArray(result.unresolvedFamilyReview.codeRows)
            ? result.unresolvedFamilyReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.leads) ? row.leads.length : 0), 0) : 0 }
        : {}),
      ...(profileId === UNRESOLVED_FAMILY_OCR_PROFILE && isRecord(result.unresolvedFamilyOcrReview)
        ? { unresolvedFamilyOcrReviewLeadCount: Array.isArray(result.unresolvedFamilyOcrReview.codeRows)
            ? result.unresolvedFamilyOcrReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.leads) ? row.leads.length : 0), 0) : 0 }
        : {}),
      ...(profileId === SITE_TEP_AREA_PROFILE && isRecord(result.siteTepAreaReview)
        ? { siteTepAreaReviewLeadCount: Array.isArray(result.siteTepAreaReview.codeRows)
            ? result.siteTepAreaReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.leads) ? row.leads.length : 0), 0) : 0 }
        : {}),
      ...(profileId === SITE_GP_CONTEXT_PROFILE && isRecord(result.siteGpContextReview)
        ? { siteGpContextReviewLeadCount: Array.isArray(result.siteGpContextReview.codeRows)
            ? result.siteGpContextReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.leads) ? row.leads.length : 0), 0) : 0 }
        : {}),
      ...(profileId === SITE_GP_TABLE_ROW_PROFILE && isRecord(result.siteGpTableRowReview)
        ? { siteGpTableRowReviewProposalCount: Array.isArray(result.siteGpTableRowReview.codeRows)
            ? result.siteGpTableRowReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.proposals) ? row.proposals.length : 0), 0) : 0 }
        : {}),
      ...(profileId === EQUIPMENT_SPEC_PROFILE && isRecord(result.equipmentSpecReview)
        ? { equipmentSpecReviewLeadCount: Array.isArray(result.equipmentSpecReview.codeRows)
            ? result.equipmentSpecReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.leads) ? row.leads.length : 0), 0) : 0 }
        : {}),
      ...(profileId === MATERIAL_CLASS_PROFILE && isRecord(result.materialClassReview)
        ? { materialClassReviewLeadCount: Array.isArray(result.materialClassReview.codeRows)
            ? result.materialClassReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.leads) ? row.leads.length : 0), 0) : 0 }
        : {}),
      ...(unresolvedDescriptor && isRecord(unresolvedSidecar)
        ? { [`${unresolvedDescriptor.sidecarKey}LeadCount`]:
            Array.isArray(unresolvedSidecar.codeRows)
              ? unresolvedSidecar.codeRows.reduce((count: number, row: unknown) =>
                count + (isRecord(row) && Array.isArray(row.leads) ? row.leads.length : 0), 0) : 0 }
        : {}),
      ...(profileId === LAYER_ASSEMBLY_PROFILE && isRecord(result.layerAssemblyReview)
        ? { layerAssemblyReviewProposalCount: Array.isArray(result.layerAssemblyReview.codeRows)
            ? result.layerAssemblyReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.proposals) ? row.proposals.length : 0), 0) : 0 }
        : {}),
      ...(profileId === KR065_OPENING_PROFILE && isRecord(result.kr065OpeningReview)
        ? { kr065OpeningReviewProposalCount: Array.isArray(result.kr065OpeningReview.codeRows)
            ? result.kr065OpeningReview.codeRows.reduce((count: number, row: unknown) =>
              count + (isRecord(row) && Array.isArray(row.proposals) ? row.proposals.length : 0), 0) : 0 }
        : {}),
    },
  };
}

function hasPinnedFactFamilyRules(release: Record<string, unknown>, configHash: string,
  candidatePreview = false, candidateObservations = false,
  candidateOcrObservations = false, ocrTableRows: OcrTableVersion = false,
  unresolvedFamilyReview = false): boolean {
  if (!isRecord(release.rules) || !isRecord(release.rules.definitions)) return false;
  const definitions = release.rules.definitions;
  const expected = unresolvedFamilyReview
    ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableUnresolvedRulesV1
    : ocrTableRows === "v3"
    ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV3
    : ocrTableRows === "v2" ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRulesV2
    : ocrTableRows ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrTableRules
    : candidateOcrObservations
    ? pilotPz002Pz017OcrHeatFactFamilyCandidateOcrObservationsRules
    : candidateObservations ? pilotPz002Pz017OcrHeatFactFamilyCandidateObservationsRules
    : candidatePreview ? pilotPz002Pz017OcrHeatFactFamilyCandidatePreviewRules
    : pilotPz002Pz017OcrHeatFactFamilyRules;
  return canonicalJson(definitions) === canonicalJson(expected)
    && sha256(canonicalJson(definitions)) === configHash;
}

function projectOcrTableRowsRead(value: Record<string, unknown>): OcrTableRowsRead {
  const proposals = value.proposals as OcrTableRowsRead["proposals"];
  const abstentions = value.abstentions as OcrTableRowsRead["abstentions"];
  return {
    profileId: value.profileId === "conservative-ocr-table-rows-v3"
      ? "conservative-ocr-table-rows-v3"
      : value.profileId === "conservative-ocr-table-rows-v2"
        ? "conservative-ocr-table-rows-v2" : "conservative-ocr-table-rows-v1",
    inputManifestHash: String(value.inputManifestHash),
    proposals: proposals.slice(0, 64),
    abstentions: abstentions.slice(0, 64),
    findingCount: 0,
    proposalCount: proposals.length,
    abstentionCount: abstentions.length,
    truncated: proposals.length > 64 || abstentions.length > 64,
  };
}

function countOcrRequiredPages(artifacts: ValidatedTextArtifact[]): number {
  return artifacts.reduce((total, artifact) => {
    if (artifact.artifact.schemaVersion === "document-text-v2") {
      return total + (artifact.artifact.qualitySummary?.ocrRequiredPageCount ?? 0);
    }
    return total + artifact.artifact.pageCount;
  }, 0);
}

function mapObject(row: ObjectRow): InspectionObject {
  return {
    id: row.api_id,
    name: row.name,
    address: row.address,
    status: row.display_status,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    stages: parseJson(row.stages),
    fileCount: row.file_count,
    pageCount: row.page_count,
    activeCheckId: row.active_check_id,
    stats: parseJson(row.stats),
  };
}

function mapCheck(row: CheckRow): CheckRun {
  const gaps = parseJson(row.gaps);
  const decisionSet = parseJson(row.decision_set);
  return {
    id: row.api_id,
    objectId: row.object_api_id,
    status: row.inspection_lifecycle === "FINALIZED" ? "FINALIZED" : row.display_status,
    progress: row.progress,
    currentStage: row.current_stage,
    startedAt: asIso(row.started_at),
    completedAt: row.completed_at ? asIso(row.completed_at) : null,
    mode: row.mode,
    modelVersion: row.model_version,
    rulesVersion: row.rules_version,
    stats: parseJson(row.stats),
    rowVersion: Number(row.inspection_row_version),
    decisionSetHash: sha256(canonicalJson(decisionSet)),
    gapsHash: sha256(canonicalJson(gaps)),
  };
}

function mapFinding(row: FindingRow): Finding {
  const payload = parseJson(row.result_payload);
  const status = row.projection_status === "PENDING" ? row.machine_status : row.projection_status;
  return {
    ...payload,
    id: row.api_id,
    checkId: row.check_api_id,
    status,
    decision: row.decision_action && row.decision_actor_id && row.decision_created_at
      ? {
          type: row.decision_action,
          reason: row.decision_comment ?? row.decision_reason_code ?? "Решение сохранено",
          author: row.decision_actor_name ?? row.decision_actor_id,
          decidedAt: asIso(row.decision_created_at),
        }
      : null,
  };
}

function mapFinalizationDecision(row: FindingRow): FinalizationDecisionItem {
  return {
    itemId: row.api_id,
    lifecycle: row.lifecycle,
    projectionStatus: row.projection_status,
    rowVersion: Number(row.row_version),
    evidenceFingerprint: row.evidence_fingerprint,
    decision: row.decision_id && row.decision_action && row.decision_reason_code && row.decision_actor_id
      ? {
          id: row.decision_id,
          action: row.decision_action,
          reasonCode: row.decision_reason_code,
          comment: row.decision_comment,
          actorId: row.decision_actor_id,
          evidenceFingerprint: row.decision_evidence_fingerprint ?? row.evidence_fingerprint,
        }
      : null,
  };
}

function mapProtocol(row: ProtocolRow): ProtocolVersion {
  const snapshot = parseJson(row.snapshot_json);
  const revocation = mapProtocolRevocation(row);
  const canonicalArtifact = mapProtocolArtifact(row);
  return {
    id: row.api_id,
    checkId: row.check_api_id,
    version: row.version,
    status: row.kind,
    createdAt: asIso(row.created_at),
    createdBy: row.created_by,
    stats: snapshot.protocol?.stats ?? parseJson(row.run_stats),
    snapshotHash: row.snapshot_hash,
    validity: row.kind === "DRAFT" ? "DRAFT" : revocation ? "REVOKED" : "VALID",
    revocation,
    ...(canonicalArtifact ? { canonicalArtifact } : {}),
  };
}

function mapProtocolArtifact(row: ProtocolRow): ProtocolArtifactSummary | undefined {
  if (
    !row.artifact_api_id
    || row.artifact_byte_size === null
    || !row.artifact_content_hash
    || !row.artifact_created_at
  ) return undefined;
  return {
    id: row.artifact_api_id,
    protocolId: row.api_id,
    format: "JSON",
    mediaType: "application/json",
    canonicalizationVersion: "inspector-c14n-v1",
    byteSize: Number(row.artifact_byte_size),
    contentHash: row.artifact_content_hash,
    createdAt: asIso(row.artifact_created_at),
  };
}

function mapProtocolRevocation(row: ProtocolRow): ProtocolRevocationSummary | null {
  if (
    !row.revocation_api_id
    || !row.revocation_reason_code
    || !row.revocation_comment
    || !row.revoked_at
    || !row.revoked_by
    || !row.replacement_protocol_api_id
  ) return null;
  return {
    id: row.revocation_api_id,
    reasonCode: row.revocation_reason_code,
    comment: row.revocation_comment,
    revokedAt: asIso(row.revoked_at),
    revokedBy: row.revoked_by,
    replacementProtocolId: row.replacement_protocol_api_id,
  };
}

interface OcrTranscriptionDecisionRow extends QueryResultRow {
  id: string;
  object_id: string;
  run_id: string;
  origin_run_api_id: string;
  origin_manifest_hash: string;
  origin_release_id: string;
  ocr_stage_artifact_id: string;
  rule_stage_artifact_id: string;
  source_file_id: string;
  source_sha256: string;
  row_fingerprint_sha256: string;
  review_json: Record<string, unknown>;
  actor_id: string;
  content_hash: string;
}

interface OcrTranscriptionSnapshotRow extends QueryResultRow {
  run_id: string;
  object_id: string;
  source_file_id: string;
  source_sha256: string;
  row_fingerprint_sha256: string;
  decision_id: string;
  decision_content_hash: string;
  origin_run_id: string;
  ocr_stage_artifact_id: string;
  rule_stage_artifact_id: string;
  review_json: Record<string, unknown>;
}

interface OcrApplicabilityDecisionRow extends QueryResultRow {
  id: string;
  object_id: string;
  run_id: string;
  source_file_id: string;
  source_sha256: string;
  row_fingerprint_sha256: string;
  transcription_decision_id: string;
  source_review_decision_id: string;
  review_json: Record<string, unknown>;
  actor_id: string;
  content_hash: string;
}

interface OcrApplicabilitySnapshotRow extends QueryResultRow {
  run_id: string;
  object_id: string;
  source_file_id: string;
  source_sha256: string;
  row_fingerprint_sha256: string;
  parameter_code: string;
  attribute: string;
  stage: "PD" | "RD";
  entity_key: string;
  decision_id: string;
  decision_content_hash: string;
  origin_run_id: string;
  transcription_decision_id: string;
  source_review_decision_id: string;
  review_json: Record<string, unknown>;
  eligible_for_fact_review: boolean;
}

interface OcrFactPairDecisionRow extends QueryResultRow {
  id: string;
  object_id: string;
  run_id: string;
  input_manifest_hash: string;
  artifact_hash: string;
  parameter_code: string;
  attribute: string;
  entity_key: string;
  pd_fact_id: string;
  rd_fact_id: string;
  pd_locator_hash: string;
  rd_locator_hash: string;
  pd_source_file_id: string;
  rd_source_file_id: string;
  pd_source_review_decision_id: string;
  rd_source_review_decision_id: string;
  review_json: Record<string, unknown>;
  actor_id: string;
  content_hash: string;
  created_at: Date | string;
}

interface OcrFactPairSnapshotRow extends QueryResultRow {
  run_id: string;
  object_id: string;
  subject_hash: string;
  decision_id: string;
  decision_content_hash: string;
  origin_run_id: string;
  pd_source_file_id: string;
  rd_source_file_id: string;
  pd_source_sha256: string;
  rd_source_sha256: string;
  pd_row_fingerprint: string;
  rd_row_fingerprint: string;
  pd_source_review_decision_id: string;
  rd_source_review_decision_id: string;
  target_artifact_hash: string;
  origin_review_json: Record<string, unknown>;
  target_review_json: Record<string, unknown> | null;
  target_review_hash: string | null;
  eligible_for_pair_review: boolean;
  reason_code: OcrFactPairSnapshot["reasonCode"];
}

interface OcrFactPairQuantityDecisionRow extends QueryResultRow {
  id: string;
  object_id: string;
  run_id: string;
  input_manifest_hash: string;
  artifact_hash: string;
  pair_decision_id: string;
  pair_subject_hash: string;
  target_review_hash: string;
  pd_fact_id: string;
  rd_fact_id: string;
  pd_locator_hash: string;
  rd_locator_hash: string;
  evidence_hash: string;
  review_json: Record<string, unknown>;
  actor_id: string;
  content_hash: string;
  created_at: Date | string;
}

type OcrTranscriptionContext = {
  ocrArtifactId: string;
  ruleArtifactId: string;
  ocrStage: OcrHeatStageEnvelope;
  tableRows: Record<string, unknown>;
  sources: Map<string, { id: string; sha256: string }>;
};

export class PostgresInspectionRepository implements InspectionRepository {
  private constructor(
    private readonly pool: Pool,
    private readonly organizationId: string,
    private readonly parameters: ParameterCatalogItem[],
    private readonly analysisProfile: "SCAFFOLD" | "PILOT_PZ002" | "PILOT_PZ002_PZ017",
    private readonly visualProfile: "V4" | "V5" | "V6",
    private readonly storage?: ObjectStorage,
  ) {}

  static async create(options: PostgresRepositoryOptions): Promise<PostgresInspectionRepository> {
    const pool = new Pool({ connectionString: options.connectionString });
    pool.on("error", (error) => {
      if (options.onPoolError) {
        options.onPoolError(error);
        return;
      }
      console.error(JSON.stringify({
        level: "error",
        event: "postgres_pool_idle_connection_error",
        code: (error as Error & { code?: string }).code,
        message: error.message,
      }));
    });
    try {
      const organization = await pool.query<{ id: string }>(
        `INSERT INTO organizations (slug, name)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [options.organizationSlug ?? "local", options.organizationName ?? "Локальная организация"],
      );
      return new PostgresInspectionRepository(
        pool, organization.rows[0].id, options.parameters, options.analysisProfile ?? "SCAFFOLD",
        options.visualProfile ?? "V4",
        options.storage,
      );
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listObjects(actor?: AuthenticatedActor): Promise<InspectionObject[]> {
    if (!this.hasReadScope(actor)) return [];
    const result = await this.readQuery<ObjectRow>(
      `${objectSelect}
       WHERE o.organization_id = $1
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = o.id
             AND access.user_id = $2
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )
       ORDER BY o.created_at, o.id`,
      [this.organizationId, actor.userId],
    );
    return result.rows.map(mapObject);
  }

  async getObject(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<InspectionObject>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<ObjectRow>(
      `${objectSelect}
       WHERE o.organization_id = $1
         AND o.api_id = $2
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = o.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    return result.rows[0] ? mapObject(result.rows[0]) : undefined;
  }

  async createObject(input: CreateObjectInput, actor?: AuthenticatedActor): Promise<InspectionObject> {
    if (actor && actor.organizationId !== this.organizationId) {
      throw new Error("Actor organization does not match repository organization");
    }
    const apiId = `OBJ-${randomUUID().slice(0, 8).toUpperCase()}`;
    await this.transaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO objects (
           organization_id, api_id, name, address, display_status, stats
         ) VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb)
         RETURNING id`,
        [this.organizationId, apiId, input.name, input.address, JSON.stringify(blankStats())],
      );
      const objectId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO inspections (organization_id, object_id, lifecycle, mode)
         VALUES ($1, $2, 'OPEN', 'NORMAL')`,
        [this.organizationId, objectId],
      );
      await client.query(
        `INSERT INTO object_stage_summaries (object_id, stage, completeness)
         VALUES ($1, 'PD', 'MISSING'), ($1, 'RD', 'MISSING'), ($1, 'ID', 'MISSING')`,
        [objectId],
      );
      if (actor) {
        await client.query(
          `INSERT INTO object_memberships (object_id, user_id, permission_set)
           VALUES ($1, $2, ARRAY['READ', 'UPLOAD', 'RUN', 'REVIEW_DECIDE', 'FINALIZE'])
           ON CONFLICT (object_id, user_id) DO UPDATE
           SET permission_set = EXCLUDED.permission_set, revoked_at = NULL`,
          [objectId, actor.userId],
        );
      }
    });
    const object = await this.getObjectUnscoped(apiId);
    if (!object) throw new Error(`Created object ${apiId} was not found`);
    return object;
  }

  async createObjectCommand(
    input: CreateObjectInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<InspectionObject>> {
    if (command.actor.organizationId !== this.organizationId) return { kind: "forbidden" };
    const operation = "OBJECT_CREATE";
    const targetType = "ORGANIZATION";
    const targetId = this.organizationId;
    const requestHash = sha256(canonicalJson({ name: input.name, address: input.address }));

    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, targetType, targetId);
      const receipt = await this.getCommandReceipt<{ value: InspectionObject }>(
        client,
        command,
        operation,
        targetType,
        targetId,
      );
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" };
        return { kind: "success", value: receipt.response.value, replayed: true };
      }

      const apiId = `OBJ-${randomUUID().slice(0, 8).toUpperCase()}`;
      const inserted = await client.query<{
        id: string;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `INSERT INTO objects (
           organization_id, api_id, name, address, display_status, stats
         ) VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb)
         RETURNING id, created_at, updated_at`,
        [this.organizationId, apiId, input.name, input.address, JSON.stringify(blankStats())],
      );
      const objectId = inserted.rows[0].id;
      const inspection = await client.query<{ id: string }>(
        `INSERT INTO inspections (organization_id, object_id, lifecycle, mode)
         VALUES ($1, $2, 'OPEN', 'NORMAL')
         RETURNING id`,
        [this.organizationId, objectId],
      );
      await client.query(
        `INSERT INTO object_stage_summaries (object_id, stage, completeness)
         VALUES ($1, 'PD', 'MISSING'), ($1, 'RD', 'MISSING'), ($1, 'ID', 'MISSING')`,
        [objectId],
      );
      const permissions = ["READ", "UPLOAD", "RUN", "REVIEW_DECIDE", "FINALIZE"];
      await client.query(
        `INSERT INTO object_memberships (object_id, user_id, permission_set)
         VALUES ($1, $2, $3::text[])
         ON CONFLICT (object_id, user_id) DO UPDATE
         SET permission_set = EXCLUDED.permission_set, revoked_at = NULL`,
        [objectId, command.actor.userId, permissions],
      );
      const value: InspectionObject = {
        id: apiId,
        name: input.name,
        address: input.address,
        status: "DRAFT",
        createdAt: asIso(inserted.rows[0].created_at),
        updatedAt: asIso(inserted.rows[0].updated_at),
        stages: [
          { stage: "PD", fileCount: 0, pageCount: 0, status: "MISSING" },
          { stage: "RD", fileCount: 0, pageCount: 0, status: "MISSING" },
          { stage: "ID", fileCount: 0, pageCount: 0, status: "MISSING" },
        ],
        fileCount: 0,
        pageCount: 0,
        activeCheckId: null,
        stats: blankStats(),
      };
      await this.insertCommandReceipt(
        client,
        command,
        operation,
        targetType,
        targetId,
        requestHash,
        201,
        { value },
      );
      await this.appendAuditEvent(client, {
        command,
        objectId,
        inspectionId: inspection.rows[0].id,
        action: operation,
        targetType: "OBJECT",
        targetId: apiId,
        beforeRef: null,
        afterRef: { apiId, status: "DRAFT", creatorPermissions: permissions },
      });
      return { kind: "success", value, replayed: false };
    });
  }

  async recordSourceReviewCommand(
    objectApiId: string,
    sourceFileApiId: string,
    input: SourceReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<SourceReviewDecision>> {
    if (command.actor.organizationId !== this.organizationId) return { kind: "forbidden" };
    const operation = "SOURCE_REVIEW";
    const { sectionCode: requestedSectionCode, ...legacyInput } = input;
    const hashInput = requestedSectionCode
      ? { ...legacyInput, sectionCode: requestedSectionCode } : legacyInput;
    const requestHash = sha256(canonicalJson({ objectApiId, sourceFileApiId, input: hashInput }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, "SOURCE_FILE", sourceFileApiId);
      const receipt = await this.getCommandReceipt<{ value: SourceReviewDecision }>(
        client, command, operation, "SOURCE_FILE", sourceFileApiId,
      );
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", value: {
          ...receipt.response.value,
          sectionCode: receipt.response.value.sectionCode ?? null,
        }, replayed: true } as const;
      }
      const source = await client.query<{
        id: string; object_id: string; inspection_id: string; sha256: string; stages: string[];
      }>(
        `SELECT source.id, object.id AS object_id, inspection.id AS inspection_id,
                blob.sha256, array_agg(stage.stage ORDER BY stage.stage) AS stages
         FROM source_files source
         JOIN objects object ON object.id = source.object_id
         JOIN inspections inspection ON inspection.object_id = object.id AND inspection.lifecycle = 'OPEN'
         JOIN blobs blob ON blob.id = source.blob_id
         JOIN source_file_stages stage ON stage.source_file_id = source.id
         WHERE object.organization_id = $1 AND object.api_id = $2 AND source.api_id = $3
           AND EXISTS (
             SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $4
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['REVIEW_DECIDE']::text[]
           )
         GROUP BY source.id, object.id, inspection.id, blob.sha256`,
        [this.organizationId, objectApiId, sourceFileApiId, command.actor.userId],
      );
      const selected = source.rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.sha256.trim() !== input.sourceSha256) {
        return { kind: "invalid_state", code: "SOURCE_HASH_MISMATCH",
          message: "Исходный файл изменён или выбран неверный SHA-256" } as const;
      }
      if ((selected.stages.length === 1 && Object.keys(input.pageStages).length > 0)
        || Object.values(input.pageStages).some((stage) => stage !== "UNRESOLVED" && !selected.stages.includes(stage))) {
        return { kind: "invalid_state", code: "SOURCE_STAGE_MISMATCH",
          message: "Стадия страницы не указана для исходного файла" } as const;
      }
      const contentHash = sha256(canonicalJson({
        objectApiId, sourceFileApiId, ...hashInput, actorId: command.actor.userId,
      }));
      const inserted = await client.query<{ id: string; created_at: Date | string }>(
        `INSERT INTO source_review_decisions (
           object_id, source_file_id, source_sha256, revision_status, approval_status,
           link_group_id, section_code, page_stages, basis_reference, actor_id, content_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
         RETURNING id, created_at`,
        [
          selected.object_id, selected.id, input.sourceSha256,
          input.revisionStatus, input.approvalStatus, input.linkGroupId,
          input.sectionCode ?? null, canonicalJson(input.pageStages), input.basis.reference,
          command.actor.userId, contentHash,
        ],
      );
      const value: SourceReviewDecision = {
        id: inserted.rows[0].id, objectId: objectApiId,
        sourceFileId: sourceFileApiId, actorId: command.actor.userId,
        contentHash, createdAt: asIso(inserted.rows[0].created_at), ...input,
        sectionCode: input.sectionCode ?? null,
      };
      await this.insertCommandReceipt(
        client, command, operation, "SOURCE_FILE", sourceFileApiId,
        requestHash, 201, { value },
      );
      await this.appendAuditEvent(client, {
        command, objectId: selected.object_id, inspectionId: selected.inspection_id,
        action: operation, targetType: "SOURCE_FILE", targetId: sourceFileApiId,
        beforeRef: null, afterRef: { decisionId: value.id, contentHash },
      });
      return { kind: "success", value, replayed: false } as const;
    });
  }

  async getSourceReview(
    objectApiId: string,
    sourceFileApiId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<SourceReviewDecision>> {
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<{
      id: string; object_api_id: string; source_api_id: string; source_sha256: string;
      revision_status: SourceReviewInput["revisionStatus"];
      approval_status: SourceReviewInput["approvalStatus"];
      link_group_id: string | null; section_code: SourceReviewDecision["sectionCode"];
      page_stages: Record<string, "PD" | "RD" | "ID">;
      basis_reference: string; actor_id: string; content_hash: string; created_at: Date | string;
    }>(
      `SELECT review.id, object.api_id AS object_api_id, source.api_id AS source_api_id,
              review.source_sha256, review.revision_status, review.approval_status,
              review.link_group_id, review.section_code, review.page_stages, review.basis_reference,
              review.actor_id, review.content_hash, review.created_at
       FROM source_review_decisions review
       JOIN source_files source ON source.id = review.source_file_id
       JOIN objects object ON object.id = review.object_id
       WHERE object.organization_id = $1 AND object.api_id = $2 AND source.api_id = $3
         AND EXISTS (
           SELECT 1 FROM object_memberships access
           WHERE access.object_id = object.id AND access.user_id = $4
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )
       ORDER BY review.created_at DESC, review.id DESC LIMIT 1`,
      [this.organizationId, objectApiId, sourceFileApiId, actor.userId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id, objectId: row.object_api_id, sourceFileId: row.source_api_id,
      sourceSha256: row.source_sha256.trim(), revisionStatus: row.revision_status,
      approvalStatus: row.approval_status, linkGroupId: row.link_group_id,
      sectionCode: row.section_code,
      pageStages: row.page_stages, basis: { reference: row.basis_reference },
      actorId: row.actor_id, contentHash: row.content_hash.trim(), createdAt: asIso(row.created_at),
    };
  }

  async listSourceFiles(
    objectApiId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<SourceFileSummary[]>> {
    if (!this.hasReadScope(actor)) return undefined;
    const object = await this.getObject(objectApiId, actor);
    if (!object || object === "AUTH_REQUIRED") return object;
    const result = await this.readQuery<{
      id: string; name: string; sha256: string; byte_size: string;
      stages: Array<"PD" | "RD" | "ID">; page_count: number | null;
      registered_at: Date | string;
      revision_status: "CURRENT" | "SUPERSEDED" | "UNKNOWN" | null;
      approval_status: "APPROVED" | "UNAPPROVED" | "UNKNOWN" | null;
      link_group_id: string | null; section_code: SourceReviewDecision["sectionCode"];
      page_stage_count: number | null;
      review_hash: string | null; review_sha256: string | null;
      review_created_at: Date | string | null;
    }>(
      `SELECT source.api_id AS id, source.canonical_name AS name,
              blob.sha256, blob.byte_size, stages.stages, text.page_count,
              source.registered_at,
              review.revision_status, review.approval_status,
              review.link_group_id, review.section_code, review.page_stage_count,
              review.content_hash AS review_hash,
              review.source_sha256 AS review_sha256,
              review.created_at AS review_created_at
       FROM source_files source
       JOIN objects object ON object.id = source.object_id
       JOIN blobs blob ON blob.id = source.blob_id
       JOIN LATERAL (
         SELECT array_agg(stage.stage ORDER BY CASE stage.stage
           WHEN 'PD' THEN 1 WHEN 'RD' THEN 2 WHEN 'ID' THEN 3 END) AS stages
         FROM source_file_stages stage WHERE stage.source_file_id = source.id
       ) stages ON true
       LEFT JOIN LATERAL (
         SELECT artifact.page_count FROM analysis_text_artifacts artifact
         WHERE artifact.source_file_id = source.id AND artifact.input_sha256 = blob.sha256
         ORDER BY artifact.created_at DESC, artifact.id DESC LIMIT 1
       ) text ON true
       LEFT JOIN LATERAL (
         SELECT decision.revision_status, decision.approval_status,
                decision.link_group_id, decision.section_code, decision.content_hash,
                decision.source_sha256, decision.created_at,
                (SELECT count(*)::integer FROM jsonb_object_keys(decision.page_stages)) AS page_stage_count
         FROM source_review_decisions decision
         WHERE decision.source_file_id = source.id
         ORDER BY decision.created_at DESC, decision.id DESC LIMIT 1
       ) review ON true
       WHERE object.organization_id = $1 AND object.api_id = $2
         AND EXISTS (
           SELECT 1 FROM object_memberships access
           WHERE access.object_id = object.id AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )
       ORDER BY source.registered_at, source.id`,
      [this.organizationId, objectApiId, actor.userId],
    );
    return result.rows.map((row) => ({
      id: row.id, name: row.name, sha256: row.sha256.trim(),
      size: Number(row.byte_size), stages: row.stages,
      pageCount: row.page_count, registeredAt: asIso(row.registered_at),
      review: row.review_hash && row.review_sha256?.trim() === row.sha256.trim()
        && row.revision_status && row.approval_status && row.review_created_at
        ? {
            revisionStatus: row.revision_status,
            approvalStatus: row.approval_status,
            linkGroupId: row.link_group_id,
            sectionCode: row.section_code,
            pageStageCount: row.page_stage_count ?? 0,
            contentHash: row.review_hash.trim(),
            createdAt: asIso(row.review_created_at),
          }
        : null,
    }));
  }

  async getSourceFileContent(
    objectApiId: string,
    sourceFileApiId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ name: string; storageKey: string; byteSize: number; sha256: string; mediaType: string }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<{
      name: string; storage_key: string; byte_size: string; sha256: string; media_type: string;
    }>(
      `SELECT source.canonical_name AS name, blob.storage_key,
              blob.byte_size, blob.sha256, blob.media_type
       FROM source_files source
       JOIN objects object ON object.id = source.object_id
       JOIN blobs blob ON blob.id = source.blob_id
       WHERE object.organization_id = $1 AND object.api_id = $2 AND source.api_id = $3
         AND blob.scan_status = 'CLEAN'
         AND EXISTS (
           SELECT 1 FROM object_memberships access
           WHERE access.object_id = object.id AND access.user_id = $4
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, objectApiId, sourceFileApiId, actor.userId],
    );
    const row = result.rows[0];
    return row ? {
      name: row.name, storageKey: row.storage_key, byteSize: Number(row.byte_size),
      sha256: row.sha256.trim(), mediaType: row.media_type,
    } : undefined;
  }

  async hasIngestedFile(
    objectId: string,
    digest: string,
    actor?: AuthenticatedActor,
  ): Promise<boolean> {
    if (actor && actor.organizationId !== this.organizationId) return false;
    const accessClause = actor
      ? `AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $4
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['UPLOAD']::text[]
         )`
      : "";
    const result = await this.readQuery(
      `SELECT 1
       FROM blobs blob
       JOIN objects object ON object.id = blob.object_id
       WHERE object.organization_id = $1 AND object.api_id = $2 AND blob.sha256 = $3
         ${accessClause}
       LIMIT 1`,
      actor
        ? [this.organizationId, objectId, digest, actor.userId]
        : [this.organizationId, objectId, digest],
    );
    return result.rowCount === 1;
  }

  async registerIngestedFiles(
    objectApiId: string,
    files: RegisteredIngestedDocumentFile[],
    actor?: AuthenticatedActor,
  ): Promise<BinaryUploadRecord | undefined> {
    const result = await this.executeRegisterIngestedFiles(objectApiId, files, actor);
    return result.kind === "success" ? result.value : undefined;
  }

  async registerIngestedFilesCommand(
    objectApiId: string,
    files: RegisteredIngestedDocumentFile[],
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<BinaryUploadRecord>> {
    return this.executeRegisterIngestedFiles(objectApiId, files, command.actor, command);
  }

  private async executeRegisterIngestedFiles(
    objectApiId: string,
    files: RegisteredIngestedDocumentFile[],
    actor?: AuthenticatedActor,
    command?: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<BinaryUploadRecord>> {
    if (actor && actor.organizationId !== this.organizationId) return { kind: "not_found" };
    const requestHash = command ? sha256(canonicalJson({
      objectId: objectApiId,
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        stage: file.stage,
        mimeType: file.mimeType,
        sha256: file.sha256,
      })),
    })) : undefined;
    return this.transaction(async (client) => {
      const accessClause = actor
        ? `AND EXISTS (
             SELECT 1
             FROM object_memberships access
             WHERE access.object_id = objects.id
               AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['UPLOAD']::text[]
           )`
        : "";
      const object = await client.query<{ id: string; inspection_id: string }>(
        `SELECT objects.id, inspection.id AS inspection_id
         FROM objects
         JOIN inspections inspection ON inspection.object_id = objects.id
         WHERE objects.organization_id = $1 AND objects.api_id = $2 AND inspection.lifecycle = 'OPEN'
           ${accessClause}
         FOR UPDATE OF objects, inspection`,
        actor
          ? [this.organizationId, objectApiId, actor.userId]
          : [this.organizationId, objectApiId],
      );
      if (!object.rows[0]) return { kind: "not_found" } as const;
      if (command && requestHash) {
        await this.lockCommandReceipt(client, command, "DOCUMENT_UPLOAD", "OBJECT", objectApiId);
        const receipt = await this.getCommandReceipt<{ value: BinaryUploadRecord }>(
          client,
          command,
          "DOCUMENT_UPLOAD",
          "OBJECT",
          objectApiId,
        );
        if (receipt) {
          if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
          return { kind: "success", value: receipt.response.value, replayed: true } as const;
        }
      }
      const objectId = object.rows[0].id;
      const uploadApiId = `UPL-${randomUUID().slice(0, 8).toUpperCase()}`;
      const upload = await client.query<UploadRow>(
        `INSERT INTO upload_receipts (api_id, object_id, state)
         VALUES ($1, $2, 'COMMITTED')
         RETURNING id, api_id, $3::text AS object_api_id, created_at`,
        [uploadApiId, objectId, objectApiId],
      );
      const storedFiles: BinaryUploadRecord["files"] = [];
      let newStageAssociations = 0;

      for (const [ordinal, file] of files.entries()) {
        const insertedBlob = await client.query<{ id: string }>(
          `INSERT INTO blobs (
             object_id, sha256, byte_size, storage_key, media_type, scan_status
           ) VALUES ($1, $2, $3, $4, $5, 'CLEAN')
           ON CONFLICT (object_id, sha256) DO NOTHING
           RETURNING id`,
          [
            objectId,
            file.sha256,
            file.size,
            file.storageKey ?? `objects/${objectApiId}/originals/${file.sha256}/${file.name}`,
            file.mimeType,
          ],
        );
        const wasDuplicate = !insertedBlob.rows[0];
        let sourceFileId: string;
        if (wasDuplicate) {
          const existing = await client.query<{ source_file_id: string }>(
            `SELECT source.id AS source_file_id
             FROM blobs blob
             JOIN source_files source ON source.blob_id = blob.id AND source.object_id = blob.object_id
             WHERE blob.object_id = $1 AND blob.sha256 = $2`,
            [objectId, file.sha256],
          );
          if (!existing.rows[0]) throw new Error(`Source file is missing for blob ${file.sha256}`);
          sourceFileId = existing.rows[0].source_file_id;
        } else {
          const source = await client.query<{ id: string }>(
            `INSERT INTO source_files (
               api_id, object_id, blob_id, canonical_name, original_format
             ) VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [file.id, objectId, insertedBlob.rows[0].id, file.name, file.mimeType],
          );
          sourceFileId = source.rows[0].id;
        }

        const stage = await client.query(
          `INSERT INTO source_file_stages (source_file_id, stage)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [sourceFileId, file.stage],
        );
        if (stage.rowCount === 1) {
          newStageAssociations += 1;
          await client.query(
            `UPDATE object_stage_summaries
             SET file_count = file_count + 1, completeness = 'COMPLETE'
             WHERE object_id = $1 AND stage = $2`,
            [objectId, file.stage],
          );
        }

        const ingestStatus = wasDuplicate ? "DUPLICATE" : "STORED";
        await client.query(
          `INSERT INTO upload_receipt_files (
             receipt_id, object_id, source_file_id, ordinal, api_file_id,
             client_name, supplied_stage, ingest_status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [upload.rows[0].id, objectId, sourceFileId, ordinal, file.id, file.name, file.stage, ingestStatus],
        );
        storedFiles.push({
          id: file.id,
          name: file.name,
          size: file.size,
          stage: file.stage,
          mimeType: file.mimeType,
          sha256: file.sha256,
          scanStatus: "CLEAN",
          status: ingestStatus,
        });
      }

      await client.query(
        `UPDATE objects
         SET display_status = 'VALIDATING',
             file_count = file_count + $1,
             updated_at = now()
         WHERE id = $2`,
        [newStageAssociations, objectId],
      );
      const value: BinaryUploadRecord = {
        id: uploadApiId,
        objectId: objectApiId,
        status: "ACCEPTED",
        files: storedFiles,
        createdAt: asIso(upload.rows[0].created_at),
      };
      if (command && requestHash) {
        await this.insertCommandReceipt(
          client,
          command,
          "DOCUMENT_UPLOAD",
          "OBJECT",
          objectApiId,
          requestHash,
          201,
          { value },
        );
        await this.appendAuditEvent(client, {
          command,
          objectId,
          inspectionId: object.rows[0].inspection_id,
          action: "DOCUMENT_UPLOAD",
          targetType: "UPLOAD",
          targetId: uploadApiId,
          beforeRef: null,
          afterRef: {
            uploadId: uploadApiId,
            fileCount: storedFiles.length,
            newStageAssociations,
            files: storedFiles.map((file) => ({
              sha256: file.sha256,
              stage: file.stage,
              status: file.status,
            })),
          },
        });
      }
      return { kind: "success", value, replayed: false } as const;
    });
  }

  async getUpload(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<BinaryUploadRecord>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const upload = await this.readQuery<UploadRow>(
      `SELECT receipt.id, receipt.api_id, object.api_id AS object_api_id, receipt.created_at
       FROM upload_receipts receipt
       JOIN objects object ON object.id = receipt.object_id
       WHERE object.organization_id = $1
         AND receipt.api_id = $2
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    if (!upload.rows[0]) return undefined;
    const files = await this.readQuery<UploadFileRow>(
      `SELECT
         item.api_file_id,
         item.client_name,
         item.supplied_stage,
         item.ingest_status,
         blob.byte_size,
         blob.media_type,
         blob.sha256
       FROM upload_receipt_files item
       JOIN source_files source ON source.id = item.source_file_id
       JOIN blobs blob ON blob.id = source.blob_id
       WHERE item.receipt_id = $1
       ORDER BY item.ordinal`,
      [upload.rows[0].id],
    );
    return {
      id: upload.rows[0].api_id,
      objectId: upload.rows[0].object_api_id,
      status: "ACCEPTED",
      createdAt: asIso(upload.rows[0].created_at),
      files: files.rows.map((file) => ({
        id: file.api_file_id,
        name: file.client_name,
        size: Number(file.byte_size),
        stage: file.supplied_stage,
        mimeType: file.media_type,
        sha256: file.sha256,
        scanStatus: "CLEAN",
        status: file.ingest_status,
      })),
    };
  }

  async startCheck(objectApiId: string, actor?: AuthenticatedActor): Promise<CheckRun | undefined> {
    const result = await this.executeStartCheck(objectApiId, actor);
    if (result.kind !== "success") return undefined;
    return this.getCheckUnscoped(result.value.checkId);
  }

  async startCheckCommand(
    objectApiId: string,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<CheckRun>> {
    const result = await this.executeStartCheck(objectApiId, command.actor, {
      command,
      operation: "RUN_START",
      receiptTargetType: "OBJECT",
      receiptTargetId: objectApiId,
      responseStatus: 201,
    });
    if (result.kind !== "success") return result;
    const value = await this.getCheckUnscoped(result.value.checkId);
    if (!value) throw new Error(`Started check ${result.value.checkId} was not found`);
    return { kind: "success", value, replayed: result.replayed };
  }

  private async executeStartCheck(
    objectApiId: string,
    actor?: AuthenticatedActor,
    audited?: {
      command: AuditedMutationCommand;
      operation: "RUN_START" | "RUN_REPROCESS";
      receiptTargetType: "OBJECT" | "ANALYSIS_RUN";
      receiptTargetId: string;
      responseStatus: 200 | 201;
    },
  ): Promise<AuditedMutationCommandResult<{ checkId: string }>> {
    if (actor && actor.organizationId !== this.organizationId) return { kind: "not_found" };
    const requestHash = audited
      ? sha256(canonicalJson({
          operation: audited.operation,
          targetId: audited.receiptTargetId,
          objectId: objectApiId,
        }))
      : undefined;
    const checkApiId = `CHK-${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await this.transaction(async (client) => {
      const accessClause = actor
        ? `AND EXISTS (
             SELECT 1
             FROM object_memberships access
             WHERE access.object_id = object.id
               AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['RUN']::text[]
           )`
        : "";
      const aggregate = await client.query<{
        object_id: string;
        inspection_id: string;
        file_count: number;
      }>(
        `SELECT
           object.id AS object_id,
           inspection.id AS inspection_id,
           object.file_count
         FROM objects object
         JOIN inspections inspection ON inspection.object_id = object.id
         WHERE object.organization_id = $1 AND object.api_id = $2 AND inspection.lifecycle = 'OPEN'
           ${accessClause}
         FOR UPDATE OF object, inspection`,
        actor
          ? [this.organizationId, objectApiId, actor.userId]
          : [this.organizationId, objectApiId],
      );
      if (!aggregate.rows[0]) return { kind: "not_found" } as const;
      if (aggregate.rows[0].file_count === 0) {
        return {
          kind: "invalid_state",
          code: "DOCUMENTS_REQUIRED",
          message: "Перед запуском проверки загрузите хотя бы один документ",
        } as const;
      }
      if (audited && requestHash) {
        await this.lockCommandReceipt(
          client,
          audited.command,
          audited.operation,
          audited.receiptTargetType,
          audited.receiptTargetId,
        );
        const receipt = await this.getCommandReceipt<{ checkId: string }>(
          client,
          audited.command,
          audited.operation,
          audited.receiptTargetType,
          audited.receiptTargetId,
        );
        if (receipt) {
          if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
          return { kind: "success", value: receipt.response, replayed: true } as const;
        }
      }
      const activeRun = await client.query<{
        active_run_id: string | null;
        active_run_api_id: string | null;
        active_run_state: string | null;
      }>(
        `SELECT
           inspection.active_run_id,
           run.api_id AS active_run_api_id,
           run.run_state AS active_run_state
         FROM inspections inspection
         LEFT JOIN analysis_runs run ON run.id = inspection.active_run_id
         WHERE inspection.id = $1`,
        [aggregate.rows[0].inspection_id],
      );
      if (
        (activeRun.rows[0].active_run_state === "QUEUED" || activeRun.rows[0].active_run_state === "RUNNING")
        && activeRun.rows[0].active_run_api_id
      ) {
        const activeCheckId = activeRun.rows[0].active_run_api_id;
        if (audited && requestHash) {
          await this.insertCommandReceipt(
            client,
            audited.command,
            audited.operation,
            audited.receiptTargetType,
            audited.receiptTargetId,
            requestHash,
            audited.responseStatus,
            { checkId: activeCheckId },
          );
          await this.appendAuditEvent(client, {
            command: audited.command,
            objectId: aggregate.rows[0].object_id,
            inspectionId: aggregate.rows[0].inspection_id,
            action: audited.operation,
            targetType: "ANALYSIS_RUN",
            targetId: activeCheckId,
            beforeRef: { activeRunId: activeCheckId, state: activeRun.rows[0].active_run_state },
            afterRef: { checkId: activeCheckId, reusedActiveRun: true },
          });
        }
        return { kind: "success", value: { checkId: activeCheckId }, replayed: false } as const;
      }
      const { object_id: objectId, inspection_id: inspectionId } = aggregate.rows[0];
      const parentRunId = activeRun.rows[0].active_run_id;
      const sources = await client.query<{
        id: string;
        api_id: string;
        sha256: string;
        stages: string[];
      }>(
        `SELECT
           source.id,
           source.api_id,
           blob.sha256,
           array_agg(stage.stage ORDER BY stage.stage) AS stages
         FROM source_files source
         JOIN blobs blob ON blob.id = source.blob_id
         JOIN source_file_stages stage ON stage.source_file_id = source.id
         WHERE source.object_id = $1
         GROUP BY source.id, source.api_id, blob.sha256
         ORDER BY source.api_id`,
        [objectId],
      );
      const reviewedSources = await client.query<{
        id: string; source_file_id: string; content_hash: string;
        source_sha256: string; revision_status: string; approval_status: string;
        link_group_id: string | null; section_code: string | null;
      }>(
        `SELECT DISTINCT ON (review.source_file_id)
                review.id, review.source_file_id, review.content_hash,
                review.source_sha256, review.revision_status, review.approval_status,
                review.link_group_id, review.section_code
         FROM source_review_decisions review
         WHERE review.source_file_id = ANY($1::uuid[])
         ORDER BY review.source_file_id, review.created_at DESC, review.id DESC`,
        [sources.rows.map((source) => source.id)],
      );
      const reviewBySource = new Map(reviewedSources.rows.map((row) => [row.source_file_id, row]));
      const sequence = await client.query<{ next_sequence: number }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
         FROM input_manifests
         WHERE inspection_id = $1`,
        [inspectionId],
      );
      const manifestPayload = {
        inspectionId,
        sources: sources.rows.map((source) => ({
          sourceFileId: source.api_id,
          sha256: source.sha256,
          stages: source.stages,
          sourceReviewHash: reviewBySource.get(source.id)?.content_hash.trim() ?? null,
        })),
      };
      const canonical = canonicalJson(manifestPayload);
      const parentManifest = await client.query<{ working_manifest_id: string | null }>(
        `SELECT working_manifest_id FROM inspections WHERE id = $1`,
        [inspectionId],
      );
      const manifestHash = sha256(canonical);
      const insertedManifest = await client.query<{ id: string }>(
        `INSERT INTO input_manifests (
           inspection_id, sequence, canonical_json, sha256, parent_id
         ) VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (inspection_id, sha256) DO NOTHING
         RETURNING id`,
        [
          inspectionId,
          sequence.rows[0].next_sequence,
          canonical,
          manifestHash,
          parentManifest.rows[0].working_manifest_id,
        ],
      );
      const manifestId = insertedManifest.rows[0]?.id ?? (await client.query<{ id: string }>(
        `SELECT id FROM input_manifests WHERE inspection_id = $1 AND sha256 = $2`,
        [inspectionId, manifestHash],
      )).rows[0].id;
      if (insertedManifest.rows[0]) {
        for (const source of sources.rows) {
          await client.query(
            `INSERT INTO manifest_items (manifest_id, source_file_id, blob_sha256, inclusion_role)
             VALUES ($1, $2, $3, 'SOURCE')`,
            [manifestId, source.id, source.sha256],
          );
        }
      }
      const release = await this.ensureAnalysisRelease(client);
      const releaseId = release.manifest.releaseId;
      const run = await client.query<{ id: string }>(
        `INSERT INTO analysis_runs (
           api_id, inspection_id, object_id, manifest_id, release_id,
           run_state, display_status, mode, progress, current_stage,
           model_version, rules_version, stats, supersedes_run_id, event_version
         ) VALUES (
           $1, $2, $3, $4, $5,
           'QUEUED', 'PROCESSING', 'NORMAL', 0, 'Ожидание worker',
           NULL, 'matrix-132-v1', $6::jsonb, $7, 1
         ) RETURNING id`,
        [
          checkApiId,
          inspectionId,
          objectId,
          manifestId,
          releaseId,
          JSON.stringify(blankStats(this.parameters.length)),
          parentRunId,
        ],
      );
      for (const source of sources.rows) {
        const review = reviewBySource.get(source.id);
        if (review) {
          await client.query(
            `INSERT INTO run_source_review_snapshots (run_id, source_file_id, decision_id, decision_hash)
             VALUES ($1, $2, $3, $4)`,
            [run.rows[0].id, source.id, review.id, review.content_hash.trim()],
          );
        }
      }
      await this.snapshotOcrTranscriptionDecisions(
        client, run.rows[0].id, objectId, objectApiId, sources.rows);
      await this.snapshotOcrRowApplicabilityDecisions(client, {
        runId: run.rows[0].id, checkId: checkApiId,
        objectId, objectApiId, manifestHash,
        manifestJson: manifestPayload,
        sources: sources.rows,
      });
      if (release.manifest.reviewArtifacts?.ocrTypedFactCandidates
        === "ocr-typed-fact-candidates-v1") {
        await this.persistOcrTypedFactCandidateArtifact(client, {
          run_id: run.rows[0].id, object_id: objectId, object_api_id: objectApiId,
          manifest_hash: manifestHash, manifest_json: manifestPayload,
          check_id: checkApiId, release_id: releaseId,
        });
        await this.snapshotOcrFactPairDecisions(client, {
          run_id: run.rows[0].id, object_id: objectId, object_api_id: objectApiId,
          manifest_hash: manifestHash, manifest_json: manifestPayload,
          check_id: checkApiId,
        }, sources.rows.map((source) => source.id));
      }
      const latestLinks = await client.query<{
        id: string; content_hash: string; parameter_code: string; attribute: string;
        actual_stage: string; pd_source_file_id: string; actual_source_file_id: string;
        pd_source_review_id: string; actual_source_review_id: string;
        link_json: Record<string, unknown>; actor_id: string;
      }>(
        `SELECT DISTINCT ON (parameter_code, attribute, actual_stage)
                id, content_hash, parameter_code, attribute, actual_stage,
                pd_source_file_id, actual_source_file_id,
                pd_source_review_id, actual_source_review_id, link_json, actor_id
         FROM fact_entity_link_decisions
         WHERE object_id = $1
         ORDER BY parameter_code, attribute, actual_stage, created_at DESC, id DESC`,
        [objectId],
      );
      const sourceById = new Map(sources.rows.map((source) => [source.id, source]));
      for (const decision of latestLinks.rows) {
        const pdSource = sourceById.get(decision.pd_source_file_id);
        const actualSource = sourceById.get(decision.actual_source_file_id);
        const pdReview = reviewBySource.get(decision.pd_source_file_id);
        const actualReview = reviewBySource.get(decision.actual_source_file_id);
        if (!pdSource || !actualSource || !pdReview || !actualReview
          || pdReview.id !== decision.pd_source_review_id
          || actualReview.id !== decision.actual_source_review_id
          || pdReview.source_sha256.trim() !== pdSource.sha256.trim()
          || actualReview.source_sha256.trim() !== actualSource.sha256.trim()
          || pdReview.revision_status !== "CURRENT" || actualReview.revision_status !== "CURRENT"
          || pdReview.approval_status !== "APPROVED" || actualReview.approval_status !== "APPROVED"
          || !pdReview.link_group_id || pdReview.link_group_id !== actualReview.link_group_id) continue;
        const rule = pilotPz002Pz017OcrHeatFactFamilyRules.factFamily.rules.find((candidate) =>
          candidate.parameterCode === decision.parameter_code
          && candidate.attribute === decision.attribute
          && candidate.actualStage === decision.actual_stage);
        if (!rule || !(rule.requiredActualSection as readonly string[])
          .includes(actualReview.section_code ?? "")) continue;
        const link = parseJson<Record<string, unknown>>(decision.link_json);
        const evidence = link.evidence;
        if (!Array.isArray(evidence) || !isRecord(evidence[0]) || !isRecord(evidence[1])
          || link.objectId !== objectId || link.linkGroupId !== pdReview.link_group_id
          || evidence[0].sourceFileId !== pdSource.api_id
          || evidence[1].sourceFileId !== actualSource.api_id
          || evidence[0].sourceSha256 !== pdSource.sha256.trim()
          || evidence[1].sourceSha256 !== actualSource.sha256.trim()
          || sha256(canonicalJson({ actorId: decision.actor_id, link }))
            !== decision.content_hash.trim()) {
          throw new Error("Fact entity link decision integrity check failed");
        }
        await client.query(
          `INSERT INTO run_fact_entity_link_snapshots (run_id, decision_id, decision_hash)
           VALUES ($1, $2, $3)`,
          [run.rows[0].id, decision.id, decision.content_hash.trim()],
        );
      }
      await client.query(
        `UPDATE inspections
         SET active_run_id = $1, working_manifest_id = $2, row_version = row_version + 1, updated_at = now()
         WHERE id = $3`,
        [run.rows[0].id, manifestId, inspectionId],
      );
      await client.query(
        `UPDATE objects
         SET display_status = 'PROCESSING', updated_at = now()
         WHERE id = $1`,
        [objectId],
      );
      const jobDefinitions: Array<{ jobType: AnalysisJobType; queueName: string }> = [
        { jobType: "ANALYSIS_INVENTORY", queueName: "rules.evaluate" },
        { jobType: "DOCUMENT_TEXT_LAYER", queueName: "documents.render" },
        { jobType: "DOCUMENT_RENDER", queueName: "documents.render" },
        { jobType: "DOCUMENT_METADATA", queueName: "documents.link" },
        { jobType: "DOCUMENT_LINKING", queueName: "documents.link" },
        { jobType: "ENTITY_EXTRACTION", queueName: "documents.extract" },
        { jobType: "RULE_EVALUATION",
          queueName: resolveAnalysisJobQueue("RULE_EVALUATION", release.manifest) },
        { jobType: "EVIDENCE_VALIDATION", queueName: "rules.evaluate" },
        { jobType: "ANALYSIS_SEAL_UNSUPPORTED", queueName: "rules.evaluate" },
      ];
      const jobs = jobDefinitions.map((definition, index) => ({
        ...definition,
        id: randomUUID(),
        state: index === 0 ? "READY" : "BLOCKED",
        semanticKey: sha256(canonicalJson({
          objectId,
          runId: run.rows[0].id,
          stage: definition.jobType,
          inputManifestHash: manifestHash,
          releaseId,
        })),
      }));
      for (const job of jobs) {
        await client.query(
          `INSERT INTO analysis_jobs (
             id, organization_id, object_id, inspection_id, run_id,
             queue_name, job_type, scope_type, state, semantic_key,
             input_manifest_hash, release_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ANALYSIS', $8, $9, $10, $11)`,
          [
            job.id,
            this.organizationId,
            objectId,
            inspectionId,
            run.rows[0].id,
            job.queueName,
            job.jobType,
            job.state,
            job.semanticKey,
            manifestHash,
            releaseId,
          ],
        );
      }
      for (let index = 1; index < jobs.length; index += 1) {
        await client.query(
          `INSERT INTO analysis_job_dependencies (job_id, prerequisite_job_id, run_id)
           VALUES ($1, $2, $3)`,
          [jobs[index].id, jobs[index - 1].id, run.rows[0].id],
        );
      }
      const inventoryJob = jobs[0];
      const occurredAt = new Date().toISOString();
      const traceId = audited?.command.traceId ?? randomUUID();
      await this.enqueueJobReady(client, {
        id: inventoryJob.id,
        objectId,
        inspectionId,
        runId: run.rows[0].id,
        jobType: "ANALYSIS_INVENTORY",
        queueName: "rules.evaluate",
        inputManifestHash: manifestHash,
        semanticKey: inventoryJob.semanticKey,
        releaseId,
        aggregateVersion: 1,
      }, traceId, occurredAt);
      const startedEventId = randomUUID();
      await client.query(
        `INSERT INTO domain_outbox (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           exchange_name, routing_key, payload
         ) VALUES ($1, 'analysis.started', 'ANALYSIS_RUN', $2, $3, 'inspector.events', 'analysis.started', $4::jsonb)`,
        [
          startedEventId,
          run.rows[0].id,
          1,
          JSON.stringify({
            schema_version: "1.0",
            event_id: startedEventId,
            event_type: "analysis.started",
            occurred_at: occurredAt,
            trace_id: traceId,
            organization_id: this.organizationId,
            object_id: objectId,
            inspection_id: inspectionId,
            run_id: run.rows[0].id,
            input_manifest_hash: manifestHash,
            aggregate_version: 1,
          }),
        ],
      );
      if (audited && requestHash) {
        await this.insertCommandReceipt(
          client,
          audited.command,
          audited.operation,
          audited.receiptTargetType,
          audited.receiptTargetId,
          requestHash,
          audited.responseStatus,
          { checkId: checkApiId },
        );
        await this.appendAuditEvent(client, {
          command: audited.command,
          objectId,
          inspectionId,
          action: audited.operation,
          targetType: "ANALYSIS_RUN",
          targetId: checkApiId,
          beforeRef: {
            activeRunId: activeRun.rows[0].active_run_api_id,
            state: activeRun.rows[0].active_run_state,
          },
          afterRef: {
            checkId: checkApiId,
            state: "QUEUED",
            manifestHash,
            rootJobId: inventoryJob.id,
            jobIds: jobs.map((job) => job.id),
            supersedesRunId: activeRun.rows[0].active_run_api_id,
          },
        });
      }
      return { kind: "success", value: { checkId: checkApiId }, replayed: false } as const;
    });
    return created;
  }

  async completeCheck(checkId: string): Promise<CheckRun | undefined> {
    const completed = await this.transaction(async (client) => {
      const run = await client.query<{
        id: string;
        api_id: string;
        inspection_id: string;
        object_id: string;
        run_state: string;
      }>(
        `SELECT run.id, run.api_id, run.inspection_id, run.object_id, run.run_state
         FROM analysis_runs run
         JOIN objects object ON object.id = run.object_id
         WHERE run.api_id = $1 AND object.organization_id = $2
         FOR UPDATE OF run`,
        [checkId, this.organizationId],
      );
      if (!run.rows[0]) return undefined;
      if (run.rows[0].run_state !== "QUEUED" && run.rows[0].run_state !== "RUNNING") return checkId;
      await this.sealUnsupportedRun(client, run.rows[0]);
      return checkId;
    });
    return completed ? this.getCheckUnscoped(completed) : undefined;
  }

  async claimJob(jobId: string, input: JobClaimInput): Promise<JobClaimResult> {
    return this.transaction(async (client) => {
      const scope = await client.query<{ inspection_id: string; run_id: string }>(
        `SELECT inspection_id, run_id
         FROM analysis_jobs
         WHERE id = $1 AND organization_id = $2`,
        [jobId, this.organizationId],
      );
      if (!scope.rows[0]) return { kind: "not_found" };
      const inspection = await client.query<{
        id: string;
        lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
      }>(
        `SELECT id, lifecycle, active_run_id
         FROM inspections
         WHERE id = $1
         FOR UPDATE`,
        [scope.rows[0].inspection_id],
      );
      const run = await client.query<{
        id: string;
        api_id: string;
        run_state: string;
      }>(
        `SELECT id, api_id, run_state
         FROM analysis_runs
         WHERE id = $1
         FOR UPDATE`,
        [scope.rows[0].run_id],
      );
      const job = await client.query<{
        id: string;
        organization_id: string;
        object_id: string;
        inspection_id: string;
        run_id: string;
        job_type: AnalysisJobType;
        queue_name: string;
        state: "BLOCKED" | "READY" | "LEASED" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";
        attempt_count: string | number;
        max_attempts: string | number;
        fencing_token: string | number;
        current_attempt_id: string | null;
        lease_until: Date | string | null;
        next_attempt_at: Date | string;
        input_manifest_hash: string;
        release_id: string;
        release_manifest_hash: string;
        release_byte_size: string | number;
        release_lifecycle: JobLease["release"]["lifecycle"];
        release_external_network_allowed: false;
        release_content_json: Record<string, unknown> | string;
      }>(
        `SELECT job.id, job.organization_id, job.object_id, job.inspection_id, job.run_id,
                job.job_type, job.queue_name, job.state, job.attempt_count, job.max_attempts, job.fencing_token,
                job.current_attempt_id, job.lease_until, job.next_attempt_at,
                job.input_manifest_hash, job.release_id,
                release.content_hash AS release_manifest_hash,
                release.byte_size AS release_byte_size,
                release.lifecycle AS release_lifecycle,
                release.external_network_allowed AS release_external_network_allowed,
                release.content_json AS release_content_json
         FROM analysis_jobs job
         JOIN analysis_releases release ON release.release_id = job.release_id
         WHERE job.id = $1
         FOR UPDATE OF job`,
        [jobId],
      );
      const row = job.rows[0];
      if (!row) return { kind: "not_found" };
      const releaseManifest = parseJson<Record<string, unknown>>(row.release_content_json);
      const releaseCanonical = canonicalJson(releaseManifest);
      if (releaseManifest.releaseId !== row.release_id
        || sha256(releaseCanonical) !== row.release_manifest_hash.trim()
        || Buffer.byteLength(releaseCanonical, "utf8") !== Number(row.release_byte_size)) {
        throw new Error("Job release manifest integrity check failed");
      }
      assertAnalysisJobQueue(row.job_type, row.queue_name, releaseManifest);
      if ((input.queueName && input.queueName !== row.queue_name)
        || ((row.queue_name === ZU127_POPPLER_V2_QUEUE
          || row.queue_name === ZU127_GENERIC_V3_QUEUE)
          && input.queueName !== row.queue_name)) {
        return { kind: "queue_mismatch" };
      }
      if (["SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].includes(row.state)) {
        return { kind: "already_terminal", state: row.state as "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" };
      }
      if (row.state === "BLOCKED") return { kind: "not_ready", state: "BLOCKED" };
      if (!input.capabilities.includes(row.job_type)) {
        return { kind: "capability_mismatch", requiredCapability: row.job_type };
      }
      const now = Date.now();
      if (row.state === "LEASED" && row.lease_until && new Date(row.lease_until).getTime() > now) {
        return { kind: "not_ready", state: "LEASED" };
      }
      if (row.state === "RETRY_WAIT" && new Date(row.next_attempt_at).getTime() > now) {
        return { kind: "not_ready", state: "RETRY_WAIT" };
      }
      if (
        inspection.rows[0]?.lifecycle !== "OPEN"
        || inspection.rows[0].active_run_id !== row.run_id
        || !run.rows[0]
        || !["QUEUED", "RUNNING"].includes(run.rows[0].run_state)
      ) {
        await client.query(
          `UPDATE analysis_jobs
           SET state = 'CANCELLED', lease_until = NULL, current_attempt_id = NULL,
               completed_at = now(), updated_at = now(), last_error_code = 'STALE_SCOPE'
           WHERE id = $1`,
          [jobId],
        );
        return { kind: "already_terminal", state: "CANCELLED" };
      }
      if (row.current_attempt_id) {
        await client.query(
          `UPDATE job_attempts
           SET state = 'EXPIRED', completed_at = now(), error_code = 'LEASE_EXPIRED'
           WHERE id = $1 AND state = 'LEASED'`,
          [row.current_attempt_id],
        );
      }
      const attemptNumber = Number(row.attempt_count) + 1;
      if (attemptNumber > Number(row.max_attempts)) {
        await client.query(
          `UPDATE analysis_jobs
           SET state = 'FAILED', completed_at = now(), updated_at = now(), last_error_code = 'ATTEMPTS_EXHAUSTED'
           WHERE id = $1`,
          [jobId],
        );
        return { kind: "already_terminal", state: "FAILED" };
      }
      const attemptId = randomUUID();
      const fencingToken = Number(row.fencing_token) + 1;
      const leaseUntil = new Date(now + 90_000).toISOString();
      await client.query(
        `UPDATE analysis_jobs
         SET state = 'LEASED', attempt_count = $2, fencing_token = $3,
             current_attempt_id = $4, lease_until = $5, updated_at = now()
         WHERE id = $1`,
        [jobId, attemptNumber, fencingToken, attemptId, leaseUntil],
      );
      await client.query(
        `INSERT INTO job_attempts (
           id, job_id, attempt_number, fencing_token, worker_id, state, lease_until
         ) VALUES ($1, $2, $3, $4, $5, 'LEASED', $6)`,
        [attemptId, jobId, attemptNumber, fencingToken, input.workerId, leaseUntil],
      );
      await client.query(
        `UPDATE analysis_runs
         SET run_state = 'RUNNING',
             current_stage = $2
         WHERE id = $1 AND run_state IN ('QUEUED', 'RUNNING')`,
        [row.run_id, ACTIVE_STAGE_LABELS[row.job_type]],
      );
      const sourceFiles = await client.query<{
        source_file_id: string;
        sha256: string;
        stages: Array<"PD" | "RD" | "ID">;
        byte_size: string | number;
        media_type: string;
      }>(
        `SELECT
           source.api_id AS source_file_id,
           item.blob_sha256 AS sha256,
           array_agg(stage.stage ORDER BY stage.stage) AS stages,
           blob.byte_size,
           blob.media_type
         FROM analysis_runs analysis_run
         JOIN manifest_items item ON item.manifest_id = analysis_run.manifest_id
         JOIN source_files source ON source.id = item.source_file_id
         JOIN blobs blob ON blob.id = source.blob_id
         JOIN source_file_stages stage ON stage.source_file_id = source.id
         WHERE analysis_run.id = $1
         GROUP BY source.api_id, item.blob_sha256, blob.byte_size, blob.media_type
         ORDER BY source.api_id`,
        [row.run_id],
      );
      const sourceReviews = await client.query<{
        source_file_id: string; source_sha256: string;
        revision_status: SourceReviewInput["revisionStatus"];
        approval_status: SourceReviewInput["approvalStatus"];
        link_group_id: string | null; section_code: SourceReviewDecision["sectionCode"];
        page_stages: SourceReviewInput["pageStages"]; basis_reference: string;
        content_hash: string; decision_hash: string;
      }>(
        `SELECT source.api_id AS source_file_id, review.source_sha256,
                review.revision_status, review.approval_status, review.link_group_id,
                review.section_code,
                review.page_stages, review.basis_reference, review.content_hash,
                snapshot.decision_hash
         FROM run_source_review_snapshots snapshot
         JOIN source_review_decisions review ON review.id = snapshot.decision_id
         JOIN source_files source ON source.id = snapshot.source_file_id
         WHERE snapshot.run_id = $1`,
        [row.run_id],
      );
      const sourceDecisions: JobLease["inputs"]["sourceDecisions"] = {};
      for (const review of sourceReviews.rows) {
        if (review.content_hash.trim() !== review.decision_hash.trim()) {
          throw new Error("run source review snapshot hash mismatch");
        }
        sourceDecisions[review.source_file_id] = {
          sourceSha256: review.source_sha256.trim(), revisionStatus: review.revision_status,
          approvalStatus: review.approval_status, linkGroupId: review.link_group_id,
          sectionCode: review.section_code,
          pageStages: review.page_stages, basis: { reference: review.basis_reference },
        };
      }
      const reviewedEntityLinks = row.job_type === "RULE_EVALUATION"
        ? await this.loadReviewedFactEntityLinks(client, row.run_id, row.object_id) : [];
      if (reviewedEntityLinks === null) {
        throw new Error("Run fact entity link snapshot integrity check failed");
      }
      return {
        kind: "acquired",
        lease: {
          jobId: row.id,
          jobType: row.job_type,
          attemptId,
          attemptNumber,
          fencingToken,
          leaseUntil,
          organizationId: row.organization_id,
          objectId: row.object_id,
          inspectionId: row.inspection_id,
          runId: row.run_id,
          inputManifestHash: row.input_manifest_hash.trim(),
          releaseId: row.release_id,
          release: {
            manifestHash: row.release_manifest_hash.trim(),
            lifecycle: row.release_lifecycle,
            externalNetworkAllowed: false,
            textLayer: releaseManifest.textLayer,
            providerSlot: providerSlotForJob(releaseManifest, row.job_type),
            ocrLayoutSlot: (() => {
              const slot = providerSlotForJob(releaseManifest, "DOCUMENT_OCR_LAYOUT");
              return slot ? { profileId: slot.profileId, configHash: slot.configHash } : null;
            })(),
            rules: isRecord(releaseManifest.rules) && (
              releaseManifest.rules.executionStatus === "PILOT"
              || releaseManifest.rules.executionStatus === "UNCONFIGURED"
            ) ? {
              executionStatus: releaseManifest.rules.executionStatus,
              ...(isRecord(releaseManifest.rules.definitions)
                && isRecord(releaseManifest.rules.definitions.navigation)
                && isRecord(releaseManifest.rules.definitions.numeric)
                ? { definitions: {
                    navigation: releaseManifest.rules.definitions.navigation,
                    numeric: releaseManifest.rules.definitions.numeric,
                    ...(isRecord(releaseManifest.rules.definitions.heat)
                      ? { heat: releaseManifest.rules.definitions.heat } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.ocrHeatRows)
                      ? { ocrHeatRows: releaseManifest.rules.definitions.ocrHeatRows } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.factFamily)
                      ? { factFamily: releaseManifest.rules.definitions.factFamily } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.candidateFamilyPreview)
                      ? { candidateFamilyPreview: releaseManifest.rules.definitions.candidateFamilyPreview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.candidateFamilyObservations)
                      ? { candidateFamilyObservations: releaseManifest.rules.definitions.candidateFamilyObservations } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.candidateFamilyOcrObservations)
                      ? { candidateFamilyOcrObservations: releaseManifest.rules.definitions.candidateFamilyOcrObservations } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.ocrTableRows)
                      ? { ocrTableRows: releaseManifest.rules.definitions.ocrTableRows } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.unresolvedFamilyReview)
                      ? { unresolvedFamilyReview: releaseManifest.rules.definitions.unresolvedFamilyReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.unresolvedFamilyOcrReview)
                      ? { unresolvedFamilyOcrReview: releaseManifest.rules.definitions.unresolvedFamilyOcrReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.siteTepAreaReview)
                      ? { siteTepAreaReview: releaseManifest.rules.definitions.siteTepAreaReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.siteGpContextReview)
                      ? { siteGpContextReview: releaseManifest.rules.definitions.siteGpContextReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.siteGpTableRowReview)
                      ? { siteGpTableRowReview: releaseManifest.rules.definitions.siteGpTableRowReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.equipmentSpecReview)
                      ? { equipmentSpecReview: releaseManifest.rules.definitions.equipmentSpecReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.materialClassReview)
                      ? { materialClassReview: releaseManifest.rules.definitions.materialClassReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.unresolvedConfigReview)
                      ? { unresolvedConfigReview: releaseManifest.rules.definitions.unresolvedConfigReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.unresolvedConfigReviewV2)
                      ? { unresolvedConfigReviewV2: releaseManifest.rules.definitions.unresolvedConfigReviewV2 } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.unresolvedConfigReviewV3)
                      ? { unresolvedConfigReviewV3: releaseManifest.rules.definitions.unresolvedConfigReviewV3 } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.layerAssemblyReview)
                      ? { layerAssemblyReview: releaseManifest.rules.definitions.layerAssemblyReview } : {}),
                    ...(isRecord(releaseManifest.rules.definitions.kr065OpeningReview)
                      ? { kr065OpeningReview: releaseManifest.rules.definitions.kr065OpeningReview } : {}),
                  } }
                : {}),
            } : null,
          },
          inputs: {
            sourceDecisions,
            ...(row.job_type === "RULE_EVALUATION" ? { reviewedEntityLinks } : {}),
            sourceFiles: sourceFiles.rows.map((source) => ({
              sourceFileId: source.source_file_id,
              sha256: source.sha256.trim(),
              stages: source.stages,
              sectionCode: sourceDecisions[source.source_file_id]?.sectionCode ?? null,
              byteSize: Number(source.byte_size),
              mediaType: source.media_type,
              downloadPath: `/api/internal/v1/jobs/${row.id}/inputs/${source.source_file_id}`,
            })),
          },
        },
      };
    });
  }

  async heartbeatJob(jobId: string, input: JobAttemptInput): Promise<JobHeartbeatResult> {
    return this.transaction(async (client) => {
      const scope = await client.query<{ inspection_id: string; run_id: string }>(
        `SELECT inspection_id, run_id
         FROM analysis_jobs
         WHERE id = $1 AND organization_id = $2`,
        [jobId, this.organizationId],
      );
      if (!scope.rows[0]) return { kind: "not_found" };
      const inspection = await client.query<{
        lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
      }>(
        `SELECT lifecycle, active_run_id
         FROM inspections
         WHERE id = $1
         FOR UPDATE`,
        [scope.rows[0].inspection_id],
      );
      const run = await client.query<{ id: string; run_state: string }>(
        `SELECT id, run_state
         FROM analysis_runs
         WHERE id = $1
         FOR UPDATE`,
        [scope.rows[0].run_id],
      );
      const job = await client.query<{
        state: "LEASED" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" | "READY" | "RETRY_WAIT";
        current_attempt_id: string | null;
        fencing_token: string | number;
        lease_until: Date | string | null;
      }>(
        `SELECT state, current_attempt_id, fencing_token, lease_until
         FROM analysis_jobs
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [jobId, this.organizationId],
      );
      const row = job.rows[0];
      if (!row) return { kind: "not_found" };
      if (["SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].includes(row.state)) {
        return { kind: "already_terminal", state: row.state as "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" };
      }
      if (
        row.state !== "LEASED"
        || row.current_attempt_id !== input.attemptId
        || Number(row.fencing_token) !== input.fencingToken
        || !row.lease_until
        || new Date(row.lease_until).getTime() <= Date.now()
      ) return { kind: "stale_attempt" };
      if (
        inspection.rows[0]?.lifecycle !== "OPEN"
        || inspection.rows[0].active_run_id !== scope.rows[0].run_id
        || !run.rows[0]
        || !["QUEUED", "RUNNING"].includes(run.rows[0].run_state)
      ) {
        await client.query(
          `UPDATE job_attempts
           SET state = 'CANCELLED', completed_at = now(), error_code = 'STALE_SCOPE',
               error_message = 'Inspection закрыта, run заменён или больше не выполняется'
           WHERE id = $1 AND state = 'LEASED'`,
          [input.attemptId],
        );
        await client.query(
          `UPDATE analysis_jobs
           SET state = 'CANCELLED', current_attempt_id = NULL, lease_until = NULL,
               last_error_code = 'STALE_SCOPE',
               last_error_message = 'Inspection закрыта, run заменён или больше не выполняется',
               completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [jobId],
        );
        return { kind: "already_terminal", state: "CANCELLED" };
      }
      const leaseUntil = new Date(Date.now() + 90_000).toISOString();
      await client.query(
        `UPDATE analysis_jobs SET lease_until = $2, updated_at = now() WHERE id = $1`,
        [jobId, leaseUntil],
      );
      await client.query(
        `UPDATE job_attempts SET lease_until = $2 WHERE id = $1 AND state = 'LEASED'`,
        [input.attemptId, leaseUntil],
      );
      return { kind: "extended", leaseUntil };
    });
  }

  async getJobInput(jobId: string, sourceFileId: string, input: JobAttemptInput): Promise<JobInputResult> {
    return this.transaction(async (client) => {
      const job = await client.query<{
        run_id: string;
        state: "BLOCKED" | "READY" | "LEASED" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";
        current_attempt_id: string | null;
        fencing_token: string | number;
        lease_until: Date | string | null;
        run_state: string;
        inspection_lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
      }>(
        `SELECT job.run_id, job.state, job.current_attempt_id, job.fencing_token, job.lease_until,
                run.run_state, inspection.lifecycle AS inspection_lifecycle,
                inspection.active_run_id
         FROM analysis_jobs job
         JOIN analysis_runs run ON run.id = job.run_id
         JOIN inspections inspection ON inspection.id = job.inspection_id
         WHERE job.id = $1 AND job.organization_id = $2`,
        [jobId, this.organizationId],
      );
      const row = job.rows[0];
      if (!row) return { kind: "not_found" };
      if (["SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].includes(row.state)) {
        return { kind: "already_terminal", state: row.state as "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" };
      }
      if (
        row.state !== "LEASED"
        || row.current_attempt_id !== input.attemptId
        || Number(row.fencing_token) !== input.fencingToken
        || !row.lease_until
        || new Date(row.lease_until).getTime() <= Date.now()
        || row.inspection_lifecycle !== "OPEN"
        || row.active_run_id !== row.run_id
        || !["QUEUED", "RUNNING"].includes(row.run_state)
      ) return { kind: "stale_attempt" };

      const source = await client.query<{
        storage_key: string;
        sha256: string;
        byte_size: string | number;
        media_type: string;
      }>(
        `SELECT blob.storage_key, item.blob_sha256 AS sha256, blob.byte_size, blob.media_type
         FROM analysis_runs run
         JOIN manifest_items item ON item.manifest_id = run.manifest_id
         JOIN source_files source ON source.id = item.source_file_id
         JOIN blobs blob ON blob.id = source.blob_id
         WHERE run.id = $1 AND source.api_id = $2`,
        [row.run_id, sourceFileId],
      );
      if (!source.rows[0]) return { kind: "not_found" };
      return {
        kind: "available",
        file: {
          storageKey: source.rows[0].storage_key,
          sha256: source.rows[0].sha256.trim(),
          byteSize: Number(source.rows[0].byte_size),
          mediaType: source.rows[0].media_type,
        },
      };
    });
  }

  async getJobTextArtifact(
    jobId: string,
    sourceFileId: string,
    input: JobAttemptInput,
  ): Promise<JobTextArtifactResult> {
    return this.transaction(async (client) => {
      const job = await client.query<{
        run_id: string;
        state: "BLOCKED" | "READY" | "LEASED" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";
        current_attempt_id: string | null;
        fencing_token: string | number;
        lease_until: Date | string | null;
        run_state: string;
        inspection_lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
      }>(
        `SELECT job.run_id, job.state, job.current_attempt_id, job.fencing_token, job.lease_until,
                run.run_state, inspection.lifecycle AS inspection_lifecycle,
                inspection.active_run_id
         FROM analysis_jobs job
         JOIN analysis_runs run ON run.id = job.run_id
         JOIN inspections inspection ON inspection.id = job.inspection_id
         WHERE job.id = $1 AND job.organization_id = $2`,
        [jobId, this.organizationId],
      );
      const row = job.rows[0];
      if (!row) return { kind: "not_found" };
      if (["SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].includes(row.state)) {
        return { kind: "already_terminal", state: row.state as "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" };
      }
      if (
        row.state !== "LEASED"
        || row.current_attempt_id !== input.attemptId
        || Number(row.fencing_token) !== input.fencingToken
        || !row.lease_until
        || new Date(row.lease_until).getTime() <= Date.now()
        || row.inspection_lifecycle !== "OPEN"
        || row.active_run_id !== row.run_id
        || !["QUEUED", "RUNNING"].includes(row.run_state)
      ) return { kind: "stale_attempt" };

      const artifact = await client.query<{
        schema_version: "document-text-v1" | "document-text-v2";
        input_sha256: string;
        content_hash: string;
        byte_size: number | string;
        content_json: Record<string, unknown>;
        manifest_sha256: string;
      }>(
        `SELECT artifact.schema_version, artifact.input_sha256, artifact.content_hash,
                artifact.byte_size, artifact.content_json, item.blob_sha256 AS manifest_sha256
         FROM analysis_runs run
         JOIN manifest_items item ON item.manifest_id = run.manifest_id
         JOIN source_files source ON source.id = item.source_file_id
         JOIN analysis_text_artifacts artifact
           ON artifact.run_id = run.id AND artifact.source_file_id = source.id
         JOIN analysis_jobs text_job
           ON text_job.id = artifact.job_id AND text_job.run_id = run.id
          AND text_job.job_type = 'DOCUMENT_TEXT_LAYER' AND text_job.state = 'SUCCEEDED'
         WHERE run.id = $1 AND source.api_id = $2
         ORDER BY CASE artifact.schema_version WHEN 'document-text-v2' THEN 0 ELSE 1 END
         LIMIT 1`,
        [row.run_id, sourceFileId],
      );
      const stored = artifact.rows[0];
      if (!stored) return { kind: "not_found" };
      const canonical = canonicalJson(stored.content_json);
      const byteSize = Buffer.byteLength(canonical, "utf8");
      const inputSha256 = stored.input_sha256.trim();
      const contentHash = stored.content_hash.trim();
      if (
        inputSha256 !== stored.manifest_sha256.trim()
        || stored.content_json.sourceFileId !== sourceFileId
        || stored.content_json.inputSha256 !== inputSha256
        || stored.content_json.schemaVersion !== stored.schema_version
        || byteSize !== Number(stored.byte_size)
        || contentHash !== sha256(canonical)
      ) return { kind: "integrity_error" };
      return {
        kind: "available",
        canonical,
        contentHash,
        byteSize,
        inputSha256,
        schemaVersion: stored.schema_version,
      };
    });
  }

  async getJobOcrLayoutArtifact(
    jobId: string,
    input: JobAttemptInput,
  ): Promise<JobOcrLayoutArtifactResult> {
    return this.transaction(async (client) => {
      const job = await client.query<{
        job_type: AnalysisJobType;
        run_id: string;
        run_api_id: string;
        object_id: string;
        state: "BLOCKED" | "READY" | "LEASED" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";
        current_attempt_id: string | null;
        fencing_token: string | number;
        lease_until: Date | string | null;
        run_state: string;
        inspection_lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
        input_manifest_hash: string;
        manifest_sha256: string;
        release_id: string;
        run_release_id: string;
        release_content_hash: string;
        release_byte_size: string | number;
        release_content_json: Record<string, unknown> | string;
      }>(
        `SELECT job.job_type, job.run_id, run.api_id AS run_api_id, run.object_id,
                job.state, job.current_attempt_id, job.fencing_token, job.lease_until,
                run.run_state, inspection.lifecycle AS inspection_lifecycle,
                inspection.active_run_id, job.input_manifest_hash,
                manifest.sha256 AS manifest_sha256, job.release_id,
                run.release_id AS run_release_id, release.content_hash AS release_content_hash,
                release.byte_size AS release_byte_size, release.content_json AS release_content_json
         FROM analysis_jobs job
         JOIN analysis_runs run ON run.id = job.run_id
         JOIN inspections inspection ON inspection.id = job.inspection_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         JOIN analysis_releases release ON release.release_id = job.release_id
         WHERE job.id = $1 AND job.organization_id = $2
         FOR SHARE OF job, run, inspection`,
        [jobId, this.organizationId],
      );
      const row = job.rows[0];
      if (!row || row.job_type !== "RULE_EVALUATION") return { kind: "not_found" };
      if (["SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].includes(row.state)) {
        return { kind: "already_terminal", state: row.state as "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" };
      }
      if (
        row.state !== "LEASED"
        || row.current_attempt_id !== input.attemptId
        || Number(row.fencing_token) !== input.fencingToken
        || !row.lease_until
        || new Date(row.lease_until).getTime() <= Date.now()
        || row.inspection_lifecycle !== "OPEN"
        || row.active_run_id !== row.run_id
        || !["QUEUED", "RUNNING"].includes(row.run_state)
      ) return { kind: "stale_attempt" };

      const manifestHash = row.input_manifest_hash.trim();
      const release = parseJson<Record<string, unknown>>(row.release_content_json);
      const releaseCanonical = canonicalJson(release);
      const slot = providerSlotForJob(release, "DOCUMENT_OCR_LAYOUT");
      const ruleSlot = providerSlotForJob(release, "RULE_EVALUATION");
      if (
        row.run_release_id !== row.release_id
        || row.manifest_sha256.trim() !== manifestHash
        || release.releaseId !== row.release_id
        || sha256(releaseCanonical) !== row.release_content_hash.trim()
        || Buffer.byteLength(releaseCanonical, "utf8") !== Number(row.release_byte_size)
      ) return { kind: "integrity_error" };
      if (slot?.status !== "CONFIGURED"
        || !((slot.profileId === boundedOcrProfileIdV3
          && slot.adapterVersion === "3" && slot.configHash === boundedOcrConfigHashV3)
          || (slot.profileId === boundedOcrProfileIdV4
            && slot.adapterVersion === "4" && slot.configHash === boundedOcrConfigHashV4)
          || (slot.profileId === boundedOcrProfileIdV5
            && slot.adapterVersion === "5" && slot.configHash === boundedOcrConfigHashV5)
          || (slot.profileId === boundedOcrProfileIdV6
            && slot.adapterVersion === "6" && slot.configHash === boundedOcrConfigHashV6
            && ruleSlot?.profileId === UNRESOLVED_FAMILY_OCR_PROFILE
            && ruleSlot.configHash === sha256(canonicalJson(UNRESOLVED_FAMILY_OCR_RULES))
            && isRecord(release.rules)
            && canonicalJson(release.rules.definitions)
              === canonicalJson(UNRESOLVED_FAMILY_OCR_RULES)))) {
        return { kind: "not_found" };
      }
      const expectedSchema = slot.profileId === boundedOcrProfileIdV6
        ? "bounded-ocr-layout-analysis-v6" : slot.profileId === boundedOcrProfileIdV5
        ? "bounded-ocr-layout-analysis-v5" : slot.profileId === boundedOcrProfileIdV4
          ? "bounded-ocr-layout-analysis-v4" : "bounded-ocr-layout-analysis-v3";

      const artifact = await client.query<PersistedOcrLayoutRow & {
        schema_version: string;
        disposition: string;
        output_count: number;
        ocr_release_id: string;
        ocr_manifest_hash: string;
        ocr_state: string;
      }>(
        `SELECT stage.id, stage.content_json, stage.content_hash, stage.byte_size,
                stage.provider_profile_id, stage.provider_config_hash,
                stage.input_manifest_hash, stage.schema_version, stage.disposition,
                stage.output_count, run.object_id AS object_internal_id,
                ocr.release_id AS ocr_release_id,
                ocr.input_manifest_hash AS ocr_manifest_hash, ocr.state AS ocr_state
         FROM analysis_jobs ocr
         JOIN analysis_stage_artifacts stage ON stage.job_id = ocr.id
           AND stage.run_id = ocr.run_id AND stage.job_type = ocr.job_type
         JOIN analysis_runs run ON run.id = ocr.run_id
         WHERE ocr.run_id = $1 AND ocr.job_type = 'DOCUMENT_OCR_LAYOUT'
         LIMIT 2`,
        [row.run_id],
      );
      if (artifact.rows.length > 1) return { kind: "integrity_error" };
      const stored = artifact.rows[0];
      if (!stored || stored.ocr_state !== "SUCCEEDED") return { kind: "not_found" };
      const content = parseJson<Record<string, unknown>>(stored.content_json);
      const canonical = canonicalJson(content);
      const byteSize = Buffer.byteLength(canonical, "utf8");
      const contentHash = stored.content_hash.trim();
      if (
        stored.ocr_release_id !== row.release_id
        || stored.ocr_manifest_hash.trim() !== manifestHash
        || stored.input_manifest_hash.trim() !== manifestHash
        || stored.schema_version !== "analysis-stage-result-v2"
        || stored.disposition !== "OCR_LAYOUT_BOUNDED"
        || stored.provider_profile_id !== slot.profileId
        || stored.provider_config_hash.trim() !== slot.configHash
        || stored.object_internal_id !== row.object_id
        || byteSize < 1 || byteSize > 8 * 1024 * 1024
        || byteSize !== Number(stored.byte_size)
        || contentHash !== sha256(canonical)
        || content.inputManifestHash !== manifestHash
        || content.outputCount !== stored.output_count
      ) return { kind: "integrity_error" };
      if (slot.profileId === boundedOcrProfileIdV6
        && !(await this.verifyStoredOcrV6Artifact(client, row.run_id, row.object_id))) {
        return { kind: "integrity_error" };
      }
      try {
        const projected = projectOcrLayoutRead(row.run_api_id, { ...stored, content_json: content });
        if (projected.schemaVersion !== expectedSchema) {
          return { kind: "integrity_error" };
        }
      } catch {
        return { kind: "integrity_error" };
      }
      return {
        kind: "available", canonical, contentHash, byteSize,
        inputManifestHash: manifestHash,
        schemaVersion: expectedSchema,
        providerProfileId: slot.profileId,
        providerConfigHash: slot.configHash,
      };
    });
  }

  async completeJob(jobId: string, input: JobCompleteInput): Promise<JobCompleteResult> {
    const completed = await this.transaction(async (client) => {
      const scope = await client.query<{ inspection_id: string; run_id: string }>(
        `SELECT inspection_id, run_id FROM analysis_jobs WHERE id = $1 AND organization_id = $2`,
        [jobId, this.organizationId],
      );
      if (!scope.rows[0]) return { kind: "not_found" } as const;
      const inspection = await client.query<{
        lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
      }>(
        `SELECT lifecycle, active_run_id FROM inspections WHERE id = $1 FOR UPDATE`,
        [scope.rows[0].inspection_id],
      );
      const run = await client.query<{
        id: string;
        api_id: string;
        inspection_id: string;
        object_id: string;
        run_state: string;
        event_version: string | number;
      }>(
        `SELECT id, api_id, inspection_id, object_id, run_state, event_version
         FROM analysis_runs WHERE id = $1 FOR UPDATE`,
        [scope.rows[0].run_id],
      );
      const job = await client.query<{
        job_type: AnalysisJobType;
        state: "BLOCKED" | "READY" | "LEASED" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";
        current_attempt_id: string | null;
        fencing_token: string | number;
        lease_until: Date | string | null;
        input_manifest_hash: string;
        release_id: string;
      }>(
        `SELECT job_type, state, current_attempt_id, fencing_token, lease_until,
                input_manifest_hash, release_id
         FROM analysis_jobs WHERE id = $1 FOR UPDATE`,
        [jobId],
      );
      const row = job.rows[0];
      if (!row || !run.rows[0]) return { kind: "not_found" } as const;
      if (
        row.state === "SUCCEEDED"
        && row.current_attempt_id === input.attemptId
        && Number(row.fencing_token) === input.fencingToken
      ) {
        return { kind: "completed", checkId: run.rows[0].api_id, replayed: true } as const;
      }
      if (["FAILED", "DEAD", "CANCELLED"].includes(row.state)) {
        return { kind: "already_terminal", state: row.state as "FAILED" | "DEAD" | "CANCELLED" } as const;
      }
      if (
        row.state !== "LEASED"
        || row.current_attempt_id !== input.attemptId
        || Number(row.fencing_token) !== input.fencingToken
        || !row.lease_until
        || new Date(row.lease_until).getTime() <= Date.now()
      ) return { kind: "stale_attempt" } as const;
      if (
        inspection.rows[0]?.lifecycle !== "OPEN"
        || inspection.rows[0].active_run_id !== run.rows[0].id
        || !["QUEUED", "RUNNING"].includes(run.rows[0].run_state)
      ) {
        return {
          kind: "invalid_state",
          code: "STALE_RUN_SCOPE",
          message: "Run больше не является активным OPEN scope",
        } as const;
      }
      const result = input.result
        ?? (row.job_type === "ANALYSIS_SEAL_UNSUPPORTED"
          ? { disposition: "UNSUPPORTED_COVERAGE_SEALED" }
          : {});
      let storedResult: Record<string, unknown> = result;
      if (row.job_type === "ANALYSIS_INVENTORY") {
        const expectedResult = await client.query<{
          source_count: string | number;
          pd_count: string | number;
          rd_count: string | number;
          id_count: string | number;
        }>(
          `SELECT
             COUNT(DISTINCT item.source_file_id) AS source_count,
             COUNT(DISTINCT item.source_file_id) FILTER (WHERE stage.stage = 'PD') AS pd_count,
             COUNT(DISTINCT item.source_file_id) FILTER (WHERE stage.stage = 'RD') AS rd_count,
             COUNT(DISTINCT item.source_file_id) FILTER (WHERE stage.stage = 'ID') AS id_count
           FROM analysis_runs analysis_run
           JOIN manifest_items item ON item.manifest_id = analysis_run.manifest_id
           JOIN source_file_stages stage ON stage.source_file_id = item.source_file_id
           WHERE analysis_run.id = $1`,
          [run.rows[0].id],
        );
        const expected = expectedResult.rows[0];
        if (!expected || !validateInventoryResult(result, {
          sourceCount: Number(expected.source_count),
          stageCounts: {
            PD: Number(expected.pd_count),
            RD: Number(expected.rd_count),
            ID: Number(expected.id_count),
          },
        })) {
          return {
            kind: "invalid_state",
            code: "INVALID_JOB_RESULT",
            message: "Результат inventory не соответствует immutable manifest",
          } as const;
        }
      } else if (row.job_type === "DOCUMENT_TEXT_LAYER") {
        const release = await client.query<{ content_json: Record<string, unknown> }>(
          `SELECT content_json FROM analysis_releases WHERE release_id = $1`, [row.release_id],
        );
        const releaseTextLayer = release.rows[0]?.content_json?.textLayer;
        if (!isRecord(releaseTextLayer)
          || releaseTextLayer.artifactSchemaVersion !== "document-text-v2"
          || !["text-layer-quality-v1", TEXT_QUALITY_POLICY_VERSION].includes(
            String(releaseTextLayer.qualityPolicyVersion))) {
          return {
            kind: "invalid_state",
            code: "INVALID_JOB_RESULT",
            message: "Release не задаёт поддерживаемую политику text layer",
          } as const;
        }
        const expectedSources = await client.query<{
          id: string;
          api_id: string;
          sha256: string;
          media_type: string;
        }>(
          `SELECT source.id, source.api_id, item.blob_sha256 AS sha256, blob.media_type
           FROM analysis_runs analysis_run
           JOIN manifest_items item ON item.manifest_id = analysis_run.manifest_id
           JOIN source_files source ON source.id = item.source_file_id
           JOIN blobs blob ON blob.id = source.blob_id
           WHERE analysis_run.id = $1
           ORDER BY source.api_id`,
          [run.rows[0].id],
        );
        const validated = validateDocumentTextResult(result, expectedSources.rows.map((source) => ({
          id: source.id,
          apiId: source.api_id,
          sha256: source.sha256.trim(),
          mediaType: source.media_type,
        })), releaseTextLayer as unknown as AnalysisReleaseManifest["textLayer"]);
        if (!validated) {
          return {
            kind: "invalid_state",
            code: "INVALID_JOB_RESULT",
            message: "Результат document text layer не соответствует immutable manifest или artifact schema",
          } as const;
        }
        for (const artifact of validated.artifacts) {
          await client.query(
            `INSERT INTO analysis_text_artifacts (
               id, job_id, run_id, source_file_id, schema_version, input_sha256,
               content_hash, byte_size, page_count, text_page_count, content_json
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
            [
              artifact.id,
              jobId,
              run.rows[0].id,
              artifact.source.id,
              artifact.artifact.schemaVersion,
              artifact.source.sha256,
              artifact.contentHash,
              artifact.byteSize,
              artifact.artifact.pageCount,
              artifact.artifact.textPageCount,
              artifact.canonical,
            ],
          );
        }
        const ocrRequiredPageCount = countOcrRequiredPages(validated.artifacts);
        const ruleSlot = release.rows[0]
          ? providerSlotForJob(release.rows[0].content_json, "RULE_EVALUATION") : null;
        const pinnedOcrHeatReview = ruleSlot?.status === "CONFIGURED"
          && (ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-v1"
            || ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
            || ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
            || ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
            || ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
            || isOcrTableProfile(ruleSlot.profileId)
            || ruleSlot.profileId === UNRESOLVED_FAMILY_OCR_PROFILE);
        if (ocrRequiredPageCount > 0 || pinnedOcrHeatReview) {
          const adjacentStages = await client.query<{ id: string; job_type: AnalysisJobType }>(
            `SELECT id, job_type
             FROM analysis_jobs
             WHERE run_id = $1 AND job_type IN ('DOCUMENT_RENDER', 'DOCUMENT_METADATA')
             FOR UPDATE`,
            [run.rows[0].id],
          );
          const renderJob = adjacentStages.rows.find((stage) => stage.job_type === "DOCUMENT_RENDER");
          const metadataJob = adjacentStages.rows.find((stage) => stage.job_type === "DOCUMENT_METADATA");
          if (!renderJob || !metadataJob) {
            throw new Error("analysis pipeline scaffold is missing render or metadata job");
          }
          const ocrJobId = randomUUID();
          const ocrSemanticKey = sha256(canonicalJson({
            objectId: run.rows[0].object_id,
            runId: run.rows[0].id,
            stage: "DOCUMENT_OCR_LAYOUT",
            inputManifestHash: row.input_manifest_hash.trim(),
            releaseId: row.release_id,
          }));
          await client.query(
            `INSERT INTO analysis_jobs (
               id, organization_id, object_id, inspection_id, run_id,
               queue_name, job_type, scope_type, state, semantic_key,
               input_manifest_hash, release_id
             ) VALUES (
               $1, $2, $3, $4, $5,
               'documents.extract', 'DOCUMENT_OCR_LAYOUT', 'ANALYSIS', 'BLOCKED', $6,
               $7, $8
             )`,
            [
              ocrJobId,
              this.organizationId,
              run.rows[0].object_id,
              run.rows[0].inspection_id,
              run.rows[0].id,
              ocrSemanticKey,
              row.input_manifest_hash.trim(),
              row.release_id,
            ],
          );
          await client.query(
            `INSERT INTO analysis_job_dependencies (job_id, prerequisite_job_id, run_id)
             VALUES ($1, $2, $4), ($3, $1, $4)`,
            [ocrJobId, renderJob.id, metadataJob.id, run.rows[0].id],
          );
        }
        storedResult = validated.storedResult;
      } else if (isScaffoldJobType(row.job_type)) {
        if (row.job_type === "DOCUMENT_OCR_LAYOUT") {
          const release = await client.query<{ content_json: Record<string, unknown> }>(
            `SELECT content_json FROM analysis_releases WHERE release_id = $1`, [row.release_id],
          );
          const slot = release.rows[0]
            ? providerSlotForJob(release.rows[0].content_json, row.job_type) : null;
          if (slot?.status === "CONFIGURED") {
            const sources = await client.query<{
              api_id: string; sha256: string; byte_size: string | number;
              media_type: string; text_artifact: Record<string, unknown> | null;
            }>(
              `SELECT source.api_id, item.blob_sha256 AS sha256,
                      blob.byte_size, blob.media_type, text.content_json AS text_artifact
               FROM analysis_runs analysis_run
               JOIN manifest_items item ON item.manifest_id = analysis_run.manifest_id
               JOIN source_files source ON source.id = item.source_file_id
               JOIN blobs blob ON blob.id = source.blob_id
               LEFT JOIN analysis_text_artifacts text
                 ON text.run_id = analysis_run.id AND text.source_file_id = source.id
                 AND text.schema_version = 'document-text-v2'
               WHERE analysis_run.id = $1 ORDER BY source.api_id`,
              [run.rows[0].id],
            );
            const supportedOcrSlot = (slot.profileId === boundedOcrProfileId
                && slot.adapterVersion === "1" && slot.configHash === boundedOcrConfigHash)
              || (slot.profileId === boundedOcrProfileIdV2
                && slot.adapterVersion === "2" && slot.configHash === boundedOcrConfigHashV2)
              || (slot.profileId === boundedOcrProfileIdV3
                && slot.adapterVersion === "3" && slot.configHash === boundedOcrConfigHashV3)
              || (slot.profileId === boundedOcrProfileIdV4
                && slot.adapterVersion === "4" && slot.configHash === boundedOcrConfigHashV4)
              || (slot.profileId === boundedOcrProfileIdV5
                && slot.adapterVersion === "5" && slot.configHash === boundedOcrConfigHashV5)
              || (slot.profileId === boundedOcrProfileIdV6
                && slot.adapterVersion === "6" && slot.configHash === boundedOcrConfigHashV6);
            const v6Sources = supportedOcrSlot && slot.profileId === boundedOcrProfileIdV6
              ? await this.loadOcrV6ExpectedSources(client, run.rows[0].id,
                run.rows[0].object_id) : null;
            const validated = supportedOcrSlot && slot.profileId === boundedOcrProfileIdV6
              ? (v6Sources ? validateBoundedOcrV6StageResult(
                  result, row.input_manifest_hash.trim(), run.rows[0].object_id,
                  v6Sources) : undefined)
              : supportedOcrSlot
                && sources.rows.every((source) => Number.isSafeInteger(Number(source.byte_size)))
                ? validateBoundedOcrStageResult(
                  result, row.input_manifest_hash.trim(), run.rows[0].object_id,
                  sources.rows.map((source) => ({
                    apiId: source.api_id, sha256: source.sha256.trim(),
                    byteSize: Number(source.byte_size), mediaType: source.media_type,
                    textArtifact: source.text_artifact,
                  })), slot.profileId ?? "",
                ) : undefined;
            if (!validated) return {
              kind: "invalid_state", code: "INVALID_JOB_RESULT",
              message: "OCR/layout result не соответствует release, manifest или качеству страниц",
            } as const;
            await client.query(
              `INSERT INTO analysis_stage_artifacts (
                 id, job_id, run_id, job_type, schema_version, disposition,
                 reason_code, provider_kind, provider_profile_id, provider_config_hash,
                 output_count, input_manifest_hash, content_hash, byte_size, content_json
               ) VALUES (
                 $1, $2, $3, 'DOCUMENT_OCR_LAYOUT', 'analysis-stage-result-v2',
                 'OCR_LAYOUT_BOUNDED', 'BOUNDED_OCR_ONLY', 'OCR_LAYOUT', $4, $5,
                 $6, $7, $8, $9, $10::jsonb
               )`,
              [validated.id, jobId, run.rows[0].id, slot.profileId, slot.configHash,
                validated.outputCount, row.input_manifest_hash.trim(), validated.contentHash,
                validated.byteSize, validated.canonical],
            );
            storedResult = validated.storedResult;
          } else if (slot?.status !== "UNCONFIGURED") return {
            kind: "invalid_state", code: "INVALID_RELEASE",
            message: "DOCUMENT_OCR_LAYOUT release provider slot отсутствует",
          } as const;
        }
        if (row.job_type === "ENTITY_EXTRACTION") {
          const release = await client.query<{ content_json: Record<string, unknown> }>(
            `SELECT content_json FROM analysis_releases WHERE release_id = $1`,
            [row.release_id],
          );
          const slot = release.rows[0]
            ? providerSlotForJob(release.rows[0].content_json, row.job_type)
            : null;
          if (slot?.status === "CONFIGURED") {
            const sources = await client.query<{
              api_id: string; sha256: string; media_type: string; page_count: number | null;
            }>(
              `SELECT source.api_id, item.blob_sha256 AS sha256,
                      blob.media_type, text.page_count
               FROM analysis_runs analysis_run
               JOIN manifest_items item ON item.manifest_id = analysis_run.manifest_id
               JOIN source_files source ON source.id = item.source_file_id
               JOIN blobs blob ON blob.id = source.blob_id
               LEFT JOIN analysis_text_artifacts text
                 ON text.run_id = analysis_run.id AND text.source_file_id = source.id
                   AND text.schema_version = 'document-text-v2'
               WHERE analysis_run.id = $1
               ORDER BY source.api_id`,
              [run.rows[0].id],
            );
            const pdfSources = sources.rows.filter((source) => source.media_type === "application/pdf");
            const currentVisualSlot = slot.profileId === visualProposalProfileId
              && slot.configHash === visualProposalConfigHash && slot.adapterVersion === "4";
            const v5VisualSlot = slot.profileId === v5VisualProposalProfileId
              && slot.configHash === v5VisualProposalConfigHash && slot.adapterVersion === "5";
            const v6VisualSlot = slot.profileId === v6VisualProposalProfileId
              && slot.configHash === v6VisualProposalConfigHash && slot.adapterVersion === "6";
            const v3VisualSlot = slot.profileId === v3VisualProposalProfileId
              && slot.configHash === v3VisualProposalConfigHash && slot.adapterVersion === "3";
            const v2VisualSlot = slot.profileId === v2VisualProposalProfileId
              && slot.configHash === v2VisualProposalConfigHash && slot.adapterVersion === "2";
            const legacyVisualSlot = slot.profileId === legacyVisualProposalProfileId
              && slot.configHash === legacyVisualProposalConfigHash && slot.adapterVersion === "1";
            const validated = (currentVisualSlot || v5VisualSlot || v6VisualSlot || v3VisualSlot || v2VisualSlot || legacyVisualSlot)
              && pdfSources.every((source) => Number.isSafeInteger(source.page_count) && Number(source.page_count) > 0)
              ? validateVisualProposalStageResult(
                  result,
                  row.input_manifest_hash.trim(),
                  run.rows[0].object_id,
                  pdfSources.map((source) => ({
                    apiId: source.api_id,
                    sha256: source.sha256.trim(),
                    pageCount: Number(source.page_count),
                  })),
                  slot.profileId ?? "",
                )
              : undefined;
            if (!validated) {
              return {
                kind: "invalid_state", code: "INVALID_JOB_RESULT",
                message: "Visual proposals не соответствуют release, manifest или страницам PDF",
              } as const;
            }
            await client.query(
              `INSERT INTO analysis_stage_artifacts (
                 id, job_id, run_id, job_type, schema_version, disposition,
                 reason_code, provider_kind, provider_profile_id, provider_config_hash,
                 output_count, input_manifest_hash, content_hash, byte_size, content_json
               ) VALUES (
                 $1, $2, $3, 'ENTITY_EXTRACTION', 'analysis-stage-result-v2', 'VISUAL_PROPOSAL_SCAN',
                 'PROPOSAL_ONLY_UNVERIFIED', 'ENTITY_EXTRACTION_MODEL', $4, $5,
                 $6, $7, $8, $9, $10::jsonb
               )`,
              [
                validated.id, jobId, run.rows[0].id,
                slot.profileId, slot.configHash, validated.outputCount,
                row.input_manifest_hash.trim(), validated.contentHash,
                validated.byteSize, validated.canonical,
              ],
            );
            storedResult = validated.storedResult;
          } else if (slot?.status !== "UNCONFIGURED") {
            return {
              kind: "invalid_state", code: "INVALID_RELEASE",
              message: "ENTITY_EXTRACTION release provider slot отсутствует",
            } as const;
          }
        }
        if (row.job_type === "RULE_EVALUATION") {
          const release = await client.query<{ content_json: Record<string, unknown> }>(
            `SELECT content_json FROM analysis_releases WHERE release_id = $1`,
            [row.release_id],
          );
          const slot = release.rows[0]
            ? providerSlotForJob(release.rows[0].content_json, row.job_type)
            : null;
          if (slot?.status === "CONFIGURED") {
            const sources = await client.query<{ api_id: string; sha256: string }>(
              `SELECT source.api_id, item.blob_sha256 AS sha256
               FROM analysis_runs analysis_run
               JOIN manifest_items item ON item.manifest_id = analysis_run.manifest_id
               JOIN source_files source ON source.id = item.source_file_id
               WHERE analysis_run.id = $1
               ORDER BY source.api_id`,
              [run.rows[0].id],
            );
            const pilotSources = (slot.profileId === "typed-pz002-pz017-v1"
              || slot.profileId === "typed-pz002-pz017-ocr-heat-v1"
              || slot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
              || slot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
              || slot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
              || slot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
              || isOcrTableProfile(slot.profileId)
              || slot.profileId === UNRESOLVED_FAMILY_OCR_PROFILE
              || slot.profileId === SITE_TEP_AREA_PROFILE
              || slot.profileId === SITE_GP_CONTEXT_PROFILE
              || slot.profileId === SITE_GP_TABLE_ROW_PROFILE
              || slot.profileId === EQUIPMENT_SPEC_PROFILE
              || slot.profileId === MATERIAL_CLASS_PROFILE
              || slot.profileId === UNRESOLVED_CONFIG_PROFILE
              || slot.profileId === UNRESOLVED_CONFIG_PROFILE_V2
              || slot.profileId === UNRESOLVED_CONFIG_PROFILE_V3
              || slot.profileId === LAYER_ASSEMBLY_PROFILE
              || slot.profileId === KR065_OPENING_PROFILE)
              || (isRecord(result.analysis) && isRecord(result.analysis.evaluation)
                  && result.analysis.evaluation.machineStatus === "CANDIDATE")
              ? await this.loadPilotCandidateSources(client, run.rows[0].id)
              : [];
            const candidate = isRecord(result.analysis) && isRecord(result.analysis.evaluation)
              && result.analysis.evaluation.machineStatus === "CANDIDATE"
              ? verifyPilotPz002Candidate(
                  result.analysis,
                  run.rows[0].object_id,
                  pilotSources,
                )
              : null;
            const profileId = slot.profileId;
            const verifiedHeat = (profileId === "typed-pz002-pz017-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
              || isOcrTableProfile(profileId)
              || profileId === UNRESOLVED_FAMILY_OCR_PROFILE
              || profileId === SITE_TEP_AREA_PROFILE
              || profileId === SITE_GP_CONTEXT_PROFILE
              || profileId === SITE_GP_TABLE_ROW_PROFILE
              || profileId === EQUIPMENT_SPEC_PROFILE
              || profileId === MATERIAL_CLASS_PROFILE
              || profileId === UNRESOLVED_CONFIG_PROFILE
              || profileId === UNRESOLVED_CONFIG_PROFILE_V2
              || profileId === UNRESOLVED_CONFIG_PROFILE_V3
              || profileId === LAYER_ASSEMBLY_PROFILE
              || profileId === KR065_OPENING_PROFILE)
              && verifyPilotHeatAnalysis(
                result.heatLoad, run.rows[0].object_id, row.input_manifest_hash.trim(), pilotSources,
              );
            const ocrInputs = (profileId === "typed-pz002-pz017-ocr-heat-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
              || profileId === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
              || isOcrTableProfile(profileId))
              ? await this.loadOcrHeatVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id, row.release_id, row.input_manifest_hash.trim())
              : null;
            const verifiedOcrHeat = ocrInputs !== null && validateOcrHeatRowProposals(
              result.ocrHeatRows, ocrInputs.stage, ocrInputs.sourceReviews, ocrInputs.sourceFiles,
              row.input_manifest_hash.trim(),
            );
            const candidateOcrProfile = profileId
              === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
              || isOcrTableProfile(profileId);
            const ocrTableProfile = isOcrTableProfile(profileId);
            const candidateObservationsProfile = profileId
              === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
              || candidateOcrProfile;
            const candidatePreviewProfile = profileId
              === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
              || candidateObservationsProfile;
            const factFamilyProfile = profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
              || candidatePreviewProfile;
            const factInputs = factFamilyProfile && slot.configHash
              && release.rows[0] && hasPinnedFactFamilyRules(
                release.rows[0].content_json, slot.configHash,
                candidatePreviewProfile, candidateObservationsProfile, candidateOcrProfile,
                ocrTableProfile ? ocrTableVersionForProfile(profileId) : false,
                profileId === UNRESOLVED_FAMILY_PROFILE)
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id)
              : null;
            const reviewedLinks = factInputs !== null
              ? await this.loadReviewedFactEntityLinks(client, run.rows[0].id, run.rows[0].object_id) : null;
            const verifiedFactFamily = factInputs !== null && reviewedLinks !== null
              && verifyFactFamilyProposals({
              objectId: run.rows[0].object_id,
              inputManifestHash: row.input_manifest_hash.trim(),
              ...factInputs,
              result: result.factFamily,
              rules: [...pilotPz002Pz017OcrHeatFactFamilyRules.factFamily.rules],
              entityLinks: verifiedReviewedFactEntityLinks(reviewedLinks,
                run.rows[0].object_id, isRecord(result.factFamily) ? result.factFamily.facts : null,
                factInputs.sourceFiles, factInputs.sourceReviews),
            });
            const verifiedCandidatePreview = candidatePreviewProfile && factInputs !== null
              && verifyCandidateFamilyPreview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...factInputs, result: result.candidateFamilyPreview,
              });
            const verifiedCandidateObservations = candidateObservationsProfile
              && verifiedCandidatePreview && factInputs !== null
              && verifyCandidateFamilyObservations({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...factInputs, preview: result.candidateFamilyPreview,
                result: result.candidateFamilyObservations,
              });
            const verifiedReviewCandidates = candidateObservationsProfile
              && factInputs !== null && "reviewCandidates" in result
              && verifyReviewCandidates({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...factInputs, result: result.reviewCandidates,
              });
            const verifiedCandidateOcrObservations = candidateOcrProfile
              && verifiedCandidateObservations && factInputs !== null && ocrInputs !== null
              && verifyCandidateFamilyOcrObservations({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...factInputs, preview: result.candidateFamilyPreview,
                ocrStage: ocrInputs.stage,
                result: result.candidateFamilyOcrObservations,
              });
            const verifiedOcrTableRows = ocrTableProfile && ocrInputs !== null
              && verifyPinnedOcrTableRows(result.ocrTableRows, ocrInputs.stage,
                row.input_manifest_hash.trim(), profileId);
            const verifiedUnresolvedFamilyReview = profileId === UNRESOLVED_FAMILY_PROFILE
              && factInputs !== null && verifyUnresolvedFamilyRunReview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...factInputs, result: result.unresolvedFamilyReview,
              });
            const v6Ocr = profileId === UNRESOLVED_FAMILY_OCR_PROFILE
              ? await this.loadVerifiedOcrV6Artifact(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedUnresolvedFamilyOcrReview = v6Ocr !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(UNRESOLVED_FAMILY_OCR_RULES)
              && sha256(canonicalJson(UNRESOLVED_FAMILY_OCR_RULES)) === slot.configHash
              && verifyUnresolvedFamilyOcrReview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                expectedSources: v6Ocr.sources, stage: v6Ocr.stage,
                stageHash: v6Ocr.stageHash, result: result.unresolvedFamilyOcrReview,
              });
            const siteInputs = profileId === SITE_TEP_AREA_PROFILE
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedSiteTepAreaReview = siteInputs !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(SITE_TEP_AREA_RULES)
              && sha256(canonicalJson(SITE_TEP_AREA_RULES)) === slot.configHash
              && verifySiteTepAreaReview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...siteInputs, result: result.siteTepAreaReview,
              });
            const gpInputs = profileId === SITE_GP_CONTEXT_PROFILE
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedSiteGpContextReview = gpInputs !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(SITE_GP_CONTEXT_RULES)
              && sha256(canonicalJson(SITE_GP_CONTEXT_RULES)) === slot.configHash
              && verifySiteGpContextReview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...gpInputs, result: result.siteGpContextReview,
              });
            const gpTableInputs = profileId === SITE_GP_TABLE_ROW_PROFILE
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedSiteGpTableRowReview = gpTableInputs !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(SITE_GP_TABLE_ROW_RULES)
              && sha256(canonicalJson(SITE_GP_TABLE_ROW_RULES)) === slot.configHash
              && verifySiteGpTableRowReview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...gpTableInputs, result: result.siteGpTableRowReview,
              });
            const equipmentInputs = profileId === EQUIPMENT_SPEC_PROFILE
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedEquipmentSpecReview = equipmentInputs !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(EQUIPMENT_SPEC_RULES)
              && sha256(canonicalJson(EQUIPMENT_SPEC_RULES)) === slot.configHash
              && verifyEquipmentSpecReview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...equipmentInputs, result: result.equipmentSpecReview,
              });
            const materialInputs = profileId === MATERIAL_CLASS_PROFILE
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedMaterialClassReview = materialInputs !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(MATERIAL_CLASS_RULES)
              && sha256(canonicalJson(MATERIAL_CLASS_RULES)) === slot.configHash
              && verifyMaterialClassReview({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...materialInputs, result: result.materialClassReview,
              });
            const layerInputs = profileId === LAYER_ASSEMBLY_PROFILE
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedLayerAssemblyReview = layerInputs !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(LAYER_ASSEMBLY_RULES)
              && sha256(canonicalJson(LAYER_ASSEMBLY_RULES)) === slot.configHash
              && verifyLayerAssemblyProposals({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...layerInputs, result: result.layerAssemblyReview,
              });
            const kr065Inputs = profileId === KR065_OPENING_PROFILE
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedKr065OpeningReview = kr065Inputs !== null
              && isRecord(release.rows[0]?.content_json.rules)
              && canonicalJson(release.rows[0].content_json.rules.definitions)
                === canonicalJson(KR065_OPENING_RULES)
              && sha256(canonicalJson(KR065_OPENING_RULES)) === slot.configHash
              && verifyKr065OpeningProposals({
                objectId: run.rows[0].object_id,
                inputManifestHash: row.input_manifest_hash.trim(),
                ...kr065Inputs, result: result.kr065OpeningReview,
              });
            const unresolvedDescriptor = unresolvedConfigDescriptorFor(profileId);
            const unresolvedInputs = unresolvedDescriptor
              ? await this.loadFactFamilyVerificationInputs(client, run.rows[0].id,
                  run.rows[0].object_id) : null;
            const verifiedUnresolvedConfigReview = unresolvedDescriptor !== null
              && unresolvedInputs !== null
              && verifyPinnedUnresolvedConfigReview(
                unresolvedDescriptor, release.rows[0]?.content_json.rules,
                slot.configHash,
                { objectId: run.rows[0].object_id,
                  inputManifestHash: row.input_manifest_hash.trim(), ...unresolvedInputs },
                result,
              );
            const validated = slot.configHash
              && (profileId === "typed-pz002-v1" || profileId === "typed-pz002-pz017-v1"
                || profileId === "typed-pz002-pz017-ocr-heat-v1"
                || factFamilyProfile || profileId === UNRESOLVED_FAMILY_OCR_PROFILE
                || profileId === SITE_TEP_AREA_PROFILE
                || profileId === SITE_GP_CONTEXT_PROFILE
                || profileId === SITE_GP_TABLE_ROW_PROFILE
                || profileId === EQUIPMENT_SPEC_PROFILE
                || profileId === MATERIAL_CLASS_PROFILE
                || profileId === UNRESOLVED_CONFIG_PROFILE
                || profileId === UNRESOLVED_CONFIG_PROFILE_V2
                || profileId === UNRESOLVED_CONFIG_PROFILE_V3
                || profileId === LAYER_ASSEMBLY_PROFILE
                || profileId === KR065_OPENING_PROFILE)
              && validatePilotPz002StageResult(
              result,
              row.input_manifest_hash.trim(),
              run.rows[0].object_id,
              sources.rows.map((source) => ({ apiId: source.api_id, sha256: source.sha256 })),
              slot.configHash,
              candidate,
              profileId,
              verifiedHeat,
              verifiedOcrHeat,
              verifiedFactFamily,
              verifiedCandidatePreview,
              verifiedCandidateObservations,
              verifiedReviewCandidates,
              verifiedCandidateOcrObservations,
              verifiedOcrTableRows,
              verifiedUnresolvedFamilyReview,
              verifiedUnresolvedFamilyOcrReview,
              verifiedSiteTepAreaReview,
              verifiedSiteGpContextReview,
              verifiedSiteGpTableRowReview,
              verifiedEquipmentSpecReview,
              verifiedMaterialClassReview,
              verifiedUnresolvedConfigReview,
              verifiedLayerAssemblyReview,
              verifiedKr065OpeningReview,
            );
            if (!validated) {
              return {
                kind: "invalid_state",
                code: "INVALID_JOB_RESULT",
                message: "PZ-002 result не соответствует release, manifest или безопасному статусу",
              } as const;
            }
            await client.query(
              `INSERT INTO analysis_stage_artifacts (
                 id, job_id, run_id, job_type, schema_version, disposition,
                 reason_code, provider_kind, provider_profile_id, provider_config_hash,
                 output_count, input_manifest_hash, content_hash, byte_size, content_json
               ) VALUES (
                 $1, $2, $3, 'RULE_EVALUATION', $4, 'RULES_EVALUATED',
                 $5, 'RULE_ENGINE', $6, $7, $8, $9, $10, $11, $12::jsonb
               )`,
              [
                validated.id, jobId, run.rows[0].id, result.schemaVersion, validated.reasonCode,
                slot.profileId, slot.configHash, validated.storedResult.outputCount,
                row.input_manifest_hash.trim(), validated.contentHash,
                validated.byteSize, validated.canonical,
              ],
            );
            storedResult = validated.storedResult;
          } else if (slot?.status !== "UNCONFIGURED") {
            return {
              kind: "invalid_state", code: "INVALID_RELEASE",
              message: "RULE_EVALUATION release provider slot отсутствует",
            } as const;
          }
        }
        if (storedResult === result) {
        const validated = validateScaffoldStageResult(
          result,
          row.job_type,
          row.input_manifest_hash.trim(),
        );
        if (!validated) {
          return {
            kind: "invalid_state",
            code: "INVALID_JOB_RESULT",
            message: "Результат pipeline stage не соответствует provider-neutral artifact schema",
          } as const;
        }
        const expected = buildExpectedScaffoldResult(row.job_type, row.input_manifest_hash.trim());
        await client.query(
          `INSERT INTO analysis_stage_artifacts (
             id, job_id, run_id, job_type, schema_version, disposition,
             reason_code, provider_kind, provider_profile_id, provider_config_hash,
             output_count, input_manifest_hash, content_hash, byte_size, content_json
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10,
             $11, $12, $13, $14, $15::jsonb
           )`,
          [
            validated.id,
            jobId,
            run.rows[0].id,
            row.job_type,
            expected.schemaVersion,
            expected.disposition,
            expected.reasonCode,
            expected.providerKind,
            expected.providerProfileId,
            expected.providerConfigHash,
            expected.outputCount,
            row.input_manifest_hash.trim(),
            validated.contentHash,
            validated.byteSize,
            validated.canonical,
          ],
        );
        storedResult = validated.storedResult;
        }
      } else if (result.disposition !== "UNSUPPORTED_COVERAGE_SEALED") {
        return {
          kind: "invalid_state",
          code: "INVALID_JOB_RESULT",
          message: "Результат seal job имеет неизвестный disposition",
        } as const;
      }
      await client.query(
        `UPDATE job_attempts
         SET state = 'SUCCEEDED', result_json = $2::jsonb, completed_at = now()
         WHERE id = $1 AND state = 'LEASED'`,
        [input.attemptId, JSON.stringify(storedResult)],
      );
      await client.query(
        `UPDATE analysis_jobs
         SET state = 'SUCCEEDED', result_json = $2::jsonb, lease_until = NULL,
             completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [jobId, JSON.stringify(storedResult)],
      );
      if (row.job_type !== "ANALYSIS_SEAL_UNSUPPORTED") {
        const stageProgress = await client.query<{
          total_count: string | number;
          succeeded_count: string | number;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE job_type <> 'ANALYSIS_SEAL_UNSUPPORTED') AS total_count,
             COUNT(*) FILTER (
               WHERE job_type <> 'ANALYSIS_SEAL_UNSUPPORTED' AND state = 'SUCCEEDED'
             ) AS succeeded_count
           FROM analysis_jobs
           WHERE run_id = $1`,
          [run.rows[0].id],
        );
        const totalCount = Math.max(1, Number(stageProgress.rows[0]?.total_count ?? 0));
        const succeededCount = Number(stageProgress.rows[0]?.succeeded_count ?? 0);
        const progress = Math.min(95, Math.floor((succeededCount / totalCount) * 95));
        const runVersion = await client.query<{ event_version: string | number }>(
          `UPDATE analysis_runs
           SET run_state = 'RUNNING', progress = $2,
               current_stage = $3,
               event_version = event_version + 1
           WHERE id = $1
           RETURNING event_version`,
          [
            run.rows[0].id,
            progress,
            COMPLETED_STAGE_LABELS[row.job_type],
          ],
        );
        const aggregateVersion = Number(runVersion.rows[0].event_version);
        const eventId = randomUUID();
        const occurredAt = new Date().toISOString();
        const traceId = randomUUID();
        await client.query(
          `INSERT INTO domain_outbox (
             id, event_type, aggregate_type, aggregate_id, aggregate_version,
             exchange_name, routing_key, payload
           ) VALUES ($1, 'stage.finished', 'ANALYSIS_RUN', $2, $3, 'inspector.events', 'stage.finished', $4::jsonb)`,
          [
            eventId,
            run.rows[0].id,
            aggregateVersion,
            JSON.stringify({
              schema_version: "1.0",
              event_id: eventId,
              event_type: "stage.finished",
              occurred_at: occurredAt,
              trace_id: traceId,
              organization_id: this.organizationId,
              object_id: run.rows[0].object_id,
              inspection_id: run.rows[0].inspection_id,
              run_id: run.rows[0].id,
              job_id: jobId,
              job_type: row.job_type,
              aggregate_version: aggregateVersion,
              result: storedResult,
            }),
          ],
        );
        const activated = await client.query<{
          id: string;
          object_id: string;
          inspection_id: string;
          run_id: string;
          job_type: AnalysisJobType;
          queue_name: string;
          input_manifest_hash: string;
          semantic_key: string;
          release_id: string;
          attempt_count: string | number;
        }>(
          `UPDATE analysis_jobs child
           SET state = 'READY', next_attempt_at = now(), updated_at = now()
           WHERE child.run_id = $1
             AND child.state = 'BLOCKED'
             AND EXISTS (
               SELECT 1
               FROM analysis_job_dependencies dependency
               WHERE dependency.job_id = child.id
                 AND dependency.prerequisite_job_id = $2
             )
             AND NOT EXISTS (
               SELECT 1
               FROM analysis_job_dependencies dependency
               JOIN analysis_jobs prerequisite ON prerequisite.id = dependency.prerequisite_job_id
               WHERE dependency.job_id = child.id
                 AND prerequisite.state <> 'SUCCEEDED'
             )
           RETURNING child.id, child.object_id, child.inspection_id, child.run_id,
                     child.job_type, child.queue_name, child.input_manifest_hash, child.semantic_key,
                     child.release_id, child.attempt_count`,
          [run.rows[0].id, jobId],
        );
        for (const child of activated.rows) {
          await this.enqueueJobReady(client, {
            id: child.id,
            objectId: child.object_id,
            inspectionId: child.inspection_id,
            runId: child.run_id,
            jobType: child.job_type,
            queueName: child.queue_name,
            inputManifestHash: child.input_manifest_hash.trim(),
            semanticKey: child.semantic_key.trim(),
            releaseId: child.release_id,
            aggregateVersion: Number(child.attempt_count) + 1,
          }, traceId, occurredAt);
        }
      } else {
        const aggregateVersion = await this.sealUnsupportedRun(client, run.rows[0]);
        const eventId = randomUUID();
        await client.query(
          `INSERT INTO domain_outbox (
             id, event_type, aggregate_type, aggregate_id, aggregate_version,
             exchange_name, routing_key, payload
           ) VALUES ($1, 'analysis.sealed', 'ANALYSIS_RUN', $2, $3, 'inspector.events', 'analysis.sealed', $4::jsonb)`,
          [
            eventId,
            run.rows[0].id,
            aggregateVersion,
            JSON.stringify({
              schema_version: "1.0",
              event_id: eventId,
              event_type: "analysis.sealed",
              occurred_at: new Date().toISOString(),
              organization_id: this.organizationId,
              object_id: run.rows[0].object_id,
              inspection_id: run.rows[0].inspection_id,
              run_id: run.rows[0].id,
              job_id: jobId,
              aggregate_version: aggregateVersion,
            }),
          ],
        );
      }
      return { kind: "completed", checkId: run.rows[0].api_id, replayed: false } as const;
    });
    if (completed.kind !== "completed") return completed;
    const check = await this.getCheckUnscoped(completed.checkId);
    if (!check) return { kind: "not_found" };
    return { kind: "completed", check, replayed: completed.replayed };
  }

  async failJob(jobId: string, input: JobFailInput): Promise<JobFailResult> {
    const retryableCodes = new Set([
      "TRANSIENT_STORAGE",
      "TRANSIENT_NETWORK",
      "PROVIDER_UNAVAILABLE",
      "WORKER_TIMEOUT",
    ]);
    return this.transaction(async (client) => {
      const scope = await client.query<{ inspection_id: string; run_id: string }>(
        `SELECT inspection_id, run_id
         FROM analysis_jobs
         WHERE id = $1 AND organization_id = $2`,
        [jobId, this.organizationId],
      );
      if (!scope.rows[0]) return { kind: "not_found" };
      const inspection = await client.query<{
        lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
      }>(
        `SELECT lifecycle, active_run_id
         FROM inspections
         WHERE id = $1
         FOR UPDATE`,
        [scope.rows[0].inspection_id],
      );
      const run = await client.query<{
        id: string;
        inspection_id: string;
        object_id: string;
        run_state: string;
      }>(
        `SELECT id, inspection_id, object_id, run_state
         FROM analysis_runs
         WHERE id = $1
         FOR UPDATE`,
        [scope.rows[0].run_id],
      );
      const job = await client.query<{
        run_id: string;
        object_id: string;
        job_type: AnalysisJobType;
        state: "BLOCKED" | "READY" | "LEASED" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED";
        current_attempt_id: string | null;
        fencing_token: string | number;
        lease_until: Date | string | null;
        attempt_count: string | number;
        max_attempts: string | number;
      }>(
        `SELECT run_id, object_id, job_type, state, current_attempt_id, fencing_token,
                lease_until, attempt_count, max_attempts
         FROM analysis_jobs
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [jobId, this.organizationId],
      );
      const row = job.rows[0];
      if (!row) return { kind: "not_found" };
      if (["SUCCEEDED", "FAILED", "DEAD", "CANCELLED"].includes(row.state)) {
        return { kind: "already_terminal", state: row.state as "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" };
      }
      if (
        row.state !== "LEASED"
        || row.current_attempt_id !== input.attemptId
        || Number(row.fencing_token) !== input.fencingToken
        || !row.lease_until
        || new Date(row.lease_until).getTime() <= Date.now()
      ) return { kind: "stale_attempt" };
      if (
        inspection.rows[0]?.lifecycle !== "OPEN"
        || inspection.rows[0].active_run_id !== row.run_id
        || !run.rows[0]
        || !["QUEUED", "RUNNING"].includes(run.rows[0].run_state)
      ) {
        await client.query(
          `UPDATE job_attempts
           SET state = 'CANCELLED', completed_at = now(), error_code = 'STALE_SCOPE',
               error_message = 'Inspection закрыта, run заменён или больше не выполняется'
           WHERE id = $1 AND state = 'LEASED'`,
          [input.attemptId],
        );
        await client.query(
          `UPDATE analysis_jobs
           SET state = 'CANCELLED', current_attempt_id = NULL, lease_until = NULL,
               last_error_code = 'STALE_SCOPE',
               last_error_message = 'Inspection закрыта, run заменён или больше не выполняется',
               completed_at = now(), updated_at = now()
           WHERE id = $1`,
          [jobId],
        );
        return { kind: "already_terminal", state: "CANCELLED" };
      }
      const shouldRetry = retryableCodes.has(input.errorCode)
        && Number(row.attempt_count) < Number(row.max_attempts);
      await client.query(
        `UPDATE job_attempts
         SET state = 'FAILED', error_code = $2, error_message = $3, completed_at = now()
         WHERE id = $1 AND state = 'LEASED'`,
        [input.attemptId, input.errorCode, input.message],
      );
      if (shouldRetry) {
        const delaySeconds = Number(row.attempt_count) === 1 ? 30 : 120;
        const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        await client.query(
          `UPDATE analysis_jobs
           SET state = 'RETRY_WAIT', current_attempt_id = NULL, lease_until = NULL,
               next_attempt_at = $2, last_error_code = $3, last_error_message = $4,
               updated_at = now()
           WHERE id = $1`,
          [jobId, nextAttemptAt, input.errorCode, input.message],
        );
        await client.query(
          `UPDATE analysis_runs
           SET run_state = 'QUEUED', current_stage = 'Повтор worker запланирован'
           WHERE id = $1 AND run_state = 'RUNNING'`,
          [row.run_id],
        );
        return { kind: "retry_scheduled", nextAttemptAt };
      }
      await client.query(
        `UPDATE analysis_jobs
         SET state = 'FAILED', lease_until = NULL, last_error_code = $2,
             last_error_message = $3, completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [jobId, input.errorCode, input.message],
      );
      await client.query(
        `WITH RECURSIVE descendants(id) AS (
           SELECT dependency.job_id
           FROM analysis_job_dependencies dependency
           WHERE dependency.prerequisite_job_id = $1
           UNION
           SELECT dependency.job_id
           FROM analysis_job_dependencies dependency
           JOIN descendants parent ON parent.id = dependency.prerequisite_job_id
         )
         UPDATE analysis_jobs descendant
         SET state = 'CANCELLED', current_attempt_id = NULL, lease_until = NULL,
             last_error_code = 'PREREQUISITE_FAILED',
             last_error_message = 'Prerequisite job завершился terminal failure',
             completed_at = now(), updated_at = now()
         WHERE descendant.id IN (SELECT id FROM descendants)
           AND descendant.state IN ('BLOCKED', 'READY', 'RETRY_WAIT')`,
        [jobId],
      );
      const failedRun = await client.query<{ event_version: string | number }>(
        `UPDATE analysis_runs
         SET run_state = 'FAILED', display_status = 'FAILED', current_stage = 'Worker завершился ошибкой',
             completed_at = now(), event_version = event_version + 1
         WHERE id = $1 AND run_state IN ('QUEUED', 'RUNNING')
         RETURNING event_version`,
        [row.run_id],
      );
      await client.query(
        `UPDATE objects SET display_status = 'FAILED', updated_at = now() WHERE id = $1`,
        [row.object_id],
      );
      const aggregateVersion = Number(failedRun.rows[0].event_version);
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO domain_outbox (
           id, event_type, aggregate_type, aggregate_id, aggregate_version,
           exchange_name, routing_key, payload
         ) VALUES ($1, 'stage.finished', 'ANALYSIS_RUN', $2, $3, 'inspector.events', 'stage.finished', $4::jsonb)`,
        [
          eventId,
          row.run_id,
          aggregateVersion,
          JSON.stringify({
            schema_version: "1.0",
            event_id: eventId,
            event_type: "stage.finished",
            occurred_at: new Date().toISOString(),
            trace_id: randomUUID(),
            organization_id: this.organizationId,
            object_id: row.object_id,
            inspection_id: run.rows[0].inspection_id,
            run_id: row.run_id,
            job_id: jobId,
            job_type: row.job_type,
            aggregate_version: aggregateVersion,
            outcome: "FAILED",
            error_code: input.errorCode,
          }),
        ],
      );
      return { kind: "failed" };
    });
  }

  private async enqueueJobReady(
    client: PoolClient,
    job: {
      id: string;
      objectId: string;
      inspectionId: string;
      runId: string;
      jobType: AnalysisJobType;
      queueName: string;
      inputManifestHash: string;
      semanticKey: string;
      releaseId: string;
      aggregateVersion: number;
    },
    traceId: string,
    occurredAt: string,
  ): Promise<void> {
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO domain_outbox (
         id, event_type, aggregate_type, aggregate_id, aggregate_version,
         exchange_name, routing_key, payload
       ) VALUES ($1, 'job.ready', 'ANALYSIS_JOB', $2, $3, 'inspector.jobs', $4, $5::jsonb)`,
      [
        eventId,
        job.id,
        job.aggregateVersion,
        job.queueName,
        JSON.stringify({
          schema_version: "1.0",
          event_id: eventId,
          event_type: "job.ready",
          occurred_at: occurredAt,
          trace_id: traceId,
          organization_id: this.organizationId,
          object_id: job.objectId,
          inspection_id: job.inspectionId,
          run_id: job.runId,
          job_id: job.id,
          job_type: job.jobType,
          scope_type: "ANALYSIS",
          input_manifest_hash: job.inputManifestHash,
          semantic_key: job.semanticKey,
          release_id: job.releaseId,
        }),
      ],
    );
  }

  private async ensureAnalysisRelease(client: PoolClient): Promise<ReturnType<typeof buildScaffoldReleaseManifest>> {
    const ocrSelection = process.env.INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE ?? "v1";
    const heatRowSelection = process.env.INSPECTOR_OCR_HEAT_ROW_PROFILE ?? "";
    const factFamilySelection = process.env.INSPECTOR_FACT_FAMILY_PROFILE ?? "";
    const candidatePreviewSelection = process.env.INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE ?? "";
    const candidateObservationsSelection = process.env.INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE ?? "";
    const candidateOcrObservationsSelection = process.env.INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE ?? "";
    const ocrTableRowsSelection = process.env.INSPECTOR_OCR_TABLE_ROWS_PROFILE ?? "";
    const ocrTypedFactSelection = process.env.INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE ?? "";
    const unresolvedFamilySelection = process.env.INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE ?? "";
    const unresolvedFamilyOcrSelection = process.env.INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE ?? "";
    const siteTepAreaSelection = process.env.INSPECTOR_SITE_TEP_AREA_REVIEW_PROFILE ?? "";
    const siteGpContextSelection = process.env.INSPECTOR_SITE_GP_CONTEXT_REVIEW_PROFILE ?? "";
    const siteGpTableRowSelection = process.env.INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE ?? "";
    const equipmentSpecSelection = process.env.INSPECTOR_EQUIPMENT_SPEC_REVIEW_PROFILE ?? "";
    const materialClassSelection = process.env.INSPECTOR_MATERIAL_CLASS_REVIEW_PROFILE ?? "";
    const unresolvedConfigSelection = process.env.INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE ?? "";
    const layerAssemblySelection = process.env.INSPECTOR_LAYER_ASSEMBLY_REVIEW_PROFILE ?? "";
    const kr065OpeningSelection = process.env.INSPECTOR_KR065_OPENING_REVIEW_PROFILE ?? "";
    if (this.analysisProfile === "PILOT_PZ002_PZ017"
      && ocrSelection !== "v1" && ocrSelection !== "v2" && ocrSelection !== "v3"
      && ocrSelection !== "v4" && ocrSelection !== "v5" && ocrSelection !== "v6") {
      throw new Error("INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE must be v1, v2, v3, v4, v5 or v6");
    }
    if (heatRowSelection !== "" && heatRowSelection !== "v1") {
      throw new Error("INSPECTOR_OCR_HEAT_ROW_PROFILE must be v1 or unset");
    }
    if (heatRowSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || !["v3", "v4", "v5"].includes(ocrSelection))) {
      throw new Error("INSPECTOR_OCR_HEAT_ROW_PROFILE=v1 requires PILOT_PZ002_PZ017 and OCR v3/v4/v5");
    }
    if (factFamilySelection !== "" && factFamilySelection !== "v1") {
      throw new Error("INSPECTOR_FACT_FAMILY_PROFILE must be v1 or unset");
    }
    if (factFamilySelection === "v1" && heatRowSelection !== "v1") {
      throw new Error("INSPECTOR_FACT_FAMILY_PROFILE=v1 requires OCR heat review v1");
    }
    if (candidatePreviewSelection !== "" && candidatePreviewSelection !== "v1") {
      throw new Error("INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE must be v1 or unset");
    }
    if (candidatePreviewSelection === "v1" && factFamilySelection !== "v1") {
      throw new Error("INSPECTOR_CANDIDATE_FAMILY_PREVIEW_PROFILE=v1 requires fact family review v1");
    }
    if (candidateObservationsSelection !== "" && candidateObservationsSelection !== "v1") {
      throw new Error("INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE must be v1 or unset");
    }
    if (candidateObservationsSelection === "v1" && candidatePreviewSelection !== "v1") {
      throw new Error("INSPECTOR_CANDIDATE_FAMILY_OBSERVATIONS_PROFILE=v1 requires candidate preview v1");
    }
    if (candidateOcrObservationsSelection !== "" && candidateOcrObservationsSelection !== "v1") {
      throw new Error("INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE must be v1 or unset");
    }
    if (candidateOcrObservationsSelection === "v1" && candidateObservationsSelection !== "v1") {
      throw new Error("INSPECTOR_CANDIDATE_FAMILY_OCR_OBSERVATIONS_PROFILE=v1 requires candidate observations v1");
    }
    if (ocrTableRowsSelection !== "" && ocrTableRowsSelection !== "v1"
      && ocrTableRowsSelection !== "v2" && ocrTableRowsSelection !== "v3") {
      throw new Error("INSPECTOR_OCR_TABLE_ROWS_PROFILE must be v1, v2, v3 or unset");
    }
    if (ocrTableRowsSelection !== "" && (candidateOcrObservationsSelection !== "v1"
      || !["v4", "v5"].includes(ocrSelection))) {
      throw new Error("INSPECTOR_OCR_TABLE_ROWS_PROFILE requires candidate family OCR observations v1 and OCR v4/v5");
    }
    if (ocrTypedFactSelection !== "" && ocrTypedFactSelection !== "v1") {
      throw new Error("INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE must be v1 or unset");
    }
    if (ocrTypedFactSelection === "v1" && (this.analysisProfile !== "PILOT_PZ002_PZ017"
      || ocrTableRowsSelection === "")) {
      throw new Error("INSPECTOR_OCR_TYPED_FACT_CANDIDATE_PROFILE=v1 requires OCR table rows");
    }
    if (unresolvedFamilySelection !== "" && unresolvedFamilySelection !== "v1") {
      throw new Error("INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE must be v1 or unset");
    }
    if (unresolvedFamilySelection === "v1" && (this.analysisProfile !== "PILOT_PZ002_PZ017"
      || ocrTableRowsSelection !== "v3")) {
      throw new Error("INSPECTOR_UNRESOLVED_FAMILY_RUN_REVIEW_PROFILE=v1 requires OCR table rows v3");
    }
    if (unresolvedFamilyOcrSelection !== "" && unresolvedFamilyOcrSelection !== "v1") {
      throw new Error("INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE must be v1 or unset");
    }
    if (unresolvedFamilyOcrSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017" || ocrSelection !== "v6"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection)) {
      throw new Error("INSPECTOR_UNRESOLVED_FAMILY_OCR_REVIEW_PROFILE=v1 requires OCR v6 without legacy OCR consumers");
    }
    if (siteTepAreaSelection !== "" && siteTepAreaSelection !== "v1") {
      throw new Error("INSPECTOR_SITE_TEP_AREA_REVIEW_PROFILE must be v1 or unset");
    }
    if (siteTepAreaSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteGpContextSelection || siteGpTableRowSelection
        || equipmentSpecSelection || materialClassSelection || unresolvedConfigSelection)) {
      throw new Error("INSPECTOR_SITE_TEP_AREA_REVIEW_PROFILE=v1 requires pilot PZ-002/PZ-017 without OCR review consumers");
    }
    if (siteGpContextSelection !== "" && siteGpContextSelection !== "v1") {
      throw new Error("INSPECTOR_SITE_GP_CONTEXT_REVIEW_PROFILE must be v1 or unset");
    }
    if (siteGpContextSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteTepAreaSelection || siteGpTableRowSelection
        || equipmentSpecSelection || materialClassSelection || unresolvedConfigSelection)) {
      throw new Error("INSPECTOR_SITE_GP_CONTEXT_REVIEW_PROFILE=v1 requires pilot PZ-002/PZ-017 without OCR review consumers");
    }
    if (siteGpTableRowSelection !== "" && siteGpTableRowSelection !== "v1") {
      throw new Error("INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE must be v1 or unset");
    }
    if (siteGpTableRowSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteTepAreaSelection || siteGpContextSelection
        || equipmentSpecSelection || materialClassSelection || unresolvedConfigSelection)) {
      throw new Error("INSPECTOR_SITE_GP_TABLE_ROW_REVIEW_PROFILE=v1 requires pilot PZ-002/PZ-017 without OCR review consumers");
    }
    if (equipmentSpecSelection !== "" && equipmentSpecSelection !== "v1") {
      throw new Error("INSPECTOR_EQUIPMENT_SPEC_REVIEW_PROFILE must be v1 or unset");
    }
    if (equipmentSpecSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteTepAreaSelection || siteGpContextSelection
        || siteGpTableRowSelection || materialClassSelection || unresolvedConfigSelection)) {
      throw new Error("INSPECTOR_EQUIPMENT_SPEC_REVIEW_PROFILE=v1 requires pilot PZ-002/PZ-017 without OCR review consumers");
    }
    if (materialClassSelection !== "" && materialClassSelection !== "v1") {
      throw new Error("INSPECTOR_MATERIAL_CLASS_REVIEW_PROFILE must be v1 or unset");
    }
    if (materialClassSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteTepAreaSelection || siteGpContextSelection
        || siteGpTableRowSelection || equipmentSpecSelection || unresolvedConfigSelection)) {
      throw new Error("INSPECTOR_MATERIAL_CLASS_REVIEW_PROFILE=v1 requires pilot PZ-002/PZ-017 without OCR review consumers");
    }
    if (unresolvedConfigSelection !== "" && unresolvedConfigSelection !== "v1"
      && unresolvedConfigSelection !== "v2" && unresolvedConfigSelection !== "v3") {
      throw new Error("INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE must be v1, v2, v3 or unset");
    }
    if (unresolvedConfigSelection !== ""
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteTepAreaSelection || siteGpContextSelection
        || siteGpTableRowSelection || equipmentSpecSelection || materialClassSelection)) {
      throw new Error("INSPECTOR_UNRESOLVED_CONFIG_REVIEW_PROFILE requires an exclusive pilot release");
    }
    if (layerAssemblySelection !== "" && layerAssemblySelection !== "v1") {
      throw new Error("INSPECTOR_LAYER_ASSEMBLY_REVIEW_PROFILE must be v1 or unset");
    }
    if (layerAssemblySelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteTepAreaSelection || siteGpContextSelection
        || siteGpTableRowSelection || equipmentSpecSelection || materialClassSelection
        || unresolvedConfigSelection || kr065OpeningSelection)) {
      throw new Error("INSPECTOR_LAYER_ASSEMBLY_REVIEW_PROFILE=v1 requires an exclusive pilot release");
    }
    if (kr065OpeningSelection !== "" && kr065OpeningSelection !== "v1") {
      throw new Error("INSPECTOR_KR065_OPENING_REVIEW_PROFILE must be v1 or unset");
    }
    if (kr065OpeningSelection === "v1"
      && (this.analysisProfile !== "PILOT_PZ002_PZ017"
        || heatRowSelection || factFamilySelection || candidatePreviewSelection
        || candidateObservationsSelection || candidateOcrObservationsSelection
        || ocrTableRowsSelection || ocrTypedFactSelection || unresolvedFamilySelection
        || unresolvedFamilyOcrSelection || siteTepAreaSelection || siteGpContextSelection
        || siteGpTableRowSelection || equipmentSpecSelection || materialClassSelection
        || unresolvedConfigSelection || layerAssemblySelection)) {
      throw new Error("INSPECTOR_KR065_OPENING_REVIEW_PROFILE=v1 requires an exclusive pilot release");
    }
    if (ocrSelection === "v6" && (heatRowSelection || factFamilySelection
      || candidatePreviewSelection || candidateObservationsSelection
      || candidateOcrObservationsSelection || ocrTableRowsSelection
      || ocrTypedFactSelection || unresolvedFamilySelection)) {
      throw new Error("INSPECTOR_OCR_LAYOUT_SELECTION_PROFILE=v6 requires OCR review consumers unset");
    }
    const release = this.analysisProfile === "PILOT_PZ002_PZ017"
      ? buildPilotPz002Pz017ReleaseManifest(this.parameters.length, this.visualProfile,
          ocrSelection === "v6" ? "V6" : ocrSelection === "v5" ? "V5" : ocrSelection === "v4" ? "V4"
            : ocrSelection === "v3" ? "V3"
            : ocrSelection === "v2" ? "V2" : "V1",
          heatRowSelection === "v1", factFamilySelection === "v1",
          candidatePreviewSelection === "v1", candidateObservationsSelection === "v1",
          candidateOcrObservationsSelection === "v1",
          ocrTableRowsSelection === "v3" ? "v3"
            : ocrTableRowsSelection === "v2" ? "v2" : ocrTableRowsSelection === "v1",
          ocrTypedFactSelection === "v1", unresolvedFamilySelection === "v1",
          unresolvedFamilyOcrSelection === "v1", siteTepAreaSelection === "v1",
          siteGpContextSelection === "v1", siteGpTableRowSelection === "v1",
          equipmentSpecSelection === "v1", materialClassSelection === "v1",
          unresolvedConfigSelection === "v1", unresolvedConfigSelection === "v2",
          unresolvedConfigSelection === "v3", layerAssemblySelection === "v1",
          kr065OpeningSelection === "v1")
      : this.analysisProfile === "PILOT_PZ002"
        ? buildPilotPz002ReleaseManifest(this.parameters.length, this.visualProfile)
        : buildScaffoldReleaseManifest(this.parameters.length);
    await client.query(
      `INSERT INTO analysis_releases (
         release_id, schema_version, lifecycle, content_hash, byte_size,
         content_json, external_network_allowed
       ) VALUES ($1, 'analysis-release-v1', $5, $2, $3, $4::jsonb, false)
       ON CONFLICT (release_id) DO NOTHING`,
      [
        release.manifest.releaseId,
        release.contentHash,
        release.byteSize,
        release.canonical,
        release.manifest.lifecycle,
      ],
    );
    const persisted = await client.query<{ content_hash: string; content_json: Record<string, unknown> }>(
      `SELECT content_hash, content_json
       FROM analysis_releases
       WHERE release_id = $1`,
      [release.manifest.releaseId],
    );
    if (
      !persisted.rows[0]
      || persisted.rows[0].content_hash.trim() !== release.contentHash
      || canonicalJson(persisted.rows[0].content_json) !== release.canonical
    ) {
      throw new Error("analysis release manifest identity conflict");
    }
    return release;
  }

  private async sealUnsupportedRun(
    client: PoolClient,
    run: { id: string; api_id: string; inspection_id: string; object_id: string },
  ): Promise<number> {
    await this.verifyOcrTypedFactCandidateArtifact(client, run.id);
    const pilotRelease = await client.query<{ lifecycle: string; execution_status: string | null;
      content_json: Record<string, unknown> }>(
      `SELECT release.lifecycle, release.content_json,
              release.content_json -> 'rules' ->> 'executionStatus' AS execution_status
       FROM analysis_runs analysis_run
       JOIN analysis_releases release ON release.release_id = analysis_run.release_id
       WHERE analysis_run.id = $1`,
      [run.id],
    );
    const ocrSlot = pilotRelease.rows[0]
      ? providerSlotForJob(pilotRelease.rows[0].content_json, "DOCUMENT_OCR_LAYOUT") : null;
    if (ocrSlot?.profileId === boundedOcrProfileIdV6) {
      const jobs = await client.query<{ id: string }>(
        `SELECT id FROM analysis_jobs WHERE run_id = $1 AND job_type = 'DOCUMENT_OCR_LAYOUT'`,
        [run.id],
      );
      const noOcrNeeded = async () => {
        const sources = await this.loadOcrV6ExpectedSources(client, run.id, run.object_id);
        return !!sources && !!selectBoundedOcrV6Pages(sources)
          && sources.every((source) => source.mediaType !== "application/pdf"
            || ((source.textArtifact as Record<string, unknown>).pages as Array<Record<string, unknown>>)
              .every((page) => (page.quality as Record<string, unknown>).disposition
                !== "OCR_REQUIRED"));
      };
      if (jobs.rows.length > 1 || (jobs.rows.length === 1
        ? !(await this.verifyStoredOcrV6Artifact(client, run.id, run.object_id))
        : !(await noOcrNeeded()))) {
        throw new Error("OCR v6 immutable stage integrity check failed");
      }
    }
    if (pilotRelease.rows[0]?.execution_status === "PILOT") {
      return this.sealPilotPz002Run(client, run);
    }
    const reason = "Исполняемое правило для новых документов пока не подключено.";
    await client.query(
      `INSERT INTO parameter_coverage (
         run_id, parameter_id, parameter_code, parameter_name, execution_rollup, reason
       )
       SELECT $1, parameter_id, parameter_code, parameter_name, 'UNSUPPORTED', $5
       FROM unnest($2::integer[], $3::text[], $4::text[])
         AS coverage(parameter_id, parameter_code, parameter_name)
       ON CONFLICT (run_id, parameter_code) DO NOTHING`,
      [
        run.id,
        this.parameters.map((parameter) => parameter.parameter_id),
        this.parameters.map((parameter) => parameter.parameter_code),
        this.parameters.map((parameter) => parameter.parameter_name),
        reason,
      ],
    );
    const stats = { ...blankStats(this.parameters.length), unsupported: this.parameters.length };
    const output = canonicalJson({
      checkId: run.api_id,
      coverage: this.parameters.map((item) => ({
        parameterCode: item.parameter_code,
        executionStatus: "UNSUPPORTED",
        reason,
      })),
    });
    const updatedRun = await client.query<{ event_version: string | number }>(
      `UPDATE analysis_runs
       SET run_state = 'PARTIAL', display_status = 'PARTIAL', progress = 100,
           current_stage = 'Исполняемые правила для новых документов пока не подключены',
           stats = $1::jsonb, output_hash = $2, completed_at = now(), sealed_at = now(),
           event_version = event_version + 1
       WHERE id = $3
       RETURNING event_version`,
      [JSON.stringify(stats), sha256(output), run.id],
    );
    await client.query(
      `UPDATE objects
       SET display_status = 'PARTIAL', stats = $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(stats), run.object_id],
    );
    return Number(updatedRun.rows[0].event_version);
  }

  private async loadPilotCandidateSources(client: PoolClient, runId: string): Promise<PilotCandidateSource[]> {
    const rows = await client.query<{
      source_file_id: string; sha256: string; name: string; stages: string[];
      review_source_sha256: string | null; revision_status: string | null;
      approval_status: string | null; link_group_id: string | null;
      page_stages: Record<string, string> | null;
      review_content_hash: string | null; decision_hash: string | null;
      content_json: Record<string, unknown> | null; content_hash: string | null;
    }>(
      `SELECT source.api_id AS source_file_id, item.blob_sha256 AS sha256,
              source.canonical_name AS name, stages.stages,
              review.source_sha256 AS review_source_sha256,
              review.revision_status, review.approval_status, review.link_group_id,
              review.page_stages, review.content_hash AS review_content_hash,
              snapshot.decision_hash, artifact.content_json, artifact.content_hash
       FROM analysis_runs run
       JOIN manifest_items item ON item.manifest_id = run.manifest_id
       JOIN source_files source ON source.id = item.source_file_id
       JOIN LATERAL (
         SELECT array_agg(stage.stage ORDER BY stage.stage) AS stages
         FROM source_file_stages stage WHERE stage.source_file_id = source.id
       ) stages ON true
       LEFT JOIN run_source_review_snapshots snapshot
         ON snapshot.run_id = run.id AND snapshot.source_file_id = source.id
       LEFT JOIN source_review_decisions review ON review.id = snapshot.decision_id
       LEFT JOIN analysis_text_artifacts artifact
         ON artifact.run_id = run.id AND artifact.source_file_id = source.id
           AND artifact.schema_version = 'document-text-v2'
       WHERE run.id = $1
       ORDER BY source.api_id`,
      [runId],
    );
    return rows.rows.map((row) => ({
      sourceFileId: row.source_file_id, sha256: row.sha256.trim(), name: row.name,
      stages: row.stages,
      review: row.review_source_sha256 && row.review_content_hash?.trim() === row.decision_hash?.trim()
        ? {
            sourceSha256: row.review_source_sha256.trim(),
            revisionStatus: row.revision_status ?? "UNKNOWN",
            approvalStatus: row.approval_status ?? "UNKNOWN",
            linkGroupId: row.link_group_id, pageStages: row.page_stages ?? {},
          }
        : null,
      textArtifact: row.content_json,
      textArtifactHash: row.content_hash,
    }));
  }

  private async loadOcrHeatVerificationInputs(
    client: PoolClient, runId: string, objectId: string, releaseId: string, manifestHash: string,
  ): Promise<{ stage: OcrHeatStageEnvelope; sourceReviews: Record<string, unknown>;
    sourceFiles: Array<{ sourceFileId: string; sha256: string; stages: string[] }> } | null> {
    const artifacts = await client.query<{
      content_json: Record<string, unknown>; content_hash: string; byte_size: number | string;
      provider_profile_id: string; provider_config_hash: string; input_manifest_hash: string;
      schema_version: string; disposition: string; output_count: number;
      job_state: string; job_release_id: string; job_manifest_hash: string;
    }>(
      `SELECT stage.content_json, stage.content_hash, stage.byte_size,
              stage.provider_profile_id, stage.provider_config_hash,
              stage.input_manifest_hash, stage.schema_version, stage.disposition,
              stage.output_count, job.state AS job_state,
              job.release_id AS job_release_id,
              job.input_manifest_hash AS job_manifest_hash
       FROM analysis_jobs job
       JOIN analysis_stage_artifacts stage ON stage.job_id = job.id
         AND stage.run_id = job.run_id AND stage.job_type = job.job_type
       WHERE job.run_id = $1 AND job.job_type = 'DOCUMENT_OCR_LAYOUT'
       LIMIT 2`,
      [runId],
    );
    if (artifacts.rows.length !== 1) return null;
    const artifact = artifacts.rows[0];
    if (artifact.job_state !== "SUCCEEDED" || artifact.job_release_id !== releaseId
      || artifact.job_manifest_hash.trim() !== manifestHash
      || artifact.input_manifest_hash.trim() !== manifestHash
      || artifact.schema_version !== "analysis-stage-result-v2"
      || artifact.disposition !== "OCR_LAYOUT_BOUNDED"
      || !((artifact.provider_profile_id === boundedOcrProfileIdV3
        && artifact.provider_config_hash.trim() === boundedOcrConfigHashV3)
        || (artifact.provider_profile_id === boundedOcrProfileIdV4
          && artifact.provider_config_hash.trim() === boundedOcrConfigHashV4)
        || (artifact.provider_profile_id === boundedOcrProfileIdV5
          && artifact.provider_config_hash.trim() === boundedOcrConfigHashV5))
      || !Number.isSafeInteger(artifact.output_count)
      || artifact.output_count < 0
      || artifact.output_count > (artifact.provider_profile_id === boundedOcrProfileIdV5 ? 4 : 2)) return null;
    const stage: OcrHeatStageEnvelope = {
      content_json: artifact.content_json, content_hash: artifact.content_hash.trim(),
      byte_size: artifact.byte_size, provider_profile_id: artifact.provider_profile_id,
      provider_config_hash: artifact.provider_config_hash.trim(),
      input_manifest_hash: artifact.input_manifest_hash.trim(),
    };
    if (!isRecord(artifact.content_json.analysis)
      || artifact.content_json.analysis.objectId !== objectId
      || artifact.content_json.outputCount !== artifact.output_count) return null;
    const sources = await client.query<{
      source_file_id: string; source_sha256: string; object_api_id: string;
      stages: string[];
      review_source_sha256: string | null; revision_status: string | null;
      approval_status: string | null; link_group_id: string | null;
      section_code: SourceReviewDecision["sectionCode"];
      page_stages: Record<string, unknown> | null; basis_reference: string | null;
      actor_id: string | null; review_content_hash: string | null; decision_hash: string | null;
      snapshot_decision_id: string | null; review_id: string | null;
    }>(
      `SELECT source.api_id AS source_file_id, item.blob_sha256 AS source_sha256,
              object.api_id AS object_api_id,
              (SELECT array_agg(stage.stage ORDER BY stage.stage)
               FROM source_file_stages stage WHERE stage.source_file_id = source.id) AS stages,
              review.source_sha256 AS review_source_sha256,
              review.revision_status, review.approval_status, review.link_group_id,
              review.section_code,
              review.page_stages, review.basis_reference, review.actor_id,
              review.content_hash AS review_content_hash, snapshot.decision_hash,
              snapshot.decision_id AS snapshot_decision_id, review.id AS review_id
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN manifest_items item ON item.manifest_id = run.manifest_id
       JOIN source_files source ON source.id = item.source_file_id
       LEFT JOIN run_source_review_snapshots snapshot
         ON snapshot.run_id = run.id AND snapshot.source_file_id = source.id
       LEFT JOIN source_review_decisions review ON review.id = snapshot.decision_id
       WHERE run.id = $1 ORDER BY source.api_id`,
      [runId],
    );
    const sourceHashes = new Map<string, string>();
    const sourceReviews: Record<string, unknown> = {};
    const sourceFiles: Array<{ sourceFileId: string; sha256: string; stages: string[] }> = [];
    for (const source of sources.rows) {
      if (sourceHashes.has(source.source_file_id)) return null;
      sourceHashes.set(source.source_file_id, source.source_sha256.trim());
      sourceFiles.push({ sourceFileId: source.source_file_id,
        sha256: source.source_sha256.trim(), stages: source.stages });
      if (source.snapshot_decision_id === null) continue;
      if (!source.review_id || source.review_id !== source.snapshot_decision_id
        || !source.review_source_sha256 || !source.page_stages || !source.actor_id
        || !source.basis_reference || !source.revision_status || !source.approval_status
        || !source.review_content_hash || !source.decision_hash
        || source.review_source_sha256.trim() !== source.source_sha256.trim()) return null;
      const contentHash = sha256(canonicalJson({
        objectApiId: source.object_api_id, sourceFileApiId: source.source_file_id,
        sourceSha256: source.review_source_sha256.trim(),
        revisionStatus: source.revision_status, approvalStatus: source.approval_status,
        linkGroupId: source.link_group_id, pageStages: source.page_stages,
        ...(source.section_code ? { sectionCode: source.section_code } : {}),
        basis: { reference: source.basis_reference }, actorId: source.actor_id,
      }));
      if (source.review_content_hash.trim() !== contentHash
        || source.decision_hash.trim() !== contentHash) return null;
      sourceReviews[source.source_file_id] = {
        sourceSha256: source.source_sha256.trim(), pageStages: source.page_stages,
      };
    }
    const analysisSources = artifact.content_json.analysis.sources;
    if (!Array.isArray(analysisSources)
      || analysisSources.some((source) => !isRecord(source)
        || typeof source.sourceFileId !== "string"
        || source.sourceSha256 !== sourceHashes.get(source.sourceFileId))) return null;
    return { stage, sourceReviews, sourceFiles };
  }

  /** Rebuild OCR v6 inputs from this run, never from the mutable latest review. */
  private async loadOcrV6ExpectedSources(
    client: PoolClient, runId: string, objectId: string,
  ): Promise<OcrV6ExpectedSource[] | null> {
    const result = await client.query<{
      source_internal_id: string; source_file_id: string; source_object_id: string;
      object_api_id: string; sha256: string; blob_sha256: string;
      byte_size: number | string;
      media_type: string; stages: string[];
      text_artifact: Record<string, unknown> | null; text_hash: string | null;
      text_byte_size: number | string | null; text_input_sha256: string | null;
      snapshot_decision_id: string | null; snapshot_hash: string | null;
      review_id: string | null; review_object_id: string | null;
      review_source_file_id: string | null; review_source_sha256: string | null;
      revision_status: string | null; approval_status: string | null;
      link_group_id: string | null; section_code: string | null;
      page_stages: Record<string, string> | null; basis_reference: string | null;
      actor_id: string | null; review_content_hash: string | null;
    }>(
      `SELECT source.id AS source_internal_id, source.api_id AS source_file_id,
              source.object_id AS source_object_id, object.api_id AS object_api_id,
              item.blob_sha256 AS sha256, blob.sha256 AS blob_sha256,
              blob.byte_size, blob.media_type,
              (SELECT array_agg(stage.stage ORDER BY stage.stage)
               FROM source_file_stages stage WHERE stage.source_file_id = source.id) AS stages,
              text.content_json AS text_artifact, text.content_hash AS text_hash,
              text.byte_size AS text_byte_size, text.input_sha256 AS text_input_sha256,
              snapshot.decision_id AS snapshot_decision_id,
              snapshot.decision_hash AS snapshot_hash,
              review.id AS review_id, review.object_id AS review_object_id,
              review.source_file_id AS review_source_file_id,
              review.source_sha256 AS review_source_sha256,
              review.revision_status, review.approval_status, review.link_group_id,
              review.section_code, review.page_stages, review.basis_reference,
              review.actor_id, review.content_hash AS review_content_hash
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN manifest_items item ON item.manifest_id = run.manifest_id
       JOIN source_files source ON source.id = item.source_file_id
         AND source.object_id = run.object_id
       JOIN blobs blob ON blob.id = source.blob_id
       LEFT JOIN analysis_text_artifacts text
         ON text.run_id = run.id AND text.source_file_id = source.id
         AND text.schema_version = 'document-text-v2'
       LEFT JOIN run_source_review_snapshots snapshot
         ON snapshot.run_id = run.id AND snapshot.source_file_id = source.id
       LEFT JOIN source_review_decisions review ON review.id = snapshot.decision_id
       WHERE run.id = $1 AND run.object_id = $2
       ORDER BY source.api_id`,
      [runId, objectId],
    );
    const sources: OcrV6ExpectedSource[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
      const sha = row.sha256.trim();
      const byteSize = Number(row.byte_size);
      if (seen.has(row.source_file_id) || row.blob_sha256.trim() !== sha
        || !Number.isSafeInteger(byteSize)
        || row.source_object_id !== objectId || !Array.isArray(row.stages)
        || row.stages.length === 0) return null;
      seen.add(row.source_file_id);
      const textArtifact = row.text_artifact === null
        ? null : parseJson<Record<string, unknown>>(row.text_artifact);
      const textHash = row.text_hash?.trim() ?? null;
      if (textArtifact === null && (textHash !== null
        || row.text_byte_size !== null || row.text_input_sha256 !== null)) return null;
      if (textArtifact !== null && (!textHash || row.text_input_sha256?.trim() !== sha
        || sha256(canonicalJson(textArtifact)) !== textHash
        || Buffer.byteLength(canonicalJson(textArtifact), "utf8") !== Number(row.text_byte_size))) {
        return null;
      }
      if (row.media_type === "application/pdf" && textArtifact === null) return null;
      if (row.media_type !== "application/pdf" && textArtifact !== null) return null;
      let sectionCode: string | null = null;
      let sourceDecision: OcrV6ExpectedSource["sourceDecision"] = null;
      if (row.snapshot_decision_id !== null) {
        if (!row.review_id || row.review_id !== row.snapshot_decision_id
          || row.review_object_id !== objectId
          || row.review_source_file_id !== row.source_internal_id
          || row.review_source_sha256?.trim() !== sha
          || !row.revision_status || !row.approval_status || !row.page_stages
          || !row.basis_reference || !row.actor_id || !row.review_content_hash
          || !row.snapshot_hash) return null;
        const contentHash = sha256(canonicalJson({
          objectApiId: row.object_api_id, sourceFileApiId: row.source_file_id,
          sourceSha256: sha, revisionStatus: row.revision_status,
          approvalStatus: row.approval_status, linkGroupId: row.link_group_id,
          pageStages: row.page_stages,
          ...(row.section_code ? { sectionCode: row.section_code } : {}),
          basis: { reference: row.basis_reference }, actorId: row.actor_id,
        }));
        if (row.review_content_hash.trim() !== contentHash
          || row.snapshot_hash.trim() !== contentHash) return null;
        sectionCode = row.section_code;
        sourceDecision = {
          sourceSha256: sha, revisionStatus: row.revision_status,
          approvalStatus: row.approval_status, sectionCode,
          pageStages: row.page_stages, basis: { reference: row.basis_reference },
        };
      }
      sources.push({ apiId: row.source_file_id, sha256: sha, byteSize,
        mediaType: row.media_type, stages: row.stages, sectionCode,
        sourceDecision, textArtifact, textArtifactSha256: textHash });
    }
    return sources.length > 0 ? sources : null;
  }

  /** Fail closed on changed immutable inputs or changed OCR bytes before seal/read. */
  private async loadVerifiedOcrV6Artifact(
    client: PoolClient, runId: string, objectId: string,
  ): Promise<{ stage: Record<string, unknown>; stageHash: string;
    sources: OcrV6ExpectedSource[] } | null> {
    const result = await client.query<{
      release_id: string; release_content_json: Record<string, unknown>;
      release_content_hash: string; release_byte_size: number | string;
      manifest_hash: string;
      job_release_id: string | null; job_manifest_hash: string | null;
      job_state: string | null; stage_content_json: Record<string, unknown> | null;
      stage_content_hash: string | null; stage_byte_size: number | string | null;
      stage_profile_id: string | null; stage_config_hash: string | null;
      stage_manifest_hash: string | null; stage_output_count: number | null;
      stage_schema: string | null; stage_disposition: string | null;
    }>(
      `SELECT run.release_id, release.content_json AS release_content_json,
              release.content_hash AS release_content_hash,
              release.byte_size AS release_byte_size,
              manifest.sha256 AS manifest_hash, job.input_manifest_hash AS job_manifest_hash,
              job.release_id AS job_release_id, job.state AS job_state,
              stage.content_json AS stage_content_json,
              stage.content_hash AS stage_content_hash,
              stage.byte_size AS stage_byte_size,
              stage.provider_profile_id AS stage_profile_id,
              stage.provider_config_hash AS stage_config_hash,
              stage.input_manifest_hash AS stage_manifest_hash,
              stage.output_count AS stage_output_count,
              stage.schema_version AS stage_schema, stage.disposition AS stage_disposition
       FROM analysis_runs run
       JOIN input_manifests manifest ON manifest.id = run.manifest_id
       JOIN analysis_releases release ON release.release_id = run.release_id
       LEFT JOIN analysis_jobs job ON job.run_id = run.id
         AND job.job_type = 'DOCUMENT_OCR_LAYOUT'
       LEFT JOIN analysis_stage_artifacts stage ON stage.job_id = job.id
         AND stage.run_id = run.id AND stage.job_type = job.job_type
       WHERE run.id = $1 AND run.object_id = $2
       LIMIT 2`,
      [runId, objectId],
    );
    if (result.rows.length !== 1) return null;
    const row = result.rows[0];
    const release = parseJson<Record<string, unknown>>(row.release_content_json);
    const releaseCanonical = canonicalJson(release);
    const slot = providerSlotForJob(release, "DOCUMENT_OCR_LAYOUT");
    if (release.releaseId !== row.release_id
      || sha256(releaseCanonical) !== row.release_content_hash.trim()
      || Buffer.byteLength(releaseCanonical, "utf8") !== Number(row.release_byte_size)
      || slot?.status !== "CONFIGURED"
      || slot.profileId !== boundedOcrProfileIdV6 || slot.adapterVersion !== "6"
      || slot.configHash !== boundedOcrConfigHashV6
      || row.job_state !== "SUCCEEDED" || row.job_release_id !== row.release_id
      || row.job_manifest_hash?.trim() !== row.manifest_hash.trim()
      || row.stage_manifest_hash?.trim() !== row.manifest_hash.trim()
      || row.stage_schema !== "analysis-stage-result-v2"
      || row.stage_disposition !== "OCR_LAYOUT_BOUNDED"
      || row.stage_profile_id !== boundedOcrProfileIdV6
      || row.stage_config_hash?.trim() !== boundedOcrConfigHashV6
      || row.stage_content_json === null || !row.stage_content_hash) return null;
    const content = parseJson<Record<string, unknown>>(row.stage_content_json);
    const canonical = canonicalJson(content);
    if (sha256(canonical) !== row.stage_content_hash.trim()
      || Buffer.byteLength(canonical, "utf8") !== Number(row.stage_byte_size)
      || content.outputCount !== row.stage_output_count) return null;
    const sources = await this.loadOcrV6ExpectedSources(client, runId, objectId);
    return sources && validateBoundedOcrV6StageResult(content,
      row.manifest_hash.trim(), objectId, sources)
      ? { stage: content, stageHash: row.stage_content_hash.trim(), sources } : null;
  }

  private async verifyStoredOcrV6Artifact(
    client: PoolClient, runId: string, objectId: string,
  ): Promise<boolean> {
    return (await this.loadVerifiedOcrV6Artifact(client, runId, objectId)) !== null;
  }

  private async loadReviewedFactEntityLinks(
    client: PoolClient, runId: string, objectId: string,
  ): Promise<ReviewedFactEntityLink[] | null> {
    const result = await client.query<{
      decision_id: string; decision_hash: string; stored_hash: string;
      link_json: Record<string, unknown>; actor_id: string; decision_object_id: string;
      parameter_code: string; attribute: string; actual_stage: string;
      pd_source_file_id: string; actual_source_file_id: string;
      pd_source_review_id: string; actual_source_review_id: string;
      pd_snapshot_review_id: string | null; actual_snapshot_review_id: string | null;
      pd_source_api_id: string | null; actual_source_api_id: string | null;
      pd_sha256: string | null; actual_sha256: string | null;
      pd_revision: string | null; actual_revision: string | null;
      pd_approval: string | null; actual_approval: string | null;
      pd_review_sha256: string | null; actual_review_sha256: string | null;
      pd_group: string | null; actual_group: string | null;
      actual_section: string | null;
    }>(
      `SELECT snapshot.decision_id, snapshot.decision_hash,
              decision.content_hash AS stored_hash, decision.link_json, decision.actor_id,
              decision.object_id AS decision_object_id, decision.parameter_code,
              decision.attribute, decision.actual_stage,
              decision.pd_source_file_id, decision.actual_source_file_id,
              decision.pd_source_review_id, decision.actual_source_review_id,
              pd_snapshot.decision_id AS pd_snapshot_review_id,
              actual_snapshot.decision_id AS actual_snapshot_review_id,
              pd_source.api_id AS pd_source_api_id,
              actual_source.api_id AS actual_source_api_id,
              pd_item.blob_sha256 AS pd_sha256,
              actual_item.blob_sha256 AS actual_sha256,
              pd_review.revision_status AS pd_revision,
              actual_review.revision_status AS actual_revision,
              pd_review.approval_status AS pd_approval,
              actual_review.approval_status AS actual_approval,
              pd_review.source_sha256 AS pd_review_sha256,
              actual_review.source_sha256 AS actual_review_sha256,
              pd_review.link_group_id AS pd_group,
              actual_review.link_group_id AS actual_group,
              actual_review.section_code AS actual_section
       FROM run_fact_entity_link_snapshots snapshot
       JOIN fact_entity_link_decisions decision ON decision.id = snapshot.decision_id
       JOIN analysis_runs run ON run.id = snapshot.run_id
       LEFT JOIN run_source_review_snapshots pd_snapshot
         ON pd_snapshot.run_id = run.id AND pd_snapshot.source_file_id = decision.pd_source_file_id
       LEFT JOIN run_source_review_snapshots actual_snapshot
         ON actual_snapshot.run_id = run.id AND actual_snapshot.source_file_id = decision.actual_source_file_id
       LEFT JOIN source_review_decisions pd_review ON pd_review.id = pd_snapshot.decision_id
       LEFT JOIN source_review_decisions actual_review ON actual_review.id = actual_snapshot.decision_id
       LEFT JOIN manifest_items pd_item
         ON pd_item.manifest_id = run.manifest_id AND pd_item.source_file_id = decision.pd_source_file_id
       LEFT JOIN manifest_items actual_item
         ON actual_item.manifest_id = run.manifest_id AND actual_item.source_file_id = decision.actual_source_file_id
       LEFT JOIN source_files pd_source ON pd_source.id = decision.pd_source_file_id
       LEFT JOIN source_files actual_source ON actual_source.id = decision.actual_source_file_id
       WHERE snapshot.run_id = $1 ORDER BY decision.parameter_code, decision.attribute, decision.actual_stage`,
      [runId],
    );
    if (result.rows.length > pilotPz002Pz017OcrHeatFactFamilyRules.factFamily.rules.length) return null;
    const links: ReviewedFactEntityLink[] = [];
    const seenRules = new Set<string>();
    for (const row of result.rows) {
      const link = parseJson<Record<string, unknown>>(row.link_json);
      const ruleKey = `${row.parameter_code}:${row.attribute}:${row.actual_stage}`;
      const rule = pilotPz002Pz017OcrHeatFactFamilyRules.factFamily.rules.find((candidate) =>
        candidate.parameterCode === row.parameter_code && candidate.attribute === row.attribute
        && candidate.actualStage === row.actual_stage);
      const evidence = link.evidence;
      const pdEvidence = Array.isArray(evidence) ? evidence[0] : null;
      const actualEvidence = Array.isArray(evidence) ? evidence[1] : null;
      const storedHash = row.stored_hash?.trim();
      if (seenRules.has(ruleKey) || !rule || row.decision_object_id !== objectId
        || row.pd_source_review_id !== row.pd_snapshot_review_id
        || row.actual_source_review_id !== row.actual_snapshot_review_id
        || row.pd_revision !== "CURRENT" || row.actual_revision !== "CURRENT"
        || row.pd_approval !== "APPROVED" || row.actual_approval !== "APPROVED"
        || row.pd_review_sha256?.trim() !== row.pd_sha256?.trim()
        || row.actual_review_sha256?.trim() !== row.actual_sha256?.trim()
        || !row.pd_group || row.pd_group !== row.actual_group
        || !(rule.requiredActualSection as readonly string[]).includes(row.actual_section ?? "")
        || link.schemaVersion !== "fact-entity-link-v1" || link.objectId !== objectId
        || link.linkGroupId !== row.pd_group
        || !isRecord(pdEvidence) || !isRecord(actualEvidence)
        || pdEvidence.sourceFileId !== row.pd_source_api_id
        || actualEvidence.sourceFileId !== row.actual_source_api_id
        || pdEvidence.sourceSha256 !== row.pd_sha256?.trim()
        || actualEvidence.sourceSha256 !== row.actual_sha256?.trim()
        || pdEvidence.factId !== link.pdFactId || actualEvidence.factId !== link.actualFactId
        || !storedHash || storedHash !== row.decision_hash.trim()
        || sha256(canonicalJson({ actorId: row.actor_id, link })) !== storedHash) return null;
      seenRules.add(ruleKey);
      links.push({ schemaVersion: "reviewed-fact-entity-link-v1", link,
        actorId: row.actor_id, contentHash: storedHash, decisionHash: storedHash });
    }
    return links;
  }

  private async loadFactFamilyVerificationInputs(
    client: PoolClient, runId: string, objectId: string,
  ): Promise<{
    sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
      stages: string[]; sourceReviewHash: string | null;
      sectionCode: SourceReviewDecision["sectionCode"] }>;
    sourceReviews: Record<string, { sourceSha256: string; revisionStatus: string;
      approvalStatus: string; linkGroupId: string | null; sectionCode: string | null;
      pageStages: Record<string, string>;
      contentHash: string; decisionHash: string }>;
    textArtifacts: Record<string, { content_json: unknown; content_hash: string }>;
  } | null> {
    const rows = await client.query<{
      source_file_id: string; source_sha256: string; object_id: string;
      object_api_id: string; stages: string[];
      review_source_sha256: string | null; revision_status: string | null;
      approval_status: string | null; link_group_id: string | null;
      section_code: SourceReviewDecision["sectionCode"];
      page_stages: Record<string, string> | null; basis_reference: string | null;
      actor_id: string | null; review_content_hash: string | null; decision_hash: string | null;
      snapshot_decision_id: string | null; review_id: string | null;
      content_json: Record<string, unknown> | null; content_hash: string | null;
      byte_size: number | string | null;
    }>(
      `SELECT source.api_id AS source_file_id, item.blob_sha256 AS source_sha256,
              object.id AS object_id, object.api_id AS object_api_id,
              (SELECT array_agg(stage.stage ORDER BY stage.stage)
               FROM source_file_stages stage WHERE stage.source_file_id = source.id) AS stages,
              review.source_sha256 AS review_source_sha256,
              review.revision_status, review.approval_status, review.link_group_id,
              review.section_code,
              review.page_stages, review.basis_reference, review.actor_id,
              review.content_hash AS review_content_hash, snapshot.decision_hash,
              snapshot.decision_id AS snapshot_decision_id, review.id AS review_id,
              artifact.content_json, artifact.content_hash, artifact.byte_size
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN manifest_items item ON item.manifest_id = run.manifest_id
       JOIN source_files source ON source.id = item.source_file_id
       LEFT JOIN run_source_review_snapshots snapshot
         ON snapshot.run_id = run.id AND snapshot.source_file_id = source.id
       LEFT JOIN source_review_decisions review ON review.id = snapshot.decision_id
       LEFT JOIN analysis_text_artifacts artifact
         ON artifact.run_id = run.id AND artifact.source_file_id = source.id
           AND artifact.schema_version = 'document-text-v2'
       WHERE run.id = $1 ORDER BY source.api_id`,
      [runId],
    );
    const sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
      stages: string[]; sourceReviewHash: string | null;
      sectionCode: SourceReviewDecision["sectionCode"] }> = [];
    const sourceReviews: Record<string, { sourceSha256: string; revisionStatus: string;
      approvalStatus: string; linkGroupId: string | null; sectionCode: string | null;
      pageStages: Record<string, string>;
      contentHash: string; decisionHash: string }> = {};
    const textArtifacts: Record<string, { content_json: unknown; content_hash: string }> = {};
    const seen = new Set<string>();
    for (const source of rows.rows) {
      const sourceHash = source.source_sha256?.trim();
      if (seen.has(source.source_file_id) || source.object_id !== objectId
        || !sourceHash || !/^[a-f0-9]{64}$/u.test(sourceHash)
        || !Array.isArray(source.stages)) return null;
      seen.add(source.source_file_id);
      let reviewHash: string | null = null;
      let sectionCode: SourceReviewDecision["sectionCode"] = null;
      if (source.snapshot_decision_id !== null) {
        if (!source.review_id || source.review_id !== source.snapshot_decision_id
          || !source.review_source_sha256 || !source.page_stages || !source.actor_id
          || !source.basis_reference || !source.revision_status || !source.approval_status
          || !source.review_content_hash || !source.decision_hash
          || source.review_source_sha256.trim() !== sourceHash) return null;
        reviewHash = sha256(canonicalJson({
          objectApiId: source.object_api_id, sourceFileApiId: source.source_file_id,
          sourceSha256: sourceHash, revisionStatus: source.revision_status,
          approvalStatus: source.approval_status, linkGroupId: source.link_group_id,
          ...(source.section_code ? { sectionCode: source.section_code } : {}),
          pageStages: source.page_stages, basis: { reference: source.basis_reference },
          actorId: source.actor_id,
        }));
        if (reviewHash !== source.review_content_hash.trim()
          || reviewHash !== source.decision_hash.trim()) return null;
        sectionCode = source.section_code;
        sourceReviews[source.source_file_id] = {
          sourceSha256: sourceHash, revisionStatus: source.revision_status,
          approvalStatus: source.approval_status, linkGroupId: source.link_group_id,
          sectionCode: source.section_code,
          pageStages: source.page_stages, contentHash: reviewHash,
          decisionHash: reviewHash,
        };
      }
      sourceFiles.push({ sourceFileId: source.source_file_id, objectId,
        sha256: sourceHash, stages: source.stages, sourceReviewHash: reviewHash,
        sectionCode });
      if (source.content_json !== null) {
        const artifactHash = source.content_hash?.trim();
        const canonical = canonicalJson(source.content_json);
        if (!artifactHash || artifactHash !== sha256(canonical)
          || Number(source.byte_size) !== Buffer.byteLength(canonical, "utf8")) return null;
        textArtifacts[source.source_file_id] = {
          content_json: source.content_json, content_hash: artifactHash,
        };
      }
    }
    return { sourceFiles, sourceReviews, textArtifacts };
  }

  /** Rebuild the ZU-127 v3 selector inputs from the run's immutable DB snapshots. */
  private async loadAuthenticatedZu127GenericInputs(
    client: PoolClient, runId: string, objectId: string,
  ): Promise<{
    inputManifestHash: string;
    sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
      byteSize: number; pageCount: number; mediaType: string; stages: string[];
      sectionCode: string | null }>;
    sourceDecisions: Record<string, { sourceSha256: string; revisionStatus: string;
      approvalStatus: string; linkGroupId: string | null; sectionCode: string | null;
      pageStages: Record<string, string>; basis: { reference: string } }>;
    textArtifacts: Array<{ sourceFileId: string; contentSha256: string;
      artifact: Record<string, unknown> }>;
    pdfStorageRefs: Record<string, { storageKey: string; sha256: string; byteSize: number }>;
  } | null> {
    const scope = await client.query<{
      inspection_id: string; object_id: string; manifest_hash: string;
      manifest_json: Record<string, unknown>;
    }>(
      `SELECT run.inspection_id, run.object_id, manifest.sha256 AS manifest_hash,
              manifest.canonical_json AS manifest_json
       FROM analysis_runs run
       JOIN input_manifests manifest ON manifest.id = run.manifest_id
         AND manifest.inspection_id = run.inspection_id
       WHERE run.id = $1 AND run.object_id = $2`, [runId, objectId],
    );
    if (scope.rows.length !== 1) return null;
    const manifestHash = scope.rows[0].manifest_hash.trim();
    const manifestJson = parseJson<Record<string, unknown>>(scope.rows[0].manifest_json);
    if (!/^[a-f0-9]{64}$/u.test(manifestHash)
      || sha256(canonicalJson(manifestJson)) !== manifestHash) return null;
    const result = await client.query<{
      source_internal_id: string; source_file_id: string; source_object_id: string;
      object_api_id: string; blob_object_id: string; source_sha256: string;
      blob_sha256: string; blob_byte_size: number | string; blob_media_type: string;
      blob_scan_status: string; storage_key: string; inclusion_role: string;
      stages: string[] | null; snapshot_decision_id: string | null;
      snapshot_hash: string | null; review_id: string | null;
      review_object_id: string | null; review_source_file_id: string | null;
      review_source_sha256: string | null; revision_status: string | null;
      approval_status: string | null; link_group_id: string | null;
      section_code: string | null; page_stages: Record<string, string> | null;
      basis_reference: string | null; actor_id: string | null;
      review_content_hash: string | null; text_job_id: string | null;
      text_job_run_id: string | null; text_job_object_id: string | null;
      text_job_type: string | null; text_job_state: string | null;
      text_job_manifest_hash: string | null; text_job_release_id: string | null;
      run_release_id: string; text_artifact: Record<string, unknown> | null;
      text_hash: string | null; text_byte_size: number | string | null;
      text_input_sha256: string | null; text_page_count: number | null;
      text_schema_version: string | null;
    }>(
      `SELECT source.id AS source_internal_id, source.api_id AS source_file_id,
              source.object_id AS source_object_id, object.api_id AS object_api_id,
              blob.object_id AS blob_object_id, item.blob_sha256 AS source_sha256,
              blob.sha256 AS blob_sha256, blob.byte_size AS blob_byte_size,
              blob.media_type AS blob_media_type, blob.scan_status AS blob_scan_status,
              blob.storage_key, item.inclusion_role,
              (SELECT array_agg(stage.stage ORDER BY stage.stage)
               FROM source_file_stages stage WHERE stage.source_file_id = source.id) AS stages,
              snapshot.decision_id AS snapshot_decision_id,
              snapshot.decision_hash AS snapshot_hash,
              review.id AS review_id, review.object_id AS review_object_id,
              review.source_file_id AS review_source_file_id,
              review.source_sha256 AS review_source_sha256,
              review.revision_status, review.approval_status, review.link_group_id,
              review.section_code, review.page_stages, review.basis_reference,
              review.actor_id, review.content_hash AS review_content_hash,
              text.job_id AS text_job_id, text.content_json AS text_artifact,
              text.content_hash AS text_hash, text.byte_size AS text_byte_size,
              text.input_sha256 AS text_input_sha256, text.page_count AS text_page_count,
              text.schema_version AS text_schema_version,
              text_job.run_id AS text_job_run_id, text_job.object_id AS text_job_object_id,
              text_job.job_type AS text_job_type, text_job.state AS text_job_state,
              text_job.input_manifest_hash AS text_job_manifest_hash,
              text_job.release_id AS text_job_release_id,
              run.release_id AS run_release_id
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN manifest_items item ON item.manifest_id = run.manifest_id
       JOIN source_files source ON source.id = item.source_file_id
       JOIN blobs blob ON blob.id = source.blob_id
       LEFT JOIN run_source_review_snapshots snapshot
         ON snapshot.run_id = run.id AND snapshot.source_file_id = source.id
       LEFT JOIN source_review_decisions review ON review.id = snapshot.decision_id
       LEFT JOIN analysis_text_artifacts text
         ON text.run_id = run.id AND text.source_file_id = source.id
           AND text.schema_version = 'document-text-v2'
       LEFT JOIN analysis_jobs text_job ON text_job.id = text.job_id
       WHERE run.id = $1 AND run.object_id = $2
       ORDER BY source.api_id`, [runId, objectId],
    );
    if (result.rows.length < 1 || result.rows.length > 64) return null;
    const sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
      byteSize: number; pageCount: number; mediaType: string; stages: string[];
      sectionCode: string | null }> = [];
    const sourceDecisions: Record<string, { sourceSha256: string; revisionStatus: string;
      approvalStatus: string; linkGroupId: string | null; sectionCode: string | null;
      pageStages: Record<string, string>; basis: { reference: string } }> = {};
    const textArtifacts: Array<{ sourceFileId: string; contentSha256: string;
      artifact: Record<string, unknown> }> = [];
    const pdfStorageRefs: Record<string, { storageKey: string; sha256: string;
      byteSize: number }> = {};
    const manifestSources: Array<{ sourceFileId: string; sha256: string;
      stages: string[]; sourceReviewHash: string | null }> = [];
    const seenSources = new Set<string>();
    const seenHashes = new Set<string>();
    for (const row of result.rows) {
      const sourceId = row.source_file_id;
      const sourceHash = row.source_sha256.trim();
      const byteSize = Number(row.blob_byte_size);
      const pageCount = Number(row.text_page_count);
      if (seenSources.has(sourceId) || seenHashes.has(sourceHash)
        || row.source_object_id !== objectId || row.blob_object_id !== objectId
        || row.inclusion_role !== "SOURCE" || row.blob_sha256.trim() !== sourceHash
        || !/^[a-f0-9]{64}$/u.test(sourceHash)
        || !Number.isSafeInteger(byteSize) || byteSize < 5 || byteSize > 64 * 1024 * 1024
        || row.blob_media_type !== "application/pdf" || row.blob_scan_status !== "CLEAN"
        || !row.storage_key || !Array.isArray(row.stages) || row.stages.length < 1
        || row.stages.some((stage) => !["PD", "RD", "ID"].includes(stage))
        || new Set(row.stages).size !== row.stages.length
        || !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 2_000
        || row.text_schema_version !== "document-text-v2"
        || row.text_job_id === null || row.text_job_run_id !== runId
        || row.text_job_object_id !== objectId || row.text_job_type !== "DOCUMENT_TEXT_LAYER"
        || row.text_job_state !== "SUCCEEDED"
        || row.text_job_manifest_hash?.trim() !== manifestHash
        || row.text_job_release_id !== row.run_release_id
        || row.text_input_sha256?.trim() !== sourceHash
        || row.text_artifact === null || !row.text_hash) return null;
      seenSources.add(sourceId);
      seenHashes.add(sourceHash);
      const artifact = parseJson<Record<string, unknown>>(row.text_artifact);
      const artifactCanonical = canonicalJson(artifact);
      const artifactHash = row.text_hash.trim();
      if (artifact.schemaVersion !== "document-text-v2"
        || artifact.sourceFileId !== sourceId || artifact.inputSha256 !== sourceHash
        || artifact.pageCount !== pageCount
        || !Array.isArray(artifact.pages) || artifact.pages.length !== pageCount
        || sha256(artifactCanonical) !== artifactHash
        || Buffer.byteLength(artifactCanonical, "utf8") !== Number(row.text_byte_size)) return null;
      let reviewHash: string | null = null;
      let sectionCode: string | null = null;
      if (row.snapshot_decision_id !== null || row.snapshot_hash !== null) {
        if (!row.review_id || row.review_id !== row.snapshot_decision_id
          || row.review_object_id !== objectId
          || row.review_source_file_id !== row.source_internal_id
          || row.review_source_sha256?.trim() !== sourceHash
          || !row.revision_status || !row.approval_status
          || !row.page_stages || !row.basis_reference || !row.actor_id
          || !row.review_content_hash || !row.snapshot_hash) return null;
        reviewHash = sha256(canonicalJson({
          objectApiId: row.object_api_id, sourceFileApiId: sourceId,
          sourceSha256: sourceHash, revisionStatus: row.revision_status,
          approvalStatus: row.approval_status, linkGroupId: row.link_group_id,
          ...(row.section_code ? { sectionCode: row.section_code } : {}),
          pageStages: row.page_stages, basis: { reference: row.basis_reference },
          actorId: row.actor_id,
        }));
        if (row.review_content_hash.trim() !== reviewHash
          || row.snapshot_hash.trim() !== reviewHash) return null;
        sectionCode = row.section_code;
        sourceDecisions[sourceId] = {
          sourceSha256: sourceHash, revisionStatus: row.revision_status,
          approvalStatus: row.approval_status, linkGroupId: row.link_group_id,
          sectionCode, pageStages: row.page_stages,
          basis: { reference: row.basis_reference },
        };
      }
      sourceFiles.push({ sourceFileId: sourceId, objectId: row.object_api_id,
        sha256: sourceHash, byteSize, pageCount, mediaType: row.blob_media_type,
        stages: row.stages, sectionCode });
      textArtifacts.push({ sourceFileId: sourceId, contentSha256: artifactHash, artifact });
      pdfStorageRefs[sourceId] = { storageKey: row.storage_key, sha256: sourceHash,
        byteSize };
      manifestSources.push({ sourceFileId: sourceId, sha256: sourceHash,
        stages: row.stages, sourceReviewHash: reviewHash });
    }
    const expectedManifest = { inspectionId: scope.rows[0].inspection_id,
      sources: manifestSources };
    if (canonicalJson(manifestJson) !== canonicalJson(expectedManifest)) return null;
    return { inputManifestHash: manifestHash, sourceFiles, sourceDecisions,
      textArtifacts, pdfStorageRefs };
  }

  private async sealPilotPz002Run(
    client: PoolClient,
    run: { id: string; api_id: string; inspection_id: string; object_id: string },
  ): Promise<number> {
    const artifact = await client.query<{
      content_json: Record<string, unknown>;
      content_hash: string;
      byte_size: number | string;
      schema_version: string;
      provider_profile_id: string | null;
      provider_config_hash: string | null;
      input_manifest_hash: string;
    }>(
      `SELECT stage.content_json, stage.content_hash, stage.byte_size,
              stage.schema_version, stage.provider_profile_id,
              stage.provider_config_hash, stage.input_manifest_hash
       FROM analysis_stage_artifacts stage
       JOIN analysis_jobs job ON job.id = stage.job_id
       WHERE stage.run_id = $1 AND stage.job_type = 'RULE_EVALUATION'
         AND stage.schema_version = 'analysis-stage-result-v2'
         AND job.state = 'SUCCEEDED'`,
      [run.id],
    );
    const stage = artifact.rows[0];
    if (!stage || sha256(canonicalJson(stage.content_json)) !== stage.content_hash.trim()
      || Buffer.byteLength(canonicalJson(stage.content_json), "utf8") !== Number(stage.byte_size)
      || !isRecord(stage.content_json.analysis)
      || !isRecord(stage.content_json.analysis.evaluation)) {
      throw new Error("pilot release cannot seal without intact PZ-002 rule artifact");
    }
    const release = await client.query<{
      release_id: string; content_hash: string; byte_size: number | string;
      content_json: Record<string, unknown>; manifest_hash: string;
    }>(
      `SELECT release.release_id, release.content_hash, release.byte_size,
              release.content_json, manifest.sha256 AS manifest_hash
       FROM analysis_runs run
       JOIN analysis_releases release ON release.release_id = run.release_id
       JOIN input_manifests manifest ON manifest.id = run.manifest_id
       WHERE run.id = $1`, [run.id],
    );
    const pinned = release.rows[0];
    const ruleSlot = pinned && providerSlotForJob(pinned.content_json, "RULE_EVALUATION");
    if (!pinned || !ruleSlot || ruleSlot.status !== "CONFIGURED"
      || pinned.content_hash.trim() !== sha256(canonicalJson(pinned.content_json))
      || Number(pinned.byte_size) !== Buffer.byteLength(canonicalJson(pinned.content_json), "utf8")
      || pinned.content_json.releaseId !== pinned.release_id
      || stage.provider_profile_id !== ruleSlot.profileId
      || stage.provider_config_hash?.trim() !== ruleSlot.configHash
      || stage.input_manifest_hash.trim() !== pinned.manifest_hash.trim()
      || stage.content_json.providerProfileId !== ruleSlot.profileId
      || stage.content_json.providerConfigHash !== ruleSlot.configHash) {
      throw new Error("pilot release cannot seal a rule artifact outside its pinned release");
    }
    const hasCandidateOcrObservations = ruleSlot.profileId
      === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
      || isOcrTableProfile(ruleSlot.profileId);
    const hasOcrTableRows = isOcrTableProfile(ruleSlot.profileId);
    const hasCandidateObservations = ruleSlot.profileId
      === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
      || hasCandidateOcrObservations;
    const hasCandidatePreview = ruleSlot.profileId
      === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
      || hasCandidateObservations;
    const hasHeat = ruleSlot.profileId === "typed-pz002-pz017-v1"
      || ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-v1"
      || ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
      || hasCandidatePreview || ruleSlot.profileId === UNRESOLVED_FAMILY_OCR_PROFILE
      || ruleSlot.profileId === SITE_TEP_AREA_PROFILE
      || ruleSlot.profileId === SITE_GP_CONTEXT_PROFILE
      || ruleSlot.profileId === SITE_GP_TABLE_ROW_PROFILE
      || ruleSlot.profileId === EQUIPMENT_SPEC_PROFILE
      || ruleSlot.profileId === MATERIAL_CLASS_PROFILE
      || ruleSlot.profileId === UNRESOLVED_CONFIG_PROFILE
      || ruleSlot.profileId === UNRESOLVED_CONFIG_PROFILE_V2
      || ruleSlot.profileId === UNRESOLVED_CONFIG_PROFILE_V3
      || ruleSlot.profileId === LAYER_ASSEMBLY_PROFILE
      || ruleSlot.profileId === KR065_OPENING_PROFILE;
    const hasFactFamily = ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
      || hasCandidatePreview;
    const heat = hasHeat ? stage.content_json.heatLoad : null;
    if (hasHeat && !verifyPilotHeatAnalysis(
      heat, run.object_id, String(stage.content_json.inputManifestHash),
      await this.loadPilotCandidateSources(client, run.id),
    )) {
      throw new Error("pilot release cannot seal without intact PZ-017 rule artifact");
    }
    if (ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-v1"
      || ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
      || hasCandidatePreview) {
      const ocrInputs = await this.loadOcrHeatVerificationInputs(
        client, run.id, run.object_id, pinned.release_id, pinned.manifest_hash.trim(),
      );
      if (!ocrInputs || !validateOcrHeatRowProposals(
        stage.content_json.ocrHeatRows, ocrInputs.stage, ocrInputs.sourceReviews,
        ocrInputs.sourceFiles,
        pinned.manifest_hash.trim(),
      )) {
        throw new Error("pilot release cannot seal without intact OCR heat review aid");
      }
    } else if ("ocrHeatRows" in stage.content_json) {
      throw new Error("pilot release cannot seal OCR heat rows under an older release");
    }
    if (hasFactFamily) {
      const factInputs = hasPinnedFactFamilyRules(
        pinned.content_json, ruleSlot.configHash ?? "",
        hasCandidatePreview, hasCandidateObservations, hasCandidateOcrObservations,
        hasOcrTableRows ? ocrTableVersionForProfile(ruleSlot.profileId) : false,
        ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE)
        ? await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id) : null;
      const reviewedLinks = factInputs
        ? await this.loadReviewedFactEntityLinks(client, run.id, run.object_id) : null;
      if (stage.content_json.outputCount !== (ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE
        ? 9 : hasOcrTableRows ? 8 : hasCandidateOcrObservations ? 7
        : hasCandidateObservations ? 6 : hasCandidatePreview ? 5 : 4)
        || !factInputs || !reviewedLinks
        || !verifyFactFamilyProposals({
          objectId: run.object_id,
          inputManifestHash: pinned.manifest_hash.trim(),
          ...factInputs,
          result: stage.content_json.factFamily,
          rules: [...pilotPz002Pz017OcrHeatFactFamilyRules.factFamily.rules],
          entityLinks: verifiedReviewedFactEntityLinks(reviewedLinks, run.object_id,
            isRecord(stage.content_json.factFamily) ? stage.content_json.factFamily.facts : null,
            factInputs.sourceFiles, factInputs.sourceReviews),
      })) {
        throw new Error("pilot release cannot seal without intact fact family review aid");
      }
      if (hasCandidatePreview && !verifyCandidateFamilyPreview({
        objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
        ...factInputs, result: stage.content_json.candidateFamilyPreview,
      })) throw new Error("pilot release cannot seal without intact candidate family preview");
      if (hasCandidateObservations && !verifyCandidateFamilyObservations({
        objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
        ...factInputs, preview: stage.content_json.candidateFamilyPreview,
        result: stage.content_json.candidateFamilyObservations,
      })) throw new Error("pilot release cannot seal without intact candidate family observations");
      if ("reviewCandidates" in stage.content_json &&
        (!hasCandidateObservations || !verifyReviewCandidates({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...factInputs, result: stage.content_json.reviewCandidates,
        }))) throw new Error("pilot release cannot seal without intact review candidates");
      if (hasCandidateOcrObservations) {
        const ocrInputs = await this.loadOcrHeatVerificationInputs(
          client, run.id, run.object_id, pinned.release_id, pinned.manifest_hash.trim());
        if (!ocrInputs || !verifyCandidateFamilyOcrObservations({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...factInputs, preview: stage.content_json.candidateFamilyPreview,
          ocrStage: ocrInputs.stage,
          result: stage.content_json.candidateFamilyOcrObservations,
        })) throw new Error("pilot release cannot seal without intact candidate family OCR observations");
      }
      if (hasOcrTableRows) {
        const ocrInputs = await this.loadOcrHeatVerificationInputs(
          client, run.id, run.object_id, pinned.release_id, pinned.manifest_hash.trim());
        if (!ocrInputs || !verifyPinnedOcrTableRows(stage.content_json.ocrTableRows,
          ocrInputs.stage, pinned.manifest_hash.trim(), ruleSlot.profileId ?? "")) {
          throw new Error("pilot release cannot seal without intact OCR table rows");
        }
      }
      if (ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE
        && !verifyUnresolvedFamilyRunReview({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...factInputs, result: stage.content_json.unresolvedFamilyReview,
        })) throw new Error("pilot release cannot seal unresolved family review aid");
    } else if ("factFamily" in stage.content_json) {
      throw new Error("pilot release cannot seal fact family review under an older release");
    }
    if (!hasCandidatePreview && "candidateFamilyPreview" in stage.content_json) {
      throw new Error("pilot release cannot seal candidate preview under an older release");
    }
    if (!hasCandidateObservations && "candidateFamilyObservations" in stage.content_json) {
      throw new Error("pilot release cannot seal candidate observations under an older release");
    }
    if (!hasCandidateOcrObservations && "candidateFamilyOcrObservations" in stage.content_json) {
      throw new Error("pilot release cannot seal candidate OCR observations under an older release");
    }
    if (!hasOcrTableRows && "ocrTableRows" in stage.content_json) {
      throw new Error("pilot release cannot seal OCR table rows under an older release");
    }
    if (ruleSlot.profileId !== UNRESOLVED_FAMILY_PROFILE
      && "unresolvedFamilyReview" in stage.content_json) {
      throw new Error("pilot release cannot seal unresolved family aid under an older release");
    }
    if (ruleSlot.profileId === UNRESOLVED_FAMILY_OCR_PROFILE) {
      const rules = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const ocr = await this.loadVerifiedOcrV6Artifact(client, run.id, run.object_id);
      if (!ocr || canonicalJson(rules) !== canonicalJson(UNRESOLVED_FAMILY_OCR_RULES)
        || sha256(canonicalJson(UNRESOLVED_FAMILY_OCR_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifyUnresolvedFamilyOcrReview({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          expectedSources: ocr.sources, stage: ocr.stage, stageHash: ocr.stageHash,
          result: stage.content_json.unresolvedFamilyOcrReview,
        })) throw new Error("pilot release cannot seal unresolved family OCR review aid");
    } else if ("unresolvedFamilyOcrReview" in stage.content_json) {
      throw new Error("pilot release cannot seal OCR sidecar under an older release");
    }
    if (ruleSlot.profileId === SITE_TEP_AREA_PROFILE) {
      const definitions = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || canonicalJson(definitions) !== canonicalJson(SITE_TEP_AREA_RULES)
        || sha256(canonicalJson(SITE_TEP_AREA_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifySiteTepAreaReview({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...inputs, result: stage.content_json.siteTepAreaReview,
        })) throw new Error("pilot release cannot seal site TEP area review aid");
    } else if ("siteTepAreaReview" in stage.content_json) {
      throw new Error("pilot release cannot seal site TEP area aid under an older release");
    }
    if (ruleSlot.profileId === SITE_GP_CONTEXT_PROFILE) {
      const definitions = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || canonicalJson(definitions) !== canonicalJson(SITE_GP_CONTEXT_RULES)
        || sha256(canonicalJson(SITE_GP_CONTEXT_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifySiteGpContextReview({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...inputs, result: stage.content_json.siteGpContextReview,
        })) throw new Error("pilot release cannot seal site GP context review aid");
    } else if ("siteGpContextReview" in stage.content_json) {
      throw new Error("pilot release cannot seal site GP context aid under an older release");
    }
    if (ruleSlot.profileId === SITE_GP_TABLE_ROW_PROFILE) {
      const definitions = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || canonicalJson(definitions) !== canonicalJson(SITE_GP_TABLE_ROW_RULES)
        || sha256(canonicalJson(SITE_GP_TABLE_ROW_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifySiteGpTableRowReview({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...inputs, result: stage.content_json.siteGpTableRowReview,
        })) throw new Error("pilot release cannot seal site GP table row review aid");
    } else if ("siteGpTableRowReview" in stage.content_json) {
      throw new Error("pilot release cannot seal site GP table row aid under an older release");
    }
    if (ruleSlot.profileId === EQUIPMENT_SPEC_PROFILE) {
      const definitions = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || canonicalJson(definitions) !== canonicalJson(EQUIPMENT_SPEC_RULES)
        || sha256(canonicalJson(EQUIPMENT_SPEC_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifyEquipmentSpecReview({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...inputs, result: stage.content_json.equipmentSpecReview,
        })) throw new Error("pilot release cannot seal equipment spec review aid");
    } else if ("equipmentSpecReview" in stage.content_json) {
      throw new Error("pilot release cannot seal equipment spec aid under an older release");
    }
    if (ruleSlot.profileId === MATERIAL_CLASS_PROFILE) {
      const definitions = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || canonicalJson(definitions) !== canonicalJson(MATERIAL_CLASS_RULES)
        || sha256(canonicalJson(MATERIAL_CLASS_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifyMaterialClassReview({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...inputs, result: stage.content_json.materialClassReview,
        })) throw new Error("pilot release cannot seal material class review aid");
    } else if ("materialClassReview" in stage.content_json) {
      throw new Error("pilot release cannot seal material class aid under an older release");
    }
    if (ruleSlot.profileId === LAYER_ASSEMBLY_PROFILE) {
      const definitions = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || canonicalJson(definitions) !== canonicalJson(LAYER_ASSEMBLY_RULES)
        || sha256(canonicalJson(LAYER_ASSEMBLY_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifyLayerAssemblyProposals({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...inputs, result: stage.content_json.layerAssemblyReview,
        })) throw new Error("pilot release cannot seal layer assembly review aid");
    } else if ("layerAssemblyReview" in stage.content_json) {
      throw new Error("pilot release cannot seal layer assembly aid under an older release");
    }
    if (ruleSlot.profileId === KR065_OPENING_PROFILE) {
      const definitions = isRecord(pinned.content_json.rules)
        ? pinned.content_json.rules.definitions : null;
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || canonicalJson(definitions) !== canonicalJson(KR065_OPENING_RULES)
        || sha256(canonicalJson(KR065_OPENING_RULES)) !== ruleSlot.configHash
        || stage.content_json.outputCount !== 3
        || !verifyKr065OpeningProposals({
          objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
          ...inputs, result: stage.content_json.kr065OpeningReview,
        })) throw new Error("pilot release cannot seal KR-065 opening review aid");
    } else if ("kr065OpeningReview" in stage.content_json) {
      throw new Error("pilot release cannot seal KR-065 opening aid under an older release");
    }
    const unresolvedDescriptor = unresolvedConfigDescriptorFor(ruleSlot.profileId);
    if (unresolvedDescriptor) {
      const inputs = await this.loadFactFamilyVerificationInputs(client, run.id, run.object_id);
      if (!inputs || stage.content_json.outputCount !== 3
        || !verifyPinnedUnresolvedConfigReview(
          unresolvedDescriptor, pinned.content_json.rules, ruleSlot.configHash,
          { objectId: run.object_id, inputManifestHash: pinned.manifest_hash.trim(),
            ...inputs }, stage.content_json,
        )) throw new Error(unresolvedDescriptor.sealError);
    } else if (!hasOnlySelectedUnresolvedSidecar(stage.content_json, null)) {
      throw new Error("pilot release cannot seal unresolved config aid under an older release");
    }
    const evaluation = stage.content_json.analysis.evaluation;
    const reasonCode = String(evaluation.reasonCode);
    const machineStatus = String(evaluation.machineStatus) as "MISSING_EVIDENCE" | "NOT_COMPARABLE" | "CLARIFICATION_REQUIRED" | "CANDIDATE";
    if (!["MISSING_EVIDENCE", "NOT_COMPARABLE", "CLARIFICATION_REQUIRED", "CANDIDATE"].includes(machineStatus)) {
      throw new Error("pilot release cannot seal an unvalidated machine status");
    }
    const candidate = machineStatus === "CANDIDATE"
      ? verifyPilotPz002Candidate(
          stage.content_json.analysis,
          run.object_id,
          await this.loadPilotCandidateSources(client, run.id),
        )
      : null;
    if (machineStatus === "CANDIDATE" && !candidate) {
      throw new Error("pilot release cannot seal an unverifiable candidate");
    }
    const resultId = randomUUID();
    const resultApiId = `RSLT-${randomUUID()}`;
    const parameter = this.parameters.find((item) => item.parameter_code === "PZ-002");
    const resultPayload: Record<string, unknown> = candidate ? {
      groupId: "PZ", parameterId: parameter?.parameter_id ?? null, parameterCode: "PZ-002",
      title: "Расхождение общей площади здания", location: "Общая площадь здания",
      severity: "WARNING", criticality: "Проверить расхождение площади по ПД и РД",
      confidence: null, comparisonResult: "Площадь РД отличается от ПД более чем на 1%",
      documentStatus: "Требует проверки инспектором",
      expectedValue: candidate.expectedValue, actualValue: candidate.actualValue,
      idValue: null, rationale: "Порог превышен по двум подтверждённым текстовым источникам; решение остаётся за инспектором.",
      evidence: candidate.evidence,
    } : evaluation;
    await client.query(
      `INSERT INTO rule_results (
         id, api_id, run_id, rule_key, rule_version, parameter_code, entity_key,
         execution_status, machine_status, result_payload, evidence_fingerprint
       ) VALUES ($1, $2, $3, 'pilot-pz-002-area', '1', 'PZ-002', $4::jsonb,
                 'SUCCEEDED', $5, $6::jsonb, $7)`,
      [
        resultId, resultApiId, run.id,
        JSON.stringify({ key: typeof evaluation.entityKey === "string" ? evaluation.entityKey : "unresolved" }),
        machineStatus, JSON.stringify(resultPayload), candidate?.evidenceFingerprint ?? null,
      ],
    );
    if (candidate) {
      await client.query(
        `INSERT INTO review_items (
           api_id, inspection_id, run_id, result_id, origin, lifecycle,
           projection_status, evidence_fingerprint
         ) VALUES ($1, $2, $3, $4, 'MACHINE', 'ACTIVE', 'PENDING', $5)`,
        [`FND-${randomUUID()}`, run.inspection_id, run.id, resultId, candidate.evidenceFingerprint],
      );
    }
    if (hasHeat && isRecord(heat) && isRecord(heat.evaluation)) {
      await client.query(
        `INSERT INTO rule_results (
           id, api_id, run_id, rule_key, rule_version, parameter_code, entity_key,
           execution_status, machine_status, result_payload, evidence_fingerprint
         ) VALUES ($1, $2, $3, 'pilot-pz-017-heat', '1', 'PZ-017', $4::jsonb,
                   'SUCCEEDED', $5, $6::jsonb, NULL)`,
        [randomUUID(), `RSLT-${randomUUID()}`, run.id,
          JSON.stringify({ key: "building-total" }), heat.evaluation.machineStatus,
          JSON.stringify(heat)],
      );
    }
    const unsupportedReason = "Для параметра нет исполняемого правила в пилотном release.";
    const pilotReason = candidate
      ? "PZ-002: проверяемый кандидат по текстовому слою; решение инспектора ожидается."
      : `PZ-002: ${reasonCode}; предметный вывод требует проверки источников.`;
    const heatReason = hasHeat && isRecord(heat) && isRecord(heat.evaluation)
      ? `PZ-017: ${String(heat.evaluation.reasonCode)}; сравнение тепловой нагрузки требует проверки источников и состава компонентов.`
      : unsupportedReason;
    const factFamilyReason = "Извлечены исходные факты; пять сравнений требуют проверки контекста и связей объектов. Вывод инспектора отсутствует.";
    await client.query(
      `INSERT INTO parameter_coverage (
         run_id, parameter_id, parameter_code, parameter_name, execution_rollup, reason
       )
       SELECT $1, parameter_id, parameter_code, parameter_name,
              CASE WHEN parameter_code = 'PZ-002' OR ($7::boolean AND parameter_code = 'PZ-017')
                    OR ($9::boolean AND parameter_code IN ('PZ-004', 'PZ-007', 'KR-055', 'KR-058', 'KR-059'))
                   THEN 'PARTIAL' ELSE 'UNSUPPORTED' END,
              CASE WHEN parameter_code = 'PZ-002' THEN $5
                   WHEN $7::boolean AND parameter_code = 'PZ-017' THEN $8
                   WHEN $9::boolean AND parameter_code IN ('PZ-004', 'PZ-007', 'KR-055', 'KR-058', 'KR-059')
                     THEN $10 ELSE $6 END
       FROM unnest($2::integer[], $3::text[], $4::text[])
         AS coverage(parameter_id, parameter_code, parameter_name)
       ON CONFLICT (run_id, parameter_code) DO NOTHING`,
      [
        run.id,
        this.parameters.map((parameter) => parameter.parameter_id),
        this.parameters.map((parameter) => parameter.parameter_code),
        this.parameters.map((parameter) => parameter.parameter_name),
        pilotReason, unsupportedReason, hasHeat, heatReason,
        hasFactFamily, factFamilyReason,
      ],
    );
    const stats = {
      ...blankStats(this.parameters.length),
      unsupported: this.parameters.length - (hasHeat ? 2 : 1) - (hasFactFamily ? 5 : 0),
      candidates: candidate ? 1 : 0,
      clarification: (machineStatus === "CLARIFICATION_REQUIRED" ? 1 : 0)
        + (hasHeat && isRecord(heat) && isRecord(heat.evaluation)
          && heat.evaluation.machineStatus === "CLARIFICATION_REQUIRED" ? 1 : 0),
      notComparable: machineStatus === "NOT_COMPARABLE" ? 1 : 0,
    };
    const output = canonicalJson({
      checkId: run.api_id,
      pilotParameter: "PZ-002",
      pilotStatus: machineStatus,
      pilotReason,
      ...(hasHeat && isRecord(heat) && isRecord(heat.evaluation)
        ? { heatParameter: "PZ-017", heatStatus: heat.evaluation.machineStatus, heatReason }
        : {}),
      ...(hasFactFamily && isRecord(stage.content_json.factFamily)
        ? { factFamilyReviewAid: {
            parameterCodes: ["PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"],
            contentHash: stage.content_json.factFamily.contentHash,
            factCount: Array.isArray(stage.content_json.factFamily.facts)
              ? stage.content_json.factFamily.facts.length : 0,
          } } : {}),
      unsupportedParameters: this.parameters.filter((item) => item.parameter_code !== "PZ-002"
        && (!hasHeat || item.parameter_code !== "PZ-017")
        && (!hasFactFamily || !["PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"]
          .includes(item.parameter_code)))
        .map((item) => item.parameter_code),
    });
    const updatedRun = await client.query<{ event_version: number | string }>(
      `UPDATE analysis_runs
       SET run_state = 'PARTIAL', display_status = 'PARTIAL', progress = 100,
           current_stage = $4,
           stats = $1::jsonb, output_hash = $2, completed_at = now(), sealed_at = now(),
           event_version = event_version + 1
       WHERE id = $3 RETURNING event_version`,
      [JSON.stringify(stats), sha256(output), run.id,
        hasFactFamily ? "Пилот PZ-002/PZ-017 и пять групповых review-only правил выполнены"
          : hasHeat ? "Пилот PZ-002 и PZ-017 выполнен; остальные правила недоступны"
          : "Пилот PZ-002 выполнен; остальные правила недоступны"],
    );
    await client.query(
      `UPDATE objects SET display_status = 'PARTIAL', stats = $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(stats), run.object_id],
    );
    return Number(updatedRun.rows[0].event_version);
  }

  async getCheck(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<CheckRun>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<CheckRow>(
      `${checkSelect}
       WHERE object.organization_id = $1
         AND run.api_id = $2
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    return result.rows[0] ? mapCheck(result.rows[0]) : undefined;
  }

  async getFindings(checkId: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<Finding[]>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<FindingRow>(
      `${findingSelect}
       WHERE object.organization_id = $1
         AND run.api_id = $2
         AND item.lifecycle = 'ACTIVE'
         AND result.execution_status = 'SUCCEEDED'
         AND result.machine_status IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )
       ORDER BY item.created_at, item.id`,
      [this.organizationId, checkId, actor.userId],
    );
    return result.rows.map(mapFinding);
  }

  async getPilotResults(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Promise<PilotResultsScopedRead> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<{
      run_id: string;
      object_id: string;
      run_state: string;
      can_read: boolean;
      release_content: Record<string, unknown> | null;
      release_schema_version: string | null;
      release_text: string | null;
      release_content_hash: string | null;
      release_byte_size: number | string | null;
      manifest_hash: string | null;
      heat_stage: PersistedOcrHeatRowsStage | null;
      heat_stage_count: string | null;
      api_id: string | null;
      parameter_code: PersistedPilotResultRow["parameter_code"] | null;
      rule_key: string | null;
      rule_version: string | null;
      execution_status: string | null;
      machine_status: string | null;
      result_payload: Record<string, unknown> | null;
    }>(
      `SELECT run.id AS run_id, run.object_id, run.run_state,
              EXISTS (
                SELECT 1 FROM object_memberships access
                WHERE access.object_id = object.id AND access.user_id = $3
                  AND access.revoked_at IS NULL
                  AND access.permission_set @> ARRAY['READ']::text[]
              ) AS can_read,
              release.content_json AS release_content,
              release.schema_version AS release_schema_version,
              release.content_json::text AS release_text,
              release.content_hash AS release_content_hash,
              release.byte_size AS release_byte_size,
              manifest.sha256 AS manifest_hash,
              heat_stage.stage AS heat_stage, heat_stage.stage_count AS heat_stage_count,
              result.api_id, result.parameter_code, result.rule_key, result.rule_version,
              result.execution_status, result.machine_status, result.result_payload
       FROM analysis_runs run
       JOIN inspections inspection ON inspection.id = run.inspection_id
         AND inspection.active_run_id = run.id
       JOIN objects object ON object.id = run.object_id
       LEFT JOIN analysis_releases release ON release.release_id = run.release_id
       LEFT JOIN input_manifests manifest ON manifest.id = run.manifest_id
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'content_json', stage.content_json, 'content_hash', stage.content_hash,
           'byte_size', stage.byte_size, 'schema_version', stage.schema_version,
           'disposition', stage.disposition, 'provider_profile_id', stage.provider_profile_id,
           'provider_config_hash', stage.provider_config_hash,
           'input_manifest_hash', stage.input_manifest_hash,
           'output_count', stage.output_count, 'job_state', job.state
         ) AS stage, COUNT(*) OVER() AS stage_count
         FROM analysis_stage_artifacts stage
         JOIN analysis_jobs job ON job.id = stage.job_id
         WHERE stage.run_id = run.id AND stage.job_type = 'RULE_EVALUATION'
           AND stage.provider_profile_id IN (
             'typed-pz002-pz017-ocr-heat-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v2',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3-unresolved-review-v1',
             'typed-pz002-pz017-ocr-v6-unresolved-family-review-v1',
             'typed-pz002-pz017-site-tep-area-review-v1',
             'typed-pz002-pz017-site-gp-context-review-v1',
             'typed-pz002-pz017-site-gp-table-row-review-v1',
             'typed-pz002-pz017-equipment-spec-review-v1',
             'typed-pz002-pz017-material-class-review-v1',
             'typed-pz002-pz017-unresolved-config-review-v1',
             'typed-pz002-pz017-unresolved-config-review-v2',
             'typed-pz002-pz017-unresolved-config-review-v3',
             'typed-pz002-pz017-layer-assembly-review-v1',
             'typed-pz002-pz017-kr065-opening-review-v1'
           )
         ORDER BY stage.id LIMIT 1
       ) heat_stage ON TRUE
       LEFT JOIN LATERAL (
         SELECT candidate.api_id, candidate.parameter_code, candidate.rule_key,
                candidate.rule_version, candidate.execution_status, candidate.machine_status,
                candidate.result_payload
         FROM rule_results candidate
         WHERE candidate.run_id = run.id
           AND candidate.parameter_code IN ('PZ-002', 'PZ-017')
           AND candidate.rule_key IN ('pilot-pz-002-area', 'pilot-pz-017-heat')
         ORDER BY candidate.parameter_code, candidate.api_id
         LIMIT 3
       ) result ON TRUE
       WHERE object.organization_id = $1 AND run.api_id = $2
       ORDER BY result.parameter_code NULLS LAST, result.api_id`,
      [this.organizationId, checkId, actor.userId],
    );
    const scope = result.rows[0];
    if (!scope) return undefined;
    if (!scope.can_read) return "FORBIDDEN";
    if (scope.run_state === "FAILED" || scope.run_state === "CANCELLED") {
      return { checkId, status: scope.run_state, items: [], ocrHeatRows: null };
    }
    if (scope.run_state !== "PARTIAL" && scope.run_state !== "SUCCEEDED") {
      return { checkId, status: "PROCESSING", items: [], ocrHeatRows: null };
    }
    const rows = result.rows.filter((row) => row.api_id !== null);
    if (rows.length > 2) throw new Error("Duplicate persisted pilot rule results");
    let ocrHeatRows = null;
    if (!scope.release_content || !scope.release_content_hash || !scope.release_byte_size) {
      throw new Error("Pilot release integrity check failed");
    }
    if (scope.release_content.schemaVersion !== scope.release_schema_version
      || !["analysis-release-legacy-v1", "analysis-release-v1"]
        .includes(String(scope.release_schema_version))) {
      throw new Error("Pilot release schema mismatch");
    }
    // Migration 012 hashed PostgreSQL's JSONB text form for legacy releases.
    // Later releases hash the application's canonical JSON representation.
    const releaseBytes = scope.release_schema_version === "analysis-release-legacy-v1"
      ? scope.release_text : canonicalJson(scope.release_content);
    if (!releaseBytes || sha256(releaseBytes) !== scope.release_content_hash.trim()
      || Buffer.byteLength(releaseBytes, "utf8") !== Number(scope.release_byte_size)) {
      throw new Error("Pilot release integrity check failed");
    }
    if (scope.release_schema_version === "analysis-release-legacy-v1") {
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null };
    }
    if (!scope.manifest_hash) throw new Error("Pilot release manifest missing");
    const ruleSlot = providerSlotForJob(scope.release_content, "RULE_EVALUATION");
    const unresolvedDescriptor = unresolvedConfigDescriptorFor(ruleSlot?.profileId);
    const unresolvedStage = scope.heat_stage;
    const unresolvedContent = unresolvedStage && isRecord(unresolvedStage.content_json)
      ? unresolvedStage.content_json : null;
    if (unresolvedContent
      && !hasOnlySelectedUnresolvedSidecar(unresolvedContent, unresolvedDescriptor)) {
      throw new Error("Unresolved config review profile boundary failed");
    }
    if (unresolvedContent && ruleSlot?.profileId !== LAYER_ASSEMBLY_PROFILE
      && "layerAssemblyReview" in unresolvedContent) {
      throw new Error("Layer assembly review profile boundary failed");
    }
    if (unresolvedContent && ruleSlot?.profileId !== KR065_OPENING_PROFILE
      && "kr065OpeningReview" in unresolvedContent) {
      throw new Error("KR-065 opening review profile boundary failed");
    }
    if (unresolvedDescriptor) {
      const stage = unresolvedStage;
      const content = unresolvedContent;
      if (ruleSlot?.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || stage.provider_profile_id !== unresolvedDescriptor.profileId
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error(unresolvedDescriptor.readStageError);
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifyPinnedUnresolvedConfigReview(
          unresolvedDescriptor, scope.release_content.rules, ruleSlot.configHash,
          { objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
            ...inputs }, content,
        )) throw new Error(unresolvedDescriptor.readAidError);
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null,
        [unresolvedDescriptor.sidecarKey]: content[unresolvedDescriptor.sidecarKey],
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === LAYER_ASSEMBLY_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const definitions = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(definitions) !== canonicalJson(LAYER_ASSEMBLY_RULES)
        || sha256(canonicalJson(LAYER_ASSEMBLY_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== LAYER_ASSEMBLY_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("Layer assembly rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifyLayerAssemblyProposals({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          ...inputs, result: content.layerAssemblyReview,
        })) throw new Error("Layer assembly review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null, layerAssemblyReview: content.layerAssemblyReview,
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === KR065_OPENING_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const definitions = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(definitions) !== canonicalJson(KR065_OPENING_RULES)
        || sha256(canonicalJson(KR065_OPENING_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== KR065_OPENING_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("KR-065 opening rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifyKr065OpeningProposals({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          ...inputs, result: content.kr065OpeningReview,
        })) throw new Error("KR-065 opening review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null, kr065OpeningReview: content.kr065OpeningReview,
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === MATERIAL_CLASS_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const definitions = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(definitions) !== canonicalJson(MATERIAL_CLASS_RULES)
        || sha256(canonicalJson(MATERIAL_CLASS_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== MATERIAL_CLASS_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("Material class rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifyMaterialClassReview({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          ...inputs, result: content.materialClassReview,
        })) throw new Error("Material class review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null, materialClassReview: content.materialClassReview,
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === EQUIPMENT_SPEC_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const definitions = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(definitions) !== canonicalJson(EQUIPMENT_SPEC_RULES)
        || sha256(canonicalJson(EQUIPMENT_SPEC_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== EQUIPMENT_SPEC_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("Equipment spec rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifyEquipmentSpecReview({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          ...inputs, result: content.equipmentSpecReview,
        })) throw new Error("Equipment spec review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null, equipmentSpecReview: content.equipmentSpecReview,
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === SITE_GP_TABLE_ROW_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const definitions = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(definitions) !== canonicalJson(SITE_GP_TABLE_ROW_RULES)
        || sha256(canonicalJson(SITE_GP_TABLE_ROW_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== SITE_GP_TABLE_ROW_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("Site GP table row rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifySiteGpTableRowReview({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          ...inputs, result: content.siteGpTableRowReview,
        })) throw new Error("Site GP table row review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null, siteGpTableRowReview: content.siteGpTableRowReview,
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === SITE_GP_CONTEXT_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const definitions = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(definitions) !== canonicalJson(SITE_GP_CONTEXT_RULES)
        || sha256(canonicalJson(SITE_GP_CONTEXT_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== SITE_GP_CONTEXT_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("Site GP context rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifySiteGpContextReview({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          ...inputs, result: content.siteGpContextReview,
        })) throw new Error("Site GP context review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null, siteGpContextReview: content.siteGpContextReview,
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === SITE_TEP_AREA_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const definitions = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(definitions) !== canonicalJson(SITE_TEP_AREA_RULES)
        || sha256(canonicalJson(SITE_TEP_AREA_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== SITE_TEP_AREA_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("Site TEP area rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const inputs = await this.loadFactFamilyVerificationInputs(
          client, scope.run_id, scope.object_id);
        if (!inputs || !verifySiteTepAreaReview({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          ...inputs, result: content.siteTepAreaReview,
        })) throw new Error("Site TEP area review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null, siteTepAreaReview: content.siteTepAreaReview,
      } as PilotResultsScopedRead;
    }
    if (ruleSlot?.profileId === UNRESOLVED_FAMILY_OCR_PROFILE) {
      const stage = scope.heat_stage;
      const content = stage && isRecord(stage.content_json) ? stage.content_json : null;
      const rules = isRecord(scope.release_content.rules)
        ? scope.release_content.rules.definitions : null;
      if (ruleSlot.status !== "CONFIGURED" || !stage || !content
        || Number(scope.heat_stage_count) !== 1
        || canonicalJson(rules) !== canonicalJson(UNRESOLVED_FAMILY_OCR_RULES)
        || sha256(canonicalJson(UNRESOLVED_FAMILY_OCR_RULES)) !== ruleSlot.configHash
        || stage.provider_profile_id !== UNRESOLVED_FAMILY_OCR_PROFILE
        || stage.provider_config_hash !== ruleSlot.configHash
        || stage.job_state !== "SUCCEEDED"
        || stage.schema_version !== "analysis-stage-result-v2"
        || stage.disposition !== "RULES_EVALUATED"
        || stage.input_manifest_hash !== scope.manifest_hash.trim()
        || stage.output_count !== 3 || content.outputCount !== 3
        || content.providerProfileId !== ruleSlot.profileId
        || content.providerConfigHash !== ruleSlot.configHash
        || content.inputManifestHash !== scope.manifest_hash.trim()
        || sha256(canonicalJson(content)) !== stage.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(stage.byte_size)) {
        throw new Error("Unresolved family OCR rule stage integrity check failed");
      }
      const client = await this.pool.connect();
      try {
        const ocr = await this.loadVerifiedOcrV6Artifact(client, scope.run_id, scope.object_id);
        if (!ocr || !verifyUnresolvedFamilyOcrReview({
          objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
          expectedSources: ocr.sources, stage: ocr.stage, stageHash: ocr.stageHash,
          result: content.unresolvedFamilyOcrReview,
        })) throw new Error("Unresolved family OCR review aid integrity check failed");
      } finally {
        client.release();
      }
      return { checkId, status: "READY",
        items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)),
        ocrHeatRows: null,
        unresolvedFamilyOcrReview: content.unresolvedFamilyOcrReview,
      } as PilotResultsScopedRead;
    }
    let factFamily = null;
    let candidateFamilyPreview = null;
    let candidateFamilyObservations = null;
    let reviewCandidates = null;
    let candidateFamilyOcrObservations = null;
    let ocrTableRows: OcrTableRowsRead | null = null;
    let unresolvedFamilyReview = null;
    const candidateOcrProfile = ruleSlot?.profileId
      === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1"
      || isOcrTableProfile(ruleSlot?.profileId);
    const ocrTableProfile = isOcrTableProfile(ruleSlot?.profileId);
    const candidateObservationsProfile = ruleSlot?.profileId
      === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1"
      || candidateOcrProfile;
    const candidatePreviewProfile = ruleSlot?.profileId
      === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
      || candidateObservationsProfile;
    if (ruleSlot?.profileId === "typed-pz002-pz017-ocr-heat-v1"
      || ruleSlot?.profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
      || candidatePreviewProfile) {
      if (ruleSlot.status !== "CONFIGURED" || !ruleSlot.configHash
        || !scope.heat_stage || Number(scope.heat_stage_count) !== 1) {
        throw new Error("OCR heat stage missing or duplicated");
      }
      ocrHeatRows = projectOcrHeatRowsRead({ ...scope.heat_stage,
        content_hash: scope.heat_stage.content_hash.trim(),
        provider_config_hash: scope.heat_stage.provider_config_hash.trim(),
        input_manifest_hash: scope.heat_stage.input_manifest_hash.trim(),
      }, scope.manifest_hash.trim(), ruleSlot.configHash);
      if (ruleSlot.profileId === "typed-pz002-pz017-ocr-heat-fact-family-v1"
        || candidatePreviewProfile) {
        if (!hasPinnedFactFamilyRules(scope.release_content, ruleSlot.configHash,
          candidatePreviewProfile, candidateObservationsProfile, candidateOcrProfile,
          ocrTableProfile ? ocrTableVersionForProfile(ruleSlot.profileId) : false,
          ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE)) {
          throw new Error("Fact family release integrity check failed");
        }
        factFamily = projectFactFamilyRead({ ...scope.heat_stage,
          content_hash: scope.heat_stage.content_hash.trim(),
          provider_config_hash: scope.heat_stage.provider_config_hash.trim(),
          input_manifest_hash: scope.heat_stage.input_manifest_hash.trim(),
        }, scope.manifest_hash.trim(), ruleSlot.configHash);
        const client = await this.pool.connect();
        try {
          const factInputs = await this.loadFactFamilyVerificationInputs(
            client, scope.run_id, scope.object_id);
          const reviewedLinks = factInputs
            ? await this.loadReviewedFactEntityLinks(client, scope.run_id, scope.object_id) : null;
          if (!factInputs || !reviewedLinks || !verifyFactFamilyProposals({
            objectId: scope.object_id,
            inputManifestHash: scope.manifest_hash.trim(),
            ...factInputs, result: factFamily,
            rules: [...pilotPz002Pz017OcrHeatFactFamilyRules.factFamily.rules],
            entityLinks: verifiedReviewedFactEntityLinks(reviewedLinks, scope.object_id,
              factFamily.facts, factInputs.sourceFiles, factInputs.sourceReviews),
          })) throw new Error("Fact family review aid integrity check failed");
          if (candidatePreviewProfile) {
            candidateFamilyPreview = projectCandidateFamilyPreviewRead({ ...scope.heat_stage,
              content_hash: scope.heat_stage.content_hash.trim(),
              provider_config_hash: scope.heat_stage.provider_config_hash.trim(),
              input_manifest_hash: scope.heat_stage.input_manifest_hash.trim(),
            }, scope.manifest_hash.trim(), ruleSlot.configHash);
            if (!verifyCandidateFamilyPreview({
              objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
              ...factInputs, result: candidateFamilyPreview,
            })) throw new Error("Candidate family preview integrity check failed");
            if (candidateObservationsProfile) {
              candidateFamilyObservations = projectCandidateFamilyObservationsRead({ ...scope.heat_stage,
                content_hash: scope.heat_stage.content_hash.trim(),
                provider_config_hash: scope.heat_stage.provider_config_hash.trim(),
                input_manifest_hash: scope.heat_stage.input_manifest_hash.trim(),
              }, scope.manifest_hash.trim(), ruleSlot.configHash);
              if (!verifyCandidateFamilyObservations({
                objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
                ...factInputs, preview: candidateFamilyPreview,
                result: candidateFamilyObservations,
              })) throw new Error("Candidate family observations integrity check failed");
              if (isRecord(scope.heat_stage.content_json)
                && isRecord(scope.heat_stage.content_json.reviewCandidates)) {
                reviewCandidates = scope.heat_stage.content_json.reviewCandidates;
                if (!verifyReviewCandidates({
                  objectId: scope.object_id, inputManifestHash: scope.manifest_hash.trim(),
                  ...factInputs, result: reviewCandidates,
                })) throw new Error("Review candidates integrity check failed");
              }
              if (candidateOcrProfile) {
                const releaseId = scope.release_content.releaseId;
                const ocrInputs = typeof releaseId === "string"
                  ? await this.loadOcrHeatVerificationInputs(client, scope.run_id,
                    scope.object_id, releaseId, scope.manifest_hash.trim()) : null;
                candidateFamilyOcrObservations = projectCandidateFamilyOcrObservationsRead({
                  ...scope.heat_stage,
                  content_hash: scope.heat_stage.content_hash.trim(),
                  provider_config_hash: scope.heat_stage.provider_config_hash.trim(),
                  input_manifest_hash: scope.heat_stage.input_manifest_hash.trim(),
                }, scope.manifest_hash.trim(), ruleSlot.configHash);
                if (!ocrInputs || !verifyCandidateFamilyOcrObservations({
                  objectId: scope.object_id,
                  inputManifestHash: scope.manifest_hash.trim(),
                  ...factInputs, preview: candidateFamilyPreview,
                  ocrStage: ocrInputs.stage,
                  result: candidateFamilyOcrObservations,
                })) throw new Error("Candidate family OCR observations integrity check failed");
                if (ocrTableProfile) {
                  const ruleContent = scope.heat_stage.content_json;
                  if (!isRecord(ruleContent) || !isRecord(ruleContent.ocrTableRows)
                    || !verifyPinnedOcrTableRows(ruleContent.ocrTableRows,
                      ocrInputs.stage, scope.manifest_hash.trim(), ruleSlot.profileId ?? "")) {
                    throw new Error("OCR table rows integrity check failed");
                  }
                  ocrTableRows = projectOcrTableRowsRead(ruleContent.ocrTableRows);
                  if (ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE) {
                    unresolvedFamilyReview = projectUnresolvedFamilyReviewRead({
                      ...scope.heat_stage,
                      content_hash: scope.heat_stage.content_hash.trim(),
                      provider_config_hash: scope.heat_stage.provider_config_hash.trim(),
                      input_manifest_hash: scope.heat_stage.input_manifest_hash.trim(),
                    }, scope.manifest_hash.trim(), ruleSlot.configHash);
                    if (!verifyUnresolvedFamilyRunReview({
                      objectId: scope.object_id,
                      inputManifestHash: scope.manifest_hash.trim(),
                      ...factInputs, result: unresolvedFamilyReview,
                    })) throw new Error("Unresolved family review aid integrity check failed");
                  }
                }
              }
            }
          }
        } finally {
          client.release();
        }
      }
    }
    return { checkId, status: "READY",
      items: rows.map((row) => projectPilotRuleResult(row as PersistedPilotResultRow)), ocrHeatRows,
      ...(factFamily ? { factFamily } : {}),
      ...(candidateFamilyPreview ? { candidateFamilyPreview } : {}),
      ...(candidateFamilyObservations ? { candidateFamilyObservations } : {}),
      ...(reviewCandidates ? { reviewCandidates: reviewCandidates as unknown as import("./repository.js").ReviewCandidatesRead } : {}),
      ...(candidateFamilyOcrObservations ? { candidateFamilyOcrObservations } : {}),
      ...(ocrTableRows ? { ocrTableRows } : {}),
      ...(unresolvedFamilyReview ? { unresolvedFamilyReview } : {}) };
  }

  private async verifyOcrTranscriptionDecision(
    client: PoolClient, row: OcrTranscriptionDecisionRow, objectApiId: string,
    contexts: Map<string, OcrTranscriptionContext>,
  ): Promise<{ review: OcrRowTranscriptionReviewInput;
    provenance: OcrRowTranscriptionReview["provenance"] }> {
    let context = contexts.get(row.run_id);
    if (!context) {
      const loaded = await this.loadOcrRowTranscriptionContext(
        client, row.run_id, row.object_id, row.origin_release_id,
        row.origin_manifest_hash.trim());
      if (!loaded) throw new Error("OCR transcription origin stage integrity check failed");
      context = loaded;
      contexts.set(row.run_id, context);
    }
    const stored = parseJson<Record<string, unknown>>(row.review_json);
    const validated = validateOcrRowTranscriptionReview(
      stored.review, context.tableRows, context.ocrStage,
      row.origin_manifest_hash.trim());
    const source = validated && context.sources.get(validated.provenance.sourceFileId);
    if (!validated || !source
      || canonicalJson(stored) !== canonicalJson(validated)
      || row.ocr_stage_artifact_id !== context.ocrArtifactId
      || row.rule_stage_artifact_id !== context.ruleArtifactId
      || row.source_file_id !== source.id
      || row.source_sha256.trim() !== source.sha256
      || row.row_fingerprint_sha256.trim() !== validated.provenance.rowFingerprint
      || sha256(canonicalJson({ checkId: row.origin_run_api_id,
        objectId: objectApiId, ...validated, actorId: row.actor_id }))
        !== row.content_hash.trim()) {
      throw new Error("OCR transcription decision integrity check failed");
    }
    return validated;
  }

  private async snapshotOcrTranscriptionDecisions(
    client: PoolClient, targetRunId: string, objectId: string,
    objectApiId: string,
    sources: Array<{ id: string; sha256: string }>,
  ): Promise<void> {
    if (sources.length === 0) return;
    const latest = await client.query<OcrTranscriptionDecisionRow>(
      `SELECT DISTINCT ON (decision.source_file_id, decision.row_fingerprint_sha256)
              decision.*, origin.api_id AS origin_run_api_id,
              manifest.sha256 AS origin_manifest_hash,
              origin.release_id AS origin_release_id
       FROM ocr_row_transcription_decisions decision
       JOIN analysis_runs origin ON origin.id = decision.run_id
         AND origin.object_id = decision.object_id
       JOIN input_manifests manifest ON manifest.id = origin.manifest_id
       WHERE decision.object_id = $1 AND decision.source_file_id = ANY($2::uuid[])
       ORDER BY decision.source_file_id, decision.row_fingerprint_sha256,
                decision.created_at DESC, decision.id DESC`,
      [objectId, sources.map((source) => source.id)],
    );
    const current = new Map(sources.map((source) => [source.id, source.sha256.trim()]));
    const contexts = new Map<string, OcrTranscriptionContext>();
    for (const row of latest.rows) {
      const currentSha = current.get(row.source_file_id);
      if (!currentSha) throw new Error("OCR transcription source outside run manifest");
      // A newer revision of the source invalidates every decision for the old bytes.
      // Never fall back to an older confirmation when the latest decision is rejected.
      if (row.source_sha256.trim() !== currentSha) continue;
      const validated = await this.verifyOcrTranscriptionDecision(
        client, row, objectApiId, contexts);
      if (validated.provenance.sourceSha256 !== currentSha) {
        throw new Error("OCR transcription source SHA mismatch");
      }
      await client.query(
        `INSERT INTO run_ocr_transcription_snapshots (
           run_id, object_id, source_file_id, source_sha256,
           row_fingerprint_sha256, decision_id, decision_content_hash,
           origin_run_id, ocr_stage_artifact_id, rule_stage_artifact_id,
           review_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [targetRunId, objectId, row.source_file_id, currentSha,
          row.row_fingerprint_sha256.trim(), row.id, row.content_hash.trim(),
          row.run_id, row.ocr_stage_artifact_id, row.rule_stage_artifact_id,
          canonicalJson(validated)],
      );
    }
  }

  private async loadOcrRowTranscriptionContext(
    client: PoolClient, runId: string, objectId: string, releaseId: string,
    manifestHash: string,
  ): Promise<{ ocrArtifactId: string; ruleArtifactId: string;
    ocrStage: OcrHeatStageEnvelope; tableRows: Record<string, unknown>;
    sources: Map<string, { id: string; sha256: string }> } | null> {
    const ocrInputs = await this.loadOcrHeatVerificationInputs(
      client, runId, objectId, releaseId, manifestHash);
    if (!ocrInputs || ![boundedOcrProfileIdV4, boundedOcrProfileIdV5]
      .includes(ocrInputs.stage.provider_profile_id as typeof boundedOcrProfileIdV4)) return null;
    const stages = await client.query<{
      id: string; job_type: string; provider_profile_id: string;
      provider_config_hash: string; schema_version: string; disposition: string;
      output_count: number;
      content_json: Record<string, unknown>; content_hash: string;
      byte_size: number | string; input_manifest_hash: string;
      job_state: string; job_release_id: string; job_manifest_hash: string;
    }>(
      `SELECT stage.id, stage.job_type, stage.provider_profile_id,
              stage.provider_config_hash, stage.schema_version, stage.disposition,
              stage.output_count,
              stage.content_json, stage.content_hash, stage.byte_size,
              stage.input_manifest_hash, job.state AS job_state,
              job.release_id AS job_release_id,
              job.input_manifest_hash AS job_manifest_hash
       FROM analysis_stage_artifacts stage
       JOIN analysis_jobs job ON job.id = stage.job_id
         AND job.run_id = stage.run_id AND job.job_type = stage.job_type
       WHERE stage.run_id = $1 AND stage.job_type IN ('DOCUMENT_OCR_LAYOUT', 'RULE_EVALUATION')`,
      [runId],
    );
    const ocr = stages.rows.filter((row) => row.job_type === "DOCUMENT_OCR_LAYOUT");
    const rules = stages.rows.filter((row) => row.job_type === "RULE_EVALUATION");
    if (ocr.length !== 1 || rules.length !== 1) return null;
    const release = await client.query<{ content_json: Record<string, unknown>;
      content_hash: string; byte_size: number | string }>(
      `SELECT content_json, content_hash, byte_size
       FROM analysis_releases WHERE release_id = $1`, [releaseId]);
    const releaseRow = release.rows[0];
    if (!releaseRow || sha256(canonicalJson(releaseRow.content_json))
      !== releaseRow.content_hash.trim()
      || Number(releaseRow.byte_size) !== Buffer.byteLength(
        canonicalJson(releaseRow.content_json), "utf8")) return null;
    const ruleSlot = providerSlotForJob(releaseRow.content_json, "RULE_EVALUATION");
    if (ruleSlot?.status !== "CONFIGURED" || !isOcrTableProfile(ruleSlot.profileId)
      || !ruleSlot.configHash || !hasPinnedFactFamilyRules(
        releaseRow.content_json, ruleSlot.configHash, true, true, true,
        ocrTableVersionForProfile(ruleSlot.profileId),
        ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE)) return null;
    const validStage = (row: typeof ocr[number]) => {
      const content = parseJson<Record<string, unknown>>(row.content_json);
      const canonical = canonicalJson(content);
      return row.job_state === "SUCCEEDED" && row.job_release_id === releaseId
        && row.job_manifest_hash.trim() === manifestHash
        && row.input_manifest_hash.trim() === manifestHash
        && row.content_hash.trim() === sha256(canonical)
        && Number(row.byte_size) === Buffer.byteLength(canonical, "utf8");
    };
    if (!validStage(ocr[0]) || !validStage(rules[0])
      || ocr[0].content_hash.trim() !== ocrInputs.stage.content_hash
      || rules[0].provider_profile_id !== ruleSlot.profileId
      || rules[0].provider_config_hash.trim() !== ruleSlot.configHash
      || rules[0].schema_version !== "analysis-stage-result-v2"
      || rules[0].disposition !== "RULES_EVALUATED"
      || rules[0].output_count !== (ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE ? 9 : 8)
      || rules[0].content_json.outputCount !== (ruleSlot.profileId === UNRESOLVED_FAMILY_PROFILE ? 9 : 8)
      || !isRecord(rules[0].content_json.ocrTableRows)
      || !verifyPinnedOcrTableRows(rules[0].content_json.ocrTableRows,
        ocrInputs.stage, manifestHash, ruleSlot.profileId)) return null;
    const sourceRows = await client.query<{
      id: string; api_id: string; blob_sha256: string; actual_sha256: string;
    }>(
      `SELECT source.id, source.api_id, item.blob_sha256,
              blob.sha256 AS actual_sha256
       FROM analysis_runs run
       JOIN manifest_items item ON item.manifest_id = run.manifest_id
       JOIN source_files source ON source.id = item.source_file_id
         AND source.object_id = run.object_id
       JOIN blobs blob ON blob.id = source.blob_id
       WHERE run.id = $1 AND run.object_id = $2`,
      [runId, objectId],
    );
    const sources = new Map<string, { id: string; sha256: string }>();
    for (const row of sourceRows.rows) {
      const hash = row.blob_sha256.trim();
      if (sources.has(row.api_id) || hash !== row.actual_sha256.trim()) return null;
      sources.set(row.api_id, { id: row.id, sha256: hash });
    }
    return { ocrArtifactId: ocr[0].id, ruleArtifactId: rules[0].id,
      ocrStage: ocrInputs.stage, tableRows: rules[0].content_json.ocrTableRows,
      sources };
  }

  /** Read back a run's immutable OCR transcription snapshot after rechecking its origin. */
  async getOcrRowTranscriptionSnapshots(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: Array<{
    decisionId: string; decisionContentHash: string; originCheckId: string;
    sourceFileId: string; sourceSha256: string; rowFingerprint: string;
    review: OcrRowTranscriptionReviewInput;
    provenance: OcrRowTranscriptionReview["provenance"];
  }> }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const client = await this.pool.connect();
    try {
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string; manifest_id: string;
      }>(
        `SELECT run.id AS run_id, object.id AS object_id,
                object.api_id AS object_api_id, run.manifest_id
         FROM analysis_runs run
         JOIN objects object ON object.id = run.object_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      )).rows[0];
      if (!selected) return undefined;
      const sourceRows = await client.query<{
        id: string; manifest_sha: string; actual_sha: string;
      }>(
        `SELECT source.id, item.blob_sha256 AS manifest_sha,
                blob.sha256 AS actual_sha
         FROM manifest_items item
         JOIN source_files source ON source.id = item.source_file_id
           AND source.object_id = $2
         JOIN blobs blob ON blob.id = source.blob_id
         WHERE item.manifest_id = $1`,
        [selected.manifest_id, selected.object_id],
      );
      const sources = new Map(sourceRows.rows.map((row) =>
        [row.id, { manifestSha: row.manifest_sha.trim(),
          actualSha: row.actual_sha.trim() }]));
      const snapshots = await client.query<OcrTranscriptionSnapshotRow>(
        `SELECT * FROM run_ocr_transcription_snapshots
         WHERE run_id = $1 AND object_id = $2
         ORDER BY source_file_id, row_fingerprint_sha256`,
        [selected.run_id, selected.object_id],
      );
      const contexts = new Map<string, OcrTranscriptionContext>();
      const items = [] as Array<{
        decisionId: string; decisionContentHash: string; originCheckId: string;
        sourceFileId: string; sourceSha256: string; rowFingerprint: string;
        review: OcrRowTranscriptionReviewInput;
        provenance: OcrRowTranscriptionReview["provenance"];
      }>;
      for (const snapshot of snapshots.rows) {
        const source = sources.get(snapshot.source_file_id);
        if (!source || source.manifestSha !== source.actualSha
          || source.manifestSha !== snapshot.source_sha256.trim()
          || snapshot.run_id !== selected.run_id
          || snapshot.object_id !== selected.object_id) {
          throw new Error("OCR transcription snapshot source integrity check failed");
        }
        const origin = (await client.query<OcrTranscriptionDecisionRow>(
          `SELECT decision.*, run.api_id AS origin_run_api_id,
                  manifest.sha256 AS origin_manifest_hash,
                  run.release_id AS origin_release_id
           FROM ocr_row_transcription_decisions decision
           JOIN analysis_runs run ON run.id = decision.run_id
             AND run.object_id = decision.object_id
           JOIN input_manifests manifest ON manifest.id = run.manifest_id
           WHERE decision.id = $1 AND decision.object_id = $2`,
          [snapshot.decision_id, selected.object_id],
        )).rows[0];
        if (!origin || origin.run_id !== snapshot.origin_run_id
          || origin.source_file_id !== snapshot.source_file_id
          || origin.source_sha256.trim() !== snapshot.source_sha256.trim()
          || origin.row_fingerprint_sha256.trim()
            !== snapshot.row_fingerprint_sha256.trim()
          || origin.content_hash.trim() !== snapshot.decision_content_hash.trim()
          || origin.ocr_stage_artifact_id !== snapshot.ocr_stage_artifact_id
          || origin.rule_stage_artifact_id !== snapshot.rule_stage_artifact_id) {
          throw new Error("OCR transcription snapshot origin integrity check failed");
        }
        const validated = await this.verifyOcrTranscriptionDecision(
          client, origin, selected.object_api_id, contexts);
        if (canonicalJson(snapshot.review_json) !== canonicalJson(validated)
          || validated.provenance.sourceSha256 !== source.manifestSha) {
          throw new Error("OCR transcription snapshot review integrity check failed");
        }
        items.push({ decisionId: origin.id,
          decisionContentHash: origin.content_hash.trim(),
          originCheckId: origin.origin_run_api_id,
          sourceFileId: validated.provenance.sourceFileId,
          sourceSha256: source.manifestSha,
          rowFingerprint: validated.provenance.rowFingerprint,
          ...validated });
      }
      return { items };
    } finally {
      client.release();
    }
  }

  async recordOcrRowTranscriptionReviewCommand(
    checkId: string, input: OcrRowTranscriptionReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrRowTranscriptionReview>> {
    if (command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")) return { kind: "forbidden" };
    const operation = "OCR_ROW_TRANSCRIPTION_REVIEW";
    const targetId = `${checkId}:${input.rowFingerprint}`;
    const requestHash = sha256(canonicalJson({ checkId, input }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, "OCR_ROW", targetId);
      const receipt = await this.getCommandReceipt<{ value: OcrRowTranscriptionReview }>(
        client, command, operation, "OCR_ROW", targetId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", value: receipt.response.value, replayed: true } as const;
      }
      const scope = await client.query<{
        run_id: string; object_id: string; object_api_id: string; inspection_id: string;
        active_run_id: string | null; run_state: string; manifest_hash: string;
        release_id: string;
      }>(
        `SELECT run.id AS run_id, object.id AS object_id,
                object.api_id AS object_api_id, inspection.id AS inspection_id,
                inspection.active_run_id, run.run_state, manifest.sha256 AS manifest_hash,
                run.release_id
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND inspection.lifecycle = 'OPEN'
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])
         FOR UPDATE OF inspection`,
        [this.organizationId, checkId, command.actor.userId],
      );
      const selected = scope.rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.active_run_id !== selected.run_id
        || !["SUCCEEDED", "PARTIAL"].includes(selected.run_state)) {
        return { kind: "invalid_state", code: "STALE_OCR_ROW",
          message: "Строка относится к старой или незавершённой проверке" } as const;
      }
      const context = await this.loadOcrRowTranscriptionContext(
        client, selected.run_id, selected.object_id, selected.release_id,
        selected.manifest_hash.trim());
      if (!context) return { kind: "invalid_state", code: "OCR_ROW_STAGE_INVALID",
        message: "Сохранённая OCR-строка не прошла проверку" } as const;
      const validated = validateOcrRowTranscriptionReview(input, context.tableRows,
        context.ocrStage, selected.manifest_hash.trim());
      if (!validated) return { kind: "invalid_state", code: "OCR_ROW_NOT_FOUND",
        message: "Строка OCR или её SHA не совпали с сохранённым результатом" } as const;
      const source = context.sources.get(validated.provenance.sourceFileId);
      if (!source || source.sha256 !== validated.provenance.sourceSha256) {
        return { kind: "invalid_state", code: "OCR_ROW_SOURCE_MISMATCH",
          message: "Исходный PDF не совпал с манифестом проверки" } as const;
      }
      const reviewJson = { review: validated.review, provenance: validated.provenance };
      const contentHash = sha256(canonicalJson({ checkId,
        objectId: selected.object_api_id, ...reviewJson, actorId: command.actor.userId }));
      const prior = await client.query<{ id: string; created_at: Date | string }>(
        `SELECT id, created_at FROM ocr_row_transcription_decisions
         WHERE run_id = $1 AND content_hash = $2 LIMIT 1`,
        [selected.run_id, contentHash],
      );
      const attempted = prior.rows[0] ? null : await client.query<{
        id: string; created_at: Date | string;
      }>(
        `INSERT INTO ocr_row_transcription_decisions (
           object_id, run_id, ocr_stage_artifact_id, rule_stage_artifact_id,
           source_file_id, source_sha256, row_fingerprint_sha256, review_json,
           actor_id, content_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (run_id, content_hash) DO NOTHING
         RETURNING id, created_at`,
        [selected.object_id, selected.run_id, context.ocrArtifactId,
          context.ruleArtifactId, source.id, source.sha256,
          validated.provenance.rowFingerprint, canonicalJson(reviewJson),
          command.actor.userId, contentHash],
      );
      const created = Boolean(attempted?.rows[0]);
      const inserted = prior.rows[0] ?? attempted?.rows[0]
        ?? (await client.query<{ id: string; created_at: Date | string }>(
          `SELECT id, created_at FROM ocr_row_transcription_decisions
           WHERE run_id = $1 AND content_hash = $2`,
          [selected.run_id, contentHash])).rows[0];
      if (!inserted) throw new Error("OCR transcription decision conflict read failed");
      const value: OcrRowTranscriptionReview = { id: inserted.id, checkId,
        objectId: selected.object_api_id, ...reviewJson, actorId: command.actor.userId,
        contentHash, createdAt: asIso(inserted.created_at) };
      await this.insertCommandReceipt(client, command, operation, "OCR_ROW",
        targetId, requestHash, 201, { value }, true);
      if (created) await this.appendAuditEvent(client, {
        command, objectId: selected.object_id, inspectionId: selected.inspection_id,
        action: operation, targetType: "OCR_ROW", targetId,
        beforeRef: null, afterRef: { decisionId: value.id, contentHash,
          runId: selected.run_id, ocrStageId: context.ocrArtifactId,
          ruleStageId: context.ruleArtifactId,
          rowFingerprint: validated.provenance.rowFingerprint },
        reason: validated.review.basis,
      });
      return { kind: "success", value, replayed: !created } as const;
    });
  }

  async getOcrRowTranscriptionReviews(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrRowTranscriptionReview[]; canReview: boolean;
    ocrStageSha256: string; candidates: Array<{ rowFingerprint: string;
      proposal: OcrTableRowsRead["proposals"][number] }> }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const client = await this.pool.connect();
    try {
      const scope = await client.query<{
        run_id: string; object_id: string; object_api_id: string;
        run_state: string; inspection_lifecycle: string;
        active_run_id: string | null; can_review: boolean;
        manifest_hash: string; release_id: string;
      }>(
        `SELECT run.id AS run_id, object.id AS object_id,
                object.api_id AS object_api_id, run.run_state,
                inspection.lifecycle AS inspection_lifecycle,
                inspection.active_run_id, manifest.sha256 AS manifest_hash,
                run.release_id,
                EXISTS (SELECT 1 FROM object_memberships reviewer
                  WHERE reviewer.object_id = object.id AND reviewer.user_id = $3
                    AND reviewer.revoked_at IS NULL
                    AND reviewer.permission_set @> ARRAY['REVIEW_DECIDE']::text[]) AS can_review
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      );
      const selected = scope.rows[0];
      if (!selected) return undefined;
      const context = await this.loadOcrRowTranscriptionContext(
        client, selected.run_id, selected.object_id, selected.release_id,
        selected.manifest_hash.trim());
      if (!context) return undefined;
      // The pilot read projection caps rows at 64. Review candidates must use the
      // complete independently verified artifact, with original row fingerprints.
      const proposals = context.tableRows.proposals as OcrTableRowsRead["proposals"];
      const candidates = proposals.map((proposal) => ({
        rowFingerprint: sha256(canonicalJson(proposal)), proposal }));
      const rows = await client.query<{
        id: string; object_id: string; run_id: string;
        ocr_stage_artifact_id: string; rule_stage_artifact_id: string;
        source_file_id: string; source_sha256: string;
        row_fingerprint_sha256: string; review_json: Record<string, unknown>;
        actor_id: string; content_hash: string; created_at: Date | string;
      }>(
        `SELECT id, object_id, run_id, ocr_stage_artifact_id,
                rule_stage_artifact_id, source_file_id, source_sha256,
                row_fingerprint_sha256, review_json, actor_id,
                content_hash, created_at
         FROM ocr_row_transcription_decisions
         WHERE run_id = $1 AND object_id = $2
         ORDER BY created_at, id`,
        [selected.run_id, selected.object_id],
      );
      const items: OcrRowTranscriptionReview[] = [];
      for (const row of rows.rows) {
        const stored = parseJson<Record<string, unknown>>(row.review_json);
        const validated = validateOcrRowTranscriptionReview(stored.review,
          context.tableRows, context.ocrStage, selected.manifest_hash.trim());
        const source = validated && context.sources.get(validated.provenance.sourceFileId);
        if (!validated || !source
          || canonicalJson(stored) !== canonicalJson(validated)
          || row.object_id !== selected.object_id || row.run_id !== selected.run_id
          || row.ocr_stage_artifact_id !== context.ocrArtifactId
          || row.rule_stage_artifact_id !== context.ruleArtifactId
          || row.source_file_id !== source.id
          || row.source_sha256.trim() !== source.sha256
          || row.row_fingerprint_sha256.trim() !== validated.provenance.rowFingerprint) {
          throw new Error("OCR transcription review integrity check failed");
        }
        const contentHash = sha256(canonicalJson({ checkId,
          objectId: selected.object_api_id, ...validated, actorId: row.actor_id }));
        if (contentHash !== row.content_hash.trim()) {
          throw new Error("OCR transcription review hash mismatch");
        }
        items.push({ id: row.id, checkId, objectId: selected.object_api_id,
          ...validated, actorId: row.actor_id, contentHash,
          createdAt: asIso(row.created_at) });
      }
      return { items, canReview: actor.capabilities.includes("REVIEW_DECIDE")
        && selected.can_review && selected.active_run_id === selected.run_id
        && selected.inspection_lifecycle === "OPEN"
        && ["SUCCEEDED", "PARTIAL"].includes(selected.run_state),
        ocrStageSha256: context.ocrStage.content_hash, candidates };
    } finally {
      client.release();
    }
  }

  /** Bind an applicability judgment to two immutable decisions and original OCR bytes. */
  private async loadOcrRowApplicabilityContext(
    client: PoolClient,
    selected: { run_id: string; object_id: string; object_api_id: string;
      manifest_hash: string; manifest_json: Record<string, unknown> },
    sourceFileApiId: string, rowFingerprint: string,
  ): Promise<{ context: OcrRowApplicabilityVerificationContext;
    sourceInternalId: string; transcriptionDecisionInternalId: string;
    sourceReviewDecisionInternalId: string } | null> {
    const manifest = parseJson<Record<string, unknown>>(selected.manifest_json);
    if (sha256(canonicalJson(manifest)) !== selected.manifest_hash.trim()
      || !Array.isArray(manifest.sources)) return null;
    const sourceEntries = manifest.sources.filter((entry) =>
      isRecord(entry) && entry.sourceFileId === sourceFileApiId);
    if (sourceEntries.length !== 1 || !isRecord(sourceEntries[0])) return null;
    const manifestSource = sourceEntries[0];
    if (typeof manifestSource.sha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(manifestSource.sha256)
      || !Array.isArray(manifestSource.stages)
      || !(manifestSource.sourceReviewHash === null
        || typeof manifestSource.sourceReviewHash === "string")) return null;
    const sources = await client.query<{
      id: string; api_id: string; object_id: string; manifest_sha: string;
      actual_sha: string; stages: string[];
    }>(
      `SELECT source.id, source.api_id, source.object_id,
              item.blob_sha256 AS manifest_sha, blob.sha256 AS actual_sha,
              (SELECT array_agg(stage.stage ORDER BY stage.stage)
               FROM source_file_stages stage WHERE stage.source_file_id = source.id) AS stages
       FROM analysis_runs run
       JOIN manifest_items item ON item.manifest_id = run.manifest_id
       JOIN source_files source ON source.id = item.source_file_id
       JOIN blobs blob ON blob.id = source.blob_id
       WHERE run.id = $1 AND run.object_id = $2 AND source.api_id = $3`,
      [selected.run_id, selected.object_id, sourceFileApiId],
    );
    if (sources.rows.length !== 1) return null;
    const source = sources.rows[0];
    if (source.object_id !== selected.object_id
      || source.api_id !== sourceFileApiId
      || source.manifest_sha.trim() !== manifestSource.sha256
      || source.actual_sha.trim() !== manifestSource.sha256
      || !Array.isArray(source.stages)
      || canonicalJson(source.stages) !== canonicalJson(manifestSource.stages)) return null;

    const snapshots = await client.query<OcrTranscriptionSnapshotRow>(
      `SELECT * FROM run_ocr_transcription_snapshots
       WHERE run_id = $1 AND object_id = $2 AND source_file_id = $3
         AND row_fingerprint_sha256 = $4`,
      [selected.run_id, selected.object_id, source.id, rowFingerprint],
    );
    if (snapshots.rows.length !== 1) return null;
    const snapshot = snapshots.rows[0];
    if (snapshot.source_sha256.trim() !== manifestSource.sha256
      || snapshot.row_fingerprint_sha256.trim() !== rowFingerprint) return null;
    const origins = await client.query<OcrTranscriptionDecisionRow>(
      `SELECT decision.*, origin.api_id AS origin_run_api_id,
              origin_manifest.sha256 AS origin_manifest_hash,
              origin.release_id AS origin_release_id
       FROM ocr_row_transcription_decisions decision
       JOIN analysis_runs origin ON origin.id = decision.run_id
         AND origin.object_id = decision.object_id
       JOIN input_manifests origin_manifest ON origin_manifest.id = origin.manifest_id
       WHERE decision.id = $1 AND decision.object_id = $2`,
      [snapshot.decision_id, selected.object_id],
    );
    if (origins.rows.length !== 1) return null;
    const origin = origins.rows[0];
    if (origin.run_id !== snapshot.origin_run_id
      || origin.source_file_id !== source.id
      || origin.source_sha256.trim() !== manifestSource.sha256
      || origin.row_fingerprint_sha256.trim() !== rowFingerprint
      || origin.content_hash.trim() !== snapshot.decision_content_hash.trim()
      || origin.ocr_stage_artifact_id !== snapshot.ocr_stage_artifact_id
      || origin.rule_stage_artifact_id !== snapshot.rule_stage_artifact_id) return null;
    const originContexts = new Map<string, OcrTranscriptionContext>();
    const transcription = await this.verifyOcrTranscriptionDecision(
      client, origin, selected.object_api_id, originContexts);
    if (canonicalJson(snapshot.review_json) !== canonicalJson(transcription)) return null;
    const originContext = originContexts.get(origin.run_id);
    if (!originContext) return null;

    const reviews = await client.query<{
      snapshot_decision_id: string; snapshot_hash: string;
      id: string; object_id: string; source_file_id: string; source_sha256: string;
      revision_status: SourceReviewDecision["revisionStatus"];
      approval_status: SourceReviewDecision["approvalStatus"];
      link_group_id: string | null; section_code: SourceReviewDecision["sectionCode"];
      page_stages: SourceReviewDecision["pageStages"];
      basis_reference: string; actor_id: string; content_hash: string;
      created_at: Date | string;
    }>(
      `SELECT snapshot.decision_id AS snapshot_decision_id,
              snapshot.decision_hash AS snapshot_hash,
              review.id, review.object_id, review.source_file_id,
              review.source_sha256, review.revision_status,
              review.approval_status, review.link_group_id,
              review.section_code, review.page_stages, review.basis_reference,
              review.actor_id, review.content_hash, review.created_at
       FROM run_source_review_snapshots snapshot
       JOIN source_review_decisions review ON review.id = snapshot.decision_id
       WHERE snapshot.run_id = $1 AND snapshot.source_file_id = $2`,
      [selected.run_id, source.id],
    );
    if (reviews.rows.length !== 1) return null;
    const review = reviews.rows[0];
    if (review.snapshot_decision_id !== review.id
      || review.object_id !== selected.object_id
      || review.source_file_id !== source.id
      || review.source_sha256.trim() !== manifestSource.sha256
      || review.snapshot_hash.trim() !== review.content_hash.trim()
      || review.content_hash.trim() !== manifestSource.sourceReviewHash) return null;
    const sourceDecision: SourceReviewDecision = {
      id: review.id, objectId: selected.object_api_id,
      sourceFileId: sourceFileApiId, sourceSha256: review.source_sha256.trim(),
      revisionStatus: review.revision_status,
      approvalStatus: review.approval_status,
      linkGroupId: review.link_group_id, sectionCode: review.section_code,
      pageStages: parseJson<SourceReviewDecision["pageStages"]>(review.page_stages),
      basis: { reference: review.basis_reference }, actorId: review.actor_id,
      contentHash: review.content_hash.trim(), createdAt: asIso(review.created_at),
    };
    const context: OcrRowApplicabilityVerificationContext = {
      targetCheckId: "", objectId: selected.object_api_id,
      inputManifestHash: selected.manifest_hash.trim(),
      originInputManifestHash: origin.origin_manifest_hash.trim(),
      source: { sourceFileId: sourceFileApiId,
        sourceSha256: manifestSource.sha256, stages: source.stages,
        sourceReviewHash: manifestSource.sourceReviewHash },
      transcriptionSnapshot: {
        targetCheckId: "", decisionId: origin.id,
        decisionContentHash: origin.content_hash.trim(),
        originCheckId: origin.origin_run_api_id, actorId: origin.actor_id,
        sourceFileId: sourceFileApiId, sourceSha256: manifestSource.sha256,
        rowFingerprint, review: transcription.review,
        provenance: transcription.provenance,
      },
      sourceReviewSnapshot: { targetCheckId: "", decisionId: review.id,
        decisionHash: review.snapshot_hash.trim(), decision: sourceDecision },
      tableRowsResult: originContext.tableRows, ocrStage: originContext.ocrStage,
    };
    return { context, sourceInternalId: source.id,
      transcriptionDecisionInternalId: origin.id,
      sourceReviewDecisionInternalId: review.id };
  }

  private async verifyStoredOcrApplicabilityDecision(
    client: PoolClient, row: OcrApplicabilityDecisionRow, objectApiId: string,
  ): Promise<{ input: OcrRowApplicabilityReviewInput;
    validated: NonNullable<ReturnType<typeof validateOcrRowApplicabilityReview>>;
    context: OcrRowApplicabilityVerificationContext } > {
    const origin = (await client.query<{
      run_id: string; object_id: string; object_api_id: string; check_id: string;
      manifest_hash: string; manifest_json: Record<string, unknown>;
    }>(
      `SELECT run.id AS run_id, run.object_id, object.api_id AS object_api_id,
              run.api_id AS check_id,
              manifest.sha256 AS manifest_hash,
              manifest.canonical_json AS manifest_json
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN input_manifests manifest ON manifest.id = run.manifest_id
       WHERE run.id = $1 AND run.object_id = $2`,
      [row.run_id, row.object_id],
    )).rows[0];
    if (!origin || origin.object_api_id !== objectApiId
      || !isRecord(row.review_json) || !isRecord(row.review_json.review)) {
      throw new Error("OCR applicability decision origin integrity check failed");
    }
    const input = row.review_json.review as unknown as OcrRowApplicabilityReviewInput;
    if (input.targetCheckId !== origin.check_id) {
      throw new Error("OCR applicability decision run integrity check failed");
    }
    const loaded = await this.loadOcrRowApplicabilityContext(
      client, origin, input.sourceFileId, input.rowFingerprint);
    if (!loaded || row.source_file_id !== loaded.sourceInternalId
      || row.source_sha256.trim() !== loaded.context.source.sourceSha256
      || row.row_fingerprint_sha256.trim() !== input.rowFingerprint
      || row.transcription_decision_id !== loaded.transcriptionDecisionInternalId
      || row.source_review_decision_id !== loaded.sourceReviewDecisionInternalId) {
      throw new Error("OCR applicability decision source integrity check failed");
    }
    loaded.context.targetCheckId = origin.check_id;
    loaded.context.transcriptionSnapshot.targetCheckId = origin.check_id;
    loaded.context.sourceReviewSnapshot.targetCheckId = origin.check_id;
    const validated = validateOcrRowApplicabilityReview(input, loaded.context);
    const expectedHash = validated && sha256(canonicalJson({
      checkId: origin.check_id, objectId: objectApiId, ...validated,
      actorId: row.actor_id,
    }));
    if (!validated || canonicalJson(row.review_json) !== canonicalJson(validated)
      || expectedHash !== row.content_hash.trim()) {
      throw new Error("OCR applicability decision hash integrity check failed");
    }
    return { input, validated, context: loaded.context };
  }

  /** Carry only the latest verified judgment for each exact subject key. */
  private async snapshotOcrRowApplicabilityDecisions(client: PoolClient, target: {
    runId: string; checkId: string; objectId: string; objectApiId: string;
    manifestHash: string; manifestJson: Record<string, unknown>;
    sources: Array<{ id: string; sha256: string }>;
  }): Promise<void> {
    if (target.sources.length === 0) return;
    const decisions = await client.query<OcrApplicabilityDecisionRow>(
      `SELECT decision.* FROM ocr_row_applicability_decisions decision
       WHERE decision.object_id = $1 AND decision.source_file_id = ANY($2::uuid[])
       ORDER BY decision.created_at DESC, decision.id DESC`,
      [target.objectId, target.sources.map((source) => source.id)],
    );
    const currentSha = new Map(target.sources.map((source) =>
      [source.id, source.sha256.trim()]));
    const selectedKeys = new Set<string>();
    for (const row of decisions.rows) {
      if (!isRecord(row.review_json) || !isRecord(row.review_json.review)) {
        throw new Error("OCR applicability decision integrity check failed");
      }
      const input = row.review_json.review as unknown as OcrRowApplicabilityReviewInput;
      const key = canonicalJson([row.source_file_id, row.row_fingerprint_sha256.trim(),
        input.parameterCode, input.attribute, input.stage, input.entityKey]);
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      const sourceSha = currentSha.get(row.source_file_id);
      if (!sourceSha) throw new Error("OCR applicability source outside run manifest");
      // A newer source or review snapshot invalidates the latest judgment.
      // Do not fall back to an older APPLICABLE decision.
      if (row.source_sha256.trim() !== sourceSha) continue;
      await this.verifyStoredOcrApplicabilityDecision(client, row, target.objectApiId);
      const loaded = await this.loadOcrRowApplicabilityContext(client, {
        run_id: target.runId, object_id: target.objectId,
        object_api_id: target.objectApiId, manifest_hash: target.manifestHash,
        manifest_json: target.manifestJson,
      }, input.sourceFileId, input.rowFingerprint);
      if (!loaded || loaded.transcriptionDecisionInternalId !== row.transcription_decision_id
        || loaded.sourceReviewDecisionInternalId !== row.source_review_decision_id) continue;
      loaded.context.targetCheckId = target.checkId;
      loaded.context.transcriptionSnapshot.targetCheckId = target.checkId;
      loaded.context.sourceReviewSnapshot.targetCheckId = target.checkId;
      const validated = validateOcrRowApplicabilityReview(
        { ...input, targetCheckId: target.checkId }, loaded.context);
      if (!validated) throw new Error("OCR applicability target snapshot integrity check failed");
      await client.query(
        `INSERT INTO run_ocr_applicability_snapshots (
           run_id, object_id, source_file_id, source_sha256,
           row_fingerprint_sha256, parameter_code, attribute, stage,
           entity_key, decision_id, decision_content_hash, origin_run_id,
           transcription_decision_id, source_review_decision_id,
           review_json, eligible_for_fact_review
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                   $9, $10, $11, $12, $13, $14, $15::jsonb, $16)`,
        [target.runId, target.objectId, row.source_file_id, sourceSha,
          input.rowFingerprint, input.parameterCode, input.attribute,
          input.stage, input.entityKey, row.id, row.content_hash.trim(),
          row.run_id, row.transcription_decision_id,
          row.source_review_decision_id, canonicalJson(validated),
          validated.eligibleForFactReview],
      );
    }
  }

  /** Verify immutable target and origin before exposing carried judgments. */
  async getOcrRowApplicabilitySnapshots(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: Array<{
    decisionId: string; decisionContentHash: string; originCheckId: string;
    sourceFileId: string; sourceSha256: string; rowFingerprint: string;
    review: OcrRowApplicabilityReviewInput; eligibleForFactReview: boolean;
  }> }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const client = await this.pool.connect();
    try {
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, run.object_id,
                object.api_id AS object_api_id,
                manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json
         FROM analysis_runs run
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      )).rows[0];
      if (!selected) return undefined;
      const rows = await client.query<OcrApplicabilitySnapshotRow>(
        `SELECT * FROM run_ocr_applicability_snapshots
         WHERE run_id = $1 AND object_id = $2
         ORDER BY source_file_id, row_fingerprint_sha256,
                  parameter_code, attribute, stage, entity_key`,
        [selected.run_id, selected.object_id],
      );
      const items = [] as Array<{
        decisionId: string; decisionContentHash: string; originCheckId: string;
        sourceFileId: string; sourceSha256: string; rowFingerprint: string;
        review: OcrRowApplicabilityReviewInput; eligibleForFactReview: boolean;
      }>;
      for (const snapshot of rows.rows) {
        const origin = (await client.query<OcrApplicabilityDecisionRow>(
          `SELECT * FROM ocr_row_applicability_decisions WHERE id = $1`,
          [snapshot.decision_id],
        )).rows[0];
        if (!origin || origin.run_id !== snapshot.origin_run_id
          || origin.object_id !== selected.object_id
          || origin.source_file_id !== snapshot.source_file_id
          || origin.source_sha256.trim() !== snapshot.source_sha256.trim()
          || origin.row_fingerprint_sha256.trim()
            !== snapshot.row_fingerprint_sha256.trim()
          || origin.transcription_decision_id !== snapshot.transcription_decision_id
          || origin.source_review_decision_id !== snapshot.source_review_decision_id
          || origin.content_hash.trim() !== snapshot.decision_content_hash.trim()) {
          throw new Error("OCR applicability snapshot origin integrity check failed");
        }
        const verified = await this.verifyStoredOcrApplicabilityDecision(
          client, origin, selected.object_api_id);
        const input = verified.input;
        if (input.parameterCode !== snapshot.parameter_code
          || input.attribute !== snapshot.attribute || input.stage !== snapshot.stage
          || input.entityKey !== snapshot.entity_key) {
          throw new Error("OCR applicability snapshot key integrity check failed");
        }
        const loaded = await this.loadOcrRowApplicabilityContext(
          client, selected, input.sourceFileId, input.rowFingerprint);
        if (!loaded || loaded.sourceInternalId !== snapshot.source_file_id
          || loaded.context.source.sourceSha256 !== snapshot.source_sha256.trim()
          || loaded.transcriptionDecisionInternalId !== snapshot.transcription_decision_id
          || loaded.sourceReviewDecisionInternalId !== snapshot.source_review_decision_id) {
          throw new Error("OCR applicability snapshot target integrity check failed");
        }
        loaded.context.targetCheckId = checkId;
        loaded.context.transcriptionSnapshot.targetCheckId = checkId;
        loaded.context.sourceReviewSnapshot.targetCheckId = checkId;
        const validated = validateOcrRowApplicabilityReview(
          { ...input, targetCheckId: checkId }, loaded.context);
        if (!validated || canonicalJson(validated) !== canonicalJson(snapshot.review_json)
          || validated.eligibleForFactReview !== snapshot.eligible_for_fact_review) {
          throw new Error("OCR applicability snapshot review integrity check failed");
        }
        items.push({ decisionId: snapshot.decision_id,
          decisionContentHash: snapshot.decision_content_hash.trim(),
          originCheckId: input.targetCheckId,
          sourceFileId: input.sourceFileId, sourceSha256: input.sourceSha256,
          rowFingerprint: input.rowFingerprint, review: validated.review,
          eligibleForFactReview: validated.eligibleForFactReview });
      }
      return { items };
    } finally {
      client.release();
    }
  }

  private async persistOcrTypedFactCandidateArtifact(client: PoolClient,
    selected: { run_id: string; object_id: string; object_api_id: string;
      manifest_hash: string; manifest_json: Record<string, unknown>;
      check_id: string; release_id: string },
  ): Promise<void> {
    const content = await this.deriveOcrTypedFactCandidates(
      client, selected.check_id, selected);
    const canonical = canonicalJson(content);
    await client.query(
      `INSERT INTO run_ocr_typed_fact_candidate_artifacts (
         run_id, object_id, release_id, input_manifest_hash,
         schema_version, content_hash, byte_size, fact_count,
         snapshot_count, content_json
       ) VALUES ($1, $2, $3, $4,
                 'ocr-typed-fact-candidates-v1', $5, $6, $7, $8, $9::jsonb)`,
      [selected.run_id, selected.object_id, selected.release_id,
        selected.manifest_hash, sha256(canonical),
        Buffer.byteLength(canonical, "utf8"), content.items.length,
        content.snapshotCount, canonical],
    );
  }

  /** Release, saved bytes, and source decisions are independently checked at read and seal. */
  private async verifyOcrTypedFactCandidateArtifact(client: PoolClient,
    runId: string): Promise<OcrTypedFactV2Read | null> {
    const selected = (await client.query<{
      run_id: string; check_id: string; object_id: string; object_api_id: string;
      manifest_hash: string; manifest_json: Record<string, unknown>;
      release_id: string; release_json: Record<string, unknown>;
      release_hash: string; release_bytes: number | string;
    }>(
      `SELECT run.id AS run_id, run.api_id AS check_id, run.object_id,
              object.api_id AS object_api_id, manifest.sha256 AS manifest_hash,
              manifest.canonical_json AS manifest_json,
              release.release_id, release.content_json AS release_json,
              release.content_hash AS release_hash, release.byte_size AS release_bytes
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN input_manifests manifest ON manifest.id = run.manifest_id
       JOIN analysis_releases release ON release.release_id = run.release_id
       WHERE run.id = $1`, [runId],
    )).rows[0];
    if (!selected) throw new Error("OCR typed fact run release missing");
    const releaseCanonical = canonicalJson(selected.release_json);
    if (sha256(releaseCanonical) !== selected.release_hash.trim()
      || Buffer.byteLength(releaseCanonical, "utf8") !== Number(selected.release_bytes)
      || selected.release_json.releaseId !== selected.release_id) {
      throw new Error("OCR typed fact release integrity check failed");
    }
    const enabled = isRecord(selected.release_json.reviewArtifacts)
      && selected.release_json.reviewArtifacts.ocrTypedFactCandidates
        === "ocr-typed-fact-candidates-v1";
    const saved = (await client.query<{
      object_id: string; release_id: string; input_manifest_hash: string;
      schema_version: string; content_hash: string; byte_size: number | string;
      fact_count: number; snapshot_count: number;
      content_json: Record<string, unknown>;
    }>(
      `SELECT * FROM run_ocr_typed_fact_candidate_artifacts WHERE run_id = $1`,
      [runId],
    )).rows[0];
    if (!enabled) {
      if (saved) throw new Error("OCR typed fact artifact outside pinned release");
      return null;
    }
    if (!saved || saved.object_id !== selected.object_id
      || saved.release_id !== selected.release_id
      || saved.input_manifest_hash.trim() !== selected.manifest_hash.trim()
      || saved.schema_version !== "ocr-typed-fact-candidates-v1") {
      throw new Error("OCR typed fact candidate artifact missing or out of scope");
    }
    const storedCanonical = canonicalJson(saved.content_json);
    if (sha256(storedCanonical) !== saved.content_hash.trim()
      || Buffer.byteLength(storedCanonical, "utf8") !== Number(saved.byte_size)) {
      throw new Error("OCR typed fact candidate artifact hash mismatch");
    }
    const derived = await this.deriveOcrTypedFactCandidates(
      client, selected.check_id, selected);
    if (canonicalJson(derived) !== storedCanonical
      || derived.items.length !== saved.fact_count
      || derived.snapshotCount !== saved.snapshot_count) {
      throw new Error("OCR typed fact candidate artifact derivation mismatch");
    }
    return derived;
  }

  /** Recompute solely from frozen snapshots and verified origin artifacts. */
  private async deriveOcrTypedFactCandidates(client: PoolClient, checkId: string,
    selected: { run_id: string; object_id: string; object_api_id: string;
      manifest_hash: string; manifest_json: Record<string, unknown> },
  ): Promise<OcrTypedFactV2Read> {
    const rows = await client.query<OcrApplicabilitySnapshotRow>(
      `SELECT * FROM run_ocr_applicability_snapshots
       WHERE run_id = $1 AND object_id = $2
       ORDER BY source_file_id, row_fingerprint_sha256,
                parameter_code, attribute, stage, entity_key LIMIT 513`,
      [selected.run_id, selected.object_id],
    );
    if (rows.rows.length > 512) {
      throw new Error("OCR typed fact candidate snapshot limit exceeded");
    }
    const items: OcrTypedFactV2Read["items"] = [];
    let abstainedCount = 0;
    for (const snapshot of rows.rows) {
      const origin = (await client.query<OcrApplicabilityDecisionRow>(
        `SELECT * FROM ocr_row_applicability_decisions WHERE id = $1`,
        [snapshot.decision_id],
      )).rows[0];
      if (!origin || origin.run_id !== snapshot.origin_run_id
        || origin.object_id !== selected.object_id
        || origin.source_file_id !== snapshot.source_file_id
        || origin.source_sha256.trim() !== snapshot.source_sha256.trim()
        || origin.row_fingerprint_sha256.trim()
          !== snapshot.row_fingerprint_sha256.trim()
        || origin.transcription_decision_id !== snapshot.transcription_decision_id
        || origin.source_review_decision_id !== snapshot.source_review_decision_id
        || origin.content_hash.trim() !== snapshot.decision_content_hash.trim()) {
        throw new Error("OCR typed fact origin integrity check failed");
      }
      const verifiedOrigin = await this.verifyStoredOcrApplicabilityDecision(
        client, origin, selected.object_api_id);
      const originInput = verifiedOrigin.input;
      if (originInput.parameterCode !== snapshot.parameter_code
        || originInput.attribute !== snapshot.attribute
        || originInput.stage !== snapshot.stage
        || originInput.entityKey !== snapshot.entity_key) {
        throw new Error("OCR typed fact snapshot key integrity check failed");
      }
      const loaded = await this.loadOcrRowApplicabilityContext(
        client, selected, originInput.sourceFileId, originInput.rowFingerprint);
      if (!loaded || loaded.sourceInternalId !== snapshot.source_file_id
        || loaded.context.source.sourceSha256 !== snapshot.source_sha256.trim()
        || loaded.transcriptionDecisionInternalId !== snapshot.transcription_decision_id
        || loaded.sourceReviewDecisionInternalId !== snapshot.source_review_decision_id) {
        throw new Error("OCR typed fact target integrity check failed");
      }
      loaded.context.targetCheckId = checkId;
      loaded.context.transcriptionSnapshot.targetCheckId = checkId;
      loaded.context.sourceReviewSnapshot.targetCheckId = checkId;
      const validated = validateOcrRowApplicabilityReview(
        { ...originInput, targetCheckId: checkId }, loaded.context);
      if (!validated || canonicalJson(validated) !== canonicalJson(snapshot.review_json)
        || validated.eligibleForFactReview !== snapshot.eligible_for_fact_review) {
        throw new Error("OCR typed fact target review integrity check failed");
      }
      if (!validated.eligibleForFactReview) {
        abstainedCount += 1;
        continue;
      }
      const verification = {
        originApplicability: verifiedOrigin.context,
        applicability: loaded.context,
        applicabilitySnapshot: {
          targetCheckId: checkId, decisionId: snapshot.decision_id,
          decisionContentHash: snapshot.decision_content_hash.trim(),
          originReview: originInput, actorId: origin.actor_id,
          ...validated,
        },
        latestApplicabilityDecisionId: snapshot.decision_id,
      };
      const fact = buildOcrTypedFactV2(verification);
      if (!fact) {
        abstainedCount += 1;
        continue;
      }
      if (!validateOcrTypedFactV2(fact, verification)) {
        throw new Error("OCR typed fact independent verification failed");
      }
      items.push(fact);
    }
    return { schemaVersion: "ocr-typed-fact-candidates-v1", items,
      snapshotCount: rows.rows.length, abstainedCount,
      findingCount: 0, coverageCount: 0 };
  }

  /** Explicit read-only opt-in. Recheck both origin decision and frozen target snapshot. */
  async getOcrTypedFactCandidates(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<OcrTypedFactV2Read>> {
    if (!this.hasReadScope(actor)) return undefined;
    const client = await this.pool.connect();
    try {
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, run.object_id,
                object.api_id AS object_api_id,
                manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json
         FROM analysis_runs run
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      )).rows[0];
      if (!selected) return undefined;
      const persisted = await this.verifyOcrTypedFactCandidateArtifact(client, selected.run_id);
      if (persisted) return persisted;
      return this.deriveOcrTypedFactCandidates(client, checkId, selected);
    } finally {
      client.release();
    }
  }

  async recordOcrRowApplicabilityReviewCommand(
    checkId: string, input: OcrRowApplicabilityReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrRowApplicabilityReview>> {
    if (command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")) return { kind: "forbidden" };
    const operation = "OCR_ROW_APPLICABILITY_REVIEW";
    const targetId = `${checkId}:${input.sourceFileId}:${input.rowFingerprint}`;
    const requestHash = sha256(canonicalJson({ checkId, input }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, "OCR_ROW", targetId);
      const receipt = await this.getCommandReceipt<{ value: OcrRowApplicabilityReview }>(
        client, command, operation, "OCR_ROW", targetId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", value: receipt.response.value, replayed: true } as const;
      }
      const scope = await client.query<{
        run_id: string; object_id: string; object_api_id: string;
        inspection_id: string; active_run_id: string | null;
        run_state: string; manifest_hash: string;
        manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, object.id AS object_id,
                object.api_id AS object_api_id, inspection.id AS inspection_id,
                inspection.active_run_id, run.run_state,
                manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND inspection.lifecycle = 'OPEN'
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])
         FOR UPDATE OF inspection`,
        [this.organizationId, checkId, command.actor.userId],
      );
      const selected = scope.rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.active_run_id !== selected.run_id
        || !["SUCCEEDED", "PARTIAL"].includes(selected.run_state)) {
        return { kind: "invalid_state", code: "STALE_OCR_ROW",
          message: "Строка относится к старой или незавершённой проверке" } as const;
      }
      const loaded = await this.loadOcrRowApplicabilityContext(
        client, selected, input.sourceFileId, input.rowFingerprint);
      if (!loaded) return { kind: "invalid_state", code: "OCR_ROW_SCOPE_INVALID",
        message: "Источник, решения или OCR-строка не прошли проверку" } as const;
      loaded.context.targetCheckId = checkId;
      loaded.context.transcriptionSnapshot.targetCheckId = checkId;
      loaded.context.sourceReviewSnapshot.targetCheckId = checkId;
      const validated = validateOcrRowApplicabilityReview(input, loaded.context);
      if (!validated) return { kind: "invalid_state", code: "OCR_ROW_NOT_APPLICABLE",
        message: "Решение не соответствует проверенной строке и источнику" } as const;
      const contentHash = sha256(canonicalJson({ checkId,
        objectId: selected.object_api_id, ...validated, actorId: command.actor.userId }));
      const prior = await client.query<{ id: string; created_at: Date | string }>(
        `SELECT id, created_at FROM ocr_row_applicability_decisions
         WHERE run_id = $1 AND content_hash = $2 LIMIT 1`,
        [selected.run_id, contentHash],
      );
      const attempted = prior.rows[0] ? null : await client.query<{
        id: string; created_at: Date | string;
      }>(
        `INSERT INTO ocr_row_applicability_decisions (
           object_id, run_id, source_file_id, source_sha256,
           row_fingerprint_sha256, transcription_decision_id,
           source_review_decision_id, review_json, actor_id, content_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (run_id, content_hash) DO NOTHING
         RETURNING id, created_at`,
        [selected.object_id, selected.run_id, loaded.sourceInternalId,
          validated.provenance.sourceSha256, validated.provenance.rowFingerprint,
          loaded.transcriptionDecisionInternalId,
          loaded.sourceReviewDecisionInternalId, canonicalJson(validated),
          command.actor.userId, contentHash],
      );
      const created = Boolean(attempted?.rows[0]);
      const inserted = prior.rows[0] ?? attempted?.rows[0]
        ?? (await client.query<{ id: string; created_at: Date | string }>(
          `SELECT id, created_at FROM ocr_row_applicability_decisions
           WHERE run_id = $1 AND content_hash = $2`,
          [selected.run_id, contentHash])).rows[0];
      if (!inserted) throw new Error("OCR applicability decision conflict read failed");
      const value: OcrRowApplicabilityReview = { id: inserted.id, checkId,
        objectId: selected.object_api_id, ...validated,
        actorId: command.actor.userId, contentHash,
        createdAt: asIso(inserted.created_at) };
      await this.insertCommandReceipt(client, command, operation, "OCR_ROW",
        targetId, requestHash, 201, { value }, true);
      if (created) await this.appendAuditEvent(client, {
        command, objectId: selected.object_id, inspectionId: selected.inspection_id,
        action: operation, targetType: "OCR_ROW", targetId,
        beforeRef: null, afterRef: { decisionId: value.id, contentHash,
          runId: selected.run_id,
          rowFingerprint: validated.provenance.rowFingerprint,
          transcriptionDecisionId: loaded.transcriptionDecisionInternalId,
          sourceReviewDecisionId: loaded.sourceReviewDecisionInternalId },
        reason: validated.review.basis,
      });
      return { kind: "success", value, replayed: !created } as const;
    });
  }

  async getOcrRowApplicabilityReviews(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrRowApplicabilityReview[]; canReview: boolean;
    candidates: OcrRowApplicabilityCandidate[] }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const client = await this.pool.connect();
    try {
      const scope = await client.query<{
        run_id: string; object_id: string; object_api_id: string;
        active_run_id: string | null; run_state: string;
        inspection_lifecycle: string; can_review: boolean;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, object.id AS object_id,
                object.api_id AS object_api_id, inspection.active_run_id,
                inspection.lifecycle AS inspection_lifecycle, run.run_state,
                manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json,
                EXISTS (SELECT 1 FROM object_memberships reviewer
                  WHERE reviewer.object_id = object.id AND reviewer.user_id = $3
                    AND reviewer.revoked_at IS NULL
                    AND reviewer.permission_set @> ARRAY['REVIEW_DECIDE']::text[]) AS can_review
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      );
      const selected = scope.rows[0];
      if (!selected) return undefined;
      const rows = await client.query<{
        id: string; object_id: string; run_id: string;
        source_file_id: string; source_sha256: string;
        row_fingerprint_sha256: string; transcription_decision_id: string;
        source_review_decision_id: string; review_json: Record<string, unknown>;
        actor_id: string; content_hash: string; created_at: Date | string;
      }>(
        `SELECT * FROM ocr_row_applicability_decisions
         WHERE run_id = $1 AND object_id = $2 ORDER BY created_at, id`,
        [selected.run_id, selected.object_id],
      );
      const items: OcrRowApplicabilityReview[] = [];
      for (const row of rows.rows) {
        const stored = parseJson<Record<string, unknown>>(row.review_json);
        if (!isRecord(stored.review)) throw new Error("OCR applicability review integrity check failed");
        const review = stored.review as unknown as OcrRowApplicabilityReviewInput;
        const loaded = await this.loadOcrRowApplicabilityContext(
          client, selected, review.sourceFileId, review.rowFingerprint);
        if (!loaded || row.object_id !== selected.object_id
          || row.run_id !== selected.run_id
          || row.source_file_id !== loaded.sourceInternalId
          || row.source_sha256.trim() !== loaded.context.source.sourceSha256
          || row.row_fingerprint_sha256.trim() !== review.rowFingerprint
          || row.transcription_decision_id !== loaded.transcriptionDecisionInternalId
          || row.source_review_decision_id !== loaded.sourceReviewDecisionInternalId) {
          throw new Error("OCR applicability review origin integrity check failed");
        }
        loaded.context.targetCheckId = checkId;
        loaded.context.transcriptionSnapshot.targetCheckId = checkId;
        loaded.context.sourceReviewSnapshot.targetCheckId = checkId;
        const validated = validateOcrRowApplicabilityReview(review, loaded.context);
        if (!validated || canonicalJson(stored) !== canonicalJson(validated)) {
          throw new Error("OCR applicability review verification failed");
        }
        const contentHash = sha256(canonicalJson({ checkId,
          objectId: selected.object_api_id, ...validated, actorId: row.actor_id }));
        if (contentHash !== row.content_hash.trim()) {
          throw new Error("OCR applicability review hash mismatch");
        }
        items.push({ id: row.id, checkId, objectId: selected.object_api_id,
          ...validated, actorId: row.actor_id, contentHash,
          createdAt: asIso(row.created_at) });
      }
      const candidateRows = await client.query<{
        source_file_api_id: string; row_fingerprint_sha256: string;
      }>(
        `SELECT source.api_id AS source_file_api_id,
                transcription.row_fingerprint_sha256
         FROM run_ocr_transcription_snapshots transcription
         JOIN run_source_review_snapshots source_review
           ON source_review.run_id = transcription.run_id
             AND source_review.source_file_id = transcription.source_file_id
         JOIN source_files source ON source.id = transcription.source_file_id
           AND source.object_id = transcription.object_id
         WHERE transcription.run_id = $1 AND transcription.object_id = $2
         ORDER BY source.api_id, transcription.row_fingerprint_sha256`,
        [selected.run_id, selected.object_id],
      );
      const candidates: OcrRowApplicabilityCandidate[] = [];
      for (const candidateRow of candidateRows.rows) {
        const loaded = await this.loadOcrRowApplicabilityContext(client, selected,
          candidateRow.source_file_api_id, candidateRow.row_fingerprint_sha256.trim());
        if (!loaded) throw new Error("OCR applicability candidate integrity check failed");
        const context = loaded.context;
        context.targetCheckId = checkId;
        context.transcriptionSnapshot.targetCheckId = checkId;
        context.sourceReviewSnapshot.targetCheckId = checkId;
        const provenance = context.transcriptionSnapshot.provenance;
        const review = context.sourceReviewSnapshot.decision;
        const verified = validateOcrRowApplicabilityReview({
          schemaVersion: "ocr-row-applicability-review-v1", decision: "UNSURE",
          targetCheckId: checkId, sourceFileId: provenance.sourceFileId,
          sourceSha256: provenance.sourceSha256, pageNumber: provenance.pageNumber,
          renderSha256: provenance.renderSha256,
          ocrStageSha256: provenance.ocrStageSha256,
          rowFingerprint: provenance.rowFingerprint,
          transcriptionDecisionId: context.transcriptionSnapshot.decisionId,
          transcriptionDecisionHash: context.transcriptionSnapshot.decisionContentHash,
          sourceReviewDecisionId: context.sourceReviewSnapshot.decisionId,
          sourceReviewDecisionHash: context.sourceReviewSnapshot.decisionHash,
          parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA", stage: "PD",
          entityKey: "candidate-read-only", context: "Сверка сохранённых снимков",
          basis: "Проверка целостности кандидата без решения эксперта",
        }, context);
        if (!verified) throw new Error("OCR applicability candidate verification failed");
        const explicitPageStage = review.pageStages[String(provenance.pageNumber)] ?? null;
        const pageStage = context.source.stages.length === 1
          && Object.keys(review.pageStages).length === 0
          ? context.source.stages[0] : explicitPageStage;
        const eligibleStage = pageStage === "PD" || pageStage === "RD"
          ? pageStage : null;
        const sourceReady = context.transcriptionSnapshot.review.decision === "CONFIRMED_TRANSCRIPTION"
          && review.revisionStatus === "CURRENT" && review.approvalStatus === "APPROVED"
          && review.sectionCode !== null && eligibleStage !== null
          && context.source.stages.includes(eligibleStage)
          && (context.source.stages.length !== 1
            || Object.keys(review.pageStages).length === 0);
        const codeOptions: OcrRowApplicabilityCandidate["codeOptions"] = [];
        if (sourceReady && eligibleStage) {
          for (const [parameterCode, spec] of Object.entries(candidateFamilyPreviewSpecs)) {
            if (!candidateFamilyPreviewSections[parameterCode]?.[eligibleStage]
              .includes(review.sectionCode!)) continue;
            for (const attribute of Object.keys(spec.attributes)) {
              codeOptions.push({ parameterCode, attribute, stage: eligibleStage });
            }
          }
        }
        candidates.push({ sourceFileId: provenance.sourceFileId,
          sourceSha256: provenance.sourceSha256, pageNumber: provenance.pageNumber,
          renderSha256: provenance.renderSha256,
          ocrStageSha256: provenance.ocrStageSha256,
          rowFingerprint: provenance.rowFingerprint,
          transcriptionDecisionId: context.transcriptionSnapshot.decisionId,
          transcriptionDecisionHash: context.transcriptionSnapshot.decisionContentHash,
          sourceReviewDecisionId: context.sourceReviewSnapshot.decisionId,
          sourceReviewDecisionHash: context.sourceReviewSnapshot.decisionHash,
          transcriptionDecision: context.transcriptionSnapshot.review.decision,
          reviewedLabel: context.transcriptionSnapshot.review.reviewedLabel,
          reviewedValue: context.transcriptionSnapshot.review.reviewedValue,
          reviewedUnit: context.transcriptionSnapshot.review.reviewedUnit,
          sourceReview: { revisionStatus: review.revisionStatus,
            approvalStatus: review.approvalStatus, sectionCode: review.sectionCode,
            pageStage: pageStage as OcrRowApplicabilityCandidate["sourceReview"]["pageStage"] },
          codeOptions });
      }
      return { items, canReview: actor.capabilities.includes("REVIEW_DECIDE")
        && selected.can_review && selected.active_run_id === selected.run_id
        && selected.inspection_lifecycle === "OPEN"
        && ["SUCCEEDED", "PARTIAL"].includes(selected.run_state), candidates };
    } finally {
      client.release();
    }
  }

  private async loadOcrFactPairContext(client: PoolClient, selected: {
    run_id: string; object_id: string; object_api_id: string; check_id: string;
    manifest_hash: string; manifest_json: Record<string, unknown>;
  }, artifact: OcrTypedFactV2Read, pdFactId: string, rdFactId: string): Promise<{
    context: OcrFactPairReviewVerificationContext;
    pdSourceInternalId: string; rdSourceInternalId: string;
    pdSourceReviewDecisionId: string; rdSourceReviewDecisionId: string;
  } | null> {
    const pd = artifact.items.find((fact) => fact.factId === pdFactId);
    const rd = artifact.items.find((fact) => fact.factId === rdFactId);
    if (!pd || !rd || pd.stage !== "PD" || rd.stage !== "RD") return null;
    const pdLoaded = await this.loadOcrRowApplicabilityContext(client, selected,
      pd.sourceFileId, pd.locator.rowFingerprint);
    const rdLoaded = await this.loadOcrRowApplicabilityContext(client, selected,
      rd.sourceFileId, rd.locator.rowFingerprint);
    if (!pdLoaded || !rdLoaded) return null;
    const pdReview = pdLoaded.context.sourceReviewSnapshot;
    const rdReview = rdLoaded.context.sourceReviewSnapshot;
    if (pdReview.decisionId !== pd.locator.sourceReviewDecisionId
      || rdReview.decisionId !== rd.locator.sourceReviewDecisionId
      || pdReview.decisionHash !== pd.locator.sourceReviewDecisionHash
      || rdReview.decisionHash !== rd.locator.sourceReviewDecisionHash) return null;
    const artifactHash = sha256(canonicalJson(artifact));
    return {
      context: {
        targetCheckId: selected.check_id,
        inputManifestHash: selected.manifest_hash.trim(),
        objectId: selected.object_api_id,
        releaseProfile: "ocr-typed-fact-candidates-v1",
        artifact: { content: artifact, contentHash: artifactHash },
        sourceReviews: {
          PD: { targetCheckId: selected.check_id, decision: pdReview.decision },
          RD: { targetCheckId: selected.check_id, decision: rdReview.decision },
        },
      },
      pdSourceInternalId: pdLoaded.sourceInternalId,
      rdSourceInternalId: rdLoaded.sourceInternalId,
      pdSourceReviewDecisionId: pdReview.decisionId,
      rdSourceReviewDecisionId: rdReview.decisionId,
    };
  }

  private async verifyStoredOcrFactPairDecision(client: PoolClient,
    row: OcrFactPairDecisionRow, objectApiId: string) {
    const origin = (await client.query<{
      run_id: string; object_id: string; object_api_id: string; check_id: string;
      manifest_hash: string; manifest_json: Record<string, unknown>;
    }>(
      `SELECT run.id AS run_id, run.object_id,
              object.api_id AS object_api_id, run.api_id AS check_id,
              manifest.sha256 AS manifest_hash,
              manifest.canonical_json AS manifest_json
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN input_manifests manifest ON manifest.id = run.manifest_id
       WHERE run.id = $1 AND run.object_id = $2`,
      [row.run_id, row.object_id],
    )).rows[0];
    if (!origin || origin.object_api_id !== objectApiId
      || !isRecord(row.review_json) || !isRecord(row.review_json.review)) {
      throw new Error("OCR fact pair decision origin integrity check failed");
    }
    const input = row.review_json.review as unknown as OcrFactPairReviewInput;
    if (input.targetCheckId !== origin.check_id) {
      throw new Error("OCR fact pair decision run integrity check failed");
    }
    const artifact = await this.verifyOcrTypedFactCandidateArtifact(client, origin.run_id);
    if (!artifact) throw new Error("OCR fact pair origin artifact missing");
    const loaded = await this.loadOcrFactPairContext(client, origin, artifact,
      input.pdFactId, input.rdFactId);
    const validated = loaded && validateOcrFactPairReview(input, loaded.context);
    if (!loaded || !validated
      || row.input_manifest_hash.trim() !== origin.manifest_hash.trim()
      || row.artifact_hash.trim() !== loaded.context.artifact.contentHash
      || row.parameter_code !== input.parameterCode
      || row.attribute !== input.attribute || row.entity_key !== input.entityKey
      || row.pd_fact_id.trim() !== input.pdFactId
      || row.rd_fact_id.trim() !== input.rdFactId
      || row.pd_locator_hash.trim() !== input.pdLocatorHash
      || row.rd_locator_hash.trim() !== input.rdLocatorHash
      || row.pd_source_file_id !== loaded.pdSourceInternalId
      || row.rd_source_file_id !== loaded.rdSourceInternalId
      || row.pd_source_review_decision_id !== loaded.pdSourceReviewDecisionId
      || row.rd_source_review_decision_id !== loaded.rdSourceReviewDecisionId
      || canonicalJson(row.review_json) !== canonicalJson(validated)
      || sha256(canonicalJson({ checkId: origin.check_id,
        objectId: origin.object_api_id, ...validated, actorId: row.actor_id }))
        !== row.content_hash.trim()) {
      throw new Error("OCR fact pair decision provenance integrity check failed");
    }
    const pd = artifact.items.find((fact) => fact.factId === input.pdFactId)!;
    const rd = artifact.items.find((fact) => fact.factId === input.rdFactId)!;
    const subjectHash = sha256(canonicalJson([
      row.pd_source_file_id, pd.locator.rowFingerprint,
      row.rd_source_file_id, rd.locator.rowFingerprint,
      input.parameterCode, input.attribute, input.entityKey, input.context,
    ]));
    return { origin, input, validated, artifact, loaded, pd, rd, subjectHash };
  }

  /** Current-run pair judgments supersede the pair snapshot frozen at run start. */
  private async currentRunOcrFactPairSubjects(client: PoolClient,
    selected: { run_id: string; object_id: string; object_api_id: string },
  ): Promise<Set<string>> {
    const rows = await client.query<OcrFactPairDecisionRow>(
      `SELECT * FROM ocr_fact_pair_decisions
       WHERE run_id = $1 AND object_id = $2
       ORDER BY created_at, id LIMIT 1025`,
      [selected.run_id, selected.object_id],
    );
    if (rows.rows.length > 1024) {
      throw new Error("OCR current-run pair decision limit exceeded");
    }
    const subjects = new Set<string>();
    for (const row of rows.rows) {
      const checked = await this.verifyStoredOcrFactPairDecision(
        client, row, selected.object_api_id);
      subjects.add(checked.subjectHash);
    }
    return subjects;
  }

  private async rebindOcrFactPairDecision(client: PoolClient,
    target: { run_id: string; object_id: string; object_api_id: string;
      check_id: string; manifest_hash: string; manifest_json: Record<string, unknown> },
    targetArtifact: OcrTypedFactV2Read,
    origin: Awaited<ReturnType<PostgresInspectionRepository[
      "verifyStoredOcrFactPairDecision"]>>,
    row: OcrFactPairDecisionRow) {
    const match = (stage: "PD" | "RD", sourceFileId: string,
      sourceSha256: string, fingerprint: string) => targetArtifact.items.filter((fact) =>
      fact.stage === stage && fact.sourceFileId === sourceFileId
      && fact.sourceSha256 === sourceSha256
      && fact.locator.rowFingerprint === fingerprint
      && fact.parameterCode === origin.input.parameterCode
      && fact.attribute === origin.input.attribute
      && fact.entityKey === origin.input.entityKey
      && fact.context === origin.input.context);
    const pdMatches = match("PD", origin.pd.sourceFileId, origin.pd.sourceSha256,
      origin.pd.locator.rowFingerprint);
    const rdMatches = match("RD", origin.rd.sourceFileId, origin.rd.sourceSha256,
      origin.rd.locator.rowFingerprint);
    if (pdMatches.length !== 1 || rdMatches.length !== 1) return null;
    const [pd] = pdMatches;
    const [rd] = rdMatches;
    const loaded = await this.loadOcrFactPairContext(client, target, targetArtifact,
      pd.factId, rd.factId);
    if (!loaded || loaded.pdSourceInternalId !== row.pd_source_file_id
      || loaded.rdSourceInternalId !== row.rd_source_file_id
      || loaded.pdSourceReviewDecisionId !== row.pd_source_review_decision_id
      || loaded.rdSourceReviewDecisionId !== row.rd_source_review_decision_id) return null;
    const review: OcrFactPairReviewInput = {
      ...origin.input, targetCheckId: target.check_id,
      inputManifestHash: target.manifest_hash.trim(),
      pdFactId: pd.factId, pdLocatorHash: sha256(canonicalJson(pd.locator)),
      rdFactId: rd.factId, rdLocatorHash: sha256(canonicalJson(rd.locator)),
    };
    const validated = validateOcrFactPairReview(review, loaded.context);
    if (!validated) return null;
    const targetReviewHash = sha256(canonicalJson({
      checkId: target.check_id, objectId: target.object_api_id,
      ...validated, actorId: row.actor_id,
    }));
    return { review, validated, targetReviewHash };
  }

  private async snapshotOcrFactPairDecisions(client: PoolClient,
    target: { run_id: string; object_id: string; object_api_id: string;
      check_id: string; manifest_hash: string; manifest_json: Record<string, unknown> },
    sourceInternalIds: string[]): Promise<void> {
    if (sourceInternalIds.length < 2) return;
    const targetArtifact = await this.verifyOcrTypedFactCandidateArtifact(client, target.run_id);
    if (!targetArtifact) throw new Error("OCR fact pair target artifact missing");
    const rows = await client.query<OcrFactPairDecisionRow>(
      `SELECT * FROM ocr_fact_pair_decisions
       WHERE object_id = $1 AND pd_source_file_id = ANY($2::uuid[])
         AND rd_source_file_id = ANY($2::uuid[])
       ORDER BY created_at DESC, id DESC LIMIT 1025`,
      [target.object_id, sourceInternalIds],
    );
    if (rows.rows.length > 1024) {
      throw new Error("OCR fact pair decision snapshot limit exceeded");
    }
    const selected = new Set<string>();
    for (const row of rows.rows) {
      if (row.run_id === target.run_id) continue;
      const origin = await this.verifyStoredOcrFactPairDecision(
        client, row, target.object_api_id);
      if (selected.has(origin.subjectHash)) continue;
      selected.add(origin.subjectHash);
      const rebound = await this.rebindOcrFactPairDecision(
        client, target, targetArtifact, origin, row);
      const reasonCode = rebound ? "REBOUND" : "TARGET_FACT_UNAVAILABLE";
      const targetArtifactHash = sha256(canonicalJson(targetArtifact));
      await client.query(
        `INSERT INTO run_ocr_fact_pair_snapshots (
           run_id, object_id, subject_hash, decision_id, decision_content_hash,
           origin_run_id, pd_source_file_id, rd_source_file_id,
           pd_source_sha256, rd_source_sha256,
           pd_row_fingerprint, rd_row_fingerprint,
           pd_source_review_decision_id, rd_source_review_decision_id,
           target_artifact_hash, origin_review_json,
           target_review_json, target_review_hash,
           eligible_for_pair_review, reason_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11, $12, $13, $14, $15, $16::jsonb,
                   $17::jsonb, $18, $19, $20)`,
        [target.run_id, target.object_id, origin.subjectHash,
          row.id, row.content_hash.trim(), row.run_id,
          row.pd_source_file_id, row.rd_source_file_id,
          origin.pd.sourceSha256, origin.rd.sourceSha256,
          origin.pd.locator.rowFingerprint, origin.rd.locator.rowFingerprint,
          row.pd_source_review_decision_id, row.rd_source_review_decision_id,
          targetArtifactHash, canonicalJson(origin.validated),
          rebound ? canonicalJson(rebound.validated) : null,
          rebound?.targetReviewHash ?? null,
          rebound?.validated.eligibleForPairReview ?? false,
          reasonCode],
      );
    }
  }

  async recordOcrFactPairReviewCommand(
    checkId: string, input: OcrFactPairReviewInput, command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrFactPairReview>> {
    if (command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")) return { kind: "forbidden" };
    const operation = "OCR_FACT_PAIR_REVIEW";
    const targetId = `${checkId}:${sha256(canonicalJson([input.pdFactId, input.rdFactId]))}`;
    const requestHash = sha256(canonicalJson({ checkId, input }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, "OCR_FACT_PAIR", targetId);
      const receipt = await this.getCommandReceipt<{ value: OcrFactPairReview }>(
        client, command, operation, "OCR_FACT_PAIR", targetId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", value: receipt.response.value, replayed: true } as const;
      }
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string; check_id: string;
        inspection_id: string; active_run_id: string | null; run_state: string;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, run.api_id AS check_id, object.id AS object_id,
                object.api_id AS object_api_id, inspection.id AS inspection_id,
                inspection.active_run_id, run.run_state,
                manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND inspection.lifecycle = 'OPEN'
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])
         FOR UPDATE OF inspection`,
        [this.organizationId, checkId, command.actor.userId],
      )).rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.active_run_id !== selected.run_id
        || !["SUCCEEDED", "PARTIAL"].includes(selected.run_state)) {
        return { kind: "invalid_state", code: "STALE_OCR_FACT_PAIR",
          message: "Пара относится к старой или незавершённой проверке" } as const;
      }
      const artifact = await this.verifyOcrTypedFactCandidateArtifact(client, selected.run_id);
      if (!artifact) return { kind: "invalid_state", code: "OCR_FACT_PAIR_PROFILE_DISABLED",
        message: "Проверенный OCR-факт недоступен в профиле запуска" } as const;
      const loaded = await this.loadOcrFactPairContext(client, selected, artifact,
        input.pdFactId, input.rdFactId);
      const validated = loaded && validateOcrFactPairReview(input, loaded.context);
      if (!loaded || !validated) return { kind: "invalid_state",
        code: "OCR_FACT_PAIR_NOT_VERIFIED",
        message: "Пара не соответствует проверенным фактам и источникам" } as const;
      const contentHash = sha256(canonicalJson({ checkId,
        objectId: selected.object_api_id, ...validated, actorId: command.actor.userId }));
      const prior = (await client.query<{ id: string; created_at: Date | string }>(
        `SELECT id, created_at FROM ocr_fact_pair_decisions
         WHERE run_id = $1 AND content_hash = $2 LIMIT 1`,
        [selected.run_id, contentHash],
      )).rows[0];
      const attempted = prior ? null : (await client.query<{
        id: string; created_at: Date | string;
      }>(
        `INSERT INTO ocr_fact_pair_decisions (
           object_id, run_id, input_manifest_hash, artifact_hash,
           parameter_code, attribute, entity_key, pd_fact_id, rd_fact_id,
           pd_locator_hash, rd_locator_hash, pd_source_file_id, rd_source_file_id,
           pd_source_review_decision_id, rd_source_review_decision_id,
           review_json, actor_id, content_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, $13, $14, $15, $16::jsonb, $17, $18)
         ON CONFLICT (run_id, content_hash) DO NOTHING RETURNING id, created_at`,
        [selected.object_id, selected.run_id, selected.manifest_hash.trim(),
          loaded.context.artifact.contentHash, input.parameterCode, input.attribute,
          input.entityKey, input.pdFactId, input.rdFactId,
          input.pdLocatorHash, input.rdLocatorHash,
          loaded.pdSourceInternalId, loaded.rdSourceInternalId,
          loaded.pdSourceReviewDecisionId, loaded.rdSourceReviewDecisionId,
          canonicalJson(validated), command.actor.userId, contentHash],
      )).rows[0];
      const created = Boolean(attempted);
      const inserted = prior ?? attempted ?? (await client.query<{
        id: string; created_at: Date | string;
      }>(`SELECT id, created_at FROM ocr_fact_pair_decisions
          WHERE run_id = $1 AND content_hash = $2`, [selected.run_id, contentHash])).rows[0];
      if (!inserted) throw new Error("OCR fact pair decision conflict read failed");
      const value: OcrFactPairReview = { id: inserted.id, checkId,
        objectId: selected.object_api_id, ...validated,
        actorId: command.actor.userId, contentHash, createdAt: asIso(inserted.created_at) };
      await this.insertCommandReceipt(client, command, operation, "OCR_FACT_PAIR",
        targetId, requestHash, 201, { value }, true);
      if (created) await this.appendAuditEvent(client, {
        command, objectId: selected.object_id, inspectionId: selected.inspection_id,
        action: operation, targetType: "OCR_FACT_PAIR", targetId,
        beforeRef: null, afterRef: { decisionId: value.id, contentHash,
          runId: selected.run_id, pdFactId: input.pdFactId, rdFactId: input.rdFactId,
          artifactHash: loaded.context.artifact.contentHash },
        reason: input.basis,
      });
      return { kind: "success", value, replayed: !created } as const;
    });
  }

  async getOcrFactPairReviews(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrFactPairReview[]; canReview: boolean;
    candidates: OcrFactPairCandidate[] }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const client = await this.pool.connect();
    try {
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string; check_id: string;
        active_run_id: string | null; run_state: string;
        inspection_lifecycle: string; can_review: boolean;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, run.api_id AS check_id,
                object.id AS object_id, object.api_id AS object_api_id,
                inspection.active_run_id, inspection.lifecycle AS inspection_lifecycle,
                run.run_state, manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json,
                EXISTS (SELECT 1 FROM object_memberships reviewer
                  WHERE reviewer.object_id = object.id AND reviewer.user_id = $3
                    AND reviewer.revoked_at IS NULL
                    AND reviewer.permission_set @> ARRAY['REVIEW_DECIDE']::text[]) AS can_review
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      )).rows[0];
      if (!selected) return undefined;
      const artifact = await this.verifyOcrTypedFactCandidateArtifact(client, selected.run_id);
      const rows = await client.query<OcrFactPairDecisionRow>(
        `SELECT * FROM ocr_fact_pair_decisions
         WHERE run_id = $1 AND object_id = $2 ORDER BY created_at, id`,
        [selected.run_id, selected.object_id],
      );
      if (!artifact && rows.rows.length > 0) {
        throw new Error("OCR fact pair decisions outside pinned release");
      }
      const items: OcrFactPairReview[] = [];
      for (const row of rows.rows) {
        if (!artifact || !isRecord(row.review_json)
          || !isRecord(row.review_json.review)) {
          throw new Error("OCR fact pair decision integrity check failed");
        }
        const input = row.review_json.review as unknown as OcrFactPairReviewInput;
        const loaded = await this.loadOcrFactPairContext(client, selected, artifact,
          input.pdFactId, input.rdFactId);
        const validated = loaded && validateOcrFactPairReview(input, loaded.context);
        if (!loaded || !validated
          || row.run_id !== selected.run_id || row.object_id !== selected.object_id
          || row.input_manifest_hash.trim() !== selected.manifest_hash.trim()
          || row.artifact_hash.trim() !== loaded.context.artifact.contentHash
          || row.parameter_code !== input.parameterCode
          || row.attribute !== input.attribute || row.entity_key !== input.entityKey
          || row.pd_fact_id.trim() !== input.pdFactId
          || row.rd_fact_id.trim() !== input.rdFactId
          || row.pd_locator_hash.trim() !== input.pdLocatorHash
          || row.rd_locator_hash.trim() !== input.rdLocatorHash
          || row.pd_source_file_id !== loaded.pdSourceInternalId
          || row.rd_source_file_id !== loaded.rdSourceInternalId
          || row.pd_source_review_decision_id !== loaded.pdSourceReviewDecisionId
          || row.rd_source_review_decision_id !== loaded.rdSourceReviewDecisionId
          || canonicalJson(row.review_json) !== canonicalJson(validated)) {
          throw new Error("OCR fact pair decision provenance integrity check failed");
        }
        const contentHash = sha256(canonicalJson({ checkId,
          objectId: selected.object_api_id, ...validated, actorId: row.actor_id }));
        if (contentHash !== row.content_hash.trim()) {
          throw new Error("OCR fact pair decision hash integrity check failed");
        }
        items.push({ id: row.id, checkId, objectId: selected.object_api_id,
          ...validated, actorId: row.actor_id, contentHash,
          createdAt: asIso(row.created_at) });
      }
      const candidates: OcrFactPairCandidate[] = [];
      if (artifact) {
        if (new Set(artifact.items.map((fact) => fact.factId)).size !== artifact.items.length) {
          throw new Error("OCR fact pair duplicate fact ID");
        }
        for (const pd of artifact.items.filter((fact) => fact.stage === "PD")) {
          for (const rd of artifact.items.filter((fact) => fact.stage === "RD")) {
            if (pd.parameterCode !== rd.parameterCode || pd.attribute !== rd.attribute
              || pd.entityKey !== rd.entityKey || pd.context !== rd.context
              || pd.sourceSha256 === rd.sourceSha256) continue;
            const loaded = await this.loadOcrFactPairContext(client, selected, artifact,
              pd.factId, rd.factId);
            if (!loaded) throw new Error("OCR fact pair candidate integrity check failed");
            const linkGroupId = loaded.context.sourceReviews.PD.decision.linkGroupId;
            if (!linkGroupId) continue;
            const input: OcrFactPairReviewInput = {
              schemaVersion: "ocr-fact-pair-review-v1", decision: "UNSURE",
              targetCheckId: checkId, inputManifestHash: selected.manifest_hash.trim(),
              objectId: selected.object_api_id, parameterCode: pd.parameterCode,
              attribute: pd.attribute, pdFactId: pd.factId,
              pdLocatorHash: sha256(canonicalJson(pd.locator)),
              rdFactId: rd.factId, rdLocatorHash: sha256(canonicalJson(rd.locator)),
              entityKey: pd.entityKey, context: pd.context, linkGroupId,
              basis: "Проверка целостности кандидата без решения эксперта",
            };
            if (!validateOcrFactPairReview(input, loaded.context)) continue;
            candidates.push({ parameterCode: pd.parameterCode,
              attribute: pd.attribute, entityKey: pd.entityKey, context: pd.context,
              linkGroupId, pdFact: pd, rdFact: rd,
              pdLocatorHash: input.pdLocatorHash,
              rdLocatorHash: input.rdLocatorHash,
              artifactHash: loaded.context.artifact.contentHash });
            if (candidates.length > 512) {
              throw new Error("OCR fact pair candidate limit exceeded");
            }
          }
        }
      }
      return { items, canReview: actor.capabilities.includes("REVIEW_DECIDE")
        && selected.can_review && selected.active_run_id === selected.run_id
        && selected.inspection_lifecycle === "OPEN"
        && ["SUCCEEDED", "PARTIAL"].includes(selected.run_state)
        && artifact !== null, candidates };
    } finally {
      client.release();
    }
  }

  async getOcrFactPairSnapshots(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrFactPairSnapshot[] }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const client = await this.pool.connect();
    try {
      const target = (await client.query<{
        run_id: string; object_id: string; object_api_id: string; check_id: string;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, run.api_id AS check_id,
                run.object_id, object.api_id AS object_api_id,
                manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json
         FROM analysis_runs run
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      )).rows[0];
      if (!target) return undefined;
      const artifact = await this.verifyOcrTypedFactCandidateArtifact(client, target.run_id);
      const rows = await client.query<OcrFactPairSnapshotRow>(
        `SELECT * FROM run_ocr_fact_pair_snapshots
         WHERE run_id = $1 AND object_id = $2 ORDER BY subject_hash`,
        [target.run_id, target.object_id],
      );
      if (!artifact && rows.rows.length > 0) {
        throw new Error("OCR fact pair snapshot outside pinned release");
      }
      const items: OcrFactPairSnapshot[] = [];
      for (const snapshot of rows.rows) {
        if (!artifact) throw new Error("OCR fact pair snapshot target artifact missing");
        const originRow = (await client.query<OcrFactPairDecisionRow>(
          `SELECT * FROM ocr_fact_pair_decisions WHERE id = $1`,
          [snapshot.decision_id],
        )).rows[0];
        if (!originRow || originRow.run_id !== snapshot.origin_run_id
          || originRow.object_id !== target.object_id
          || originRow.pd_source_file_id !== snapshot.pd_source_file_id
          || originRow.rd_source_file_id !== snapshot.rd_source_file_id
          || originRow.pd_source_review_decision_id
            !== snapshot.pd_source_review_decision_id
          || originRow.rd_source_review_decision_id
            !== snapshot.rd_source_review_decision_id
          || originRow.content_hash.trim() !== snapshot.decision_content_hash.trim()) {
          throw new Error("OCR fact pair snapshot origin integrity check failed");
        }
        const origin = await this.verifyStoredOcrFactPairDecision(
          client, originRow, target.object_api_id);
        if (snapshot.run_id !== target.run_id || snapshot.object_id !== target.object_id
          || snapshot.subject_hash.trim() !== origin.subjectHash
          || snapshot.pd_source_sha256.trim() !== origin.pd.sourceSha256
          || snapshot.rd_source_sha256.trim() !== origin.rd.sourceSha256
          || snapshot.pd_row_fingerprint.trim()
            !== origin.pd.locator.rowFingerprint
          || snapshot.rd_row_fingerprint.trim()
            !== origin.rd.locator.rowFingerprint
          || snapshot.target_artifact_hash.trim() !== sha256(canonicalJson(artifact))
          || canonicalJson(snapshot.origin_review_json)
            !== canonicalJson(origin.validated)) {
          throw new Error("OCR fact pair snapshot lineage integrity check failed");
        }
        const rebound = await this.rebindOcrFactPairDecision(
          client, target, artifact, origin, originRow);
        const reasonCode = rebound ? "REBOUND" : "TARGET_FACT_UNAVAILABLE";
        if (snapshot.reason_code !== reasonCode
          || snapshot.eligible_for_pair_review
            !== (rebound?.validated.eligibleForPairReview ?? false)
          || (rebound ? snapshot.target_review_hash?.trim()
            !== rebound.targetReviewHash : snapshot.target_review_hash !== null)
          || (rebound ? canonicalJson(snapshot.target_review_json)
            !== canonicalJson(rebound.validated) : snapshot.target_review_json !== null)) {
          throw new Error("OCR fact pair snapshot target integrity check failed");
        }
        items.push({ decisionId: originRow.id,
          decisionContentHash: originRow.content_hash.trim(),
          originCheckId: origin.origin.check_id,
          targetCheckId: checkId, actorId: originRow.actor_id,
          originReview: origin.input,
          review: rebound?.review ?? null,
          targetReviewHash: rebound?.targetReviewHash ?? null,
          provenance: rebound?.validated.provenance ?? null,
          eligibleForPairReview: rebound?.validated.eligibleForPairReview ?? false,
          reasonCode });
      }
      return { items };
    } finally {
      client.release();
    }
  }

  async getOcrFactPairQuantityReviews(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrFactPairQuantityReview[];
    effectiveItems: OcrFactPairQuantityReview[];
    candidates: OcrFactPairQuantityCandidate[];
    canReview: boolean; reasonCode: string | null }>> {
    if (!this.hasReadScope(actor)) return undefined;
    // This independent read verifies origin decisions, immutable snapshots and rebinding.
    const verified = await this.getOcrFactPairSnapshots(checkId, actor);
    if (!verified || typeof verified === "string") return verified;
    const client = await this.pool.connect();
    try {
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string; check_id: string;
        manifest_hash: string; manifest_json: Record<string, unknown>;
        active_run_id: string | null; run_state: string;
        inspection_lifecycle: string; can_review: boolean;
      }>(
        `SELECT run.id AS run_id, run.api_id AS check_id,
                object.id AS object_id, object.api_id AS object_api_id,
                manifest.sha256 AS manifest_hash, manifest.canonical_json AS manifest_json,
                inspection.active_run_id, run.run_state,
                inspection.lifecycle AS inspection_lifecycle,
                EXISTS (SELECT 1 FROM object_memberships reviewer
                  WHERE reviewer.object_id = object.id AND reviewer.user_id = $3
                    AND reviewer.revoked_at IS NULL
                    AND reviewer.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])
                  AS can_review
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      )).rows[0];
      if (!selected) return undefined;
      const artifact = await this.verifyOcrTypedFactCandidateArtifact(client, selected.run_id);
      const snapshotRows = await client.query<OcrFactPairSnapshotRow>(
        `SELECT * FROM run_ocr_fact_pair_snapshots
         WHERE run_id = $1 AND object_id = $2 ORDER BY subject_hash LIMIT 513`,
        [selected.run_id, selected.object_id],
      );
      if (snapshotRows.rows.length > 512
        || snapshotRows.rows.length !== verified.items.length) {
        throw new Error("OCR quantity snapshot set integrity check failed");
      }
      const byDecision = new Map(verified.items.map((item) => [item.decisionId, item]));
      const rowByDecision = new Map(snapshotRows.rows.map((row) => [row.decision_id, row]));
      if (byDecision.size !== verified.items.length
        || rowByDecision.size !== snapshotRows.rows.length
        || [...byDecision.keys()].some((id) => !rowByDecision.has(id))) {
        throw new Error("OCR quantity snapshot identity check failed");
      }
      const currentPairSubjects = await this.currentRunOcrFactPairSubjects(
        client, selected);
      const candidates: OcrFactPairQuantityCandidate[] = [];
      if (artifact) for (const snapshot of verified.items) {
        const review = snapshot.review;
        const storedSnapshot = rowByDecision.get(snapshot.decisionId);
        if (snapshot.reasonCode !== "REBOUND" || !snapshot.eligibleForPairReview
          || review?.decision !== "PAIR_CONFIRMED" || !snapshot.targetReviewHash
          || !storedSnapshot
          || currentPairSubjects.has(storedSnapshot.subject_hash.trim())
          || !ocrFactPairQuantityCatalogFor(review.parameterCode, review.attribute)) continue;
        const pdFact = artifact.items.find((fact) => fact.factId === review.pdFactId);
        const rdFact = artifact.items.find((fact) => fact.factId === review.rdFactId);
        const loaded = await this.loadOcrFactPairContext(client, selected, artifact,
          review.pdFactId, review.rdFactId);
        const checked = loaded && validateOcrFactPairReview(review, loaded.context);
        if (!pdFact || !rdFact || !checked || !checked.eligibleForPairReview
          || sha256(canonicalJson({ checkId, objectId: selected.object_api_id,
            ...checked, actorId: snapshot.actorId })) !== snapshot.targetReviewHash) {
          throw new Error("OCR quantity candidate integrity check failed");
        }
        candidates.push({ pairSnapshot: snapshot, pdFact, rdFact });
      }
      const rows = await client.query<OcrFactPairQuantityDecisionRow>(
        `SELECT * FROM ocr_fact_pair_quantity_decisions
         WHERE run_id = $1 AND object_id = $2
         ORDER BY created_at, id LIMIT 1025`,
        [selected.run_id, selected.object_id],
      );
      if (rows.rows.length > 1024) throw new Error("OCR quantity decision limit exceeded");
      const items: OcrFactPairQuantityReview[] = [];
      for (const row of rows.rows) {
        const snapshot = byDecision.get(row.pair_decision_id);
        const snapshotRow = rowByDecision.get(row.pair_decision_id);
        if (!artifact || !snapshot || !snapshotRow || !isRecord(row.review_json)
          || !isRecord(row.review_json.review)) {
          throw new Error("OCR quantity decision integrity check failed");
        }
        const input = row.review_json.review as unknown as OcrFactPairQuantityReviewInput;
        const loaded = await this.loadOcrFactPairContext(client, selected, artifact,
          input.pdFactId, input.rdFactId);
        const catalog = ocrFactPairQuantityCatalogFor(input.parameterCode, input.attribute);
        const validated = loaded && catalog && validateOcrFactPairQuantityReview(input,
          { pair: loaded.context, snapshots: verified.items,
            latestDecisionId: row.pair_decision_id, catalog });
        if (!validated || row.object_id !== selected.object_id
          || row.run_id !== selected.run_id
          || row.input_manifest_hash.trim() !== selected.manifest_hash.trim()
          || row.artifact_hash.trim() !== validated.provenance.artifactHash
          || row.pair_subject_hash.trim() !== snapshotRow.subject_hash.trim()
          || row.pair_decision_id !== input.pairDecisionId
          || row.target_review_hash.trim() !== input.pairTargetReviewHash
          || row.pd_fact_id.trim() !== input.pdFactId
          || row.rd_fact_id.trim() !== input.rdFactId
          || row.pd_locator_hash.trim() !== input.pdLocatorHash
          || row.rd_locator_hash.trim() !== input.rdLocatorHash
          || row.evidence_hash.trim() !== validated.evidenceHash
          || canonicalJson(row.review_json) !== canonicalJson(validated)) {
          throw new Error("OCR quantity decision provenance integrity check failed");
        }
        const contentHash = sha256(canonicalJson({ checkId,
          objectId: selected.object_api_id, ...validated, actorId: row.actor_id }));
        if (row.content_hash.trim() !== contentHash) {
          throw new Error("OCR quantity decision hash integrity check failed");
        }
        items.push({ id: row.id, checkId, objectId: selected.object_api_id,
          ...validated, actorId: row.actor_id, contentHash,
          createdAt: asIso(row.created_at) });
      }
      const latest = new Map<string, OcrFactPairQuantityReview>();
      for (const item of items) latest.set(item.review.pairDecisionId, item);
      const effectiveItems = [...latest.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([, item]) => item);
      const currentPairJournal = await client.query<{ decision: string }>(
        `SELECT review_json #>> '{review,decision}' AS decision
         FROM ocr_fact_pair_decisions
         WHERE run_id = $1 AND object_id = $2
         ORDER BY created_at DESC, id DESC LIMIT 1025`,
        [selected.run_id, selected.object_id],
      );
      if (currentPairJournal.rows.length > 1024) {
        throw new Error("OCR quantity current pair journal limit exceeded");
      }
      const scopeReady = actor.capabilities.includes("REVIEW_DECIDE")
        && selected.can_review && selected.active_run_id === selected.run_id
        && selected.inspection_lifecycle === "OPEN"
        && ["SUCCEEDED", "PARTIAL"].includes(selected.run_state);
      const canReview = scopeReady && candidates.length > 0;
      const superseded = snapshotRows.rows.some((row) =>
        currentPairSubjects.has(row.subject_hash.trim()));
      const reasonCode = canReview ? null : !scopeReady
        ? "STALE_OCR_QUANTITY_RUN"
        : superseded ? "OCR_QUANTITY_SNAPSHOT_REQUIRED"
        : currentPairJournal.rows.some((row) => row.decision === "PAIR_CONFIRMED")
          && candidates.length === 0
          ? "OCR_QUANTITY_SNAPSHOT_REQUIRED" : "NO_VERIFIED_PAIR_SNAPSHOT";
      return { items, effectiveItems, candidates, canReview, reasonCode };
    } finally {
      client.release();
    }
  }

  async getOcrFactPairComparisonPreviews(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: { quantityDecisionId: string;
    preview: OcrFactPairComparisonPreview }[] }>> {
    if (!this.hasReadScope(actor)) return undefined;
    // Both reads independently verify stored journal lineage and immutable pair snapshots.
    const quantity = await this.getOcrFactPairQuantityReviews(checkId, actor);
    if (!quantity || typeof quantity === "string") return quantity;
    if (quantity.effectiveItems.length === 0) return { items: [] };
    const verified = await this.getOcrFactPairSnapshots(checkId, actor);
    if (!verified || typeof verified === "string") return verified;
    const client = await this.pool.connect();
    try {
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string; check_id: string;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, run.api_id AS check_id,
                object.id AS object_id, object.api_id AS object_api_id,
                manifest.sha256 AS manifest_hash, manifest.canonical_json AS manifest_json
         FROM analysis_runs run
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ']::text[])`,
        [this.organizationId, checkId, actor.userId],
      )).rows[0];
      if (!selected) return undefined;
      const artifact = await this.verifyOcrTypedFactCandidateArtifact(client, selected.run_id);
      if (!artifact) throw new Error("OCR comparison typed artifact missing");
      const snapshotRows = await client.query<OcrFactPairSnapshotRow>(
        `SELECT * FROM run_ocr_fact_pair_snapshots
         WHERE run_id = $1 AND object_id = $2 ORDER BY subject_hash LIMIT 513`,
        [selected.run_id, selected.object_id],
      );
      if (snapshotRows.rows.length > 512
        || snapshotRows.rows.length !== verified.items.length) {
        throw new Error("OCR comparison snapshot set integrity check failed");
      }
      const snapshotSubjects = new Map(snapshotRows.rows.map((row) =>
        [row.decision_id, row.subject_hash.trim()]));
      if (snapshotSubjects.size !== verified.items.length
        || verified.items.some((item) => !snapshotSubjects.has(item.decisionId))) {
        throw new Error("OCR comparison snapshot identity check failed");
      }
      const currentPairSubjects = await this.currentRunOcrFactPairSubjects(client, selected);
      const items: { quantityDecisionId: string;
        preview: OcrFactPairComparisonPreview }[] = [];
      for (const item of quantity.effectiveItems) {
        const review = item.review;
        const snapshot = verified.items.find((entry) =>
          entry.decisionId === review.pairDecisionId);
        const catalog = ocrFactPairQuantityCatalogFor(review.parameterCode, review.attribute);
        const loaded = await this.loadOcrFactPairContext(client, selected, artifact,
          review.pdFactId, review.rdFactId);
        if (!snapshot || !catalog || !loaded || review.targetCheckId !== checkId
          || review.inputManifestHash !== selected.manifest_hash.trim()
          || review.objectId !== selected.object_api_id) {
          throw new Error("OCR comparison quantity scope integrity check failed");
        }
        const validated = validateOcrFactPairQuantityReview(review, {
          pair: loaded.context, snapshots: verified.items,
          latestDecisionId: snapshot.decisionId, catalog,
        });
        if (!validated || canonicalJson(validated.provenance) !== canonicalJson(item.provenance)
          || validated.evidenceHash !== item.evidenceHash
          || validated.eligibleForComparison !== item.eligibleForComparison) {
          throw new Error("OCR comparison quantity evidence integrity check failed");
        }
        const superseded = currentPairSubjects.has(snapshotSubjects.get(snapshot.decisionId)!);
        const preview: OcrFactPairComparisonPreview = superseded ? {
          schemaVersion: "ocr-fact-pair-comparison-preview-v1", purpose: "REVIEW_ONLY",
          status: "ABSTAIN", reasonCode: "PAIR_SUPERSEDED_IN_CURRENT_RUN",
          comparison: null,
        } : buildOcrFactPairComparisonPreview({
          pair: loaded.context, snapshots: verified.items,
          latestDecisionId: snapshot.decisionId, catalog,
          quantity: validated.eligibleForComparison ? {
            targetCheckId: review.targetCheckId,
            inputManifestHash: review.inputManifestHash,
            objectId: review.objectId,
            parameterCode: review.parameterCode,
            attribute: review.attribute,
            entityKey: review.entityKey,
            context: review.context,
            pdFactId: review.pdFactId, rdFactId: review.rdFactId,
            pdLocatorHash: review.pdLocatorHash,
            rdLocatorHash: review.rdLocatorHash,
            semantics: "SAME_SCALAR_TOTAL", denominator: "PD",
            evidenceHash: validated.evidenceHash,
          } : null,
        });
        items.push({ quantityDecisionId: item.id, preview });
      }
      // A review may be appended while independent provenance reads run. Never emit
      // a superseded positive preview from that interval; caller can retry.
      const latestRows = await client.query<{
        id: string; pair_decision_id: string;
      }>(
        `SELECT id, pair_decision_id FROM ocr_fact_pair_quantity_decisions
         WHERE run_id = $1 AND object_id = $2
         ORDER BY created_at, id LIMIT 1025`,
        [selected.run_id, selected.object_id],
      );
      if (latestRows.rows.length > 1024) {
        throw new Error("OCR comparison quantity journal limit exceeded");
      }
      const latest = new Map<string, string>();
      for (const row of latestRows.rows) latest.set(row.pair_decision_id, row.id);
      const expected = new Map(quantity.effectiveItems.map((item) =>
        [item.review.pairDecisionId, item.id]));
      if (latest.size !== expected.size
        || [...latest].some(([pairId, decisionId]) => expected.get(pairId) !== decisionId)) {
        throw new Error("OCR comparison stale quantity decision; retry");
      }
      const currentPairSubjectsAtReturn = await this.currentRunOcrFactPairSubjects(
        client, selected);
      if (currentPairSubjectsAtReturn.size !== currentPairSubjects.size
        || [...currentPairSubjectsAtReturn].some((subject) =>
          !currentPairSubjects.has(subject))) {
        throw new Error("OCR comparison stale pair decision; retry");
      }
      return { items };
    } finally {
      client.release();
    }
  }

  async recordOcrFactPairQuantityReviewCommand(
    checkId: string, input: OcrFactPairQuantityReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrFactPairQuantityReview>> {
    if (command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")) return { kind: "forbidden" };
    const verified = await this.getOcrFactPairSnapshots(checkId, command.actor);
    if (!verified || typeof verified === "string") return { kind: "not_found" };
    const operation = "OCR_FACT_PAIR_QUANTITY_REVIEW";
    const targetId = `${checkId}:${input.pairDecisionId}`;
    const requestHash = sha256(canonicalJson({ checkId, input }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation,
        "OCR_FACT_PAIR_QUANTITY", targetId);
      const receipt = await this.getCommandReceipt<{ value: OcrFactPairQuantityReview }>(
        client, command, operation, "OCR_FACT_PAIR_QUANTITY", targetId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
      }
      const selected = (await client.query<{
        run_id: string; object_id: string; object_api_id: string; check_id: string;
        inspection_id: string; active_run_id: string | null; run_state: string;
        manifest_hash: string; manifest_json: Record<string, unknown>;
      }>(
        `SELECT run.id AS run_id, run.api_id AS check_id,
                object.id AS object_id, object.api_id AS object_api_id,
                inspection.id AS inspection_id, inspection.active_run_id,
                run.run_state, manifest.sha256 AS manifest_hash,
                manifest.canonical_json AS manifest_json
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND inspection.lifecycle = 'OPEN'
           AND EXISTS (SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])
         FOR UPDATE OF inspection`,
        [this.organizationId, checkId, command.actor.userId],
      )).rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.active_run_id !== selected.run_id
        || !["SUCCEEDED", "PARTIAL"].includes(selected.run_state)) {
        return { kind: "invalid_state", code: "STALE_OCR_QUANTITY_RUN",
          message: "Решение относится к старой или незавершённой проверке" } as const;
      }
      const snapshot = verified.items.find((item) => item.decisionId === input.pairDecisionId);
      const snapshotRow = (await client.query<OcrFactPairSnapshotRow>(
        `SELECT * FROM run_ocr_fact_pair_snapshots
         WHERE run_id = $1 AND object_id = $2 AND decision_id = $3`,
        [selected.run_id, selected.object_id, input.pairDecisionId],
      )).rows[0];
      if (!snapshot || !snapshotRow || snapshot.reasonCode !== "REBOUND"
        || !snapshot.eligibleForPairReview || snapshot.review?.decision !== "PAIR_CONFIRMED") {
        return { kind: "invalid_state", code: "OCR_QUANTITY_SNAPSHOT_REQUIRED",
          message: "После подтверждения пары запустите повторную проверку для создания неизменяемого снимка" } as const;
      }
      if (snapshot.targetReviewHash !== snapshotRow.target_review_hash?.trim()) {
        throw new Error("OCR quantity snapshot changed after verification");
      }
      const currentPairSubjects = await this.currentRunOcrFactPairSubjects(
        client, selected);
      if (currentPairSubjects.has(snapshotRow.subject_hash.trim())) {
        return { kind: "invalid_state", code: "OCR_QUANTITY_SNAPSHOT_REQUIRED",
          message: "Новое решение по паре требует повторной проверки и нового снимка" } as const;
      }
      const artifact = await this.verifyOcrTypedFactCandidateArtifact(client, selected.run_id);
      const loaded = artifact && await this.loadOcrFactPairContext(client, selected,
        artifact, input.pdFactId, input.rdFactId);
      const catalog = ocrFactPairQuantityCatalogFor(input.parameterCode, input.attribute);
      const validated = loaded && catalog && validateOcrFactPairQuantityReview(input,
        { pair: loaded.context, snapshots: verified.items,
          latestDecisionId: snapshot.decisionId, catalog });
      if (!validated || !artifact) return { kind: "invalid_state",
        code: "OCR_QUANTITY_NOT_VERIFIED",
        message: "Количество не соответствует проверенной паре, источникам и артефакту" } as const;
      if (receipt) {
        return { kind: "success", value: receipt.response.value, replayed: true } as const;
      }
      const contentHash = sha256(canonicalJson({ checkId,
        objectId: selected.object_api_id, ...validated, actorId: command.actor.userId }));
      const prior = (await client.query<{ id: string; created_at: Date | string }>(
        `SELECT id, created_at FROM ocr_fact_pair_quantity_decisions
         WHERE run_id = $1 AND content_hash = $2 LIMIT 1`,
        [selected.run_id, contentHash],
      )).rows[0];
      const attempted = prior ? null : (await client.query<{
        id: string; created_at: Date | string;
      }>(
        `INSERT INTO ocr_fact_pair_quantity_decisions (
           object_id, run_id, input_manifest_hash, artifact_hash,
           pair_decision_id, pair_subject_hash, target_review_hash,
           pd_fact_id, rd_fact_id, pd_locator_hash, rd_locator_hash,
           evidence_hash, review_json, actor_id, content_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11, $12, $13::jsonb, $14, $15)
         ON CONFLICT (run_id, content_hash) DO NOTHING RETURNING id, created_at`,
        [selected.object_id, selected.run_id, selected.manifest_hash.trim(),
          validated.provenance.artifactHash, snapshot.decisionId,
          snapshotRow.subject_hash.trim(), input.pairTargetReviewHash,
          input.pdFactId, input.rdFactId, input.pdLocatorHash,
          input.rdLocatorHash, validated.evidenceHash, canonicalJson(validated),
          command.actor.userId, contentHash],
      )).rows[0];
      const created = Boolean(attempted);
      const inserted = prior ?? attempted ?? (await client.query<{
        id: string; created_at: Date | string;
      }>(`SELECT id, created_at FROM ocr_fact_pair_quantity_decisions
          WHERE run_id = $1 AND content_hash = $2`, [selected.run_id, contentHash])).rows[0];
      if (!inserted) throw new Error("OCR quantity decision conflict read failed");
      const value: OcrFactPairQuantityReview = { id: inserted.id, checkId,
        objectId: selected.object_api_id, ...validated,
        actorId: command.actor.userId, contentHash, createdAt: asIso(inserted.created_at) };
      await this.insertCommandReceipt(client, command, operation,
        "OCR_FACT_PAIR_QUANTITY", targetId, requestHash, 201, { value }, true);
      if (created) await this.appendAuditEvent(client, {
        command, objectId: selected.object_id, inspectionId: selected.inspection_id,
        action: operation, targetType: "OCR_FACT_PAIR_QUANTITY", targetId,
        beforeRef: null, afterRef: { decisionId: value.id, contentHash,
          runId: selected.run_id, pairDecisionId: input.pairDecisionId,
          artifactHash: validated.provenance.artifactHash,
          evidenceHash: validated.evidenceHash },
        reason: input.basis.scope,
      });
      return { kind: "success", value, replayed: !created } as const;
    });
  }

  async getVisualProposals(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<Record<string, unknown>>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<{
      id: string; content_json: Record<string, unknown>; content_hash: string; byte_size: number | string;
    }>(
      `SELECT stage.id, stage.content_json, stage.content_hash, stage.byte_size
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN analysis_stage_artifacts stage
         ON stage.run_id = run.id AND stage.job_type = 'ENTITY_EXTRACTION'
           AND stage.schema_version = 'analysis-stage-result-v2'
           AND stage.disposition = 'VISUAL_PROPOSAL_SCAN'
       JOIN analysis_jobs job ON job.id = stage.job_id AND job.state = 'SUCCEEDED'
       WHERE object.organization_id = $1 AND run.api_id = $2
         AND EXISTS (
           SELECT 1 FROM object_memberships access
           WHERE access.object_id = object.id AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, checkId, actor.userId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const content = parseJson<Record<string, unknown>>(row.content_json);
    const canonical = canonicalJson(content);
    if (sha256(canonical) !== row.content_hash.trim()
      || Buffer.byteLength(canonical, "utf8") !== Number(row.byte_size)
      || !isRecord(content.analysis)
      || !["visual-proposal-analysis-v1", "visual-proposal-analysis-v2", "visual-proposal-analysis-v3", "visual-proposal-analysis-v4", "visual-proposal-analysis-v5", "visual-proposal-analysis-v6"].includes(
        String(content.analysis.schemaVersion),
      )) {
      throw new Error("visual proposal artifact integrity check failed");
    }
    return {
      ...content.analysis,
      status: "PROPOSAL_ONLY_UNVERIFIED",
      artifactId: row.id,
      contentHash: row.content_hash.trim(),
    };
  }

  private async scopedOcrLayoutRow(
    checkId: string, actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<PersistedOcrLayoutRow>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<PersistedOcrLayoutRow & {
      run_internal_id: string; release_content_json: Record<string, unknown>;
    }>(
      `SELECT stage.id, stage.content_json, stage.content_hash, stage.byte_size,
              stage.provider_profile_id, stage.provider_config_hash,
              stage.input_manifest_hash, object.id AS object_internal_id,
              run.id AS run_internal_id, release.content_json AS release_content_json
       FROM analysis_runs run
       JOIN inspections inspection ON inspection.id = run.inspection_id
         AND inspection.active_run_id = run.id
       JOIN objects object ON object.id = run.object_id
       JOIN analysis_releases release ON release.release_id = run.release_id
       JOIN analysis_stage_artifacts stage ON stage.run_id = run.id
         AND stage.job_type = 'DOCUMENT_OCR_LAYOUT'
         AND stage.schema_version = 'analysis-stage-result-v2'
         AND stage.disposition = 'OCR_LAYOUT_BOUNDED'
       JOIN analysis_jobs job ON job.id = stage.job_id AND job.state = 'SUCCEEDED'
       WHERE object.organization_id = $1 AND run.api_id = $2
         AND EXISTS (
           SELECT 1 FROM object_memberships access
           WHERE access.object_id = object.id AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )
       LIMIT 2`,
      [this.organizationId, checkId, actor.userId],
    );
    if (result.rows.length > 1) throw new Error("Duplicate persisted OCR layout artifacts");
    const row = result.rows[0];
    const slot = row ? providerSlotForJob(parseJson<Record<string, unknown>>(
      row.release_content_json), "DOCUMENT_OCR_LAYOUT") : null;
    if (row && (row.provider_profile_id === boundedOcrProfileIdV6
      || slot?.profileId === boundedOcrProfileIdV6)) {
      const client = await this.pool.connect();
      try {
        if (!(await this.verifyStoredOcrV6Artifact(client, row.run_internal_id,
          row.object_internal_id))) {
          throw new Error("OCR v6 immutable stage integrity check failed");
        }
      } finally {
        client.release();
      }
    }
    return row ? { ...row, content_json: parseJson<Record<string, unknown>>(row.content_json) } : undefined;
  }

  async getOcrLayout(
    checkId: string, actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<OcrLayoutRead>> {
    const row = await this.scopedOcrLayoutRow(checkId, actor);
    if (!row || row === "AUTH_REQUIRED") return row;
    return projectOcrLayoutRead(checkId, row);
  }

  async getOcrLayoutPage(
    checkId: string, sourceFileId: string, pageNumber: number,
    offset: number, actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<OcrLayoutPageRead>> {
    const row = await this.scopedOcrLayoutRow(checkId, actor);
    if (!row || row === "AUTH_REQUIRED") return row;
    return projectOcrLayoutPage(checkId, row, sourceFileId, pageNumber, offset);
  }

  async listFactEntityLinks(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: FactEntityLinkDecision[]; canReview: boolean; canRun: boolean }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const scope = await this.readQuery<{
      run_id: string; object_id: string; object_api_id: string;
      can_review: boolean; can_run: boolean;
    }>(
      `SELECT run.id AS run_id, object.id AS object_id, object.api_id AS object_api_id,
              (inspection.active_run_id = run.id AND run.run_state IN ('SUCCEEDED', 'PARTIAL')
                AND EXISTS (SELECT 1 FROM object_memberships reviewer
                  WHERE reviewer.object_id = object.id AND reviewer.user_id = $3
                    AND reviewer.revoked_at IS NULL
                    AND reviewer.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])) AS can_review,
              (inspection.lifecycle = 'OPEN' AND EXISTS (SELECT 1 FROM object_memberships runner
                  WHERE runner.object_id = object.id AND runner.user_id = $3
                    AND runner.revoked_at IS NULL
                    AND runner.permission_set @> ARRAY['RUN']::text[])) AS can_run
       FROM analysis_runs run
       JOIN inspections inspection ON inspection.id = run.inspection_id
       JOIN objects object ON object.id = run.object_id
       WHERE object.organization_id = $1 AND run.api_id = $2
         AND EXISTS (SELECT 1 FROM object_memberships access
           WHERE access.object_id = object.id AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[])`,
      [this.organizationId, checkId, actor.userId],
    );
    if (!scope.rows[0]) return undefined;
    const rows = await this.readQuery<{
      id: string; link_json: Record<string, unknown>; actor_id: string;
      content_hash: string; created_at: Date | string;
    }>(
      `SELECT decision.id, decision.link_json, decision.actor_id,
              decision.content_hash, decision.created_at
       FROM fact_entity_link_decisions decision
       WHERE decision.proposal_run_id = $1 AND decision.object_id = $2
       ORDER BY decision.created_at, decision.id`,
      [scope.rows[0].run_id, scope.rows[0].object_id],
    );
    const items = rows.rows.map((row) => {
      const link = parseJson<Record<string, unknown>>(row.link_json);
      if (sha256(canonicalJson({ actorId: row.actor_id, link })) !== row.content_hash.trim()) {
        throw new Error("Fact entity link decision integrity check failed");
      }
      return { id: row.id, checkId, objectId: scope.rows[0].object_api_id,
        link, actorId: row.actor_id, contentHash: row.content_hash.trim(),
        createdAt: asIso(row.created_at) };
    });
    return { items, canReview: actor.capabilities.includes("REVIEW_DECIDE")
      && scope.rows[0].can_review,
      canRun: scope.rows[0].can_run && (actor.roles.includes("INSPECTOR")
        || actor.roles.includes("SUPERVISOR") || actor.capabilities.includes("RUN_START")) };
  }

  async recordFactEntityLinkCommand(
    checkId: string, input: FactEntityLinkReviewInput, command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<FactEntityLinkDecision>> {
    if (command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")) return { kind: "forbidden" };
    const operation = "FACT_ENTITY_LINK_REVIEW";
    const targetId = `${checkId}:${input.pdFactId}:${input.actualFactId}`;
    const basis = { reference: input.basis.reference.trim() };
    if (basis.reference.length < 8 || basis.reference.length > 1000) {
      return { kind: "invalid_state", code: "INVALID_FACT_LINK_BASIS",
        message: "Основание связи должно содержать от 8 до 1000 символов" };
    }
    const requestHash = sha256(canonicalJson({ checkId, ...input, basis }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, "FACT_ENTITY_LINK", targetId);
      const receipt = await this.getCommandReceipt<{ value: FactEntityLinkDecision }>(
        client, command, operation, "FACT_ENTITY_LINK", targetId,
      );
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", value: receipt.response.value, replayed: true } as const;
      }
      const scope = await client.query<{
        run_id: string; object_id: string; object_api_id: string; inspection_id: string;
        run_state: string; active_run_id: string | null; manifest_hash: string;
      }>(
        `SELECT run.id AS run_id, object.id AS object_id, object.api_id AS object_api_id,
                inspection.id AS inspection_id, run.run_state, inspection.active_run_id,
                manifest.sha256 AS manifest_hash
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND inspection.lifecycle = 'OPEN'
           AND EXISTS (SELECT 1 FROM object_memberships reviewer
             WHERE reviewer.object_id = object.id AND reviewer.user_id = $3
               AND reviewer.revoked_at IS NULL
               AND reviewer.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])
         FOR UPDATE OF inspection`,
        [this.organizationId, checkId, command.actor.userId],
      );
      const selected = scope.rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.active_run_id !== selected.run_id
        || !["SUCCEEDED", "PARTIAL"].includes(selected.run_state)) {
        return { kind: "invalid_state", code: "STALE_FACT_FAMILY_PROPOSAL",
          message: "Предложение относится к старой или незавершённой проверке" } as const;
      }
      const pilot = await this.getPilotResults(checkId, command.actor);
      if (!pilot || typeof pilot === "string" || pilot.status !== "READY" || !pilot.factFamily
        || pilot.factFamily.contentHash !== input.factFamilyContentHash) {
        return { kind: "invalid_state", code: "STALE_FACT_FAMILY_PROPOSAL",
          message: "Хеш сохранённого предложения не совпал" } as const;
      }
      const family = pilot.factFamily;
      const pdFacts = family.facts.filter((fact) => fact.factId === input.pdFactId);
      const actualFacts = family.facts.filter((fact) => fact.factId === input.actualFactId);
      if (pdFacts.length !== 1 || actualFacts.length !== 1) {
        return { kind: "invalid_state", code: "FACT_PAIR_NOT_FOUND",
          message: "Факты не найдены в текущем предложении" } as const;
      }
      const pd = pdFacts[0];
      const actual = actualFacts[0];
      const rule = pilotPz002Pz017OcrHeatFactFamilyRules.factFamily.rules.find((candidate) =>
        candidate.parameterCode === pd.parameterCode && candidate.attribute === pd.attribute
        && candidate.actualStage === actual.stage);
      if (pd.stage !== "PD" || !["RD", "ID"].includes(String(actual.stage))
        || pd.parameterCode !== actual.parameterCode || pd.attribute !== actual.attribute
        || !rule || pd.objectId !== selected.object_id || actual.objectId !== selected.object_id
        || pd.sourceFileId === actual.sourceFileId) {
        return { kind: "invalid_state", code: "FACT_PAIR_INVALID",
          message: "Факты не образуют разрешённую пару ПД и РД/ИД" } as const;
      }
      if (String(pd.parameterCode).startsWith("KR-")
        && (typeof pd.elementType !== "string" || !pd.elementType.trim()
          || pd.elementType !== actual.elementType)
        || ["elementType", "zone", "floor", "scope"].some((field) =>
          pd[field] !== actual[field] || pd[field] !== undefined
            && (typeof pd[field] !== "string" || !String(pd[field]).trim()))) {
        return { kind: "invalid_state", code: "FACT_ENTITY_CONTEXT_MISMATCH",
          message: "Контекст элемента или зоны у фактов не совпадает" } as const;
      }
      const sourceRows = await client.query<{
        source_file_id: string; source_api_id: string; source_sha256: string;
        decision_id: string | null; latest_decision_id: string | null;
        review_sha256: string | null; revision_status: string | null;
        approval_status: string | null; link_group_id: string | null;
        section_code: string | null;
      }>(
        `SELECT source.id AS source_file_id, source.api_id AS source_api_id,
                item.blob_sha256 AS source_sha256, snapshot.decision_id,
                latest.id AS latest_decision_id,
                review.source_sha256 AS review_sha256, review.revision_status,
                review.approval_status, review.link_group_id, review.section_code
         FROM analysis_runs run
         JOIN manifest_items item ON item.manifest_id = run.manifest_id
         JOIN source_files source ON source.id = item.source_file_id
         LEFT JOIN run_source_review_snapshots snapshot
           ON snapshot.run_id = run.id AND snapshot.source_file_id = source.id
         LEFT JOIN source_review_decisions review ON review.id = snapshot.decision_id
         LEFT JOIN LATERAL (
           SELECT decision.id FROM source_review_decisions decision
           WHERE decision.source_file_id = source.id
           ORDER BY decision.created_at DESC, decision.id DESC LIMIT 1
         ) latest ON TRUE
         WHERE run.id = $1 AND source.api_id = ANY($2::text[])`,
        [selected.run_id, [pd.sourceFileId, actual.sourceFileId]],
      );
      const sources = new Map(sourceRows.rows.map((row) => [row.source_api_id, row]));
      const pdSource = sources.get(String(pd.sourceFileId));
      const actualSource = sources.get(String(actual.sourceFileId));
      if (!pdSource || !actualSource || sources.size !== 2
        || ![pdSource, actualSource].every((source) =>
          source.decision_id && source.decision_id === source.latest_decision_id
          && source.source_sha256.trim() === source.review_sha256?.trim()
          && source.revision_status === "CURRENT" && source.approval_status === "APPROVED")
        || pd.sourceSha256 !== pdSource.source_sha256.trim()
        || actual.sourceSha256 !== actualSource.source_sha256.trim()
        || !pdSource.link_group_id || pdSource.link_group_id !== actualSource.link_group_id
        || !(rule.requiredActualSection as readonly string[]).includes(actualSource.section_code ?? "")) {
        return { kind: "invalid_state", code: "FACT_SOURCES_NOT_APPROVED",
          message: "Исходники пары не утверждены в одной актуальной группе и разделе" } as const;
      }
      const evidence = [pd, actual].map((fact) => ({ factId: fact.factId,
        sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
        pageNumber: fact.pageNumber, locator: fact.locator }));
      const link = { schemaVersion: "fact-entity-link-v1", pdFactId: input.pdFactId,
        actualFactId: input.actualFactId, objectId: selected.object_id,
        linkGroupId: pdSource.link_group_id, basis, evidence };
      const contentHash = sha256(canonicalJson({ actorId: command.actor.userId, link }));
      const factInputs = await this.loadFactFamilyVerificationInputs(
        client, selected.run_id, selected.object_id);
      const envelope: ReviewedFactEntityLink = { schemaVersion: "reviewed-fact-entity-link-v1",
        link, actorId: command.actor.userId, contentHash, decisionHash: contentHash };
      if (!factInputs || verifiedReviewedFactEntityLinks([envelope], selected.object_id,
        family.facts, factInputs.sourceFiles, factInputs.sourceReviews).length !== 1) {
        return { kind: "invalid_state", code: "FACT_LINK_INVALID",
          message: "Связь фактов не прошла независимую проверку" } as const;
      }
      const artifact = await client.query<{ id: string; content_json: Record<string, unknown> }>(
        `SELECT stage.id, stage.content_json
         FROM analysis_stage_artifacts stage
         JOIN analysis_jobs job ON job.id = stage.job_id AND job.state = 'SUCCEEDED'
         WHERE stage.run_id = $1 AND stage.job_type = 'RULE_EVALUATION'
           AND stage.provider_profile_id IN (
             'typed-pz002-pz017-ocr-heat-fact-family-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v1',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v2',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3',
             'typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3-unresolved-review-v1'
           )
         LIMIT 2`, [selected.run_id],
      );
      if (artifact.rows.length !== 1
        || !isRecord(artifact.rows[0].content_json.factFamily)
        || artifact.rows[0].content_json.factFamily.contentHash !== input.factFamilyContentHash) {
        return { kind: "invalid_state", code: "STALE_FACT_FAMILY_PROPOSAL",
          message: "Сохранённый артефакт предложения изменился" } as const;
      }
      const prior = await client.query<{ id: string; created_at: Date | string }>(
        `SELECT id, created_at FROM fact_entity_link_decisions
         WHERE proposal_run_id = $1 AND content_hash = $2 LIMIT 1`,
        [selected.run_id, contentHash],
      );
      const inserted = prior.rows[0] ?? (await client.query<{ id: string; created_at: Date | string }>(
        `INSERT INTO fact_entity_link_decisions (
           object_id, proposal_run_id, proposal_artifact_id, proposal_content_hash,
           parameter_code, attribute, actual_stage, pd_source_file_id,
           actual_source_file_id, pd_source_review_id, actual_source_review_id,
           link_json, actor_id, content_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
         RETURNING id, created_at`,
        [selected.object_id, selected.run_id, artifact.rows[0].id,
          input.factFamilyContentHash, String(pd.parameterCode), String(pd.attribute),
          String(actual.stage), pdSource.source_file_id, actualSource.source_file_id,
          pdSource.decision_id, actualSource.decision_id, canonicalJson(link),
          command.actor.userId, contentHash],
      )).rows[0];
      const value: FactEntityLinkDecision = { id: inserted.id, checkId,
        objectId: selected.object_api_id, link, actorId: command.actor.userId,
        contentHash, createdAt: asIso(inserted.created_at) };
      await this.insertCommandReceipt(client, command, operation, "FACT_ENTITY_LINK",
        targetId, requestHash, 201, { value }, true);
      if (!prior.rows[0]) await this.appendAuditEvent(client, {
        command, objectId: selected.object_id, inspectionId: selected.inspection_id,
        action: operation, targetType: "FACT_ENTITY_LINK", targetId,
        beforeRef: null, afterRef: { decisionId: value.id, contentHash,
          proposalRunId: selected.run_id, proposalContentHash: input.factFamilyContentHash },
        reason: basis.reference,
      });
      return { kind: "success", value, replayed: Boolean(prior.rows[0]) } as const;
    });
  }

  async listVisualProposalReviews(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: VisualProposalReview[]; canReview: boolean }>> {
    if (!this.hasReadScope(actor)) return undefined;
    const scope = await this.readQuery<{ id: string; can_review: boolean }>(
      `SELECT run.id,
              (inspection.active_run_id = run.id AND run.run_state IN ('SUCCEEDED', 'PARTIAL') AND EXISTS (
                SELECT 1 FROM object_memberships reviewer
                WHERE reviewer.object_id = object.id AND reviewer.user_id = $3
                  AND reviewer.revoked_at IS NULL
                  AND reviewer.permission_set @> ARRAY['REVIEW_DECIDE']::text[]
              )) AS can_review
       FROM analysis_runs run
       JOIN inspections inspection ON inspection.id = run.inspection_id
       JOIN objects object ON object.id = run.object_id
       WHERE object.organization_id = $1 AND run.api_id = $2
         AND EXISTS (
           SELECT 1 FROM object_memberships access
           WHERE access.object_id = object.id AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, checkId, actor.userId],
    );
    if (!scope.rows[0]) return undefined;
    const rows = await this.readQuery<{
      id: string; object_api_id: string; artifact_id: string; artifact_hash: string;
      source_api_id: string; source_sha256: string; proposal_ordinal: number;
      proposal_hash: string; action: VisualProposalReview["action"]; note: string;
      actor_id: string; review_hash: string; created_at: Date | string;
    }>(
      `SELECT review.id, object.api_id AS object_api_id, review.artifact_id,
              review.artifact_hash, source.api_id AS source_api_id,
              review.source_sha256, review.proposal_ordinal, review.proposal_hash,
              review.action, review.note, review.actor_id, review.review_hash,
              review.created_at
       FROM visual_proposal_reviews review
       JOIN analysis_stage_artifacts stage ON stage.id = review.artifact_id
       JOIN analysis_runs run ON run.id = stage.run_id
       JOIN objects object ON object.id = review.object_id AND object.id = run.object_id
       JOIN source_files source ON source.id = review.source_file_id AND source.object_id = object.id
       WHERE run.id = $1 AND object.organization_id = $2
       ORDER BY review.created_at, review.id`,
      [scope.rows[0].id, this.organizationId],
    );
    return {
      canReview: actor.capabilities.includes("REVIEW_DECIDE") && scope.rows[0].can_review,
      items: rows.rows.map((row) => ({
        id: row.id, checkId, objectId: row.object_api_id,
        artifactId: row.artifact_id, contentHash: row.artifact_hash.trim(),
        sourceFileId: row.source_api_id, sourceSha256: row.source_sha256.trim(),
        proposalOrdinal: row.proposal_ordinal, proposalHash: row.proposal_hash.trim(),
        action: row.action, note: row.note, actorId: row.actor_id,
        reviewHash: row.review_hash.trim(), createdAt: asIso(row.created_at),
      })),
    };
  }

  async listReviewCandidateDecisions(
    checkId: string, actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: ReviewCandidateDecisionRead[]; canReview: boolean }>> {
    const pilot = await this.getPilotResults(checkId, actor);
    if (!pilot || pilot === "AUTH_REQUIRED" || pilot === "FORBIDDEN" || !pilot.reviewCandidates) {
      return undefined;
    }
    const scope = await this.readQuery<{ id: string; can_review: boolean }>(
      `SELECT run.id, EXISTS (
         SELECT 1 FROM object_memberships member
         WHERE member.object_id = run.object_id AND member.user_id = $3
           AND member.revoked_at IS NULL
           AND member.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[]
       ) AS can_review
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       JOIN inspections inspection ON inspection.id = run.inspection_id
         AND inspection.active_run_id = run.id
       WHERE object.organization_id = $1 AND run.api_id = $2`,
      [this.organizationId, checkId, actor.userId],
    );
    if (!scope.rows[0]) return undefined;
    const rows = await this.readQuery<{ id: string; candidate_id: string; rule_stage_hash: string;
      saved_stage_hash: string;
      decision: ReviewCandidateDecisionRead["decision"]; note: string; actor_id: string;
      decision_hash: string; created_at: Date | string }>(
      `SELECT decision.id, decision.candidate_id, decision.rule_stage_hash,
              stage.content_hash AS saved_stage_hash, decision.decision,
              decision.note, decision.actor_id, decision.decision_hash, decision.created_at
       FROM review_candidate_decisions decision
       JOIN analysis_stage_artifacts stage ON stage.id = decision.rule_stage_artifact_id
         AND stage.run_id = decision.run_id AND stage.job_type = 'RULE_EVALUATION'
       WHERE decision.run_id = $1 ORDER BY decision.created_at, decision.id`,
      [scope.rows[0].id],
    );
    for (const row of rows.rows) {
      if (row.rule_stage_hash.trim() !== row.saved_stage_hash.trim()
        || !pilot.reviewCandidates.candidates.some((candidate) =>
          candidate.candidateId === row.candidate_id.trim())
        || sha256(canonicalJson({ checkId,
          schemaVersion: "review-candidate-decision-v1",
          candidateId: row.candidate_id.trim(),
          artifactHash: pilot.reviewCandidates.contentHash,
          decision: row.decision, note: row.note, actorId: row.actor_id,
          stageHash: row.saved_stage_hash.trim(),
        })) !== row.decision_hash.trim()) {
        throw new Error("review candidate decision integrity check failed");
      }
    }
    return { canReview: actor.capabilities.includes("REVIEW_DECIDE") && scope.rows[0].can_review,
      items: rows.rows.map((row) => ({
        id: row.id, checkId, schemaVersion: "review-candidate-decision-v1",
        candidateId: row.candidate_id.trim(), artifactHash: pilot.reviewCandidates!.contentHash,
        decision: row.decision, note: row.note, actorId: row.actor_id,
        decisionHash: row.decision_hash.trim(), createdAt: asIso(row.created_at),
      })) };
  }

  async recordReviewCandidateDecisionCommand(
    checkId: string, input: ReviewCandidateDecisionInput, command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<ReviewCandidateDecisionRead>> {
    if (command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")) return { kind: "forbidden" };
    const normalized = { ...input, note: input.note.trim() };
    if (normalized.schemaVersion !== "review-candidate-decision-v1"
      || !/^[a-f0-9]{64}$/u.test(normalized.candidateId)
      || !/^[a-f0-9]{64}$/u.test(normalized.artifactHash)
      || !["ACCEPT_FOR_REVIEW", "REJECT"].includes(normalized.decision)
      || normalized.note.length < 8 || normalized.note.length > 1000) {
      return { kind: "invalid_state", code: "INVALID_REVIEW_CANDIDATE_DECISION",
        message: "Некорректное решение по подсказке" };
    }
    const pilot = await this.getPilotResults(checkId, command.actor);
    if (!pilot || pilot === "AUTH_REQUIRED" || pilot === "FORBIDDEN"
      || !pilot.reviewCandidates) return { kind: "not_found" };
    if (pilot.reviewCandidates.contentHash !== normalized.artifactHash
      || !pilot.reviewCandidates.candidates.some((candidate) =>
        candidate.candidateId === normalized.candidateId)) {
      return { kind: "invalid_state", code: "STALE_REVIEW_CANDIDATE",
        message: "Подсказка не найдена в текущем запуске" };
    }
    const operation = "REVIEW_CANDIDATE_DECIDE";
    const targetId = `${checkId}:${normalized.candidateId}`;
    const requestHash = sha256(canonicalJson({ checkId, ...normalized }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, "REVIEW_CANDIDATE", targetId);
      const receipt = await this.getCommandReceipt<{ value: ReviewCandidateDecisionRead }>(
        client, command, operation, "REVIEW_CANDIDATE", targetId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", value: receipt.response.value, replayed: true } as const;
      }
      const scope = await client.query<{ run_id: string; object_id: string;
        inspection_id: string; object_api_id: string; run_state: string;
        active_run_id: string | null }>(
        `SELECT run.id AS run_id, run.object_id, inspection.id AS inspection_id,
                object.api_id AS object_api_id, run.run_state, inspection.active_run_id
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (SELECT 1 FROM object_memberships member
             WHERE member.object_id = object.id AND member.user_id = $3
               AND member.revoked_at IS NULL
               AND member.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[])
         FOR UPDATE OF inspection`,
        [this.organizationId, checkId, command.actor.userId],
      );
      const selected = scope.rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.active_run_id !== selected.run_id
        || !["SUCCEEDED", "PARTIAL"].includes(selected.run_state)) {
        return { kind: "invalid_state", code: "STALE_REVIEW_CANDIDATE",
          message: "Запуск заменён или не завершён" } as const;
      }
      const stage = await client.query<{ id: string; content_hash: string;
        content_json: Record<string, unknown>; byte_size: number | string }>(
        `SELECT stage.id, stage.content_hash, stage.content_json, stage.byte_size
         FROM analysis_stage_artifacts stage
         JOIN analysis_jobs job ON job.id = stage.job_id AND job.state = 'SUCCEEDED'
         WHERE stage.run_id = $1 AND stage.job_type = 'RULE_EVALUATION'`,
        [selected.run_id],
      );
      if (stage.rows.length !== 1) return { kind: "not_found" } as const;
      const saved = stage.rows[0];
      const content = parseJson<Record<string, unknown>>(saved.content_json);
      if (sha256(canonicalJson(content)) !== saved.content_hash.trim()
        || Buffer.byteLength(canonicalJson(content), "utf8") !== Number(saved.byte_size)) {
        throw new Error("review candidate stage integrity check failed");
      }
      const artifact = content.reviewCandidates;
      if (!isRecord(artifact) || artifact.contentHash !== normalized.artifactHash
        || !Array.isArray(artifact.candidates)
        || !artifact.candidates.some((item) => isRecord(item)
          && item.candidateId === normalized.candidateId)) {
        return { kind: "invalid_state", code: "STALE_REVIEW_CANDIDATE",
          message: "Подсказка отсутствует в сохранённом артефакте" } as const;
      }
      const decisionHash = sha256(canonicalJson({ checkId, ...normalized,
        actorId: command.actor.userId, stageHash: saved.content_hash.trim() }));
      const inserted = await client.query<{ id: string; created_at: Date | string }>(
        `INSERT INTO review_candidate_decisions (object_id, run_id, rule_stage_artifact_id,
           rule_stage_hash, candidate_id, decision, note, actor_id, decision_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (run_id, decision_hash) DO NOTHING RETURNING id, created_at`,
        [selected.object_id, selected.run_id, saved.id, saved.content_hash.trim(),
          normalized.candidateId, normalized.decision, normalized.note,
          command.actor.userId, decisionHash],
      );
      const existing = inserted.rows[0] ? null : await client.query<{ id: string; created_at: Date | string }>(
        `SELECT id, created_at FROM review_candidate_decisions
         WHERE run_id = $1 AND decision_hash = $2`, [selected.run_id, decisionHash]);
      const persisted = inserted.rows[0] ?? existing?.rows[0];
      if (!persisted) throw new Error("review candidate decision disappeared after insert");
      const value: ReviewCandidateDecisionRead = { ...normalized, id: persisted.id,
        checkId, actorId: command.actor.userId, decisionHash,
        createdAt: asIso(persisted.created_at) };
      await this.insertCommandReceipt(client, command, operation, "REVIEW_CANDIDATE",
        targetId, requestHash, 201, { value }, true);
      if (inserted.rows[0]) {
        await this.appendAuditEvent(client, { command, objectId: selected.object_id,
          inspectionId: selected.inspection_id, action: operation,
          targetType: "REVIEW_CANDIDATE", targetId, beforeRef: null,
          afterRef: { decisionId: value.id, decisionHash, candidateId: normalized.candidateId,
            stageHash: saved.content_hash.trim() }, reason: normalized.note });
      }
      return { kind: "success", value, replayed: !inserted.rows[0] } as const;
    });
  }

  async recordVisualProposalReviewCommand(
    checkId: string,
    input: VisualProposalReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<VisualProposalReview>> {
    if (command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")) return { kind: "forbidden" };
    const operation = "VISUAL_PROPOSAL_REVIEW";
    const targetId = `${checkId}:${input.artifactId}:${input.sourceFileId}:${input.proposalOrdinal}`;
    const normalized = { ...input, note: input.note.trim() };
    const requestHash = sha256(canonicalJson({ checkId, ...normalized }));
    return this.transaction(async (client) => {
      await this.lockCommandReceipt(client, command, operation, "VISUAL_PROPOSAL", targetId);
      const receipt = await this.getCommandReceipt<{ value: VisualProposalReview }>(
        client, command, operation, "VISUAL_PROPOSAL", targetId,
      );
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", value: receipt.response.value, replayed: true } as const;
      }
      const scope = await client.query<{
        run_id: string; object_id: string; object_api_id: string; inspection_id: string;
        active_run_id: string | null; run_state: string;
      }>(
        `SELECT run.id AS run_id, object.id AS object_id, object.api_id AS object_api_id,
                inspection.id AS inspection_id, inspection.active_run_id, run.run_state
         FROM analysis_runs run
         JOIN inspections inspection ON inspection.id = run.inspection_id
         JOIN objects object ON object.id = run.object_id
         WHERE object.organization_id = $1 AND run.api_id = $2
           AND EXISTS (
             SELECT 1 FROM object_memberships access
             WHERE access.object_id = object.id AND access.user_id = $3
               AND access.revoked_at IS NULL
               AND access.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[]
           )
         FOR UPDATE OF inspection`,
        [this.organizationId, checkId, command.actor.userId],
      );
      const selected = scope.rows[0];
      if (!selected) return { kind: "not_found" } as const;
      if (selected.active_run_id !== selected.run_id
        || !["SUCCEEDED", "PARTIAL"].includes(selected.run_state)) {
        return { kind: "invalid_state", code: "STALE_VISUAL_PROPOSAL",
          message: "Предложение относится к старой или незавершённой проверке" } as const;
      }
      const stage = await client.query<{
        content_json: Record<string, unknown>; content_hash: string; byte_size: number | string;
      }>(
        `SELECT stage.content_json, stage.content_hash, stage.byte_size
         FROM analysis_stage_artifacts stage
         JOIN analysis_jobs job ON job.id = stage.job_id AND job.state = 'SUCCEEDED'
         WHERE stage.id = $1 AND stage.run_id = $2
           AND stage.job_type = 'ENTITY_EXTRACTION'
           AND stage.disposition = 'VISUAL_PROPOSAL_SCAN'
           AND stage.schema_version = 'analysis-stage-result-v2'`,
        [input.artifactId, selected.run_id],
      );
      const artifact = stage.rows[0];
      if (!artifact) return { kind: "not_found" } as const;
      const content = parseJson<Record<string, unknown>>(artifact.content_json);
      const canonical = canonicalJson(content);
      if (sha256(canonical) !== artifact.content_hash.trim()
        || Buffer.byteLength(canonical, "utf8") !== Number(artifact.byte_size)) {
        throw new Error("visual proposal artifact integrity check failed");
      }
      if (artifact.content_hash.trim() !== input.contentHash) {
        return { kind: "invalid_state", code: "STALE_VISUAL_PROPOSAL",
          message: "Хеш артефакта не совпадает с текущим результатом" } as const;
      }
      const source = await client.query<{ id: string; sha256: string }>(
        `SELECT source.id, blob.sha256
         FROM source_files source JOIN blobs blob ON blob.id = source.blob_id
         WHERE source.object_id = $1 AND source.api_id = $2`,
        [selected.object_id, input.sourceFileId],
      );
      const sourceRow = source.rows[0];
      if (!sourceRow) return { kind: "not_found" } as const;
      if (sourceRow.sha256.trim() !== input.sourceSha256) {
        return { kind: "invalid_state", code: "SOURCE_HASH_MISMATCH",
          message: "SHA исходного файла не совпадает" } as const;
      }
      const analysis = content.analysis;
      const sources = isRecord(analysis) ? analysis.sources : undefined;
      const analysisSource = Array.isArray(sources)
        ? sources.find((item) => isRecord(item) && item.sourceFileId === input.sourceFileId
          && item.sourceSha256 === input.sourceSha256) : undefined;
      const proposals = isRecord(analysisSource) ? analysisSource.proposals : undefined;
      const proposal = Array.isArray(proposals) ? proposals[input.proposalOrdinal] : undefined;
      if (!isRecord(proposal) || proposal.status !== "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED") {
        return { kind: "invalid_state", code: "PROPOSAL_NOT_FOUND",
          message: "Геометрическое предложение не найдено в артефакте" } as const;
      }
      const proposalHash = sha256(canonicalJson(proposal));
      const reviewHash = sha256(canonicalJson({
        checkId, objectId: selected.object_api_id, ...normalized,
        proposalHash, actorId: command.actor.userId,
      }));
      const inserted = await client.query<{ id: string; created_at: Date | string }>(
        `INSERT INTO visual_proposal_reviews (
           object_id, artifact_id, artifact_hash, source_file_id, source_sha256,
           proposal_ordinal, proposal_hash, action, note, actor_id, review_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, created_at`,
        [selected.object_id, input.artifactId, input.contentHash, sourceRow.id,
          input.sourceSha256, input.proposalOrdinal, proposalHash, input.action,
          normalized.note, command.actor.userId, reviewHash],
      );
      const value: VisualProposalReview = {
        ...normalized, id: inserted.rows[0].id, checkId,
        objectId: selected.object_api_id, proposalHash,
        actorId: command.actor.userId, reviewHash,
        createdAt: asIso(inserted.rows[0].created_at),
      };
      await this.insertCommandReceipt(
        client, command, operation, "VISUAL_PROPOSAL", targetId,
        requestHash, 201, { value }, true,
      );
      await this.appendAuditEvent(client, {
        command, objectId: selected.object_id, inspectionId: selected.inspection_id,
        action: operation, targetType: "VISUAL_PROPOSAL", targetId,
        beforeRef: null, afterRef: { reviewId: value.id, reviewHash,
          artifactId: input.artifactId, artifactHash: input.contentHash,
          sourceFileId: input.sourceFileId, proposalOrdinal: input.proposalOrdinal },
        reason: normalized.note,
      });
      return { kind: "success", value, replayed: false } as const;
    });
  }

  async getFinding(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<Finding>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<FindingRow>(
      `${findingSelect}
       WHERE object.organization_id = $1
         AND item.api_id = $2
         AND item.lifecycle = 'ACTIVE'
         AND result.execution_status = 'SUCCEEDED'
         AND result.machine_status IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    return result.rows[0] ? mapFinding(result.rows[0]) : undefined;
  }

  async getFindingForReview(id: string, actor?: ReviewDecisionCommand["actor"]): Promise<ReviewFindingResult> {
    if (!actor) return "AUTH_REQUIRED";
    if (actor.organizationId !== this.organizationId) return undefined;
    const result = await this.readQuery<FindingRow>(
      `${findingSelect}
       WHERE object.organization_id = $1
         AND item.api_id = $2
         AND item.lifecycle = 'ACTIVE'
         AND result.execution_status = 'SUCCEEDED'
         AND result.machine_status IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    if (!result.rows[0]) return undefined;
    return {
      finding: mapFinding(result.rows[0]),
      mode: "NORMAL",
      rowVersion: Number(result.rows[0].row_version),
    };
  }

  async decideFinding(id: string, _input: DecisionInput): Promise<DecisionResult> {
    return await this.getFindingUnscoped(id) ? "IDENTITY_REQUIRED" : undefined;
  }

  async decideFindingCommand(
    id: string,
    command: ReviewDecisionCommand,
  ): Promise<ReviewDecisionCommandResult> {
    if (
      command.actor.organizationId !== this.organizationId
      || !command.actor.capabilities.includes("REVIEW_DECIDE")
    ) {
      return { kind: "forbidden" };
    }

    const requestHash = sha256(canonicalJson({
      targetId: id,
      type: command.input.type,
      reason: command.input.reason,
      expectedVersion: command.expectedVersion,
    }));

    return this.transaction(async (client) => {
      const aggregate = await client.query<{
        inspection_id: string;
        object_id: string;
        lifecycle: "OPEN" | "FINALIZED";
        active_run_id: string | null;
      }>(
        `SELECT
           inspection.id AS inspection_id,
           object.id AS object_id,
           inspection.lifecycle,
           inspection.active_run_id
         FROM review_items item
         JOIN inspections inspection ON inspection.id = item.inspection_id
         JOIN objects object ON object.id = inspection.object_id
         JOIN object_memberships access
           ON access.object_id = object.id
          AND access.user_id = $3
          AND access.revoked_at IS NULL
         WHERE item.api_id = $1
           AND object.organization_id = $2
           AND access.permission_set @> ARRAY['READ', 'REVIEW_DECIDE']::text[]
         FOR UPDATE OF inspection`,
        [id, this.organizationId, command.actor.userId],
      );
      const scope = aggregate.rows[0];
      if (!scope) return { kind: "not_found" };
      if (!scope.active_run_id) {
        return { kind: "invalid_state", code: "NO_ACTIVE_RUN", message: "У проверки нет активного запуска" };
      }

      const run = await client.query<{
        id: string;
        run_state: string;
        sealed_at: Date | string | null;
        stats: CheckStats | string;
      }>(
        `SELECT id, run_state, sealed_at, stats
         FROM analysis_runs
         WHERE id = $1
         FOR UPDATE`,
        [scope.active_run_id],
      );
      if (!run.rows[0]) {
        return { kind: "invalid_state", code: "NO_ACTIVE_RUN", message: "Активный запуск не найден" };
      }

      const item = await client.query<{
        id: string;
        run_id: string;
        lifecycle: "ACTIVE" | "SUPERSEDED";
        projection_status: string;
        row_version: string | number;
        evidence_fingerprint: string;
        result_fingerprint: string | null;
      }>(
        `SELECT
           item.id,
           item.run_id,
           item.lifecycle,
           item.projection_status,
           item.row_version,
           item.evidence_fingerprint,
           result.evidence_fingerprint AS result_fingerprint
         FROM review_items item
         JOIN rule_results result ON result.id = item.result_id
         WHERE item.api_id = $1 AND item.inspection_id = $2
         FOR UPDATE OF item`,
        [id, scope.inspection_id],
      );
      if (!item.rows[0]) return { kind: "not_found" };

      const receipt = await client.query<{
        request_hash: string;
        response_json: { finding: Finding; rowVersion: number } | string;
      }>(
        `SELECT request_hash, response_json
         FROM command_receipts
         WHERE actor_user_id = $1
           AND operation = 'REVIEW_DECIDE'
           AND target_type = 'REVIEW_ITEM'
           AND target_id = $2
           AND idempotency_key = $3`,
        [command.actor.userId, id, command.idempotencyKey],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_hash !== requestHash) return { kind: "idempotency_conflict" };
        const response = parseJson(receipt.rows[0].response_json);
        return {
          kind: "success",
          finding: response.finding,
          rowVersion: response.rowVersion,
          replayed: true,
        };
      }

      const currentVersion = Number(item.rows[0].row_version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "precondition_failed", currentVersion };
      }
      if (scope.lifecycle !== "OPEN") {
        return { kind: "invalid_state", code: "INSPECTION_FINALIZED", message: "Проверка уже финализирована" };
      }
      if (
        item.rows[0].run_id !== run.rows[0].id
        || !run.rows[0].sealed_at
        || !["SUCCEEDED", "PARTIAL"].includes(run.rows[0].run_state)
      ) {
        return { kind: "invalid_state", code: "STALE_RUN", message: "Кандидат не принадлежит активному завершённому запуску" };
      }
      if (item.rows[0].lifecycle !== "ACTIVE") {
        return { kind: "invalid_state", code: "REVIEW_ITEM_INACTIVE", message: "Кандидат больше не активен" };
      }
      if (
        !item.rows[0].result_fingerprint
        || item.rows[0].evidence_fingerprint !== item.rows[0].result_fingerprint
      ) {
        return { kind: "invalid_state", code: "EVIDENCE_CHANGED", message: "Доказательства кандидата изменились" };
      }

      const latestDecision = await client.query<{ id: string }>(
        `SELECT id
         FROM review_decisions
         WHERE review_item_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [item.rows[0].id],
      );
      const projectionByDecision = {
        CONFIRM: "CONFIRMED_VIOLATION",
        REJECT: "NEGATIVE_VERIFIED",
        CLARIFY: "CLARIFICATION_REQUIRED",
        VERIFY_NEGATIVE: "NEGATIVE_VERIFIED",
      } as const;
      const reasonCodeByDecision = {
        CONFIRM: "INSPECTOR_CONFIRMED",
        REJECT: "INSPECTOR_REJECTED",
        CLARIFY: "INSPECTOR_REQUESTED_CLARIFICATION",
        VERIFY_NEGATIVE: "INSPECTOR_VERIFIED_NEGATIVE",
      } as const;
      const nextProjection = projectionByDecision[command.input.type];
      const decision = await client.query<{ id: string }>(
        `INSERT INTO review_decisions (
           review_item_id, action, reason_code, comment, actor_id,
           supersedes_decision_id, evidence_fingerprint
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          item.rows[0].id,
          command.input.type,
          reasonCodeByDecision[command.input.type],
          command.input.reason,
          command.actor.userId,
          latestDecision.rows[0]?.id ?? null,
          item.rows[0].evidence_fingerprint,
        ],
      );
      const version = await client.query<{ row_version: string | number }>(
        `UPDATE review_items
         SET projection_status = $1, row_version = row_version + 1
         WHERE id = $2
         RETURNING row_version`,
        [nextProjection, item.rows[0].id],
      );
      await client.query(
        `UPDATE inspections
         SET row_version = row_version + 1, updated_at = now()
         WHERE id = $1`,
        [scope.inspection_id],
      );

      const counts = await client.query<{
        candidates: string | number;
        confirmed: string | number;
        negative_verified: string | number;
        clarification: string | number;
      }>(
        `SELECT
           count(*) FILTER (WHERE projection_status = 'PENDING') AS candidates,
           count(*) FILTER (WHERE projection_status = 'CONFIRMED_VIOLATION') AS confirmed,
           count(*) FILTER (WHERE projection_status = 'NEGATIVE_VERIFIED') AS negative_verified,
           count(*) FILTER (WHERE projection_status = 'CLARIFICATION_REQUIRED') AS clarification
         FROM review_items
         WHERE run_id = $1 AND lifecycle = 'ACTIVE'`,
        [run.rows[0].id],
      );
      const runStats = parseJson(run.rows[0].stats);
      const stats: CheckStats = {
        ...runStats,
        candidates: Number(counts.rows[0].candidates),
        confirmed: Number(counts.rows[0].confirmed),
        negativeVerified: Number(counts.rows[0].negative_verified),
        clarification: Number(counts.rows[0].clarification),
      };
      const objectStatus: ObjectStatus = stats.candidates > 0
        ? "REVIEW_REQUIRED"
        : stats.clarification > 0
          ? "CLARIFICATION_REQUIRED"
          : stats.unsupported > 0
            ? "PARTIAL"
            : "READY_TO_FINALIZE";
      await client.query(
        `UPDATE objects
         SET display_status = $1, stats = $2::jsonb, updated_at = now()
         WHERE id = $3`,
        [objectStatus, JSON.stringify(stats), scope.object_id],
      );

      const findingRow = await client.query<FindingRow>(
        `${findingSelect}
         WHERE object.organization_id = $1 AND item.id = $2`,
        [this.organizationId, item.rows[0].id],
      );
      if (!findingRow.rows[0]) throw new Error(`Updated review item ${id} was not found`);
      const finding = mapFinding(findingRow.rows[0]);
      const nextVersion = Number(version.rows[0].row_version);
      const response = { finding, rowVersion: nextVersion };
      await client.query(
        `INSERT INTO command_receipts (
           actor_user_id, operation, target_type, target_id, idempotency_key,
           request_hash, response_status, response_json, expires_at
         ) VALUES ($1, 'REVIEW_DECIDE', 'REVIEW_ITEM', $2, $3, $4, 200, $5::jsonb, now() + interval '30 days')`,
        [command.actor.userId, id, command.idempotencyKey, requestHash, JSON.stringify(response)],
      );

      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [this.organizationId]);
      const previousAudit = await client.query<{ event_hash: string }>(
        `SELECT event_hash
         FROM audit_events
         WHERE organization_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [this.organizationId],
      );
      const previousEventHash = previousAudit.rows[0]?.event_hash ?? null;
      const createdAt = new Date().toISOString();
      const beforeRef = {
        rowVersion: currentVersion,
        status: item.rows[0].projection_status,
      };
      const afterRef = {
        rowVersion: nextVersion,
        status: nextProjection,
        decisionId: decision.rows[0].id,
        evidenceFingerprint: item.rows[0].evidence_fingerprint,
      };
      const eventHash = sha256(canonicalJson({
        organizationId: this.organizationId,
        objectId: scope.object_id,
        inspectionId: scope.inspection_id,
        actorUserId: command.actor.userId,
        action: "REVIEW_DECIDE",
        targetType: "REVIEW_ITEM",
        targetId: id,
        beforeRef,
        afterRef,
        reason: command.input.reason,
        requestId: command.requestId,
        traceId: command.traceId,
        previousEventHash,
        createdAt,
      }));
      await client.query(
        `INSERT INTO audit_events (
           organization_id, object_id, inspection_id, actor_user_id,
           action, target_type, target_id, before_ref, after_ref, reason,
           request_id, trace_id, ip_address, user_agent,
           previous_event_hash, event_hash, created_at
         ) VALUES (
           $1, $2, $3, $4,
           'REVIEW_DECIDE', 'REVIEW_ITEM', $5, $6::jsonb, $7::jsonb, $8,
           $9, $10, $11, $12, $13, $14, $15
         )`,
        [
          this.organizationId,
          scope.object_id,
          scope.inspection_id,
          command.actor.userId,
          id,
          JSON.stringify(beforeRef),
          JSON.stringify(afterRef),
          command.input.reason,
          command.requestId,
          command.traceId,
          command.ipAddress ?? null,
          command.userAgent ?? null,
          previousEventHash,
          eventHash,
          createdAt,
        ],
      );

      return { kind: "success", finding, rowVersion: nextVersion, replayed: false };
    });
  }

  async reprocess(checkId: string, actor?: AuthenticatedActor): Promise<CheckRun | undefined> {
    const check = await this.getCheckUnscoped(checkId);
    if (!check) return undefined;
    return this.startCheck(check.objectId, actor);
  }

  async reprocessCommand(
    checkId: string,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<CheckRun>> {
    if (command.actor.organizationId !== this.organizationId) return { kind: "not_found" };
    const check = await this.getCheckUnscoped(checkId);
    if (!check) return { kind: "not_found" };
    const result = await this.executeStartCheck(check.objectId, command.actor, {
      command,
      operation: "RUN_REPROCESS",
      receiptTargetType: "ANALYSIS_RUN",
      receiptTargetId: checkId,
      responseStatus: 200,
    });
    if (result.kind !== "success") return result;
    const value = await this.getCheckUnscoped(result.value.checkId);
    if (!value) throw new Error(`Reprocessed check ${result.value.checkId} was not found`);
    return { kind: "success", value, replayed: result.replayed };
  }

  async finalize(checkId: string, actor?: AuthenticatedActor): Promise<FinalizeResult> {
    if (actor && actor.organizationId !== this.organizationId) return undefined;
    const check = await this.getCheckUnscoped(checkId);
    if (!check) return undefined;
    if (actor && !(await this.hasObjectPermissionForUser(check.objectId, actor.userId, "FINALIZE"))) return undefined;
    return "INCOMPLETE_ANALYSIS";
  }

  async finalizeCommand(
    checkId: string,
    command: FinalizeCheckCommand,
  ): Promise<FinalizeCheckCommandResult> {
    if (command.actor.organizationId !== this.organizationId) return { kind: "not_found" };
    const input: FinalizeCheckInput = command.input;
    const requestHash = sha256(canonicalJson(input));

    return this.transaction(async (client) => {
      const aggregate = await client.query<{
        inspection_id: string;
        lifecycle: "OPEN" | "FINALIZED";
        row_version: string | number;
        active_run_id: string | null;
        target_run_id: string;
        object_id: string;
        object_api_id: string;
        object_name: string;
        object_address: string;
      }>(
        `SELECT
           inspection.id AS inspection_id,
           inspection.lifecycle,
           inspection.row_version,
           inspection.active_run_id,
           target_run.id AS target_run_id,
           object.id AS object_id,
           object.api_id AS object_api_id,
           object.name AS object_name,
           object.address AS object_address
         FROM analysis_runs target_run
         JOIN inspections inspection ON inspection.id = target_run.inspection_id
         JOIN objects object ON object.id = inspection.object_id
         JOIN object_memberships access
           ON access.object_id = object.id
          AND access.user_id = $3
          AND access.revoked_at IS NULL
         WHERE target_run.api_id = $1
           AND object.organization_id = $2
           AND access.permission_set @> ARRAY['READ', 'FINALIZE']::text[]
         FOR UPDATE OF inspection`,
        [checkId, this.organizationId, command.actor.userId],
      );
      const scope = aggregate.rows[0];
      if (!scope) return { kind: "not_found" } as const;
      if (!scope.active_run_id) {
        return { kind: "invalid_state", code: "NO_ACTIVE_RUN", message: "У проверки нет активного запуска" } as const;
      }

      const activeRun = await client.query<{
        id: string;
        api_id: string;
        run_state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "CANCELLED";
        sealed_at: Date | string | null;
        manifest_hash: string;
        output_hash: string | null;
        rules_version: string;
        model_version: string | null;
        stats: CheckStats | string;
      }>(
        `SELECT
           run.id,
           run.api_id,
           run.run_state,
           run.sealed_at,
           manifest.sha256 AS manifest_hash,
           run.output_hash,
           run.rules_version,
           run.model_version,
           run.stats
         FROM analysis_runs run
         JOIN input_manifests manifest ON manifest.id = run.manifest_id
         WHERE run.id = $1
         FOR UPDATE OF run`,
        [scope.active_run_id],
      );
      if (!activeRun.rows[0]) {
        return { kind: "invalid_state", code: "NO_ACTIVE_RUN", message: "Активный запуск не найден" } as const;
      }

      const reviewRows = await client.query<FindingRow>(
        `${findingSelect}
         WHERE object.organization_id = $1
           AND item.inspection_id = $2
           AND item.run_id = $3
         ORDER BY item.id
         FOR UPDATE OF item`,
        [this.organizationId, scope.inspection_id, activeRun.rows[0].id],
      );

      await this.lockCommandReceipt(client, command, "INSPECTION_FINALIZE", "INSPECTION", checkId);
      const receipt = await this.getCommandReceipt<{ protocol: ProtocolVersion; rowVersion: number }>(
        client,
        command,
        "INSPECTION_FINALIZE",
        "INSPECTION",
        checkId,
      );
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return {
          kind: "success",
          protocol: receipt.response.protocol,
          rowVersion: receipt.response.rowVersion,
          replayed: true,
        } as const;
      }

      const currentVersion = Number(scope.row_version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "precondition_failed", currentVersion } as const;
      }
      if (scope.lifecycle !== "OPEN") {
        return {
          kind: "invalid_state",
          code: "INVALID_TRANSITION",
          message: "Проверка уже финализирована",
        } as const;
      }
      if (scope.target_run_id !== activeRun.rows[0].id || input.runId !== activeRun.rows[0].api_id) {
        return {
          kind: "invalid_state",
          code: "STALE_INPUT",
          message: "Финализировать можно только текущий активный запуск",
        } as const;
      }
      if (
        (activeRun.rows[0].run_state !== "SUCCEEDED" && activeRun.rows[0].run_state !== "PARTIAL")
        || !activeRun.rows[0].sealed_at
        || !activeRun.rows[0].output_hash
      ) {
        return {
          kind: "invalid_state",
          code: "INCOMPLETE_ANALYSIS",
          message: "Активный запуск не завершён и не запечатан",
        } as const;
      }

      const activeReviews = reviewRows.rows.filter((row) => row.lifecycle === "ACTIVE");
      if (activeReviews.some((row) => row.projection_status === "PENDING")) {
        return {
          kind: "invalid_state",
          code: "PENDING_DECISIONS",
          message: "Сначала обработайте всех кандидатов",
        } as const;
      }
      for (const row of activeReviews) {
        const payload = parseJson<StoredFindingPayload>(row.result_payload);
        const decisionMatchesFingerprint = row.decision_evidence_fingerprint === row.evidence_fingerprint
          && row.result_fingerprint === row.evidence_fingerprint;
        const hasEvidence = Array.isArray(payload.evidence) && payload.evidence.length > 0;
        const validDecision = row.projection_status === "CONFIRMED_VIOLATION"
          ? row.decision_action === "CONFIRM" && hasEvidence && decisionMatchesFingerprint
          : row.projection_status === "NEGATIVE_VERIFIED"
            ? (row.decision_action === "REJECT" || row.decision_action === "VERIFY_NEGATIVE")
              && decisionMatchesFingerprint
            : row.projection_status === "CLARIFICATION_REQUIRED"
              ? row.decision_action === "CLARIFY" && decisionMatchesFingerprint
              : false;
        if (!validDecision) {
          return {
            kind: "invalid_state",
            code: "EVIDENCE_INCOMPLETE",
            message: "Одно из решений не связано с действительным evidence текущего запуска",
          } as const;
        }
      }

      const decisionSet = reviewRows.rows
        .map(mapFinalizationDecision)
        .sort((left, right) => left.itemId.localeCompare(right.itemId));
      const decisionSetHash = sha256(canonicalJson(decisionSet));
      if (input.decisionSetHash !== decisionSetHash) {
        return {
          kind: "invalid_state",
          code: "STALE_INPUT",
          message: "Набор решений изменился; обновите проверку перед финализацией",
        } as const;
      }

      const coverage = await client.query<{
        parameter_id: number;
        parameter_code: string;
        parameter_name: string;
        execution_rollup: "UNSUPPORTED" | "PARTIAL";
        reason: string;
      }>(
        `SELECT parameter_id, parameter_code, parameter_name, execution_rollup, reason
         FROM parameter_coverage
         WHERE run_id = $1
         ORDER BY parameter_id, parameter_code`,
        [activeRun.rows[0].id],
      );
      const gaps: ParameterCoverageItem[] = coverage.rows.map((row) => ({
        parameterId: row.parameter_id,
        parameterCode: row.parameter_code,
        parameterName: row.parameter_name,
        executionStatus: row.execution_rollup,
        reason: row.reason,
      }));
      const gapsHash = sha256(canonicalJson(gaps));
      if (activeRun.rows[0].run_state === "PARTIAL") {
        if (!input.acknowledgedGapsHash || !input.acknowledgementReason) {
          return {
            kind: "invalid_state",
            code: "GAPS_ACKNOWLEDGEMENT_REQUIRED",
            message: "Для неполной проверки подтвердите текущий список технических пробелов",
          } as const;
        }
        if (input.acknowledgedGapsHash !== gapsHash) {
          return {
            kind: "invalid_state",
            code: "GAPS_CHANGED",
            message: "Список технических пробелов изменился; обновите проверку",
          } as const;
        }
      } else if (gaps.length > 0) {
        return {
          kind: "invalid_state",
          code: "INCOMPLETE_ANALYSIS",
          message: "Завершённый запуск содержит необработанные технические пробелы",
        } as const;
      }

      const sources = await client.query<{
        api_id: string;
        canonical_name: string;
        sha256: string;
        byte_size: string | number;
        media_type: string;
        stages: Array<"PD" | "RD" | "ID">;
      }>(
        `SELECT
           source.api_id,
           source.canonical_name,
           blob.sha256,
           blob.byte_size,
           blob.media_type,
           array_agg(stage.stage ORDER BY stage.stage) AS stages
         FROM analysis_runs run
         JOIN manifest_items manifest_item ON manifest_item.manifest_id = run.manifest_id
         JOIN source_files source ON source.id = manifest_item.source_file_id
         JOIN blobs blob ON blob.id = source.blob_id
         JOIN source_file_stages stage ON stage.source_file_id = source.id
         WHERE run.id = $1
         GROUP BY source.id, source.api_id, source.canonical_name, blob.sha256, blob.byte_size, blob.media_type
         ORDER BY source.api_id`,
        [activeRun.rows[0].id],
      );
      const latestVersion = await client.query<{ next_version: string | number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM inspection_protocol_versions
         WHERE inspection_id = $1`,
        [scope.inspection_id],
      );
      const version = Number(latestVersion.rows[0].next_version);
      const protocolId = `PRT-${randomUUID().toUpperCase()}`;
      const createdAt = new Date().toISOString();
      const runStats = parseJson<CheckStats>(activeRun.rows[0].stats);
      const stats: CheckStats = {
        ...runStats,
        candidates: activeReviews.filter((row) => row.projection_status === "PENDING").length,
        confirmed: activeReviews.filter((row) => row.projection_status === "CONFIRMED_VIOLATION").length,
        negativeVerified: activeReviews.filter((row) => row.projection_status === "NEGATIVE_VERIFIED").length,
        clarification: activeReviews.filter((row) => row.projection_status === "CLARIFICATION_REQUIRED").length,
      };
      const protocol: ProtocolVersion = {
        id: protocolId,
        checkId,
        version,
        status: "FINAL",
        createdAt,
        createdBy: command.actor.displayName,
        stats,
      };
      const nextRowVersion = currentVersion + 1;
      const snapshot: ProtocolExport = {
        schemaVersion: "1.0",
        protocol,
        scope: {
          organizationId: this.organizationId,
          object: {
            id: scope.object_api_id,
            name: scope.object_name,
            address: scope.object_address,
          },
          inspection: {
            id: scope.inspection_id,
            lifecycle: "FINALIZED",
            rowVersion: nextRowVersion,
          },
          run: {
            id: activeRun.rows[0].api_id,
            state: activeRun.rows[0].run_state,
          },
        },
        integrity: {
          inputManifestHash: activeRun.rows[0].manifest_hash,
          outputHash: activeRun.rows[0].output_hash,
          decisionSetHash,
        },
        sources: sources.rows.map((source) => ({
          fileId: source.api_id,
          fileName: source.canonical_name,
          sha256: source.sha256,
          byteSize: Number(source.byte_size),
          mediaType: source.media_type,
          stages: source.stages,
        })),
        coverage: {
          totalParameters: stats.total,
          executedParameters: Math.max(0, stats.total - gaps.length),
          unsupportedParameters: gaps.length,
          gapsHash,
          gaps,
          acknowledgement: activeRun.rows[0].run_state === "PARTIAL"
            ? {
                gapsHash,
                reason: input.acknowledgementReason!,
                actorId: command.actor.userId,
                actorName: command.actor.displayName,
                acknowledgedAt: createdAt,
              }
            : null,
        },
        findings: activeReviews
          .map(mapFinding)
          .sort((left, right) => left.parameterCode.localeCompare(right.parameterCode)
            || left.groupId.localeCompare(right.groupId)
            || left.id.localeCompare(right.id)),
      };
      const canonicalSnapshot = canonicalJson(snapshot);
      const snapshotHash = sha256(canonicalSnapshot);
      const artifactId = `ART-${randomUUID().toUpperCase()}`;
      const responseProtocol: ProtocolVersion = {
        ...protocol,
        snapshotHash,
        validity: "VALID",
        revocation: null,
        canonicalArtifact: {
          id: artifactId,
          protocolId,
          format: "JSON",
          mediaType: "application/json",
          canonicalizationVersion: "inspector-c14n-v1",
          byteSize: Buffer.byteLength(canonicalSnapshot),
          contentHash: snapshotHash,
          createdAt,
        },
      };

      const insertedProtocol = await client.query<{ id: string }>(
        `INSERT INTO inspection_protocol_versions (
           api_id, inspection_id, run_id, version, kind, snapshot_json,
           snapshot_hash, decision_set_hash, created_by, created_at, finalized_at
         ) VALUES ($1, $2, $3, $4, 'FINAL', $5::jsonb, $6, $7, $8, $9, $9)
         RETURNING id`,
        [
          protocolId,
          scope.inspection_id,
          activeRun.rows[0].id,
          version,
          JSON.stringify(snapshot),
          snapshotHash,
          decisionSetHash,
          command.actor.displayName,
          createdAt,
        ],
      );
      await this.insertCanonicalProtocolArtifact(
        client,
        insertedProtocol.rows[0].id,
        artifactId,
        canonicalSnapshot,
        snapshotHash,
        createdAt,
      );
      const inspection = await client.query<{ row_version: string | number }>(
        `UPDATE inspections
         SET lifecycle = 'FINALIZED', row_version = row_version + 1, updated_at = $1
         WHERE id = $2
         RETURNING row_version`,
        [createdAt, scope.inspection_id],
      );
      const persistedRowVersion = Number(inspection.rows[0].row_version);
      await client.query(
        `UPDATE objects
         SET display_status = 'FINALIZED', stats = $1::jsonb, updated_at = $2
         WHERE id = $3`,
        [JSON.stringify(stats), createdAt, scope.object_id],
      );

      await this.insertCommandReceipt(
        client,
        command,
        "INSPECTION_FINALIZE",
        "INSPECTION",
        checkId,
        requestHash,
        201,
        { protocol: responseProtocol, rowVersion: persistedRowVersion },
        true,
      );
      await this.appendAuditEvent(client, {
        command,
        objectId: scope.object_id,
        inspectionId: scope.inspection_id,
        action: "INSPECTION_FINALIZE",
        targetType: "PROTOCOL",
        targetId: protocolId,
        beforeRef: {
          lifecycle: scope.lifecycle,
          rowVersion: currentVersion,
          runId: activeRun.rows[0].api_id,
          decisionSetHash,
          gapsHash,
        },
        afterRef: {
          lifecycle: "FINALIZED",
          rowVersion: persistedRowVersion,
          protocolId,
          protocolVersion: version,
          snapshotHash,
        },
        reason: input.acknowledgementReason,
      });

      return {
        kind: "success",
        protocol: responseProtocol,
        rowVersion: persistedRowVersion,
        replayed: false,
      } as const;
    });
  }

  async revokeProtocolCommand(
    protocolId: string,
    command: RevokeProtocolCommand,
  ): Promise<RevokeProtocolCommandResult> {
    if (command.actor.organizationId !== this.organizationId) return { kind: "not_found" };
    if (!command.actor.roles.some((role) => role === "SUPERVISOR" || role === "ADMIN")) {
      return { kind: "forbidden" };
    }
    const input: RevokeProtocolInput = command.input;
    const requestHash = sha256(canonicalJson(input));

    return this.transaction(async (client) => {
      const aggregate = await client.query<{
        protocol_internal_id: string;
        protocol_kind: "DRAFT" | "FINAL";
        protocol_version: string | number;
        protocol_snapshot: ProtocolExport | string;
        protocol_snapshot_hash: string;
        decision_set_hash: string;
        inspection_id: string;
        inspection_lifecycle: "OPEN" | "FINALIZED";
        inspection_row_version: string | number;
        active_run_id: string | null;
        protocol_run_id: string;
        object_id: string;
        object_api_id: string;
        permission_set: string[];
      }>(
        `SELECT
           protocol.id AS protocol_internal_id,
           protocol.kind AS protocol_kind,
           protocol.version AS protocol_version,
           protocol.snapshot_json AS protocol_snapshot,
           protocol.snapshot_hash AS protocol_snapshot_hash,
           protocol.decision_set_hash,
           inspection.id AS inspection_id,
           inspection.lifecycle AS inspection_lifecycle,
           inspection.row_version AS inspection_row_version,
           inspection.active_run_id,
           protocol.run_id AS protocol_run_id,
           object.id AS object_id,
           object.api_id AS object_api_id,
           access.permission_set
         FROM inspection_protocol_versions protocol
         JOIN inspections inspection ON inspection.id = protocol.inspection_id
         JOIN objects object ON object.id = inspection.object_id
         JOIN object_memberships access
           ON access.object_id = object.id
          AND access.user_id = $3
          AND access.revoked_at IS NULL
          AND access.permission_set @> ARRAY['READ']::text[]
         WHERE protocol.api_id = $1
           AND object.organization_id = $2
         FOR UPDATE OF inspection`,
        [protocolId, this.organizationId, command.actor.userId],
      );
      const scope = aggregate.rows[0];
      if (!scope) return { kind: "not_found" } as const;
      if (!scope.permission_set.includes("REVOKE")) return { kind: "forbidden" } as const;
      if (!scope.active_run_id) {
        return { kind: "invalid_state", code: "NO_ACTIVE_RUN", message: "У проверки нет активного запуска" } as const;
      }

      const activeRun = await client.query<{
        id: string;
        api_id: string;
        display_status: ObjectStatus;
        stats: CheckStats | string;
      }>(
        `SELECT id, api_id, display_status, stats
         FROM analysis_runs
         WHERE id = $1
         FOR UPDATE`,
        [scope.active_run_id],
      );
      const run = activeRun.rows[0];
      if (!run) {
        return { kind: "invalid_state", code: "NO_ACTIVE_RUN", message: "Активный запуск не найден" } as const;
      }

      await this.lockCommandReceipt(client, command, "PROTOCOL_REVOKE", "PROTOCOL", protocolId);
      const receipt = await this.getCommandReceipt<{ revocation: ProtocolRevocationResult }>(
        client,
        command,
        "PROTOCOL_REVOKE",
        "PROTOCOL",
        protocolId,
      );
      if (receipt) {
        if (receipt.requestHash !== requestHash) return { kind: "idempotency_conflict" } as const;
        return { kind: "success", revocation: receipt.response.revocation, replayed: true } as const;
      }

      const currentVersion = Number(scope.inspection_row_version);
      if (currentVersion !== command.expectedVersion) {
        return { kind: "precondition_failed", currentVersion } as const;
      }
      if (scope.inspection_lifecycle !== "FINALIZED") {
        return {
          kind: "invalid_state",
          code: "INVALID_TRANSITION",
          message: "Отзывать можно только протокол финализированной проверки",
        } as const;
      }
      if (scope.protocol_kind !== "FINAL" || scope.protocol_run_id !== run.id) {
        return {
          kind: "invalid_state",
          code: "NOT_CURRENT_FINAL",
          message: "Отзывать можно только действующий FINAL текущего запуска",
        } as const;
      }

      const currentFinal = await client.query<{ id: string }>(
        `SELECT candidate.id
         FROM inspection_protocol_versions candidate
         LEFT JOIN protocol_revocations revocation ON revocation.protocol_id = candidate.id
         WHERE candidate.inspection_id = $1
           AND candidate.kind = 'FINAL'
           AND revocation.id IS NULL
         ORDER BY candidate.version DESC
         LIMIT 1`,
        [scope.inspection_id],
      );
      if (currentFinal.rows[0]?.id !== scope.protocol_internal_id) {
        return {
          kind: "invalid_state",
          code: "NOT_CURRENT_FINAL",
          message: "Протокол уже отозван или не является текущим действующим FINAL",
        } as const;
      }

      const nextVersion = await client.query<{ next_version: string | number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM inspection_protocol_versions
         WHERE inspection_id = $1`,
        [scope.inspection_id],
      );
      const version = Number(nextVersion.rows[0].next_version);
      const createdAt = new Date().toISOString();
      const nextRowVersion = currentVersion + 1;
      const draftProtocolId = `PRT-${randomUUID().toUpperCase()}`;
      const revocationId = `REV-${randomUUID().toUpperCase()}`;
      const previousSnapshot = parseJson<ProtocolExport>(scope.protocol_snapshot);
      const draftProtocol: ProtocolVersion = {
        id: draftProtocolId,
        checkId: run.api_id,
        version,
        status: "DRAFT",
        createdAt,
        createdBy: command.actor.displayName,
        stats: previousSnapshot.protocol?.stats ?? parseJson(run.stats),
      };
      const draftSnapshot: ProtocolExport = {
        ...previousSnapshot,
        protocol: draftProtocol,
        ...(previousSnapshot.scope
          ? {
              scope: {
                ...previousSnapshot.scope,
                inspection: {
                  ...previousSnapshot.scope.inspection,
                  lifecycle: "OPEN" as const,
                  rowVersion: nextRowVersion,
                },
              },
            }
          : {}),
        lineage: {
          previousProtocolId: protocolId,
          previousSnapshotHash: scope.protocol_snapshot_hash,
          basis: "REVOCATION",
          reasonCode: input.reasonCode,
          comment: input.comment,
          actorId: command.actor.userId,
          actorName: command.actor.displayName,
          createdAt,
        },
      };
      const canonicalDraftSnapshot = canonicalJson(draftSnapshot);
      const draftSnapshotHash = sha256(canonicalDraftSnapshot);
      const draftArtifactId = `ART-${randomUUID().toUpperCase()}`;
      const insertedDraft = await client.query<{ id: string }>(
        `INSERT INTO inspection_protocol_versions (
           api_id, inspection_id, run_id, version, kind, snapshot_json,
           snapshot_hash, decision_set_hash, created_by, created_at
         ) VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, $6, $7, $8, $9)
         RETURNING id`,
        [
          draftProtocolId,
          scope.inspection_id,
          run.id,
          version,
          JSON.stringify(draftSnapshot),
          draftSnapshotHash,
          scope.decision_set_hash,
          command.actor.displayName,
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO protocol_revocations (
           api_id, protocol_id, actor_user_id, reason_code, comment,
           replacement_protocol_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          revocationId,
          scope.protocol_internal_id,
          command.actor.userId,
          input.reasonCode,
          input.comment,
          insertedDraft.rows[0].id,
          createdAt,
        ],
      );
      const inspection = await client.query<{ row_version: string | number }>(
        `UPDATE inspections
         SET lifecycle = 'OPEN', row_version = row_version + 1, updated_at = $1
         WHERE id = $2
         RETURNING row_version`,
        [createdAt, scope.inspection_id],
      );
      const persistedRowVersion = Number(inspection.rows[0].row_version);
      await client.query(
        `UPDATE objects
         SET display_status = $1, updated_at = $2
         WHERE id = $3`,
        [run.display_status, createdAt, scope.object_id],
      );

      const draftProtocolEnvelope: ProtocolVersion = {
        ...draftProtocol,
        snapshotHash: draftSnapshotHash,
        validity: "DRAFT",
        revocation: null,
        canonicalArtifact: {
          id: draftArtifactId,
          protocolId: draftProtocolId,
          format: "JSON",
          mediaType: "application/json",
          canonicalizationVersion: "inspector-c14n-v1",
          byteSize: Buffer.byteLength(canonicalDraftSnapshot),
          contentHash: draftSnapshotHash,
          createdAt,
        },
      };
      await this.insertCanonicalProtocolArtifact(
        client,
        insertedDraft.rows[0].id,
        draftArtifactId,
        canonicalDraftSnapshot,
        draftSnapshotHash,
        createdAt,
      );
      const revocation: ProtocolRevocationResult = {
        id: revocationId,
        protocolId,
        checkId: run.api_id,
        reasonCode: input.reasonCode,
        comment: input.comment,
        revokedAt: createdAt,
        revokedBy: command.actor.displayName,
        replacementProtocolId: draftProtocolId,
        rowVersion: persistedRowVersion,
        draftProtocol: draftProtocolEnvelope,
      };
      await this.insertCommandReceipt(
        client,
        command,
        "PROTOCOL_REVOKE",
        "PROTOCOL",
        protocolId,
        requestHash,
        201,
        { revocation },
        true,
      );
      await this.appendAuditEvent(client, {
        command,
        objectId: scope.object_id,
        inspectionId: scope.inspection_id,
        action: "PROTOCOL_REVOKE",
        targetType: "PROTOCOL",
        targetId: protocolId,
        beforeRef: {
          lifecycle: "FINALIZED",
          rowVersion: currentVersion,
          protocolId,
          protocolVersion: Number(scope.protocol_version),
          snapshotHash: scope.protocol_snapshot_hash,
          validity: "VALID",
        },
        afterRef: {
          lifecycle: "OPEN",
          rowVersion: persistedRowVersion,
          revocationId,
          protocolId,
          validity: "REVOKED",
          replacementProtocolId: draftProtocolId,
          replacementSnapshotHash: draftSnapshotHash,
        },
        reason: `${input.reasonCode}: ${input.comment}`,
      });

      return { kind: "success", revocation, replayed: false } as const;
    });
  }

  private async insertCanonicalProtocolArtifact(
    client: PoolClient,
    protocolInternalId: string,
    artifactId: string,
    canonicalSnapshot: string,
    contentHash: string,
    createdAt: string,
  ): Promise<void> {
    const bytes = Buffer.from(canonicalSnapshot, "utf8");
    await client.query(
      `INSERT INTO protocol_artifacts (
         api_id, protocol_id, format, media_type, canonicalization_version,
         byte_size, content_hash, content_bytes, created_at
       ) VALUES ($1, $2, 'JSON', 'application/json', 'inspector-c14n-v1', $3, $4, $5, $6)`,
      [artifactId, protocolInternalId, bytes.byteLength, contentHash, bytes, createdAt],
    );
  }

  async getProtocols(checkId: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<ProtocolVersion[]>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<ProtocolRow>(
      `${protocolSelect}
       WHERE object.organization_id = $1
         AND run.api_id = $2
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )
       ORDER BY protocol.version`,
      [this.organizationId, checkId, actor.userId],
    );
    return result.rows.map(mapProtocol);
  }

  async getProtocol(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<ProtocolVersion>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<ProtocolRow>(
      `${protocolSelect}
       WHERE object.organization_id = $1
         AND protocol.api_id = $2
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    return result.rows[0] ? mapProtocol(result.rows[0]) : undefined;
  }

  async getProtocolExport(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<ProtocolExport>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<ProtocolRow>(
      `${protocolSelect}
       WHERE inspection.organization_id = $1
         AND protocol.api_id = $2
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    if (!result.rows[0]) return undefined;
    const protocol = mapProtocol(result.rows[0]);
    return {
      ...parseJson(result.rows[0].snapshot_json),
      snapshotHash: result.rows[0].snapshot_hash,
      validity: protocol.validity,
      revocation: protocol.revocation,
    };
  }

  async getCanonicalProtocolArtifact(
    id: string,
    actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<ProtocolCanonicalArtifactContent>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const result = await this.readQuery<ProtocolArtifactRow>(
      `SELECT
         artifact.api_id,
         protocol.api_id AS protocol_api_id,
         artifact.byte_size,
         artifact.content_hash,
         artifact.content_bytes,
         artifact.created_at
       FROM protocol_artifacts artifact
       JOIN inspection_protocol_versions protocol ON protocol.id = artifact.protocol_id
       JOIN inspections inspection ON inspection.id = protocol.inspection_id
       JOIN objects object ON object.id = inspection.object_id
       WHERE object.organization_id = $1
         AND protocol.api_id = $2
         AND artifact.format = 'JSON'
         AND artifact.canonicalization_version = 'inspector-c14n-v1'
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, id, actor.userId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      artifact: {
        id: row.api_id,
        protocolId: row.protocol_api_id,
        format: "JSON",
        mediaType: "application/json",
        canonicalizationVersion: "inspector-c14n-v1",
        byteSize: Number(row.byte_size),
        contentHash: row.content_hash,
        createdAt: asIso(row.created_at),
      },
      bytes: row.content_bytes,
    };
  }

  async getSubmission(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Promise<SubmissionResult | "AUTH_REQUIRED"> {
    const check = await this.getCheck(checkId, actor);
    if (check === "AUTH_REQUIRED") return check;
    if (!check) return undefined;
    return "INCOMPLETE_ANALYSIS";
  }

  async getParameters(): Promise<ParameterCatalogItem[]> {
    return this.parameters;
  }

  async getCoverage(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<ParameterCoverageItem[]>> {
    if (!actor) return "AUTH_REQUIRED";
    if (!this.hasReadScope(actor)) return undefined;
    const run = await this.readQuery<{ id: string }>(
      `SELECT run.id
       FROM analysis_runs run
       JOIN objects object ON object.id = run.object_id
       WHERE object.organization_id = $1
         AND run.api_id = $2
         AND EXISTS (
           SELECT 1
           FROM object_memberships access
           WHERE access.object_id = object.id
             AND access.user_id = $3
             AND access.revoked_at IS NULL
             AND access.permission_set @> ARRAY['READ']::text[]
         )`,
      [this.organizationId, checkId, actor.userId],
    );
    if (!run.rows[0]) return undefined;
    const coverage = await this.readQuery<{
      parameter_id: number;
      parameter_code: string;
      parameter_name: string;
      execution_rollup: "UNSUPPORTED" | "PARTIAL";
      reason: string;
    }>(
      `SELECT parameter_id, parameter_code, parameter_name, execution_rollup, reason
       FROM parameter_coverage
       WHERE run_id = $1
       ORDER BY parameter_id`,
      [run.rows[0].id],
    );
    return coverage.rows.map((item) => ({
      parameterId: item.parameter_id,
      parameterCode: item.parameter_code,
      parameterName: item.parameter_name,
      executionStatus: item.execution_rollup,
      reason: item.reason,
    }));
  }

  private async lockCommandReceipt(
    client: PoolClient,
    command: AuditedMutationCommand,
    operation: string,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    const lockKey = canonicalJson({
      actorUserId: command.actor.userId,
      operation,
      targetType,
      targetId,
      idempotencyKey: command.idempotencyKey,
    });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
  }

  private async getCommandReceipt<T extends Record<string, unknown>>(
    client: PoolClient,
    command: AuditedMutationCommand,
    operation: string,
    targetType: string,
    targetId: string,
  ): Promise<{ requestHash: string; response: T } | undefined> {
    const receipt = await client.query<{
      request_hash: string;
      response_json: T | string;
    }>(
      `SELECT request_hash, response_json
       FROM command_receipts
       WHERE actor_user_id = $1
         AND operation = $2
         AND target_type = $3
         AND target_id = $4
         AND idempotency_key = $5`,
      [command.actor.userId, operation, targetType, targetId, command.idempotencyKey],
    );
    if (!receipt.rows[0]) return undefined;
    return {
      requestHash: receipt.rows[0].request_hash,
      response: parseJson(receipt.rows[0].response_json),
    };
  }

  private async insertCommandReceipt(
    client: PoolClient,
    command: AuditedMutationCommand,
    operation: string,
    targetType: string,
    targetId: string,
    requestHash: string,
    responseStatus: number,
    response: Record<string, unknown>,
    durable = false,
  ): Promise<void> {
    await client.query(
      `INSERT INTO command_receipts (
         actor_user_id, operation, target_type, target_id, idempotency_key,
         request_hash, response_status, response_json, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
         CASE WHEN $9::boolean THEN 'infinity'::timestamptz ELSE now() + interval '30 days' END
       )`,
      [
        command.actor.userId,
        operation,
        targetType,
        targetId,
        command.idempotencyKey,
        requestHash,
        responseStatus,
        JSON.stringify(response),
        durable,
      ],
    );
  }

  private async appendAuditEvent(
    client: PoolClient,
    event: {
      command: AuditedMutationCommand;
      objectId: string;
      inspectionId: string;
      action: string;
      targetType: string;
      targetId: string;
      beforeRef: Record<string, unknown> | null;
      afterRef: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [this.organizationId]);
    const previousAudit = await client.query<{ event_hash: string }>(
      `SELECT event_hash
       FROM audit_events
       WHERE organization_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [this.organizationId],
    );
    const previousEventHash = previousAudit.rows[0]?.event_hash ?? null;
    const createdAt = new Date().toISOString();
    const eventHash = sha256(canonicalJson({
      organizationId: this.organizationId,
      objectId: event.objectId,
      inspectionId: event.inspectionId,
      actorUserId: event.command.actor.userId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      beforeRef: event.beforeRef,
      afterRef: event.afterRef,
      reason: event.reason ?? null,
      requestId: event.command.requestId,
      traceId: event.command.traceId,
      previousEventHash,
      createdAt,
    }));
    await client.query(
      `INSERT INTO audit_events (
         organization_id, object_id, inspection_id, actor_user_id,
         action, target_type, target_id, before_ref, after_ref, reason,
         request_id, trace_id, ip_address, user_agent,
         previous_event_hash, event_hash, created_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8::jsonb, $9::jsonb, $10,
         $11, $12, $13, $14,
         $15, $16, $17
       )`,
      [
        this.organizationId,
        event.objectId,
        event.inspectionId,
        event.command.actor.userId,
        event.action,
        event.targetType,
        event.targetId,
        event.beforeRef ? JSON.stringify(event.beforeRef) : null,
        JSON.stringify(event.afterRef),
        event.reason ?? null,
        event.command.requestId,
        event.command.traceId,
        event.command.ipAddress ?? null,
        event.command.userAgent ?? null,
        previousEventHash,
        eventHash,
        createdAt,
      ],
    );
  }

  private hasReadScope(actor?: AuthenticatedActor): actor is AuthenticatedActor {
    return Boolean(actor && actor.organizationId === this.organizationId);
  }

  async hasObjectPermission(
    objectApiId: string,
    actor: AuthenticatedActor,
    permission: string,
  ): Promise<boolean> {
    if (actor.organizationId !== this.organizationId) return false;
    return this.hasObjectPermissionForUser(objectApiId, actor.userId, permission);
  }

  private async hasObjectPermissionForUser(
    objectApiId: string,
    userId: string,
    permission: string,
  ): Promise<boolean> {
    const result = await this.readQuery(
      `SELECT 1
       FROM objects object
       JOIN object_memberships access ON access.object_id = object.id
       WHERE object.organization_id = $1
         AND object.api_id = $2
         AND access.user_id = $3
         AND access.revoked_at IS NULL
         AND access.permission_set @> ARRAY[$4]::text[]
       LIMIT 1`,
      [this.organizationId, objectApiId, userId, permission],
    );
    return result.rowCount === 1;
  }

  private async getObjectUnscoped(id: string): Promise<InspectionObject | undefined> {
    const result = await this.readQuery<ObjectRow>(
      `${objectSelect}
       WHERE o.organization_id = $1 AND o.api_id = $2`,
      [this.organizationId, id],
    );
    return result.rows[0] ? mapObject(result.rows[0]) : undefined;
  }

  private async getCheckUnscoped(id: string): Promise<CheckRun | undefined> {
    const result = await this.readQuery<CheckRow>(
      `${checkSelect}
       WHERE object.organization_id = $1 AND run.api_id = $2`,
      [this.organizationId, id],
    );
    return result.rows[0] ? mapCheck(result.rows[0]) : undefined;
  }

  private async getFindingUnscoped(id: string): Promise<Finding | undefined> {
    const result = await this.readQuery<FindingRow>(
      `${findingSelect}
       WHERE object.organization_id = $1
         AND item.api_id = $2
         AND item.lifecycle = 'ACTIVE'
         AND result.execution_status = 'SUCCEEDED'
         AND result.machine_status IS NOT NULL`,
      [this.organizationId, id],
    );
    return result.rows[0] ? mapFinding(result.rows[0]) : undefined;
  }

  private async readQuery<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: Array<string | number | null> = [],
  ): Promise<QueryResult<Row>> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.pool.query<Row>(text, values);
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (!code || !retryableReadErrorCodes.has(code) || attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
