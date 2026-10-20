import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.string().trim().min(8).max(1000);

export const matrixFactScopeTargetSchema = z.object({
  checkId: z.string().trim().min(1).max(120),
  executionContentHash: hash,
  observationId: hash,
  evidenceHash: hash,
  textArtifactHash: hash,
}).strict();

/** Explicit inspector classification of the original PD evidence, never a parsed title. */
export const matrixProjectZeroAuthoritySchema = z.object({
  kind: z.literal("APPROVED_PD_GEODETIC_BASIS"),
  sourceFileId: z.string().trim().min(1).max(200),
  sourceSha256: hash,
  pageNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  target: matrixFactScopeTargetSchema,
  // PD declares its own authority without a circular self-hash. RD cites the saved PD review.
  reviewContentHash: hash.optional(),
}).strict();

/** Human details only. The server adds source, manifest, actor and decision provenance. */
export const matrixFactScopeContextSchema = z.object({
  reference,
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
  projectZeroAuthority: matrixProjectZeroAuthoritySchema.optional(),
}).strict();

const contextKey = z.string().max(180).regex(/^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_-]+)?$/u)
  .refine(key => !/^(?:RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)(?::|$)/u.test(key),
    "Completeness judgments are unavailable in this fact-scope version");

export const matrixFactScopeBindingSchema = z.object({
  ruleId: z.string().trim().min(1).max(180),
  ruleVersion: z.string().trim().min(1).max(40),
  parameterCode: z.string().trim().min(1).max(40),
  entityKey: z.string().trim().min(1).max(200),
  reference,
  target: matrixFactScopeTargetSchema,
  contexts: z.record(contextKey, matrixFactScopeContextSchema)
    .refine(value => Object.keys(value).length <= 100, "At most 100 contexts are allowed"),
  tableContextReview: z.object({ fragmentsHash: hash, reference }).strict().optional(),
}).strict();

/** Per-fact review replaces whole-file entity inference; it never changes machine output. */
export const matrixFactScopeSchema = z.object({
  schemaVersion: z.literal("matrix-fact-scopes-v1"),
  // An empty list explicitly removes bindings; callers must not fall back to whole-file scope.
  bindings: z.array(matrixFactScopeBindingSchema).max(500),
}).strict().superRefine((scope, context) => {
  const rulesByObservation = new Set<string>();
  const entityByObservation = new Map<string, string>();
  for (const [index, binding] of scope.bindings.entries()) {
    for (const [key, details] of Object.entries(binding.contexts)) {
      if (details.projectZeroAuthority && (key !== "PROJECT_ZERO_GEODETIC_AUTHORITY"
        || binding.ruleId !== "matrix-pz-009-declared_project_zero_absolute_elevation"
        || binding.parameterCode !== "PZ-009" || binding.ruleVersion !== "1")) {
        context.addIssue({ code: "custom", path: ["bindings", index, "contexts", key, "projectZeroAuthority"],
          message: "Project zero authority belongs only to its declared atomic rule" });
      }
    }
    const observationId = binding.target.observationId;
    const ruleKey = JSON.stringify([observationId, binding.ruleId]);
    if (rulesByObservation.has(ruleKey)) context.addIssue({ code: "custom",
      path: ["bindings", index, "target", "observationId"],
      message: "An observation may be bound only once per rule" });
    rulesByObservation.add(ruleKey);
    const previousEntity = entityByObservation.get(observationId);
    if (previousEntity !== undefined && previousEntity !== binding.entityKey) context.addIssue({ code: "custom",
      path: ["bindings", index, "entityKey"],
      message: "One observation cannot identify different entities" });
    entityByObservation.set(observationId, binding.entityKey);
  }
});

export type MatrixFactScopeContext = z.infer<typeof matrixFactScopeContextSchema>;
export type MatrixProjectZeroAuthority = z.infer<typeof matrixProjectZeroAuthoritySchema>;
export type MatrixFactScopeTarget = z.infer<typeof matrixFactScopeTargetSchema>;
export type MatrixFactScopeBinding = z.infer<typeof matrixFactScopeBindingSchema>;
export type MatrixFactScope = z.infer<typeof matrixFactScopeSchema>;

export interface MatrixFactTargetsRead {
  checkId:string;
  executionContentHash:string;
  items:Array<{sourceFileId:string;target:MatrixFactScopeTarget;fragmentsHash?:string}>;
}
