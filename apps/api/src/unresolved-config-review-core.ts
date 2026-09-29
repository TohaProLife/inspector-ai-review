import { canonicalJson, sha256 } from "./canonical-json.js";
import { pinnedUnresolvedReviewConfig } from "./unresolved-review-config-pinned.js";
import { pinnedUnresolvedReviewConfigV2 } from "./unresolved-review-config-pinned-v2.js";
import { pinnedUnresolvedReviewConfigV3 } from "./unresolved-review-config-pinned-v3.js";

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
const registrySha256 = "fdc6a69544e06513ee37baa20ad21a1c5c1bc711b04907491becc3283604a87a";
const strategySha256 = "0e9519b426c93fa9eaefe7416d6ced893c212ff3deb198d87e70eedf884d5514";
// API-owned audited receipt tuples bind public source/page/render navigation.
// Physical PDF renders are not reproduced by this verifier.
const auditedPagesV2: Record<string, { sourceSha256: string; renderSha256: string }> = {
  "F0126:21": { sourceSha256: "b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088",
    renderSha256: "cd04bc7f57b57cb69196d723909b3a2120399a001859fd4c9759d8ef148e172f" },
  "F0156:20": { sourceSha256: "16cd7f0b61a31b52b6e5d94f9249c0382407ec91b5531d6e0ed843e8827e30cf",
    renderSha256: "ef5ace7ff46a0da789bbbb66c931b7f8be73508075bac0655c382667ef2a0218" },
  "F0156:27": { sourceSha256: "16cd7f0b61a31b52b6e5d94f9249c0382407ec91b5531d6e0ed843e8827e30cf",
    renderSha256: "6726fb36dec09093b5452389944674034375a3131416d88ff596da642cb11fb7" },
  "F0118:12": { sourceSha256: "63c2bbc93d14a15232eca0d771820f6994c07f41cba73a3f4172cda925bd9357",
    renderSha256: "ad8380532add6e65936b3d7f11e3353a7e36cac4a7fe124f280803ccf1233c1d" },
  "F0120:8": { sourceSha256: "6351d217b51c5004b93ce7fab4b7721178adfd63c2159ba2feb3dcd285e9265d",
    renderSha256: "8ff99c6f752c43933319039371b96a1ae3c2c65812e1cafdd9afc16a52e4f68b" },
  "F0160:120": { sourceSha256: "72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd",
    renderSha256: "332d1127375dd191ca10dae0697b3a5b497036e05548924d1f8a2bd40c61caee" },
  "F0193:41": { sourceSha256: "edf34d969b0f37e9165c344432f7f229159db2b990e87b67482969286e71aa4f",
    renderSha256: "ef02119e390e2f7cec6f65d14d7c16fafa69d4660189d850b0abf5d121d61234" },
  "F0193:43": { sourceSha256: "edf34d969b0f37e9165c344432f7f229159db2b990e87b67482969286e71aa4f",
    renderSha256: "bb7f0336c2e6a8946c690c5ca143b9b8178d572b3bbef603835c3151f65356f4" },
  "F0193:59": { sourceSha256: "edf34d969b0f37e9165c344432f7f229159db2b990e87b67482969286e71aa4f",
    renderSha256: "076cb91e3027263d7a6f6f594873beb48c15fa585346873c840c2c136343e1a0" },
};
const auditedPagesV3: Record<string, { sourceSha256: string; renderSha256: string }> = {
  "F0148:249": { sourceSha256: "e4b188ce7f815a95dc7be708135943b6f6bdbfeb61422305ff2a2d6f59ca36bd",
    renderSha256: "d1f222d09970bebe86306186d688f9b637643092e3db45e382094fa912920da3" },
  "F0128:21": { sourceSha256: "7f3737225014e681de43ce118ae29633492dd84d6ba36cb28c1d115141ac8fca",
    renderSha256: "552775ce8c4fa8a02c1416e97f1e6782467160b74b911b2e42c134422b9f840b" },
  "F0162:20": { sourceSha256: "79a3cc7d7ca5a1df4093b26b0bd739c8f299f1d5739b18e04a9cdcf44e0c4946",
    renderSha256: "2a72089ff7f36db3bb6ac1d12120147b0ff42dd33718362a481ed471a8021e4f" },
  "F0171:11": { sourceSha256: "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc",
    renderSha256: "259fb42cb771b947743b01030fb4ca6a57e062aba54c2443adfa3e2175d82710" },
  "F0171:144": { sourceSha256: "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc",
    renderSha256: "88826766e0a2a6b9d2499f91bebf54d7e7a1fbbb51b46a80b2f5909dae78b798" },
  "F0171:19": { sourceSha256: "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc",
    renderSha256: "621727d933bf5ac87b9e0e86af84cce43fa0106ce038277a0a6fa812083a8709" },
  "F0163:8": { sourceSha256: "18282c9104974a462338ff2d246bf081545bdfcafde1a85ee5e6d4ca54584861",
    renderSha256: "df717730876399f5aa6ac8d5ab7fd2c03fd3604c5725b7f3f108fa0cba3e51ab" },
};
type AuditedPage = { sourceSha256: string; renderSha256: string };
type TrustedDescriptor = {
  configSha256: string;
  schemaVersion: string;
  profileId: string;
  configVersion: string;
  pinnedConfig: unknown;
  codes: readonly string[];
  families: readonly string[];
  auditedPages: Readonly<Record<string, AuditedPage>> | null;
  auditedRenderProfile: string | null;
  extraReasons: readonly string[];
};

