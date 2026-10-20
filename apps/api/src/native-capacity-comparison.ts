import { createHash } from "node:crypto";
import { types } from "node:util";
import type { NativeCapacityAbstainReason, NativeCapacityComparison, NativeCapacityOrigin,
  NativeCapacityProvenance, NativeCapacityQuote, NativeCapacityTitleFragment } from "@inspector-ai/contracts";
import { readDocumentTextV4FullArtifact } from "./document-text-v4.js";
import type { DocumentTextV4LocatedLine } from "@inspector-ai/contracts";

export const NATIVE_CAPACITY_LIMITS = Object.freeze({ maxPagesPerSource: 1024,
  maxNativeLinesPerSource: 128000, maxQuotesPerSource: 4096, maxQuoteUtf8BytesPerSource: 1048576 });
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
const ORIGIN_FIELDS = ["schemaVersion", "purpose", "sourceAuditProfileVersion", "resourcePolicyVersion", "checkId",
  "sourceFileId", "sourceSha256", "inputManifestHash", "textStageContentHash", "textArtifactByteSha256",
  "textArtifactContentHash", "extractorProfileHash", "stage", "authorityStatus", "renderedVisibility",
  "calibratedProbability", "textArtifact"];
const HASH_FIELDS = ["sourceSha256", "inputManifestHash", "textStageContentHash", "textArtifactByteSha256",
  "textArtifactContentHash", "extractorProfileHash"] as const;
const NOTICE = ["SOURCE_DECLARATIONS_ONLY", "SOURCE_ROLE_UNVERIFIED", "REVISION_AND_APPROVAL_UNVERIFIED",
  "RENDERED_VISIBILITY_UNVERIFIED", "COMPOSITE_TRIGGER_REMAINS", "NO_ENGINEERING_OR_ABSENCE_CONCLUSION"];
// Horizontal separators only. No joins across lines/pages, OCR, fuzzy matching or unit conversion.
const PREFIX = /(?<![\p{L}\p{N}_])школа[ \u00a0\u202f]+на(?![\p{L}\p{N}_])/giu;
const TITLE = /(?<![\p{L}\p{N}_])школа[ \u00a0\u202f]+на[ \u00a0\u202f]+([1-9][0-9]{0,5})[ \u00a0\u202f]+мест(?![\p{L}\p{N}_])/giu;
const QUANTITY = /^[ \u00a0\u202f]*([1-9][0-9]{0,5})[ \u00a0\u202f]+мест[ \u00a0\u202f]*(?:\r?\n)?$/iu;
type Json = Record<string, unknown>;
/** Used only after callback-free whole V4 validation, or on freshly constructed output. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonical((value as Json)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
/** Integrity only, not origin authentication or semantic admission. For saved freshly parsed JSON.
 * Read descriptors first so malformed callers cannot execute callbacks through serialization. */
