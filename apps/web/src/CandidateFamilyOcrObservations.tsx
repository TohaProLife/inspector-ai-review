import { api, type CandidateFamilyOcrObservationsRead } from "./api";

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
  FACT_ENTITY_AND_COMPARISON_REVIEW_REQUIRED: "Нужно проверить смысл значения и соответствие элементов",
  LEAD_LIMIT_REACHED: "Список подсказок ограничен",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет проверенного источника для этого правила",
  NO_EXACT_OCR_LABEL_LEAD: "Точной подписи в прочитанных строках OCR нет",
  OCR_BYTE_BUDGET_REACHED: "Часть подсказок скрыта из-за ограничения размера ответа",
  OCR_DEFERRED_IN_SCOPE: "Часть страниц ожидает OCR",
  SOURCE_APPROVAL_UNRESOLVED: "Согласование источника не подтверждено",
  SOURCE_PAGE_STAGE_UNRESOLVED: "Стадия части страниц не подтверждена",
  SOURCE_REVISION_SUPERSEDED: "Источник заменён новой редакцией",
  SOURCE_REVISION_UNRESOLVED: "Текущая редакция источника не подтверждена",
  SOURCE_UNAPPROVED: "Источник не согласован",
  TEXT_ARTIFACT_MISSING: "Текстовый слой источника недоступен",
};

const limitedReasons = new Set(["LEAD_LIMIT_REACHED", "OCR_BYTE_BUDGET_REACHED"]);

const shortHash = (hash: string) => `${hash.slice(0, 12)}…`;

export function CandidateFamilyOcrObservations({ data, objectId, parameterNames = {} }: {
  data: CandidateFamilyOcrObservationsRead;
  objectId: string;
  parameterNames?: Record<string, string>;
}) {
  const groups = new Map<string, CandidateFamilyOcrObservationsRead["codeRows"]>();
  for (const row of data.codeRows) {
    groups.set(row.family, [...(groups.get(row.family) ?? []), row]);
  }
  const leadCount = data.codeRows.reduce((sum, row) => sum + row.leadCount, 0);
  const codeCountWithLeads = data.codeRows.filter((row) => row.leadCount > 0).length;
  const limitedCodeCount = data.codeRows.filter((row) => row.reasonCodes.some((reason) => limitedReasons.has(reason))).length;
  const sortedGroups = [...groups].sort((left, right) =>
    right[1].reduce((sum, row) => sum + row.leadCount, 0)
      - left[1].reduce((sum, row) => sum + row.leadCount, 0));

  return <section className="surface" aria-label="Адресные OCR-подсказки" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Проверка документов</span><h3>Адресные OCR-подсказки</h3><p>Строки из сохранённой OCR-стадии этого запуска.</p></div></div>
    <p><strong>Для всех {data.codeRows.length} кодов вывод не сделан (ABSTAIN).</strong> OCR-подсказка требует проверки на исходном листе. Она не является подтверждённым фактом или находкой; покрытие параметров здесь не определяется.</p>
    <details>
      <summary>Просмотреть OCR-подсказки: {leadCount} · кодов с подсказками: {codeCountWithLeads} · семейств: {groups.size}</summary>
      <p>Каждое семейство содержит отдельные строки по кодам. Счётчики страниц относятся к каждому коду; один лист может учитываться в нескольких кодах.</p>
      <p>Сохранённый OCR SHA-256 <code title={data.ocrArtifactSha256}>{shortHash(data.ocrArtifactSha256)}</code> · manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
      {limitedCodeCount > 0 && <p>Список подсказок ограничен для {limitedCodeCount} кодов. Отсутствие записи не подтверждает отсутствие параметра.</p>}
      {sortedGroups.map(([family, rows]) => {
        const familyLeadCount = rows.reduce((sum, row) => sum + row.leadCount, 0);
        const sortedRows = [...rows].sort((left, right) => right.leadCount - left.leadCount);
        return <details key={family} style={{ marginTop: "var(--space-md)" }}>
          <summary><strong>{familyLabels[family] ?? family}</strong> · кодов: {rows.length} · подсказок: {familyLeadCount}</summary>
          {sortedRows.map((row) => {
            const limited = row.reasonCodes.some((reason) => limitedReasons.has(reason));
            return <details key={row.parameterCode} style={{ marginTop: "var(--space-sm)" }}>
              <summary><strong>{row.parameterCode}</strong>{parameterNames[row.parameterCode] ? ` · ${parameterNames[row.parameterCode]}` : ""} · ABSTAIN · подсказок: {row.leadCount}{limited ? " · список ограничен" : ""}</summary>
              <p>Обработано OCR-страниц: {row.ocrProcessedPageCount}. Ожидают OCR: {row.ocrDeferredPageCount}. Подходящих проверенных источников: {row.eligibleSourceCount}.</p>
              <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ") || "не указаны"}.</p>
              {limited && <p>Показаны не все подсказки. По этому списку нельзя судить о полноте документа.</p>}
              {row.candidateLeads.length > 0 && <div className="missing-list" aria-label={`OCR-подсказки ${row.parameterCode}`}>
                {row.candidateLeads.map((lead) => <div key={lead.leadSha256}>
                  <span>{lead.stage}</span><div>
                    <strong>{lead.matchedLabel}: {lead.rawValue}{lead.rawUnit ? ` ${lead.rawUnit}` : ""}</strong>
                    <small>Источник {lead.sourceFileId} · раздел {lead.sectionCode} · страница PDF {lead.pageNumber} · OCR-строка {lead.locator.lineIndex + 1} · оценка OCR {lead.locator.score.toFixed(3)}</small>
                    <small>Рамка OCR [{lead.locator.bboxPx.join(", ")}] · координаты изображения: {lead.coordinateSystem} · {lead.locator.widthPx} × {lead.locator.heightPx} px · {lead.locator.dpi} DPI</small>
                    <small>SHA-256 файла <code title={lead.sourceSha256}>{shortHash(lead.sourceSha256)}</code> · OCR-страницы <code title={lead.ocrPageSha256}>{shortHash(lead.ocrPageSha256)}</code> · рендера <code title={lead.locator.renderSha256}>{shortHash(lead.locator.renderSha256)}</code> · подсказки <code title={lead.leadSha256}>{shortHash(lead.leadSha256)}</code></small>
                    <p>Исходная OCR-строка: «{lead.lineText}»</p>
                    <a href={api.sourcePagePreviewUrl(objectId, lead.sourceFileId, lead.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {lead.pageNumber}</a>
                  </div>
                </div>)}
              </div>}
              {row.candidateLeads.length === 0 && <p>OCR-подсказок нет. Это не подтверждает отсутствие параметра в документах.</p>}
            </details>;
          })}
        </details>;
      })}
    </details>
  </section>;
}
