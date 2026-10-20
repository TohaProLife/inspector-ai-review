import type { CheckRun, DocumentTextV3AuditSourceRead, DocumentTextV3LargeAuditSourceRead, DocumentTextV4FullAuditPageBatchRead, MatrixInventorySourcePagesRead, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import type { InspectorEvidenceViewerProps } from "./InspectorEvidenceViewer";

export interface SourceTextIdentity { objectId: string; checkId: string; file: SourceFileSummary; reviewHash: string | null }
type Box = [number, number, number, number];
export interface SourceTextLine {
  key: string; pageNumber: number; blockIndex: number; lineIndex: number; rawText: string;
  sourcePath?: never; unlocatedReasonCode?: never;
  bboxMilliPoints: Box | null; widthMilliPoints: number; heightMilliPoints: number;
}
export interface SourceTextIndex {
  identity: SourceTextIdentity;
  origin: Omit<MatrixInventorySourcePagesRead, "textArtifact" | "pageStages">;
  lines: SourceTextLine[]; pageCount: number; unlocatedLines: number; emptyPages: number[];
}
export interface SourceTextV3Line extends Omit<SourceTextLine, "blockIndex" | "lineIndex" | "sourcePath" | "unlocatedReasonCode"> {
  blockIndex?: never; lineIndex?: never; sourcePath: number[]; unlocatedReasonCode?: "NATIVE_ZERO_AREA" | "MILLI_POINT_COLLAPSE";
}
export interface SourceTextV3Index extends Omit<SourceTextIndex, "origin" | "lines"> {
  origin: Omit<DocumentTextV3AuditSourceRead, "textArtifact" | "pageStages">; lines: SourceTextV3Line[];
}
export interface SourceTextV3LargeIndex extends Omit<SourceTextIndex, "origin" | "lines"> {
  origin: Omit<DocumentTextV3LargeAuditSourceRead, "textArtifact" | "pageStages">; lines: SourceTextV3Line[];
}
export interface SourceTextV4FullIndex extends Omit<SourceTextIndex, "origin" | "lines"> {
  origin: Omit<DocumentTextV4FullAuditPageBatchRead, "pages" | "pageStages" | "startPage" | "pageLimit" | "nextPage">;
  lines: SourceTextV3Line[];
  qualitySummary: { candidatePages: number; partialPages: number; ocrRequiredPages: number };
}
export interface SourceTextLoadProgress { loadedPages: number; totalPages: number }
export type SearchableSourceTextIndex = SourceTextIndex | SourceTextV3Index | SourceTextV3LargeIndex | SourceTextV4FullIndex;
export type SearchableSourceTextLine = SourceTextLine | SourceTextV3Line;
const SHA = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9_-]{1,200}$/u;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const changed = () => new Error("Источник, проверка или решение изменились. Загрузите исходный текст снова.");
function validIdentity(identity: SourceTextIdentity) {
  if (!ID.test(identity.objectId) || !ID.test(identity.checkId) || !ID.test(identity.file.id)
    || !SHA.test(identity.file.sha256) || (identity.reviewHash !== null && !SHA.test(identity.reviewHash))) throw changed();
}
function lineBox(value: unknown, width: number, height: number): Box | null {
  if (!Array.isArray(value) || value.length !== 4 || !Array.from(value).every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
    || value[0] >= value[2] || value[1] >= value[3] || value[2] > width || value[3] > height) return null;
  return [...value] as Box;
}

