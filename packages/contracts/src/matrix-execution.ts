import type { MachineConfidencePresentation } from "./machine-confidence.js";

/** Source context remains separate from the value's page and never approves its scope. */
export interface MatrixContextFragment {
  pageNumber: number;
  blockId: string;
  rawText: string;
  bbox: { x: number; y: number; width: number; height: number };
  role: "ATTRIBUTE_HEADER" | "TABLE_SCOPE" | "UNIT_DECLARATION" | "MATERIAL_SCOPE";
}

export interface MatrixObservation {
  id: string;
  sourceFileId: string;
  sourceSha256: string;
  stage: "PD" | "RD" | "ID" | "UNRESOLVED";
  pageNumber: number;
  blockId: string;
  bbox: { x: number; y: number; width: number; height: number };
  rawText: string;
  attribute: string;
  value: string;
  unit: string;
  entityKey: string | null;
  method: "TEXT_LAYER";
  extractorVersion: string;
  contextFragments?: MatrixContextFragment[];
  [key: string]: unknown;
}

/** OCR observations remain separate from atomic comparisons and qualified text facts. */
export interface MatrixOcrCandidate {
  id: string;
  sourceFileId: string;
  sourceSha256: string;
  stage: "PD" | "RD" | "ID" | "UNRESOLVED";
  pageNumber: number;
  lineIndex: number;
  blockId: string;
  renderSha256: string;
  ocrPageContentHash: string;
  bbox: { x: number; y: number; width: number; height: number };
  coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED";
  rawText: string;
  rawValue: string;
  rawUnit: string;
  attribute: string;
  value: string;
  unit: string;
  parameterCodes: string[];
  entityKey: null;
  method: "OCR";
  status: "CANDIDATE";
  extractorVersion: "matrix-ocr-literal-candidates-v1";
  /** Always includes OCR_TRANSCRIPTION_UNVERIFIED, including approved source revisions. */
  sourceFlags: string[];
}

export interface MatrixAtomicResult {
  ruleId: string;
  ruleVersion: string;
  parameterCode: string;
  entityKey: string | null;
  comparisonVariant: "PD_RD" | "PD_ID" | "RD_ID";
  executionStatus: "SUCCEEDED" | "FAILED";
  machineStatus: "CANDIDATE" | "NEGATIVE_VERIFIED" | "MISSING_EVIDENCE" | "NOT_COMPARABLE" | "CLARIFICATION_REQUIRED";
  reasonCode: string;
  expectedObservationId: string | null;
  actualObservationId: string | null;
  expectedValue: string | null;
  actualValue: string | null;
  delta: string | null;
  qualified: boolean;
  [key: string]: unknown;
}

export interface MatrixCoverage {
  parameterCode: string;
  implementedAtomicRules: number;
  enabledAtomicRules: number;
  evaluatedAtomicRules: number;
  successfulComparisons: number;
  abstentions: number;
  failures: number;
  executionStatus: "UNSUPPORTED" | "PARTIAL" | "EVALUATED" | "TECHNICAL_FAILURE";
  reason: string;
}

/** Immutable machine artifact, independent of subsequent inspector decisions. */
export interface MatrixExecution {
  schemaVersion: "matrix-execution-v1";
  objectId: string;
  inputManifestHash: string;
  registryHash: string;
  observations: MatrixObservation[];
  ocrCandidates?: MatrixOcrCandidate[];
  ocrSummary?: { processedPageCount:number; ocrRequiredPageCount:number; deferredPageCount:number; skippedRenderPixelPageCount:number; maxPagesPerRun:number };
  metadata: Array<Record<string, unknown>>;
  results: MatrixAtomicResult[];
  coverage: MatrixCoverage[];
}

export interface MatrixExecutionRead {
  columnPylonSectionComparisons?: import("./matrix-column-pylon-section-execution.js").ColumnPylonSectionExecutionComparisons;
  columnPylonSectionSnapshot?: import("./matrix-column-pylon-section-run-snapshot.js").ColumnPylonSectionRunSnapshot;
  columnPylonSectionComparisonEvidence?: import("./matrix-column-pylon-section-execution.js").ColumnPylonSectionExecutionEvidence[];
  steelComparisons?: import("./matrix-steel-execution.js").SteelComparisonExecutionComparisons;
  steelApplicabilitySnapshot?: import("./matrix-steel-durable.js").SteelApplicabilityRunSnapshot;
  steelComparisonEvidence?: import("./matrix-steel-execution.js").SteelComparisonExecutionEvidence[];
  checkId: string;
  contentHash: string;
  execution: MatrixExecution;
  /** Separate evidence-only payload. Historical exact-only profiles omit it. */
  projectConstraints?: import("./matrix-project-constraints.js").MatrixProjectConstraints;
  /** Separate source-authored evidence; v1/v2 profiles omit it. */
  sourceDeclarations?: import("./matrix-source-declarations-v2.js").MatrixSourceDeclarationsRead;
  /** Separate typed comparisons. Four legacy profiles omit these fields. */
  lightingTechnologyComparisons?: import("./matrix-lighting-technology-execution.js").LightingTechnologyExecutionComparisons;
  lightingTechnologyComparisonEvidence?: import("./matrix-lighting-technology-execution.js").LightingTechnologyExecutionEvidence[];
  waterNodeComparisons?: import("./matrix-water-node-execution.js").MatrixWaterNodeComparisons;
  waterNodeComparisonEvidence?: import("./matrix-water-node-execution.js").MatrixWaterNodeComparisonEvidence[];
  railInventoryComparisons?: import("./matrix-rail-inventory-execution.js").MatrixRailInventoryComparisons;
  railInventoryComparisonEvidence?: import("./matrix-rail-inventory-execution.js").MatrixRailInventoryComparisonEvidence[];
  callInventoryComparisons?: import("./matrix-call-inventory-execution.js").MatrixCallInventoryComparisons;
  callInventoryComparisonEvidence?: import("./matrix-call-inventory-execution.js").MatrixCallInventoryComparisonEvidence[];
  inventoryComparisons?: import("./matrix-inventory-execution.js").MatrixInventoryComparisons;
  inventoryComparisonEvidence?: import("./matrix-inventory-execution.js").MatrixInventoryComparisonEvidence[];
  /** v5 merges scalar and typed coverage without altering the scalar artifact. */
  effectiveCoverage?: MatrixCoverage[];
  presentation: Array<{ resultIndex: number } & (MachineConfidencePresentation | import("./machine-confidence-v2.js").MachineConfidencePresentationV2)>;
  submission: {
    contentHash: string;
    officialIdsVerified: boolean;
    mappingVersion: string;
    partial: boolean;
    omittedResults: number;
  } | null;
}
