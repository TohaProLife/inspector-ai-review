import { useEffect, useState } from "react";
import { api, type ReviewCandidatesRead, type ReviewCandidateDecisionList } from "./api";
import { SourceImage } from "./design-system/SourceImage";

type Candidate = ReviewCandidatesRead["candidates"][number];
const missingLabels: Record<string, string> = {
  REVISION_NOT_CONFIRMED: "Не подтверждена редакция",
  APPROVAL_NOT_CONFIRMED: "Не подтверждено согласование",
  PAGE_STAGE_NOT_CONFIRMED: "Не подтверждена стадия листа",
  SECTION_NOT_CONFIRMED: "Не подтверждён раздел",
  DOCUMENT_LINK_NOT_CONFIRMED: "Не подтверждена связь документов",
  ELEMENT_NOT_CONFIRMED: "Не определён конкретный элемент",
  SAME_ELEMENT_NOT_CONFIRMED: "Не доказано, что строки относятся к одному элементу",
  PAGE_TOPIC_NOT_COMPARISON: "Совпадение темы не подтверждает расхождение",
  SCOPE_NOT_CONFIRMED: "Не определено место установки",
  CODE_MAPPING_NOT_CONFIRMED: "Связь строки с кодом требует проверки",
  VALUE_NOT_EXTRACTED: "Значение для сравнения не извлечено",
  PAVING_MATERIAL_NOT_CONFIRMED: "Материал покрытия не подтверждён",
  PARKING_LAYOUT_NOT_CONFIRMED: "Разметка парковочных мест не подтверждена",
  TABLE_ROW_ASSOCIATION_NOT_CONFIRMED: "Связь значения со строкой таблицы требует проверки",
  CLASS_NOT_ASSIGNED_IN_SOURCE: "Источник сообщает, что класс в проекте не определён",
  ZONE_PLAN_BOUNDARY_NOT_CONFIRMED: "Граница охранной зоны на плане не подтверждена",
  SHAFT_DIMENSIONS_NOT_CONFIRMED: "Габариты лифтовой шахты не подтверждены",
  NETWORK_VS_INTERNAL_NOT_CONFIRMED: "Показанная тепловая сеть может не относиться к внутренним магистралям и стоякам",
  EXTERIOR_EXIT_NOT_CONFIRMED: "Не подтверждено, что выходы В2/В3 ведут непосредственно наружу",
  TURNING_RADIUS_VALUE_NOT_CONFIRMED: "Радиус поворота на схеме не извлечён и не сопоставлен с проездом",
};
const kindLabel: Record<Candidate["kind"], string> = {
  ONE_DOCUMENT_SIGNAL: "Проверить строку",
  POSSIBLE_PAIR: "Предполагаемая пара",
  POSSIBLE_DIFFERENCE: "Возможное расхождение",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

function crop(candidate: Candidate): [number, number, number, number] | null {
  const [x0, y0, x1, y1] = candidate.locator.bboxMilliPoints;
  const width = candidate.pageWidthMilliPoints;
  const height = candidate.pageHeightMilliPoints;
  if (![x0, y0, x1, y1, width, height].every(Number.isFinite)
    || width <= 0 || height <= 0 || x1 <= x0 || y1 <= y0) return null;
  const round = (value: number) => Number(Math.max(0, Math.min(1, value)).toFixed(6));
  const bounds: [number, number, number, number] = [
    round(x0 / width), round(1 - y1 / height), round(x1 / width), round(1 - y0 / height),
  ];
  return bounds[0] < bounds[2] && bounds[1] < bounds[3] ? bounds : null;
}

export function ReviewCandidates({ data, checkId, objectId, onProtocol, parameterCatalog = {} }: {
  data: ReviewCandidatesRead; checkId: string; objectId: string; onProtocol: () => void;
  parameterCatalog?: Record<string, { name: string; matrixCode: string }>;
}) {
  const [selectedId, setSelectedId] = useState(data.candidates[0]?.candidateId ?? "");
  const [decisions, setDecisions] = useState<ReviewCandidateDecisionList | null>(null);
  const [note, setNote] = useState("");
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSelectedId(data.candidates[0]?.candidateId ?? "");
    setDecisions(null); setOpened(false); setNote(""); setError(null);
    void api.listReviewCandidateDecisions(checkId).then((value) => {
      if (active) setDecisions(value);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Не удалось загрузить решения");
    });
    return () => { active = false; };
  }, [checkId, data.contentHash]);
  const selected = data.candidates.find((candidate) => candidate.candidateId === selectedId);
  const selectedDecisions = decisions?.items.filter((item) => item.candidateId === selectedId) ?? [];
  const box = selected ? crop(selected) : null;
  async function decide(decision: "ACCEPT_FOR_REVIEW" | "REJECT") {
    if (saving || !selected || !opened || !decisions?.canReview || note.trim().length < 8) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.recordReviewCandidateDecision(checkId, {
        schemaVersion: "review-candidate-decision-v1", candidateId: selected.candidateId,
        artifactHash: data.contentHash, decision, note: note.trim(),
      });
      setDecisions(await api.listReviewCandidateDecisions(checkId));
      setNotice(decision === "REJECT" ? "Подсказка отклонена" : "Подсказка оставлена для проверки");
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение");
    } finally { setSaving(false); }
  }
  function exportReview() {
    if (!decisions) return;
    const content = JSON.stringify({ schemaVersion: "review-candidate-export-v1",
      checkId, objectId, artifact: data, decisions: decisions.items,
      officialFindingsIncluded: false }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `review-candidates-${checkId}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return <section className="surface review-candidates" aria-label="Кандидаты на замечания">
    <div className="surface-title"><div><span className="kicker">Отдельный режим</span>
      <h3>Кандидаты на замечания</h3>
      <p>Подсказки по исходным страницам. Это не замечания и не подтверждённые факты.</p>
    </div></div>
    <p><strong>Проверить: {data.candidateCount}</strong> · сохранённых решений: {decisions?.items.length ?? "…"}
      {data.truncated ? " · список ограничен" : ""}. Официальный результат и покрытие не меняются.</p>
    <p>Артефакт запуска SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code>.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {data.candidates.length === 0 ? <p>Недостаточно данных для адресных подсказок. Проверьте OCR и исходные документы.</p> : <div className="review-candidates-layout">
      <div className="review-candidates-list" aria-label="Ранжированные подсказки">
        {data.candidates.map((candidate, index) => <button key={candidate.candidateId}
          type="button" disabled={saving} aria-current={selectedId === candidate.candidateId ? "true" : undefined}
          onClick={() => { setSelectedId(candidate.candidateId); setOpened(false); setNote(""); setNotice(null); setError(null); }}>
          <strong>{index + 1}. {candidate.parameterCode} · {candidate.reason === "PAGE_TOPIC_LINE"
            ? "Проверить тематический лист" : candidate.reason === "CATALOG_TOPIC_LINE"
              ? "Проверить строку каталога" : kindLabel[candidate.kind]}</strong>
          {parameterCatalog[candidate.parameterCode] && <span className="review-candidate-matrix">
            {parameterCatalog[candidate.parameterCode].matrixCode} · {parameterCatalog[candidate.parameterCode].name}
          </span>}
          <small>{candidate.sourceFileId}, PDF стр. {candidate.pageNumber} · {candidate.matchedLabel}
            {candidate.rawValue !== candidate.matchedLabel ? `: ${candidate.rawValue}` : ""} {candidate.rawUnit ?? ""}</small>
        </button>)}
      </div>
      {selected && <div className="review-candidates-detail">
        <h4>{selected.parameterCode} · {kindLabel[selected.kind]}</h4>
        {parameterCatalog[selected.parameterCode] && <p className="review-candidate-matrix">
          Матрица {parameterCatalog[selected.parameterCode].matrixCode} · {parameterCatalog[selected.parameterCode].name}
        </p>}
        {selected.reason === "PAGE_TOPIC_LINE" && <p>Тема листа помогает найти место для проверки. Код и расхождение ещё не подтверждены.</p>}
        {selected.reason === "CATALOG_TOPIC_LINE" && <p>{["ZU-126", "ZU-127", "ZU-128"].includes(selected.parameterCode)
          ? "На листе таблицы найдено числовое значение. Принадлежность строке и конкретному элементу требует проверки; расхождение не подтверждено."
          : "В строке найден сигнал по коду. Конкретный элемент и расхождение ещё не подтверждены."}</p>}
        {selected.reason === "FEATURE_LABEL_LINE" && <p>Назван элемент, но его место установки и связь с кодом ещё не подтверждены.</p>}
        <p><strong>Сигнал:</strong> «{selected.lineText}»</p>
        <p>Источник {selected.sourceFileId} · PDF стр. {selected.pageNumber} · блок {selected.locator.blockIndex + 1}, строка {selected.locator.lineIndex + 1} · текстовый слой PDF, OCR не применялся.</p>
        <p>PDF SHA-256 <code title={selected.sourceSha256}>{shortHash(selected.sourceSha256)}</code> · текст SHA-256 <code title={selected.artifactSha256}>{shortHash(selected.artifactSha256)}</code>.</p>
        {selected.relatedDocuments.length > 0 && <div><strong>Связанные строки для проверки:</strong>
          <ul>{selected.relatedDocuments.map((related) => <li key={`${related.sourceFileId}-${related.pageNumber}-${related.rawValue}`}>
            {related.sourceFileId}, PDF стр. {related.pageNumber}: «{related.lineText}» · PDF SHA-256 {shortHash(related.sourceSha256)} · <a
              href={api.sourcePagePreviewUrl(objectId, related.sourceFileId, related.pageNumber)}
              target="_blank" rel="noopener noreferrer">открыть лист</a>
          </li>)}</ul>
          <p>Связь документов и общего элемента требует проверки инспектором.</p>
        </div>}
        <p><strong>Недостаточно данных:</strong> {selected.missingConfirmation.map((reason) =>
          missingLabels[reason] ?? reason).join("; ")}.</p>
        <div className="review-candidates-preview">
          {box && <figure><SourceImage key={`${selected.candidateId}-crop`}
            src={api.sourcePageCropUrl(objectId, selected.sourceFileId, selected.pageNumber, box)}
            alt={`Фрагмент строки на листе ${selected.pageNumber}`} /><figcaption>Фрагмент со строкой</figcaption></figure>}
          <figure><SourceImage key={`${selected.candidateId}-page`}
            src={api.sourcePagePreviewUrl(objectId, selected.sourceFileId, selected.pageNumber)}
            alt={`Исходный лист ${selected.pageNumber}`} /><figcaption>Исходный лист</figcaption></figure>
        </div>
        <a href={api.sourcePagePreviewUrl(objectId, selected.sourceFileId, selected.pageNumber)}
          onClick={() => setOpened(true)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {selected.pageNumber}</a>
        {selectedDecisions.length > 0 && <div><h5>Решения инспектора</h5><ul>{selectedDecisions.map((item) => <li key={item.id}>
          {item.decision === "REJECT" ? "Отклонено" : "Оставлено для проверки"} · {item.note} · {new Date(item.createdAt).toLocaleString("ru-RU")}
        </li>)}</ul></div>}
        {decisions?.canReview && <div className="source-review-form">
          <label><span>Основание решения</span><textarea value={note} maxLength={1000} disabled={saving}
            onChange={(event) => setNote(event.target.value)} placeholder="Что видно на исходном листе?" /></label>
          <small>Откройте лист и укажите основание (от 8 символов). Принятие подсказки не создаёт замечание.</small>
          <div className="source-review-actions"><button className="button button--primary" type="button"
            disabled={saving || !opened || note.trim().length < 8} onClick={() => void decide("ACCEPT_FOR_REVIEW")}>Оставить для проверки</button>
            <button className="button button--secondary" type="button"
              disabled={saving || !opened || note.trim().length < 8} onClick={() => void decide("REJECT")}>Отклонить</button></div>
        </div>}
      </div>}
    </div>}
    <div className="source-review-actions"><button className="button button--secondary" type="button"
      disabled={!decisions} onClick={exportReview}>Экспорт подсказок и решений JSON</button>
      <button className="button button--secondary" type="button" onClick={onProtocol}>Открыть протокол</button></div>
  </section>;
}
