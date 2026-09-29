import { sha256 } from "./canonical-json.js";
import { inspectPdfPageWordsWithPoppler,
  type IndependentPdfPageWords } from "./poppler-page-words.js";
import { pythonCanonicalJson, pythonHash, type PdfWord } from "./trusted-page-words.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (left: unknown, right: unknown): boolean =>
  pythonCanonicalJson(left) === pythonCanonicalJson(right);
const exact = (value: Json, keys: string[]): boolean =>
  equal(Object.keys(value).sort(), [...keys].sort());
const PUBLIC_SHA = "99ec972d7dfe5039fca922e3120bd5e486f2a26518f78044d0850992c028e7af";
const PUBLIC_OBJECT_ID = "OBJ-TYUMENSKAYA-5-GOLD-SEED";
const PUBLIC_SIZE = 6_359_136;
const PAGES = [49, 51];
const POPPLER_VERSION = "25.12.0";
const INDEPENDENT_PROVIDER_ID = `api-poppler-pdftotext-bbox-layout-v1@${POPPLER_VERSION}`;
const RESULT_PROVIDER_ID = `poppler-pdftotext-bbox-layout-v2@${POPPLER_VERSION}`;
const number = /^\d{1,2}[,.]\d{1,3}$/u;
const labels: Record<string, "WINDOW" | "VITRAGE"> = {
  "окна": "WINDOW", "витражи": "VITRAGE",
};
const midX = (word: PdfWord): number =>
  Math.floor((word.bboxMilliPointsTopLeft[0] + word.bboxMilliPointsTopLeft[2]) / 2);
const midY = (word: PdfWord): number =>
  Math.floor((word.bboxMilliPointsTopLeft[1] + word.bboxMilliPointsTopLeft[3]) / 2);
const label = (word: PdfWord): "WINDOW" | "VITRAGE" | undefined =>
  labels[word.rawText.replace(/^[.: ]+|[.: ]+$/gu, "").toLowerCase()];

function proposal(kind: string, product: "WINDOW" | "VITRAGE",
  roles: Record<string, PdfWord>, rawCellTexts: Record<string, string>): Json {
  const body = { proposalKind: kind, productKind: product,
    thermalQuantity: "R_RESISTANCE_CANDIDATE",
    unitInterpretationStatus: "UNVERIFIED", rowAssociationStatus: "UNVERIFIED",
    productEquivalenceStatus: "UNVERIFIED", protocolAssociationStatus: "UNVERIFIED",
    reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED", "SOURCE_ROLE_UNVERIFIED",
      "PRODUCT_EQUIVALENCE_UNVERIFIED"], roles, rawCellTexts, typedValues: null };
  return { ...body, proposalSha256: pythonHash(body) };
}

