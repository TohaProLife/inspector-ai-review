import { canonicalJson, sha256 } from "./canonical-json.js";
import { normalizeFact } from "./fact-family-proposals.js";
import type { matrixRegistry, MatrixVerificationSource } from "./matrix-execution.js";
import { boundedOcrConfigHashV2, boundedOcrProfileIdV2, boundedOcrProfileV2 } from "./ocr-layout.js";

export interface MatrixOcrCandidate {
  id: string; sourceFileId: string; sourceSha256: string; stage: "PD" | "RD" | "ID" | "UNRESOLVED";
  pageNumber: number; lineIndex: number; blockId: string; renderSha256: string; ocrPageContentHash: string;
  bbox: { x: number; y: number; width: number; height: number };
  coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED";
  rawText: string; rawValue: string; rawUnit: string; attribute: string; value: string; unit: string;
  parameterCodes: string[]; entityKey: null; method: "OCR"; status: "CANDIDATE";
  extractorVersion: "matrix-ocr-literal-candidates-v1"; sourceFlags: string[];
}
type Json = Record<string, unknown>;
type Registry = typeof matrixRegistry;
type Rule = Registry["entries"][number]["atomicRules"][number];
const record = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 128
  && v.every(s => typeof s === "string" && s.length > 0 && s.length <= 256);
