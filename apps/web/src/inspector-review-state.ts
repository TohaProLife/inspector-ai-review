import { compareInspectorEvidence, type InspectorReviewDetails, type SourceFileSummary } from "@inspector-ai/contracts";
import type { ReviewCandidatesRead, ReviewCandidateDecisionRead } from "./api";
export type ReviewCandidate = ReviewCandidatesRead["candidates"][number];
export function candidateBox(candidate: ReviewCandidate): [number, number, number, number] | null {
  const [x0, y0, x1, y1] = candidate.locator.bboxMilliPoints;
  const width = candidate.pageWidthMilliPoints, height = candidate.pageHeightMilliPoints;
  if (![x0, y0, x1, y1, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const clamp = (v: number) => Number(Math.max(0, Math.min(1, v)).toFixed(6));
  const b: [number, number, number, number] = [clamp(x0 / width), clamp(1 - y1 / height), clamp(x1 / width), clamp(1 - y0 / height)];
  return b[0] < b[2] && b[1] < b[3] ? b : null;
}
export function initialReview(candidate: ReviewCandidate, files: SourceFileSummary[]): InspectorReviewDetails {
  const sources: InspectorReviewDetails["sources"] = [];
  const refs = [{ ...candidate, bbox: candidateBox(candidate) }, ...candidate.relatedDocuments.map(r => ({ ...r, bbox: null }))];
  for (const ref of refs) {
    const file = files.find(f => f.id === ref.sourceFileId);
    const stage = ref.sourceFileId === candidate.sourceFileId && candidate.stage ? candidate.stage
      : file?.stages.length === 1 ? file.stages[0] : null;
    if (!stage || sources.some(s => s.stage === stage)) continue;
    sources.push({ id: stage, sourceFileId: ref.sourceFileId, sourceSha256: ref.sourceSha256, stage,
      pageNumber: ref.pageNumber, sheet: null, revision: null, bbox: ref.bbox,
      value: ref.rawValue, unit: ref.rawUnit, element: "Не установлен" });
  }
  const stages = sources.map(s => s.stage);
  return { entity: "Не установлен", sameElementConfirmed: false,
    comparisonPair: stages.includes("ID") ? stages.includes("RD") ? stages.includes("PD") ? "PD_RD_ID" : "RD_ID" : "PD_ID" : "PD_RD",
    sources, rule: null, clarification: "", parts: [] };
}
export const decisionLabels: Record<ReviewCandidateDecisionRead["decision"] | "PENDING", string> = {
  PENDING: "Не рассмотрено", ACCEPT_FOR_REVIEW: "Оставлено для проверки", REJECT: "Отклонено",
  CONFIRM: "Подтверждено инспектором", CLARIFY: "Требует уточнения", PARTIAL_CONFIRM: "Подтверждено частично",
  CORRECT_EVIDENCE: "Доказательства исправлены; требуется повторная проверка",
};
export function reviewOutcome(details: InspectorReviewDetails) {
  const stages = details.comparisonPair.split("_");
  const selected = details.sources.filter(s => stages.includes(s.stage));
  if (stages.some(stage => !selected.some(s => s.stage === stage))) return {
    status: "MISSING_DOCUMENT", label: "Отсутствует источник выбранной стадии", action: "Дозагрузите документ или выберите доступную пару", delta: null };
  if (!details.sameElementConfirmed) return { status: "NOT_COMPARABLE", label: "Связь с одним элементом не подтверждена", action: "Сверьте помещение, этаж и элемент в источниках", delta: null };
  const result = compareInspectorEvidence(selected, details.rule);
  const labels = { MISSING_VALUE: "Значение не найдено; укажите его по оригиналу или запросите уточнение", MISSING_DOCUMENT: "Недостаточно стадий", NOT_COMPARABLE: "Источники несопоставимы", RULE_REQUIRED: "Правило оценки не задано",
    NO_DIFFERENCE: "Расхождение по выбранному правилу не найдено", DIFFERENCE: "Выявлено расхождение; требуется решение инспектора" };
  return { ...result, label: labels[result.status], action: result.status === "RULE_REQUIRED" ? "Укажите условие и нормативное основание" : "Сверьте оригиналы перед решением" };
}
