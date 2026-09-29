import { canonicalJson, sha256 } from "./canonical-json.js";
import type { OcrHeatAbstentionRead, OcrHeatEvidenceRead, OcrHeatProposalRead,
  OcrHeatRowsRead, PilotResultFactRead, PilotRuleResultRead, FactFamilyRead,
  CandidateFamilyPreviewRead } from "./repository.js";
import type { CandidateFamilyObservationsRead, CandidateFamilyOcrObservationsRead } from "./repository.js";
import type { UnresolvedFamilyReviewRead } from "./repository.js";

type Json = Record<string, unknown>;
const candidateOcrProfile =
  "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-v1";
const ocrTableProfile =
  "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v1";
const ocrTableProfileV2 =
  "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v2";
const ocrTableProfileV3 =
  "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3";
const unresolvedFamilyProfile =
  "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-ocr-table-v3-unresolved-review-v1";
const isOcrTableProfile = (profileId: string): boolean =>
  profileId === ocrTableProfile || profileId === ocrTableProfileV2
  || profileId === ocrTableProfileV3 || profileId === unresolvedFamilyProfile;
const ocrTableStageCount = (profileId: string): number =>
  profileId === unresolvedFamilyProfile ? 9 : 8;

export interface PersistedPilotResultRow {
  api_id: string;
  parameter_code: "PZ-002" | "PZ-017";
  rule_key: string;
  rule_version: string;
  execution_status: string;
  machine_status: string | null;
  result_payload: Json;
}

export interface PersistedOcrHeatRowsStage {
  content_json: unknown;
  content_hash: string;
  byte_size: number | string;
  schema_version: string;
  disposition: string;
  provider_profile_id: string;
  provider_config_hash: string;
  input_manifest_hash: string;
  output_count: number;
  job_state: string;
}

/** Source-backed review aid from a sealed rule stage. DB inputs are rechecked by the caller. */
export function projectFactFamilyRead(stage: PersistedOcrHeatRowsStage,
  expectedManifestHash: string, expectedConfigHash: string): FactFamilyRead {
  const size = Number(stage.byte_size);
  const previewProfile = stage.provider_profile_id
    === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1";
  const observationsProfile = stage.provider_profile_id
    === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1";
  const ocrObservationsProfile = stage.provider_profile_id === candidateOcrProfile;
  const expectedCount = isOcrTableProfile(stage.provider_profile_id)
    ? ocrTableStageCount(stage.provider_profile_id)
    : ocrObservationsProfile ? 7 : observationsProfile ? 6 : previewProfile ? 5 : 4;
  if (!hash(expectedManifestHash) || !hash(expectedConfigHash)
    || !Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024
    || !hash(stage.content_hash) || stage.schema_version !== "analysis-stage-result-v2"
    || stage.disposition !== "RULES_EVALUATED" || stage.job_state !== "SUCCEEDED"
    || !["typed-pz002-pz017-ocr-heat-fact-family-v1",
      "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
      "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
      candidateOcrProfile, ocrTableProfile, ocrTableProfileV2,
      ocrTableProfileV3, unresolvedFamilyProfile].includes(stage.provider_profile_id)
    || stage.provider_config_hash !== expectedConfigHash
    || stage.input_manifest_hash !== expectedManifestHash || stage.output_count !== expectedCount
    || !record(stage.content_json)) throw new Error("Fact family stage integrity check failed");
  const content = stage.content_json;
  const canonical = canonicalJson(content);
  if (Buffer.byteLength(canonical, "utf8") !== size || sha256(canonical) !== stage.content_hash
    || content.schemaVersion !== "analysis-stage-result-v2"
    || content.providerProfileId !== stage.provider_profile_id
    || content.providerConfigHash !== expectedConfigHash
    || content.inputManifestHash !== expectedManifestHash || content.outputCount !== expectedCount
    || !record(content.factFamily)) throw new Error("Fact family content integrity check failed");
  return content.factFamily as unknown as FactFamilyRead;
}

