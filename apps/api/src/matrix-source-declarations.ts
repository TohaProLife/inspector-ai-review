import { createHash } from "node:crypto";
import type { MatrixSteelSourceDeclaration, MatrixSourceDeclarations } from "@inspector-ai/contracts";
import { extractSteelCandidates } from "./matrix-steel-prose.js";

const VERSION = "matrix-source-declarations-v1";
const SHA = /^[a-f0-9]{64}(?![\s\S])/;
type RecordValue = Record<string, unknown>;
type Box = [number, number, number, number];
export interface SourceDeclarationInput {
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
  return !Array.from(value).some(char => { const n = char.codePointAt(0)!; return n >= 0xd800 && n <= 0xdfff; });
}
function string(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, "") === value && Array.from(value).length <= 200 && scalarString(value);
}
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function positive(value: unknown): value is number { return integer(value) && value > 0; }
function keys(value: RecordValue, expected: string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length && actual.every(key => typeof key === "string"
    && expected.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}
function denseArray(value: unknown[]): boolean {
  return Reflect.ownKeys(value).length === value.length + 1 && Array.from({length:value.length},(_,i) => {
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    return !!d && d.enumerable && Object.hasOwn(d,"value");
  }).every(Boolean);
}
function dataField(value: RecordValue, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return !!descriptor && descriptor.enumerable === true && Object.hasOwn(descriptor, "value");
}
/** Separate portable hash domain. Manual key serialization preserves lexical numeric keys. */
export function canonicalSourceDeclarationJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 64) throw new Error("source declaration JSON exceeds depth limit");
    if (item === null) return "null";
    if (typeof item === "boolean") return item ? "true" : "false";
    if (typeof item === "number" && Number.isSafeInteger(item)) return JSON.stringify(item);
    if (typeof item === "string" && scalarString(item)) return JSON.stringify(item);
    if ((!Array.isArray(item) && !record(item)) || ancestors.has(item)) {
      throw new Error("source declaration JSON is not portable");
    }
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const ownKeys = Reflect.ownKeys(item);
        if (ownKeys.length !== item.length + 1 || !ownKeys.includes("length")) {
          throw new Error("source declaration JSON is not portable");
        }
        const entries: string[] = [];
        for (let i = 0; i < item.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
            throw new Error("source declaration JSON is not portable");
          }
          entries.push(encode(descriptor.value, depth + 1));
        }
        return `[${entries.join(",")}]`;
      }
      const names = Reflect.ownKeys(item);
      if (names.some(name => typeof name !== "string" || !/^[\x00-\x7f]*$/.test(name))) {
        throw new Error("source declaration JSON keys must be ASCII");
      }
      return `{${(names as string[]).sort().map(name => {
        const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new Error("source declaration JSON is not portable");
        }
        return `${JSON.stringify(name)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally { ancestors.delete(item); }
  }
  return encode(value, 0);
}
function hash(value: unknown): string {
  return createHash("sha256").update(canonicalSourceDeclarationJson(value), "utf8").digest("hex");
}
export function sourceDeclarationId(fact: Record<string, unknown> | MatrixSteelSourceDeclaration): string {
  if (!record(fact)) throw new Error("source declaration JSON is not portable");
  const fields: RecordValue = Object.create(null);
  for (const key of Reflect.ownKeys(fact)) {
    if (key === "id") continue;
    const descriptor = Object.getOwnPropertyDescriptor(fact, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new Error("source declaration JSON is not portable");
    }
    fields[key] = descriptor.value;
  }
  return hash({ hashDomain: "matrix-source-declaration-id-v1", declaration: fields });
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
function codePointCompare(left: string, right: string): number {
  const a = Array.from(left, c => c.codePointAt(0)!), b = Array.from(right, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}


/** Strict full-envelope reconstruction. Missing artifacts are not fabricated; malformed inputs fail closed. */
export function extractSourceDeclarations(input: SourceDeclarationInput): MatrixSourceDeclarations {
  if (!record(input) || !keys(input, ["objectId", "inputManifestHash", "sources", "textArtifacts"])
    || !string(input.objectId) || typeof input.inputManifestHash !== "string" || !SHA.test(input.inputManifestHash)
    || !Array.isArray(input.sources) || !Array.isArray(input.textArtifacts) || !denseArray(input.sources) || !denseArray(input.textArtifacts)) throw new Error("invalid source declaration input");
  const sources = new Map<string, { sha256: string; stages: unknown[]; pageStages: RecordValue }>();
  for (const source of input.sources) {
    if (!record(source) || !["sourceFileId", "sha256", "stages"].every(key => dataField(source,key))
      || !string(source.sourceFileId) || sources.has(source.sourceFileId)
      || typeof source.sha256 !== "string" || !SHA.test(source.sha256)
      || !Array.isArray(source.stages)
      || (Object.hasOwn(source, "objectId") && (!dataField(source,"objectId") || source.objectId !== input.objectId))) {
      throw new Error("invalid source declaration source");
    }
    // Validate the consumed stage list itself, rejecting sparse/accessor/extra array shapes.
    canonicalSourceDeclarationJson(source.stages);
    if (source.stages.some(stage => typeof stage !== "string" || !["PD","RD","ID","UNRESOLVED"].includes(stage))
      || new Set(source.stages).size !== source.stages.length) throw new Error("invalid source declaration source");
    if (Object.hasOwn(source,"pageStages") && !dataField(source,"pageStages")) throw new Error("invalid source declaration page stages");
    const pageStages = Object.hasOwn(source, "pageStages") ? source.pageStages : {};
    if (!record(pageStages)) throw new Error("invalid source declaration page stages");
    canonicalSourceDeclarationJson(pageStages);
    if (Object.entries(pageStages).some(([page, stage]) => !/^[1-9][0-9]*$/.test(page)
      || !Number.isSafeInteger(Number(page)) || typeof stage !== "string" || !["PD","RD","ID","UNRESOLVED"].includes(stage))) {
      throw new Error("invalid source declaration page stages");
    }
    sources.set(source.sourceFileId, { sha256: source.sha256, stages: source.stages, pageStages });
  }
  const artifacts = new Map<string, RecordValue>();
  for (const artifact of input.textArtifacts) {
    canonicalSourceDeclarationJson(artifact);
    if (!record(artifact) || !string(artifact.sourceFileId) || artifacts.has(artifact.sourceFileId)
      || !sources.has(artifact.sourceFileId) || artifact.inputSha256 !== sources.get(artifact.sourceFileId)!.sha256
      || !validArtifact(artifact)) throw new Error("invalid source declaration text artifact");
    if (Object.keys(sources.get(artifact.sourceFileId)!.pageStages).some(page => Number(page) > (artifact.pageCount as number))) {
      throw new Error("invalid source declaration page stages");
    }
    artifacts.set(artifact.sourceFileId, artifact);
  }
  const result: MatrixSourceDeclarations = { schemaVersion: "matrix-source-declarations-v1", objectId: input.objectId,
    inputManifestHash: input.inputManifestHash, extractorVersion: VERSION, purpose: "EVIDENCE_ONLY", declarations: [] };
  for (const [sourceFileId, source] of sources) {
    if (source.stages.length !== 1 || !["PD", "RD"].includes(source.stages[0] as string)
      || Object.values(source.pageStages).some(stage => stage !== source.stages[0])) continue;
    const artifact = artifacts.get(sourceFileId);
    if (!artifact) continue;
    const stage = source.stages[0] as "PD" | "RD";
    const textArtifactHash = hash({ hashDomain: "matrix-source-declaration-text-artifact-v1", textArtifact: artifact });
    for (const page of artifact.pages as RecordValue[]) {
      for (const candidate of extractSteelCandidates(page, stage)) {
        const declaration: Omit<MatrixSteelSourceDeclaration, "id"> = {
          schemaVersion: "matrix-source-declaration-v1", kind: "SOURCE_AUTHORED_STEEL_DECLARATION",
          extractorVersion: "matrix-steel-prose-v1", sourceFileId, sourceSha256: source.sha256, textArtifactHash,
          stage, pageNumber: page.pageNumber as number, widthMilliPoints: page.widthMilliPoints as number,
          heightMilliPoints: page.heightMilliPoints as number, entityKey: null, applicabilityStatus: "UNREVIEWED", ...candidate,
        };
        result.declarations.push({ id: sourceDeclarationId(declaration), ...declaration });
      }
    }
  }
  result.declarations.sort((a, b) => codePointCompare(a.sourceFileId, b.sourceFileId)
    || a.pageNumber - b.pageNumber || codePointCompare(a.id, b.id));
  return result;
}
/** Worker IDs do not authenticate source evidence; independently reconstruct the complete artifact. */
export function validateSourceDeclarations(raw: unknown, input: SourceDeclarationInput): MatrixSourceDeclarations | null {
  try {
    const expected = extractSourceDeclarations(input);
    return canonicalSourceDeclarationJson(raw) === canonicalSourceDeclarationJson(expected) ? expected : null;
  } catch { return null; }
}
