import { canonicalJson, sha256 } from "./canonical-json.js";

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
// Python json.dumps(sort_keys=True) sorts keys by code point.
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const codes = ["SPZU-029", "SPZU-032", "SPZU-033", "SPZU-035", "SPZU-036"] as const;
const reasons = new Set(["LEAD_NOT_VERIFIED_FACT", "SOURCE_REVIEW_REQUIRED",
  "DRAWING_SECTION_UNRESOLVED", "SOURCE_STAGE_UNRESOLVED",
  "OCR_REQUIRED_IN_SCOPE", "TEXT_ARTIFACT_MISSING",
  "NO_ELIGIBLE_REVIEWED_SOURCE", "NO_EXACT_LINE_LEAD", "LEAD_LIMIT_REACHED",
  "MAF_ITEM_IDENTITY_UNVERIFIED", "ROAD_LAYER_COMPOSITION_UNVERIFIED",
  "SLOPE_GEOMETRY_UNVERIFIED", "ZONE_INTERSECTION_UNVERIFIED",
  "FENCE_TYPE_HEIGHT_UNVERIFIED"]);
const wordEnd = "(?![\\p{L}\\p{N}_])";
const labels: Record<string, RegExp> = {
  "SPZU-029": /^\s*(?:ведомость|спецификация)\s+(?:малых\s+архитектурных\s+форм|МАФ)\s*$/iu,
  "SPZU-032": /^\s*\.?\s*конструкци[яи]\s+дорожн(?:ой|ых)\s+одежд(?:ы)?(?:\s*\([^)]{1,80}\))?\s*$/iu,
  "SPZU-033": new RegExp(`^\\s*план\\s+организации\\s+рельефа${wordEnd}.{0,240}$`, "iu"),
  "SPZU-035": /^\s*(?:границы\s+охранных\s+зон(?:\s+.{1,120})?|охранная\s+зона\s+.{1,120})\s*$/iu,
  "SPZU-036": new RegExp(`^\\s*(?:(?:шумозащитное\\s+)?ограждение\\s+территории|ограждения\\s+высотой\\s+\\d+(?:[.,]\\d+)?\\s*м${wordEnd}.{0,120})\\s*$`, "iu"),
};
const semanticGates: Record<string, string> = {
  "SPZU-029": "MAF_ITEM_IDENTITY_UNVERIFIED",
  "SPZU-032": "ROAD_LAYER_COMPOSITION_UNVERIFIED",
  "SPZU-033": "SLOPE_GEOMETRY_UNVERIFIED",
  "SPZU-035": "ZONE_INTERSECTION_UNVERIFIED",
  "SPZU-036": "FENCE_TYPE_HEIGHT_UNVERIFIED",
};

export interface SiteGpContextReviewVerificationInput {
  objectId: string;
  inputManifestHash: string;
  sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
    stages: string[]; sourceReviewHash: string | null; sectionCode: string | null }>;
  sourceReviews: Record<string, { sourceSha256: string; revisionStatus: string;
    approvalStatus: string; sectionCode: string | null; pageStages: Record<string, string>;
    contentHash: string; decisionHash: string }>;
  textArtifacts: Record<string, { content_json: unknown; content_hash: string }>;
  result: unknown;
}

function lines(text: string): string[] {
  return text.split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u);
}

