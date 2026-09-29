import type {
  BinaryUploadRecord,
  CheckRun,
  CreateObjectInput,
  DecisionInput,
  Finding,
  InspectionObject,
  ParameterCatalogItem,
  ParameterCoverageItem,
  ProtocolVersion,
  ProtocolRevocationReasonCode,
  ProtocolRevocationResult,
  SessionResponse,
  SourceFileListResponse,
  SourceReviewDecision,
  SourceReviewInput,
  UploadStage,
} from "@inspector-ai/contracts";
import { protocolRequiresGapAcknowledgement } from "./protocol-state";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export interface VisualProposalAnalysis {
  schemaVersion: "visual-proposal-analysis-v1" | "visual-proposal-analysis-v2" | "visual-proposal-analysis-v3" | "visual-proposal-analysis-v4" | "visual-proposal-analysis-v5" | "visual-proposal-analysis-v6";
  status: "PROPOSAL_ONLY_UNVERIFIED";
  artifactId: string;
  contentHash: string;
  profile: Record<string, unknown>;
  sources: Array<{
    sourceFileId: string;
    sourceSha256: string;
    pageCount: number;
    scannedPageCount: number;
    status: "SCANNED" | "SKIPPED_PAGE_LIMIT" | "PARTIALLY_SCANNED_PAGE_LIMIT";
    scannedPageNumbers?: number[];
    skippedPageCount?: number;
    documentContext?: {
      schemaVersion: "document-context-v1";
      methodId: "first-two-pdf-cover-text-pages-v1";
      status: "HEATING" | "VENTILATION" | "UNKNOWN";
      reasonCode: "TITLE_KEYWORD_MATCH" | "TITLE_CONFLICT" | "NO_TITLE_KEYWORD_MATCH";
      inspectedPages: Array<{ pageNumber: number; textSha256: string; titleWindow: string | null }>;
    };
    vlm?: {
      schemaVersion: "visual-vlm-observations-v1";
      methodId: "spread-two-saved-proposals-v1" | "spread-two-saved-proposals-server-nonnegative-v1";
      eligibleProposalCount: number;
      selectedOrdinals: number[];
      omittedProposalCount: number;
      observations: Array<{
        proposalOrdinal: number;
        sourceSha256: string;
        pageNumber: number;
        bboxNormalized: [number, number, number, number];
        cropSha256: string | null;
        modelId: string;
        modelWeightsSha256?: string;
        modelProjectorSha256?: string;
        modelRevision?: string;
        modelLockSha256?: string;
        promptSha256: string;
        decision: "RADIATOR_HINT" | "OTHER_HINT" | "ABSTAIN";
        reasonCode: "MODEL_RESPONSE" | "MODEL_ABSTAIN" | "MODEL_OTHER_UNTRUSTED" | "CROP_RENDER_ERROR" | "ENDPOINT_NOT_CONFIGURED"
          | "MODEL_HTTP_ERROR" | "MODEL_TIMEOUT" | "MODEL_UNAVAILABLE" | "MODEL_REDIRECT_REJECTED"
          | "MODEL_OUTPUT_INVALID" | "MODEL_RESPONSE_TOO_LARGE";
        responseSha256: string | null;
      }>;
    };
    proposals: Array<{
      pageNumber: number;
      bboxNormalized: [number, number, number, number];
      status: "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED";
    }>;
    proposalLimitReached: boolean;
    unretainedProposalCount: number;
  }>;
}

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

export interface OcrHeatRowEvidence {
  role: string;
  lineIndex: number;
  text: string;
  bboxPx: [number, number, number, number];
  score: number;
}

export interface OcrHeatRowsRead {
  profileId: string;
  inputManifestHash: string;
  findingCount: number;
  proposalCount: number;
  abstentionCount: number;
  truncated: boolean;
  proposals: Array<{
    sourceFileId: string;
    inputSha256: string;
    pageNumber: number;
    stage: string;
    component: string;
    basis: string;
    values: { kW: string; "Gcal/h": string };
    ocrPageContentHash: string;
    renderSha256: string;
    evidence: OcrHeatRowEvidence[];
  }>;
  abstentions: Array<{
    sourceFileId: string;
    inputSha256: string;
    pageNumber: number;
    lineIndex: number;
    reasonCode: string;
    evidence: OcrHeatRowEvidence[];
  }>;
}

export interface PilotResultsRead {
  checkId: string;
  status: "PROCESSING" | "READY" | "FAILED" | "CANCELLED";
  ocrHeatRows: OcrHeatRowsRead | null;
  ocrTableRows?: OcrTableRowsRead;
  factFamily?: {
    schemaVersion: "fact-family-proposals-v1";
    inputManifestHash: string;
    objectId: string;
    facts: Record<string, unknown>[];
    comparisons: Record<string, unknown>[];
    outputCount: number;
    findingCount: 0;
    contentHash: string;
  };
  candidateFamilyPreview?: CandidateFamilyPreviewRead;
  candidateFamilyObservations?: CandidateFamilyObservationsRead;
  reviewCandidates?: ReviewCandidatesRead;
  candidateFamilyOcrObservations?: CandidateFamilyOcrObservationsRead;
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
  items: Array<{
    resultId: string;
    parameterCode: "PZ-002" | "PZ-017";
    ruleKey: string;
    ruleVersion: string;
    executionStatus: "SUCCEEDED";
    machineStatus: string;
    reasonCode: string | null;
    comparison: { disposition: string; reasonCode: string | null } | null;
    facts: Array<{
      stage: "PD" | "RD";
      component: string | null;
      sourceFileId: string;
      sourceSha256: string;
      pageNumber: number;
      rawValue: string | null;
      rawUnit: string | null;
      value: string;
      unit: string;
    }>;
  }>;
}

