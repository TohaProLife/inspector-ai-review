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
const codes = ["SPZU-029", "SPZU-032"] as const;
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
type Block = { text: string; bboxMilliPoints: number[] };
const roadHeading = /^конструкции\s+дорожных\s+одежд\s*\([^)]{1,80}\)$/iu;
const mafHeading = /^ведомость\s+малых\s+архитектурных\s+форм$/iu;
const typeLabel = /^тип\s*\d+[а-я]?$/iu;
const numberLabel = /^\d+(?:[.,]\d+)?$/u;
const positionLabel = /^\d{1,3}$/u;
const cyrillic = /[А-Яа-яЁё]/u;
const normalize = (value: string): string => value.trim().split(/\s+/u).join(" ");
const lower = (value: string): string => value.toLocaleLowerCase("ru-RU");
const box = (block: Block): number[] => block.bboxMilliPoints;
const role = (index: number, block: Block) => ({ blockIndex: index,
  blockText: block.text, blockTextSha256: sha256(block.text),
  bboxMilliPoints: block.bboxMilliPoints });
const overlap = (left: number[], right: number[]): boolean => {
  const amount = Math.min(left[3], right[3]) - Math.max(left[1], right[1]);
  return amount > 0 && amount * 2 >= Math.min(left[3] - left[1], right[3] - right[1]);
};
const inSection = (item: number[], top: number, bottom: number): boolean =>
  bottom <= item[1] && item[3] < top;
function uniqueHeader(blocks: Block[], titleIndex: number, floor: number,
  label: string, xMin?: number, xMax?: number): number | null {
  const title = box(blocks[titleIndex]);
  const hits = blocks.flatMap((block, index) => {
    const area = box(block);
    return inSection(area, title[1], floor)
      && title[1] - area[3] <= 80_000
      && (xMin === undefined || area[0] >= xMin)
      && (xMax === undefined || area[0] <= xMax)
      && lower(normalize(block.text)) === lower(label) ? [index] : [];
  });
  return hits.length === 1 ? hits[0] : null;
}
function abstention(reasonCode: string, index: number, blocks: Block[]): Json {
  const body = { reasonCode, anchor: role(index, blocks[index]) };
  return { ...body, abstentionSha256: sha256(workerJson(body)) };
}
function proposal(body: Json): Json {
  return { ...body, adjacencyEvidenceSha256: sha256(workerJson(body)) };
}

