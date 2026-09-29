import { pythonCanonicalJson, pythonHash } from "./trusted-page-words.js";

type Json = Record<string, unknown>;
const SHA = /^[a-f0-9]{64}$/u;
const PAGE_KEY = /^[1-9][0-9]*$/u;
const SCHEMA = "zu127-page-selection-v3";
const MAX_SOURCES = 64;
const MAX_PAGES_PER_SOURCE = 2_000;
const MAX_TOTAL_PAGES = 10_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_SELECTED_PAGES = 4;
const WORD = "[\\p{L}\\p{N}_]";
const resistance = new RegExp(`(?<!${WORD})сопротивлен${WORD}*(?!${WORD})`, "u");
const heatTransfer = new RegExp(`(?<!${WORD})теплопередач${WORD}*(?!${WORD})`, "u");
const windowWord = new RegExp(`(?<!${WORD})(?:окн${WORD}*|окон${WORD}*|витраж${WORD}*)(?!${WORD})`, "u");
const whitespace = /[\t\n\v\f\r\x1c-\x1f\u0085\p{Zs}\p{Zl}\p{Zp}]/u;
const cidPlaceholder = /\(cid:[0-9]+\)/u;

const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const hash = (value: unknown): value is string =>
  typeof value === "string" && SHA.test(value);
const equal = (left: unknown, right: unknown): boolean =>
  pythonCanonicalJson(left) === pythonCanonicalJson(right);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function qualityOf(blockTexts: string[], policy: string): Json {
  const text = blockTexts.join("\n");
  let nonWhitespace = 0;
  let alphanumeric = 0;
  let replacement = 0;
  let disallowedControl = 0;
  for (const character of text) {
    if (!whitespace.test(character)) nonWhitespace += 1;
    if (/[\p{L}\p{N}]/u.test(character)) alphanumeric += 1;
    if (character === "\ufffd") replacement += 1;
    if (/\p{Cc}/u.test(character) && !"\n\r\t".includes(character)) {
      disallowedControl += 1;
    }
  }
  const reasons: string[] = [];
  if (nonWhitespace === 0) reasons.push("EMPTY_TEXT_LAYER");
  else {
    if (alphanumeric === 0) reasons.push("NO_ALPHANUMERIC_TEXT");
    if (replacement > 0 || disallowedControl > 0
      || policy === "text-layer-quality-v2" && cidPlaceholder.test(text)) {
      reasons.push("TEXT_DECODING_ANOMALY");
    }
  }
  return {
    disposition: reasons.length ? "OCR_REQUIRED" : "TEXT_LAYER_CANDIDATE",
    reasonCodes: reasons,
    metrics: {
      blockCount: blockTexts.length,
      nonWhitespaceCharacterCount: nonWhitespace,
      alphanumericCharacterCount: alphanumeric,
      replacementCharacterCount: replacement,
      disallowedControlCharacterCount: disallowedControl,
    },
  };
}

function validArtifact(artifact: unknown, source: Json): artifact is Json & { pages: Json[] } {
  if (!record(artifact) || artifact.schemaVersion !== "document-text-v2"
    || artifact.sourceFileId !== source.sourceFileId
    || artifact.inputSha256 !== source.sha256
    || artifact.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || !Array.isArray(artifact.pages) || !artifact.pages.length
    || artifact.pageCount !== artifact.pages.length
    || !["text-layer-quality-v1", "text-layer-quality-v2"].includes(
      String(artifact.qualityPolicyVersion))) return false;
  const seen = new Set<number>();
  let textCount = 0;
  let candidateCount = 0;
  for (const page of artifact.pages) {
    if (!record(page) || !integer(page.pageNumber, 1, artifact.pages.length)
      || seen.has(page.pageNumber)
      || !integer(page.widthMilliPoints, 1)
      || !integer(page.heightMilliPoints, 1)
      || !Array.isArray(page.blocks)) return false;
    seen.add(page.pageNumber);
    if (page.blocks.length) textCount += 1;
    const blockTexts: string[] = [];
    for (const block of page.blocks) {
      if (!record(block) || typeof block.text !== "string"
        || !Array.isArray(block.bboxMilliPoints) || block.bboxMilliPoints.length !== 4
        || !block.bboxMilliPoints.every((coordinate) => integer(coordinate))) return false;
      const [x0, y0, x1, y1] = block.bboxMilliPoints as number[];
      if (x0 > x1 || y0 > y1 || x1 > page.widthMilliPoints
        || y1 > page.heightMilliPoints) return false;
      blockTexts.push(block.text);
    }
    const expectedQuality = qualityOf(blockTexts, String(artifact.qualityPolicyVersion));
    if (!equal(page.quality, expectedQuality)) return false;
    if (expectedQuality.disposition === "TEXT_LAYER_CANDIDATE") candidateCount += 1;
  }
  return seen.size === artifact.pages.length
    && artifact.textPageCount === textCount
    && equal(artifact.qualitySummary, {
      textLayerCandidatePageCount: candidateCount,
      ocrRequiredPageCount: artifact.pages.length - candidateCount,
    });
}

