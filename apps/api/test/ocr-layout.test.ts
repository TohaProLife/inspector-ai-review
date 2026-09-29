import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import {
  boundedOcrConfigHash, boundedOcrProfile, boundedOcrProfileId,
  boundedOcrConfigHashV2, boundedOcrProfileIdV2, boundedOcrProfileV2,
  boundedOcrConfigHashV3, boundedOcrProfileIdV3, boundedOcrProfileV3,
  boundedOcrConfigHashV4, boundedOcrProfileIdV4, boundedOcrProfileV4,
  boundedOcrConfigHashV5, boundedOcrProfileIdV5, boundedOcrProfileV5,
  boundedOcrConfigHashV6, boundedOcrProfileIdV6, boundedOcrProfileV6,
  selectBoundedOcrV2Pages, selectBoundedOcrV3Pages, selectBoundedOcrV4Pages,
  selectBoundedOcrV5Pages, selectBoundedOcrV6Pages,
  validateBoundedOcrStageResult, validateBoundedOcrV6StageResult,
  type OcrV6ExpectedSource,
} from "../src/ocr-layout.js";

const source = { apiId: "FIL-A", sha256: "a".repeat(64), byteSize: 100,
  mediaType: "application/pdf", textArtifact: {
    schemaVersion: "document-text-v2", sourceFileId: "FIL-A", inputSha256: "a".repeat(64),
    pageCount: 2, pages: [
      { pageNumber: 1, quality: { disposition: "OCR_REQUIRED" } },
      { pageNumber: 2, quality: { disposition: "TEXT_LAYER_CANDIDATE" } },
    ],
  } };

function validResult() {
  const page: Record<string, unknown> = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-A",
    inputSha256: "a".repeat(64), pageNumber: 1,
    render: { sha256: "b".repeat(64), widthPx: 1000, heightPx: 1000,
      dpi: 120, rendererProfileId: "pdfium-test" },
    provider: { profileId: "paddle-test", script: "eslav" },
    lines: [{ text: "Текст", score: 0.98, bboxPx: [1, 2, 50, 30] }],
  };
  page.contentHash = sha256(canonicalJson(page));
  return {
    schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: "c".repeat(64), disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: boundedOcrProfileId, providerConfigHash: boundedOcrConfigHash,
    outputCount: 1, analysis: {
      schemaVersion: "bounded-ocr-layout-analysis-v1", objectId: "OBJ-1",
      inputManifestHash: "c".repeat(64), profile: boundedOcrProfile,
      sourceCount: 1, ocrRequiredPageCount: 1, processedPageCount: 1,
      deferredPageCount: 0, skippedOversizePageCount: 0,
      skippedUnsupportedSourceCount: 0,
      sources: [{ sourceFileId: "FIL-A", sourceSha256: "a".repeat(64),
        mediaType: "application/pdf", pageCount: 2, status: "SCANNED",
        ocrRequiredPageCount: 1, processedPageCount: 1, deferredPageCount: 0,
        pages: [page] }],
    },
  };
}

function v2Page(sourceId: string, digest: string, number: number) {
  const widthPx = sourceId === "FIL-A" ? 2000 : 2334;
  const page: Record<string, unknown> = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: sourceId,
    inputSha256: digest, pageNumber: number,
    render: { sha256: "b".repeat(64), widthPx, heightPx: 1334,
      dpi: 120, rendererProfileId: boundedOcrProfileV2.rendererProfileId },
    provider: { profileId: boundedOcrProfileV2.ocrProviderProfileIds[0], script: "eslav" }, lines: [],
  };
  page.contentHash = sha256(canonicalJson(page));
  return page;
}

