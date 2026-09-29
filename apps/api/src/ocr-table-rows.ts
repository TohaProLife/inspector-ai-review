import { canonicalJson, sha256 } from "./canonical-json.js";
import { boundedOcrProfileIdV4, boundedOcrProfileIdV5 } from "./ocr-layout.js";
import { stageContent, verifiedPage, type OcrHeatStageEnvelope } from "./ocr-heat-row-proposals.js";

type Json = Record<string, unknown>;
type Line = { text: string; score: number; bboxPx: [number, number, number, number] };
type Page = { sourceFileId: string; inputSha256: string; pageNumber: number;
  contentHash: string; render: { sha256: string; widthPx: number }; lines: Line[] };
type Evidence = { role: string; lineIndex: number; text: string;
  bboxPx: [number, number, number, number]; score: number };

const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const exact = (value: Json, fields: readonly string[]): boolean =>
  Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const same = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

// Worker json.dumps(sort_keys=True) uses code point key order, unlike API canonicalJson.
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function evidence(page: Page, index: number, role: string): Evidence {
  const line = page.lines[index];
  return { role, lineIndex: index, text: line.text, bboxPx: line.bboxPx, score: line.score };
}

function overlaps(first: Line, second: Line): boolean {
  const a = first.bboxPx;
  const b = second.bboxPx;
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return overlap > 0 && overlap * 2 >= Math.min(a[3] - a[1], b[3] - b[1]);
}

function derivePage(page: Page, proposals: Json[], abstentions: Json[],
  rightCandidateLeftTolerancePx: 32 | 64, withContinuations = false): void {
  const abstain = (lineIndex: number | null, reasonCode: string) => {
    abstentions.push({ sourceFileId: page.sourceFileId, inputSha256: page.inputSha256,
      pageNumber: page.pageNumber, lineIndex, reasonCode });
  };
  const title = (text: string) => text.trim().split(/\s+/u).join(" ").toLocaleLowerCase("ru-RU");
  const names = page.lines.flatMap((line, index) => title(line.text) === "наименование" ? [index] : []);
  const values = page.lines.flatMap((line, index) => title(line.text) === "значение" ? [index] : []);
  if (names.length !== 1 || values.length !== 1) {
    abstain(null, "TWO_COLUMN_HEADER_UNRESOLVED");
    return;
  }
  const leftHeaderIndex = names[0];
  const rightHeaderIndex = values[0];
  const leftHeader = page.lines[leftHeaderIndex];
  const rightHeader = page.lines[rightHeaderIndex];
  if (leftHeader.score < 0.8 || rightHeader.score < 0.8
    || leftHeader.bboxPx[2] >= rightHeader.bboxPx[0]
    || !overlaps(leftHeader, rightHeader)) {
    abstain(null, "TWO_COLUMN_HEADER_UNRESOLVED");
    return;
  }
  const headerBottom = Math.max(leftHeader.bboxPx[3], rightHeader.bboxPx[3]);
  const rightStart = rightHeader.bboxPx[0];
  const rightEnd = rightHeader.bboxPx[2];
  const excluded = new Set([leftHeaderIndex, rightHeaderIndex]);
  const leftIndices = page.lines.flatMap((line, index) => !excluded.has(index)
    && line.bboxPx[1] >= headerBottom
    && line.bboxPx[0] >= page.render.widthPx * 0.2
    && line.bboxPx[0] < rightStart - 32
    && line.bboxPx[2] <= rightStart
    && line.text.trim().length >= 4 && /\p{L}/u.test(line.text) ? [index] : []);
  const rightIndices = page.lines.flatMap((line, index) => !excluded.has(index)
    && line.bboxPx[1] >= headerBottom
    && line.bboxPx[0] >= rightStart - rightCandidateLeftTolerancePx
    && line.bboxPx[0] <= rightEnd + 32
    && /\p{Decimal_Number}/u.test(line.text) ? [index] : []);
  const edges = new Map<number, number[]>();
  const reverse = new Map<number, number[]>();
  for (const rightIndex of rightIndices) {
    const value = page.lines[rightIndex];
    const matches = leftIndices.filter((leftIndex) =>
      page.lines[leftIndex].bboxPx[2] < value.bboxPx[0]
      && overlaps(page.lines[leftIndex], value));
    if (!matches.length) continue;
    edges.set(rightIndex, matches);
    for (const leftIndex of matches) {
      reverse.set(leftIndex, [...(reverse.get(leftIndex) ?? []), rightIndex]);
    }
  }
  let previousBottom = headerBottom;
  const firstProposal = proposals.length;
  for (const rightIndex of [...edges.keys()].sort((a, b) =>
    page.lines[a].bboxPx[1] - page.lines[b].bboxPx[1] || a - b)) {
    const value = page.lines[rightIndex];
    if (value.bboxPx[1] - previousBottom > 200) break;
    const labelIndices = edges.get(rightIndex)!;
    if (labelIndices.length !== 1 || reverse.get(labelIndices[0])!.length !== 1) {
      abstain(rightIndex, "ROW_PAIR_AMBIGUOUS");
      continue;
    }
    const leftIndex = labelIndices[0];
    const label = page.lines[leftIndex];
    if (Math.min(label.score, value.score) < 0.8) {
      abstain(rightIndex, "OCR_SCORE_TOO_LOW");
      continue;
    }
    proposals.push({ sourceFileId: page.sourceFileId, inputSha256: page.inputSha256,
      pageNumber: page.pageNumber, ocrPageContentHash: page.contentHash,
      renderSha256: page.render.sha256,
      headerEvidence: [evidence(page, leftHeaderIndex, "labelHeader"),
        evidence(page, rightHeaderIndex, "valueHeader")],
      labelEvidence: evidence(page, leftIndex, "rowLabel"),
      valueEvidence: evidence(page, rightIndex, "rawValue") });
    previousBottom = Math.max(label.bboxPx[3], value.bboxPx[3]);
  }
  if (withContinuations) {
    const pageProposals = proposals.splice(firstProposal);
    deriveContinuations(page, pageProposals, abstentions,
      leftHeaderIndex, rightHeaderIndex);
    proposals.push(...pageProposals);
  }
}

