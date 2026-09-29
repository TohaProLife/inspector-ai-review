import type {
  BinaryUploadRecord,
  CheckRun,
  CreateObjectInput,
  DecisionInput,
  FinalizeCheckInput,
  Finding,
  IngestedDocumentFile,
  InspectionObject,
  ParameterCatalogItem,
  ParameterCoverageItem,
  ProtocolArtifactSummary,
  ProtocolExport,
  ProtocolRevocationResult,
  ProtocolVersion,
  RevokeProtocolInput,
  SourceReviewDecision,
  SourceReviewInput,
  SourceFileSummary,
} from "@inspector-ai/contracts";
import type { AuthenticatedActor } from "./identity.js";
import type {
  OcrRowTranscriptionReviewInput,
  ValidatedOcrRowTranscriptionReview,
} from "./ocr-row-transcription-review.js";
import type {
  OcrRowApplicabilityReviewInput,
  ValidatedOcrRowApplicabilityReview,
} from "./ocr-row-applicability-review.js";
import type { OcrTypedFactV2 } from "./ocr-typed-fact-v2.js";
import type { OcrFactPairReviewInput, ValidatedOcrFactPairReview } from "./ocr-fact-pair-review.js";
import type { OcrFactPairQuantityReviewInput,
  ValidatedOcrFactPairQuantityReview } from "./ocr-fact-pair-quantity-review.js";
import type { OcrFactPairComparisonPreview } from "./ocr-fact-pair-comparison.js";

export type { OcrRowTranscriptionReviewInput } from "./ocr-row-transcription-review.js";
export type { OcrRowApplicabilityReviewInput } from "./ocr-row-applicability-review.js";
export type { OcrFactPairReviewInput } from "./ocr-fact-pair-review.js";
export type { OcrFactPairQuantityReviewInput } from "./ocr-fact-pair-quantity-review.js";

export type Awaitable<T> = T | Promise<T>;

export interface SubmissionExport {
  object_id: string;
  checks: Array<{
    parameter_code: string;
    location: string;
    pd_value: string | null;
    rd_value: string | null;
    id_value: string | null;
    violation_label: "VIOLATION_PRESENT" | "NO_VIOLATION" | "COMPARISON_IMPOSSIBLE";
    protocol_status: "OK" | "WARNING" | "CRITICAL" | "COMPARISON_IMPOSSIBLE";
    criticality: string;
    evidence: Array<{ stage: "PD" | "RD" | "ID"; file_id: string; pdf_page_number: number }>;
  }>;
}

export type FinalizeResult = ProtocolVersion | "PENDING_DECISIONS" | "INCOMPLETE_ANALYSIS" | undefined;
export type SubmissionResult = SubmissionExport | "PENDING_DECISIONS" | "INCOMPLETE_ANALYSIS" | undefined;
export type DecisionResult = Finding | "IDENTITY_REQUIRED" | undefined;

export interface SourceFileContent {
  name: string;
  storageKey: string;
  byteSize: number;
  sha256: string;
  mediaType: string;
}

export interface ReviewFindingResource {
  finding: Finding;
  mode: "DEMO_SEED" | "NORMAL";
  rowVersion: number;
}

export type ReviewFindingResult = ReviewFindingResource | "AUTH_REQUIRED" | undefined;
export type ScopedReadResult<T> = T | "AUTH_REQUIRED" | undefined;

export interface PilotResultFactRead {
  stage: "PD" | "RD";
  component: string | null;
  sourceFileId: string;
  sourceSha256: string;
  pageNumber: number;
  rawValue: string | null;
  rawUnit: string | null;
  value: string;
  unit: string;
}

export interface PilotRuleResultRead {
  resultId: string;
  parameterCode: "PZ-002" | "PZ-017";
  ruleKey: string;
  ruleVersion: string;
  executionStatus: "SUCCEEDED";
  machineStatus: string;
  reasonCode: string | null;
  comparison: { disposition: string; reasonCode: string | null } | null;
  facts: PilotResultFactRead[];
}

export interface OcrHeatEvidenceRead {
  role: "section" | "rowLabel" | "basisContinuation" | "value";
  lineIndex: number;
  text: string;
  bboxPx: [number, number, number, number];
  score: number;
}

export interface OcrHeatProposalRead {
  sourceFileId: string;
  inputSha256: string;
  pageNumber: number;
  stage: "RD";
  component: "HEATING" | "VENTILATION" | "DHW";
  basis: "DESIGN_HEAT_RATE" | "MAX_INCLUDING_CIRCULATION" | "MEAN";
  values: { kW: string; "Gcal/h": string };
  ocrPageContentHash: string;
  renderSha256: string;
  evidence: OcrHeatEvidenceRead[];
}

export interface OcrHeatAbstentionRead {
  sourceFileId: string;
  inputSha256: string;
  pageNumber: number;
  lineIndex: number;
  reasonCode: string;
  evidence: OcrHeatEvidenceRead[];
}

export interface OcrHeatRowsRead {
  profileId: "conservative-ocr-heat-rows-v1";
  inputManifestHash: string;
  proposals: OcrHeatProposalRead[];
  abstentions: OcrHeatAbstentionRead[];
  findingCount: 0;
  proposalCount: number;
  abstentionCount: number;
  truncated: boolean;
}

