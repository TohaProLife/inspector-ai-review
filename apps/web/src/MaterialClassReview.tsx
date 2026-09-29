import { api, type MaterialClassReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "KR-056": "Класс стали",
  "KR-057": "Класс арматуры",
  "KR-066": "Огнестойкость и огнезащита",
};
const kindLabels: Record<string, string> = {
  TABLE_HEADING_UNLINKED: "заголовок таблицы без привязки к элементу",
  GENERAL_REQUIREMENT_UNLINKED: "общее требование без привязки к элементу",
  SHEET_NOTE_UNLINKED: "примечание листа без привязки к элементу",
  ELEMENT_CONTEXT_UNVERIFIED: "упоминание с непроверенным контекстом элемента",
  FIRE_CONTEXT_AMBIGUOUS: "смешанный контекст огнестойкости и огнезащиты",
  PROTECTION_COMPOSITION_MENTION_UNVERIFIED: "упоминание состава или толщины огнезащиты",
  PROTECTION_MENTION_UNVERIFIED: "упоминание огнезащиты",
  FIRE_RATING_REQUIREMENT: "требование к пределу огнестойкости",
  FIRE_RATING_CONTEXT_UNRESOLVED: "упоминание огнестойкости с неясным контекстом",
};
const reasonLabels: Record<string, string> = {
  LEXICAL_NAVIGATION_ONLY: "Слово служит только для поиска в документе",
  ELEMENT_IDENTITY_UNVERIFIED: "Конструктивный элемент не идентифицирован",
  PD_RD_PAIR_UNVERIFIED: "Пара ПД/РД не подтверждена",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  DRAWING_SECTION_UNRESOLVED: "Раздел КР не подтверждён",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_IN_SCOPE: "Часть страниц требует отдельного OCR",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_EXACT_LINE_LEAD: "Точная строка-подсказка не найдена",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function MaterialClassReview({ data, objectId }: {
  data: MaterialClassReviewRead;
  objectId: string;
}) {
  const complete = ["KR-056", "KR-057", "KR-066"].every((code) =>
    data.codeRows.some((row) => row.parameterCode === code)) && data.codeRows.length === 3;
  const sourceMatches = (sourceFileId: string, sourceSha256: string,
    textArtifactSha256: string) => data.sourceStageArtifacts.some((item) =>
    item.sourceFileId === sourceFileId && item.sourceSha256 === sourceSha256
    && item.textArtifactSha256 === textArtifactSha256);
  return <section className="surface" aria-label="КР: материалы и огнезащита"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов · КР</span>
      <h3>Материалы и огнезащита: три кода без подтверждённого вывода</h3>
    </div></div>
    <p><strong>{complete ? "Все три кода имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Категория строки определяется
      только по словам. Привязка к элементу и сопоставление между файлами не проверены.
      Фактическая огнезащита: <strong>NOT_ESTABLISHED</strong>. Факты, сравнение, замечания
      и охват не сформированы.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующий код не означает отсутствие
      материала или огнезащиты в документах.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    {data.codeRows.map((row) => <details key={row.parameterCode}>
      <summary><strong>{row.parameterCode}</strong> · {codeLabels[row.parameterCode]} ·
        ABSTAIN · строк-подсказок: {row.leadCount}</summary>
      <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
      <p>В рамках выбранных источников: подходящих источников {row.eligibleSourceCount};
        страниц с кандидатом текстового слоя {row.textCandidatePageCount};
        страниц, требующих OCR, {row.ocrRequiredPageCount}.</p>
      {row.parameterCode === "KR-066" && <p>Фактическая огнезащита: NOT_ESTABLISHED.</p>}
      {row.leadCount > row.leads.length && <p>Показано {row.leads.length} из {row.leadCount}
        строк-подсказок. По списку нельзя судить о полноте документа.</p>}
      {row.leads.length === 0 && <p>Строк-подсказок нет. Это не подтверждает отсутствие
        класса материала или огнезащиты на листах.</p>}
      {row.leads.length > 0 && <div className="missing-list"
        aria-label={`Текстовые подсказки ${row.parameterCode}`}>
        {row.leads.map((lead) => <div key={lead.leadSha256}><span>{lead.sourceStage}</span><div>
          <strong>«{lead.lineText}»</strong>
          <small>Лексическая категория: {kindLabels[lead.leadKind] ?? lead.leadKind}
            {" "}({lead.leadKind}). Элемент: {lead.elementAssociationStatus};
            сопоставление файлов: {lead.crossFileMatchStatus}.</small>
          {lead.actualProtectionStatus && <small>Фактическая огнезащита:
            {" "}{lead.actualProtectionStatus}.</small>}
          <small>Источник {lead.sourceFileId} · {lead.sourceStage}/КР ·
            PDF-страница {lead.pageNumber} · текстовый блок {lead.blockIndex + 1} ·
            строка {lead.lineIndex + 1}.</small>
          <small>Рамка блока: [{lead.bboxMilliPoints.join(", ")}]
            координат PDF ×1000.</small>
          <small>PDF SHA-256 <code title={lead.sourceSha256}>{shortHash(lead.sourceSha256)}</code> ·
            текстовый артефакт SHA-256 <code title={lead.textArtifactSha256}>{shortHash(lead.textArtifactSha256)}</code> ·
            блок SHA-256 <code title={lead.blockTextSha256}>{shortHash(lead.blockTextSha256)}</code> ·
            строка SHA-256 <code title={lead.lineTextSha256}>{shortHash(lead.lineTextSha256)}</code> ·
            подсказка SHA-256 <code title={lead.leadSha256}>{shortHash(lead.leadSha256)}</code>.</small>
          {sourceMatches(lead.sourceFileId, lead.sourceSha256,
            lead.textArtifactSha256) && lead.sourceRole === "KR_MATERIAL_NAVIGATION"
            ? <p><a href={api.sourcePagePreviewUrl(objectId, lead.sourceFileId,
              lead.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть лист PDF</a>
              {" · "}<a href={api.sourceFileUrl(objectId, lead.sourceFileId)}
                target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a></p>
            : <p role="status">Источник строки не совпал с пакетом. Откройте источник
                через список файлов.</p>}
        </div></div>)}
      </div>}
    </details>)}
  </section>;
}
