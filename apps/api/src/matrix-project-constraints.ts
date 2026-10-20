import { createHash } from "node:crypto";
import type { MatrixProjectConstraint, MatrixProjectConstraints } from "@inspector-ai/contracts";

const VERSION = "matrix-project-bound-prose-v1";
const SHA = /^[a-f0-9]{64}(?![\s\S])/;
// Python str.split/strip whitespace; JavaScript \s differs for NEL, BOM and C0 separators.
const SPACE = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
const FIRST = "ширина дверных проемов в стенах и перегородках, через которые";
const SECOND = "может передвигаться инвалид на кресле-коляске, а также выходов на";
const VALUE = /^лестничные клетки и в лифтовые холлы принята не менее ((?:0|[1-9][0-9]*)(?:[.,][0-9]+)?) м в свету при$/;
const END = /^открытом[ \t\u00a0\u202f]+дверном[ \t\u00a0\u202f]+полотне\./;
const TAIL = "Дверные проемы либо не имеют порогов, либо";
type RecordValue = Record<string, unknown>;
type Box = [number, number, number, number];
interface Block { text: string; bboxMilliPoints: Box; lineBboxesMilliPoints?: Box[] }
interface Page {
  pageNumber: number; widthMilliPoints: number; heightMilliPoints: number; blocks: Block[];
  quality: { disposition: "TEXT_LAYER_CANDIDATE" | "OCR_REQUIRED" };
}
interface TextArtifact { pages: Page[] }
export interface ProjectConstraintInput {
  objectId: string;
  inputManifestHash: string;
  sources: unknown[];
  textArtifacts: unknown[];
}

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function scalarString(value: string): boolean {
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}
function clean(text: string): string { return text.split(SPACE).filter(Boolean).join(" "); }
function string(value: unknown): value is string {
  return typeof value === "string" && clean(value).length > 0 && Array.from(value).length <= 200;
}
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function positive(value: unknown): value is number { return integer(value) && value > 0; }
function keys(value: RecordValue, expected: string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length && actual.every(key => typeof key === "string"
    && expected.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}

/** Separate portable hash domain. Manual key serialization preserves lexical numeric keys. */
export function canonicalProjectConstraintJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 64) throw new Error("project constraint JSON exceeds depth limit");
    if (item === null) return "null";
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "number" && Number.isSafeInteger(item)) return JSON.stringify(item);
    if (typeof item === "string" && scalarString(item)) return JSON.stringify(item);
    if ((!Array.isArray(item) && !record(item)) || ancestors.has(item)) {
      throw new Error("project constraint JSON is not portable");
    }
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const ownKeys = Reflect.ownKeys(item);
        if (ownKeys.length !== item.length + 1 || !ownKeys.includes("length")) {
          throw new Error("project constraint JSON is not portable");
        }
        const entries: string[] = [];
        for (let i = 0; i < item.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
            throw new Error("project constraint JSON is not portable");
          }
          entries.push(encode(descriptor.value, depth + 1));
        }
        return `[${entries.join(",")}]`;
      }
      const names = Reflect.ownKeys(item);
      if (names.some(name => typeof name !== "string" || !/^[\x00-\x7f]*$/.test(name))) {
        throw new Error("project constraint JSON keys must be ASCII");
      }
      return `{${(names as string[]).sort().map(name => {
        const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new Error("project constraint JSON is not portable");
        }
        return `${JSON.stringify(name)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally { ancestors.delete(item); }
  }
  return encode(value, 0);
}
function hash(value: unknown): string {
  return createHash("sha256").update(canonicalProjectConstraintJson(value), "utf8").digest("hex");
}
export function projectConstraintId(fact: Record<string, unknown> | MatrixProjectConstraint): string {
  if (!record(fact)) throw new Error("project constraint JSON is not portable");
  const fields: RecordValue = Object.create(null);
  for (const key of Reflect.ownKeys(fact)) {
    if (key === "id") continue;
    const descriptor = Object.getOwnPropertyDescriptor(fact, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new Error("project constraint JSON is not portable");
    }
    fields[key] = descriptor.value;
  }
  return hash({ hashDomain: "matrix-project-constraint-id-v1", fact: fields });
}
function box(value: unknown, width: number, height: number): value is Box {
  return Array.isArray(value) && value.length === 4 && value.every(n => integer(n) && n >= 0)
    && value[0] < value[2] && value[2] <= width && value[1] < value[3] && value[3] <= height;
}
function validArtifact(value: RecordValue): boolean {
  if (!keys(value, ["schemaVersion", "sourceFileId", "inputSha256", "coordinateSystem", "pageCount",
    "textPageCount", "qualityPolicyVersion", "qualitySummary", "pages"])
    || value.schemaVersion !== "document-text-v2" || value.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || !["text-layer-quality-v1", "text-layer-quality-v2"].includes(value.qualityPolicyVersion as string)
    || !positive(value.pageCount) || !Array.isArray(value.pages) || value.pages.length !== value.pageCount) return false;
  let textPages = 0, candidatePages = 0;
  for (const [index, page] of value.pages.entries()) {
    if (!record(page) || !keys(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "blocks", "quality"])
      || !integer(page.pageNumber) || page.pageNumber !== index + 1
      || !positive(page.widthMilliPoints) || !positive(page.heightMilliPoints)
      || !Array.isArray(page.blocks) || !record(page.quality)) return false;
    const quality = page.quality;
    if (!keys(quality, ["disposition", "metrics", "reasonCodes"])
      || !["TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"].includes(quality.disposition as string)
      || !record(quality.metrics) || !keys(quality.metrics, ["alphanumericCharacterCount", "blockCount",
        "disallowedControlCharacterCount", "nonWhitespaceCharacterCount", "replacementCharacterCount"])
      || !Object.values(quality.metrics).every(n => integer(n) && n >= 0)
      || !Array.isArray(quality.reasonCodes) || !quality.reasonCodes.every(code => typeof code === "string")) return false;
    if (page.blocks.length) textPages++;
    if (quality.disposition === "TEXT_LAYER_CANDIDATE") candidatePages++;
    for (const block of page.blocks) {
      if (!record(block) || !(keys(block, ["text", "bboxMilliPoints"])
        || keys(block, ["text", "bboxMilliPoints", "lineBboxesMilliPoints"]))
        || typeof block.text !== "string" || !box(block.bboxMilliPoints, page.widthMilliPoints, page.heightMilliPoints)) return false;
      if (Object.hasOwn(block, "lineBboxesMilliPoints") && (!Array.isArray(block.lineBboxesMilliPoints)
        || block.lineBboxesMilliPoints.length !== block.text.split("\n").length
        || !block.lineBboxesMilliPoints.every(b => box(b, page.widthMilliPoints as number, page.heightMilliPoints as number)))) return false;
    }
  }
  return integer(value.textPageCount) && value.textPageCount === textPages && record(value.qualitySummary)
    && keys(value.qualitySummary, ["textLayerCandidatePageCount", "ocrRequiredPageCount"])
    && integer(value.qualitySummary.textLayerCandidatePageCount) && integer(value.qualitySummary.ocrRequiredPageCount)
    && value.qualitySummary.textLayerCandidatePageCount === candidatePages
    && value.qualitySummary.ocrRequiredPageCount === value.pages.length - candidatePages;
}
function pageConstraint(page: Page): Pick<MatrixProjectConstraint, "pageNumber" | "widthMilliPoints" | "heightMilliPoints" | "limitValue" | "fragments"> | null {
  if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") return null;
  const anchors = page.blocks.flatMap((block, i) => clean(block.text).toLowerCase().includes("ширина дверных проемов") ? [i] : []);
  if (anchors.length !== 1 || anchors[0] + 4 > page.blocks.length) return null;
  const start = anchors[0], chosen = page.blocks.slice(start, start + 4);
  if (chosen.some(block => /[\n\r\u2028\u2029]/u.test(block.text)
    || (block.lineBboxesMilliPoints !== undefined && (block.lineBboxesMilliPoints.length !== 1
      || block.lineBboxesMilliPoints[0].some((n, i) => n !== block.bboxMilliPoints[i]))))) return null;
  const texts = chosen.map(block => clean(block.text)), match = VALUE.exec(texts[2]), ending = END.exec(chosen[3].text);
  if (texts[0].toLowerCase() !== FIRST || texts[1] !== SECOND || !match || !ending
    || !["", TAIL].includes(clean(chosen[3].text.slice(ending[0].length)))) return null;
  const boxes = chosen.map(block => block.bboxMilliPoints), heights = boxes.map(b => b[3] - b[1]);
  const gaps = boxes.slice(0, 3).map((b, i) => b[1] - boxes[i + 1][3]);
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);
  if (heights.some(h => h < 10000 || h > 18000) || span(heights) > 1000 || gaps.some(g => g < 0 || g > 18000)
    || boxes[0][0] - boxes[1][0] < 0 || boxes[0][0] - boxes[1][0] > 40000
    || span(boxes.slice(1).map(b => b[0])) > 1000 || span(boxes.map(b => b[2])) > 2000) return null;
  const bottom = boxes[3][1], top = boxes[0][3];
  if (page.blocks.some((block, i) => (i < start || i >= start + 4) && clean(block.text)
    && block.bboxMilliPoints[1] < top && block.bboxMilliPoints[3] > bottom)) return null;
  const raw = match[1].replace(",", ".");
  if (raw.length > 60) return null;
  const limitValue = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
  if (limitValue === "0") return null;
  return { pageNumber: page.pageNumber, widthMilliPoints: page.widthMilliPoints, heightMilliPoints: page.heightMilliPoints,
    limitValue, fragments: chosen.map((block, i) => ({ blockIndex: start + i, lineIndex: 0,
      rawText: block.text, bboxMilliPoints: [...block.bboxMilliPoints], usedTextRange: { start: 0,
        end: Array.from(i === 3 ? ending[0] : block.text).length } })) };
}
function codePointCompare(left: string, right: string): number {
  const a = Array.from(left, c => c.codePointAt(0)!), b = Array.from(right, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

/** Reconstructs only source-authored prose evidence, without reviews or scalar execution. */
export function extractProjectConstraints(input: ProjectConstraintInput): MatrixProjectConstraints {
  if (!record(input) || !string(input.objectId) || typeof input.inputManifestHash !== "string" || !SHA.test(input.inputManifestHash)
    || !Array.isArray(input.sources) || !Array.isArray(input.textArtifacts)) throw new Error("invalid project constraint input");
  const result: MatrixProjectConstraints = { schemaVersion: "matrix-project-constraints-v1", objectId: input.objectId,
    inputManifestHash: input.inputManifestHash, extractorVersion: VERSION, purpose: "EVIDENCE_ONLY", constraints: [] };
  function counts(items: unknown[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of items) if (record(item) && string(item.sourceFileId)) counts.set(item.sourceFileId, (counts.get(item.sourceFileId) ?? 0) + 1);
    return counts;
  }
  const sourceCounts = counts(input.sources), artifactCounts = counts(input.textArtifacts);
  const artifacts = new Map(input.textArtifacts.filter(record).filter(a => string(a.sourceFileId)).map(a => [a.sourceFileId, a]));
  for (const source of input.sources) {
    if (!record(source)) continue;
    const sid = source.sourceFileId, sha = source.sha256;
    if (!string(sid) || sourceCounts.get(sid) !== 1 || artifactCounts.get(sid) !== 1 || typeof sha !== "string" || !SHA.test(sha)
      || !Array.isArray(source.stages) || source.stages.length !== 1 || source.stages[0] !== "PD"
      || (Object.hasOwn(source, "objectId") ? source.objectId : input.objectId) !== input.objectId) continue;
    const artifact = artifacts.get(sid)!;
    if (artifact.sourceFileId !== sid || artifact.inputSha256 !== sha || !validArtifact(artifact)) continue;
    let textArtifactHash: string;
    try { textArtifactHash = hash({ hashDomain: "matrix-project-constraint-text-artifact-v1", textArtifact: artifact }); }
    catch { continue; }
    for (const page of (artifact as unknown as TextArtifact).pages) {
      const extracted = pageConstraint(page);
      if (!extracted) continue;
      const fact: Omit<MatrixProjectConstraint, "id"> = { schemaVersion: "matrix-project-constraint-v1", kind: "PROJECT_AUTHORED_CONSTRAINT",
        relation: "GE", attribute: "DOOR_CLEAR_OPENING_WIDTH", canonicalUnit: "m", sourceFileId: sid, sourceSha256: sha,
        textArtifactHash, stage: "PD", extractorVersion: VERSION, entityKey: null, applicabilityStatus: "UNREVIEWED",
        componentClass: "ACCESSIBLE_ROUTE_DOOR_OPENING", measurementBasis: "CLEAR_OPENING_WITH_LEAF_OPEN", ...extracted };
      result.constraints.push({ id: projectConstraintId(fact), ...fact });
    }
  }
  result.constraints.sort((a, b) => codePointCompare(a.sourceFileId, b.sourceFileId) || a.pageNumber - b.pageNumber || codePointCompare(a.id, b.id));
  return result;
}

/** A recomputed worker ID never substitutes for independent reconstruction from committed inputs. */
export function validateProjectConstraints(raw: unknown, input: ProjectConstraintInput): MatrixProjectConstraints | null {
  try {
    const expected = extractProjectConstraints(input);
    return canonicalProjectConstraintJson(raw) === canonicalProjectConstraintJson(expected) ? expected : null;
  } catch { return null; }
}
