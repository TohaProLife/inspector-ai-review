import { sha256 } from "./canonical-json.js";
import { inspectPdfPageWordsWithPoppler,
  type IndependentPdfPageWords } from "./poppler-page-words.js";
import { pythonCanonicalJson, pythonHash, verifyTrustedPageWords,
  type PdfWord, type TrustedPageWords } from "./trusted-page-words.js";

type Json = Record<string, unknown>;
type Locator = { wordIndex: number; text: string; textSha256: string;
  bboxMilliPoints: [number, number, number, number] };
const SCHEMA = "pz006-building-levels-proposals-v1";
const PROFILE = "pz006-building-levels-review-v1";
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_WORDS = 20_000;
const MAX_PROPOSALS = 24;
const MAX_WORDS_PER_PROPOSAL = 64;
const MAX_RESULT_BYTES = 256 * 1024;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const safe = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const equal = (left: unknown, right: unknown): boolean =>
  pythonCanonicalJson(left) === pythonCanonicalJson(right);
const joined = (words: Locator[]): string => words.map((word) => word.text).join(" ");
const center = (word: Locator): number =>
  (word.bboxMilliPoints[1] + word.bboxMilliPoints[3]) / 2;
const corpus = /(?:^|[^\p{L}\p{N}_])корпус\s+(\p{Decimal_Number}{1,3})(?!\p{Decimal_Number})/iu;
const number = /\p{Decimal_Number}[\p{Decimal_Number}\s]*[,\.]?\p{Decimal_Number}*/u;
const floorInteger = /^\p{Decimal_Number}{1,3}$/u;

function makeProposal(kind: string, line: Locator[], width: number,
  corpusLabel: string | null): Json {
  const label = line.filter((word) => Math.trunc(width * .10) <= word.bboxMilliPoints[0]
    && word.bboxMilliPoints[0] < Math.trunc(width * .66));
  const unit = line.filter((word) => Math.trunc(width * .66) <= word.bboxMilliPoints[0]
    && word.bboxMilliPoints[0] < Math.trunc(width * .78));
  const value = line.filter((word) => word.bboxMilliPoints[0] >= Math.trunc(width * .78));
  const rawUnit = joined(unit) || null;
  const rawValue = joined(value) || null;
  const reasons = ["ROW_ASSOCIATION_UNVERIFIED", "TABLE_CELL_BOUNDARIES_UNVERIFIED"];
  if (kind === "FLOOR_COUNT_HEADER" || kind === "FLOOR_COUNT_CONTINUATION") {
    reasons.push("COMPOSITE_FLOOR_COUNT_UNRESOLVED");
  }
  if (kind === "CORPUS_FLOOR_COUNT" && rawUnit
    && !["эт", "этаж", "этажей"].includes(rawUnit.replace(/^[ .]+|[ .]+$/gu, "").toLowerCase())) {
    reasons.push("FLOOR_ROW_UNIT_CONFLICT");
  }
  if (kind === "VOLUME_TOTAL" && rawUnit?.toLowerCase().includes("кв")) {
    reasons.push("VOLUME_UNIT_CONFLICT");
  }
  if (rawValue === null || !number.test(rawValue)) reasons.push("VALUE_CELL_UNRESOLVED");
  if (kind === "CORPUS_FLOOR_COUNT" && rawValue && !floorInteger.test(rawValue)) {
    reasons.push("MULTIPLE_VALUE_CELLS_AMBIGUOUS");
  }
  const body = { proposalKind: kind, corpusLabelRaw: corpusLabel,
    rawLabel: joined(label) || null, rawUnit, rawValue,
    rowAssociationStatus: "UNVERIFIED", corpusAssociationStatus: "UNVERIFIED",
    unitStatus: "UNVERIFIED", typedFact: null, reasonCodes: reasons.sort(),
    wordLocators: line };
  return { ...body, proposalSha256: pythonHash(body) };
}

