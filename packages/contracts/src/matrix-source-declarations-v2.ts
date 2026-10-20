import type { MatrixSourceDeclarations, MatrixSteelSourceDeclaration, SourceDeclarationFragment } from "./matrix-source-declarations.js";

/** Literal project-authored tabulated fire-resistance value, with no physical member or achieved-resistance claim. */
export interface MatrixFireResistanceSourceDeclaration {
  schemaVersion: "matrix-source-declaration-v1";
  id: string;
  kind: "SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION";
  extractorVersion: "matrix-fire-resistance-table-v1";
  sourceFileId: string;
  sourceSha256: string;
  textArtifactHash: string;
  stage: "PD" | "RD";
  pageNumber: number;
  widthMilliPoints: number;
  heightMilliPoints: number;
  criterion: "R" | "REI";
  minutes: number;
  rawValue: string;
  rawUnit: "мин";
  canonicalUnit: "min";
  constructionLabelLines: string[];
  entityKey: null;
  applicabilityStatus: "UNREVIEWED";
  primaryFragments: SourceDeclarationFragment[];
  scopeFragments: SourceDeclarationFragment[];
  headerFragments: SourceDeclarationFragment[];
  unitFragments: SourceDeclarationFragment[];
  bindingPolicyVersion: "matrix-fire-resistance-upper-table-v1";
  tableBoxMilliPoints: [number, number, number, number];
}
export type MatrixSourceDeclarationV2 = MatrixSteelSourceDeclaration | MatrixFireResistanceSourceDeclaration;
/** Profile v4 evidence sibling. Frozen profile v3 continues to use the v1 envelope. */
export interface MatrixSourceDeclarationsV2 {
  schemaVersion: "matrix-source-declarations-v2";
  objectId: string;
  inputManifestHash: string;
  extractorVersion: "matrix-source-declarations-v2";
  purpose: "EVIDENCE_ONLY";
  declarations: MatrixSourceDeclarationV2[];
}
export type MatrixSourceDeclarationsRead = MatrixSourceDeclarations | MatrixSourceDeclarationsV2;
