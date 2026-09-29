import { canonicalJson, sha256 } from "./canonical-json.js";

export interface PilotCandidateSource {
  sourceFileId: string;
  sha256: string;
  name: string;
  stages: string[];
  review: {
    sourceSha256: string;
    revisionStatus: string;
    approvalStatus: string;
    linkGroupId: string | null;
    pageStages: Record<string, string>;
  } | null;
  textArtifact: Record<string, unknown> | null;
  textArtifactHash: string | null;
}

export interface VerifiedPilotCandidate {
  evidenceFingerprint: string;
  entityKey: string;
  expectedValue: string;
  actualValue: string;
  evidence: Array<{
    stage: "PD" | "RD";
    fileId: string;
    fileName: string;
    pdfPageNumber: number;
    documentSheetNumber: null;
    imageUrl: null;
    bbox: [number, number, number, number];
    sha256: string;
  }>;
}

type Rational = { numerator: bigint; denominator: bigint };
type LocatedFact = {
  role: "EXPECTED" | "ACTUAL";
  stage: "PD" | "RD";
  source: PilotCandidateSource;
  pageNumber: number;
  blockIndex: number | null;
  evidenceKind: "TEXT_LAYER" | "TABLE_ROW";
  tableRow: Record<"label" | "unit" | "value", { blockIndex: number; lineIndex: number; bboxMilliPoints: [number, number, number, number] }> | null;
  tableVisual: Record<string, unknown> | null;
  bboxMilliPoints: [number, number, number, number];
  pageWidth: number;
  pageHeight: number;
  rawValue: string;
  rawUnit: string;
  sourceUnit: string;
  normalized: Rational;
};

// Keep the independent server check narrow: qualified text blocks only.
// OCR findings require a separate render/line provenance verifier.
const AREA_LABEL_PATTERNS = [
  /(?<![\p{L}\p{N}_])общая[ \t]+площадь[ \t]+здания(?![\p{L}\p{N}_])[ \t\r\n:;=—–-]{0,24}(?<value>[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?)[ \t\r\n]*(?<unit>(?:мм|см|м|mm|cm|m)[²2]|кв\.?[ \t]*м\.?)(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])общая[ \t]+площадь[ \t]+здания(?![\p{L}\p{N}_])[ \t]*,[ \t]*в[ \t]+т\.?[ \t]*ч\.?:?[ \t\r\n]*(?<unit>(?:мм|см|м|mm|cm|m)[ \t]*[²2]|кв\.?[ \t]*м\.?)[ \t\r\n]{1,24}(?<value>[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?)(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])общая[ \t]+площадь[ \t]+здания(?![\p{L}\p{N}_])[ \t]+S[ \t]*=[ \t]*(?<value>[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?)[ \t\r\n]*(?<unit>(?:мм|см|м|mm|cm|m)[ \t]*[²2]|кв\.?[ \t]*м\.?)(?![\p{L}\p{N}_])/giu,
];
const AREA_FACTORS_MICRO: Record<string, bigint> = {
  m2: 1_000_000n, "m²": 1_000_000n, м2: 1_000_000n, "м²": 1_000_000n,
  "кв.м": 1_000_000n,
  cm2: 100n, "cm²": 100n, см2: 100n, "см²": 100n,
  mm2: 1n, "mm²": 1n, мм2: 1n, "мм²": 1n,
};
const TABLE_LABEL = /^общая\s+площадь\s+здания(?:\s*,\s*в\s+т\.?\s*ч\.?)?\s*:?$/iu;
const TABLE_UNIT = /^(?:мм|см|м|mm|cm|m)\s*[²2]$|^кв\.?\s*м\.?$/iu;
const TABLE_VALUE = /^[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?$/u;

function decimal(value: unknown): Rational | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(value);
  if (!match) return null;
  const fractional = match[2] ?? "";
  if (match[1].length + fractional.length > 60) return null;
  return {
    numerator: BigInt(match[1] + fractional),
    denominator: 10n ** BigInt(fractional.length),
  };
}

function area(value: string, unit: string): Rational | null {
  const factor = AREA_FACTORS_MICRO[unit.replace(/ /g, "").replace(/\u00a0/g, "").replace(/\.$/, "").toLowerCase()];
  const parsed = decimal(value.replace(/[ \u00a0]/g, ""));
  return parsed && factor !== undefined
    ? { numerator: parsed.numerator * factor, denominator: parsed.denominator }
    : null;
}

function equal(left: Rational, right: Rational): boolean {
  return left.numerator * right.denominator === right.numerator * left.denominator;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function box(value: unknown, width: number, height: number): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4
    && value.every((part) => Number.isSafeInteger(part) && part >= 0)
    && value[0] <= value[2] && value[1] <= value[3]
    && value[2] <= width && value[3] <= height;
}

function rowOverlap(left: [number, number, number, number], right: [number, number, number, number]): boolean {
  const overlap = Math.min(left[3], right[3]) - Math.max(left[1], right[1]);
  return overlap > 0 && overlap * 2 >= Math.min(left[3] - left[1], right[3] - right[1]);
}

function pixelBox(value: unknown, width: number, height: number): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4
    && value.every((part) => typeof part === "number" && Number.isFinite(part))
    && 0 <= value[0] && value[0] < value[2] && value[2] <= width
    && 0 <= value[1] && value[1] < value[3] && value[3] <= height;
}

