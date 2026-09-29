import { canonicalJson, sha256 } from "./canonical-json.js";
import { candidateFamilyPreviewPolicy } from "./pilot-rules.js";

/** A run-local navigation aid. Values and code rows never authorize findings or coverage. */
export interface CandidateFamilyPreviewVerificationInput {
  objectId: string;
  inputManifestHash: string;
  sourceFiles: Array<{ sourceFileId: string; objectId: string; sha256: string;
    stages: string[]; sourceReviewHash: string | null; sectionCode?: string | null }>;
  sourceReviews: Record<string, { sourceSha256: string; revisionStatus: string;
    approvalStatus: string; linkGroupId: string | null; pageStages: Record<string, string>;
    contentHash: string; decisionHash?: string }>;
  textArtifacts: Record<string, { content_json: unknown; content_hash: string }>;
  result: unknown;
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const exact = (value: Json, fields: readonly string[]): boolean =>
  Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const nonempty = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= limit;
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const numericUnitAliases: Record<string, readonly string[]> = {
  m: ["м", "m"], m2: ["м²", "м2", "m2", "кв.м"],
  m3: ["м³", "м3", "m3"], mm: ["мм", "mm"],
  count: ["шт.", "шт", "чел.", "чел"], kW: ["кВт", "kW"],
  "m3/day": ["м³/сут", "м3/сут"], "Gcal/h": ["Гкал/ч"],
  "m3/h": ["м³/ч", "м3/ч"], t: ["т", "t"],
  day: ["дни", "день", "дня", "сут", "сут."],
  "W/(m*C)": ["Вт/(м·С)", "Вт/(м·°С)", "Вт/(м·C)"],
  "kWh/m2": ["кВт·ч/м²", "кВт·ч/м2"],
  thousand_rub: ["тыс. руб.", "тыс руб.", "тыс.руб."],
};

export function validNumericLine(lead: Json, line: string, valueStart: number): boolean {
  const aliases = numericUnitAliases[String(lead.canonicalUnit)];
  if (!aliases || typeof lead.rawUnit !== "string" || typeof lead.rawValue !== "string"
    || typeof lead.matchedLabel !== "string"
    || !aliases.some((alias) => alias.toLocaleLowerCase("ru-RU")
      === String(lead.rawUnit).toLocaleLowerCase("ru-RU"))) return false;
  const number = "(?:[0-9]+|[0-9]{1,3}(?:[ \\u00a0][0-9]{3})+)(?:[.,][0-9]+)?";
  const units = aliases.map(escapeRegex).sort((a, b) => b.length - a.length).join("|");
  const pattern = new RegExp(`^\\s*${escapeRegex(lead.matchedLabel)}\\s*(?:[:=—–-]\\s*|\\s+)`
    + `(?<value>${number})\\s*(?<unit>${units})\\s*[.;]?\\s*$`, "idu");
  const match = pattern.exec(line);
  const span = match?.indices?.groups?.value;
  return Boolean(match && span && match.groups?.value === lead.rawValue
    && match.groups?.unit === lead.rawUnit
    && Array.from(line.slice(0, span[0])).length === valueStart);
}

// Mirrors only the code/family/attribute identity of pinned candidate rule pack.
// The worker independently checks the full pack, catalog, registry and label packs.
export const candidateFamilyPreviewSpecs: Record<string, { family: string; attributes: Record<string, string> }> = {
  "AR-040": { family: "LOWER_BOUND", attributes: { EVACUATION_CORRIDOR_WIDTH: "m" } },
  "AR-041": { family: "LOWER_BOUND", attributes: { EVACUATION_DOOR_CLEAR_WIDTH: "m" } },
  "AR-049": { family: "LOWER_BOUND", attributes: { ROOF_BALCONY_GUARD_HEIGHT: "m" } },
  "AR-050": { family: "CLASS_DECREASE", attributes: { FINISH_FIRE_CLASS: "finish_fire_class" } },
  "AR-053": { family: "PRESENCE_SET", attributes: { NOISE_PROTECTION_MEASURE_SET: "set" } },
  "IOS2-071": { family: "DECREASE", attributes: { WATER_PIPE_DIAMETER: "mm" } },
  "IOS3-074": { family: "DECREASE", attributes: { SEWER_PIPE_DIAMETER: "mm" } },
  "KR-061": { family: "DECREASE", attributes: { LOAD_BEARING_MONOLITHIC_WALL_THICKNESS: "mm" } },
  "KR-062": { family: "DECREASE", attributes: { LONGITUDINAL_REBAR_DIAMETER: "mm" } },
  "KR-067": { family: "RELATIVE_DELTA", attributes: { CONCRETE_VOLUME: "m3", STEEL_MASS: "t" } },
  "ODI-118": { family: "UPPER_BOUND", attributes: { ACCESSIBLE_DOOR_THRESHOLD_HEIGHT: "m" } },
  "ODI-120": { family: "PRESENCE_SET", attributes: { ACCESSIBLE_GRAB_RAIL_SET: "set" } },
  "ODI-122": { family: "PRESENCE_SET", attributes: { TACTILE_WARNING_SET: "set" } },
  "ODI-123": { family: "PRESENCE_SET", attributes: { ASSISTANCE_CALL_SYSTEM_SET: "set" } },
  "POD-092": { family: "PRESENCE_SET", attributes: { LIVE_UTILITY_PROTECTION_SET: "set" } },
  "POD-093": { family: "RELATIVE_DELTA", attributes: { DEMOLITION_VOLUME_BY_TYPE: "m3" } },
  "POD-095": { family: "PRESENCE_SET", attributes: { DUST_NOISE_SUPPRESSION_SET: "set" } },
  "POS-082": { family: "RELATIVE_INCREASE", attributes: { CRITICAL_CONSTRUCTION_STAGE_DURATION: "day" } },
  "POS-086": { family: "INCREASE", attributes: { PEAK_PERSONNEL_COUNT: "count" } },
  "POS-088": { family: "INCREASE", attributes: { TEMPORARY_POWER_DEMAND: "kW", TEMPORARY_RESOURCE_VOLUME: "m3" } },
  "PPM-103": { family: "CLASS_DECREASE", attributes: { FIRE_DOOR_RATING: "fire_rating" } },
  "PPM-104": { family: "LOWER_BOUND", attributes: { EVACUATION_PASSAGE_WIDTH: "m", EVACUATION_PASSAGE_HEIGHT: "m" } },
  "PPM-105": { family: "LOWER_BOUND", attributes: { EXTERNAL_EVACUATION_DOOR_CLEAR_WIDTH: "m" } },
  "PPM-107": { family: "CLASS_DECREASE", attributes: { FINISH_FIRE_CLASS: "finish_fire_class" } },
  "PZ-002": { family: "RELATIVE_DELTA", attributes: { BUILDING_TOTAL_AREA: "m2" } },
  "PZ-008": { family: "INCREASE", attributes: { BUILDING_HEIGHT: "m" } },
  "PZ-010": { family: "DIFFERENT", attributes: { APARTMENT_COUNT: "count" } },
  "PZ-012": { family: "DECREASE", attributes: { UNDERGROUND_PARKING_COUNT: "count" } },
  "PZ-014": { family: "INCREASE", attributes: { DESIGN_ELECTRIC_POWER: "kW" } },
  "PZ-015": { family: "CLASS_DECREASE", attributes: { POWER_SUPPLY_RELIABILITY_CATEGORY: "reliability_category" } },
  "PZ-016": { family: "INCREASE", attributes: { DAILY_WATER_CONSUMPTION: "m3/day" } },
  "PZ-017": { family: "INCREASE", attributes: { TOTAL_HEATING_LOAD: "Gcal/h" } },
  "PZ-018": { family: "INCREASE", attributes: { MAX_HOURLY_GAS_FLOW: "m3/h" } },
  "PZ-021": { family: "CLASS_DECREASE", attributes: { ENERGY_EFFICIENCY_CLASS: "energy_class" } },
  "PZ-022": { family: "CLASS_DECREASE", attributes: { FIRE_RESISTANCE_DEGREE: "fire_resistance_degree" } },
  "PZ-023": { family: "CLASS_DECREASE", attributes: { STRUCTURAL_FIRE_HAZARD_CLASS: "structural_fire_hazard_class" } },
  "SM-132": { family: "RELATIVE_INCREASE", attributes: { CONSTRUCTION_TOTAL_COST: "thousand_rub" } },
  "SPZU-024": { family: "RELATIVE_DELTA", attributes: { EXCAVATION_VOLUME: "m3", BACKFILL_VOLUME: "m3" } },
  "SPZU-025": { family: "RELATIVE_DELTA", attributes: { HARD_SURFACE_AREA: "m2" } },
  "SPZU-030": { family: "LOWER_BOUND", attributes: { FIRE_ACCESS_ROAD_WIDTH: "m" } },
  "SPZU-037": { family: "DECREASE", attributes: { SURFACE_PARKING_COUNT: "count" } },
  "SPZU-039": { family: "PRESENCE_SET", attributes: { DRAINAGE_MEASURE_SET: "set" } },
  "ZU-124": { family: "CLASS_DECREASE", attributes: { ENERGY_EFFICIENCY_CLASS: "energy_class" } },
  "ZU-126": { family: "INCREASE", attributes: { WALL_INSULATION_THERMAL_CONDUCTIVITY: "W/(m*C)" } },
  "ZU-128": { family: "DECREASE", attributes: { ROOF_INSULATION_THICKNESS: "mm" } },
  "ZU-129": { family: "PRESENCE_SET", attributes: { ENERGY_METER_SET: "set" } },
  "ZU-131": { family: "INCREASE", attributes: { ANNUAL_SPECIFIC_HEATING_ENERGY: "kWh/m2" } },
};

export const candidateFamilyPreviewSections: Record<string, { PD: string[]; RD: string[] }> = {
  "AR-040": { PD: ["AR"], RD: ["AR"] },
  "AR-041": { PD: ["AR"], RD: ["AR"] },
  "AR-049": { PD: ["AR"], RD: ["AR"] },
  "AR-050": { PD: ["AR"], RD: ["AR"] },
  "AR-053": { PD: ["AR"], RD: ["AR"] },
  "IOS2-071": { PD: ["IOS2"], RD: ["VK"] },
  "IOS3-074": { PD: ["IOS3"], RD: ["VK"] },
  "KR-061": { PD: ["KR"], RD: ["KJ"] },
  "KR-062": { PD: ["KR"], RD: ["KJ"] },
  "KR-067": { PD: ["KR"], RD: ["KJ","KM"] },
  "ODI-118": { PD: ["ODI"], RD: ["AR"] },
  "ODI-120": { PD: ["ODI"], RD: ["AR"] },
  "ODI-122": { PD: ["ODI"], RD: ["GP","AR"] },
  "ODI-123": { PD: ["ODI"], RD: ["SS"] },
  "POD-092": { PD: ["POD"], RD: ["PPR"] },
  "POD-093": { PD: ["POD"], RD: ["PPR"] },
  "POD-095": { PD: ["POD"], RD: ["PPR"] },
  "POS-082": { PD: ["POS"], RD: ["PPR"] },
  "POS-086": { PD: ["POS"], RD: ["PPR"] },
  "POS-088": { PD: ["POS"], RD: ["PPR"] },
  "PPM-103": { PD: ["PPM"], RD: ["AR"] },
  "PPM-104": { PD: ["PPM"], RD: ["AR"] },
  "PPM-105": { PD: ["PPM"], RD: ["AR"] },
  "PPM-107": { PD: ["PPM"], RD: ["AR"] },
  "PZ-002": { PD: ["PZ"], RD: ["AR"] },
  "PZ-008": { PD: ["PZ"], RD: ["AR"] },
  "PZ-010": { PD: ["PZ"], RD: ["AR"] },
  "PZ-012": { PD: ["PZ"], RD: ["AR"] },
  "PZ-014": { PD: ["PZ"], RD: ["EOM"] },
  "PZ-015": { PD: ["PZ"], RD: ["EOM"] },
  "PZ-016": { PD: ["PZ"], RD: ["VK"] },
  "PZ-017": { PD: ["PZ"], RD: ["OV"] },
  "PZ-018": { PD: ["PZ"], RD: ["GSV"] },
  "PZ-021": { PD: ["PZ"], RD: ["AR","OV"] },
  "PZ-022": { PD: ["PZ"], RD: ["AR","KR"] },
  "PZ-023": { PD: ["PZ"], RD: ["AR","KR"] },
  "SM-132": { PD: ["SM"], RD: ["SM"] },
  "SPZU-024": { PD: ["SPZU"], RD: ["PP"] },
  "SPZU-025": { PD: ["SPZU"], RD: ["PP"] },
  "SPZU-030": { PD: ["SPZU"], RD: ["PP"] },
  "SPZU-037": { PD: ["SPZU"], RD: ["PP"] },
  "SPZU-039": { PD: ["SPZU"], RD: ["NVK"] },
  "ZU-124": { PD: ["ZU"], RD: ["AR","OV"] },
  "ZU-126": { PD: ["ZU"], RD: ["AR"] },
  "ZU-128": { PD: ["ZU","AR"], RD: ["AR"] },
  "ZU-129": { PD: ["ZU"], RD: ["IOS1","IOS2","OV"] },
  "ZU-131": { PD: ["ZU"], RD: ["OV"] },
};

const reasons = new Set([
  "SOURCE_REVISION_UNRESOLVED", "SOURCE_REVISION_SUPERSEDED",
  "SOURCE_APPROVAL_UNRESOLVED", "SOURCE_UNAPPROVED",
  "SOURCE_PAGE_STAGE_UNRESOLVED", "DRAWING_SECTION_UNRESOLVED",
  "TEXT_ARTIFACT_MISSING", "AMBIGUOUS_PAGE_LABEL", "LEAD_LIMIT_REACHED",
  "PREVIEW_BYTE_BUDGET_REACHED",
  "OCR_REQUIRED_IN_SCOPE", "NO_ELIGIBLE_REVIEWED_SOURCE", "NO_EXACT_LABEL_LEAD",
  "FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED",
]);

function lines(blockText: string): Array<{ text: string; start: number; end: number }> {
  const chars = Array.from(blockText);
  const result: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (!["\n", "\r", "\v", "\f", "\u001c", "\u001d", "\u001e", "\u0085", "\u2028", "\u2029"].includes(ch)) continue;
    const next = ch === "\r" && chars[index + 1] === "\n" ? index + 2 : index + 1;
    const part = chars.slice(start, next).join("");
    result.push({ text: part.replace(/[\r\n]+$/u, ""), start, end: next });
    start = next;
    index = next - 1;
  }
  if (start < chars.length) result.push({ text: chars.slice(start).join(""), start, end: chars.length });
  return result;
}