function pageProposals(page: IndependentPdfPageWords, words: PdfWord[]): {
  proposals: Json[]; reasons: string[];
} {
  if (!/сопротивлени[ея]\s+теплопередач/iu.test(page.pageText)
    || /коэффициент\s+теплопередач/iu.test(page.pageText)) {
    return { proposals: [], reasons: ["R_HEADING_NOT_UNAMBIGUOUS"] };
  }
  if (page.pageNumber === 49) {
    const headings = words.filter((word) => label(word)
      && midX(word) >= 290_000 && midX(word) <= 360_000
      && midY(word) > 100_000 && midY(word) < 225_000)
      .sort((a, b) => midY(a) - midY(b));
    if (headings.length !== 2 || label(headings[0]) !== "WINDOW"
      || label(headings[1]) !== "VITRAGE") {
      return { proposals: [], reasons: ["PRODUCT_HEADINGS_AMBIGUOUS"] };
    }
    const proposals: Json[] = [];
    const reasons: string[] = [];
    for (const [index, heading] of headings.entries()) {
      const lower = index + 1 < headings.length
        ? midY(headings[index + 1]) : midY(heading) + 50_000;
      const hits = words.filter((word) => number.test(word.rawText)
        && midY(word) > midY(heading) + 3000 && midY(word) < lower - 3000
        && midX(word) > page.pageWidthMilliPoints * 0.7);
      if (hits.length !== 1) {
        reasons.push("PRODUCT_ROW_ADJACENCY_AMBIGUOUS");
        continue;
      }
      const box = hits[0].bboxMilliPointsTopLeft;
      const markers = words.filter((word) => (word.rawText === "*" || word.rawText === "**")
        && word.bboxMilliPointsTopLeft[0] - box[2] >= 0
        && word.bboxMilliPointsTopLeft[0] - box[2] <= 200
        && Math.min(box[3], word.bboxMilliPointsTopLeft[3])
          > Math.max(box[1], word.bboxMilliPointsTopLeft[1]));
      if (markers.length !== 1) {
        reasons.push("PRODUCT_FOOTNOTE_ADJACENCY_AMBIGUOUS");
        continue;
      }
      proposals.push(proposal("R_PRODUCT_ROW_ADJACENCY_POPPLER", label(heading)!,
        { productHeading: heading, resistanceCell: hits[0], footnoteMarker: markers[0] },
        { resistance: hits[0].rawText, footnoteMarker: markers[0].rawText }));
    }
    return { proposals, reasons };
  }
  if (page.pageNumber === 51) {
    const headings = words.filter((word) => label(word) && midX(word) < 200_000
      && midY(word) > 300_000 && midY(word) < 550_000)
      .sort((a, b) => midY(a) - midY(b));
    if (headings.length !== 2 || label(headings[0]) !== "WINDOW"
      || label(headings[1]) !== "VITRAGE") {
      return { proposals: [], reasons: ["SUMMARY_PRODUCT_LABELS_AMBIGUOUS"] };
    }
    const firstY = midY(headings[0]);
    const required = words.filter((word) => word.rawText.toLowerCase() === "требуемое"
      && midY(word) < firstY);
    const calculated = words.filter((word) => ["расчётное", "расчетное"]
      .includes(word.rawText.toLowerCase()) && midY(word) < firstY);
    if (required.length !== 1 || calculated.length !== 1
      || midX(required[0]) + 40_000 >= midX(calculated[0])) {
      return { proposals: [], reasons: ["SUMMARY_HEADERS_AMBIGUOUS"] };
    }
    const left = required[0];
    const right = calculated[0];
    const proposals: Json[] = [];
    const reasons: string[] = [];
    for (const heading of headings) {
      const candidates = words.filter((word) => number.test(word.rawText)
        && Math.abs(midY(word) - midY(heading)) <= 5000
        && midX(word) > midX(heading) + 20_000);
      const leftHits = candidates.filter((word) => Math.abs(midX(word) - midX(left)) <= 45_000);
      const rightHits = candidates.filter((word) => Math.abs(midX(word) - midX(right)) <= 45_000);
      if (leftHits.length !== 1 || rightHits.length !== 1 || leftHits[0] === rightHits[0]) {
        reasons.push("SUMMARY_ROW_ADJACENCY_AMBIGUOUS");
        continue;
      }
      proposals.push(proposal("R_SUMMARY_ROW_ADJACENCY_POPPLER", label(heading)!,
        { productLabel: heading, requiredHeader: left, calculatedHeader: right,
          requiredCell: leftHits[0], calculatedCell: rightHits[0] },
        { required: leftHits[0].rawText, calculated: rightHits[0].rawText }));
    }
    return { proposals, reasons };
  }
  throw new Error("page outside ZU-127 Poppler profile");
}

export interface Zu127PopplerV2VerificationInput {
  originalPdfBytes: Buffer;
  publicSource: unknown;
  result: unknown;
}

function validSource(source: unknown, originalPdfBytes: Buffer): boolean {
  return record(source) && source.file_id === "F0152"
    && source.split === "TRAIN_PUBLIC" && source.distribution_status === "INCLUDE"
    && source.label_visibility === "PUBLIC_TRAIN"
    && source.object_id === PUBLIC_OBJECT_ID && source.stage === "PD"
    && source.section === "OTHER" && source.sha256 === PUBLIC_SHA
    && source.size_bytes === PUBLIC_SIZE && source.pdf_pages === 77
    && Buffer.isBuffer(originalPdfBytes) && originalPdfBytes.length === PUBLIC_SIZE
    && originalPdfBytes.toString("ascii", 0, 5) === "%PDF-"
    && sha256(originalPdfBytes) === PUBLIC_SHA;
}