function replay(words: PdfWord[], width: number): {
  proposals: Json[]; count: number; oversize: number; reasons: string[];
  layoutHash: string;
} {
  const locators: Locator[] = words.map((word) => ({
    wordIndex: word.wordIndex, text: word.rawText,
    textSha256: word.wordTextSha256,
    bboxMilliPoints: word.bboxMilliPointsTopLeft,
  }));
  const ordered = [...locators].sort((left, right) =>
    center(left) - center(right) || left.bboxMilliPoints[0] - right.bboxMilliPoints[0]);
  const groups: Locator[][] = [];
  const centers: number[] = [];
  for (const word of ordered) {
    const y = center(word);
    if (!groups.length || Math.abs(y - centers[centers.length - 1]) > 5800) {
      groups.push([word]); centers.push(y);
    } else {
      const group = groups[groups.length - 1];
      group.push(word);
      centers[centers.length - 1] = group.reduce((sum, item) => sum + center(item), 0)
        / group.length;
    }
  }
  const proposals: Json[] = [];
  let oversize = 0;
  let floorHeaderY: number | null = null;
  let volumeTotalY: number | null = null;
  for (const [index, group] of groups.entries()) {
    const line = group.sort((left, right) => left.bboxMilliPoints[0] - right.bboxMilliPoints[0]
      || left.wordIndex - right.wordIndex);
    const y = centers[index];
    const lower = joined(line).toLowerCase();
    let kind: string | null = null;
    let corpusLabel: string | null = null;
    if (lower.includes("количество этажей")) {
      kind = "FLOOR_COUNT_HEADER"; floorHeaderY = y;
    } else {
      const match = corpus.exec(lower);
      if (match && floorHeaderY !== null && y - floorHeaderY > 0
        && y - floorHeaderY < 45_000) {
        kind = "CORPUS_FLOOR_COUNT"; corpusLabel = match[1];
      } else if (lower.includes("строительный объем") || lower.includes("строительный объём")) {
        kind = "VOLUME_TOTAL"; volumeTotalY = y;
      } else if (lower.includes("подземная часть") && volumeTotalY !== null
        && y - volumeTotalY > 0 && y - volumeTotalY < 50_000) {
        kind = "VOLUME_UNDERGROUND_PART";
      } else if (lower.includes("наземная часть") && volumeTotalY !== null
        && y - volumeTotalY > 0 && y - volumeTotalY < 50_000) {
        kind = "VOLUME_ABOVEGROUND_PART";
      } else if (lower.includes("подз") && floorHeaderY !== null
        && y - floorHeaderY > 0 && y - floorHeaderY < 20_000
        && line.some((word) => word.bboxMilliPoints[0] >= Math.trunc(width * .78))) {
        kind = "FLOOR_COUNT_CONTINUATION";
      }
    }
    if (kind === null) continue;
    if (line.length > MAX_WORDS_PER_PROPOSAL) { oversize += 1; continue; }
    proposals.push(makeProposal(kind, line, width, corpusLabel));
  }
  const count = proposals.length;
  const total = proposals.find((item) => item.proposalKind === "VOLUME_TOTAL");
  const parts = proposals.filter((item) =>
    item.proposalKind === "VOLUME_UNDERGROUND_PART"
    || item.proposalKind === "VOLUME_ABOVEGROUND_PART");
  if (total && parts.length && total.rawUnit && parts.some((part) =>
    part.rawUnit && part.rawUnit !== total.rawUnit)) {
    for (const item of [total, ...parts]) {
      item.reasonCodes = [...new Set([...(item.reasonCodes as string[]),
        "TOTAL_VS_PART_UNIT_CONFLICT"])].sort();
      const { proposalSha256: _old, ...body } = item;
      item.proposalSha256 = pythonHash(body);
    }
  }
  const reasons = new Set(["REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_APPROVAL_UNVERIFIED",
    "PD_RD_PAIR_UNVERIFIED", "PZ006_CATALOG_TITLE_TRIGGER_CONFLICT",
    "ROW_ASSOCIATION_UNVERIFIED"]);
  if (!count) reasons.add("NO_SAFE_PROPOSAL_IN_SCANNED_TEXT");
  if (count > MAX_PROPOSALS) reasons.add("PROPOSAL_LIMIT_REACHED");
  if (oversize) reasons.add("OVERSIZE_LINE_DEFERRED");
  if (total && (total.reasonCodes as string[]).includes("VOLUME_UNIT_CONFLICT")) {
    reasons.add("VOLUME_UNIT_CONFLICT");
  }
  if (proposals.some((item) => (item.reasonCodes as string[])
    .includes("TOTAL_VS_PART_UNIT_CONFLICT"))) reasons.add("TOTAL_VS_PART_UNIT_CONFLICT");
  return { proposals, count, oversize, reasons: [...reasons].sort(),
    layoutHash: pythonHash(locators) };
}

