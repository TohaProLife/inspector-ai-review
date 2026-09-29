import { randomUUID } from "node:crypto";
import { canonicalJson, sha256 } from "./canonical-json.js";

export const boundedOcrProfile = {
  schemaVersion: "bounded-ocr-layout-profile-v1",
  methodId: "first-ocr-required-pages-v1",
  maxPagesPerRun: 2,
  maxSourceBytes: 64 * 1024 * 1024,
  dpi: 120,
  script: "eslav",
} as const;
export const boundedOcrProfileId = "local-bounded-ocr-layout-v1";
export const boundedOcrConfigHash = sha256(canonicalJson(boundedOcrProfile));
export const boundedOcrProfileV2 = {
  schemaVersion: "bounded-ocr-layout-profile-v2",
  methodId: "source-balanced-drawing-context-v2",
  maxPagesPerRun: 2,
  maxSourceBytes: 64 * 1024 * 1024,
  dpi: 120,
  script: "eslav",
  drawingLongEdgeMilliPoints: 1_000_000,
  maxRenderPixels: 25_000_000,
  maxRenderSidePx: 20_000,
  geometryTolerancePx: 2,
  allowSwappedGeometry: true,
  rendererProfileId: "renderer-pdfium-5.12.1-linux-x86_64-v1",
  ocrProviderProfileIds: [
    "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1",
    "ocr-paddle-3.7.0-ru-en-mobile-v1",
    "ocr-paddle-3.7.0-ru-en-server-v1",
  ],
  anchorTerms: ["общая площадь здания", "тепловая нагрузка", "отоплен", "вентиляц", "таблиц"],
} as const;
export const boundedOcrProfileIdV2 = "local-bounded-ocr-layout-v2";
export const boundedOcrConfigHashV2 = sha256(canonicalJson(boundedOcrProfileV2));
export const boundedOcrProfileV3 = {
  schemaVersion: "bounded-ocr-layout-profile-v3",
  methodId: "rd-ov-heating-revision-window-v3",
  maxPagesPerRun: 2,
  maxSourceBytes: 64 * 1024 * 1024,
  dpi: 120,
  script: "eslav",
  maxRenderPixels: 25_000_000,
  maxRenderSidePx: 20_000,
  geometryTolerancePx: 2,
  allowSwappedGeometry: true,
  rendererProfileId: "renderer-pdfium-5.12.1-linux-x86_64-v1",
  ocrProviderProfileIds: [
    "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1",
    "ocr-paddle-3.7.0-ru-en-mobile-v1",
    "ocr-paddle-3.7.0-ru-en-server-v1",
  ],
  revisionMarkerTerms: ["разрешение", "обозначение", "-рд-ов"],
  heatingSummaryTerms: [
    "основные показатели по рабочим чертежам марки ов", "на отопление", "тепловой поток",
  ],
  maxContextGapPages: 8,
} as const;
export const boundedOcrProfileIdV3 = "local-bounded-ocr-layout-v3";
export const boundedOcrConfigHashV3 = sha256(canonicalJson(boundedOcrProfileV3));
export const boundedOcrProfileV4 = {
  ...boundedOcrProfileV3,
  schemaVersion: "bounded-ocr-layout-profile-v4",
  methodId: "subject-window-or-cid-title-recovery-v4",
  titleRecoveryMaxPage: 2,
  titleRecoveryReasonCode: "TEXT_DECODING_ANOMALY",
} as const;
export const boundedOcrProfileIdV4 = "local-bounded-ocr-layout-v4";
export const boundedOcrConfigHashV4 = sha256(canonicalJson(boundedOcrProfileV4));
export const boundedOcrProfileV5 = {
  ...boundedOcrProfileV4,
  schemaVersion: "bounded-ocr-layout-profile-v5",
  methodId: "subject-window-or-cid-title-recovery-v5",
  maxPagesPerRun: 4,
} as const;
export const boundedOcrProfileIdV5 = "local-bounded-ocr-layout-v5";
export const boundedOcrConfigHashV5 = sha256(canonicalJson(boundedOcrProfileV5));
export const boundedOcrProfileV6 = {
  ...boundedOcrProfileV5,
  schemaVersion: "bounded-ocr-layout-profile-v6",
  methodId: "reviewed-ar-vk-ocr-required-v6",
  sectionCodesAllowed: ["AR", "VK"],
  requiredRevisionStatus: "CURRENT",
  requiredApprovalStatus: "APPROVED",
} as const;
export const boundedOcrProfileIdV6 = "local-bounded-ocr-layout-v6";
export const boundedOcrConfigHashV6 = sha256(canonicalJson(boundedOcrProfileV6));

export interface OcrExpectedSource {
  apiId: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  textArtifact: Record<string, unknown> | null;
}

/** Loaded from this run's immutable source-review and text-artifact snapshots. */
export interface OcrV6ExpectedSource extends OcrExpectedSource {
  textArtifactSha256: string | null;
  stages: string[];
  sectionCode: string | null;
  sourceDecision: {
    sourceSha256: string;
    revisionStatus: string;
    approvalStatus: string;
    sectionCode: string | null;
    pageStages: Record<string, string>;
    basis: { reference: string };
  } | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...fields].sort());
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function positiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function requiredPages(source: OcrExpectedSource): number[] | null {
  if (source.mediaType !== "application/pdf") return [];
  const text = source.textArtifact;
  if (!record(text) || text.schemaVersion !== "document-text-v2"
    || text.sourceFileId !== source.apiId || text.inputSha256 !== source.sha256
    || !Array.isArray(text.pages) || !positiveInt(text.pageCount)
    || text.pages.length !== text.pageCount) return null;
  const required: number[] = [];
  for (let index = 0; index < text.pages.length; index += 1) {
    const page = text.pages[index];
    if (!record(page) || page.pageNumber !== index + 1 || !record(page.quality)
      || !["OCR_REQUIRED", "TEXT_LAYER_CANDIDATE"].includes(String(page.quality.disposition))) return null;
    if (page.quality.disposition === "OCR_REQUIRED") required.push(index + 1);
  }
  return required;
}