const v2Sources = [
  { ...source, textArtifact: { ...source.textArtifact, pageCount: 4, pages: [
    { pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
      quality: { disposition: "TEXT_LAYER_CANDIDATE" }, blocks: [{ text: "Тепловая нагрузка" }] },
    { pageNumber: 2, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
      quality: { disposition: "OCR_REQUIRED" }, blocks: [] },
    { pageNumber: 3, widthMilliPoints: 1_200_000, heightMilliPoints: 800_000,
      quality: { disposition: "OCR_REQUIRED" }, blocks: [] },
    { pageNumber: 4, widthMilliPoints: 10_000_000, heightMilliPoints: 10_000_000,
      quality: { disposition: "OCR_REQUIRED" }, blocks: [] },
  ] } },
  { apiId: "FIL-B", sha256: "d".repeat(64), byteSize: 100,
    mediaType: "application/pdf", textArtifact: {
      schemaVersion: "document-text-v2", sourceFileId: "FIL-B", inputSha256: "d".repeat(64),
      pageCount: 2, pages: [
        { pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          quality: { disposition: "TEXT_LAYER_CANDIDATE" }, blocks: [{ text: "Общая площадь здания" }] },
        { pageNumber: 2, widthMilliPoints: 1_400_000, heightMilliPoints: 800_000,
          quality: { disposition: "OCR_REQUIRED" }, blocks: [] },
      ],
    } },
];

function v2Result() {
  const result: Record<string, unknown> = validResult();
  result.providerProfileId = boundedOcrProfileIdV2;
  result.providerConfigHash = boundedOcrConfigHashV2;
  result.outputCount = 2;
  result.analysis = {
    schemaVersion: "bounded-ocr-layout-analysis-v2", objectId: "OBJ-1",
    inputManifestHash: "c".repeat(64), profile: boundedOcrProfileV2,
    sourceCount: 2, ocrRequiredPageCount: 4, processedPageCount: 2,
    deferredPageCount: 2, skippedOversizePageCount: 0,
    skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 1,
    sources: [
      { sourceFileId: "FIL-A", sourceSha256: "a".repeat(64), mediaType: "application/pdf",
        pageCount: 4, status: "PARTIALLY_SCANNED", ocrRequiredPageCount: 3,
        processedPageCount: 1, deferredPageCount: 2, skippedRenderPixelPageCount: 1,
        pages: [v2Page("FIL-A", "a".repeat(64), 3)] },
      { sourceFileId: "FIL-B", sourceSha256: "d".repeat(64), mediaType: "application/pdf",
        pageCount: 2, status: "SCANNED", ocrRequiredPageCount: 1,
        processedPageCount: 1, deferredPageCount: 0, skippedRenderPixelPageCount: 0,
        pages: [v2Page("FIL-B", "d".repeat(64), 2)] },
    ],
  };
  return result;
}

const v3Sources = [
  v2Sources[0],
  { apiId: "FIL-B", sha256: "d".repeat(64), byteSize: 100,
    mediaType: "application/pdf", textArtifact: {
      schemaVersion: "document-text-v2", sourceFileId: "FIL-B", inputSha256: "d".repeat(64),
      pageCount: 5, pages: [
        { pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          quality: { disposition: "TEXT_LAYER_CANDIDATE" },
          blocks: [{ text: "Разрешение. Обозначение АНО/1-РД-ОВ1" }] },
        ...[2, 3, 4].map((number) => ({ pageNumber: number,
          widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          quality: { disposition: "OCR_REQUIRED" }, blocks: [] })),
        { pageNumber: 5, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
          quality: { disposition: "TEXT_LAYER_CANDIDATE" },
          blocks: [{ text: "Основные показатели по рабочим чертежам марки ОВ. "
            + "Тепловой поток на отопление" }] },
      ],
    } },
];