export interface PilotResultsRead {
  checkId: string;
  status: "PROCESSING" | "READY" | "FAILED" | "CANCELLED";
  items: PilotRuleResultRead[];
  ocrHeatRows: OcrHeatRowsRead | null;
  factFamily?: FactFamilyRead;
  candidateFamilyPreview?: CandidateFamilyPreviewRead;
  candidateFamilyObservations?: CandidateFamilyObservationsRead;
  reviewCandidates?: ReviewCandidatesRead;
  candidateFamilyOcrObservations?: CandidateFamilyOcrObservationsRead;
  ocrTableRows?: OcrTableRowsRead;
  unresolvedFamilyReview?: UnresolvedFamilyReviewRead;
  unresolvedFamilyOcrReview?: UnresolvedFamilyOcrReviewRead;
  siteTepAreaReview?: SiteTepAreaReviewRead;
  siteGpContextReview?: SiteGpContextReviewRead;
  siteGpTableRowReview?: SiteGpTableRowReviewRead;
  equipmentSpecReview?: EquipmentSpecReviewRead;
  materialClassReview?: MaterialClassReviewRead;
  unresolvedConfigReview?: UnresolvedConfigReviewRead;
  unresolvedConfigReviewV2?: UnresolvedConfigReviewV2Read;
  unresolvedConfigReviewV3?: UnresolvedConfigReviewV3Read;
  layerAssemblyReview?: LayerAssemblyReviewRead;
  kr065OpeningReview?: Kr065OpeningReviewRead;
}

/** Text anchors for KR-065 openings; contour, element and reinforcement unverified. */
export interface Kr065OpeningReviewRead {
  schemaVersion: "kr065-opening-proposals-v1";
  profileId: "kr065-opening-review-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "KR-065";
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    oversizeAnchorLineCount: number;
    duplicateAnchorCount: number;
    proposalCount: number;
    truncatedProposalCount: number;
    abstentionCount: number;
    truncatedAbstentionCount: number;
    absenceConclusion: "NOT_AVAILABLE";
    proposals: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageSha256: string;
      pageNumber: number;
      sourceStage: "RD";
      sourceSection: "KR";
      proposalKind: string;
      rawOpeningNumber: string | null;
      rawDimensionsText: string | null;
      rawAxes: null;
      rawLevel: null;
      drawingContourAssociation: "UNVERIFIED";
      detailAssociation: "UNVERIFIED";
      sameElementAssociation: "UNVERIFIED";
      reinforcementStatus: "NOT_ESTABLISHED";
      unauthorizedFillStatus: "NOT_ESTABLISHED";
      anchor: {
        blockIndex: number;
        lineIndex: number;
        lineText: string;
        lineTextSha256: string;
        blockTextSha256: string;
        bboxMilliPoints: [number, number, number, number];
      };
      scopedSha256: string;
    }>;
    abstentions: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageSha256: string;
      pageNumber: number;
      sourceStage: "RD";
      sourceSection: "KR";
      reasonCode: string;
      anchor: {
        blockIndex: number;
        lineIndex: number;
        lineText: string;
        lineTextSha256: string;
        blockTextSha256: string;
        bboxMilliPoints: [number, number, number, number];
      };
      scopedSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Layer and thickness block neighborhoods; rows and construction types remain unverified. */
export interface LayerAssemblyReviewRead {
  schemaVersion: "layer-assembly-proposals-v1";
  profileId: "layer-assembly-review-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "SPZU-032" | "AR-044" | "ZU-125";
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    oversizeAnchorLineCount: number;
    proposalCount: number;
    truncatedProposalCount: number;
    abstentionCount: number;
    truncatedAbstentionCount: number;
    absenceConclusion: "NOT_AVAILABLE";
    proposals: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageSha256: string;
      pageNumber: number;
      sourceStage: "PD";
      sourceSection: string;
      proposalKind: string;
      rowAssociationStatus: "UNVERIFIED";
      typeAssociationStatus: "UNVERIFIED";
      zoneAssociationStatus: "UNVERIFIED";
      rawThickness: null;
      rawQuantity: null;
      roles: Record<string, {
        blockIndex: number;
        lineIndex: number;
        lineText: string;
        lineTextSha256: string;
        blockTextSha256: string;
        bboxMilliPoints: [number, number, number, number];
      }>;
      scopedSha256: string;
    }>;
    abstentions: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageSha256: string;
      pageNumber: number;
      sourceStage: "PD";
      sourceSection: string;
      reasonCode: string;
      anchor: {
        blockIndex: number;
        lineIndex: number;
        lineText: string;
        lineTextSha256: string;
        blockTextSha256: string;
        bboxMilliPoints: [number, number, number, number];
      };
      scopedSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Network topology navigation only; line and branch identity remain unverified. */
export interface UnresolvedConfigReviewV3Read extends Omit<UnresolvedConfigReviewRead,
  "schemaVersion" | "profileId" | "codeRows"> {
  schemaVersion: "unresolved-config-run-review-v3";
  profileId: "unresolved-review-config-v3";
  codeRows: Array<Omit<UnresolvedConfigReviewRead["codeRows"][number],
    "candidateExtractorFamily"> & {
    candidateExtractorFamily: "NETWORK_TOPOLOGY";
  }>;
}

/** Second pinned review-only batch; approvals and norms remain unverified. */
export interface UnresolvedConfigReviewV2Read extends Omit<UnresolvedConfigReviewRead,
  "schemaVersion" | "profileId" | "codeRows"> {
  schemaVersion: "unresolved-config-run-review-v2";
  profileId: "unresolved-review-config-v2";
  codeRows: Array<Omit<UnresolvedConfigReviewRead["codeRows"][number],
    "candidateExtractorFamily"> & {
    candidateExtractorFamily: "DOCUMENT_APPROVAL" | "SAFETY_COVERAGE";
  }>;
}

