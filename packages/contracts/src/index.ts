import { z } from "zod";

export const documentStages = ["PD", "RD", "ID", "RD_ID_MIXED", "UNKNOWN"] as const;
export type DocumentStage = (typeof documentStages)[number];

export const objectStatuses = [
  "DRAFT",
  "UPLOADING",
  "VALIDATING",
  "PROCESSING",
  "PARTIAL",
  "REVIEW_REQUIRED",
  "CLARIFICATION_REQUIRED",
  "READY_TO_FINALIZE",
  "FINALIZED",
  "FAILED",
] as const;
export type ObjectStatus = (typeof objectStatuses)[number];

export const findingStatuses = [
  "CANDIDATE",
  "NEGATIVE_VERIFIED",
  "CONFIRMED_VIOLATION",
  "MISSING_EVIDENCE",
  "NOT_APPLICABLE",
  "NOT_COMPARABLE",
  "CLARIFICATION_REQUIRED",
  "SUSPICION",
] as const;
export type FindingStatus = (typeof findingStatuses)[number];

export const decisionTypes = ["CONFIRM", "REJECT", "CLARIFY", "VERIFY_NEGATIVE"] as const;
export type DecisionType = (typeof decisionTypes)[number];

export interface StageSummary {
  stage: DocumentStage;
  fileCount: number;
  pageCount: number;
  status: "COMPLETE" | "MISSING" | "MIXED" | "UNKNOWN";
}

export interface CheckStats {
  total: number;
  unsupported: number;
  candidates: number;
  confirmed: number;
  negativeVerified: number;
  notComparable: number;
  clarification: number;
  suspicion: number;
}

export interface InspectionObject {
  id: string;
  name: string;
  address: string;
  status: ObjectStatus;
  createdAt: string;
  updatedAt: string;
  stages: StageSummary[];
  fileCount: number;
  pageCount: number;
  activeCheckId: string | null;
  stats: CheckStats;
}

export interface EvidenceRef {
  stage: DocumentStage;
  fileId: string;
  fileName: string;
  pdfPageNumber: number;
  documentSheetNumber: number | null;
  imageUrl: string | null;
  bbox: [number, number, number, number] | null;
  sha256: string;
}

export interface InspectorDecision {
  type: DecisionType;
  reason: string;
  author: string;
  decidedAt: string;
}

export interface Finding {
  id: string;
  checkId: string;
  groupId: string;
  parameterId: number | null;
  parameterCode: string;
  title: string;
  location: string;
  status: FindingStatus;
  severity: "CRITICAL" | "WARNING" | "INFO";
  criticality: string;
  confidence: number | null;
  comparisonResult: string;
  documentStatus: string;
  expectedValue: string | null;
  actualValue: string | null;
  idValue: string | null;
  rationale: string;
  evidence: EvidenceRef[];
  decision: InspectorDecision | null;
}

export interface CheckRun {
  id: string;
  objectId: string;
  status: ObjectStatus;
  progress: number;
  currentStage: string;
  startedAt: string;
  completedAt: string | null;
  mode: "DEMO_SEED" | "NORMAL";
  modelVersion: string | null;
  rulesVersion: string;
  stats: CheckStats;
  rowVersion?: number;
  decisionSetHash?: string;
  gapsHash?: string;
}

export interface ParameterCoverageItem {
  parameterId: number;
  parameterCode: string;
  parameterName: string;
  executionStatus: "UNSUPPORTED" | "PARTIAL";
  reason: string;
}

export interface ProtocolVersion {
  id: string;
  checkId: string;
  version: number;
  status: "DRAFT" | "FINAL";
  createdAt: string;
  createdBy: string;
  stats: CheckStats;
  snapshotHash?: string;
  validity?: "DRAFT" | "VALID" | "REVOKED";
  revocation?: ProtocolRevocationSummary | null;
  canonicalArtifact?: ProtocolArtifactSummary;
}

