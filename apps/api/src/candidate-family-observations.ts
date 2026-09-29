import { canonicalJson, sha256 } from "./canonical-json.js";
import { verifyCandidateFamilyPreview,
  type CandidateFamilyPreviewVerificationInput } from "./candidate-family-preview.js";

/** Frozen manifest/review/text inputs are projected independently by the caller. */
export interface CandidateFamilyObservationsVerificationInput
  extends Omit<CandidateFamilyPreviewVerificationInput, "result"> {
  preview: unknown;
  result: unknown;
}

type Json = Record<string, unknown>;
const numericFamilies = new Set(["DECREASE", "INCREASE", "DIFFERENT", "RELATIVE_DELTA",
  "RELATIVE_INCREASE", "LOWER_BOUND", "UPPER_BOUND"]);
const classValues: Record<string, RegExp> = {
  reliability_category: /^(?:[123]|I|II|III)$/u,
  energy_class: /^(?:[A-G]|[АВСДЕ])$/u,
  fire_resistance_degree: /^(?:I|II|III|IV|V)$/u,
  structural_fire_hazard_class: /^(?:С|C)[0-3]$/u,
  finish_fire_class: /^(?:КМ|KM)[0-5]$/u,
  fire_rating: /^(?:EI|E|I)-(?:15|30|45|60|90|120)$/u,
};
const observationFields = ["schemaVersion", "status", "parameterCode", "family", "attribute",
  "canonicalUnit", "matchedLabel", "rawValue", "rawUnit", "featureKey", "scopeTokens",
  "objectId", "inputManifestHash", "sourceFileId", "sourceSha256", "artifactSha256",
  "stage", "sectionCode", "revisionStatus", "approvalStatus", "pageNumber", "lineText",
  "blockTextSha256", "locator", "leadSha256", "candidateRulePackSha256",
  "numericLabelPackSha256", "classLabelPackSha256", "presenceLabelPackSha256",
  "typedFact", "observationId"] as const;
const factFields = ["factId", "schemaVersion", "parameterCode", "objectId",
  "inputManifestHash", "attribute", "stage", "sourceFileId", "sourceSha256",
  "artifactSha256", "leadSha256", "pageNumber", "rawText", "rawValue", "rawUnit",
  "canonicalUnit", "locator"] as const;
const record = (value: unknown): value is Json => value !== null
  && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string"
  && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0): value is number =>
  Number.isSafeInteger(value) && Number(value) >= minimum;
const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const exact = (value: Json, fields: readonly string[]): boolean =>
  same(Object.keys(value).sort(), [...fields].sort());

function lines(blockText: string): Array<{ text: string; start: number }> {
  const chars = Array.from(blockText);
  const result: Array<{ text: string; start: number }> = [];
  let start = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (!["\n", "\r", "\v", "\f", "\u001c", "\u001d", "\u001e", "\u0085", "\u2028", "\u2029"].includes(ch)) continue;
    const next = ch === "\r" && chars[index + 1] === "\n" ? index + 2 : index + 1;
    result.push({ text: chars.slice(start, next).join("").replace(/[\r\n]+$/u, ""), start });
    start = next;
    index = next - 1;
  }
  if (start < chars.length) result.push({ text: chars.slice(start).join(""), start });
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function numericValue(value: unknown, unit: unknown, canonicalUnit: unknown): boolean {
  if (typeof value !== "string" || value.length > 500
    || !/^(?:[0-9]+|[0-9]{1,3}(?:[ \u00a0][0-9]{3})+)(?:[.,][0-9]+)?$/u.test(value)
    || typeof unit !== "string" || !unit.trim()) return false;
  if (canonicalUnit !== "count") return true;
  const fractional = value.replaceAll("\u00a0", " ").replaceAll(" ", "")
    .replace(",", ".").split(".")[1];
  return fractional === undefined || !/[1-9]/u.test(fractional);
}