function checkedTableRow(
  evidence: Record<string, unknown>, blocks: unknown[], width: number, height: number,
): { row: NonNullable<LocatedFact["tableRow"]>; bbox: [number, number, number, number]; value: string; unit: string } | null {
  if (!record(evidence.tableRow) || Object.keys(evidence.tableRow).sort().join(",") !== "label,unit,value") return null;
  const row = {} as NonNullable<LocatedFact["tableRow"]>;
  const texts = {} as Record<"label" | "unit" | "value", string>;
  for (const role of ["label", "unit", "value"] as const) {
    const locator = evidence.tableRow[role];
    if (!record(locator) || Object.keys(locator).sort().join(",") !== "bboxMilliPoints,blockIndex,lineIndex"
      || !Number.isSafeInteger(locator.blockIndex) || !Number.isSafeInteger(locator.lineIndex)) return null;
    const blockIndex = Number(locator.blockIndex);
    const lineIndex = Number(locator.lineIndex);
    if (blockIndex < 0 || blockIndex >= blocks.length || lineIndex < 0) return null;
    const block = blocks[blockIndex];
    if (!record(block) || typeof block.text !== "string" || !box(block.bboxMilliPoints, width, height)
      || !box(locator.bboxMilliPoints, width, height)) return null;
    const bbox = locator.bboxMilliPoints;
    const outer = block.bboxMilliPoints;
    if (!(outer[0] <= bbox[0] && bbox[2] <= outer[2] && outer[1] <= bbox[1] && bbox[3] <= outer[3])) return null;
    const lines = block.text.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean);
    if (lineIndex >= lines.length) return null;
    texts[role] = lines[lineIndex];
    row[role] = { blockIndex, lineIndex, bboxMilliPoints: bbox };
  }
  const labelBox = row.label.bboxMilliPoints;
  const unitBox = row.unit.bboxMilliPoints;
  const valueBox = row.value.bboxMilliPoints;
  if (!TABLE_LABEL.test(texts.label) || !TABLE_UNIT.test(texts.unit) || !TABLE_VALUE.test(texts.value)
    || !(labelBox[2] < unitBox[0] && unitBox[2] < valueBox[0])
    || !rowOverlap(labelBox, unitBox) || !rowOverlap(labelBox, valueBox)) return null;
  return {
    row, value: texts.value, unit: texts.unit,
    bbox: [Math.min(labelBox[0], unitBox[0], valueBox[0]), Math.min(labelBox[1], unitBox[1], valueBox[1]),
      Math.max(labelBox[2], unitBox[2], valueBox[2]), Math.max(labelBox[3], unitBox[3], valueBox[3])],
  };
}

