/** Evidence from an adopted project sentence; never an exact measurement or a rule result. */
export interface MatrixProjectConstraintFragment {
  blockIndex: number;
  lineIndex: 0;
  rawText: string;
  bboxMilliPoints: [number, number, number, number];
  /** Unicode code-point offsets into rawText, end exclusive. */
  usedTextRange: { start: number; end: number };
}

export interface MatrixProjectConstraint {
  schemaVersion: "matrix-project-constraint-v1";
  id: string;
  kind: "PROJECT_AUTHORED_CONSTRAINT";
  relation: "GE";
  attribute: "DOOR_CLEAR_OPENING_WIDTH";
  limitValue: string;
  canonicalUnit: "m";
  sourceFileId: string;
  sourceSha256: string;
  textArtifactHash: string;
  stage: "PD";
  pageNumber: number;
  widthMilliPoints: number;
  heightMilliPoints: number;
  extractorVersion: "matrix-project-bound-prose-v1";
  entityKey: null;
  applicabilityStatus: "UNREVIEWED";
  componentClass: "ACCESSIBLE_ROUTE_DOOR_OPENING";
  measurementBasis: "CLEAR_OPENING_WITH_LEAF_OPEN";
  fragments: MatrixProjectConstraintFragment[];
}

/** Stored alongside the scalar execution, outside its observations/results/coverage. */
export interface MatrixProjectConstraints {
  schemaVersion: "matrix-project-constraints-v1";
  objectId: string;
  inputManifestHash: string;
  extractorVersion: "matrix-project-bound-prose-v1";
  purpose: "EVIDENCE_ONLY";
  constraints: MatrixProjectConstraint[];
}
