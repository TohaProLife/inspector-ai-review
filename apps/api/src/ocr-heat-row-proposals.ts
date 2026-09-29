import { canonicalJson, sha256 } from "./canonical-json.js";
import { boundedOcrConfigHashV3, boundedOcrProfileIdV3,
  boundedOcrProfileV3, boundedOcrConfigHashV4, boundedOcrProfileIdV4,
  boundedOcrProfileV4, boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrProfileV5 } from "./ocr-layout.js";

/** Persisted OCR artifact plus integrity columns (also returned by the internal OCR read). */
export interface OcrHeatStageEnvelope {
  content_json: unknown;
  content_hash: string;
  byte_size: number | string;
  provider_profile_id: string;
  provider_config_hash: string;
  input_manifest_hash: string;
}

type Json = Record<string, unknown>;
type Line = { text: string; score: number; bboxPx: [number, number, number, number] };
type Page = { sourceFileId: string; inputSha256: string; pageNumber: number;
  contentHash: string; render: { sha256: string }; lines: Line[] };
type Evidence = { role: string; lineIndex: number; text: string;
  bboxPx: [number, number, number, number]; score: number };

const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const record = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const keys = (value: Json, expected: string[]): boolean =>
  Object.keys(value).sort().join("|") === [...expected].sort().join("|");
const center = (line: Line): number => (line.bboxPx[1] + line.bboxPx[3]) / 2;

export function stageContent(envelope: unknown, manifestHash: string): Json | null {
  const v4 = record(envelope) && envelope.provider_profile_id === boundedOcrProfileIdV4;
  const v5 = record(envelope) && envelope.provider_profile_id === boundedOcrProfileIdV5;
  const expectedProfileId = v5 ? boundedOcrProfileIdV5 : v4 ? boundedOcrProfileIdV4 : boundedOcrProfileIdV3;
  const expectedHash = v5 ? boundedOcrConfigHashV5 : v4 ? boundedOcrConfigHashV4 : boundedOcrConfigHashV3;
  const expectedProfile = v5 ? boundedOcrProfileV5 : v4 ? boundedOcrProfileV4 : boundedOcrProfileV3;
  if (!record(envelope) || !record(envelope.content_json) || !hash(envelope.content_hash)
    || !hash(envelope.input_manifest_hash) || envelope.input_manifest_hash !== manifestHash
    || envelope.provider_profile_id !== expectedProfileId
    || envelope.provider_config_hash !== expectedHash) return null;
  const content = envelope.content_json;
  const canonical = canonicalJson(content);
  const byteSize = Buffer.byteLength(canonical, "utf8");
  if (byteSize > 8 * 1024 * 1024 || byteSize !== Number(envelope.byte_size)
    || sha256(canonical) !== envelope.content_hash || !keys(content, ["schemaVersion", "jobType",
      "inputManifestHash", "disposition", "reasonCode", "providerKind", "providerProfileId",
      "providerConfigHash", "outputCount", "analysis"])
    || content.schemaVersion !== "analysis-stage-result-v2"
    || content.jobType !== "DOCUMENT_OCR_LAYOUT" || content.disposition !== "OCR_LAYOUT_BOUNDED"
    || content.reasonCode !== "BOUNDED_OCR_ONLY" || content.providerKind !== "OCR_LAYOUT"
    || content.providerProfileId !== expectedProfileId
    || content.providerConfigHash !== expectedHash
    || content.inputManifestHash !== manifestHash || !record(content.analysis)) return null;
  const analysis = content.analysis;
  if (analysis.schemaVersion !== (v5 ? "bounded-ocr-layout-analysis-v5"
    : v4 ? "bounded-ocr-layout-analysis-v4" : "bounded-ocr-layout-analysis-v3")
    || analysis.inputManifestHash !== manifestHash
    || canonicalJson(analysis.profile) !== canonicalJson(expectedProfile)
    || !Array.isArray(analysis.sources) || !count(analysis.sourceCount)
    || analysis.sourceCount !== analysis.sources.length
    || !count(analysis.processedPageCount)
    || analysis.processedPageCount > (v5 ? boundedOcrProfileV5.maxPagesPerRun : boundedOcrProfileV4.maxPagesPerRun)
    || content.outputCount !== analysis.processedPageCount) return null;
  return content;
}

