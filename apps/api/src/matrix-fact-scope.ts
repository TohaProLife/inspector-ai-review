import { REBAR_ATTRIBUTE, REBAR_UNIT, validRebarSourceBinding } from "./matrix-rebar-prose.js";
import { CONCRETE_ATTRIBUTE, isConcreteProseFact, validConcreteSourceBinding } from "./matrix-concrete-prose.js";
import { z } from "zod";
import { matrixFactScopeTargetSchema, type MatrixFactScopeTarget }
  from "@inspector-ai/contracts";
import { sha256 } from "./canonical-json.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const bbox = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict()
  .refine(box => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001);
const fragment = z.object({ blockId: z.string().max(40).regex(/^\d+:\d+$/u),
  rawText: z.string().min(1).max(100_000), bbox }).strict();
const contextFragment = fragment.extend({ pageNumber: z.number().int().positive(),
  role: z.enum(["ATTRIBUTE_HEADER", "TABLE_SCOPE", "UNIT_DECLARATION", "MATERIAL_SCOPE"]) }).strict();
const factSchema = z.object({ id: hash, sourceFileId: z.string().min(1).max(200), sourceSha256: hash,
  stage: z.enum(["PD", "RD", "ID", "UNRESOLVED"]), pageNumber: z.number().int().positive(),
  blockId: z.string().max(40).regex(/^\d+:\d+$/u), attribute: z.string().min(1).max(100),
  value: z.string().min(1).max(1000), unit: z.string().min(1).max(100),
  rawValue: z.string().min(1).max(1000), rawUnit: z.string().min(1).max(100).nullable(),
  rawText: z.string().min(1).max(100_000), method: z.literal("TEXT_LAYER"),
  extractorVersion: z.string().min(1).max(200), bbox,
  evidenceFragments: z.array(fragment).min(1).max(100),
  contextFragments: z.array(contextFragment).min(1).max(8).optional(),
}).passthrough().superRefine((fact,ctx)=>{
  if(fact.contextFragments?.some(part=>part.role==="MATERIAL_SCOPE") && ![REBAR_ATTRIBUTE,CONCRETE_ATTRIBUTE].includes(fact.attribute))
    ctx.addIssue({code:"custom",message:"Material scope outside supported material declaration",path:["contextFragments"]});
  if(fact.rawUnit===null && !(fact.attribute===REBAR_ATTRIBUTE && fact.unit===REBAR_UNIT))
    ctx.addIssue({code:"custom",message:"Null unit outside reinforcement declaration",path:["rawUnit"]});
});

export interface MatrixFactSelectorPayload {
  schemaVersion: "matrix-fact-selector-v1";
  sourceFileId: string;
  sourceSha256: string;
  stage: "PD" | "RD" | "ID" | "UNRESOLVED";
  pageNumber: number;
  blockId: string;
  attribute: string;
  value: string;
  unit: string;
  rawValue: string;
  rawUnit: string | null;
  rawText: string;
  method: "TEXT_LAYER";
  extractorVersion: string;
  bbox: z.infer<typeof bbox>;
  evidenceFragments: Array<z.infer<typeof fragment>>;
  contextFragments?: Array<z.infer<typeof contextFragment>>;
  textArtifactHash: string;
}

export type MatrixFactTargetEvidence = Pick<MatrixFactScopeTarget,
  "observationId" | "evidenceHash" | "textArtifactHash"> & { fragmentsHash?: string };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const unicodeScalarString = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

/** Reject non-JSON values rather than allowing canonical serialization to erase them. */
function jsonValue(value: unknown, ancestors = new Set<object>(), depth = 0): boolean {
  if (typeof value === "string") return unicodeScalarString(value);
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 100 || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Array.from(value).every(child => jsonValue(child, ancestors, depth + 1))
    : Object.entries(value).every(([key, child]) => unicodeScalarString(key) && jsonValue(child, ancestors, depth + 1));
  ancestors.delete(value);
  return valid;
}

type PortableTree = null | boolean | string | ["$number", string]
  | ["$array", PortableTree[]] | ["$object", Array<[string, PortableTree]>];

function portableTree(value: unknown): PortableTree {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
    return ["$number", bytes.toString("hex")];
  }
  if (Array.isArray(value)) return ["$array", value.map(portableTree)];
  return ["$object", Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
    .map(([key, child]) => [key, portableTree(child)])];
}

