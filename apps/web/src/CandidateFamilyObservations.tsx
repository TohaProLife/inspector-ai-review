import { api, type CandidateFamilyObservationsRead } from "./api";

const familyLabels: Record<string, string> = {
  CLASS_DECREASE: "Снижение класса",
  DECREASE: "Уменьшение значения",
  DIFFERENT: "Изменение значения",
  INCREASE: "Увеличение значения",
  LOWER_BOUND: "Нижняя граница",
  PRESENCE_SET: "Состав элементов",
  RELATIVE_DELTA: "Относительное изменение",
  RELATIVE_INCREASE: "Относительное увеличение",
  UPPER_BOUND: "Верхняя граница",
};

const reasonLabels: Record<string, string> = {
  AMBIGUOUS_PAGE_LABEL: "На странице несколько одинаковых подписей",
  DRAWING_SECTION_UNRESOLVED: "Раздел чертежа не подтверждён",
  FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED: "Нужно проверить смысл значения и соответствие элементов",
  LEAD_LIMIT_REACHED: "Список подсказок ограничен",
  PREVIEW_BYTE_BUDGET_REACHED: "Часть подсказок скрыта из-за ограничения размера ответа",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет проверенного источника для этого правила",
  NO_EXACT_LABEL_LEAD: "Точной подписи в прочитанных строках нет",
  OCR_REQUIRED_IN_SCOPE: "Часть страниц требует распознавания",
  SOURCE_APPROVAL_UNRESOLVED: "Согласование источника не подтверждено",
  SOURCE_PAGE_STAGE_UNRESOLVED: "Стадия части страниц не подтверждена",
  SOURCE_REVISION_SUPERSEDED: "Источник заменён новой редакцией",
  SOURCE_REVISION_UNRESOLVED: "Текущая редакция источника не подтверждена",
  SOURCE_UNAPPROVED: "Источник не согласован",
  TEXT_ARTIFACT_MISSING: "Текстовый слой источника недоступен",
};

const truncatedReasons = new Set(["LEAD_LIMIT_REACHED", "PREVIEW_BYTE_BUDGET_REACHED"]);

export function CandidateFamilyObservations({ data, objectId, parameterNames = {} }: {
  data: CandidateFamilyObservationsRead;
  objectId: string;
  parameterNames?: Record<string, string>;
}) {
  const groups = new Map<string, CandidateFamilyObservationsRead["codeRows"]>();
  const observationsByCode = new Map<string, CandidateFamilyObservationsRead["observations"]>();
  for (const row of data.codeRows) {
    groups.set(row.family, [...(groups.get(row.family) ?? []), row]);
  }
  for (const observation of data.observations) {
    observationsByCode.set(observation.parameterCode,
      [...(observationsByCode.get(observation.parameterCode) ?? []), observation]);
  }
  const truncatedCodeCount = data.codeRows.filter((row) =>
    row.reasonCodes.some((reason) => truncatedReasons.has(reason))).length;

  return <section className="surface" aria-label="Адресные наблюдения по параметрам" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Проверка документов</span><h3>Адресные наблюдения по параметрам</h3><p>Строки сверены с сохранённым текстовым слоем исходных листов.</p></div></div>
    <p><strong>Для всех {data.codeRows.length} кодов вывод не сделан.</strong> Совпадение подписи и значения в строке не доказывает, что документы описывают один элемент. Находки и покрытие параметров этим этапом не определяются.</p>
    <p>Наблюдений для просмотра: {data.outputCount}. Семейств: {groups.size}.{truncatedCodeCount > 0 ? ` Кодов с ограниченным списком подсказок: ${truncatedCodeCount}; отсутствие записи не означает отсутствие параметра.` : ""}</p>
    {Array.from(groups, ([family, rows]) => <details key={family} style={{ marginTop: "var(--space-md)" }}>
      <summary><strong>{familyLabels[family] ?? family}</strong> · кодов: {rows.length} · наблюдений: {rows.reduce((sum, row) => sum + row.observationCount, 0)}</summary>
      {rows.map((row) => {
        const observations = observationsByCode.get(row.parameterCode) ?? [];
        const truncated = row.reasonCodes.some((reason) => truncatedReasons.has(reason));
        return <details key={row.parameterCode} style={{ marginTop: "var(--space-sm)" }}>
          <summary><strong>{row.parameterCode}</strong>{parameterNames[row.parameterCode] ? ` · ${parameterNames[row.parameterCode]}` : ""} · вывод не сделан · наблюдений: {row.observationCount}{truncated ? " · список ограничен" : ""}</summary>
          <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ") || "не указаны"}.</p>
          {truncated && <p>Показаны не все подсказки. По этому списку нельзя судить о полноте документа.</p>}
          {observations.length > 0 && <div className="missing-list" aria-label={`Наблюдения ${row.parameterCode}`}>
            {observations.map((observation) => <div key={observation.observationId}>
              <span>{observation.stage}</span><div>
                <strong>{observation.matchedLabel}: {observation.rawValue}{observation.rawUnit ? ` ${observation.rawUnit}` : ""}</strong>
                <small>Источник {observation.sourceFileId} · раздел {observation.sectionCode} · страница PDF {observation.pageNumber} · блок {observation.locator.blockIndex + 1}, строка {observation.locator.lineIndex + 1}</small>
                <small>SHA-256 файла {observation.sourceSha256.slice(0, 12)}… · текстового слоя {observation.artifactSha256.slice(0, 12)}…</small>
                <p>Исходная строка: «{observation.lineText}»</p>
                <a href={api.sourcePagePreviewUrl(objectId, observation.sourceFileId, observation.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {observation.pageNumber}</a>
              </div>
            </div>)}
          </div>}
          {observations.length === 0 && <p>Наблюдений нет. Это не подтверждает отсутствие параметра в документах.</p>}
        </details>;
      })}
    </details>)}
  </section>;
}
