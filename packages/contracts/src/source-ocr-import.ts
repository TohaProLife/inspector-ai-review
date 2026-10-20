import type { DocumentTextV4FullAuditSourceRead } from "./document-text-v4-full-audit.js";

/** Caller authenticates parent run, manifest, original and the complete V4 artifact. */
export type SourceOcrImportOrigin = Omit<DocumentTextV4FullAuditSourceRead, "pageStages" | "latestReviewHash">;
export interface SourceOcrImportPage {
  readonly pageNumber: number;
  readonly pdfWidthMilliPoints: number;
  readonly pdfHeightMilliPoints: number;
  readonly rasterWidth: number;
  readonly rasterHeight: number;
  /** External assertion only; importing these bytes never authenticates their raster. */
  readonly renderSha256: string;
  readonly rawResponseJson: string;
}
export interface SourceOcrImportBundle {
  readonly schemaVersion: "source-ocr-import-bundle-v1";
  readonly sourceSha256: string;
  readonly profileId: "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1";
  readonly pages: readonly SourceOcrImportPage[];
}
export interface SourceOcrImportLine {
  /** Ordinal in the unchanged provider rec_texts array; empty rows are not promoted. */
  readonly ordinal: number;
  readonly text: string;
  /** Provider score, not a calibrated probability. */
  readonly recognitionScore: number;
  /** External raster coordinates only. No PDF conversion or trusted highlight. */
  readonly rasterBbox: readonly [number, number, number, number];
  readonly lineHash: string;
}
export interface SourceOcrImportDerivedPage extends SourceOcrImportPage {
  readonly rawResponseSha256: string;
  readonly lines: readonly SourceOcrImportLine[];
  readonly status: "TEXT_CANDIDATE" | "UNRESOLVED";
}
export interface SourceOcrImportDerived {
  readonly schemaVersion: "source-ocr-import-derived-v1";
  readonly status: "IMPORTED_OCR_UNVERIFIED";
  readonly policyVersion: "source-ocr-import-v1";
  readonly sourceSha256: string;
  readonly profileId: "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1";
  readonly p: null;
  readonly factEligible: false;
  readonly coverageDelta: 0;
  readonly providerExecutionVerified: false;
  readonly renderDerivationVerified: false;
  readonly pages: readonly SourceOcrImportDerivedPage[];
  readonly bundleHash: string;
  readonly notices: readonly string[];
  /** Integrity only. Authentication remains the repository's responsibility. */
  readonly contentHash: string;
}