function v2CandidatePages(source: OcrExpectedSource): { ranked: number[]; rasterSkipped: number } | null {
  if (source.mediaType !== "application/pdf") return { ranked: [], rasterSkipped: 0 };
  if (requiredPages(source) === null) return null;
  const pages = (source.textArtifact as Record<string, unknown>).pages as Record<string, unknown>[];
  const anchors: number[] = [];
  for (const page of pages) {
    if (!positiveInt(page.widthMilliPoints) || !positiveInt(page.heightMilliPoints)
      || !Array.isArray(page.blocks)) return null;
    if ((page.quality as Record<string, unknown>).disposition !== "TEXT_LAYER_CANDIDATE") continue;
    if (!page.blocks.every((block: unknown) => record(block) && typeof block.text === "string")) return null;
    const content = page.blocks.map((block: Record<string, unknown>) => block.text as string)
      .join(" ").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
    if (boundedOcrProfileV2.anchorTerms.some((term) => content.includes(term))) {
      anchors.push(page.pageNumber as number);
    }
  }
  let rasterSkipped = 0;
  const candidates: Array<{ number: number; drawing: boolean; distance: number }> = [];
  for (const page of pages) {
    if ((page.quality as Record<string, unknown>).disposition !== "OCR_REQUIRED") continue;
    const width = Math.ceil((page.widthMilliPoints as number) * boundedOcrProfileV2.dpi / 72_000);
    const height = Math.ceil((page.heightMilliPoints as number) * boundedOcrProfileV2.dpi / 72_000);
    if (width * height > boundedOcrProfileV2.maxRenderPixels
      || width > boundedOcrProfileV2.maxRenderSidePx
      || height > boundedOcrProfileV2.maxRenderSidePx) {
      rasterSkipped += 1;
      continue;
    }
    const number = page.pageNumber as number;
    let lower = 0;
    let upper = anchors.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (anchors[middle] < number) lower = middle + 1;
      else upper = middle;
    }
    const distance = Math.min(
      lower < anchors.length ? Math.abs(number - anchors[lower]) : Number.MAX_SAFE_INTEGER,
      lower > 0 ? Math.abs(number - anchors[lower - 1]) : Number.MAX_SAFE_INTEGER,
    );
    candidates.push({ number,
      drawing: Math.max(page.widthMilliPoints as number, page.heightMilliPoints as number)
        >= boundedOcrProfileV2.drawingLongEdgeMilliPoints,
      distance });
  }
  candidates.sort((left, right) => Number(right.drawing) - Number(left.drawing)
    || left.distance - right.distance || left.number - right.number);
  return { ranked: candidates.map((candidate) => candidate.number), rasterSkipped };
}

export function selectBoundedOcrV2Pages(expectedSources: OcrExpectedSource[]):
  Map<string, { selected: number[]; rasterSkipped: number }> | undefined {
  const candidates = new Map<string, { ranked: number[]; rasterSkipped: number }>();
  const sorted = [...expectedSources].sort((left, right) => left.apiId < right.apiId ? -1 : left.apiId > right.apiId ? 1 : 0);
  for (const source of sorted) {
    if (candidates.has(source.apiId)) return undefined;
    const value = v2CandidatePages(source);
    if (!value) return undefined;
    candidates.set(source.apiId, source.byteSize > boundedOcrProfileV2.maxSourceBytes
      ? { ranked: [], rasterSkipped: 0 } : value);
  }
  const selection = new Map(sorted.map((source) => [source.apiId, {
    selected: [] as number[], rasterSkipped: candidates.get(source.apiId)!.rasterSkipped,
  }]));
  for (let round = 0; round < boundedOcrProfileV2.maxPagesPerRun; round += 1) {
    for (const source of sorted) {
      const page = candidates.get(source.apiId)!.ranked[round];
      if (page !== undefined) selection.get(source.apiId)!.selected.push(page);
      if ([...selection.values()].reduce((count, item) => count + item.selected.length, 0)
        === boundedOcrProfileV2.maxPagesPerRun) return selection;
    }
  }
  return selection;
}