/** Config-pinned literal text locators for unresolved codes; never findings. */
export interface UnresolvedConfigReviewRead {
  schemaVersion: "unresolved-config-run-review-v1";
  profileId: "unresolved-review-config-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  configSha256: string;
  registrySha256: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: string;
    candidateExtractorFamily: "AREA_PROGRAM" | "DIMENSION_LAYOUT";
    locatorType: "TEXT_LINE_BBOX_ONLY";
    requiredProofGates: string[];
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    oversizeAnchorLineCount: number;
    leadCount: number;
    truncatedLeadCount: number;
    leadCountSemantics: "MATCHES_IN_SCANNED_TEXT_ONLY";
    absenceConclusion: "NOT_AVAILABLE";
    leads: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      sourceStage: "PD" | "RD";
      sourceSection: string;
      pageNumber: number;
      blockIndex: number;
      lineIndex: number;
      blockTextSha256: string;
      lineText: string;
      lineTextSha256: string;
      bboxMilliPoints: [number, number, number, number];
      matchedAnchors: string[];
      locatorType: "TEXT_LINE_BBOX_ONLY";
      elementAssociationStatus: "UNVERIFIED";
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Literal KR mentions; physical element and actual protection stay unverified. */
export interface MaterialClassReviewRead {
  schemaVersion: "material-class-run-review-v1";
  profileId: "material-class-text-navigation-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "KR-056" | "KR-057" | "KR-066";
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    leadCount: number;
    leads: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      sourceStage: "PD" | "RD";
      sourceRole: "KR_MATERIAL_NAVIGATION";
      pageNumber: number;
      blockIndex: number;
      lineIndex: number;
      blockTextSha256: string;
      lineText: string;
      lineTextSha256: string;
      bboxMilliPoints: [number, number, number, number];
      leadKind: string;
      elementAssociationStatus: "UNVERIFIED";
      crossFileMatchStatus: "UNVERIFIED";
      actualProtectionStatus?: "NOT_ESTABLISHED";
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Exact equipment text locators; never assembled equipment records. */
export interface EquipmentSpecReviewRead {
  schemaVersion: "equipment-spec-run-review-v1";
  profileId: "equipment-spec-text-navigation-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "IOS4-077" | "IOS4-079" | "PPM-112";
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    leadCount: number;
    leads: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      sourceStage: "PD" | "RD";
      sourceRole: "OV_EQUIPMENT_NAVIGATION";
      pageNumber: number;
      blockIndex: number;
      lineIndex: number;
      blockTextSha256: string;
      lineText: string;
      lineTextSha256: string;
      bboxMilliPoints: [number, number, number, number];
      leadKind: "REGISTER_PROSE" | "CALCULATION_PROSE" | "SCHEDULE_TOKEN" | "CONTEXT_UNRESOLVED";
      rowAssociationStatus: "UNVERIFIED";
      systemAssignmentStatus: "UNVERIFIED";
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Block adjacency for manual navigation. No verified table row or quantity. */
export interface SiteGpTableRowReviewRead {
  schemaVersion: "site-gp-table-row-proposals-v1";
  profileId: "site-gp-table-row-review-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "SPZU-029" | "SPZU-032";
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    proposalCount: number;
    abstentionCount: number;
    proposals: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageNumber: number;
      sourceRole: "PD_GP_TABLE";
      proposalKind: "ROAD_LAYER_THICKNESS_ADJACENCY" | "ROAD_ASSEMBLY_WORK_TYPE_ADJACENCY" | "MAF_POSITION_NAME_ADJACENCY";
      rowAssociationStatus: "UNVERIFIED";
      reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"];
      rawQuantity?: null;
      quantityStatus?: "UNKNOWN";
      unitInterpretationStatus?: "UNVERIFIED";
      assemblyTypeStatus?: "UNRESOLVED";
      layerAssociationStatus?: "UNRESOLVED";
      roles: Record<string, { blockIndex: number; blockText: string; blockTextSha256: string; bboxMilliPoints: [number, number, number, number] }>;
      adjacencyEvidenceSha256: string;
      scopedSha256: string;
    }>;
    abstentions: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageNumber: number;
      sourceRole: "PD_GP_TABLE";
      reasonCode: string;
      anchor: { blockIndex: number; blockText: string; blockTextSha256: string; bboxMilliPoints: [number, number, number, number] };
      abstentionSha256: string;
      scopedSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Source-bound PD/GP context labels; never design facts or coverage. */
export interface SiteGpContextReviewRead {
  schemaVersion: "site-gp-context-run-review-v1";
  profileId: "site-gp-context-text-review-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "SPZU-029" | "SPZU-032" | "SPZU-033" | "SPZU-035" | "SPZU-036";
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    leadCount: number;
    leads: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageNumber: number;
      blockIndex: number;
      lineIndex: number;
      lineText: string;
      blockTextSha256: string;
      bboxMilliPoints: [number, number, number, number];
      sourceRole: "PD_GP_CONTEXT";
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Source-bound PD/GP table-label addresses; never area facts or coverage. */
export interface SiteTepAreaReviewRead {
  schemaVersion: "site-tep-area-run-review-v1";
  profileId: "site-tep-area-text-review-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "PZ-001" | "SPZU-026" | "SPZU-027";
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textCandidatePageCount: number;
    ocrRequiredPageCount: number;
    leadCount: number;
    leads: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageNumber: number;
      blockIndex: number;
      lineIndex: number;
      lineText: string;
      blockTextSha256: string;
      bboxMilliPoints: [number, number, number, number];
      sourceRole: "PD_GP_TEP";
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** OCR v6 navigation leads from one committed run; no facts or coverage. */
export interface UnresolvedFamilyOcrReviewRead {
  schemaVersion: "unresolved-family-ocr-review-v1";
  profileId: "unresolved-family-ocr-review-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  ocrStageSha256: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "AR-042" | "IOS2-072" | "IOS3-075";
    status: "ABSTAIN";
    reasonCodes: string[];
    leads: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      ocrStageSha256: string;
      ocrPageSha256: string;
      pageNumber: number;
      stage: "PD" | "RD";
      sectionCode: "AR" | "VK";
      coordinateSystem: "IMAGE_TOP_LEFT_PIXELS";
      lineIndex: number;
      lineText: string;
      score: number;
      bboxPx: [number, number, number, number];
      renderSha256: string;
      rendererProfileId: string;
      providerProfileId: string;
      providerScript: string;
      dpi: number;
      widthPx: number;
      heightPx: number;
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

/** Text-only leads from a committed run. Each code remains ABSTAIN. */
export interface UnresolvedFamilyReviewRead {
  schemaVersion: "unresolved-family-run-review-v1";
  profileId: "unresolved-family-text-review-v1";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  sourceStageArtifacts: Array<{
    sourceFileId: string;
    sourceSha256: string;
    textArtifactSha256: string;
  }>;
  codeRows: Array<{
    parameterCode: "AR-042" | "IOS2-072" | "IOS3-075";
    status: "ABSTAIN";
    reasonCodes: string[];
    leads: Array<{
      sourceFileId: string;
      sourceSha256: string;
      textArtifactSha256: string;
      pageNumber: number;
      blockIndex: number;
      lineIndex: number;
      lineText: string;
      blockTextSha256: string;
      bboxMilliPoints: number[];
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export interface OcrTableRowsRead {
  profileId: "conservative-ocr-table-rows-v1" | "conservative-ocr-table-rows-v2"
    | "conservative-ocr-table-rows-v3";
  inputManifestHash: string;
  proposals: Array<{
    sourceFileId: string; inputSha256: string; pageNumber: number;
    ocrPageContentHash: string; renderSha256: string;
    headerEvidence: Array<{ role: string; lineIndex: number; text: string;
      bboxPx: number[]; score: number }>;
    labelEvidence: { role: string; lineIndex: number; text: string;
      bboxPx: number[]; score: number };
    labelContinuationEvidence?: Array<{ role: "rowLabelContinuation"; lineIndex: number;
      text: string; bboxPx: number[]; score: number }>;
    valueEvidence: { role: string; lineIndex: number; text: string;
      bboxPx: number[]; score: number };
  }>;
  abstentions: Array<{ sourceFileId: string; inputSha256: string;
    pageNumber: number; lineIndex: number | null; reasonCode: string }>;
  findingCount: 0;
  proposalCount: number;
  abstentionCount: number;
  truncated: boolean;
}

export interface CandidateFamilyPreviewRead {
  schemaVersion: "candidate-family-preview-v1";
  inputManifestHash: string;
  objectId: string;
  scope: "RUN_COMMITTED_SOURCES";
  purpose: "REVIEW_ONLY";
  candidateRulePackSha256: string;
  numericLabelPackSha256: string;
  classLabelPackSha256: string;
  presenceLabelPackSha256: string;
  codeRows: Record<string, unknown>[];
  findingCount: null;
  parameterCoverage: null;
  outputCount: 47;
  contentHash: string;
}

export interface CandidateFamilyObservationsRead {
  schemaVersion: "candidate-family-observations-v1";
  purpose: "REVIEW_ONLY";
  inputManifestHash: string;
  objectId: string;
  candidateRulePackSha256: string;
  numericLabelPackSha256: string;
  classLabelPackSha256: string;
  presenceLabelPackSha256: string;
  codeRows: Record<string, unknown>[];
  observations: Record<string, unknown>[];
  outputCount: number;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export interface ReviewCandidatesRead {
  schemaVersion: "review-candidates-v1";
  resultType: "REVIEW_CANDIDATE";
  objectId: string;
  inputManifestHash: string;
  candidateCount: number;
  truncated: boolean;
  candidates: Array<{
    candidateId: string; resultType: "REVIEW_CANDIDATE";
    reason: "EXACT_LABEL_LINE" | "PAGE_TOPIC_LINE";
    kind: "ONE_DOCUMENT_SIGNAL" | "POSSIBLE_PAIR" | "POSSIBLE_DIFFERENCE";
    parameterCode: string; family: string; attribute: string;
    matchedLabel: string; rawValue: string; rawUnit: string | null;
    sourceFileId: string; sourceSha256: string; artifactSha256: string;
    pageNumber: number; pageWidthMilliPoints: number; pageHeightMilliPoints: number;
    stage: "PD" | "RD" | null; sectionCode: string | null;
    revisionStatus: string; approvalStatus: string; origin: "PDF_TEXT_LAYER";
    lineText: string; blockTextSha256: string;
    locator: { kind: "DOCUMENT_TEXT_BLOCK_LINE"; blockIndex: number;
      lineIndex: number; start: number; end: number; bboxMilliPoints: number[] };
    relatedDocuments: Array<{ sourceFileId: string; sourceSha256: string;
      pageNumber: number; rawValue: string; rawUnit: string | null; lineText: string }>;
    missingConfirmation: string[]; suggestedElement: null; rank: number;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export interface ReviewCandidateDecisionInput {
  schemaVersion: "review-candidate-decision-v1";
  candidateId: string;
  artifactHash: string;
  decision: "ACCEPT_FOR_REVIEW" | "REJECT";
  note: string;
}

export interface ReviewCandidateDecisionRead extends ReviewCandidateDecisionInput {
  id: string;
  checkId: string;
  actorId: string;
  decisionHash: string;
  createdAt: string;
}

/** OCR line candidates from committed run OCR; never typed facts or findings. */
export interface CandidateFamilyOcrObservationsRead {
  schemaVersion: "candidate-family-ocr-observations-v1";
  inputManifestHash: string;
  objectId: string;
  scope: "RUN_COMMITTED_OCR";
  purpose: "REVIEW_ONLY";
  ocrArtifactSha256: string;
  candidateRulePackSha256: string;
  numericLabelPackSha256: string;
  classLabelPackSha256: string;
  presenceLabelPackSha256: string;
  codeRows: Array<{
    parameterCode: string;
    family: string;
    ruleId: string;
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    ocrProcessedPageCount: number;
    ocrDeferredPageCount: number;
    leadCount: number;
    candidateLeads: Record<string, unknown>[];
  }>;
  findingCount: null;
  parameterCoverage: null;
  outputCount: 47;
  contentHash: string;
}

export interface FactFamilyRead {
  schemaVersion: "fact-family-proposals-v1";
  inputManifestHash: string;
  objectId: string;
  facts: Record<string, unknown>[];
  comparisons: Record<string, unknown>[];
  outputCount: number;
  findingCount: 0;
  contentHash: string;
}

export interface FactEntityLinkReviewInput {
  factFamilyContentHash: string;
  pdFactId: string;
  actualFactId: string;
  basis: { reference: string };
}

export interface ReviewedFactEntityLink {
  schemaVersion: "reviewed-fact-entity-link-v1";
  link: Record<string, unknown>;
  contentHash: string;
  decisionHash: string;
  actorId: string;
}

export interface FactEntityLinkDecision {
  id: string;
  checkId: string;
  objectId: string;
  link: Record<string, unknown>;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export type PilotResultsScopedRead = PilotResultsRead | "AUTH_REQUIRED" | "FORBIDDEN" | undefined;

export interface OcrLayoutRead {
  checkId: string;
  status: "OCR_UNVERIFIED_BOUNDED";
  artifactId: string;
  contentHash: string;
  inputManifestHash: string;
  schemaVersion: "bounded-ocr-layout-analysis-v1" | "bounded-ocr-layout-analysis-v2"
    | "bounded-ocr-layout-analysis-v3" | "bounded-ocr-layout-analysis-v4"
    | "bounded-ocr-layout-analysis-v5" | "bounded-ocr-layout-analysis-v6";
  providerProfileId: string;
  ocrRequiredPageCount: number;
  processedPageCount: number;
  deferredPageCount: number;
  reviewEligiblePageCount?: number;
  stageUnresolvedPageCount?: number;
  sources: Array<{
    sourceFileId: string;
    sourceSha256: string;
    pageCount: number | null;
    status: string;
    ocrRequiredPageCount: number;
    processedPageCount: number;
    deferredPageCount: number;
    reviewEligiblePageCount?: number;
    stageUnresolvedPageCount?: number;
    selectionReasonCodes?: string[];
    pages: Array<{
      pageNumber: number;
      contentHash: string;
      renderSha256: string;
      widthPx: number;
      heightPx: number;
      dpi: number;
      rendererProfileId: string;
      ocrProviderProfileId: string;
      lineCount: number;
    }>;
  }>;
}

export interface OcrLayoutPageRead {
  checkId: string;
  status: "OCR_UNVERIFIED_BOUNDED";
  artifactId: string;
  contentHash: string;
  sourceFileId: string;
  sourceSha256: string;
  pageNumber: number;
  pageContentHash: string;
  renderSha256: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  rendererProfileId: string;
  ocrProviderProfileId: string;
  lineCount: number;
  offset: number;
  nextOffset: number | null;
  lines: Array<{ ordinal: number; text: string; confidence: number; bboxPx: [number, number, number, number] }>;
}

export type VisualProposalReviewAction = "KEEP_FOR_REVIEW" | "REJECT" | "UNSURE";

export interface VisualProposalReviewInput {
  artifactId: string;
  contentHash: string;
  sourceFileId: string;
  sourceSha256: string;
  proposalOrdinal: number;
  action: VisualProposalReviewAction;
  note: string;
}

export interface VisualProposalReview extends VisualProposalReviewInput {
  id: string;
  checkId: string;
  objectId: string;
  proposalHash: string;
  actorId: string;
  reviewHash: string;
  createdAt: string;
}

/** Append-only human transcription judgment; no parameter code or typed fact. */
export interface OcrRowTranscriptionReview {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrRowTranscriptionReviewInput;
  provenance: ValidatedOcrRowTranscriptionReview["provenance"];
  actorId: string;
  contentHash: string;
  createdAt: string;
}

/** Human subject judgment, still review-only until a separately verified typed fact exists. */
export interface OcrRowApplicabilityReview {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrRowApplicabilityReviewInput;
  provenance: ValidatedOcrRowApplicabilityReview["provenance"];
  eligibleForFactReview: boolean;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

/** Verified target-run snapshots offered for a new human subject judgment. */
export interface OcrRowApplicabilityCandidate {
  sourceFileId: string;
  sourceSha256: string;
  pageNumber: number;
  renderSha256: string;
  ocrStageSha256: string;
  rowFingerprint: string;
  transcriptionDecisionId: string;
  transcriptionDecisionHash: string;
  sourceReviewDecisionId: string;
  sourceReviewDecisionHash: string;
  transcriptionDecision: "CONFIRMED_TRANSCRIPTION" | "REJECTED";
  reviewedLabel: string | null;
  reviewedValue: string | null;
  reviewedUnit: string | null;
  sourceReview: {
    revisionStatus: SourceReviewDecision["revisionStatus"];
    approvalStatus: SourceReviewDecision["approvalStatus"];
    sectionCode: SourceReviewDecision["sectionCode"];
    pageStage: "PD" | "RD" | "ID" | "UNRESOLVED" | null;
  };
  codeOptions: Array<{ parameterCode: string; attribute: string; stage: "PD" | "RD" }>;
}

/** Opt-in, read-only OCR fact candidates. No comparison, coverage, or finding. */
export interface OcrTypedFactV2Read {
  schemaVersion: "ocr-typed-fact-candidates-v1";
  items: OcrTypedFactV2[];
  snapshotCount: number;
  abstainedCount: number;
  findingCount: 0;
  coverageCount: 0;
}

/** Separate, append-only human judgment on a verified PD/RD OCR_ROW pair. */
export interface OcrFactPairReview {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrFactPairReviewInput;
  provenance: ValidatedOcrFactPairReview["provenance"];
  eligibleForPairReview: boolean;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

/** Proposal assembled only from the verified immutable typed artifact and source snapshots. */
export interface OcrFactPairCandidate {
  parameterCode: string;
  attribute: string;
  entityKey: string;
  context: string;
  linkGroupId: string;
  pdFact: OcrTypedFactV2;
  rdFact: OcrTypedFactV2;
  pdLocatorHash: string;
  rdLocatorHash: string;
  artifactHash: string;
}

/** Immutable next-run lineage; null target review means rebinding abstained. */
export interface OcrFactPairSnapshot {
  decisionId: string;
  decisionContentHash: string;
  actorId: string;
  originCheckId: string;
  targetCheckId: string;
  originReview: OcrFactPairReviewInput;
  review: OcrFactPairReviewInput | null;
  targetReviewHash: string | null;
  provenance: ValidatedOcrFactPairReview["provenance"] | null;
  eligibleForPairReview: boolean;
  reasonCode: "REBOUND" | "TARGET_FACT_UNAVAILABLE";
}

/** Append-only human judgment on quantity comparability for a rebound OCR_ROW pair. */
export interface OcrFactPairQuantityReview {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrFactPairQuantityReviewInput;
  provenance: ValidatedOcrFactPairQuantityReview["provenance"];
  eligibleForComparison: boolean;
  evidenceHash: string;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export interface OcrFactPairQuantityCandidate {
  pairSnapshot: OcrFactPairSnapshot;
  pdFact: OcrTypedFactV2;
  rdFact: OcrTypedFactV2;
}

export interface ProtocolCanonicalArtifactContent {
  artifact: ProtocolArtifactSummary;
  bytes: Buffer;
}

export interface ReviewDecisionCommand {
  actor: AuthenticatedActor;
  input: DecisionInput;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
  traceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditedMutationCommand {
  actor: AuthenticatedActor;
  idempotencyKey: string;
  requestId: string;
  traceId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface FinalizeCheckCommand extends AuditedMutationCommand {
  input: FinalizeCheckInput;
  expectedVersion: number;
}

export interface RevokeProtocolCommand extends AuditedMutationCommand {
  input: RevokeProtocolInput;
  expectedVersion: number;
}

export interface JobClaimInput {
  workerId: string;
  capabilities: string[];
  queueName?: string;
}

export type AnalysisJobType =
  | "ANALYSIS_INVENTORY"
  | "DOCUMENT_TEXT_LAYER"
  | "DOCUMENT_RENDER"
  | "DOCUMENT_OCR_LAYOUT"
  | "DOCUMENT_METADATA"
  | "DOCUMENT_LINKING"
  | "ENTITY_EXTRACTION"
  | "RULE_EVALUATION"
  | "EVIDENCE_VALIDATION"
  | "ANALYSIS_SEAL_UNSUPPORTED";

export interface JobLease {
  jobId: string;
  jobType: AnalysisJobType;
  attemptId: string;
  attemptNumber: number;
  fencingToken: number;
  leaseUntil: string;
  organizationId: string;
  objectId: string;
  inspectionId: string;
  runId: string;
  inputManifestHash: string;
  releaseId: string;
  release: {
    manifestHash: string;
    lifecycle: "LEGACY" | "SCAFFOLD" | "DRAFT" | "EVALUATED" | "APPROVED" | "DEPLOYED" | "RETIRED" | "REJECTED";
    externalNetworkAllowed: false;
    providerSlot: {
      stageJobType: AnalysisJobType;
      providerKind: string;
      status: "UNCONFIGURED" | "CONFIGURED";
      profileId: string | null;
      adapterVersion: string | null;
      artifactHash: string | null;
      configHash: string | null;
      licenseId: string | null;
      resourceProfile: string | null;
    } | null;
    ocrLayoutSlot: { profileId: string | null; configHash: string | null } | null;
    rules: {
      executionStatus: "UNCONFIGURED" | "PILOT";
      definitions?: {
        navigation: Record<string, unknown>;
        numeric: Record<string, unknown>;
        heat?: Record<string, unknown>;
        ocrHeatRows?: Record<string, unknown>;
        factFamily?: Record<string, unknown>;
        candidateFamilyPreview?: Record<string, unknown>;
        candidateFamilyObservations?: Record<string, unknown>;
        candidateFamilyOcrObservations?: Record<string, unknown>;
        ocrTableRows?: Record<string, unknown>;
        unresolvedFamilyReview?: Record<string, unknown>;
      };
    } | null;
  };
  inputs: {
    reviewedEntityLinks?: ReviewedFactEntityLink[];
    sourceDecisions: Record<string, {
      sourceSha256: string;
      revisionStatus: SourceReviewInput["revisionStatus"];
      approvalStatus: SourceReviewInput["approvalStatus"];
      linkGroupId: string | null;
      sectionCode: SourceReviewDecision["sectionCode"];
      pageStages: SourceReviewInput["pageStages"];
      basis: SourceReviewInput["basis"];
    }>;
    sourceFiles: Array<{
      sourceFileId: string;
      sha256: string;
      stages: Array<"PD" | "RD" | "ID">;
      sectionCode: SourceReviewDecision["sectionCode"];
      byteSize: number;
      mediaType: string;
      downloadPath: string;
    }>;
  };
}

export type JobClaimResult =
  | { kind: "acquired"; lease: JobLease }
  | { kind: "already_terminal"; state: "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" }
  | { kind: "not_ready"; state: "BLOCKED" | "LEASED" | "RETRY_WAIT" }
  | { kind: "capability_mismatch"; requiredCapability: JobLease["jobType"] }
  | { kind: "queue_mismatch" }
  | { kind: "not_found" };

export interface JobAttemptInput {
  attemptId: string;
  fencingToken: number;
}

export interface JobCompleteInput extends JobAttemptInput {
  result?: Record<string, unknown>;
}

export interface JobFailInput extends JobAttemptInput {
  errorCode: string;
  message: string;
  retryableHint?: boolean;
}

export type JobInputResult =
  | {
      kind: "available";
      file: {
        storageKey: string;
        sha256: string;
        byteSize: number;
        mediaType: string;
      };
    }
  | { kind: "already_terminal"; state: "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" }
  | { kind: "stale_attempt" }
  | { kind: "not_found" };

export type JobTextArtifactResult =
  | {
      kind: "available";
      canonical: string;
      contentHash: string;
      byteSize: number;
      inputSha256: string;
      schemaVersion: "document-text-v1" | "document-text-v2";
    }
  | { kind: "already_terminal"; state: "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" }
  | { kind: "stale_attempt" }
  | { kind: "integrity_error" }
  | { kind: "not_found" };

export type JobOcrLayoutArtifactResult =
  | {
      kind: "available";
      canonical: string;
      contentHash: string;
      byteSize: number;
      inputManifestHash: string;
      schemaVersion: "bounded-ocr-layout-analysis-v3" | "bounded-ocr-layout-analysis-v4"
        | "bounded-ocr-layout-analysis-v5" | "bounded-ocr-layout-analysis-v6";
      providerProfileId: "local-bounded-ocr-layout-v3" | "local-bounded-ocr-layout-v4"
        | "local-bounded-ocr-layout-v5" | "local-bounded-ocr-layout-v6";
      providerConfigHash: string;
    }
  | { kind: "already_terminal"; state: "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" }
  | { kind: "stale_attempt" }
  | { kind: "integrity_error" }
  | { kind: "not_found" };

export type JobHeartbeatResult =
  | { kind: "extended"; leaseUntil: string }
  | { kind: "already_terminal"; state: "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" }
  | { kind: "stale_attempt" }
  | { kind: "not_found" };

export type JobCompleteResult =
  | { kind: "completed"; check: CheckRun; replayed: boolean }
  | { kind: "already_terminal"; state: "FAILED" | "DEAD" | "CANCELLED" }
  | { kind: "stale_attempt" }
  | { kind: "invalid_state"; code: string; message: string }
  | { kind: "not_found" };

export type JobFailResult =
  | { kind: "retry_scheduled"; nextAttemptAt: string }
  | { kind: "failed" }
  | { kind: "already_terminal"; state: "SUCCEEDED" | "FAILED" | "DEAD" | "CANCELLED" }
  | { kind: "stale_attempt" }
  | { kind: "not_found" };

export type AuditedMutationCommandResult<T> =
  | { kind: "success"; value: T; replayed: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "idempotency_conflict" }
  | { kind: "invalid_state"; code: string; message: string };

export type ReviewDecisionCommandResult =
  | { kind: "success"; finding: Finding; rowVersion: number; replayed: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "precondition_failed"; currentVersion: number }
  | { kind: "idempotency_conflict" }
  | { kind: "invalid_state"; code: string; message: string };

export type FinalizeCheckCommandResult =
  | { kind: "success"; protocol: ProtocolVersion; rowVersion: number; replayed: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "precondition_failed"; currentVersion: number }
  | { kind: "idempotency_conflict" }
  | { kind: "invalid_state"; code: string; message: string };

export type RevokeProtocolCommandResult =
  | { kind: "success"; revocation: ProtocolRevocationResult; replayed: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "precondition_failed"; currentVersion: number }
  | { kind: "idempotency_conflict" }
  | { kind: "invalid_state"; code: string; message: string };

export interface RegisteredIngestedDocumentFile extends IngestedDocumentFile {
  storageKey?: string;
}

export interface InspectionRepository {
  listObjects(actor?: AuthenticatedActor): Awaitable<InspectionObject[]>;
  getObject(id: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<InspectionObject>>;
  hasObjectPermission(objectId: string, actor: AuthenticatedActor, permission: string): Awaitable<boolean>;
  createObject(input: CreateObjectInput, actor?: AuthenticatedActor): Awaitable<InspectionObject>;
  createObjectCommand?(
    input: CreateObjectInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<InspectionObject>>;
  hasIngestedFile(objectId: string, sha256: string, actor?: AuthenticatedActor): Awaitable<boolean>;
  registerIngestedFiles(
    objectId: string,
    files: RegisteredIngestedDocumentFile[],
    actor?: AuthenticatedActor,
  ): Awaitable<BinaryUploadRecord | undefined>;
  registerIngestedFilesCommand?(
    objectId: string,
    files: RegisteredIngestedDocumentFile[],
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<BinaryUploadRecord>>;
  recordSourceReviewCommand?(
    objectId: string,
    sourceFileId: string,
    input: SourceReviewInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<SourceReviewDecision>>;
  getSourceReview?(
    objectId: string,
    sourceFileId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<SourceReviewDecision>>;
  listSourceFiles?(
    objectId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<SourceFileSummary[]>>;
  getSourceFileContent?(
    objectId: string,
    sourceFileId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<SourceFileContent>>;
  getUpload(id: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<BinaryUploadRecord>>;
  startCheck(objectId: string, actor?: AuthenticatedActor): Awaitable<CheckRun | undefined>;
  startCheckCommand?(
    objectId: string,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<CheckRun>>;
  completeCheck(checkId: string): Awaitable<CheckRun | undefined>;
  getCheck(id: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<CheckRun>>;
  getFindings(checkId: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<Finding[]>>;
  getVisualProposals?(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<Record<string, unknown>>>;
  listFactEntityLinks?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{ items: FactEntityLinkDecision[]; canReview: boolean; canRun: boolean }>>;
  recordFactEntityLinkCommand?(
    checkId: string,
    input: FactEntityLinkReviewInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<FactEntityLinkDecision>>;
  getOcrLayout?(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<OcrLayoutRead>>;
  getOcrLayoutPage?(
    checkId: string,
    sourceFileId: string,
    pageNumber: number,
    offset: number,
    actor?: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<OcrLayoutPageRead>>;
  listVisualProposalReviews?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{ items: VisualProposalReview[]; canReview: boolean }>>;
  recordVisualProposalReviewCommand?(
    checkId: string,
    input: VisualProposalReviewInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<VisualProposalReview>>;
  listReviewCandidateDecisions?(
    checkId: string, actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{ items: ReviewCandidateDecisionRead[]; canReview: boolean }>>;
  recordReviewCandidateDecisionCommand?(
    checkId: string, input: ReviewCandidateDecisionInput, command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<ReviewCandidateDecisionRead>>;
  getOcrRowTranscriptionReviews?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{
    items: OcrRowTranscriptionReview[];
    canReview: boolean;
    ocrStageSha256: string;
    candidates: Array<{ rowFingerprint: string; proposal: OcrTableRowsRead["proposals"][number] }>;
  }>>;
  recordOcrRowTranscriptionReviewCommand?(
    checkId: string,
    input: OcrRowTranscriptionReviewInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<OcrRowTranscriptionReview>>;
  getOcrRowApplicabilityReviews?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{ items: OcrRowApplicabilityReview[];
    canReview: boolean; candidates: OcrRowApplicabilityCandidate[] }>>;
  getOcrTypedFactCandidates?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<OcrTypedFactV2Read>>;
  getOcrFactPairReviews?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{ items: OcrFactPairReview[];
    canReview: boolean; candidates: OcrFactPairCandidate[] }>>;
  getOcrFactPairSnapshots?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{ items: OcrFactPairSnapshot[] }>>;
  recordOcrFactPairReviewCommand?(
    checkId: string,
    input: OcrFactPairReviewInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<OcrFactPairReview>>;
  getOcrFactPairQuantityReviews?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{
    items: OcrFactPairQuantityReview[];
    effectiveItems: OcrFactPairQuantityReview[];
    candidates: OcrFactPairQuantityCandidate[];
    canReview: boolean;
    reasonCode: string | null;
  }>>;
  recordOcrFactPairQuantityReviewCommand?(
    checkId: string,
    input: OcrFactPairQuantityReviewInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<OcrFactPairQuantityReview>>;
  getOcrFactPairComparisonPreviews?(
    checkId: string,
    actor: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<{ items: Array<{
    quantityDecisionId: string; preview: OcrFactPairComparisonPreview;
  }> }>>;
  recordOcrRowApplicabilityReviewCommand?(
    checkId: string,
    input: OcrRowApplicabilityReviewInput,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<OcrRowApplicabilityReview>>;
  getFinding(id: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<Finding>>;
  getFindingForReview(id: string, actor?: AuthenticatedActor): Awaitable<ReviewFindingResult>;
  decideFinding(id: string, input: DecisionInput): Awaitable<DecisionResult>;
  decideFindingCommand(id: string, command: ReviewDecisionCommand): Awaitable<ReviewDecisionCommandResult>;
  reprocess(checkId: string, actor?: AuthenticatedActor): Awaitable<CheckRun | undefined>;
  reprocessCommand?(
    checkId: string,
    command: AuditedMutationCommand,
  ): Awaitable<AuditedMutationCommandResult<CheckRun>>;
  finalize(checkId: string, actor?: AuthenticatedActor): Awaitable<FinalizeResult>;
  finalizeCommand?(
    checkId: string,
    command: FinalizeCheckCommand,
  ): Awaitable<FinalizeCheckCommandResult>;
  revokeProtocolCommand?(
    protocolId: string,
    command: RevokeProtocolCommand,
  ): Awaitable<RevokeProtocolCommandResult>;
  getProtocols(checkId: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<ProtocolVersion[]>>;
  getProtocol(id: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<ProtocolVersion>>;
  getProtocolExport(id: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<ProtocolExport>>;
  getCanonicalProtocolArtifact?(
    id: string,
    actor?: AuthenticatedActor,
  ): Awaitable<ScopedReadResult<ProtocolCanonicalArtifactContent>>;
  getSubmission(checkId: string, actor?: AuthenticatedActor): Awaitable<SubmissionResult | "AUTH_REQUIRED">;
  getParameters(): Awaitable<ParameterCatalogItem[]>;
  getCoverage(checkId: string, actor?: AuthenticatedActor): Awaitable<ScopedReadResult<ParameterCoverageItem[]>>;
  getPilotResults?(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Awaitable<PilotResultsScopedRead>;
  claimJob?(jobId: string, input: JobClaimInput): Awaitable<JobClaimResult>;
  getJobInput?(jobId: string, sourceFileId: string, input: JobAttemptInput): Awaitable<JobInputResult>;
  getJobTextArtifact?(jobId: string, sourceFileId: string, input: JobAttemptInput): Awaitable<JobTextArtifactResult>;
  getJobOcrLayoutArtifact?(jobId: string, input: JobAttemptInput): Awaitable<JobOcrLayoutArtifactResult>;
  heartbeatJob?(jobId: string, input: JobAttemptInput): Awaitable<JobHeartbeatResult>;
  completeJob?(jobId: string, input: JobCompleteInput): Awaitable<JobCompleteResult>;
  failJob?(jobId: string, input: JobFailInput): Awaitable<JobFailResult>;
  close?(): Promise<void>;
}
