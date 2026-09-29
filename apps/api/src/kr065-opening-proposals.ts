import { canonicalJson, sha256 } from "./canonical-json.js";

type Json = Record<string, unknown>;
type Box = [number, number, number, number];
type Block = { text: string; bboxMilliPoints: Box };
type Page = { pageNumber: number; quality: { disposition: string }; blocks: Block[] };
type Source = Kr065OpeningVerificationInput["sourceFiles"][number];
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const exact = (value: Json, fields: readonly string[]): boolean =>
  same(Object.keys(value).sort(), [...fields].sort());
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const workerHash = (value: unknown): string => sha256(workerJson(value));

export interface Kr065OpeningVerificationInput {
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

function validSource(input: Kr065OpeningVerificationInput, source: Source): boolean {
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
      /^[1-9][0-9]*$/u.test(page) && (stage === "UNRESOLVED" || source.stages.includes(stage)));
}

function quality(blocks: Block[], policyVersion: string): Json {
  const text = blocks.map((block) => block.text).join("\n");
  let nonWhitespaceCharacterCount = 0;
  let alphanumericCharacterCount = 0;
  let replacementCharacterCount = 0;
  let disallowedControlCharacterCount = 0;
  for (const character of text) {
    if (!/^[\t\n\v\f\r\u001c-\u001f\u0085]$/u.test(character)
      && !/[\p{Zs}\p{Zl}\p{Zp}]/u.test(character)) nonWhitespaceCharacterCount += 1;
    if (/[\p{L}\p{N}]/u.test(character)) alphanumericCharacterCount += 1;
    if (character === "\uFFFD") replacementCharacterCount += 1;
    if (/\p{Cc}/u.test(character) && !["\n", "\r", "\t"].includes(character)) {
      disallowedControlCharacterCount += 1;
    }
  }
  const reasonCodes: string[] = [];
  if (nonWhitespaceCharacterCount === 0) reasonCodes.push("EMPTY_TEXT_LAYER");
  else {
    if (alphanumericCharacterCount === 0) reasonCodes.push("NO_ALPHANUMERIC_TEXT");
    if (replacementCharacterCount > 0 || disallowedControlCharacterCount > 0
      || policyVersion === "text-layer-quality-v2" && /\(cid:[0-9]+\)/u.test(text)) {
      reasonCodes.push("TEXT_DECODING_ANOMALY");
    }
  }
  return { disposition: reasonCodes.length ? "OCR_REQUIRED" : "TEXT_LAYER_CANDIDATE",
    reasonCodes, metrics: { blockCount: blocks.length, nonWhitespaceCharacterCount,
      alphanumericCharacterCount, replacementCharacterCount,
      disallowedControlCharacterCount } };
}

function validArtifact(source: Source,
  stored: Kr065OpeningVerificationInput["textArtifacts"][string]): boolean {
  if (!record(stored) || !record(stored.content_json) || !hash(stored.content_hash)
    || sha256(canonicalJson(stored.content_json)) !== stored.content_hash
    || Buffer.byteLength(workerJson(stored.content_json), "utf8") > 64 * 1024 * 1024) return false;
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
        || !Array.isArray(block.bboxMilliPoints) || block.bboxMilliPoints.length !== 4
        || !block.bboxMilliPoints.every((n) => integer(n))
        || block.bboxMilliPoints[0] > block.bboxMilliPoints[2]
        || block.bboxMilliPoints[2] > page.widthMilliPoints
        || block.bboxMilliPoints[1] > block.bboxMilliPoints[3]
        || block.bboxMilliPoints[3] > page.heightMilliPoints) return false;
    }
    if (!same(page.quality, quality(page.blocks as Block[], artifact.qualityPolicyVersion as string))) {
      return false;
    }
  }
  return artifact.textPageCount === textPages && record(artifact.qualitySummary)
    && same(artifact.qualitySummary, { textLayerCandidatePageCount: candidatePages,
      ocrRequiredPageCount: artifact.pages.length - candidatePages });
}

const opening = /(?:обрамлени[ея]|монтажн[\p{L}\p{N}_]*\s+про[её]м|отверсти[яе])/iu;
const number = /№\s*(\d{1,4})(?![\p{L}\p{N}_])/gu;
const dimension = /(?<!\d)(\d{2,5})\s*[xх×]\s*(\d{2,5})(?:\s*\(h\))?\s*мм(?=$|[^\p{L}\p{N}_])/giu;
const closure = /деталь\s+заделки\s+монтажного\s+про[её]ма(?=$|[^\p{L}\p{N}_])/iu;
const detail = /деталь\s+\d{1,3}(?=$|[^\p{L}\p{N}_])/iu;

