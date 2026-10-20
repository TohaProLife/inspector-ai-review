/** Literal project declarations only. This helper never infers shared identity or datum authority. */
export const PROJECT_ZERO_EXTRACTOR_VERSION = "matrix-project-zero-prose-v1";
export interface ProjectZeroFragment {
  blockIndex: number;
  lineIndex: number;
  rawText: string;
  bboxMilliPoints: number[];
}
export interface ProjectZeroCandidate {
  value: string;
  rawValue: string;
  rawUnit: "м" | "метрах";
  canonicalUnit: "m";
  localZero: "0";
  referenceKind: "FINISHED_FLOOR";
  referenceText: string;
  datumName: null;
  primaryFragments: ProjectZeroFragment[];
  unitAuthorityFragments: ProjectZeroFragment[];
}
const numberPattern = "[+-]?(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?";
const signedDecimal = new RegExp(`^(?:${numberPattern})$(?![\\s\\S])`, "u");
const pdFirst = new RegExp(`^За относительную отметку 0[,.]000 принята абсолютная отметка (?<value>${numberPattern}) м\\., что соответствует$(?![\\s\\S])`, "u");
const pdSecond = "отметке чистого пола входного вестибюля на 1-м этаже.";
const rdFirst = new RegExp(`^За относительную отметку ±?0[,.]000 принята отметка чистого пола первого этажа, соответствующая абсолютной отметке (?<value>${numberPattern})\\.$(?![\\s\\S])`, "u");
const unitLast = "отметки - в метрах.";
const unitPreviousEnd = "Все размеры даны в миллиметрах,";
// Python's Unicode whitespace and word categories; JS \b/\w are ASCII-only.
const whitespace = "[\\t\\n\\v\\f\\r\\u001c-\\u001f\\u0085\\p{Zs}\\p{Zl}\\p{Zp}]";
const word = "[\\p{L}\\p{N}_]";
const endWord = `(?<!${word})(?=${word})|(?<=${word})(?!${word})`;
const boundary = `(?:${endWord})`;
const declaration = new RegExp(`отметки${whitespace}*(?:[-–—:=]|(?:даны|указаны|приведены|измеряются|в)${boundary})`, "iu");
const unitMention = new RegExp(`отметк[а-я]*${boundary}.*(?:метр[а-я]*|(?<!${word})(?:м|мм|см|m|mm|cm)${boundary})`, "iu");
const sizeDeclaration = new RegExp(`размеры${whitespace}+(?:даны|указаны|приведены|в)${boundary}`, "iu");
const trimWhitespace = new RegExp(`^${whitespace}+|${whitespace}+$`, "gu");
const trim = (text: string) => text.replace(trimWhitespace, "");
const clean = (text: string) => trim(text.replace(/[ \t\u00a0\u202f]+/gu, " "));
const anchor = "за относительную отметк";
// The only full case folds into letters used by this Russian anchor.
const foldAnchor = (text: string) => text.toLowerCase().replace(/[\u1c82-\u1c85]/gu,
  letter => ({ "ᲂ": "о", "ᲃ": "с", "ᲄ": "т", "ᲅ": "т" })[letter]!);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function ownData(value: object): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === "string"
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}
function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return ownData(value) && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}
function list(value: unknown): value is unknown[] {
  return Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
      .every(descriptor => !!descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
}
const positiveInteger = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value > 0;
function box(value: unknown, width: number, height: number): value is number[] {
  return list(value) && value.length === 4 && value.every(n => typeof n === "number"
    && Number.isSafeInteger(n) && n >= 0) && Number(value[0]) < Number(value[2])
    && Number(value[2]) <= width && Number(value[1]) < Number(value[3]) && Number(value[3]) <= height;
}
function pageLines(page: unknown): { lines: ProjectZeroFragment[]; blocks: Array<{ text: string }>; width: number } | null {
  if (!record(page) || !exactKeys(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "quality", "blocks"])
    || !positiveInteger(page.pageNumber) || !positiveInteger(page.widthMilliPoints) || !positiveInteger(page.heightMilliPoints)
    || !record(page.quality) || !ownData(page.quality) || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
    || !list(page.blocks)) return null;
  const width = page.widthMilliPoints, height = page.heightMilliPoints;
  const lines: ProjectZeroFragment[] = [], blocks: Array<{ text: string }> = [];
  for (const [blockIndex, block] of page.blocks.entries()) {
    if (!record(block) || !exactKeys(block, ["text", "bboxMilliPoints", "lineBboxesMilliPoints"])
      || typeof block.text !== "string" || /[\r\u2028\u2029]/u.test(block.text)
      || !box(block.bboxMilliPoints, width, height) || !list(block.lineBboxesMilliPoints)) return null;
    const texts = block.text.split("\n"), boxes = block.lineBboxesMilliPoints;
    if (!boxes.length || boxes.length !== texts.length || !boxes.every(b => box(b, width, height))) return null;
    const exactBoxes = boxes as number[][];
    const union = exactBoxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
      Math.max(a[2], b[2]), Math.max(a[3], b[3])], exactBoxes[0]);
    if (!union.every((n, i) => n === (block.bboxMilliPoints as number[])[i])) return null;
    for (const [lineIndex, rawText] of texts.entries()) lines.push({ blockIndex, lineIndex, rawText,
      bboxMilliPoints: exactBoxes[lineIndex].slice() });
    blocks.push({ text: block.text });
  }
  return { lines, blocks, width };
}
function pair(first: ProjectZeroFragment, second: ProjectZeroFragment, gap: number): boolean {
  const a = first.bboxMilliPoints, b = second.bboxMilliPoints, h1 = a[3] - a[1], h2 = b[3] - b[1];
  return first.blockIndex === second.blockIndex && second.lineIndex === first.lineIndex + 1
    && h1 >= 9000 && h1 <= 14000 && h2 >= 9000 && h2 <= 14000 && Math.abs(h1 - h2) <= 1000
    && a[1] - b[3] >= 0 && a[1] - b[3] <= gap && Math.abs(a[0] - b[0]) <= 1000;
}
function unobstructed(chosen: ProjectZeroFragment[], lines: ProjectZeroFragment[]): boolean {
  const boxes = chosen.map(line => line.bboxMilliPoints);
  const envelope = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
    Math.max(a[2], b[2]), Math.max(a[3], b[3])], boxes[0]);
  return lines.every(line => {
    if (chosen.some(part => part.blockIndex === line.blockIndex && part.lineIndex === line.lineIndex)
      || !trim(line.rawText)) return true;
    const b = line.bboxMilliPoints;
    return !(b[0] < envelope[2] && b[2] > envelope[0] && b[1] < envelope[3] && b[3] > envelope[1]);
  });
}
/** Narrow signed elevation normalization. Callers must independently verify the original unit authority. */
export function normalizeProjectZeroValue(rawValue: unknown, rawUnit: unknown): string | null {
  if (typeof rawValue !== "string" || rawValue.length > 64 || !signedDecimal.test(rawValue)
    || (rawUnit !== "м" && rawUnit !== "метрах")) return null;
  const negative = rawValue.startsWith("-"), unsigned = rawValue.replace(/^[+-]/u, "").replace(",", ".");
  const [whole, fraction = ""] = unsigned.split("."), tail = fraction.replace(/0+$/u, "");
  const canonical = whole + (tail ? `.${tail}` : "");
  return (negative && canonical !== "0" ? "-" : "") + canonical;
}
function candidate(rawValue: string, rawUnit: "м" | "метрах", referenceText: string,
  primaryFragments: ProjectZeroFragment[], unitAuthorityFragments: ProjectZeroFragment[]): ProjectZeroCandidate[] {
  const value = normalizeProjectZeroValue(rawValue, rawUnit);
  return value === null ? [] : [{ value, rawValue, rawUnit, canonicalUnit: "m", localZero: "0",
    referenceKind: "FINISHED_FLOOR", referenceText, datumName: null, primaryFragments, unitAuthorityFragments }];
}
/** Page-only parsing, independent from the Python implementation and from any review state. */
export function extractProjectZeroCandidates(page: unknown, stage: unknown): ProjectZeroCandidate[] {
  if (stage !== "PD" && stage !== "RD") return [];
  const parsed = pageLines(page);
  if (!parsed) return [];
  const { lines, blocks, width } = parsed;
  const anchors = lines.filter(line => foldAnchor(clean(line.rawText)).includes(anchor));
  const anchorCount = blocks.reduce((n, block) => n + foldAnchor(clean(block.text.replaceAll("\n", " "))).split(anchor).length - 1, 0);
  if (anchors.length !== 1 || anchorCount !== 1) return [];
  const first = anchors[0];
  if (stage === "PD") {
    const match = pdFirst.exec(clean(first.rawText));
    if (!match?.groups) return [];
    const continuations = lines.filter(line => line.blockIndex === first.blockIndex && line.lineIndex === first.lineIndex + 1);
    if (continuations.length !== 1 || clean(continuations[0].rawText) !== pdSecond
      || !pair(first, continuations[0], 6000) || !unobstructed([first, continuations[0]], lines)) return [];
    return candidate(match.groups.value, "м", trim(continuations[0].rawText), [first, continuations[0]], []);
  }
  const match = rdFirst.exec(clean(first.rawText)), firstHeight = first.bboxMilliPoints[3] - first.bboxMilliPoints[1];
  if (!match?.groups || firstHeight < 9000 || firstHeight > 14000) return [];
  const declarations = lines.filter(line => declaration.test(clean(line.rawText)) || unitMention.test(clean(line.rawText)));
  if (declarations.length !== 1 || clean(declarations[0].rawText) !== unitLast) return [];
  const last = declarations[0];
  const previousLines = lines.filter(line => line.blockIndex === last.blockIndex && line.lineIndex === last.lineIndex - 1);
  if (previousLines.length !== 1 || !clean(previousLines[0].rawText).endsWith(unitPreviousEnd)
    || !pair(previousLines[0], last, 7000)) return [];
  const previous = previousLines[0], text = clean(previous.rawText), prefix = text.slice(0, -unitPreviousEnd.length);
  if (prefix && !prefix.endsWith(". ") || /[«»"'“”]/u.test(text)) return [];
  const sizes = lines.filter(line => sizeDeclaration.test(clean(line.rawText)));
  if (sizes.length !== 1 || sizes[0] !== previous) return [];
  const fragments = [first, previous, last], lefts = fragments.map(f => f.bboxMilliPoints[0]);
  if (fragments.some(f => f.bboxMilliPoints[2] * 2 > width) || Math.max(...lefts) - Math.min(...lefts) > 40000
    || !unobstructed([first], lines) || !unobstructed([previous, last], lines)) return [];
  const reference = /чистого[ \t\u00a0\u202f]+пола[ \t\u00a0\u202f]+первого[ \t\u00a0\u202f]+этажа/u.exec(first.rawText);
  return reference ? candidate(match.groups.value, "метрах", reference[0], [first], [previous, last]) : [];
}
