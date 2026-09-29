import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewPolicy } from "./pilot-rules.js";
import {
  candidateFamilyPreviewSections, candidateFamilyPreviewSpecs,
  validNumericLine, verifyCandidateFamilyPreview,
  type CandidateFamilyPreviewVerificationInput,
} from "./candidate-family-preview.js";
import { stageContent, verifiedPage, type OcrHeatStageEnvelope } from "./ocr-heat-row-proposals.js";

/** OCR coordinates stay review-only and separate from typed PDF-text facts. */
export interface CandidateFamilyOcrObservationsVerificationInput
  extends Omit<CandidateFamilyPreviewVerificationInput, "result"> {
  preview: unknown;
  ocrStage: OcrHeatStageEnvelope;
  result: unknown;
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const same = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);
// Python worker uses json.dumps(sort_keys=True), which sorts keys by code point.
// localeCompare in the API's legacy canonicalJson orders renderSha256 differently.
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const exact = (value: Json, fields: readonly string[]): boolean =>
  same(Object.keys(value).sort(), [...fields].sort());
const resultFields = ["schemaVersion", "inputManifestHash", "objectId", "scope", "purpose",
  "ocrArtifactSha256", "candidateRulePackSha256", "numericLabelPackSha256",
  "classLabelPackSha256", "presenceLabelPackSha256", "codeRows", "findingCount",
  "parameterCoverage", "outputCount", "contentHash"] as const;
const rowFields = ["parameterCode", "family", "ruleId", "status", "reasonCodes",
  "eligibleSourceCount", "ocrProcessedPageCount", "ocrDeferredPageCount", "leadCount",
  "candidateLeads"] as const;
const leadFields = ["schemaVersion", "status", "purpose", "parameterCode", "family",
  "attribute", "canonicalUnit", "matchedLabel", "rawValue", "rawUnit", "featureKey",
  "scopeTokens", "sourceFileId", "sourceSha256", "ocrArtifactSha256", "ocrPageSha256",
  "objectId", "inputManifestHash", "stage", "sectionCode", "revisionStatus",
  "approvalStatus", "pageNumber", "coordinateSystem", "lineText", "locator", "leadSha256"] as const;
const locatorFields = ["kind", "lineIndex", "start", "end", "bboxPx", "score",
  "renderSha256", "rendererProfileId", "providerProfileId", "providerScript", "dpi",
  "widthPx", "heightPx"] as const;
const numericFamilies = new Set(["DECREASE", "INCREASE", "DIFFERENT", "RELATIVE_DELTA",
  "RELATIVE_INCREASE", "LOWER_BOUND", "UPPER_BOUND"]);

function sourceStage(input: CandidateFamilyOcrObservationsVerificationInput,
  source: CandidateFamilyOcrObservationsVerificationInput["sourceFiles"][number],
  pageNumber: number): "PD" | "RD" | null {
  const review = input.sourceReviews[source.sourceFileId];
  if (!review || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED"
    || review.sourceSha256 !== source.sha256 || review.contentHash !== source.sourceReviewHash
    || source.sectionCode == null) return null;
  if (source.stages.length === 1) {
    return source.stages[0] === "PD" || source.stages[0] === "RD" ? source.stages[0] : null;
  }
  const stage = review.pageStages[String(pageNumber)];
  return stage === "PD" || stage === "RD" ? stage : null;
}