export function verifiedPage(raw: unknown, sourceId: string, sourceHash: string): Page | null {
  if (!record(raw) || !keys(raw, ["schemaVersion", "sourceFileId", "inputSha256",
    "pageNumber", "render", "provider", "lines", "contentHash"])
    || raw.schemaVersion !== "document-ocr-page-v1" || raw.sourceFileId !== sourceId
    || raw.inputSha256 !== sourceHash || !count(raw.pageNumber) || raw.pageNumber === 0
    || !hash(raw.contentHash) || !record(raw.render) || !record(raw.provider)
    || !keys(raw.render, ["sha256", "widthPx", "heightPx", "dpi", "rendererProfileId"])
    || !hash(raw.render.sha256) || !count(raw.render.widthPx) || !count(raw.render.heightPx)
    || !raw.render.widthPx || !raw.render.heightPx || raw.render.widthPx > 20_000
    || raw.render.heightPx > 20_000 || raw.render.widthPx * raw.render.heightPx > 25_000_000
    || raw.render.dpi !== 120
    || raw.render.rendererProfileId !== boundedOcrProfileV3.rendererProfileId
    || !keys(raw.provider, ["profileId", "script"])
    || !(boundedOcrProfileV3.ocrProviderProfileIds as readonly string[])
      .includes(raw.provider.profileId as string) || raw.provider.script !== "eslav"
    || !Array.isArray(raw.lines) || raw.lines.length > 5000) return null;
  const width = raw.render.widthPx as number;
  const height = raw.render.heightPx as number;
  for (const line of raw.lines) {
    if (!record(line) || !keys(line, ["text", "score", "bboxPx"])
      || typeof line.text !== "string" || line.text.length > 4096
      || typeof line.score !== "number" || !Number.isFinite(line.score)
      || line.score < 0 || line.score > 1 || !Array.isArray(line.bboxPx)
      || line.bboxPx.length !== 4 || !line.bboxPx.every((part) =>
        typeof part === "number" && Number.isFinite(part))
      || !(0 <= line.bboxPx[0] && line.bboxPx[0] < line.bboxPx[2]
        && line.bboxPx[2] <= width && 0 <= line.bboxPx[1]
        && line.bboxPx[1] < line.bboxPx[3] && line.bboxPx[3] <= height)) return null;
  }
  const { contentHash: _ignored, ...unhashed } = raw;
  if (sha256(canonicalJson(unhashed)) !== raw.contentHash) return null;
  return raw as Page;
}

function entry(page: Page, index: number, role: string): Evidence {
  const line = page.lines[index];
  return { role, lineIndex: index, text: line.text, bboxPx: line.bboxPx, score: line.score };
}

const sections: Array<[string, RegExp]> = [
  ["HEATING", /^\s*Система\s+отопления\s*$/iu],
  ["VENTILATION", /^\s*Теплоснабжение\s+вентиляции\s*$/iu],
  ["DHW", /^\s*Система\s+горячего\s+водоснабжения\s*$/iu],
];
const thermalValue = /\d[\d.,]*\s*(?:квт|гкал)(?=$|[^\p{L}\p{N}_])/iu;
const pair = /^\s*(\d+(?:[.,]\d+)?)\s*(?:кВт|КВТ|квт)\.?\s*\(\s*(\d+(?:[.,]\d+)?)\s*(?:Гкал|ГКАЛ|гкал)\s*\/\s*(?:час|ч|ЧАС|Ч)\s*\)\s*$/u;

