import { createHash } from "node:crypto";
import { types } from "node:util";
import type { DocumentTextV3Artifact, DocumentTextV3LocatedLine, LightingTechnologyV3Declaration,
  LightingTechnologyV3PrimaryFragment, LightingTechnologyV3Result } from "@inspector-ai/contracts";
import { readDocumentTextV3Artifact } from "./document-text-v3.js";

type RecordValue = Record<string, unknown>;
type NativeResult = { status: "VALID"; canonical: string } | { status: "INVALID" | "LIMIT" };
type Box = [number, number, number, number];
const SCHEMA = "matrix-zu130-lighting-technology-source-v3-result-v1";
export const LIGHTING_TECHNOLOGY_V3_EXTRACTOR_VERSION = "matrix-zu130-lighting-technology-source-v3-v1";
export const LIGHTING_TECHNOLOGY_V3_POLICY_VERSION = "matrix-zu130-explicit-lighting-technology-v3-literals-v1";
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonnegative = (v: unknown): v is number => integer(v) && v >= 0;
const positive = (v: unknown): v is number => integer(v) && v > 0;
const record = (v: unknown): v is RecordValue => v !== null && typeof v === "object"
  && !types.isProxy(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: unknown, keys: readonly string[]): v is RecordValue => record(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
const shaValue = (v: unknown): v is string => typeof v === "string" && SHA.test(v);
const STAGES = new Set(["PD", "RD", "ID", "UNRESOLVED"]);
const WHITESPACE = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const pyTrim = (v: string) => v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, "");
const key = (v: unknown): v is string => typeof v === "string" && [...v].length > 0 && [...v].length <= 200
  && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v) && pyTrim(v) === v;
const path = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 1 && v.length <= 64
  && v.every(n => nonnegative(n) && n <= 32767);
const pathKey = (v: number[]) => v.join(":");
const pathCompare = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
const validBox = (v: unknown, w: number, h: number): v is Box => Array.isArray(v) && v.length === 4
  && v.every(nonnegative) && v[0] < v[2] && v[1] < v[3] && v[2] <= w && v[3] <= h;