/** Read-only original text, including lines without exact geometry. No block-box fallback. */
export function buildSourceTextIndex(identity: SourceTextIdentity, data: MatrixInventorySourcePagesRead): SourceTextIndex {
  validIdentity(identity);
  if (!record(data) || data.checkId !== identity.checkId || data.sourceFileId !== identity.file.id
    || data.sourceSha256 !== identity.file.sha256 || data.latestReviewHash !== identity.reviewHash
    || !SHA.test(data.inputManifestHash) || !SHA.test(data.textStageContentHash) || !SHA.test(data.textArtifactHash)
    || !["PD", "RD", "UNRESOLVED"].includes(data.stage)
    || (data.stage !== "UNRESOLVED" && !identity.file.stages.includes(data.stage))) throw changed();
  const artifact = data.textArtifact;
  if (!record(artifact) || artifact.sourceFileId !== identity.file.id || artifact.inputSha256 !== identity.file.sha256
    || artifact.schemaVersion !== "document-text-v2") throw changed();
  if (!positive(artifact.pageCount) || artifact.pageCount > 512 || !Array.isArray(artifact.pages)
    || artifact.pages.length !== artifact.pageCount
    || (identity.file.pageCount !== null && identity.file.pageCount !== artifact.pageCount))
    throw new Error("Не подтверждён полный набор исходных листов (до 512 страниц).");
  const lines: SourceTextLine[] = [], emptyPages: number[] = [];
  let characters = 0, unlocatedLines = 0;
  for (const [pageIndex, rawPage] of artifact.pages.entries()) {
    if (!record(rawPage) || rawPage.pageNumber !== pageIndex + 1 || !positive(rawPage.widthMilliPoints)
      || !positive(rawPage.heightMilliPoints) || !Array.isArray(rawPage.blocks) || rawPage.blocks.length > 20000)
      throw new Error("Не подтверждены порядок и координаты исходных листов.");
    const { pageNumber, widthMilliPoints, heightMilliPoints } = rawPage as Record<string, unknown> & {
      pageNumber: number; widthMilliPoints: number; heightMilliPoints: number };
    const before = lines.length;
    for (const [blockIndex, block] of rawPage.blocks.entries()) {
      if (!record(block) || typeof block.text !== "string") throw new Error("Неполный текст исходного листа.");
      characters += block.text.length;
      if (characters > 8 * 1024 * 1024) throw new Error("Исходный текст превышает предел поиска. Нужен отдельный пакет листов.");
      const rawLines = block.text.split("\n"), bounds = block.lineBboxesMilliPoints;
      const exactBounds = Array.isArray(bounds) && bounds.length === rawLines.length;
      for (const [lineIndex, rawText] of rawLines.entries()) {
        if (!rawText.trim()) continue;
        if (lines.length >= 100000) throw new Error("Слишком много строк для поиска. Нужен отдельный пакет листов.");
        const bboxMilliPoints = exactBounds ? lineBox(bounds[lineIndex], widthMilliPoints, heightMilliPoints) : null;
        if (!bboxMilliPoints) unlocatedLines++;
        lines.push({ key: JSON.stringify([identity.objectId, identity.checkId, identity.file.id, identity.file.sha256,
          identity.reviewHash, data.textArtifactHash, pageNumber, blockIndex, lineIndex]),
          pageNumber, blockIndex, lineIndex, rawText, bboxMilliPoints, widthMilliPoints, heightMilliPoints });
      }
    }
    if (before === lines.length) emptyPages.push(pageNumber);
  }
  const { textArtifact: _artifact, pageStages: _latestPageStages, ...origin } = data;
  // Latest page-stage decisions do not reclassify the frozen analysis source.
  return { identity: structuredClone(identity), origin: structuredClone(origin), lines,
    pageCount: artifact.pageCount, unlocatedLines, emptyPages };
}

/** UI projection of the authenticated, whole-artifact validated source-only endpoint.
 * It retains native row identity; it is not a second engineering or hash validator.
 */
