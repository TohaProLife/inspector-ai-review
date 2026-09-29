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
const codes = ["KR-056", "KR-057", "KR-066"] as const;
const word = "[\\p{L}\\p{N}_]";
const steel = new RegExp(`(?<!${word})[СC]\\s*(?:235|245|255|345|355)(?!${word})`, "iu");
const rebar = new RegExp(`(?<!${word})[АA]\\s*(?:400|500[СC]?)(?!${word})`, "iu");
const steelFull = /^[СC]\s*(?:235|245|255|345|355)$/iu;
const rebarFull = /^[АA]\s*(?:400|500[СC]?)$/iu;
const rating = new RegExp(`(?<!${word})(?:REI|EI|R|ЕI|РЕI)\\s*\\d{2,3}(?!${word})`, "iu");
const fireRequirement = /предел[\p{L}\p{N}_]*\s+огнестойк[\p{L}\p{N}_]*|требован[\p{L}\p{N}_]*\s+(?:к\s+)?огнестойк[\p{L}\p{N}_]*/iu;
const protection = /огнезащит[\p{L}\p{N}_]*/iu;
const protectionDetail = /состав[\p{L}\p{N}_]*|покрыти[\p{L}\p{N}_]*|толщин[\p{L}\p{N}_]*|нанес[\p{L}\p{N}_]*/iu;
const general = /для\s+(?:всех\s+)?(?:железобетонн[\p{L}\p{N}_]*|несущ[\p{L}\p{N}_]*)\s+конструкц[\p{L}\p{N}_]*|общ[\p{L}\p{N}_]*\s+указан[\p{L}\p{N}_]*|арматур[\p{L}\p{N}_]*\s+для\s+железобетонн[\p{L}\p{N}_]*/iu;
const whitespace = /[\s\u001c-\u001f\u0085]+/u;
const normalize = (value: string): string => value.split(whitespace).filter(Boolean).join(" ");
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function pageHasRatingRequirements(page: Json): boolean {
  return fireRequirement.test((page.blocks as Json[]).map((block) => block.text as string).join(" "));
}

function classifyLine(line: string, ratingRequirementPage: boolean): Record<string, string> {
  if (!line.trim() || Array.from(line).length > 500) return {};
  const compact = normalize(line);
  const heading = steelFull.test(compact) || rebarFull.test(compact);
  const materialKind = heading ? "TABLE_HEADING_UNLINKED" : general.test(line)
    ? "GENERAL_REQUIREMENT_UNLINKED"
      : line.toLocaleLowerCase("ru-RU").includes("примечание")
        ? "SHEET_NOTE_UNLINKED" : "ELEMENT_CONTEXT_UNVERIFIED";
  const result: Record<string, string> = {};
  if (steel.test(line)) result["KR-056"] = materialKind;
  if (rebar.test(line)) result["KR-057"] = materialKind;
  const hasProtection = protection.test(line);
  const hasRating = rating.test(line) || fireRequirement.test(line);
  if (hasProtection && hasRating) result["KR-066"] = "FIRE_CONTEXT_AMBIGUOUS";
  else if (hasProtection) result["KR-066"] = protectionDetail.test(line)
    ? "PROTECTION_COMPOSITION_MENTION_UNVERIFIED" : "PROTECTION_MENTION_UNVERIFIED";
  else if (hasRating) result["KR-066"] = ratingRequirementPage
    ? "FIRE_RATING_REQUIREMENT" : "FIRE_RATING_CONTEXT_UNRESOLVED";
  return result;
}

