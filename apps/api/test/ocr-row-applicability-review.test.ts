import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrProfileV5 } from "../src/ocr-layout.js";
import { validateOcrRowTranscriptionReview } from "../src/ocr-row-transcription-review.js";
import { validateOcrRowApplicabilityReview,
  type OcrRowApplicabilityReviewInput,
  type OcrRowApplicabilityVerificationContext } from "../src/ocr-row-applicability-review.js";

const manifestHash = "b".repeat(64);
const targetManifestHash = "d".repeat(64);
const sourceSha = "a".repeat(64);
const renderSha = "c".repeat(64);

// Python json.dumps(sort_keys=True) hashes the rule-stage row packet by code point key order.
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${workerJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture() {
  const lines = [
    { text: "Наименование", bboxPx: [250, 100, 430, 130], score: 0.98 },
    { text: "Значение", bboxPx: [600, 100, 730, 130], score: 0.97 },
    { text: "Общая площадь здания", bboxPx: [250, 150, 510, 178], score: 0.96 },
    { text: "84,9 м²", bboxPx: [620, 151, 700, 178], score: 0.95 },
  ];
  const page: Record<string, unknown> = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-1",
    inputSha256: sourceSha, pageNumber: 9,
    render: { sha256: renderSha, widthPx: 1000, heightPx: 1400,
      dpi: 120, rendererProfileId: boundedOcrProfileV5.rendererProfileId },
    provider: { profileId: boundedOcrProfileV5.ocrProviderProfileIds[0], script: "eslav" },
    lines,
  };
  page.contentHash = sha256(canonicalJson(page));
  const content = {
    schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: manifestHash, disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: boundedOcrProfileIdV5, providerConfigHash: boundedOcrConfigHashV5,
    outputCount: 1,
    analysis: { schemaVersion: "bounded-ocr-layout-analysis-v5", objectId: "OBJ-1",
      inputManifestHash: manifestHash, profile: boundedOcrProfileV5,
      sourceCount: 1, processedPageCount: 1,
      sources: [{ sourceFileId: "FIL-1", sourceSha256: sourceSha,
        processedPageCount: 1, pages: [page] }] },
  };
  const canonical = canonicalJson(content);
  const stage = { content_json: content, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical), provider_profile_id: boundedOcrProfileIdV5,
    provider_config_hash: boundedOcrConfigHashV5, input_manifest_hash: manifestHash };
  const evidence = (index: number, role: string) => ({ role, lineIndex: index,
    text: lines[index].text, bboxPx: lines[index].bboxPx, score: lines[index].score });
  const row = { sourceFileId: "FIL-1", inputSha256: sourceSha, pageNumber: 9,
    ocrPageContentHash: page.contentHash, renderSha256: renderSha,
    headerEvidence: [evidence(0, "labelHeader"), evidence(1, "valueHeader")],
    labelEvidence: evidence(2, "rowLabel"), valueEvidence: evidence(3, "rawValue") };
  const tableRowsResult: Record<string, unknown> = {
    schemaVersion: "ocr-table-row-proposals-v1", profileId: "conservative-ocr-table-rows-v1",
    ocrStageSha256: stage.content_hash, inputManifestHash: manifestHash,
    proposals: [row], abstentions: [], findingCount: 0,
  };
  tableRowsResult.contentHash = sha256(workerJson(tableRowsResult));
  const review = {
    schemaVersion: "ocr-row-transcription-review-v1" as const,
    ocrStageSha256: stage.content_hash, rowFingerprint: sha256(canonicalJson(row)),
    decision: "CONFIRMED_TRANSCRIPTION" as const,
    reviewedLabel: "Общая площадь здания", reviewedValue: "84,9", reviewedUnit: "м²",
    basis: "Синтетический тест: текст и единица визуально сверены.",
  };
  const validated = validateOcrRowTranscriptionReview(review, tableRowsResult,
    stage, manifestHash);
  if (!validated) throw new Error("Invalid synthetic OCR fixture");
  const sourceReview = {
    id: "SR-1", objectId: "OBJ-1", sourceFileId: "FIL-1",
    actorId: "ACTOR-1", createdAt: "2026-01-01T00:00:00.000Z",
    sourceSha256: sourceSha, revisionStatus: "CURRENT" as const,
    approvalStatus: "APPROVED" as const, linkGroupId: "building-1",
    sectionCode: "AR" as const, pageStages: {},
    basis: { reference: "Синтетический тест подтверждения источника." },
    contentHash: "",
  };
  sourceReview.contentHash = sha256(canonicalJson({
    objectApiId: "OBJ-1", sourceFileApiId: "FIL-1",
    sourceSha256: sourceSha, revisionStatus: sourceReview.revisionStatus,
    approvalStatus: sourceReview.approvalStatus, linkGroupId: sourceReview.linkGroupId,
    sectionCode: sourceReview.sectionCode, pageStages: sourceReview.pageStages,
    basis: sourceReview.basis, actorId: sourceReview.actorId,
  }));
  const transcriptionHash = sha256(canonicalJson({
    checkId: "CHK-ORIGIN", objectId: "OBJ-1", ...validated, actorId: "ACTOR-2",
  }));
  const context: OcrRowApplicabilityVerificationContext = {
    targetCheckId: "CHK-TARGET", objectId: "OBJ-1",
    inputManifestHash: targetManifestHash, originInputManifestHash: manifestHash,
    source: { sourceFileId: "FIL-1", sourceSha256: sourceSha,
      stages: ["RD"], sourceReviewHash: sourceReview.contentHash },
    transcriptionSnapshot: { targetCheckId: "CHK-TARGET", decisionId: "TR-1",
      decisionContentHash: transcriptionHash, originCheckId: "CHK-ORIGIN",
      actorId: "ACTOR-2", sourceFileId: "FIL-1", sourceSha256: sourceSha,
      rowFingerprint: review.rowFingerprint, ...validated },
    sourceReviewSnapshot: { targetCheckId: "CHK-TARGET", decisionId: "SR-1",
      decisionHash: sourceReview.contentHash, decision: sourceReview },
    tableRowsResult, ocrStage: stage,
  };
  const input: OcrRowApplicabilityReviewInput = {
    schemaVersion: "ocr-row-applicability-review-v1", decision: "APPLICABLE",
    targetCheckId: "CHK-TARGET", sourceFileId: "FIL-1", sourceSha256: sourceSha,
    pageNumber: 9, renderSha256: renderSha, ocrStageSha256: stage.content_hash,
    rowFingerprint: review.rowFingerprint, transcriptionDecisionId: "TR-1",
    transcriptionDecisionHash: transcriptionHash, sourceReviewDecisionId: "SR-1",
    sourceReviewDecisionHash: sourceReview.contentHash,
    parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA", stage: "RD",
    entityKey: "building-1", context: "Здание целиком; синтетический тест.",
    basis: "Синтетический пример предметной применимости, без реального согласования.",
  };
  return { context, input };
}