const union = (boxes: Box[]): Box => [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
  Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
const abstain = (reasonCode: Extract<LightingTechnologyV3Result, {status: "ABSTAIN"}>["reasonCode"]): LightingTechnologyV3Result =>
  ({schemaVersion: SCHEMA, status: "ABSTAIN", reasonCode});
const compareCodepoints = (a: string, b: string): number => {
  const aa = Array.from(a, c => c.codePointAt(0)!), bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
};

/** Read descriptors before values; reject proxies, callbacks, sparse arrays and cycles. */
function portable(input: unknown): NativeResult {
  let nodes = 0, rawBytes = 0, limited = false;
  const ancestors = new Set<object>();
  function limit(): undefined { limited = true; return undefined; }
  function visit(value: unknown, depth: number): string | undefined {
    if (++nodes > 200000 || depth > 64) return limit();
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
      if (rawBytes > 8000000) return limit();
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
    if (Buffer.byteLength(canonical, "utf8") > 8000000) return { status: "LIMIT" };
    return { status: "VALID", canonical };
  } catch { return { status: "INVALID" }; }
}


const aliases = new Map<string, LightingTechnologyV3Declaration["technology"]>([
  ["LED", "LED"], ["светодиодный", "LED"], ["светодиодные", "LED"],
  ["FLUORESCENT", "FLUORESCENT"], ["люминесцентный", "FLUORESCENT"], ["люминесцентные", "FLUORESCENT"],
  ["INCANDESCENT", "INCANDESCENT"], ["лампа накаливания", "INCANDESCENT"], ["лампы накаливания", "INCANDESCENT"],
]);
const named = /^Светильник +([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79})\. Источник +света: ([^\r\n\t]+)\.$(?![\s\S])/u;
const first = /^Светотехническое +оборудование +приняты +с +энергосберегающими +источниками +света$(?![\s\S])/u;
const second = /^\(([^()\r\n\t]+)\), на базе продукции компании «([^«»()\x22\x27\r\n\t]{1,200})»\.$(?![\s\S])/u;
/** New, explicit grammar view. Raw source and Unicode codepoint offsets stay intact. */
function view(raw: string) {
  const chars = Array.from(raw); let start = 0, end = chars.length;
  if (chars[end - 1] === "\n") end--;
  while (start < end && chars[start] === " ") start++;
  while (end > start && chars[end - 1] === " ") end--;
  return { text: chars.slice(start, end).join(""), range: {start, end} };
}
const order = (a: DocumentTextV3LocatedLine, b: DocumentTextV3LocatedLine) =>
  b.bboxMilliPoints[3] - a.bboxMilliPoints[3] || a.bboxMilliPoints[0] - b.bboxMilliPoints[0]
  || pathCompare(a.sourcePath, b.sourcePath);
function groupGeometry(fragments: DocumentTextV3LocatedLine[]): boolean {
  if (fragments.length !== 2) return true;
  const [a, b] = fragments.map(f => f.bboxMilliPoints), [pa, pb] = fragments.map(f => f.sourcePath);
  return [a, b].every(v => v[3] - v[1] >= 9000 && v[3] - v[1] <= 14000)
    && Math.abs((a[3] - a[1]) - (b[3] - b[1])) <= 1000 && Math.abs(a[0] - b[0]) <= 16000
    && a[2] >= b[2] && a[1] - b[3] >= 0 && a[1] - b[3] <= 18000
    && (pathKey(pa.slice(0, -1)) !== pathKey(pb.slice(0, -1)) || pb.at(-1) === pa.at(-1)! + 1);
}
function parseLiteral(raws: string[]) {
  const views = raws.map(view);
  if (views.some(v => !v.text || /[\r\n\t]/u.test(v.text))) return undefined;
  let positionLabel: string | null, rawTechnology: string;
  if (raws.length === 1) {
    const m = named.exec(views[0].text); if (!m) return undefined;
    positionLabel = m[1]; rawTechnology = m[2];
  } else {
    const m = second.exec(views[1].text);
    if (!first.test(views[0].text) || !m || !pyTrim(m[2]) || pyTrim(m[2]) !== m[2]
      || /[\u0000-\u001f\u007f-\u009f]/u.test(m[2])) return undefined;
    positionLabel = null; rawTechnology = m[1];
  }
  const technology = aliases.get(rawTechnology);
  return technology ? {positionLabel, rawTechnology, technology, views} : undefined;
}

export function reconstructLightingTechnologySourceV3(input: unknown): LightingTechnologyV3Result {
  const native = portable(input);
  if (native.status !== "VALID") return abstain(native.status === "LIMIT" ? "INPUT_LIMIT" : "INVALID_INPUT");
  if (!exact(input, ["sourceFileId", "sourceSha256", "stage", "pageStages", "textArtifact", "selection"])
    || !key(input.sourceFileId) || !shaValue(input.sourceSha256) || typeof input.stage !== "string"
    || !STAGES.has(input.stage) || !record(input.pageStages)) return abstain("INVALID_INPUT");
  const pageStages = input.pageStages;
  if (Object.entries(pageStages).some(([p, s]) => !/^[1-9][0-9]{0,15}$(?![\s\S])/u.test(p)
    || !positive(Number(p)) || typeof s !== "string" || !STAGES.has(s))) return abstain("INVALID_INPUT");
  const read = readDocumentTextV3Artifact(input.textArtifact);
  if (read.status !== "VALID") return abstain(read.reasonCode === "INPUT_LIMIT" ? "INPUT_LIMIT" : "INVALID_TEXT_ARTIFACT");
  const artifact = input.textArtifact as DocumentTextV3Artifact;
  if (input.sourceFileId !== artifact.sourceFileId || input.sourceSha256 !== artifact.inputSha256) return abstain("SOURCE_MISMATCH");
  if (Object.keys(pageStages).some(p => Number(p) > artifact.pageCount)) return abstain("INVALID_INPUT");
  if (Object.values(pageStages).some(s => s !== "UNRESOLVED" && s !== input.stage)) return abstain("STAGE_CONFLICT");
  const selection = input.selection;
  if (!exact(selection, ["pageNumber", "fragments"]) || !positive(selection.pageNumber)
    || selection.pageNumber > artifact.pageCount || !Array.isArray(selection.fragments)
    || ![1, 2].includes(selection.fragments.length)) return abstain("INVALID_SELECTION");
  for (const f of selection.fragments) if (!exact(f, ["sourcePath", "rawText"]) || !path(f.sourcePath)
    || typeof f.rawText !== "string" || !f.rawText) return abstain("INVALID_SELECTION");
  const selected = selection.fragments as Array<{sourcePath: number[]; rawText: string}>;
  const selectedPaths = new Set(selected.map(f => pathKey(f.sourcePath)));
  if (selectedPaths.size !== selected.length) return abstain("INVALID_SELECTION");
  const page = artifact.pages[selection.pageNumber - 1];
  const all = new Map([...page.locatedLines, ...page.unlocatedLines].map(f => [pathKey(f.sourcePath), f]));
  const resolved = selected.map(f => all.get(pathKey(f.sourcePath)));
  if (resolved.some((f, i) => !f || f.rawText !== selected[i].rawText)) return abstain("SELECTION_MISMATCH");
  if (resolved.some(f => !Object.hasOwn(f!, "bboxMilliPoints"))) return abstain("SELECTED_TEXT_UNLOCATED");
  if (page.unlocatedLines.length) return abstain("UNLOCATED_PAGE_TEXT");
  if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") return abstain("SOURCE_TEXT_UNAVAILABLE");
  const fragments = resolved as DocumentTextV3LocatedLine[];
  if (fragments.some((f, i) => i > 0 && order(fragments[i - 1], f) > 0)) return abstain("INVALID_SELECTION");
  const region = union(fragments.map(f => f.bboxMilliPoints));
  if (!groupGeometry(fragments) || page.locatedLines.some(f => !selectedPaths.has(pathKey(f.sourcePath))
    && Array.from(f.rawText).some(c => !WHITESPACE.test(c)) && region[0] <= f.bboxMilliPoints[2]
    && f.bboxMilliPoints[0] <= region[2] && region[1] <= f.bboxMilliPoints[3]
    && f.bboxMilliPoints[1] <= region[3])) return abstain("AMBIGUOUS_LAYOUT");
  const literal = parseLiteral(fragments.map(f => f.rawText));
  if (!literal) return abstain("DECLARATION_UNVERIFIED");
  return {schemaVersion: SCHEMA, status: "RECONSTRUCTED", declaration: {
    schemaVersion: "matrix-zu130-lighting-technology-v3-declaration-v1",
    extractorVersion: LIGHTING_TECHNOLOGY_V3_EXTRACTOR_VERSION,
    bindingPolicyVersion: LIGHTING_TECHNOLOGY_V3_POLICY_VERSION,
    sourceFileId: input.sourceFileId, sourceSha256: input.sourceSha256, textArtifactHash: read.contentHash,
    extractorProfileHash: artifact.extractorProfileHash,
    stage: (pageStages[String(page.pageNumber)] ?? input.stage) as LightingTechnologyV3Declaration["stage"],
    pageNumber: page.pageNumber, pageWidthMilliPoints: page.widthMilliPoints, pageHeightMilliPoints: page.heightMilliPoints,
    nativeFrame: structuredClone(page.nativeFrame), regionBoxMilliPoints: region,
    technology: literal.technology, rawTechnology: literal.rawTechnology, positionLabel: literal.positionLabel,
    scopeStatus: literal.positionLabel === null ? "UNBOUND_GROUP_DECLARATION" : "NAMED_POSITION_LITERAL",
    primaryFragments: fragments.map((f, i) => ({pageNumber: page.pageNumber, ...structuredClone(f),
      usedTextRange: literal.views[i].range})) as LightingTechnologyV3Declaration["primaryFragments"],
    authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null,
  }};
}

const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$(?![\s\S])/u;
function nativeDecimal(v: unknown): {n: bigint; scale: number} | undefined {
  if (typeof v !== "string" || v.length > 64) return undefined;
  const m = DECIMAL.exec(v); if (!m) return undefined;
  const exponent = m[4] === undefined ? 0 : Number(m[4]);
  if (!Number.isInteger(exponent) || exponent < -324 || exponent > 308) return undefined;
  let n = BigInt(m[2] + (m[3] ?? "")), scale = (m[3]?.length ?? 0) - exponent;
  if (scale < 0) {n *= 10n ** BigInt(-scale); scale = 0;}
  if (n > 1000000000n * 10n ** BigInt(scale)) return undefined;
  return {n: m[1] ? -n : n, scale};
}
function nativeBox(v: unknown): boolean {
  if (!Array.isArray(v) || v.length !== 4) return false;
  const values = v.map(nativeDecimal);
  if (values.some(n => n === undefined)) return false;
  for (const axis of [0, 1]) {
    const a = values[axis]!, b = values[axis + 2]!;
    if (a.n * 10n ** BigInt(b.scale) >= b.n * 10n ** BigInt(a.scale)) return false;
  }
  return true;
}
function validDeclaration(d: unknown): d is LightingTechnologyV3Declaration {
  if (!exact(d, ["schemaVersion", "extractorVersion", "bindingPolicyVersion", "sourceFileId", "sourceSha256",
    "textArtifactHash", "extractorProfileHash", "stage", "pageNumber", "pageWidthMilliPoints", "pageHeightMilliPoints",
    "nativeFrame", "regionBoxMilliPoints", "technology", "rawTechnology", "positionLabel", "scopeStatus",
    "primaryFragments", "authorityStatus", "renderedVisibility", "calibratedProbability"])
    || d.schemaVersion !== "matrix-zu130-lighting-technology-v3-declaration-v1"
    || d.extractorVersion !== LIGHTING_TECHNOLOGY_V3_EXTRACTOR_VERSION || d.bindingPolicyVersion !== LIGHTING_TECHNOLOGY_V3_POLICY_VERSION
    || !key(d.sourceFileId) || !shaValue(d.sourceSha256) || !shaValue(d.textArtifactHash) || !shaValue(d.extractorProfileHash)
    || typeof d.stage !== "string" || !STAGES.has(d.stage) || !positive(d.pageNumber) || d.pageNumber > 512
    || !positive(d.pageWidthMilliPoints) || !positive(d.pageHeightMilliPoints)
    || !validBox(d.regionBoxMilliPoints, d.pageWidthMilliPoints, d.pageHeightMilliPoints)
    || !exact(d.nativeFrame, ["coordinateSystem", "visibleBoxPointStrings"])
    || d.nativeFrame.coordinateSystem !== "PDFMINER_LAYOUT_POINTS" || !nativeBox(d.nativeFrame.visibleBoxPointStrings)
    || !Array.isArray(d.primaryFragments) || ![1, 2].includes(d.primaryFragments.length)
    || d.authorityStatus !== "SOURCE_DECLARED_UNVERIFIED" || d.renderedVisibility !== "UNVERIFIED"
    || d.calibratedProbability !== null) return false;
  for (const f of d.primaryFragments) if (!exact(f, ["pageNumber", "sourcePath", "rawText", "nativeBoxPointStrings", "bboxMilliPoints", "usedTextRange"])
    || f.pageNumber !== d.pageNumber || !path(f.sourcePath) || typeof f.rawText !== "string" || !f.rawText
    || !nativeBox(f.nativeBoxPointStrings) || !validBox(f.bboxMilliPoints, d.pageWidthMilliPoints, d.pageHeightMilliPoints)
    || !exact(f.usedTextRange, ["start", "end"]) || !nonnegative(f.usedTextRange.start)
    || !positive(f.usedTextRange.end) || f.usedTextRange.start >= f.usedTextRange.end
    || f.usedTextRange.end > Array.from(f.rawText).length) return false;
  const fragments = d.primaryFragments as LightingTechnologyV3PrimaryFragment[];
  if (new Set(fragments.map(f => pathKey(f.sourcePath))).size !== fragments.length) return false;
  const literal = parseLiteral(fragments.map(f => f.rawText));
  if (!literal || d.technology !== literal.technology || d.rawTechnology !== literal.rawTechnology
    || d.positionLabel !== literal.positionLabel || d.scopeStatus !== (literal.positionLabel === null
      ? "UNBOUND_GROUP_DECLARATION" : "NAMED_POSITION_LITERAL")) return false;
  return fragments.every((f, i) => f.usedTextRange.start === literal.views[i].range.start && f.usedTextRange.end === literal.views[i].range.end);
}
/** Standalone DTO integrity only. Source authority requires the complete original input. */
export function lightingTechnologyV3DeclarationContentHash(declaration: unknown): string {
  if (portable(declaration).status !== "VALID" || !validDeclaration(declaration)) throw Error("invalid bounded lighting v3 declaration");
  const encoded = portable({hashDomain: "matrix-zu130-lighting-technology-v3-source-id-v1", declaration});
  if (encoded.status !== "VALID") throw Error("invalid bounded lighting v3 hash envelope");
  return createHash("sha256").update(encoded.canonical, "utf8").digest("hex");
}
