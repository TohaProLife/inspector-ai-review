import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrProfileV5 } from "../src/ocr-layout.js";
import { validateOcrRowTranscriptionReview } from "../src/ocr-row-transcription-review.js";
import { validateOcrRowApplicabilityReview,
  type OcrRowApplicabilityReviewInput,
  type OcrRowApplicabilityVerificationContext } from "../src/ocr-row-applicability-review.js";
import { buildOcrTypedFactV2, validateOcrTypedFactV2 } from "../src/ocr-typed-fact-v2.js";

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


function verifiedFixture() {
  const { context, input } = fixture();
  const validated = validateOcrRowApplicabilityReview(input, context);
  if (!validated) throw new Error("Invalid synthetic applicability fixture");
  const originApplicability = structuredClone(context);
  originApplicability.targetCheckId = "CHK-ORIGIN";
  originApplicability.inputManifestHash = manifestHash;
  originApplicability.transcriptionSnapshot.targetCheckId = "CHK-ORIGIN";
  originApplicability.sourceReviewSnapshot.targetCheckId = "CHK-ORIGIN";
  const originReview = { ...input, targetCheckId: "CHK-ORIGIN" };
  const originValidated = validateOcrRowApplicabilityReview(
    originReview, originApplicability);
  if (!originValidated) throw new Error("Invalid synthetic origin applicability");
  const actorId = "ACTOR-3";
  const decisionContentHash = sha256(canonicalJson({
    checkId: originApplicability.targetCheckId, objectId: context.objectId,
    ...originValidated, actorId,
  }));
  return {
    originApplicability,
    applicability: context,
    applicabilitySnapshot: {
      targetCheckId: context.targetCheckId, decisionId: "APP-1",
      decisionContentHash, originReview, actorId, ...validated,
    },
    latestApplicabilityDecisionId: "APP-1",
  };
}

function refreshReviewedUnit(context: ReturnType<typeof verifiedFixture>, unit: string) {
  const transcription = context.applicability.transcriptionSnapshot;
  transcription.review.reviewedUnit = unit;
  const verified = validateOcrRowTranscriptionReview(transcription.review,
    context.applicability.tableRowsResult, context.applicability.ocrStage,
    context.applicability.originInputManifestHash);
  if (!verified) throw new Error("Invalid synthetic reviewed unit");
  transcription.provenance = verified.provenance;
  transcription.decisionContentHash = sha256(canonicalJson({
    checkId: transcription.originCheckId, objectId: context.applicability.objectId,
    ...verified, actorId: transcription.actorId,
  }));
  context.originApplicability.transcriptionSnapshot.review.reviewedUnit = unit;
  context.originApplicability.transcriptionSnapshot.provenance = verified.provenance;
  context.originApplicability.transcriptionSnapshot.decisionContentHash =
    transcription.decisionContentHash;
  context.applicabilitySnapshot.originReview.transcriptionDecisionHash =
    transcription.decisionContentHash;
  context.applicabilitySnapshot.review.transcriptionDecisionHash = transcription.decisionContentHash;
  const applicability = validateOcrRowApplicabilityReview(context.applicabilitySnapshot.review,
    context.applicability);
  if (!applicability) throw new Error("Invalid synthetic applicability after unit review");
  context.applicabilitySnapshot.provenance = applicability.provenance;
  context.applicabilitySnapshot.decisionContentHash = sha256(canonicalJson({
    checkId: context.originApplicability.targetCheckId,
    objectId: context.originApplicability.objectId,
    ...validateOcrRowApplicabilityReview(context.applicabilitySnapshot.originReview,
      context.originApplicability), actorId: context.applicabilitySnapshot.actorId,
  }));
}