function v3Result() {
  const result: Record<string, unknown> = v2Result();
  const page = (number: number): Record<string, unknown> => {
    const value: Record<string, unknown> = {
      schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-B",
      inputSha256: "d".repeat(64), pageNumber: number,
      render: { sha256: "b".repeat(64), widthPx: 992, heightPx: 1404,
        dpi: 120, rendererProfileId: boundedOcrProfileV3.rendererProfileId },
      provider: { profileId: boundedOcrProfileV3.ocrProviderProfileIds[0], script: "eslav" },
      lines: [],
    };
    value.contentHash = sha256(canonicalJson(value));
    return value;
  };
  result.providerProfileId = boundedOcrProfileIdV3;
  result.providerConfigHash = boundedOcrConfigHashV3;
  result.analysis = {
    schemaVersion: "bounded-ocr-layout-analysis-v3", objectId: "OBJ-1",
    inputManifestHash: "c".repeat(64), profile: boundedOcrProfileV3,
    sourceCount: 2, ocrRequiredPageCount: 6, processedPageCount: 2,
    deferredPageCount: 4, skippedOversizePageCount: 0,
    skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
    subjectCandidatePageCount: 3,
    sources: [
      { sourceFileId: "FIL-A", sourceSha256: "a".repeat(64), mediaType: "application/pdf",
        pageCount: 4, status: "SKIPPED_NO_SUBJECT_CONTEXT", ocrRequiredPageCount: 3,
        processedPageCount: 0, deferredPageCount: 3, skippedRenderPixelPageCount: 0,
        subjectCandidatePageCount: 0, pages: [] },
      { sourceFileId: "FIL-B", sourceSha256: "d".repeat(64), mediaType: "application/pdf",
        pageCount: 5, status: "PARTIALLY_SCANNED", ocrRequiredPageCount: 3,
        processedPageCount: 2, deferredPageCount: 1, skippedRenderPixelPageCount: 0,
        subjectCandidatePageCount: 3, pages: [page(2), page(3)] },
    ],
  };
  return result;
}

