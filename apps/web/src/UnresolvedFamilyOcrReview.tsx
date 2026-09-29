import { api, type UnresolvedFamilyOcrReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "AR-042": "Высота путей эвакуации и проёмов",
  "IOS2-072": "Материал и класс давления труб",
  "IOS3-075": "Материал и тип канализационных труб",
};
const reasonLabels: Record<string, string> = {
  LEAD_NOT_VERIFIED_FACT: "OCR-строка не подтверждает факт или применимость",
  OCR_TEXT_REQUIRES_VISUAL_REVIEW: "Текст OCR нужно сверить с оригинальным PDF",
  SOURCE_REVIEW_REQUIRED: "Требуется проверка источника",
  SOURCE_REVIEW_NOT_CURRENT_APPROVED: "Нет подтверждения актуальной утверждённой редакции источника",
  SECTION_NOT_AR_VK: "Раздел источника не AR/VK",
  PAGE_STAGE_UNRESOLVED: "Стадия страницы не подтверждена",
  SOURCE_TOO_LARGE: "Источник превышает лимит адресного OCR",
  RENDER_PIXEL_LIMIT: "Лист превышает лимит рендера",
  PAGE_BUDGET_EXHAUSTED: "Лимит страниц адресного OCR исчерпан",
  OCR_PAGES_DEFERRED: "Часть страниц с OCR_REQUIRED отложена",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_EXACT_LINE_LEAD: "Точная OCR-строка-подсказка не найдена",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  OCR_BYTE_BUDGET_REACHED: "Пакет строк ограничен по объёму",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function UnresolvedFamilyOcrReview({ data, objectId }: {
  data: UnresolvedFamilyOcrReviewRead;
  objectId: string;
}) {
  const rows = data.codeRows;
  const complete = ["AR-042", "IOS2-072", "IOS3-075"].every((code) =>
    rows.some((row) => row.parameterCode === code)) && rows.length === 3;
  const leadCount = rows.reduce((count, row) => count + row.leads.length, 0);
  return <section className="surface" aria-label="Неразрешённые семейства: подсказки OCR v6"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Проверка исходных листов · OCR v6</span>
      <h3>Три кода без подтверждённого вывода</h3>
      <p>Адресные строки OCR из сохранённого запуска. Каждая требует сверки с оригинальным PDF.</p>
    </div></div>
    <p><strong>{complete ? "Все три кода имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> OCR может ошибиться в тексте,
      разделе или стадии. Строки не являются проверенными фактами, сравнением или замечаниями.
      Охват параметров здесь не определяется.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующий код не означает отсутствие
      параметра в документах.</p>}
    <p>Кодов в пакете: {rows.length}. OCR-строк: {leadCount}.</p>
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      OCR stage SHA-256 <code title={data.ocrStageSha256}>{shortHash(data.ocrStageSha256)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    <div aria-label="OCR-строки по трём неразрешённым кодам">
      {rows.map((row) => <details key={row.parameterCode}>
        <summary><strong>{row.parameterCode}</strong> · {codeLabels[row.parameterCode] ?? row.parameterCode} ·
          ABSTAIN · OCR-строк: {row.leads.length}</summary>
        <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
        {row.reasonCodes.some((reason) => ["OCR_PAGES_DEFERRED", "PAGE_BUDGET_EXHAUSTED",
          "LEAD_LIMIT_REACHED", "OCR_BYTE_BUDGET_REACHED"].includes(reason)) &&
          <p>Обработана только часть доступных страниц или строк. Вывод о полноте документа невозможен.</p>}
        {row.leads.length === 0 && <p>OCR-строк-подсказок нет. Это не подтверждает отсутствие
          параметра в документах.</p>}
        {row.leads.length > 0 && <div className="missing-list"
          aria-label={`OCR-строки ${row.parameterCode}`}>
          {row.leads.map((lead) => {
            const source = data.sourceStageArtifacts.find((item) =>
              item.sourceFileId === lead.sourceFileId
              && item.sourceSha256 === lead.sourceSha256
              && item.textArtifactSha256 === lead.textArtifactSha256);
            return <div key={lead.leadSha256}><span>OCR</span><div>
              <strong>«{lead.lineText}»</strong>
              <small>Источник {lead.sourceFileId} · {lead.stage} · раздел {lead.sectionCode} ·
                PDF-страница {lead.pageNumber} · OCR-строка {lead.lineIndex + 1}.</small>
              <small>Рамка на рендере: [{lead.bboxPx.join(", ")}] px ·
                оценка OCR {lead.score.toFixed(3)}.</small>
              <small>PDF SHA-256 <code title={lead.sourceSha256}>{shortHash(lead.sourceSha256)}</code> ·
                текстовый артефакт SHA-256 <code title={lead.textArtifactSha256}>{shortHash(lead.textArtifactSha256)}</code> ·
                OCR-страница SHA-256 <code title={lead.ocrPageSha256}>{shortHash(lead.ocrPageSha256)}</code> ·
                рендер SHA-256 <code title={lead.renderSha256}>{shortHash(lead.renderSha256)}</code> ·
                строка SHA-256 <code title={lead.leadSha256}>{shortHash(lead.leadSha256)}</code>.</small>
              {source && lead.ocrStageSha256 === data.ocrStageSha256
                ? <a href={api.sourceFileUrl(objectId, lead.sourceFileId)}
                  target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a>
                : <p role="status">Источник или OCR stage не совпал с пакетом. Откройте источник
                    через список файлов.</p>}
            </div></div>;
          })}
        </div>}
      </details>)}
    </div>
  </section>;
}