export interface MaterialClassReviewVerificationInput {
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

function validSource(input: MaterialClassReviewVerificationInput,
  source: MaterialClassReviewVerificationInput["sourceFiles"][number]): boolean {
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

function validArtifact(source: MaterialClassReviewVerificationInput["sourceFiles"][number],
  stored: MaterialClassReviewVerificationInput["textArtifacts"][string]): boolean {
  if (!record(stored) || !record(stored.content_json) || !hash(stored.content_hash)
    || sha256(canonicalJson(stored.content_json)) !== stored.content_hash) return false;
  const artifact = stored.content_json;
  if (artifact.schemaVersion !== "document-text-v2"
    || artifact.sourceFileId !== source.sourceFileId
    || artifact.inputSha256 !== source.sha256
    || artifact.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || !["text-layer-quality-v1", "text-layer-quality-v2"]
      .includes(String(artifact.qualityPolicyVersion))
    || !integer(artifact.pageCount, 1) || !Array.isArray(artifact.pages)
    || artifact.pages.length !== artifact.pageCount) return false;
  let textPages = 0;
  let candidatePages = 0;
  for (const [index, page] of artifact.pages.entries()) {
    if (!record(page) || page.pageNumber !== index + 1 || !record(page.quality)
      || !["TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"].includes(String(page.quality.disposition))
      || !integer(page.widthMilliPoints, 1) || !integer(page.heightMilliPoints, 1)
      || !Array.isArray(page.blocks)) return false;
    if (page.blocks.length > 0) textPages += 1;
    if (page.quality.disposition === "TEXT_LAYER_CANDIDATE") candidatePages += 1;
    for (const block of page.blocks) {
      if (!record(block) || typeof block.text !== "string"
        || !Array.isArray(block.bboxMilliPoints)
        || block.bboxMilliPoints.length !== 4
        || !block.bboxMilliPoints.every((number) => integer(number))
        || !(block.bboxMilliPoints[0] <= block.bboxMilliPoints[2]
          && block.bboxMilliPoints[2] <= page.widthMilliPoints
          && block.bboxMilliPoints[1] <= block.bboxMilliPoints[3]
          && block.bboxMilliPoints[3] <= page.heightMilliPoints)) return false;
    }
  }
  return artifact.textPageCount === textPages && record(artifact.qualitySummary)
    && same(artifact.qualitySummary, { textLayerCandidatePageCount: candidatePages,
      ocrRequiredPageCount: artifact.pages.length - candidatePages });
}

/** Rebuild every counter and displayed locator from committed source and text snapshots. */
export function verifyMaterialClassReview(input: MaterialClassReviewVerificationInput): boolean {
  try {
    if (typeof input.objectId !== "string" || !input.objectId.trim()
      || !hash(input.inputManifestHash) || !Array.isArray(input.sourceFiles)
      || !record(input.sourceReviews) || !record(input.textArtifacts)
      || !record(input.result)) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "objectId",
      "inputManifestHash", "sourceStageArtifacts", "codeRows", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "material-class-run-review-v1"
      || result.profileId !== "material-class-text-navigation-v1"
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
        || row.leads.length > 24 || !integer(row.eligibleSourceCount)
        || !integer(row.textCandidatePageCount) || !integer(row.ocrRequiredPageCount)
        || !integer(row.leadCount)) return false;
      const expectedReasons = new Set<string>(["LEXICAL_NAVIGATION_ONLY",
        "ELEMENT_IDENTITY_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED"]);
      const expectedLeads: Json[] = [];
      let eligibleCount = 0;
      let textPageCount = 0;
      let ocrPageCount = 0;
      for (const source of [...sources.values()].sort((a, b) =>
        a.sourceFileId < b.sourceFileId ? -1 : a.sourceFileId > b.sourceFileId ? 1 : 0)) {
        const review = input.sourceReviews[source.sourceFileId];
        if (source.stages.length !== 1 || !["PD", "RD"].includes(source.stages[0])
          || (review && Object.keys(review.pageStages).length !== 0)) {
          expectedReasons.add("SOURCE_STAGE_UNRESOLVED");
          continue;
        }
        if (!review || review.revisionStatus !== "CURRENT"
          || review.approvalStatus !== "APPROVED") {
          expectedReasons.add("SOURCE_REVIEW_REQUIRED");
          continue;
        }
        if (source.sectionCode !== "KR") {
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
          const ratingRequirementPage = pageHasRatingRequirements(page);
          for (const [blockIndex, block] of (page.blocks as Json[]).entries()) {
            const blockText = block.text as string;
            const blockTextSha256 = sha256(blockText);
            for (const [lineIndex, lineText] of lines(blockText).entries()) {
              const kind = classifyLine(lineText, ratingRequirementPage)[code];
              if (!kind) continue;
              const leadBody = { sourceFileId: source.sourceFileId,
                sourceSha256: source.sha256, textArtifactSha256: artifact.hash,
                sourceStage: source.stages[0], sourceRole: "KR_MATERIAL_NAVIGATION",
                pageNumber: page.pageNumber, blockIndex, lineIndex,
                blockTextSha256, lineText, lineTextSha256: sha256(lineText),
                bboxMilliPoints: block.bboxMilliPoints, leadKind: kind,
                elementAssociationStatus: "UNVERIFIED", crossFileMatchStatus: "UNVERIFIED",
                ...(code === "KR-066" ? { actualProtectionStatus: "NOT_ESTABLISHED" } : {}) };
              expectedLeads.push({ ...leadBody, leadSha256: sha256(workerJson(leadBody)) });
            }
          }
        }
      }
      expectedLeads.sort((a, b) =>
        compare(String(a.sourceFileId), String(b.sourceFileId))
        || Number(a.pageNumber) - Number(b.pageNumber)
        || Number(a.blockIndex) - Number(b.blockIndex)
        || Number(a.lineIndex) - Number(b.lineIndex)
        || compare(String(a.lineText), String(b.lineText)));
      if (expectedLeads.length > 24) expectedReasons.add("LEAD_LIMIT_REACHED");
      if (eligibleCount === 0) expectedReasons.add("NO_ELIGIBLE_REVIEWED_SOURCE");
      if (expectedLeads.length === 0) expectedReasons.add("NO_EXACT_LINE_LEAD");
      if (row.eligibleSourceCount !== eligibleCount
        || row.textCandidatePageCount !== textPageCount
        || row.ocrRequiredPageCount !== ocrPageCount
        || row.leadCount !== expectedLeads.length
        || !same(row.reasonCodes, [...expectedReasons].sort())
        || !same(row.leads, expectedLeads.slice(0, 24))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
