import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrProfileV5 } from "../src/ocr-layout.js";
import { validateOcrRowTranscriptionReview } from "../src/ocr-row-transcription-review.js";

const manifestHash = "b".repeat(64);

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
    { text: "Площадь помещения", bboxPx: [250, 150, 510, 178], score: 0.96 },
    { text: "84,9 м²", bboxPx: [620, 151, 700, 178], score: 0.95 },
  ];
  const page: Record<string, unknown> = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-1",
    inputSha256: "a".repeat(64), pageNumber: 9,
    render: { sha256: "c".repeat(64), widthPx: 1000, heightPx: 1400,
      dpi: 120, rendererProfileId: boundedOcrProfileV5.rendererProfileId },
    provider: { profileId: boundedOcrProfileV5.ocrProviderProfileIds[0], script: "eslav" },
    lines,
  };
  page.contentHash = sha256(canonicalJson(page));
  const content: Record<string, unknown> = {
    schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: manifestHash, disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: boundedOcrProfileIdV5, providerConfigHash: boundedOcrConfigHashV5,
    outputCount: 1,
    analysis: { schemaVersion: "bounded-ocr-layout-analysis-v5", objectId: "OBJ-1",
      inputManifestHash: manifestHash, profile: boundedOcrProfileV5,
      sourceCount: 1, processedPageCount: 1,
      sources: [{ sourceFileId: "FIL-1", sourceSha256: "a".repeat(64),
        processedPageCount: 1, pages: [page] }] },
  };
  const canonical = canonicalJson(content);
  const stage = { content_json: content, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical), provider_profile_id: boundedOcrProfileIdV5,
    provider_config_hash: boundedOcrConfigHashV5, input_manifest_hash: manifestHash };
  const evidence = (index: number, role: string) => ({ role, lineIndex: index,
    text: lines[index].text, bboxPx: lines[index].bboxPx, score: lines[index].score });
  const row = { sourceFileId: "FIL-1", inputSha256: "a".repeat(64), pageNumber: 9,
    ocrPageContentHash: page.contentHash, renderSha256: "c".repeat(64),
    headerEvidence: [evidence(0, "labelHeader"), evidence(1, "valueHeader")],
    labelEvidence: evidence(2, "rowLabel"), valueEvidence: evidence(3, "rawValue") };
  const result: Record<string, any> = {
    schemaVersion: "ocr-table-row-proposals-v1", profileId: "conservative-ocr-table-rows-v1",
    ocrStageSha256: stage.content_hash, inputManifestHash: manifestHash,
    proposals: [row], abstentions: [], findingCount: 0,
  };
  result.contentHash = sha256(workerJson(result));
  const input = {
    schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: stage.content_hash,
    rowFingerprint: sha256(canonicalJson(row)), decision: "CONFIRMED_TRANSCRIPTION",
    reviewedLabel: "Площадь помещения", reviewedValue: "84,9", reviewedUnit: "м²",
    basis: "Визуально сверено с исходной страницей PDF и единицей измерения.",
  };
  return { stage, result, input, row, page };
}