const exact = (v: Json, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const literal = (s: string) => escape(s).replace(/\s+/gu, "\\s+");
const number = "(?:[0-9]+|[0-9]{1,3}(?:[ \\u00a0\\u202f][0-9]{3})+)(?:[.,][0-9]+)?";

function decimal(value: { numerator: bigint; denominator: bigint }): string | null {
  if (value.denominator <= 0n || value.numerator < 0n) return null;
  const whole = value.numerator / value.denominator;
  let remainder = value.numerator % value.denominator; let fraction = "";
  while (remainder !== 0n && fraction.length < 128) {
    remainder *= 10n; fraction += (remainder / value.denominator).toString(); remainder %= value.denominator;
  }
  return remainder === 0n ? `${whole}${fraction ? `.${fraction}` : ""}` : null;
}

function matchLiteral(rawText: string, rule: Rule): { rawValue: string; rawUnit: string; value: string } | null {
  if (!strings(rule.labels) || !strings(rule.unitAliases) || !strings(rule.allowedValues)
    || !["DECIMAL", "INTEGER", "CATEGORY", "CONCRETE_CLASS"].includes(String(rule.valueKind))
    || /[\r\n]/u.test(rawText)) return null;
  const matches = new Map<string, { rawValue: string; rawUnit: string; value: string }>();
  for (const label of rule.labels) {
    const prefix = new RegExp(`^\\s*${literal(label)}\\s*(?:[:,;=|—–-]\\s*|\\s+)`, "iu").exec(rawText);
    if (!prefix) continue;
    const tail = rawText.slice(prefix[0].length);
    if (rule.valueKind === "CATEGORY" || rule.valueKind === "CONCRETE_CLASS") {
      const allowed = rule.valueKind === "CATEGORY" ? rule.allowedValues.map(escape).sort((a, b) => b.length - a.length).join("|") : `[BВ]${number}`;
      if (!allowed) continue;
      const found = new RegExp(`^(${allowed})\\s*[.;]?\\s*$`, "u").exec(tail);
      if (!found) continue;
      if (rule.valueKind === "CONCRETE_CLASS" && !normalizeFact({ rawValue: found[1], rawUnit: found[1][0], attribute: rule.attribute }, "B_CLASS")) continue;
      matches.set(found[1], { rawValue: found[1], rawUnit: rule.canonicalUnit, value: found[1] });
      continue;
    }
    const aliases = [...new Set([...rule.unitAliases, rule.canonicalUnit])].sort((a, b) => b.length - a.length)
      .map(unit => literal(unit).replace(/[²³]/gu, digit => `\\s*${digit}`)).join("|");
    if (!aliases) continue;
    const patterns = [new RegExp(`^(${number})\\s*(?:\\|\\s*)?(${aliases})\\s*[.;]?\\s*$`, "u"),
      new RegExp(`^(${aliases})\\s*(?:\\|\\s*|[:,;]\\s*|\\s+)(${number})\\s*[.;]?\\s*$`, "u")];
    for (const [i, pattern] of patterns.entries()) {
      const found = pattern.exec(tail); if (!found) continue;
      const rawValue = found[i ? 2 : 1]; const rawUnit = found[i ? 1 : 2];
      const normalized = normalizeFact({ rawValue: rawValue.replace(/\u202f/gu, " "),
        rawUnit: rawUnit.replace(/\s+([²³])/gu, "$1"), attribute: rule.attribute }, rule.canonicalUnit);
      if (!normalized || rule.valueKind === "INTEGER" && normalized.numerator % normalized.denominator !== 0n) continue;
      const value = decimal(normalized); if (value === null) continue;
      matches.set(canonicalJson({ rawValue, rawUnit, value }), { rawValue, rawUnit, value });
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

/** Only call on a canonical artifact independently revalidated against its release and DB manifest.
 * Rechecks source/page/render bindings here; OCR transcription never becomes a qualified observation. */
export function extractMatrixOcrCandidates(ocrStage: Record<string, unknown>,
  sources: MatrixVerificationSource[], registry: Registry): MatrixOcrCandidate[] {
  if (!record(ocrStage) || !exact(ocrStage, ["schemaVersion", "jobType", "inputManifestHash", "disposition", "reasonCode",
    "providerKind", "providerProfileId", "providerConfigHash", "outputCount", "analysis"])
    || ocrStage.schemaVersion !== "analysis-stage-result-v2" || ocrStage.jobType !== "DOCUMENT_OCR_LAYOUT"
    || ocrStage.disposition !== "OCR_LAYOUT_BOUNDED" || ocrStage.reasonCode !== "BOUNDED_OCR_ONLY"
    || ocrStage.providerKind !== "OCR_LAYOUT" || ocrStage.providerProfileId !== boundedOcrProfileIdV2
    || ocrStage.providerConfigHash !== boundedOcrConfigHashV2 || !hash(ocrStage.inputManifestHash)
    || !record(ocrStage.analysis) || !Array.isArray(sources) || sources.length > 10_000
    || !registry || registry.schemaVersion !== "matrix-execution-registry-v1" || !Array.isArray(registry.entries)
    || registry.entries.some(entry => !entry || !Array.isArray(entry.atomicRules) || typeof entry.parameterCode !== "string")) return [];
  const analysis = ocrStage.analysis;
  if (analysis.schemaVersion !== "bounded-ocr-layout-analysis-v2" || analysis.inputManifestHash !== ocrStage.inputManifestHash
    || typeof analysis.objectId !== "string" || !analysis.objectId || !record(analysis.profile)
    || canonicalJson(analysis.profile) !== canonicalJson(boundedOcrProfileV2)
    || !Array.isArray(analysis.sources) || analysis.sources.length !== sources.length || analysis.sourceCount !== sources.length) return [];
  const sourceMap = new Map<string, MatrixVerificationSource>();
  for (const source of sources) {
    if (!source || typeof source.sourceFileId !== "string" || !source.sourceFileId || sourceMap.has(source.sourceFileId)
      || !hash(source.sha256) || !Array.isArray(source.stages) || !source.stages.length
      || new Set(source.stages).size !== source.stages.length || source.stages.some(stage => !["PD", "RD", "ID"].includes(stage))) return [];
    sourceMap.set(source.sourceFileId, source);
  }
  const candidates = new Map<string, MatrixOcrCandidate>();
  const seenSources = new Set<string>(); let processed = 0;
  for (const actual of analysis.sources) {
    if (!record(actual) || typeof actual.sourceFileId !== "string" || seenSources.has(actual.sourceFileId)) return [];
    seenSources.add(actual.sourceFileId);
    const source = sourceMap.get(actual.sourceFileId);
    if (!source || actual.sourceSha256 !== source.sha256 || !Array.isArray(actual.pages)
      || actual.pages.length > boundedOcrProfileV2.maxPagesPerRun || actual.processedPageCount !== actual.pages.length) return [];
    if (actual.pages.length && (actual.mediaType !== "application/pdf" || !["SCANNED", "PARTIALLY_SCANNED"].includes(String(actual.status)))) return [];
    const seenPages = new Set<number>();
    for (const page of actual.pages) {
      processed += 1;
      const artifact = source.textArtifact;
      if (!record(page) || !exact(page, ["schemaVersion", "sourceFileId", "inputSha256", "pageNumber", "render", "provider", "lines", "contentHash"])
        || page.schemaVersion !== "document-ocr-page-v1" || page.sourceFileId !== source.sourceFileId || page.inputSha256 !== source.sha256
        || !positiveInt(page.pageNumber) || page.pageNumber > 10_000 || seenPages.has(page.pageNumber)
        || !hash(page.contentHash) || !record(page.render) || !record(page.provider) || !Array.isArray(page.lines) || page.lines.length > 5000
        || !record(artifact) || artifact.sourceFileId !== source.sourceFileId || artifact.inputSha256 !== source.sha256
        || !Array.isArray(artifact.pages) || !positiveInt(artifact.pageCount) || actual.pageCount !== artifact.pageCount
        || page.pageNumber > artifact.pageCount) return [];
      seenPages.add(page.pageNumber);
      const { contentHash: _hash, ...content } = page;
      if (page.contentHash !== sha256(canonicalJson(content))) return [];
      const sourcePages = artifact.pages.filter(p => record(p) && p.pageNumber === page.pageNumber);
      const original = sourcePages[0]; const render = page.render;
      if (sourcePages.length !== 1 || !record(original) || !positiveInt(original.widthMilliPoints) || !positiveInt(original.heightMilliPoints)
        || !record(original.quality) || original.quality.disposition !== "OCR_REQUIRED"
        || !hash(render.sha256) || !positiveInt(render.widthPx) || !positiveInt(render.heightPx)
        || render.widthPx > boundedOcrProfileV2.maxRenderSidePx || render.heightPx > boundedOcrProfileV2.maxRenderSidePx
        || render.widthPx * render.heightPx > boundedOcrProfileV2.maxRenderPixels || render.dpi !== boundedOcrProfileV2.dpi
        || render.rendererProfileId !== boundedOcrProfileV2.rendererProfileId
        || !(boundedOcrProfileV2.ocrProviderProfileIds as readonly unknown[]).includes(page.provider.profileId)
        || page.provider.script !== boundedOcrProfileV2.script) return [];
      const expectedWidth = Math.ceil(original.widthMilliPoints * boundedOcrProfileV2.dpi / 72_000);
      const expectedHeight = Math.ceil(original.heightMilliPoints * boundedOcrProfileV2.dpi / 72_000);
      const close = (w: number, h: number) => Math.abs(render.widthPx as number - w) <= boundedOcrProfileV2.geometryTolerancePx
        && Math.abs(render.heightPx as number - h) <= boundedOcrProfileV2.geometryTolerancePx;
      if (!close(expectedWidth, expectedHeight) && !close(expectedHeight, expectedWidth)) return [];
      let stage: MatrixOcrCandidate["stage"] = "UNRESOLVED";
      if (source.stages.length === 1) stage = source.stages[0] as MatrixOcrCandidate["stage"];
      else {
        const declared = source.review?.pageStages?.[String(page.pageNumber)];
        if (declared !== undefined && declared !== "UNRESOLVED" && !source.stages.includes(declared)) return [];
        if (declared && source.stages.includes(declared)) stage = declared as MatrixOcrCandidate["stage"];
      }
      for (const [lineIndex, line] of page.lines.entries()) {
        if (!record(line) || !exact(line, ["text", "score", "bboxPx"]) || typeof line.text !== "string" || line.text.length > 4096
          || typeof line.score !== "number" || !Number.isFinite(line.score) || line.score < 0 || line.score > 1
          || !Array.isArray(line.bboxPx) || line.bboxPx.length !== 4 || !line.bboxPx.every(n => typeof n === "number" && Number.isFinite(n))) return [];
        const [left, top, right, bottom] = line.bboxPx as number[];
        if (!(0 <= left && left < right && right <= render.widthPx && 0 <= top && top < bottom && bottom <= render.heightPx)) return [];
        for (const entry of registry.entries) for (const rule of entry.atomicRules) {
          if (!rule.enabled) continue;
          const match = matchLiteral(line.text, rule); if (!match) continue;
          const fields = { sourceFileId: source.sourceFileId, sourceSha256: source.sha256, pageNumber: page.pageNumber,
            lineIndex, renderSha256: render.sha256, ocrPageContentHash: page.contentHash,
            attribute: rule.attribute, value: match.value, unit: rule.canonicalUnit, rawText: line.text };
          const id = sha256(canonicalJson({ method: "OCR", ...fields }));
          const existing = candidates.get(id);
          if (existing) { if (!existing.parameterCodes.includes(entry.parameterCode)) existing.parameterCodes.push(entry.parameterCode); continue; }
          const sourceFlags = ["OCR_TRANSCRIPTION_UNVERIFIED"];
          if (source.review?.revisionStatus !== "CURRENT") sourceFlags.push(`SOURCE_REVISION_${source.review?.revisionStatus ?? "UNKNOWN"}`);
          if (source.review?.approvalStatus !== "APPROVED") sourceFlags.push(`SOURCE_APPROVAL_${source.review?.approvalStatus ?? "UNKNOWN"}`);
          if (stage === "UNRESOLVED") sourceFlags.push("SOURCE_STAGE_UNRESOLVED");
          candidates.set(id, { ...fields, ...match, id, stage, blockId: `ocr:${lineIndex}`,
            bbox: { x: left / render.widthPx, y: top / render.heightPx, width: (right - left) / render.widthPx, height: (bottom - top) / render.heightPx },
            coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED", parameterCodes: [entry.parameterCode], entityKey: null,
            method: "OCR", status: "CANDIDATE", extractorVersion: "matrix-ocr-literal-candidates-v1", sourceFlags });
        }
      }
    }
  }
  return processed <= boundedOcrProfileV2.maxPagesPerRun && processed === analysis.processedPageCount && processed === ocrStage.outputCount
    ? [...candidates.values()].map(candidate => ({ ...candidate, parameterCodes: candidate.parameterCodes.sort() })) : [];
}
