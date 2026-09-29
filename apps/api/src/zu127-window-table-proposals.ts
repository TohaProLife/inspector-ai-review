import { sha256 } from "./canonical-json.js";
import { pythonCanonicalJson, pythonHash, verifyTrustedPageWords,
  type PdfWord, type TrustedPageWords } from "./trusted-page-words.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const safe = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const equal = (left: unknown, right: unknown): boolean =>
  pythonCanonicalJson(left) === pythonCanonicalJson(right);
const exact = (value: Json, keys: string[]): boolean =>
  equal(Object.keys(value).sort(), [...keys].sort());
const number = /^\d{1,2}[,.]\d{1,3}\*{0,2}$/u;
const labels: Record<string, "WINDOW" | "VITRAGE"> = {
  "окна": "WINDOW", "витражи": "VITRAGE",
};
const middleY = (word: PdfWord): number =>
  Math.floor((word.bboxMilliPointsTopLeft[1] + word.bboxMilliPointsTopLeft[3]) / 2);
const middleX = (word: PdfWord): number =>
  Math.floor((word.bboxMilliPointsTopLeft[0] + word.bboxMilliPointsTopLeft[2]) / 2);
const labelKey = (word: PdfWord): string => word.rawText.replace(/^[.: ]+|[.: ]+$/gu, "").toLowerCase();

function proposal(kind: string, product: string, roles: Record<string, PdfWord>,
  rawValues: Record<string, string>): Json {
  const body = { proposalKind: kind, productKind: product,
    thermalQuantity: "R_RESISTANCE_CANDIDATE", unitInterpretationStatus: "UNVERIFIED",
    rowAssociationStatus: "UNVERIFIED", productEquivalenceStatus: "UNVERIFIED",
    protocolAssociationStatus: "UNVERIFIED",
    reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED", "SOURCE_ROLE_UNVERIFIED",
      "PRODUCT_EQUIVALENCE_UNVERIFIED"],
    roles, rawCellTexts: rawValues, typedValues: null };
  return { ...body, proposalSha256: pythonHash(body) };
}

function pageProposals(page: TrustedPageWords): { proposals: Json[]; reasons: string[];
  wordHash: string } {
  const words = page.words;
  if (words.length > 5000) return { proposals: [], reasons: ["WORD_LIMIT_REACHED"], wordHash: "" };
  const wordHash = pythonHash(words);
  if (!/сопротивлени[ея]\s+теплопередач/iu.test(page.pageText)
    || /коэффициент\s+теплопередач/iu.test(page.pageText)) {
    return { proposals: [], reasons: ["R_HEADING_NOT_UNAMBIGUOUS"], wordHash };
  }
  const proposals: Json[] = [];
  const reasons: string[] = [];
  const category = words.filter((word) => labels[labelKey(word)] !== undefined);
  const firstY = Math.min(...category.map(middleY), 1e9);
  const required = words.filter((word) => word.rawText.toLowerCase() === "требуемое"
    && middleY(word) < firstY);
  const calculated = words.filter((word) => ["расчётное", "расчетное"]
    .includes(word.rawText.toLowerCase()) && middleY(word) < firstY);
  if (required.length === 1 && calculated.length === 1) {
    const [left] = required;
    const [right] = calculated;
    if (middleX(left) + 40_000 < middleX(right)) {
      for (const label of category) {
        const y = middleY(label);
        if (y <= Math.max(middleY(left), middleY(right)) + 5000) continue;
        const candidates = words.filter((word) => number.test(word.rawText)
          && Math.abs(middleY(word) - y) <= 5000
          && middleX(word) > middleX(label) + 20_000);
        const leftHits = candidates.filter((word) => Math.abs(middleX(word) - middleX(left)) <= 45_000);
        const rightHits = candidates.filter((word) => Math.abs(middleX(word) - middleX(right)) <= 45_000);
        if (leftHits.length !== 1 || rightHits.length !== 1 || leftHits[0] === rightHits[0]) {
          reasons.push("SUMMARY_ROW_ADJACENCY_AMBIGUOUS");
          continue;
        }
        proposals.push(proposal("R_SUMMARY_ROW_ADJACENCY", labels[labelKey(label)],
          { productLabel: label, requiredHeader: left, calculatedHeader: right,
            requiredCell: leftHits[0], calculatedCell: rightHits[0] },
          { required: leftHits[0].rawText, calculated: rightHits[0].rawText }));
      }
    }
  } else if (!required.length && !calculated.length) {
    const sorted = [...category].sort((a, b) => middleY(a) - middleY(b));
    for (const [index, label] of sorted.entries()) {
      const lower = index + 1 < sorted.length ? middleY(sorted[index + 1]) : middleY(label) + 45_000;
      const hits = words.filter((word) => number.test(word.rawText)
        && middleY(label) + 3000 < middleY(word) && middleY(word) < lower - 3000
        && middleX(word) > page.pageWidthMilliPoints * 0.65);
      if (hits.length !== 1) {
        reasons.push("PRODUCT_ROW_ADJACENCY_AMBIGUOUS");
        continue;
      }
      proposals.push(proposal("R_PRODUCT_ROW_ADJACENCY", labels[labelKey(label)],
        { productHeading: label, resistanceCell: hits[0] },
        { resistance: hits[0].rawText }));
    }
  } else reasons.push("SUMMARY_HEADERS_AMBIGUOUS");
  return { proposals, reasons, wordHash };
}

