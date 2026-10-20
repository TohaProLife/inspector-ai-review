import type { MatrixFactReviewPreflight as RecordedState } from "./matrix-fact-review-preflight";
import { matrixFactScopeContextLabel } from "./MatrixFactScopeEditor";

export interface MatrixFactReviewPreflightProps {
  value: RecordedState;
  onSource?: (file: { id: string; sha256: string }) => void;
  disabled?: boolean;
}

/** Pure presentation of selected stored fields, never a server qualification. */
export function MatrixFactReviewPreflight({ value, onSource, disabled = false }: MatrixFactReviewPreflightProps) {
  if (value.status === "INVALID_INPUT") return <section aria-label="Что записано для выбранного факта" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <h4>Что записано для выбранного факта</h4>
    <p role="alert">Нельзя сопоставить загруженное решение с выбранным фактом: {value.invalidReason}. Перезагрузите решение и адрес исходного факта. Это ошибка идентичности или структуры, а не отсутствие человеческого подтверждения.</p>
  </section>;
  const navigate = value.sourceNavigation;
  return <section aria-label="Что записано для выбранного факта" style={{ minWidth: 0, overflowWrap: "anywhere", marginBlock: 16 }}>
    <h4>Что записано для выбранного факта</h4>
    <p>Правило {value.rule?.parameterCode} · {value.rule?.ruleId} · версия {value.rule?.version}. Это описание сохранённых полей, а не повторное машинное сравнение.</p>
    <div><h5>Сохранённый запуск</h5>
      <p>{value.savedRun.checkId} · Хеш результата <code>{value.savedRun.executionContentHash}</code></p>
      <p>Причина сохранённого результата: {value.savedRun.reasonCode ?? "для выбранной строки не установлена"}.</p>
      <p>Результат запуска не меняется при редактировании привязки. Для применения сохранённых решений нужен новый запуск.</p>
    </div>
    <div><h5>Последнее загруженное решение по источнику</h5>
      <p>Хеш решения: {value.latestReviewContentHash ? <code>{value.latestReviewContentHash}</code> : "не записано"}. Изменения черновика здесь не учитываются.</p>
      <p>Редакция: {value.sourceRevision} · Согласование: {value.sourceApproval}.</p>
      {value.sourceRevision === "UNKNOWN" && <p>Актуальность редакции не установлена. Нужна отдельная проверка исходного документа.</p>}
      {value.sourceApproval === "UNKNOWN" && <p>Согласование не установлено. Сохранение привязки строки не подтверждает согласование источника.</p>}
      <p>Раздел источника: {value.sourceSection ?? "не записан"}. Разделы выбранного правила для этой стадии: {value.allowedSectionsForSelectedStage.join(", ") || "не установлены"}.</p>
      {value.rowSectionOverride && <p>Для исходной строки отдельно записан раздел {value.rowSectionOverride.drawingSection} · {value.rowSectionOverride.status}. Семантическая применимость здесь не проверялась.</p>}
      {!value.sourceSection && !value.rowSectionOverride && <p>Раздел требует отдельного решения по оригиналу или исходной строке. Название файла его не подтверждает.</p>}
      <p>Группа связи: {value.linkGroup.value ?? "не записана"} · {value.linkGroup.status}. Относится только к выбранному источнику.</p>
    </div>
    <div><h5>Привязка выбранной строки</h5>
      <p>{value.binding.status}{value.binding.entityKey ? ` · Ключ элемента: ${value.binding.entityKey}` : ""}</p>
      {value.binding.origin && <p>Исходный адрес привязки: {value.binding.origin.checkId} · <code>{value.binding.origin.executionContentHash}</code> · Факт <code>{value.binding.origin.observationId}</code>.</p>}
      {value.binding.status === "MATCHED_BY_OBSERVATION_EVIDENCE_AND_TEXT_HASH" && <p>Привязка из прежнего запуска: совпали адрес факта, доказательство и полный текст. Другой исходный запуск сам по себе не означает устаревшую привязку.</p>}
      {value.binding.status === "EVIDENCE_MISMATCH_NOT_APPLIED" && <p>Привязка относится к другому доказательству или тексту. Её условия не отнесены к текущему факту; проверьте текущий оригинал.</p>}
      {value.legacyWarning && <p>Сохранена прежняя общая область файла. Она не является привязкой выбранной строки. Её замена требует отдельного явного подтверждения существующей формы.</p>}
      <ul>{value.requiredContexts.map(context => <li key={context.key}>
        {matrixFactScopeContextLabel(context.key) ?? context.key} · <code>{context.key}</code>: {context.status === "RECORDED" ? "записано" : "не записано"} ({context.status}).
      </li>)}</ul>
      <p>Наличие ключа означает только запись поля. Смысл условий: {value.semanticContextStatus}. Совпадение конструкции, нормативная применимость и пригодность пары здесь не проверялись.</p>
      <p>Контекст таблицы: {value.tableContext.status}. Совпадение хеша — запись о выбранных фрагментах, а не подтверждение всех условий таблицы.</p>
    </div>
    {value.authority.status !== "NOT_REQUIRED_BY_SELECTED_RULE" && <div><h5>Основание проектного нуля</h5>
      <p>{value.authority.status}.</p>
      {value.authority.pointer && <p>Типизированная ссылка записана: {value.authority.pointer.kind} · Источник {value.authority.pointer.sourceFileId} · SHA <code>{value.authority.pointer.sourceSha256}</code> · PDF {value.authority.pointer.pageNumber}.
        Хеш решения ПД: <code>{value.authority.pointer.reviewContentHash ?? "в собственной декларации ПД не указывается"}</code>.</p>}
      <p>Актуальность основания ПД и применимость ссылки к паре здесь не проверялись. Равенство отметок и предварительная координатная привязка листа не создают геодезического основания.</p>
    </div>}
    <p>Другая стадия: {value.counterpart} · не проверялась. Пара автоматически не выбрана. Полнота области, уверенность и геопривязка этим описанием не подтверждаются.</p>
    {navigate && onSource ? <button type="button" className="button button--secondary" disabled={disabled}
      style={{ maxWidth: "100%", whiteSpace: "normal" }} onClick={() => { if (!disabled) onSource({ ...navigate }); }}>Проверить отдельные решения по источнику</button>
      : <p>Переход к источнику недоступен: нужен файл с точными ID и SHA выбранного факта и доступное действие просмотра.</p>}
    <p>Источник {value.sourceFileId} · SHA <code>{value.sourceSha256}</code>. Частичную привязку можно сохранить отдельно; решения по источнику автоматически не назначаются.</p>
  </section>;
}
