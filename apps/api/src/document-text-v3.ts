import { createHash } from "node:crypto";
import { types } from "node:util";
import type {
  DocumentTextV3Artifact, DocumentTextV3Page, DocumentTextV3Quality,
  DocumentTextV3QualityMetrics, DocumentTextV3LargeReadResult,
} from "@inspector-ai/contracts";
import { DOCUMENT_TEXT_V3_LARGE_RESOURCE_POLICY } from "@inspector-ai/contracts";

/** Whole-artifact reader for the canonical document-text-v3.schema.json contract.
 * A matching profile hash proves integrity, not approval of an extractor release.
 */
export type DocumentTextV3ReadResult = { status: "VALID"; contentHash: string }
  | { status: "ABSTAIN"; reasonCode: "INVALID_INPUT" | "INPUT_LIMIT" | "INVALID_TEXT_ARTIFACT" };
type RecordValue = Record<string, unknown>;
type NativeResult = { status: "VALID"; canonical: string } | { status: "INVALID" | "LIMIT" };
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$(?![\s\S])/u;
const WHITESPACE = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonnegative = (v: unknown): v is number => integer(v) && v >= 0;
const record = (v: unknown): v is RecordValue => v !== null && typeof v === "object"
  && !types.isProxy(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: unknown, keys: readonly string[]): v is RecordValue => record(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const compareCodepoints = (a: string, b: string): number => {
  const aa = Array.from(a, c => c.codePointAt(0)!), bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
};

/** Read descriptors before values; reject proxies, callbacks, sparse arrays and cycles. */
type ResourcePolicy = "STANDARD" | "LARGE";
// Explicit finite operations from document-text-v3-resource-policy.schema.json.
function portable(input: unknown, resourcePolicy: ResourcePolicy = "STANDARD"): NativeResult {
  if (resourcePolicy !== "STANDARD" && resourcePolicy !== "LARGE") return { status: "INVALID" };
  const maximumNodes = resourcePolicy === "LARGE" ? 1400000 : 200000;
  const maximumBytes = resourcePolicy === "LARGE" ? 32000000 : 8000000;
  let nodes = 0, rawBytes = 0, limited = false;
  const ancestors = new Set<object>();
  function limit(): undefined { limited = true; return undefined; }
  function visit(value: unknown, depth: number): string | undefined {
    if (++nodes > maximumNodes || depth > 64) return limit();
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return integer(value) ? String(value) : undefined;
    if (typeof value === "string") {
      if (value.length > 4000000) return limit();
      let count = 0;
      for (const c of value) {
        if (++count > 2000000) return limit();
        const cp = c.codePointAt(0)!;
        if (cp >= 0xd800 && cp <= 0xdfff) return undefined;
      }
      rawBytes += Buffer.byteLength(value, "utf8");
      if (rawBytes > maximumBytes) return limit();
      return JSON.stringify(value);
    }
    if (value === null || typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) return undefined;
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(k => typeof k !== "string")) return undefined;
    let keys: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!nonnegative(length)) return undefined;
      if (length > 32768) return limit();
      if (names.length !== length + 1) return undefined;
      keys = Array.from({ length }, (_, i) => String(i));
    } else {
      if (names.length > 32768) return limit();
      keys = (names as string[]).sort(compareCodepoints);
    }
    ancestors.add(value);
    const parts: string[] = [];
    for (const key of keys) {
      const d = descriptors[key];
      if (!d || !d.enumerable || !Object.hasOwn(d, "value")) { ancestors.delete(value); return undefined; }
      const encodedKey = array ? "" : visit(key, depth + 1);
      if (encodedKey === undefined) { ancestors.delete(value); return undefined; }
      const encoded = visit(d.value, depth + 1);
      if (encoded === undefined) { ancestors.delete(value); return undefined; }
      parts.push(array ? encoded : `${encodedKey}:${encoded}`);
    }
    ancestors.delete(value);
    return array ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  }
  try {
    const canonical = visit(input, 0);
    if (canonical === undefined) return { status: limited ? "LIMIT" : "INVALID" };
    if (Buffer.byteLength(canonical, "utf8") > maximumBytes) return { status: "LIMIT" };
    return { status: "VALID", canonical };
  } catch { return { status: "INVALID" }; }
}