/** Pure replay for cross-language fixture checks. Inspections here are untrusted. */
export function replayZu127WindowTablePopplerV2FromInspections(
  source: unknown, result: unknown, inspections: IndependentPdfPageWords[],
): boolean {
  try {
    if (!record(source) || source.file_id !== "F0152"
      || source.split !== "TRAIN_PUBLIC" || source.distribution_status !== "INCLUDE"
      || source.label_visibility !== "PUBLIC_TRAIN"
      || source.object_id !== PUBLIC_OBJECT_ID || source.stage !== "PD"
      || source.section !== "OTHER" || source.sha256 !== PUBLIC_SHA
      || source.size_bytes !== PUBLIC_SIZE || source.pdf_pages !== 77
      || !record(result) || !Array.isArray(inspections)
      || inspections.length !== 2 || inspections.some((page, index) =>
        page.pageNumber !== PAGES[index] || page.sourceSha256 !== PUBLIC_SHA
        || page.pdfPageCount !== 77 || page.providerId !== INDEPENDENT_PROVIDER_ID
        || page.words.length < 1 || page.words.length > 5000)) return false;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "sourceFileId",
      "sourceSha256", "sourceObjectId", "selectedPageNumbers", "pageReceipts",
      "codeRows", "findings", "findingCount", "parameterCoverage", "typedFacts", "contentHash"])
      || result.schemaVersion !== "zu127-window-table-proposals-poppler-v2"
      || result.profileId !== "zu127-window-table-poppler-review-v2"
      || result.purpose !== "REVIEW_ONLY" || result.sourceFileId !== "F0152"
      || result.sourceSha256 !== PUBLIC_SHA || result.sourceObjectId !== PUBLIC_OBJECT_ID
      || !equal(result.selectedPageNumbers, PAGES)
      || result.findings !== null || result.findingCount !== null
      || result.parameterCoverage !== null || result.typedFacts !== null
      || !Array.isArray(result.pageReceipts) || !Array.isArray(result.codeRows)
      || result.codeRows.length !== 1 || typeof result.contentHash !== "string"
      || !/^[0-9a-f]{64}$/u.test(result.contentHash)
      || Buffer.byteLength(pythonCanonicalJson(result)) > 256 * 1024) return false;
    const { contentHash: _hash, ...body } = result;
    if (pythonHash(body) !== result.contentHash) return false;
    const receipts: Json[] = [];
    const proposals: Json[] = [];
    const reasons = new Set(["REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_ROLE_UNVERIFIED",
      "PD_RD_PAIR_UNVERIFIED", "ROW_ASSOCIATION_UNVERIFIED"]);
    for (const page of inspections) {
      const words: PdfWord[] = page.words.map((word, index) => ({
        pageNumber: page.pageNumber, wordIndex: index, rawText: word.rawText,
        wordTextSha256: sha256(word.rawText),
        bboxMilliPointsTopLeft: word.bboxMilliPointsTopLeft,
      }));
      if (page.words.some((word, index) => word.wordIndex !== index)) return false;
      const local = pageProposals(page, words);
      proposals.push(...local.proposals);
      local.reasons.forEach((reason) => reasons.add(reason));
      receipts.push({ pageNumber: page.pageNumber,
        providerId: RESULT_PROVIDER_ID,
        pageWidthMilliPoints: page.pageWidthMilliPoints,
        pageHeightMilliPoints: page.pageHeightMilliPoints,
        wordCount: words.length, wordArtifactSha256: pythonHash(words),
        xmlSha256: page.xmlSha256, plainTextSha256: page.plainTextSha256,
        proposalCount: local.proposals.length,
        reasonCodes: [...new Set(local.reasons)].sort() });
    }
    if (!proposals.length) reasons.add("NO_SAFE_PROPOSAL_IN_SELECTED_PAGES");
    const expectedRow = { parameterCode: "ZU-127", status: "ABSTAIN",
      reasonCodes: [...reasons].sort(), proposalCount: proposals.length,
      truncatedProposalCount: Math.max(0, proposals.length - 16),
      absenceConclusion: "NOT_AVAILABLE", typedFact: null,
      proposals: proposals.slice(0, 16) };
    return equal(result.pageReceipts, receipts) && equal(result.codeRows, [expectedRow]);
  } catch {
    return false;
  }
}

/** Re-extracts both complete pages from original SHA-pinned bytes in API process. */
export async function verifyZu127WindowTablePopplerV2(
  input: Zu127PopplerV2VerificationInput,
): Promise<boolean> {
  try {
    if (!validSource(input.publicSource, input.originalPdfBytes)) return false;
    const inspections: IndependentPdfPageWords[] = [];
    for (const pageNumber of PAGES) {
      const inspection = await inspectPdfPageWordsWithPoppler({
        originalPdfBytes: input.originalPdfBytes,
        expectedSourceSha256: PUBLIC_SHA,
        expectedPdfPageCount: 77,
        pageNumber,
      });
      if (inspection.providerId !== INDEPENDENT_PROVIDER_ID) return false;
      inspections.push(inspection);
    }
    return replayZu127WindowTablePopplerV2FromInspections(
      input.publicSource, input.result, inspections);
  } catch {
    return false;
  }
}