function roadPage(blocks: Block[]): { proposals: Json[]; abstentions: Json[] } {
  const proposals: Json[] = [];
  const abstentions: Json[] = [];
  const headings = blocks.flatMap((block, index) =>
    roadHeading.test(normalize(block.text)) ? [index] : [])
    .sort((a, b) => box(blocks[b])[3] - box(blocks[a])[3]);
  for (const [offset, heading] of headings.entries()) {
    const title = box(blocks[heading]);
    const floor = offset + 1 < headings.length ? box(blocks[headings[offset + 1]])[3] : 0;
    const construction = uniqueHeader(blocks, heading, floor, "Конструкция");
    const thickness = uniqueHeader(blocks, heading, floor, "Толщина слоя, м");
    const typeHeader = uniqueHeader(blocks, heading, floor, "Тип");
    if (construction === null || thickness === null || typeHeader === null) {
      abstentions.push(abstention("ROAD_TABLE_HEADERS_AMBIGUOUS", heading, blocks));
      continue;
    }
    const constructBox = box(blocks[construction]);
    const thickBox = box(blocks[thickness]);
    const typeBox = box(blocks[typeHeader]);
    if (!(typeBox[0] < constructBox[0] && constructBox[0] < thickBox[0])) {
      abstentions.push(abstention("ROAD_TABLE_COLUMNS_AMBIGUOUS", heading, blocks));
      continue;
    }
    const excluded = new Set([heading, construction, thickness, typeHeader]);
    const materials = blocks.flatMap((block, index) => {
      const area = box(block);
      return !excluded.has(index) && inSection(area, constructBox[1], floor)
        && constructBox[0] <= area[0] && area[2] < thickBox[0]
        && cyrillic.test(block.text) && Array.from(block.text).length <= 600 ? [index] : [];
    });
    const depths = blocks.flatMap((block, index) => {
      const area = box(block);
      return !excluded.has(index) && inSection(area, thickBox[1], floor)
        && thickBox[0] <= area[0] && numberLabel.test(normalize(block.text)) ? [index] : [];
    });
    const byMaterial = new Map<number, number[]>();
    const byDepth = new Map<number, number[]>();
    for (const material of materials) for (const depth of depths) {
      if (!overlap(box(blocks[material]), box(blocks[depth]))) continue;
      byMaterial.set(material, [...(byMaterial.get(material) ?? []), depth]);
      byDepth.set(depth, [...(byDepth.get(depth) ?? []), material]);
    }
    for (const depth of depths) {
      const matches = byDepth.get(depth) ?? [];
      if (matches.length !== 1 || (byMaterial.get(matches[0]) ?? []).length !== 1) {
        abstentions.push(abstention("ROAD_LAYER_ALIGNMENT_AMBIGUOUS", depth, blocks));
        continue;
      }
      const material = matches[0];
      proposals.push(proposal({ proposalKind: "ROAD_LAYER_THICKNESS_ADJACENCY",
        rowAssociationStatus: "UNVERIFIED", reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"],
        unitInterpretationStatus: "UNVERIFIED", assemblyTypeStatus: "UNRESOLVED",
        roles: { roadHeading: role(heading, blocks[heading]),
          unitHeader: role(thickness, blocks[thickness]),
          material: role(material, blocks[material]),
          thickness: role(depth, blocks[depth]) } }));
    }
    const works = blocks.flatMap((block, index) => {
      const area = box(block);
      return index !== heading && inSection(area, typeBox[1], floor)
        && area[0] < typeBox[0] && area[2] < typeBox[0]
        && lower(normalize(block.text)).startsWith("устройство ") ? [index] : [];
    });
    const types = blocks.flatMap((block, index) => {
      const area = box(block);
      return inSection(area, typeBox[1], floor)
        && Math.abs(area[0] - typeBox[0]) <= 35_000
        && typeLabel.test(normalize(block.text)) ? [index] : [];
    });
    const byWork = new Map<number, number[]>();
    const byType = new Map<number, number[]>();
    for (const work of works) for (const typ of types) {
      if (!overlap(box(blocks[work]), box(blocks[typ]))) continue;
      byWork.set(work, [...(byWork.get(work) ?? []), typ]);
      byType.set(typ, [...(byType.get(typ) ?? []), work]);
    }
    for (const typ of types) {
      const matches = byType.get(typ) ?? [];
      if (matches.length !== 1 || (byWork.get(matches[0]) ?? []).length !== 1) {
        abstentions.push(abstention("ROAD_ASSEMBLY_TYPE_ALIGNMENT_AMBIGUOUS", typ, blocks));
        continue;
      }
      const work = matches[0];
      proposals.push(proposal({ proposalKind: "ROAD_ASSEMBLY_WORK_TYPE_ADJACENCY",
        rowAssociationStatus: "UNVERIFIED", reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"],
        layerAssociationStatus: "UNRESOLVED",
        roles: { roadHeading: role(heading, blocks[heading]),
          work: role(work, blocks[work]), type: role(typ, blocks[typ]) } }));
    }
  }
  return { proposals, abstentions };
}

