import { canonicalJson, sha256 } from "./canonical-json.js";
import type { PilotCandidateSource } from "./pilot-candidate.js";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const components: Record<string, RegExp> = {
  HEATING: /^(?:на\s+)?отоплени[ея]$/iu,
  VENTILATION: /^(?:на\s+)?вентиляци[юя]$/iu,
  CURTAINS: /^(?:на\s+)?(?:тепло[\s-]*завесы|воздушно[\s-]*тепловые\s+завесы)$/iu,
  DHW: /^(?:на\s+)?(?:ГВС|горячее\s+водоснабжение)$/iu,
};
const tableComponent = (text: string): string | null => {
  const compact = text.replace(/[\s-]+/gu, "").toLocaleLowerCase("ru").replace(/\.$/u, "");
  const aliases: Record<string, string[]> = {
    HEATING: ["отопление", "наотопление"],
    VENTILATION: ["вентиляция", "вентиляцию", "навентиляцию", "навентиляция"],
    CURTAINS: ["тепловыезавесы", "теплозавесы", "натеплозавесы", "воздушнотепловыезавесы", "навоздушнотепловыезавесы"],
    DHW: ["гвс", "нагвс", "гвсмакс", "горячееводоснабжение", "нагорячееводоснабжение"],
  };
  return Object.entries(aliases).find(([, forms]) => forms.includes(compact))?.[0] ?? null;
};
const numberPattern = /^[0-9]+(?:[ \u00a0][0-9]{3})*(?:[.,][0-9]+)?$/u;
const thermal = /теплов(?:ая|ой|ую)\s+(?:нагрузк[\p{L}]*|поток[\p{L}]*)/iu;
const unitPattern = /^(?:Гкал\s*\/\s*(?:час|ч)|кВт|МВт|kW|MW)$/iu;
const inlineValue = "[0-9]+(?:[ \\u00a0][0-9]{3})*(?:[.,][0-9]+)?";
const inlineUnit = "(?:Гкал\\s*\\/\\s*(?:час|ч)|кВт|МВт|kW|MW)";

