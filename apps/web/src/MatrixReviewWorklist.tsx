import { useState } from "react";
import type { MatrixExecutionRead, MatrixObservation, SourceFileSummary } from "@inspector-ai/contracts";
import { buildMatrixReviewWorklist, matrixReviewFactSource, matrixReviewAvailability, selectMatrixReviewWork,
  matrixReviewSourceChoices, type MatrixReviewWorkView } from "./matrix-review-worklist";
import { matrixFactScopeContextLabel } from "./MatrixFactScopeEditor";

export interface MatrixReviewWorklistProps {
  data: MatrixExecutionRead;
  files: SourceFileSummary[];
  onSelect: (fact: MatrixObservation, ruleId: string) => void;
  onSource?: (file: { id: string; sha256: string }) => void;
  view?: MatrixReviewWorkView;
  onViewChange?: (view: MatrixReviewWorkView) => void;
}
type MatrixReviewControllerProps = Omit<MatrixReviewWorklistProps, "view" | "onViewChange">;
export function MatrixReviewWorklistController(props: MatrixReviewControllerProps) {
  return <MatrixReviewWorklistState key={JSON.stringify([props.data.checkId, props.data.contentHash])} {...props} />;
}
function MatrixReviewWorklistState(props: MatrixReviewControllerProps) {
  const [view, setView] = useState<MatrixReviewWorkView>({ filter: "ALL", factsFirst: false });
  return <MatrixReviewWorklist {...props} view={view} onViewChange={setView} />;
}

export function MatrixReviewSourceChooser({ files, addressValid, onSource }: {
  files: SourceFileSummary[]; addressValid: boolean; onSource?: (file: { id: string; sha256: string }) => void;
}) {
  const sourceChoices = matrixReviewSourceChoices(files);
  return <details style={{ marginBlock: 16 }}><summary>Искать в исходных файлах</summary>
    <p>Явно выберите файл объекта, затем загрузите исходный текст. Стадия, значение и пара этим выбором не назначаются.
      Доступ к тексту выбранного запуска сервер проверит отдельно.</p>
    {!sourceChoices.length && <p>Нет файлов с однозначными ID и корректными SHA. Обновите список источников.</p>}
    {sourceChoices.map(file => <div key={JSON.stringify([file.id, file.sha256])} style={{ marginBlock: 12 }}>
      <button type="button" className="button button--secondary" disabled={!addressValid || !onSource}
        style={{ maxWidth: "100%", whiteSpace: "normal" }}
        onClick={() => { if (addressValid && onSource) onSource({ id: file.id, sha256: file.sha256 }); }}>Проверить источник: {file.name}</button>
      <p><small>{file.id} · SHA {file.sha256}</small></p>
    </div>)}
  </details>;
}

