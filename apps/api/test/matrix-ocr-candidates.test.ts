import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { matrixRegistry, type MatrixVerificationSource } from "../src/matrix-execution.js";
import { extractMatrixOcrCandidates } from "../src/matrix-ocr-candidates.js";
import { boundedOcrConfigHashV2, boundedOcrProfileIdV2, boundedOcrProfileV2 } from "../src/ocr-layout.js";

function fixture(texts = ["Общая площадь здания: 9\u202f007\u202f199\u202f254\u202f740\u202f993,125 м²"]) {
  const source: MatrixVerificationSource = { sourceFileId: "FIL-synthetic-ocr", sha256: "a".repeat(64), stages: ["PD"], review: null,
    textArtifact: { schemaVersion: "document-text-v2", sourceFileId: "FIL-synthetic-ocr", inputSha256: "a".repeat(64), pageCount: 1,
      pages: [{ pageNumber: 1, widthMilliPoints: 600_000, heightMilliPoints: 720_000, quality: { disposition: "OCR_REQUIRED" }, blocks: [] }] } };
  const page: Record<string, any> = { schemaVersion: "document-ocr-page-v1", sourceFileId: source.sourceFileId, inputSha256: source.sha256,
    pageNumber: 1, render: { sha256: "b".repeat(64), widthPx: 1000, heightPx: 1200, dpi: 120,
      rendererProfileId: boundedOcrProfileV2.rendererProfileId }, provider: { profileId: boundedOcrProfileV2.ocrProviderProfileIds[0], script: "eslav" },
    lines: texts.map((text, i) => ({ text, score: 0.999, bboxPx: [100, 120 + i * 30, 900, 140 + i * 30] })) };
  rehash(page);
  const stage = { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT", inputManifestHash: "c".repeat(64),
    disposition: "OCR_LAYOUT_BOUNDED", reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: boundedOcrProfileIdV2, providerConfigHash: boundedOcrConfigHashV2, outputCount: 1,
    analysis: { schemaVersion: "bounded-ocr-layout-analysis-v2", objectId: "OBJ-synthetic", inputManifestHash: "c".repeat(64),
      profile: boundedOcrProfileV2, sourceCount: 1, ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0,
      skippedOversizePageCount: 0, skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
      sources: [{ sourceFileId: source.sourceFileId, sourceSha256: source.sha256, mediaType: "application/pdf", pageCount: 1,
        status: "SCANNED", ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0, skippedRenderPixelPageCount: 0, pages: [page] }] } };
  return { source, page, stage };
}
function rehash(page: Record<string, any>) {
  const { contentHash: _hash, ...content } = page; page.contentHash = sha256(canonicalJson(content));
}
const run = (f: ReturnType<typeof fixture>) => extractMatrixOcrCandidates(f.stage, [f.source], matrixRegistry);