describe("OCR row transcription review validator", () => {
  it("binds transcription to exact saved stage, row and line evidence", () => {
    const f = fixture();
    const checked = validateOcrRowTranscriptionReview(f.input, f.result, f.stage, manifestHash);
    expect(checked).toEqual({ review: f.input, provenance: {
      ocrStageSha256: f.stage.content_hash, tableRowsContentHash: f.result.contentHash,
      rowFingerprint: f.input.rowFingerprint, inputManifestHash: manifestHash,
      sourceFileId: "FIL-1", sourceSha256: "a".repeat(64), pageNumber: 9,
      ocrPageContentHash: f.page.contentHash, renderSha256: "c".repeat(64),
      headerEvidence: f.row.headerEvidence, labelEvidence: f.row.labelEvidence,
      valueEvidence: f.row.valueEvidence,
    } });
    expect(checked).not.toHaveProperty("parameterCode");
    expect(checked).not.toHaveProperty("typedFact");
  });

  it("accepts rejection only with empty transcription fields", () => {
    const f = fixture();
    const rejected = { ...f.input, decision: "REJECTED", reviewedLabel: null,
      reviewedValue: null, reviewedUnit: null };
    expect(validateOcrRowTranscriptionReview(rejected, f.result, f.stage, manifestHash)
      ?.review.decision).toBe("REJECTED");
    expect(validateOcrRowTranscriptionReview({ ...rejected, reviewedValue: "84,9" },
      f.result, f.stage, manifestHash)).toBeNull();
  });

  it("rejects stale stage, wrong fingerprint, duplicate row and forged evidence", () => {
    const f = fixture();
    expect(validateOcrRowTranscriptionReview({ ...f.input, ocrStageSha256: "d".repeat(64) },
      f.result, f.stage, manifestHash)).toBeNull();
    expect(validateOcrRowTranscriptionReview({ ...f.input, rowFingerprint: "d".repeat(64) },
      f.result, f.stage, manifestHash)).toBeNull();
    const duplicate = structuredClone(f.result);
    duplicate.proposals.push(structuredClone(f.row));
    const { contentHash: _duplicateHash, ...duplicateUnhashed } = duplicate;
    duplicate.contentHash = sha256(workerJson(duplicateUnhashed));
    expect(validateOcrRowTranscriptionReview(f.input, duplicate, f.stage, manifestHash)).toBeNull();
    const forged = structuredClone(f.result);
    forged.proposals[0].valueEvidence.text = "999";
    const { contentHash: _ignored, ...unhashed } = forged;
    forged.contentHash = sha256(workerJson(unhashed));
    expect(validateOcrRowTranscriptionReview(f.input, forged, f.stage, manifestHash)).toBeNull();
    f.stage.content_hash = "e".repeat(64);
    expect(validateOcrRowTranscriptionReview(f.input, f.result, f.stage, manifestHash)).toBeNull();
  });

  it("rejects a different manifest or a changed OCR page even with rewritten stage hashes", () => {
    const f = fixture();
    expect(validateOcrRowTranscriptionReview(f.input, f.result, f.stage,
      "d".repeat(64))).toBeNull();
    const changed = fixture();
    (changed.page as Record<string, any>).lines[3].text = "999 м²";
    const { contentHash: _pageHash, ...pageUnhashed } = changed.page;
    changed.page.contentHash = sha256(canonicalJson(pageUnhashed));
    const canonical = canonicalJson(changed.stage.content_json);
    changed.stage.content_hash = sha256(canonical);
    changed.stage.byte_size = Buffer.byteLength(canonical);
    changed.result.ocrStageSha256 = changed.stage.content_hash;
    const { contentHash: _resultHash, ...resultUnhashed } = changed.result;
    changed.result.contentHash = sha256(workerJson(resultUnhashed));
    const input = { ...changed.input, ocrStageSha256: changed.stage.content_hash };
    expect(validateOcrRowTranscriptionReview(input, changed.result, changed.stage,
      manifestHash)).toBeNull();
  });

  it("rejects extra authority fields, blank or unsafe text and overlong values", () => {
    const f = fixture();
    for (const input of [
      { ...f.input, parameterCode: "PZ-004" },
      { ...f.input, approvedSource: true },
      { ...f.input, reviewedLabel: " " },
      { ...f.input, reviewedValue: "84,9\n999" },
      { ...f.input, reviewedUnit: " " },
      { ...f.input, basis: "" },
      { ...f.input, basis: "x".repeat(1001) },
      { ...f.input, reviewedLabel: "я".repeat(257) },
      { ...f.input, decision: "APPROVED" },
    ]) expect(validateOcrRowTranscriptionReview(input, f.result, f.stage,
      manifestHash)).toBeNull();
  });
});