function validSource(input: SiteGpContextReviewVerificationInput,
  source: SiteGpContextReviewVerificationInput["sourceFiles"][number]): boolean {
  if (typeof source.sourceFileId !== "string" || !source.sourceFileId
    || source.objectId !== input.objectId || !hash(source.sha256)
    || !Array.isArray(source.stages) || source.stages.length < 1
    || new Set(source.stages).size !== source.stages.length
    || source.stages.some((stage) => !["PD", "RD", "ID"].includes(stage))) return false;
  const review = input.sourceReviews[source.sourceFileId];
  if (!review) return source.sourceReviewHash === null && source.sectionCode === null;
  return hash(source.sourceReviewHash) && source.sourceReviewHash === review.contentHash
    && review.contentHash === review.decisionHash
    && review.sourceSha256 === source.sha256
    && review.sectionCode === source.sectionCode
    && ["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(review.revisionStatus)
    && ["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(review.approvalStatus)
    && record(review.pageStages)
    && Object.entries(review.pageStages).every(([page, stage]) =>
      /^[1-9][0-9]*$/u.test(page)
        && (stage === "UNRESOLVED" || source.stages.includes(stage)));
}

function validArtifact(source: SiteGpContextReviewVerificationInput["sourceFiles"][number],
  stored: SiteGpContextReviewVerificationInput["textArtifacts"][string]): boolean {
  if (!record(stored) || !record(stored.content_json) || !hash(stored.content_hash)
    || sha256(canonicalJson(stored.content_json)) !== stored.content_hash) return false;
  const artifact = stored.content_json;
  if (artifact.schemaVersion !== "document-text-v2"
    || artifact.sourceFileId !== source.sourceFileId
    || artifact.inputSha256 !== source.sha256
    || !integer(artifact.pageCount, 1) || !Array.isArray(artifact.pages)
    || artifact.pages.length !== artifact.pageCount) return false;
  for (const [index, page] of artifact.pages.entries()) {
    if (!record(page) || page.pageNumber !== index + 1 || !record(page.quality)
      || !["TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"].includes(String(page.quality.disposition))
      || !Array.isArray(page.blocks)) return false;
    for (const block of page.blocks) {
      if (!record(block) || typeof block.text !== "string"
        || !Array.isArray(block.bboxMilliPoints)
        || block.bboxMilliPoints.length !== 4
        || !block.bboxMilliPoints.every((number) => integer(number))) return false;
    }
  }
  return true;
}

/** Rebuild every counter and displayed locator from committed source and text snapshots. */
export function verifySiteGpContextReview(input: SiteGpContextReviewVerificationInput): boolean {
  try {
    if (typeof input.objectId !== "string" || !input.objectId.trim()
      || !hash(input.inputManifestHash) || !Array.isArray(input.sourceFiles)
      || !record(input.sourceReviews) || !record(input.textArtifacts)
      || !record(input.result)) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "objectId",
      "inputManifestHash", "sourceStageArtifacts", "codeRows", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "site-gp-context-run-review-v1"
      || result.profileId !== "site-gp-context-text-review-v1"
      || result.purpose !== "REVIEW_ONLY" || result.objectId !== input.objectId
      || result.inputManifestHash !== input.inputManifestHash
      || result.findingCount !== null || result.parameterCoverage !== null
      || !hash(result.contentHash) || !Array.isArray(result.sourceStageArtifacts)
      || !Array.isArray(result.codeRows) || result.codeRows.length !== codes.length
      || Buffer.byteLength(workerJson(result), "utf8") > 256 * 1024) return false;
    const { contentHash: _digest, ...unhashed } = result;
    if (sha256(workerJson(unhashed)) !== result.contentHash) return false;
    const sources = new Map(input.sourceFiles.map((source) => [source.sourceFileId, source]));
    if (sources.size !== input.sourceFiles.length
      || input.sourceFiles.some((source) => !validSource(input, source))
      || Object.keys(input.sourceReviews).some((sourceId) => !sources.has(sourceId))) return false;
    const artifacts = new Map<string, { content: Json; hash: string }>();
    for (const [sourceId, stored] of Object.entries(input.textArtifacts)) {
      const source = sources.get(sourceId);
      if (!source || !validArtifact(source, stored)) return false;
      artifacts.set(sourceId, { content: stored.content_json as Json, hash: stored.content_hash });
    }
    const expectedArtifacts = [...artifacts.entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([sourceId, artifact]) => ({ sourceFileId: sourceId,
        sourceSha256: sources.get(sourceId)!.sha256, textArtifactSha256: artifact.hash }));
    if (!same(result.sourceStageArtifacts, expectedArtifacts)) return false;
    for (const [index, code] of codes.entries()) {
      const row = result.codeRows[index];
      if (!record(row) || !exact(row, ["parameterCode", "status", "reasonCodes",
        "eligibleSourceCount", "textCandidatePageCount", "ocrRequiredPageCount",
        "leadCount", "leads"])
        || row.parameterCode !== code || row.status !== "ABSTAIN"
        || !Array.isArray(row.reasonCodes) || !Array.isArray(row.leads)
        || row.reasonCodes.some((reason) => !reasons.has(reason))
        || row.leads.length > 16 || !integer(row.eligibleSourceCount)
        || !integer(row.textCandidatePageCount) || !integer(row.ocrRequiredPageCount)
        || !integer(row.leadCount)) return false;
      const expectedReasons = new Set<string>(["LEAD_NOT_VERIFIED_FACT", semanticGates[code]]);
      const expectedLeads: Json[] = [];
      let eligibleCount = 0;
      let textPageCount = 0;
      let ocrPageCount = 0;
      for (const source of [...sources.values()].sort((a, b) =>
        a.sourceFileId < b.sourceFileId ? -1 : a.sourceFileId > b.sourceFileId ? 1 : 0)) {
        const review = input.sourceReviews[source.sourceFileId];
        if (source.stages.length !== 1 || source.stages[0] !== "PD"
          || (review && Object.keys(review.pageStages).length !== 0)) {
          expectedReasons.add("SOURCE_STAGE_UNRESOLVED");
          continue;
        }
        if (!review || review.revisionStatus !== "CURRENT"
          || review.approvalStatus !== "APPROVED") {
          expectedReasons.add("SOURCE_REVIEW_REQUIRED");
          continue;
        }
        if (source.sectionCode !== "GP") {
          expectedReasons.add("DRAWING_SECTION_UNRESOLVED");
          continue;
        }
        const artifact = artifacts.get(source.sourceFileId);
        if (!artifact) {
          expectedReasons.add("TEXT_ARTIFACT_MISSING");
          continue;
        }
        eligibleCount += 1;
        for (const page of artifact.content.pages as Json[]) {
          if ((page.quality as Json).disposition !== "TEXT_LAYER_CANDIDATE") {
            ocrPageCount += 1;
            expectedReasons.add("OCR_REQUIRED_IN_SCOPE");
            continue;
          }
          textPageCount += 1;
          for (const [blockIndex, block] of (page.blocks as Json[]).entries()) {
            const blockText = block.text as string;
            const blockTextSha256 = sha256(blockText);
            for (const [lineIndex, lineText] of lines(blockText).entries()) {
              if (Array.from(lineText).length > 500 || !labels[code].test(lineText)) continue;
              const leadBody = { sourceFileId: source.sourceFileId,
                sourceSha256: source.sha256, textArtifactSha256: artifact.hash,
                pageNumber: page.pageNumber, blockIndex, lineIndex, lineText,
                blockTextSha256, bboxMilliPoints: block.bboxMilliPoints,
                sourceRole: "PD_GP_CONTEXT" };
              expectedLeads.push({ ...leadBody, leadSha256: sha256(workerJson(leadBody)) });
            }
          }
        }
      }
      expectedLeads.sort((a, b) =>
        String(a.sourceFileId) < String(b.sourceFileId) ? -1
          : String(a.sourceFileId) > String(b.sourceFileId) ? 1
            : Number(a.pageNumber) - Number(b.pageNumber)
        || Number(a.blockIndex) - Number(b.blockIndex)
        || Number(a.lineIndex) - Number(b.lineIndex)
        || (String(a.lineText) < String(b.lineText) ? -1
          : String(a.lineText) > String(b.lineText) ? 1 : 0));
      if (expectedLeads.length > 16) expectedReasons.add("LEAD_LIMIT_REACHED");
      if (eligibleCount === 0) expectedReasons.add("NO_ELIGIBLE_REVIEWED_SOURCE");
      if (expectedLeads.length === 0) expectedReasons.add("NO_EXACT_LINE_LEAD");
      if (row.eligibleSourceCount !== eligibleCount
        || row.textCandidatePageCount !== textPageCount
        || row.ocrRequiredPageCount !== ocrPageCount
        || row.leadCount !== expectedLeads.length
        || !same(row.reasonCodes, [...expectedReasons].sort())
        || !same(row.leads, expectedLeads.slice(0, 16))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
