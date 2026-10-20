/** Hand-authored UI transport expectations. No producer output or public labels as oracle. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { CheckRun, DocumentTextV4FullAuditPageBatchRead, DocumentTextV4Page, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { buildSourceTextV4FullIndex, loadSearchableSourceText, searchSourceText, sourceTextEvidence } from "./source-text-explorer";
import { SourceTextSearchResults } from "./SourceTextExplorer";

const hash = (letter: string) => letter.repeat(64);
function fixture(count = 676) {
  const file: SourceFileSummary = { id: "FIL-FULL", sha256: hash("a"), stages: ["RD"], name: "Authored complete PDF",
    pageCount: count, size: 100, registeredAt: "2026-10-20T10:00:00Z", review: null };
  const identity = { objectId: "OBJ-FULL", checkId: "CHK-FULL", file, reviewHash: null };
  const check: CheckRun = { id: identity.checkId, objectId: identity.objectId, mode: "NORMAL", purpose: "SOURCE_AUDIT_ONLY",
    sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1", progress: 100, status: "PARTIAL", startedAt: "2026-10-20T10:00:00Z",
    completedAt: "2026-10-20T10:02:00Z", currentStage: "Готово", modelVersion: null, rulesVersion: "test", stats: {} as CheckRun["stats"] };
  const pages: DocumentTextV4Page[] = Array.from({ length: count }, (_, index) => {
    const rawText = `FULLSOURCE PAGE ${index + 1}\n`;
    return { pageNumber: index + 1, widthMilliPoints: 200000, heightMilliPoints: 100000,
      nativeFrame: { coordinateSystem: "PDFMINER_LAYOUT_POINTS", visibleBoxPointStrings: ["0", "0", "200", "100"] },
      locatedLines: [{ sourcePath: [0], rawText, nativeBoxPointStrings: ["20", "60", "100", "80"], bboxMilliPoints: [20000, 60000, 100000, 80000] }],
      unlocatedLines: [], quality: { disposition: "TEXT_LAYER_CANDIDATE", reasonCodes: [], metrics: { locatedLineCount: 1,
        unlocatedLineCount: 0, locatedNonWhitespaceCharacters: rawText.replace(/\s/gu, "").length,
        unlocatedNonWhitespaceCharacters: 0, replacementCharacters: 0, disallowedControlCharacters: 0, cidPlaceholders: 0 } } };
  });
  const batches: DocumentTextV4FullAuditPageBatchRead[] = [];
  for (let start = 1; start <= count; start += 128) {
    const end = Math.min(start + 127, count);
    batches.push({ schemaVersion: "document-text-v4-full-source-page-batch-v1", purpose: "SOURCE_AUDIT_ONLY",
      sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1", resourcePolicyVersion: "document-text-v4-full-source-bounds-v1",
      checkId: identity.checkId, sourceFileId: file.id, sourceSha256: file.sha256, inputManifestHash: hash("b"),
      textStageContentHash: hash("c"), textArtifactByteSha256: hash("c"), textArtifactContentHash: hash("d"), extractorProfileHash: hash("e"),
      stage: "UNRESOLVED", pageStages: {}, latestReviewHash: null, authorityStatus: "SOURCE_DECLARED_UNVERIFIED",
      renderedVisibility: "UNVERIFIED", calibratedProbability: null, wholeArtifactPageCount: count, startPage: start,
      pageLimit: 128, nextPage: end < count ? end + 1 : null, pages: pages.slice(start - 1, end) });
  }
  return { identity, check, batches };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("assembles all676 once, finds the literal last-page quote and preserves exact viewer coordinates", () => {
  const { identity, batches } = fixture(), before = structuredClone(batches);
  const index = buildSourceTextV4FullIndex(identity, batches);
  expect(index.pageCount).toBe(676); expect(index.lines).toHaveLength(676);
  expect(index.lines.map(line => line.pageNumber)).toEqual(Array.from({ length: 676 }, (_, n) => n + 1));
  expect(index.lines.at(-1)?.rawText).toBe("FULLSOURCE PAGE 676\n");
  expect(index.qualitySummary).toEqual({ candidatePages: 676, partialPages: 0, ocrRequiredPages: 0 });
  const found = searchSourceText(index, "PAGE 676"); expect(found.total).toBe(1);
  const evidence = sourceTextEvidence(index, found.items[0]!);
  expect(evidence).toMatchObject({ pageNumber: 676, sourceFileId: "FIL-FULL", sourceSha256: hash("a"), unit: "", stage: "UNRESOLVED" });
  expect(found.items[0]!.bboxMilliPoints).toEqual([20000, 60000, 100000, 80000]);
  [0.1, 0.2, 0.5, 0.4].forEach((coordinate, index) => expect(evidence.bbox![index]).toBeCloseTo(coordinate, 14));
  expect(batches).toEqual(before); expect(index.identity).not.toBe(identity);
  expect(index.origin).toMatchObject({ calibratedProbability: null, renderedVisibility: "UNVERIFIED", authorityStatus: "SOURCE_DECLARED_UNVERIFIED" });
  const html = renderToStaticMarkup(<SourceTextSearchResults index={index} query="PAGE 676" onSelect={() => {}} />);
  expect(html).toContain("PDF 676"); expect(html).toContain("Открыть строку на PDF"); expect(html).not.toContain("<img");
});
it("accepts exact1024 pages, eight batches; no page513 ceiling in V4", () => {
  const { identity, batches } = fixture(1024), index = buildSourceTextV4FullIndex(identity, batches);
  expect(batches).toHaveLength(8); expect(index.lines.at(-1)?.pageNumber).toBe(1024);
});
it.each(["missing", "duplicate", "reorder", "last", "early-end", "skip", "loop", "extra-batch", "over1024", "file-count"])("refuses incomplete page bijection or cursor: %s", kind => {
  const { identity, batches } = fixture();
  if (kind === "missing") batches[1]!.pages.splice(3, 1);
  if (kind === "duplicate") batches[1]!.pages[3] = structuredClone(batches[1]!.pages[2]!);
  if (kind === "reorder") batches[1]!.pages.reverse();
  if (kind === "last") batches.at(-1)!.pages.pop();
  if (kind === "early-end") batches[0]!.nextPage = null;
  if (kind === "skip") batches[0]!.nextPage = 257;
  if (kind === "loop") batches[0]!.nextPage = 1;
  if (kind === "extra-batch") batches.push(structuredClone(batches.at(-1)!));
  if (kind === "over1024") batches[0]!.wholeArtifactPageCount = 1025;
  if (kind === "file-count") identity.file.pageCount = 675;
  expect(() => buildSourceTextV4FullIndex(identity, batches)).toThrow();
});
it.each(["manifest", "artifact", "byteHash", "profileHash", "review", "stage", "pageStages", "schema", "profile", "resource", "purpose", "authority", "probability", "visibility", "source", "sha", "check", "extra"])("rejects changed or detached batch metadata: %s", kind => {
  const { identity, batches } = fixture(), batch = batches[1]! as any;
  const mutations: Record<string, () => void> = {
    manifest: () => batch.inputManifestHash = hash("f"), artifact: () => batch.textArtifactContentHash = hash("f"),
    byteHash: () => batch.textArtifactByteSha256 = hash("f"), profileHash: () => batch.extractorProfileHash = hash("f"),
    review: () => batch.latestReviewHash = hash("f"), stage: () => batch.stage = "RD", pageStages: () => batch.pageStages = { "676": "RD" },
    schema: () => batch.schemaVersion = "document-text-v3-large-source-read-v1", profile: () => batch.sourceAuditProfileVersion = "UNKNOWN",
    resource: () => batch.resourcePolicyVersion = "document-text-v3-large-source-bounds-v1", purpose: () => batch.purpose = "ENGINEERING",
    authority: () => batch.authorityStatus = "VERIFIED", probability: () => batch.calibratedProbability = 0.99,
    visibility: () => batch.renderedVisibility = "VERIFIED", source: () => batch.sourceFileId = "FOREIGN",
    sha: () => batch.sourceSha256 = hash("f"), check: () => batch.checkId = "FOREIGN", extra: () => batch.extra = null,
  };
  mutations[kind]!(); expect(() => buildSourceTextV4FullIndex(identity, batches)).toThrow();
});
it.each(["duplicate-path", "box", "row-extra", "path", "quality-count", "frame", "getter", "unicode"])("rejects unsafe or inconsistent presentation geometry: %s", kind => {
  const { identity, batches } = fixture(), page = batches.at(-1)!.pages.at(-1)! as any; let calls = 0;
  if (kind === "duplicate-path") page.locatedLines.push(structuredClone(page.locatedLines[0]));
  if (kind === "box") page.locatedLines[0].bboxMilliPoints = [0, 0, 300000, 10000];
  if (kind === "row-extra") page.locatedLines[0].reasonCode = "NATIVE_ZERO_AREA";
  if (kind === "path") page.locatedLines[0].sourcePath = [32768];
  if (kind === "quality-count") page.quality.metrics.locatedLineCount = 2;
  if (kind === "frame") page.nativeFrame.coordinateSystem = "UNKNOWN";
  if (kind === "getter") Object.defineProperty(page, "extra", { enumerable: true, get() { calls++; return null; } });
  if (kind === "unicode") page.locatedLines[0].rawText = "\ud800";
  expect(() => buildSourceTextV4FullIndex(identity, batches)).toThrow(); expect(calls).toBe(0);
});
it("keeps unlocated raw lines searchable without inventing an evidence box or an OCR result", () => {
  const { identity, batches } = fixture(1), page = batches[0]!.pages[0]!;
  page.locatedLines = []; page.unlocatedLines = [{ sourcePath: [0], rawText: "NO GEOMETRY\n", nativeBoxPointStrings: ["0", "0", "0", "0"], reasonCode: "NATIVE_ZERO_AREA" }];
  page.quality = { disposition: "OCR_REQUIRED", reasonCodes: ["NO_LOCATED_TEXT", "UNLOCATED_TEXT_PRESENT"], metrics: { locatedLineCount: 0,
    unlocatedLineCount: 1, locatedNonWhitespaceCharacters: 0, unlocatedNonWhitespaceCharacters: 10, replacementCharacters: 0, disallowedControlCharacters: 0, cidPlaceholders: 0 } };
  const index = buildSourceTextV4FullIndex(identity, batches);
  expect(index.unlocatedLines).toBe(1); expect(index.qualitySummary.ocrRequiredPages).toBe(1);
  expect(searchSourceText(index, "GEOMETRY").total).toBe(1); expect(() => sourceTextEvidence(index, index.lines[0]!)).toThrow();
});
it("loads sealed V4 only through six hash pinned batches, publishes full index and no old route fallback", async () => {
  const { identity, check, batches } = fixture(), signal = new AbortController().signal;
  const get = vi.spyOn(api, "getCheck").mockResolvedValue(check), progress = vi.fn();
  const read = vi.spyOn(api, "getDocumentTextV4FullPageBatch").mockImplementation(async (_c, _f, input) => structuredClone(batches.find(batch => batch.startPage === input.startPage)!));
  const old = vi.spyOn(api, "getDocumentTextV3LargeSource"), v2 = vi.spyOn(api, "getSourceInventoryPages");
  const index = await loadSearchableSourceText(identity, signal, progress);
  expect(index.pageCount).toBe(676); expect(get).toHaveBeenCalledWith(identity.checkId, signal); expect(read).toHaveBeenCalledTimes(6);
  expect(read.mock.calls.map(call => call[2])).toEqual([1, 129, 257, 385, 513, 641].map(startPage => ({ startPage, pageLimit: 128, ...(startPage > 1 ? { expectedArtifactContentHash: hash("d") } : {}) })));
  expect(read.mock.calls.every(call => call[3] === signal)).toBe(true); expect(progress.mock.calls.map(call => call[0])).toEqual([128, 256, 384, 512, 640, 676].map(loadedPages => ({ loadedPages, totalPages: 676 })));
  expect(old).not.toHaveBeenCalled(); expect(v2).not.toHaveBeenCalled();
});
it("fails before source read for unsealed/wrong object/profile and never downgrades V4 source errors", async () => {
  const { identity, check } = fixture(), get = vi.spyOn(api, "getCheck").mockResolvedValue(check);
  const read = vi.spyOn(api, "getDocumentTextV4FullPageBatch"), old = vi.spyOn(api, "getDocumentTextV3LargeSource");
  for (const patch of [{ objectId: "OTHER" }, { progress: 99 }, { completedAt: null }, { status: "FAILED" as const }, { purpose: undefined }, { sourceAuditProfileVersion: "UNKNOWN" as any }]) {
    get.mockResolvedValue({ ...check, ...patch }); await expect(loadSearchableSourceText(identity, new AbortController().signal)).rejects.toThrow();
  }
  expect(read).not.toHaveBeenCalled(); get.mockResolvedValue(check);
  read.mockRejectedValue(Object.assign(Error("V4 unavailable"), { status: 404 }));
  await expect(loadSearchableSourceText(identity, new AbortController().signal)).rejects.toThrow("V4 unavailable"); expect(old).not.toHaveBeenCalled();
});
it("abort during ignored-signal response prevents another batch or publishing partial searchable text", async () => {
  const { identity, check, batches } = fixture(), control = new AbortController();
  vi.spyOn(api, "getCheck").mockResolvedValue(check);
  const read = vi.spyOn(api, "getDocumentTextV4FullPageBatch").mockImplementation(async () => { control.abort(); return batches[0]!; });
  const progress = vi.fn(); await expect(loadSearchableSourceText(identity, control.signal, progress)).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1); expect(progress).not.toHaveBeenCalled();
});
it("abort from final progress callback still prevents index publication", async () => {
  const { identity, check, batches } = fixture(1), control = new AbortController();
  vi.spyOn(api, "getCheck").mockResolvedValue(check);
  vi.spyOn(api, "getDocumentTextV4FullPageBatch").mockResolvedValue(batches[0]!);
  await expect(loadSearchableSourceText(identity, control.signal, () => control.abort())).rejects.toThrow();
});
it("refuses aggregate32M bytes even when every batch is individually within its transport bound", () => {
  const { identity, batches } = fixture(), text = "x".repeat(1800000);
  for (const batch of batches) {
    const page = batch.pages[0]!, row = page.locatedLines[0]!;
    page.locatedLines = Array.from({ length: 4 }, (_, n) => ({ ...structuredClone(row), sourcePath: [n], rawText: text }));
    page.quality.metrics.locatedLineCount = 4; page.quality.metrics.locatedNonWhitespaceCharacters = 7200000;
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThan(33554432);
  }
  expect(() => buildSourceTextV4FullIndex(identity, batches)).toThrow(/32 000 000/u);
}, 30000);
it("refuses aggregate1.4M native nodes independently of valid row count and individual1.5M response bound", () => {
  const { identity, batches } = fixture(1), page = batches[0]!.pages[0]!, row = page.locatedLines[0]!;
  page.locatedLines = Array.from({ length: 30000 }, (_, n) => ({ ...structuredClone(row), sourcePath: [n, ...Array(31).fill(0)], rawText: "x" }));
  page.quality.metrics.locatedLineCount = 30000; page.quality.metrics.locatedNonWhitespaceCharacters = 30000;
  function nodes(value: unknown): number {
    if (Array.isArray(value)) return 1 + value.reduce((sum, child) => sum + nodes(child), 0);
    if (value !== null && typeof value === "object") return 1 + Object.entries(value).reduce((sum, [, child]) => sum + 1 + nodes(child), 0);
    return 1;
  }
  expect(nodes(batches[0])).toBeGreaterThan(1400000); expect(nodes(batches[0])).toBeLessThan(1500000);
  expect(() => buildSourceTextV4FullIndex(identity, batches)).toThrow(/допустимые пределы/u);
}, 30000);
it("V4 rejects a trailing newline SHA, rather than accepting an end-anchor match", () => {
  const { identity, batches } = fixture(1); identity.file.sha256 += "\n"; batches[0]!.sourceSha256 += "\n";
  expect(() => buildSourceTextV4FullIndex(identity, batches)).toThrow();
});
