import { inspectorReviewDetailsSchema, compareInspectorEvidence, type CandidateReviewEvent } from "@inspector-ai/contracts";
export function validateInspectorReview(input: Pick<CandidateReviewEvent, "decision" | "details" | "expectedDecisionHash">): string | null {
  if (input.details !== undefined && !inspectorReviewDetailsSchema.safeParse(input.details).success) return "Некорректное доказательство";
  if (!["ACCEPT_FOR_REVIEW", "REJECT"].includes(input.decision) && (!input.details || !Object.hasOwn(input, "expectedDecisionHash")))
    return "Нужны доказательства и версия предыдущего решения";
  const details = input.details;
  if (!details) return null;
  const stages = details.comparisonPair.split("_");
  if (input.decision === "CONFIRM") {
    const sources = details.sources.filter(s => stages.includes(s.stage));
    if (!details.sameElementConfirmed || sources.some(s => s.element !== details.entity)
      || sources.length !== stages.length || stages.some(stage => !sources.some(s => s.stage === stage))
      || sources.some(s => s.bbox === null) || details.parts.length > 0
      || compareInspectorEvidence(sources, details.rule).status !== "DIFFERENCE")
      return "Подтверждение требует один элемент, сопоставимые стадии, рамки и проверяемое правило расхождения";
  }
  if (input.decision === "CLARIFY" && details.clarification.length < 8) return "Укажите недостающий документ или неверный источник";
  if (input.decision === "PARTIAL_CONFIRM") {
    if (!details.sameElementConfirmed || details.parts.length < 2
      || !details.parts.some(p => p.decision === "CONFIRM") || details.parts.every(p => p.decision === "CONFIRM"))
      return "Частичное решение требует минимум две части с разными исходами";
    for (const part of details.parts.filter(p => p.decision === "CONFIRM")) {
      const sources = details.sources.filter(s => part.evidenceIds.includes(s.id));
      if (sources.length !== stages.length || stages.some(stage => !sources.some(s => s.stage === stage))
        || sources.some(s => s.element !== details.entity) || sources.some(s => s.bbox === null) || compareInspectorEvidence(sources, details.rule).status !== "DIFFERENCE")
        return "Недостаточно доказательств для подтверждённой части";
    }
  }
  return null;
}