export interface Zu127WindowVerificationInput {
  originalPdfBytes: Buffer;
  publicSource: { file_id: string; split: string; distribution_status: string;
    label_visibility: string; object_id: string; sha256: string;
    size_bytes: number; pdf_pages: number };
  trustedPages: TrustedPageWords[];
  result: unknown;
}

/**
 * Replays navigation from separately parsed PDF words. Caller must supply
 * `trustedPages` from an API-owned provider reading `originalPdfBytes`; a
 * worker-supplied word list is not trusted. No such runtime provider is wired yet.
 */
export function verifyZu127WindowTableProposals(input: Zu127WindowVerificationInput): boolean {
  try {
    const source = input.publicSource;
    if (!Buffer.isBuffer(input.originalPdfBytes) || !record(source)
      || source.file_id !== "F0152" || source.split !== "TRAIN_PUBLIC"
      || source.distribution_status !== "INCLUDE" || source.label_visibility !== "PUBLIC_TRAIN"
      || typeof source.object_id !== "string" || !source.object_id
      || !hash(source.sha256) || !safe(source.size_bytes, 1)
      || input.originalPdfBytes.length !== source.size_bytes
      || sha256(input.originalPdfBytes) !== source.sha256
      || !safe(source.pdf_pages, 1) || !Array.isArray(input.trustedPages)
      || input.trustedPages.length < 1 || input.trustedPages.length > 8
      || !record(input.result)) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "sourceFileId",
      "sourceSha256", "sourceObjectId", "selectedPageNumbers", "pageReceipts",
      "codeRows", "findingCount", "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "zu127-window-table-proposals-v1"
      || result.profileId !== "zu127-window-table-review-v1"
      || result.purpose !== "REVIEW_ONLY" || result.sourceFileId !== source.file_id
      || result.sourceSha256 !== source.sha256 || result.sourceObjectId !== source.object_id
      || result.findingCount !== null || result.parameterCoverage !== null
      || !hash(result.contentHash) || !Array.isArray(result.selectedPageNumbers)
      || !Array.isArray(result.pageReceipts) || !Array.isArray(result.codeRows)
      || result.codeRows.length !== 1
      || Buffer.byteLength(pythonCanonicalJson(result)) > 512_000) return false;
    const { contentHash: _digest, ...body } = result;
    if (pythonHash(body) !== result.contentHash) return false;
    const sortedPages = [...input.trustedPages].sort((a, b) => a.pageNumber - b.pageNumber);
    if (new Set(sortedPages.map((page) => page.pageNumber)).size !== sortedPages.length
      || !equal(result.selectedPageNumbers, sortedPages.map((page) => page.pageNumber))) return false;
    const proposals: Json[] = [];
    const receipts: Json[] = [];
    const reasons = new Set(["REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_ROLE_UNVERIFIED",
      "PD_RD_PAIR_UNVERIFIED", "ROW_ASSOCIATION_UNVERIFIED"]);
    for (const page of sortedPages) {
      if (!verifyTrustedPageWords(input.originalPdfBytes, source.sha256, source.pdf_pages, page)) {
        return false;
      }
      const local = pageProposals(page);
      proposals.push(...local.proposals);
      local.reasons.forEach((reason) => reasons.add(reason));
      receipts.push({ pageNumber: page.pageNumber, wordArtifactSha256: local.wordHash,
        proposalCount: local.proposals.length, reasonCodes: [...new Set(local.reasons)].sort() });
    }
    if (!proposals.length) reasons.add("NO_SAFE_PROPOSAL_IN_SELECTED_PAGES");
    const expectedRow = { parameterCode: "ZU-127", status: "ABSTAIN",
      reasonCodes: [...reasons].sort(), proposalCount: proposals.length,
      truncatedProposalCount: Math.max(0, proposals.length - 16),
      absenceConclusion: "NOT_AVAILABLE", proposals: proposals.slice(0, 16) };
    return equal(result.pageReceipts, receipts) && equal(result.codeRows, [expectedRow]);
  } catch {
    return false;
  }
}