export interface ProtocolArtifactSummary {
  id: string;
  protocolId: string;
  format: "JSON";
  mediaType: "application/json";
  canonicalizationVersion: "inspector-c14n-v1";
  byteSize: number;
  contentHash: string;
  createdAt: string;
}

export const protocolRevocationReasonCodes = [
  "SOURCE_DATA_ERROR",
  "REVIEW_DECISION_ERROR",
  "SCOPE_ERROR",
  "PROTOCOL_CONTENT_ERROR",
  "OTHER",
] as const;
export type ProtocolRevocationReasonCode = (typeof protocolRevocationReasonCodes)[number];

export interface ProtocolRevocationSummary {
  id: string;
  reasonCode: ProtocolRevocationReasonCode;
  comment: string;
  revokedAt: string;
  revokedBy: string;
  replacementProtocolId: string;
}

export interface ProtocolRevocationResult extends ProtocolRevocationSummary {
  protocolId: string;
  checkId: string;
  rowVersion: number;
  draftProtocol: ProtocolVersion;
}

export interface ProtocolSourceSnapshot {
  fileId: string;
  fileName: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  stages: DocumentStage[];
}

export interface ProtocolScopeSnapshot {
  organizationId: string;
  object: {
    id: string;
    name: string;
    address: string;
  };
  inspection: {
    id: string;
    lifecycle: "OPEN" | "FINALIZED";
    rowVersion: number;
  };
  run: {
    id: string;
    state: "SUCCEEDED" | "PARTIAL";
  };
}

export interface ProtocolIntegritySnapshot {
  inputManifestHash: string;
  outputHash: string;
  decisionSetHash: string;
}

export interface PartialGapAcknowledgement {
  gapsHash: string;
  reason: string;
  actorId: string;
  actorName: string;
  acknowledgedAt: string;
}

export interface ProtocolCoverageSnapshot {
  totalParameters: number;
  executedParameters: number;
  unsupportedParameters: number;
  gapsHash: string;
  gaps: ParameterCoverageItem[];
  acknowledgement: PartialGapAcknowledgement | null;
}

