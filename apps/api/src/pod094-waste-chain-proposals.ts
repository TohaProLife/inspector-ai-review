import { sha256 } from "./canonical-json.js";
import { inspectPdfPageWordsWithPoppler,
  type IndependentPdfPageWords } from "./poppler-page-words.js";
import { comparePz006CompleteWordBijection,
  type Pz006WordBijection } from "./pz006-building-levels-proposals.js";
import { pythonCanonicalJson, pythonHash, verifyTrustedPageWords,
  type PdfWord, type TrustedPageWords } from "./trusted-page-words.js";

type Json = Record<string, unknown>;
type Source = { file_id: string; object_id: string; split: string;
  distribution_status: string; label_visibility: string; sha256: string;
  size_bytes: number; pdf_pages: number; stage: string; section: string };
type Audited = { sha: string; pages: number; scanned: number[];
  object: string; stage: string; section: string };
const AUDITED: Record<string, Audited> = {
  F0189: { sha: "eae7d1997b49d2302d20d66483f9490ca3fb5e2bb7b465329d9518563e95c7cd",
    pages: 969, scanned: [99, 100], object: "OBJ-TYUMENSKAYA-5-GOLD-SEED",
    stage: "PD", section: "OTHER" },
  F0071: { sha: "a314d845fcb58fc6ac1502fc1fb1672562f419ed36cc8ead88327d374817d327",
    pages: 32, scanned: [5], object: "OBJ-NOVOSLOBODSKAYA",
    stage: "ID", section: "OTHER" },
};
const SCHEMA = "pod094-waste-chain-proposals-v1";
const PROFILE = "pod094-waste-chain-public-review-v1";
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_RESULT_BYTES = 256 * 1024;
const number = /^\d+[,.]\d+$/u;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (a: unknown, b: unknown): boolean =>
  pythonCanonicalJson(a) === pythonCanonicalJson(b);
const text = (words: PdfWord[]): string => words.map((word) => word.rawText).join(" ");
const line = (words: PdfWord[], anchor: PdfWord, tolerance = 3000): PdfWord[] =>
  words.filter((word) => Math.abs(word.bboxMilliPointsTopLeft[1]
    - anchor.bboxMilliPointsTopLeft[1]) <= tolerance);
const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

function proposal(kind: string, roles: Record<string, PdfWord[]>, reasons: string[]): Json {
  const raw = (name: string): string | null => text(roles[name] ?? []) || null;
  const quantityRaw = raw("quantity");
  const slots = { estimate: kind === "PROJECT_ESTIMATE_CANDIDATE" ? quantityRaw : null,
    contractLimit: null,
    contractOrientative: kind === "CONTRACT_ORIENTATIVE_CANDIDATE" ? quantityRaw : null,
    actualTransfer: null };
  const body = { proposalKind: kind, quantityCategory: kind,
    materialRaw: raw("material"), fkkoRaw: raw("fkko"),
    hazardClassRaw: raw("hazardClass"), quantityRaw,
    unitRaw: raw("unit"), quantitySlots: slots,
    rowAssociationStatus: "UNVERIFIED", materialAssociationStatus: "UNVERIFIED",
    fkkoAssociationStatus: "UNVERIFIED", unitStatus: "UNVERIFIED",
    batchIdentity: null, transferDate: null, talonId: null,
    receivingPartyVerification: null, typedValues: null,
    reasonCodes: sortedUnique([...reasons, "REVIEW_ONLY_NOT_TYPED_FACT",
      "ROW_ASSOCIATION_UNVERIFIED", "SOURCE_ROLE_UNVERIFIED"]), roles };
  return { ...body, proposalSha256: pythonHash(body) };
}

