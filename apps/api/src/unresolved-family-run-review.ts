import { canonicalJson, sha256 } from "./canonical-json.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const exact = (value: Json, keys: string[]): boolean =>
  same(Object.keys(value).sort(), [...keys].sort());
const codes = ["AR-042", "IOS2-072", "IOS3-075"] as const;
const reasons = new Set(["SOURCE_REVIEW_REQUIRED", "DRAWING_SECTION_UNRESOLVED",
  "SOURCE_STAGE_UNRESOLVED", "TEXT_ARTIFACT_MISSING", "OCR_REQUIRED_IN_SCOPE",
  "NO_EXACT_LINE_LEAD", "LEAD_NOT_VERIFIED_FACT", "LEAD_LIMIT_REACHED",
  "NO_ELIGIBLE_REVIEWED_SOURCE"]);
const wordStart = "(?<![\\p{L}\\p{N}_])";
const wordEnd = "(?![\\p{L}\\p{N}_])";
const tail = "[\\p{L}\\p{N}_]*";
const material = new RegExp(`${wordStart}(?:полипропилен${tail}|полиэтилен${tail}|сшит${tail}\\s+полиэтилен${tail}|оцинкован${tail}|чугун${tail}|ВЧШГ|НПВХ|ПВХ|PVC|PE-?X|стальн${tail}|нержавеющ${tail}|медн${tail})${wordEnd}`, "iu");
const pipe = new RegExp(`${wordStart}(?:труб${tail}|трубопровод${tail})${wordEnd}`, "iu");
const supply = new RegExp(`${wordStart}(?:водоснабжен${tail}|водопровод${tail}|В[1-9]|Т3|Т4|ГВС|ХВС)${wordEnd}`, "iu");
const sewer = new RegExp(`${wordStart}(?:канализац${tail}|водоотведен${tail}|К[1-9])${wordEnd}`, "iu");
const arHeight = new RegExp(`высот${tail}`, "iu");
const arObject = new RegExp(`(?:коридор${tail}|про[её]м${tail}|двер${tail})`, "iu");

export interface UnresolvedFamilyReviewVerificationInput {
  objectId: string;
  inputManifestHash: string;
  sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
    stages: string[]; sourceReviewHash: string | null; sectionCode: string | null }>;
  sourceReviews: Record<string, { sourceSha256: string; revisionStatus: string;
    approvalStatus: string; pageStages: Record<string, string>;
    contentHash: string; decisionHash: string }>;
  textArtifacts: Record<string, { content_json: unknown; content_hash: string }>;
  result: unknown;
}

function lines(text: string): string[] {
  return text.split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u);
}