function deriveContinuations(page: Page, rows: Json[], abstentions: Json[],
  leftHeaderIndex: number, rightHeaderIndex: number): void {
  const used = new Set<number>();
  for (const row of rows) {
    for (const entry of [...row.headerEvidence as Evidence[],
      row.labelEvidence as Evidence, row.valueEvidence as Evidence]) {
      used.add(entry.lineIndex);
    }
  }
  const rightHeader = page.lines[rightHeaderIndex].bboxPx;
  const otherValues = page.lines.flatMap((line, index) =>
    index !== leftHeaderIndex && index !== rightHeaderIndex
      && line.bboxPx[0] >= rightHeader[0] - 64
      && line.bboxPx[0] <= rightHeader[2] + 32
      && /\p{Decimal_Number}/u.test(line.text) ? [index] : []);
  const candidates: number[][] = [];
  const owners = new Map<number, number[]>();
  for (const [rowNumber, row] of rows.entries()) {
    const labelBox = (row.labelEvidence as Evidence).bboxPx;
    const valueBox = (row.valueEvidence as Evidence).bboxPx;
    const valueIndex = (row.valueEvidence as Evidence).lineIndex;
    const matches: number[] = [];
    for (const [index, line] of page.lines.entries()) {
      if (used.has(index) || !line.text.trim()) continue;
      const box = line.bboxPx;
      if (Math.abs(box[0] - labelBox[0]) > 24
        || box[1] <= labelBox[1] || box[1] > labelBox[3] + 10
        || box[3] < labelBox[3] || box[3] > valueBox[3] + 16
        || box[2] >= valueBox[0]
        || !overlaps(line, page.lines[valueIndex])) continue;
      matches.push(index);
      owners.set(index, [...(owners.get(index) ?? []), rowNumber]);
    }
    candidates.push(matches);
  }
  const accepted: Json[] = [];
  for (const [rowNumber, row] of rows.entries()) {
    const matches = candidates[rowNumber];
    const valueIndex = (row.valueEvidence as Evidence).lineIndex;
    let reason: string | null = null;
    if (matches.length > 1 || matches.some((index) => owners.get(index)?.length !== 1)) {
      reason = "ROW_LABEL_CONTINUATION_AMBIGUOUS";
    } else if (matches.length && otherValues.some((other) =>
      other !== valueIndex
      && page.lines[matches[0]].bboxPx[2] < page.lines[other].bboxPx[0]
      && overlaps(page.lines[matches[0]], page.lines[other]))) {
      reason = "ROW_LABEL_CONTINUATION_AMBIGUOUS";
    } else if (matches.length && page.lines[matches[0]].score < 0.8) {
      reason = "OCR_SCORE_TOO_LOW";
    }
    if (reason) {
      abstentions.push({ sourceFileId: row.sourceFileId, inputSha256: row.inputSha256,
        pageNumber: row.pageNumber, lineIndex: valueIndex, reasonCode: reason });
    } else {
      accepted.push({ ...row, labelContinuationEvidence: matches.length
        ? [evidence(page, matches[0], "rowLabelContinuation")] : [] });
    }
  }
  rows.splice(0, rows.length, ...accepted);
}

