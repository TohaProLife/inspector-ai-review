import { api, type UnresolvedFamilyReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "AR-042": "Высота путей эвакуации и проёмов",
  "IOS2-072": "Материал и класс давления труб",
  "IOS3-075": "Материал и тип канализационных труб",
};
const reasonLabels: Record<string, string> = {
  SOURCE_REVIEW_REQUIRED: "Нужно проверить редакцию и согласование источника",
  DRAWING_SECTION_UNRESOLVED: "Раздел чертежа не подтверждён",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый слой недоступен",
  OCR_REQUIRED_IN_SCOPE: "На части нужных страниц требуется адресный OCR",
  NO_EXACT_LINE_LEAD: "Точной строки-подсказки нет",
  LEAD_NOT_VERIFIED_FACT: "Строка требует проверки смысла и применимости",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function UnresolvedFamilyReview({ data, objectId }: {
  data: UnresolvedFamilyReviewRead;
  objectId: string;
}) {
  const rows = data.codeRows;
  const leads = rows.reduce((sum, row) => sum + row.leads.length, 0);
  const expected = ["AR-042", "IOS2-072", "IOS3-075"];
  const complete = expected.every((code) => rows.some((row) => row.parameterCode === code))
    && rows.length === expected.length;
  return <section className="surface" aria-label="Неразрешённые семейства: текстовые подсказки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов</span>
      <h3>Три кода без подтверждённого вывода</h3>
      <p>Высоты эвакуации и материалы труб: строки текстового слоя из сохранённого запуска.</p>
    </div></div>
    <p><strong>{complete ? "Все три кода имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Строки требуют проверки на исходном PDF.
      Они не являются фактом, сравнением или замечанием. Охват параметров здесь не определяется.</p>
    {!complete && <p role="status">Пакет строк неполный. Отсутствующий код не означает отсутствие параметра в документах.</p>}
    <p>Кодов в пакете: {rows.length}. Строк-подсказок: {leads}. Источников с текстовым слоем:
      {data.sourceStageArtifacts.length}.</p>
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    <div aria-label="Строки по трём неразрешённым кодам">
      {rows.map((row) => <details key={row.parameterCode}>
        <summary><strong>{row.parameterCode}</strong> · {codeLabels[row.parameterCode] ?? row.parameterCode} ·
          ABSTAIN · строк-подсказок: {row.leads.length}</summary>
        <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")
          || "не указаны"}.</p>
        {row.reasonCodes.includes("LEAD_LIMIT_REACHED") &&
          <p>Список ограничен. По нему нельзя судить о полноте документа.</p>}
        {row.leads.length === 0 &&
          <p>Строк-подсказок нет. Это не подтверждает отсутствие параметра на чертежах.</p>}
        {row.leads.length > 0 && <div className="missing-list"
          aria-label={`Строки-подсказки ${row.parameterCode}`}>
          {row.leads.map((lead) => {
            const source = data.sourceStageArtifacts.find((item) =>
              item.sourceFileId === lead.sourceFileId && item.sourceSha256 === lead.sourceSha256
              && item.textArtifactSha256 === lead.textArtifactSha256);
            return <div key={lead.leadSha256}>
              <span>PDF</span><div>
                <strong>«{lead.lineText}»</strong>
                <small>Источник {lead.sourceFileId} · PDF-страница {lead.pageNumber} ·
                  текстовый блок {lead.blockIndex + 1} · строка {lead.lineIndex + 1}.</small>
                <small>Рамка строки: [{lead.bboxMilliPoints.join(", ")}] координат PDF ×1000.</small>
                <small>PDF SHA-256 <code title={lead.sourceSha256}>{shortHash(lead.sourceSha256)}</code> ·
                  текстовый артефакт SHA-256 <code title={lead.textArtifactSha256}>{shortHash(lead.textArtifactSha256)}</code> ·
                  блок SHA-256 <code title={lead.blockTextSha256}>{shortHash(lead.blockTextSha256)}</code> ·
                  строка-подсказка SHA-256 <code title={lead.leadSha256}>{shortHash(lead.leadSha256)}</code>.</small>
                {source ? <a href={api.sourcePagePreviewUrl(objectId, lead.sourceFileId, lead.pageNumber)}
                  target="_blank" rel="noopener noreferrer">Открыть исходный лист {lead.pageNumber}</a>
                  : <p role="status">Сохранённый источник строки не совпал с пакетом. Откройте источник через список файлов.</p>}
              </div>
            </div>;
          })}
        </div>}
      </details>)}
    </div>
  </section>;
}