function validSource(raw: unknown, objectId: string): raw is Json {
  if (!record(raw) || !nonempty(raw.sourceFileId) || !hash(raw.sha256)
    || !integer(raw.pageCount, 1, MAX_PAGES_PER_SOURCE)
    || !integer(raw.byteSize, 5, MAX_SOURCE_BYTES)
    || raw.mediaType !== "application/pdf"
    || !Array.isArray(raw.stages) || !raw.stages.length
    || raw.stages.some((stage) => typeof stage !== "string"
      || !["PD", "RD", "ID"].includes(stage))
    || new Set(raw.stages).size !== raw.stages.length
    || raw.sectionCode !== undefined && raw.sectionCode !== null
      && !nonempty(raw.sectionCode)
    || raw.objectId !== undefined && raw.objectId !== objectId) return false;
  return true;
}

function reviewReason(source: Json, decision: unknown): string | null {
  if (decision === undefined || decision === null) return "SOURCE_REVIEW_REQUIRED";
  if (!record(decision) || decision.sourceSha256 !== source.sha256) {
    throw new Error("ZU-127 decision source SHA mismatch");
  }
  const pages = decision.pageStages;
  if (!record(pages)) return "PAGE_STAGE_REVIEW_REQUIRED";
  for (const [key, stage] of Object.entries(pages)) {
    if (!PAGE_KEY.test(key) || Number(key) > Number(source.pageCount)
      || !["PD", "RD", "ID", "UNRESOLVED"].includes(String(stage))
      || stage !== "UNRESOLVED" && !(source.stages as string[]).includes(String(stage))) {
      throw new Error("ZU-127 decision pageStages invalid");
    }
  }
  if (decision.revisionStatus !== "CURRENT" || decision.approvalStatus !== "APPROVED") {
    return "SOURCE_REVIEW_NOT_CURRENT_APPROVED";
  }
  if (decision.sectionCode !== "ZU") return "SOURCE_SECTION_REVIEW_REQUIRED";
  if (!record(decision.basis) || !nonempty(decision.basis.reference)
    || decision.basis.reference.trim().length < 8) return "SOURCE_REVIEW_REQUIRED";
  if (!(source.stages as string[]).includes("PD")) return "PD_SOURCE_REQUIRED";
  if ((source.stages as string[]).length > 1
    && Object.keys(pages).length !== source.pageCount) return "PAGE_STAGE_REVIEW_REQUIRED";
  if (Object.values(pages).includes("UNRESOLVED")) return "PAGE_STAGE_REVIEW_REQUIRED";
  return null;
}

function lexicalCues(page: Json): [boolean, boolean] {
  const blocks = page.blocks as Json[];
  const normalized = blocks.map((block) => block.text).join(" ")
    .normalize("NFKC").toLowerCase().split(whitespace).filter(Boolean).join(" ");
  return [resistance.test(normalized) && heatTransfer.test(normalized),
    windowWord.test(normalized)];
}

export interface Zu127PageSelectionV3Input {
  objectId: string;
  inputManifestHash: string;
  sources: unknown[];
  sourceDecisions: Record<string, unknown>;
  textArtifacts: unknown[];
  workerResult: unknown;
}