export function verifyNativeCapacityComparisonHash(value: NativeCapacityComparison): boolean {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string | undefined {
    if (++nodes > 1400000 || depth > 64) return undefined;
    if (item === null) return "null";
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "number") return Number.isSafeInteger(item) ? String(item) : undefined;
    if (typeof item === "string") {
      bytes += Buffer.byteLength(item, "utf8");
      if (bytes > 32000000 || item.length > 2000000) return undefined;
      for (const character of item) { const cp = character.codePointAt(0)!; if (cp >= 0xd800 && cp <= 0xdfff) return undefined; }
      return JSON.stringify(item);
    }
    if (!item || typeof item !== "object" || types.isProxy(item) || ancestors.has(item)) return undefined;
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(item), names = Reflect.ownKeys(descriptors);
    if (names.length > 131072 || names.some(key => typeof key !== "string")) return undefined;
    const length = array ? descriptors.length?.value : undefined;
    if (array && (!Number.isSafeInteger(length) || length < 0 || length + 1 !== names.length)) return undefined;
    const keys = array ? Array.from({ length }, (_, index) => String(index)) : (names as string[]).sort();
    ancestors.add(item); const parts: string[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
      const encoded = encode(descriptor.value, depth + 1); if (encoded === undefined) return undefined;
      parts.push(array ? encoded : `${JSON.stringify(key)}:${encoded}`);
    }
    ancestors.delete(item);
    return array ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  }
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value), hash = descriptors.contentHash;
    if (!hash?.enumerable || !Object.hasOwn(hash, "value") || typeof hash.value !== "string" || !SHA.test(hash.value)) return false;
    const body: Json = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key]; if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return false;
      if (key !== "contentHash") Object.defineProperty(body, key, { value: descriptor.value, enumerable: true });
    }
    const raw = encode({ hashDomain: "native-capacity-comparison-v1", result: body }, 0);
    return raw !== undefined && Buffer.byteLength(raw, "utf8") <= 32000000 && sha(raw) === hash.value;
  } catch { return false; }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function result(body: Json): NativeCapacityComparison {
  const output = { schemaVersion: "native-capacity-comparison-v1", policyVersion: "native-school-title-capacity-v1",
    purpose: "SOURCE_ONLY", parameterCode: "PZ-013", attribute: "DECLARED_SCHOOL_SEAT_CAPACITY",
    p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0, engineeringQualification: false,
    completeConfiguration: false, notices: [...NOTICE], excludedTitleFragments: [], ...body };
  return freeze({ ...output, contentHash: sha(canonical({ hashDomain: "native-capacity-comparison-v1", result: output })) }) as unknown as NativeCapacityComparison;
}
const abstain = (reasonCode: NativeCapacityAbstainReason, fragments: NativeCapacityTitleFragment[] = []) => result({
  status: "ABSTAIN", reasonCode, excludedTitleFragments: fragments,
  notices: fragments.length ? [...NOTICE, "NATIVE_TITLE_FRAGMENTS_UNRESOLVED"] : [...NOTICE] });
function originShape(value: unknown): value is NativeCapacityOrigin {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== ORIGIN_FIELDS.length || !ORIGIN_FIELDS.every(key => descriptors[key]?.enumerable
    && Object.hasOwn(descriptors[key]!, "value"))) return false;
  const v = value as Json;
  return v.schemaVersion === "document-text-v4-full-source-read-v1" && v.purpose === "SOURCE_AUDIT_ONLY"
    && v.sourceAuditProfileVersion === "SOURCE_AUDIT_V4_FULL_SOURCE_V1"
    && v.resourcePolicyVersion === "document-text-v4-full-source-bounds-v1"
    && [v.checkId, v.sourceFileId].every(id => typeof id === "string" && id.length > 0 && id.length <= 200
      && !/[\u0000-\u0020\u007f-\u009f]/u.test(id))
    && HASH_FIELDS.every(key => typeof v[key] === "string" && SHA.test(v[key] as string))
    && ["PD", "RD", "UNRESOLVED"].includes(v.stage as string)
    && v.authorityStatus === "SOURCE_DECLARED_UNVERIFIED" && v.renderedVisibility === "UNVERIFIED"
    && v.calibratedProbability === null;
}
function verify(origin: NativeCapacityOrigin): NativeCapacityAbstainReason | undefined {
  const read = readDocumentTextV4FullArtifact(origin.textArtifact);
  if (read.status !== "VALID") return read.reasonCode === "INPUT_LIMIT" ? "INPUT_LIMIT" : "INVALID_TEXT_ARTIFACT";
  const artifact = origin.textArtifact;
  if (artifact.extractorProfile.traversalPolicyVersion !== "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1"
    || artifact.extractorProfileHash !== origin.extractorProfileHash) return "EXTRACTOR_PROFILE_MISMATCH";
  const bytesHash = sha(canonical(artifact));
  if (artifact.sourceFileId !== origin.sourceFileId || artifact.inputSha256 !== origin.sourceSha256
    || read.contentHash !== origin.textArtifactContentHash || bytesHash !== origin.textArtifactByteSha256
    || origin.textStageContentHash !== bytesHash) return "ORIGIN_ARTIFACT_MISMATCH";
  return undefined;
}
type Scan = { quotes: NativeCapacityQuote[]; value: string; count: number; fragments: NativeCapacityTitleFragment[] }
  | { reason: NativeCapacityAbstainReason; fragments?: NativeCapacityTitleFragment[] };