function expectedFact(lead: Json, blockText: string, manifestHash: string): Json {
  const lineLocator = lead.locator as Json;
  const rawUnit = lead.family === "CLASS_DECREASE" ? lead.canonicalUnit : lead.rawUnit;
  const fact = {
    schemaVersion: "typed-fact-v1", parameterCode: lead.parameterCode,
    objectId: lead.objectId, inputManifestHash: manifestHash,
    attribute: lead.attribute, stage: lead.stage,
    sourceFileId: lead.sourceFileId, sourceSha256: lead.sourceSha256,
    artifactSha256: lead.artifactSha256, leadSha256: lead.leadSha256,
    pageNumber: lead.pageNumber, rawText: blockText, rawValue: lead.rawValue,
    rawUnit, canonicalUnit: lead.canonicalUnit,
    locator: { kind: "TEXT_BLOCK", blockIndex: lineLocator.blockIndex,
      start: lineLocator.start, end: lineLocator.end,
      bboxMilliPoints: lineLocator.bboxMilliPoints },
  };
  return { factId: sha256(canonicalJson(fact)), ...fact };
}

function verifyObservation(lead: Json, observation: unknown, input: CandidateFamilyObservationsVerificationInput,
  preview: Json): boolean {
  if (!record(observation) || !exact(observation, observationFields)
    || !hash(observation.observationId) || !record(lead.locator)
    || !integer(lead.pageNumber, 1) || !integer(lead.locator.blockIndex)
    || !integer(lead.locator.start) || !integer(lead.locator.end, 1)
    || lead.locator.end <= lead.locator.start) return false;
  const source = input.sourceFiles.find((item) => item.sourceFileId === lead.sourceFileId);
  const review = input.sourceReviews[String(lead.sourceFileId)];
  const stored = input.textArtifacts[String(lead.sourceFileId)];
  if (!source || !review || review.revisionStatus !== "CURRENT"
    || review.approvalStatus !== "APPROVED" || source.sha256 !== lead.sourceSha256
    || source.sectionCode !== lead.sectionCode || !stored
    || !hash(stored.content_hash) || stored.content_hash !== lead.artifactSha256
    || !record(stored.content_json) || !Array.isArray(stored.content_json.pages)) return false;
  const page = stored.content_json.pages.find((item: unknown) => record(item)
    && item.pageNumber === lead.pageNumber);
  if (!record(page) || !record(page.quality)
    || page.quality.disposition !== "TEXT_LAYER_CANDIDATE"
    || !Array.isArray(page.blocks)) return false;
  const block = page.blocks[lead.locator.blockIndex];
  if (!record(block) || typeof block.text !== "string"
    || !same(block.bboxMilliPoints, lead.locator.bboxMilliPoints)
    || sha256(block.text) !== lead.blockTextSha256
    || Array.from(block.text).slice(lead.locator.start, lead.locator.end).join("")
      !== lead.rawValue) return false;
  if (!integer(lead.locator.lineIndex)) return false;
  const selectedLine = lines(block.text)[lead.locator.lineIndex];
  if (!selectedLine || selectedLine.text !== lead.lineText
    || lead.locator.start < selectedLine.start
    || lead.locator.end > selectedLine.start + Array.from(selectedLine.text).length) return false;
  const numeric = numericFamilies.has(String(lead.family));
  const classToken = lead.family === "CLASS_DECREASE";
  if (numeric) {
    if (!numericValue(lead.rawValue, lead.rawUnit, lead.canonicalUnit)) return false;
    const suffix = Array.from(selectedLine.text)
      .slice(lead.locator.end - selectedLine.start).join("");
    if (!new RegExp(`^\\s*${escapeRegExp(String(lead.rawUnit))}\\s*[.;]?\\s*$`, "u")
      .test(suffix)) return false;
  } else if (classToken) {
    const allowed = classValues[String(lead.canonicalUnit)];
    if (lead.rawUnit !== null || !allowed || typeof lead.rawValue !== "string"
      || !allowed.test(lead.rawValue)) return false;
  }
  const typed = numeric || classToken;
  if (typed) {
    if (!record(observation.typedFact) || !exact(observation.typedFact, factFields)
      || !same(observation.typedFact,
        expectedFact(lead, block.text, input.inputManifestHash))) return false;
  } else if (observation.typedFact !== null) return false;
  const expected = {
    schemaVersion: "candidate-family-observation-v1", status: "REVIEW_ONLY",
    parameterCode: lead.parameterCode, family: lead.family,
    attribute: lead.attribute, canonicalUnit: lead.canonicalUnit,
    matchedLabel: lead.matchedLabel, rawValue: lead.rawValue, rawUnit: lead.rawUnit,
    featureKey: lead.featureKey, scopeTokens: lead.scopeTokens,
    objectId: input.objectId, inputManifestHash: input.inputManifestHash,
    sourceFileId: lead.sourceFileId, sourceSha256: lead.sourceSha256,
    artifactSha256: lead.artifactSha256, stage: lead.stage,
    sectionCode: lead.sectionCode, revisionStatus: "CURRENT", approvalStatus: "APPROVED",
    pageNumber: lead.pageNumber, lineText: lead.lineText,
    blockTextSha256: lead.blockTextSha256, locator: lead.locator,
    leadSha256: lead.leadSha256,
    candidateRulePackSha256: preview.candidateRulePackSha256,
    numericLabelPackSha256: preview.numericLabelPackSha256,
    classLabelPackSha256: preview.classLabelPackSha256,
    presenceLabelPackSha256: preview.presenceLabelPackSha256,
    typedFact: typed ? expectedFact(lead, block.text, input.inputManifestHash) : null,
  };
  return observation.observationId === sha256(canonicalJson(expected))
    && same(observation, { ...expected, observationId: observation.observationId });
}