function lines(text: string): string[] {
  if (!text) return [];
  const parts = text.split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}
function locator(block: Block, blockIndex: number, line: string, lineIndex: number): Json {
  return { blockIndex, lineIndex, lineText: line,
    lineTextSha256: sha256(line), blockTextSha256: sha256(block.text),
    bboxMilliPoints: block.bboxMilliPoints };
}
function proposal(proposalKind: string, anchor: Json,
  rawOpeningNumber: string | null, rawDimensionsText: string | null): Json {
  return { proposalKind, rawOpeningNumber, rawDimensionsText,
    rawAxes: null, rawLevel: null, drawingContourAssociation: "UNVERIFIED",
    detailAssociation: "UNVERIFIED", sameElementAssociation: "UNVERIFIED",
    reinforcementStatus: "NOT_ESTABLISHED",
    unauthorizedFillStatus: "NOT_ESTABLISHED", anchor };
}
function pageProposals(page: Page): { proposals: Json[]; abstentions: Json[];
  oversize: number; duplicates: number } {
  const proposals: Json[] = [];
  const abstentions: Json[] = [];
  let oversize = 0;
  let duplicates = 0;
  const seenLabels = new Set<string>();
  const seenHeadings = new Set<string>();
  for (const [blockIndex, block] of page.blocks.entries()) {
    for (const [lineIndex, line] of lines(block.text).entries()) {
      if (!opening.test(line) && !closure.test(line) && !detail.test(line)) continue;
      if (Array.from(line).length > 180) { oversize += 1; continue; }
      const anchor = locator(block, blockIndex, line, lineIndex);
      if (closure.test(line)) {
        const key = `closure:${line}`;
        if (seenHeadings.has(key)) {
          duplicates += 1;
          abstentions.push({ reasonCode: "DUPLICATE_HEADING_CONTEXT_UNVERIFIED", anchor });
        }
        seenHeadings.add(key);
        proposals.push(proposal("DESIGNED_CLOSURE_HEADING_NAVIGATION", anchor, null, null));
        continue;
      }
      if (opening.test(line)) {
        const numbers = [...line.matchAll(number)].map((match) => match[1]);
        const dimensions = [...line.matchAll(dimension)];
        if (numbers.length === 1 && dimensions.length === 1) {
          const rawDimension = dimensions[0][0];
          const key = JSON.stringify([numbers[0], rawDimension, line]);
          if (seenLabels.has(key)) {
            duplicates += 1;
            abstentions.push({ reasonCode: "DUPLICATE_OPENING_LABEL", anchor });
            continue;
          }
          seenLabels.add(key);
          proposals.push(proposal("OPENING_LABEL_DIMENSION_NAVIGATION", anchor,
            numbers[0], rawDimension));
        } else if (numbers.length || dimensions.length) {
          abstentions.push({ reasonCode: "OPENING_LABEL_AMBIGUOUS", anchor });
        }
        continue;
      }
      const key = `detail:${line}`;
      if (seenHeadings.has(key)) {
        duplicates += 1;
        abstentions.push({ reasonCode: "DUPLICATE_HEADING_CONTEXT_UNVERIFIED", anchor });
      }
      seenHeadings.add(key);
      proposals.push(proposal("DETAIL_HEADING_NAVIGATION", anchor, null, null));
    }
  }
  return { proposals, abstentions, oversize, duplicates };
}

