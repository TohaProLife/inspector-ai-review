import { canonicalJson, sha256 } from "./canonical-json.js";

type Json = Record<string, unknown>;
type Box = [number, number, number, number];
type Block = { text: string; bboxMilliPoints: Box };
type Page = { pageNumber: number; quality: { disposition: string }; blocks: Block[] };
type Line = { blockIndex: number; lineIndex: number; line: string; normalized: string;
  box: Box; block: Block };
type Source = LayerAssemblyVerificationInput["sourceFiles"][number];
const codes = ["SPZU-032", "AR-044", "ZU-125"] as const;
const sections: Record<string, string[]> = { "SPZU-032": ["GP", "SPZU"],
  "AR-044": ["AR"], "ZU-125": ["AR", "ZU"] };
const roofHeading = /^(?:конструкция\s+кровли\s*:?|(?:не)?эксплуатируемая\s+кровля(?=$|[^\p{L}\p{N}_]).{0,105})$/iu;
const explicitRoof = /^конструкция\s+кровли\s*:?$/iu;
const typeLabel = /^тип\s*\d+[а-я]?$/iu;
const roofMaterial = /филизол|техноэласт|мембран|пароизоляц|руф\s+баттс/iu;
const wallMaterial = /минераловат|rockwool|утеплит/iu;
const pureThickness = /^\d{1,3}(?:[.,]\d+)?\s*мм$/iu;
const scopeBreak = /цоколь|конструкция\s+кровли|конструкции\s+дорожных/iu;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const normalize = (value: string): string => value.trim().split(/\s+/u).join(" ");
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const exact = (value: Json, fields: readonly string[]): boolean =>
  same(Object.keys(value).sort(), [...fields].sort());
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

// Python worker canonical hashes sort object keys by code point before UTF-8 encoding.
function workerJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const workerHash = (value: unknown): string => sha256(workerJson(value));