/** Admit review-only observations only when every row and fact is bound to the pinned preview. */
export function verifyCandidateFamilyObservations(input: CandidateFamilyObservationsVerificationInput): boolean {
  try {
    const { preview, result } = input;
    if (!record(preview) || !record(result)
      || !verifyCandidateFamilyPreview({ ...input, result: preview })
      || !exact(result, ["schemaVersion", "purpose", "inputManifestHash", "objectId",
        "candidateRulePackSha256", "numericLabelPackSha256", "classLabelPackSha256",
        "presenceLabelPackSha256", "codeRows", "observations", "outputCount",
        "findingCount", "parameterCoverage", "contentHash"])
      || result.schemaVersion !== "candidate-family-observations-v1"
      || result.purpose !== "REVIEW_ONLY" || result.objectId !== input.objectId
      || result.inputManifestHash !== input.inputManifestHash
      || !hash(result.contentHash) || !Array.isArray(result.codeRows)
      || result.codeRows.length !== 47 || !Array.isArray(result.observations)
      || result.observations.length > 47 * 16
      || result.outputCount !== result.observations.length
      || result.findingCount !== null || result.parameterCoverage !== null
      || !Array.isArray(preview.codeRows) || preview.codeRows.length !== 47
      || Buffer.byteLength(canonicalJson(result), "utf8") > 6 * 1024 * 1024) return false;
    for (const key of ["candidateRulePackSha256", "numericLabelPackSha256",
      "classLabelPackSha256", "presenceLabelPackSha256"] as const) {
      if (result[key] !== preview[key] || !hash(result[key])) return false;
    }
    const { contentHash: _ignored, ...content } = result;
    if (sha256(canonicalJson(content)) !== result.contentHash) return false;
    let observationIndex = 0;
    for (let index = 0; index < 47; index += 1) {
      const previewRow = preview.codeRows[index];
      const row = result.codeRows[index];
      if (!record(previewRow) || !record(row) || !Array.isArray(previewRow.candidateLeads)
        || !Array.isArray(previewRow.reasonCodes)
        || !exact(row, ["parameterCode", "family", "status", "observationCount", "reasonCodes"])
        || row.parameterCode !== previewRow.parameterCode || row.family !== previewRow.family
        || row.status !== "REVIEW_ONLY" || row.observationCount !== previewRow.candidateLeads.length
        || !same(row.reasonCodes, previewRow.textScannedPageCount === 0
          ? previewRow.reasonCodes.filter((reason) => reason !== "NO_EXACT_LABEL_LEAD")
          : previewRow.reasonCodes)) return false;
      for (const lead of previewRow.candidateLeads) {
        if (!record(lead) || !verifyObservation(lead, result.observations[observationIndex], input,
          preview)) return false;
        observationIndex += 1;
      }
    }
    return observationIndex === result.observations.length;
  } catch {
    return false;
  }
}