/**
 * New evidence hashes only: compact UTF-8 JSON of a typed tree. Null/bool/string remain literal;
 * numbers become ["$number", big-endian IEEE754 float64 lowercase hex]; arrays become
 * ["$array", children]; objects become ["$object", [[key, child], ...]], sorted by UTF-8 key bytes.
 * Negative zero is preserved. Tags cannot collide with original arrays or objects.
 * Legacy canonicalJson and its persisted hashes remain unchanged.
 */
export function portableEvidenceJson(value: unknown): string {
  if (!jsonValue(value)) throw new TypeError("Portable evidence requires finite JSON values and Unicode scalar strings");
  return JSON.stringify(portableTree(value));
}

export function portableEvidenceHash(value: unknown): string {
  return sha256(portableEvidenceJson(value));
}

function sourceBox(fragmentValue: z.infer<typeof fragment>, pageNumber: number,
  pages: Record<string, unknown>[]): number[] | null {
  const page = pages.find(item => item.pageNumber === pageNumber);
  if (!page || !Array.isArray(page.blocks)) return null;
  const width = page.widthMilliPoints, height = page.heightMilliPoints;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return null;
  const [blockIndex, lineIndex] = fragmentValue.blockId.split(":").map(Number);
  const block = page.blocks[blockIndex];
  if (!record(block) || typeof block.text !== "string"
    || block.text.split(/\r?\n/u)[lineIndex]?.trim() !== fragmentValue.rawText.trim()) return null;
  const box = Array.isArray(block.lineBboxesMilliPoints) ? block.lineBboxesMilliPoints[lineIndex] : block.bboxMilliPoints;
  if (!Array.isArray(box) || box.length !== 4 || box.some(n => !Number.isSafeInteger(n))
    || box[0] < 0 || box[1] < 0 || box[2] > width || box[3] > height
    || box[2] <= box[0] || box[3] <= box[1]) return null;
  const expected = { x: box[0] / width, y: 1 - box[3] / height,
    width: (box[2] - box[0]) / width, height: (box[3] - box[1]) / height };
  if (!(Object.keys(expected) as Array<keyof typeof expected>).every(key =>
    Math.abs(fragmentValue.bbox[key] - expected[key]) < 1e-9)) return null;
  return box;
}

/**
 * Portable identity is portableEvidenceHash(payload). The payload contains exactly
 * the fields below; contextFragments is absent when absent in the immutable observation.
 * textArtifactHash is portableEvidenceHash(entire immutable text artifact), including frames.
 * Arrays preserve order. Strings and raw text are neither trimmed nor normalized for hashing.
 * Object/manifest, review/entity, flags, parameter codes and origin run refs are excluded.
 * The caller must load an independently validated immutable execution before using this helper.
 */
function validTextArtifact(textArtifact: unknown): textArtifact is Record<string, unknown> & {
  pages: Record<string, unknown>[];
} {
  if (!record(textArtifact) || !jsonValue(textArtifact)
    || !["document-text-v1", "document-text-v2"].includes(String(textArtifact.schemaVersion))
    || textArtifact.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || !Array.isArray(textArtifact.pages) || textArtifact.pages.some(page => !record(page))) return false;
  const pageNumbers = (textArtifact.pages as Record<string, unknown>[]).map(page => page.pageNumber);
  if (pageNumbers.some(number => !Number.isSafeInteger(number) || Number(number) < 1)
    || new Set(pageNumbers).size !== pageNumbers.length) return false;
  return true;
}

