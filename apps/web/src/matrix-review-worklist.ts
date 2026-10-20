import type { MatrixAtomicResult, MatrixExecutionRead, MatrixObservation, SourceFileSummary } from "@inspector-ai/contracts";
import registry from "../../../services/worker/rules/matrix-execution-v1.json";

export type MatrixReviewStage = "PD" | "RD" | "ID";
export interface MatrixReviewWorkRule {
  ruleId: string;
  version: string;
  parameterCode: string;
  parameterName: string;
  attribute: string;
  canonicalUnit: string;
  requiredContext: string[];
  comparisonVariants: string[];
}
export interface MatrixReviewWorkGroup {
  stage: MatrixReviewStage;
  kind: "REFERENCED_FACT" | "MATCHING_FACTS" | "MISSING_FACT" | "INVALID_REFERENCE";
  facts: MatrixObservation[];
}
export interface MatrixReviewWorkItem {
  key: string;
  resultIndex: number;
  result: MatrixAtomicResult;
  rule: MatrixReviewWorkRule | null;
  groups: MatrixReviewWorkGroup[];
  invalidRule: boolean;
}
const hash = /^[a-f0-9]{64}$/u;
const stages = new Set<string>(["PD", "RD", "ID"]);
const rules = registry.entries.flatMap(entry => entry.atomicRules.filter(rule => rule.enabled)
  .map(rule => ({ ...rule, parameterCode: entry.parameterCode, parameterName: entry.name })));

/** A file ID alone cannot authorize navigation to a different revision's PDF. */
export function matrixReviewFactSource(fact: MatrixObservation, files: SourceFileSummary[]): SourceFileSummary | undefined {
  const matches = files.filter(file => file.id === fact.sourceFileId);
  return matches.length === 1 && hash.test(fact.sourceSha256) && matches[0].sha256 === fact.sourceSha256
    ? matches[0] : undefined;
}

function validLocator(fact: MatrixObservation): boolean {
  const box = fact.bbox;
  return hash.test(fact.id) && hash.test(fact.sourceSha256) && typeof fact.sourceFileId === "string"
    && fact.sourceFileId.length > 0 && fact.sourceFileId.length <= 200 && fact.method === "TEXT_LAYER"
    && Number.isSafeInteger(fact.pageNumber) && fact.pageNumber > 0 && /^\d+:\d+$/u.test(fact.blockId)
    && !!box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
    && box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001;
}

/** Frozen abstentions become navigation work, never a new comparison or a selected pair. */
export function buildMatrixReviewWorklist(data: MatrixExecutionRead, _files: SourceFileSummary[]): MatrixReviewWorkItem[] {
  const counts = new Map<string, number>();
  for (const fact of data.execution.observations) counts.set(fact.id, (counts.get(fact.id) ?? 0) + 1);
  const facts = data.execution.observations.filter(fact => counts.get(fact.id) === 1 && validLocator(fact));
  return data.execution.results.flatMap((result, resultIndex) => {
    if (result.executionStatus === "FAILED" || !["MISSING_EVIDENCE", "NOT_COMPARABLE", "CLARIFICATION_REQUIRED"].includes(result.machineStatus)) return [];
    const matches = rules.filter(rule => rule.ruleId === result.ruleId && rule.version === result.ruleVersion
      && rule.parameterCode === result.parameterCode && rule.comparisonVariants.includes(result.comparisonVariant));
    const rule: MatrixReviewWorkRule | null = matches.length === 1 ? matches[0] : null;
    const requiredStages = result.comparisonVariant.split("_");
    const validStages = requiredStages.length === 2 && requiredStages.every(stage => stages.has(stage));
    const invalidRule = !rule || !validStages;
    const groups: MatrixReviewWorkGroup[] = invalidRule ? [] : requiredStages.map((stage, side) => {
      const matching = facts.filter(fact => fact.stage === stage && fact.attribute === rule.attribute
        && fact.unit === rule.canonicalUnit && Array.isArray(fact.parameterCodes)
        && fact.parameterCodes.includes(rule.parameterCode));
      const reference = side === 0 ? result.expectedObservationId : result.actualObservationId;
      if (reference !== null) {
        const referenced = matching.filter(fact => fact.id === reference);
        return { stage: stage as MatrixReviewStage, kind: referenced.length === 1 ? "REFERENCED_FACT" : "INVALID_REFERENCE",
          facts: referenced.length === 1 ? referenced : [] };
      }
      return { stage: stage as MatrixReviewStage, kind: matching.length ? "MATCHING_FACTS" : "MISSING_FACT", facts: matching };
    });
    return [{ key: JSON.stringify([data.checkId, data.contentHash, resultIndex, result.ruleId, result.comparisonVariant]),
      resultIndex, result, rule, groups, invalidRule }];
  });
}

export type MatrixReviewAvailability = "BOTH_STAGES" | "ONE_STAGE" | "NO_FACTS" | "INVALID";
export interface MatrixReviewWorkView { filter: Exclude<MatrixReviewAvailability, "INVALID"> | "ALL"; factsFirst: boolean }

/** Counts frozen source material, without asserting authority, scope or comparison readiness. */
export function matrixReviewAvailability(item: MatrixReviewWorkItem): MatrixReviewAvailability {
  if (item.invalidRule || item.groups.length !== 2 || new Set(item.groups.map(group => group.stage)).size !== 2
    || item.groups.some(group => group.kind === "INVALID_REFERENCE")) return "INVALID";
  const count = item.groups.filter(group => group.facts.length > 0).length;
  return count === 2 ? "BOTH_STAGES" : count === 1 ? "ONE_STAGE" : "NO_FACTS";
}

/** Invalid references remain visible even when ordinary availability filters are selected. */
export function selectMatrixReviewWork(items: MatrixReviewWorkItem[], view: MatrixReviewWorkView): MatrixReviewWorkItem[] {
  const selected = items.filter(item => {
    const availability = matrixReviewAvailability(item);
    return availability === "INVALID" || view.filter === "ALL" || availability === view.filter;
  });
  if (!view.factsFirst) return selected;
  const rank: Record<MatrixReviewAvailability, number> = { BOTH_STAGES: 0, ONE_STAGE: 1, NO_FACTS: 2, INVALID: 3 };
  return selected.sort((left, right) => rank[matrixReviewAvailability(left)] - rank[matrixReviewAvailability(right)]
    || left.resultIndex - right.resultIndex);
}

/** Explicit file navigation only: duplicate IDs are ambiguous even when their hashes agree. */
export function matrixReviewSourceChoices(files: SourceFileSummary[]): SourceFileSummary[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file.id, (counts.get(file.id) ?? 0) + 1);
  return files.filter(file => counts.get(file.id) === 1 && typeof file.id === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(file.id)
    && typeof file.sha256 === "string" && hash.test(file.sha256));
}