/** Controlled presentation stays independent of state and performs no automatic navigation. */
export function MatrixReviewWorklist({ data, files, onSelect, onSource,
  view = { filter: "ALL", factsFirst: false }, onViewChange }: MatrixReviewWorklistProps) {
  const items = buildMatrixReviewWorklist(data, files);
  const visible = selectMatrixReviewWork(items, view);
  const counts = { BOTH_STAGES: 0, ONE_STAGE: 0, NO_FACTS: 0, INVALID: 0 };
  for (const item of items) counts[matrixReviewAvailability(item)]++;
  const addressValid = /^[a-f0-9]{64}$/u.test(data.contentHash) && typeof data.checkId === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(data.checkId);
  const withFacts = items.filter(item => item.groups.some(group => group.facts.length)).length;
  return <section aria-label="Что нужно для сравнения" style={{ marginBlock: 20, minWidth: 0 }}>
    <h3>Что нужно для сравнения</h3>
    <p>Не хватает данных или подтверждений: {items.length} результатов. Исходные факты доступны для {withFacts}.</p>
    <p>Причины относятся к сохранённому запуску. Проверьте оригиналы, сохраните решения и запустите новую проверку. Изменение привязки не пересчитывает прежний результат.</p>
    {!items.length && <p>В сохранённом результате нет таких отказов. Это не подтверждает полноту проверки.</p>}
    {items.length > 0 && <>
      <p>Факты обеих стадий: {counts.BOTH_STAGES}. Одной: {counts.ONE_STAGE}. Без фактов: {counts.NO_FACTS}. Неподтверждённые ссылки или правила: {counts.INVALID}.
        Наличие фактов не подтверждает их сопоставимость, согласование или уверенность.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBlock: 16 }}>
        <label>Наличие исходных фактов<select value={view.filter} onChange={event => {
          const filter = event.target.value;
          if (["ALL", "BOTH_STAGES", "ONE_STAGE", "NO_FACTS"].includes(filter))
            onViewChange?.({ ...view, filter: filter as MatrixReviewWorkView["filter"] });
        }}>
          <option value="ALL">Все результаты</option><option value="BOTH_STAGES">Факты обеих стадий</option>
          <option value="ONE_STAGE">Факты одной стадии</option><option value="NO_FACTS">Без исходных фактов</option>
        </select></label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={view.factsFirst}
          onChange={event => onViewChange?.({ ...view, factsFirst: event.target.checked })} />Сначала с исходными фактами</label>
      </div>
      <p role="status">Показано: {visible.length} / {items.length}. Неподтверждённые ссылки и правила видны при любом фильтре.</p>
      {onSource && <MatrixReviewSourceChooser files={files} addressValid={addressValid} onSource={onSource} />}
    </>}
    {!visible.length && items.length > 0 && <p>Под выбранный фильтр результатов нет. Это не означает отсутствие ошибок.</p>}
    <div style={{ maxHeight: 640, overflowY: "auto" }}>
      {visible.map(item => <details key={item.key} style={{ borderBottom: "1px solid var(--border-subtle)", padding: "12px 0" }}>
        <summary>{item.result.parameterCode} · {item.rule?.parameterName ?? item.result.ruleId} · {item.result.comparisonVariant.replace("_", " / ")} · фактов: {item.groups.reduce((n, group) => n + group.facts.length, 0)}</summary>
        <p>Причина сохранённого результата: {item.result.reasonCode}</p>
        {item.invalidRule && <p role="status">Правило или версия результата не подтверждены установленным реестром. Действия недоступны.</p>}
        {item.groups.map(group => <section key={group.stage} aria-label={`Исходные факты ${group.stage}`}>
          <h4>{group.stage}</h4>
          {group.kind === "INVALID_REFERENCE" && <p role="status">Ссылка исходного результата не подтверждена. Автоматическая подстановка отключена.</p>}
          {group.kind === "MISSING_FACT" && <p>Нет исходного факта стадии {group.stage}. Ручная привязка не создаёт отсутствующее значение.</p>}
          {group.kind === "MATCHING_FACTS" && <p>Все подходящие факты стадии {group.stage}: {group.facts.length}. Пара автоматически не выбрана.</p>}
          {group.kind === "REFERENCED_FACT" && <p>Факт из сохранённого результата</p>}
          {group.facts.map(fact => {
            const file = matrixReviewFactSource(fact, files);
            const actionable = addressValid && !!file;
            return <article key={fact.id} style={{ padding: "8px 0", minWidth: 0 }}>
              <strong>{fact.value} {fact.unit === "rebar_catalog_example" ? "(класс)" : fact.unit}</strong>
              <p>{file?.name ?? fact.sourceFileId} · PDF {fact.pageNumber} · строка {fact.blockId}</p>
              <blockquote style={{ marginInline: 0 }}>{fact.rawText}</blockquote>
              <p><small>SHA {fact.sourceSha256}</small></p>
              {!file && <p role="status">Файл с исходным SHA не подтверждён. Действия недоступны.</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" className="button button--secondary" disabled={!actionable}
                  style={{ maxWidth: "100%", whiteSpace: "normal" }}
                  onClick={() => { if (actionable && item.rule) onSelect(fact, item.rule.ruleId); }}>Открыть факт и правило</button>
                {onSource && <button type="button" className="button button--secondary" disabled={!actionable}
                  style={{ maxWidth: "100%", whiteSpace: "normal" }}
                  onClick={() => { if (actionable && file) onSource({ id: file.id, sha256: file.sha256 }); }}>Проверить источник</button>}
              </div>
            </article>;
          })}
        </section>)}
        {item.rule && <details><summary>Условия для проверки по оригиналу</summary>
          <p>Список требований правила, а не диагноз отсутствующих подтверждений. Отмечайте условия только после проверки соответствующей строки и конструкции.</p>
          <ul>{item.rule.requiredContext.map(key => <li key={key}>{matrixFactScopeContextLabel(key) ?? key} <small>({key})</small></li>)}</ul>
        </details>}
      </details>)}
    </div>
  </section>;
}