// Decimal values remain exact rationals. A native repr string never passes through Number.
type Decimal = { n: bigint; scale: number };
const power = (n: number) => 10n ** BigInt(n);
const subtract = (a: Decimal, b: Decimal): Decimal => {
  const scale = Math.max(a.scale, b.scale);
  return { n: a.n * power(scale - a.scale) - b.n * power(scale - b.scale), scale };
};
const compare = (a: Decimal, b: Decimal) => {
  const delta = subtract(a, b).n;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
};
const ZERO: Decimal = { n: 0n, scale: 0 }, EPSILON: Decimal = { n: 1n, scale: 6 };
function decimal(value: unknown): Decimal | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const match = DECIMAL.exec(value);
  if (!match) return undefined;
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  if (!Number.isInteger(exponent) || exponent < -324 || exponent > 308) return undefined;
  const fraction = match[3] ?? "";
  let n = BigInt(match[2] + fraction) * (match[1] ? -1n : 1n), scale = fraction.length - exponent;
  if (scale < 0) { n *= power(-scale); scale = 0; }
  if ((n < 0n ? -n : n) > 1000000000n * power(scale)) return undefined;
  return { n, scale };
}
function milli(value: Decimal): number {
  const numerator = value.n * 1000n, denominator = power(value.scale);
  const negative = numerator < 0n, absolute = negative ? -numerator : numerator;
  let rounded = absolute / denominator;
  const remainder = absolute % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && rounded % 2n !== 0n)) rounded++;
  return Number(negative ? -rounded : rounded);
}
function nativeBox(value: unknown): Decimal[] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const box = value.map(decimal);
  if (box.some(n => n === undefined)) return undefined;
  const result = box as Decimal[];
  return compare(result[0], result[2]) <= 0 && compare(result[1], result[3]) <= 0 ? result : undefined;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sha = (canonical: string) => createHash("sha256").update(canonical, "utf8").digest("hex");
