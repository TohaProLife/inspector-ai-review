import type { DocumentTextV4FullAuditPageBatchRead } from "@inspector-ai/contracts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readDocumentTextV4FullArtifact } from "../src/document-text-v4.js";
import { readDocumentTextV3LargeArtifact } from "../src/document-text-v3.js";
import { buildDocumentTextV4FullAuditReleaseTextLayer, validateDocumentTextV4FullAuditRelease } from "../src/document-text-v4-full-audit-release.js";
import { validateDocumentTextV4FullAuditResult } from "../src/document-text-v4-full-audit-admission.js";
import { documentTextV4FullPageBatch } from "../src/document-text-v4-full-batch.js";
import { fullSourceV4Artifact } from "./full-source-v4-fixture.js";
const canonical = (v: any): string => v !== null && typeof v === "object"
  ? Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const release = buildDocumentTextV4FullAuditReleaseTextLayer();
  const artifact = fullSourceV4Artifact(release.extractorProfile, release.extractorProfileHash);
  const source = { id: "source-db-id", apiId: artifact.sourceFileId, sha256: artifact.inputSha256, mediaType: "application/pdf" };
  const result = { disposition: "DOCUMENT_TEXT_LAYER_COMPLETED", purpose: "SOURCE_AUDIT_ONLY", resourcePolicyVersion: "document-text-v4-full-source-bounds-v1", sources: [{ sourceFileId: source.apiId, inputSha256: source.sha256, status: "EXTRACTED", artifact }], workerId: "full-source-test" };
  return { release, artifact, source, result };
}
it("admits all676 hand-authored pages with last676 quote and exact independent domain hash; old reader refuses512", () => {
  const { artifact } = fixture(), hash = sha(canonical({ hashDomain: "document-text-v4-content-v1", artifact }));
  expect(readDocumentTextV4FullArtifact(artifact)).toEqual({ status: "VALID", resourcePolicyVersion: "document-text-v4-full-source-bounds-v1", contentHash: hash });
  expect(artifact.pages.map((p: any) => p.pageNumber)).toEqual(Array.from({ length: 676 }, (_, i) => i + 1));
  expect(artifact.pages.at(-1).locatedLines[0]).toEqual({ sourcePath: [0], rawText: "FULLSOURCE PAGE 676\n", nativeBoxPointStrings: ["20", "120", "130", "130"], bboxMilliPoints: [20000, 120000, 130000, 130000] });
  expect(readDocumentTextV3LargeArtifact(artifact)).toMatchObject({ status: "ABSTAIN", reasonCode: "INPUT_LIMIT" });
});
it("refuses missing, duplicated, reordered and damaged last page without accepting partial source", () => {
  const { artifact } = fixture();
  for (const mutate of [(a: any) => a.pages.splice(200, 1), (a: any) => a.pages[200] = structuredClone(a.pages[199]), (a: any) => a.pages.reverse(), (a: any) => a.pages.at(-1).quality.metrics.locatedLineCount++]) {
    const bad = structuredClone(artifact); mutate(bad);
    expect(readDocumentTextV4FullArtifact(bad)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
  }
  expect(readDocumentTextV4FullArtifact({ pages: Array(1025).fill(null) })).toMatchObject({ reasonCode: "INPUT_LIMIT" });
  expect(readDocumentTextV4FullArtifact(Array.from({ length: 43 }, () => Array(32768).fill(null)))).toMatchObject({ reasonCode: "INPUT_LIMIT" });
});
it("binds new current source bytes, keeps historical structural read separate, rejects current stale producer", () => {
  const { release } = fixture();
  const path = new URL("../../../services/worker/inspector_worker/document_text_v4.py", import.meta.url);
  expect(release.extractorProfile.documentTextV4SourceSha256).toBe(sha(readFileSync(path)));
  expect(validateDocumentTextV4FullAuditRelease(release, { requireCurrentProducer: true })).toBe(true);
  const historical = structuredClone(release); historical.extractorProfile.documentTextV4SourceSha256 = "b".repeat(64);
  historical.extractorProfileHash = sha(canonical({ hashDomain: "document-text-extractor-profile-v1", profile: historical.extractorProfile }));
  expect(validateDocumentTextV4FullAuditRelease(historical)).toBe(true);
  expect(validateDocumentTextV4FullAuditRelease(historical, { requireCurrentProducer: true })).toBe(false);
  for (const patch of [{ purpose: "ENGINEERING" }, { resourcePolicyVersion: "document-text-v3-large-source-bounds-v1" }, { extra: true }]) expect(validateDocumentTextV4FullAuditRelease({ ...release, ...patch })).toBe(false);
});
it("completion authenticates source bijection and whole artifact; zero engineering or OCR claim", () => {
  const { release, artifact, source, result } = fixture();
  const accepted = validateDocumentTextV4FullAuditResult(result, [source], release);
  expect(accepted?.artifacts).toHaveLength(1);
  expect(accepted?.artifacts[0]?.artifact).toEqual(artifact);
  expect(accepted?.storedResult).toMatchObject({ sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1", ocrScheduled: false, calibratedProbability: null, renderedVisibility: "UNVERIFIED", authorityStatus: "SOURCE_DECLARED_UNVERIFIED" });
  for (const patch of [{ sources: [] }, { sources: [result.sources[0], result.sources[0]] }, { sources: [{ ...result.sources[0], inputSha256: "0".repeat(64) }] }]) expect(validateDocumentTextV4FullAuditResult({ ...result, ...patch }, [source], release)).toBeUndefined();
});
it("batch iteration returns all absolute pages once with hash pinned continuation and last676", () => {
  const { artifact } = fixture();
  const hash = sha(canonical({ hashDomain: "document-text-v4-content-v1", artifact }));
  const source: any = { schemaVersion: "document-text-v4-full-source-read-v1", textArtifact: artifact, textArtifactContentHash: hash };
  const numbers: number[] = []; let next: number | null = 1;
  while (next !== null) {
    const batch: DocumentTextV4FullAuditPageBatchRead = documentTextV4FullPageBatch(source, { startPage: next, pageLimit: 128, ...(next > 1 ? { expectedArtifactContentHash: hash } : {}) })!;
    expect(batch.wholeArtifactPageCount).toBe(676); expect(batch.textArtifactContentHash).toBe(hash);
    numbers.push(...batch.pages.map(p => p.pageNumber)); next = batch.nextPage;
  }
  expect(numbers).toEqual(Array.from({ length: 676 }, (_, i) => i + 1));
  const last = documentTextV4FullPageBatch(source, { startPage: 641, pageLimit: 128, expectedArtifactContentHash: hash })!;
  expect(last.pages).toHaveLength(36); expect(last.nextPage).toBeNull(); expect(last.pages.at(-1)?.pageNumber).toBe(676);
  for (const input of [{ startPage: 129, pageLimit: 128 }, { startPage: 677, pageLimit: 1, expectedArtifactContentHash: hash }, { startPage: 1, pageLimit: 129 }, { startPage: 1, pageLimit: 1, expectedArtifactContentHash: "0".repeat(64) }]) expect(documentTextV4FullPageBatch(source, input)).toBeUndefined();
});
