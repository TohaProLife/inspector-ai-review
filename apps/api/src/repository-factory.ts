import type {
  BinaryUploadRecord,
  CheckRun,
  CreateObjectInput,
  DecisionInput,
  Finding,
  InspectionObject,
  ParameterCatalogItem,
  ParameterCoverageItem,
  SourceReviewDecision,
  SourceReviewInput,
  SourceFileSummary,
  ProtocolExport,
  ProtocolVersion,
} from "@inspector-ai/contracts";
import { PostgresInspectionRepository } from "./postgres-repository.js";
import { loadReferenceData } from "./reference-data.js";
import type {
  AuditedMutationCommand,
  AuditedMutationCommandResult,
  DecisionResult,
  FactEntityLinkDecision,
  FactEntityLinkReviewInput,
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
  OcrLayoutPageRead,
  OcrLayoutRead,
  OcrRowTranscriptionReview,
  OcrRowTranscriptionReviewInput,
  OcrRowApplicabilityReview,
  OcrRowApplicabilityCandidate,
  OcrTypedFactV2Read,
  OcrFactPairReview,
  OcrFactPairCandidate,
  OcrFactPairSnapshot,
  OcrFactPairReviewInput,
  OcrFactPairQuantityReview,
  OcrFactPairQuantityCandidate,
  OcrFactPairQuantityReviewInput,
  OcrRowApplicabilityReviewInput,
  OcrTableRowsRead,
  PilotResultsScopedRead,
  SourceFileContent,
  RegisteredIngestedDocumentFile,
  ProtocolCanonicalArtifactContent,
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
import type { OcrFactPairComparisonPreview } from "./ocr-fact-pair-comparison.js";
import { InspectorStore } from "./store.js";

export class RoutedInspectionRepository implements InspectionRepository {
  constructor(
    private readonly demo: InspectorStore,
    private readonly normal: PostgresInspectionRepository,
  ) {}

  async close(): Promise<void> {
    await this.normal.close();
  }

  recordSourceReviewCommand(
    objectId: string,
    sourceFileId: string,
    input: SourceReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<SourceReviewDecision>> {
    return this.normal.recordSourceReviewCommand(objectId, sourceFileId, input, command);
  }

  getSourceReview(
    objectId: string,
    sourceFileId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<SourceReviewDecision>> {
    return this.normal.getSourceReview(objectId, sourceFileId, actor);
  }

  listSourceFiles(
    objectId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<SourceFileSummary[]>> {
    if (this.demo.getObject(objectId)) return Promise.resolve([]);
    return this.normal.listSourceFiles(objectId, actor);
  }

  getSourceFileContent(
    objectId: string,
    sourceFileId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<SourceFileContent>> {
    if (this.demo.getObject(objectId)) return Promise.resolve(undefined);
    return this.normal.getSourceFileContent(objectId, sourceFileId, actor);
  }

  claimJob(jobId: string, input: JobClaimInput): Promise<JobClaimResult> {
    return this.normal.claimJob(jobId, input);
  }

  getJobInput(jobId: string, sourceFileId: string, input: JobAttemptInput): Promise<JobInputResult> {
    return this.normal.getJobInput(jobId, sourceFileId, input);
  }

  getJobTextArtifact(jobId: string, sourceFileId: string, input: JobAttemptInput): Promise<JobTextArtifactResult> {
    return this.normal.getJobTextArtifact(jobId, sourceFileId, input);
  }

  getJobOcrLayoutArtifact(jobId: string, input: JobAttemptInput): Promise<JobOcrLayoutArtifactResult> {
    return this.normal.getJobOcrLayoutArtifact(jobId, input);
  }

  heartbeatJob(jobId: string, input: JobAttemptInput): Promise<JobHeartbeatResult> {
    return this.normal.heartbeatJob(jobId, input);
  }

  completeJob(jobId: string, input: JobCompleteInput): Promise<JobCompleteResult> {
    return this.normal.completeJob(jobId, input);
  }

  failJob(jobId: string, input: JobFailInput): Promise<JobFailResult> {
    return this.normal.failJob(jobId, input);
  }

  async listObjects(actor?: AuthenticatedActor): Promise<InspectionObject[]> {
    return [...this.demo.listObjects(), ...await this.normal.listObjects(actor)];
  }

  async getObject(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<InspectionObject>> {
    return this.demo.getObject(id) ?? await this.normal.getObject(id, actor);
  }

  async hasObjectPermission(
    objectId: string,
    actor: AuthenticatedActor,
    permission: string,
  ): Promise<boolean> {
    if (this.demo.getObject(objectId)) return true;
    return this.normal.hasObjectPermission(objectId, actor, permission);
  }

  createObject(input: CreateObjectInput, actor?: AuthenticatedActor): Promise<InspectionObject> {
    return this.normal.createObject(input, actor);
  }

  createObjectCommand(
    input: CreateObjectInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<InspectionObject>> {
    return this.normal.createObjectCommand(input, command);
  }

  async hasIngestedFile(objectId: string, sha256: string, actor?: AuthenticatedActor): Promise<boolean> {
    if (this.demo.getObject(objectId)) return this.demo.hasIngestedFile(objectId, sha256);
    return this.normal.hasIngestedFile(objectId, sha256, actor);
  }

  async registerIngestedFiles(
    objectId: string,
    files: RegisteredIngestedDocumentFile[],
    actor?: AuthenticatedActor,
  ): Promise<BinaryUploadRecord | undefined> {
    if (this.demo.getObject(objectId)) return this.demo.registerIngestedFiles(objectId, files);
    return this.normal.registerIngestedFiles(objectId, files, actor);
  }

  async registerIngestedFilesCommand(
    objectId: string,
    files: RegisteredIngestedDocumentFile[],
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<BinaryUploadRecord>> {
    if (this.demo.getObject(objectId)) {
      const value = this.demo.registerIngestedFiles(objectId, files);
      return value ? { kind: "success", value, replayed: false } : { kind: "not_found" };
    }
    return this.normal.registerIngestedFilesCommand(objectId, files, command);
  }

  async getUpload(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<BinaryUploadRecord>> {
    return this.demo.getUpload(id) ?? await this.normal.getUpload(id, actor);
  }

  async startCheck(objectId: string, actor?: AuthenticatedActor): Promise<CheckRun | undefined> {
    if (this.demo.getObject(objectId)) return this.demo.startCheck(objectId);
    return this.normal.startCheck(objectId, actor);
  }

  async startCheckCommand(
    objectId: string,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<CheckRun>> {
    if (this.demo.getObject(objectId)) {
      const value = this.demo.startCheck(objectId);
      return value ? { kind: "success", value, replayed: false } : { kind: "not_found" };
    }
    return this.normal.startCheckCommand(objectId, command);
  }

  async completeCheck(checkId: string): Promise<CheckRun | undefined> {
    if (this.demo.getCheck(checkId)) return this.demo.completeCheck(checkId);
    return this.normal.completeCheck(checkId);
  }

  async getCheck(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<CheckRun>> {
    return this.demo.getCheck(id) ?? await this.normal.getCheck(id, actor);
  }

  async getFindings(checkId: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<Finding[]>> {
    if (this.demo.getCheck(checkId)) return this.demo.getFindings(checkId);
    return this.normal.getFindings(checkId, actor);
  }

  async getPilotResults(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Promise<PilotResultsScopedRead> {
    const demoCheck = this.demo.getCheck(checkId);
    if (demoCheck) {
      return {
        checkId,
        status: demoCheck.status === "PROCESSING" ? "PROCESSING" : "READY",
        items: [],
        ocrHeatRows: null,
      };
    }
    return this.normal.getPilotResults(checkId, actor);
  }

  async getVisualProposals(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<Record<string, unknown>>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getVisualProposals(checkId, actor);
  }

  async listFactEntityLinks(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: FactEntityLinkDecision[]; canReview: boolean; canRun: boolean }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.listFactEntityLinks(checkId, actor);
  }

  recordFactEntityLinkCommand(
    checkId: string,
    input: FactEntityLinkReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<FactEntityLinkDecision>> {
    if (this.demo.getCheck(checkId)) return Promise.resolve({ kind: "not_found" });
    return this.normal.recordFactEntityLinkCommand(checkId, input, command);
  }

  async getOcrLayout(
    checkId: string, actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<OcrLayoutRead>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrLayout(checkId, actor);
  }

  async getOcrLayoutPage(
    checkId: string, sourceFileId: string, pageNumber: number,
    offset: number, actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<OcrLayoutPageRead>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrLayoutPage(checkId, sourceFileId, pageNumber, offset, actor);
  }

  async listVisualProposalReviews(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: VisualProposalReview[]; canReview: boolean }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.listVisualProposalReviews(checkId, actor);
  }

  recordVisualProposalReviewCommand(
    checkId: string,
    input: VisualProposalReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<VisualProposalReview>> {
    if (this.demo.getCheck(checkId)) return Promise.resolve({ kind: "not_found" });
    return this.normal.recordVisualProposalReviewCommand(checkId, input, command);
  }

  async listReviewCandidateDecisions(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: ReviewCandidateDecisionRead[]; canReview: boolean }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.listReviewCandidateDecisions(checkId, actor);
  }

  recordReviewCandidateDecisionCommand(
    checkId: string,
    input: ReviewCandidateDecisionInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<ReviewCandidateDecisionRead>> {
    if (this.demo.getCheck(checkId)) return Promise.resolve({ kind: "not_found" });
    return this.normal.recordReviewCandidateDecisionCommand(checkId, input, command);
  }

  async getOcrRowTranscriptionReviews(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{
    items: OcrRowTranscriptionReview[];
    canReview: boolean;
    ocrStageSha256: string;
    candidates: Array<{ rowFingerprint: string; proposal: OcrTableRowsRead["proposals"][number] }>;
  }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrRowTranscriptionReviews(checkId, actor);
  }

  recordOcrRowTranscriptionReviewCommand(
    checkId: string,
    input: OcrRowTranscriptionReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrRowTranscriptionReview>> {
    if (this.demo.getCheck(checkId)) return Promise.resolve({ kind: "not_found" });
    return this.normal.recordOcrRowTranscriptionReviewCommand(checkId, input, command);
  }

  async getOcrRowApplicabilityReviews(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrRowApplicabilityReview[];
    canReview: boolean; candidates: OcrRowApplicabilityCandidate[] }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrRowApplicabilityReviews(checkId, actor);
  }

  async getOcrTypedFactCandidates(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<OcrTypedFactV2Read>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrTypedFactCandidates(checkId, actor);
  }

  recordOcrRowApplicabilityReviewCommand(
    checkId: string,
    input: OcrRowApplicabilityReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrRowApplicabilityReview>> {
    if (this.demo.getCheck(checkId)) return Promise.resolve({ kind: "not_found" });
    return this.normal.recordOcrRowApplicabilityReviewCommand(checkId, input, command);
  }

  async getOcrFactPairReviews(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrFactPairReview[];
    canReview: boolean; candidates: OcrFactPairCandidate[] }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrFactPairReviews(checkId, actor);
  }

  async getOcrFactPairSnapshots(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrFactPairSnapshot[] }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrFactPairSnapshots(checkId, actor);
  }

  recordOcrFactPairReviewCommand(
    checkId: string,
    input: OcrFactPairReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrFactPairReview>> {
    if (this.demo.getCheck(checkId)) return Promise.resolve({ kind: "not_found" });
    return this.normal.recordOcrFactPairReviewCommand(checkId, input, command);
  }

  async getOcrFactPairQuantityReviews(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: OcrFactPairQuantityReview[];
    effectiveItems: OcrFactPairQuantityReview[];
    candidates: OcrFactPairQuantityCandidate[];
    canReview: boolean; reasonCode: string | null }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrFactPairQuantityReviews(checkId, actor);
  }

  recordOcrFactPairQuantityReviewCommand(
    checkId: string,
    input: OcrFactPairQuantityReviewInput,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<OcrFactPairQuantityReview>> {
    if (this.demo.getCheck(checkId)) return Promise.resolve({ kind: "not_found" });
    return this.normal.recordOcrFactPairQuantityReviewCommand(checkId, input, command);
  }

  async getOcrFactPairComparisonPreviews(
    checkId: string,
    actor: AuthenticatedActor,
  ): Promise<ScopedReadResult<{ items: Array<{
    quantityDecisionId: string; preview: OcrFactPairComparisonPreview;
  }> }>> {
    if (this.demo.getCheck(checkId)) return undefined;
    return this.normal.getOcrFactPairComparisonPreviews(checkId, actor);
  }

  async getFinding(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<Finding>> {
    return this.demo.getFinding(id) ?? await this.normal.getFinding(id, actor);
  }

  async getFindingForReview(
    id: string,
    actor?: ReviewDecisionCommand["actor"],
  ): Promise<ReviewFindingResult> {
    const demoFinding = this.demo.getFindingForReview(id);
    if (demoFinding) return demoFinding;
    return this.normal.getFindingForReview(id, actor);
  }

  async decideFinding(id: string, input: DecisionInput): Promise<DecisionResult> {
    if (this.demo.getFinding(id)) return this.demo.decideFinding(id, input);
    return this.normal.decideFinding(id, input);
  }

  async decideFindingCommand(
    id: string,
    command: ReviewDecisionCommand,
  ): Promise<ReviewDecisionCommandResult> {
    if (this.demo.getFinding(id)) return this.demo.decideFindingCommand(id, command);
    return this.normal.decideFindingCommand(id, command);
  }

  async reprocess(checkId: string, actor?: AuthenticatedActor): Promise<CheckRun | undefined> {
    if (this.demo.getCheck(checkId)) return this.demo.reprocess(checkId);
    return this.normal.reprocess(checkId, actor);
  }

  async reprocessCommand(
    checkId: string,
    command: AuditedMutationCommand,
  ): Promise<AuditedMutationCommandResult<CheckRun>> {
    if (this.demo.getCheck(checkId)) {
      const value = this.demo.reprocess(checkId);
      return value ? { kind: "success", value, replayed: false } : { kind: "not_found" };
    }
    return this.normal.reprocessCommand(checkId, command);
  }

  async finalize(checkId: string, actor?: AuthenticatedActor): Promise<FinalizeResult> {
    if (this.demo.getCheck(checkId)) return this.demo.finalize(checkId);
    return this.normal.finalize(checkId, actor);
  }

  async finalizeCommand(
    checkId: string,
    command: FinalizeCheckCommand,
  ): Promise<FinalizeCheckCommandResult> {
    if (this.demo.getCheck(checkId)) {
      const value = this.demo.finalize(checkId);
      if (!value || typeof value === "string") {
        return value === "PENDING_DECISIONS"
          ? { kind: "invalid_state", code: value, message: "Сначала обработайте всех кандидатов" }
          : { kind: "invalid_state", code: "INCOMPLETE_ANALYSIS", message: "Проверка не готова к финализации" };
      }
      return { kind: "success", protocol: value, rowVersion: 1, replayed: false };
    }
    return this.normal.finalizeCommand(checkId, command);
  }

  async getProtocols(checkId: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<ProtocolVersion[]>> {
    if (this.demo.getCheck(checkId)) return this.demo.getProtocols(checkId);
    return this.normal.getProtocols(checkId, actor);
  }

  async revokeProtocolCommand(
    protocolId: string,
    command: RevokeProtocolCommand,
  ): Promise<RevokeProtocolCommandResult> {
    if (this.demo.getProtocol(protocolId)) {
      return {
        kind: "invalid_state",
        code: "DEMO_PROTOCOL_IMMUTABLE",
        message: "Публичный demo-протокол нельзя отзывать",
      };
    }
    return this.normal.revokeProtocolCommand(protocolId, command);
  }

  async getProtocol(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<ProtocolVersion>> {
    return this.demo.getProtocol(id) ?? await this.normal.getProtocol(id, actor);
  }

  async getProtocolExport(id: string, actor?: AuthenticatedActor): Promise<ScopedReadResult<ProtocolExport>> {
    return this.demo.getProtocolExport(id) ?? await this.normal.getProtocolExport(id, actor);
  }

  async getCanonicalProtocolArtifact(
    id: string,
    actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<ProtocolCanonicalArtifactContent>> {
    if (this.demo.getProtocol(id)) return undefined;
    return this.normal.getCanonicalProtocolArtifact(id, actor);
  }

  async getSubmission(checkId: string, actor?: AuthenticatedActor): Promise<SubmissionResult | "AUTH_REQUIRED"> {
    if (this.demo.getCheck(checkId)) return this.demo.getSubmission(checkId);
    return this.normal.getSubmission(checkId, actor);
  }

  async getParameters(): Promise<ParameterCatalogItem[]> {
    return this.demo.getParameters();
  }

  async getCoverage(
    checkId: string,
    actor?: AuthenticatedActor,
  ): Promise<ScopedReadResult<ParameterCoverageItem[]>> {
    if (this.demo.getCheck(checkId)) return this.demo.getCoverage(checkId);
    return this.normal.getCoverage(checkId, actor);
  }
}

export async function createInspectionRepositoryFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<InspectionRepository> {
  const reference = await loadReferenceData();
  // Public training checks remain test fixtures; running services expose only uploaded objects.
  const demo = new InspectorStore(reference, false);
  const connectionString = environment.DATABASE_URL;
  if (environment.INSPECTOR_ZU127_GENERIC_REVIEW_PROFILE) {
    throw new Error(
      "INSPECTOR_ZU127_GENERIC_REVIEW_PROFILE is unavailable until the dedicated consumer and durable verifier are installed",
    );
  }
  if (!connectionString) return demo;
  const profile = environment.INSPECTOR_ANALYSIS_PROFILE ?? "SCAFFOLD";
  if (profile !== "SCAFFOLD" && profile !== "PILOT_PZ002" && profile !== "PILOT_PZ002_PZ017") {
    throw new Error(`Unsupported INSPECTOR_ANALYSIS_PROFILE: ${profile}`);
  }
  const visualProfile = environment.INSPECTOR_VISUAL_PROFILE ?? "V4";
  if (visualProfile !== "V4" && visualProfile !== "V5" && visualProfile !== "V6") {
    throw new Error(`Unsupported INSPECTOR_VISUAL_PROFILE: ${visualProfile}`);
  }

  const normal = await PostgresInspectionRepository.create({
    connectionString,
    parameters: reference.parameters,
    organizationSlug: environment.INSPECTOR_ORGANIZATION_SLUG,
    organizationName: environment.INSPECTOR_ORGANIZATION_NAME,
    analysisProfile: profile,
    visualProfile,
  });
  return new RoutedInspectionRepository(demo, normal);
}