const realStagePath = fileURLToPath(new URL("../../../output/public-index-20260927/f0202-v5-ocr-stage-20260928.json", import.meta.url));
const realRowsPath = fileURLToPath(new URL("../../../output/public-index-20260927/f0202-v5-ocr-table-review-20260928.json", import.meta.url));
const pythonPath = fileURLToPath(new URL("../../../services/worker/.venv/bin/python", import.meta.url));

it.skipIf(!existsSync(realStagePath) || !existsSync(realRowsPath))(
  "binds one original public F0202 OCR row without creating a human decision", () => {
    const content = JSON.parse(readFileSync(realStagePath, "utf8"));
    const packet = JSON.parse(readFileSync(realRowsPath, "utf8"));
    const canonical = canonicalJson(content);
    const stage = { content_json: content, content_hash: sha256(canonical),
      byte_size: Buffer.byteLength(canonical), provider_profile_id: content.providerProfileId,
      provider_config_hash: content.providerConfigHash,
      input_manifest_hash: content.inputManifestHash };
    const result = packet.tableRows;
    const row = result.proposals.find((proposal: { pageNumber: number }) => proposal.pageNumber === 9);
    expect(row).toBeDefined();
    const input = { schemaVersion: "ocr-row-transcription-review-v1",
      ocrStageSha256: stage.content_hash, rowFingerprint: sha256(canonicalJson(row)),
      decision: "REJECTED", reviewedLabel: null, reviewedValue: null,
      reviewedUnit: null, basis: "Test fixture only; no human review or approval was performed." };
    const checked = validateOcrRowTranscriptionReview(input, result, stage,
      content.inputManifestHash);
    expect(checked?.provenance.sourceSha256)
      .toBe("632379a0e541f0c81e6b03e5528946730b4433939c796db4fdc1e5c3fc8b71ee");
    expect(checked?.provenance.pageNumber).toBe(9);
    expect(checked?.provenance.rowFingerprint).toBe(input.rowFingerprint);
  });

it.skipIf(!existsSync(realStagePath) || !existsSync(pythonPath))(
  "keeps every continuation OCR locator from public F0202 v3 without human approval", () => {
    const content = JSON.parse(readFileSync(realStagePath, "utf8"));
    const canonical = canonicalJson(content);
    const stage = { content_json: content, content_hash: sha256(canonical),
      byte_size: Buffer.byteLength(canonical), provider_profile_id: content.providerProfileId,
      provider_config_hash: content.providerConfigHash,
      input_manifest_hash: content.inputManifestHash };
    expect(stage.content_hash)
      .toBe("abc417e23740320ba4004dc05ec84d951b3715abde02a91c563c7954dffb327a");
    const code = [
      "import json,sys",
      "from inspector_worker.ocr_table_rows import extract_ocr_table_rows,PROFILE_ID_V3",
      "print(json.dumps(extract_ocr_table_rows(json.load(sys.stdin),stage_sha256=sys.argv[1],profile_id=PROFILE_ID_V3),ensure_ascii=False))",
    ].join("\n");
    const run = spawnSync(pythonPath, ["-c", code, stage.content_hash], {
      input: JSON.stringify(content), encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    });
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    const row = result.proposals.find((proposal: { pageNumber: number;
      valueEvidence: { lineIndex: number } }) =>
      proposal.pageNumber === 7 && proposal.valueEvidence.lineIndex === 44);
    expect(row).toBeDefined();
    const input = { schemaVersion: "ocr-row-transcription-review-v1",
      ocrStageSha256: stage.content_hash, rowFingerprint: sha256(canonicalJson(row)),
      decision: "REJECTED", reviewedLabel: null, reviewedValue: null,
      reviewedUnit: null, basis: "Test fixture only; no human review was performed." };
    const checked = validateOcrRowTranscriptionReview(input, result, stage,
      content.inputManifestHash);
    expect(checked?.provenance.labelEvidence).toEqual(row.labelEvidence);
    expect(checked?.provenance.labelContinuationEvidence).toEqual(row.labelContinuationEvidence);
    expect(checked?.provenance.labelContinuationEvidence)
      .toEqual([expect.objectContaining({ lineIndex: 45, text: "26°" })]);
  });
