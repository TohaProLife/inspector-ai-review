import type { SourceDeclarationFragment, SteelSourceProductScope } from "@inspector-ai/contracts";

/** Literal source evidence only. This parser neither identifies members nor evaluates rules. */
export const STEEL_EXTRACTOR_VERSION = "matrix-steel-prose-v1";
export interface SteelCandidate {
  value: "С245" | "С345";
  rawValue: "C245" | "С245" | "C345" | "С345";
  rawUnit: null;
  canonicalUnit: "steel_catalog_example";
  primaryFragments: SourceDeclarationFragment[];
  scopeFragments: SourceDeclarationFragment[];
  productScope: SteelSourceProductScope;
}
const aliases = new Map<string, SteelCandidate["value"]>([
  ["C245", "С245"], ["С245", "С245"], ["C345", "С345"], ["С345", "С345"],
]);
export function normalizeSteelCatalogGrade(value: unknown): SteelCandidate["value"] | null {
  return typeof value === "string" ? aliases.get(value) ?? null : null;
}
/** Directed catalog example only; equality has no qualification or completeness meaning. */
export function compareSteelCatalogExample(expected: unknown, actual: unknown): boolean | null {
  const pd = normalizeSteelCatalogGrade(expected), rd = normalizeSteelCatalogGrade(actual);
  if (!pd || !rd) return null;
  if (pd === rd) return false;
  return pd === "С345" && rd === "С245" ? true : null;
}
const whitespace = "[\\t\\n\\v\\f\\r\\u001c-\\u001f\\u0085\\p{Zs}\\p{Zl}\\p{Zp}]";
const trim = (text: string) => text.replace(new RegExp(`^${whitespace}+|${whitespace}+$`, "gu"), "");
const clean = (text: string) => trim(text.replace(/[ \t\u00a0\u202f]+/gu, " "));
const exact = (text: string) => new RegExp(`^${text}$(?![\\s\\S])`, "u");
const grade = "(?<grade>[CС](?:245|345))";
const pdPattern = exact("двутавров 70Б3 ГОСТ Р 35087-2024 \\(сталь класса " + grade + " ГОСТ 27772-2015\\)\\. Монтаж");
const pdScopes = [
  "конструкциях, и составляет от 3,5 м до 5,5 м. Крепление распорных элементов к",
  "«стене в грунте» осуществляется через распределительные пояса, которые",
  "выполняются на 1 и 3 ярусе из спаренных двутавров 70Б2, для 2 яруса из трех",
];
const pdScopeAnchors = [/крепление распорных элементов к/giu, /через распределительные пояса, которые/giu,
  /выполняются на 1 и 3 ярусе/giu];
const pdAnchor = /сталь класса/giu, rdAnchor = /двутавры/giu;
const rdFirst = "12. Трубы должны соответствовать ГОСТ 10704-91, из стали марки Ст20 по ГОСТ";
const rdStart = "380-2005. Двутавры должны соответствовать по ГОСТ Р 57837-2017, сталь";
const rdClass = exact(grade + " по ГОСТ 27772-2021\\. Сталь прокатная листовая должна");
const rdSheet = exact("соответствовать ГОСТ 19903-2015 из стали [CС](?:245|345) по ГОСТ 27772-2021\\.");
const rdRebar = "Арматурные стержни закладных деталей класса А500С по ГОСТ 34028-2016.";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function ownData(value: object): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === "string"
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return ownData(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function list(value: unknown): value is unknown[] {
  return Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
      .every(descriptor => !!descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable);
}
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
function box(value: unknown, width: number, height: number): value is [number, number, number, number] {
  return list(value) && value.length === 4 && value.every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
    && Number(value[0]) < Number(value[2]) && Number(value[2]) <= width
    && Number(value[1]) < Number(value[3]) && Number(value[3]) <= height;
}
function pageLines(page: unknown): { lines: SourceDeclarationFragment[]; blocks: { text: string }[] } | null {
  if (!record(page) || !keys(page, ["pageNumber", "widthMilliPoints", "heightMilliPoints", "quality", "blocks"])
    || !positiveInteger(page.pageNumber) || !positiveInteger(page.widthMilliPoints) || !positiveInteger(page.heightMilliPoints)
    || !record(page.quality) || !ownData(page.quality) || page.quality.disposition !== "TEXT_LAYER_CANDIDATE" || !list(page.blocks)) return null;
  const lines: SourceDeclarationFragment[] = [], blocks: { text: string }[] = [];
  for (const [blockIndex, block] of page.blocks.entries()) {
    if (!record(block) || !keys(block, ["text", "bboxMilliPoints", "lineBboxesMilliPoints"])
      || typeof block.text !== "string" || /[\u0000-\u0008\u000b-\u001f\u2028\u2029\ud800-\udfff]/u.test(block.text)
      || !box(block.bboxMilliPoints, page.widthMilliPoints, page.heightMilliPoints) || !list(block.lineBboxesMilliPoints)) return null;
    const texts = block.text.split("\n"), boxes = block.lineBboxesMilliPoints;
    if (!boxes.length || texts.length !== boxes.length || !boxes.every(b => box(b, page.widthMilliPoints as number, page.heightMilliPoints as number))) return null;
    const positions = boxes as [number, number, number, number][];
    const union = positions.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], positions[0]);
    if (!union.every((n, i) => n === (block.bboxMilliPoints as number[])[i])) return null;
    for (const [lineIndex, rawText] of texts.entries()) lines.push({ pageNumber: page.pageNumber, blockIndex, lineIndex, rawText,
      bboxMilliPoints: [...positions[lineIndex]] });
    blocks.push({ text: block.text });
  }
  return { lines, blocks };
}
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;
const anchorCount = (blocks: { text: string }[], pattern: RegExp) => blocks.reduce((n, b) => n + count(clean(b.text.replaceAll("\n", " ")), pattern), 0);
function unique(lines: SourceDeclarationFragment[], pattern: RegExp): SourceDeclarationFragment | null {
  const matches = lines.filter(line => count(clean(line.rawText), pattern));
  return matches.length === 1 ? matches[0] : null;
}
function geometry(chosen: SourceDeclarationFragment[], lines: SourceDeclarationFragment[], low: number, high: number, maxGap: number, maxLeft: number): boolean {
  const boxes = chosen.map(line => line.bboxMilliPoints), heights = boxes.map(b => b[3] - b[1]);
  if (heights.some(h => h < low || h > high) || Math.max(...heights) - Math.min(...heights) > 1000
    || Math.max(...boxes.map(b => b[0])) - Math.min(...boxes.map(b => b[0])) > maxLeft
    || boxes.slice(0, -1).some((a, i) => a[1] - boxes[i + 1][3] < 0 || a[1] - boxes[i + 1][3] > maxGap)) return false;
  const envelope = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], boxes[0]);
  return lines.every(line => {
    if (chosen.some(p => p.blockIndex === line.blockIndex && p.lineIndex === line.lineIndex) || !trim(line.rawText)) return true;
    const b = line.bboxMilliPoints;
    return !(b[0] < envelope[2] && b[2] > envelope[0] && b[1] < envelope[3] && b[3] > envelope[1]);
  });
}

