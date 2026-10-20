import { types } from "node:util";
import type { SourceOcrImportBundle, SourceOcrImportDerived, SourceOcrImportDerivedPage, SourceOcrImportLine,
  SourceOcrImportOrigin, SourceOcrImportPage } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { readDocumentTextV4FullArtifact } from "./document-text-v4.js";
import { freezeNativeSourceOutput, nativeSourceCanonicalTrusted, nativeSourceSha256 } from "./native-source-comparison-origin.js";

export class SourceOcrImportError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); }
}
export const SOURCE_OCR_IMPORT_LIMITS = Object.freeze({ maxPages: 12, maxBundleBytes: 8 * 1024 * 1024,
  maxDerivedBytes: 16 * 1024 * 1024, maxLinesPerPage: 10000, maxTotalLines: 20000,
  maxTextCharactersPerLine: 12000, maxRasterPixels: 2500000 });
const PROFILE = "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1" as const;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
type Json = Record<string, unknown>;
function fail(code: string, message: string, statusCode = 422): never { throw new SourceOcrImportError(statusCode, code, message); }
const limit = (): never => fail("SOURCE_OCR_IMPORT_INPUT_LIMIT", "Превышен предел импорта OCR", 413);
const scalar = (value: string) => { for (const c of value) { const n = c.codePointAt(0)!; if (n >= 0xd800 && n <= 0xdfff) return false; } return true; };
function plain(value: unknown): value is Json {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}
/** Descriptor-first: do not call accessors, proxies, toJSON or caller array methods. */
function exact(value: unknown, fields: readonly string[]): value is Json {
  if (!plain(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  return keys.length === fields.length && fields.every(key => descriptors[key]?.enumerable === true && Object.hasOwn(descriptors[key]!, "value"));
}
function dense(value: unknown, maximum: number): value is unknown[] {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === length + 1 && Array.from({ length }, (_, i) => descriptors[String(i)])
    .every(d => d?.enumerable === true && Object.hasOwn(d, "value"));
}
const positive = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const digest = (value: unknown, domain: string) => sha256(canonicalJson({ hashDomain: domain, value }));

export function parseSourceOcrImportBundle(value: unknown): SourceOcrImportBundle {
  try {
    if (!exact(value, ["schemaVersion", "sourceSha256", "profileId", "pages"]) || value.schemaVersion !== "source-ocr-import-bundle-v1"
      || typeof value.sourceSha256 !== "string" || !SHA.test(value.sourceSha256) || value.profileId !== PROFILE)
      fail("SOURCE_OCR_IMPORT_INVALID_BUNDLE", "Некорректный пакет OCR", 400);
    if (!dense(value.pages, SOURCE_OCR_IMPORT_LIMITS.maxPages) || !value.pages.length) {
      if (Array.isArray(value.pages) && !types.isProxy(value.pages) && value.pages.length > SOURCE_OCR_IMPORT_LIMITS.maxPages) limit();
      fail("SOURCE_OCR_IMPORT_INVALID_BUNDLE", "Нужен полный ограниченный набор страниц OCR", 400);
    }
    const pages: SourceOcrImportPage[] = [];
    let previous = 0, rawBytes = 0;
    for (const page of value.pages) {
      if (!exact(page, ["pageNumber", "pdfWidthMilliPoints", "pdfHeightMilliPoints", "rasterWidth", "rasterHeight", "renderSha256", "rawResponseJson"])
        || !positive(page.pageNumber) || page.pageNumber > 1024 || page.pageNumber <= previous
        || !positive(page.pdfWidthMilliPoints) || !positive(page.pdfHeightMilliPoints)
        || !positive(page.rasterWidth) || !positive(page.rasterHeight)
        || typeof page.renderSha256 !== "string" || !SHA.test(page.renderSha256)
        || typeof page.rawResponseJson !== "string" || !page.rawResponseJson.length || !scalar(page.rawResponseJson))
        fail("SOURCE_OCR_IMPORT_INVALID_BUNDLE", "Некорректная или неоднозначная страница OCR", 400);
      if (page.rasterWidth > SOURCE_OCR_IMPORT_LIMITS.maxRasterPixels / page.rasterHeight) limit();
      rawBytes += Buffer.byteLength(page.rawResponseJson, "utf8");
      if (rawBytes > SOURCE_OCR_IMPORT_LIMITS.maxBundleBytes) limit();
      previous = page.pageNumber;
      pages.push({ pageNumber: page.pageNumber, pdfWidthMilliPoints: page.pdfWidthMilliPoints, pdfHeightMilliPoints: page.pdfHeightMilliPoints,
        rasterWidth: page.rasterWidth, rasterHeight: page.rasterHeight, renderSha256: page.renderSha256, rawResponseJson: page.rawResponseJson });
    }
    const bundle: SourceOcrImportBundle = { schemaVersion: "source-ocr-import-bundle-v1", sourceSha256: value.sourceSha256, profileId: PROFILE, pages };
    if (Buffer.byteLength(canonicalJson(bundle), "utf8") > SOURCE_OCR_IMPORT_LIMITS.maxBundleBytes) limit();
    return freezeNativeSourceOutput(bundle);
  } catch (error) {
    if (error instanceof SourceOcrImportError) throw error;
    return fail("SOURCE_OCR_IMPORT_INVALID_BUNDLE", "Некорректный пакет OCR", 400);
  }
}

/** Bounded JSON parser rejects duplicate keys/nonfinite numbers and ambiguous Unicode. */
function rawResponse(raw: string): Json {
  let at = 0, nodes = 0;
  const bad = (): never => fail("SOURCE_OCR_IMPORT_INVALID_RESPONSE", "Ответ OCR не соответствует формату");
  const whitespace = () => { while (at < raw.length && /[\t\n\r ]/u.test(raw[at])) at++; };
  function string(): string {
    if (raw[at] !== '"') return bad();
    const start = at++;
    while (at < raw.length) {
      const c = raw[at++];
      if (c === '"') {
        let value: string; try { value = JSON.parse(raw.slice(start, at)); } catch { return bad(); }
        if (!scalar(value)) return bad();
        return value;
      }
      if (c === "\\") { if (raw[at] === "u") at += 5; else at++; }
      else if (c.charCodeAt(0) < 32) return bad();
    }
    return bad();
  }
  function read(depth: number): unknown {
    if (++nodes > 500000 || depth > 48) return limit();
    whitespace(); const c = raw[at];
    if (c === '"') return string();
    if (c === "{") {
      at++; whitespace(); const result: Json = {}, keys = new Set<string>();
      if (raw[at] === "}") { at++; return result; }
      for (;;) {
        whitespace(); const key = string(); if (keys.has(key)) return bad(); keys.add(key);
        whitespace(); if (raw[at++] !== ":") return bad();
        Object.defineProperty(result, key, { value: read(depth + 1), enumerable: true, writable: true, configurable: true });
        whitespace(); const next = raw[at++]; if (next === "}") return result; if (next !== ",") return bad();
      }
    }
    if (c === "[") {
      at++; whitespace(); const result: unknown[] = [];
      if (raw[at] === "]") { at++; return result; }
      for (;;) { result.push(read(depth + 1)); whitespace(); const next = raw[at++]; if (next === "]") return result; if (next !== ",") return bad(); }
    }
    for (const [token, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (raw.startsWith(token, at)) { at += token.length; return value; }
    }
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    number.lastIndex = at; const match = number.exec(raw); if (!match) return bad();
    at = number.lastIndex; const value = Number(match[0]); return Number.isFinite(value) ? value : bad();
  }
  const result = read(0); whitespace(); if (at !== raw.length || !plain(result)) return bad(); return result;
}
function verifiedOrigin(value: SourceOcrImportOrigin): SourceOcrImportOrigin {
  const fields = ["schemaVersion", "purpose", "sourceAuditProfileVersion", "resourcePolicyVersion", "checkId", "sourceFileId", "sourceSha256",
    "inputManifestHash", "textStageContentHash", "textArtifactByteSha256", "textArtifactContentHash", "extractorProfileHash", "stage",
    "authorityStatus", "renderedVisibility", "calibratedProbability", "textArtifact"];
  const bad = (): never => fail("SOURCE_OCR_IMPORT_INVALID_ORIGIN", "Полный исходный артефакт V4 не подтверждён", 409);
  if (!exact(value, fields) || value.schemaVersion !== "document-text-v4-full-source-read-v1" || value.purpose !== "SOURCE_AUDIT_ONLY"
    || value.sourceAuditProfileVersion !== "SOURCE_AUDIT_V4_FULL_SOURCE_V1" || value.resourcePolicyVersion !== "document-text-v4-full-source-bounds-v1"
    || value.authorityStatus !== "SOURCE_DECLARED_UNVERIFIED" || value.renderedVisibility !== "UNVERIFIED" || value.calibratedProbability !== null
    || !["PD", "RD", "UNRESOLVED"].includes(value.stage)
    || ![value.checkId, value.sourceFileId].every(id => typeof id === "string" && id.length > 0 && id.length <= 200 && scalar(id) && !/[\u0000-\u0020\u007f-\u009f]/u.test(id))
    || ![value.sourceSha256, value.inputManifestHash, value.textStageContentHash, value.textArtifactByteSha256, value.textArtifactContentHash,
      value.extractorProfileHash].every(hash => typeof hash === "string" && SHA.test(hash))) return bad();
  const read = readDocumentTextV4FullArtifact(value.textArtifact);
  if (read.status !== "VALID") return bad();
  const a = value.textArtifact;
  if (a.sourceFileId !== value.sourceFileId || a.inputSha256 !== value.sourceSha256 || read.contentHash !== value.textArtifactContentHash
    || a.extractorProfileHash !== value.extractorProfileHash || a.extractorProfile.traversalPolicyVersion !== "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1"
    || nativeSourceSha256(nativeSourceCanonicalTrusted(a)) !== value.textArtifactByteSha256
    || value.textStageContentHash !== value.textArtifactByteSha256) return bad();
  return value;
}

export function deriveSourceOcrImport(input: SourceOcrImportBundle, origin: SourceOcrImportOrigin): SourceOcrImportDerived {
  const bundle = parseSourceOcrImportBundle(input);
  try { verifiedOrigin(origin); } catch (error) {
    if (error instanceof SourceOcrImportError) throw error;
    return fail("SOURCE_OCR_IMPORT_INVALID_ORIGIN", "Полный исходный артефакт V4 не подтверждён", 409);
  }
  if (bundle.sourceSha256 !== origin.sourceSha256) fail("SOURCE_OCR_IMPORT_SOURCE_MISMATCH", "OCR относится к другому исходнику", 409);
  const required = origin.textArtifact.pages.filter(page => page.quality.disposition === "OCR_REQUIRED");
  if (required.length > SOURCE_OCR_IMPORT_LIMITS.maxPages) limit();
  if (bundle.pages.length !== required.length || bundle.pages.some((page, index) => page.pageNumber !== required[index].pageNumber))
    fail("SOURCE_OCR_IMPORT_PAGE_SET_MISMATCH", "Нужны все и только страницы OCR_REQUIRED полного артефакта");
  let total = 0;
  const pages: SourceOcrImportDerivedPage[] = bundle.pages.map((page, index) => {
    const native = required[index];
    if (page.pdfWidthMilliPoints !== native.widthMilliPoints || page.pdfHeightMilliPoints !== native.heightMilliPoints)
      fail("SOURCE_OCR_IMPORT_GEOMETRY_MISMATCH", "Геометрия PDF не соответствует полному артефакту V4");
    const response = rawResponse(page.rawResponseJson);
    if (!exact(response, ["schemaVersion", "profileId", "script", "results"]) || response.schemaVersion !== "document-ai-ocr-response-v1"
      || response.profileId !== PROFILE || response.script !== "eslav") fail("SOURCE_OCR_IMPORT_PROFILE_MISMATCH", "Профиль ответа OCR не соответствует импорту");
    if (!Array.isArray(response.results) || response.results.length !== 1 || !plain(response.results[0]))
      fail("SOURCE_OCR_IMPORT_INVALID_RESPONSE", "Нужен ровно один результат OCR страницы");
    const result = response.results[0];
    if (result.width !== page.rasterWidth || result.height !== page.rasterHeight)
      fail("SOURCE_OCR_IMPORT_RASTER_MISMATCH", "Размеры внешнего растра расходятся с ответом OCR");
    const overall = result.overall_ocr_res;
    if (!plain(overall) || !Array.isArray(overall.rec_texts) || !Array.isArray(overall.rec_scores) || !Array.isArray(overall.rec_boxes)
      || overall.rec_texts.length !== overall.rec_scores.length || overall.rec_texts.length !== overall.rec_boxes.length)
      fail("SOURCE_OCR_IMPORT_INVALID_RESPONSE", "Массивы строк OCR не согласованы");
    total += overall.rec_texts.length;
    if (overall.rec_texts.length > SOURCE_OCR_IMPORT_LIMITS.maxLinesPerPage || total > SOURCE_OCR_IMPORT_LIMITS.maxTotalLines) limit();
    const rawResponseSha256 = sha256(page.rawResponseJson), lines: SourceOcrImportLine[] = [];
    for (let ordinal = 0; ordinal < overall.rec_texts.length; ordinal++) {
      const text = overall.rec_texts[ordinal], recognitionScore = overall.rec_scores[ordinal], box = overall.rec_boxes[ordinal];
      if (typeof text !== "string" || !scalar(text) || text.includes("\u0000") || typeof recognitionScore !== "number" || !Number.isFinite(recognitionScore)
        || recognitionScore < 0 || recognitionScore > 1 || !Array.isArray(box) || box.length !== 4
        || !box.every(n => typeof n === "number" && Number.isFinite(n)) || !(0 <= box[0] && box[0] < box[2] && box[2] <= page.rasterWidth
          && 0 <= box[1] && box[1] < box[3] && box[3] <= page.rasterHeight))
        fail("SOURCE_OCR_IMPORT_INVALID_RESPONSE", "Строка, score или рамка OCR недопустимы");
      if (Array.from(text).length > SOURCE_OCR_IMPORT_LIMITS.maxTextCharactersPerLine) limit();
      if (!text.trim()) continue;
      const line = { ordinal, text, recognitionScore, rasterBbox: [...box] as [number, number, number, number] };
      const lineHash = digest({ sourceSha256: bundle.sourceSha256, profileId: PROFILE, pageNumber: page.pageNumber,
        renderSha256: page.renderSha256, rawResponseSha256, line }, "source-ocr-import-line-v1");
      lines.push({ ...line, lineHash });
    }
    return { ...page, rawResponseSha256, lines, status: lines.length ? "TEXT_CANDIDATE" : "UNRESOLVED" };
  });
  const body: Omit<SourceOcrImportDerived, "contentHash"> = { schemaVersion: "source-ocr-import-derived-v1", status: "IMPORTED_OCR_UNVERIFIED",
    policyVersion: "source-ocr-import-v1", sourceSha256: bundle.sourceSha256, profileId: PROFILE, p: null, factEligible: false, coverageDelta: 0,
    providerExecutionVerified: false, renderDerivationVerified: false, pages, bundleHash: digest(bundle, "source-ocr-import-bundle-v1"),
    notices: ["EXTERNAL_OCR_IMPORTED_NOT_PROVIDER_EXECUTION", "EXTERNAL_RASTER_DERIVATION_UNVERIFIED", "RASTER_COORDINATES_ONLY_NO_TRUSTED_PDF_HIGHLIGHT",
      "HUMAN_TRANSCRIPTION_REVIEW_REQUIRED", "RECOGNITION_SCORE_NOT_CALIBRATED_PROBABILITY", "EMPTY_RECOGNITION_UNRESOLVED", "NO_FACT_OR_ABSENCE_OR_ENGINEERING_CONCLUSION"] };
  if (Buffer.byteLength(canonicalJson(body), "utf8") > SOURCE_OCR_IMPORT_LIMITS.maxDerivedBytes) limit();
  return freezeNativeSourceOutput({ ...body, contentHash: digest(body, "source-ocr-import-derived-v1") });
}

/** Integrity only; this does not validate a schema or authenticate imports/provider execution. */
export function verifySourceOcrImportDerivedHash(value: unknown): boolean {
  let nodes = 0, bytes = 0; const ancestors = new Set<object>();
  function snapshot(item: unknown, depth: number): unknown {
    if (++nodes > 500000 || depth > 48) throw Error("limit");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") { if (!Number.isFinite(item)) throw Error("number"); return item; }
    if (typeof item === "string") { bytes += Buffer.byteLength(item, "utf8"); if (bytes > 32 * 1024 * 1024 || !scalar(item)) throw Error("string"); return item; }
    if (!item || typeof item !== "object" || types.isProxy(item) || ancestors.has(item)) throw Error("object");
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) throw Error("prototype");
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.some(k => typeof k !== "string") || keys.length > 20001) throw Error("keys");
    const length = array ? descriptors.length?.value : undefined;
    if (array && (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1)) throw Error("array");
    const names = array ? Array.from({ length }, (_, i) => String(i)) : keys as string[];
    const result: Json | unknown[] = array ? [] : {}; ancestors.add(item);
    for (const key of names) {
      const d = descriptors[key]; if (!d?.enumerable || !Object.hasOwn(d, "value")) throw Error("descriptor");
      Object.defineProperty(result, key, { value: snapshot(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(item); return result;
  }
  try {
    if (!plain(value)) return false;
    const saved = snapshot(value, 0) as Json, hash = saved.contentHash;
    if (typeof hash !== "string" || !SHA.test(hash)) return false;
    delete saved.contentHash;
    return digest(saved, "source-ocr-import-derived-v1") === hash;
  } catch { return false; }
}
