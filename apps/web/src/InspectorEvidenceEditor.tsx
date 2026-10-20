import { useState } from "react";
import type { InspectorEvidence, InspectorReviewDetails, SourceFileSummary } from "@inspector-ai/contracts";
function BoundsEditor({ source, onChange }: { source: InspectorEvidence; onChange: (bbox: InspectorEvidence["bbox"]) => void }) {
  const [text, setText] = useState(source.bbox?.join(", ") ?? "");
  const [error, setError] = useState(false);
  return <label>Рамка x0, y0, x1, y1 (0–1, от верхнего левого угла)
    <input value={text} aria-invalid={error} onChange={e => setText(e.target.value)} onBlur={() => {
      if (!text.trim()) { onChange(null); setError(false); return; }
      const values = text.split(",").map(Number);
      const valid = values.length === 4 && values.every(Number.isFinite) && 0 <= values[0] && values[0] < values[2] && values[2] <= 1
        && 0 <= values[1] && values[1] < values[3] && values[3] <= 1;
      setError(!valid); if (valid) onChange(values as [number, number, number, number]);
    }} />{error && <small role="alert">Нужны четыре координаты, например 0.1, 0.2, 0.4, 0.3</small>}</label>;
}
export function InspectorEvidenceEditor({ details, files, disabled, onChange }: {
  details: InspectorReviewDetails; files: SourceFileSummary[]; disabled: boolean; onChange: (value: InspectorReviewDetails) => void;
}) {
  function updateSource(id: string, patch: Partial<InspectorEvidence>) {
    onChange({ ...details, sources: details.sources.map(s => s.id === id ? { ...s, ...patch } : s) });
  }
  return <fieldset className="inspector-evidence-editor" disabled={disabled}><legend>Доказательства и правило оценки</legend>
    <p>Изменения сохраняются отдельной версией. Машинная строка остаётся в истории. После исправления нужно новое решение.</p>
    <label>Объект / этаж / помещение / элемент<input value={details.entity} maxLength={300}
      onChange={e => onChange({ ...details, entity: e.target.value, sameElementConfirmed: false })} /></label>
    <label><input type="checkbox" checked={details.sameElementConfirmed} onChange={e => onChange({ ...details, sameElementConfirmed: e.target.checked })} />
      Проверил: выбранные источники относятся к указанному элементу</label>
    {(["PD", "RD", "ID"] as const).map(stage => {
      const source = details.sources.find(s => s.stage === stage);
      return <section key={stage}><h5>{stage === "PD" ? "ПД" : stage === "RD" ? "РД" : "ИД"}</h5>
        <label>Файл<select value={source?.sourceFileId ?? ""} onChange={e => {
          const file = files.find(f => f.id === e.target.value);
          const others = details.sources.filter(s => s.stage !== stage);
          onChange({ ...details, sameElementConfirmed: false, parts: [], sources: file ? [...others, {
            id: stage, sourceFileId: file.id, sourceSha256: file.sha256, stage, pageNumber: 1, sheet: null,
            revision: null, bbox: null, value: "", unit: null, element: details.entity,
          }] : others });
        }}><option value="">Источник отсутствует</option>{files.filter(f => f.stages.includes(stage)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        {source && <div className="inspector-editor-fields">
          <label>Страница PDF<input type="number" min={1} max={files.find(f => f.id === source.sourceFileId)?.pageCount ?? 10000} value={source.pageNumber}
            onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 1) updateSource(source.id, { pageNumber: value, bbox: null }); }} /></label>
          <label>Обозначение листа<input value={source.sheet ?? ""} maxLength={120} onChange={e => updateSource(source.id, { sheet: e.target.value || null })} /></label>
          <label>Редакция<input value={source.revision ?? ""} maxLength={120} onChange={e => updateSource(source.id, { revision: e.target.value || null })} /></label>
          <label>Значение<input value={source.value} placeholder="Не извлечено" maxLength={1000} onChange={e => updateSource(source.id, { value: e.target.value })} /></label>
          <label>Единица<input value={source.unit ?? ""} maxLength={80} onChange={e => updateSource(source.id, { unit: e.target.value || null })} /></label>
          <label>Элемент в этом источнике<input value={source.element} maxLength={300} onChange={e => updateSource(source.id, { element: e.target.value })} /></label>
          <BoundsEditor key={`${source.id}-${source.sourceFileId}-${source.pageNumber}`} source={source} onChange={bbox => updateSource(source.id, { bbox })} />
        </div>}
      </section>;
    })}
    <label>Правило<select value={details.rule?.kind ?? ""} onChange={e => onChange({ ...details,
      rule: e.target.value ? { kind: e.target.value as "EXACT" | "ABSOLUTE" | "PERCENT", tolerance: 0, basis: "", condition: "" } : null })}>
      <option value="">Не задано</option><option value="EXACT">Точное совпадение</option><option value="ABSOLUTE">Абсолютное отклонение</option><option value="PERCENT">Отклонение от первой стадии, %</option></select></label>
    {details.rule && <div className="inspector-editor-fields">
      {details.rule.kind !== "EXACT" && <label>Допуск<input type="number" min={0} step="any" value={details.rule.tolerance}
        onChange={e => onChange({ ...details, rule: { ...details.rule!, tolerance: Number(e.target.value) } })} /></label>}
      <label>Нормативное основание / пункт<input value={details.rule.basis} maxLength={1000}
        onChange={e => onChange({ ...details, rule: { ...details.rule!, basis: e.target.value } })} /></label>
      <label>Условие применения<input value={details.rule.condition} maxLength={1000}
        onChange={e => onChange({ ...details, rule: { ...details.rule!, condition: e.target.value } })} /></label>
    </div>}
    <label>Уточнение: недостающий документ или неверный источник<textarea value={details.clarification} maxLength={2000}
      onChange={e => onChange({ ...details, clarification: e.target.value })} /></label>
    <details><summary>Составное замечание: решения по частям ({details.parts.length})</summary>
      <p>Для каждой части выберите её доказательства. Подтверждённая часть должна содержать минимум две сопоставимые стадии одного элемента.</p>
      {details.parts.map((part, index) => <fieldset key={part.id}><legend>Часть {index + 1}</legend>
        <label>Описание<input value={part.description} onChange={e => onChange({ ...details, parts: details.parts.map(p => p.id === part.id ? { ...p, description: e.target.value } : p) })} /></label>
        <label>Решение<select value={part.decision} onChange={e => onChange({ ...details, parts: details.parts.map(p => p.id === part.id ? { ...p, decision: e.target.value as typeof part.decision } : p) })}>
          <option value="CONFIRM">Подтвердить</option><option value="REJECT">Отклонить</option><option value="CLARIFY">Уточнить</option></select></label>
        <label>Причина<input value={part.note} onChange={e => onChange({ ...details, parts: details.parts.map(p => p.id === part.id ? { ...p, note: e.target.value } : p) })} /></label>
        {details.sources.map(source => <label key={source.id}><input type="checkbox" checked={part.evidenceIds.includes(source.id)}
          onChange={e => onChange({ ...details, parts: details.parts.map(p => p.id === part.id ? { ...p,
            evidenceIds: e.target.checked ? [...p.evidenceIds, source.id] : p.evidenceIds.filter(id => id !== source.id) } : p) })} />{source.stage}: {source.element} · {source.value}</label>)}
        <button type="button" onClick={() => onChange({ ...details, parts: details.parts.filter(p => p.id !== part.id) })}>Удалить часть из черновика</button>
      </fieldset>)}
      <button type="button" disabled={details.parts.length >= 24} onClick={() => onChange({ ...details, parts: [...details.parts,
        { id: crypto.randomUUID(), description: "", decision: "CLARIFY", note: "", evidenceIds: [] }] })}>Добавить часть</button>
    </details>
  </fieldset>;
}