/** Return only a saved, release-bound preview; caller independently verifies source locators. */
export function projectCandidateFamilyPreviewRead(stage: PersistedOcrHeatRowsStage,
  expectedManifestHash: string, expectedConfigHash: string): CandidateFamilyPreviewRead {
  const size = Number(stage.byte_size);
  const observationsProfile = stage.provider_profile_id
    === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1";
  const ocrObservationsProfile = stage.provider_profile_id === candidateOcrProfile;
  const expectedCount = isOcrTableProfile(stage.provider_profile_id)
    ? ocrTableStageCount(stage.provider_profile_id)
    : ocrObservationsProfile ? 7 : observationsProfile ? 6 : 5;
  if (!hash(expectedManifestHash) || !hash(expectedConfigHash)
    || !Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024
    || !hash(stage.content_hash) || stage.schema_version !== "analysis-stage-result-v2"
    || stage.disposition !== "RULES_EVALUATED" || stage.job_state !== "SUCCEEDED"
    || !["typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
      "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
      candidateOcrProfile, ocrTableProfile, ocrTableProfileV2,
      ocrTableProfileV3, unresolvedFamilyProfile].includes(stage.provider_profile_id)
    || stage.provider_config_hash !== expectedConfigHash
    || stage.input_manifest_hash !== expectedManifestHash || stage.output_count !== expectedCount
    || !record(stage.content_json)) throw new Error("Candidate preview stage integrity check failed");
  const content = stage.content_json;
  const canonical = canonicalJson(content);
  if (Buffer.byteLength(canonical, "utf8") !== size || sha256(canonical) !== stage.content_hash
    || content.schemaVersion !== "analysis-stage-result-v2" || content.jobType !== "RULE_EVALUATION"
    || content.disposition !== "RULES_EVALUATED" || content.providerKind !== "RULE_ENGINE"
    || content.providerProfileId !== stage.provider_profile_id
    || content.providerConfigHash !== expectedConfigHash
    || content.inputManifestHash !== expectedManifestHash || content.outputCount !== expectedCount
    || !record(content.candidateFamilyPreview)) throw new Error("Candidate preview content integrity check failed");
  return content.candidateFamilyPreview as unknown as CandidateFamilyPreviewRead;
}

/** Saved review-only observations; caller revalidates each source-bound observation. */
export function projectCandidateFamilyObservationsRead(stage: PersistedOcrHeatRowsStage,
  expectedManifestHash: string, expectedConfigHash: string): CandidateFamilyObservationsRead {
  const size = Number(stage.byte_size);
  if (!hash(expectedManifestHash) || !hash(expectedConfigHash)
    || !Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024
    || !hash(stage.content_hash) || stage.schema_version !== "analysis-stage-result-v2"
    || stage.disposition !== "RULES_EVALUATED" || stage.job_state !== "SUCCEEDED"
    || !["typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
      candidateOcrProfile, ocrTableProfile, ocrTableProfileV2,
      ocrTableProfileV3, unresolvedFamilyProfile].includes(stage.provider_profile_id)
    || stage.provider_config_hash !== expectedConfigHash
    || stage.input_manifest_hash !== expectedManifestHash
    || stage.output_count !== (isOcrTableProfile(stage.provider_profile_id)
      ? ocrTableStageCount(stage.provider_profile_id)
      : stage.provider_profile_id === candidateOcrProfile ? 7 : 6)
    || !record(stage.content_json)) throw new Error("Candidate observations stage integrity check failed");
  const content = stage.content_json;
  const canonical = canonicalJson(content);
  if (Buffer.byteLength(canonical, "utf8") !== size || sha256(canonical) !== stage.content_hash
    || content.schemaVersion !== "analysis-stage-result-v2" || content.jobType !== "RULE_EVALUATION"
    || content.disposition !== "RULES_EVALUATED" || content.providerKind !== "RULE_ENGINE"
    || content.providerProfileId !== stage.provider_profile_id
    || content.providerConfigHash !== expectedConfigHash
    || content.inputManifestHash !== expectedManifestHash
    || content.outputCount !== (isOcrTableProfile(stage.provider_profile_id)
      ? ocrTableStageCount(stage.provider_profile_id)
      : stage.provider_profile_id === candidateOcrProfile ? 7 : 6)
    || !record(content.candidateFamilyObservations)) {
    throw new Error("Candidate observations content integrity check failed");
  }
  return content.candidateFamilyObservations as unknown as CandidateFamilyObservationsRead;
}

