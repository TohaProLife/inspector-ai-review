import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyOcrTableRows } from "../src/ocr-table-rows.js";
import { boundedOcrConfigHashV4, boundedOcrConfigHashV5,
  boundedOcrProfileIdV4, boundedOcrProfileIdV5,
  boundedOcrProfileV4, boundedOcrProfileV5 } from "../src/ocr-layout.js";

const sourceId = "FIL-1";
const sourceHash = "a".repeat(64);
const manifestHash = "b".repeat(64);

function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort()
      .map((key) => `${JSON.stringify(key)}:${workerJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fixture(version: 4 | 5 = 5) {
  const profile = version === 5 ? boundedOcrProfileV5 : boundedOcrProfileV4;
  const profileId = version === 5 ? boundedOcrProfileIdV5 : boundedOcrProfileIdV4;
  const configHash = version === 5 ? boundedOcrConfigHashV5 : boundedOcrConfigHashV4;
  const lines = [
    { text: "Наименование", bboxPx: [250, 100, 430, 130], score: 0.98 },
    { text: "Значение", bboxPx: [600, 100, 730, 130], score: 0.97 },
    { text: "Площадь участка", bboxPx: [250, 150, 510, 178], score: 0.96 },
    { text: "100,5", bboxPx: [620, 151, 680, 178], score: 0.95 },
    { text: "Давление системы", bboxPx: [250, 190, 510, 218], score: 0.94 },
    { text: "+15,800", bboxPx: [620, 190, 700, 218], score: 0.93 },
    { text: "не число", bboxPx: [620, 230, 700, 258], score: 0.99 },
  ];
  const page: Record<string, any> = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: sourceId,
    inputSha256: sourceHash, pageNumber: 9,
    render: { sha256: "c".repeat(64), widthPx: 1000, heightPx: 1400,
      dpi: 120, rendererProfileId: profile.rendererProfileId },
    provider: { profileId: profile.ocrProviderProfileIds[0], script: "eslav" },
    lines,
  };
  page.contentHash = sha256(canonicalJson(page));
  const emptyPage: Record<string, any> = {
    ...page, pageNumber: 7, lines: [{ text: "Раздел", bboxPx: [200, 100, 300, 130], score: 0.95 }],
  };
  const { contentHash: _old, ...emptyUnhashed } = emptyPage;
  emptyPage.contentHash = sha256(canonicalJson(emptyUnhashed));
  const stage: Record<string, any> = {
    schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: manifestHash, disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: profileId, providerConfigHash: configHash, outputCount: 2,
    analysis: { schemaVersion: `bounded-ocr-layout-analysis-v${version}`,
      objectId: "OBJ-1", inputManifestHash: manifestHash, profile,
      sourceCount: 1, processedPageCount: 2,
      sources: [{ sourceFileId: sourceId, sourceSha256: sourceHash,
        processedPageCount: 2, pages: [emptyPage, page] }] },
  };
  const stageCanonical = canonicalJson(stage);
  const persisted = { content_json: stage, content_hash: sha256(stageCanonical),
    byte_size: Buffer.byteLength(stageCanonical), provider_profile_id: profileId,
    provider_config_hash: configHash, input_manifest_hash: manifestHash };
  const evidence = (index: number, role: string) => ({ role, lineIndex: index,
    text: lines[index].text, bboxPx: lines[index].bboxPx, score: lines[index].score });
  const row = (labelIndex: number, valueIndex: number) => ({ sourceFileId: sourceId,
    inputSha256: sourceHash, pageNumber: 9, ocrPageContentHash: page.contentHash,
    renderSha256: page.render.sha256,
    headerEvidence: [evidence(0, "labelHeader"), evidence(1, "valueHeader")],
    labelEvidence: evidence(labelIndex, "rowLabel"),
    valueEvidence: evidence(valueIndex, "rawValue") });
  const result: Record<string, any> = {
    schemaVersion: "ocr-table-row-proposals-v1", profileId: "conservative-ocr-table-rows-v1",
    ocrStageSha256: persisted.content_hash, inputManifestHash: manifestHash,
    proposals: [row(2, 3), row(4, 5)],
    abstentions: [{ sourceFileId: sourceId, inputSha256: sourceHash,
      pageNumber: 7, lineIndex: null, reasonCode: "TWO_COLUMN_HEADER_UNRESOLVED" }],
    findingCount: 0,
  };
  result.contentHash = sha256(workerJson(result));
  return { persisted, result, page, emptyPage };
}

function rehashStage(f: ReturnType<typeof fixture>): void {
  for (const page of [f.emptyPage, f.page]) {
    const { contentHash: _ignored, ...unhashed } = page;
    page.contentHash = sha256(canonicalJson(unhashed));
  }
  const canonical = canonicalJson(f.persisted.content_json);
  f.persisted.content_hash = sha256(canonical);
  f.persisted.byte_size = Buffer.byteLength(canonical);
  f.result.ocrStageSha256 = f.persisted.content_hash;
  rehashResult(f.result);
}

function rehashResult(result: Record<string, any>): void {
  const { contentHash: _ignored, ...unhashed } = result;
  result.contentHash = sha256(workerJson(unhashed));
}

describe("independent OCR table-row verifier", () => {
  it.each([4, 5] as const)("accepts exact review-only rows from v%s stage", (version) => {
    const { persisted, result } = fixture(version);
    expect(verifyOcrTableRows(result, persisted, manifestHash)).toBe(true);
    expect(result.proposals).toHaveLength(2);
    expect(result.findingCount).toBe(0);
  });

  it("rejects stage, source, page, render, and OCR line tampering", () => {
    const f = fixture();
    f.persisted.content_hash = "d".repeat(64);
    expect(verifyOcrTableRows(f.result, f.persisted, manifestHash)).toBe(false);
    const source = fixture();
    source.persisted.content_json.analysis.sources[0].sourceSha256 = "d".repeat(64);
    rehashStage(source);
    expect(verifyOcrTableRows(source.result, source.persisted, manifestHash)).toBe(false);
    const page = fixture();
    page.page.lines[3].text = "999";
    expect(verifyOcrTableRows(page.result, page.persisted, manifestHash)).toBe(false);
    const render = fixture();
    render.page.render.sha256 = "d".repeat(64);
    rehashStage(render);
    rehashResult(render.result);
    expect(verifyOcrTableRows(render.result, render.persisted, manifestHash)).toBe(false);
    const line = fixture();
    line.page.lines[3].bboxPx[0] = 619;
    rehashStage(line);
    rehashResult(line.result);
    expect(verifyOcrTableRows(line.result, line.persisted, manifestHash)).toBe(false);
  });

  it("rejects fabricated row, duplicate row, wrong counts, and nonnumeric value", () => {
    const fabricated = fixture();
    fabricated.result.proposals[0].valueEvidence.text = "999";
    rehashResult(fabricated.result);
    expect(verifyOcrTableRows(fabricated.result, fabricated.persisted, manifestHash)).toBe(false);
    const duplicate = fixture();
    duplicate.result.proposals.push(structuredClone(duplicate.result.proposals[0]));
    rehashResult(duplicate.result);
    expect(verifyOcrTableRows(duplicate.result, duplicate.persisted, manifestHash)).toBe(false);
    const count = fixture();
    count.result.findingCount = 1;
    rehashResult(count.result);
    expect(verifyOcrTableRows(count.result, count.persisted, manifestHash)).toBe(false);
    const value = fixture();
    value.page.lines[3].text = "нет";
    rehashStage(value);
    rehashResult(value.result);
    expect(verifyOcrTableRows(value.result, value.persisted, manifestHash)).toBe(false);
  });

  it("rejects ambiguous duplicate geometry and duplicate OCR pages", () => {
    const ambiguous = fixture();
    ambiguous.page.lines.push({ text: "Другая площадь", bboxPx: [250, 151, 500, 178], score: 0.96 });
    rehashStage(ambiguous);
    rehashResult(ambiguous.result);
    expect(verifyOcrTableRows(ambiguous.result, ambiguous.persisted, manifestHash)).toBe(false);
    const pages = fixture();
    pages.emptyPage.pageNumber = 9;
    rehashStage(pages);
    rehashResult(pages.result);
    expect(verifyOcrTableRows(pages.result, pages.persisted, manifestHash)).toBe(false);
  });

  it("accepts explicit ambiguity abstention only when no ambiguous row is proposed", () => {
    const f = fixture();
    f.page.lines.push({ text: "Другая площадь", bboxPx: [250, 151, 500, 178], score: 0.96 });
    rehashStage(f);
    f.result.proposals.shift();
    f.result.proposals[0].ocrPageContentHash = f.page.contentHash;
    f.result.abstentions.push({ sourceFileId: sourceId, inputSha256: sourceHash,
      pageNumber: 9, lineIndex: 3, reasonCode: "ROW_PAIR_AMBIGUOUS" });
    rehashResult(f.result);
    expect(verifyOcrTableRows(f.result, f.persisted, manifestHash)).toBe(true);
  });

  it("rejects extra approval, coverage, or typed-fact fields", () => {
    const f = fixture();
    f.result.approvalStatus = "APPROVED";
    rehashResult(f.result);
    expect(verifyOcrTableRows(f.result, f.persisted, manifestHash)).toBe(false);
    delete f.result.approvalStatus;
    f.result.proposals[0].parameterCode = "PZ-002";
    rehashResult(f.result);
    expect(verifyOcrTableRows(f.result, f.persisted, manifestHash)).toBe(false);
  });
});