export function buildSourceTextV3Index(identity: SourceTextIdentity, data: DocumentTextV3AuditSourceRead): SourceTextV3Index {
  validIdentity(identity);
  if (!record(data) || data.schemaVersion !== "document-text-v3-source-read-v1" || data.purpose !== "SOURCE_AUDIT_ONLY"
    || data.checkId !== identity.checkId || data.sourceFileId !== identity.file.id || data.sourceSha256 !== identity.file.sha256
    || data.latestReviewHash !== identity.reviewHash || data.authorityStatus !== "SOURCE_DECLARED_UNVERIFIED"
    || data.renderedVisibility !== "UNVERIFIED" || data.calibratedProbability !== null
    || ![data.inputManifestHash, data.textStageContentHash, data.textArtifactByteSha256, data.textArtifactContentHash,
      data.extractorProfileHash].every(hash => typeof hash === "string" && SHA.test(hash))
    || data.textStageContentHash !== data.textArtifactByteSha256 || !["PD", "RD", "UNRESOLVED"].includes(data.stage)
    || data.stage !== "UNRESOLVED" && !identity.file.stages.includes(data.stage)) throw changed();
  const artifact = data.textArtifact;
  if (!record(artifact) || artifact.schemaVersion !== "document-text-v3" || artifact.sourceFileId !== identity.file.id
    || artifact.inputSha256 !== identity.file.sha256 || artifact.extractorProfileHash !== data.extractorProfileHash
    || !positive(artifact.pageCount) || artifact.pageCount > 512 || !Array.isArray(artifact.pages)
    || artifact.pages.length !== artifact.pageCount || identity.file.pageCount !== null && identity.file.pageCount !== artifact.pageCount
    || new TextEncoder().encode(JSON.stringify(artifact)).length > 8000000) throw changed();
  const lines: SourceTextV3Line[] = [], emptyPages: number[] = [];
  let unlocatedLines = 0;
  for (const [pageIndex, page] of artifact.pages.entries()) {
    if (!record(page) || page.pageNumber !== pageIndex + 1 || !positive(page.widthMilliPoints) || !positive(page.heightMilliPoints)
      || !Array.isArray(page.locatedLines) || !Array.isArray(page.unlocatedLines)) throw changed();
    const rows: SourceTextV3Line[] = [], paths = new Set<string>();
    for (const channel of ["locatedLines", "unlocatedLines"] as const) for (const row of page[channel]) {
      if (!record(row) || typeof row.rawText !== "string" || !Array.isArray(row.sourcePath)
        || row.sourcePath.length < 1 || row.sourcePath.length > 64 || row.sourcePath.some(n => !Number.isSafeInteger(n) || n < 0)
        || !Array.isArray(row.nativeBoxPointStrings) || row.nativeBoxPointStrings.length !== 4
        || !row.nativeBoxPointStrings.every(n => typeof n === "string") || lines.length + rows.length >= 100000) throw changed();
      const path = JSON.stringify(row.sourcePath);
      if (paths.has(path)) throw changed(); paths.add(path);
      const box = channel === "locatedLines" ? lineBox("bboxMilliPoints" in row ? row.bboxMilliPoints : undefined, page.widthMilliPoints, page.heightMilliPoints) : null;
      if (channel === "locatedLines" && (!box || "reasonCode" in row)
        || channel === "unlocatedLines" && ("bboxMilliPoints" in row || !["NATIVE_ZERO_AREA", "MILLI_POINT_COLLAPSE"].includes(String(row.reasonCode)))) throw changed();
      rows.push({ key: JSON.stringify([identity.objectId, identity.checkId, identity.file.id, identity.file.sha256,
        identity.reviewHash, data.textArtifactContentHash, page.pageNumber, row.sourcePath]), pageNumber: page.pageNumber,
        rawText: row.rawText, sourcePath: [...row.sourcePath], bboxMilliPoints: box,
        widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints,
        ...(channel === "unlocatedLines" && "reasonCode" in row ? { unlocatedReasonCode: row.reasonCode } : {}) });
      if (!box) unlocatedLines++;
    }
    rows.sort((a, b) => { const left = a.sourcePath!, right = b.sourcePath!;
      for (let n = 0; n < Math.min(left.length, right.length); n++) if (left[n] !== right[n]) return left[n] - right[n];
      return left.length - right.length; });
    lines.push(...rows); if (!rows.length) emptyPages.push(page.pageNumber);
  }
  const { textArtifact: _artifact, pageStages: _latestPageStages, ...origin } = data;
  return { identity: structuredClone(identity), origin: structuredClone(origin), lines, pageCount: artifact.pageCount, unlocatedLines, emptyPages };
}

/** Fixed new-profile UI resource guard. JSON responses are trusted only after server validation.
 * Descriptor reads avoid getters/toJSON. Browser JavaScript cannot identify arbitrary Proxies;
 * the server's callback-free native guard remains authoritative for untrusted native objects.
 */
function requireLargeNativeJson(value: unknown, maxBytes: number, maxNodes: number, maxDepth: number): void {
  let nodes = 0, bytes = 0;
  const seen = new Set<object>(), encoder = new TextEncoder();
  const limit = () => { throw new Error("Большой исходный текст превышает допустимые пределы или имеет неподдерживаемую структуру."); };
  const addBytes = (size: number) => { bytes += size; if (bytes > maxBytes) limit(); };
  const stringBytes = (text: string) => {
    let points = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) limit();
      } else if (code >= 0xdc00 && code <= 0xdfff) limit();
      if (++points > 2000000) limit();
    }
    return encoder.encode(JSON.stringify(text)).length;
  };
  function walk(item: unknown, depth: number): void {
    if (++nodes > maxNodes || depth > maxDepth) limit();
    if (item === null) { addBytes(4); return; }
    if (typeof item === "string") { addBytes(stringBytes(item)); return; }
    if (typeof item === "boolean") { addBytes(item ? 4 : 5); return; }
    if (typeof item === "number") { if (!Number.isSafeInteger(item) || Object.is(item, -0)) limit(); addBytes(String(item).length); return; }
    if (typeof item !== "object") limit();
    const object = item as object, array = Array.isArray(object);
    if (seen.has(object) || Object.getPrototypeOf(object) !== (array ? Array.prototype : Object.prototype)) limit();
    seen.add(object);
    const descriptors = Object.getOwnPropertyDescriptors(object), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) limit();
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 32768 || keys.length !== length + 1) limit();
      addBytes(2 + Math.max(0, length - 1));
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) limit();
        walk(descriptor.value, depth + 1);
      }
    } else {
      if (keys.length > 32768) limit();
      addBytes(2 + Math.max(0, keys.length - 1));
      for (const key of keys as string[]) {
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || !descriptor.enumerable || ++nodes > maxNodes) limit();
        addBytes(stringBytes(key) + 1); walk(descriptor.value, depth + 1);
      }
    }
  }
  walk(value, 0);
}

