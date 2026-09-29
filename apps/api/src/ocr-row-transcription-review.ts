import { canonicalJson, sha256 } from "./canonical-json.js";
import { type OcrHeatStageEnvelope } from "./ocr-heat-row-proposals.js";
import { verifyOcrTableRows } from "./ocr-table-rows.js";

type Json = Record<string, unknown>;

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

export interface ValidatedOcrRowTranscriptionReview {
  review: OcrRowTranscriptionReviewInput;
  provenance: {
    ocrStageSha256: string;
    tableRowsContentHash: string;
    rowFingerprint: string;
    inputManifestHash: string;
    sourceFileId: string;
    sourceSha256: string;
    pageNumber: number;
    ocrPageContentHash: string;
    renderSha256: string;
    headerEvidence: unknown[];
    labelEvidence: unknown;
    labelContinuationEvidence?: unknown[];
    valueEvidence: unknown;
  };
}

const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const exact = (value: Json, fields: readonly string[]): boolean =>
  Object.keys(value).length === fields.length
  && fields.every((field) => Object.hasOwn(value, field));

// Review is a transcription judgment only. Keep text single-line and bounded; do not infer a code or fact.
function textField(value: unknown, maxBytes: number, required: boolean): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maxBytes
    && value === value.trim() && (!required || value.length > 0)
    && !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** Bind one human OCR transcription judgment to an independently re-derived saved row. */
export function validateOcrRowTranscriptionReview(
  input: unknown,
  tableRowsResult: unknown,
  persistedOcrStage: OcrHeatStageEnvelope,
  expectedManifestHash: string,
): ValidatedOcrRowTranscriptionReview | null {
  try {
    if (!record(input) || !exact(input, ["schemaVersion", "ocrStageSha256",
      "rowFingerprint", "decision", "reviewedLabel", "reviewedValue", "reviewedUnit", "basis"])
      || input.schemaVersion !== "ocr-row-transcription-review-v1"
      || !hash(input.ocrStageSha256) || !hash(input.rowFingerprint)
      || !hash(expectedManifestHash)
      || !textField(input.basis, 1000, true)
      || !["CONFIRMED_TRANSCRIPTION", "REJECTED"].includes(input.decision as string)
      || !record(tableRowsResult) || !record(persistedOcrStage)
      || persistedOcrStage.content_hash !== input.ocrStageSha256
      || tableRowsResult.ocrStageSha256 !== input.ocrStageSha256
      || !verifyOcrTableRows(tableRowsResult, persistedOcrStage, expectedManifestHash)
      || !Array.isArray(tableRowsResult.proposals)) return null;

    if (input.decision === "CONFIRMED_TRANSCRIPTION") {
      if (!textField(input.reviewedLabel, 512, true)
        || !textField(input.reviewedValue, 512, true)
        || !(input.reviewedUnit === null || textField(input.reviewedUnit, 64, true))) return null;
    } else if (input.reviewedLabel !== null || input.reviewedValue !== null
      || input.reviewedUnit !== null) return null;

    // A duplicate fingerprint is ambiguous even if both rows independently verify.
    const matches = tableRowsResult.proposals.filter((row) =>
      sha256(canonicalJson(row)) === input.rowFingerprint);
    if (matches.length !== 1 || !record(matches[0])) return null;
    const row = matches[0];
    if (typeof row.sourceFileId !== "string" || !hash(row.inputSha256)
      || !Number.isSafeInteger(row.pageNumber) || !hash(row.ocrPageContentHash)
      || !hash(row.renderSha256) || !Array.isArray(row.headerEvidence)
      || !record(row.labelEvidence) || !record(row.valueEvidence)
      || (Object.hasOwn(row, "labelContinuationEvidence")
        && (!Array.isArray(row.labelContinuationEvidence)
          || row.labelContinuationEvidence.length > 1))
      || !hash(tableRowsResult.contentHash)) return null;

    const review: OcrRowTranscriptionReviewInput = {
      schemaVersion: "ocr-row-transcription-review-v1",
      ocrStageSha256: input.ocrStageSha256,
      rowFingerprint: input.rowFingerprint,
      decision: input.decision as OcrRowTranscriptionReviewInput["decision"],
      reviewedLabel: input.reviewedLabel as string | null,
      reviewedValue: input.reviewedValue as string | null,
      reviewedUnit: input.reviewedUnit as string | null,
      basis: input.basis,
    };
    return {
      review,
      provenance: {
        ocrStageSha256: input.ocrStageSha256,
        tableRowsContentHash: tableRowsResult.contentHash,
        rowFingerprint: input.rowFingerprint,
        inputManifestHash: expectedManifestHash,
        sourceFileId: row.sourceFileId,
        sourceSha256: row.inputSha256,
        pageNumber: row.pageNumber as number,
        ocrPageContentHash: row.ocrPageContentHash,
        renderSha256: row.renderSha256,
        headerEvidence: structuredClone(row.headerEvidence),
        labelEvidence: structuredClone(row.labelEvidence),
        ...(Object.hasOwn(row, "labelContinuationEvidence")
          ? { labelContinuationEvidence: structuredClone(row.labelContinuationEvidence as unknown[]) } : {}),
        valueEvidence: structuredClone(row.valueEvidence),
      },
    };
  } catch {
    return null;
  }
}
