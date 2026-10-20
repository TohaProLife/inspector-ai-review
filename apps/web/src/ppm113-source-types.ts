/** Source navigation only. OCR/render declarations never authorize engineering results. */
export interface Ppm113SourcePreviewInputV1 {
  checkId: string; sourceFileId: string; declaredCachePage: number; cacheJson: string;
}
export interface Ppm113SourceReferenceV1 {
  status: "SOURCE_CANDIDATE";
  provenance: "OCR_CACHE_UNVERIFIED";
  probability: null;
  rawReferenceType: "NAMED_VPV_RING_INTERNAL_DIAMETER";
  ringId: string;
  rawValue: string;
  rawUnit: "мм" | "см" | "м";
  internalDiameterMm: string;
  rawOcrText: string;
  matchedText: string;
  matchedSpanCodepoints: [number, number];
  cacheSha256: string;
  cacheJsonPointer: string;
  sourceFileId: string;
  sourcePdfSha256: string;
  declaredCachePage: number;
  declaredOcr: { providerProfileId: string; script: string; score: number };
  declaredGeometry: { status: "DECLARED_UNVERIFIED"; overlayPermitted: false;
    renderSha256: string; rendererProfileId: string; dpi: number;
    widthPx: number; heightPx: number; bboxPx: [number, number, number, number] };
}
export interface Ppm113SourceCandidatesV1 {
  schemaVersion: "ppm113-source-candidates-v1";
  policyVersion: "ppm113-named-ring-internal-diameter-literals-v1";
  parameterCode: "PPM-113";
  purpose: "SOURCE_REVIEW_ONLY";
  provenance: "OCR_CACHE_UNVERIFIED";
  probability: null;
  validatedLineCount: number;
  referenceLimit: 32;
  references: Ppm113SourceReferenceV1[];
  truncated: boolean;
  reason: "NO_EXACT_NAMED_RING_INTERNAL_DIAMETER_LITERAL" | null;
  findings: null;
  parameterCoverage: null;
}
