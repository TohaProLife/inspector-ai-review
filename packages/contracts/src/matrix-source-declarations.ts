/** Source-authored material evidence; never an executable fact, comparison or review target. */
export interface SourceDeclarationFragment {
  pageNumber: number;
  blockIndex: number;
  lineIndex: number;
  rawText: string;
  bboxMilliPoints: [number, number, number, number];
}
export type SteelSourceProductScope = {
  role: "DISTRIBUTION_BELT_I_BEAMS";
  productKind: "I_BEAM";
  profile: "70Б3";
  count: 3;
  tier: 2;
  productStandard: "ГОСТ Р 35087-2024";
  gradeStandard: "ГОСТ 27772-2015";
} | {
  role: "I_BEAM_GENERIC_DECLARATION";
  productKind: "I_BEAM";
  profile: null;
  count: null;
  tier: null;
  productStandard: "ГОСТ Р 57837-2017";
  gradeStandard: "ГОСТ 27772-2021";
};
export interface MatrixSteelSourceDeclaration {
  schemaVersion: "matrix-source-declaration-v1";
  id: string;
  kind: "SOURCE_AUTHORED_STEEL_DECLARATION";
  extractorVersion: "matrix-steel-prose-v1";
  sourceFileId: string;
  sourceSha256: string;
  textArtifactHash: string;
  stage: "PD" | "RD";
  pageNumber: number;
  widthMilliPoints: number;
  heightMilliPoints: number;
  value: "С245" | "С345";
  rawValue: "C245" | "С245" | "C345" | "С345";
  rawUnit: null;
  canonicalUnit: "steel_catalog_example";
  entityKey: null;
  applicabilityStatus: "UNREVIEWED";
  primaryFragments: SourceDeclarationFragment[];
  scopeFragments: SourceDeclarationFragment[];
  productScope: SteelSourceProductScope;
}
/** Immutable sibling of execution; declarations do not contribute to coverage. */
export interface MatrixSourceDeclarations {
  schemaVersion: "matrix-source-declarations-v1";
  objectId: string;
  inputManifestHash: string;
  extractorVersion: "matrix-source-declarations-v1";
  purpose: "EVIDENCE_ONLY";
  declarations: MatrixSteelSourceDeclaration[];
}
