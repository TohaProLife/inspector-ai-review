import { api, type SiteGpContextReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "SPZU-029": "Малые архитектурные формы",
  "SPZU-032": "Конструкция дорожной одежды",
  "SPZU-033": "Организация рельефа",
  "SPZU-035": "Охранные зоны",
  "SPZU-036": "Ограждение территории",
};
const reasonLabels: Record<string, string> = {
  LEAD_NOT_VERIFIED_FACT: "Заголовок или строка не подтверждают факт и применимость",
  MAF_ITEM_IDENTITY_UNVERIFIED: "Конкретный элемент МАФ не идентифицирован",
  ROAD_LAYER_COMPOSITION_UNVERIFIED: "Состав слоёв дорожной одежды не проверен",
  SLOPE_GEOMETRY_UNVERIFIED: "Геометрия уклонов не проверена",
  ZONE_INTERSECTION_UNVERIFIED: "Пересечение с охранной зоной не проверено",
  FENCE_TYPE_HEIGHT_UNVERIFIED: "Тип и высота ограждения не проверены",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена как ПД",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  DRAWING_SECTION_UNRESOLVED: "Раздел ГП не подтверждён",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_IN_SCOPE: "Часть страниц требует отдельного OCR",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_EXACT_LINE_LEAD: "Точная строка-подсказка не найдена",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function SiteGpContextReview({ data, objectId }: {
  data: SiteGpContextReviewRead;
  objectId: string;
}) {
  const rows = data.codeRows;
  const complete = ["SPZU-029", "SPZU-032", "SPZU-033", "SPZU-035", "SPZU-036"]
    .every((code) => rows.some((row) => row.parameterCode === code)) && rows.length === 5;
  return <section className="surface" aria-label="ГП: контекстные текстовые подсказки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов · ГП</span>
      <h3>Пять кодов без подтверждённого вывода</h3>
      <p>Заголовки и строки текстового слоя сохранённого запуска помогают найти исходные листы.</p>
    </div></div>
    <p><strong>{complete ? "Все пять кодов имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Подсказки не устанавливают
      состав МАФ, конструкцию дороги, уклоны, пересечение зон или параметры ограждения.
      Здесь нет фактов, сравнения ПД/РД, замечаний или оценки охвата.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующий код не означает отсутствие
      элемента в документах.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    <div aria-label="Текстовые подсказки по пяти кодам">
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
          элемента в документах.</p>}
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
              {source && lead.sourceRole === "PD_GP_CONTEXT"
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
