import { isProxy } from "node:util/types";

/** New wall grammar only. It does not replace or extend the historical stair parser. */
export const CONCRETE_WALL_EXTRACTOR_VERSION = "matrix-concrete-wall-prose-v1";
export interface ConcreteWallFragment {
  pageNumber: number; blockIndex: number; lineIndex: number; rawText: string; bboxMilliPoints: number[];
}
export interface ConcreteWallCandidate {
  value: string; rawValue: string; rawUnit: "B_CLASS"; canonicalUnit: "B_CLASS";
  primaryFragments: ConcreteWallFragment[];
  contextFragments: Array<ConcreteWallFragment & { role: "MATERIAL_SCOPE" }>;
}

/** @internal Shared fixed native boundary for the two wall modules; no caller-supplied limits. */
export function concreteWallNativeV1(input: unknown): "INVALID_INPUT" | "INPUT_LIMIT" | null {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  const add = (count: number) => { bytes += count; if (bytes > 8_000_000) throw "INPUT_LIMIT"; };
  function visit(value: unknown, depth: number): void {
    if (++nodes > 650_000 || depth > 64) throw "INPUT_LIMIT";
    if (value === null) { add(4); return; }
    if (typeof value === "boolean") { add(value ? 4 : 5); return; }
    if (typeof value === "number") {
      // Normalized legacy bbox coordinates are finite fractions, not integer-only JSON.
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw "INVALID_INPUT";
      add(Buffer.byteLength(JSON.stringify(value), "utf8")); return;
    }
    if (typeof value === "string") {
      if (value.length > 8_000_000) throw "INPUT_LIMIT";
      for (const char of value) {
        const point = char.codePointAt(0)!;
        if (point >= 0xd800 && point <= 0xdfff) throw "INVALID_INPUT";
      }
      add(Buffer.byteLength(JSON.stringify(value), "utf8")); return;
    }
    // Detect proxies before even querying their prototype/descriptors.
    if (!value || typeof value !== "object" || isProxy(value) || ancestors.has(value)) throw "INVALID_INPUT";
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw "INVALID_INPUT";
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(name => typeof name !== "string")) throw "INVALID_INPUT";
    let keys: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) throw "INVALID_INPUT";
      if (length > 32768) throw "INPUT_LIMIT";
      if (names.length !== length + 1) throw "INVALID_INPUT";
      keys = Array.from({ length }, (_, index) => String(index));
    } else {
      if (names.length > 32768) throw "INPUT_LIMIT";
      keys = names as string[];
    }
    ancestors.add(value); add(2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw "INVALID_INPUT";
      if (!array) { visit(key, depth + 1); add(1); }
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
  }
  try { visit(input, 0); return null; }
  catch (error) { return error === "INPUT_LIMIT" ? "INPUT_LIMIT" : "INVALID_INPUT"; }
}

