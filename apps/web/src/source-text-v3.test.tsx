import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { buildSourceTextV3Index, loadSearchableSourceText, searchSourceText, sourceTextEvidence } from "./source-text-explorer";
import { SourceTextSearchResults } from "./SourceTextExplorer";
import type { DocumentTextV3AuditSourceRead, SourceFileSummary } from "@inspector-ai/contracts";

const manual = (folder: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${folder}/qa-core-manual-goldens.json`, import.meta.url), "utf8")).cases[0].artifact;
function fixture(artifact = manual("document-text-v3-v1")) {
  const file: SourceFileSummary = { id: artifact.sourceFileId, sha256: artifact.inputSha256, stages: ["PD"], name: "Original PDF",
    pageCount: artifact.pageCount, size: 100, registeredAt: "2026-10-18T00:00:00Z", review: null };
  const identity = { objectId: "OBJ-V3", checkId: "CHK-V3", file, reviewHash: null };
  const data: DocumentTextV3AuditSourceRead = { schemaVersion: "document-text-v3-source-read-v1", purpose: "SOURCE_AUDIT_ONLY",
    checkId: identity.checkId, sourceFileId: file.id, sourceSha256: file.sha256, inputManifestHash: "b".repeat(64),
    textStageContentHash: "c".repeat(64), textArtifactByteSha256: "c".repeat(64), textArtifactContentHash: "d".repeat(64),
    extractorProfileHash: artifact.extractorProfileHash, stage: "PD", pageStages: {}, latestReviewHash: null,
    authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact };
  return { identity, data };
}
afterEach(() => vi.restoreAllMocks());
it("retains every manual raw row/path, including23 unlocated rows and their reasons without a v2 facade", () => {
  const { identity, data } = fixture(), before = structuredClone(data), index = buildSourceTextV3Index(identity, data);
  expect(index.lines).toHaveLength(25); expect(index.unlocatedLines).toBe(23);
  for (const page of data.textArtifact.pages) for (const channel of ["locatedLines", "unlocatedLines"] as const)
    for (const line of page[channel]) {
      const found = index.lines.find(row => row.pageNumber === page.pageNumber && JSON.stringify(row.sourcePath) === JSON.stringify(line.sourcePath))!;
      expect(found.rawText).toBe(line.rawText); expect(found.blockIndex).toBeUndefined(); expect(found.lineIndex).toBeUndefined();
      expect(found.bboxMilliPoints).toEqual("bboxMilliPoints" in line ? line.bboxMilliPoints : null);
      if ("reasonCode" in line) { expect(found.unlocatedReasonCode).toBe(line.reasonCode); expect(() => sourceTextEvidence(index, found)).toThrow(); }
    }
  expect(data).toEqual(before); expect(index.origin).toMatchObject({ renderedVisibility: "UNVERIFIED", calibratedProbability: null });
});
it("shows full nested path and an explicit visibility caveat with original raw LF; no invented block index", () => {
  const real = JSON.parse(readFileSync(new URL("../../../fixtures/portable-historical-tests-v1/root-real-F0161-full-v3.json", import.meta.url), "utf8"));
  const { identity, data } = fixture(real), index = buildSourceTextV3Index(identity, data);
  const line = index.lines.find(row => row.pageNumber === 13 && JSON.stringify(row.sourcePath) === "[154,0,0]")!, query = "10";
  expect(line.rawText).toBe("10\n"); expect(searchSourceText(index, query).items).toContainEqual(line);
  const html = renderToStaticMarkup(<SourceTextSearchResults index={index} query={query} onSelect={() => {}} />);
  expect(html).toContain(line.sourcePath!.join(" / ")); expect(html).toContain("Видимость строки на PDF не подтверждена");
  expect(html).not.toMatch(/блок 1|строка 1/u); expect(html).toContain(line.rawText);
});
it("rejects changed identity, profile binding, malformed path and fake unlocated geometry", () => {
  for (const mutate of [
    (x: any) => x.sourceSha256 = "a".repeat(64), (x: any) => x.latestReviewHash = "a".repeat(64),
    (x: any) => x.extractorProfileHash = "a".repeat(64), (x: any) => x.renderedVisibility = "VERIFIED",
    (x: any) => x.textArtifact.pages[0].locatedLines[0].sourcePath = [],
    (x: any) => x.textArtifact.pages[0].unlocatedLines[0].bboxMilliPoints = [1, 1, 2, 2],
  ]) { const { identity, data } = fixture(); mutate(data); expect(() => buildSourceTextV3Index(identity, data)).toThrow(); }
});
it("falls back from only old404 to authenticated v3; never masks forbidden errors or cancellation", async () => {
  const { identity, data } = fixture();
  vi.spyOn(api, "getCheck").mockResolvedValue({ id: identity.checkId, objectId: identity.objectId, mode: "NORMAL", progress: 100,
    status: "PARTIAL", completedAt: "2026-10-18T00:00:00Z" } as any);
  const old = vi.spyOn(api, "getSourceInventoryPages").mockRejectedValue(Object.assign(Error("Unavailable"), { status: 404 }));
  const v3 = vi.spyOn(api, "getDocumentTextV3Source").mockResolvedValue(data);
  expect((await loadSearchableSourceText(identity, new AbortController().signal)).lines).toHaveLength(25);
  expect(v3).toHaveBeenCalledOnce(); v3.mockClear(); old.mockRejectedValue(Object.assign(Error("Forbidden"), { status: 403 }));
  await expect(loadSearchableSourceText(identity, new AbortController().signal)).rejects.toThrow("Forbidden"); expect(v3).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(); await expect(loadSearchableSourceText(identity, controller.signal)).rejects.toThrow();
});