describe("server-derived OCR matrix candidates", () => {
  it("keeps unknown source review visible, exact decimals and top-left rendered-page geometry", () => {
    const f = fixture(); const candidates = run(f); expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ sourceFileId: f.source.sourceFileId, sourceSha256: f.source.sha256, stage: "PD",
      pageNumber: 1, lineIndex: 0, blockId: "ocr:0", renderSha256: f.page.render.sha256, ocrPageContentHash: f.page.contentHash,
      method: "OCR", status: "CANDIDATE", entityKey: null, attribute: "BUILDING_TOTAL_AREA", value: "9007199254740993.125",
      unit: "m2", rawValue: "9\u202f007\u202f199\u202f254\u202f740\u202f993,125", rawUnit: "м²", parameterCodes: ["PZ-002"],
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 20 / 1200 }, coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED",
      sourceFlags: ["OCR_TRANSCRIPTION_UNVERIFIED", "SOURCE_REVISION_UNKNOWN", "SOURCE_APPROVAL_UNKNOWN"] });
    for (const field of ["qualified", "confidence", "calibratedProbability", "coverage", "results"]) expect(candidates[0]).not.toHaveProperty(field);
    expect(run(f)).toEqual(candidates);
    f.source.review = { revisionStatus: "CURRENT", approvalStatus: "APPROVED", linkGroupId: "synthetic", pageStages: {} };
    expect(run(f)[0].sourceFlags).toEqual(["OCR_TRANSCRIPTION_UNVERIFIED"]);
  });

  it("extracts literal registered classes and normalized units without OCR typo repair", () => {
    const f = fixture(["Класс бетона: В25", "Класс энергетической эффективности здания: А", "Общая площадь здания: 12,50 м2",
      "Класс бетона: 825", "Класс энергетической эффективности здания: A+", "Общая площадь здания: 12 га"]);
    expect(run(f).map(c => [c.attribute, c.value, c.unit])).toEqual([
      ["CONCRETE_CLASS", "В25", "B_CLASS"], ["ENERGY_EFFICIENCY_CLASS", "А", "energy_class"], ["BUILDING_TOTAL_AREA", "12.5", "m2"] ]);
  });

  it("refuses fragments, alternatives, unsupported units and absent literal label/value/unit", () => {
    const f = fixture(["Общая площадь здания", "120 м²", "Общая площадь здания: 120 / 130 м²", "Общая площадь здания: 120",
      "Общая площадь здания: 120 м² примечание", "Примечание: Общая площадь здания: 120 м²", "Общая площадь здания:\n120 м²"]);
    expect(run(f)).toEqual([]);
  });

  it("fails closed on source, page, content, release or render binding changes", () => {
    const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
      f => { f.stage.analysis.sources[0].sourceSha256 = "d".repeat(64); },
      f => { f.stage.analysis.sources[0].sourceFileId = "FIL-other"; },
      f => { f.page.inputSha256 = "d".repeat(64); rehash(f.page); },
      f => { f.page.render.sha256 = "invalid"; rehash(f.page); },
      f => { f.page.render.widthPx = 1100; rehash(f.page); },
      f => { f.page.render.rendererProfileId = "uncommitted-renderer"; rehash(f.page); },
      f => { f.page.render.heightPx = 0; rehash(f.page); },
      f => { f.page.lines[0].bboxPx[3] = 2000; rehash(f.page); },
      f => { f.page.lines[0].bboxPx[0] = Number.NaN; },
      f => { f.page.lines[0].text = "Общая площадь здания: 1 м²"; },
      f => { f.page.pageNumber = 2; rehash(f.page); },
      f => { f.stage.providerConfigHash = "d".repeat(64); },
      f => { f.stage.analysis.schemaVersion = "bounded-ocr-layout-analysis-v3"; },
      f => { f.source.textArtifact = null; },
      f => { f.stage.outputCount = 2; },
    ];
    for (const change of changes) { const f = fixture(); change(f); expect(run(f)).toEqual([]); }
    expect(extractMatrixOcrCandidates({}, [], matrixRegistry)).toEqual([]);
    const f = fixture(); expect(extractMatrixOcrCandidates(f.stage, [], matrixRegistry)).toEqual([]);
  });

  it("keeps mixed-stage facts unresolved until page stage exists, always transcription-unverified", () => {
    const f = fixture(); f.source.stages = ["RD", "ID"];
    expect(run(f)[0]).toMatchObject({ stage: "UNRESOLVED", sourceFlags: expect.arrayContaining(["OCR_TRANSCRIPTION_UNVERIFIED", "SOURCE_STAGE_UNRESOLVED"]) });
    f.source.review = { revisionStatus: "UNKNOWN", approvalStatus: "UNKNOWN", linkGroupId: null, pageStages: { "1": "ID" } };
    expect(run(f)[0].stage).toBe("ID");
    f.source.review.pageStages = { "1": "PD" }; expect(run(f)).toEqual([]);
  });
});