export type UnresolvedConfigCode = "PZ-003" | "PZ-011" | "PZ-019" | "PZ-020"
  | "SPZU-027" | "SPZU-028" | "AR-046" | "PZ-005" | "SPZU-031"
  | "SPZU-033" | "AR-042" | "AR-047" | "AR-048" | "AR-051"
  | "KR-060" | "POS-084" | "ODI-116" | "ODI-117" | "ODI-119";

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
    parameterCode: UnresolvedConfigCode;
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

export type UnresolvedConfigCodeV2 = "SPZU-026" | "AR-052" | "IOS2-072"
  | "IOS3-075" | "ZU-130" | "AR-043" | "IOS5-080" | "PPM-106"
  | "PPM-108" | "PPM-110";

export interface UnresolvedConfigReviewV2Read {
  schemaVersion: "unresolved-config-run-review-v2";
  profileId: "unresolved-review-config-v2";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  configSha256: string;
  registrySha256: string;
  sourceStageArtifacts: UnresolvedConfigReviewRead["sourceStageArtifacts"];
  codeRows: Array<Omit<UnresolvedConfigReviewRead["codeRows"][number],
    "parameterCode" | "candidateExtractorFamily"> & {
    parameterCode: UnresolvedConfigCodeV2;
    candidateExtractorFamily: "DOCUMENT_APPROVAL" | "SAFETY_COVERAGE";
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export type UnresolvedConfigCodeV3 = "IOS1-068" | "IOS1-069" | "IOS1-070"
  | "IOS4-076" | "IOS4-078" | "PPM-111" | "PPM-113";

export interface UnresolvedConfigReviewV3Read {
  schemaVersion: "unresolved-config-run-review-v3";
  profileId: "unresolved-review-config-v3";
  purpose: "REVIEW_ONLY";
  objectId: string;
  inputManifestHash: string;
  configSha256: string;
  registrySha256: string;
  sourceStageArtifacts: UnresolvedConfigReviewRead["sourceStageArtifacts"];
  codeRows: Array<Omit<UnresolvedConfigReviewRead["codeRows"][number],
    "parameterCode" | "candidateExtractorFamily"> & {
    parameterCode: UnresolvedConfigCodeV3;
    candidateExtractorFamily: "NETWORK_TOPOLOGY";
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export interface LayerAssemblyLocatorRead {
  blockIndex: number;
  lineIndex: number;
  lineText: string;
  lineTextSha256: string;
  blockTextSha256: string;
  bboxMilliPoints: [number, number, number, number];
}

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
      proposalKind: "OPENING_LABEL_DIMENSION_NAVIGATION"
        | "DESIGNED_CLOSURE_HEADING_NAVIGATION" | "DETAIL_HEADING_NAVIGATION";
      rawOpeningNumber: string | null;
      rawDimensionsText: string | null;
      rawAxes: null;
      rawLevel: null;
      drawingContourAssociation: "UNVERIFIED";
      detailAssociation: "UNVERIFIED";
      sameElementAssociation: "UNVERIFIED";
      reinforcementStatus: "NOT_ESTABLISHED";
      unauthorizedFillStatus: "NOT_ESTABLISHED";
      anchor: LayerAssemblyLocatorRead;
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
      anchor: LayerAssemblyLocatorRead;
      scopedSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

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
      proposalKind: "ROOF_HEADING_NAVIGATION"
        | "ROOF_MATERIAL_THICKNESS_NEIGHBORHOOD"
        | "WALL_MATERIAL_THICKNESS_NEIGHBORHOOD";
      rowAssociationStatus: "UNVERIFIED";
      typeAssociationStatus: "UNVERIFIED";
      zoneAssociationStatus: "UNVERIFIED";
      rawThickness: null;
      rawQuantity: null;
      roles: Record<string, LayerAssemblyLocatorRead>;
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
      anchor: LayerAssemblyLocatorRead;
      scopedSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

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
      leadKind: "TABLE_HEADING_UNLINKED" | "GENERAL_REQUIREMENT_UNLINKED"
        | "SHEET_NOTE_UNLINKED" | "ELEMENT_CONTEXT_UNVERIFIED"
        | "FIRE_CONTEXT_AMBIGUOUS" | "PROTECTION_COMPOSITION_MENTION_UNVERIFIED"
        | "PROTECTION_MENTION_UNVERIFIED" | "FIRE_RATING_REQUIREMENT"
        | "FIRE_RATING_CONTEXT_UNRESOLVED";
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
      leadKind: "SCHEDULE_TOKEN" | "CALCULATION_PROSE" | "REGISTER_PROSE"
        | "CONTEXT_UNRESOLVED";
      rowAssociationStatus: "UNVERIFIED";
      systemAssignmentStatus: "UNVERIFIED";
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export interface SiteGpTableBlockRead {
  blockIndex: number;
  blockText: string;
  blockTextSha256: string;
  bboxMilliPoints: [number, number, number, number];
}

interface SiteGpTableScopedRead {
  sourceFileId: string;
  sourceSha256: string;
  textArtifactSha256: string;
  pageNumber: number;
  sourceRole: "PD_GP_TABLE";
  scopedSha256: string;
}

export type SiteGpTableProposalRead = SiteGpTableScopedRead & ({
  proposalKind: "ROAD_LAYER_THICKNESS_ADJACENCY";
  rowAssociationStatus: "UNVERIFIED";
  reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"];
  unitInterpretationStatus: "UNVERIFIED";
  assemblyTypeStatus: "UNRESOLVED";
  roles: { roadHeading: SiteGpTableBlockRead; unitHeader: SiteGpTableBlockRead;
    material: SiteGpTableBlockRead; thickness: SiteGpTableBlockRead };
  adjacencyEvidenceSha256: string;
} | {
  proposalKind: "ROAD_ASSEMBLY_WORK_TYPE_ADJACENCY";
  rowAssociationStatus: "UNVERIFIED";
  reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"];
  layerAssociationStatus: "UNRESOLVED";
  roles: { roadHeading: SiteGpTableBlockRead; work: SiteGpTableBlockRead;
    type: SiteGpTableBlockRead };
  adjacencyEvidenceSha256: string;
} | {
  proposalKind: "MAF_POSITION_NAME_ADJACENCY";
  rowAssociationStatus: "UNVERIFIED";
  reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"];
  rawQuantity: null;
  quantityStatus: "UNKNOWN";
  roles: { mafHeading: SiteGpTableBlockRead; positionHeader: SiteGpTableBlockRead;
    nameHeader: SiteGpTableBlockRead; quantityHeader: SiteGpTableBlockRead;
    position: SiteGpTableBlockRead; name: SiteGpTableBlockRead };
  adjacencyEvidenceSha256: string;
});

export interface SiteGpTableAbstentionRead extends SiteGpTableScopedRead {
  reasonCode: string;
  anchor: SiteGpTableBlockRead;
  abstentionSha256: string;
}

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
    proposals: SiteGpTableProposalRead[];
    abstentions: SiteGpTableAbstentionRead[];
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

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
      bboxMilliPoints: [number, number, number, number];
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export interface OcrTableRowEvidence {
  role: string;
  lineIndex: number;
  text: string;
  bboxPx: number[];
  score: number;
}

export interface OcrTableRowsRead {
  profileId: "conservative-ocr-table-rows-v1" | "conservative-ocr-table-rows-v2"
    | "conservative-ocr-table-rows-v3";
  inputManifestHash: string;
  proposals: Array<{
    sourceFileId: string;
    inputSha256: string;
    pageNumber: number;
    ocrPageContentHash: string;
    renderSha256: string;
    headerEvidence: OcrTableRowEvidence[];
    labelEvidence: OcrTableRowEvidence;
    labelContinuationEvidence?: OcrTableRowEvidence[];
    valueEvidence: OcrTableRowEvidence;
  }>;
  abstentions: Array<{
    sourceFileId: string;
    inputSha256: string;
    pageNumber: number;
    lineIndex: number | null;
    reasonCode: string;
  }>;
  findingCount: 0;
  proposalCount: number;
  abstentionCount: number;
  truncated: boolean;
}

export interface OcrRowTranscriptionReviewInput {
  schemaVersion: "ocr-row-transcription-review-v1";
  ocrStageSha256: string;
  rowFingerprint: string;
  decision: "CONFIRMED_TRANSCRIPTION" | "REJECTED";
  reviewedLabel: string | null;
  reviewedValue: string | null;
  reviewedUnit: string | null;
  basis: string;
}

export interface OcrRowTranscriptionReviewRecord {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrRowTranscriptionReviewInput;
  provenance: {
    sourceFileId: string;
    sourceSha256: string;
    pageNumber: number;
    renderSha256: string;
    ocrPageContentHash: string;
    headerEvidence: OcrTableRowEvidence[];
    labelEvidence: OcrTableRowEvidence;
    labelContinuationEvidence?: OcrTableRowEvidence[];
    valueEvidence: OcrTableRowEvidence;
  };
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export interface OcrRowTranscriptionReviewList {
  items: OcrRowTranscriptionReviewRecord[];
  canReview: boolean;
  ocrStageSha256: string;
  candidates: Array<{
    rowFingerprint: string;
    proposal: OcrTableRowsRead["proposals"][number];
  }>;
}

export interface OcrRowApplicabilityReviewInput {
  schemaVersion: "ocr-row-applicability-review-v1";
  decision: "APPLICABLE" | "NOT_APPLICABLE" | "UNSURE";
  targetCheckId: string;
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
  parameterCode: string;
  attribute: string;
  stage: "PD" | "RD";
  entityKey: string;
  context: string;
  basis: string;
}

export interface OcrRowApplicabilityReviewRecord {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrRowApplicabilityReviewInput;
  provenance: {
    targetCheckId: string;
    objectId: string;
    inputManifestHash: string;
    originInputManifestHash: string;
    sourceFileId: string;
    sourceSha256: string;
    pageNumber: number;
    ocrPageContentHash: string;
    renderSha256: string;
    ocrStageSha256: string;
    tableRowsContentHash: string;
    rowFingerprint: string;
    transcriptionDecisionId: string;
    transcriptionDecisionHash: string;
    sourceReviewDecisionId: string;
    sourceReviewDecisionHash: string;
    sectionCode: string | null;
  };
  eligibleForFactReview: boolean;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export interface OcrRowApplicabilityReviewList {
  items: OcrRowApplicabilityReviewRecord[];
  canReview: boolean;
  candidates: Array<{
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
      revisionStatus: "CURRENT" | "SUPERSEDED" | "UNKNOWN";
      approvalStatus: "APPROVED" | "UNAPPROVED" | "UNKNOWN";
      sectionCode: string | null;
      pageStage: "PD" | "RD" | "ID" | "UNRESOLVED" | null;
    };
    codeOptions: Array<{ parameterCode: string; attribute: string; stage: "PD" | "RD" }>;
  }>;
}

export interface OcrTypedFactCandidate {
  schemaVersion: "typed-fact-v2";
  factId: string;
  targetCheckId: string;
  inputManifestHash: string;
  objectId: string;
  sourceFileId: string;
  sourceSha256: string;
  stage: "PD" | "RD";
  pageNumber: number;
  parameterCode: string;
  attribute: string;
  entityKey: string;
  context: string;
  rawText: string;
  rawValue: string;
  rawUnit: string;
  locator: {
    kind: "OCR_ROW";
    originInputManifestHash: string;
    ocrPageContentHash: string;
    renderSha256: string;
    ocrStageSha256: string;
    tableRowsContentHash: string;
    rowFingerprint: string;
    transcriptionDecisionId: string;
    transcriptionDecisionHash: string;
    sourceReviewDecisionId: string;
    sourceReviewDecisionHash: string;
    applicabilityDecisionId: string;
    applicabilityDecisionHash: string;
    targetSnapshotHash: string;
    originCheckId: string;
    sectionCode: string;
    labelEvidence: unknown;
    labelContinuationEvidence?: unknown[];
    valueEvidence: unknown;
  };
}

export interface OcrTypedFactCandidatesRead {
  schemaVersion: "ocr-typed-fact-candidates-v1";
  items: OcrTypedFactCandidate[];
  snapshotCount: number;
  abstainedCount: number;
  findingCount: 0;
  coverageCount: 0;
}

export interface OcrFactPairReviewInput {
  schemaVersion: "ocr-fact-pair-review-v1";
  decision: "PAIR_CONFIRMED" | "PAIR_REJECTED" | "UNSURE";
  targetCheckId: string;
  inputManifestHash: string;
  objectId: string;
  parameterCode: string;
  attribute: string;
  pdFactId: string;
  pdLocatorHash: string;
  rdFactId: string;
  rdLocatorHash: string;
  entityKey: string;
  context: string;
  linkGroupId: string;
  basis: string;
}

export interface OcrFactPairCandidate {
  parameterCode: string;
  attribute: string;
  entityKey: string;
  context: string;
  linkGroupId: string;
  pdFact: OcrTypedFactCandidate;
  rdFact: OcrTypedFactCandidate;
  pdLocatorHash: string;
  rdLocatorHash: string;
  artifactHash: string;
}

export interface OcrFactPairReviewRecord {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrFactPairReviewInput;
  provenance: {
    artifactHash: string;
    pdSourceFileId: string;
    pdSourceSha256: string;
    pdSourceReviewHash: string;
    rdSourceFileId: string;
    rdSourceSha256: string;
    rdSourceReviewHash: string;
  };
  eligibleForPairReview: boolean;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export interface OcrFactPairReviewList {
  items: OcrFactPairReviewRecord[];
  canReview: boolean;
  candidates: OcrFactPairCandidate[];
}

export interface OcrFactPairSnapshot {
  decisionId: string;
  decisionContentHash: string;
  actorId: string;
  originCheckId: string;
  targetCheckId: string;
  originReview: OcrFactPairReviewInput;
  review: OcrFactPairReviewInput | null;
  targetReviewHash: string | null;
  provenance: OcrFactPairReviewRecord["provenance"] | null;
  eligibleForPairReview: boolean;
  reasonCode: "REBOUND" | "TARGET_FACT_UNAVAILABLE";
}

export interface OcrFactPairQuantityReviewInput {
  schemaVersion: "ocr-fact-pair-quantity-review-v1";
  decision: "SAME_SCALAR_TOTAL" | "NOT_COMPARABLE" | "UNSURE";
  targetCheckId: string;
  inputManifestHash: string;
  objectId: string;
  parameterCode: string;
  attribute: string;
  entityKey: string;
  context: string;
  pdFactId: string;
  pdLocatorHash: string;
  rdFactId: string;
  rdLocatorHash: string;
  pairDecisionId: string;
  pairTargetReviewHash: string;
  pdDenominatorAffirmed: boolean;
  pdPageNumber: number;
  rdPageNumber: number;
  basis: {
    scope: string;
    quantityType: string;
    period: string;
    aggregation: string;
    priceBasis?: string;
  };
}

export interface OcrFactPairQuantityReviewRecord {
  id: string;
  checkId: string;
  objectId: string;
  review: OcrFactPairQuantityReviewInput;
  provenance: {
    artifactHash: string;
    pairDecisionId: string;
    pairDecisionContentHash: string;
    pairTargetReviewHash: string;
    candidateRulePackSha256: string;
    canonicalUnit: string;
    pdSourceFileId: string;
    pdSourceSha256: string;
    pdSourceReviewHash: string;
    pdApplicabilityDecisionHash: string;
    pdTargetSnapshotHash: string;
    rdSourceFileId: string;
    rdSourceSha256: string;
    rdSourceReviewHash: string;
    rdApplicabilityDecisionHash: string;
    rdTargetSnapshotHash: string;
  };
  eligibleForComparison: boolean;
  evidenceHash: string;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export interface OcrFactPairQuantityCandidate {
  pairSnapshot: OcrFactPairSnapshot;
  pdFact: OcrTypedFactCandidate;
  rdFact: OcrTypedFactCandidate;
}

export interface OcrFactPairQuantityReviewList {
  items: OcrFactPairQuantityReviewRecord[];
  effectiveItems: OcrFactPairQuantityReviewRecord[];
  candidates: OcrFactPairQuantityCandidate[];
  canReview: boolean;
  reasonCode: string | null;
}

export interface OcrFactPairComparisonPreviewRead {
  schemaVersion: "ocr-fact-pair-comparison-preview-v1";
  purpose: "REVIEW_ONLY";
  status: "ABSTAIN" | "COMPARISON_CANDIDATE";
  reasonCode: string | null;
  comparison: null | {
    parameterCode: string;
    attribute: string;
    family: "RELATIVE_DELTA" | "RELATIVE_INCREASE";
    canonicalUnit: string;
    pdValue: string;
    rdValue: string;
    thresholdPercent: string;
    observedPercent: { numerator: string; denominator: string };
    exceedsThreshold: boolean;
    pdFactId: string;
    rdFactId: string;
    pdLocatorHash: string;
    rdLocatorHash: string;
    targetReviewHash: string;
    artifactHash: string;
    quantityEvidenceHash: string;
  };
}

export interface OcrFactPairComparisonPreviewList {
  items: Array<{ quantityDecisionId: string; preview: OcrFactPairComparisonPreviewRead }>;
}

export interface CandidateFamilyPreviewRead {
  schemaVersion: "candidate-family-preview-v1";
  inputManifestHash: string;
  objectId: string;
  scope: "RUN_COMMITTED_SOURCES";
  purpose: "REVIEW_ONLY";
  candidateRulePackSha256: string;
  codeRows: Array<{
    parameterCode: string;
    family: string;
    status: "ABSTAIN";
    reasonCodes: string[];
    eligibleSourceCount: number;
    textScannedPageCount: number;
    ocrRequiredPageCount: number;
    leadCount: number;
    candidateLeads: Array<{
      leadSha256: string;
      sourceFileId: string;
      sourceSha256: string;
      pageNumber: number;
      stage: string;
      sectionCode: string | null;
      matchedLabel: string;
      rawValue: string;
      rawUnit: string | null;
      lineText: string;
    }>;
  }>;
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
  codeRows: Array<{
    parameterCode: string;
    family: string;
    status: "REVIEW_ONLY";
    observationCount: number;
    reasonCodes: string[];
  }>;
  observations: Array<{
    schemaVersion: "candidate-family-observation-v1";
    observationId: string;
    status: "REVIEW_ONLY";
    parameterCode: string;
    family: string;
    attribute: string;
    canonicalUnit: string;
    matchedLabel: string;
    rawValue: string;
    rawUnit: string | null;
    featureKey: string | null;
    scopeTokens: Array<Record<string, unknown>> | null;
    objectId: string;
    inputManifestHash: string;
    sourceFileId: string;
    sourceSha256: string;
    artifactSha256: string;
    stage: "PD" | "RD";
    sectionCode: string;
    revisionStatus: "CURRENT";
    approvalStatus: "APPROVED";
    pageNumber: number;
    lineText: string;
    blockTextSha256: string;
    locator: {
      kind: "DOCUMENT_TEXT_BLOCK_LINE";
      blockIndex: number;
      lineIndex: number;
      start: number;
      end: number;
      bboxMilliPoints: [number, number, number, number];
    };
    leadSha256: string;
    candidateRulePackSha256: string;
    numericLabelPackSha256: string;
    classLabelPackSha256: string;
    presenceLabelPackSha256: string;
    typedFact: Record<string, unknown> | null;
  }>;
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
    candidateId: string;
    reason: "EXACT_LABEL_LINE" | "PAGE_TOPIC_LINE" | "FEATURE_LABEL_LINE" | "CATALOG_TOPIC_LINE";
    kind: "ONE_DOCUMENT_SIGNAL" | "POSSIBLE_PAIR" | "POSSIBLE_DIFFERENCE";
    parameterCode: string; family: string; attribute: string;
    matchedLabel: string; rawValue: string; rawUnit: string | null;
    sourceFileId: string; sourceSha256: string; artifactSha256: string;
    pageNumber: number; pageWidthMilliPoints: number; pageHeightMilliPoints: number;
    stage: "PD" | "RD" | null; sectionCode: string | null;
    lineText: string; origin: "PDF_TEXT_LAYER";
    locator: { blockIndex: number; lineIndex: number; bboxMilliPoints: number[] };
    relatedDocuments: Array<{ sourceFileId: string; sourceSha256: string;
      pageNumber: number; rawValue: string; rawUnit: string | null; lineText: string }>;
    missingConfirmation: string[]; rank: number;
  }>;
  findingCount: null;
  parameterCoverage: null;
  contentHash: string;
}

export interface ReviewCandidateDecisionInput {
  schemaVersion: "review-candidate-decision-v1";
  candidateId: string; artifactHash: string;
  decision: "ACCEPT_FOR_REVIEW" | "REJECT";
  note: string;
}
export interface ReviewCandidateDecisionRead extends ReviewCandidateDecisionInput {
  id: string; checkId: string; actorId: string; decisionHash: string; createdAt: string;
}
export interface ReviewCandidateDecisionList {
  items: ReviewCandidateDecisionRead[]; canReview: boolean;
}

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
    candidateLeads: Array<{
      schemaVersion: "candidate-family-ocr-lead-v1";
      status: "CANDIDATE";
      purpose: "REVIEW_ONLY";
      parameterCode: string;
      family: string;
      attribute: string;
      canonicalUnit: string;
      matchedLabel: string;
      rawValue: string;
      rawUnit: string | null;
      featureKey: string | null;
      scopeTokens: Array<Record<string, unknown>> | null;
      sourceFileId: string;
      sourceSha256: string;
      ocrArtifactSha256: string;
      ocrPageSha256: string;
      objectId: string;
      inputManifestHash: string;
      stage: "PD" | "RD";
      sectionCode: string;
      revisionStatus: "CURRENT";
      approvalStatus: "APPROVED";
      pageNumber: number;
      coordinateSystem: "IMAGE_TOP_LEFT_PIXELS";
      lineText: string;
      locator: {
        kind: "DOCUMENT_OCR_LINE";
        lineIndex: number;
        start: number;
        end: number;
        bboxPx: [number, number, number, number];
        score: number;
        renderSha256: string;
        rendererProfileId: string;
        providerProfileId: string;
        providerScript: string;
        dpi: number;
        widthPx: number;
        heightPx: number;
      };
      leadSha256: string;
    }>;
  }>;
  findingCount: null;
  parameterCoverage: null;
  outputCount: 47;
  contentHash: string;
}

export interface FactLinkInput {
  factFamilyContentHash: string;
  pdFactId: string;
  actualFactId: string;
  basis: { reference: string };
}

export interface FactLinkRecord {
  id: string;
  checkId: string;
  objectId: string;
  link: {
    pdFactId: string;
    actualFactId: string;
    basis: { reference: string };
    [key: string]: unknown;
  };
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export interface FactLinkListRead {
  items: FactLinkRecord[];
  canReview: boolean;
  canRun: boolean;
}

export type VisualProposalReviewAction = "KEEP_FOR_REVIEW" | "REJECT" | "UNSURE";
export interface VisualProposalReview {
  id: string;
  checkId: string;
  objectId: string;
  artifactId: string;
  contentHash: string;
  sourceFileId: string;
  sourceSha256: string;
  proposalOrdinal: number;
  proposalHash: string;
  action: VisualProposalReviewAction;
  note: string;
  actorId: string;
  reviewHash: string;
  createdAt: string;
}

export interface VisualProposalReviewList {
  items: VisualProposalReview[];
  canReview: boolean;
}

async function requestResponse(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `Ошибка запроса: ${response.status}`);
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestResponse(path, init)).json() as Promise<T>;
}

function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = "inspector_csrf=";
  const value = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : undefined;
}

function mutationHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  const csrf = csrfToken();
  if (csrf) headers.set("X-CSRF-Token", csrf);
  return headers;
}

function commandHeaders(initial?: HeadersInit): Headers {
  const headers = mutationHeaders(initial);
  headers.set("Idempotency-Key", crypto.randomUUID());
  return headers;
}

export const api = {
  openWorkspace: () => request<SessionResponse>("/auth/open-workspace", { method: "POST" }),
  async listObjects(): Promise<InspectionObject[]> {
    const data = await request<{ items: InspectionObject[] }>("/objects");
    return data.items;
  },
  getObject: (id: string) => request<InspectionObject>(`/objects/${id}`),
  sourceFileUrl: (objectId: string, sourceFileId: string) =>
    `${API_BASE}/objects/${encodeURIComponent(objectId)}/files/${encodeURIComponent(sourceFileId)}/content`,
  sourcePagePreviewUrl: (objectId: string, sourceFileId: string, pageNumber: number) =>
    `${API_BASE}/objects/${encodeURIComponent(objectId)}/files/${encodeURIComponent(sourceFileId)}/pages/${encodeURIComponent(pageNumber)}/preview`,
  sourcePageCropUrl: (objectId: string, sourceFileId: string, pageNumber: number, bbox: readonly [number, number, number, number]) =>
    `${API_BASE}/objects/${encodeURIComponent(objectId)}/files/${encodeURIComponent(sourceFileId)}/pages/${encodeURIComponent(pageNumber)}/preview?crop=${bbox.join(",")}`,
  listSourceFiles: (id: string) => request<SourceFileListResponse>(`/objects/${id}/files`),
  async getSourceReview(objectId: string, sourceFileId: string): Promise<SourceReviewDecision | null> {
    const response = await fetch(`${API_BASE}/objects/${objectId}/files/${sourceFileId}/source-review`, {
      credentials: "include",
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(error?.message ?? `Ошибка запроса: ${response.status}`);
    }
    return response.json() as Promise<SourceReviewDecision>;
  },
  recordSourceReview: (objectId: string, sourceFileId: string, input: SourceReviewInput) =>
    request<SourceReviewDecision>(`/objects/${objectId}/files/${sourceFileId}/source-review`, {
      method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
    }),
  createObject: (input: CreateObjectInput) =>
    request<InspectionObject>("/objects", {
      method: "POST",
      headers: commandHeaders(),
      body: JSON.stringify(input),
    }),
  uploadFiles: (id: string, stage: UploadStage, files: File[]) => {
    const body = new FormData();
    files.forEach((file) => body.append("file", file, file.name));
    return request<BinaryUploadRecord>(`/objects/${id}/files?stage=${stage}`, {
      method: "POST",
      headers: commandHeaders(),
      body,
    });
  },
  startCheck: (id: string) => request<CheckRun>(`/objects/${id}/checks`, {
    method: "POST",
    headers: commandHeaders(),
  }),
  getCheck: (id: string) => request<CheckRun>(`/checks/${id}`),
  async getOcrLayout(checkId: string): Promise<OcrLayoutRead | null> {
    const response = await fetch(`${API_BASE}/checks/${encodeURIComponent(checkId)}/ocr-layout`, {
      credentials: "include",
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(error?.message ?? `Ошибка запроса: ${response.status}`);
    }
    return response.json() as Promise<OcrLayoutRead>;
  },
  getOcrLayoutPage: (checkId: string, sourceFileId: string, pageNumber: number, offset = 0) =>
    request<OcrLayoutPageRead>(`/checks/${encodeURIComponent(checkId)}/ocr-layout/pages/${encodeURIComponent(sourceFileId)}/${pageNumber}?offset=${offset}`),
  async getVisualProposals(checkId: string): Promise<VisualProposalAnalysis | null> {
    const response = await fetch(`${API_BASE}/checks/${encodeURIComponent(checkId)}/visual-proposals`, {
      credentials: "include",
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(error?.message ?? `Ошибка запроса: ${response.status}`);
    }
    return response.json() as Promise<VisualProposalAnalysis>;
  },
  listVisualProposalReviews: (checkId: string) =>
    request<VisualProposalReviewList>(`/checks/${encodeURIComponent(checkId)}/visual-proposals/reviews`),
  recordVisualProposalReview: (
    checkId: string,
    input: Pick<VisualProposalReview, "artifactId" | "contentHash" | "sourceFileId" |
      "sourceSha256" | "proposalOrdinal" | "action" | "note">,
  ) => request<VisualProposalReview>(`/checks/${encodeURIComponent(checkId)}/visual-proposals/reviews`, {
    method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
  }),
  reprocessCheck: (id: string) => request<CheckRun>(`/checks/${id}/reprocess`, {
    method: "POST", headers: commandHeaders(),
  }),
  async getFindings(id: string): Promise<Finding[]> {
    const data = await request<{ items: Finding[] }>(`/checks/${id}/findings`);
    return data.items;
  },
  async getCoverage(id: string): Promise<ParameterCoverageItem[]> {
    const data = await request<{ items: ParameterCoverageItem[] }>(`/checks/${id}/coverage`);
    return data.items;
  },
  getPilotResults: (id: string) => request<PilotResultsRead>(`/checks/${encodeURIComponent(id)}/pilot-results`),
  listReviewCandidateDecisions: (id: string) =>
    request<ReviewCandidateDecisionList>(`/checks/${encodeURIComponent(id)}/review-candidate-decisions`),
  recordReviewCandidateDecision: (id: string, input: ReviewCandidateDecisionInput) =>
    request<ReviewCandidateDecisionRead>(`/checks/${encodeURIComponent(id)}/review-candidate-decisions`, {
      method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
    }),
  getOcrRowTranscriptionReviews: (id: string) =>
    request<OcrRowTranscriptionReviewList>(`/checks/${encodeURIComponent(id)}/ocr-row-reviews`),
  recordOcrRowTranscriptionReview: (id: string, input: OcrRowTranscriptionReviewInput) =>
    request<OcrRowTranscriptionReviewRecord>(`/checks/${encodeURIComponent(id)}/ocr-row-reviews`, {
      method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
    }),
  getOcrRowApplicabilityReviews: (id: string) =>
    request<OcrRowApplicabilityReviewList>(`/checks/${encodeURIComponent(id)}/ocr-row-applicability-reviews`),
  getOcrTypedFactCandidates: (id: string) =>
    request<OcrTypedFactCandidatesRead>(`/checks/${encodeURIComponent(id)}/ocr-typed-facts?profile=ocr-typed-fact-candidates-v1`),
  getOcrFactPairReviews: (id: string) =>
    request<OcrFactPairReviewList>(`/checks/${encodeURIComponent(id)}/ocr-fact-pair-reviews`),
  recordOcrFactPairReview: (id: string, input: OcrFactPairReviewInput) =>
    request<OcrFactPairReviewRecord>(`/checks/${encodeURIComponent(id)}/ocr-fact-pair-reviews`, {
      method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
    }),
  getOcrFactPairQuantityReviews: (id: string) =>
    request<OcrFactPairQuantityReviewList>(`/checks/${encodeURIComponent(id)}/ocr-fact-pair-quantity-reviews`),
  recordOcrFactPairQuantityReview: (id: string, input: OcrFactPairQuantityReviewInput) =>
    request<OcrFactPairQuantityReviewRecord>(`/checks/${encodeURIComponent(id)}/ocr-fact-pair-quantity-reviews`, {
      method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
    }),
  getOcrFactPairComparisonPreviews: (id: string) =>
    request<OcrFactPairComparisonPreviewList>(`/checks/${encodeURIComponent(id)}/ocr-fact-pair-comparison-previews`),
  recordOcrRowApplicabilityReview: (id: string, input: OcrRowApplicabilityReviewInput) =>
    request<OcrRowApplicabilityReviewRecord>(`/checks/${encodeURIComponent(id)}/ocr-row-applicability-reviews`, {
      method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
    }),
  getFactLinks: (id: string) => request<FactLinkListRead>(`/checks/${encodeURIComponent(id)}/fact-links`),
  recordFactLink: (id: string, input: FactLinkInput) =>
    request<FactLinkRecord>(`/checks/${encodeURIComponent(id)}/fact-links`, {
      method: "POST", headers: commandHeaders(), body: JSON.stringify(input),
    }),
  decide: async (id: string, input: DecisionInput) => {
    const current = await requestResponse(`/findings/${id}`);
    const etag = current.headers.get("ETag");
    if (!etag) throw new Error("API не вернул версию кандидата");
    const csrf = csrfToken();
    const headers = new Headers({
      "If-Match": etag,
      "Idempotency-Key": crypto.randomUUID(),
    });
    if (csrf) headers.set("X-CSRF-Token", csrf);
    return request<Finding>(`/findings/${id}/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
  },
  async getProtocols(id: string): Promise<ProtocolVersion[]> {
    const data = await request<{ items: ProtocolVersion[] }>(`/checks/${id}/protocols`);
    return data.items;
  },
  finalize: async (id: string, acknowledgementReason?: string) => {
    const current = await requestResponse(`/checks/${id}`);
    const check = await current.json() as CheckRun;
    if (check.mode === "DEMO_SEED") {
      return request<ProtocolVersion>(`/checks/${id}/finalize`, {
        method: "POST",
        headers: mutationHeaders(),
      });
    }
    const etag = current.headers.get("ETag");
    if (!etag || !check.decisionSetHash || !check.gapsHash) {
      throw new Error("API не вернул актуальную версию и hashes проверки");
    }
    const headers = commandHeaders({ "If-Match": etag });
    return request<ProtocolVersion>(`/checks/${id}/finalize`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        runId: check.id,
        decisionSetHash: check.decisionSetHash,
        ...(protocolRequiresGapAcknowledgement(check)
          ? {
              acknowledgedGapsHash: check.gapsHash,
              acknowledgementReason,
            }
          : {}),
      }),
    });
  },
  revokeProtocol: async (
    checkId: string,
    protocolId: string,
    reasonCode: ProtocolRevocationReasonCode,
    comment: string,
  ) => {
    const current = await requestResponse(`/checks/${checkId}`);
    const etag = current.headers.get("ETag");
    if (!etag) throw new Error("API не вернул актуальную версию проверки");
    return request<ProtocolRevocationResult>(`/protocols/${protocolId}/revoke`, {
      method: "POST",
      headers: commandHeaders({ "If-Match": etag }),
      body: JSON.stringify({ reasonCode, comment }),
    });
  },
  async getParameters(): Promise<ParameterCatalogItem[]> {
    const data = await request<{ items: ParameterCatalogItem[] }>("/parameters");
    return data.items;
  },
  exportUrl: (id: string) => `${API_BASE}/protocols/${id}/export`,
  canonicalArtifactUrl: (id: string) => `${API_BASE}/protocols/${id}/artifacts/canonical-json`,
  submissionUrl: (id: string) => `${API_BASE}/checks/${id}/submission`,
};
