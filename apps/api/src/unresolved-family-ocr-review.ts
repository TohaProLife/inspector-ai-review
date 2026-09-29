import { canonicalJson, sha256 } from "./canonical-json.js";
import { boundedOcrProfileIdV6, validateBoundedOcrV6StageResult,
  type OcrV6ExpectedSource } from "./ocr-layout.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const exact = (value: Json, keys: readonly string[]): boolean =>
  same(Object.keys(value).sort(), [...keys].sort());
// Python's json.dumps(sort_keys=True) sorts keys by code point, unlike localeCompare.
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const codes = ["AR-042", "IOS2-072", "IOS3-075"] as const;
const reasons = new Set(["LEAD_NOT_VERIFIED_FACT", "OCR_TEXT_REQUIRES_VISUAL_REVIEW",
  "SOURCE_REVIEW_REQUIRED", "SOURCE_REVIEW_NOT_CURRENT_APPROVED", "SECTION_NOT_AR_VK",
  "PAGE_STAGE_UNRESOLVED", "SOURCE_TOO_LARGE", "RENDER_PIXEL_LIMIT",
  "PAGE_BUDGET_EXHAUSTED", "OCR_PAGES_DEFERRED", "NO_ELIGIBLE_REVIEWED_SOURCE",
  "NO_EXACT_LINE_LEAD", "LEAD_LIMIT_REACHED", "OCR_BYTE_BUDGET_REACHED"]);
const wordStart = "(?<![\\p{L}\\p{N}_])";
const wordEnd = "(?![\\p{L}\\p{N}_])";
const tail = "[\\p{L}\\p{N}_]*";
const material = new RegExp(`${wordStart}(?:полипропилен${tail}|полиэтилен${tail}|сшит${tail}\\s+полиэтилен${tail}|оцинкован${tail}|чугун${tail}|ВЧШГ|НПВХ|ПВХ|PVC|PE-?X|стальн${tail}|нержавеющ${tail}|медн${tail})${wordEnd}`, "iu");
const pipe = new RegExp(`${wordStart}(?:труб${tail}|трубопровод${tail})${wordEnd}`, "iu");
const supply = new RegExp(`${wordStart}(?:водоснабжен${tail}|водопровод${tail}|В[1-9]|Т3|Т4|ГВС|ХВС)${wordEnd}`, "iu");
const sewer = new RegExp(`${wordStart}(?:канализац${tail}|водоотведен${tail}|К[1-9])${wordEnd}`, "iu");
const arHeight = new RegExp(`высот${tail}`, "iu");
const arObject = new RegExp(`(?:коридор${tail}|про[её]м${tail}|двер${tail})`, "iu");

function lineTrigger(code: string, line: unknown): boolean {
  if (typeof line !== "string" || !line.trim() || Array.from(line).length > 500) return false;
  return code === "AR-042" ? arHeight.test(line) && arObject.test(line)
    : material.test(line) && pipe.test(line)
      && (code === "IOS2-072" ? supply.test(line) : sewer.test(line));
}

export interface UnresolvedFamilyOcrReviewVerificationInput {
  objectId: string;
  inputManifestHash: string;
  expectedSources: OcrV6ExpectedSource[];
  stage: Record<string, unknown>;
  stageHash: string;
  result: unknown;
}