function refreshSourceReview(input: OcrRowApplicabilityReviewInput,
  context: OcrRowApplicabilityVerificationContext): void {
  const decision = context.sourceReviewSnapshot.decision;
  const sourceInput = {
    sourceSha256: decision.sourceSha256, revisionStatus: decision.revisionStatus,
    approvalStatus: decision.approvalStatus, linkGroupId: decision.linkGroupId,
    ...(decision.sectionCode ? { sectionCode: decision.sectionCode } : {}),
    pageStages: decision.pageStages, basis: decision.basis,
  };
  const hash = sha256(canonicalJson({ objectApiId: context.objectId,
    sourceFileApiId: context.source.sourceFileId, ...sourceInput,
    actorId: decision.actorId }));
  decision.contentHash = hash;
  context.sourceReviewSnapshot.decisionHash = hash;
  context.source.sourceReviewHash = hash;
  input.sourceReviewDecisionHash = hash;
}

function refreshTranscription(input: OcrRowApplicabilityReviewInput,
  context: OcrRowApplicabilityVerificationContext): void {
  const snapshot = context.transcriptionSnapshot;
  const validated = validateOcrRowTranscriptionReview(snapshot.review,
    context.tableRowsResult, context.ocrStage, context.originInputManifestHash);
  if (!validated) throw new Error("Invalid synthetic transcription fixture");
  snapshot.provenance = validated.provenance;
  const hash = sha256(canonicalJson({ checkId: snapshot.originCheckId,
    objectId: context.objectId, ...validated, actorId: snapshot.actorId }));
  snapshot.decisionContentHash = hash;
  input.transcriptionDecisionHash = hash;
}

