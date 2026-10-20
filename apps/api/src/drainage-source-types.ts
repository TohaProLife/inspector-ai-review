/** Wire documentation only. No integration into current source106. */
export type DrainageRawReferenceType =
  | 'DRAINAGE_PLAN_REFERENCE'
  | 'DRAINAGE_TRAY_REFERENCE'
  | 'DRAINAGE_PIPE_REFERENCE'
  | 'TUBULAR_DRAINAGE_REFERENCE';

/** Every object is CLOSED: extra keys refuse. All integers exclude booleans. */
export interface DrainageCacheSourceBindingV1 {
  schemaVersion: 'drainage-cache-source-binding-v1';
  policyVersion: 'drainage-raw-reference-literals-v1';
  cacheSha256: string; // lowercase64hex, whole exact cache bytes
  sourceFileId: string;
  sourceSha256: string; // independently supplied original PDF identity
  declaredCachePage: number; // integer1..100000
  providerProfileId: string;
  rendererProfileId: string;
  script: string;
  dpi: number; // integer1..1200
  declaredWidthPx: number; // integer1..32768, width*height<=67108864
  declaredHeightPx: number;
  declaredRenderSha256: string; // declared, not accepted render proof
}

export interface DrainageRawSourceReferenceV1 {
  status: 'SOURCE_CANDIDATE';
  provenance: 'OCR_CACHE_UNVERIFIED';
  probability: null;
  rawReferenceType: DrainageRawReferenceType;
  rawOcrText: string; // exact original line, <=500 Unicode scalar codepoints
  matchedText: string;
  matchedSpanCodepoints: [number, number]; // original text, half-open; NOT JS UTF16 indices
  cacheSha256: string;
  cacheJsonPointer: string; // /artifact/lines/{canonical zero-based integer}/text
  sourceFileId: string;
  sourcePdfSha256: string;
  declaredCachePage: number;
  declaredOcr: {
    providerProfileId: string;
    script: string;
    score: number; // finite0..1 cached OCR score, never engineering probability
  };
  declaredGeometry: {
    status: 'DECLARED_UNVERIFIED';
    overlayPermitted: false;
    renderSha256: string;
    rendererProfileId: string;
    dpi: number;
    widthPx: number;
    heightPx: number;
    bboxPx: [number, number, number, number]; // integers bounded by DECLARED dimensions
  };
}

export interface DrainageSourceCandidatesV1 {
  schemaVersion: 'drainage-source-candidates-v1';
  policyVersion: 'drainage-raw-reference-literals-v1';
  purpose: 'SOURCE_REVIEW_ONLY';
  provenance: 'OCR_CACHE_UNVERIFIED';
  probability: null;
  validatedLineCount: number; // integer0..4096, not inventory completeness
  referenceLimit: 32;
  references: DrainageRawSourceReferenceV1[]; // <=32, line-index then fixed type order
  truncated: boolean;
  findings: null;
  parameterCoverage: null;
}

/**
 * Pure function inputs: exact cache bytes <=1048576 and closed binding above.
 * Entire strict UTF8/duplicate-free finite JSON/cache line schema validates
 * before classification. See before-code-contract.md for cache schema and
 * finite grammar/suppression; helper source is future verifier reference.
 * No source role, stage/review/approval/link, featureKey, zone, comparison,
 * source inventory, finding or coverage authority. Missing accepted PNG or
 * release is intentional. Do not use cached boxes on a resized preview.
 */