export function replayPod094EstimateCandidates(words: PdfWord[]): { proposals: Json[]; reasons: string[] } {
  const starts = words.flatMap((word, index) =>
    (["Отходы", "Лом"].includes(word.rawText)
      && ["Отходы (мусор) от", "Лом и отходы,"].some((prefix) =>
        text(words.slice(index, index + 4)).startsWith(prefix))) ? [index] : []);
  const reasons = ["LOWER_TABLE_ROWS_DEFERRED_AMBIGUOUS_CLASS_AND_UNITS"];
  if (starts.length !== 2 || starts[0] >= starts[1]) {
    return { proposals: [], reasons: [...reasons, "ESTIMATE_PARAGRAPH_BOUNDARIES_AMBIGUOUS"] };
  }
  const proposals: Json[] = [];
  for (const [index, start] of starts.entries()) {
    const finish = starts[index + 1] ??
      (words.findIndex((word, position) => position > start && word.rawText === "Отдельно") >= 0
        ? words.findIndex((word, position) => position > start && word.rawText === "Отдельно")
        : words.length);
    const chunk = words.slice(start, finish);
    const fkko = chunk.findIndex((word) => word.rawText === "ФККО");
    const mass = chunk.findIndex((word, position) => word.rawText === "Общей"
      && chunk[position + 1]?.rawText === "массой");
    if (fkko < 0 || mass < 0 || fkko >= mass) {
      reasons.push("ESTIMATE_FIELDS_AMBIGUOUS"); continue;
    }
    const codeTail = line(chunk, chunk[fkko])
      .filter((word) => word.wordIndex > chunk[fkko].wordIndex);
    const classStart = codeTail.findIndex((word) => word.rawText.startsWith("("));
    const massLine = line(chunk, chunk[mass]);
    const equals = massLine.flatMap((word, position) => word.rawText === "=" ? [position] : []);
    if (classStart <= 0 || equals.length !== 1 || equals[0] + 2 >= massLine.length
      || !number.test(massLine[equals[0] + 1].rawText)
      || !massLine[equals[0] + 2].rawText.startsWith("тонн")) {
      reasons.push("ESTIMATE_QUANTITY_OR_CLASS_AMBIGUOUS"); continue;
    }
    const materialEnd = chunk.findIndex((word) => word.rawText === "код");
    if (materialEnd < 0) return { proposals: [], reasons: [...reasons, "ESTIMATE_FIELDS_AMBIGUOUS"] };
    const roles = { material: chunk.slice(0, materialEnd),
      fkko: codeTail.slice(0, classStart), hazardClass: codeTail.slice(classStart),
      quantity: [massLine[equals[0] + 1]], unit: [massLine[equals[0] + 2]],
      quantityContext: massLine };
    proposals.push(proposal("PROJECT_ESTIMATE_CANDIDATE", roles,
      ["CALCULATION_NOT_ACTUAL_TRANSFER", "ESTIMATE_FORMULA_REQUIRES_REVIEW"]));
  }
  return { proposals, reasons };
}

export function replayPod094ContractCandidates(words: PdfWord[]): { proposals: Json[]; reasons: string[] } {
  const heading = words.filter((word) => word.rawText === "Ориентировочный");
  const materialStart = words.filter((word) => word.rawText === "Лом"
    && word.bboxMilliPointsTopLeft[1] >= 560000
    && word.bboxMilliPointsTopLeft[1] <= 620000);
  if (heading.length !== 1 || materialStart.length !== 1) {
    return { proposals: [], reasons: ["CONTRACT_TABLE_HEADING_OR_ROW_AMBIGUOUS"] };
  }
  const row = words.filter((word) => word.bboxMilliPointsTopLeft[1] >= 560000
    && word.bboxMilliPointsTopLeft[1] <= 617000);
  const material = row.filter((word) => word.bboxMilliPointsTopLeft[0] >= 90000
    && word.bboxMilliPointsTopLeft[0] < 225000);
  const classes = row.filter((word) => word.bboxMilliPointsTopLeft[0] >= 225000
    && word.bboxMilliPointsTopLeft[0] < 285000
    && ["I", "II", "III", "IV", "V"].includes(word.rawText.toUpperCase()));
  const fkko = row.filter((word) => word.bboxMilliPointsTopLeft[0] >= 285000
    && word.bboxMilliPointsTopLeft[0] < 385000 && /^\d+$/u.test(word.rawText));
  const mass = row.filter((word) => word.bboxMilliPointsTopLeft[0] >= 385000
    && word.bboxMilliPointsTopLeft[0] < 490000 && number.test(word.rawText));
  const tonne = words.filter((word) => word.rawText === "(тонн)"
    && Math.abs(word.bboxMilliPointsTopLeft[1]
      - heading[0].bboxMilliPointsTopLeft[1]) <= 40000);
  const price = row.filter((word) => word.bboxMilliPointsTopLeft[0] >= 490000
    && number.test(word.rawText));
  if (material.length < 3 || classes.length !== 1 || fkko.length !== 6
    || mass.length !== 1 || tonne.length !== 1 || price.length !== 1) {
    return { proposals: [], reasons: ["CONTRACT_ROW_OR_UNIT_AMBIGUOUS"] };
  }
  const roles = { material, fkko, hazardClass: classes, quantity: mass, unit: tonne,
    contractQuantityHeading: heading, excludedPriceCell: price };
  return { proposals: [proposal("CONTRACT_ORIENTATIVE_CANDIDATE", roles,
    ["ORIENTATIVE_QUANTITY_NOT_BINDING_LIMIT", "CONTRACT_NOT_ACTUAL_TRANSFER",
      "PRICE_CELL_EXCLUDED_FROM_QUANTITY"])], reasons: [] };
}

export interface Pod094WasteChainVerificationInput {
  originalPdfBytes: Buffer;
  publicSource: Source;
  trustedPages: TrustedPageWords[];
  result: unknown;
}

/** Pure replay. trustedPages are complete PyMuPDF-order page artifacts; caller must
 * separately establish their independence against original bytes. */