/** Raw glyph, neighboring clauses and original line boxes survive unchanged. */
export function extractSteelCandidates(page: unknown, stage: unknown): SteelCandidate[] {
  if (stage !== "PD" && stage !== "RD") return [];
  const parsed = pageLines(page);
  if (!parsed) return [];
  const { lines, blocks } = parsed;
  let primaryFragments: SourceDeclarationFragment[], scopeFragments: SourceDeclarationFragment[], productScope: SteelSourceProductScope, match: RegExpExecArray | null;
  if (stage === "PD") {
    if (anchorCount(blocks, pdAnchor) !== 1) return [];
    const primary = unique(lines, pdAnchor);
    if (!primary) return [];
    match = pdPattern.exec(clean(primary.rawText));
    const scopes: SourceDeclarationFragment[] = [];
    for (const [i, pattern] of pdScopeAnchors.entries()) {
      if (anchorCount(blocks, pattern) !== 1) return [];
      const line = unique(lines, pattern);
      if (!line || clean(line.rawText) !== pdScopes[i]) return [];
      scopes.push(line);
    }
    const chosen = [...scopes, primary];
    if (!match || !geometry(chosen, lines, 11000, 13000, 10000, 2000)
      || chosen.slice(0, -1).some((line, i) => line.blockIndex > chosen[i + 1].blockIndex
        || (line.blockIndex === chosen[i + 1].blockIndex && line.lineIndex > chosen[i + 1].lineIndex))) return [];
    primaryFragments = [primary]; scopeFragments = scopes;
    productScope = { role: "DISTRIBUTION_BELT_I_BEAMS", productKind: "I_BEAM", profile: "70Б3", count: 3, tier: 2,
      productStandard: "ГОСТ Р 35087-2024", gradeStandard: "ГОСТ 27772-2015" };
  } else {
    if (anchorCount(blocks, rdAnchor) !== 1) return [];
    const start = unique(lines, rdAnchor);
    if (!start || clean(start.rawText) !== rdStart || start.lineIndex < 1) return [];
    const chosen = Array.from({ length: 5 }, (_, i) => lines.find(line => line.blockIndex === start.blockIndex && line.lineIndex === start.lineIndex - 1 + i));
    if (chosen.some(line => !line)) return [];
    const [first, beginning, primary, sheet, rebar] = chosen as SourceDeclarationFragment[];
    match = rdClass.exec(clean(primary.rawText));
    if (!match || clean(first.rawText) !== rdFirst || !rdSheet.test(clean(sheet.rawText)) || clean(rebar.rawText) !== rdRebar
      || !geometry(chosen as SourceDeclarationFragment[], lines, 14500, 16500, 4000, 21000)) return [];
    primaryFragments = [beginning, primary]; scopeFragments = [first, sheet, rebar];
    productScope = { role: "I_BEAM_GENERIC_DECLARATION", productKind: "I_BEAM", profile: null, count: null, tier: null,
      productStandard: "ГОСТ Р 57837-2017", gradeStandard: "ГОСТ 27772-2021" };
  }
  const rawValue = match.groups!.grade as SteelCandidate["rawValue"];
  return [{ value: aliases.get(rawValue)!, rawValue, rawUnit: null, canonicalUnit: "steel_catalog_example", primaryFragments, scopeFragments, productScope }];
}