describe("bounded OCR stage validation", () => {
  it("accepts only the qualified page and returns compact immutable metadata", () => {
    const result = validResult();
    const accepted = validateBoundedOcrStageResult(result, "c".repeat(64), "OBJ-1", [source]);
    expect(accepted).toMatchObject({ outputCount: 1,
      contentHash: sha256(canonicalJson(result)),
      storedResult: { disposition: "OCR_LAYOUT_BOUNDED", outputCount: 1 } });
    expect(accepted?.storedResult).not.toHaveProperty("analysis");
  });

  it("rejects OCR on a qualified text-layer page, changed SHA and findings", () => {
    const result = validResult();
    (result.analysis.sources[0].pages[0] as Record<string, unknown>).pageNumber = 2;
    expect(validateBoundedOcrStageResult(result, "c".repeat(64), "OBJ-1", [source])).toBeUndefined();
    const changed = validResult();
    ((changed.analysis.sources[0].pages[0] as Record<string, unknown>).lines as Array<Record<string, unknown>>)[0].text = "подмена";
    expect(validateBoundedOcrStageResult(changed, "c".repeat(64), "OBJ-1", [source])).toBeUndefined();
    expect(validateBoundedOcrStageResult({ ...validResult(), finding: {} },
      "c".repeat(64), "OBJ-1", [source])).toBeUndefined();
  });

  it("rejects result when committed text artifact or selected source is missing", () => {
    expect(validateBoundedOcrStageResult(validResult(), "c".repeat(64), "OBJ-1",
      [{ ...source, textArtifact: null }])).toBeUndefined();
    expect(validateBoundedOcrStageResult(validResult(), "c".repeat(64), "OBJ-1",
      [{ ...source, sha256: "f".repeat(64) }])).toBeUndefined();
  });

  it("v2 selects drawing-size OCR pages round robin, counts raster skips, and accepts old v1", () => {
    const selected = selectBoundedOcrV2Pages(v2Sources);
    expect(selected?.get("FIL-A")).toEqual({ selected: [3], rasterSkipped: 1 });
    expect(selected?.get("FIL-B")).toEqual({ selected: [2], rasterSkipped: 0 });
    expect(validateBoundedOcrStageResult(v2Result(), "c".repeat(64), "OBJ-1", v2Sources,
      boundedOcrProfileIdV2)?.outputCount).toBe(2);
    expect(validateBoundedOcrStageResult(validResult(), "c".repeat(64), "OBJ-1", [source])?.outputCount).toBe(1);
  });

  it("v2 rejects substituted page, false raster count and wrong release profile", () => {
    const substituted = v2Result();
    const analysis = substituted.analysis as Record<string, unknown>;
    const sources = analysis.sources as Array<Record<string, unknown>>;
    ((sources[0].pages as Array<Record<string, unknown>>)[0]).pageNumber = 2;
    expect(validateBoundedOcrStageResult(substituted, "c".repeat(64), "OBJ-1", v2Sources,
      boundedOcrProfileIdV2)).toBeUndefined();
    const count = v2Result();
    (count.analysis as Record<string, unknown>).skippedRenderPixelPageCount = 0;
    expect(validateBoundedOcrStageResult(count, "c".repeat(64), "OBJ-1", v2Sources,
      boundedOcrProfileIdV2)).toBeUndefined();
    expect(validateBoundedOcrStageResult(v2Result(), "c".repeat(64), "OBJ-1", v2Sources,
      boundedOcrProfileId)).toBeUndefined();
  });

  it("v2 skips long narrow pages above renderer side limit", () => {
    const skinny = structuredClone(v2Sources[0]);
    skinny.textArtifact.pages[2].widthMilliPoints = 13_000_000;
    skinny.textArtifact.pages[2].heightMilliPoints = 20_000;
    const selected = selectBoundedOcrV2Pages([skinny]);
    expect(selected?.get("FIL-A")).toEqual({ selected: [2], rasterSkipped: 2 });
  });

  it("v2 rejects forged dimensions and unpinned OCR/renderer identities", () => {
    const geometry = v2Result();
    const sources = (geometry.analysis as Record<string, unknown>).sources as Array<Record<string, unknown>>;
    const page = (sources[0].pages as Array<Record<string, unknown>>)[0];
    (page.render as Record<string, unknown>).widthPx = 1990;
    const { contentHash: _geometryHash, ...geometryContent } = page;
    page.contentHash = sha256(canonicalJson(geometryContent));
    expect(validateBoundedOcrStageResult(geometry, "c".repeat(64), "OBJ-1", v2Sources,
      boundedOcrProfileIdV2)).toBeUndefined();
    const provider = v2Result();
    const providerSources = (provider.analysis as Record<string, unknown>).sources as Array<Record<string, unknown>>;
    const providerPage = (providerSources[0].pages as Array<Record<string, unknown>>)[0];
    (providerPage.provider as Record<string, unknown>).profileId = "unknown-provider";
    const { contentHash: _providerHash, ...providerContent } = providerPage;
    providerPage.contentHash = sha256(canonicalJson(providerContent));
    expect(validateBoundedOcrStageResult(provider, "c".repeat(64), "OBJ-1", v2Sources,
      boundedOcrProfileIdV2)).toBeUndefined();
    const renderer = v2Result();
    const rendererSources = (renderer.analysis as Record<string, unknown>).sources as Array<Record<string, unknown>>;
    const rendererPage = (rendererSources[0].pages as Array<Record<string, unknown>>)[0];
    (rendererPage.render as Record<string, unknown>).rendererProfileId = "unknown-renderer";
    const { contentHash: _rendererHash, ...rendererContent } = rendererPage;
    rendererPage.contentHash = sha256(canonicalJson(rendererContent));
    expect(validateBoundedOcrStageResult(renderer, "c".repeat(64), "OBJ-1", v2Sources,
      boundedOcrProfileIdV2)).toBeUndefined();
  });

  it("v3 selects only bounded RD-OV heating context and abstains for other source", () => {
    expect(selectBoundedOcrV3Pages(v3Sources)?.get("FIL-A")).toEqual({
      selected: [], rasterSkipped: 0, subjectCandidateCount: 0,
    });
    expect(selectBoundedOcrV3Pages(v3Sources)?.get("FIL-B")).toEqual({
      selected: [2, 3], rasterSkipped: 0, subjectCandidateCount: 3,
    });
    expect(validateBoundedOcrStageResult(v3Result(), "c".repeat(64), "OBJ-1", v3Sources,
      boundedOcrProfileIdV3)?.outputCount).toBe(2);
  });

  it("v3 rejects forged subject count, changed selected page and missing context", () => {
    const count = v3Result();
    (count.analysis as Record<string, unknown>).subjectCandidatePageCount = 2;
    expect(validateBoundedOcrStageResult(count, "c".repeat(64), "OBJ-1", v3Sources,
      boundedOcrProfileIdV3)).toBeUndefined();
    const page = v3Result();
    const sources = (page.analysis as Record<string, unknown>).sources as Array<Record<string, unknown>>;
    ((sources[1].pages as Array<Record<string, unknown>>)[0]).pageNumber = 4;
    expect(validateBoundedOcrStageResult(page, "c".repeat(64), "OBJ-1", v3Sources,
      boundedOcrProfileIdV3)).toBeUndefined();
    const withoutContext = structuredClone(v3Sources);
    withoutContext[1].textArtifact.pages[0].blocks = [{ text: "Неизвестный документ" }];
    expect(selectBoundedOcrV3Pages(withoutContext)?.get("FIL-B")).toEqual({
      selected: [], rasterSkipped: 0, subjectCandidateCount: 0,
    });
    const withoutSummary = structuredClone(v3Sources);
    withoutSummary[1].textArtifact.pages[4].blocks = [{ text: "Общие данные" }];
    expect(selectBoundedOcrV3Pages(withoutSummary)?.get("FIL-B")?.selected).toEqual([]);
  });

  it("v3 skips subject page above renderer side limit and keeps later qualified pages", () => {
    const sources = structuredClone(v3Sources);
    sources[1].textArtifact.pages[1].widthMilliPoints = 13_000_000;
    sources[1].textArtifact.pages[1].heightMilliPoints = 20_000;
    expect(selectBoundedOcrV3Pages(sources)?.get("FIL-B")).toEqual({
      selected: [3, 4], rasterSkipped: 1, subjectCandidateCount: 3,
    });
  });

  it("v4 selects and verifies only CID-damaged opening title when subject context is absent", () => {
    const input = structuredClone(v3Sources[1]);
    input.textArtifact.pages[0].quality = { disposition: "OCR_REQUIRED",
      reasonCodes: ["TEXT_DECODING_ANOMALY"] } as any;
    input.textArtifact.pages[0].blocks = [];
    const selection = selectBoundedOcrV4Pages([input]);
    expect(selection?.get("FIL-B")).toEqual({ selected: [1], rasterSkipped: 0,
      subjectCandidateCount: 0, titleRecoveryCandidateCount: 1 });
    const page: Record<string, unknown> = {
      schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-B",
      inputSha256: "d".repeat(64), pageNumber: 1,
      render: { sha256: "b".repeat(64), widthPx: 992, heightPx: 1404,
        dpi: 120, rendererProfileId: boundedOcrProfileV4.rendererProfileId },
      provider: { profileId: boundedOcrProfileV4.ocrProviderProfileIds[0], script: "eslav" }, lines: [],
    };
    page.contentHash = sha256(canonicalJson(page));
    const result: Record<string, unknown> = {
      schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
      inputManifestHash: "c".repeat(64), disposition: "OCR_LAYOUT_BOUNDED",
      reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
      providerProfileId: boundedOcrProfileIdV4, providerConfigHash: boundedOcrConfigHashV4,
      outputCount: 1,
      analysis: { schemaVersion: "bounded-ocr-layout-analysis-v4", objectId: "OBJ-1",
        inputManifestHash: "c".repeat(64), profile: boundedOcrProfileV4,
        sourceCount: 1, ocrRequiredPageCount: 4, processedPageCount: 1,
        deferredPageCount: 3, skippedOversizePageCount: 0,
        skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
        subjectCandidatePageCount: 0, titleRecoveryCandidatePageCount: 1,
        sources: [{ sourceFileId: "FIL-B", sourceSha256: "d".repeat(64),
          mediaType: "application/pdf", pageCount: 5, status: "PARTIALLY_SCANNED",
          ocrRequiredPageCount: 4, processedPageCount: 1, deferredPageCount: 3,
          skippedRenderPixelPageCount: 0, subjectCandidatePageCount: 0,
          titleRecoveryCandidatePageCount: 1, pages: [page] }],
      },
    };
    expect(validateBoundedOcrStageResult(result, "c".repeat(64), "OBJ-1", [input],
      boundedOcrProfileIdV4)?.outputCount).toBe(1);
    ((result.analysis as Record<string, unknown>).sources as Array<Record<string, unknown>>)[0]
      .titleRecoveryCandidatePageCount = 0;
    expect(validateBoundedOcrStageResult(result, "c".repeat(64), "OBJ-1", [input],
      boundedOcrProfileIdV4)).toBeUndefined();
    input.textArtifact.pages[0].quality = { disposition: "OCR_REQUIRED",
      reasonCodes: ["LOW_TEXT_COVERAGE"] } as any;
    expect(selectBoundedOcrV4Pages([input])?.get("FIL-B")?.selected).toEqual([]);
  });

  it("v5 selects four subject pages, verifies counters, and leaves v4 capped at two", () => {
    expect(boundedOcrConfigHashV5).toBe("d7e4e78dcea591d30587022f9d57360e0cc227607f577ab10f896c69d94b37a7");
    const input = structuredClone(v3Sources[1]);
    input.textArtifact.pageCount = 6;
    input.textArtifact.pages.splice(4, 0, { pageNumber: 5,
      widthMilliPoints: 595_000, heightMilliPoints: 842_000,
      quality: { disposition: "OCR_REQUIRED" }, blocks: [] } as any);
    input.textArtifact.pages[5].pageNumber = 6;
    expect(selectBoundedOcrV4Pages([input])?.get("FIL-B")?.selected).toEqual([2, 3]);
    expect(selectBoundedOcrV5Pages([input])?.get("FIL-B")?.selected).toEqual([2, 3, 4, 5]);

    const result = v3Result();
    result.providerProfileId = boundedOcrProfileIdV5;
    result.providerConfigHash = boundedOcrConfigHashV5;
    result.outputCount = 4;
    const analysis = result.analysis as Record<string, any>;
    analysis.schemaVersion = "bounded-ocr-layout-analysis-v5";
    analysis.profile = boundedOcrProfileV5;
    analysis.sources = [analysis.sources[1]];
    analysis.sourceCount = 1;
    analysis.ocrRequiredPageCount = 4;
    analysis.processedPageCount = 4;
    analysis.deferredPageCount = 0;
    analysis.subjectCandidatePageCount = 4;
    analysis.titleRecoveryCandidatePageCount = 0;
    const sourceResult = analysis.sources[0];
    sourceResult.pageCount = 6;
    sourceResult.status = "SCANNED";
    sourceResult.ocrRequiredPageCount = 4;
    sourceResult.processedPageCount = 4;
    sourceResult.deferredPageCount = 0;
    sourceResult.subjectCandidatePageCount = 4;
    sourceResult.titleRecoveryCandidatePageCount = 0;
    sourceResult.pages = [2, 3, 4, 5].map((number) => {
      const page = structuredClone(sourceResult.pages[0]);
      page.pageNumber = number;
      const { contentHash: _old, ...unhashed } = page;
      page.contentHash = sha256(canonicalJson(unhashed));
      return page;
    });
    expect(validateBoundedOcrStageResult(result, "c".repeat(64), "OBJ-1", [input],
      boundedOcrProfileIdV5)?.outputCount).toBe(4);
    const tampered = structuredClone(result);
    ((tampered.analysis as any).sources[0]).subjectCandidatePageCount = 3;
    expect(validateBoundedOcrStageResult(tampered, "c".repeat(64), "OBJ-1", [input],
      boundedOcrProfileIdV5)).toBeUndefined();
    const oldProfile = structuredClone(result);
    oldProfile.providerProfileId = boundedOcrProfileIdV4;
    oldProfile.providerConfigHash = boundedOcrConfigHashV4;
    (oldProfile.analysis as any).schemaVersion = "bounded-ocr-layout-analysis-v4";
    (oldProfile.analysis as any).profile = boundedOcrProfileV4;
    expect(validateBoundedOcrStageResult(oldProfile, "c".repeat(64), "OBJ-1", [input],
      boundedOcrProfileIdV4)).toBeUndefined();
  });
});