export interface Pz006BuildingLevelsVerificationInput {
  originalPdfBytes: Buffer;
  publicSource: { file_id: string; object_id: string; split: string;
    distribution_status: string; label_visibility: string; sha256: string;
    size_bytes: number; pdf_pages: number; stage: string; section: string };
  trustedPage: TrustedPageWords;
  result: unknown;
}

/**
 * Replays worker navigation from a complete API-owned PDF word artifact.
 * Callers must obtain trustedPage from the independent provider reading these
 * original bytes; worker-supplied word lists are never independent evidence.
 */
export function verifyPz006BuildingLevelsProposals(
  input: Pz006BuildingLevelsVerificationInput,
): boolean {
  try {
    const source = input.publicSource;
    if (!Buffer.isBuffer(input.originalPdfBytes)
      || input.originalPdfBytes.length < 1 || input.originalPdfBytes.length > MAX_PDF_BYTES
      || !record(source) || source.file_id !== "F0101"
      || source.split !== "TRAIN_PUBLIC" || source.distribution_status !== "INCLUDE"
      || source.label_visibility !== "PUBLIC_TRAIN"
      || typeof source.object_id !== "string" || !source.object_id
      || !hash(source.sha256) || sha256(input.originalPdfBytes) !== source.sha256
      || !safe(source.size_bytes, 1) || input.originalPdfBytes.length !== source.size_bytes
      || !safe(source.pdf_pages, 1) || typeof source.stage !== "string"
      || typeof source.section !== "string" || !record(input.trustedPage)
      || !record(input.result)) return false;
    const page = input.trustedPage;
    const result = input.result;
    if (!verifyTrustedPageWords(input.originalPdfBytes, source.sha256, source.pdf_pages, page)
      || page.words.length < 1 || page.words.length > MAX_WORDS
      || !safe(result.pageNumber, 1) || result.pageNumber !== page.pageNumber) return false;
    const local = replay(page.words, page.pageWidthMilliPoints);
    const body = { schemaVersion: SCHEMA, profileId: PROFILE,
      purpose: "REVIEW_ONLY", parameterCode: "PZ-006",
      sourceFileId: source.file_id, objectId: source.object_id,
      sourceSha256: source.sha256, sourceStageFromManifest: source.stage,
      sourceSectionFromManifest: source.section, sourceApprovalStatus: "UNVERIFIED",
      pageNumber: page.pageNumber, pageWidthMilliPoints: page.pageWidthMilliPoints,
      pageHeightMilliPoints: page.pageHeightMilliPoints,
      wordLayoutSha256: local.layoutHash, wordCount: page.words.length,
      status: "ABSTAIN", reasonCodes: local.reasons,
      proposalCount: local.count, oversizeLineCount: local.oversize,
      truncatedProposalCount: Math.max(0, local.count - MAX_PROPOSALS),
      proposals: local.proposals.slice(0, MAX_PROPOSALS),
      rowAssociationStatus: "UNVERIFIED", typedFact: null,
      findingCount: null, parameterCoverage: null };
    const expected = { ...body, contentHash: pythonHash(body) };
    return equal(result, expected)
      && Buffer.byteLength(pythonCanonicalJson(result)) <= MAX_RESULT_BYTES;
  } catch {
    return false;
  }
}