export function verifyPod094WasteChainProposals(input: Pod094WasteChainVerificationInput): boolean {
  try {
    const { originalPdfBytes: bytes, publicSource: source, trustedPages, result } = input;
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_PDF_BYTES
      || !record(source) || !record(result) || !Array.isArray(trustedPages)) return false;
    const audit = AUDITED[source.file_id];
    if (!audit || source.split !== "TRAIN_PUBLIC" || source.distribution_status !== "INCLUDE"
      || source.label_visibility !== "PUBLIC_TRAIN" || source.sha256 !== audit.sha
      || source.pdf_pages !== audit.pages || source.object_id !== audit.object
      || source.stage !== audit.stage || source.section !== audit.section
      || source.size_bytes !== bytes.length || sha256(bytes) !== audit.sha
      || trustedPages.length !== audit.scanned.length) return false;
    const pageMap = new Map<number, TrustedPageWords>();
    for (const page of trustedPages) {
      if (!verifyTrustedPageWords(bytes, audit.sha, audit.pages, page)
        || page.words.length > 5000 || pageMap.has(page.pageNumber)) return false;
      pageMap.set(page.pageNumber, page);
    }
    if (audit.scanned.some((page) => !pageMap.has(page))) return false;
    let replayed: { proposals: Json[]; reasons: string[] };
    if (source.file_id === "F0189") {
      const context = text(pageMap.get(99)!.words);
      replayed = context.includes("Расчет отходов строительства")
        ? replayPod094EstimateCandidates(pageMap.get(100)!.words)
        : { proposals: [], reasons: ["ESTIMATE_SECTION_CONTEXT_AMBIGUOUS"] };
    } else replayed = replayPod094ContractCandidates(pageMap.get(5)!.words);
    const reasons = [...replayed.reasons, "NO_APPROVED_POD_PPR_SOURCE_ROLE",
      "NO_VERIFIED_BATCH_LINK", "NO_ACTUAL_TRANSFER_PROOF_FROM_SCANNED_PAGES"];
    if (!replayed.proposals.length) reasons.push("NO_SAFE_PROPOSAL_IN_SCANNED_PAGES");
    const body = { schemaVersion: SCHEMA, profileId: PROFILE, purpose: "REVIEW_ONLY",
      parameterCode: "POD-094", sourceFileId: source.file_id, objectId: audit.object,
      sourceSha256: audit.sha, sourceStageFromManifest: audit.stage,
      sourceSectionFromManifest: audit.section, sourceApprovalStatus: "UNVERIFIED",
      scannedPages: audit.scanned.map((pageNumber) => ({ pageNumber,
        wordCount: pageMap.get(pageNumber)!.words.length,
        wordLayoutSha256: pythonHash(pageMap.get(pageNumber)!.words) })),
      status: "ABSTAIN", reasonCodes: sortedUnique(reasons),
      proposalCount: replayed.proposals.length, proposals: replayed.proposals,
      documentAssociationStatus: "SOURCE_LOCAL_ONLY", contractLimit: null,
      actualTransfer: null, typedFact: null, findingCount: null,
      parameterCoverage: null };
    const expected = { ...body, contentHash: pythonHash(body) };
    return equal(result, expected)
      && Buffer.byteLength(JSON.stringify(result)) <= MAX_RESULT_BYTES;
  } catch { return false; }
}

export type Pod094OriginalVerification = { verified: boolean;
  reason: "VERIFIED_REVIEW_ONLY" | "INDEPENDENT_WORDS_UNAVAILABLE"
    | "FULL_WORD_BIJECTION_FAILED" | "WORKER_RESULT_REPLAY_FAILED";
  pageComparisons?: Array<{ pageNumber: number; comparison: Pz006WordBijection }> };

/** Poppler checks every word on every scanned page, then deterministic replay.
 * Bijection does not prove PyMuPDF index order. No durable consumer uses this. */
export async function verifyPod094WasteChainAgainstOriginalPdf(
  input: Pod094WasteChainVerificationInput,
): Promise<Pod094OriginalVerification> {
  const audit = AUDITED[input.publicSource?.file_id];
  if (!audit || !Array.isArray(input.trustedPages)
    || input.trustedPages.length !== audit.scanned.length) {
    return { verified: false, reason: "WORKER_RESULT_REPLAY_FAILED" };
  }
  const pageComparisons: NonNullable<Pod094OriginalVerification["pageComparisons"]> = [];
  for (const pageNumber of audit.scanned) {
    const worker = input.trustedPages.find((page) => page?.pageNumber === pageNumber);
    if (!worker || !verifyTrustedPageWords(input.originalPdfBytes, audit.sha,
      audit.pages, worker)) return { verified: false, reason: "WORKER_RESULT_REPLAY_FAILED" };
    let independent: IndependentPdfPageWords;
    try {
      independent = await inspectPdfPageWordsWithPoppler({
        originalPdfBytes: input.originalPdfBytes, expectedSourceSha256: audit.sha,
        expectedPdfPageCount: audit.pages, pageNumber });
    } catch { return { verified: false, reason: "INDEPENDENT_WORDS_UNAVAILABLE" }; }
    const comparison = comparePz006CompleteWordBijection(worker, independent);
    pageComparisons.push({ pageNumber, comparison });
  }
  if (pageComparisons.some((entry) => !entry.comparison.equivalent)) {
    return { verified: false, reason: "FULL_WORD_BIJECTION_FAILED", pageComparisons };
  }
  return verifyPod094WasteChainProposals(input)
    ? { verified: true, reason: "VERIFIED_REVIEW_ONLY", pageComparisons }
    : { verified: false, reason: "WORKER_RESULT_REPLAY_FAILED", pageComparisons };
}