function lineCopy(line: DocumentTextV4LocatedLine) {
  return { sourcePath: [...line.sourcePath], rawText: line.rawText,
    nativeBoxPointStrings: [...line.nativeBoxPointStrings] as [string, string, string, string],
    bboxMilliPoints: [...line.bboxMilliPoints] as [number, number, number, number] };
}
function twoLineGeometry(title: DocumentTextV4LocatedLine, quantity: DocumentTextV4LocatedLine): boolean {
  const a = title.sourcePath, b = quantity.sourcePath;
  if (a.length < 2 || a.length !== b.length || a.at(-1)! + 1 !== b.at(-1)
    || a.slice(0, -1).some((part, index) => part !== b[index])) return false;
  const x = title.bboxMilliPoints, y = quantity.bboxMilliPoints;
  const overlap = Math.min(x[2], y[2]) - Math.max(x[0], y[0]);
  const minimumWidth = Math.min(x[2] - x[0], y[2] - y[0]);
  const gap = x[1] - y[3], maximumHeight = Math.max(x[3] - x[1], y[3] - y[1]);
  return overlap * 5 >= minimumWidth * 4 && gap >= 0 && gap <= 2 * maximumHeight;
}
function scan(origin: NativeCapacityOrigin, role: "PD" | "RD"): Scan {
  const artifact = origin.textArtifact, quotes: NativeCapacityQuote[] = [], values = new Set<string>();
  const fragments: NativeCapacityTitleFragment[] = [];
  let count = 0, quoteBytes = 0;
  if (artifact.pageCount > NATIVE_CAPACITY_LIMITS.maxPagesPerSource) return { reason: "INPUT_LIMIT" };
  for (const page of artifact.pages) {
    count += page.locatedLines.length + page.unlocatedLines.length;
    if (count > NATIVE_CAPACITY_LIMITS.maxNativeLinesPerSource) return { reason: "INPUT_LIMIT" };
    for (const line of page.unlocatedLines) if (Array.from(line.rawText.matchAll(PREFIX)).length) return { reason: "UNLOCATED_TITLE" };
    for (const [index, line] of page.locatedLines.entries()) {
      const prefixes = Array.from(line.rawText.matchAll(PREFIX));
      if (!prefixes.length) continue;
      const matches = Array.from(line.rawText.matchAll(TITLE));
      if (matches.length > 1 || prefixes.length > 1) return { reason: "AMBIGUOUS_TITLE_ENTITY" };
      let selectedLine = line, value: string, range: [number, number];
      let contextTitleLine: ReturnType<typeof lineCopy> | undefined;
      if (matches.length !== 1) {
        if (!/^[ \u00a0\u202f]*школа[ \u00a0\u202f]+на[ \u00a0\u202f]*(?:\r?\n)?$/iu.test(line.rawText))
          return { reason: "UNSUPPORTED_TITLE_GRAMMAR" };
        const next = page.locatedLines[index + 1], quantity = next && QUANTITY.exec(next.rawText);
        if (next && quantity && twoLineGeometry(line, next)) {
          const following = page.locatedLines[index + 2];
          if (following && canonical(following.sourcePath.slice(0, -1)) === canonical(next.sourcePath.slice(0, -1))
            && /^[ \u00a0\u202f]*[0-9]/u.test(following.rawText)) return { reason: "AMBIGUOUS_TITLE_ENTITY" };
          selectedLine = next; value = quantity[1]; contextTitleLine = lineCopy(line);
          const start = Array.from(next.rawText.slice(0, next.rawText.indexOf(value))).length;
          range = [start, start + Array.from(value).length];
        } else {
        const candidates = [page.locatedLines[index - 1], next].filter((item): item is DocumentTextV4LocatedLine => Boolean(item));
        const continuations = candidates.filter(item => {
          const nearby = canonical(item.sourcePath.slice(0, -1)) === canonical(line.sourcePath.slice(0, -1))
            || (item.bboxMilliPoints[0] < line.bboxMilliPoints[2] && item.bboxMilliPoints[2] > line.bboxMilliPoints[0]
              && Math.abs(line.bboxMilliPoints[1] - item.bboxMilliPoints[3]) <= 2 * (line.bboxMilliPoints[3] - line.bboxMilliPoints[1]));
          return Array.from(item.rawText.matchAll(PREFIX)).length === 0
            && (nearby || QUANTITY.test(item.rawText)) && /[0-9]/u.test(item.rawText)
            && (/^[ \u00a0\u202f]*[0-9]/u.test(item.rawText) || /мест/iu.test(item.rawText));
        });
        const continuation = continuations.length > 0;
        if (fragments.length >= NATIVE_CAPACITY_LIMITS.maxQuotesPerSource) return { reason: "INPUT_LIMIT" };
        const fragment: NativeCapacityTitleFragment = { reason: continuation ? "TITLE_CONTINUATION_UNRESOLVED" : "TITLE_WITHOUT_QUANTITY",
          inputRole: role, sourceFileId: origin.sourceFileId, sourceSha256: origin.sourceSha256,
          textArtifactContentHash: origin.textArtifactContentHash, physicalPage: page.pageNumber,
          pageWidthMilliPoints: page.widthMilliPoints, pageHeightMilliPoints: page.heightMilliPoints,
          sourcePath: [...line.sourcePath], rawText: line.rawText, nativeBoxPointStrings: [...line.nativeBoxPointStrings],
          bboxMilliPoints: [...line.bboxMilliPoints], coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
          continuationLines: continuations.map(lineCopy) };
        fragments.push(fragment);
        if (continuation) return { reason: "TITLE_CONTINUATION_UNRESOLVED", fragments };
        continue;
        }
      } else {
        const match = matches[0]; value = match[1];
        const suffix = line.rawText.slice(match.index! + match[0].length);
        if (/[0-9]+[ \u00a0\u202f]+мест(?![\p{L}\p{N}_])/iu.test(suffix)) return { reason: "AMBIGUOUS_TITLE_ENTITY" };
        if (!/^[ \u00a0\u202f]*(?:[,»"”\r\n]|$)/u.test(suffix)) return { reason: "UNSUPPORTED_TITLE_GRAMMAR" };
        const next = page.locatedLines[index + 1];
        if (next && line.sourcePath.length >= 2 && canonical(next.sourcePath.slice(0, -1)) === canonical(line.sourcePath.slice(0, -1))
          && /^[ \u00a0\u202f]*[0-9].*мест/iu.test(next.rawText)) return { reason: "AMBIGUOUS_TITLE_ENTITY" };
        const start = Array.from(line.rawText.slice(0, match.index)).length;
        range = [start, start + Array.from(match[0]).length];
      }
      if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") return { reason: "MATCHING_PAGE_UNVERIFIED" };
      quoteBytes += Buffer.byteLength(selectedLine.rawText, "utf8") + (contextTitleLine ? Buffer.byteLength(contextTitleLine.rawText, "utf8") : 0);
      if (quotes.length >= NATIVE_CAPACITY_LIMITS.maxQuotesPerSource
        || quoteBytes > NATIVE_CAPACITY_LIMITS.maxQuoteUtf8BytesPerSource) return { reason: "INPUT_LIMIT" };
      values.add(value);
      quotes.push({ sourceFileId: origin.sourceFileId, sourceSha256: origin.sourceSha256,
        textArtifactContentHash: origin.textArtifactContentHash, inputRole: role, evidenceKind: "NATIVE",
        physicalPage: page.pageNumber, pageWidthMilliPoints: page.widthMilliPoints, pageHeightMilliPoints: page.heightMilliPoints,
        ...lineCopy(selectedLine), coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
        matchedRangeCodePoints: range, rawValue: value, value, unit: "мест", renderedVisibility: "UNVERIFIED",
        extractionMethod: contextTitleLine ? "NATIVE_SAME_BLOCK_TWO_LINE_TITLE" : "NATIVE_SINGLE_LINE_TITLE",
        ...(contextTitleLine ? { contextTitleLine } : {}) });
    }
  }
  if (values.size > 1) return { reason: "CAPACITY_DECLARATIONS_CONFLICT" };
  if (!quotes.length) return { reason: "CAPACITY_EVIDENCE_MISSING" };
  return { quotes, value: [...values][0], count, fragments };
}
function provenance(origin: NativeCapacityOrigin, role: "PD" | "RD", count: number): NativeCapacityProvenance {
  return { checkId: origin.checkId, sourceFileId: origin.sourceFileId, sourceSha256: origin.sourceSha256,
    inputManifestHash: origin.inputManifestHash, textStageContentHash: origin.textStageContentHash,
    textArtifactByteSha256: origin.textArtifactByteSha256, textArtifactContentHash: origin.textArtifactContentHash,
    extractorProfileHash: origin.extractorProfileHash, extractorProfile: { ...origin.textArtifact.extractorProfile },
    sourceAuditProfileVersion: origin.sourceAuditProfileVersion, resourcePolicyVersion: origin.resourcePolicyVersion,
    declaredStage: origin.stage, selectedRole: role, roleQualification: "UNVERIFIED", pageCount: origin.textArtifact.pageCount,
    scannedNativeLineCount: count };
}
/** Pure, bounded source arithmetic. Authentication/object membership remains the caller's responsibility.
 * checkId is the origin's run identity; this contract has no independent object/release-ID field.
 * Equal declarations never establish physical capacity, revision authority, absence or compliance. */
export function compareNativeCapacity(pdOrigin: NativeCapacityOrigin, rdOrigin: NativeCapacityOrigin): NativeCapacityComparison {
  try {
    if (!originShape(pdOrigin) || !originShape(rdOrigin)) return abstain("INVALID_ORIGIN");
    if (pdOrigin.checkId !== rdOrigin.checkId || pdOrigin.inputManifestHash !== rdOrigin.inputManifestHash) return abstain("PAIR_SCOPE_MISMATCH");
    if (pdOrigin.sourceFileId === rdOrigin.sourceFileId || pdOrigin.sourceSha256 === rdOrigin.sourceSha256) return abstain("IDENTICAL_SOURCE");
    if (pdOrigin.stage === "RD" || rdOrigin.stage === "PD") return abstain("SOURCE_ROLE_CONFLICT");
    for (const origin of [pdOrigin, rdOrigin]) { const reason = verify(origin); if (reason) return abstain(reason); }
    if (pdOrigin.extractorProfileHash !== rdOrigin.extractorProfileHash) return abstain("EXTRACTOR_PROFILE_MISMATCH");
    const pd = scan(pdOrigin, "PD"); if ("reason" in pd) return abstain(pd.reason, pd.fragments);
    const rd = scan(rdOrigin, "RD"); if ("reason" in rd) return abstain(rd.reason, [...pd.fragments, ...(rd.fragments ?? [])]);
    const delta = BigInt(rd.value) - BigInt(pd.value);
    return result({ status: "COMPARED", comparison: delta === 0n ? "EQUAL" : delta < 0n ? "DECREASE" : "INCREASE",
      pdValue: pd.value, rdValue: rd.value, deltaRdMinusPd: String(delta), unit: "мест",
      sources: { PD: provenance(pdOrigin, "PD", pd.count), RD: provenance(rdOrigin, "RD", rd.count) },
      quotes: { PD: pd.quotes, RD: rd.quotes }, excludedTitleFragments: [...pd.fragments, ...rd.fragments],
      notices: pd.fragments.length + rd.fragments.length ? [...NOTICE, "NATIVE_TITLE_FRAGMENTS_UNRESOLVED"] : [...NOTICE] });
  } catch { return abstain("INVALID_ORIGIN"); }
}