// Selected only by the trusted wrapper, never by the release or sidecar.
const trustedDescriptors = {
  v1: {
    configSha256: "c5aedccb8752ef365ea18298e1ed222f97abd207607b8caf5a18f23fd547bc85",
    schemaVersion: "unresolved-config-run-review-v1",
    profileId: "unresolved-review-config-v1", configVersion: "1",
    pinnedConfig: pinnedUnresolvedReviewConfig,
    codes: ["PZ-003", "PZ-011", "PZ-019", "PZ-020", "SPZU-027", "SPZU-028", "AR-046",
      "PZ-005", "SPZU-031", "SPZU-033", "AR-042", "AR-047", "AR-048",
      "AR-051", "KR-060", "POS-084", "ODI-116", "ODI-117", "ODI-119"],
    families: [...Array(7).fill("AREA_PROGRAM"), ...Array(12).fill("DIMENSION_LAYOUT")],
    auditedPages: null, auditedRenderProfile: null, extraReasons: [],
  },
  v2: {
    configSha256: "1c31aad1761af86273f421daef5fc04bfe7724c9bf07750a1f1b8b37be30a0e8",
    schemaVersion: "unresolved-config-run-review-v2",
    profileId: "unresolved-review-config-v2", configVersion: "2",
    pinnedConfig: pinnedUnresolvedReviewConfigV2,
    codes: ["SPZU-026", "AR-052", "IOS2-072", "IOS3-075", "ZU-130",
      "AR-043", "IOS5-080", "PPM-106", "PPM-108", "PPM-110"],
    families: [...Array(5).fill("DOCUMENT_APPROVAL"), ...Array(5).fill("SAFETY_COVERAGE")],
    auditedPages: auditedPagesV2, auditedRenderProfile: null, extraReasons: [],
  },
  v3: {
    configSha256: "ca9fb46fa07a5ccb32f8176b88bebede90b5b30875a29257465da5259b84365a",
    schemaVersion: "unresolved-config-run-review-v3",
    profileId: "unresolved-review-config-v3", configVersion: "3",
    pinnedConfig: pinnedUnresolvedReviewConfigV3,
    codes: ["IOS1-068", "IOS1-069", "IOS1-070", "IOS4-076", "IOS4-078", "PPM-111", "PPM-113"],
    families: Array(7).fill("NETWORK_TOPOLOGY"),
    auditedPages: auditedPagesV3,
    auditedRenderProfile: "pdftoppm-100dpi-png-singlefile",
    extraReasons: ["NETWORK_TOPOLOGY_UNVERIFIED"],
  },
} as const satisfies Record<string, TrustedDescriptor>;
export type UnresolvedConfigProfile = keyof typeof trustedDescriptors;

const whitespace = /[\s\u001c-\u001f\u0085]+/u;
const normalize = (value: string): string => value.toLowerCase()
  .split(whitespace).filter(Boolean).join(" ");

type ConfigEntry = {
  parameterCode: string;
  candidateExtractorFamily: string;
  allowedSourceRoles: Array<{ stage: string; section: string }>;
  anchors: string[];
  anchorEvidence: Array<{ sourceFileId: string; sourceSha256: string;
    pageNumber: number; renderSha256: string; lineText: string }>;
  locatorType: string;
  requiredProofGates: string[];
};

