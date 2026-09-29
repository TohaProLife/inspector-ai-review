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
const codes = ["IOS4-077", "IOS4-079", "PPM-112"] as const;
const radiator = /радиатор[\p{L}\p{N}_]*|(?<![\p{L}\p{N}_])PRADO\s+Classic(?![\p{L}\p{N}_])/iu;
const fan = /вентилятор[\p{L}\p{N}_]*/iu;
const smoke = /дымоудален[\p{L}\p{N}_]*|противодым[\p{L}\p{N}_]*|подпор[\p{L}\p{N}_]*/iu;
const registerDocument = /(?:АНО|РД)[/-][\p{L}\p{N}_.\-/]{5,}/giu;
const calculation = /расч[её]т\s+системы|потери\s+давления|об[ъь]емн[\p{L}\p{N}_]*\s+расход\s+вентилятора|давление\s+вентилятора/iu;
const position = /(?<![\p{L}\p{N}_])позици[яи](?![\p{L}\p{N}_])/iu;
const technicalName = /наименование\s+и\s+техническая\s+характеристика/iu;
const quantity = /количеств|коли-\s*чество/iu;
const whitespace = /[\s\u001c-\u001f\u0085]+/u;
const normalize = (value: string): string => value.split(whitespace).filter(Boolean).join(" ");
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function pageContext(page: Json): { kind: string; smokeContext: boolean } {
  const text = (page.blocks as Json[]).map((block) => block.text as string).join("\n");
  const flat = normalize(text);
  const register = flat.includes("Содержание изменения")
    || [...text.matchAll(registerDocument)].length >= 3;
  const schedule = position.test(flat) && technicalName.test(flat) && quantity.test(flat);
  const kind = register ? "REGISTER_PROSE" : calculation.test(flat) ? "CALCULATION_PROSE"
    : schedule ? "SCHEDULE_TOKEN" : "CONTEXT_UNRESOLVED";
  return { kind, smokeContext: smoke.test(text) };
}

function lineCodes(line: string, context: string, smokeContext: boolean): string[] {
  if (!line.trim() || Array.from(line).length > 500) return [];
  const selected: string[] = [];
  if (radiator.test(line) && (context === "SCHEDULE_TOKEN"
    || line.toLocaleLowerCase("ru-RU").includes("радиатор"))) selected.push("IOS4-077");
  if (smoke.test(line)) selected.push("PPM-112");
  else if (fan.test(line)) {
    if (context === "CALCULATION_PROSE" && smokeContext) selected.push("PPM-112");
    else if (!smokeContext) selected.push("IOS4-079");
  }
  return selected;
}

export interface EquipmentSpecReviewVerificationInput {
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

function validSource(input: EquipmentSpecReviewVerificationInput,
  source: EquipmentSpecReviewVerificationInput["sourceFiles"][number]): boolean {
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

function validArtifact(source: EquipmentSpecReviewVerificationInput["sourceFiles"][number],
  stored: EquipmentSpecReviewVerificationInput["textArtifacts"][string]): boolean {
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
export function verifyEquipmentSpecReview(input: EquipmentSpecReviewVerificationInput): boolean {
  try {
    if (typeof input.objectId !== "string" || !input.objectId.trim()
      || !hash(input.inputManifestHash) || !Array.isArray(input.sourceFiles)
      || !record(input.sourceReviews) || !record(input.textArtifacts)
      || !record(input.result)) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "objectId",
      "inputManifestHash", "sourceStageArtifacts", "codeRows", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "equipment-spec-run-review-v1"
      || result.profileId !== "equipment-spec-text-navigation-v1"
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
        "ROW_ASSOCIATION_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED"]);
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
        if (source.sectionCode !== "OV") {
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
          const context = pageContext(page);
          for (const [blockIndex, block] of (page.blocks as Json[]).entries()) {
            const blockText = block.text as string;
            const blockTextSha256 = sha256(blockText);
            for (const [lineIndex, lineText] of lines(blockText).entries()) {
              if (!lineCodes(lineText, context.kind, context.smokeContext).includes(code)) continue;
              const leadBody = { sourceFileId: source.sourceFileId,
                sourceSha256: source.sha256, textArtifactSha256: artifact.hash,
                sourceStage: source.stages[0], sourceRole: "OV_EQUIPMENT_NAVIGATION",
                pageNumber: page.pageNumber, blockIndex, lineIndex,
                blockTextSha256, lineText, lineTextSha256: sha256(lineText),
                bboxMilliPoints: block.bboxMilliPoints, leadKind: context.kind,
                rowAssociationStatus: "UNVERIFIED", systemAssignmentStatus: "UNVERIFIED" };
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