function v6Source(pageCount = 5): OcrV6ExpectedSource {
  const textArtifact = {
    schemaVersion: "document-text-v2", sourceFileId: "FIL-V6",
    inputSha256: "e".repeat(64), pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
      quality: { disposition: "OCR_REQUIRED" }, blocks: [],
    })),
  };
  return { apiId: "FIL-V6", sha256: "e".repeat(64), byteSize: 100,
    mediaType: "application/pdf", textArtifact,
    textArtifactSha256: sha256(canonicalJson(textArtifact)), stages: ["RD"], sectionCode: "AR",
    sourceDecision: { sourceSha256: "e".repeat(64), revisionStatus: "CURRENT",
      approvalStatus: "APPROVED", sectionCode: "AR", pageStages: {},
      basis: { reference: "Synthetic test review" } } };
}

function v6Page(number: number): Record<string, unknown> {
  const page: Record<string, unknown> = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-V6",
    inputSha256: "e".repeat(64), pageNumber: number,
    render: { sha256: "f".repeat(64), widthPx: 992, heightPx: 1404,
      dpi: 120, rendererProfileId: boundedOcrProfileV6.rendererProfileId },
    provider: { profileId: boundedOcrProfileV6.ocrProviderProfileIds[0], script: "eslav" },
    lines: [],
  };
  page.contentHash = sha256(canonicalJson(page));
  return page;
}