/** Separate 32M/vertical source-only projection. Old 8M reader remains unchanged. */
export function buildSourceTextV3LargeIndex(identity: SourceTextIdentity, data: DocumentTextV3LargeAuditSourceRead): SourceTextV3LargeIndex {
  // This is a bounded UI projection of authenticated JSON, not an engineering/hash validator.
  requireLargeNativeJson(data, 33554432, 1500000, 65);
  validIdentity(identity);
  if (![identity.objectId, identity.checkId, identity.file.id].every(id => typeof id === "string" && id.length >= 1
    && id.length <= 200 && !/[^A-Za-z0-9_-]/u.test(id)) || identity.file.sha256.length !== 64
    || identity.reviewHash !== null && identity.reviewHash.length !== 64) throw changed();
  if (!record(data) || data.schemaVersion !== "document-text-v3-large-source-read-v1"
    || data.sourceAuditProfileVersion !== "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1"
    || data.resourcePolicyVersion !== "document-text-v3-large-source-bounds-v1"
    || Object.keys(data).length !== 19 || Object.keys(data).some(key => ![
      "schemaVersion", "purpose", "sourceAuditProfileVersion", "resourcePolicyVersion", "checkId", "sourceFileId", "sourceSha256",
      "inputManifestHash", "textStageContentHash", "textArtifactByteSha256", "textArtifactContentHash", "extractorProfileHash",
      "stage", "pageStages", "latestReviewHash", "authorityStatus", "renderedVisibility", "calibratedProbability", "textArtifact"
    ].includes(key)) || data.purpose !== "SOURCE_AUDIT_ONLY"
    || data.checkId !== identity.checkId || data.sourceFileId !== identity.file.id || data.sourceSha256 !== identity.file.sha256
    || data.latestReviewHash !== identity.reviewHash || !record(data.pageStages) || data.authorityStatus !== "SOURCE_DECLARED_UNVERIFIED"
    || data.renderedVisibility !== "UNVERIFIED" || data.calibratedProbability !== null
    || ![data.inputManifestHash, data.textStageContentHash, data.textArtifactByteSha256, data.textArtifactContentHash,
      data.extractorProfileHash].every(hash => typeof hash === "string" && hash.length === 64 && SHA.test(hash))
    || data.textStageContentHash !== data.textArtifactByteSha256 || !["PD", "RD", "UNRESOLVED"].includes(data.stage)) throw changed();
  const artifact = data.textArtifact;
  requireLargeNativeJson(artifact, 32000000, 1400000, 64);
  if (!record(artifact) || artifact.schemaVersion !== "document-text-v3" || artifact.sourceFileId !== identity.file.id
    || artifact.inputSha256 !== identity.file.sha256 || artifact.extractorProfileHash !== data.extractorProfileHash
    || !positive(artifact.pageCount) || artifact.pageCount > 512 || !Array.isArray(artifact.pages)
    || artifact.pages.length !== artifact.pageCount || identity.file.pageCount !== null && identity.file.pageCount !== artifact.pageCount
    || !record(artifact.extractorProfile)
    || artifact.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || artifact.extractorProfile.traversalPolicyVersion !== "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1") throw changed();
  const lines: SourceTextV3Line[] = [], emptyPages: number[] = [];
  let unlocatedLines = 0;
  for (const [pageIndex, page] of artifact.pages.entries()) {
    if (!record(page) || page.pageNumber !== pageIndex + 1 || !positive(page.widthMilliPoints) || !positive(page.heightMilliPoints)
      || !Array.isArray(page.locatedLines) || !Array.isArray(page.unlocatedLines)) throw changed();
    const rows: SourceTextV3Line[] = [], paths = new Set<string>();
    for (const channel of ["locatedLines", "unlocatedLines"] as const) for (const row of page[channel]) {
      if (!record(row) || typeof row.rawText !== "string" || !Array.isArray(row.sourcePath)
        || row.sourcePath.length < 1 || row.sourcePath.length > 64 || row.sourcePath.some(n => !Number.isSafeInteger(n) || n < 0 || n > 32767)
        || !Array.isArray(row.nativeBoxPointStrings) || row.nativeBoxPointStrings.length !== 4
        || !row.nativeBoxPointStrings.every(n => typeof n === "string") || lines.length + rows.length >= 100000) throw changed();
      const path = JSON.stringify(row.sourcePath);
      if (paths.has(path)) throw changed(); paths.add(path);
      const box = channel === "locatedLines" ? lineBox("bboxMilliPoints" in row ? row.bboxMilliPoints : undefined, page.widthMilliPoints, page.heightMilliPoints) : null;
      if (channel === "locatedLines" && (!box || "reasonCode" in row)
        || channel === "unlocatedLines" && ("bboxMilliPoints" in row || !["NATIVE_ZERO_AREA", "MILLI_POINT_COLLAPSE"].includes(String(row.reasonCode)))) throw changed();
      rows.push({ key: JSON.stringify([identity.objectId, identity.checkId, identity.file.id, identity.file.sha256,
        identity.reviewHash, data.textArtifactContentHash, page.pageNumber, row.sourcePath]), pageNumber: page.pageNumber,
        rawText: row.rawText, sourcePath: [...row.sourcePath], bboxMilliPoints: box,
        widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints,
        ...(channel === "unlocatedLines" && "reasonCode" in row ? { unlocatedReasonCode: row.reasonCode } : {}) });
      if (!box) unlocatedLines++;
    }
    rows.sort((a, b) => { const left = a.sourcePath!, right = b.sourcePath!;
      for (let n = 0; n < Math.min(left.length, right.length); n++) if (left[n] !== right[n]) return left[n] - right[n];
      return left.length - right.length; });
    lines.push(...rows); if (!rows.length) emptyPages.push(page.pageNumber);
  }
  const { textArtifact: _artifact, pageStages: _latestPageStages, ...origin } = data;
  return { identity: structuredClone(identity), origin: structuredClone(origin), lines, pageCount: artifact.pageCount, unlocatedLines, emptyPages };
}