function validSource(input: CandidateFamilyPreviewVerificationInput,
  source: CandidateFamilyPreviewVerificationInput["sourceFiles"][number]): boolean {
  if (!nonempty(source.sourceFileId, 128) || source.objectId !== input.objectId || !hash(source.sha256)
    || !Array.isArray(source.stages) || source.stages.length < 1 || source.stages.length > 3
    || new Set(source.stages).size !== source.stages.length
    || source.stages.some((stage) => !["PD", "RD", "ID"].includes(stage))) return false;
  const review = input.sourceReviews[source.sourceFileId];
  if (!review) return source.sourceReviewHash === null && source.sectionCode == null;
  return hash(source.sourceReviewHash) && source.sourceReviewHash === review.contentHash
    && review.decisionHash === review.contentHash && review.sourceSha256 === source.sha256
    && ["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(review.revisionStatus)
    && ["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(review.approvalStatus)
    && record(review.pageStages)
    && Object.entries(review.pageStages).every(([page, stage]) =>
      /^[1-9][0-9]*$/u.test(page) && [...source.stages, "UNRESOLVED"].includes(stage));
}

interface VerifiedArtifact { content: Json; hash: string; stageByPage: Array<string | null> }

function verifiedArtifacts(input: CandidateFamilyPreviewVerificationInput,
  sources: Map<string, CandidateFamilyPreviewVerificationInput["sourceFiles"][number]>): Map<string, VerifiedArtifact> | null {
  const result = new Map<string, VerifiedArtifact>();
  for (const [sourceId, stored] of Object.entries(input.textArtifacts)) {
    const source = sources.get(sourceId);
    if (!source || !record(stored) || !record(stored.content_json) || !hash(stored.content_hash)
      || sha256(canonicalJson(stored.content_json)) !== stored.content_hash) return null;
    const artifact = stored.content_json;
    if (artifact.schemaVersion !== "document-text-v2" || artifact.sourceFileId !== sourceId
      || artifact.inputSha256 !== source.sha256 || !integer(artifact.pageCount, 1)
      || !Array.isArray(artifact.pages) || artifact.pages.length !== artifact.pageCount) return null;
    const review = input.sourceReviews[sourceId];
    const stageByPage: Array<string | null> = [];
    if (source.stages.length === 1) {
      if (review && Object.keys(review.pageStages).length !== 0) return null;
      for (let page = 0; page < artifact.pageCount; page += 1) stageByPage.push(source.stages[0]);
    } else if (review && Object.keys(review.pageStages).length === artifact.pageCount) {
      for (let page = 1; page <= artifact.pageCount; page += 1) {
        const stage = review.pageStages[String(page)];
        if (stage !== "UNRESOLVED" && !source.stages.includes(stage)) return null;
        stageByPage.push(stage === "UNRESOLVED" ? null : stage);
      }
    } else {
      for (let page = 0; page < artifact.pageCount; page += 1) stageByPage.push(null);
    }
    result.set(sourceId, { content: artifact, hash: stored.content_hash, stageByPage });
  }
  return result;
}

function validLead(input: CandidateFamilyPreviewVerificationInput, row: Json, lead: unknown,
  sources: Map<string, CandidateFamilyPreviewVerificationInput["sourceFiles"][number]>,
  artifacts: Map<string, VerifiedArtifact>): boolean {
  if (!record(lead) || !exact(lead, ["schemaVersion", "status", "purpose", "parameterCode",
    "family", "attribute", "canonicalUnit", "matchedLabel", "rawValue", "rawUnit",
    "featureKey", "scopeTokens", "sourceFileId", "sourceSha256", "artifactSha256",
    "objectId", "stage", "sectionCode", "revisionStatus", "approvalStatus",
    "pageNumber", "coordinateSystem", "lineText", "blockTextSha256", "locator", "leadSha256"])) return false;
  const spec = candidateFamilyPreviewSpecs[String(row.parameterCode)];
  const source = sources.get(String(lead.sourceFileId));
  if (!source || lead.schemaVersion !== "candidate-family-run-lead-v1" || lead.status !== "CANDIDATE"
    || lead.purpose !== "REVIEW_ONLY" || lead.parameterCode !== row.parameterCode
    || lead.family !== row.family || spec.attributes[String(lead.attribute)] !== lead.canonicalUnit
    || !nonempty(lead.matchedLabel, 160) || !nonempty(lead.rawValue, 500)
    || lead.rawUnit !== null && !nonempty(lead.rawUnit, 80)
    || !nonempty(lead.lineText, 500) || lead.objectId !== input.objectId
    || lead.sourceSha256 !== source.sha256 || !hash(lead.artifactSha256)
    || !hash(lead.blockTextSha256) || !hash(lead.leadSha256)
    || lead.sectionCode !== source.sectionCode || !["PD", "RD"].includes(String(lead.stage))
    || lead.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
    || !integer(lead.pageNumber, 1) || !record(lead.locator)) return false;
  const review = input.sourceReviews[source.sourceFileId];
  if (!review || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED"
    || lead.revisionStatus !== review.revisionStatus || lead.approvalStatus !== review.approvalStatus
    || !nonempty(source.sectionCode, 12)
    || !candidateFamilyPreviewSections[String(row.parameterCode)][lead.stage as "PD" | "RD"]
      .includes(source.sectionCode)) return false;
  if (spec.family === "PRESENCE_SET") {
    if (!nonempty(lead.featureKey, 80) || !Array.isArray(lead.scopeTokens)
      || lead.scopeTokens.length > 8 || lead.rawUnit !== null) return false;
  } else if (lead.featureKey !== null || lead.scopeTokens !== null) return false;
  const stored = artifacts.get(source.sourceFileId);
  if (!stored || lead.artifactSha256 !== stored.hash
    || Number(lead.pageNumber) > stored.stageByPage.length
    || stored.stageByPage[Number(lead.pageNumber) - 1] !== lead.stage) return false;
  const artifact = stored.content;
  const page = (artifact.pages as unknown[])[Number(lead.pageNumber) - 1];
  const locator = lead.locator;
  if (!record(page) || page.pageNumber !== lead.pageNumber || !record(page.quality)
    || page.quality.disposition !== "TEXT_LAYER_CANDIDATE" || !Array.isArray(page.blocks)
    || locator.kind !== "DOCUMENT_TEXT_BLOCK_LINE" || !integer(locator.blockIndex)
    || !integer(locator.lineIndex) || !integer(locator.start) || !integer(locator.end, 1)
    || locator.end <= locator.start || !Array.isArray(locator.bboxMilliPoints)) return false;
  const block = page.blocks[locator.blockIndex];
  if (!record(block) || typeof block.text !== "string" || !Array.isArray(block.bboxMilliPoints)
    || !same(locator.bboxMilliPoints, block.bboxMilliPoints)
    || sha256(block.text) !== lead.blockTextSha256) return false;
  const selectedLine = lines(block.text)[locator.lineIndex];
  const chars = Array.from(block.text);
  if (!selectedLine || selectedLine.text !== lead.lineText
    || locator.start < selectedLine.start
    || locator.end > selectedLine.start + Array.from(selectedLine.text).length
    || chars.slice(locator.start, locator.end).join("") !== lead.rawValue) return false;
  const normalize = (value: string) => value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  const label = normalize(String(lead.matchedLabel));
  const normalizedLine = normalize(selectedLine.text);
  const valueStart = locator.start - selectedLine.start;
  if (spec.family !== "PRESENCE_SET" && spec.family !== "CLASS_DECREASE"
    && !validNumericLine(lead, selectedLine.text, valueStart)) return false;
  const labelStart = normalizedLine.indexOf(label);
  if (labelStart < 0 || (spec.family === "PRESENCE_SET"
    ? labelStart !== valueStart
    : labelStart >= valueStart || normalizedLine.slice(0, labelStart).trim().length !== 0)) return false;
  const { leadSha256: _hash, ...unhashed } = lead;
  return sha256(canonicalJson(unhashed)) === lead.leadSha256;
}

function verifiedCounts(code: string,
  sources: Map<string, CandidateFamilyPreviewVerificationInput["sourceFiles"][number]>,
  reviews: CandidateFamilyPreviewVerificationInput["sourceReviews"],
  artifacts: Map<string, VerifiedArtifact>): {
    eligibleSourceCount: number; textScannedPageCount: number; ocrRequiredPageCount: number;
  } | null {
  let eligibleSourceCount = 0;
  let textScannedPageCount = 0;
  let ocrRequiredPageCount = 0;
  for (const source of sources.values()) {
    const relevant = source.stages.filter((stage) => stage === "PD" || stage === "RD") as Array<"PD" | "RD">;
    if (relevant.length === 0) continue;
    const review = reviews[source.sourceFileId];
    if (!review || review.revisionStatus !== "CURRENT" || review.approvalStatus !== "APPROVED") continue;
    const stored = artifacts.get(source.sourceFileId);
    if (source.stages.length > 1 && (!stored
      || Object.keys(review.pageStages).length !== stored.stageByPage.length)) continue;
    const matching = relevant.filter((stage) => source.sectionCode != null
      && candidateFamilyPreviewSections[code][stage as "PD" | "RD"].includes(source.sectionCode));
    if (matching.length === 0 || !stored) continue;
    if (source.stages.length > 1
      && !stored.stageByPage.some((stage) => stage !== null
        && matching.includes(stage as "PD" | "RD"))) continue;
    eligibleSourceCount += 1;
    const pages = stored.content.pages;
    if (!Array.isArray(pages) || pages.length !== stored.stageByPage.length) return null;
    for (const [index, page] of pages.entries()) {
      if (!matching.some((stage) => stage === stored.stageByPage[index])) continue;
      if (!record(page) || !record(page.quality)) return null;
      if (page.quality.disposition === "TEXT_LAYER_CANDIDATE") textScannedPageCount += 1;
      else if (page.quality.disposition === "OCR_REQUIRED") ocrRequiredPageCount += 1;
      else return null;
    }
  }
  return { eligibleSourceCount, textScannedPageCount, ocrRequiredPageCount };
}

export function verifyCandidateFamilyPreview(input: CandidateFamilyPreviewVerificationInput): boolean {
  const result = input.result;
  if (!record(result) || !exact(result, ["schemaVersion", "inputManifestHash", "objectId",
    "scope", "purpose", "candidateRulePackSha256", "numericLabelPackSha256",
    "classLabelPackSha256", "presenceLabelPackSha256", "codeRows", "findingCount",
    "parameterCoverage", "outputCount", "contentHash"])) return false;
  if (!hash(input.inputManifestHash) || !nonempty(input.objectId, 128)
    || result.schemaVersion !== "candidate-family-preview-v1"
    || result.inputManifestHash !== input.inputManifestHash || result.objectId !== input.objectId
    || result.scope !== "RUN_COMMITTED_SOURCES" || result.purpose !== "REVIEW_ONLY"
    || result.candidateRulePackSha256 !== candidateFamilyPreviewPolicy.candidateRulePackSha256
    || result.numericLabelPackSha256 !== candidateFamilyPreviewPolicy.numericLabelPackSha256
    || result.classLabelPackSha256 !== candidateFamilyPreviewPolicy.classLabelPackSha256
    || result.presenceLabelPackSha256 !== candidateFamilyPreviewPolicy.presenceLabelPackSha256
    || result.findingCount !== null || result.parameterCoverage !== null
    || result.outputCount !== 47 || !hash(result.contentHash)
    || !Array.isArray(result.codeRows) || result.codeRows.length !== 47
    || Buffer.byteLength(canonicalJson(result), "utf8") > 1024 * 1024
    || !Array.isArray(input.sourceFiles) || input.sourceFiles.length > 1000) return false;
  const { contentHash: _contentHash, ...unhashed } = result;
  if (sha256(canonicalJson(unhashed)) !== result.contentHash) return false;
  const sources = new Map(input.sourceFiles.map((source) => [source.sourceFileId, source]));
  if (sources.size !== input.sourceFiles.length
    || input.sourceFiles.some((source) => !validSource(input, source))) return false;
  const artifacts = verifiedArtifacts(input, sources);
  if (!artifacts) return false;
  const codes = Object.keys(candidateFamilyPreviewSpecs).sort();
  return result.codeRows.every((row, index) => {
    if (!record(row) || !exact(row, ["parameterCode", "family", "ruleId", "status",
      "reasonCodes", "eligibleSourceCount", "textScannedPageCount", "ocrRequiredPageCount",
      "leadCount", "candidateLeads"])) return false;
    const code = codes[index];
    const spec = candidateFamilyPreviewSpecs[code];
    const counts = verifiedCounts(code, sources, input.sourceReviews, artifacts);
    if (row.parameterCode !== code || row.family !== spec.family
      || row.ruleId !== `candidate-${code.toLowerCase()}` || row.status !== "ABSTAIN"
      || !Array.isArray(row.reasonCodes) || row.reasonCodes.length < 1
      || row.reasonCodes.length > reasons.size
      || row.reasonCodes.some((reason) => typeof reason !== "string" || !reasons.has(reason))
      || !same(row.reasonCodes, [...row.reasonCodes].sort())
      || new Set(row.reasonCodes).size !== row.reasonCodes.length
      || !integer(row.eligibleSourceCount) || row.eligibleSourceCount > input.sourceFiles.length
      || !integer(row.textScannedPageCount) || !integer(row.ocrRequiredPageCount)
      || counts === null || row.eligibleSourceCount !== counts.eligibleSourceCount
      || row.textScannedPageCount !== counts.textScannedPageCount
      || row.ocrRequiredPageCount !== counts.ocrRequiredPageCount
      || row.reasonCodes.includes("NO_ELIGIBLE_REVIEWED_SOURCE") !== (counts.eligibleSourceCount === 0)
      || row.reasonCodes.includes("OCR_REQUIRED_IN_SCOPE") !== (counts.ocrRequiredPageCount > 0)
      || !integer(row.leadCount) || !Array.isArray(row.candidateLeads)
      || row.leadCount !== row.candidateLeads.length || row.leadCount > 16
      || (row.leadCount === 0 && row.textScannedPageCount > 0)
        !== row.reasonCodes.includes("NO_EXACT_LABEL_LEAD")
      || (row.leadCount > 0) !== row.reasonCodes.includes("FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED")) return false;
    const leadHashes = new Set<string>();
    for (const lead of row.candidateLeads) {
      if (!validLead(input, row, lead, sources, artifacts)) return false;
      const digest = (lead as Json).leadSha256 as string;
      if (leadHashes.has(digest)) return false;
      leadHashes.add(digest);
    }
    return true;
  });
}