/** Read OCR candidates only from a complete, saved opt-in rule stage. */
export function projectCandidateFamilyOcrObservationsRead(stage: PersistedOcrHeatRowsStage,
  expectedManifestHash: string, expectedConfigHash: string): CandidateFamilyOcrObservationsRead {
  const size = Number(stage.byte_size);
  if (!hash(expectedManifestHash) || !hash(expectedConfigHash)
    || !Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024
    || !hash(stage.content_hash) || stage.schema_version !== "analysis-stage-result-v2"
    || stage.disposition !== "RULES_EVALUATED" || stage.job_state !== "SUCCEEDED"
    || ![candidateOcrProfile, ocrTableProfile, ocrTableProfileV2,
      ocrTableProfileV3, unresolvedFamilyProfile].includes(stage.provider_profile_id)
    || stage.provider_config_hash !== expectedConfigHash
    || stage.input_manifest_hash !== expectedManifestHash
    || stage.output_count !== (isOcrTableProfile(stage.provider_profile_id)
      ? ocrTableStageCount(stage.provider_profile_id) : 7)
    || !record(stage.content_json)) throw new Error("Candidate OCR observations stage integrity check failed");
  const content = stage.content_json;
  const canonical = canonicalJson(content);
  if (Buffer.byteLength(canonical, "utf8") !== size || sha256(canonical) !== stage.content_hash
    || content.schemaVersion !== "analysis-stage-result-v2" || content.jobType !== "RULE_EVALUATION"
    || content.disposition !== "RULES_EVALUATED" || content.providerKind !== "RULE_ENGINE"
    || content.providerProfileId !== stage.provider_profile_id
    || content.providerConfigHash !== expectedConfigHash
    || content.inputManifestHash !== expectedManifestHash
    || content.outputCount !== (isOcrTableProfile(stage.provider_profile_id)
      ? ocrTableStageCount(stage.provider_profile_id) : 7)
    || !record(content.candidateFamilyOcrObservations)) {
    throw new Error("Candidate OCR observations content integrity check failed");
  }
  const value = content.candidateFamilyOcrObservations;
  if (value.schemaVersion !== "candidate-family-ocr-observations-v1"
    || value.inputManifestHash !== expectedManifestHash
    || typeof value.objectId !== "string" || !value.objectId
    || value.scope !== "RUN_COMMITTED_OCR" || value.purpose !== "REVIEW_ONLY"
    || !hash(value.ocrArtifactSha256) || !hash(value.candidateRulePackSha256)
    || !hash(value.numericLabelPackSha256) || !hash(value.classLabelPackSha256)
    || !hash(value.presenceLabelPackSha256) || !hash(value.contentHash)
    || value.findingCount !== null || value.parameterCoverage !== null
    || value.outputCount !== 47 || !Array.isArray(value.codeRows)
    || value.codeRows.length !== 47) {
    throw new Error("Candidate OCR observations payload integrity check failed");
  }
  const { contentHash: _ignored, ...unhashed } = value;
  if (sha256(workerCanonicalJson(unhashed)) !== value.contentHash) {
    throw new Error("Candidate OCR observations content hash mismatch");
  }
  for (const row of value.codeRows) {
    if (!record(row) || typeof row.parameterCode !== "string" || !row.parameterCode
      || typeof row.family !== "string" || !row.family
      || typeof row.ruleId !== "string" || !row.ruleId || row.status !== "ABSTAIN"
      || !Array.isArray(row.reasonCodes)
      || row.reasonCodes.some((reason) => typeof reason !== "string" || !reason)
      || ![row.eligibleSourceCount, row.ocrProcessedPageCount,
        row.ocrDeferredPageCount, row.leadCount].every(boundedCount)
      || !Array.isArray(row.candidateLeads) || row.candidateLeads.length !== row.leadCount
      || row.candidateLeads.length > 16 || row.candidateLeads.some((lead) =>
        !record(lead) || lead.schemaVersion !== "candidate-family-ocr-lead-v1"
        || lead.status !== "CANDIDATE" || lead.purpose !== "REVIEW_ONLY"
        || lead.parameterCode !== row.parameterCode || !hash(lead.leadSha256)
        || sha256(workerCanonicalJson(Object.fromEntries(Object.entries(lead)
          .filter(([key]) => key !== "leadSha256")))) !== lead.leadSha256)) {
      throw new Error("Candidate OCR observations row integrity check failed");
    }
  }
  return value as unknown as CandidateFamilyOcrObservationsRead;
}