describe("OCR row applicability review validator", () => {
  it("accepts a synthetic positive only with independently verified run snapshots", () => {
    const { input, context } = fixture();
    const result = validateOcrRowApplicabilityReview(input, context);
    expect(result?.eligibleForFactReview).toBe(true);
    expect(result?.provenance).toMatchObject({ targetCheckId: "CHK-TARGET",
      inputManifestHash: targetManifestHash, originInputManifestHash: manifestHash,
      sourceSha256: sourceSha, pageNumber: 9, renderSha256: renderSha,
      transcriptionDecisionHash: input.transcriptionDecisionHash,
      sourceReviewDecisionHash: input.sourceReviewDecisionHash, sectionCode: "AR" });
    expect(result).not.toHaveProperty("typedFact");
    expect(result).not.toHaveProperty("finding");
  });

  it("binds OCR to origin manifest even when target manifest has a later source review", () => {
    const { input, context } = fixture();
    expect(context.inputManifestHash).not.toBe(context.originInputManifestHash);
    expect(validateOcrRowApplicabilityReview(input, context)).not.toBeNull();
    context.originInputManifestHash = context.inputManifestHash;
    expect(validateOcrRowApplicabilityReview(input, context)).toBeNull();
  });

  it("rejects changed decision hashes, fingerprints, source, run, page and render", () => {
    const { input, context } = fixture();
    const tampered = [
      { ...input, transcriptionDecisionHash: "d".repeat(64) },
      { ...input, sourceReviewDecisionHash: "d".repeat(64) },
      { ...input, rowFingerprint: "d".repeat(64) },
      { ...input, targetCheckId: "CHK-OTHER" },
      { ...input, sourceFileId: "FIL-OTHER" },
      { ...input, sourceSha256: "d".repeat(64) },
      { ...input, pageNumber: 10 },
      { ...input, renderSha256: "d".repeat(64) },
      { ...input, ocrStageSha256: "d".repeat(64) },
    ];
    for (const changed of tampered) {
      expect(validateOcrRowApplicabilityReview(changed, context)).toBeNull();
    }
    context.transcriptionSnapshot.targetCheckId = "CHK-OTHER";
    expect(validateOcrRowApplicabilityReview(input, context)).toBeNull();
  });

  it("rejects forged snapshot bytes even if their declared hashes stay unchanged", () => {
    const { input, context } = fixture();
    context.transcriptionSnapshot.review.reviewedValue = "999";
    expect(validateOcrRowApplicabilityReview(input, context)).toBeNull();
    const second = fixture();
    second.context.sourceReviewSnapshot.decision.basis.reference = "Подмена текста";
    expect(validateOcrRowApplicabilityReview(second.input, second.context)).toBeNull();
    const third = fixture();
    third.context.sourceReviewSnapshot.decisionHash = "d".repeat(64);
    third.input.sourceReviewDecisionHash = "d".repeat(64);
    expect(validateOcrRowApplicabilityReview(third.input, third.context)).toBeNull();
  });

  it("rejects wrong section, stage, attribute, missing approval and rejected transcription", () => {
    const { input, context } = fixture();
    expect(validateOcrRowApplicabilityReview({ ...input, attribute: "BUILDING_HEIGHT" },
      context)).toBeNull();
    expect(validateOcrRowApplicabilityReview({ ...input, stage: "PD" }, context)).toBeNull();
    const wrongSection = fixture();
    wrongSection.context.sourceReviewSnapshot.decision.sectionCode = "PZ";
    refreshSourceReview(wrongSection.input, wrongSection.context);
    expect(validateOcrRowApplicabilityReview(wrongSection.input,
      wrongSection.context)).toBeNull();
    const noApproval = fixture();
    noApproval.context.sourceReviewSnapshot.decision.approvalStatus = "UNKNOWN";
    refreshSourceReview(noApproval.input, noApproval.context);
    expect(validateOcrRowApplicabilityReview(noApproval.input,
      noApproval.context)).toBeNull();
    const rejected = fixture();
    rejected.context.transcriptionSnapshot.review.decision = "REJECTED";
    rejected.context.transcriptionSnapshot.review.reviewedLabel = null;
    rejected.context.transcriptionSnapshot.review.reviewedValue = null;
    rejected.context.transcriptionSnapshot.review.reviewedUnit = null;
    refreshTranscription(rejected.input, rejected.context);
    expect(validateOcrRowApplicabilityReview(rejected.input,
      rejected.context)).toBeNull();
    const mixed = fixture();
    mixed.context.source.stages = ["PD", "RD"];
    mixed.context.sourceReviewSnapshot.decision.pageStages = { "9": "PD" };
    refreshSourceReview(mixed.input, mixed.context);
    expect(validateOcrRowApplicabilityReview(mixed.input, mixed.context)).toBeNull();
  });

  it("requires explicit matching page-stage review for mixed PD/RD source", () => {
    const { input, context } = fixture();
    context.source.stages = ["PD", "RD"];
    context.sourceReviewSnapshot.decision.pageStages = { "9": "RD" };
    refreshSourceReview(input, context);
    expect(validateOcrRowApplicabilityReview(input, context)?.eligibleForFactReview)
      .toBe(true);
    context.sourceReviewSnapshot.decision.pageStages = { "9": "UNRESOLVED" };
    refreshSourceReview(input, context);
    expect(validateOcrRowApplicabilityReview(input, context)).toBeNull();
  });

  it("records negative or unsure decisions without fact eligibility", () => {
    const { input, context } = fixture();
    for (const decision of ["NOT_APPLICABLE", "UNSURE"] as const) {
      const result = validateOcrRowApplicabilityReview({ ...input, decision }, context);
      expect(result?.eligibleForFactReview).toBe(false);
      expect(result?.review.decision).toBe(decision);
    }
  });

  it("rejects an unknown candidate code or attribute even for negative decisions", () => {
    const { input, context } = fixture();
    for (const decision of ["NOT_APPLICABLE", "UNSURE"] as const) {
      expect(validateOcrRowApplicabilityReview({ ...input, decision,
        parameterCode: "UNKNOWN-999" }, context)).toBeNull();
      expect(validateOcrRowApplicabilityReview({ ...input, decision,
        attribute: "UNKNOWN_ATTRIBUTE" }, context)).toBeNull();
    }
  });

  it("uses legacy source-review hash shape when section is null", () => {
    const { input, context } = fixture();
    context.sourceReviewSnapshot.decision.sectionCode = null;
    refreshSourceReview(input, context);
    expect(validateOcrRowApplicabilityReview(input, context)).toBeNull();
    const negative = validateOcrRowApplicabilityReview({
      ...input, decision: "NOT_APPLICABLE",
    }, context);
    expect(negative?.eligibleForFactReview).toBe(false);
    expect(negative?.provenance.sectionCode).toBeNull();
  });

  it("rejects extra authority fields, unbounded or unsafe text", () => {
    const { input, context } = fixture();
    for (const changed of [
      { ...input, approvedFact: true },
      { ...input, basis: "" },
      { ...input, basis: "x".repeat(1001) },
      { ...input, entityKey: "building-1\nother" },
      { ...input, context: " context " },
      { ...input, decision: "CONFIRMED" },
    ]) expect(validateOcrRowApplicabilityReview(changed, context)).toBeNull();
  });
});