function v3CandidatePages(source: OcrExpectedSource):
  { ranked: number[]; rasterSkipped: number; subjectCandidateCount: number } | null {
  if (source.mediaType !== "application/pdf") return {
    ranked: [], rasterSkipped: 0, subjectCandidateCount: 0,
  };
  if (requiredPages(source) === null) return null;
  const pages = (source.textArtifact as Record<string, unknown>).pages as Record<string, unknown>[];
  const markerPages: number[] = [];
  const summaryPages: number[] = [];
  for (const page of pages) {
    if (!positiveInt(page.widthMilliPoints) || !positiveInt(page.heightMilliPoints)
      || !Array.isArray(page.blocks)) return null;
    if ((page.quality as Record<string, unknown>).disposition !== "TEXT_LAYER_CANDIDATE") continue;
    if (!page.blocks.every((block: unknown) => record(block) && typeof block.text === "string")) return null;
    const content = page.blocks.map((block: Record<string, unknown>) => block.text as string)
      .join(" ").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
    if (boundedOcrProfileV3.revisionMarkerTerms.every((term) => content.includes(term))) {
      markerPages.push(page.pageNumber as number);
    }
    if (boundedOcrProfileV3.heatingSummaryTerms.every((term) => content.includes(term))) {
      summaryPages.push(page.pageNumber as number);
    }
  }
  const qualified = new Set<number>();
  for (const marker of markerPages) {
    const summary = summaryPages.find((number) => number > marker
      && number - marker <= boundedOcrProfileV3.maxContextGapPages);
    if (summary === undefined) continue;
    for (let number = marker + 1; number < summary; number += 1) {
      if ((pages[number - 1].quality as Record<string, unknown>).disposition === "OCR_REQUIRED") {
        qualified.add(number);
      }
    }
  }
  let rasterSkipped = 0;
  const ranked: number[] = [];
  for (const number of [...qualified].sort((left, right) => left - right)) {
    const page = pages[number - 1];
    const width = Math.ceil((page.widthMilliPoints as number) * boundedOcrProfileV3.dpi / 72_000);
    const height = Math.ceil((page.heightMilliPoints as number) * boundedOcrProfileV3.dpi / 72_000);
    if (width * height > boundedOcrProfileV3.maxRenderPixels
      || width > boundedOcrProfileV3.maxRenderSidePx
      || height > boundedOcrProfileV3.maxRenderSidePx) rasterSkipped += 1;
    else ranked.push(number);
  }
  return { ranked, rasterSkipped, subjectCandidateCount: qualified.size };
}

export function selectBoundedOcrV3Pages(expectedSources: OcrExpectedSource[]):
  Map<string, { selected: number[]; rasterSkipped: number; subjectCandidateCount: number }> | undefined {
  const sorted = [...expectedSources].sort((left, right) => left.apiId < right.apiId ? -1 : left.apiId > right.apiId ? 1 : 0);
  const candidates = new Map<string, { ranked: number[]; rasterSkipped: number; subjectCandidateCount: number }>();
  for (const source of sorted) {
    if (candidates.has(source.apiId)) return undefined;
    const value = v3CandidatePages(source);
    if (!value) return undefined;
    candidates.set(source.apiId, source.byteSize > boundedOcrProfileV3.maxSourceBytes
      ? { ranked: [], rasterSkipped: 0, subjectCandidateCount: value.subjectCandidateCount } : value);
  }
  const selection = new Map(sorted.map((source) => [source.apiId, {
    selected: [] as number[], rasterSkipped: candidates.get(source.apiId)!.rasterSkipped,
    subjectCandidateCount: candidates.get(source.apiId)!.subjectCandidateCount,
  }]));
  let processed = 0;
  for (let round = 0; round < boundedOcrProfileV3.maxPagesPerRun; round += 1) {
    for (const source of sorted) {
      const page = candidates.get(source.apiId)!.ranked[round];
      if (page !== undefined) {
        selection.get(source.apiId)!.selected.push(page);
        processed += 1;
      }
      if (processed === boundedOcrProfileV3.maxPagesPerRun) return selection;
    }
  }
  return selection;
}

function v4CandidatePages(source: OcrExpectedSource):
  { ranked: number[]; rasterSkipped: number; subjectCandidateCount: number;
    titleRecoveryCandidateCount: number } | null {
  const subject = v3CandidatePages(source);
  if (!subject) return null;
  if (source.mediaType !== "application/pdf" || subject.subjectCandidateCount > 0) {
    return { ...subject, titleRecoveryCandidateCount: 0 };
  }
  const pages = (source.textArtifact as Record<string, unknown>).pages as Record<string, unknown>[];
  const ranked: number[] = [];
  let rasterSkipped = subject.rasterSkipped;
  let titleRecoveryCandidateCount = 0;
  for (const page of pages.slice(0, boundedOcrProfileV4.titleRecoveryMaxPage)) {
    const quality = page.quality as Record<string, unknown>;
    if (quality.disposition !== "OCR_REQUIRED" || !Array.isArray(quality.reasonCodes)
      || !quality.reasonCodes.includes(boundedOcrProfileV4.titleRecoveryReasonCode)) continue;
    titleRecoveryCandidateCount += 1;
    const width = Math.ceil((page.widthMilliPoints as number) * boundedOcrProfileV4.dpi / 72_000);
    const height = Math.ceil((page.heightMilliPoints as number) * boundedOcrProfileV4.dpi / 72_000);
    if (width * height > boundedOcrProfileV4.maxRenderPixels
      || width > boundedOcrProfileV4.maxRenderSidePx
      || height > boundedOcrProfileV4.maxRenderSidePx) rasterSkipped += 1;
    else ranked.push(page.pageNumber as number);
  }
  return { ranked, rasterSkipped, subjectCandidateCount: 0, titleRecoveryCandidateCount };
}

