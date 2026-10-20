import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(([x0, y0, x1, y1]) => 0 <= x0 && x0 < x1 && x1 <= 1 && 0 <= y0 && y0 < y1 && y1 <= 1);
export const inspectorEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  sourceFileId: z.string().trim().min(1).max(200), sourceSha256: hash,
  stage: z.enum(["PD", "RD", "ID"]), pageNumber: z.number().int().min(1).max(10000),
  sheet: z.string().trim().max(120).nullable(), revision: z.string().trim().max(120).nullable(),
  bbox: bbox.nullable(), value: z.string().trim().max(1000),
  unit: z.string().trim().max(80).nullable(), element: z.string().trim().min(1).max(300),
}).strict();
export const inspectorReviewDetailsSchema = z.object({
  entity: z.string().trim().min(1).max(300),
  sameElementConfirmed: z.boolean(),
  comparisonPair: z.enum(["PD_RD", "PD_ID", "RD_ID", "PD_RD_ID"]),
  sources: z.array(inspectorEvidenceSchema).min(1).max(12),
  rule: z.object({ kind: z.enum(["EXACT", "ABSOLUTE", "PERCENT"]),
    tolerance: z.number().finite().min(0).max(1e12),
    basis: z.string().trim().min(8).max(1000), condition: z.string().trim().min(5).max(1000),
  }).strict().nullable(),
  clarification: z.string().trim().max(2000),
  parts: z.array(z.object({ id: z.string().trim().min(1).max(80),
    description: z.string().trim().min(3).max(300),
    decision: z.enum(["CONFIRM", "REJECT", "CLARIFY"]),
    note: z.string().trim().min(8).max(1000),
    evidenceIds: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  }).strict()).max(24),
}).strict().refine(v => new Set(v.sources.map(s => s.id)).size === v.sources.length
  && new Set(v.parts.map(p => p.id)).size === v.parts.length
  && v.parts.every(p => new Set(p.evidenceIds).size === p.evidenceIds.length
    && p.evidenceIds.every(id => v.sources.some(s => s.id === id))));
export type InspectorEvidence = z.infer<typeof inspectorEvidenceSchema>;
export type InspectorReviewDetails = z.infer<typeof inspectorReviewDetailsSchema>;
export const candidateReviewActions = ["ACCEPT_FOR_REVIEW", "REJECT", "CONFIRM", "CLARIFY", "PARTIAL_CONFIRM", "CORRECT_EVIDENCE"] as const;
export type CandidateReviewAction = typeof candidateReviewActions[number];
export interface CandidateReviewEvent {
  inheritedFrom?: { decisionId: string; checkId: string; decisionHash: string; createdAt: string };
  schemaVersion: "review-candidate-decision-v1";
  candidateId: string; artifactHash: string; decision: CandidateReviewAction; note: string;
  details?: InspectorReviewDetails;
  expectedDecisionHash?: string | null;
  id: string; checkId: string; actorId: string; decisionHash: string; createdAt: string;
}

/** No inferred probability. Numeric delta uses exact numeric strings and equal units. */
export function compareInspectorEvidence(sources: InspectorEvidence[], rule: InspectorReviewDetails["rule"]) {
  if (sources.some(source => !source.value.trim())) return { status: "MISSING_VALUE" as const, delta: null };
  if (sources.length < 2) return { status: "MISSING_DOCUMENT" as const, delta: null };
  if (new Set(sources.map(s => s.stage)).size !== sources.length
    || new Set(sources.map(s => s.element)).size !== 1 || new Set(sources.map(s => s.unit ?? "")).size !== 1)
    return { status: "NOT_COMPARABLE" as const, delta: null };
  if (!rule) return { status: "RULE_REQUIRED" as const, delta: null };
  if (rule.kind === "EXACT") return { status: sources.every(s => s.value === sources[0].value)
    ? "NO_DIFFERENCE" as const : "DIFFERENCE" as const, delta: null };
  const parse = (v: string) => /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(v) ? Number(v.replace(",", ".")) : NaN;
  const values = sources.map(s => parse(s.value));
  if (values.some(v => !Number.isFinite(v)) || (rule.kind === "PERCENT" && values[0] === 0))
    return { status: "NOT_COMPARABLE" as const, delta: null };
  const delta = Math.max(...values.slice(1).map(v => Math.abs(v - values[0])))
    * (rule.kind === "PERCENT" ? 100 / Math.abs(values[0]) : 1);
  if (!Number.isFinite(delta)) return { status: "NOT_COMPARABLE" as const, delta: null };
  return { status: delta > rule.tolerance ? "DIFFERENCE" as const : "NO_DIFFERENCE" as const, delta };
}
