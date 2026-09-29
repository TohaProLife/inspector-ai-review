import { sha256 } from "./canonical-json.js";
import { inspectPdfPageWordsWithPoppler,
  type IndependentPdfPageWords, type IndependentPdfWord } from "./poppler-page-words.js";
import { pythonCanonicalJson, pythonHash } from "./trusted-page-words.js";

type Json = Record<string, unknown>;
type Box = [number, number, number, number];
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const equal = (left: unknown, right: unknown): boolean =>
  pythonCanonicalJson(left) === pythonCanonicalJson(right);
const exact = (value: Json, keys: string[]): boolean =>
  equal(Object.keys(value).sort(), [...keys].sort());
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

const OBJECT_ID = "OBJ-TYUMENSKAYA-5-GOLD-SEED";
const PROVIDER_ID = "api-poppler-pdftotext-bbox-layout-v1@25.03.0";
const MAX_BOX_EDGE_DELTA_MILLI_POINTS = 600;
const COMMON_REASONS = ["EQUIPMENT_IDENTITY_AND_INSTALLATION_UNVERIFIED",
  "PD_RD_PAIR_UNVERIFIED", "REVIEW_ONLY_NOT_TYPED_FACT", "SOURCE_APPROVAL_UNVERIFIED"];
const PROFILES = {
  F0165: {
    sha256: "f4a34324aaf6779f05fc89379ddb2b15499a22dc0e9181389d87047ab1a39f64",
    sizeBytes: 24_884_908, pdfPages: 38, stage: "PD", section: "VK",
    pageNumber: 26, parameterCode: "IOS2-073", wordCount: 232, wordStartIndex: 2,
    wordLayoutSha256: "8565d9985bec2b2e85aa3394e85598a2276832542c81d6b48573019bcbedbda8",
    pageWidthMilliPoints: 595_320, pageHeightMilliPoints: 841_920,
    proposalKind: "FIRE_SPRINKLER_PUMP",
    exclusion: "FIRE_SPRINKLER_SYSTEM_NOT_DOMESTIC_DRINKING_WATER",
    nearText: "Насосная установка для пожарной системы (спринклеры)",
    words: ["Насосная", "установка", "для", "пожарной", "системы", "(спринклеры)"],
    box: [63_744, 176_600, 413_162, 189_980] as Box,
  },
  F0160: {
    sha256: "72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd",
    sizeBytes: 38_153_328, pdfPages: 126, stage: "PD", section: "EOM",
    pageNumber: 37, parameterCode: "ODI-115", wordCount: 878, wordStartIndex: 102,
    wordLayoutSha256: "fe38d8fbca6eb916f35f9a3b4b0e2263f01b2bf159352d705c7da4272c21d8dc",
    pageWidthMilliPoints: 3_574_000, pageHeightMilliPoints: 1_684_000,
    proposalKind: "LIFT_POWER_BOARD_LEGEND",
    exclusion: "POWER_BOARD_NOT_INSTALLED_LIFT",
    nearText: "ЩЛ - щит лифта (подъемника МГН);",
    words: ["ЩЛ", "-", "щит", "лифта", "(подъемника", "МГН);"],
    box: [3_058_620, 1_028_625, 3_220_597, 1_038_530] as Box,
  },
} as const;
type FileId = keyof typeof PROFILES;
type Profile = (typeof PROFILES)[FileId];

export interface EquipmentFalseNearSelectedSpanInput {
  originalPdfBytes: Buffer;
  publicSource: unknown;
  result: unknown;
}

/** Selected phrase only. This receipt is never a page scan or a fact decision. */
export interface EquipmentFalseNearSelectedSpanReceipt {
  schemaVersion: "equipment-false-near-selected-span-verification-v1";
  verificationScope: "SELECTED_SPAN_ONLY";
  providerId: typeof PROVIDER_ID;
  sourceFileId: FileId;
  sourceSha256: string;
  pageNumber: number;
  normalizedPhrase: string;
  selectedBboxMilliPointsTopLeft: Box;
  maxBoxEdgeDeltaMilliPoints: number;
  status: "ABSTAIN";
  reasonCodes: ["PAGE_SCAN_COMPLETENESS_UNVERIFIED"];
  pageScanCompleteness: "UNVERIFIED";
  eligibility: "INELIGIBLE_FOR_PARAMETER_FACT";
  typedFact: null;
  findingCount: null;
  parameterCoverage: null;
  durableSaveAllowed: false;
}