export type Pz006WordBijection = {
  equivalent: boolean;
  reason: "FULL_UNIQUE_WORD_BIJECTION_MATCH" | "SOURCE_OR_SCOPE_MISMATCH"
    | "WORD_COUNT_MISMATCH" | "WORD_TEXT_OR_BOX_UNMATCHED"
    | "AMBIGUOUS_WORD_MATCH" | "PAGE_TEXT_MISMATCH";
  workerWordCount: number;
  independentWordCount: number;
};

const normalizedPageText = (value: string): string => value.replace(/\s+/gu, " ").trim();

/**
 * Full-page multiset equivalence where every word has exactly one independent
 * text-and-box match. Poppler need not enumerate words in PyMuPDF order.
 * This validates word presence and geometry, not PyMuPDF's raw wordIndex order.
 */
export function comparePz006CompleteWordBijection(
  worker: TrustedPageWords,
  independent: IndependentPdfPageWords,
): Pz006WordBijection {
  const result = (reason: Pz006WordBijection["reason"]): Pz006WordBijection => ({
    equivalent: reason === "FULL_UNIQUE_WORD_BIJECTION_MATCH", reason,
    workerWordCount: Array.isArray(worker?.words) ? worker.words.length : 0,
    independentWordCount: Array.isArray(independent?.words) ? independent.words.length : 0,
  });
  if (!record(worker) || !record(independent)
    || worker.providerId !== "api-independent-pdf-words-v1"
    || !/^api-poppler-pdftotext-bbox-layout-v1@\d+\.\d+\.\d+$/u.test(independent.providerId)
    || worker.sourceSha256 !== independent.sourceSha256
    || worker.pdfPageCount !== independent.pdfPageCount
    || worker.pageNumber !== independent.pageNumber
    || worker.pageWidthMilliPoints !== independent.pageWidthMilliPoints
    || worker.pageHeightMilliPoints !== independent.pageHeightMilliPoints
    || !Array.isArray(worker.words) || !Array.isArray(independent.words)
    || !hash(worker.inspectionSha256)
    || !hash(independent.xmlSha256) || !hash(independent.plainTextSha256)
    || !hash(independent.inspectionSha256)) return result("SOURCE_OR_SCOPE_MISMATCH");
  const { inspectionSha256: _workerDigest, ...workerBody } = worker;
  if (pythonHash(workerBody) !== worker.inspectionSha256) {
    return result("SOURCE_OR_SCOPE_MISMATCH");
  }
  const { inspectionSha256: _digest, ...receiptBody } = independent;
  if (pythonHash(receiptBody) !== independent.inspectionSha256) {
    return result("SOURCE_OR_SCOPE_MISMATCH");
  }
  if (!worker.words.length || worker.words.length > 5000
    || worker.words.length !== independent.words.length) return result("WORD_COUNT_MISMATCH");
  const byText = new Map<string, typeof independent.words>();
  for (const [index, word] of independent.words.entries()) {
    if (word.wordIndex !== index || typeof word.rawText !== "string" || !word.rawText
      || !Array.isArray(word.bboxMilliPointsTopLeft)
      || word.bboxMilliPointsTopLeft.length !== 4
      || !word.bboxMilliPointsTopLeft.every((value) => safe(value))
      || word.bboxMilliPointsTopLeft[0] > word.bboxMilliPointsTopLeft[2]
      || word.bboxMilliPointsTopLeft[2] > independent.pageWidthMilliPoints
      || word.bboxMilliPointsTopLeft[1] > word.bboxMilliPointsTopLeft[3]
      || word.bboxMilliPointsTopLeft[3] > independent.pageHeightMilliPoints) {
      return result("SOURCE_OR_SCOPE_MISMATCH");
    }
    const candidates = byText.get(word.rawText) ?? [];
    candidates.push(word);
    byText.set(word.rawText, candidates);
  }
  const used = new Set<number>();
  for (const [index, word] of worker.words.entries()) {
    if (word.wordIndex !== index || word.pageNumber !== worker.pageNumber
      || sha256(word.rawText) !== word.wordTextSha256
      || !Array.isArray(word.bboxMilliPointsTopLeft)
      || word.bboxMilliPointsTopLeft.length !== 4
      || !word.bboxMilliPointsTopLeft.every((value) => safe(value))
      || word.bboxMilliPointsTopLeft[0] > word.bboxMilliPointsTopLeft[2]
      || word.bboxMilliPointsTopLeft[2] > worker.pageWidthMilliPoints
      || word.bboxMilliPointsTopLeft[1] > word.bboxMilliPointsTopLeft[3]
      || word.bboxMilliPointsTopLeft[3] > worker.pageHeightMilliPoints) {
      return result("SOURCE_OR_SCOPE_MISMATCH");
    }
    const matches = (byText.get(word.rawText) ?? []).filter((candidate) =>
      word.bboxMilliPointsTopLeft.every((value, corner) =>
        Math.abs(value - candidate.bboxMilliPointsTopLeft[corner]) <= 100));
    if (!matches.length) return result("WORD_TEXT_OR_BOX_UNMATCHED");
    if (matches.length !== 1 || used.has(matches[0].wordIndex)) {
      return result("AMBIGUOUS_WORD_MATCH");
    }
    used.add(matches[0].wordIndex);
  }
  if (used.size !== independent.words.length) return result("WORD_TEXT_OR_BOX_UNMATCHED");
  if (typeof worker.pageText !== "string" || typeof independent.pageText !== "string"
    || normalizedPageText(worker.pageText) !== normalizedPageText(independent.pageText)) {
    return result("PAGE_TEXT_MISMATCH");
  }
  return result("FULL_UNIQUE_WORD_BIJECTION_MATCH");
}