function micro(value: string): bigint | null {
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  // Match extractor's bounded decimal grammar; retain leading zeros in proposal text.
  if (fraction.length > 6 || whole.length > 12) return null;
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function parsedPair(text: string): { values: { kW: string; "Gcal/h": string };
  validConversion: boolean } | null {
  const match = pair.exec(text);
  if (!match) return null;
  const kW = micro(match[1]);
  const gcal = micro(match[2]);
  if (kW === null || gcal === null || kW <= 0n || gcal <= 0n) return null;
  const diff = kW > gcal * 1163n ? kW - gcal * 1163n : gcal * 1163n - kW;
  return { values: { kW: match[1].replace(",", "."), "Gcal/h": match[2].replace(",", ".") },
    validConversion: diff <= 650_000n };
}

function derivePage(page: Page, reviewStage: unknown,
  proposals: Json[], abstentions: Json[]): void {
  const sectionLines: Array<{ index: number; component: string }> = [];
  for (const [index, line] of page.lines.entries()) {
    for (const [component, pattern] of sections) {
      if (pattern.test(line.text)) sectionLines.push({ index, component });
    }
  }
  sectionLines.sort((left, right) => center(page.lines[left.index]) - center(page.lines[right.index]));
  const abstain = (index: number, reasonCode: string, evidence: Evidence[]) => {
    abstentions.push({ sourceFileId: page.sourceFileId, inputSha256: page.inputSha256,
      pageNumber: page.pageNumber, lineIndex: index, reasonCode, evidence });
  };
  for (const [valueIndex, value] of page.lines.entries()) {
    if (!thermalValue.test(value.text)) continue;
    if (reviewStage !== "RD") {
      abstain(valueIndex, reviewStage === "PD" || reviewStage === "ID"
        ? "PAGE_STAGE_NOT_RD" : "PAGE_STAGE_UNRESOLVED", [entry(page, valueIndex, "value")]);
      continue;
    }
    const previous = sectionLines.filter(({ index }) => {
      const distance = center(value) - center(page.lines[index]);
      return distance > 0 && distance <= 300;
    });
    const section = previous.at(-1);
    if (!section) {
      abstain(valueIndex, "SECTION_UNRESOLVED", [entry(page, valueIndex, "value")]);
      continue;
    }
    const matches: Array<{ index: number; basis: string }> = [];
    for (const [index, line] of page.lines.entries()) {
      if (index === section.index || index === valueIndex
        || center(line) <= center(page.lines[section.index])
        || line.bboxPx[2] >= value.bboxPx[0]
        || Math.abs(center(line) - center(value)) > 24) continue;
      if (section.component === "HEATING"
        && /^\s*Расчетный\s+расход\s+тепла\s+на\s+отопление(?=$|[^\p{L}\p{N}_])/iu.test(line.text)) {
        matches.push({ index, basis: "DESIGN_HEAT_RATE" });
      } else if (section.component === "VENTILATION"
        && /^\s*Расчетный\s+расход\s+тепла\s*$/iu.test(line.text)) {
        matches.push({ index, basis: "DESIGN_HEAT_RATE" });
      } else if (section.component === "DHW"
        && /^\s*Максимальный\s+расчетный\s+расход\s+тепла\s+с\s+учетом\s*$/iu.test(line.text)) {
        matches.push({ index, basis: "MAX_INCLUDING_CIRCULATION" });
      } else if (section.component === "DHW"
        && /^\s*Средний\s+расчетный\s+расход\s+тепла\s*$/iu.test(line.text)) {
        matches.push({ index, basis: "MEAN" });
      }
    }
    if (matches.length !== 1) {
      abstain(valueIndex, "ROW_LABEL_UNRESOLVED", [entry(page, valueIndex, "value")]);
      continue;
    }
    const label = matches[0];
    const evidence = [entry(page, section.index, "section"), entry(page, label.index, "rowLabel")];
    if (label.basis === "MAX_INCLUDING_CIRCULATION") {
      const candidates = page.lines.flatMap((line, index) => {
        const labelLine = page.lines[label.index];
        return /^\s*циркуляции\s*$/iu.test(line.text)
          && Math.abs(line.bboxPx[0] - labelLine.bboxPx[0]) <= 25
          && center(line) - center(labelLine) >= 0
          && center(line) - center(labelLine) <= 35
          && line.bboxPx[2] < value.bboxPx[0] ? [index] : [];
      });
      if (candidates.length !== 1) {
        abstain(valueIndex, "BASIS_AMBIGUOUS", [...evidence, entry(page, valueIndex, "value")]);
        continue;
      }
      evidence.push(entry(page, candidates[0], "basisContinuation"));
    }
    evidence.push(entry(page, valueIndex, "value"));
    if (evidence.some((part) => part.score < 0.75)) {
      abstain(valueIndex, "OCR_SCORE_TOO_LOW", evidence);
      continue;
    }
    const parsed = parsedPair(value.text);
    if (!parsed) {
      abstain(valueIndex, "OCR_UNIT_UNREADABLE", evidence);
      continue;
    }
    if (!parsed.validConversion) {
      abstain(valueIndex, "PAIRED_UNITS_CONTRADICT", evidence);
      continue;
    }
    proposals.push({ sourceFileId: page.sourceFileId, inputSha256: page.inputSha256,
      pageNumber: page.pageNumber, stage: "RD", component: section.component, basis: label.basis,
      values: parsed.values, ocrPageContentHash: page.contentHash,
      renderSha256: page.render.sha256, evidence });
  }
}

/** Re-derive every proposal and abstention from a trusted persisted OCR v3 stage. */
export function validateOcrHeatRowProposals(result: unknown, persistedStage: unknown,
  sourceReviews: unknown, sourceFiles: unknown, expectedManifestHash: string): boolean {
  if (!hash(expectedManifestHash) || !record(result) || !record(sourceReviews)
    || !Array.isArray(sourceFiles)
    || !keys(result, ["schemaVersion", "profileId", "inputManifestHash", "proposals",
      "abstentions", "findingCount"])
    || result.schemaVersion !== "ocr-heat-row-proposals-v1"
    || result.profileId !== "conservative-ocr-heat-rows-v1"
    || result.inputManifestHash !== expectedManifestHash || result.findingCount !== 0
    || !Array.isArray(result.proposals) || !Array.isArray(result.abstentions)
    || result.proposals.length > 256 || result.abstentions.length > 10_000) return false;
  const content = stageContent(persistedStage, expectedManifestHash);
  if (!content) return false;
  const analysis = content.analysis as Json;
  const manifestSources = new Map<string, { sha256: string; stages: string[] }>();
  for (const raw of sourceFiles) {
    if (!record(raw) || typeof raw.sourceFileId !== "string" || !raw.sourceFileId
      || manifestSources.has(raw.sourceFileId) || !hash(raw.sha256)
      || !Array.isArray(raw.stages) || raw.stages.length === 0
      || raw.stages.some((stage) => !["PD", "RD", "ID"].includes(stage))
      || new Set(raw.stages).size !== raw.stages.length) return false;
    manifestSources.set(raw.sourceFileId, { sha256: raw.sha256, stages: raw.stages });
  }
  if (Object.keys(sourceReviews).some((id) => !manifestSources.has(id))) return false;
  const proposals: Json[] = [];
  const abstentions: Json[] = [];
  const sourceIds = new Set<string>();
  let processed = 0;
  for (const rawSource of analysis.sources as unknown[]) {
    if (!record(rawSource) || typeof rawSource.sourceFileId !== "string"
      || !rawSource.sourceFileId || sourceIds.has(rawSource.sourceFileId)
      || !hash(rawSource.sourceSha256) || !Array.isArray(rawSource.pages)
      || !count(rawSource.processedPageCount)
      || rawSource.pages.length !== rawSource.processedPageCount) return false;
    sourceIds.add(rawSource.sourceFileId);
    const manifestSource = manifestSources.get(rawSource.sourceFileId);
    if (!manifestSource || manifestSource.sha256 !== rawSource.sourceSha256) return false;
    processed += rawSource.pages.length;
    const review = (sourceReviews as Json)[rawSource.sourceFileId];
    if (review !== undefined && (!record(review) || review.sourceSha256 !== rawSource.sourceSha256
      || !record(review.pageStages))) return false;
    const pageStages = record(review) ? review.pageStages as Json : {};
    if (Object.values(pageStages).some((mapped) =>
      mapped !== "UNRESOLVED" && !manifestSource.stages.includes(String(mapped)))) return false;
    const pageNumbers = new Set<number>();
    for (const rawPage of rawSource.pages) {
      const page = verifiedPage(rawPage, rawSource.sourceFileId, rawSource.sourceSha256);
      if (!page || pageNumbers.has(page.pageNumber)) return false;
      pageNumbers.add(page.pageNumber);
      const reviewStage = pageStages[String(page.pageNumber)]
        ?? (manifestSource.stages.length === 1 ? manifestSource.stages[0] : undefined);
      if (reviewStage !== undefined && !["PD", "RD", "ID", "UNRESOLVED"].includes(String(reviewStage))) {
        return false;
      }
      derivePage(page, reviewStage, proposals, abstentions);
    }
  }
  if (processed !== analysis.processedPageCount) return false;
  const counts = new Map<string, number>();
  for (const proposal of proposals) {
    const key = `${proposal.sourceFileId}|${proposal.component}|${proposal.basis}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const unique: Json[] = [];
  for (const proposal of proposals) {
    const key = `${proposal.sourceFileId}|${proposal.component}|${proposal.basis}`;
    if (counts.get(key)! > 1) {
      const evidence = proposal.evidence as Evidence[];
      abstentions.push({ sourceFileId: proposal.sourceFileId, inputSha256: proposal.inputSha256,
        pageNumber: proposal.pageNumber, lineIndex: evidence.at(-1)!.lineIndex,
        reasonCode: "DUPLICATE_COMPONENT_BASIS", evidence });
    } else unique.push(proposal);
  }
  return canonicalJson(result.proposals) === canonicalJson(unique)
    && canonicalJson(result.abstentions) === canonicalJson(abstentions);
}
