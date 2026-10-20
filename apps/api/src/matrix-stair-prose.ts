/** Independent source grammar for AR-048. Does not infer entity, normative applicability or finished dimensions. */
const attributes = new Set(["STAIR_TREAD_DEPTH", "STAIR_RISER_HEIGHT"]);
const units = new Set(["мм", "mm", "м", "m", "см", "cm"]);
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const box = (value: unknown): value is number[] => Array.isArray(value) && value.length === 4
  && value.every(Number.isFinite) && value[2] > value[0] && value[3] > value[1];
const intersects = (a: number[], b: number[]) => Math.min(a[2], b[2]) > Math.max(a[0], b[0])
  && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
const numberUnit = "([0-9]+(?:[.,][0-9]+)?)\\s*(мм|mm|см|cm|м|m)";
const first = new RegExp(`^Ширина проступей ступеней предусмотрена ${numberUnit}, а высота подъема$`, "iu");
const second = new RegExp(`^ступеней\\s*-\\s*${numberUnit}\\.(?: Уклоны лестниц\\s*-\\s*1:2\\. Стальные ограждения лестничных)?$`, "iu");

export function isStairDimension(attribute: string) { return attributes.has(attribute); }
export function validStairSourceBinding(item: Record<string, any>, fragments: Record<string, any>[], page: Record<string, any>) {
  if (!Array.isArray(item.parameterCodes) || item.parameterCodes.length !== 1 || item.parameterCodes[0] !== "AR-048"
    || !attributes.has(item.attribute) || !["PD", "RD"].includes(item.stage) || item.unit !== "mm"
    || !units.has(item.rawUnit) || !/^[0-9]+(?:[.,][0-9]+)?$/u.test(item.rawValue)
    || item.contextFragments !== undefined || item.sourceFlags.some((flag: string) => flag.includes("TABLE"))) return false;
  if (fragments.length === 1) {
    const label = item.attribute === "STAIR_TREAD_DEPTH" ? "Глубина проступи лестницы в свету"
      : "Высота подступенка лестницы после отделки";
    const literal = new RegExp(`^${label}\\s*(?:[:,;=|—–-]\\s*|\\s+)${numberUnit}\\s*[.;]?$`, "iu").exec(clean(item.rawText));
    return !!literal && literal[1] === item.rawValue && literal[2] === item.rawUnit && units.has(literal[2]);
  }
  if (fragments.length !== 2 || !Array.isArray(page.blocks)) return false;
  const rows: Array<{ id: string; text: string; bbox: number[] | null; exact: boolean }> = [];
  page.blocks.forEach((block: unknown, blockIndex: number) => {
    if (!record(block) || typeof block.text !== "string") return;
    const parts = block.text.split(/\r?\n/u);
    parts.forEach((text: string, lineIndex: number) => {
      if (!clean(text)) return;
      const declaredLineBoxes = block.lineBboxesMilliPoints !== undefined;
      const hasLineBox = Array.isArray(block.lineBboxesMilliPoints) && box(block.lineBboxesMilliPoints[lineIndex]);
      const exact = declaredLineBoxes ? hasLineBox : parts.length === 1;
      const candidate = declaredLineBoxes ? hasLineBox ? block.lineBboxesMilliPoints[lineIndex] : null : block.bboxMilliPoints;
      rows.push({ id: `${blockIndex}:${lineIndex}`, text: clean(text), bbox: box(candidate) ? candidate : null, exact });
    });
  });
  const anchors = rows.filter(row => row.text.toLocaleLowerCase().startsWith("ширина проступей ступеней"));
  const seconds = rows.filter(row => second.test(row.text));
  if (anchors.length !== 1 || seconds.length !== 1) return false;
  const a = anchors[0], b = seconds[0];
  if (!a.exact || !b.exact || !a.bbox || !b.bbox || fragments[0].blockId !== a.id || fragments[1].blockId !== b.id) return false;
  const gap = a.bbox[1] - b.bbox[3];
  if (gap < 0 || gap > 18_000 || Math.abs(a.bbox[0] - b.bbox[0]) > 2_000
    || Math.abs((a.bbox[3] - a.bbox[1]) - (b.bbox[3] - b.bbox[1])) > 1_000) return false;
  const union = [Math.min(a.bbox[0], b.bbox[0]), b.bbox[1], Math.max(a.bbox[2], b.bbox[2]), a.bbox[3]];
  if (rows.some(row => row !== a && row !== b && (!row.bbox || intersects(row.bbox, union)))) return false;
  const tread = first.exec(a.text), riser = second.exec(b.text);
  if (!tread || !riser || !units.has(tread[2]) || !units.has(riser[2])) return false;
  const match = item.attribute === "STAIR_TREAD_DEPTH" ? tread : riser;
  return match[1] === item.rawValue && match[2] === item.rawUnit;
}