function pinnedEntries(config: unknown, descriptor: TrustedDescriptor): ConfigEntry[] | null {
  if (!record(config) || sha256(workerJson(config)) !== descriptor.configSha256
    || !same(config, descriptor.pinnedConfig)
    || config.schemaVersion !== descriptor.profileId || config.version !== descriptor.configVersion
    || config.executionPolicy !== "REVIEW_ONLY_ABSTAIN"
    || config.registrySha256 !== registrySha256
    || config.strategySha256 !== strategySha256
    || config.matching !== "ANY_LITERAL_LOWERCASE_COLLAPSE_WHITESPACE"
    || (descriptor.auditedRenderProfile !== null
      && config.auditedRenderProfile !== descriptor.auditedRenderProfile)
    || !record(config.bounds)
    || !same(config.bounds, { maxLeadsPerCode: 16, maxLineChars: 500,
      maxTextArtifactBytes: 67_108_864 })
    || !Array.isArray(config.entries) || config.entries.length !== descriptor.codes.length) return null;
  for (const [index, value] of config.entries.entries()) {
    if (!record(value) || value.parameterCode !== descriptor.codes[index]
      || value.candidateExtractorFamily !== descriptor.families[index]
      || value.locatorType !== "TEXT_LINE_BBOX_ONLY"
      || value.registryClassification !== "UNRESOLVED"
      || !Array.isArray(value.allowedSourceRoles)
      || !value.allowedSourceRoles.every((role) => record(role)
        && ["PD", "RD"].includes(String(role.stage))
        && typeof role.section === "string")
      || !Array.isArray(value.anchors) || !value.anchors.every((anchor) =>
        typeof anchor === "string" && anchor === normalize(anchor))
      || !Array.isArray(value.requiredProofGates)) return null;
    if (descriptor.auditedPages !== null && (!Array.isArray(value.anchorEvidence)
      || value.anchorEvidence.length !== value.anchors.length
      || !value.anchorEvidence.every((evidence, anchorIndex) => {
        if (!record(evidence) || !exact(evidence, ["sourceFileId", "sourceSha256",
          "pageNumber", "renderSha256", "lineText"])
          || typeof evidence.sourceFileId !== "string"
          || !/^F[0-9]{4}$/u.test(evidence.sourceFileId)
          || !integer(evidence.pageNumber, 1)
          || !hash(evidence.sourceSha256) || !hash(evidence.renderSha256)
          || typeof evidence.lineText !== "string"
          || !normalize(evidence.lineText).includes((value.anchors as string[])[anchorIndex])) return false;
        const audited = descriptor.auditedPages?.[
          `${evidence.sourceFileId}:${evidence.pageNumber}`];
        return audited?.sourceSha256 === evidence.sourceSha256
          && audited.renderSha256 === evidence.renderSha256;
      }))) return null;
  }
  return config.entries as ConfigEntry[];
}