const V4_BATCH_KEYS = ["schemaVersion", "purpose", "sourceAuditProfileVersion", "resourcePolicyVersion", "checkId", "sourceFileId",
  "sourceSha256", "inputManifestHash", "textStageContentHash", "textArtifactByteSha256", "textArtifactContentHash", "extractorProfileHash",
  "stage", "pageStages", "latestReviewHash", "authorityStatus", "renderedVisibility", "calibratedProbability", "wholeArtifactPageCount",
  "startPage", "pageLimit", "nextPage", "pages"];
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length
  && Object.keys(value).every(key => keys.includes(key));
const stableJson = (value: unknown): string => value !== null && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(stableJson).join(",")}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value);
const nativeDecimal = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/u;
const nativeBox = (value: unknown) => Array.isArray(value) && value.length === 4
  && value.every(n => typeof n === "string" && n.length <= 500 && nativeDecimal.test(n));

/** Server authenticates whole artifact hashes and native semantics. This client checks
 * complete presentation data and pins immutable identity across every bounded batch.
 * No partially received page set becomes searchable, and no V4 failure falls back to V3.
 */
function sourceTextV4FullReader(identity: SourceTextIdentity) {
  if (![identity.objectId, identity.checkId, identity.file.id].every(id => typeof id === "string")
    || typeof identity.file.sha256 !== "string" || identity.file.sha256.length !== 64
    || identity.reviewHash !== null && (typeof identity.reviewHash !== "string" || identity.reviewHash.length !== 64)) throw changed();
  validIdentity(identity);
  let nextPage: number | null = 1, totalPages = 0, fingerprint = "", pageBytes = 2;
  let origin: SourceTextV4FullIndex["origin"] | undefined;
  const pages: DocumentTextV4FullAuditPageBatchRead["pages"] = [], lines: SourceTextV3Line[] = [], emptyPages: number[] = [];
  const qualitySummary = { candidatePages: 0, partialPages: 0, ocrRequiredPages: 0 };
  let unlocatedLines = 0;
  function accept(data: DocumentTextV4FullAuditPageBatchRead): SourceTextLoadProgress {
    requireLargeNativeJson(data, 33554432, 1500000, 65);
    if (nextPage === null || !record(data) || !exactKeys(data, V4_BATCH_KEYS)
      || data.schemaVersion !== "document-text-v4-full-source-page-batch-v1" || data.purpose !== "SOURCE_AUDIT_ONLY"
      || data.sourceAuditProfileVersion !== "SOURCE_AUDIT_V4_FULL_SOURCE_V1"
      || data.resourcePolicyVersion !== "document-text-v4-full-source-bounds-v1"
      || data.checkId !== identity.checkId || data.sourceFileId !== identity.file.id || data.sourceSha256 !== identity.file.sha256
      || data.latestReviewHash !== identity.reviewHash || data.authorityStatus !== "SOURCE_DECLARED_UNVERIFIED"
      || data.renderedVisibility !== "UNVERIFIED" || data.calibratedProbability !== null
      || ![data.inputManifestHash, data.textStageContentHash, data.textArtifactByteSha256, data.textArtifactContentHash,
        data.extractorProfileHash].every(hash => typeof hash === "string" && hash.length === 64 && SHA.test(hash))
      || data.textStageContentHash !== data.textArtifactByteSha256 || !["PD", "RD", "UNRESOLVED"].includes(data.stage)
      || !record(data.pageStages) || Object.keys(data.pageStages).length > 1024
      || Object.entries(data.pageStages).some(([page, stage]) => !/^[1-9][0-9]{0,3}$/u.test(page) || Number(page) > 1024
        || !["PD", "RD", "ID", "UNRESOLVED"].includes(stage))
      || !positive(data.wholeArtifactPageCount) || data.wholeArtifactPageCount > 1024
      || identity.file.pageCount !== null && identity.file.pageCount !== data.wholeArtifactPageCount
      || data.startPage !== nextPage || data.pageLimit !== 128 || !Array.isArray(data.pages)) throw changed();
    const end = Math.min(nextPage + 127, data.wholeArtifactPageCount), expectedNext = end < data.wholeArtifactPageCount ? end + 1 : null;
    if (data.pages.length !== end - nextPage + 1 || data.nextPage !== expectedNext) throw changed();
    const { pages: _pages, pageStages: _latestPageStages, startPage: _start, pageLimit: _limit, nextPage: _next, ...metadata } = data;
    const metadataFingerprint = stableJson({ ...metadata, pageStages: data.pageStages });
    if (fingerprint && fingerprint !== metadataFingerprint) throw changed();
    fingerprint = metadataFingerprint; origin = metadata; totalPages = data.wholeArtifactPageCount;
    for (const [offset, page] of data.pages.entries()) {
      if (!record(page) || !exactKeys(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "nativeFrame", "locatedLines", "unlocatedLines", "quality"])
        || page.pageNumber !== nextPage + offset || !positive(page.widthMilliPoints) || !positive(page.heightMilliPoints)
        || !record(page.nativeFrame) || !exactKeys(page.nativeFrame, ["coordinateSystem", "visibleBoxPointStrings"])
        || page.nativeFrame.coordinateSystem !== "PDFMINER_LAYOUT_POINTS" || !nativeBox(page.nativeFrame.visibleBoxPointStrings)
        || !Array.isArray(page.locatedLines) || !Array.isArray(page.unlocatedLines)
        || !record(page.quality) || !exactKeys(page.quality, ["disposition", "reasonCodes", "metrics"])
        || !["TEXT_LAYER_CANDIDATE", "PARTIAL_TEXT_LAYER", "OCR_REQUIRED"].includes(page.quality.disposition)
        || !Array.isArray(page.quality.reasonCodes) || new Set(page.quality.reasonCodes).size !== page.quality.reasonCodes.length
        || page.quality.reasonCodes.some(reason => !["NO_LOCATED_TEXT", "TEXT_DECODING_ANOMALY", "UNLOCATED_TEXT_PRESENT"].includes(reason))
        || !record(page.quality.metrics) || !exactKeys(page.quality.metrics, ["locatedLineCount", "unlocatedLineCount", "locatedNonWhitespaceCharacters",
          "unlocatedNonWhitespaceCharacters", "replacementCharacters", "disallowedControlCharacters", "cidPlaceholders"])
        || Object.values(page.quality.metrics).some(value => !Number.isSafeInteger(value) || value < 0)
        || page.quality.metrics.locatedLineCount !== page.locatedLines.length
        || page.quality.metrics.unlocatedLineCount !== page.unlocatedLines.length) throw changed();
      pageBytes += new TextEncoder().encode(JSON.stringify(page)).length + (pages.length > 0 ? 1 : 0);
      if (pageBytes > 32000000) throw new Error("Полный текст превышает предел поиска 32 000 000 байт.");
      const rows: SourceTextV3Line[] = [], paths = new Set<string>();
      for (const channel of ["locatedLines", "unlocatedLines"] as const) for (const row of page[channel]) {
        if (!record(row) || !exactKeys(row, ["sourcePath", "rawText", "nativeBoxPointStrings", channel === "locatedLines" ? "bboxMilliPoints" : "reasonCode"])
          || typeof row.rawText !== "string" || row.rawText.length < 1 || !Array.isArray(row.sourcePath)
          || row.sourcePath.length < 1 || row.sourcePath.length > 64
          || row.sourcePath.some(part => !Number.isSafeInteger(part) || part < 0 || part > 32767)
          || !nativeBox(row.nativeBoxPointStrings) || lines.length + rows.length >= 100000) throw changed();
        const path = JSON.stringify(row.sourcePath);
        if (paths.has(path)) throw changed(); paths.add(path);
        const box = channel === "locatedLines" ? lineBox("bboxMilliPoints" in row ? row.bboxMilliPoints : undefined, page.widthMilliPoints, page.heightMilliPoints) : null;
        if (channel === "locatedLines" && !box || channel === "unlocatedLines"
          && !("reasonCode" in row && ["NATIVE_ZERO_AREA", "MILLI_POINT_COLLAPSE"].includes(row.reasonCode))) throw changed();
        rows.push({ key: JSON.stringify([identity.objectId, identity.checkId, identity.file.id, identity.file.sha256, identity.reviewHash,
          data.textArtifactContentHash, page.pageNumber, row.sourcePath]), pageNumber: page.pageNumber, rawText: row.rawText,
          sourcePath: [...row.sourcePath], bboxMilliPoints: box, widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints,
          ...(channel === "unlocatedLines" && "reasonCode" in row ? { unlocatedReasonCode: row.reasonCode } : {}) });
        if (!box) unlocatedLines++;
      }
      rows.sort((a, b) => {
        for (let i = 0; i < Math.min(a.sourcePath.length, b.sourcePath.length); i++) if (a.sourcePath[i] !== b.sourcePath[i]) return a.sourcePath[i]! - b.sourcePath[i]!;
        return a.sourcePath.length - b.sourcePath.length;
      });
      lines.push(...rows); if (rows.length === 0) emptyPages.push(page.pageNumber);
      qualitySummary[page.quality.disposition === "TEXT_LAYER_CANDIDATE" ? "candidatePages"
        : page.quality.disposition === "PARTIAL_TEXT_LAYER" ? "partialPages" : "ocrRequiredPages"]++;
      pages.push(page);
    }
    nextPage = expectedNext;
    return { loadedPages: pages.length, totalPages };
  }
  function finish(): SourceTextV4FullIndex {
    if (nextPage !== null || !origin || totalPages < 1 || pages.length !== totalPages) throw changed();
    // Aggregate page data remains bounded even when each individual response fits.
    requireLargeNativeJson(pages, 32000000, 1400000, 64);
    return { identity: structuredClone(identity), origin: structuredClone(origin), lines, pageCount: totalPages,
      emptyPages, unlocatedLines, qualitySummary };
  }
  return { accept, finish, next: () => nextPage, hash: () => origin?.textArtifactContentHash };
}