function mafPage(blocks: Block[], height: number): { proposals: Json[]; abstentions: Json[] } {
  const proposals: Json[] = [];
  const abstentions: Json[] = [];
  const headings = blocks.flatMap((block, index) =>
    mafHeading.test(normalize(block.text)) ? [index] : []);
  for (const heading of headings) {
    const title = box(blocks[heading]);
    const floor = Math.max(Math.floor(height / 10), title[1] - 500_000);
    const xMin = title[0] - 120_000;
    const xMax = title[2] + 100_000;
    const position = uniqueHeader(blocks, heading, floor, "Поз.", xMin, xMax);
    const name = uniqueHeader(blocks, heading, floor, "Наименование", xMin, xMax);
    const quantity = uniqueHeader(blocks, heading, floor, "Кол. Примечание", xMin, xMax);
    if (position === null || name === null || quantity === null) {
      abstentions.push(abstention("MAF_TABLE_HEADERS_AMBIGUOUS", heading, blocks));
      continue;
    }
    const posBox = box(blocks[position]);
    const nameBox = box(blocks[name]);
    const qtyBox = box(blocks[quantity]);
    if (!(posBox[0] < nameBox[0] && nameBox[0] < qtyBox[0])) {
      abstentions.push(abstention("MAF_TABLE_COLUMNS_AMBIGUOUS", heading, blocks));
      continue;
    }
    const positions = blocks.flatMap((block, index) => {
      const area = box(block);
      return inSection(area, posBox[1], floor)
        && Math.abs(area[0] - posBox[0]) <= 30_000
        && positionLabel.test(normalize(block.text)) ? [index] : [];
    });
    const names = blocks.flatMap((block, index) => {
      const area = box(block);
      return inSection(area, nameBox[1], floor)
        && nameBox[0] - 35_000 <= area[0] && area[0] <= nameBox[2] + 55_000
        && area[2] < qtyBox[0] && cyrillic.test(block.text)
        && Array.from(block.text).length <= 300 ? [index] : [];
    });
    const byPosition = new Map<number, number[]>();
    const byName = new Map<number, number[]>();
    for (const positionIndex of positions) for (const nameIndex of names) {
      if (!overlap(box(blocks[positionIndex]), box(blocks[nameIndex]))) continue;
      byPosition.set(positionIndex, [...(byPosition.get(positionIndex) ?? []), nameIndex]);
      byName.set(nameIndex, [...(byName.get(nameIndex) ?? []), positionIndex]);
    }
    for (const positionIndex of positions) {
      const matches = byPosition.get(positionIndex) ?? [];
      if (matches.length !== 1 || (byName.get(matches[0]) ?? []).length !== 1) {
        abstentions.push(abstention("MAF_POSITION_NAME_ALIGNMENT_AMBIGUOUS",
          positionIndex, blocks));
        continue;
      }
      const nameIndex = matches[0];
      proposals.push(proposal({ proposalKind: "MAF_POSITION_NAME_ADJACENCY",
        rowAssociationStatus: "UNVERIFIED", reasonCodes: ["ROW_ASSOCIATION_UNVERIFIED"],
        rawQuantity: null, quantityStatus: "UNKNOWN",
        roles: { mafHeading: role(heading, blocks[heading]),
          positionHeader: role(position, blocks[position]),
          nameHeader: role(name, blocks[name]),
          quantityHeader: role(quantity, blocks[quantity]),
          position: role(positionIndex, blocks[positionIndex]),
          name: role(nameIndex, blocks[nameIndex]) } }));
    }
  }
  return { proposals, abstentions };
}

