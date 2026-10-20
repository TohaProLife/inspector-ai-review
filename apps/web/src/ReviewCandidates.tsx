import { InspectorGeometryRegistration } from "./InspectorGeometryRegistration";
import { useEffect, useState } from "react";
import { inspectorReviewDetailsSchema, type CandidateReviewAction, type InspectorReviewDetails, type SourceFileSummary } from "@inspector-ai/contracts";
import { api, type ReviewCandidatesRead, type ReviewCandidateDecisionList, type VisualProposalAnalysis } from "./api";
import { DocumentPairWorkspace } from "./DocumentPairWorkspace";
import { InspectorEvidenceEditor } from "./InspectorEvidenceEditor";
import { initialReview, decisionLabels, reviewOutcome } from "./inspector-review-state";
import "./inspector-review.css";

function ReviewWorkspace({ data, checkId, objectId, onProtocol, parameterCatalog = {} }: {
  data: ReviewCandidatesRead; checkId: string; objectId: string; onProtocol: () => void;
  parameterCatalog?: Record<string, { name: string; matrixCode: string; criticality?: string | null; trigger?: string | null; source_pd?: string | null }>;
}) {
  const [selectedId, setSelectedId] = useState(data.candidates[0]?.candidateId ?? "");
  const [decisions, setDecisions] = useState<ReviewCandidateDecisionList | null>(null);
  const [files, setFiles] = useState<SourceFileSummary[]>([]);
  const [visual, setVisual] = useState<VisualProposalAnalysis | null>(null);
  const [details, setDetails] = useState<InspectorReviewDetails | null>(null);
  const [query, setQuery] = useState(""); const [section, setSection] = useState(""); const [status, setStatus] = useState("");
  const [note, setNote] = useState(""); const [opened, setOpened] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSelectedId(data.candidates[0]?.candidateId ?? ""); setDecisions(null); setDetails(null); setFiles([]);
    setOpened(new Set()); setNote(""); setError(null); setVisual(null);
    void Promise.all([api.listReviewCandidateDecisions(checkId), api.listSourceFiles(objectId)]).then(([history, sources]) => {
      if (active) { setDecisions(history); setFiles(sources.items); }
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Не удалось загрузить историю и источники"); });
    void api.getVisualProposals(checkId).then(value => { if (active) setVisual(value); }).catch(() => { if (active) setNotice("Охват визуального анализа недоступен. Обновите страницу; соответствие не установлено."); });
    return () => { active = false; };
  }, [checkId, objectId, data.contentHash]);
  const selected = data.candidates.find(candidate => candidate.candidateId === selectedId);
  const selectedDecisions = decisions?.items.filter(item => item.candidateId === selectedId) ?? [];
  const latest = selectedDecisions.at(-1);
  useEffect(() => {
    if (!selected || !decisions) return;
    setDetails(latest?.details ? structuredClone(latest.details) : initialReview(selected, files));
    setOpened(new Set());
  }, [selectedId, decisions, files]);
  const latestById = new Map(decisions?.items.map(item => [item.candidateId, item]));
  const reviewed = data.candidates.filter(c => {
    const action = latestById.get(c.candidateId)?.decision;
    return action && !["ACCEPT_FOR_REVIEW", "CORRECT_EVIDENCE"].includes(action);
  }).length;
  const visible = data.candidates.filter(c => `${c.parameterCode} ${parameterCatalog[c.parameterCode]?.name ?? ""} ${parameterCatalog[c.parameterCode]?.matrixCode ?? ""} ${c.lineText}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    && (!section || c.sectionCode === section) && (!status || (latestById.get(c.candidateId)?.decision ?? "PENDING") === status));
  const outcome = details ? reviewOutcome(details) : null;
  const stages = details?.comparisonPair.split("_") ?? ["PD", "RD"];
  const stageLabel = (stage: string) => ({ PD: "ПД", RD: "РД", ID: "ИД" }[stage] ?? stage);
  const canAct = !!decisions?.canReview && !saving && note.trim().length >= 8 && opened.size > 0;
  function selectCandidate(id: string) { setSelectedId(id); setNote(""); setNotice(null); setError(null); }
  async function decide(decision: CandidateReviewAction) {
    if (!selected || !decisions?.canReview || saving || note.trim().length < 8 || opened.size === 0) return;
    const parsed = inspectorReviewDetailsSchema.safeParse(details);
    if (!["REJECT", "ACCEPT_FOR_REVIEW"].includes(decision) && !parsed.success) {
      setError("Заполните элемент, значения и основание правила; проверьте страницы, рамки и части замечания"); return;
    }
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.recordReviewCandidateDecision(checkId, {
        schemaVersion: "review-candidate-decision-v1", candidateId: selected.candidateId,
        artifactHash: data.contentHash, decision, note: note.trim(),
        ...(parsed.success ? { details: parsed.data } : {}), expectedDecisionHash: latest?.decisionHash ?? null,
      });
      setDecisions(await api.listReviewCandidateDecisions(checkId)); setNotice(decisionLabels[decision]); setNote("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение"); }
    finally { setSaving(false); }
  }
  function exportReview() {
    if (!decisions) return;
    const content = JSON.stringify({ schemaVersion: "inspector-review-export-v2", checkId, objectId,
      artifact: data, decisions: decisions.items, sources: files, visualCoverage: visual,
      machineFindingsChanged: false }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `inspector-review-${checkId}.json`;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return <section className="surface inspector-review" aria-label="Кандидаты на замечания">
    <header><span className="kicker">Рабочее место инспектора</span><h3>Кандидаты на замечания</h3>
      <p>Найдено: {data.candidateCount} · рассмотрено: {reviewed} · ожидает: {data.candidateCount - reviewed}{data.truncated ? " · список ограничен; анализ неполный" : ""}.</p>
      <p>Машинная подсказка и решение инспектора показаны отдельно. Уверенность модели: не оценена. Сходство листов: не вычислено.</p>
      {decisions && !decisions.canReview && <p role="status">Режим просмотра: проверка закрыта либо нет права на изменение.</p>}
    </header>
    {visual && <details className="inspector-coverage"><summary>Охват визуального анализа: {visual.profile.analysisMode === "FULL" ? "полный режим" : "выборочный режим"}</summary>
      {visual.sources.map(source => {
        const processed = source.vlm?.observations.filter(o => o.responseSha256 !== null).length ?? 0;
        const failures = (source.vlm?.observations.length ?? 0) - processed;
        return <div key={source.sourceFileId}><strong>{files.find(f => f.id === source.sourceFileId)?.name ?? source.sourceFileId}</strong>
          <p>Листы: {source.scannedPageCount}/{source.pageCount}; пропущено: {source.skippedPageCount ?? source.pageCount - source.scannedPageCount}.
            Областей найдено: {source.proposals.length + source.unretainedProposalCount}; сохранено: {source.proposals.length};
            получен ответ модели: {processed}; ошибок/недоступно: {failures}; не направлено в модель: {(source.vlm?.omittedProposalCount ?? source.proposals.length) + source.unretainedProposalCount}.</p>
          <p>Контекст: {source.documentContext?.status ?? "не определён"}{source.documentContext?.domains?.length ? ` (${source.documentContext.domains.join(", ")})` : ""}.
            {source.documentContext?.ambiguity && " Несколько систем: контекст требует уточнения; системы сохранены вместе."}</p>
          {source.vlm && <ul>{[...new Set(source.vlm.observations.filter(o => !o.responseSha256).map(o => o.reasonCode))].map(reason => <li key={reason}>{reason}</li>)}</ul>}
        </div>;
      })}</details>}
    {error && <p role="alert">{error} <button type="button" onClick={() => void api.listReviewCandidateDecisions(checkId).then(setDecisions)}>Обновить историю</button></p>}
    {notice && <p role="status">{notice}</p>}
    <div className="inspector-filters"><label>Поиск<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Код матрицы, название или описание" /></label>
      <label>Раздел<select value={section} onChange={e => setSection(e.target.value)}><option value="">Все</option>
        {[...new Set(data.candidates.flatMap(c => c.sectionCode ? [c.sectionCode] : []))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Решение<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Все</option>
        {Object.entries(decisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <div className="inspector-review-layout"><nav className="inspector-candidate-list" aria-label="Список кандидатов">
      {visible.map(candidate => <button key={candidate.candidateId} type="button" disabled={saving}
        aria-current={candidate.candidateId === selectedId ? "true" : undefined}
        onClick={() => selectCandidate(candidate.candidateId)}>
        <strong>{candidate.parameterCode} · {parameterCatalog[candidate.parameterCode]?.name ?? candidate.matchedLabel}</strong>
        <span>{candidate.lineText}</span><small>{decisionLabels[latestById.get(candidate.candidateId)?.decision ?? "PENDING"]}</small>
      </button>)}{!visible.length && <p>По фильтру записей нет.</p>}</nav>
      {selected && <article className="inspector-candidate-detail" aria-label="Открытая карточка">
        <div className="inspector-actions" aria-label="Переход между расхождениями">
          <button type="button" disabled={saving || visible.findIndex(item => item.candidateId === selectedId) <= 0}
            onClick={() => { const index = visible.findIndex(item => item.candidateId === selectedId); if (index > 0) selectCandidate(visible[index - 1].candidateId); }}>Предыдущее расхождение</button>
          <button type="button" disabled={saving || visible.findIndex(item => item.candidateId === selectedId) < 0 || visible.findIndex(item => item.candidateId === selectedId) >= visible.length - 1}
            onClick={() => { const index = visible.findIndex(item => item.candidateId === selectedId); if (index >= 0 && index < visible.length - 1) selectCandidate(visible[index + 1].candidateId); }}>Следующее расхождение</button>
        </div>
        <h4>{selected.parameterCode} · {parameterCatalog[selected.parameterCode]?.name ?? selected.matchedLabel}</h4>
        <p>Выбрана запись {data.candidates.indexOf(selected) + 1} из {data.candidateCount}. Статус: <strong>{decisionLabels[latest?.decision ?? "PENDING"]}</strong></p>
        <p>Метод обнаружения: текстовый слой PDF · {selected.reason}. Критичность и нормативное основание определяются по параметру и правилу, не по уверенности модели.</p>
        <p>Критичность по матрице: {parameterCatalog[selected.parameterCode]?.criticality ?? "не задана"}.
          Условие: {parameterCatalog[selected.parameterCode]?.trigger ?? "требует предметной проверки"}.
          Источник в ПД: {parameterCatalog[selected.parameterCode]?.source_pd ?? "не указан"}.</p>
        <blockquote>{selected.lineText}</blockquote>
        <p>Исходник {files.find(f => f.id === selected.sourceFileId)?.name ?? selected.sourceFileId} · PDF стр. {selected.pageNumber} · блок {selected.locator.blockIndex + 1}, строка {selected.locator.lineIndex + 1}.
          <a href={`${api.sourceFileUrl(objectId, selected.sourceFileId)}#page=${selected.pageNumber}`} target="_blank" rel="noopener noreferrer"
            onClick={() => setOpened(prev => new Set(prev).add("original"))}> Открыть оригинал</a></p>
        <InspectorGeometryRegistration key={selected.sourceFileId} objectId={objectId} sourceFileId={selected.sourceFileId} />
        <details><summary>Ограничения исходной подсказки ({selected.missingConfirmation.length})</summary><ul>{selected.missingConfirmation.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
        {details && <>
          <div className="inspector-comparison-controls"><label>Сравниваемые стадии<select value={details.comparisonPair}
            onChange={e => setDetails({ ...details, comparisonPair: e.target.value as InspectorReviewDetails["comparisonPair"] })}>
            <option value="PD_RD">ПД / РД</option><option value="PD_ID">ПД / ИД</option><option value="RD_ID">РД / ИД</option><option value="PD_RD_ID">ПД / РД / ИД</option></select></label>
            </div>
          <div className="inspector-stage-values">{["PD", "RD", "ID"].map(stage => {
            const source = details.sources.find(s => s.stage === stage);
            return <div key={stage}><span>{stageLabel(stage)}</span><strong>{source ? source.value.trim() ? `${source.value} ${source.unit ?? ""}` : "Значение не найдено" : "Нет источника"}</strong></div>;
          })}</div>
          <div className="inspector-outcome" role="status"><strong>{outcome?.label}</strong><p>{outcome?.action}</p>
            {outcome?.delta !== null && <p>Отклонение: {outcome?.delta} {details.rule?.kind === "PERCENT" ? "%" : details.sources[0]?.unit}. Допуск: {details.rule?.tolerance}.</p>}
            {details.rule && <p>Условие: {details.rule.condition}. Основание: {details.rule.basis}.</p>}</div>
          <DocumentPairWorkspace objectId={objectId} checkId={checkId} files={files} sources={details.sources} stages={stages}
            title={`${stages.map(stageLabel).join(" / ")} · исходные фрагменты`} onOpened={evidence => setOpened(prev => new Set(prev).add(`${evidence?.sourceFileId}:${evidence?.pageNumber}`))} />
          {decisions?.canReview && <details><summary>Исправить доказательства, добавить источник или разделить замечание</summary>
            <InspectorEvidenceEditor details={details} files={files} disabled={saving} onChange={setDetails} /></details>}
        </>}
        {decisions?.canReview && <div className="inspector-decision-form"><label>Причина решения<textarea value={note} maxLength={1000}
          disabled={saving} onChange={e => setNote(e.target.value)} placeholder="От 8 символов; при уточнении укажите недостающий документ" /></label>
          <small>Откройте исходный лист и укажите основание. Подтверждение проверяет редакции, связь документов и правило на сервере.</small>
          <div className="inspector-actions">{(["CONFIRM", "REJECT", "CLARIFY", "PARTIAL_CONFIRM", "CORRECT_EVIDENCE", "ACCEPT_FOR_REVIEW"] as CandidateReviewAction[]).map(action => <button key={action}
            type="button" disabled={!canAct} onClick={() => void decide(action)}>{({ CONFIRM: "Подтвердить нарушение", REJECT: "Отклонить", CLARIFY: "Запросить уточнение",
              PARTIAL_CONFIRM: "Сохранить частичное решение", CORRECT_EVIDENCE: "Сохранить исправления; повторное рассмотрение", ACCEPT_FOR_REVIEW: "Оставить для проверки" })[action]}</button>)}</div></div>}
        <details><summary>История решений и доказательств ({selectedDecisions.length})</summary>
          {selectedDecisions.map((event, index) => <section key={event.id}><strong>Версия {index + 1}: {decisionLabels[event.decision]}</strong>
            <p>{event.note} · {event.actorId} · {new Date(event.createdAt).toLocaleString("ru-RU")}</p>
            {event.inheritedFrom && <p>Сохранено из проверки {event.inheritedFrom.checkId} от {new Date(event.inheritedFrom.createdAt).toLocaleString("ru-RU")}: исходники и зависимости совпали.</p>}
            {event.details && <><p>{event.details.entity}</p><ul>{event.details.sources.map(source => <li key={source.id}>{source.stage} · {source.sourceFileId} · стр. {source.pageNumber} · {source.value} {source.unit} · bbox {source.bbox?.join(", ") ?? "не задан"}</li>)}</ul>
              {event.details.parts.map(part => <p key={part.id}>{part.description}: {part.decision} · {part.note}</p>)}</>}
            <code title={event.decisionHash}>{event.decisionHash.slice(0, 16)}…</code></section>)}
        </details>
      </article>}
    </div>
    {!data.candidates.length && <p>Значения не найдены в загруженных документах. Проверьте OCR, комплектность и ограничения анализа; соответствие не установлено.</p>}
    <div className="inspector-actions"><button type="button" disabled={!decisions} onClick={exportReview}>Экспорт источников и решений JSON</button>
      <button type="button" onClick={onProtocol}>Открыть протокол</button></div>
  </section>;
}

export function ReviewCandidates(props: Parameters<typeof ReviewWorkspace>[0]) {
  const [checks, setChecks] = useState<Array<{ id: string; startedAt: string; status: string }>>([]);
  const [selected, setSelected] = useState(props.checkId);
  const [historic, setHistoric] = useState<ReviewCandidatesRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; setSelected(props.checkId); setHistoric(null);
    void api.listObjectChecks(props.objectId).then(result => { if (active) setChecks(result.items); })
      .catch(() => { if (active) setError("История запусков недоступна"); });
    return () => { active = false; };
  }, [props.objectId, props.checkId]);
  useEffect(() => { let active = true; setHistoric(null); setError(null);
    if (selected !== props.checkId) void api.getPilotResults(selected).then(result => {
      if (active) { setHistoric(result.reviewCandidates ?? null); if (!result.reviewCandidates) setError("В этой версии подсказок нет"); }
    }).catch(() => { if (active) setError("Не удалось загрузить сохранённую версию"); });
    return () => { active = false; };
  }, [selected, props.checkId]);
  return <><label className="inspector-run-select">Версия проверки<select value={selected} onChange={event => setSelected(event.target.value)}>
    {!checks.some(check => check.id === props.checkId) && <option value={props.checkId}>Текущая — {props.checkId}</option>}
    {checks.map(check => <option key={check.id} value={check.id}>{check.id === props.checkId ? "Текущая · " : "История · "}{new Date(check.startedAt).toLocaleString("ru-RU")} · {check.id}</option>)}
  </select></label>{error && <p role="status">{error}</p>}
  {selected === props.checkId || historic ? <ReviewWorkspace key={selected} {...props} checkId={selected} data={historic ?? props.data} /> : !error && <p role="status">Загрузка сохранённого результата…</p>}</>;
}