const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const boundedCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
function workerCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(workerCanonicalJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${workerCanonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const exactKeys = (value: Json, expected: readonly string[]): boolean =>
  Object.keys(value).sort().join("|") === [...expected].sort().join("|");
const boundedIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < 5000;

function ocrEvidence(value: unknown): OcrHeatEvidenceRead {
  if (!record(value) || !exactKeys(value, ["role", "lineIndex", "text", "bboxPx", "score"])
    || !["section", "rowLabel", "basisContinuation", "value"].includes(String(value.role))
    || !boundedIndex(value.lineIndex) || typeof value.text !== "string" || value.text.length > 4096
    || !Array.isArray(value.bboxPx) || value.bboxPx.length !== 4
    || !value.bboxPx.every((part) => typeof part === "number" && Number.isFinite(part)
      && part >= 0 && part <= 20_000)
    || value.bboxPx[0] >= value.bboxPx[2] || value.bboxPx[1] >= value.bboxPx[3]
    || typeof value.score !== "number" || !Number.isFinite(value.score)
    || value.score < 0 || value.score > 1) throw new Error("Invalid persisted OCR heat evidence");
  return { role: value.role as OcrHeatEvidenceRead["role"], lineIndex: value.lineIndex,
    text: value.text, bboxPx: value.bboxPx as OcrHeatEvidenceRead["bboxPx"], score: value.score };
}

function ocrEvidenceList(value: unknown): OcrHeatEvidenceRead[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw new Error("Invalid persisted OCR heat evidence list");
  }
  const evidence = value.map(ocrEvidence);
  if (evidence.at(-1)?.role !== "value") throw new Error("Invalid persisted OCR heat value evidence");
  return evidence;
}

function ocrLocator(value: Json) {
  if (typeof value.sourceFileId !== "string" || value.sourceFileId.length < 1
    || value.sourceFileId.length > 128 || !hash(value.inputSha256)
    || !Number.isSafeInteger(value.pageNumber) || Number(value.pageNumber) < 1
    || Number(value.pageNumber) > 100_000) throw new Error("Invalid persisted OCR heat locator");
  return { sourceFileId: value.sourceFileId, inputSha256: value.inputSha256,
    pageNumber: value.pageNumber as number };
}

function ocrProposal(value: unknown): OcrHeatProposalRead {
  if (!record(value) || !exactKeys(value, ["sourceFileId", "inputSha256", "pageNumber",
    "stage", "component", "basis", "values", "ocrPageContentHash", "renderSha256", "evidence"])
    || value.stage !== "RD" || !["HEATING", "VENTILATION", "DHW"].includes(String(value.component))
    || !["DESIGN_HEAT_RATE", "MAX_INCLUDING_CIRCULATION", "MEAN"].includes(String(value.basis))
    || !record(value.values) || !exactKeys(value.values, ["kW", "Gcal/h"])
    || !/^\d{1,12}(?:\.\d{1,6})?$/u.test(String(value.values.kW))
    || !/^\d{1,12}(?:\.\d{1,6})?$/u.test(String(value.values["Gcal/h"]))
    || !hash(value.ocrPageContentHash) || !hash(value.renderSha256)) {
    throw new Error("Invalid persisted OCR heat proposal");
  }
  const evidence = ocrEvidenceList(value.evidence);
  return { ...ocrLocator(value), stage: "RD", component: value.component as OcrHeatProposalRead["component"],
    basis: value.basis as OcrHeatProposalRead["basis"],
    values: { kW: value.values.kW as string, "Gcal/h": value.values["Gcal/h"] as string },
    ocrPageContentHash: value.ocrPageContentHash, renderSha256: value.renderSha256, evidence };
}

function ocrAbstention(value: unknown): OcrHeatAbstentionRead {
  if (!record(value) || !exactKeys(value, ["sourceFileId", "inputSha256", "pageNumber",
    "lineIndex", "reasonCode", "evidence"])
    || !boundedIndex(value.lineIndex) || ![
      "PAGE_STAGE_NOT_RD", "PAGE_STAGE_UNRESOLVED", "SECTION_UNRESOLVED",
      "ROW_LABEL_UNRESOLVED", "BASIS_AMBIGUOUS", "OCR_SCORE_TOO_LOW",
      "OCR_UNIT_UNREADABLE", "PAIRED_UNITS_CONTRADICT", "DUPLICATE_COMPONENT_BASIS",
    ].includes(String(value.reasonCode))) throw new Error("Invalid persisted OCR heat abstention");
  const evidence = ocrEvidenceList(value.evidence);
  if (evidence.at(-1)?.lineIndex !== value.lineIndex) {
    throw new Error("Invalid persisted OCR heat abstention line");
  }
  return { ...ocrLocator(value), lineIndex: value.lineIndex,
    reasonCode: value.reasonCode as string, evidence };
}

function boundedRows<T>(items: T[], budget: number): { rows: T[]; used: number } {
  const rows: T[] = [];
  let used = 0;
  for (const item of items) {
    if (rows.length >= 64) break;
    const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (used + bytes > budget) break;
    rows.push(item);
    used += bytes;
  }
  return { rows, used };
}

/** Project only committed review-aid fields; never map OCR rows into rule facts. */
export function projectOcrHeatRowsRead(stage: PersistedOcrHeatRowsStage,
  expectedManifestHash: string, expectedConfigHash: string): OcrHeatRowsRead {
  const size = Number(stage.byte_size);
  const expectedCount = stage.provider_profile_id === "typed-pz002-pz017-ocr-heat-fact-family-v1"
    ? 4 : stage.provider_profile_id === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1"
      ? 5 : stage.provider_profile_id
      === "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1" ? 6
        : isOcrTableProfile(stage.provider_profile_id)
          ? ocrTableStageCount(stage.provider_profile_id)
          : stage.provider_profile_id === candidateOcrProfile ? 7 : 3;
  if (!hash(expectedManifestHash) || !hash(expectedConfigHash)
    || !Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024
    || !hash(stage.content_hash) || stage.schema_version !== "analysis-stage-result-v2"
    || stage.disposition !== "RULES_EVALUATED" || stage.job_state !== "SUCCEEDED"
    || !["typed-pz002-pz017-ocr-heat-v1", "typed-pz002-pz017-ocr-heat-fact-family-v1",
      "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-v1",
      "typed-pz002-pz017-ocr-heat-fact-family-candidate-preview-observations-v1",
      candidateOcrProfile, ocrTableProfile, ocrTableProfileV2,
      ocrTableProfileV3, unresolvedFamilyProfile]
      .includes(stage.provider_profile_id)
    || stage.provider_config_hash !== expectedConfigHash
    || stage.input_manifest_hash !== expectedManifestHash || stage.output_count !== expectedCount
    || !record(stage.content_json)) throw new Error("OCR heat stage integrity check failed");
  const content = stage.content_json;
  const canonical = canonicalJson(content);
  if (Buffer.byteLength(canonical, "utf8") !== size || sha256(canonical) !== stage.content_hash
    || content.schemaVersion !== "analysis-stage-result-v2"
    || content.jobType !== "RULE_EVALUATION" || content.disposition !== "RULES_EVALUATED"
    || content.providerKind !== "RULE_ENGINE"
    || content.providerProfileId !== stage.provider_profile_id
    || content.providerConfigHash !== expectedConfigHash
    || content.inputManifestHash !== expectedManifestHash || content.outputCount !== expectedCount
    || !record(content.ocrHeatRows)) throw new Error("OCR heat content integrity check failed");
  const heat = content.ocrHeatRows;
  if (!exactKeys(heat, ["schemaVersion", "profileId", "inputManifestHash", "proposals",
    "abstentions", "findingCount"]) || heat.schemaVersion !== "ocr-heat-row-proposals-v1"
    || heat.profileId !== "conservative-ocr-heat-rows-v1"
    || heat.inputManifestHash !== expectedManifestHash || heat.findingCount !== 0
    || !Array.isArray(heat.proposals) || heat.proposals.length > 256
    || !Array.isArray(heat.abstentions) || heat.abstentions.length > 10_000) {
    throw new Error("OCR heat review aid integrity check failed");
  }
  const proposals = heat.proposals.map(ocrProposal);
  const abstentions = heat.abstentions.map(ocrAbstention);
  const selectedProposals = boundedRows(proposals, 256 * 1024);
  const selectedAbstentions = boundedRows(abstentions, 256 * 1024);
  return { profileId: "conservative-ocr-heat-rows-v1", inputManifestHash: expectedManifestHash,
    proposals: selectedProposals.rows, abstentions: selectedAbstentions.rows, findingCount: 0,
    proposalCount: proposals.length, abstentionCount: abstentions.length,
    truncated: selectedProposals.rows.length < proposals.length
      || selectedAbstentions.rows.length < abstentions.length };
}

function record(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Invalid persisted pilot result");
  return value;
}

function pageNumber(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("Invalid persisted pilot page");
  return Number(value);
}

function stage(value: unknown): "PD" | "RD" {
  if (value !== "PD" && value !== "RD") throw new Error("Invalid persisted pilot stage");
  return value;
}

function heatFact(value: unknown): PilotResultFactRead {
  if (!record(value)) throw new Error("Invalid persisted pilot fact");
  return {
    stage: stage(value.stage),
    component: requiredString(value.component),
    sourceFileId: requiredString(value.sourceFileId),
    sourceSha256: requiredString(value.inputSha256),
    pageNumber: pageNumber(value.pageNumber),
    rawValue: requiredString(value.rawValue),
    rawUnit: requiredString(value.rawUnit),
    value: requiredString(value.normalizedValue),
    unit: requiredString(value.canonicalUnit),
  };
}

function areaFacts(payload: Json): PilotResultFactRead[] {
  if (!Array.isArray(payload.evidence) || payload.evidence.length !== 2) {
    throw new Error("Invalid persisted area candidate evidence");
  }
  const expected = /^([0-9]+(?:[.,][0-9]+)?) м²$/u.exec(requiredString(payload.expectedValue));
  const actual = /^([0-9]+(?:[.,][0-9]+)?) м²$/u.exec(requiredString(payload.actualValue));
  if (!expected || !actual) throw new Error("Invalid persisted area candidate values");
  return payload.evidence.map((value: unknown) => {
    if (!record(value)) throw new Error("Invalid persisted area source");
    const sourceStage = stage(value.stage);
    return {
      stage: sourceStage,
      component: null,
      sourceFileId: requiredString(value.fileId),
      sourceSha256: requiredString(value.sha256),
      pageNumber: pageNumber(value.pdfPageNumber),
      rawValue: null,
      rawUnit: null,
      value: (sourceStage === "PD" ? expected : actual)![1],
      unit: "m2",
    };
  });
}

export function projectPilotRuleResult(row: PersistedPilotResultRow): PilotRuleResultRead {
  if (row.execution_status !== "SUCCEEDED" || !row.machine_status || !record(row.result_payload)) {
    throw new Error("Invalid persisted pilot result status");
  }
  const heat = row.parameter_code === "PZ-017";
  const payload = row.result_payload;
  const evaluation = heat ? payload.evaluation : payload;
  if (!record(evaluation)) throw new Error("Invalid persisted pilot evaluation");
  const comparison = heat ? payload.comparison : null;
  if (heat && !record(comparison)) throw new Error("Invalid persisted heat comparison");
  const facts = heat
    ? [
      ...(Array.isArray(payload.pdFacts) ? payload.pdFacts : []),
      ...(Array.isArray(payload.rdFacts) ? payload.rdFacts : []),
    ].map(heatFact)
    : row.machine_status === "CANDIDATE" ? areaFacts(payload) : [];
  if (heat && (!Array.isArray(payload.pdFacts) || !Array.isArray(payload.rdFacts))) {
    throw new Error("Invalid persisted heat facts");
  }
  return {
    resultId: row.api_id,
    parameterCode: row.parameter_code,
    ruleKey: row.rule_key,
    ruleVersion: row.rule_version,
    executionStatus: "SUCCEEDED",
    machineStatus: row.machine_status,
    reasonCode: typeof evaluation.reasonCode === "string" ? evaluation.reasonCode : null,
    comparison: record(comparison) ? {
      disposition: requiredString(comparison.disposition),
      reasonCode: typeof comparison.reasonCode === "string" ? comparison.reasonCode : null,
    } : null,
    facts,
  };
}

/** Project a committed unresolved-family aid. Caller must verify every text locator. */
export function projectUnresolvedFamilyReviewRead(stage: PersistedOcrHeatRowsStage,
  expectedManifestHash: string, expectedConfigHash: string): UnresolvedFamilyReviewRead {
  const size = Number(stage.byte_size);
  if (!hash(expectedManifestHash) || !hash(expectedConfigHash)
    || !Number.isSafeInteger(size) || size < 1 || size > 8 * 1024 * 1024
    || !hash(stage.content_hash) || stage.schema_version !== "analysis-stage-result-v2"
    || stage.disposition !== "RULES_EVALUATED" || stage.job_state !== "SUCCEEDED"
    || stage.provider_profile_id !== unresolvedFamilyProfile
    || stage.provider_config_hash !== expectedConfigHash
    || stage.input_manifest_hash !== expectedManifestHash
    || stage.output_count !== 9 || !record(stage.content_json)) {
    throw new Error("Unresolved family stage integrity check failed");
  }
  const content = stage.content_json;
  const canonical = canonicalJson(content);
  if (Buffer.byteLength(canonical, "utf8") !== size || sha256(canonical) !== stage.content_hash
    || content.schemaVersion !== "analysis-stage-result-v2"
    || content.jobType !== "RULE_EVALUATION"
    || content.disposition !== "RULES_EVALUATED"
    || content.providerKind !== "RULE_ENGINE"
    || content.providerProfileId !== unresolvedFamilyProfile
    || content.providerConfigHash !== expectedConfigHash
    || content.inputManifestHash !== expectedManifestHash
    || content.outputCount !== 9 || !record(content.unresolvedFamilyReview)) {
    throw new Error("Unresolved family content integrity check failed");
  }
  const value = content.unresolvedFamilyReview;
  if (value.schemaVersion !== "unresolved-family-run-review-v1"
    || value.profileId !== "unresolved-family-text-review-v1"
    || value.purpose !== "REVIEW_ONLY"
    || value.inputManifestHash !== expectedManifestHash
    || typeof value.objectId !== "string" || !value.objectId
    || !Array.isArray(value.sourceStageArtifacts)
    || !Array.isArray(value.codeRows) || value.codeRows.length !== 3
    || value.findingCount !== null || value.parameterCoverage !== null
    || !hash(value.contentHash)) {
    throw new Error("Unresolved family payload integrity check failed");
  }
  const { contentHash: _ignored, ...unhashed } = value;
  if (sha256(workerCanonicalJson(unhashed)) !== value.contentHash) {
    throw new Error("Unresolved family payload hash mismatch");
  }
  return value as unknown as UnresolvedFamilyReviewRead;
}
