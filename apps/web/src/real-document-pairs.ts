import type { SourceFileSummary } from "@inspector-ai/contracts";
import bindings from "../../../fixtures/real-public-room-pairs-v1/manual-source-bindings.json";
import type { DocumentEvidence } from "./document-pair-navigation";

export interface RealDocumentPair { roomId: string; sources: DocumentEvidence[]; files: SourceFileSummary[] }
/** Public source bindings only. Never use a filename, training answer or current stage as identity. */
export function realDocumentPairs(files: SourceFileSummary[]): RealDocumentPair[] {
  const result: RealDocumentPair[] = [];
  for (const roomId of ["147", "198"]) {
    const records = bindings.records.filter(record => record.roomId === roomId);
    if (records.length !== 2) continue;
    const pd = records.find(record => record.inputRole === "PD"), rd = records.find(record => record.inputRole === "RD");
    if (!pd || !rd) continue;
    const selected = records.map(record => files.filter(file => file.sha256 === record.sourceSha256
      && file.pageCount !== null && file.pageCount >= record.physicalPage));
    // Duplicate content identities require an explicit source selection, not a first-match fallback.
    if (selected.some(matches => matches.length !== 1)) continue;
    const sources: DocumentEvidence[] = [];
    for (const [index, record] of records.entries()) {
      const file = selected[index][0], stage = record.inputRole as "PD" | "RD";
      const width = record.pageWidthMilliPoints, height = record.pageHeightMilliPoints;
      const base = { sourceFileId: file.id, sourceSha256: file.sha256, stage, pageNumber: record.physicalPage,
        sheet: null, revision: null, unit: null, element: `Помещение ${roomId}, выбранная серия В2` };
      const clip = record.crop.clipPt;
      sources.push({ ...base, id: `${roomId}-${stage}-context`, value: record.systemQuotes.map(quote => quote.rawText).join(" / "),
        bbox: [clip[0] * 1000 / width, clip[1] * 1000 / height, clip[2] * 1000 / width, clip[3] * 1000 / height] });
      for (const [quoteIndex, quote] of record.systemQuotes.entries()) {
        const box = quote.bboxMilliPoints;
        sources.push({ ...base, id: `${roomId}-${stage}-${quoteIndex}`, value: quote.rawText,
          bbox: [box[0] / width, 1 - box[3] / height, box[2] / width, 1 - box[1] / height] });
      }
    }
    result.push({ roomId, sources, files: selected.map(matches => matches[0]) });
  }
  return result;
}
