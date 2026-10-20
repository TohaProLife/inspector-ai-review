// Derived by output/matrix-t70-20261018/ts-generate-types.py; canonical schema owns shape.
// Schema SHA-256: 8d9c58cf83e4cb3785ef0112ebc757fae804b53386b35073238a442f38953e1a
import type { SourceDeclarationFragment } from "./matrix-source-declarations.js";
import type { SteelComparisonSource, SteelComparisonOrigin, SteelComparisonApplicabilityDecision, SteelComparisonIdentity, SteelComparisonResult, SteelComparisonTarget } from "./matrix-steel-comparison.js";

export type SteelComparisonExecutionLoaderPackage = { "schemaVersion": "matrix-kr056-steel-loader-inputs-v1"; "objectId": string; "inputManifestHash": string; "sources": Array<SteelComparisonSource>; "origins": Array<SteelComparisonOrigin>; "applicabilityDecisions": Array<SteelComparisonApplicabilityDecision>; "identities": Array<SteelComparisonIdentity> };

export type SteelComparisonExecutionResult = ({ "schemaVersion": "matrix-steel-execution-result-v1"; "id": string; "ruleId": "matrix-kr-056-reviewed_steel_catalog_transition"; "ruleVersion": "1"; "parameterCode": "KR-056"; "comparisonVariant": "PD_RD"; "kind": "SCOPED_COMPARISON"; "identity": SteelComparisonIdentity; "comparison": SteelComparisonResult } | { "schemaVersion": "matrix-steel-execution-result-v1"; "id": string; "ruleId": "matrix-kr-056-reviewed_steel_catalog_transition"; "ruleVersion": "1"; "parameterCode": "KR-056"; "comparisonVariant": "PD_RD"; "kind": "UNBOUND_ATOM_ABSTENTION"; "reasonCode": "REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING"; "calibratedProbability": null });

export type SteelComparisonExecutionComparisons = { "schemaVersion": "matrix-steel-comparisons-v1"; "purpose": "MACHINE_COMPARISON"; "objectId": string; "inputManifestHash": string; "capabilityRegistryHash": string; "results": Array<SteelComparisonExecutionResult> };

export type SteelComparisonExecutionEvidence = { "resultId": string; "role": "EXPECTED" | "ACTUAL"; "sourceFileId": string; "sourceSha256": string; "reviewDecisionId": string; "reviewContentHash": string; "target": SteelComparisonTarget; "applicabilityDecisionId": string; "applicabilityDecisionContentHash": string; "pageNumber": number; "pageFrame": { "widthMilliPoints": number; "heightMilliPoints": number }; "fragmentRole": "PRIMARY" | "DECLARATION_SCOPE" | "PHYSICAL_MEMBER_SCOPE" | "APPLICABILITY_BASIS"; "fragment": SourceDeclarationFragment };

export type SteelComparisonExecutionCoverageRow = { "parameterCode": string; "implementedAtomicRules": number; "enabledAtomicRules": number; "evaluatedAtomicRules": number; "successfulComparisons": number; "abstentions": number; "failures": number; "executionStatus": "UNSUPPORTED" | "PARTIAL" | "EVALUATED" | "TECHNICAL_FAILURE"; "reason": string };