/** Independent replay. Caller must authenticate immutable DB source decisions and text artifacts. */
export function verifyZu127PageSelectionV3(input: Zu127PageSelectionV3Input): boolean {
  try {
    const { objectId, inputManifestHash, sources, sourceDecisions, textArtifacts,
      workerResult } = input;
    if (!nonempty(objectId) || !hash(inputManifestHash)
      || !Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES
      || !record(sourceDecisions) || !Array.isArray(textArtifacts)
      || !record(workerResult)) return false;
    const sourceIndex = new Map<string, Json>();
    const sourceHashes = new Set<string>();
    let totalPages = 0;
    for (const source of sources) {
      if (!validSource(source, objectId)) return false;
      const sourceId = source.sourceFileId as string;
      if (sourceIndex.has(sourceId) || sourceHashes.has(source.sha256 as string)) return false;
      sourceIndex.set(sourceId, source);
      sourceHashes.add(source.sha256 as string);
      totalPages += source.pageCount as number;
      if (totalPages > MAX_TOTAL_PAGES) return false;
    }
    if (Object.keys(sourceDecisions).some((sourceId) => !sourceIndex.has(sourceId))) return false;
    const artifacts = new Map<string, Json & { pages: Json[] }>();
    const artifactHashes = new Map<string, string>();
    for (const receipt of textArtifacts) {
      if (!record(receipt) || typeof receipt.sourceFileId !== "string"
        || !sourceIndex.has(receipt.sourceFileId)
        || artifacts.has(receipt.sourceFileId)
        || !hash(receipt.contentSha256)
        || !record(receipt.artifact)) return false;
      const canonical = pythonCanonicalJson(receipt.artifact);
      if (Buffer.byteLength(canonical) > MAX_ARTIFACT_BYTES
        || pythonHash(receipt.artifact) !== receipt.contentSha256) return false;
      const source = sourceIndex.get(receipt.sourceFileId)!;
      if (receipt.artifact.pageCount !== source.pageCount
        || !validArtifact(receipt.artifact, source)) return false;
      artifacts.set(receipt.sourceFileId, receipt.artifact);
      artifactHashes.set(receipt.sourceFileId, receipt.contentSha256);
    }
    if (artifacts.size !== sourceIndex.size) return false;

    const rows: Json[] = [];
    let remaining = MAX_SELECTED_PAGES;
    for (const sourceId of [...sourceIndex.keys()].sort()) {
      const source = sourceIndex.get(sourceId)!;
      const base = { sourceFileId: sourceId, sourceSha256: source.sha256,
        sourceByteSize: source.byteSize, textArtifactSha256: artifactHashes.get(sourceId),
        sourcePageCount: source.pageCount };
      const decision = sourceDecisions[sourceId];
      const reason = reviewReason(source, decision);
      if (reason !== null) {
        rows.push({ ...base, reasonCodes: [reason], reviewEligible: false,
          textSearchedPageCount: null, thermalCuePageCount: null,
          windowCuePageCount: null, candidatePageCount: null,
          candidatePageNumbers: null, selectedPageNumbers: [],
          ocrRequiredDeferredPageNumbers: null, truncatedCandidatePageCount: null });
        continue;
      }
      const artifact = artifacts.get(sourceId)!;
      const pages = (decision as Json).pageStages as Json;
      let textSearched = 0;
      let thermalCount = 0;
      let windowCount = 0;
      const candidates: number[] = [];
      const ocrDeferred: number[] = [];
      for (const page of artifact.pages) {
        const pageNumber = page.pageNumber as number;
        const stage = pages[String(pageNumber)] ??
          ((source.stages as string[]).length === 1 ? (source.stages as string[])[0] : null);
        if (stage !== "PD") continue;
        if ((page.quality as Json).disposition === "OCR_REQUIRED") {
          ocrDeferred.push(pageNumber);
          continue;
        }
        textSearched += 1;
        const [thermal, window] = lexicalCues(page);
        if (thermal) thermalCount += 1;
        if (window) windowCount += 1;
        if (thermal && window) candidates.push(pageNumber);
      }
      const selected = candidates.slice(0, remaining);
      remaining -= selected.length;
      const truncated = candidates.length - selected.length;
      const reasons = ["LEXICAL_NAVIGATION_ONLY"];
      if (ocrDeferred.length) reasons.push("OCR_REQUIRED_UNREAD");
      if (truncated) reasons.push("PAGE_SELECTION_TRUNCATED");
      if (!candidates.length) reasons.push("NO_TEXT_LAYER_CANDIDATE");
      rows.push({ ...base, reasonCodes: reasons, reviewEligible: true,
        textSearchedPageCount: textSearched, thermalCuePageCount: thermalCount,
        windowCuePageCount: windowCount, candidatePageCount: candidates.length,
        candidatePageNumbers: candidates, selectedPageNumbers: selected,
        ocrRequiredDeferredPageNumbers: ocrDeferred, truncatedCandidatePageCount: truncated });
    }
    const body = { schemaVersion: SCHEMA, parameterCode: "ZU-127",
      purpose: "REVIEW_ONLY", status: "ABSTAIN", objectId, inputManifestHash,
      maxSelectedPages: MAX_SELECTED_PAGES, sourceRows: rows,
      reviewEligibleSourceCount: rows.filter((row) => row.reviewEligible).length,
      reviewBlockedSourceCount: rows.filter((row) => !row.reviewEligible).length,
      scannedCandidatePageCount: rows.reduce((sum, row) => sum + Number(row.candidatePageCount || 0), 0),
      selectedPageCount: rows.reduce((sum, row) => sum + (row.selectedPageNumbers as number[]).length, 0),
      deferredOcrRequiredPageCount: rows.reduce((sum, row) =>
        sum + ((row.ocrRequiredDeferredPageNumbers as number[] | null)?.length ?? 0), 0),
      truncatedCandidatePageCount: rows.reduce((sum, row) =>
        sum + Number(row.truncatedCandidatePageCount || 0), 0),
      findings: null, findingCount: null, parameterCoverage: null, typedFacts: null,
      absenceConclusion: "NOT_AVAILABLE" };
    return equal(workerResult, { ...body, contentHash: pythonHash(body) });
  } catch {
    return false;
  }
}