function v6Result(): Record<string, any> {
  const pages = [1, 2, 3, 4].map(v6Page);
  return { schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: "c".repeat(64), disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: boundedOcrProfileIdV6, providerConfigHash: boundedOcrConfigHashV6,
    outputCount: 4, analysis: { schemaVersion: "bounded-ocr-layout-analysis-v6",
      objectId: "OBJ-1", inputManifestHash: "c".repeat(64), profile: boundedOcrProfileV6,
      sourceCount: 1, ocrRequiredPageCount: 5, processedPageCount: 4,
      deferredPageCount: 1, skippedOversizePageCount: 0,
      skippedUnsupportedSourceCount: 0, skippedRenderPixelPageCount: 0,
      reviewEligiblePageCount: 5, stageUnresolvedPageCount: 0,
      sources: [{ sourceFileId: "FIL-V6", sourceSha256: "e".repeat(64),
        mediaType: "application/pdf", pageCount: 5, status: "PARTIALLY_SCANNED",
        ocrRequiredPageCount: 5, processedPageCount: 4, deferredPageCount: 1,
        skippedRenderPixelPageCount: 0, reviewEligiblePageCount: 5,
        stageUnresolvedPageCount: 0,
        selectionReasonCodes: ["PAGE_BUDGET_EXHAUSTED"], pages }] },
  };
}