export interface ProtocolLineageSnapshot {
  previousProtocolId: string;
  previousSnapshotHash: string;
  basis: "REVOCATION";
  reasonCode: ProtocolRevocationReasonCode;
  comment: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export interface ProtocolExport {
  schemaVersion: "1.0";
  protocol: ProtocolVersion;
  findings: Finding[];
  snapshotHash?: string;
  validity?: "DRAFT" | "VALID" | "REVOKED";
  revocation?: ProtocolRevocationSummary | null;
  scope?: ProtocolScopeSnapshot;
  integrity?: ProtocolIntegritySnapshot;
  sources?: ProtocolSourceSnapshot[];
  coverage?: ProtocolCoverageSnapshot;
  lineage?: ProtocolLineageSnapshot;
}

export interface ParameterCatalogItem {
  parameter_id: number;
  parameter_code: string;
  pd_section: string | null;
  parameter_name: string;
  unit: string | null;
  source_pd: string | null;
  source_rd: string | null;
  source_id: string | null;
  trigger: string | null;
  criticality: string | null;
  matrix_row: number | null;
  mapping_status: string | null;
}

export const createObjectSchema = z.object({
  name: z.string().trim().min(3).max(180),
  address: z.string().trim().min(3).max(260),
});
export type CreateObjectInput = z.infer<typeof createObjectSchema>;

export const uploadStages = ["PD", "RD", "ID"] as const;
export const uploadStageSchema = z.enum(uploadStages);
export type UploadStage = z.infer<typeof uploadStageSchema>;

export const uploadPolicy = {
  acceptedExtensions: [".pdf", ".docx", ".xml", ".dwg"],
  maxFileBytes: 100 * 1024 * 1024,
  maxUploadBytes: 200 * 1024 * 1024,
  maxFiles: 1000,
} as const;
export type AcceptedUploadExtension = (typeof uploadPolicy.acceptedExtensions)[number];

export interface IngestedDocumentFile {
  id: string;
  name: string;
  size: number;
  stage: UploadStage;
  mimeType: string;
  sha256: string;
  scanStatus: "CLEAN";
  status: "STORED" | "DUPLICATE";
}

export interface BinaryUploadRecord {
  id: string;
  objectId: string;
  status: "ACCEPTED";
  files: IngestedDocumentFile[];
  createdAt: string;
}

export const sourcePageStages = [...uploadStages, "UNRESOLVED"] as const;
export type SourcePageStage = (typeof sourcePageStages)[number];
export const sourceSectionCodes = [
  "PZ", "SPZU", "AR", "KR", "IOS1", "IOS2", "IOS3", "IOS4", "IOS5",
  "POS", "POD", "OOS", "PPM", "ODI", "ZU", "SM",
  "EOM", "GP", "GSV", "KJ", "KM", "NVK", "OV", "PP", "PPR", "SS", "VK",
] as const;
export type SourceSectionCode = (typeof sourceSectionCodes)[number];

export const sourceReviewSchema = z.object({
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  revisionStatus: z.enum(["CURRENT", "SUPERSEDED", "UNKNOWN"]),
  approvalStatus: z.enum(["APPROVED", "UNAPPROVED", "UNKNOWN"]),
  linkGroupId: z.string().trim().min(1).max(120).nullable(),
  sectionCode: z.enum(sourceSectionCodes).nullable().optional(),
  pageStages: z.record(z.string().regex(/^[1-9][0-9]*$/), z.enum(sourcePageStages)),
  basis: z.object({ reference: z.string().trim().min(8).max(1000) }).strict(),
}).strict();
export type SourceReviewInput = z.infer<typeof sourceReviewSchema>;

export interface SourceReviewDecision extends SourceReviewInput {
  sectionCode: SourceSectionCode | null;
  id: string;
  objectId: string;
  sourceFileId: string;
  actorId: string;
  contentHash: string;
  createdAt: string;
}

export interface SourceFileReviewSummary {
  revisionStatus: SourceReviewInput["revisionStatus"];
  approvalStatus: SourceReviewInput["approvalStatus"];
  linkGroupId: string | null;
  sectionCode: SourceSectionCode | null;
  pageStageCount: number;
  contentHash: string;
  createdAt: string;
}

export interface SourceFileSummary {
  id: string;
  name: string;
  sha256: string;
  size: number;
  stages: UploadStage[];
  pageCount: number | null;
  registeredAt: string;
  review: SourceFileReviewSummary | null;
}

export interface SourceFileListResponse {
  items: SourceFileSummary[];
  permissions: { upload: boolean; review: boolean; run: boolean };
}

export const decisionSchema = z.object({
  type: z.enum(decisionTypes),
  reason: z.string().trim().min(5).max(1000),
  author: z.string().trim().min(2).max(120).default("Инспектор"),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const finalizeCheckSchema = z.object({
  runId: z.string().trim().min(1).max(200),
  decisionSetHash: sha256Schema,
  acknowledgedGapsHash: sha256Schema.optional(),
  acknowledgementReason: z.string().trim().min(10).max(1000).optional(),
}).strict();
export type FinalizeCheckInput = z.infer<typeof finalizeCheckSchema>;

export const revokeProtocolSchema = z.object({
  reasonCode: z.enum(protocolRevocationReasonCodes),
  comment: z.string().trim().min(10).max(2000),
}).strict();
export type RevokeProtocolInput = z.infer<typeof revokeProtocolSchema>;

export const loginSchema = z.object({
  login: z.string().trim().min(3).max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(512),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface SessionUser {
  id: string;
  displayName: string;
  roles: string[];
  capabilities: string[];
  expiresAt: string;
}

export interface SessionResponse {
  user: SessionUser;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