function validLead(code: string, lead: unknown,
  input: UnresolvedFamilyOcrReviewVerificationInput,
  sources: Map<string, OcrV6ExpectedSource>, pages: Map<string, Json>): boolean {
  if (!record(lead) || !exact(lead, ["sourceFileId", "sourceSha256",
    "textArtifactSha256", "ocrStageSha256", "ocrPageSha256", "pageNumber",
    "stage", "sectionCode", "coordinateSystem", "lineIndex", "lineText",
    "score", "bboxPx", "renderSha256", "rendererProfileId", "providerProfileId",
    "providerScript", "dpi", "widthPx", "heightPx", "leadSha256"])
    || typeof lead.sourceFileId !== "string" || !hash(lead.sourceSha256)
    || !hash(lead.textArtifactSha256) || !hash(lead.ocrStageSha256)
    || !hash(lead.ocrPageSha256) || !hash(lead.renderSha256)
    || !hash(lead.leadSha256) || !integer(lead.pageNumber, 1)
    || !integer(lead.lineIndex) || typeof lead.lineText !== "string"
    || !lead.lineText.trim() || Array.from(lead.lineText).length > 500
    || lead.coordinateSystem !== "IMAGE_TOP_LEFT_PIXELS"
    || !["PD", "RD"].includes(String(lead.stage))) return false;
  const { leadSha256: _digest, ...unhashed } = lead;
  if (sha256(workerJson(unhashed)) !== lead.leadSha256) return false;
  const source = sources.get(lead.sourceFileId);
  const review = source?.sourceDecision;
  const page = pages.get(`${lead.sourceFileId}:${lead.pageNumber}`);
  if (!source || !review || !page || source.sha256 !== lead.sourceSha256
    || source.textArtifactSha256 !== lead.textArtifactSha256
    || lead.ocrStageSha256 !== input.stageHash
    || source.sectionCode !== (code === "AR-042" ? "AR" : "VK")
    || lead.sectionCode !== source.sectionCode
    || review.sourceSha256 !== source.sha256
    || review.sectionCode !== source.sectionCode
    || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED"
    || !record(source.textArtifact) || !Array.isArray(source.textArtifact.pages)
    || lead.pageNumber > source.textArtifact.pages.length) return false;
  const textPage = source.textArtifact.pages[lead.pageNumber - 1];
  if (!record(textPage) || textPage.pageNumber !== lead.pageNumber
    || !record(textPage.quality) || textPage.quality.disposition !== "OCR_REQUIRED") return false;
  const stage = review.pageStages[String(lead.pageNumber)]
    ?? (source.stages.length === 1 ? source.stages[0] : undefined);
  if (stage !== lead.stage || !source.stages.includes(stage)) return false;
  if (page.contentHash !== lead.ocrPageSha256 || !Array.isArray(page.lines)
    || !record(page.render) || !record(page.provider)
    || page.sourceFileId !== lead.sourceFileId
    || page.inputSha256 !== lead.sourceSha256 || page.pageNumber !== lead.pageNumber
    || page.render.sha256 !== lead.renderSha256
    || page.render.rendererProfileId !== lead.rendererProfileId
    || page.render.dpi !== lead.dpi || page.render.widthPx !== lead.widthPx
    || page.render.heightPx !== lead.heightPx
    || page.provider.profileId !== lead.providerProfileId
    || page.provider.script !== lead.providerScript) return false;
  const line = page.lines[lead.lineIndex];
  if (!record(line) || line.text !== lead.lineText || line.score !== lead.score
    || !same(line.bboxPx, lead.bboxPx)) return false;
  return lineTrigger(code, lead.lineText);
}

function hasEligibleLine(code: string, sources: Map<string, OcrV6ExpectedSource>,
  pages: Map<string, Json>): boolean {
  for (const page of pages.values()) {
    const source = sources.get(String(page.sourceFileId));
    const review = source?.sourceDecision;
    if (!source || !review || !integer(page.pageNumber, 1)
      || source.sectionCode !== (code === "AR-042" ? "AR" : "VK")
      || review.sourceSha256 !== source.sha256
      || review.sectionCode !== source.sectionCode
      || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED"
      || !record(source.textArtifact) || !Array.isArray(source.textArtifact.pages)) continue;
    const textPage = source.textArtifact.pages[page.pageNumber - 1];
    const stage = review.pageStages[String(page.pageNumber)]
      ?? (source.stages.length === 1 ? source.stages[0] : undefined);
    if (!record(textPage) || textPage.pageNumber !== page.pageNumber
      || !record(textPage.quality) || textPage.quality.disposition !== "OCR_REQUIRED"
      || (stage !== "PD" && stage !== "RD") || !source.stages.includes(stage)
      || !Array.isArray(page.lines)) continue;
    if (page.lines.some((line) => record(line) && lineTrigger(code, line.text))) return true;
  }
  return false;
}