/** Recompute every uncoded row from one immutable saved OCR v4/v5 stage. */
export function verifyOcrTableRows(result: unknown, persistedStage: OcrHeatStageEnvelope,
  expectedManifestHash: string): boolean {
  try {
    if (!record(result)) return false;
    const rightCandidateLeftTolerancePx =
      result.schemaVersion === "ocr-table-row-proposals-v1"
        && result.profileId === "conservative-ocr-table-rows-v1" ? 32
        : result.schemaVersion === "ocr-table-row-proposals-v2"
          && result.profileId === "conservative-ocr-table-rows-v2" ? 64
          : result.schemaVersion === "ocr-table-row-proposals-v3"
            && result.profileId === "conservative-ocr-table-rows-v3" ? 64 : null;
    if (!hash(expectedManifestHash) || !record(result)
      || !exact(result, ["schemaVersion", "profileId", "ocrStageSha256", "inputManifestHash",
        "proposals", "abstentions", "findingCount", "contentHash"])
      || rightCandidateLeftTolerancePx === null
      || result.inputManifestHash !== expectedManifestHash || result.findingCount !== 0
      || !hash(result.ocrStageSha256) || !hash(result.contentHash)
      || !Array.isArray(result.proposals) || !Array.isArray(result.abstentions)
      || result.proposals.length > 20_000 || result.abstentions.length > 20_000
      || Buffer.byteLength(workerJson(result), "utf8") > 8 * 1024 * 1024) return false;
    const { contentHash: _ignored, ...unhashed } = result;
    if (sha256(workerJson(unhashed)) !== result.contentHash) return false;
    if (!record(persistedStage)
      || ![boundedOcrProfileIdV4, boundedOcrProfileIdV5].includes(
        persistedStage.provider_profile_id as typeof boundedOcrProfileIdV4)
      || persistedStage.content_hash !== result.ocrStageSha256) return false;
    const stage = stageContent(persistedStage, expectedManifestHash);
    if (!stage || !record(stage.analysis) || !Array.isArray(stage.analysis.sources)) return false;
    const proposals: Json[] = [];
    const abstentions: Json[] = [];
    const sourceIds = new Set<string>();
    let processed = 0;
    for (const rawSource of stage.analysis.sources) {
      if (!record(rawSource) || typeof rawSource.sourceFileId !== "string"
        || !rawSource.sourceFileId || sourceIds.has(rawSource.sourceFileId)
        || !hash(rawSource.sourceSha256) || !Array.isArray(rawSource.pages)
        || !count(rawSource.processedPageCount)
        || rawSource.processedPageCount !== rawSource.pages.length) return false;
      sourceIds.add(rawSource.sourceFileId);
      const pageNumbers = new Set<number>();
      for (const rawPage of rawSource.pages) {
        const page = verifiedPage(rawPage, rawSource.sourceFileId, rawSource.sourceSha256);
        if (!page || pageNumbers.has(page.pageNumber)) return false;
        pageNumbers.add(page.pageNumber);
        derivePage(page as Page, proposals, abstentions, rightCandidateLeftTolerancePx,
          result.schemaVersion === "ocr-table-row-proposals-v3");
        processed += 1;
      }
    }
    return processed === stage.analysis.processedPageCount
      && proposals.length === result.proposals.length
      && abstentions.length === result.abstentions.length
      && same(result.proposals, proposals) && same(result.abstentions, abstentions);
  } catch {
    return false;
  }
}
