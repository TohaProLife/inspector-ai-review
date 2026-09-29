import { api, type SiteTepAreaReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "PZ-001": "Площадь застройки",
  "SPZU-026": "Площадь покрытий",
  "SPZU-027": "Площадь озеленения",
};
const reasonLabels: Record<string, string> = {
  LEAD_NOT_VERIFIED_FACT: "Табличная подпись не подтверждает значение или применимость",
  PAVING_MATERIAL_UNRESOLVED: "По общей подписи покрытий нельзя определить материал",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена как ПД",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  DRAWING_SECTION_UNRESOLVED: "Раздел ГП не подтверждён",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_IN_SCOPE: "Часть страниц требует отдельного OCR",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_EXACT_LINE_LEAD: "Точная строка табличной подписи не найдена",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function SiteTepAreaReview({ data, objectId }: {
  data: SiteTepAreaReviewRead;
  objectId: string;
}) {
  const rows = data.codeRows;
  const complete = ["PZ-001", "SPZU-026", "SPZU-027"].every((code) =>
    rows.some((row) => row.parameterCode === code)) && rows.length === 3;
  return <section className="surface" aria-label="ГП ТЭП: табличные подсказки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов · ГП ТЭП</span>
      <h3>Площади участка: три кода без подтверждённого вывода</h3>
      <p>Строки-подписи текстового слоя сохранённого запуска, без извлечения значений.</p>
    </div></div>
    <p><strong>{complete ? "Все три кода имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Подписи помогают найти место
      на исходном PDF. Значения площадей, материалы покрытий, идентичность листов и сравнение
      ПД/РД требуют отдельной проверки. Здесь нет фактов, замечаний или оценки охвата.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующий код не означает отсутствие
      строки в документах.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    <div aria-label="Табличные подсказки по трём кодам">
      {rows.map((row) => <details key={row.parameterCode}>
        <summary><strong>{row.parameterCode}</strong> · {codeLabels[row.parameterCode] ?? row.parameterCode} ·
          ABSTAIN · строк-подсказок: {row.leadCount}</summary>
        <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
        <p>В рамках выбранных источников: подходящих источников {row.eligibleSourceCount};
          страниц с кандидатом текстового слоя {row.textCandidatePageCount};
          страниц, требующих OCR, {row.ocrRequiredPageCount}.</p>
        {row.leadCount > row.leads.length && <p>Показано {row.leads.length} из {row.leadCount}
          строк-подсказок. По списку нельзя судить о полноте документа.</p>}
        {row.leads.length === 0 && <p>Строк-подсказок нет. Это не подтверждает отсутствие
          параметра в документах.</p>}
        {row.leads.length > 0 && <div className="missing-list"
          aria-label={`Строки-подсказки ${row.parameterCode}`}>
          {row.leads.map((lead) => {
            const source = data.sourceStageArtifacts.find((item) =>
              item.sourceFileId === lead.sourceFileId
              && item.sourceSha256 === lead.sourceSha256
              && item.textArtifactSha256 === lead.textArtifactSha256);
            return <div key={lead.leadSha256}><span>ПД</span><div>
              <strong>«{lead.lineText}»</strong>
              <small>Источник {lead.sourceFileId} · ПД/ГП · PDF-страница {lead.pageNumber} ·
                текстовый блок {lead.blockIndex + 1} · строка {lead.lineIndex + 1}.</small>
              <small>Рамка блока: [{lead.bboxMilliPoints.join(", ")}]
                координат PDF ×1000.</small>
              <small>PDF SHA-256 <code title={lead.sourceSha256}>{shortHash(lead.sourceSha256)}</code> ·
                текстовый артефакт SHA-256 <code title={lead.textArtifactSha256}>{shortHash(lead.textArtifactSha256)}</code> ·
                блок SHA-256 <code title={lead.blockTextSha256}>{shortHash(lead.blockTextSha256)}</code> ·
                строка-подсказка SHA-256 <code title={lead.leadSha256}>{shortHash(lead.leadSha256)}</code>.</small>
              {source && lead.sourceRole === "PD_GP_TEP"
                ? <a href={api.sourceFileUrl(objectId, lead.sourceFileId)}
                  target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a>
                : <p role="status">Сохранённый источник строки не совпал с пакетом.
                    Откройте источник через список файлов.</p>}
            </div></div>;
          })}
        </div>}
      </details>)}
    </div>
  </section>;
}
