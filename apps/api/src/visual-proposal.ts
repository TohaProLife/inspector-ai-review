import { randomUUID } from "node:crypto";
import { canonicalJson, sha256 } from "./canonical-json.js";

export const legacyVisualProposalProfile = {
  schemaVersion: "visual-proposal-profile-v1",
  methodId: "red-vector-panel-blue-contact-v1",
  maxPagesPerSource: 64,
  maxProposalsPerSource: 500,
  coordinateSystem: "NORMALIZED_TOP_LEFT",
} as const;

export const v2VisualProposalProfile = {
  ...legacyVisualProposalProfile,
  schemaVersion: "visual-proposal-profile-v2",
} as const;
export const v3VisualProposalProfile = {
  ...v2VisualProposalProfile,
  schemaVersion: "visual-proposal-profile-v3",
  maxPagesPerSource: 1024,
} as const;
export const visualProposalProfile = {
  ...v3VisualProposalProfile,
  schemaVersion: "visual-proposal-profile-v4",
  contextMethodId: "first-two-pdf-cover-text-pages-v1",
  maxContextPages: 2,
} as const;
export const v5VisualProposalProfile = {
  ...visualProposalProfile,
  schemaVersion: "visual-proposal-profile-v5",
  vlmMethodId: "spread-two-saved-proposals-v1",
  vlmModelId: "inspector-qwen3vl4b-eval",
  vlmModelWeightsSha256: "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a",
  vlmModelProjectorSha256: "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d",
  vlmPromptSha256: "34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611",
  maxVlmObservationsPerSource: 2,
  vlmCropMaxEdgePx: 768,
} as const;
export const v6VisualProposalProfile = {
  ...visualProposalProfile,
  schemaVersion: "visual-proposal-profile-v6",
  vlmMethodId: "spread-two-saved-proposals-server-nonnegative-v1",
  vlmModelId: "inspector-qwen3-vl-8b-fp8",
  vlmModelRevision: "9cdc6310a8cb770ce18efaf4e9935334512aee45",
  vlmModelLockSha256: "e2586e16f45deee017935d4c60b550e48059fdc02cbc9c9114053f2f1fe4d879",
  vlmModelShards: [
    { filename: "model-00001-of-00002.safetensors", sha256: "e2dea2e85e643ef7045c31a485a426631a1e0a84e463f8b2c7e9c6682a06eafd" },
    { filename: "model-00002-of-00002.safetensors", sha256: "3dc64ec934af27a7007d265014e907aff9e16658d409e5cd4cf79869bf2bd8c1" },
  ],
  vlmPromptSha256: "34a372ca6f4032b74ff51c11dd7adfe14df31b266ca356a5a2ec15b1d56c9611",
  maxVlmObservationsPerSource: 2,
  vlmCropMaxEdgePx: 768,
} as const;

export const legacyVisualProposalConfigHash = sha256(canonicalJson(legacyVisualProposalProfile));
export const legacyVisualProposalProfileId = "red-vector-proposals-v1";
export const v2VisualProposalConfigHash = sha256(canonicalJson(v2VisualProposalProfile));
export const v2VisualProposalProfileId = "red-vector-proposals-v2";
export const v3VisualProposalConfigHash = sha256(canonicalJson(v3VisualProposalProfile));
export const v3VisualProposalProfileId = "red-vector-proposals-v3";
export const visualProposalConfigHash = sha256(canonicalJson(visualProposalProfile));
export const visualProposalProfileId = "red-vector-proposals-v4";
export const v5VisualProposalConfigHash = sha256(canonicalJson(v5VisualProposalProfile));
export const v5VisualProposalProfileId = "red-vector-proposals-v5";
export const v6VisualProposalConfigHash = sha256(canonicalJson(v6VisualProposalProfile));
export const v6VisualProposalProfileId = "red-vector-proposals-v6";

export function selectedVisualPages(pageCount: number, maxPages: number = visualProposalProfile.maxPagesPerSource): number[] {
  if (pageCount <= maxPages) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const first = Array.from({ length: 8 }, (_, index) => index + 1);
  const middleCount = maxPages - 16;
  const sampled = Array.from({ length: middleCount }, (_, index) =>
    9 + Math.floor(((2 * index + 1) * (pageCount - 16)) / (2 * middleCount)));
  const last = Array.from({ length: 8 }, (_, index) => pageCount - 7 + index);
  return [...first, ...sampled, ...last];
}

