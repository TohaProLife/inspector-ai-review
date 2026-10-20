import { z } from "zod";
import { matrixFactScopeSchema } from "./matrix-fact-scope.js";

/** Human source-scope judgment. Server adds provenance and manifest binding. */
export const legacyMatrixSourceScopeSchema = z.object({
  entityKey: z.string().trim().min(1).max(200),
  reference: z.string().trim().min(8).max(1000),
  contexts: z.record(z.string().max(180).regex(/^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_-]+)?$/u), z.object({
    reference: z.string().trim().min(8).max(1000),
    drawingSection: z.string().max(40).optional(),
    applicable: z.boolean().optional(),
    parameterCode: z.string().max(40).optional(),
    attribute: z.string().max(100).optional(),
    threshold: z.string().max(60).optional(),
    canonicalUnit: z.string().max(40).optional(),
    limitValue: z.string().regex(/^\d+(?:\.\d+)?$/u).max(60).optional(),
    approvedChangePresent: z.boolean().optional(),
    reductionConfirmed: z.boolean().optional(),
    componentRole: z.string().trim().min(1).max(100).optional(),
    componentKey: z.string().trim().min(1).max(200).optional(),
    zoneKey: z.string().trim().min(1).max(200).optional(),
    operatingModeKey: z.string().trim().min(1).max(200).optional(),
    measurementBasisKey: z.string().trim().min(1).max(200).optional(),
  }).strict()).refine(value => Object.keys(value).length <= 100),
}).strict();
export type LegacyMatrixSourceScope = z.infer<typeof legacyMatrixSourceScopeSchema>;
export const matrixSourceScopeSchema = z.union([legacyMatrixSourceScopeSchema,matrixFactScopeSchema]);
export type MatrixSourceScope = z.infer<typeof matrixSourceScopeSchema>;

export function bindMatrixSourceScope(scope: MatrixSourceScope | null | undefined, binding: {
  sourceFileId: string; sourceSha256: string; objectId: string; inputManifestHash: string;
  reviewContentHash?: string;
}): Record<string, Record<string, unknown>> {
  if (!scope) return {};
  if ("schemaVersion" in scope) return { FACT_BINDINGS: { ...scope,...binding,status:"VERIFIED",
    reference:"Authenticated fact bindings; original evidence reviewed" } };
  // The additional authority provenance is available only to per-fact bindings.
  const { reviewContentHash: _reviewHash, ...sourceBinding } = binding;
  const base = { ...sourceBinding, entityKey: scope.entityKey, status: "VERIFIED" };
  return { ...Object.fromEntries(Object.entries(scope.contexts).map(([key, details]) =>
    [key, { ...details, ...base }])), ENTITY_SCOPE: { ...base, reference: scope.reference } };
}