function selectBoundedOcrV4FamilyPages(expectedSources: OcrExpectedSource[], maxPagesPerRun: 2 | 4):
  Map<string, { selected: number[]; rasterSkipped: number; subjectCandidateCount: number;
    titleRecoveryCandidateCount: number }> | undefined {
  const sorted = [...expectedSources].sort((left, right) => left.apiId < right.apiId ? -1 : left.apiId > right.apiId ? 1 : 0);
  const candidates = new Map<string, NonNullable<ReturnType<typeof v4CandidatePages>>>();
  for (const source of sorted) {
    if (candidates.has(source.apiId)) return undefined;
    const value = v4CandidatePages(source);
    if (!value) return undefined;
    candidates.set(source.apiId, source.byteSize > boundedOcrProfileV4.maxSourceBytes
      ? { ...value, ranked: [], rasterSkipped: 0 } : value);
  }
  const selection = new Map(sorted.map((source) => [source.apiId, {
    selected: [] as number[], rasterSkipped: candidates.get(source.apiId)!.rasterSkipped,
    subjectCandidateCount: candidates.get(source.apiId)!.subjectCandidateCount,
    titleRecoveryCandidateCount: candidates.get(source.apiId)!.titleRecoveryCandidateCount,
  }]));
  let processed = 0;
  for (let round = 0; round < maxPagesPerRun; round += 1) {
    for (const source of sorted) {
      const page = candidates.get(source.apiId)!.ranked[round];
      if (page !== undefined) {
        selection.get(source.apiId)!.selected.push(page);
        processed += 1;
      }
      if (processed === maxPagesPerRun) return selection;
    }
  }
  return selection;
}

export function selectBoundedOcrV4Pages(expectedSources: OcrExpectedSource[]) {
  return selectBoundedOcrV4FamilyPages(expectedSources, boundedOcrProfileV4.maxPagesPerRun);
}

export function selectBoundedOcrV5Pages(expectedSources: OcrExpectedSource[]) {
  return selectBoundedOcrV4FamilyPages(expectedSources, boundedOcrProfileV5.maxPagesPerRun);
}

export interface OcrV6Selection {
  selected: number[];
  rasterSkipped: number;
  reviewEligiblePageCount: number;
  stageUnresolvedPageCount: number;
  selectionReasonCodes: string[];
}