export type Pz006OriginalVerification = {
  verified: boolean;
  reason: "VERIFIED_REVIEW_ONLY" | "INDEPENDENT_WORDS_UNAVAILABLE"
    | "FULL_WORD_BIJECTION_FAILED" | "WORKER_RESULT_REPLAY_FAILED";
  wordBijection?: Pz006WordBijection;
};

/**
 * Standalone review gate. It obtains Poppler words from original bytes itself,
 * then replays the Python worker result using separately supplied full words.
 * No durable release, save, seal, GET or UI path calls this function.
 */
export async function verifyPz006BuildingLevelsAgainstOriginalPdf(
  input: Pz006BuildingLevelsVerificationInput,
): Promise<Pz006OriginalVerification> {
  let independent: IndependentPdfPageWords;
  try {
    independent = await inspectPdfPageWordsWithPoppler({
      originalPdfBytes: input.originalPdfBytes,
      expectedSourceSha256: input.publicSource.sha256,
      expectedPdfPageCount: input.publicSource.pdf_pages,
      pageNumber: input.trustedPage.pageNumber,
    });
  } catch {
    return { verified: false, reason: "INDEPENDENT_WORDS_UNAVAILABLE" };
  }
  const wordBijection = comparePz006CompleteWordBijection(input.trustedPage, independent);
  if (!wordBijection.equivalent) {
    return { verified: false, reason: "FULL_WORD_BIJECTION_FAILED", wordBijection };
  }
  if (!verifyPz006BuildingLevelsProposals(input)) {
    return { verified: false, reason: "WORKER_RESULT_REPLAY_FAILED", wordBijection };
  }
  return { verified: true, reason: "VERIFIED_REVIEW_ONLY", wordBijection };
}