function validLead(code: string, lead: unknown,
  input: UnresolvedFamilyReviewVerificationInput,
  sourceMap: Map<string, UnresolvedFamilyReviewVerificationInput["sourceFiles"][number]>): boolean {
  if (!record(lead) || !exact(lead, ["sourceFileId", "sourceSha256",
    "textArtifactSha256", "pageNumber", "blockIndex", "lineIndex", "lineText",
    "blockTextSha256", "bboxMilliPoints", "leadSha256"])
    || typeof lead.sourceFileId !== "string" || !hash(lead.sourceSha256)
    || !hash(lead.textArtifactSha256) || !hash(lead.blockTextSha256)
    || !hash(lead.leadSha256) || !integer(lead.pageNumber, 1)
    || !integer(lead.blockIndex) || !integer(lead.lineIndex)
    || typeof lead.lineText !== "string" || !lead.lineText.trim()
    || Array.from(lead.lineText).length > 500) return false;
  const { leadSha256: _digest, ...unhashed } = lead;
  if (sha256(canonicalJson(unhashed)) !== lead.leadSha256) return false;
  const source = sourceMap.get(lead.sourceFileId);
  const review = input.sourceReviews[lead.sourceFileId];
  const stored = input.textArtifacts[lead.sourceFileId];
  if (!source || source.objectId !== input.objectId || source.sha256 !== lead.sourceSha256
    || !review || review.sourceSha256 !== source.sha256
    || review.contentHash !== review.decisionHash
    || review.contentHash !== source.sourceReviewHash
    || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED"
    || source.sectionCode !== (code === "AR-042" ? "AR" : "VK")
    || !stored || stored.content_hash !== lead.textArtifactSha256
    || !record(stored.content_json)
    || sha256(canonicalJson(stored.content_json)) !== stored.content_hash
    || stored.content_json.schemaVersion !== "document-text-v2"
    || stored.content_json.sourceFileId !== source.sourceFileId
    || stored.content_json.inputSha256 !== source.sha256
    || !Array.isArray(stored.content_json.pages)) return false;
  const artifact = stored.content_json;
  const pages = artifact.pages as unknown[];
  if (pages.length !== artifact.pageCount
    || lead.pageNumber > pages.length) return false;
  const page = pages[lead.pageNumber - 1];
  if (!record(page) || page.pageNumber !== lead.pageNumber || !record(page.quality)
    || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
    || !Array.isArray(page.blocks)) return false;
  const resolvedStage = source.stages.length === 1
    ? Object.keys(review.pageStages).length === 0 ? source.stages[0] : null
    : Object.keys(review.pageStages).length === pages.length
      ? review.pageStages[String(lead.pageNumber)] : null;
  if (resolvedStage !== "PD" && resolvedStage !== "RD") return false;
  const block = page.blocks[lead.blockIndex];
  if (!record(block) || typeof block.text !== "string"
    || sha256(block.text) !== lead.blockTextSha256
    || !same(block.bboxMilliPoints, lead.bboxMilliPoints)
    || !Array.isArray(lead.bboxMilliPoints) || lead.bboxMilliPoints.length !== 4
    || !lead.bboxMilliPoints.every((n) => integer(n))) return false;
  const line = lines(block.text)[lead.lineIndex];
  if (line !== lead.lineText) return false;
  return code === "AR-042" ? arHeight.test(line) && arObject.test(line)
    : material.test(line) && pipe.test(line)
      && (code === "IOS2-072" ? supply.test(line) : sewer.test(line));
}

/** Verify untrusted lexical review against committed run text and reviewed source scope. */
export function verifyUnresolvedFamilyRunReview(input: UnresolvedFamilyReviewVerificationInput): boolean {
  try {
    const result = input.result;
    if (!record(result) || !exact(result, ["schemaVersion", "profileId", "purpose",
      "objectId", "inputManifestHash", "sourceStageArtifacts", "codeRows",
      "findingCount", "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "unresolved-family-run-review-v1"
      || result.profileId !== "unresolved-family-text-review-v1"
      || result.purpose !== "REVIEW_ONLY" || result.objectId !== input.objectId
      || result.inputManifestHash !== input.inputManifestHash
      || result.findingCount !== null || result.parameterCoverage !== null
      || !hash(result.contentHash) || !Array.isArray(result.sourceStageArtifacts)
      || !Array.isArray(result.codeRows) || result.codeRows.length !== codes.length
      || Buffer.byteLength(canonicalJson(result), "utf8") > 256 * 1024) return false;
    const { contentHash: _digest, ...unhashed } = result;
    if (sha256(canonicalJson(unhashed)) !== result.contentHash) return false;
    const sources = new Map(input.sourceFiles.map((source) => [source.sourceFileId, source]));
    if (sources.size !== input.sourceFiles.length) return false;
    const expectedArtifacts = Object.entries(input.textArtifacts)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([sourceFileId, artifact]) => ({ sourceFileId,
        sourceSha256: sources.get(sourceFileId)?.sha256,
        textArtifactSha256: artifact.content_hash }));
    if (!same(result.sourceStageArtifacts, expectedArtifacts)) return false;
    for (const [sourceId, artifact] of Object.entries(input.textArtifacts)) {
      const source = sources.get(sourceId);
      if (!source || !record(artifact.content_json)
        || artifact.content_json.schemaVersion !== "document-text-v2"
        || artifact.content_json.sourceFileId !== sourceId
        || artifact.content_json.inputSha256 !== source.sha256
        || sha256(canonicalJson(artifact.content_json)) !== artifact.content_hash) return false;
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
        || !row.reasonCodes.includes("LEAD_NOT_VERIFIED_FACT")
        || (row.leads.length === 0 && !row.reasonCodes.includes("NO_EXACT_LINE_LEAD"))) return false;
      const seen = new Set<string>();
      for (const lead of row.leads) {
        if (!validLead(code, lead, input, sources) || !record(lead)
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
