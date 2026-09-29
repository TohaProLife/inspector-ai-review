import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import {
  boundedOcrConfigHash, boundedOcrConfigHashV2, boundedOcrProfile,
  boundedOcrProfileId, boundedOcrProfileIdV2, boundedOcrProfileV2,
  boundedOcrConfigHashV3, boundedOcrProfileIdV3, boundedOcrProfileV3,
  boundedOcrConfigHashV4, boundedOcrProfileIdV4, boundedOcrProfileV4,
  boundedOcrConfigHashV5, boundedOcrProfileIdV5, boundedOcrProfileV5,
  boundedOcrConfigHashV6, boundedOcrProfileIdV6, boundedOcrProfileV6,
} from "../src/ocr-layout.js";
import { OCR_READ_PAGE_SIZE, projectOcrLayoutPage, projectOcrLayoutRead,
  type PersistedOcrLayoutRow } from "../src/ocr-layout-read.js";

const sourceHash = "a".repeat(64);
const manifestHash = "b".repeat(64);

function savedRow(version: 1 | 2 | 3 | 4 | 5 = 2, lineCount = 121): PersistedOcrLayoutRow {
  const profileId = version === 5 ? boundedOcrProfileIdV5
    : version === 4 ? boundedOcrProfileIdV4 : version === 3 ? boundedOcrProfileIdV3
    : version === 2 ? boundedOcrProfileIdV2 : boundedOcrProfileId;
  const configHash = version === 5 ? boundedOcrConfigHashV5
    : version === 4 ? boundedOcrConfigHashV4 : version === 3 ? boundedOcrConfigHashV3
    : version === 2 ? boundedOcrConfigHashV2 : boundedOcrConfigHash;
  const pageContent = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-1",
    inputSha256: sourceHash, pageNumber: 295,
    render: { sha256: "c".repeat(64), widthPx: 1000, heightPx: 1200, dpi: 120,
      rendererProfileId: "renderer-pdfium-5.12.1-linux-x86_64-v1" },
    provider: { profileId: "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1", script: "eslav" },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      text: `OCR ${index}`, score: 0.67, bboxPx: [1, 2, 100, 20],
    })),
  };
  const page = { ...pageContent, contentHash: sha256(canonicalJson(pageContent)) };
  const content = {
    schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: manifestHash, disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: profileId, providerConfigHash: configHash,
    outputCount: 1,
    analysis: {
      schemaVersion: version === 5 ? "bounded-ocr-layout-analysis-v5"
        : version === 4 ? "bounded-ocr-layout-analysis-v4"
        : version === 3 ? "bounded-ocr-layout-analysis-v3"
        : version === 2 ? "bounded-ocr-layout-analysis-v2" : "bounded-ocr-layout-analysis-v1",
      objectId: "00000000-0000-4000-8000-000000000002", inputManifestHash: manifestHash,
      profile: version === 5 ? boundedOcrProfileV5
        : version === 4 ? boundedOcrProfileV4 : version === 3 ? boundedOcrProfileV3
        : version === 2 ? boundedOcrProfileV2 : boundedOcrProfile,
      sourceCount: 1, ocrRequiredPageCount: 398, processedPageCount: 1,
      deferredPageCount: 397, skippedOversizePageCount: 0,
      skippedUnsupportedSourceCount: 0,
      ...(version > 1 ? { skippedRenderPixelPageCount: 0 } : {}),
      ...(version >= 3 ? { subjectCandidatePageCount: version >= 4 ? 0 : 1 } : {}),
      ...(version >= 4 ? { titleRecoveryCandidatePageCount: 1 } : {}),
      sources: [{ sourceFileId: "FIL-1", sourceSha256: sourceHash,
        mediaType: "application/pdf", pageCount: 1290,
        status: version > 1 ? "PARTIALLY_SCANNED" : "PARTIALLY_SCANNED_PAGE_BUDGET",
        ocrRequiredPageCount: 398, processedPageCount: 1,
        deferredPageCount: 397, pages: [page],
        ...(version > 1 ? { skippedRenderPixelPageCount: 0 } : {}),
        ...(version >= 3 ? { subjectCandidatePageCount: version >= 4 ? 0 : 1 } : {}),
        ...(version >= 4 ? { titleRecoveryCandidatePageCount: 1 } : {}) }],
    },
  };
  return {
    id: "00000000-0000-4000-8000-000000000001",
    content_json: content,
    content_hash: sha256(canonicalJson(content)),
    byte_size: Buffer.byteLength(canonicalJson(content), "utf8"),
    provider_profile_id: profileId, provider_config_hash: configHash,
    input_manifest_hash: manifestHash,
    object_internal_id: "00000000-0000-4000-8000-000000000002",
  };
}

