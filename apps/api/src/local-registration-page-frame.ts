import type { LocalDocumentFrame } from "@inspector-ai/contracts";
import { readCanonicalPdfPageFrame } from "./canonical-pdf-page-frame.js";
import { PdfPreviewError } from "./pdf-preview.js";

/** Legacy document-to-document frame keeps its exact scope and hash projection. */
export async function readLocalRegistrationPageFrame(input: {
  sourceBytes: Buffer; expectedSourceSha256: string; sourceFileId: string; objectId: string;
  pdfPageNumber: number; floorKey: string; phaseKey: string;
}): Promise<LocalDocumentFrame> {
  if ([input.floorKey, input.phaseKey].some(key => typeof key !== "string" || key !== key.trim() || key.length < 1 || key.length > 128)) {
    throw new PdfPreviewError(422, "INVALID_SOURCE", "Исходный PDF или область привязки недопустимы");
  }
  const { geometryPrecisionPt: _precision, ...frame } = await readCanonicalPdfPageFrame(input);
  return { ...frame, objectKey: input.objectId, floorKey: input.floorKey, phaseKey: input.phaseKey,
    revisionKey: `sha256:${input.expectedSourceSha256}` };
}
