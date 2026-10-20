export type LocalDocumentPoint = [number, number];
export type LocalDocumentMatrix = [number, number, number, number, number, number];
export interface LocalDocumentFrame {
  sourceFileId: string;
  sourceSha256: string;
  pdfPageNumber: number;
  pageFrameSha256: string;
  coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED";
  visibleWidthPt: number;
  visibleHeightPt: number;
  rotate: 0 | 90 | 180 | 270;
  objectKey: string;
  floorKey: string;
  phaseKey: string;
  revisionKey: string;
}

export interface LocalDocumentAnchor {
  id: string;
  source: LocalDocumentPoint;
  target: LocalDocumentPoint;
  role: "FIT" | "HOLDOUT";
  referenceKind: "DOCUMENT_AXIS" | "STABLE_REFERENCE";
  sourceLocator: string;
  targetLocator: string;
}

export interface LocalDocumentRegistrationPacket {
  schemaVersion: "local-document-registration-v1";
  sourceFrame: LocalDocumentFrame;
  targetFrame: LocalDocumentFrame;
  method: "RIGID" | "SIMILARITY" | "AFFINE";
  basis: { kind: "DOCUMENT_AXES" | "STABLE_REFERENCES" | "SCAN_DISTORTION"; evidenceRefs: string[] };
  anchors: LocalDocumentAnchor[];
  minScale: number;
  maxScale: number;
  maxAnisotropy: number;
  maxResidualTargetPoints: number;
  sourceLocalizationUncertaintyPt: number;
  targetLocalizationUncertaintyPt: number;
  targetScale: { unit: "m" | "cm" | "mm"; unitsPerVisiblePoint: number;
    relativeUncertainty: number; evidenceRef: string } | null;
}

/** Caller verifies original bytes/page frames and loads this digest from an authenticated decision. */
export interface LocalDocumentRegistrationTrust {
  sourceFrame: LocalDocumentFrame;
  targetFrame: LocalDocumentFrame;
  reviewedRegistrationSha256: string;
}

export type LocalDocumentRegistrationReason = "INVALID_REGISTRATION_PACKET" | "PAGE_FRAME_MISMATCH"
  | "SCOPE_MISMATCH" | "REGISTRATION_REVIEW_REQUIRED" | "AFFINE_SCAN_BASIS_REQUIRED"
  | "INSUFFICIENT_INDEPENDENT_ANCHORS" | "DEGENERATE_ANCHOR_GEOMETRY"
  | "SCALE_OR_DISTORTION_OUTSIDE_POLICY" | "RESIDUAL_OUTSIDE_POLICY" | "REGISTERED_RELATIVE";

export interface RegisteredLocalDocuments {
  status: "REGISTERED_RELATIVE";
  reasonCode: "REGISTERED_RELATIVE";
  schemaVersion: "local-document-registration-result-v1";
  sourceFrame: LocalDocumentFrame;
  targetFrame: LocalDocumentFrame;
  registrationSha256: string;
  method: LocalDocumentRegistrationPacket["method"];
  forwardMatrix: LocalDocumentMatrix;
  inverseMatrix: LocalDocumentMatrix;
  scaleRange: [number, number];
  fitResiduals: Array<{ anchorId: string; targetPoints: number }>;
  holdoutResiduals: Array<{ anchorId: string; targetPoints: number }>;
  maxResidualTargetPoints: number;
  uncertaintyTargetPoints: number;
  sourceDomain: LocalDocumentPoint[];
  targetDomain: LocalDocumentPoint[];
  metricScale: { metresPerVisiblePoint: number; relativeUncertainty: number; evidenceRef: string } | null;
  absoluteGeoreference: false;
}

export type LocalDocumentRegistrationResult = RegisteredLocalDocuments | {
  status: "ABSTAIN";
  reasonCode: Exclude<LocalDocumentRegistrationReason, "REGISTERED_RELATIVE">;
  schemaVersion: "local-document-registration-result-v1";
  absoluteGeoreference: false;
};

export type RegisteredDisplacementComparison = {
  status: "VIOLATION" | "NO_VIOLATION";
  reasonCode: "DISPLACEMENT_EXCEEDS_THRESHOLD" | "DISPLACEMENT_WITHIN_THRESHOLD";
  distanceMetres: number;
  intervalMetres: [number, number];
  thresholdMetres: number;
  registrationSha256: string;
} | { status: "ABSTAIN"; reasonCode: "REGISTRATION_REQUIRED" | "INVALID_COMPARISON"
  | "METRIC_SCALE_REQUIRED" | "OUTSIDE_REGISTERED_DOMAIN" | "THRESHOLD_WITHIN_UNCERTAINTY";
  intervalMetres?: [number, number] };

/** Calculation preview is not an authenticated anchor decision. */
export interface LocalDocumentRegistrationPreview {
  status: "PREVIEW_ONLY";
  result: LocalDocumentRegistrationResult;
}

export interface LocalDocumentRegistrationReview {
  reviewId: string;
  actorId: string;
  reviewedAt: string;
  registrationSha256: string;
  result: RegisteredLocalDocuments;
}

export interface PersistedLocalDocumentRegistrationReview extends LocalDocumentRegistrationReview {
  objectId: string;
  checkId: string;
  contentHash: string;
  previousReviewHash: string | null;
  packet: LocalDocumentRegistrationPacket;
  reason: string;
}

export interface LocalDocumentRegistrationWorkspaceRead {
  objectId: string;
  checkId: string | null;
  lifecycle: "OPEN" | "FINALIZED";
  canReview: boolean;
  expectedReviewHash: string | null;
  latest: PersistedLocalDocumentRegistrationReview | null;
  history: Array<{ reviewId: string; contentHash: string; registrationSha256: string; actorId: string; reviewedAt: string }>;
}

export interface LocalDocumentRegistrationPreviewInput {
  checkId: string;
  packet: LocalDocumentRegistrationPacket;
}

export interface LocalDocumentRegistrationSaveInput extends LocalDocumentRegistrationPreviewInput {
  schemaVersion: "local-document-registration-review-command-v1";
  expectedReviewHash: string | null;
  originalsReviewed: true;
  stableReferencesConfirmed: true;
  scopeConfirmed: true;
  reason: string;
}
