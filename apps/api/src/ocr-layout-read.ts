import { canonicalJson, sha256 } from "./canonical-json.js";
import {
  boundedOcrConfigHash, boundedOcrConfigHashV2, boundedOcrProfile,
  boundedOcrProfileId, boundedOcrProfileIdV2, boundedOcrProfileV2,
  boundedOcrConfigHashV3, boundedOcrProfileIdV3, boundedOcrProfileV3,
  boundedOcrConfigHashV4, boundedOcrProfileIdV4, boundedOcrProfileV4,
  boundedOcrConfigHashV5, boundedOcrProfileIdV5, boundedOcrProfileV5,
  boundedOcrConfigHashV6, boundedOcrProfileIdV6, boundedOcrProfileV6,
} from "./ocr-layout.js";
import type { OcrLayoutPageRead, OcrLayoutRead } from "./repository.js";

export interface PersistedOcrLayoutRow {
  id: string;
  content_json: Record<string, unknown>;
  content_hash: string;
  byte_size: number | string;
  provider_profile_id: string;
  provider_config_hash: string;
  input_manifest_hash: string;
  object_internal_id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const v6ReasonCodes = new Set([
  "PAGE_BUDGET_EXHAUSTED", "PAGE_STAGE_UNRESOLVED", "RENDER_PIXEL_LIMIT",
  "SECTION_NOT_AR_VK", "SOURCE_REVIEW_NOT_CURRENT_APPROVED",
  "SOURCE_REVIEW_REQUIRED", "SOURCE_TOO_LARGE",
]);

function verifiedAnalysis(row: PersistedOcrLayoutRow) {
  const content = row.content_json;
  const canonical = canonicalJson(content);
  const expectedHash = row.content_hash.trim();
  const profileId = row.provider_profile_id;
  const profileHash = profileId === boundedOcrProfileId ? boundedOcrConfigHash
    : profileId === boundedOcrProfileIdV2 ? boundedOcrConfigHashV2
      : profileId === boundedOcrProfileIdV3 ? boundedOcrConfigHashV3
        : profileId === boundedOcrProfileIdV4 ? boundedOcrConfigHashV4
          : profileId === boundedOcrProfileIdV5 ? boundedOcrConfigHashV5
            : profileId === boundedOcrProfileIdV6 ? boundedOcrConfigHashV6 : null;
  const isV4Family = profileId === boundedOcrProfileIdV4 || profileId === boundedOcrProfileIdV5;
  const isV6 = profileId === boundedOcrProfileIdV6;
  const analysis = content.analysis;
  if (!profileHash || sha256(canonical) !== expectedHash
    || Buffer.byteLength(canonical, "utf8") !== Number(row.byte_size)
    || content.schemaVersion !== "analysis-stage-result-v2"
    || content.jobType !== "DOCUMENT_OCR_LAYOUT"
    || content.disposition !== "OCR_LAYOUT_BOUNDED"
    || content.reasonCode !== "BOUNDED_OCR_ONLY"
    || content.providerKind !== "OCR_LAYOUT"
    || content.providerProfileId !== profileId
    || content.providerConfigHash !== profileHash
    || row.provider_config_hash.trim() !== profileHash
    || content.inputManifestHash !== row.input_manifest_hash.trim()
    || !isRecord(analysis)
    || analysis.schemaVersion !== (profileId === boundedOcrProfileId
      ? "bounded-ocr-layout-analysis-v1" : profileId === boundedOcrProfileIdV2
        ? "bounded-ocr-layout-analysis-v2" : profileId === boundedOcrProfileIdV3
          ? "bounded-ocr-layout-analysis-v3" : profileId === boundedOcrProfileIdV4
            ? "bounded-ocr-layout-analysis-v4" : isV6
              ? "bounded-ocr-layout-analysis-v6" : "bounded-ocr-layout-analysis-v5")
    || analysis.objectId !== row.object_internal_id
    || analysis.inputManifestHash !== row.input_manifest_hash.trim()
    || !isRecord(analysis.profile)
    || canonicalJson(analysis.profile) !== canonicalJson(profileId === boundedOcrProfileId
      ? boundedOcrProfile : profileId === boundedOcrProfileIdV2
        ? boundedOcrProfileV2 : profileId === boundedOcrProfileIdV3
          ? boundedOcrProfileV3 : profileId === boundedOcrProfileIdV4
            ? boundedOcrProfileV4 : isV6 ? boundedOcrProfileV6 : boundedOcrProfileV5)
    || !isCount(analysis.sourceCount) || !isCount(analysis.ocrRequiredPageCount)
    || !isCount(analysis.processedPageCount) || !isCount(analysis.deferredPageCount)
    || ([boundedOcrProfileIdV3, boundedOcrProfileIdV4, boundedOcrProfileIdV5].includes(profileId)
      && (!isCount(analysis.subjectCandidatePageCount)
        || !isCount(analysis.skippedRenderPixelPageCount)
        || analysis.subjectCandidatePageCount > analysis.ocrRequiredPageCount
        || (isV4Family && (!isCount(analysis.titleRecoveryCandidatePageCount)
          || analysis.titleRecoveryCandidatePageCount > analysis.ocrRequiredPageCount
          || analysis.titleRecoveryCandidatePageCount + analysis.subjectCandidatePageCount
            > analysis.ocrRequiredPageCount))
        || analysis.skippedRenderPixelPageCount > analysis.subjectCandidatePageCount
          + (isV4Family ? Number(analysis.titleRecoveryCandidatePageCount) : 0)))
    || (isV6 && (!isCount(analysis.skippedRenderPixelPageCount)
      || !isCount(analysis.reviewEligiblePageCount)
      || !isCount(analysis.stageUnresolvedPageCount)
      || analysis.reviewEligiblePageCount + analysis.stageUnresolvedPageCount
        > analysis.ocrRequiredPageCount
      || analysis.processedPageCount > analysis.reviewEligiblePageCount
      || analysis.skippedRenderPixelPageCount > analysis.reviewEligiblePageCount))
    || !Array.isArray(analysis.sources) || analysis.sources.length !== analysis.sourceCount
    || analysis.processedPageCount > (profileId === boundedOcrProfileIdV5 || isV6 ? 4 : 2)
    || content.outputCount !== analysis.processedPageCount) {
    throw new Error("OCR layout artifact integrity check failed");
  }
  return { analysis, profileId, expectedHash };
}

function projectSources(analysis: Record<string, unknown>, profileId: string): OcrLayoutRead["sources"] {
  const isV4Family = profileId === boundedOcrProfileIdV4 || profileId === boundedOcrProfileIdV5;
  const isV6 = profileId === boundedOcrProfileIdV6;
  const sources: OcrLayoutRead["sources"] = [];
  let processed = 0;
  let deferred = 0;
  let required = 0;
  let subjectCandidates = 0;
  let titleCandidates = 0;
  let renderSkipped = 0;
  let reviewEligible = 0;
  let stageUnresolved = 0;
  const seenSources = new Set<string>();
  for (const value of analysis.sources as unknown[]) {
    if (!isRecord(value) || typeof value.sourceFileId !== "string"
      || !isHash(value.sourceSha256) || typeof value.status !== "string"
      || !isCount(value.ocrRequiredPageCount) || !isCount(value.processedPageCount)
      || !isCount(value.deferredPageCount) || !Array.isArray(value.pages)
      || value.pages.length !== value.processedPageCount
      || value.processedPageCount + value.deferredPageCount !== value.ocrRequiredPageCount
      || ([boundedOcrProfileIdV3, boundedOcrProfileIdV4, boundedOcrProfileIdV5].includes(profileId)
        && (!isCount(value.subjectCandidatePageCount)
          || !isCount(value.skippedRenderPixelPageCount)
          || value.subjectCandidatePageCount > value.ocrRequiredPageCount
          || (isV4Family && (!isCount(value.titleRecoveryCandidatePageCount)
            || value.titleRecoveryCandidatePageCount > value.ocrRequiredPageCount
            || value.titleRecoveryCandidatePageCount + value.subjectCandidatePageCount
              > value.ocrRequiredPageCount))
          || value.processedPageCount > value.subjectCandidatePageCount
            + (isV4Family ? Number(value.titleRecoveryCandidatePageCount) : 0)
          || value.skippedRenderPixelPageCount > value.subjectCandidatePageCount
            + (isV4Family ? Number(value.titleRecoveryCandidatePageCount) : 0)))
      || (isV6 && (!isCount(value.skippedRenderPixelPageCount)
        || !isCount(value.reviewEligiblePageCount)
        || !isCount(value.stageUnresolvedPageCount)
        || value.reviewEligiblePageCount + value.stageUnresolvedPageCount
          > value.ocrRequiredPageCount
        || value.processedPageCount > value.reviewEligiblePageCount
        || value.skippedRenderPixelPageCount > value.reviewEligiblePageCount
        || !Array.isArray(value.selectionReasonCodes)
        || value.selectionReasonCodes.some((reason) =>
          typeof reason !== "string" || !v6ReasonCodes.has(reason))
        || new Set(value.selectionReasonCodes).size !== value.selectionReasonCodes.length
        || [...value.selectionReasonCodes].sort().some((reason, index) =>
          reason !== (value.selectionReasonCodes as string[])[index])))
      || !(value.pageCount === null || isCount(value.pageCount))) {
      throw new Error("OCR layout source integrity check failed");
    }
    if (seenSources.has(value.sourceFileId)) throw new Error("Duplicate OCR layout source");
    seenSources.add(value.sourceFileId);
    const pages: OcrLayoutRead["sources"][number]["pages"] = [];
    const seenPages = new Set<number>();
    for (const page of value.pages) {
      if (!isRecord(page) || page.schemaVersion !== "document-ocr-page-v1"
        || page.sourceFileId !== value.sourceFileId || page.inputSha256 !== value.sourceSha256
        || !isCount(page.pageNumber) || page.pageNumber < 1
        || (value.pageCount !== null && page.pageNumber > value.pageCount)
        || !isHash(page.contentHash) || !isRecord(page.render) || !isRecord(page.provider)
        || !isHash(page.render.sha256) || !isCount(page.render.widthPx) || page.render.widthPx < 1
        || !isCount(page.render.heightPx) || page.render.heightPx < 1
        || !isCount(page.render.dpi) || page.render.dpi < 1
        || typeof page.render.rendererProfileId !== "string"
        || typeof page.provider.profileId !== "string"
        || !Array.isArray(page.lines) || page.lines.length > 5000) {
        throw new Error("OCR layout page integrity check failed");
      }
      if (seenPages.has(page.pageNumber)) throw new Error("Duplicate OCR layout page");
      seenPages.add(page.pageNumber);
      const { contentHash: _hash, ...pageContent } = page;
      if (sha256(canonicalJson(pageContent)) !== page.contentHash) {
        throw new Error("OCR layout page hash mismatch");
      }
      pages.push({
        pageNumber: page.pageNumber, contentHash: page.contentHash,
        renderSha256: page.render.sha256, widthPx: page.render.widthPx,
        heightPx: page.render.heightPx, dpi: page.render.dpi,
        rendererProfileId: page.render.rendererProfileId,
        ocrProviderProfileId: page.provider.profileId, lineCount: page.lines.length,
      });
    }
    processed += value.processedPageCount;
    deferred += value.deferredPageCount;
    required += value.ocrRequiredPageCount;
    if ([boundedOcrProfileIdV3, boundedOcrProfileIdV4, boundedOcrProfileIdV5].includes(profileId)) {
      subjectCandidates += value.subjectCandidatePageCount as number;
      renderSkipped += value.skippedRenderPixelPageCount as number;
      if (isV4Family) {
        titleCandidates += value.titleRecoveryCandidatePageCount as number;
      }
    }
    if (isV6) {
      reviewEligible += value.reviewEligiblePageCount as number;
      stageUnresolved += value.stageUnresolvedPageCount as number;
      renderSkipped += value.skippedRenderPixelPageCount as number;
    }
    sources.push({
      sourceFileId: value.sourceFileId, sourceSha256: value.sourceSha256,
      pageCount: value.pageCount, status: value.status,
      ocrRequiredPageCount: value.ocrRequiredPageCount,
      processedPageCount: value.processedPageCount,
      deferredPageCount: value.deferredPageCount, pages,
      ...(isV6 ? {
        reviewEligiblePageCount: value.reviewEligiblePageCount as number,
        stageUnresolvedPageCount: value.stageUnresolvedPageCount as number,
        selectionReasonCodes: value.selectionReasonCodes as string[],
      } : {}),
    });
  }
  if (processed !== analysis.processedPageCount || deferred !== analysis.deferredPageCount
    || required !== analysis.ocrRequiredPageCount
    || (isV6 && (reviewEligible !== analysis.reviewEligiblePageCount
      || stageUnresolved !== analysis.stageUnresolvedPageCount
      || renderSkipped !== analysis.skippedRenderPixelPageCount))
    || ([boundedOcrProfileIdV3, boundedOcrProfileIdV4, boundedOcrProfileIdV5].includes(profileId)
      && (subjectCandidates !== analysis.subjectCandidatePageCount
        || renderSkipped !== analysis.skippedRenderPixelPageCount
        || (isV4Family
          && titleCandidates !== analysis.titleRecoveryCandidatePageCount)))) {
    throw new Error("OCR layout counters integrity check failed");
  }
  return sources;
}

export function projectOcrLayoutRead(checkId: string, row: PersistedOcrLayoutRow): OcrLayoutRead {
  const { analysis, profileId, expectedHash } = verifiedAnalysis(row);
  return {
    checkId, status: "OCR_UNVERIFIED_BOUNDED", artifactId: row.id,
    contentHash: expectedHash, inputManifestHash: row.input_manifest_hash.trim(),
    schemaVersion: analysis.schemaVersion as OcrLayoutRead["schemaVersion"],
    providerProfileId: profileId,
    ocrRequiredPageCount: analysis.ocrRequiredPageCount as number,
    processedPageCount: analysis.processedPageCount as number,
    deferredPageCount: analysis.deferredPageCount as number,
    ...(profileId === boundedOcrProfileIdV6 ? {
      reviewEligiblePageCount: analysis.reviewEligiblePageCount as number,
      stageUnresolvedPageCount: analysis.stageUnresolvedPageCount as number,
    } : {}),
    sources: projectSources(analysis, profileId),
  };
}

export const OCR_READ_PAGE_SIZE = 50;

export function projectOcrLayoutPage(
  checkId: string, row: PersistedOcrLayoutRow, sourceFileId: string,
  pageNumber: number, offset: number,
): OcrLayoutPageRead | undefined {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 5000) return undefined;
  const summary = projectOcrLayoutRead(checkId, row);
  const source = summary.sources.find((item) => item.sourceFileId === sourceFileId);
  const pageSummary = source?.pages.find((item) => item.pageNumber === pageNumber);
  if (!source || !pageSummary) return undefined;
  const analysis = (row.content_json.analysis as Record<string, unknown>);
  const rawSource = (analysis.sources as Record<string, unknown>[])
    .find((item) => item.sourceFileId === sourceFileId)!;
  const rawPage = (rawSource.pages as Record<string, unknown>[])
    .find((item) => item.pageNumber === pageNumber)!;
  const lines = rawPage.lines as unknown[];
  const nextOffset = offset + OCR_READ_PAGE_SIZE < lines.length ? offset + OCR_READ_PAGE_SIZE : null;
  const selected = lines.slice(offset, offset + OCR_READ_PAGE_SIZE);
  const projected = selected.map((line, index) => {
    if (!isRecord(line) || typeof line.text !== "string" || line.text.length > 4096
      || typeof line.score !== "number" || !Number.isFinite(line.score)
      || line.score < 0 || line.score > 1 || !Array.isArray(line.bboxPx)
      || line.bboxPx.length !== 4 || !line.bboxPx.every((point) =>
        typeof point === "number" && Number.isFinite(point))) {
      throw new Error("OCR layout line integrity check failed");
    }
    return { ordinal: offset + index, text: line.text, confidence: line.score,
      bboxPx: line.bboxPx as [number, number, number, number] };
  });
  return {
    checkId, status: "OCR_UNVERIFIED_BOUNDED", artifactId: row.id,
    contentHash: summary.contentHash, sourceFileId, sourceSha256: source.sourceSha256,
    pageNumber, pageContentHash: pageSummary.contentHash,
    renderSha256: pageSummary.renderSha256, widthPx: pageSummary.widthPx,
    heightPx: pageSummary.heightPx, dpi: pageSummary.dpi,
    rendererProfileId: pageSummary.rendererProfileId,
    ocrProviderProfileId: pageSummary.ocrProviderProfileId,
    lineCount: lines.length, offset, nextOffset, lines: projected,
  };
}
