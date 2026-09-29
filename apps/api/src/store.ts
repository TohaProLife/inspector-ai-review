import { randomUUID } from "node:crypto";
import type {
  CheckRun,
  CheckStats,
  BinaryUploadRecord,
  CreateObjectInput,
  DecisionInput,
  EvidenceRef,
  Finding,
  InspectionObject,
  ParameterCatalogItem,
  ParameterCoverageItem,
  ProtocolExport,
  ProtocolVersion,
  StageSummary,
  IngestedDocumentFile,
} from "@inspector-ai/contracts";
import { loadReferenceData, type ReferenceData } from "./reference-data.js";
import type {
  InspectionRepository,
  ReviewDecisionCommand,
  ReviewDecisionCommandResult,
  ReviewFindingResult,
  SubmissionExport,
} from "./repository.js";

export type { SubmissionExport } from "./repository.js";

const DEMO_OBJECT_ID = "OBJ-TYUMENSKAYA-5-GOLD-SEED";
const DEMO_CHECK_ID = "CHK-TYUMENSKAYA-5-001";

const titleByParameter: Record<string, string> = {
  "IOS4-079": "Конфигурация приточных установок",
  "FREE-HEATING-001": "Наличие системы тёплого пола",
  "IOS4-078": "Система вытяжной вентиляции",
};

const now = () => new Date().toISOString();

function isSubmissionEvidence(
  evidence: EvidenceRef,
): evidence is EvidenceRef & { stage: "PD" | "RD" | "ID" } {
  return evidence.stage === "PD" || evidence.stage === "RD" || evidence.stage === "ID";
}

function blankStats(): CheckStats {
  return {
    total: 0,
    unsupported: 0,
    candidates: 0,
    confirmed: 0,
    negativeVerified: 0,
    notComparable: 0,
    clarification: 0,
    suspicion: 0,
  };
}

function stageSummary(reference: ReferenceData): StageSummary[] {
  const rows = [...reference.manifest.values()].filter((item) => item.object_id === DEMO_OBJECT_ID);
  const summarize = (stage: StageSummary["stage"], status: StageSummary["status"]): StageSummary => {
    const matches = rows.filter((item) => item.stage === stage);
    return {
      stage,
      fileCount: matches.length,
      pageCount: matches.reduce((sum, item) => sum + (item.pdf_pages ?? 0), 0),
      status,
    };
  };

  return [
    summarize("PD", "COMPLETE"),
    summarize("RD_ID_MIXED", "MIXED"),
    summarize("ID", "MISSING"),
  ];
}

function mapFinding(reference: ReferenceData, index: number): Finding {
  const source = reference.publicChecks[index];
  return {
    id: `FND-${String(index + 1).padStart(4, "0")}`,
    checkId: DEMO_CHECK_ID,
    groupId: source.finding_group_id,
    parameterId: source.parameter_id,
    parameterCode: source.parameter_code,
    title: titleByParameter[source.parameter_code] ?? source.parameter_code,
    location: `Помещение ${source.location}`,
    status: "CANDIDATE",
    severity: source.protocol_status,
    criticality: source.criticality,
    confidence: null,
    comparisonResult: source.comparison_result,
    documentStatus: source.document_status,
    expectedValue: source.pd_value,
    actualValue: source.rd_value,
    idValue: source.id_value,
    rationale:
      source.comparison_result === "MISSING_DESIGN_ELEMENT"
        ? "Элемент найден в ПД, но не найден на связанном листе РД. Требуется решение инспектора."
        : "Связанные фрагменты ПД и РД содержат различающуюся конфигурацию. Требуется решение инспектора.",
    evidence: source.evidence.map((evidence) => {
      const manifest = reference.manifest.get(evidence.file_id);
      return {
        stage: evidence.stage,
        fileId: evidence.file_id,
        fileName: manifest?.relative_path.split("/").at(-1) ?? evidence.file_id,
        pdfPageNumber: evidence.pdf_page_number,
        documentSheetNumber: evidence.document_sheet_number,
        imageUrl: `/evidence/${evidence.rendered_image.split("/").at(-1)}`,
        bbox: null,
        sha256: manifest?.sha256 ?? "not-provided-in-public-label",
      };
    }),
    decision: null,
  };
}

