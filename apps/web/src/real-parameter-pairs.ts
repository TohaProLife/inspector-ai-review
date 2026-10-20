import type { SourceFileSummary } from "@inspector-ai/contracts";
import bindings from "../../../fixtures/real-parameter-source-comparisons-v1/viewer-bindings.json";
import { validEvidenceBox, type DocumentEvidence } from "./document-pair-navigation";

export interface RealParameterPair {
  id: string; parameterCode: string; label: string; sources: DocumentEvidence[];
  citations: { sourceFileId: string; page: number; kind: string; rawText: string }[];
}
/** Curated original citations for review. No verdict, public label or stage approval is inferred. */
export function realParameterPairs(files: SourceFileSummary[]): RealParameterPair[] {
  if (bindings.schemaVersion !== "real-parameter-source-viewer-bindings-v1" || bindings.engineeringQualification
    || bindings.coverageDelta !== 0 || bindings.p !== null) return [];
  const result: RealParameterPair[] = [];
  for (const selection of bindings.selections) {
    if (selection.scopeStatus !== "SOURCE_ONLY_CANDIDATE" || selection.completeConfiguration) continue;
    const sources: DocumentEvidence[] = [], citations: RealParameterPair["citations"] = [];
    for (const [index, quote] of selection.quotes.entries()) {
      const matches = files.filter(file => file.sha256 === quote.sourceSha256 && file.pageCount !== null && file.pageCount >= quote.physicalPage);
      if (matches.length !== 1 || quote.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS"
        || !["PD", "RD"].includes(quote.role) || quote.factEligible || quote.p !== null) break;
      const file = matches[0], box = quote.bboxMilliPoints, width = quote.pageWidthMilliPoints, height = quote.pageHeightMilliPoints;
      const bbox: [number, number, number, number] = [box[0] / width, 1 - box[3] / height, box[2] / width, 1 - box[1] / height];
      if (!validEvidenceBox(bbox)) break;
      sources.push({ id: `${selection.id}-${index}`, stage: quote.role as "PD" | "RD", sourceFileId: file.id,
        sourceSha256: file.sha256, pageNumber: quote.physicalPage, bbox, sheet: null, revision: null,
        element: selection.declaredScope, value: quote.displayValue, unit: quote.unit });
      citations.push({ sourceFileId: file.id, page: quote.physicalPage, kind: quote.evidenceKind, rawText: quote.rawText });
    }
    if (sources.length !== selection.quotes.length || !sources.some(source => source.stage === "PD") || !sources.some(source => source.stage === "RD")) continue;
    result.push({ id: selection.id, parameterCode: selection.parameterCode,
      label: selection.parameterCode === "PZ-013" ? "Вместимость · PZ-013" : "П17 · IOS4-079", sources, citations });
  }
  return result;
}
