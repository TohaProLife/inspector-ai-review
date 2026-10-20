import type { SourceOcrImportDerived } from "./source-ocr-import.js";

export interface SourceOcrImportRecord {
  schemaVersion: "source-ocr-import-record-v1";
  id: string; objectId: string; checkId: string; sourceFileId: string;
  createdAt: string; createdBy: string;
  bindings: { releaseId: string; inputManifestHash: string; sourceSha256: string;
    textArtifactByteSha256: string; textArtifactContentHash: string; originalBytesVerified: true };
  derived: SourceOcrImportDerived;
  contentHash: string;
}
export interface SourceOcrReviewInput {
  schemaVersion: "source-ocr-review-command-v1";
  importId: string; importContentHash: string; pageNumber: number; ordinal: number; lineHash: string;
  decision: "CONFIRMED" | "REJECTED";
  basis: string; expectedReviewHash: string | null;
}
export interface SourceOcrReviewRecord extends Omit<SourceOcrReviewInput, "schemaVersion"> {
  schemaVersion: "source-ocr-review-record-v1";
  id: string; objectId: string; checkId: string; sourceFileId: string;
  createdAt: string; createdBy: string;
  humanTranscriptionOnly: true; p: null; factEligible: false; coverageDelta: 0;
  contentHash: string;
}
export interface SourceOcrImportWorkspace {
  schemaVersion: "source-ocr-import-workspace-v1";
  checkId: string; canImport: boolean; canReview: boolean;
  availability: "READY" | "SEALED_SOURCE_AUDIT_V4_REQUIRED";
  items: SourceOcrImportRecord[]; reviews: SourceOcrReviewRecord[];
}
