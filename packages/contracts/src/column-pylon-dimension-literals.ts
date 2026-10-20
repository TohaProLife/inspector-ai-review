// Derived from column-pylon-dimension-literals.schema.json.
// Schema SHA-256: 249774a4ff6931298e047ae1d09ac5d6b3f5a4b5f068899e334aa23a5b6beacc
import type { DocumentTextV3ExtractorProfile, DocumentTextV3NativeBox, DocumentTextV3NativeFrame, DocumentTextV3SourcePath } from "./document-text-v3.js";
export type ColumnPylonLiteralToken = { raw: string; rangeCodePoints: [number, number] };
export type ColumnPylonDimensionLiteral = {
  pageNumber: number; sourcePath: DocumentTextV3SourcePath; rawText: string;
  nativeBoxPointStrings: DocumentTextV3NativeBox; bboxMilliPoints: [number, number, number, number];
  pageFrame: { widthMilliPoints: number; heightMilliPoints: number; nativeFrame: DocumentTextV3NativeFrame };
  usedTextRangeCodePoints: [number, number];
  tokens: { kind: ColumnPylonLiteralToken; first: ColumnPylonLiteralToken; second: ColumnPylonLiteralToken; unit: ColumnPylonLiteralToken; level: ColumnPylonLiteralToken; scope: ColumnPylonLiteralToken };
  sourceOnly: true; calibratedProbability: null;
  rectangleStatus: "UNVERIFIED"; grossSectionStatus: "UNVERIFIED";
  physicalMemberStatus: "UNVERIFIED"; applicabilityStatus: "UNVERIFIED"; renderedVisibilityStatus: "UNVERIFIED";
};
type Envelope = { schemaVersion: "column-pylon-dimension-literals-v1"; resourcePolicyVersion: "document-text-v3-large-source-bounds-v1" };
export type ColumnPylonDimensionLiteralsResult = Envelope & (
  | { status: "SOURCE_LITERALS"; sourceFileId: string; inputSha256: string; sourceArtifactContentHash: string;
      extractorProfile: DocumentTextV3ExtractorProfile; extractorProfileHash: string;
      literals: ColumnPylonDimensionLiteral[]; excludedPages: { pageNumber: number; reasonCode: "PAGE_NOT_CANDIDATE" | "UNLOCATED_RECORDS" }[] }
  | { status: "ABSTAIN"; reasonCode: "INVALID_INPUT" | "INPUT_LIMIT" | "INVALID_TEXT_ARTIFACT" }
);