export class InspectorStore implements InspectionRepository {
  private readonly objects = new Map<string, InspectionObject>();
  private readonly checks = new Map<string, CheckRun>();
  private readonly findings = new Map<string, Finding>();
  private readonly findingVersions = new Map<string, number>();
  private readonly protocols = new Map<string, ProtocolVersion[]>();
  private readonly protocolExports = new Map<string, ProtocolExport>();
  private readonly uploads = new Map<string, BinaryUploadRecord>();
  private readonly ingestedFileStages = new Map<string, Map<string, Set<IngestedDocumentFile["stage"]>>>();
  private readonly findingTemplates: Finding[];

  constructor(private readonly reference: ReferenceData, seedDemo = true) {
    this.findingTemplates = reference.publicChecks.map((_, index) => mapFinding(reference, index));
    if (!seedDemo) return;
    const stages = stageSummary(reference);
    const stats = {
      ...blankStats(),
      total: reference.parameters.length,
      unsupported: reference.parameters.length,
      candidates: reference.publicChecks.length,
    };
    const timestamp = now();
    const object: InspectionObject = {
      id: DEMO_OBJECT_ID,
      name: "Учебный объект: Тюменская, 5",
      address: "г. Москва, ул. Тюменская, д. 5",
      status: "REVIEW_REQUIRED",
      createdAt: timestamp,
      updatedAt: timestamp,
      stages,
      fileCount: stages.reduce((sum, stage) => sum + stage.fileCount, 0),
      pageCount: stages.reduce((sum, stage) => sum + stage.pageCount, 0),
      activeCheckId: DEMO_CHECK_ID,
      stats,
    };
    const check: CheckRun = {
      id: DEMO_CHECK_ID,
      objectId: object.id,
      status: "REVIEW_REQUIRED",
      progress: 100,
      currentStage: "Решение инспектора",
      startedAt: timestamp,
      completedAt: timestamp,
      mode: "DEMO_SEED",
      modelVersion: null,
      rulesVersion: "matrix-132-v1",
      stats,
    };

    this.objects.set(object.id, object);
    this.checks.set(check.id, check);
    this.findingTemplates.forEach((finding) => {
      this.findings.set(finding.id, structuredClone(finding));
      this.findingVersions.set(finding.id, 1);
    });
    const protocol: ProtocolVersion = {
      id: "PRT-TYUMENSKAYA-5-V1",
      checkId: check.id,
      version: 1,
      status: "DRAFT",
      createdAt: timestamp,
      createdBy: "Система",
      stats: structuredClone(stats),
    };
    this.protocols.set(check.id, [protocol]);
    this.captureProtocolSnapshot(protocol);
  }

  static async create(): Promise<InspectorStore> {
    return new InspectorStore(await loadReferenceData());
  }

  listObjects(): InspectionObject[] {
    return [...this.objects.values()];
  }

  getObject(id: string): InspectionObject | undefined {
    return this.objects.get(id);
  }

  hasObjectPermission(objectId: string): boolean {
    return this.objects.has(objectId);
  }

