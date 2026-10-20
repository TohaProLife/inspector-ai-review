/** Typed source-local human inventory review; no machine completeness or scalar fact authority. */
import { z } from "zod";

export const INVENTORY_REVIEW_VERSION = "matrix-inventory-review-v1";
export const INVENTORY_REVIEW_LIMITS = Object.freeze({ claims: 16, requestBytes: 524288,
  materializedBytes: 8000000, depth: 64, nodes: 200000, containerItems: 32768, lineCodepoints: 8192 });
type Box = [number, number, number, number];
const sha = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const positive = integer.positive();
const nonnegative = integer.nonnegative();
const pyStrip = (s: string) => s.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, "");
const scalar = (s: string) => { for (const c of s) { const n = c.codePointAt(0)!;
  if (n >= 0xd800 && n <= 0xdfff) return false; } return true; };
const sourceLine = (s: string) => scalar(s) && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(s);
const key = (max: number) => z.string().refine(s => scalar(s) && sourceLine(s)
  && pyStrip(s) === s && [...s].length >= 1 && [...s].length <= max, "Invalid identity string");
const reference = z.string().refine(s => scalar(s) && pyStrip(s) === s
  && [...s].length >= 8 && [...s].length <= 1000, "Reference must have 8..1000 unchanged Unicode codepoints");
const line = z.string().refine(s => sourceLine(s) && !!pyStrip(s)
  && [...s].length <= INVENTORY_REVIEW_LIMITS.lineCodepoints, "Original full source line required");
const box = z.tuple([nonnegative, nonnegative, nonnegative, nonnegative])
  .refine(b => b[0] < b[2] && b[1] < b[3], "Positive area required");
const fragment = z.object({ pageNumber: positive, blockIndex: nonnegative,
  lineIndex: nonnegative, rawText: line, bboxMilliPoints: box }).strict();
const oneFragment = z.array(fragment).length(1);
const target = z.object({ checkId: key(120), inputManifestHash: sha,
  textStageContentHash: sha, textArtifactHash: sha, inventoryContentHash: sha }).strict();
const selection = z.object({ pageNumber: positive, regionBoxMilliPoints: box,
  headerFragments: oneFragment, scopeFragments: oneFragment }).strict().superRefine((s, ctx) => {
  for (const f of [...s.headerFragments, ...s.scopeFragments]) {
    if (f.pageNumber !== s.pageNumber || !contains(s.regionBoxMilliPoints, f.bboxMilliPoints))
      ctx.addIssue({ code: "custom", message: "Selection fragment outside selected page/region" });
  }
});
const claimFields = { target, selection, entityKey: key(200),
  componentRole: z.literal("PARTITION_SLAB_JOINT"), componentKey: key(200), zoneKey: key(200),
  operatingModeKey: z.literal("DECLARED_NOISE_PROTECTION_MEASURES"),
  measurementBasisKey: z.literal("SOURCE_AUTHORED_MEASURE_MEMBERSHIP"),
  assertion: z.enum(["UNKNOWN", "HUMAN_ASSERTED_COMPLETE"]), reference };
const claimInput = z.object(claimFields).strict();

const sourceInventory = z.object({ schemaVersion: z.literal("matrix-inventory-source-v1"),
  extractorVersion: z.literal("matrix-ar053-inventory-source-v1"),
  policyVersion: z.literal("matrix-ar053-inventory-literals-v1"),
  sourceFileId: key(200), sourceSha256: sha, textArtifactHash: sha, stage: z.enum(["PD", "RD"]),
  pageNumber: positive, widthMilliPoints: positive, heightMilliPoints: positive,
  regionBoxMilliPoints: box, headerFragments: oneFragment, scopeFragments: oneFragment,
  featureRows: z.array(z.object({ featureKey: z.enum(["DAMPING_TAPE", "ACOUSTIC_GASKET"]),
    fragments: oneFragment }).strict()).max(64),
  unresolvedRows: z.array(z.object({ reasonCode: z.enum(["UNSUPPORTED_ROW", "DUPLICATE_FEATURE"]),
    fragments: oneFragment }).strict()).max(128),
}).strict().superRefine((s, ctx) => {
  const frame: Box = [0, 0, s.widthMilliPoints, s.heightMilliPoints];
  if (!contains(frame, s.regionBoxMilliPoints)) ctx.addIssue({ code: "custom", message: "Region outside original frame" });
  const fragments = [...s.headerFragments, ...s.scopeFragments,
    ...s.featureRows.flatMap(row => row.fragments), ...s.unresolvedRows.flatMap(row => row.fragments)];
  for (const f of fragments) if (f.pageNumber !== s.pageNumber || !contains(s.regionBoxMilliPoints, f.bboxMilliPoints))
    ctx.addIssue({ code: "custom", message: "Snapshot fragment outside original page/region" });
});
const claimDecision = z.object({ ...claimFields, inventorySnapshot: sourceInventory }).strict();
const scopeInput = z.object({ schemaVersion: z.literal(INVENTORY_REVIEW_VERSION),
  claims: z.array(claimInput).max(INVENTORY_REVIEW_LIMITS.claims) }).strict();
const scopeDecision = z.object({ schemaVersion: z.literal(INVENTORY_REVIEW_VERSION),
  claims: z.array(claimDecision).max(INVENTORY_REVIEW_LIMITS.claims) }).strict();

export type MatrixInventoryFragment = z.infer<typeof fragment>;
export type MatrixInventorySelection = z.infer<typeof selection>;
export type MatrixInventoryTarget = z.infer<typeof target>;
export type MatrixSourceInventory = z.infer<typeof sourceInventory>;
export type MatrixInventoryReviewClaimInput = z.infer<typeof claimInput>;
export type MatrixInventoryReviewClaimDecision = z.infer<typeof claimDecision>;
export type MatrixInventoryScopeInput = z.infer<typeof scopeInput>;
export type MatrixInventoryScopeDecision = z.infer<typeof scopeDecision>;

function contains(outer: Box, inner: Box): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export const matrixInventoryScopeInputSchema = scopeInput;
export const matrixInventoryScopeDecisionSchema = scopeDecision;
export const matrixInventorySelectionSchema = selection;
export const matrixSourceInventorySchema = sourceInventory;

/** All whole-review editors must preserve the loaded sibling via this projection.
 * A request never echoes the server snapshot: server reauthenticates/reconstructs.
 */
export function inventoryScopeDecisionToInput(scope: MatrixInventoryScopeDecision): MatrixInventoryScopeInput {
  const saved = scopeDecision.parse(scope);
  return scopeInput.parse({ schemaVersion: saved.schemaVersion, claims: saved.claims.map(
    ({ inventorySnapshot: _serverSnapshot, ...claim }) => claim) });
}

export interface MatrixInventorySourcePagesRead {
  checkId:string;sourceFileId:string;sourceSha256:string;inputManifestHash:string;textStageContentHash:string;
  textArtifactHash:string;stage:"PD"|"RD"|"UNRESOLVED";pageStages:Record<string,"PD"|"RD"|"ID"|"UNRESOLVED">;
  latestReviewHash:string|null;textArtifact:Record<string,unknown>;
}
export interface MatrixInventoryPreviewRead {
  checkId:string;sourceFileId:string;sourceSha256:string;
  result:{schemaVersion:"matrix-inventory-source-result-v1";status:"RECONSTRUCTED";inventory:MatrixSourceInventory}
    |{schemaVersion:"matrix-inventory-source-result-v1";status:"ABSTAIN";reasonCode:string};
  target?:MatrixInventoryTarget;
}