export function buildSourceTextV4FullIndex(identity: SourceTextIdentity, batches: DocumentTextV4FullAuditPageBatchRead[]): SourceTextV4FullIndex {
  if (!Array.isArray(batches) || batches.length < 1 || batches.length > 8) throw changed();
  const reader = sourceTextV4FullReader(identity);
  for (const batch of batches) reader.accept(batch);
  return reader.finish();
}
async function loadSourceTextV4FullBatches(identity: SourceTextIdentity, signal: AbortSignal,
  onProgress?: (progress: SourceTextLoadProgress) => void): Promise<SourceTextV4FullIndex> {
  const reader = sourceTextV4FullReader(identity);
  for (let batchNumber = 0; batchNumber < 8; batchNumber++) {
    signal.throwIfAborted();
    const startPage = reader.next(); if (startPage === null) return reader.finish();
    signal.throwIfAborted();
    const data = await api.getDocumentTextV4FullPageBatch(identity.checkId, identity.file.id,
      { startPage, pageLimit: 128, ...(startPage > 1 ? { expectedArtifactContentHash: reader.hash()! } : {}) }, signal);
    signal.throwIfAborted(); const progress = reader.accept(data); signal.throwIfAborted(); onProgress?.(progress); signal.throwIfAborted();
  }
  signal.throwIfAborted(); return reader.finish();
}

