import type { DocumentTextV4FullAuditSourceRead } from "./document-text-v4-full-audit.js";

/** Authenticated whole-source origins are supplied by the repository, never the browser. */
export type NativeCapacityOrigin = Omit<DocumentTextV4FullAuditSourceRead, "pageStages" | "latestReviewHash">;

export type NativeCapacityAbstainReason = "INVALID_ORIGIN" | "INVALID_TEXT_ARTIFACT"
  | "ORIGIN_ARTIFACT_MISMATCH" | "PAIR_SCOPE_MISMATCH" | "IDENTICAL_SOURCE"
  | "SOURCE_ROLE_CONFLICT" | "EXTRACTOR_PROFILE_MISMATCH" | "INPUT_LIMIT"
  | "UNSUPPORTED_TITLE_GRAMMAR" | "AMBIGUOUS_TITLE_ENTITY" | "UNLOCATED_TITLE"
  | "TITLE_CONTINUATION_UNRESOLVED"
  | "MATCHING_PAGE_UNVERIFIED" | "CAPACITY_DECLARATIONS_CONFLICT" | "CAPACITY_EVIDENCE_MISSING";

export interface NativeCapacityQuote {
  readonly sourceFileId: string;
  readonly sourceSha256: string;
  readonly textArtifactContentHash: string;
  readonly inputRole: "PD" | "RD";
  readonly evidenceKind: "NATIVE";
  readonly physicalPage: number;
  readonly pageWidthMilliPoints: number;
  readonly pageHeightMilliPoints: number;
  readonly sourcePath: readonly number[];
  readonly rawText: string;
  readonly nativeBoxPointStrings: readonly [string, string, string, string];
  readonly bboxMilliPoints: readonly [number, number, number, number];
  readonly coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS";
  /** Half-open Unicode codepoint offsets into the unchanged complete rawText. */
  readonly matchedRangeCodePoints: readonly [number, number];
  readonly rawValue: string;
  readonly value: string;
  readonly unit: "мест";
  readonly renderedVisibility: "UNVERIFIED";
  readonly extractionMethod: "NATIVE_SINGLE_LINE_TITLE" | "NATIVE_SAME_BLOCK_TWO_LINE_TITLE";
  /** Present only for the explicitly supported same-block two-line declaration. */
  readonly contextTitleLine?: { readonly sourcePath: readonly number[]; readonly rawText: string;
    readonly nativeBoxPointStrings: readonly [string, string, string, string];
    readonly bboxMilliPoints: readonly [number, number, number, number] };
}

export interface NativeCapacityProvenance {
  readonly checkId: string;
  readonly sourceFileId: string;
  readonly sourceSha256: string;
  readonly inputManifestHash: string;
  readonly textStageContentHash: string;
  readonly textArtifactByteSha256: string;
  readonly textArtifactContentHash: string;
  readonly extractorProfileHash: string;
  readonly extractorProfile: NativeCapacityOrigin["textArtifact"]["extractorProfile"];
  readonly sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1";
  readonly resourcePolicyVersion: "document-text-v4-full-source-bounds-v1";
  readonly declaredStage: "PD" | "RD" | "UNRESOLVED";
  readonly selectedRole: "PD" | "RD";
  readonly roleQualification: "UNVERIFIED";
  readonly pageCount: number;
  readonly scannedNativeLineCount: number;
}

export interface NativeCapacityTitleFragment {
  readonly reason: "TITLE_WITHOUT_QUANTITY" | "TITLE_CONTINUATION_UNRESOLVED";
  readonly inputRole: "PD" | "RD";
  readonly sourceFileId: string;
  readonly sourceSha256: string;
  readonly textArtifactContentHash: string;
  readonly physicalPage: number;
  readonly pageWidthMilliPoints: number;
  readonly pageHeightMilliPoints: number;
  readonly sourcePath: readonly number[];
  readonly rawText: string;
  readonly nativeBoxPointStrings: readonly [string, string, string, string];
  readonly bboxMilliPoints: readonly [number, number, number, number];
  readonly coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS";
  readonly continuationLines: readonly { readonly sourcePath: readonly number[]; readonly rawText: string;
    readonly nativeBoxPointStrings: readonly [string, string, string, string];
    readonly bboxMilliPoints: readonly [number, number, number, number] }[];
}

interface NativeCapacityBase {
  readonly schemaVersion: "native-capacity-comparison-v1";
  readonly policyVersion: "native-school-title-capacity-v1";
  readonly purpose: "SOURCE_ONLY";
  readonly parameterCode: "PZ-013";
  readonly attribute: "DECLARED_SCHOOL_SEAT_CAPACITY";
  readonly p: null;
  readonly calibratedProbability: null;
  readonly factEligible: false;
  readonly coverageDelta: 0;
  readonly engineeringQualification: false;
  readonly completeConfiguration: false;
  readonly notices: readonly string[];
  readonly excludedTitleFragments: readonly NativeCapacityTitleFragment[];
  readonly contentHash: string;
}

export type NativeCapacityComparison = NativeCapacityBase & ({
  readonly status: "COMPARED";
  readonly comparison: "EQUAL" | "DECREASE" | "INCREASE";
  readonly pdValue: string;
  readonly rdValue: string;
  readonly deltaRdMinusPd: string;
  readonly unit: "мест";
  readonly sources: { readonly PD: NativeCapacityProvenance; readonly RD: NativeCapacityProvenance };
  readonly quotes: { readonly PD: readonly NativeCapacityQuote[]; readonly RD: readonly NativeCapacityQuote[] };
} | {
  readonly status: "ABSTAIN";
  readonly reasonCode: NativeCapacityAbstainReason;
});