export interface LayerAssemblyVerificationInput {
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

function validSource(input: LayerAssemblyVerificationInput, source: Source): boolean {
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
  stored: LayerAssemblyVerificationInput["textArtifacts"][string]): boolean {
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

function lines(text: string): string[] {
  if (!text) return [];
  const parts = text.split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}
function lineRecords(page: Page): Line[] {
  return page.blocks.flatMap((block, blockIndex) => lines(block.text)
    .map((line, lineIndex) => ({ blockIndex, lineIndex, line,
      normalized: normalize(line), box: block.bboxMilliPoints, block })));
}
function locator(item: Line): Json {
  return { blockIndex: item.blockIndex, lineIndex: item.lineIndex,
    lineText: item.line, lineTextSha256: sha256(item.line),
    blockTextSha256: sha256(item.block.text), bboxMilliPoints: item.box };
}
function safe(records: Line[], pattern: RegExp): [Line[], number] {
  const hits = records.filter((item) => pattern.test(item.normalized));
  return [hits.filter((item) => Array.from(item.line).length <= 160),
    hits.filter((item) => Array.from(item.line).length > 160).length];
}
function above(heading: Line, item: Line, gap: number): boolean {
  return heading.box[1] - item.box[3] >= 0
    && heading.box[1] - item.box[3] <= gap
    && Math.abs(heading.box[0] - item.box[0]) <= 300_000;
}
function rowOverlap(left: Line, right: Line): boolean {
  const overlap = Math.min(left.box[3], right.box[3]) - Math.max(left.box[1], right.box[1]);
  return left.box[2] < right.box[0] && right.box[0] <= left.box[2] + 250_000
    && overlap > 0 && 2 * overlap >= Math.min(left.box[3] - left.box[1],
      right.box[3] - right.box[1]);
}
function abstain(reasonCode: string, anchor: Line): Json {
  return { reasonCode, anchor: locator(anchor) };
}

function pageProposals(page: Page, code: string): [Json[], Json[], number] {
  const records = lineRecords(page);
  const proposals: Json[] = [];
  const abstentions: Json[] = [];
  if (code === "SPZU-032") return [proposals, abstentions, 0];
  if (code === "AR-044") {
    const [headings, overHeading] = safe(records, roofHeading);
    const explicit = headings.filter((item) => explicitRoof.test(item.normalized));
    const [materials, overMaterial] = safe(records, roofMaterial);
    for (const heading of headings) proposals.push({
      proposalKind: "ROOF_HEADING_NAVIGATION", rowAssociationStatus: "UNVERIFIED",
      typeAssociationStatus: "UNVERIFIED", zoneAssociationStatus: "UNVERIFIED",
      rawThickness: null, rawQuantity: null, roles: { heading: locator(heading) } });
    const [types] = safe(records, typeLabel);
    const [depths] = safe(records, pureThickness);
    for (const material of materials) {
      const scoped = explicit.filter((heading) => above(heading, material, 240_000));
      if (scoped.length !== 1) continue;
      const heading = scoped[0];
      const candidates = types.filter((typ) => above(heading, typ, 180_000)
        && above(typ, material, 140_000));
      if (candidates.length !== 1) {
        abstentions.push(abstain("ROOF_TYPE_CONTEXT_AMBIGUOUS", material));
        continue;
      }
      const nearby = depths.filter((depth) => rowOverlap(material, depth));
      const reverse = materials.filter((other) => nearby.length > 0
        && rowOverlap(other, nearby[0]));
      if (nearby.length !== 1 || reverse.length !== 1) {
        abstentions.push(abstain("MATERIAL_THICKNESS_ROW_UNVERIFIED", material));
        continue;
      }
      proposals.push({ proposalKind: "ROOF_MATERIAL_THICKNESS_NEIGHBORHOOD",
        rowAssociationStatus: "UNVERIFIED", typeAssociationStatus: "UNVERIFIED",
        zoneAssociationStatus: "UNVERIFIED", rawThickness: null, rawQuantity: null,
        roles: { heading: locator(heading), type: locator(candidates[0]),
          material: locator(material), thickness: locator(nearby[0]) } });
    }
    return [proposals, abstentions, overHeading + overMaterial];
  }
  if (code !== "ZU-125") throw new Error("unsupported layer assembly code");
  const [materials, oversize] = safe(records, wallMaterial);
  const [types] = safe(records, typeLabel);
  const [depths] = safe(records, pureThickness);
  const boundaries = records.filter((item) => scopeBreak.test(item.normalized));
  for (const material of materials) {
    const preceding = types.filter((typ) => above(typ, material, 200_000))
      .sort((a, b) => a.box[1] - b.box[1]);
    if (!preceding.length) {
      abstentions.push(abstain("WALL_TYPE_CONTEXT_UNVERIFIED", material));
      continue;
    }
    const typ = preceding[0];
    if (boundaries.some((item) => explicitRoof.test(item.normalized)
      && item.box[1] > typ.box[3]
      && item.box[1] - typ.box[3] <= 160_000)) {
      abstentions.push(abstain("ROOF_TYPE_NOT_WALL_TYPE", material));
      continue;
    }
    if (boundaries.some((item) => typ.box[1] > item.box[1]
      && item.box[1] > material.box[3])) {
      abstentions.push(abstain("SECTION_BOUNDARY_BETWEEN_TYPE_AND_LAYER", material));
      continue;
    }
    const nearby = depths.filter((depth) => rowOverlap(material, depth));
    const reverse = materials.filter((other) => nearby.length > 0
      && rowOverlap(other, nearby[0]));
    if (nearby.length !== 1 || reverse.length !== 1) {
      abstentions.push(abstain("MATERIAL_THICKNESS_ROW_UNVERIFIED", material));
      continue;
    }
    proposals.push({ proposalKind: "WALL_MATERIAL_THICKNESS_NEIGHBORHOOD",
      rowAssociationStatus: "UNVERIFIED", typeAssociationStatus: "UNVERIFIED",
      zoneAssociationStatus: "UNVERIFIED", rawThickness: null, rawQuantity: null,
      roles: { type: locator(typ), material: locator(material), thickness: locator(nearby[0]) } });
  }
  return [proposals, abstentions, oversize];
}

/** Rebuild every review-only proposal from committed text and source-review snapshots. */
export function verifyLayerAssemblyProposals(input: LayerAssemblyVerificationInput): boolean {
  try {
    if (typeof input.objectId !== "string" || !input.objectId.trim()
      || !hash(input.inputManifestHash) || !Array.isArray(input.sourceFiles)
      || !record(input.sourceReviews) || !record(input.textArtifacts)
      || !record(input.result)) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "objectId",
      "inputManifestHash", "sourceStageArtifacts", "codeRows", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "layer-assembly-proposals-v1"
      || result.profileId !== "layer-assembly-review-v1"
      || result.purpose !== "REVIEW_ONLY" || result.objectId !== input.objectId
      || result.inputManifestHash !== input.inputManifestHash
      || result.findingCount !== null || result.parameterCoverage !== null
      || !hash(result.contentHash) || !Array.isArray(result.sourceStageArtifacts)
      || !Array.isArray(result.codeRows) || result.codeRows.length !== codes.length
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
    const collected = Object.fromEntries(codes.map((code) => [code, {
      proposals: [] as Json[], abstentions: [] as Json[], eligible: 0,
      textPages: 0, ocrPages: 0, oversize: 0,
      reasons: new Set(["REVIEW_ONLY_NOT_TYPED_FACT", "ROW_ASSOCIATION_UNVERIFIED",
        "TYPE_OR_ZONE_LINK_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED"]) }]));
    collected["SPZU-032"].reasons.add("EXISTING_SITE_GP_TABLE_ROW_REVIEW");
    for (const source of [...sources.values()].sort((a, b) => compare(a.sourceFileId, b.sourceFileId))) {
      const eligibleCodes = codes.filter((code) => sections[code].includes(source.sectionCode ?? ""));
      const review = input.sourceReviews[source.sourceFileId];
      if (!review || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED") {
        for (const code of codes) collected[code].reasons.add("SOURCE_REVIEW_REQUIRED");
        continue;
      }
      if (!same(source.stages, ["PD"]) || Object.keys(review.pageStages).length > 0) {
        for (const code of codes) collected[code].reasons.add("SOURCE_STAGE_UNRESOLVED");
        continue;
      }
      for (const code of codes) if (!eligibleCodes.includes(code))
        collected[code].reasons.add("SOURCE_ROLE_NOT_ALLOWED");
      const artifact = artifacts.get(source.sourceFileId);
      if (!artifact) {
        for (const code of eligibleCodes) collected[code].reasons.add("TEXT_ARTIFACT_MISSING");
        continue;
      }
      for (const code of eligibleCodes) collected[code].eligible += 1;
      for (const page of artifact.content.pages as Page[]) {
        for (const code of eligibleCodes) {
          const row = collected[code];
          if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") {
            row.ocrPages += 1;
            row.reasons.add("OCR_REQUIRED_DEFERRED");
            continue;
          }
          row.textPages += 1;
          const [proposals, abstentions, oversize] = pageProposals(page, code);
          row.oversize += oversize;
          if (oversize) row.reasons.add("OVERSIZE_ANCHOR_LINE_DEFERRED");
          for (const [key, items] of [["proposals", proposals],
            ["abstentions", abstentions]] as const) for (const item of items) {
            const scoped = { sourceFileId: source.sourceFileId,
              sourceSha256: source.sha256, textArtifactSha256: artifact.hash,
              pageSha256: workerHash(page), pageNumber: page.pageNumber,
              sourceStage: "PD", sourceSection: source.sectionCode, ...item };
            row[key].push({ ...scoped, scopedSha256: workerHash(scoped) });
          }
        }
      }
    }
    for (const [index, code] of codes.entries()) {
      const row = collected[code];
      const proposals = row.proposals.sort((a, b) => compare(String(a.sourceFileId), String(b.sourceFileId))
        || Number(a.pageNumber) - Number(b.pageNumber)
        || compare(String(a.proposalKind), String(b.proposalKind))
        || compare(String(a.scopedSha256), String(b.scopedSha256)));
      const abstentions = row.abstentions.sort((a, b) => compare(String(a.sourceFileId), String(b.sourceFileId))
        || Number(a.pageNumber) - Number(b.pageNumber)
        || compare(String(a.reasonCode), String(b.reasonCode))
        || compare(String(a.scopedSha256), String(b.scopedSha256)));
      const proposalCount = proposals.length;
      const abstentionCount = abstentions.length;
      if (proposalCount > 16) row.reasons.add("PROPOSAL_LIMIT_REACHED");
      if (abstentionCount > 16) row.reasons.add("ABSTENTION_LIMIT_REACHED");
      if (row.eligible === 0) row.reasons.add("NO_ELIGIBLE_REVIEWED_SOURCE");
      if (code !== "SPZU-032" && proposalCount === 0) row.reasons.add(row.textPages
        ? "NO_SAFE_PROPOSAL_IN_SCANNED_TEXT" : "NO_SCANNED_TEXT_IN_SCOPE");
      const expected = { parameterCode: code, status: "ABSTAIN",
        reasonCodes: [...row.reasons].sort(), eligibleSourceCount: row.eligible,
        textCandidatePageCount: row.textPages, ocrRequiredPageCount: row.ocrPages,
        oversizeAnchorLineCount: row.oversize, proposalCount,
        truncatedProposalCount: Math.max(0, proposalCount - 16), abstentionCount,
        truncatedAbstentionCount: Math.max(0, abstentionCount - 16),
        absenceConclusion: "NOT_AVAILABLE", proposals: proposals.slice(0, 16),
        abstentions: abstentions.slice(0, 16) };
      if (!same(result.codeRows[index], expected)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
