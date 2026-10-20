import { useEffect, useState } from "react";
import { api, type ReviewCandidateDecisionRead } from "./api";
import { decisionLabels } from "./inspector-review-state";
export function InspectorProtocolReview({ objectId, checkId, onPending }: { objectId: string; checkId: string; onPending: (value: number | null) => void }) {
  const [events, setEvents] = useState<ReviewCandidateDecisionRead[]>([]);
  const [missingId, setMissingId] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; onPending(null);
    void Promise.all([api.getPilotResults(checkId), api.listSourceFiles(objectId)])
      .then(async ([pilot, files]) => {
        const history = pilot.reviewCandidates?.candidateCount ? await api.listReviewCandidateDecisions(checkId) : { items: [] };
        if (!active) return;
        const latest = new Map(history.items.map(event => [event.candidateId, event]));
        const candidates = pilot.reviewCandidates?.candidates ?? [];
        onPending(candidates.filter(candidate => !latest.has(candidate.candidateId)
          || ["ACCEPT_FOR_REVIEW", "CORRECT_EVIDENCE"].includes(latest.get(candidate.candidateId)!.decision)).length);
        setEvents([...latest.values()]); setMissingId(!files.items.some(file => file.stages.includes("ID"))); setError(null);
      }).catch(() => { if (active) { setError("Решения или состав комплекта недоступны. Обновите проверку перед финализацией."); onPending(null); } });
    return () => { active = false; };
  }, [checkId, objectId, onPending]);
  return <section className="protocol-section">
    <h3>Решения инспектора по исходным листам</h3>
    <p>Подтверждено: {events.filter(event => event.decision === "CONFIRM").length};
      частично: {events.filter(event => event.decision === "PARTIAL_CONFIRM").length};
      отклонено: {events.filter(event => event.decision === "REJECT").length};
      уточнение: {events.filter(event => event.decision === "CLARIFY").length}.</p>
    {missingId && <p role="status">ИД отсутствует. Выпуск возможен с явным указанием неполноты; соответствие фактически выполненных работ не установлено.</p>}
    {error && <p role="alert">{error}</p>}
    {!events.length && <p>Сохранённых решений пока нет.</p>}
    {events.map(event => <article key={event.id} className="protocol-finding"><div><strong>{decisionLabels[event.decision]}</strong>
      <p>{event.details?.entity ?? event.candidateId.slice(0, 12)} · {event.note}</p>
      {event.details?.sources.map(source => <p key={source.id}>{source.stage}: {source.value || "Значение отсутствует"} {source.unit} · {source.sourceFileId} · стр. {source.pageNumber} · лист {source.sheet ?? "не указан"} · редакция {source.revision ?? "не подтверждена"} · SHA {source.sourceSha256.slice(0, 12)}</p>)}
      {event.details?.parts.map(part => <p key={part.id}>{part.description}: {decisionLabels[part.decision]} · {part.note}</p>)}
      <small>{event.actorId} · {new Date(event.createdAt).toLocaleString("ru-RU")} · SHA {event.decisionHash.slice(0, 12)}</small>
    </div></article>)}
    <p>Эти решения включаются в отдельный раздел финального JSON вместе с версиями доказательств. Машинное покрытие рассчитывается отдельно.</p>
  </section>;
}