export interface UnresolvedConfigReviewCoreInput {
  objectId: string;
  inputManifestHash: string;
  config: unknown;
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

function validSource(input: UnresolvedConfigReviewCoreInput,
  source: UnresolvedConfigReviewCoreInput["sourceFiles"][number]): boolean {
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
    && (source.stages.length !== 1 || Object.keys(review.pageStages).length === 0)
    && Object.entries(review.pageStages).every(([page, stage]) =>
      /^[1-9][0-9]*$/u.test(page)
        && (stage === "UNRESOLVED" || source.stages.includes(stage)));
}

function validArtifact(source: UnresolvedConfigReviewCoreInput["sourceFiles"][number],
  stored: UnresolvedConfigReviewCoreInput["textArtifacts"][string]): boolean {
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
  const seenPages = new Set<number>();
  for (const page of artifact.pages) {
    if (!record(page) || !integer(page.pageNumber, 1)
      || page.pageNumber > artifact.pages.length || seenPages.has(page.pageNumber)
      || !record(page.quality)
      || !["TEXT_LAYER_CANDIDATE", "OCR_REQUIRED"].includes(String(page.quality.disposition))
      || !integer(page.widthMilliPoints, 1) || !integer(page.heightMilliPoints, 1)
      || !Array.isArray(page.blocks)) return false;
    seenPages.add(page.pageNumber);
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
  return seenPages.size === artifact.pages.length
    && artifact.textPageCount === textPages && record(artifact.qualitySummary)
    && same(artifact.qualitySummary, { textLayerCandidatePageCount: candidatePages,
      ocrRequiredPageCount: artifact.pages.length - candidatePages });
}

/** Rebuild every review row from a trusted profile and committed source/text snapshots. */
export function verifyUnresolvedConfigReviewCore(
  input: UnresolvedConfigReviewCoreInput, profile: UnresolvedConfigProfile,
): boolean {
  try {
    const descriptor: TrustedDescriptor = trustedDescriptors[profile];
    if (typeof input.objectId !== "string" || !input.objectId.trim()
      || !hash(input.inputManifestHash) || !Array.isArray(input.sourceFiles)
      || !record(input.sourceReviews) || !record(input.textArtifacts)
      || !record(input.result)) return false;
    const entries = pinnedEntries(input.config, descriptor);
    if (!entries) return false;
    const result = input.result;
    if (!exact(result, ["schemaVersion", "profileId", "purpose", "objectId",
      "inputManifestHash", "configSha256", "registrySha256",
      "sourceStageArtifacts", "codeRows", "findingCount",
      "parameterCoverage", "contentHash"])
      || result.schemaVersion !== descriptor.schemaVersion
      || result.profileId !== descriptor.profileId
      || result.purpose !== "REVIEW_ONLY" || result.objectId !== input.objectId
      || result.inputManifestHash !== input.inputManifestHash
      || result.configSha256 !== descriptor.configSha256
      || result.registrySha256 !== registrySha256
      || result.findingCount !== null || result.parameterCoverage !== null
      || !hash(result.contentHash) || !Array.isArray(result.sourceStageArtifacts)
      || !Array.isArray(result.codeRows) || result.codeRows.length !== descriptor.codes.length
      || Buffer.byteLength(workerJson(result), "utf8") > 1024 * 1024) return false;
    const { contentHash: _digest, ...unhashed } = result;
    if (sha256(workerJson(unhashed)) !== result.contentHash) return false;
    const sources = new Map(input.sourceFiles.map((source) => [source.sourceFileId, source]));
    if (sources.size !== input.sourceFiles.length
      || input.sourceFiles.some((source) => !validSource(input, source))
      || Object.keys(input.sourceReviews).some((sourceId) => !sources.has(sourceId))) return false;
    const artifacts = new Map<string, { content: Json; hash: string }>();
    for (const [sourceId, stored] of Object.entries(input.textArtifacts)) {
      const source = sources.get(sourceId);
      if (!source || !validArtifact(source, stored)
        || Buffer.byteLength(workerJson(stored.content_json), "utf8") > 67_108_864) return false;
      artifacts.set(sourceId, { content: stored.content_json as Json, hash: stored.content_hash });
    }
    const expectedArtifacts = [...artifacts.entries()]
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([sourceId, artifact]) => ({ sourceFileId: sourceId,
        sourceSha256: sources.get(sourceId)!.sha256, textArtifactSha256: artifact.hash }));
    if (!same(result.sourceStageArtifacts, expectedArtifacts)) return false;
    for (const [index, code] of descriptor.codes.entries()) {
      const entry = entries[index];
      const row = result.codeRows[index];
      if (!record(row) || !exact(row, ["parameterCode", "candidateExtractorFamily",
        "locatorType", "requiredProofGates", "status", "reasonCodes",
        "eligibleSourceCount", "textCandidatePageCount", "ocrRequiredPageCount",
        "oversizeAnchorLineCount", "leadCount", "truncatedLeadCount",
        "leadCountSemantics", "absenceConclusion", "leads"])
        || row.parameterCode !== code || row.status !== "ABSTAIN"
        || !Array.isArray(row.reasonCodes) || !Array.isArray(row.leads)
        || row.leads.length > 16 || !integer(row.eligibleSourceCount)
        || !integer(row.textCandidatePageCount) || !integer(row.ocrRequiredPageCount)
        || !integer(row.oversizeAnchorLineCount) || !integer(row.leadCount)
        || !integer(row.truncatedLeadCount)
        || row.candidateExtractorFamily !== entry.candidateExtractorFamily
        || row.locatorType !== entry.locatorType
        || !same(row.requiredProofGates, entry.requiredProofGates)
        || row.leadCountSemantics !== "MATCHES_IN_SCANNED_TEXT_ONLY"
        || row.absenceConclusion !== "NOT_AVAILABLE") return false;
      const expectedReasons = new Set<string>(["CONFIG_PINNED_REVIEW_ONLY",
        "ELEMENT_OR_SPACE_UNVERIFIED", "PD_RD_PAIR_UNVERIFIED",
        ...descriptor.extraReasons]);
      const expectedLeads: Json[] = [];
      let leadCount = 0;
      let eligibleCount = 0;
      let textPageCount = 0;
      let ocrPageCount = 0;
      let oversizeCount = 0;
      for (const source of [...sources.values()].sort((a, b) =>
        a.sourceFileId < b.sourceFileId ? -1 : a.sourceFileId > b.sourceFileId ? 1 : 0)) {
        const review = input.sourceReviews[source.sourceFileId];
        if (!review || review.revisionStatus !== "CURRENT"
          || review.approvalStatus !== "APPROVED") {
          expectedReasons.add("SOURCE_REVIEW_REQUIRED");
          continue;
        }
        const artifact = artifacts.get(source.sourceFileId);
        if (!artifact) {
          expectedReasons.add("TEXT_ARTIFACT_MISSING");
          continue;
        }
        const pageStages = review.pageStages;
        if (source.stages.length > 1) {
          const expectedPages = new Set((artifact.content.pages as Json[])
            .map((page) => String(page.pageNumber)));
          if (Object.keys(pageStages).length !== expectedPages.size
            || Object.keys(pageStages).some((page) => !expectedPages.has(page))) {
            expectedReasons.add("PAGE_STAGE_MAP_INCOMPLETE");
            expectedReasons.add("SOURCE_STAGE_UNRESOLVED");
            continue;
          }
        } else if (Object.keys(pageStages).length > 0) {
          expectedReasons.add("SOURCE_STAGE_UNRESOLVED");
          continue;
        }
        const eligiblePages: Array<{ page: Json; stage: string }> = [];
        for (const page of [...artifact.content.pages as Json[]]
          .sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber))) {
          const stage = Object.keys(pageStages).length > 0
            ? pageStages[String(page.pageNumber)] : source.stages[0];
          if (stage === "UNRESOLVED") {
            expectedReasons.add("PAGE_STAGE_UNRESOLVED_DEFERRED");
            continue;
          }
          if (!entry.allowedSourceRoles.some((role) => role.stage === stage
            && role.section === source.sectionCode)) {
            expectedReasons.add("SOURCE_ROLE_NOT_ALLOWED");
            continue;
          }
          eligiblePages.push({ page, stage });
        }
        if (eligiblePages.length === 0) continue;
        eligibleCount += 1;
        for (const { page, stage } of eligiblePages) {
          if ((page.quality as Json).disposition !== "TEXT_LAYER_CANDIDATE") {
            ocrPageCount += 1;
            expectedReasons.add("OCR_REQUIRED_DEFERRED");
            continue;
          }
          textPageCount += 1;
          for (const [blockIndex, block] of (page.blocks as Json[]).entries()) {
            const blockText = block.text as string;
            const blockTextSha256 = sha256(blockText);
            for (const [lineIndex, lineText] of lines(blockText).entries()) {
              const normalized = normalize(lineText);
              const matchedAnchors = entry.anchors.filter((anchor) => normalized.includes(anchor));
              if (matchedAnchors.length === 0) continue;
              if (Array.from(lineText).length > 500) {
                oversizeCount += 1;
                expectedReasons.add("OVERSIZE_ANCHOR_LINE_DEFERRED");
                continue;
              }
              leadCount += 1;
              if (expectedLeads.length >= 16) continue;
              const leadBody = { sourceFileId: source.sourceFileId,
                sourceSha256: source.sha256, textArtifactSha256: artifact.hash,
                sourceStage: stage, sourceSection: source.sectionCode,
                pageNumber: page.pageNumber, blockIndex, lineIndex,
                blockTextSha256, lineText, lineTextSha256: sha256(lineText),
                bboxMilliPoints: block.bboxMilliPoints, matchedAnchors,
                locatorType: "TEXT_LINE_BBOX_ONLY", elementAssociationStatus: "UNVERIFIED" };
              expectedLeads.push({ ...leadBody, leadSha256: sha256(workerJson(leadBody)) });
            }
          }
        }
      }
      const truncated = leadCount - expectedLeads.length;
      if (truncated) expectedReasons.add("LEAD_LIMIT_REACHED");
      if (eligibleCount === 0) expectedReasons.add("NO_ELIGIBLE_REVIEWED_SOURCE");
      if (leadCount === 0) expectedReasons.add(textPageCount > 0
        ? "NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT" : "NO_SCANNED_TEXT_IN_SCOPE");
      if (row.eligibleSourceCount !== eligibleCount
        || row.textCandidatePageCount !== textPageCount
        || row.ocrRequiredPageCount !== ocrPageCount
        || row.oversizeAnchorLineCount !== oversizeCount
        || row.leadCount !== leadCount
        || row.truncatedLeadCount !== truncated
        || !same(row.reasonCodes, [...expectedReasons].sort())
        || !same(row.leads, expectedLeads)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