function decimal(raw: unknown): { value: bigint; scale: bigint } | null {
  if (typeof raw !== "string" || !/^[0-9]+(?:[.,][0-9]+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.replace(",", ".").split(".");
  if (whole.length + fraction.length > 60) return null;
  return { value: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
}

function signedDecimal(raw: unknown): { value: bigint; scale: bigint } | null {
  if (typeof raw !== "string") return null;
  if (raw.startsWith("-")) {
    const parsed = decimal(raw.slice(1));
    return parsed ? { value: -parsed.value, scale: parsed.scale } : null;
  }
  return decimal(raw);
}

function normalized(rawValue: unknown, rawUnit: unknown, actual: unknown, canonical: unknown): boolean {
  if (typeof rawValue !== "string" || !numberPattern.test(rawValue)
    || typeof rawUnit !== "string" || !unitPattern.test(rawUnit)) return false;
  const base = decimal(rawValue.replace(/[ \u00a0]/gu, ""));
  const proposed = decimal(actual);
  if (!base || !proposed) return false;
  const unit = rawUnit.replace(/\s/gu, "").toLocaleLowerCase("ru");
  const factor = unit === "мвт" || unit === "mw" ? 1000n : 1n;
  const expectedUnit = unit === "мвт" || unit === "mw" || unit === "квт" || unit === "kw" ? "kW" : "Gcal/h";
  return canonical === expectedUnit && base.value * factor * proposed.scale === proposed.value * base.scale;
}

function locator(evidence: unknown, source: PilotCandidateSource, stage: "PD" | "RD"):
  { text: string; box: number[]; page: number; block: number } | null {
  if (!record(evidence) || evidence.sourceFileId !== source.sourceFileId
    || evidence.inputSha256 !== source.sha256 || !Number.isInteger(evidence.pageNumber)
    || !Number.isInteger(evidence.blockIndex) || !Number.isInteger(evidence.lineIndex)
    || typeof evidence.text !== "string" || !Array.isArray(evidence.bboxMilliPoints)) return null;
  const pageNumber = Number(evidence.pageNumber);
  const blockIndex = Number(evidence.blockIndex);
  const lineIndex = Number(evidence.lineIndex);
  if (pageNumber < 1 || blockIndex < 0 || lineIndex < 0) return null;
  const artifact = source.textArtifact;
  if (!record(artifact) || artifact.schemaVersion !== "document-text-v2"
    || artifact.sourceFileId !== source.sourceFileId || artifact.inputSha256 !== source.sha256
    || !hash(source.textArtifactHash) || sha256(canonicalJson(artifact)) !== source.textArtifactHash
    || !Array.isArray(artifact.pages) || pageNumber > artifact.pages.length) return null;
  const page = artifact.pages[pageNumber - 1];
  if (!record(page) || page.pageNumber !== pageNumber || !Array.isArray(page.blocks)
    || !record(page.quality) || page.quality.disposition !== "TEXT_LAYER_CANDIDATE") return null;
  const block = page.blocks[blockIndex];
  if (!record(block) || typeof block.text !== "string" || !Array.isArray(block.bboxMilliPoints)) return null;
  const lines = block.text.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean);
  const textMatches = evidence.textKind === "BLOCK"
    ? lineIndex === 0 && evidence.text === block.text
    : (evidence.textKind === undefined || evidence.textKind === "LINE") && lines[lineIndex] === evidence.text;
  if (!textMatches || canonicalJson(block.bboxMilliPoints) !== canonicalJson(evidence.bboxMilliPoints)) return null;
  const reviewStage = source.review?.pageStages[String(pageNumber)];
  const resolved = reviewStage ?? (source.stages.length === 1 ? source.stages[0] : null);
  if (resolved !== stage || !source.stages.includes(stage)) return null;
  return { text: String(evidence.text), box: block.bboxMilliPoints as number[], page: pageNumber, block: blockIndex };
}

function checkFact(fact: unknown, stage: "PD" | "RD", sources: Map<string, PilotCandidateSource>): boolean {
  if (!record(fact) || fact.parameterCode !== "PZ-017" || fact.extractionProfile !== "pz-017-heat-components-v1"
    || fact.stage !== stage || fact.entityKey !== "building-total"
    || typeof fact.component !== "string" || !components[fact.component]
    || typeof fact.sourceFileId !== "string" || !Array.isArray(fact.evidence)
    || ![1, 3].includes(fact.evidence.length)
    || !normalized(fact.rawValue, fact.rawUnit, fact.normalizedValue, fact.canonicalUnit)) return false;
  const source = sources.get(fact.sourceFileId);
  if (!source || !fact.evidence.every((item) => locator(item, source, stage))) return false;
  const parts = fact.evidence as Json[];
  const anchor = parts[parts.length - 1];
  if (anchor.sourceFileId !== fact.sourceFileId || anchor.inputSha256 !== fact.inputSha256
    || anchor.pageNumber !== fact.pageNumber || anchor.blockIndex !== fact.blockIndex
    || anchor.lineIndex !== fact.lineIndex) return false;
  if (parts.length === 1) {
    const text = parts[0].text;
    if (parts[0].role !== "line" || typeof text !== "string" || !thermal.test(text)
      || /электрическ/iu.test(text)) return false;
    const heading = thermal.exec(text);
    const tail = text.slice((heading?.index ?? 0) + (heading?.[0].length ?? 0));
    const componentPattern = components[fact.component].source.slice(1, -1);
    const pattern = new RegExp(`(${componentPattern})\\s*[:=—–-]\\s*(${inlineValue})\\s*(${inlineUnit})(?![\\p{L}\\p{N}])`, "giu");
    const matches = [...tail.matchAll(pattern)];
    return matches.length === 1 && matches[0][2] === fact.rawValue && matches[0][3] === fact.rawUnit
      && !/электрическ/iu.test(text)
      && Object.entries(components).every(([name, other]) => name === fact.component
        || !new RegExp(other.source.slice(1, -1) + `\\s*[:=—–-]\\s*${inlineValue}`, "iu").test(tail));
  }
  if (canonicalJson(parts.map((item) => item.role)) !== canonicalJson(["thermalHeading", "componentHeader", "valueCell"])) return false;
  const [heading, label, value] = parts;
  if (![heading, label, value].every((item) => item.sourceFileId === source.sourceFileId && item.pageNumber === anchor.pageNumber)) return false;
  if (typeof heading.text !== "string" || !thermal.test(heading.text)
    || typeof label.text !== "string" || tableComponent(label.text) !== fact.component
    || !heading.text.replace(/\s/gu, "").toLocaleLowerCase("ru")
      .includes(String(fact.rawUnit).replace(/\s/gu, "").toLocaleLowerCase("ru"))
    || value.text !== fact.rawValue || !numberPattern.test(String(value.text))) return false;
  // Table header and label can be multiline blocks. Their evidence explicitly
  // claims BLOCK text and bbox. Only the numeric cell must be a single-line block.
  const positions = parts.map((item) => locator(item, source, stage));
  if (positions.some((item) => !item)) return false;
  const blocks = ((source.textArtifact?.pages as Json[])[Number(anchor.pageNumber) - 1].blocks as Json[]);
  if (parts.some((item) => item.textKind !== "BLOCK")
    || blocks[Number(value.blockIndex)].text?.toString().split(/\r?\n/u).filter(Boolean).length !== 1) return false;
  const [headBox, labelBox, valueBox] = positions.map((item) => item!.box);
  const headingAbove = headBox[1] > labelBox[3];
  const headingLeft = headBox[2] < valueBox[0]
    && Math.min(headBox[3], valueBox[3]) > Math.max(headBox[1], valueBox[1]);
  return (headingAbove || headingLeft) && labelBox[1] > valueBox[3]
    && labelBox[1] - valueBox[3] < 140_000
    && Math.min(labelBox[2], valueBox[2]) > Math.max(labelBox[0], valueBox[0]);
}

export function verifyPilotHeatAnalysis(
  analysis: unknown, objectId: string, manifestHash: string, sources: PilotCandidateSource[],
): boolean {
  if (!record(analysis) || analysis.schemaVersion !== "pz-017-analysis-v1"
    || analysis.objectId !== objectId || analysis.selectedManifestHash !== manifestHash
    || analysis.extractionProfile !== "pz-017-heat-components-v1"
    || !Array.isArray(analysis.selectedFileIds)
    || canonicalJson([...analysis.selectedFileIds].sort()) !== canonicalJson(sources.map((item) => item.sourceFileId).sort())
    || !Array.isArray(analysis.pdFacts) || !Array.isArray(analysis.rdFacts)
    || analysis.pdFacts.length > 128 || analysis.rdFacts.length > 128
    || !record(analysis.comparison) || !record(analysis.evaluation)
    || !record(analysis.scannedPages) || !Number.isInteger(analysis.ocrRequiredPageCount)) return false;
  const byId = new Map(sources.map((item) => [item.sourceFileId, item]));
  const scanned = { PD: 0, RD: 0 };
  let ocrRequired = 0;
  for (const source of sources) {
    const artifact = source.textArtifact;
    if (!record(artifact)) continue;
    if (!hash(source.textArtifactHash) || sha256(canonicalJson(artifact)) !== source.textArtifactHash
      || !Array.isArray(artifact.pages)) return false;
    for (const page of artifact.pages) {
      if (!record(page) || !Number.isInteger(page.pageNumber) || !record(page.quality)) return false;
      const stage = source.review?.pageStages[String(page.pageNumber)]
        ?? (source.stages.length === 1 ? source.stages[0] : null);
      if (stage === "PD" || stage === "RD") {
        scanned[stage] += 1;
        if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") ocrRequired += 1;
      }
    }
  }
  if (analysis.scannedPages.PD !== scanned.PD || analysis.scannedPages.RD !== scanned.RD
    || analysis.ocrRequiredPageCount !== ocrRequired) return false;
  if (!analysis.pdFacts.every((item) => checkFact(item, "PD", byId))
    || !analysis.rdFacts.every((item) => checkFact(item, "RD", byId))) return false;
  const evaluation = analysis.evaluation;
  const comparison = analysis.comparison;
  if (comparison.schemaVersion !== "pz-017-component-comparison-v1"
    || comparison.parameterCode !== "PZ-017"
    || [analysis, evaluation, comparison].some((item) =>
      ["total", "pdTotal", "rdTotal", "totalDelta"].some((field) => field in item))) return false;
  if (evaluation.schemaVersion !== "typed-rule-result-v1" || evaluation.ruleId !== "pilot-pz-017-heat"
    || evaluation.ruleVersion !== "1" || evaluation.parameterCode !== "PZ-017"
    || evaluation.objectId !== objectId || evaluation.executionStatus !== "SUCCEEDED"
    || !["MISSING_EVIDENCE", "CLARIFICATION_REQUIRED"].includes(String(evaluation.machineStatus))
    || !Array.isArray(evaluation.evidence) || evaluation.evidence.length !== 0
    || evaluation.finding !== null || comparison.finding !== null || comparison.totalComparable !== false) return false;
  const pd = new Set(analysis.pdFacts.map((item: Json) => item.component));
  const rd = new Set(analysis.rdFacts.map((item: Json) => item.component));
  const pdFacts = analysis.pdFacts as Json[];
  const rdFacts = analysis.rdFacts as Json[];
  const sameBasis = pd.size === analysis.pdFacts.length && rd.size === analysis.rdFacts.length
    && canonicalJson([...pd].sort()) === canonicalJson([...rd].sort());
  const duplicate = pd.size !== analysis.pdFacts.length || rd.size !== analysis.rdFacts.length;
  const unitMismatch = sameBasis && [...pd].some((component) => {
    const left = pdFacts.find((fact) => fact.component === component) as Json;
    const right = rdFacts.find((fact) => fact.component === component) as Json;
    return left.canonicalUnit !== right.canonicalUnit;
  });
  const expectedStatus = !pd.size || !rd.size ? "MISSING_EVIDENCE" : "CLARIFICATION_REQUIRED";
  const expectedReason = !pd.size || !rd.size ? "MISSING_PD_OR_RD_HEAT_COMPONENT"
    : duplicate ? "DUPLICATE_COMPONENT"
      : !sameBasis ? "COMPONENT_BASIS_MISMATCH"
        : unitMismatch ? "UNIT_BASIS_MISMATCH"
      : "SOURCE_REVISION_LINK_AND_SCOPE_UNRESOLVED";
  if (evaluation.machineStatus !== expectedStatus || evaluation.reasonCode !== expectedReason) return false;
  if (sameBasis && pd.size && rd.size && !unitMismatch) {
    if (comparison.disposition !== "COMPONENTS_COMPARABLE" || !Array.isArray(comparison.comparisons)
      || comparison.comparisons.length !== pd.size
      || canonicalJson(comparison.componentBasis) !== canonicalJson([...pd].sort())
      || comparison.entityKey !== "building-total") return false;
    for (const item of comparison.comparisons) {
      if (!record(item) || typeof item.component !== "string" || !pd.has(item.component)) return false;
      const expected = analysis.pdFacts.find((fact: Json) => fact.component === item.component) as Json;
      const actual = analysis.rdFacts.find((fact: Json) => fact.component === item.component) as Json;
      const left = signedDecimal(item.pdValue);
      const right = signedDecimal(item.rdValue);
      const delta = signedDecimal(item.delta);
      if (!left || !right || !delta || item.pdValue !== expected.normalizedValue
        || item.rdValue !== actual.normalizedValue
        || item.canonicalUnit !== expected.canonicalUnit || item.canonicalUnit !== actual.canonicalUnit
        || canonicalJson(item.pdEvidence) !== canonicalJson(expected.evidence)
        || canonicalJson(item.rdEvidence) !== canonicalJson(actual.evidence)
        || delta.value * left.scale * right.scale
          !== (right.value * left.scale - left.value * right.scale) * delta.scale) return false;
    }
    if (new Set(comparison.comparisons.map((item: Json) => item.component)).size !== pd.size) return false;
  } else if (comparison.disposition !== "ABSTAIN"
    || comparison.reasonCode !== (duplicate ? "DUPLICATE_COMPONENT" : !pd.size || !rd.size
      ? "MISSING_COMPONENT_EVIDENCE" : !sameBasis ? "COMPONENT_BASIS_MISMATCH" : "UNIT_BASIS_MISMATCH")
    || (comparison.reasonCode === "COMPONENT_BASIS_MISMATCH"
      && (canonicalJson(comparison.pdComponents) !== canonicalJson([...pd].sort())
        || canonicalJson(comparison.rdComponents) !== canonicalJson([...rd].sort())))) return false;
  return true;
}