const pathCompare = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
function quality(page: DocumentTextV3Page): DocumentTextV3Quality {
  const metrics: DocumentTextV3QualityMetrics = {
    locatedLineCount: page.locatedLines.length, unlocatedLineCount: page.unlocatedLines.length,
    locatedNonWhitespaceCharacters: 0, unlocatedNonWhitespaceCharacters: 0,
    replacementCharacters: 0, disallowedControlCharacters: 0, cidPlaceholders: 0,
  };
  for (const [lines, countKey] of [
    [page.locatedLines, "locatedNonWhitespaceCharacters"],
    [page.unlocatedLines, "unlocatedNonWhitespaceCharacters"],
  ] as const) for (const line of lines) {
    for (const c of line.rawText) {
      if (!WHITESPACE.test(c)) metrics[countKey]++;
      if (c === "\ufffd") metrics.replacementCharacters++;
      if (CONTROL.test(c)) metrics.disallowedControlCharacters++;
    }
    metrics.cidPlaceholders += Array.from(line.rawText.matchAll(/\(cid:[0-9]+\)/gu)).length;
  }
  const reasonCodes: DocumentTextV3Quality["reasonCodes"] = [];
  if (metrics.locatedNonWhitespaceCharacters === 0) reasonCodes.push("NO_LOCATED_TEXT");
  if (metrics.replacementCharacters || metrics.disallowedControlCharacters || metrics.cidPlaceholders) reasonCodes.push("TEXT_DECODING_ANOMALY");
  if (metrics.unlocatedLineCount) reasonCodes.push("UNLOCATED_TEXT_PRESENT");
  return { disposition: reasonCodes.includes("NO_LOCATED_TEXT") || reasonCodes.includes("TEXT_DECODING_ANOMALY")
    ? "OCR_REQUIRED" : metrics.unlocatedLineCount ? "PARTIAL_TEXT_LAYER" : "TEXT_LAYER_CANDIDATE", reasonCodes, metrics };
}
function equalQuality(value: unknown, expected: DocumentTextV3Quality): boolean {
  if (!exact(value, ["disposition", "reasonCodes", "metrics"]) || value.disposition !== expected.disposition
    || !same(value.reasonCodes, expected.reasonCodes) || !exact(value.metrics, Object.keys(expected.metrics))) return false;
  return Object.entries(expected.metrics).every(([key, count]) => value.metrics && (value.metrics as RecordValue)[key] === count);
}
function validArtifact(value: unknown): value is DocumentTextV3Artifact {
  if (!exact(value, ["schemaVersion", "sourceFileId", "inputSha256", "coordinateSystem", "pageCount", "locatedTextPageCount",
    "unlocatedTextPageCount", "extractorProfile", "extractorProfileHash", "qualitySummary", "pages"])
    || value.schemaVersion !== "document-text-v3" || value.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || typeof value.sourceFileId !== "string" || !value.sourceFileId || Array.from(value.sourceFileId).length > 200
    || CONTROL.test(value.sourceFileId) || /[\u0009\u000a\u000d]/u.test(value.sourceFileId)
    || WHITESPACE.test(value.sourceFileId[0]) || WHITESPACE.test(Array.from(value.sourceFileId).at(-1)!)
    || typeof value.inputSha256 !== "string" || !SHA.test(value.inputSha256)
    || !integer(value.pageCount) || value.pageCount < 1 || value.pageCount > 512
    || !Array.isArray(value.pages) || value.pages.length !== value.pageCount
    || !nonnegative(value.locatedTextPageCount) || !nonnegative(value.unlocatedTextPageCount)) return false;
  const profile = value.extractorProfile;
  if (!exact(profile, ["schemaVersion", "textLayerSourceSha256", "documentTextV3SourceSha256", "pdfminerVersion", "geometryPolicyVersion", "cropPolicyVersion", "traversalPolicyVersion", "qualityPolicyVersion"])
    || profile.schemaVersion !== "document-text-extractor-profile-v1" || profile.pdfminerVersion !== "20260107"
    || profile.geometryPolicyVersion !== "document-text-v3-decimal-half-even-v1"
    || profile.cropPolicyVersion !== "visible-crop-contained-epsilon-1e-6-v1"
    || (profile.traversalPolicyVersion !== "pdfminer-top-level-whole-lines-v1"
      && profile.traversalPolicyVersion !== "pdfminer-analyzed-figures-whole-lines-v1"
      && profile.traversalPolicyVersion !== "pdfminer-analyzed-figures-boxes-flow-none-v1"
      && profile.traversalPolicyVersion !== "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1")
    || profile.qualityPolicyVersion !== "document-text-quality-v3"
    || typeof profile.textLayerSourceSha256 !== "string" || !SHA.test(profile.textLayerSourceSha256)
    || typeof profile.documentTextV3SourceSha256 !== "string" || !SHA.test(profile.documentTextV3SourceSha256)) return false;
  const encodedProfile = portable({ hashDomain: "document-text-extractor-profile-v1", profile });
  if (encodedProfile.status !== "VALID" || value.extractorProfileHash !== sha(encodedProfile.canonical)) return false;
  const maximumPathLength = profile.traversalPolicyVersion === "pdfminer-top-level-whole-lines-v1" ? 2 : 64;
  const summary = { candidatePages: 0, partialPages: 0, ocrRequiredPages: 0 };
  let locatedPages = 0, unlocatedPages = 0;
  for (const [index, page] of value.pages.entries()) {
    if (!exact(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "nativeFrame", "locatedLines", "unlocatedLines", "quality"])
      || page.pageNumber !== index + 1 || !integer(page.widthMilliPoints) || page.widthMilliPoints < 1
      || !integer(page.heightMilliPoints) || page.heightMilliPoints < 1
      || !exact(page.nativeFrame, ["coordinateSystem", "visibleBoxPointStrings"])
      || page.nativeFrame.coordinateSystem !== "PDFMINER_LAYOUT_POINTS"
      || !Array.isArray(page.locatedLines) || !Array.isArray(page.unlocatedLines)) return false;
    const frame = nativeBox(page.nativeFrame.visibleBoxPointStrings);
    if (!frame || compare(frame[0], frame[2]) >= 0 || compare(frame[1], frame[3]) >= 0
      || milli(subtract(frame[2], frame[0])) !== page.widthMilliPoints
      || milli(subtract(frame[3], frame[1])) !== page.heightMilliPoints) return false;
    const paths: number[][] = [];
    for (const [lines, located] of [[page.locatedLines, true], [page.unlocatedLines, false]] as const) {
      let previous: number[] | undefined;
      for (const line of lines) {
        if (!exact(line, ["sourcePath", "rawText", "nativeBoxPointStrings", located ? "bboxMilliPoints" : "reasonCode"])
          || !Array.isArray(line.sourcePath) || line.sourcePath.length < 1 || line.sourcePath.length > maximumPathLength
          || line.sourcePath.some(n => !nonnegative(n) || n > 32767)
          || typeof line.rawText !== "string" || !line.rawText
          || (previous && pathCompare(previous, line.sourcePath) >= 0)) return false;
        previous = line.sourcePath; paths.push(line.sourcePath);
        const box = nativeBox(line.nativeBoxPointStrings);
        if (!box) return false;
        for (let axis = 0; axis < 2; axis++) {
          if (compare(subtract(frame[axis], box[axis]), EPSILON) > 0
            || compare(subtract(box[axis + 2], frame[axis + 2]), EPSILON) > 0) return false;
        }
        const bounds = [0, 1, 2, 3].map(i => Math.max(0, Math.min(
          i % 2 === 0 ? page.widthMilliPoints as number : page.heightMilliPoints as number,
          milli(subtract(box[i], frame[i % 2])),
        )));
        const nativeZero = compare(box[0], box[2]) === 0 || compare(box[1], box[3]) === 0;
        const collapsed = bounds[0] === bounds[2] || bounds[1] === bounds[3];
        if (located ? nativeZero || collapsed || !same(line.bboxMilliPoints, bounds)
          : line.reasonCode !== (nativeZero ? "NATIVE_ZERO_AREA" : collapsed ? "MILLI_POINT_COLLAPSE" : undefined)) return false;
      }
    }
    paths.sort(pathCompare);
    for (let i = 1; i < paths.length; i++) {
      const a = paths[i - 1], b = paths[i];
      if (a.every((v, j) => b[j] === v)) return false;
    }
    const expectedQuality = quality(page as unknown as DocumentTextV3Page);
    if (!equalQuality(page.quality, expectedQuality)) return false;
    if (expectedQuality.metrics.locatedNonWhitespaceCharacters) locatedPages++;
    if (expectedQuality.metrics.unlocatedLineCount) unlocatedPages++;
    summary[expectedQuality.disposition === "TEXT_LAYER_CANDIDATE" ? "candidatePages"
      : expectedQuality.disposition === "PARTIAL_TEXT_LAYER" ? "partialPages" : "ocrRequiredPages"]++;
  }
  return value.locatedTextPageCount === locatedPages && value.unlocatedTextPageCount === unlocatedPages
    && exact(value.qualitySummary, Object.keys(summary))
    && Object.entries(summary).every(([key, count]) => (value.qualitySummary as RecordValue)[key] === count);
}