/** Reconstruct v6 page choice from this run's committed text and source-review snapshots. */
export function selectBoundedOcrV6Pages(expectedSources: OcrV6ExpectedSource[]):
  Map<string, OcrV6Selection> | undefined {
  const sources = [...expectedSources].sort((a, b) => a.apiId < b.apiId ? -1 : a.apiId > b.apiId ? 1 : 0);
  const selection = new Map<string, OcrV6Selection>();
  const ranked = new Map<string, number[]>();
  for (const source of sources) {
    if (selection.has(source.apiId) || !source.apiId || !sha(source.sha256)
      || !Number.isSafeInteger(source.byteSize) || source.byteSize < 0
      || !Array.isArray(source.stages) || source.stages.length === 0
      || new Set(source.stages).size !== source.stages.length
      || source.stages.some((stage) => !["PD", "RD", "ID"].includes(stage))) return undefined;
    const decision = source.sourceDecision;
    if (decision !== null && (!record(decision) || decision.sourceSha256 !== source.sha256
      || !["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(decision.revisionStatus)
      || !["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(decision.approvalStatus)
      || !record(decision.pageStages) || !record(decision.basis)
      || typeof decision.basis.reference !== "string" || !decision.basis.reference.trim()
      || !Object.entries(decision.pageStages).every(([page, stage]) =>
        /^[1-9][0-9]*$/u.test(page)
          && (stage === "UNRESOLVED" || source.stages.includes(stage)))
      || source.sectionCode !== decision.sectionCode)) return undefined;
    if (decision === null && source.sectionCode !== null) return undefined;
    const entry: OcrV6Selection = { selected: [], rasterSkipped: 0,
      reviewEligiblePageCount: 0, stageUnresolvedPageCount: 0, selectionReasonCodes: [] };
    selection.set(source.apiId, entry);
    ranked.set(source.apiId, []);
    if (source.mediaType !== "application/pdf") {
      if (source.textArtifact !== null || source.textArtifactSha256 !== null) return undefined;
      continue;
    }
    if (!sha(source.textArtifactSha256) || !record(source.textArtifact)
      || sha256(canonicalJson(source.textArtifact)) !== source.textArtifactSha256) return undefined;
    const required = requiredPages(source);
    if (!required) return undefined;
    if (decision && Object.keys(decision.pageStages).some((page) =>
      Number(page) > Number((source.textArtifact as Record<string, unknown>).pageCount))) return undefined;
    if (required.length === 0) continue;
    if (decision === null) {
      entry.selectionReasonCodes.push("SOURCE_REVIEW_REQUIRED");
      continue;
    }
    if (decision.revisionStatus !== boundedOcrProfileV6.requiredRevisionStatus
      || decision.approvalStatus !== boundedOcrProfileV6.requiredApprovalStatus) {
      entry.selectionReasonCodes.push("SOURCE_REVIEW_NOT_CURRENT_APPROVED");
      continue;
    }
    if (!(boundedOcrProfileV6.sectionCodesAllowed as readonly string[]).includes(decision.sectionCode ?? "")) {
      entry.selectionReasonCodes.push("SECTION_NOT_AR_VK");
      continue;
    }
    const pages = source.textArtifact.pages as Record<string, unknown>[];
    for (const number of required) {
      const stage = decision.pageStages[String(number)]
        ?? (source.stages.length === 1 ? source.stages[0] : undefined);
      if (stage !== "PD" && stage !== "RD") {
        entry.stageUnresolvedPageCount += 1;
        continue;
      }
      if (!source.stages.includes(stage)) return undefined;
      entry.reviewEligiblePageCount += 1;
      const page = pages[number - 1];
      if (!positiveInt(page.widthMilliPoints) || !positiveInt(page.heightMilliPoints)) return undefined;
      const width = Math.ceil(page.widthMilliPoints * boundedOcrProfileV6.dpi / 72_000);
      const height = Math.ceil(page.heightMilliPoints * boundedOcrProfileV6.dpi / 72_000);
      if (width * height > boundedOcrProfileV6.maxRenderPixels
        || width > boundedOcrProfileV6.maxRenderSidePx
        || height > boundedOcrProfileV6.maxRenderSidePx) entry.rasterSkipped += 1;
      else if (source.byteSize <= boundedOcrProfileV6.maxSourceBytes) ranked.get(source.apiId)!.push(number);
    }
    if (entry.stageUnresolvedPageCount) entry.selectionReasonCodes.push("PAGE_STAGE_UNRESOLVED");
    if (entry.reviewEligiblePageCount && source.byteSize > boundedOcrProfileV6.maxSourceBytes) {
      entry.selectionReasonCodes.push("SOURCE_TOO_LARGE");
    }
    if (entry.rasterSkipped) entry.selectionReasonCodes.push("RENDER_PIXEL_LIMIT");
  }
  let processed = 0;
  for (let round = 0; round < boundedOcrProfileV6.maxPagesPerRun; round += 1) {
    for (const source of sources) {
      const page = ranked.get(source.apiId)![round];
      if (page !== undefined) {
        selection.get(source.apiId)!.selected.push(page);
        processed += 1;
        if (processed === boundedOcrProfileV6.maxPagesPerRun) break;
      }
    }
    if (processed === boundedOcrProfileV6.maxPagesPerRun) break;
  }
  for (const source of sources) {
    const entry = selection.get(source.apiId)!;
    if (ranked.get(source.apiId)!.length > entry.selected.length) {
      entry.selectionReasonCodes.push("PAGE_BUDGET_EXHAUSTED");
    }
    entry.selectionReasonCodes.sort();
  }
  return selection;
}

function validOcrPage(value: unknown, source: OcrExpectedSource, pageNumber: number,
  boundedProfile: typeof boundedOcrProfileV2 | typeof boundedOcrProfileV3
    | typeof boundedOcrProfileV4 | typeof boundedOcrProfileV5
    | typeof boundedOcrProfileV6 | null): boolean {
  if (!record(value) || !exact(value, ["schemaVersion", "sourceFileId", "inputSha256", "pageNumber",
    "render", "provider", "lines", "contentHash"])
    || value.schemaVersion !== "document-ocr-page-v1"
    || value.sourceFileId !== source.apiId || value.inputSha256 !== source.sha256
    || value.pageNumber !== pageNumber || !record(value.render) || !record(value.provider)
    || !Array.isArray(value.lines) || value.lines.length > 5000 || !sha(value.contentHash)) return false;
  const render = value.render;
  const provider = value.provider;
  if (!exact(render, ["sha256", "widthPx", "heightPx", "dpi", "rendererProfileId"])
    || !sha(render.sha256) || !positiveInt(render.widthPx) || !positiveInt(render.heightPx)
    || render.widthPx * render.heightPx > 25_000_000 || render.dpi !== boundedOcrProfile.dpi
    || typeof render.rendererProfileId !== "string" || !render.rendererProfileId
    || !exact(provider, ["profileId", "script"])
    || typeof provider.profileId !== "string" || !provider.profileId
    || provider.script !== boundedOcrProfile.script) return false;
  if (boundedProfile) {
    const text = source.textArtifact as Record<string, unknown>;
    const sourcePage = (text.pages as Record<string, unknown>[])[pageNumber - 1];
    const expectedWidth = Math.ceil((sourcePage.widthMilliPoints as number) * boundedProfile.dpi / 72_000);
    const expectedHeight = Math.ceil((sourcePage.heightMilliPoints as number) * boundedProfile.dpi / 72_000);
    const tolerance = boundedProfile.geometryTolerancePx;
    const direct = Math.abs((render.widthPx as number) - expectedWidth) <= tolerance
      && Math.abs((render.heightPx as number) - expectedHeight) <= tolerance;
    const swapped = boundedProfile.allowSwappedGeometry
      && Math.abs((render.widthPx as number) - expectedHeight) <= tolerance
      && Math.abs((render.heightPx as number) - expectedWidth) <= tolerance;
    if (render.widthPx > boundedProfile.maxRenderSidePx
      || render.heightPx > boundedProfile.maxRenderSidePx
      || render.rendererProfileId !== boundedProfile.rendererProfileId
      || !(boundedProfile.ocrProviderProfileIds as readonly string[]).includes(provider.profileId as string)
      || (!direct && !swapped)) return false;
  }
  for (const line of value.lines) {
    if (!record(line) || !exact(line, ["text", "score", "bboxPx"])
      || typeof line.text !== "string" || line.text.length > 4096
      || typeof line.score !== "number" || !Number.isFinite(line.score)
      || line.score < 0 || line.score > 1 || !Array.isArray(line.bboxPx)
      || line.bboxPx.length !== 4 || !line.bboxPx.every((number) =>
        typeof number === "number" && Number.isFinite(number))
      || !(0 <= line.bboxPx[0] && line.bboxPx[0] < line.bboxPx[2]
        && line.bboxPx[2] <= render.widthPx && 0 <= line.bboxPx[1]
        && line.bboxPx[1] < line.bboxPx[3] && line.bboxPx[3] <= render.heightPx)) return false;
  }
  const { contentHash: _hash, ...content } = value;
  return value.contentHash === sha256(canonicalJson(content));
}

function v6Status(source: OcrV6ExpectedSource, requiredCount: number,
  selection: OcrV6Selection): string {
  if (source.mediaType !== "application/pdf") return "SKIPPED_UNSUPPORTED_FORMAT";
  if (source.byteSize > boundedOcrProfileV6.maxSourceBytes) return "SKIPPED_SOURCE_TOO_LARGE";
  if (requiredCount === 0) return "NO_OCR_REQUIRED_PAGES";
  if (selection.selected.length === requiredCount) return "SCANNED";
  if (selection.selectionReasonCodes.includes("SOURCE_REVIEW_REQUIRED")) {
    return "SKIPPED_SOURCE_REVIEW_REQUIRED";
  }
  if (selection.selectionReasonCodes.includes("SOURCE_REVIEW_NOT_CURRENT_APPROVED")) {
    return "SKIPPED_SOURCE_NOT_CURRENT_APPROVED";
  }
  if (selection.selectionReasonCodes.includes("SECTION_NOT_AR_VK")) return "SKIPPED_SECTION_NOT_AR_VK";
  if (!selection.reviewEligiblePageCount && selection.stageUnresolvedPageCount) {
    return "SKIPPED_PAGE_STAGE_UNRESOLVED";
  }
  if (!selection.selected.length && selection.rasterSkipped === selection.reviewEligiblePageCount
    && selection.reviewEligiblePageCount > 0) return "SKIPPED_RENDER_PIXEL_LIMIT";
  return "PARTIALLY_SCANNED";
}

/** Validate v6 independently of legacy v1-v5 releases; caller supplies immutable run snapshots. */
export function validateBoundedOcrV6StageResult(
  result: Record<string, unknown>, manifestHash: string, objectId: string,
  expectedSources: OcrV6ExpectedSource[],
): ReturnType<typeof validateBoundedOcrStageResult> {
  if (!exact(result, ["schemaVersion", "jobType", "inputManifestHash", "disposition", "reasonCode",
    "providerKind", "providerProfileId", "providerConfigHash", "outputCount", "analysis"])
    || result.schemaVersion !== "analysis-stage-result-v2"
    || result.jobType !== "DOCUMENT_OCR_LAYOUT" || result.inputManifestHash !== manifestHash
    || result.disposition !== "OCR_LAYOUT_BOUNDED" || result.reasonCode !== "BOUNDED_OCR_ONLY"
    || result.providerKind !== "OCR_LAYOUT" || result.providerProfileId !== boundedOcrProfileIdV6
    || result.providerConfigHash !== boundedOcrConfigHashV6
    || !record(result.analysis)) return undefined;
  const analysis = result.analysis;
  if (!exact(analysis, ["schemaVersion", "objectId", "inputManifestHash", "profile", "sources",
    "sourceCount", "ocrRequiredPageCount", "processedPageCount", "deferredPageCount",
    "skippedOversizePageCount", "skippedUnsupportedSourceCount", "skippedRenderPixelPageCount",
    "reviewEligiblePageCount", "stageUnresolvedPageCount"])
    || analysis.schemaVersion !== "bounded-ocr-layout-analysis-v6"
    || analysis.objectId !== objectId || analysis.inputManifestHash !== manifestHash
    || canonicalJson(analysis.profile) !== canonicalJson(boundedOcrProfileV6)
    || !Array.isArray(analysis.sources) || analysis.sources.length !== expectedSources.length
    || analysis.sourceCount !== expectedSources.length) return undefined;
  const expected = [...expectedSources].sort((a, b) => a.apiId < b.apiId ? -1 : a.apiId > b.apiId ? 1 : 0);
  const selection = selectBoundedOcrV6Pages(expected);
  if (!selection) return undefined;
  let requiredTotal = 0;
  let processed = 0;
  let oversized = 0;
  let unsupported = 0;
  let rasterSkipped = 0;
  let reviewEligible = 0;
  let stageUnresolved = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const source = expected[index];
    const actual = analysis.sources[index];
    const required = requiredPages(source);
    const chosen = selection.get(source.apiId);
    if (!required || !chosen || !record(actual)
      || !exact(actual, ["sourceFileId", "sourceSha256", "mediaType", "pageCount", "status",
        "ocrRequiredPageCount", "processedPageCount", "deferredPageCount", "pages",
        "skippedRenderPixelPageCount", "reviewEligiblePageCount", "stageUnresolvedPageCount",
        "selectionReasonCodes"])
      || actual.sourceFileId !== source.apiId || actual.sourceSha256 !== source.sha256
      || actual.mediaType !== source.mediaType || !Array.isArray(actual.pages)
      || actual.pageCount !== (source.mediaType === "application/pdf"
        ? (source.textArtifact as Record<string, unknown>).pageCount : null)
      || actual.status !== v6Status(source, required.length, chosen)
      || actual.ocrRequiredPageCount !== required.length
      || actual.processedPageCount !== chosen.selected.length
      || actual.deferredPageCount !== required.length - chosen.selected.length
      || actual.skippedRenderPixelPageCount !== chosen.rasterSkipped
      || actual.reviewEligiblePageCount !== chosen.reviewEligiblePageCount
      || actual.stageUnresolvedPageCount !== chosen.stageUnresolvedPageCount
      || canonicalJson(actual.selectionReasonCodes) !== canonicalJson(chosen.selectionReasonCodes)
      || actual.pages.length !== chosen.selected.length) return undefined;
    for (let pageIndex = 0; pageIndex < chosen.selected.length; pageIndex += 1) {
      if (!validOcrPage(actual.pages[pageIndex], source, chosen.selected[pageIndex],
        boundedOcrProfileV6)) return undefined;
    }
    processed += chosen.selected.length;
    requiredTotal += required.length;
    if (source.mediaType !== "application/pdf") unsupported += 1;
    if (source.mediaType === "application/pdf"
      && source.byteSize > boundedOcrProfileV6.maxSourceBytes) oversized += required.length;
    rasterSkipped += chosen.rasterSkipped;
    reviewEligible += chosen.reviewEligiblePageCount;
    stageUnresolved += chosen.stageUnresolvedPageCount;
  }
  if (result.outputCount !== processed || analysis.processedPageCount !== processed
    || analysis.ocrRequiredPageCount !== requiredTotal
    || analysis.deferredPageCount !== requiredTotal - processed
    || analysis.skippedOversizePageCount !== oversized
    || analysis.skippedUnsupportedSourceCount !== unsupported
    || analysis.skippedRenderPixelPageCount !== rasterSkipped
    || analysis.reviewEligiblePageCount !== reviewEligible
    || analysis.stageUnresolvedPageCount !== stageUnresolved) return undefined;
  const canonical = canonicalJson(result);
  const byteSize = Buffer.byteLength(canonical, "utf8");
  if (byteSize < 1 || byteSize > 8 * 1024 * 1024) return undefined;
  const id = randomUUID();
  const contentHash = sha256(canonical);
  return { id, canonical, contentHash, byteSize, outputCount: processed,
    storedResult: { schemaVersion: result.schemaVersion, artifactId: id,
      disposition: result.disposition, reasonCode: result.reasonCode,
      providerKind: result.providerKind, providerProfileId: result.providerProfileId,
      providerConfigHash: result.providerConfigHash, outputCount: processed,
      contentHash, byteSize } };
}

export function validateBoundedOcrStageResult(
  result: Record<string, unknown>, manifestHash: string, objectId: string,
  expectedSources: OcrExpectedSource[], releaseProfileId: string = boundedOcrProfileId,
): {
  id: string; canonical: string; contentHash: string; byteSize: number;
  outputCount: number; storedResult: Record<string, unknown>;
} | undefined {
  if (!exact(result, ["schemaVersion", "jobType", "inputManifestHash", "disposition", "reasonCode",
    "providerKind", "providerProfileId", "providerConfigHash", "outputCount", "analysis"])
    || result.schemaVersion !== "analysis-stage-result-v2"
    || result.jobType !== "DOCUMENT_OCR_LAYOUT" || result.inputManifestHash !== manifestHash
    || result.disposition !== "OCR_LAYOUT_BOUNDED" || result.reasonCode !== "BOUNDED_OCR_ONLY"
    || result.providerKind !== "OCR_LAYOUT" || result.providerProfileId !== releaseProfileId
    || !record(result.analysis)) return undefined;
  const v2 = releaseProfileId === boundedOcrProfileIdV2;
  const v3 = releaseProfileId === boundedOcrProfileIdV3;
  const v4 = releaseProfileId === boundedOcrProfileIdV4;
  const v5 = releaseProfileId === boundedOcrProfileIdV5;
  if (releaseProfileId !== boundedOcrProfileId && !v2 && !v3 && !v4 && !v5) return undefined;
  const boundedProfile = v5 ? boundedOcrProfileV5 : v4 ? boundedOcrProfileV4 : v3 ? boundedOcrProfileV3
    : v2 ? boundedOcrProfileV2 : null;
  const profile = boundedProfile ?? boundedOcrProfile;
  const configHash = v5 ? boundedOcrConfigHashV5 : v4 ? boundedOcrConfigHashV4 : v3 ? boundedOcrConfigHashV3
    : v2 ? boundedOcrConfigHashV2 : boundedOcrConfigHash;
  if (result.providerConfigHash !== configHash) return undefined;
  const analysis = result.analysis;
  if (!exact(analysis, ["schemaVersion", "objectId", "inputManifestHash", "profile", "sources",
    "sourceCount", "ocrRequiredPageCount", "processedPageCount", "deferredPageCount",
    "skippedOversizePageCount", "skippedUnsupportedSourceCount",
    ...(boundedProfile ? ["skippedRenderPixelPageCount"] : []),
    ...(v3 || v4 || v5 ? ["subjectCandidatePageCount"] : []),
    ...(v4 || v5 ? ["titleRecoveryCandidatePageCount"] : [])])
    || analysis.schemaVersion !== (v5 ? "bounded-ocr-layout-analysis-v5"
      : v4 ? "bounded-ocr-layout-analysis-v4"
      : v3 ? "bounded-ocr-layout-analysis-v3"
      : v2 ? "bounded-ocr-layout-analysis-v2" : "bounded-ocr-layout-analysis-v1")
    || analysis.objectId !== objectId || analysis.inputManifestHash !== manifestHash
    || canonicalJson(analysis.profile) !== canonicalJson(profile)
    || !Array.isArray(analysis.sources) || analysis.sources.length !== expectedSources.length
    || analysis.sourceCount !== expectedSources.length) return undefined;
  const expected = [...expectedSources].sort((left, right) => left.apiId < right.apiId ? -1 : left.apiId > right.apiId ? 1 : 0);
  const v2Selection = v2 ? selectBoundedOcrV2Pages(expected) : undefined;
  const v3Selection = v3 ? selectBoundedOcrV3Pages(expected) : undefined;
  const v4Selection = v4 ? selectBoundedOcrV4Pages(expected) : undefined;
  const v5Selection = v5 ? selectBoundedOcrV5Pages(expected) : undefined;
  if ((v2 && !v2Selection) || (v3 && !v3Selection) || (v4 && !v4Selection)
    || (v5 && !v5Selection)) return undefined;
  let processed = 0;
  let requiredTotal = 0;
  let oversized = 0;
  let unsupported = 0;
  let rasterSkipped = 0;
  let subjectCandidates = 0;
  let titleCandidates = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const source = expected[index];
    const actual = analysis.sources[index];
    const required = requiredPages(source);
    if (required === null || !record(actual) || !exact(actual, ["sourceFileId", "sourceSha256",
      "mediaType", "pageCount", "status", "ocrRequiredPageCount", "processedPageCount",
      "deferredPageCount", "pages", ...(boundedProfile ? ["skippedRenderPixelPageCount"] : []),
      ...(v3 || v4 || v5 ? ["subjectCandidatePageCount"] : []),
      ...(v4 || v5 ? ["titleRecoveryCandidatePageCount"] : [])])
      || actual.sourceFileId !== source.apiId || actual.sourceSha256 !== source.sha256
      || actual.mediaType !== source.mediaType || !Array.isArray(actual.pages)
      || actual.ocrRequiredPageCount !== required.length) return undefined;
    const isPdf = source.mediaType === "application/pdf";
    const isOversize = isPdf && source.byteSize > profile.maxSourceBytes;
    if (!isPdf) unsupported += 1;
    if (isOversize) oversized += required.length;
    const remaining = profile.maxPagesPerRun - processed;
    const selected = v5 ? v5Selection!.get(source.apiId)!.selected
      : v4 ? v4Selection!.get(source.apiId)!.selected
      : v3 ? v3Selection!.get(source.apiId)!.selected
      : v2 ? v2Selection!.get(source.apiId)!.selected
      : isOversize ? [] : required.slice(0, remaining);
    const sourceRasterSkipped = v5 ? v5Selection!.get(source.apiId)!.rasterSkipped
      : v4 ? v4Selection!.get(source.apiId)!.rasterSkipped
      : v3 ? v3Selection!.get(source.apiId)!.rasterSkipped
      : v2 ? v2Selection!.get(source.apiId)!.rasterSkipped : 0;
    const sourceSubjectCandidates = v5 ? v5Selection!.get(source.apiId)!.subjectCandidateCount
      : v4 ? v4Selection!.get(source.apiId)!.subjectCandidateCount
      : v3 ? v3Selection!.get(source.apiId)!.subjectCandidateCount : 0;
    const sourceTitleCandidates = v5 ? v5Selection!.get(source.apiId)!.titleRecoveryCandidateCount
      : v4 ? v4Selection!.get(source.apiId)!.titleRecoveryCandidateCount : 0;
    rasterSkipped += sourceRasterSkipped;
    subjectCandidates += sourceSubjectCandidates;
    titleCandidates += sourceTitleCandidates;
    const expectedStatus = !isPdf ? "SKIPPED_UNSUPPORTED_FORMAT" : isOversize
      ? "SKIPPED_SOURCE_TOO_LARGE" : required.length === 0 ? "NO_OCR_REQUIRED_PAGES"
      : selected.length === required.length ? "SCANNED"
      : v3 && sourceSubjectCandidates === 0 ? "SKIPPED_NO_SUBJECT_CONTEXT"
      : (v4 || v5) && sourceSubjectCandidates + sourceTitleCandidates === 0 ? "SKIPPED_NO_SELECTION_CONTEXT"
      : boundedProfile && selected.length === 0
        && sourceRasterSkipped === (v4 || v5 ? sourceSubjectCandidates + sourceTitleCandidates
          : v3 ? sourceSubjectCandidates : required.length)
        ? "SKIPPED_RENDER_PIXEL_LIMIT"
        : boundedProfile ? "PARTIALLY_SCANNED" : "PARTIALLY_SCANNED_PAGE_BUDGET";
    const expectedPageCount = isPdf && record(source.textArtifact) ? source.textArtifact.pageCount : null;
    if (actual.pageCount !== expectedPageCount || actual.status !== expectedStatus
      || actual.processedPageCount !== selected.length
      || actual.deferredPageCount !== required.length - selected.length
      || (boundedProfile && actual.skippedRenderPixelPageCount !== sourceRasterSkipped)
      || ((v3 || v4 || v5) && actual.subjectCandidatePageCount !== sourceSubjectCandidates)
      || ((v4 || v5) && actual.titleRecoveryCandidatePageCount !== sourceTitleCandidates)
      || actual.pages.length !== selected.length) return undefined;
    for (let pageIndex = 0; pageIndex < selected.length; pageIndex += 1) {
      if (!validOcrPage(actual.pages[pageIndex], source, selected[pageIndex], boundedProfile)) return undefined;
    }
    processed += selected.length;
    requiredTotal += required.length;
  }
  if (result.outputCount !== processed || analysis.processedPageCount !== processed
    || analysis.ocrRequiredPageCount !== requiredTotal
    || analysis.deferredPageCount !== requiredTotal - processed
    || analysis.skippedOversizePageCount !== oversized
    || (boundedProfile && analysis.skippedRenderPixelPageCount !== rasterSkipped)
    || ((v3 || v4 || v5) && analysis.subjectCandidatePageCount !== subjectCandidates)
    || ((v4 || v5) && analysis.titleRecoveryCandidatePageCount !== titleCandidates)
    || analysis.skippedUnsupportedSourceCount !== unsupported) return undefined;
  const canonical = canonicalJson(result);
  const byteSize = Buffer.byteLength(canonical, "utf8");
  if (byteSize < 1 || byteSize > 8 * 1024 * 1024) return undefined;
  const id = randomUUID();
  const contentHash = sha256(canonical);
  return { id, canonical, contentHash, byteSize, outputCount: processed,
    storedResult: { schemaVersion: result.schemaVersion, artifactId: id,
      disposition: result.disposition, reasonCode: result.reasonCode,
      providerKind: result.providerKind, providerProfileId: result.providerProfileId,
      providerConfigHash: result.providerConfigHash, outputCount: processed,
      contentHash, byteSize } };
}