/** Rebuild KR-065 navigation from immutable text and reviewed source snapshots. */
export function verifyKr065OpeningProposals(input: Kr065OpeningVerificationInput): boolean {
  try {
    if (typeof input.objectId !== "string" || !input.objectId.trim()
      || !hash(input.inputManifestHash) || !Array.isArray(input.sourceFiles)
      || !record(input.sourceReviews) || !record(input.textArtifacts)
      || !record(input.result)) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "objectId",
      "inputManifestHash", "sourceStageArtifacts", "codeRows", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "kr065-opening-proposals-v1"
      || result.profileId !== "kr065-opening-review-v1"
      || result.purpose !== "REVIEW_ONLY" || result.objectId !== input.objectId
      || result.inputManifestHash !== input.inputManifestHash
      || result.findingCount !== null || result.parameterCoverage !== null
      || !hash(result.contentHash) || !Array.isArray(result.sourceStageArtifacts)
      || !Array.isArray(result.codeRows) || result.codeRows.length !== 1
      || Buffer.byteLength(workerJson(result), "utf8") > 256 * 1024) return false;
    const { contentHash: _digest, ...unhashed } = result;
    if (workerHash(unhashed) !== result.contentHash) return false;
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
    const expectedArtifacts = [...artifacts.entries()].sort(([a], [b]) => compare(a, b))
      .map(([sourceId, artifact]) => ({ sourceFileId: sourceId,
        sourceSha256: sources.get(sourceId)!.sha256, textArtifactSha256: artifact.hash }));
    if (!same(result.sourceStageArtifacts, expectedArtifacts)) return false;
    const proposals: Json[] = [];
    const abstentions: Json[] = [];
    const reasons = new Set(["REVIEW_ONLY_NOT_TYPED_FACT", "CONTOUR_ASSOCIATION_UNVERIFIED",
      "PD_RD_PAIR_UNVERIFIED", "SAME_ELEMENT_UNVERIFIED"]);
    let eligible = 0;
    let textPages = 0;
    let ocrPages = 0;
    let oversize = 0;
    let duplicates = 0;
    for (const source of [...sources.values()].sort((a, b) => compare(a.sourceFileId, b.sourceFileId))) {
      const review = input.sourceReviews[source.sourceFileId];
      if (!review || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED") {
        reasons.add("SOURCE_REVIEW_REQUIRED");
        continue;
      }
      if (!same(source.stages, ["RD"]) || Object.keys(review.pageStages).length > 0) {
        reasons.add("SOURCE_STAGE_UNRESOLVED");
        continue;
      }
      if (source.sectionCode !== "KR") {
        reasons.add("SOURCE_ROLE_NOT_ALLOWED");
        continue;
      }
      const artifact = artifacts.get(source.sourceFileId);
      if (!artifact) { reasons.add("TEXT_ARTIFACT_MISSING"); continue; }
      eligible += 1;
      for (const page of artifact.content.pages as Page[]) {
        if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") {
          ocrPages += 1;
          reasons.add("OCR_REQUIRED_DEFERRED");
          continue;
        }
        textPages += 1;
        const local = pageProposals(page);
        oversize += local.oversize;
        duplicates += local.duplicates;
        for (const [items, destination] of [[local.proposals, proposals],
          [local.abstentions, abstentions]] as const) for (const item of items) {
          const scoped = { sourceFileId: source.sourceFileId,
            sourceSha256: source.sha256, textArtifactSha256: artifact.hash,
            pageSha256: workerHash(page), pageNumber: page.pageNumber,
            sourceStage: "RD", sourceSection: "KR", ...item };
          destination.push({ ...scoped, scopedSha256: workerHash(scoped) });
        }
      }
    }
    const byAnchor = (a: Json, b: Json) => compare(String(a.sourceFileId), String(b.sourceFileId))
      || Number(a.pageNumber) - Number(b.pageNumber)
      || Number((a.anchor as Json).blockIndex) - Number((b.anchor as Json).blockIndex)
      || Number((a.anchor as Json).lineIndex) - Number((b.anchor as Json).lineIndex)
      || compare(String(a.scopedSha256), String(b.scopedSha256));
    proposals.sort(byAnchor);
    abstentions.sort(byAnchor);
    if (proposals.length > 16) reasons.add("PROPOSAL_LIMIT_REACHED");
    if (abstentions.length > 16) reasons.add("ABSTENTION_LIMIT_REACHED");
    if (oversize) reasons.add("OVERSIZE_ANCHOR_LINE_DEFERRED");
    if (duplicates) reasons.add("DUPLICATE_ANCHOR_DEFERRED");
    if (eligible === 0) reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE");
    if (!proposals.length) reasons.add(textPages
      ? "NO_SAFE_PROPOSAL_IN_SCANNED_TEXT" : "NO_SCANNED_TEXT_IN_SCOPE");
    const expected = { parameterCode: "KR-065", status: "ABSTAIN",
      reasonCodes: [...reasons].sort(), eligibleSourceCount: eligible,
      textCandidatePageCount: textPages, ocrRequiredPageCount: ocrPages,
      oversizeAnchorLineCount: oversize, duplicateAnchorCount: duplicates,
      proposalCount: proposals.length,
      truncatedProposalCount: Math.max(0, proposals.length - 16),
      abstentionCount: abstentions.length,
      truncatedAbstentionCount: Math.max(0, abstentions.length - 16),
      absenceConclusion: "NOT_AVAILABLE",
      proposals: proposals.slice(0, 16), abstentions: abstentions.slice(0, 16) };
    return same(result.codeRows[0], expected);
  } catch {
    return false;
  }
}