interface ExpectedVisualSource {
  apiId: string;
  sha256: string;
  pageCount: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validDocumentContext(value: unknown, pageCount: number): boolean {
  if (!record(value) || !keys(value, ["schemaVersion", "methodId", "status", "reasonCode", "inspectedPages"])
    || value.schemaVersion !== "document-context-v1"
    || value.methodId !== visualProposalProfile.contextMethodId
    || !Array.isArray(value.inspectedPages)
    || value.inspectedPages.length !== Math.min(visualProposalProfile.maxContextPages, pageCount)) return false;
  const domains = new Set<string>();
  for (let index = 0; index < value.inspectedPages.length; index += 1) {
    const page = value.inspectedPages[index];
    if (!record(page) || !keys(page, ["pageNumber", "textSha256", "titleWindow"])
      || page.pageNumber !== index + 1
      || typeof page.textSha256 !== "string" || !/^[a-f0-9]{64}$/.test(page.textSha256)
      || !(page.titleWindow === null || (
        typeof page.titleWindow === "string" && page.titleWindow.length > 0
        && page.titleWindow.length <= 500
        && /^(?:РАБОЧАЯ|ПРОЕКТНАЯ)\s+ДОКУМЕНТАЦИЯ(?:\n|$)/iu.test(page.titleWindow)
      ))) return false;
    if (typeof page.titleWindow === "string") {
      if (/(?:^|[^\p{L}])отоплени[еяию](?=$|[^\p{L}])/iu.test(page.titleWindow)) domains.add("HEATING");
      if (/(?:^|[^\p{L}])вентиляци[яиюе](?=$|[^\p{L}])/iu.test(page.titleWindow)) domains.add("VENTILATION");
    }
  }
  const expectedStatus = domains.size === 1 ? [...domains][0] : "UNKNOWN";
  const expectedReason = domains.size === 1 ? "TITLE_KEYWORD_MATCH"
    : domains.size > 1 ? "TITLE_CONFLICT" : "NO_TITLE_KEYWORD_MATCH";
  return value.status === expectedStatus && value.reasonCode === expectedReason;
}

export function selectedVisualVlmOrdinals(count: number): number[] {
  if (count <= v5VisualProposalProfile.maxVlmObservationsPerSource) {
    return Array.from({ length: count }, (_, index) => index);
  }
  return Array.from({ length: v5VisualProposalProfile.maxVlmObservationsPerSource }, (_, index) =>
    Math.floor(((2 * index + 1) * count) / (2 * v5VisualProposalProfile.maxVlmObservationsPerSource)));
}

function validVlmObservations(value: unknown, source: Record<string, unknown>, version: "v5" | "v6"): boolean {
  const profile = version === "v6" ? v6VisualProposalProfile : v5VisualProposalProfile;
  if (!record(value) || !keys(value, [
    "schemaVersion", "methodId", "eligibleProposalCount", "selectedOrdinals",
    "omittedProposalCount", "observations",
  ]) || value.schemaVersion !== "visual-vlm-observations-v1"
    || value.methodId !== profile.vlmMethodId
    || !Array.isArray(source.proposals)
    || value.eligibleProposalCount !== source.proposals.length
    || !Array.isArray(value.selectedOrdinals) || !Array.isArray(value.observations)) return false;
  const ordinals = selectedVisualVlmOrdinals(source.proposals.length);
  if (value.selectedOrdinals.length !== ordinals.length
    || value.selectedOrdinals.some((item, index) => item !== ordinals[index])
    || value.omittedProposalCount !== source.proposals.length - ordinals.length
    || value.observations.length !== ordinals.length) return false;
  for (let index = 0; index < ordinals.length; index += 1) {
    const observation = value.observations[index];
    const proposal = source.proposals[ordinals[index]];
    if (!record(observation) || !record(proposal) || !keys(observation, [
      "proposalOrdinal", "sourceSha256", "pageNumber", "bboxNormalized",
      "cropSha256", "modelId", "promptSha256", "decision", "reasonCode", "responseSha256",
      ...(version === "v6" ? ["modelRevision", "modelLockSha256"]
        : ["modelWeightsSha256", "modelProjectorSha256"]),
    ]) || observation.proposalOrdinal !== ordinals[index]
      || observation.sourceSha256 !== source.sourceSha256
      || observation.pageNumber !== proposal.pageNumber
      || canonicalJson(observation.bboxNormalized) !== canonicalJson(proposal.bboxNormalized)
      || observation.modelId !== profile.vlmModelId
      || observation.promptSha256 !== profile.vlmPromptSha256
      || (version === "v6" ? (
        observation.modelRevision !== v6VisualProposalProfile.vlmModelRevision
        || observation.modelLockSha256 !== v6VisualProposalProfile.vlmModelLockSha256
      ) : (
        observation.modelWeightsSha256 !== v5VisualProposalProfile.vlmModelWeightsSha256
        || observation.modelProjectorSha256 !== v5VisualProposalProfile.vlmModelProjectorSha256
      ))) return false;
    const crop = observation.cropSha256;
    const response = observation.responseSha256;
    const validHash = (item: unknown) => typeof item === "string" && /^[a-f0-9]{64}$/.test(item);
    if (observation.reasonCode === "MODEL_RESPONSE") {
      if (!validHash(crop) || !validHash(response)
        || !(version === "v6" ? observation.decision === "RADIATOR_HINT"
          : ["RADIATOR_HINT", "OTHER_HINT"].includes(String(observation.decision)))) return false;
    } else if (observation.reasonCode === "MODEL_ABSTAIN") {
      if (!validHash(crop) || !validHash(response) || observation.decision !== "ABSTAIN") return false;
    } else if (version === "v6" && observation.reasonCode === "MODEL_OTHER_UNTRUSTED") {
      if (!validHash(crop) || !validHash(response) || observation.decision !== "ABSTAIN") return false;
    } else if (observation.reasonCode === "CROP_RENDER_ERROR") {
      if (crop !== null || response !== null || observation.decision !== "ABSTAIN") return false;
    } else if ([
      "ENDPOINT_NOT_CONFIGURED", "MODEL_HTTP_ERROR", "MODEL_TIMEOUT", "MODEL_UNAVAILABLE",
      "MODEL_REDIRECT_REJECTED", "MODEL_OUTPUT_INVALID", "MODEL_RESPONSE_TOO_LARGE",
    ].includes(String(observation.reasonCode))) {
      if (!validHash(crop) || response !== null || observation.decision !== "ABSTAIN") return false;
    } else return false;
  }
  return true;
}

export function validateVisualProposalStageResult(
  result: Record<string, unknown>,
  manifestHash: string,
  objectId: string,
  expectedSources: ExpectedVisualSource[],
  releaseProfileId = visualProposalProfileId,
): {
  id: string;
  canonical: string;
  contentHash: string;
  byteSize: number;
  outputCount: number;
  storedResult: Record<string, unknown>;
} | undefined {
  const legacy = releaseProfileId === legacyVisualProposalProfileId;
  const v2 = releaseProfileId === v2VisualProposalProfileId;
  const v3 = releaseProfileId === v3VisualProposalProfileId;
  const v5 = releaseProfileId === v5VisualProposalProfileId;
  const v6 = releaseProfileId === v6VisualProposalProfileId;
  if (!legacy && !v2 && !v3 && !v5 && !v6 && releaseProfileId !== visualProposalProfileId) return undefined;
  const profile = legacy ? legacyVisualProposalProfile : v2 ? v2VisualProposalProfile
    : v3 ? v3VisualProposalProfile : v5 ? v5VisualProposalProfile
      : v6 ? v6VisualProposalProfile : visualProposalProfile;
  const profileHash = legacy ? legacyVisualProposalConfigHash
    : v2 ? v2VisualProposalConfigHash : v3 ? v3VisualProposalConfigHash
    : v5 ? v5VisualProposalConfigHash : v6 ? v6VisualProposalConfigHash : visualProposalConfigHash;
  const analysisVersion = legacy ? "v1" : v2 ? "v2" : v3 ? "v3" : v5 ? "v5" : v6 ? "v6" : "v4";
  if (!keys(result, [
    "schemaVersion", "jobType", "inputManifestHash", "disposition", "reasonCode",
    "providerKind", "providerProfileId", "providerConfigHash", "outputCount", "analysis",
  ]) || result.schemaVersion !== "analysis-stage-result-v2"
    || result.jobType !== "ENTITY_EXTRACTION"
    || result.inputManifestHash !== manifestHash
    || result.disposition !== "VISUAL_PROPOSAL_SCAN"
    || result.reasonCode !== "PROPOSAL_ONLY_UNVERIFIED"
    || result.providerKind !== "ENTITY_EXTRACTION_MODEL"
    || result.providerProfileId !== releaseProfileId
    || result.providerConfigHash !== profileHash
    || !integer(result.outputCount) || !record(result.analysis)) return undefined;

  const analysis = result.analysis;
  if (!keys(analysis, ["schemaVersion", "objectId", "inputManifestHash", "profile", "sources"])
    || analysis.schemaVersion !== `visual-proposal-analysis-${analysisVersion}`
    || analysis.objectId !== objectId || analysis.inputManifestHash !== manifestHash
    || canonicalJson(analysis.profile) !== canonicalJson(profile)
    || !Array.isArray(analysis.sources)
    || analysis.sources.length !== expectedSources.length) return undefined;

  const expected = [...expectedSources].sort((left, right) => left.apiId.localeCompare(right.apiId));
  let proposalCount = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const source = analysis.sources[index];
    const sourceExpected = expected[index];
    if (!record(source) || !keys(source, [
      "sourceFileId", "sourceSha256", "pageCount", "scannedPageCount", "status",
      "proposals", "proposalLimitReached", "unretainedProposalCount",
      ...(!legacy ? ["scannedPageNumbers", "skippedPageCount"] : []),
      ...(!legacy && !v2 && !v3 ? ["documentContext"] : []),
      ...(v5 || v6 ? ["vlm"] : []),
    ]) || source.sourceFileId !== sourceExpected.apiId
      || source.sourceSha256 !== sourceExpected.sha256
      || source.pageCount !== sourceExpected.pageCount
      || !integer(source.scannedPageCount) || !integer(source.unretainedProposalCount)
      || typeof source.proposalLimitReached !== "boolean"
      || !Array.isArray(source.proposals)
      || source.proposals.length > profile.maxProposalsPerSource
      || (!legacy && !v2 && !v3 && !validDocumentContext(source.documentContext, sourceExpected.pageCount))
      || ((v5 || v6) && !validVlmObservations(source.vlm, source, v6 ? "v6" : "v5"))) return undefined;

    const exceedsLimit = sourceExpected.pageCount > profile.maxPagesPerSource;
    const pageNumbers = legacy && exceedsLimit ? []
      : selectedVisualPages(sourceExpected.pageCount, profile.maxPagesPerSource);
    if (source.status !== (exceedsLimit
      ? legacy ? "SKIPPED_PAGE_LIMIT" : "PARTIALLY_SCANNED_PAGE_LIMIT"
      : "SCANNED")
      || source.scannedPageCount !== pageNumbers.length
      || source.proposalLimitReached !== (source.unretainedProposalCount > 0)
      || (source.unretainedProposalCount > 0 && source.proposals.length !== profile.maxProposalsPerSource)
      || (legacy && exceedsLimit && (source.proposals.length !== 0 || source.unretainedProposalCount !== 0))
      || (!legacy && (
        !Array.isArray(source.scannedPageNumbers)
        || source.scannedPageNumbers.length !== pageNumbers.length
        || source.scannedPageNumbers.some((page, pageIndex) => page !== pageNumbers[pageIndex])
        || source.skippedPageCount !== sourceExpected.pageCount - pageNumbers.length
      ))) return undefined;

    const scannedPages = new Set(pageNumbers);
    let previousPage = 0;
    for (const proposal of source.proposals) {
      if (!record(proposal) || !keys(proposal, ["pageNumber", "bboxNormalized", "status"])
        || !integer(proposal.pageNumber) || proposal.pageNumber < 1
        || !scannedPages.has(proposal.pageNumber) || proposal.pageNumber < previousPage
        || proposal.status !== "GEOMETRIC_PROPOSAL_NOT_CLASSIFIED"
        || !Array.isArray(proposal.bboxNormalized) || proposal.bboxNormalized.length !== 4
        || !proposal.bboxNormalized.every((value) => typeof value === "number" && Number.isFinite(value))
        || !(0 <= proposal.bboxNormalized[0] && proposal.bboxNormalized[0] < proposal.bboxNormalized[2]
          && proposal.bboxNormalized[2] <= 1 && 0 <= proposal.bboxNormalized[1]
          && proposal.bboxNormalized[1] < proposal.bboxNormalized[3] && proposal.bboxNormalized[3] <= 1)) return undefined;
      previousPage = proposal.pageNumber;
    }
    proposalCount += source.proposals.length;
  }
  if (result.outputCount !== proposalCount) return undefined;
  const canonical = canonicalJson(result);
  const byteSize = Buffer.byteLength(canonical, "utf8");
  if (byteSize < 1 || byteSize > 6 * 1024 * 1024) return undefined;
  const id = randomUUID();
  const contentHash = sha256(canonical);
  return {
    id, canonical, contentHash, byteSize, outputCount: proposalCount,
    storedResult: {
      schemaVersion: result.schemaVersion,
      artifactId: id,
      disposition: result.disposition,
      reasonCode: result.reasonCode,
      providerKind: result.providerKind,
      providerProfileId: result.providerProfileId,
      providerConfigHash: result.providerConfigHash,
      outputCount: proposalCount,
      contentHash,
      byteSize,
    },
  };
}