export interface SiteGpTableRowReviewVerificationInput {
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

function validSource(input: SiteGpTableRowReviewVerificationInput,
  source: SiteGpTableRowReviewVerificationInput["sourceFiles"][number]): boolean {
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

function validArtifact(source: SiteGpTableRowReviewVerificationInput["sourceFiles"][number],
  stored: SiteGpTableRowReviewVerificationInput["textArtifacts"][string]): boolean {
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
  let textCandidates = 0;
  for (const [index, page] of artifact.pages.entries()) {
    if (!record(page) || page.pageNumber !== index + 1 || !record(page.quality)
      || !["TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"].includes(String(page.quality.disposition))
      || !integer(page.widthMilliPoints, 1) || !integer(page.heightMilliPoints, 1)
      || !Array.isArray(page.blocks)) return false;
    if (page.blocks.length > 0) textPages += 1;
    if (page.quality.disposition === "TEXT_LAYER_CANDIDATE") textCandidates += 1;
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
    && same(artifact.qualitySummary, { textLayerCandidatePageCount: textCandidates,
      ocrRequiredPageCount: artifact.pages.length - textCandidates });
}

/** Rebuild every counter and displayed locator from committed source and text snapshots. */
export function verifySiteGpTableRowReview(input: SiteGpTableRowReviewVerificationInput): boolean {
  try {
    if (typeof input.objectId !== "string" || !input.objectId.trim()
      || !hash(input.inputManifestHash) || !Array.isArray(input.sourceFiles)
      || !record(input.sourceReviews) || !record(input.textArtifacts)
      || !record(input.result)) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "objectId",
      "inputManifestHash", "sourceStageArtifacts", "codeRows", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "site-gp-table-row-proposals-v1"
      || result.profileId !== "site-gp-table-row-review-v1"
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
        "proposalCount", "abstentionCount", "proposals", "abstentions"])
        || row.parameterCode !== code || row.status !== "ABSTAIN"
        || !Array.isArray(row.reasonCodes) || !Array.isArray(row.proposals)
        || !Array.isArray(row.abstentions) || row.proposals.length > 32
        || row.abstentions.length > 64 || !integer(row.eligibleSourceCount)
        || !integer(row.textCandidatePageCount) || !integer(row.ocrRequiredPageCount)
        || !integer(row.proposalCount) || !integer(row.abstentionCount)) return false;
      const expectedReasons = new Set<string>([
        "REVIEW_ONLY_NOT_TYPED_FACT", "ROW_ASSOCIATION_UNVERIFIED"]);
      const expectedProposals: Json[] = [];
      const expectedAbstentions: Json[] = [];
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
          const extracted = code === "SPZU-029"
            ? mafPage(page.blocks as Block[], page.heightMilliPoints as number)
            : roadPage(page.blocks as Block[]);
          for (const [key, destination] of [["proposals", expectedProposals],
            ["abstentions", expectedAbstentions]] as const) {
            for (const item of extracted[key]) {
              const scoped = { sourceFileId: source.sourceFileId,
                sourceSha256: source.sha256, textArtifactSha256: artifact.hash,
                pageNumber: page.pageNumber, sourceRole: "PD_GP_TABLE", ...item };
              destination.push({ ...scoped, scopedSha256: sha256(workerJson(scoped)) });
            }
          }
        }
      }
      expectedProposals.sort((a, b) => compare(String(a.sourceFileId), String(b.sourceFileId))
        || Number(a.pageNumber) - Number(b.pageNumber)
        || compare(String(a.proposalKind), String(b.proposalKind))
        || compare(String(a.scopedSha256), String(b.scopedSha256)));
      expectedAbstentions.sort((a, b) => compare(String(a.sourceFileId), String(b.sourceFileId))
        || Number(a.pageNumber) - Number(b.pageNumber)
        || compare(String(a.reasonCode), String(b.reasonCode))
        || compare(String(a.scopedSha256), String(b.scopedSha256)));
      if (expectedProposals.length > 32) expectedReasons.add("PROPOSAL_LIMIT_REACHED");
      if (expectedAbstentions.length > 64) expectedReasons.add("ABSTENTION_LIMIT_REACHED");
      if (eligibleCount === 0) expectedReasons.add("NO_ELIGIBLE_REVIEWED_SOURCE");
      if (expectedProposals.length === 0) expectedReasons.add("NO_UNAMBIGUOUS_ROW_PROPOSAL");
      if (row.eligibleSourceCount !== eligibleCount
        || row.textCandidatePageCount !== textPageCount
        || row.ocrRequiredPageCount !== ocrPageCount
        || row.proposalCount !== expectedProposals.length
        || row.abstentionCount !== expectedAbstentions.length
        || !same(row.reasonCodes, [...expectedReasons].sort())
        || !same(row.proposals, expectedProposals.slice(0, 32))
        || !same(row.abstentions, expectedAbstentions.slice(0, 64))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
