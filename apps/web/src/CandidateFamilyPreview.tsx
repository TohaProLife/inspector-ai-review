import type { CandidateFamilyPreviewRead } from "./api";
import { api } from "./api";

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
  LEAD_LIMIT_REACHED: "Показаны не все совпадения",
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

export function CandidateFamilyPreview({ data, objectId, parameterNames = {} }: {
  data: CandidateFamilyPreviewRead;
  objectId: string;
  parameterNames?: Record<string, string>;
}) {
  const groups = new Map<string, CandidateFamilyPreviewRead["codeRows"]>();
  for (const row of data.codeRows) {
    groups.set(row.family, [...(groups.get(row.family) ?? []), row]);
  }
  const leadCount = data.codeRows.reduce((total, row) => total + row.leadCount, 0);
  return <section className="surface" aria-label="Подсказки по семействам параметров" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Проверка документов</span><h3>Подсказки по семействам параметров</h3><p>Поиск ограничен прочитанными строками документов.</p></div></div>
    <p><strong>Кодов без вывода: {data.codeRows.length}.</strong> Эти подсказки помогают открыть исходный лист. Они не подтверждают факт, расхождение, отсутствие элемента или покрытие параметра.</p>
    <p>Подсказок для просмотра: {leadCount}. Семейств: {groups.size}.</p>
    {Array.from(groups, ([family, rows]) => <details key={family} style={{ marginTop: "var(--space-md)" }}>
      <summary><strong>{familyLabels[family] ?? family}</strong> · кодов: {rows.length} · подсказок: {rows.reduce((sum, row) => sum + row.leadCount, 0)}</summary>
      {rows.map((row) => <details key={row.parameterCode} style={{ marginTop: "var(--space-sm)" }}>
        <summary><strong>{row.parameterCode}</strong>{parameterNames[row.parameterCode] ? ` · ${parameterNames[row.parameterCode]}` : ""} · вывод не сделан · подсказок: {row.leadCount}</summary>
        <p>Прочитано страниц с текстовым слоем: {row.textScannedPageCount}. Страниц для OCR: {row.ocrRequiredPageCount}. Подходящих проверенных источников: {row.eligibleSourceCount}.</p>
        <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ") || "не указаны"}.</p>
        {row.candidateLeads.length > 0 && <div className="missing-list" aria-label={`Подсказки ${row.parameterCode}`}>
          {row.candidateLeads.map((lead) => <div key={lead.leadSha256}>
            <span>{lead.stage}</span><div>
              <strong>{lead.matchedLabel}: {lead.rawValue}{lead.rawUnit ? ` ${lead.rawUnit}` : ""}</strong>
              <small>Источник {lead.sourceFileId} · страница PDF {lead.pageNumber} · SHA-256 {lead.sourceSha256.slice(0, 12)}…</small>
              <p>{lead.lineText}</p>
              <a href={api.sourcePagePreviewUrl(objectId, lead.sourceFileId, lead.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {lead.pageNumber}</a>
            </div>
          </div>)}
        </div>}
        {row.candidateLeads.length === 0 && <p>Подсказок нет. Это не подтверждает отсутствие параметра в документах.</p>}
      </details>)}
    </details>)}
  </section>;
}
