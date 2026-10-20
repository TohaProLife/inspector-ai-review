import type { DocumentTextV4FullAuditSourceRead } from "./document-text-v4-full-audit.js";

/** Repository-authenticated whole-source input. Never supplied as evidence by a browser. */
export type NativeAirflowOrigin = Omit<DocumentTextV4FullAuditSourceRead, "pageStages" | "latestReviewHash">;
export interface NativeAirflowSelection {
  readonly pdSystemId: string;
  readonly rdSystemIds: readonly string[];
}
export type NativeAirflowAbstainReason = "INVALID_ORIGIN" | "INVALID_SELECTION" | "INVALID_TEXT_ARTIFACT"
  | "ORIGIN_ARTIFACT_MISMATCH" | "PAIR_SCOPE_MISMATCH" | "IDENTICAL_SOURCE" | "SOURCE_ROLE_CONFLICT"
  | "EXTRACTOR_PROFILE_MISMATCH" | "INPUT_LIMIT" | "UNLOCATED_SELECTED_SYSTEM"
  | "MATCHING_PAGE_UNVERIFIED" | "UNSUPPORTED_AIRFLOW_GRAMMAR" | "AMBIGUOUS_SELECTED_SYSTEM"
  | "AIRFLOW_DECLARATIONS_CONFLICT" | "SELECTED_MEMBER_EVIDENCE_MISSING";

export interface NativeAirflowProvenance {
  readonly checkId: string;
  readonly sourceFileId: string;
  readonly sourceSha256: string;
  readonly inputManifestHash: string;
  readonly textStageContentHash: string;
  readonly textArtifactByteSha256: string;
  readonly textArtifactContentHash: string;
  readonly extractorProfileHash: string;
  readonly extractorProfile: NativeAirflowOrigin["textArtifact"]["extractorProfile"];
  readonly sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1";
  readonly resourcePolicyVersion: "document-text-v4-full-source-bounds-v1";
  readonly declaredStage: "PD" | "RD" | "UNRESOLVED";
  readonly selectedRole: "PD" | "RD";
  readonly roleQualification: "UNVERIFIED";
  readonly pageCount: number;
  readonly scannedNativeLineCount: number;
}
export interface NativeAirflowEvidenceLine {
  readonly sourceFileId: string;
  readonly sourceSha256: string;
  readonly textArtifactContentHash: string;
  readonly inputRole: "PD" | "RD";
  readonly evidenceKind: "NATIVE";
  readonly physicalPage: number;
  readonly pageWidthMilliPoints: number;
  readonly pageHeightMilliPoints: number;
  readonly nativeFrame: { readonly coordinateSystem: "PDFMINER_LAYOUT_POINTS";
    readonly visibleBoxPointStrings: readonly [string, string, string, string] };
  readonly sourcePath: readonly number[];
  readonly rawText: string;
  readonly nativeBoxPointStrings: readonly [string, string, string, string];
  readonly bboxMilliPoints: readonly [number, number, number, number];
  readonly coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS";
  readonly renderedVisibility: "UNVERIFIED";
}
export interface NativeAirflowQuote extends NativeAirflowEvidenceLine {
  readonly systemId: string;
  readonly rawValue: string;
  readonly value: string;
  readonly unit: "м³/ч";
  readonly rawUnit: "м3/ч";
  readonly freePressurePa: string;
  readonly rawPressureUnit: "Па";
  readonly matchedRangeCodePoints: readonly [number, number];
  readonly extractionMethod: "NATIVE_SINGLE_LINE_SYSTEM_AIRFLOW";
}
export interface NativeAirflowReference extends NativeAirflowEvidenceLine {
  readonly systemIds: readonly string[];
  readonly reason: "SELECTED_SYSTEM_REFERENCE_WITHOUT_AIRFLOW";
}
export interface NativeAirflowMemberValue {
  readonly systemId: string;
  readonly value: string;
  readonly unit: "м³/ч";
  readonly freePressurePa: string;
  readonly quoteCount: number;
}
interface NativeAirflowBase {
  readonly schemaVersion: "native-airflow-comparison-v1";
  readonly policyVersion: "native-selected-system-airflow-v1";
  readonly purpose: "SOURCE_ONLY";
  readonly associatedParameterCode: "IOS4-079";
  readonly parameterMappingStatus: "PUBLIC_MAPPING_CONFLICT";
  readonly attribute: "SELECTED_SYSTEM_DECLARED_VOLUMETRIC_FLOW";
  readonly p: null;
  readonly calibratedProbability: null;
  readonly factEligible: false;
  readonly coverageDelta: 0;
  readonly engineeringQualification: false;
  readonly completeConfiguration: false;
  readonly notices: readonly string[];
  readonly contentHash: string;
}
export type NativeAirflowComparison = NativeAirflowBase & ({
  readonly status: "COMPARED";
  readonly selection: NativeAirflowSelection;
  readonly comparison: "EQUAL" | "DECREASE" | "INCREASE";
  readonly pdValue: string;
  readonly rdValue: string;
  readonly deltaRdMinusPd: string;
  readonly unit: "м³/ч";
  readonly memberValues: { readonly PD: NativeAirflowMemberValue; readonly RD: readonly NativeAirflowMemberValue[] };
  readonly sources: { readonly PD: NativeAirflowProvenance; readonly RD: NativeAirflowProvenance };
  readonly quotes: { readonly PD: readonly NativeAirflowQuote[]; readonly RD: readonly NativeAirflowQuote[] };
  readonly references: { readonly PD: readonly NativeAirflowReference[]; readonly RD: readonly NativeAirflowReference[] };
} | {
  readonly status: "ABSTAIN";
  readonly reasonCode: NativeAirflowAbstainReason;
});