function validLead(lead: unknown, row: Json, input: CandidateFamilyOcrObservationsVerificationInput,
  pages: Map<string, Json>): boolean {
  if (!record(lead) || !exact(lead, leadFields) || !record(lead.locator)
    || !exact(lead.locator, locatorFields) || !hash(lead.leadSha256)
    || !count(lead.pageNumber) || lead.pageNumber === 0
    || !count(lead.locator.lineIndex) || !count(lead.locator.start)
    || !count(lead.locator.end) || lead.locator.end <= lead.locator.start) return false;
  const code = String(row.parameterCode);
  const spec = candidateFamilyPreviewSpecs[code];
  const source = input.sourceFiles.find((item) => item.sourceFileId === lead.sourceFileId);
  if (!spec || !source || !hash(lead.sourceSha256) || lead.sourceSha256 !== source.sha256
    || lead.schemaVersion !== "candidate-family-ocr-lead-v1" || lead.status !== "CANDIDATE"
    || lead.purpose !== "REVIEW_ONLY" || lead.parameterCode !== code
    || lead.family !== row.family || spec.attributes[String(lead.attribute)] !== lead.canonicalUnit
    || lead.objectId !== input.objectId || lead.inputManifestHash !== input.inputManifestHash
    || lead.ocrArtifactSha256 !== (input.result as Json).ocrArtifactSha256
    || !hash(lead.ocrPageSha256) || lead.coordinateSystem !== "IMAGE_TOP_LEFT_PIXELS"
    || lead.revisionStatus !== "CURRENT" || lead.approvalStatus !== "APPROVED"
    || lead.sectionCode !== source.sectionCode || !["PD", "RD"].includes(String(lead.stage))
    || sourceStage(input, source, lead.pageNumber as number) !== lead.stage
    || !candidateFamilyPreviewSections[code][lead.stage as "PD" | "RD"].includes(String(source.sectionCode))
    || lead.locator.kind !== "DOCUMENT_OCR_LINE" || typeof lead.lineText !== "string"
    || typeof lead.matchedLabel !== "string" || typeof lead.rawValue !== "string"
    || lead.rawValue.length === 0 || lead.rawValue.length > 500) return false;
  if (row.family === "PRESENCE_SET") {
    if (typeof lead.featureKey !== "string" || !lead.featureKey
      || !Array.isArray(lead.scopeTokens) || lead.scopeTokens.length > 8
      || lead.rawUnit !== null) return false;
  } else if (lead.featureKey !== null || lead.scopeTokens !== null) return false;
  const page = pages.get(`${source.sourceFileId}:${lead.pageNumber}`);
  if (!page || page.contentHash !== lead.ocrPageSha256 || !Array.isArray(page.lines)
    || !record(page.render) || !record(page.provider)) return false;
  const line = page.lines[lead.locator.lineIndex as number];
  if (!record(line) || typeof line.text !== "string" || line.text !== lead.lineText
    || !same(line.bboxPx, lead.locator.bboxPx) || line.score !== lead.locator.score
    || !count(page.render.widthPx) || !count(page.render.heightPx)
    || lead.locator.renderSha256 !== page.render.sha256
    || lead.locator.rendererProfileId !== page.render.rendererProfileId
    || lead.locator.providerProfileId !== page.provider.profileId
    || lead.locator.providerScript !== page.provider.script
    || lead.locator.dpi !== page.render.dpi
    || lead.locator.widthPx !== page.render.widthPx
    || lead.locator.heightPx !== page.render.heightPx) return false;
  const chars = Array.from(line.text);
  if (lead.locator.end > chars.length
    || chars.slice(lead.locator.start as number, lead.locator.end as number).join("")
      !== lead.rawValue) return false;
  const normalize = (value: string) => value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  const label = normalize(lead.matchedLabel);
  const normalizedLine = normalize(line.text);
  const labelStart = normalizedLine.indexOf(label);
  if (labelStart < 0 || (row.family === "PRESENCE_SET"
    ? labelStart !== lead.locator.start
    : labelStart >= (lead.locator.start as number)
      || normalizedLine.slice(0, labelStart).trim().length !== 0)) return false;
  if (numericFamilies.has(String(row.family))
    && !validNumericLine(lead, line.text, lead.locator.start as number)) return false;
  const { leadSha256: _ignored, ...unhashed } = lead;
  return sha256(workerJson(unhashed)) === lead.leadSha256;
}