/** These pinned Cyrillic phrases have same lowercase and Unicode casefold mapping. */
function folded(value: string): string | null {
  const normalized = value.normalize("NFC");
  if (!/^[\p{Script=Cyrillic}\p{White_Space}();-]+$/u.test(normalized)) return null;
  return normalized.toLocaleLowerCase("ru").replace(/\p{White_Space}/gu, "");
}

function union(boxes: Box[]): Box {
  return [Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3]))];
}

function maxDelta(left: Box, right: Box): number {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

function validSource(source: unknown, profile: Profile, fileId: FileId): boolean {
  return record(source) && source.file_id === fileId && source.object_id === OBJECT_ID
    && source.split === "TRAIN_PUBLIC" && source.distribution_status === "INCLUDE"
    && source.label_visibility === "PUBLIC_TRAIN" && source.sha256 === profile.sha256
    && source.size_bytes === profile.sizeBytes && source.pdf_pages === profile.pdfPages
    && source.stage === profile.stage && source.section === profile.section;
}

function workerWords(result: Json, profile: Profile, fileId: FileId): Json[] | null {
  if (!exact(result, ["schemaVersion", "profileId", "purpose", "parameterCode",
    "sourceFileId", "objectId", "sourceSha256", "sourceStageFromManifest",
    "sourceSectionFromManifest", "sourceApprovalStatus", "pageNumber",
    "pageWidthMilliPoints", "pageHeightMilliPoints", "wordLayoutSha256",
    "wordCount", "status", "reasonCodes", "proposalCount", "proposals",
    "typedFact", "findingCount", "parameterCoverage", "contentHash"])
    || result.schemaVersion !== "equipment-spec-false-near-v1"
    || result.profileId !== "equipment-spec-false-near-public-review-v1"
    || result.purpose !== "REVIEW_ONLY" || result.parameterCode !== profile.parameterCode
    || result.sourceFileId !== fileId || result.objectId !== OBJECT_ID
    || result.sourceSha256 !== profile.sha256
    || result.sourceStageFromManifest !== profile.stage
    || result.sourceSectionFromManifest !== profile.section
    || result.sourceApprovalStatus !== "UNVERIFIED"
    || result.pageNumber !== profile.pageNumber
    || result.pageWidthMilliPoints !== profile.pageWidthMilliPoints
    || result.pageHeightMilliPoints !== profile.pageHeightMilliPoints
    || result.wordCount !== profile.wordCount
    || result.wordLayoutSha256 !== profile.wordLayoutSha256
    || result.status !== "ABSTAIN" || result.typedFact !== null
    || result.findingCount !== null || result.parameterCoverage !== null
    || !equal(result.reasonCodes, [...COMMON_REASONS, profile.exclusion].sort())
    || result.proposalCount !== 1 || !Array.isArray(result.proposals)
    || result.proposals.length !== 1 || !hash(result.contentHash)
    || Buffer.byteLength(pythonCanonicalJson(result)) > 128 * 1024) return null;
  const { contentHash: _hash, ...body } = result;
  if (pythonHash(body) !== result.contentHash) return null;
  const proposal = result.proposals[0];
  if (!record(proposal) || !exact(proposal, ["proposalKind", "sourceFileId",
    "sourceSha256", "pageNumber", "nearText", "wordLocators", "eligibility",
    "reasonCodes", "proposalSha256"])
    || proposal.proposalKind !== profile.proposalKind
    || proposal.sourceFileId !== fileId || proposal.sourceSha256 !== profile.sha256
    || proposal.pageNumber !== profile.pageNumber || proposal.nearText !== profile.nearText
    || proposal.eligibility !== "INELIGIBLE_FOR_PARAMETER_FACT"
    || !equal(proposal.reasonCodes, [profile.exclusion, "REVIEW_ONLY_NOT_TYPED_FACT",
      "EQUIPMENT_IDENTITY_AND_INSTALLATION_UNVERIFIED"])
    || !hash(proposal.proposalSha256)
    || !Array.isArray(proposal.wordLocators)
    || proposal.wordLocators.length !== profile.words.length) return null;
  const { proposalSha256: _proposalHash, ...proposalBody } = proposal;
  if (pythonHash(proposalBody) !== proposal.proposalSha256) return null;
  const words = proposal.wordLocators as unknown[];
  for (const [index, raw] of words.entries()) {
    if (!record(raw) || !exact(raw, ["wordIndex", "rawText", "wordTextSha256",
      "bboxMilliPointsTopLeft"])
      || raw.wordIndex !== profile.wordStartIndex + index
      || typeof raw.rawText !== "string" || raw.rawText !== profile.words[index]
      || raw.wordTextSha256 !== sha256(raw.rawText)
      || !Array.isArray(raw.bboxMilliPointsTopLeft)
      || raw.bboxMilliPointsTopLeft.length !== 4
      || raw.bboxMilliPointsTopLeft.some((value) =>
        !Number.isSafeInteger(value) || value < 0)) return null;
    const box = raw.bboxMilliPointsTopLeft as number[];
    if (box[0] >= box[2] || box[1] >= box[3]
      || box[2] > profile.pageWidthMilliPoints
      || box[3] > profile.pageHeightMilliPoints) return null;
  }
  const boxed = words as Json[];
  const aggregate = union(boxed.map((word) => word.bboxMilliPointsTopLeft as Box));
  if (maxDelta(aggregate, profile.box as Box) !== 0) return null;
  return boxed;
}

function uniquePhraseMatch(words: IndependentPdfWord[], phrase: string):
  IndependentPdfWord[] | null {
  const target = folded(phrase);
  if (!target) return null;
  const matches: IndependentPdfWord[][] = [];
  for (let start = 0; start < words.length; start += 1) {
    let combined = "";
    for (let end = start; end < Math.min(start + 16, words.length); end += 1) {
      const token = folded(words[end].rawText);
      if (!token) break;
      combined += token;
      if (combined === target) { matches.push(words.slice(start, end + 1)); break; }
      if (!target.startsWith(combined)) break;
    }
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

function alignWorkerTokens(worker: Json[], independent: IndependentPdfWord[]): number | null {
  let offset = 0;
  let greatestDelta = 0;
  for (const item of worker) {
    const target = folded(item.rawText as string);
    if (!target) return null;
    let text = "";
    const group: IndependentPdfWord[] = [];
    while (offset < independent.length && text.length < target.length) {
      const next = independent[offset];
      const token = folded(next.rawText);
      if (!token) return null;
      if (group.length) {
        const previous = group[group.length - 1].bboxMilliPointsTopLeft;
        const current = next.bboxMilliPointsTopLeft;
        const overlap = Math.min(previous[3], current[3])
          - Math.max(previous[1], current[1]);
        if (current[0] < previous[2] || current[0] - previous[2] > 3000
          || overlap < Math.min(previous[3] - previous[1],
            current[3] - current[1]) * 0.7) return null;
      }
      text += token;
      group.push(next);
      offset += 1;
    }
    if (text !== target || !group.length) return null;
    const delta = maxDelta(item.bboxMilliPointsTopLeft as Box,
      union(group.map((part) => part.bboxMilliPointsTopLeft)));
    if (delta > MAX_BOX_EDGE_DELTA_MILLI_POINTS) return null;
    greatestDelta = Math.max(greatestDelta, delta);
  }
  return offset === independent.length ? greatestDelta : null;
}

/** Pure comparison for tests and review; caller-supplied inspection is untrusted. */
export function replayEquipmentFalseNearSelectedSpanFromInspection(
  publicSource: unknown, result: unknown, inspection: IndependentPdfPageWords,
): EquipmentFalseNearSelectedSpanReceipt | null {
  try {
    if (!record(result) || !record(publicSource)
      || typeof publicSource.file_id !== "string"
      || !Object.hasOwn(PROFILES, publicSource.file_id)) return null;
    const fileId = publicSource.file_id as FileId;
    const profile = PROFILES[fileId];
    if (!validSource(publicSource, profile, fileId)) return null;
    const worker = workerWords(result, profile, fileId);
    if (!worker || !record(inspection)
      || inspection.providerId !== PROVIDER_ID
      || inspection.sourceSha256 !== profile.sha256
      || inspection.pdfPageCount !== profile.pdfPages
      || inspection.pageNumber !== profile.pageNumber
      || inspection.pageWidthMilliPoints !== profile.pageWidthMilliPoints
      || inspection.pageHeightMilliPoints !== profile.pageHeightMilliPoints
      || !hash(inspection.xmlSha256) || !hash(inspection.plainTextSha256)
      || typeof inspection.pageText !== "string"
      || !Array.isArray(inspection.words) || inspection.words.length < 1
      || inspection.words.length > 5000 || !hash(inspection.inspectionSha256)) return null;
    const { inspectionSha256: _inspectionHash, ...inspectionBody } = inspection;
    if (pythonHash(inspectionBody) !== inspection.inspectionSha256) return null;
    for (const [index, word] of inspection.words.entries()) {
      if (!record(word) || word.wordIndex !== index || typeof word.rawText !== "string"
        || !Array.isArray(word.bboxMilliPointsTopLeft)
        || word.bboxMilliPointsTopLeft.length !== 4
        || word.bboxMilliPointsTopLeft.some((value) =>
          !Number.isSafeInteger(value) || value < 0)
        || word.bboxMilliPointsTopLeft[0] >= word.bboxMilliPointsTopLeft[2]
        || word.bboxMilliPointsTopLeft[1] >= word.bboxMilliPointsTopLeft[3]
        || word.bboxMilliPointsTopLeft[2] > inspection.pageWidthMilliPoints
        || word.bboxMilliPointsTopLeft[3] > inspection.pageHeightMilliPoints) return null;
    }
    const match = uniquePhraseMatch(inspection.words, profile.nearText);
    if (!match) return null;
    const delta = alignWorkerTokens(worker, match);
    if (delta === null) return null;
    const independentBox = union(match.map((word) => word.bboxMilliPointsTopLeft));
    if (maxDelta(independentBox, profile.box as Box) > MAX_BOX_EDGE_DELTA_MILLI_POINTS) {
      return null;
    }
    return { schemaVersion: "equipment-false-near-selected-span-verification-v1",
      verificationScope: "SELECTED_SPAN_ONLY", providerId: PROVIDER_ID,
      sourceFileId: fileId, sourceSha256: profile.sha256,
      pageNumber: profile.pageNumber, normalizedPhrase: folded(profile.nearText)!,
      selectedBboxMilliPointsTopLeft: independentBox,
      maxBoxEdgeDeltaMilliPoints: delta, status: "ABSTAIN",
      reasonCodes: ["PAGE_SCAN_COMPLETENESS_UNVERIFIED"],
      pageScanCompleteness: "UNVERIFIED", eligibility: "INELIGIBLE_FOR_PARAMETER_FACT",
      typedFact: null, findingCount: null, parameterCoverage: null,
      durableSaveAllowed: false };
  } catch {
    return null;
  }
}

/** Reads original SHA-pinned PDF through API-owned Poppler before replay. */
export async function verifyEquipmentFalseNearSelectedSpan(
  input: EquipmentFalseNearSelectedSpanInput,
): Promise<EquipmentFalseNearSelectedSpanReceipt | null> {
  try {
    if (!record(input.publicSource)
      || typeof input.publicSource.file_id !== "string"
      || !Object.hasOwn(PROFILES, input.publicSource.file_id)) return null;
    const fileId = input.publicSource.file_id as FileId;
    const profile = PROFILES[fileId];
    if (!validSource(input.publicSource, profile, fileId)
      || !Buffer.isBuffer(input.originalPdfBytes)
      || input.originalPdfBytes.length !== profile.sizeBytes
      || sha256(input.originalPdfBytes) !== profile.sha256) return null;
    const inspection = await inspectPdfPageWordsWithPoppler({
      originalPdfBytes: input.originalPdfBytes,
      expectedSourceSha256: profile.sha256,
      expectedPdfPageCount: profile.pdfPages,
      pageNumber: profile.pageNumber });
    return replayEquipmentFalseNearSelectedSpanFromInspection(
      input.publicSource, input.result, inspection);
  } catch {
    return null;
  }
}