const fold = (s: string) => s.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru-RU");
export function searchSourceText(index: SearchableSourceTextIndex, query: string) {
  if (query.length > 400) return { items: [] as SearchableSourceTextLine[], total: 0, queryValid: false, truncated: false };
  const needle = fold(query), size = [...needle].length;
  if (size < 2 || size > 200 || [...query].length > 200) return { items: [] as SearchableSourceTextLine[], total: 0, queryValid: false, truncated: false };
  const items: SearchableSourceTextLine[] = []; let total = 0;
  for (const line of index.lines) if (fold(line.rawText).includes(needle)) { total++; if (items.length < 100) items.push(line); }
  return { items, total, queryValid: true, truncated: total > items.length };
}

export function sourceTextEvidence(index: SearchableSourceTextIndex, line: SearchableSourceTextLine): NonNullable<InspectorEvidenceViewerProps["evidence"]> {
  const original = index.lines.find(item => item.key === line.key);
  if (!original || JSON.stringify(original) !== JSON.stringify(line) || !original.bboxMilliPoints) throw changed();
  const b = original.bboxMilliPoints;
  return { id: original.key, sourceFileId: index.identity.file.id, sourceSha256: index.identity.file.sha256,
    stage: index.origin.stage, pageNumber: original.pageNumber, sheet: null, revision: null,
    element: "Исходная строка; инженерное значение и единицы не установлены", value: "Фрагмент исходного текста", unit: "",
    bbox: [b[0] / original.widthMilliPoints, 1 - b[3] / original.heightMilliPoints,
      b[2] / original.widthMilliPoints, 1 - b[1] / original.heightMilliPoints] };
}