/** Bind review-only OCR line hints to one committed v6 stage and source snapshot. */
export function verifyUnresolvedFamilyOcrReview(
  input: UnresolvedFamilyOcrReviewVerificationInput,
): boolean {
  try {
    const result = input.result;
    if (!record(result) || !exact(result, ["schemaVersion", "profileId", "purpose",
      "objectId", "inputManifestHash", "ocrStageSha256", "sourceStageArtifacts",
      "codeRows", "findingCount", "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "unresolved-family-ocr-review-v1"
      || result.profileId !== "unresolved-family-ocr-review-v1"
      || result.purpose !== "REVIEW_ONLY" || result.objectId !== input.objectId
      || result.inputManifestHash !== input.inputManifestHash
      || result.ocrStageSha256 !== input.stageHash || !hash(input.stageHash)
      || result.findingCount !== null || result.parameterCoverage !== null
      || !hash(result.contentHash) || !Array.isArray(result.sourceStageArtifacts)
      || !Array.isArray(result.codeRows) || result.codeRows.length !== codes.length
      || Buffer.byteLength(workerJson(result), "utf8") > 256 * 1024) return false;
    const { contentHash: _digest, ...unhashed } = result;
    if (sha256(workerJson(unhashed)) !== result.contentHash
      || sha256(canonicalJson(input.stage)) !== input.stageHash
      || !validateBoundedOcrV6StageResult(input.stage, input.inputManifestHash,
        input.objectId, input.expectedSources)) return false;
    if (input.stage.providerProfileId !== boundedOcrProfileIdV6
      || !record(input.stage.analysis) || !Array.isArray(input.stage.analysis.sources)) return false;
    const sources = new Map(input.expectedSources.map((source) => [source.apiId, source]));
    if (sources.size !== input.expectedSources.length) return false;
    const expectedArtifacts = input.expectedSources
      .filter((source) => source.mediaType === "application/pdf")
      .sort((a, b) => a.apiId < b.apiId ? -1 : a.apiId > b.apiId ? 1 : 0)
      .map((source) => ({ sourceFileId: source.apiId, sourceSha256: source.sha256,
        textArtifactSha256: source.textArtifactSha256 }));
    if (!same(result.sourceStageArtifacts, expectedArtifacts)) return false;
    const pages = new Map<string, Json>();
    for (const stageSource of input.stage.analysis.sources) {
      if (!record(stageSource) || !Array.isArray(stageSource.pages)) return false;
      for (const page of stageSource.pages) {
        if (!record(page) || pages.has(`${stageSource.sourceFileId}:${page.pageNumber}`)) return false;
        pages.set(`${stageSource.sourceFileId}:${page.pageNumber}`, page);
      }
    }
    let leadCount = 0;
    for (const [index, code] of codes.entries()) {
      const row = result.codeRows[index];
      if (!record(row) || !exact(row, ["parameterCode", "status", "reasonCodes", "leads"])
        || row.parameterCode !== code || row.status !== "ABSTAIN"
        || !Array.isArray(row.reasonCodes) || !Array.isArray(row.leads)
        || row.leads.length > 16 || row.reasonCodes.length < 1
        || new Set(row.reasonCodes).size !== row.reasonCodes.length
        || row.reasonCodes.some((reason) => !reasons.has(reason))
        || !same(row.reasonCodes, [...row.reasonCodes].sort())
        || !row.reasonCodes.includes("LEAD_NOT_VERIFIED_FACT")
        || !row.reasonCodes.includes("OCR_TEXT_REQUIRES_VISUAL_REVIEW")
        || (row.leads.length === 0 && !row.reasonCodes.includes("NO_EXACT_LINE_LEAD"))
        || (row.leads.length > 0 && (row.reasonCodes.includes("NO_EXACT_LINE_LEAD")
          || row.reasonCodes.includes("NO_ELIGIBLE_REVIEWED_SOURCE")))) return false;
      if (row.leads.length === 0 && hasEligibleLine(code, sources, pages)) return false;
      const seen = new Set<string>();
      for (const lead of row.leads) {
        if (!validLead(code, lead, input, sources, pages) || !record(lead)
          || seen.has(String(lead.leadSha256))) return false;
        seen.add(String(lead.leadSha256));
        leadCount += 1;
      }
    }
    return leadCount <= 48;
  } catch {
    return false;
  }
}
