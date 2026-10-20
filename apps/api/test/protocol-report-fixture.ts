import type { CandidateReviewEvent, Finding, ProtocolExport } from "@inspector-ai/contracts";
import type { ReviewCandidatesRead } from "../src/repository.js";

/** Synthetic protocol: exercises format contracts, not engineering qualification. */
export function reportFixture(): ProtocolExport {
  const finding: Finding = {
    id: "F-CONFIRMED", checkId: "CHK-EXPORT", groupId: "PZ", parameterId: 1, parameterCode: "PZ-002",
    title: "Тестовая площадь", location: "Синтетический корпус", status: "CONFIRMED_VIOLATION", severity: "CRITICAL",
    criticality: "Тестовая критичность", confidence: null, comparisonResult: "DIFFERENCE", documentStatus: "PD_RD",
    expectedValue: "100 м²", actualValue: "120 м²", idValue: null, rationale: "Сохранённое основание синтетической сверки",
    evidence: [{ stage: "PD", fileId: "FIL-PD", fileName: "Тест ПД.pdf", pdfPageNumber: 2, documentSheetNumber: null,
      imageUrl: null, bbox: [0.1, 0.2, 0.3, 0.4], sha256: "b".repeat(64) }],
    decision: { type: "CONFIRM", reason: "Решение на синтетическом комплекте", author: "Тестовый инспектор", decidedAt: "2026-10-20T10:00:00.000Z" },
  };
  const candidate: ReviewCandidatesRead["candidates"][number] = {
    candidateId: "SOURCE-PENDING", resultType: "REVIEW_CANDIDATE", reason: "EXACT_LABEL_LINE", kind: "ONE_DOCUMENT_SIGNAL",
    parameterCode: "PZ-013", family: "CAPACITY", attribute: "CAPACITY", matchedLabel: "Вместимость", rawValue: "600", rawUnit: "мест",
    sourceFileId: "FIL-PD", sourceSha256: "b".repeat(64), artifactSha256: "c".repeat(64), pageNumber: 3,
    pageWidthMilliPoints: 595000, pageHeightMilliPoints: 842000, stage: "PD", sectionCode: "PZ", revisionStatus: "UNKNOWN",
    approvalStatus: "UNKNOWN", origin: "PDF_TEXT_LAYER", lineText: "Вместимость 600 мест", blockTextSha256: "d".repeat(64),
    locator: { kind: "DOCUMENT_TEXT_BLOCK_LINE", blockIndex: 0, lineIndex: 0, start: 0, end: 20, bboxMilliPoints: [1000, 2000, 3000, 4000] },
    relatedDocuments: [], missingConfirmation: ["Сопоставимость и редакции не подтверждены"], suggestedElement: null, rank: 1,
  };
  const artifact: ReviewCandidatesRead = { schemaVersion: "review-candidates-v1", resultType: "REVIEW_CANDIDATE",
    objectId: "OBJ-EXPORT", inputManifestHash: "a".repeat(64), candidateCount: 2, truncated: false,
    candidates: [candidate, { ...candidate, candidateId: "SOURCE-REJECTED" }], findingCount: null, parameterCoverage: null, contentHash: "e".repeat(64) };
  const event: CandidateReviewEvent = { schemaVersion: "review-candidate-decision-v1", candidateId: "SOURCE-REJECTED", artifactHash: artifact.contentHash,
    decision: "REJECT", note: "Исходные элементы различаются", id: "EVENT-REJECT", checkId: finding.checkId,
    actorId: "USER-EXPORT", decisionHash: "f".repeat(64), createdAt: "2026-10-20T10:01:00.000Z" };
  return {
    schemaVersion: "1.0", protocol: { id: "PR-EXPORT", checkId: "CHK-EXPORT", version: 3, status: "FINAL",
      createdAt: "2026-10-20T10:02:00.000Z", createdBy: "Тестовый инспектор",
      stats: { total: 132, unsupported: 70, candidates: 1, confirmed: 1, negativeVerified: 0, notComparable: 0, clarification: 0, suspicion: 0 } },
    findings: [finding, { ...finding, id: "F-CANDIDATE", status: "CANDIDATE", confidence: 0.8, decision: null, title: "Кандидат ровно 80%" }],
    candidateReview: { artifact: artifact as unknown as Record<string, unknown>, decisions: [event] },
    scope: { organizationId: "ORG-EXPORT", object: { id: "OBJ-EXPORT", name: "Синтетическая школа <600> & тест", address: "Тестовый адрес" },
      inspection: { id: "INS-EXPORT", lifecycle: "FINALIZED", rowVersion: 4 }, run: { id: "RUN-EXPORT", state: "PARTIAL" } },
    sources: [{ fileId: "FIL-PD", fileName: "Тест ПД.pdf", sha256: "b".repeat(64), byteSize: 1000, mediaType: "application/pdf", stages: ["PD"] },
      { fileId: "FIL-RD", fileName: "Тест РД.pdf", sha256: "c".repeat(64), byteSize: 2000, mediaType: "application/pdf", stages: ["RD"] }],
    coverage: { totalParameters: 132, executedParameters: 62, unsupportedParameters: 70, gapsHash: "1".repeat(64),
      gaps: [{ parameterId: 1, parameterCode: "PZ-002", parameterName: "Площадь", executionStatus: "UNSUPPORTED", reason: "MISSING_ID: нет исполнительной документации" }],
      acknowledgement: { gapsHash: "1".repeat(64), reason: "Тестовый выпуск при явно указанной неполноте", actorId: "USER-EXPORT", actorName: "Тестовый инспектор", acknowledgedAt: "2026-10-20T10:02:00.000Z" } },
  };
}
