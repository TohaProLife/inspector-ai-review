import type { DocumentEvidence } from "./document-pair-navigation";
export interface NativeSourceLine {
  bboxMilliPoints: readonly number[]; pageWidthMilliPoints: number; pageHeightMilliPoints: number;
  coordinateSystem: string; physicalPage: number; inputRole: "PD" | "RD";
  sourceSha256: string; sourceFileId: string; rawText: string;
}
export function nativeSourceLineEvidence(quote: NativeSourceLine, index: number, kind: string, element: string): DocumentEvidence | null {
  const box = quote.bboxMilliPoints, width = quote.pageWidthMilliPoints, height = quote.pageHeightMilliPoints;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isSafeInteger)
    || box[0] < 0 || box[1] < 0 || box[0] >= box[2] || box[1] >= box[3] || box[2] > width || box[3] > height
    || quote.coordinateSystem !== "PDF_BOTTOM_LEFT_MILLI_POINTS" || !Number.isSafeInteger(quote.physicalPage) || quote.physicalPage < 1
    || !["PD", "RD"].includes(quote.inputRole) || !/^[a-f0-9]{64}$/u.test(quote.sourceSha256)) return null;
  return { id: `${kind}-${quote.inputRole}-${index}`, sourceFileId: quote.sourceFileId, sourceSha256: quote.sourceSha256,
    stage: quote.inputRole, pageNumber: quote.physicalPage, sheet: null, revision: null,
    bbox: [box[0] / width, 1 - box[3] / height, box[2] / width, 1 - box[1] / height],
    value: quote.rawText, unit: null, element };
}