function savedV6Row(): PersistedOcrLayoutRow {
  const row = savedRow(5);
  const analysis = row.content_json.analysis as any;
  const source = analysis.sources[0];
  row.provider_profile_id = row.content_json.providerProfileId = boundedOcrProfileIdV6;
  row.provider_config_hash = row.content_json.providerConfigHash = boundedOcrConfigHashV6;
  analysis.schemaVersion = "bounded-ocr-layout-analysis-v6";
  analysis.profile = boundedOcrProfileV6;
  delete analysis.subjectCandidatePageCount;
  delete analysis.titleRecoveryCandidatePageCount;
  delete source.subjectCandidatePageCount;
  delete source.titleRecoveryCandidatePageCount;
  analysis.reviewEligiblePageCount = source.reviewEligiblePageCount = 1;
  analysis.stageUnresolvedPageCount = source.stageUnresolvedPageCount = 397;
  source.selectionReasonCodes = ["PAGE_STAGE_UNRESOLVED"];
  const canonical = canonicalJson(row.content_json);
  row.content_hash = sha256(canonical);
  row.byte_size = Buffer.byteLength(canonical, "utf8");
  return row;
}

describe("bounded OCR read projection", () => {
  it.each([1, 2, 3, 4, 5] as const)("projects immutable v%s provenance and bounded scope", (version) => {
    const row = savedRow(version);
    const result = projectOcrLayoutRead("CHK-1", row);
    expect(result).toMatchObject({
      checkId: "CHK-1", status: "OCR_UNVERIFIED_BOUNDED",
      providerProfileId: row.provider_profile_id,
      processedPageCount: 1, deferredPageCount: 397,
      sources: [{ sourceFileId: "FIL-1", sourceSha256: sourceHash,
        pages: [{ pageNumber: 295, lineCount: 121, renderSha256: "c".repeat(64) }] }],
    });
    expect(JSON.stringify(result)).not.toContain("OCR 0");
    const page = projectOcrLayoutPage("CHK-1", row, "FIL-1", 295, 0);
    expect(page?.lines).toHaveLength(OCR_READ_PAGE_SIZE);
    expect(page?.lines[0]).toEqual({ ordinal: 0, text: "OCR 0", confidence: 0.67,
      bboxPx: [1, 2, 100, 20] });
    expect(page?.nextOffset).toBe(50);
    expect(projectOcrLayoutPage("CHK-1", row, "FIL-1", 295, 100)?.lines).toHaveLength(21);
    expect(projectOcrLayoutPage("CHK-1", row, "FIL-1", 295, 100)?.nextOffset).toBeNull();
    expect(projectOcrLayoutPage("CHK-1", row, "FIL-OTHER", 295, 0)).toBeUndefined();
    expect(projectOcrLayoutPage("CHK-1", row, "FIL-1", 294, 0)).toBeUndefined();
  });

  it("rejects changed stored bytes, metadata and page hashes", () => {
    const row = savedRow();
    expect(() => projectOcrLayoutRead("CHK-1", { ...row, content_hash: "0".repeat(64) }))
      .toThrow(/integrity/);
    expect(() => projectOcrLayoutRead("CHK-1", { ...row, provider_profile_id: boundedOcrProfileId }))
      .toThrow(/integrity/);
    const content = structuredClone(row.content_json);
    const page = ((content.analysis as any).sources[0].pages[0]);
    page.lines[0].text = "tampered";
    const changed = { ...row, content_json: content, content_hash: sha256(canonicalJson(content)),
      byte_size: Buffer.byteLength(canonicalJson(content), "utf8") };
    expect(() => projectOcrLayoutRead("CHK-1", changed)).toThrow(/hash mismatch/);
  });

  it("rejects invalid offsets without exposing lines", () => {
    const row = savedRow();
    expect(projectOcrLayoutPage("CHK-1", row, "FIL-1", 295, -1)).toBeUndefined();
    expect(projectOcrLayoutPage("CHK-1", row, "FIL-1", 295, 5001)).toBeUndefined();
  });

  it("rejects forged v3 subject counters even when artifact hash was recomputed", () => {
    const row = savedRow(3);
    const content = structuredClone(row.content_json);
    (content.analysis as any).sources[0].subjectCandidatePageCount = 0;
    expect(() => projectOcrLayoutRead("CHK-1", { ...row, content_json: content,
      content_hash: sha256(canonicalJson(content)),
      byte_size: Buffer.byteLength(canonicalJson(content), "utf8") })).toThrow(/integrity/);
  });

  it("reads four v5 pages and rejects same count under v4", () => {
    const row = savedRow(5, 0);
    const analysis = row.content_json.analysis as any;
    const source = analysis.sources[0];
    source.pages = [295, 296, 297, 298].map((number) => {
      const page = structuredClone(source.pages[0]);
      page.pageNumber = number;
      const { contentHash: _old, ...unhashed } = page;
      page.contentHash = sha256(canonicalJson(unhashed));
      return page;
    });
    source.processedPageCount = analysis.processedPageCount = row.content_json.outputCount = 4;
    source.deferredPageCount = analysis.deferredPageCount = 394;
    source.subjectCandidatePageCount = analysis.subjectCandidatePageCount = 4;
    source.titleRecoveryCandidatePageCount = analysis.titleRecoveryCandidatePageCount = 0;
    const canonical = canonicalJson(row.content_json);
    row.content_hash = sha256(canonical);
    row.byte_size = Buffer.byteLength(canonical, "utf8");
    expect(projectOcrLayoutRead("CHK-1", row).sources[0].pages).toHaveLength(4);
    const old = structuredClone(row);
    old.provider_profile_id = old.content_json.providerProfileId = boundedOcrProfileIdV4;
    old.provider_config_hash = old.content_json.providerConfigHash = boundedOcrConfigHashV4;
    (old.content_json.analysis as any).schemaVersion = "bounded-ocr-layout-analysis-v4";
    (old.content_json.analysis as any).profile = boundedOcrProfileV4;
    const oldCanonical = canonicalJson(old.content_json);
    old.content_hash = sha256(oldCanonical);
    old.byte_size = Buffer.byteLength(oldCanonical, "utf8");
    expect(() => projectOcrLayoutRead("CHK-1", old)).toThrow(/integrity/);
  });

  it("projects v6 review eligibility and deferral reasons without changing v5 read", () => {
    const v6 = savedV6Row();
    expect(projectOcrLayoutRead("CHK-1", v6)).toMatchObject({
      schemaVersion: "bounded-ocr-layout-analysis-v6",
      providerProfileId: boundedOcrProfileIdV6,
      reviewEligiblePageCount: 1, stageUnresolvedPageCount: 397,
      sources: [{ reviewEligiblePageCount: 1, stageUnresolvedPageCount: 397,
        selectionReasonCodes: ["PAGE_STAGE_UNRESOLVED"] }],
    });
    expect(projectOcrLayoutPage("CHK-1", v6, "FIL-1", 295, 0)?.lines[0].text).toBe("OCR 0");
    const v5 = projectOcrLayoutRead("CHK-1", savedRow(5));
    expect(v5).not.toHaveProperty("reviewEligiblePageCount");
    expect(v5.sources[0]).not.toHaveProperty("selectionReasonCodes");
  });

  it("rejects v6 counter and reason tamper after the artifact hash changes", () => {
    const row = savedV6Row();
    const changed = structuredClone(row);
    const analysis = changed.content_json.analysis as any;
    analysis.sources[0].stageUnresolvedPageCount = 396;
    changed.content_hash = sha256(canonicalJson(changed.content_json));
    changed.byte_size = Buffer.byteLength(canonicalJson(changed.content_json), "utf8");
    expect(() => projectOcrLayoutRead("CHK-1", changed)).toThrow(/integrity/);
    analysis.sources[0].stageUnresolvedPageCount = 397;
    analysis.sources[0].selectionReasonCodes = ["UNKNOWN_REASON"];
    changed.content_hash = sha256(canonicalJson(changed.content_json));
    changed.byte_size = Buffer.byteLength(canonicalJson(changed.content_json), "utf8");
    expect(() => projectOcrLayoutRead("CHK-1", changed)).toThrow(/integrity/);
  });

  it("reads four v6 pages but rejects a fifth even with recomputed hashes", () => {
    const row = savedV6Row();
    const analysis = row.content_json.analysis as any;
    const source = analysis.sources[0];
    const first = source.pages[0];
    source.pages = [295, 296, 297, 298].map((pageNumber) => {
      const page = { ...first, pageNumber };
      const { contentHash: _old, ...unhashed } = page;
      return { ...unhashed, contentHash: sha256(canonicalJson(unhashed)) };
    });
    source.processedPageCount = analysis.processedPageCount = row.content_json.outputCount = 4;
    source.deferredPageCount = analysis.deferredPageCount = 394;
    source.reviewEligiblePageCount = analysis.reviewEligiblePageCount = 4;
    source.stageUnresolvedPageCount = analysis.stageUnresolvedPageCount = 394;
    let canonical = canonicalJson(row.content_json);
    row.content_hash = sha256(canonical);
    row.byte_size = Buffer.byteLength(canonical, "utf8");
    expect(projectOcrLayoutRead("CHK-1", row).sources[0].pages).toHaveLength(4);
    const fifth = { ...source.pages[0], pageNumber: 299 };
    const { contentHash: _old, ...unhashed } = fifth;
    fifth.contentHash = sha256(canonicalJson(unhashed));
    source.pages.push(fifth);
    source.processedPageCount = analysis.processedPageCount = row.content_json.outputCount = 5;
    source.deferredPageCount = analysis.deferredPageCount = 393;
    source.reviewEligiblePageCount = analysis.reviewEligiblePageCount = 5;
    source.stageUnresolvedPageCount = analysis.stageUnresolvedPageCount = 393;
    canonical = canonicalJson(row.content_json);
    row.content_hash = sha256(canonical);
    row.byte_size = Buffer.byteLength(canonical, "utf8");
    expect(() => projectOcrLayoutRead("CHK-1", row)).toThrow(/integrity/);
  });
});