function requireSealedSourceCheck(identity: SourceTextIdentity, check: CheckRun) {
  if (check.id !== identity.checkId || check.objectId !== identity.objectId || check.mode !== "NORMAL"
    || check.progress !== 100 || !check.completedAt || !Number.isFinite(Date.parse(check.completedAt))
    || !["PARTIAL", "REVIEW_REQUIRED", "CLARIFICATION_REQUIRED", "READY_TO_FINALIZE", "FINALIZED"].includes(check.status)) throw changed();
}
export async function loadSourceText(identity: SourceTextIdentity, signal: AbortSignal): Promise<SourceTextIndex> {
  validIdentity(identity); signal.throwIfAborted();
  const check = await api.getCheck(identity.checkId, signal); signal.throwIfAborted();
  requireSealedSourceCheck(identity, check);
  // This route independently requires an authenticated, sealed source origin on the server.
  const data = await api.getSourceInventoryPages(identity.checkId, identity.file.id, signal); signal.throwIfAborted();
  return buildSourceTextIndex(identity, data);
}

/** Search is the only v3 consumer here. Coordinate/domain readers remain explicit v2. */
export async function loadSearchableSourceText(identity: SourceTextIdentity, signal: AbortSignal,
  onProgress?: (progress: SourceTextLoadProgress) => void): Promise<SearchableSourceTextIndex> {
  validIdentity(identity); signal.throwIfAborted();
  const check = await api.getCheck(identity.checkId, signal); signal.throwIfAborted();
  requireSealedSourceCheck(identity, check);
  if (check.sourceAuditProfileVersion === "SOURCE_AUDIT_V4_FULL_SOURCE_V1") {
    if (check.purpose !== "SOURCE_AUDIT_ONLY") throw changed();
    return loadSourceTextV4FullBatches(identity, signal, onProgress);
  }
  if (check.sourceAuditProfileVersion !== undefined) {
    if (check.sourceAuditProfileVersion !== "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1" || check.purpose !== "SOURCE_AUDIT_ONLY") throw changed();
    const data = await api.getDocumentTextV3LargeSource(identity.checkId, identity.file.id, signal); signal.throwIfAborted();
    return buildSourceTextV3LargeIndex(identity, data);
  }
  try {
    const data = await api.getSourceInventoryPages(identity.checkId, identity.file.id, signal); signal.throwIfAborted();
    return buildSourceTextIndex(identity, data);
  } catch (error) {
    signal.throwIfAborted();
    if (!record(error) || error.status !== 404) throw error;
    const data = await api.getDocumentTextV3Source(identity.checkId, identity.file.id, signal); signal.throwIfAborted();
    return buildSourceTextV3Index(identity, data);
  }
}
