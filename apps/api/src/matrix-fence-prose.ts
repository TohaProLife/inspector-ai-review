/** Independent SPZU-036 source grammar. Extracts height only; never invents fence identity or review. */
const attribute = "TERRITORY_FENCE_HEIGHT";
const units = new Set(["м", "m", "мм", "mm", "см", "cm"]);
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const box = (value: unknown): value is number[] => Array.isArray(value) && value.length === 4
  && value.every(Number.isFinite) && value[2] > value[0] && value[3] > value[1];
const intersects = (a: number[], b: number[]) => Math.min(a[2], b[2]) > Math.max(a[0], b[0])
  && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
const numberUnit = "([0-9]+(?:[.,][0-9]+)?)\\s*(мм|mm|см|cm|м|m)";
const literal = new RegExp(`^Высота ограждения территории\\s*(?:[:,;=|—–-]\\s*|\\s+)${numberUnit}\\s*[.;]?$`, "iu");
const first = "по границе территории объекта проектом предусмотрена установка";
const second = new RegExp(`^ограждения высотой ${numberUnit}, протяженностью ${numberUnit} с учетом длины ворот и$`, "iu");

export function isTerritoryFenceHeight(value: string) { return value === attribute; }
export function validFenceSourceBinding(item: Record<string, any>, fragments: Record<string, any>[], page: Record<string, any>) {
  if (!Array.isArray(item.parameterCodes) || item.parameterCodes.length !== 1 || item.parameterCodes[0] !== "SPZU-036"
    || item.attribute !== attribute || !["PD", "RD"].includes(item.stage) || item.unit !== "m"
    || !units.has(item.rawUnit) || typeof item.rawValue !== "string" || !/^[0-9]+(?:[.,][0-9]+)?$/u.test(item.rawValue)
    || typeof item.rawText !== "string" || item.contextFragments !== undefined || !Array.isArray(item.sourceFlags)
    || item.sourceFlags.some((flag: unknown) => typeof flag !== "string" || flag.includes("TABLE"))) return false;
  if (fragments.length === 1) {
    const match = literal.exec(clean(item.rawText));
    return !!match && match[1] === item.rawValue && match[2] === item.rawUnit && units.has(match[2]);
  }
  if (item.stage !== "PD" || fragments.length !== 2 || !Array.isArray(page.blocks)) return false;
  const rows: Array<{ id: string; block: number; line: number; text: string; bbox: number[] | null; exact: boolean }> = [];
  page.blocks.forEach((block: unknown, blockIndex: number) => {
    if (!record(block) || typeof block.text !== "string") return;
    block.text.split(/\r?\n/u).forEach((text: string, lineIndex: number) => {
      if (!clean(text)) return;
      const declared = block.lineBboxesMilliPoints !== undefined;
      const lineBox = Array.isArray(block.lineBboxesMilliPoints) ? block.lineBboxesMilliPoints[lineIndex] : null;
      const candidate = declared ? lineBox : block.bboxMilliPoints;
      rows.push({ id: `${blockIndex}:${lineIndex}`, block: blockIndex, line: lineIndex, text: clean(text),
        bbox: box(candidate) ? candidate : null, exact: declared && box(lineBox) });
    });
  });
  // Malformed competing first anchors remain ambiguity, even when they cannot parse a height.
  const anchors = rows.filter(row => row.text.toLocaleLowerCase().startsWith("по границе территории объекта"));
  const seconds = rows.filter(row => second.test(row.text));
  if (anchors.length !== 1 || seconds.length !== 1) return false;
  const a = anchors[0], b = seconds[0];
  if (a.text.toLocaleLowerCase() !== first || !a.exact || !b.exact || !a.bbox || !b.bbox
    || a.block !== b.block || b.line !== a.line + 1
    || fragments[0].blockId !== a.id || fragments[1].blockId !== b.id) return false;
  const gap = a.bbox[1] - b.bbox[3], indent = a.bbox[0] - b.bbox[0];
  if (gap < 0 || gap > 18_000 || indent < 0 || indent > 40_000 || Math.abs(a.bbox[2] - b.bbox[2]) > 2_000
    || Math.abs((a.bbox[3] - a.bbox[1]) - (b.bbox[3] - b.bbox[1])) > 1_000) return false;
  const union = [Math.min(a.bbox[0], b.bbox[0]), b.bbox[1], Math.max(a.bbox[2], b.bbox[2]), a.bbox[3]];
  if (rows.some(row => row !== a && row !== b && (!row.bbox || intersects(row.bbox, union)))) return false;
  const match = second.exec(b.text);
  return !!match && units.has(match[2]) && units.has(match[4]) && match[1] === item.rawValue && match[2] === item.rawUnit;
}