  createObject(input: CreateObjectInput): InspectionObject {
    const timestamp = now();
    const id = `OBJ-${randomUUID().slice(0, 8).toUpperCase()}`;
    const object: InspectionObject = {
      id,
      ...input,
      status: "DRAFT",
      createdAt: timestamp,
      updatedAt: timestamp,
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
    this.objects.set(id, object);
    return object;
  }

  hasIngestedFile(objectId: string, sha256: string): boolean {
    return this.ingestedFileStages.get(objectId)?.has(sha256) ?? false;
  }

  registerIngestedFiles(
    objectId: string,
    files: IngestedDocumentFile[],
  ): BinaryUploadRecord | undefined {
    const object = this.objects.get(objectId);
    if (!object) return undefined;

    const upload: BinaryUploadRecord = {
      id: `UPL-${randomUUID().slice(0, 8).toUpperCase()}`,
      objectId,
      status: "ACCEPTED",
      files,
      createdAt: now(),
    };
    this.uploads.set(upload.id, upload);

    const stagesByHash = this.ingestedFileStages.get(objectId) ?? new Map();
    for (const file of files) {
      const registeredStages = stagesByHash.get(file.sha256) ?? new Set();
      if (!registeredStages.has(file.stage)) {
        registeredStages.add(file.stage);
        object.fileCount += 1;
        const stage = object.stages.find((item) => item.stage === file.stage);
        if (stage) {
          stage.fileCount += 1;
          stage.status = "COMPLETE";
        }
      }
      stagesByHash.set(file.sha256, registeredStages);
    }
    this.ingestedFileStages.set(objectId, stagesByHash);
    object.status = "VALIDATING";
    object.updatedAt = now();
    return upload;
  }

  getUpload(id: string): BinaryUploadRecord | undefined {
    return this.uploads.get(id);
  }

  startCheck(objectId: string): CheckRun | undefined {
    const object = this.objects.get(objectId);
    if (!object) return undefined;
    const id = `CHK-${randomUUID().slice(0, 8).toUpperCase()}`;
    const check: CheckRun = {
      id,
      objectId,
      status: "PROCESSING",
      progress: 12,
      currentStage: "Регистрация и хеширование",
      startedAt: now(),
      completedAt: null,
      mode: "NORMAL",
      modelVersion: null,
      rulesVersion: "matrix-132-v1",
      stats: { ...blankStats(), total: this.reference.parameters.length },
    };
    this.checks.set(id, check);
    object.activeCheckId = id;
    object.status = "PROCESSING";
    object.updatedAt = now();
    return check;
  }

  completeCheck(checkId: string): CheckRun | undefined {
    const check = this.checks.get(checkId);
    if (!check || check.status !== "PROCESSING") return check;
    const object = this.objects.get(check.objectId);
    if (!object) return undefined;

    if (check.mode === "NORMAL") {
      const stats = {
        ...blankStats(),
        total: this.reference.parameters.length,
        unsupported: this.reference.parameters.length,
      };
      check.status = "PARTIAL";
      check.progress = 100;
      check.currentStage = "Исполняемые правила для новых документов пока не подключены";
      check.completedAt = now();
      check.stats = stats;
      object.status = "PARTIAL";
      object.stats = stats;
      object.updatedAt = now();
      return check;
    }

    this.findingTemplates.forEach((template, index) => {
      const finding: Finding = {
        ...structuredClone(template),
        id: `FND-${check.id.slice(-8)}-${String(index + 1).padStart(2, "0")}`,
        checkId,
      };
      this.findings.set(finding.id, finding);
      this.findingVersions.set(finding.id, 1);
    });

    const stats = {
      ...blankStats(),
      total: this.reference.parameters.length,
      unsupported: this.reference.parameters.length,
      candidates: this.findingTemplates.length,
    };
    check.status = "REVIEW_REQUIRED";
    check.progress = 100;
    check.currentStage = "Решение инспектора";
    check.completedAt = now();
    check.stats = stats;
    object.status = "REVIEW_REQUIRED";
    object.stats = stats;
    object.updatedAt = now();
    const protocol: ProtocolVersion = {
      id: `PRT-${check.id.slice(-8)}-V1`,
      checkId,
      version: 1,
      status: "DRAFT",
      createdAt: now(),
      createdBy: "Система",
      stats: structuredClone(stats),
    };
    this.protocols.set(checkId, [protocol]);
    this.captureProtocolSnapshot(protocol);
    return check;
  }

  getCheck(id: string): CheckRun | undefined {
    return this.checks.get(id);
  }

  getFindings(checkId: string): Finding[] {
    return [...this.findings.values()].filter((finding) => finding.checkId === checkId);
  }

  getFinding(id: string): Finding | undefined {
    return this.findings.get(id);
  }

  getFindingForReview(id: string): ReviewFindingResult {
    const finding = this.findings.get(id);
    if (!finding) return undefined;
    return {
      finding,
      mode: "DEMO_SEED",
      rowVersion: this.findingVersions.get(id) ?? 1,
    };
  }

  decideFinding(id: string, input: DecisionInput): Finding | undefined {
    const finding = this.findings.get(id);
    if (!finding) return undefined;
    const statusByDecision = {
      CONFIRM: "CONFIRMED_VIOLATION",
      REJECT: "NEGATIVE_VERIFIED",
      CLARIFY: "CLARIFICATION_REQUIRED",
      VERIFY_NEGATIVE: "NEGATIVE_VERIFIED",
    } as const;
    finding.status = statusByDecision[input.type];
    finding.decision = {
      type: input.type,
      reason: input.reason,
      author: "Демо-инспектор",
      decidedAt: now(),
    };
    this.findingVersions.set(id, (this.findingVersions.get(id) ?? 1) + 1);
    this.recalculate(finding.checkId);
    return finding;
  }

  decideFindingCommand(id: string, command: ReviewDecisionCommand): ReviewDecisionCommandResult {
    const currentVersion = this.findingVersions.get(id);
    if (currentVersion === undefined) return { kind: "not_found" };
    if (currentVersion !== command.expectedVersion) {
      return { kind: "precondition_failed", currentVersion };
    }
    const finding = this.decideFinding(id, command.input);
    if (!finding) return { kind: "not_found" };
    return {
      kind: "success",
      finding,
      rowVersion: this.findingVersions.get(id) ?? currentVersion + 1,
      replayed: false,
    };
  }

  reprocess(checkId: string): CheckRun | undefined {
    const check = this.checks.get(checkId);
    if (!check) return undefined;
    check.status = "PROCESSING";
    check.progress = 34;
    check.currentStage = "Повторная проверка затронутых параметров";
    check.completedAt = null;
    const object = this.objects.get(check.objectId);
    if (object) object.status = "PROCESSING";
    return check;
  }

  finalize(checkId: string): ProtocolVersion | "PENDING_DECISIONS" | "INCOMPLETE_ANALYSIS" | undefined {
    const check = this.checks.get(checkId);
    if (!check) return undefined;
    const pending = this.getFindings(checkId).some((finding) => finding.status === "CANDIDATE");
    if (pending) return "PENDING_DECISIONS";
    if (check.mode === "NORMAL" && check.stats.unsupported > 0) return "INCOMPLETE_ANALYSIS";
    check.status = "FINALIZED";
    const object = this.objects.get(check.objectId);
    if (object) object.status = "FINALIZED";
    const versions = this.protocols.get(checkId) ?? [];
    const protocol: ProtocolVersion = {
      id: `PRT-${check.id.slice(-8)}-V${versions.length + 1}`,
      checkId,
      version: versions.length + 1,
      status: "FINAL",
      createdAt: now(),
      createdBy: "Инспектор",
      stats: structuredClone(check.stats),
    };
    versions.push(protocol);
    this.protocols.set(checkId, versions);
    this.captureProtocolSnapshot(protocol);
    return protocol;
  }

  getProtocols(checkId: string): ProtocolVersion[] {
    return structuredClone(this.protocols.get(checkId) ?? []);
  }

  getProtocol(id: string): ProtocolVersion | undefined {
    const protocol = [...this.protocols.values()].flat().find((candidate) => candidate.id === id);
    return protocol ? structuredClone(protocol) : undefined;
  }

  getProtocolExport(id: string): ProtocolExport | undefined {
    const exported = this.protocolExports.get(id);
    return exported ? structuredClone(exported) : undefined;
  }

  getSubmission(checkId: string): SubmissionExport | "PENDING_DECISIONS" | "INCOMPLETE_ANALYSIS" | undefined {
    const check = this.checks.get(checkId);
    if (!check) return undefined;
    const findings = this.getFindings(checkId);
    if (findings.some((finding) => finding.status === "CANDIDATE")) return "PENDING_DECISIONS";
    if (check.mode === "NORMAL" && check.stats.unsupported > 0) return "INCOMPLETE_ANALYSIS";

    return {
      object_id: check.objectId,
      checks: findings.map((finding) => {
        const comparable = finding.status === "CONFIRMED_VIOLATION" || finding.status === "NEGATIVE_VERIFIED";
        return {
          parameter_code: finding.parameterCode,
          location: finding.location,
          pd_value: finding.expectedValue,
          rd_value: finding.actualValue,
          id_value: finding.idValue,
          violation_label: comparable
            ? finding.status === "CONFIRMED_VIOLATION"
              ? "VIOLATION_PRESENT"
              : "NO_VIOLATION"
            : "COMPARISON_IMPOSSIBLE",
          protocol_status: comparable
            ? finding.status === "CONFIRMED_VIOLATION"
              ? finding.severity === "INFO" ? "OK" : finding.severity
              : "OK"
            : "COMPARISON_IMPOSSIBLE",
          criticality: finding.criticality,
          evidence: finding.evidence
            .filter(isSubmissionEvidence)
            .map((evidence) => ({
              stage: evidence.stage,
              file_id: evidence.fileId,
              pdf_page_number: evidence.pdfPageNumber,
            })),
        };
      }),
    };
  }

  getParameters(): ParameterCatalogItem[] {
    return this.reference.parameters;
  }

  getCoverage(checkId: string): ParameterCoverageItem[] | undefined {
    const check = this.checks.get(checkId);
    if (!check) return undefined;
    const reason = check.mode === "DEMO_SEED"
      ? "Публичный seed демонстрирует review, но не подтверждает исполнение автоматического правила."
      : "Исполняемое правило для новых документов пока не подключено.";
    return this.reference.parameters.map((parameter) => ({
      parameterId: parameter.parameter_id,
      parameterCode: parameter.parameter_code,
      parameterName: parameter.parameter_name,
      executionStatus: "UNSUPPORTED",
      reason,
    }));
  }

  private recalculate(checkId: string): void {
    const check = this.checks.get(checkId);
    if (!check) return;
    const findings = this.getFindings(checkId);
    const stats: CheckStats = {
      ...blankStats(),
      total: this.reference.parameters.length,
      unsupported: this.reference.parameters.length,
      candidates: findings.filter((item) => item.status === "CANDIDATE").length,
      confirmed: findings.filter((item) => item.status === "CONFIRMED_VIOLATION").length,
      negativeVerified: findings.filter((item) => item.status === "NEGATIVE_VERIFIED").length,
      notComparable: findings.filter((item) => item.status === "NOT_COMPARABLE").length,
      clarification: findings.filter((item) => item.status === "CLARIFICATION_REQUIRED").length,
      suspicion: findings.filter((item) => item.status === "SUSPICION").length,
    };
    check.stats = stats;
    check.status = stats.candidates === 0 ? "READY_TO_FINALIZE" : "REVIEW_REQUIRED";
    const object = this.objects.get(check.objectId);
    if (object) {
      object.stats = stats;
      object.status = check.status;
      object.updatedAt = now();
    }
  }

  private captureProtocolSnapshot(protocol: ProtocolVersion): void {
    this.protocolExports.set(protocol.id, {
      schemaVersion: "1.0",
      protocol: structuredClone(protocol),
      findings: this.getFindings(protocol.checkId).map((finding) => structuredClone(finding)),
    });
  }
}
