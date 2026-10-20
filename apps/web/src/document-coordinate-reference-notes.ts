import { documentCoordinatePageFrameSchema, type DocumentCoordinatePageFrame } from "@inspector-ai/contracts";
import { sourceTextEvidence, type SourceTextIdentity, type SourceTextIndex, type SourceTextLine } from "./source-text-explorer";
import type { InspectorEvidenceViewerProps } from "./InspectorEvidenceViewer";

export type DocumentCoordinateReferenceKind = "COORDINATE_SYSTEM_DECLARATION" | "HEIGHT_SYSTEM_DECLARATION" | "PRINTED_SCALE_DECLARATION";
export interface DocumentCoordinateReferenceNote {
  id: string; kind: DocumentCoordinateReferenceKind; rawText: string;
  pageNumber: number; blockIndex: number; lineIndex: number;
  bboxMilliPoints: [number, number, number, number] | null;
  evidence: InspectorEvidenceViewerProps["evidence"] | null;
}
export interface DocumentCoordinateReferenceRead {
  status: "SOURCE_DECLARED_UNVERIFIED"; identity: SourceTextIdentity; origin: SourceTextIndex["origin"];
  frame: DocumentCoordinatePageFrame; notes: DocumentCoordinateReferenceNote[];
  totalNotes: number; truncated: boolean; indexPageExcluded: boolean; pageHasNoText: boolean; calibratedProbability: null;
}
const hash = (v: unknown): v is string => typeof v === "string" && v.length === 64 && /^[a-f0-9]{64}$/u.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(v);
const integer = (v: unknown, min: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const changed = () => Error("Источник, проверка, решение или рамка изменились. Загрузите заметки исходного листа снова.");
const sameIdentity = (a: SourceTextIdentity, b: SourceTextIdentity) => a.objectId === b.objectId && a.checkId === b.checkId
  && a.file?.id === b.file?.id && a.file?.sha256 === b.file?.sha256 && a.reviewHash === b.reviewHash;

/** This projection consumes the complete existing text index, not search hits.
 * The frame came from the authenticated original-PDF reader. Text itself has no
 * independent PDF Rotate or frame-hash authority; no second rotation is used. */
export function buildDocumentCoordinateReferenceNotes(index: SourceTextIndex, identity: SourceTextIdentity,
  frame: DocumentCoordinatePageFrame): DocumentCoordinateReferenceRead {
  if (!identity || !id(identity.objectId) || !id(identity.checkId) || !id(identity.file?.id)
      || !hash(identity.file?.sha256) || (identity.reviewHash !== null && !hash(identity.reviewHash))
      || !index || !index.identity || !sameIdentity(index.identity, identity)
      || !documentCoordinatePageFrameSchema.safeParse(frame).success || frame.geometryPrecisionPt !== 0.01
      || frame.sourceFileId !== identity.file.id || frame.sourceSha256 !== identity.file.sha256
      || !integer(index.pageCount, 1) || index.pageCount > 512 || frame.pdfPageNumber > index.pageCount
      || (identity.file.pageCount !== null && identity.file.pageCount !== index.pageCount)) throw changed();
  const origin = index.origin;
  if (!origin || origin.checkId !== identity.checkId || origin.sourceFileId !== identity.file.id
      || origin.sourceSha256 !== identity.file.sha256 || origin.latestReviewHash !== identity.reviewHash
      || !hash(origin.inputManifestHash) || !hash(origin.textStageContentHash) || !hash(origin.textArtifactHash)
      || !["PD", "RD", "UNRESOLVED"].includes(origin.stage)
      || (origin.stage !== "UNRESOLVED" && !identity.file.stages.includes(origin.stage))
      || !Array.isArray(index.lines) || index.lines.length > 100000) throw changed();
  const selected: SourceTextLine[] = [], seen = new Set<string>(); let characters = 0;
  for (const line of index.lines) {
    if (!line || !integer(line.pageNumber, 1) || line.pageNumber > index.pageCount || !integer(line.blockIndex, 0)
        || !integer(line.lineIndex, 0) || typeof line.rawText !== "string" || /[\n\r]/u.test(line.rawText)
        || !integer(line.widthMilliPoints, 1) || !integer(line.heightMilliPoints, 1)) throw changed();
    characters += line.rawText.length; if (characters > 8 * 1024 * 1024) throw changed();
    const key = JSON.stringify([identity.objectId, identity.checkId, identity.file.id, identity.file.sha256,
      identity.reviewHash, origin.textArtifactHash, line.pageNumber, line.blockIndex, line.lineIndex]);
    if (line.key !== key || seen.has(key)) throw changed(); seen.add(key);
    const box = line.bboxMilliPoints;
    if (box !== null && (!Array.isArray(box) || box.length !== 4 || !Array.from(box).every(v => integer(v, 0))
        || box[0] >= box[2] || box[1] >= box[3] || box[2] > line.widthMilliPoints || box[3] > line.heightMilliPoints)) throw changed();
    if (line.pageNumber === frame.pdfPageNumber) {
      const common = selected[0];
      if (common && (common.widthMilliPoints !== line.widthMilliPoints || common.heightMilliPoints !== line.heightMilliPoints)) throw changed();
      // Fixed 0.01pt; tiny conversion epsilon only for decimal-to-binary error.
      if (Math.abs(line.widthMilliPoints - frame.visibleWidthPt * 1000) > 10 + 1e-7
          || Math.abs(line.heightMilliPoints - frame.visibleHeightPt * 1000) > 10 + 1e-7) throw changed();
      selected.push(line);
    }
  }
  const indexPageExcluded = selected.some(line => /(?:^|[^\p{L}\p{N}_])Содержание(?:$|[^\p{L}\p{N}_])/iu.test(line.rawText)
    || /Ведомость[^\n\r]*листов/iu.test(line.rawText));
  const notes: DocumentCoordinateReferenceNote[] = []; let totalNotes = 0;
  function add(line: SourceTextLine, kind: DocumentCoordinateReferenceKind, occurrence: number) {
    totalNotes++;
    if (notes.length >= 50) return;
    notes.push({ id: JSON.stringify([line.key, kind, occurrence]), kind, rawText: line.rawText,
      pageNumber: line.pageNumber, blockIndex: line.blockIndex, lineIndex: line.lineIndex,
      bboxMilliPoints: line.bboxMilliPoints ? [...line.bboxMilliPoints] : null,
      evidence: line.bboxMilliPoints ? sourceTextEvidence(index, line) : null });
  }
  if (!indexPageExcluded) for (const line of selected) {
    const clauses = /(?:^|[.;])[ \t]*(Система координат|Система высот)[ \t]*[-–—:][ \t]*([^.;\n\r]+)/gu;
    for (const match of line.rawText.matchAll(clauses)) if (match[2].trim())
      add(line, match[1] === "Система координат" ? "COORDINATE_SYSTEM_DECLARATION" : "HEIGHT_SYSTEM_DECLARATION", match.index);
    // Literal title prefix required. The prefix is not classified as an
    // authoritative drawing title; the ratio is never interpreted as a unit.
    if (/^\S[^\n\r]*[ \t]+М +[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$/u.test(line.rawText)
        && !line.rawText.startsWith("…") && !line.rawText.startsWith("...")) add(line, "PRINTED_SCALE_DECLARATION", 0);
  }
  return { status: "SOURCE_DECLARED_UNVERIFIED", identity: structuredClone(identity), origin: structuredClone(origin),
    frame: structuredClone(frame), notes, totalNotes, truncated: totalNotes > notes.length,
    indexPageExcluded, pageHasNoText: selected.length === 0, calibratedProbability: null };
}
