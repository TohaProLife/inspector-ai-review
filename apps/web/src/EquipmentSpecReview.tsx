import { api, type EquipmentSpecReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "IOS4-077": "Отопительное оборудование",
  "IOS4-079": "Вентиляционное оборудование",
  "PPM-112": "Противодымная вентиляция",
};
const kindLabels: Record<string, string> = {
  SCHEDULE_TOKEN: "ведомость / спецификация",
  CALCULATION_PROSE: "текст расчёта",
  REGISTER_PROSE: "реестр / история изменений",
  CONTEXT_UNRESOLVED: "контекст не определён",
};
const reasonLabels: Record<string, string> = {
  LEXICAL_NAVIGATION_ONLY: "Слово служит только для поиска в документе",
  ROW_ASSOCIATION_UNVERIFIED: "Принадлежность строки позиции оборудования не проверена",
  PD_RD_PAIR_UNVERIFIED: "Пара ПД/РД не подтверждена",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  DRAWING_SECTION_UNRESOLVED: "Раздел ОВ не подтверждён",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_IN_SCOPE: "Часть страниц требует отдельного OCR",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_EXACT_LINE_LEAD: "Точная строка-подсказка не найдена",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function EquipmentSpecReview({ data, objectId }: {
  data: EquipmentSpecReviewRead;
  objectId: string;
}) {
  const complete = ["IOS4-077", "IOS4-079", "PPM-112"].every((code) =>
    data.codeRows.some((row) => row.parameterCode === code)) && data.codeRows.length === 3;
  const sourceMatches = (sourceFileId: string, sourceSha256: string,
    textArtifactSha256: string) => data.sourceStageArtifacts.some((item) =>
    item.sourceFileId === sourceFileId && item.sourceSha256 === sourceSha256
    && item.textArtifactSha256 === textArtifactSha256);
  return <section className="surface" aria-label="Оборудование ОВ: текстовые подсказки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов · ОВ</span>
      <h3>Оборудование: три кода без подтверждённого вывода</h3>
      <p>Строки помогают найти место в исходном PDF. Контекст ведомости, расчёта и реестра разделён.</p>
    </div></div>
    <p><strong>{complete ? "Все три кода имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Строка не подтверждает модель,
      мощность, расход, давление, количество, систему или пару ПД/РД.
      Принадлежность строке оборудования и назначение системе не проверены.
      Факты, сравнение, замечания и охват не сформированы.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующий код не означает отсутствие
      оборудования в документах.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    {data.codeRows.map((row) => <details key={row.parameterCode}>
      <summary><strong>{row.parameterCode}</strong> · {codeLabels[row.parameterCode]} ·
        ABSTAIN · строк-подсказок: {row.leadCount}</summary>
      <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
      <p>В рамках выбранных источников: подходящих источников {row.eligibleSourceCount};
        страниц с кандидатом текстового слоя {row.textCandidatePageCount};
        страниц, требующих OCR, {row.ocrRequiredPageCount}.</p>
      {row.leadCount > row.leads.length && <p>Показано {row.leads.length} из {row.leadCount}
        строк-подсказок. По списку нельзя судить о полноте документа.</p>}
      {row.leads.length === 0 && <p>Строк-подсказок нет. Это не подтверждает отсутствие
        оборудования или параметра на листах.</p>}
      {row.leads.length > 0 && <div className="missing-list"
        aria-label={`Текстовые подсказки ${row.parameterCode}`}>
        {row.leads.map((lead) => <div key={lead.leadSha256}><span>{lead.sourceStage}</span><div>
          <strong>«{lead.lineText}»</strong>
          <small>Тип подсказки: {kindLabels[lead.leadKind] ?? lead.leadKind}
            {" "}({lead.leadKind}). Строка и система: UNVERIFIED.</small>
          <small>Источник {lead.sourceFileId} · {lead.sourceStage}/ОВ ·
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
            lead.textArtifactSha256) && lead.sourceRole === "OV_EQUIPMENT_NAVIGATION"
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