describe("reviewed bounded OCR v6 contract", () => {
  it("matches worker profile hash and selects at most four committed reviewed pages", () => {
    expect(boundedOcrConfigHashV6).toBe(
      "ea7be21c64146e379183f7e01b047bb2fcbeb8882ee688158f5662ad0979ce21");
    const source = v6Source();
    expect(selectBoundedOcrV6Pages([source])?.get(source.apiId)).toEqual({
      selected: [1, 2, 3, 4], rasterSkipped: 0, reviewEligiblePageCount: 5,
      stageUnresolvedPageCount: 0, selectionReasonCodes: ["PAGE_BUDGET_EXHAUSTED"],
    });
    expect(validateBoundedOcrV6StageResult(v6Result(), "c".repeat(64), "OBJ-1", [source]))
      .toMatchObject({ outputCount: 4 });
    expect(validateBoundedOcrStageResult(v6Result(), "c".repeat(64), "OBJ-1", [source],
      boundedOcrProfileIdV6)).toBeUndefined();
  });

  it("defers missing or unapproved review and invalidates forged source/text scope", () => {
    const source = v6Source();
    source.sourceDecision = null;
    source.sectionCode = null;
    expect(selectBoundedOcrV6Pages([source])?.get(source.apiId)).toMatchObject({
      selected: [], selectionReasonCodes: ["SOURCE_REVIEW_REQUIRED"] });
    const result = v6Result();
    const analysis = result.analysis;
    analysis.processedPageCount = result.outputCount = 0;
    analysis.deferredPageCount = 5;
    analysis.reviewEligiblePageCount = 0;
    Object.assign(analysis.sources[0], { status: "SKIPPED_SOURCE_REVIEW_REQUIRED",
      processedPageCount: 0, deferredPageCount: 5, reviewEligiblePageCount: 0,
      selectionReasonCodes: ["SOURCE_REVIEW_REQUIRED"], pages: [] });
    expect(validateBoundedOcrV6StageResult(result, "c".repeat(64), "OBJ-1", [source]))
      .toMatchObject({ outputCount: 0 });
    source.sourceDecision = v6Source().sourceDecision;
    source.sectionCode = "AR";
    source.sourceDecision!.approvalStatus = "UNAPPROVED";
    expect(selectBoundedOcrV6Pages([source])?.get(source.apiId)?.selectionReasonCodes)
      .toEqual(["SOURCE_REVIEW_NOT_CURRENT_APPROVED"]);
    source.sourceDecision!.sourceSha256 = "0".repeat(64);
    expect(selectBoundedOcrV6Pages([source])).toBeUndefined();
    source.sourceDecision!.sourceSha256 = source.sha256;
    source.textArtifactSha256 = "0".repeat(64);
    expect(selectBoundedOcrV6Pages([source])).toBeUndefined();
  });

  it("counts unresolved stages, rejects forged counters, page, render and provider", () => {
    const source = v6Source();
    source.stages = ["PD", "RD"];
    source.sourceDecision!.pageStages = { "1": "PD", "2": "RD", "3": "UNRESOLVED",
      "4": "PD", "5": "RD" };
    expect(selectBoundedOcrV6Pages([source])?.get(source.apiId)).toEqual({
      selected: [1, 2, 4, 5], rasterSkipped: 0, reviewEligiblePageCount: 4,
      stageUnresolvedPageCount: 1, selectionReasonCodes: ["PAGE_STAGE_UNRESOLVED"],
    });
    const good = v6Result();
    const analysis = good.analysis;
    analysis.stageUnresolvedPageCount = analysis.sources[0].stageUnresolvedPageCount = 1;
    analysis.reviewEligiblePageCount = analysis.sources[0].reviewEligiblePageCount = 4;
    analysis.sources[0].status = "PARTIALLY_SCANNED";
    analysis.sources[0].selectionReasonCodes = ["PAGE_STAGE_UNRESOLVED"];
    analysis.sources[0].pages = [1, 2, 4, 5].map(v6Page);
    expect(validateBoundedOcrV6StageResult(good, "c".repeat(64), "OBJ-1", [source]))
      .toMatchObject({ outputCount: 4 });
    for (const tamper of [
      (value: any) => { value.analysis.sources[0].stageUnresolvedPageCount = 0; },
      (value: any) => { value.analysis.sources[0].selectionReasonCodes = []; },
      (value: any) => { value.analysis.sources[0].pages[0].pageNumber = 3; },
      (value: any) => { value.analysis.sources[0].pages[0].render.sha256 = "0".repeat(64); },
      (value: any) => { value.analysis.sources[0].pages[0].provider.profileId = "forged"; },
    ]) {
      const value = structuredClone(good);
      tamper(value);
      expect(validateBoundedOcrV6StageResult(value, "c".repeat(64), "OBJ-1", [source]))
        .toBeUndefined();
    }
  });

  it("selects reviewed sources round robin by source ID and rejects duplicate or stale scope", () => {
    const a = v6Source();
    a.apiId = "FIL-A";
    a.sha256 = "a".repeat(64);
    (a.textArtifact as Record<string, any>).sourceFileId = "FIL-A";
    (a.textArtifact as Record<string, any>).inputSha256 = a.sha256;
    a.textArtifactSha256 = sha256(canonicalJson(a.textArtifact));
    a.sourceDecision!.sourceSha256 = a.sha256;
    const b = v6Source();
    b.apiId = "FIL-B";
    b.sha256 = "b".repeat(64);
    (b.textArtifact as Record<string, any>).sourceFileId = "FIL-B";
    (b.textArtifact as Record<string, any>).inputSha256 = b.sha256;
    b.textArtifactSha256 = sha256(canonicalJson(b.textArtifact));
    b.sourceDecision!.sourceSha256 = b.sha256;
    expect(selectBoundedOcrV6Pages([b, a])?.get("FIL-A")?.selected).toEqual([1, 2]);
    expect(selectBoundedOcrV6Pages([b, a])?.get("FIL-B")?.selected).toEqual([1, 2]);
    expect(selectBoundedOcrV6Pages([a, a])).toBeUndefined();
    a.sourceDecision!.pageStages = { "6": "RD" };
    expect(selectBoundedOcrV6Pages([a])).toBeUndefined();
    a.sourceDecision!.pageStages = { "1": "PD" };
    expect(selectBoundedOcrV6Pages([a])).toBeUndefined();
    a.sourceDecision!.pageStages = {};
    a.sectionCode = "VK";
    expect(selectBoundedOcrV6Pages([a])).toBeUndefined();
  });
});