function checkedTableVisual(
  evidence: Record<string, unknown>, analysis: Record<string, unknown>, source: PilotCandidateSource,
): Record<string, unknown> | null {
  if (!Array.isArray(analysis.tableOcrArtifacts) || !Array.isArray(analysis.tableCrosschecks)) return null;
  const matches = analysis.tableOcrArtifacts.filter((item) => record(item)
    && item.sourceFileId === source.sourceFileId && item.pageNumber === evidence.pageNumber);
  if (matches.length !== 1 || !record(matches[0])) return null;
  const ocr = matches[0];
  if (ocr.schemaVersion !== "document-ocr-page-v1" || ocr.inputSha256 !== source.sha256
    || !record(ocr.render) || typeof ocr.render.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(ocr.render.sha256)
    || !Number.isSafeInteger(ocr.render.widthPx) || !Number.isSafeInteger(ocr.render.heightPx)
    || Number(ocr.render.widthPx) < 1 || Number(ocr.render.heightPx) < 1
    || !Number.isSafeInteger(ocr.render.dpi) || Number(ocr.render.dpi) < 1
    || typeof ocr.render.rendererProfileId !== "string" || !ocr.render.rendererProfileId
    || !record(ocr.provider) || typeof ocr.provider.profileId !== "string" || !ocr.provider.profileId
    || !["eslav", "latin"].includes(String(ocr.provider.script))
    || !Array.isArray(ocr.lines) || ocr.lines.length > 5000) return null;
  const { contentHash, ...content } = ocr;
  if (typeof contentHash !== "string" || sha256(canonicalJson(content)) !== contentHash) return null;
  const lines: Array<{ text: string; score: number; bboxPx: [number, number, number, number] }> = [];
  for (const line of ocr.lines) {
    if (!record(line) || typeof line.text !== "string" || typeof line.score !== "number"
      || !Number.isFinite(line.score) || line.score < 0 || line.score > 1
      || !pixelBox(line.bboxPx, Number(ocr.render.widthPx), Number(ocr.render.heightPx))) return null;
    lines.push({ text: line.text, score: line.score, bboxPx: line.bboxPx });
  }
  const rawValue = evidence.rawValue;
  if (typeof rawValue !== "string") return null;
  const normalizedValue = rawValue.replace(/[ \u00a0]/gu, "").replace(",", ".");
  const labels = lines.flatMap((line, index) => /общая\s+площадь\s+здания/iu.test(line.text) ? [index] : []);
  const values = lines.flatMap((line, index) =>
    (line.text.match(/[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?/gu) ?? []).some(
      (part) => part.replace(/[ \u00a0]/gu, "").replace(",", ".") === normalizedValue,
    ) ? [index] : []);
  const pairs = labels.flatMap((labelIndex) => values.flatMap((valueIndex) => {
    if (labelIndex === valueIndex) return [[labelIndex, valueIndex]];
    const label = lines[labelIndex].bboxPx;
    const value = lines[valueIndex].bboxPx;
    return Math.min(label[3], value[3]) > Math.max(label[1], value[1]) && value[0] >= label[2]
      ? [[labelIndex, valueIndex]] : [];
  }));
  if (pairs.length !== 1) return null;
  const [labelLineIndex, valueLineIndex] = pairs[0];
  const minimumOcrScore = Math.min(lines[labelLineIndex].score, lines[valueLineIndex].score);
  if (minimumOcrScore < 0.8) return null;
  const result = {
    sourceFileId: source.sourceFileId, inputSha256: source.sha256,
    pageNumber: evidence.pageNumber, rawValue,
    ocrArtifactHash: contentHash, renderSha256: ocr.render.sha256,
    labelLineIndex, valueLineIndex, minimumOcrScore,
  };
  if (canonicalJson(evidence.tableVisual) !== canonicalJson(result)
    || !analysis.tableCrosschecks.some((item) => canonicalJson(item) === canonicalJson(result))) return null;
  return result;
}

export function verifyPilotPz002Candidate(
  analysis: Record<string, unknown>,
  objectId: string,
  sources: PilotCandidateSource[],
): VerifiedPilotCandidate | null {
  const evaluation = analysis.evaluation;
  if (!record(evaluation) || evaluation.machineStatus !== "CANDIDATE"
    || evaluation.reasonCode !== "THRESHOLD_EXCEEDED"
    || evaluation.entityKey !== "building-total"
    || evaluation.canonicalUnit !== "m2"
    || !Array.isArray(evaluation.evidence) || evaluation.evidence.length !== 2
    || !Array.isArray(analysis.ocrArtifacts) || analysis.ocrArtifacts.length !== 0
    || analysis.ocrRequiredPageCount !== 0 || analysis.ocrProcessedPageCount !== 0
    || sources.length < 2) return null;

  const facts: LocatedFact[] = [];
  const sourceIds = new Set<string>();
  const pages = new Map<string, { source: PilotCandidateSource; stage: "PD" | "RD"; page: Record<string, unknown>; width: number; height: number }>();
  const pendingTableLabels = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.sourceFileId) || !source.review
      || source.review.sourceSha256 !== source.sha256
      || source.review.revisionStatus !== "CURRENT"
      || source.review.approvalStatus !== "APPROVED"
      || !source.review.linkGroupId || !source.textArtifact || !source.textArtifactHash
      || sha256(canonicalJson(source.textArtifact)) !== source.textArtifactHash.trim()) return null;
    sourceIds.add(source.sourceFileId);
    const artifact = source.textArtifact;
    if (artifact.schemaVersion !== "document-text-v2"
      || artifact.sourceFileId !== source.sourceFileId
      || artifact.inputSha256 !== source.sha256
      || artifact.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
      || !Array.isArray(artifact.pages) || artifact.pageCount !== artifact.pages.length
      || !record(artifact.qualitySummary)
      || artifact.qualitySummary.ocrRequiredPageCount !== 0) return null;
    if (source.stages.length > 1) {
      const mapping = source.review.pageStages;
      if (Object.keys(mapping).length !== artifact.pageCount
        || Object.values(mapping).some((stage) => stage === "UNRESOLVED" || !source.stages.includes(stage))) return null;
    }
    for (let pageIndex = 0; pageIndex < artifact.pages.length; pageIndex += 1) {
      const page = artifact.pages[pageIndex];
      if (!record(page) || page.pageNumber !== pageIndex + 1
        || !record(page.quality) || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
        || !Number.isSafeInteger(page.widthMilliPoints) || !Number.isSafeInteger(page.heightMilliPoints)
        || !Array.isArray(page.blocks)) return null;
      const width = Number(page.widthMilliPoints);
      const height = Number(page.heightMilliPoints);
      const stage = source.stages.length === 1
        ? source.stages[0] : source.review.pageStages[String(pageIndex + 1)];
      if (stage === "ID") continue;
      if (stage !== "PD" && stage !== "RD") return null;
      if (!source.stages.includes(stage)) return null;
      pages.set(`${source.sourceFileId}:${pageIndex + 1}`, { source, stage, page, width, height });
      for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex += 1) {
        const block = page.blocks[blockIndex];
        if (!record(block) || typeof block.text !== "string"
          || !box(block.bboxMilliPoints, width, height)) return null;
        const blockText = block.text;
        const directMatches = AREA_LABEL_PATTERNS.flatMap((pattern) => [...blockText.matchAll(pattern)]);
        let lineStart = 0;
        let nonemptyLineIndex = 0;
        for (const part of blockText.split(/\r?\n/u)) {
          const line = part.trim();
          if (line) {
            if (TABLE_LABEL.test(line)
              && !directMatches.some((match) => match.index >= lineStart && match.index < lineStart + part.length)) {
              pendingTableLabels.add(`${source.sourceFileId}:${pageIndex + 1}:${blockIndex}:${nonemptyLineIndex}`);
            }
            nonemptyLineIndex += 1;
          }
          lineStart += part.length + 1;
        }
        for (const match of directMatches) {
          const rawValue = match.groups?.value;
          const rawUnit = match.groups?.unit;
          if (!rawValue || !rawUnit) return null;
          const sourceUnit = rawUnit.replace(/ /g, "").replace(/\.$/, "");
          const normalized = area(rawValue, sourceUnit);
          if (!normalized) return null;
          facts.push({
            role: stage === "PD" ? "EXPECTED" : "ACTUAL", stage, source,
            pageNumber: pageIndex + 1, blockIndex, evidenceKind: "TEXT_LAYER", tableRow: null,
            tableVisual: null,
            bboxMilliPoints: block.bboxMilliPoints, pageWidth: width, pageHeight: height,
            rawValue, rawUnit, sourceUnit, normalized,
          });
        }
      }
    }
  }
  for (const item of evaluation.evidence) {
    if (!record(item) || item.evidenceKind !== "TABLE_ROW") continue;
    const pageNumber = item.pageNumber;
    const sourceId = item.sourceFileId;
    if (typeof sourceId !== "string" || !Number.isSafeInteger(pageNumber)) return null;
    const located = pages.get(`${sourceId}:${pageNumber}`);
    if (!located || !Array.isArray(located.page.blocks)) return null;
    const checked = checkedTableRow(item, located.page.blocks, located.width, located.height);
    if (!checked || item.rawValue !== checked.value || item.rawUnit !== checked.unit
      || item.sourceUnit !== checked.unit.replace(/[ \u00a0]/gu, "").replace(/\.$/u, "")
      || canonicalJson(item.bboxMilliPoints) !== canonicalJson(checked.bbox)) return null;
    const labelKey = `${sourceId}:${pageNumber}:${checked.row.label.blockIndex}:${checked.row.label.lineIndex}`;
    if (!pendingTableLabels.delete(labelKey)) return null;
    const normalized = area(checked.value, checked.unit);
    if (!normalized) return null;
    const tableVisual = checkedTableVisual(item, analysis, located.source);
    if (!tableVisual) return null;
    facts.push({
      role: located.stage === "PD" ? "EXPECTED" : "ACTUAL", stage: located.stage,
      source: located.source, pageNumber: Number(pageNumber), blockIndex: null,
      evidenceKind: "TABLE_ROW", tableRow: checked.row, tableVisual,
      bboxMilliPoints: checked.bbox, pageWidth: located.width, pageHeight: located.height,
      rawValue: checked.value, rawUnit: checked.unit, sourceUnit: String(item.sourceUnit), normalized,
    });
  }
  if (pendingTableLabels.size > 0) return null;
  const expected = facts.filter((fact) => fact.role === "EXPECTED");
  const actual = facts.filter((fact) => fact.role === "ACTUAL");
  if (expected.length !== 1 || actual.length !== 1
    || expected[0].source.sourceFileId === actual[0].source.sourceFileId
    || expected[0].source.review?.linkGroupId !== actual[0].source.review?.linkGroupId
    || expected[0].normalized.numerator === 0n) return null;
  const numerator = actual[0].normalized.numerator * expected[0].normalized.denominator
    - expected[0].normalized.numerator * actual[0].normalized.denominator;
  const absolute = numerator < 0n ? -numerator : numerator;
  if (absolute * 100n <= expected[0].normalized.numerator * actual[0].normalized.denominator) return null;
  const suppliedExpected = area(String(evaluation.normalizedExpected), "m2");
  const suppliedActual = area(String(evaluation.normalizedActual), "m2");
  const suppliedDelta = decimal(evaluation.delta);
  if (!suppliedExpected || !suppliedActual
    || !suppliedDelta
    || !equal(suppliedExpected, expected[0].normalized)
    || !equal(suppliedActual, actual[0].normalized)) return null;
  const deltaDenominator = expected[0].normalized.numerator * actual[0].normalized.denominator;
  const deltaDifference = absolute * suppliedDelta.denominator
    - suppliedDelta.numerator * deltaDenominator;
  const absoluteDeltaDifference = deltaDifference < 0n ? -deltaDifference : deltaDifference;
  if (absoluteDeltaDifference * 1_000_000_000_000_000_000n
    > deltaDenominator * suppliedDelta.denominator) return null;

  const ordered = [expected[0], actual[0]];
  for (let index = 0; index < ordered.length; index += 1) {
    const fact = ordered[index];
    const evidence = evaluation.evidence[index];
    const normalized = area(record(evidence) ? String(evidence.normalizedValue) : "", "m2");
    if (!record(evidence) || !normalized || !equal(normalized, fact.normalized)
      || evidence.role !== fact.role || evidence.stage !== fact.stage
      || evidence.sourceFileId !== fact.source.sourceFileId
      || evidence.inputSha256 !== fact.source.sha256
      || evidence.pageNumber !== fact.pageNumber
      || evidence.evidenceKind !== fact.evidenceKind
      || evidence.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
      || (fact.evidenceKind === "TEXT_LAYER"
        ? evidence.blockIndex !== fact.blockIndex
        : canonicalJson(evidence.tableRow) !== canonicalJson(fact.tableRow)
          || canonicalJson(evidence.tableVisual) !== canonicalJson(fact.tableVisual))
      || canonicalJson(evidence.bboxMilliPoints) !== canonicalJson(fact.bboxMilliPoints)
      || evidence.rawValue !== fact.rawValue || evidence.rawUnit !== fact.rawUnit
      || evidence.sourceUnit !== fact.sourceUnit || evidence.canonicalUnit !== "m2") return null;
  }
  const fingerprint = sha256(canonicalJson({
    ruleId: "pilot-pz-002-area", ruleVersion: "1", parameterCode: "PZ-002",
    objectId, entityKey: "building-total", evidence: evaluation.evidence,
  }));
  if (evaluation.evidenceFingerprint !== fingerprint) return null;
  return {
    evidenceFingerprint: fingerprint,
    entityKey: "building-total",
    expectedValue: `${evaluation.normalizedExpected} м²`,
    actualValue: `${evaluation.normalizedActual} м²`,
    evidence: ordered.map((fact) => ({
      stage: fact.stage,
      fileId: fact.source.sourceFileId,
      fileName: fact.source.name,
      pdfPageNumber: fact.pageNumber,
      documentSheetNumber: null,
      imageUrl: null,
      bbox: [
        fact.bboxMilliPoints[0] / fact.pageWidth,
        (fact.pageHeight - fact.bboxMilliPoints[3]) / fact.pageHeight,
        fact.bboxMilliPoints[2] / fact.pageWidth,
        (fact.pageHeight - fact.bboxMilliPoints[1]) / fact.pageHeight,
      ],
      sha256: fact.source.sha256,
    })),
  };
}