/** Independently bind worker OCR hints to one immutable, reviewed run snapshot. */
export function verifyCandidateFamilyOcrObservations(
  input: CandidateFamilyOcrObservationsVerificationInput,
): boolean {
  try {
    if (!verifyCandidateFamilyPreview({ ...input, result: input.preview })
      || !record(input.result) || !exact(input.result, resultFields)
      || input.result.schemaVersion !== "candidate-family-ocr-observations-v1"
      || input.result.inputManifestHash !== input.inputManifestHash
      || input.result.objectId !== input.objectId || input.result.scope !== "RUN_COMMITTED_OCR"
      || input.result.purpose !== "REVIEW_ONLY" || !hash(input.result.ocrArtifactSha256)
      || !hash(input.result.contentHash) || input.result.findingCount !== null
      || input.result.parameterCoverage !== null || input.result.outputCount !== 47
      || !Array.isArray(input.result.codeRows) || input.result.codeRows.length !== 47
      || Buffer.byteLength(canonicalJson(input.result), "utf8") > 1024 * 1024) return false;
    for (const key of ["candidateRulePackSha256", "numericLabelPackSha256",
      "classLabelPackSha256", "presenceLabelPackSha256"] as const) {
      if (input.result[key] !== candidateFamilyPreviewPolicy[key]) return false;
    }
    const { contentHash: _ignored, ...unhashed } = input.result;
    if (sha256(workerJson(unhashed)) !== input.result.contentHash) return false;
    const content = stageContent(input.ocrStage, input.inputManifestHash);
    if (!content || sha256(canonicalJson(content)) !== input.result.ocrArtifactSha256
      || !record(content.analysis) || content.analysis.objectId !== input.objectId
      || !Array.isArray(content.analysis.sources)
      || content.analysis.sources.length !== input.sourceFiles.length) return false;
    const pages = new Map<string, Json>();
    const ocrSources = new Map<string, Json>();
    let requiredTotal = 0;
    let processedTotal = 0;
    let deferredTotal = 0;
    let unsupportedTotal = 0;
    for (const raw of content.analysis.sources) {
      if (!record(raw) || typeof raw.sourceFileId !== "string"
        || typeof raw.sourceSha256 !== "string" || ocrSources.has(raw.sourceFileId)
        || !Array.isArray(raw.pages) || !count(raw.ocrRequiredPageCount)
        || !count(raw.processedPageCount) || !count(raw.deferredPageCount)
        || raw.pages.length !== raw.processedPageCount
        || raw.processedPageCount + raw.deferredPageCount !== raw.ocrRequiredPageCount) return false;
      const source = input.sourceFiles.find((item) => item.sourceFileId === raw.sourceFileId);
      if (!source || source.sha256 !== raw.sourceSha256) return false;
      ocrSources.set(raw.sourceFileId, raw);
      const text = input.textArtifacts[raw.sourceFileId]?.content_json;
      if (raw.mediaType === "application/pdf") {
        if (!record(text) || !record(text.qualitySummary)
          || text.pageCount !== raw.pageCount
          || text.qualitySummary.ocrRequiredPageCount !== raw.ocrRequiredPageCount) return false;
      } else if (raw.mediaType !== "text/plain" || text !== undefined
        || raw.pageCount !== null || raw.ocrRequiredPageCount !== 0
        || raw.processedPageCount !== 0 || raw.deferredPageCount !== 0
        || raw.status !== "SKIPPED_UNSUPPORTED_FORMAT") return false;
      if (raw.mediaType !== "application/pdf") unsupportedTotal += 1;
      requiredTotal += raw.ocrRequiredPageCount as number;
      processedTotal += raw.processedPageCount as number;
      deferredTotal += raw.deferredPageCount as number;
      for (const rawPage of raw.pages) {
        const page = verifiedPage(rawPage, raw.sourceFileId, raw.sourceSha256);
        if (!page || !record(text) || !Array.isArray(text.pages)
          || !record(text.pages[page.pageNumber - 1])
          || !record(text.pages[page.pageNumber - 1].quality)
          || text.pages[page.pageNumber - 1].quality.disposition !== "OCR_REQUIRED") return false;
        const key = `${raw.sourceFileId}:${page.pageNumber}`;
        if (pages.has(key)) return false;
        pages.set(key, page as unknown as Json);
      }
    }
    if (ocrSources.size !== input.sourceFiles.length
      || content.analysis.ocrRequiredPageCount !== requiredTotal
      || content.analysis.processedPageCount !== processedTotal
      || content.analysis.deferredPageCount !== deferredTotal
      || content.analysis.skippedUnsupportedSourceCount !== unsupportedTotal) return false;
    const preview = input.preview as Json;
    let totalLeads = 0;
    for (const [index, row] of input.result.codeRows.entries()) {
      const expected = (preview.codeRows as unknown[])[index];
      if (!record(row) || !record(expected) || !exact(row, rowFields)
        || row.parameterCode !== expected.parameterCode || row.family !== expected.family
        || row.ruleId !== expected.ruleId || row.status !== "ABSTAIN"
        || !count(row.eligibleSourceCount) || !count(row.ocrProcessedPageCount)
        || !count(row.ocrDeferredPageCount) || !count(row.leadCount)
        || !Array.isArray(row.candidateLeads) || row.candidateLeads.length !== row.leadCount
        || row.candidateLeads.length > 16 || !Array.isArray(row.reasonCodes)
        || row.reasonCodes.some((reason) => typeof reason !== "string" || !reason)
        || !same(row.reasonCodes, [...new Set(row.reasonCodes)].sort())) return false;
      const sections = candidateFamilyPreviewSections[String(row.parameterCode)];
      if (!sections) return false;
      let eligibleSources = 0;
      let processedPages = 0;
      let deferredPages = 0;
      for (const source of input.sourceFiles) {
        const review = input.sourceReviews[source.sourceFileId];
        const text = input.textArtifacts[source.sourceFileId]?.content_json;
        const ocr = ocrSources.get(source.sourceFileId);
        const matching = source.stages.filter((stage) =>
          (stage === "PD" || stage === "RD")
          && sections[stage].includes(String(source.sectionCode)));
        if (!matching.length || !review || review.revisionStatus !== "CURRENT"
          || review.approvalStatus !== "APPROVED" || !record(text)
          || !count(text.pageCount) || !ocr) continue;
        if (source.stages.length > 1
          && Object.keys(review.pageStages).length !== text.pageCount) continue;
        eligibleSources += 1;
        deferredPages += ocr.deferredPageCount as number;
        for (const page of ocr.pages as Json[]) {
          const stage = source.stages.length === 1 ? source.stages[0]
            : review.pageStages[String(page.pageNumber)];
          if (matching.includes(stage)) processedPages += 1;
        }
      }
      if (row.eligibleSourceCount !== eligibleSources
        || row.ocrProcessedPageCount !== processedPages
        || row.ocrDeferredPageCount !== deferredPages) return false;
      for (const lead of row.candidateLeads) {
        if (!validLead(lead, row, input, pages)) return false;
        totalLeads += 1;
      }
    }
    return totalLeads <= 47 * 16;
  } catch {
    return false;
  }
}