function readWithResourcePolicy(value: unknown, resourcePolicy: ResourcePolicy): DocumentTextV3ReadResult {
  const native = portable(value, resourcePolicy);
  if (native.status !== "VALID") return { status: "ABSTAIN", reasonCode: native.status === "LIMIT" ? "INPUT_LIMIT" : "INVALID_INPUT" };
  // Resource limits precede semantic schema rejection, and cover the whole artifact.
  if (record(value) && Array.isArray(value.pages)) {
    if (value.pages.length > 512) return { status: "ABSTAIN", reasonCode: "INPUT_LIMIT" };
    let lines = 0;
    for (const page of value.pages) if (record(page)) for (const key of ["locatedLines", "unlocatedLines"]) {
      if (Array.isArray(page[key])) lines += page[key].length;
      if (lines > 100000) return { status: "ABSTAIN", reasonCode: "INPUT_LIMIT" };
    }
  }
  if (!validArtifact(value)) return { status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" };
  // Key order is canonical and independent from native insertion order.
  return { status: "VALID", contentHash: sha(`{"artifact":${native.canonical},"hashDomain":"document-text-v3-content-v1"}`) };
}

/** Frozen default operation; oversized documents never retry with another policy. */
export function readDocumentTextV3Artifact(value: unknown): DocumentTextV3ReadResult {
  return readWithResourcePolicy(value, "STANDARD");
}

/** Explicit full-source capacity; all original semantic checks remain shared. */
export function readDocumentTextV3LargeArtifact(value: unknown): DocumentTextV3LargeReadResult {
  return { ...readWithResourcePolicy(value, "LARGE"), resourcePolicyVersion: DOCUMENT_TEXT_V3_LARGE_RESOURCE_POLICY };
}

export function documentTextV3LargeContentHash(value: unknown): string {
  const result = readDocumentTextV3LargeArtifact(value);
  if (result.status !== "VALID") throw new Error(result.reasonCode);
  return result.contentHash;
}

export function documentTextV3ContentHash(value: unknown): string {
  const result = readDocumentTextV3Artifact(value);
  if (result.status !== "VALID") throw new Error(result.reasonCode);
  return result.contentHash;
}