describe("OCR_ROW typed-fact-v2 independent validator", () => {
  it("derives only a review-only numeric candidate from three verified snapshots", () => {
    const context = verifiedFixture();
    const fact = buildOcrTypedFactV2(context);
    expect(fact).toMatchObject({ schemaVersion: "typed-fact-v2",
      sourceSha256: sourceSha, stage: "RD", pageNumber: 9,
      parameterCode: "PZ-002", rawValue: "84,9", rawUnit: "м²",
      locator: { kind: "OCR_ROW", renderSha256: renderSha,
        applicabilityDecisionHash: context.applicabilitySnapshot.decisionContentHash } });
    expect(fact?.inputManifestHash).toBe(targetManifestHash);
    expect(fact?.locator.originInputManifestHash).toBe(manifestHash);
    expect(fact).not.toHaveProperty("finding");
    expect(fact).not.toHaveProperty("comparison");
    expect(validateOcrTypedFactV2(fact, context)).toBe(true);
  });

  it("rejects altered locator, value, hash and any extra authority field", () => {
    const context = verifiedFixture();
    const fact = buildOcrTypedFactV2(context)!;
    for (const changed of [
      { ...fact, rawValue: "999" },
      { ...fact, factId: "a".repeat(64) },
      { ...fact, finding: true },
      { ...fact, locator: { ...fact.locator, kind: "TEXT_BLOCK" } },
      { ...fact, locator: { ...fact.locator, renderSha256: "a".repeat(64) } },
      { ...fact, locator: { ...fact.locator, rowFingerprint: "a".repeat(64) } },
      { ...fact, locator: { ...fact.locator, originCheckId: "CHK-OTHER" } },
    ]) expect(validateOcrTypedFactV2(changed, context)).toBe(false);
  });

  it("rejects missing/stale/negative applicability and snapshot content tampering", () => {
    const original = verifiedFixture();
    const wrongLatest = structuredClone(original);
    wrongLatest.latestApplicabilityDecisionId = "APP-2";
    expect(buildOcrTypedFactV2(wrongLatest)).toBeNull();
    const wrongHash = structuredClone(original);
    wrongHash.applicabilitySnapshot.decisionContentHash = "a".repeat(64);
    expect(buildOcrTypedFactV2(wrongHash)).toBeNull();
    const negative = structuredClone(original);
    negative.applicabilitySnapshot.review.decision = "UNSURE";
    expect(buildOcrTypedFactV2(negative)).toBeNull();
    const forged = structuredClone(original);
    forged.applicabilitySnapshot.provenance.pageNumber = 10;
    expect(buildOcrTypedFactV2(forged)).toBeNull();
    const forgedOrigin = structuredClone(original);
    forgedOrigin.originApplicability.sourceReviewSnapshot.decision.basis.reference = "подмена";
    expect(buildOcrTypedFactV2(forgedOrigin)).toBeNull();
    const noSnapshot = structuredClone(original);
    // Runtime callers can have no expert decision at all.
    (noSnapshot as unknown as { applicabilitySnapshot: unknown }).applicabilitySnapshot = null;
    expect(buildOcrTypedFactV2(noSnapshot)).toBeNull();
  });

  it("rejects source/PDF/render/row hash changes and unconfirmed transcription", () => {
    for (const change of ["source", "render", "row", "transcription"] as const) {
      const context = verifiedFixture();
      if (change === "source") context.applicability.source.sourceSha256 = "d".repeat(64);
      if (change === "render") context.applicability.transcriptionSnapshot.provenance.renderSha256 = "a".repeat(64);
      if (change === "row") context.applicabilitySnapshot.review.rowFingerprint = "a".repeat(64);
      if (change === "transcription") context.applicability.transcriptionSnapshot.review.decision = "REJECTED";
      expect(buildOcrTypedFactV2(context)).toBeNull();
    }
  });

  it("keeps unknown units and nonnumeric values out of numeric typed facts", () => {
    const context = verifiedFixture();
    context.applicability.transcriptionSnapshot.review.reviewedValue = "больше 100";
    expect(buildOcrTypedFactV2(context)).toBeNull();
    const wrongUnit = verifiedFixture();
    refreshReviewedUnit(wrongUnit, "м³");
    expect(buildOcrTypedFactV2(wrongUnit)).toBeNull();
  });
});