type Plain = Record<string, unknown>;
const record = (value: unknown): value is Plain => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is Plain => record(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const horizontal = (value: string) => value.replace(/[ \t\u00a0\u202f]+/gu, " ").replace(/^ +| +$/gu, "");
const WALL = "Класс бетона по прочности на сжатие для стен";
const SCOPE = "Толщина ж/б монолитных стен";
const dimension = "[1-9][0-9]*х[1-9][0-9]*мм";
const declaration = new RegExp(`^(?:(?:${dimension})(?:, ${dimension}){0,7}\\. )?${WALL} ([BВ][1-9][0-9]{0,2}(?:[.,][0-9])?)(?:\\.| \\(заполнитель - гранитный)?(?![\\s\\S])`, "u");
const scopeDeclaration = new RegExp(`^${SCOPE} [1-9][0-9]*мм(?:, [1-9][0-9]*мм){0,15}(?:, пилоны сечением)?(?![\\s\\S])`, "u");
function box(value: unknown, width: number, height: number): value is number[] {
  return Array.isArray(value) && value.length === 4
    && value.every(part => typeof part === "number" && Number.isSafeInteger(part) && part >= 0)
    && value[0] < value[2] && value[2] <= width && value[1] < value[3] && value[3] <= height;
}

/** Malformed page or unresolved grammar is an empty source-only result, never an inferred operand. */
export function extractConcreteWallCandidatesV1(page: unknown, stage: unknown): ConcreteWallCandidate[] {
  if (concreteWallNativeV1({ page, stage }) !== null || stage !== "RD"
    || !exact(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "quality", "blocks"])
    || !positive(page.pageNumber) || page.pageNumber > 512 || !positive(page.widthMilliPoints)
    || !positive(page.heightMilliPoints) || !exact(page.quality, ["disposition", "metrics", "reasonCodes"])
    || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
    || !exact(page.quality.metrics, ["alphanumericCharacterCount", "blockCount", "disallowedControlCharacterCount",
      "nonWhitespaceCharacterCount", "replacementCharacterCount"])
    || !Object.values(page.quality.metrics).every(item => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)
    || !Array.isArray(page.quality.reasonCodes) || !page.quality.reasonCodes.every(item => typeof item === "string")
    || !Array.isArray(page.blocks)) return [];
  const width = page.widthMilliPoints, height = page.heightMilliPoints;
  const lines: ConcreteWallFragment[] = [];
  for (const [blockIndex, block] of page.blocks.entries()) {
    if (!exact(block, ["text", "bboxMilliPoints", "lineBboxesMilliPoints"]) || typeof block.text !== "string"
      || /[\u0000-\u0008\u000b-\u001f\u2028\u2029\ufffd]/u.test(block.text)
      || !box(block.bboxMilliPoints, width, height) || !Array.isArray(block.lineBboxesMilliPoints)) return [];
    const rawLines = block.text.split("\n"), boxes = block.lineBboxesMilliPoints;
    if (!boxes.length || boxes.length !== rawLines.length || !boxes.every(item => box(item, width, height))) return [];
    const nativeBoxes = boxes as number[][];
    const union = nativeBoxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], nativeBoxes[0]);
    if (!union.every((part, index) => part === (block.bboxMilliPoints as number[])[index])) return [];
    for (const [lineIndex, rawText] of rawLines.entries()) {
      if ([...rawText].length > 100_000) return [];
      lines.push({ pageNumber: page.pageNumber, blockIndex, lineIndex, rawText, bboxMilliPoints: [...nativeBoxes[lineIndex]] });
    }
  }
  // Count reserved anchors over the entire page, including malformed competitors.
  const primaries = lines.filter(line => horizontal(line.rawText).includes(WALL));
  const scopes = lines.filter(line => horizontal(line.rawText).includes(SCOPE));
  if (primaries.length !== 1 || scopes.length !== 1) return [];
  const primary = primaries[0], scope = scopes[0], text = horizontal(primary.rawText);
  if (text.split(WALL).length !== 2 || horizontal(scope.rawText).split(SCOPE).length !== 2) return [];
  const match = declaration.exec(text);
  if (!match || !scopeDeclaration.test(horizontal(scope.rawText))) return [];
  const p = primary.bboxMilliPoints, s = scope.bboxMilliPoints;
  const gap = s[1] - p[3], overlapLeft = Math.max(p[0], s[0]), overlapRight = Math.min(p[2], s[2]);
  if (gap <= 0 || gap > 4 * Math.max(p[3] - p[1], s[3] - s[1])
    || overlapRight - overlapLeft < .9 * Math.min(p[2] - p[0], s[2] - s[0])) return [];
  if (lines.some(line => line !== primary && line !== scope && horizontal(line.rawText)
    && line.bboxMilliPoints[0] < overlapRight && line.bboxMilliPoints[2] > overlapLeft
    && line.bboxMilliPoints[1] < s[1] && line.bboxMilliPoints[3] > p[3])) return [];
  return [{ value: match[1], rawValue: match[1], rawUnit: "B_CLASS", canonicalUnit: "B_CLASS",
    primaryFragments: [{ ...primary, bboxMilliPoints: [...p] }],
    contextFragments: [{ ...scope, bboxMilliPoints: [...s], role: "MATERIAL_SCOPE" }] }];
}