function selectorFromArtifact(fact: unknown, textArtifact: Record<string, unknown> & { pages: Record<string, unknown>[] },
  textArtifactHash: string): MatrixFactSelectorPayload | null {
  const decoded = factSchema.safeParse(fact);
  if (!decoded.success || textArtifact.sourceFileId !== decoded.data.sourceFileId
    || textArtifact.inputSha256 !== decoded.data.sourceSha256) return null;
  const value = decoded.data, pages = textArtifact.pages;
  const boxes = value.evidenceFragments.map(part => sourceBox(part, value.pageNumber, pages));
  if (boxes.some(box => !box) || value.blockId !== value.evidenceFragments[0].blockId
    || value.rawText !== value.evidenceFragments.map(part => part.rawText).join(" ")
    || (value.contextFragments ?? []).some(part => !sourceBox(part, part.pageNumber, pages))) return null;
  const page = pages.find(item => item.pageNumber === value.pageNumber)!;
  if (value.attribute === REBAR_ATTRIBUTE && !validRebarSourceBinding(value, value.evidenceFragments, page)) return null;
  if (isConcreteProseFact(value) && !validConcreteSourceBinding(value,value.evidenceFragments,textArtifact))return null;
  const width = Number(page.widthMilliPoints), height = Number(page.heightMilliPoints);
  const knownBoxes = boxes as number[][];
  const union = { x: Math.min(...knownBoxes.map(box => box[0])) / width,
    y: 1 - Math.max(...knownBoxes.map(box => box[3])) / height,
    width: (Math.max(...knownBoxes.map(box => box[2])) - Math.min(...knownBoxes.map(box => box[0]))) / width,
    height: (Math.max(...knownBoxes.map(box => box[3])) - Math.min(...knownBoxes.map(box => box[1]))) / height };
  if (!(Object.keys(union) as Array<keyof typeof union>).every(key => Math.abs(value.bbox[key] - union[key]) < 1e-9)) return null;
  const selector: MatrixFactSelectorPayload = {
    schemaVersion: "matrix-fact-selector-v1", sourceFileId: value.sourceFileId, sourceSha256: value.sourceSha256,
    stage: value.stage, pageNumber: value.pageNumber, blockId: value.blockId, attribute: value.attribute,
    value: value.value, unit: value.unit, rawValue: value.rawValue, rawUnit: value.rawUnit, rawText: value.rawText,
    method: value.method, extractorVersion: value.extractorVersion, bbox: value.bbox,
    evidenceFragments: value.evidenceFragments,
    ...(value.contextFragments ? { contextFragments: value.contextFragments } : {}),
    textArtifactHash,
  };
  return jsonValue(selector) ? selector : null;
}

function targetFromSelector(fact: unknown, selector: MatrixFactSelectorPayload | null): MatrixFactTargetEvidence | null {
  if (!selector || !record(fact) || typeof fact.id !== "string") return null;
  return { observationId: fact.id, evidenceHash: portableEvidenceHash(selector), textArtifactHash: selector.textArtifactHash,
    ...(selector.contextFragments ? { fragmentsHash: portableEvidenceHash(selector.contextFragments) } : {}) };
}

export function deriveMatrixFactSelector(fact: unknown, textArtifact: unknown): MatrixFactSelectorPayload | null {
  return validTextArtifact(textArtifact)
    ? selectorFromArtifact(fact, textArtifact, portableEvidenceHash(textArtifact)) : null;
}

export function deriveMatrixFactTarget(fact: unknown, textArtifact: unknown): MatrixFactTargetEvidence | null {
  return targetFromSelector(fact, deriveMatrixFactSelector(fact, textArtifact));
}

/**
 * Batch use: one artifact hash and a private snapshot, with no caller-supplied hash or mutable cache.
 * Returned methods bind to this exact snapshot even if the original argument changes afterwards.
 */
export function prepareMatrixFactArtifact(textArtifact: unknown): {
  readonly textArtifactHash: string;
  deriveSelector(fact: unknown): MatrixFactSelectorPayload | null;
  deriveTarget(fact: unknown): MatrixFactTargetEvidence | null;
} | null {
  if (!validTextArtifact(textArtifact)) return null;
  const snapshot = structuredClone(textArtifact), textArtifactHash = portableEvidenceHash(snapshot);
  return {
    textArtifactHash,
    deriveSelector: fact => selectorFromArtifact(fact, snapshot, textArtifactHash),
    deriveTarget: fact => targetFromSelector(fact, selectorFromArtifact(fact, snapshot, textArtifactHash)),
  };
}

/** Match immutable origin references and portable evidence; this confers no approval or qualification. */
export function resolveMatrixFactScopeTarget(submitted: unknown, origin: {
  checkId: string; executionContentHash: string; fact: unknown; textArtifact: unknown;
}): MatrixFactTargetEvidence | null {
  const decoded = matrixFactScopeTargetSchema.safeParse(submitted);
  if (!decoded.success || decoded.data.checkId !== origin.checkId
    || decoded.data.executionContentHash !== origin.executionContentHash) return null;
  const derived = deriveMatrixFactTarget(origin.fact, origin.textArtifact);
  return derived && decoded.data.observationId === derived.observationId
    && decoded.data.evidenceHash === derived.evidenceHash
    && decoded.data.textArtifactHash === derived.textArtifactHash ? derived : null;
}
