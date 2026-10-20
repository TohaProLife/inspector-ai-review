/** Additional expected failure/history presentation frozen before status selector correction. */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { CheckRun, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { SourceAuditV3LargeWorkspace, SourceAuditV3LargeStatus, selectSourceAuditV3Large, selectSourceAuditV3LargeStatus, listSourceAuditV3Large, startSourceAuditV3Large, readSourceAuditV3LargeCheck } from "./SourceAuditV3LargeWorkspace";
import { buildSourceTextV3LargeIndex, sourceTextEvidence } from "./source-text-explorer";
const profile = "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1" as const;
const ready = { id: "OLD", objectId: "OBJ", mode: "NORMAL", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: profile, progress: 100,
  status: "PARTIAL", startedAt: "2026-10-18T00:00:00Z", completedAt: "2026-10-18T00:01:00Z", currentStage: "Готово", stats: {} } as CheckRun;
afterEach(() => vi.restoreAllMocks());
it("reports new failed attempt while keeping old sealed result independently selectable", () => {
  const failed = { ...ready, id: "FAILED", status: "FAILED", startedAt: "2026-10-18T00:02:00Z",
    failure: { jobType: "DOCUMENT_TEXT_LAYER", code: "INPUT_LIMIT", message: "Whole artifact rejected" } } as CheckRun;
  expect(selectSourceAuditV3Large([ready, failed], "OBJ")?.id).toBe("OLD");
  expect(selectSourceAuditV3LargeStatus([ready, failed], "OBJ")?.id).toBe("FAILED");
  const html = renderToStaticMarkup(<SourceAuditV3LargeStatus check={selectSourceAuditV3LargeStatus([ready, failed], "OBJ")} />);
  expect(html).toContain("INPUT_LIMIT"); expect(html).not.toContain("Исходный текст готов");
  expect(selectSourceAuditV3LargeStatus([ready, { ...failed, objectId: "OTHER" }], "OBJ")?.id).toBe("OLD");
});
it("workspace key discards stale object/source/SHA/review state", () => {
  const file = { id: "SRC", sha256: "a".repeat(64) } as SourceFileSummary;
  const props = { objectId: "OBJ", file, reviewHash: null, canRun: true };
  const key = SourceAuditV3LargeWorkspace(props).key;
  for (const change of [{ objectId: "OTHER" }, { file: { ...file, id: "OTHER" } }, { file: { ...file, sha256: "b".repeat(64) } }, { reviewHash: "b".repeat(64) }])
    expect(SourceAuditV3LargeWorkspace({ ...props, ...change }).key).not.toBe(key);
});
it("list/start/poll discard response when same signal aborts during request", async () => {
  const first = new AbortController(), second = new AbortController(), third = new AbortController();
  vi.spyOn(api, "listObjectChecks").mockImplementation(async () => { first.abort(); return { items: [ready] }; });
  vi.spyOn(api, "startSourceAuditV3LargeVertical").mockImplementation(async () => { second.abort(); return ready; });
  vi.spyOn(api, "getCheck").mockImplementation(async () => { third.abort(); return ready; });
  await expect(listSourceAuditV3Large("OBJ", first.signal)).rejects.toThrow();
  await expect(startSourceAuditV3Large("OBJ", second.signal)).rejects.toThrow();
  await expect(readSourceAuditV3LargeCheck("OBJ", "OLD", third.signal)).rejects.toThrow();
});
it("retains unlocated raw/path/reason as a candidate without manufactured PDF evidence", () => {
  const artifact = structuredClone(JSON.parse(readFileSync(new URL("../../../fixtures/document-text-v3-vertical-v1/qa-whole-manual-goldens.json", import.meta.url), "utf8")).cases[0].artifact);
  // Synthetic UI channel capacity case, not a producer/geometry golden.
  artifact.pages[0].unlocatedLines.push({ sourcePath: [4, 0], rawText: "НЕРАЗМЕЧЕННАЯ\n", nativeBoxPointStrings: ["20.0", "10.0", "20.0", "10.0"], reasonCode: "NATIVE_ZERO_AREA" });
  const file = { id: artifact.sourceFileId, sha256: artifact.inputSha256, stages: ["PD"], pageCount: 1 } as SourceFileSummary;
  const data = { schemaVersion: "document-text-v3-large-source-read-v1", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: profile,
    resourcePolicyVersion: "document-text-v3-large-source-bounds-v1", checkId: "CHK", sourceFileId: file.id, sourceSha256: file.sha256,
    inputManifestHash: "b".repeat(64), textStageContentHash: "c".repeat(64), textArtifactByteSha256: "c".repeat(64), textArtifactContentHash: "d".repeat(64), extractorProfileHash: artifact.extractorProfileHash,
    stage: "PD", pageStages: {}, latestReviewHash: null, authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact } as const;
  const index = buildSourceTextV3LargeIndex({ objectId: "OBJ", checkId: "CHK", file, reviewHash: null }, data as any);
  const row = index.lines.find(line => line.rawText === "НЕРАЗМЕЧЕННАЯ\n")!;
  expect(row.sourcePath).toEqual([4, 0]); expect(row.unlocatedReasonCode).toBe("NATIVE_ZERO_AREA"); expect(row.bboxMilliPoints).toBeNull();
  expect(index.unlocatedLines).toBe(1); expect(() => sourceTextEvidence(index, row)).toThrow();
});
