import { api, type UnresolvedConfigReviewRead } from "./api";

const expectedCodes = ["PZ-003", "PZ-011", "PZ-019", "PZ-020", "SPZU-027", "SPZU-028",
  "AR-046", "PZ-005", "SPZU-031", "SPZU-033", "AR-042", "AR-047", "AR-048",
  "AR-051", "KR-060", "POS-084", "ODI-116", "ODI-117", "ODI-119"];
const familyLabels: Record<string, string> = {
  AREA_PROGRAM: "площадь и программа",
  DIMENSION_LAYOUT: "размеры и планировка",
};
const reasonLabels: Record<string, string> = {
  CONFIG_PINNED_REVIEW_ONLY: "Конфигурация допускает только просмотр",
  ELEMENT_OR_SPACE_UNVERIFIED: "Элемент или помещение не идентифицированы",
  PD_RD_PAIR_UNVERIFIED: "Пара ПД/РД не подтверждена",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена",
  PAGE_STAGE_UNRESOLVED_DEFERRED: "Страницы с неподтверждённой стадией отложены",
  PAGE_STAGE_MAP_INCOMPLETE: "Для части страниц не указана стадия",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  SOURCE_ROLE_NOT_ALLOWED: "Раздел или стадия источника не подходят для кода",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_DEFERRED: "Страницы с OCR_REQUIRED отложены",
  OVERSIZE_ANCHOR_LINE_DEFERRED: "Слишком длинные строки с опорным словом отложены",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_SCANNED_TEXT_IN_SCOPE: "Нет просмотренного текста в подходящих проверенных источниках",
  NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT: "В просмотренном тексте строка-подсказка не найдена",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function UnresolvedConfigReview({ data, objectId }: {
  data: UnresolvedConfigReviewRead;
  objectId: string;
}) {
  const complete = data.codeRows.length === expectedCodes.length
    && expectedCodes.every((code) => data.codeRows.some((row) => row.parameterCode === code));
  const sourceMatches = (sourceFileId: string, sourceSha256: string,
    textArtifactSha256: string) => data.sourceStageArtifacts.some((item) =>
    item.sourceFileId === sourceFileId && item.sourceSha256 === sourceSha256
    && item.textArtifactSha256 === textArtifactSha256);
  return <section className="surface" aria-label="Неразрешённые коды: текстовые подсказки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов</span>
      <h3>Неразрешённые коды: адресные строки текста</h3>
      <p>Сохранённый запуск и закреплённая конфигурация. Строки помогают открыть исходный лист.</p>
    </div></div>
    <p><strong>{complete ? "Все 19 кодов имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Совпадение слов не подтверждает
      элемент, помещение, размер, площадь, пару ПД/РД или применимую норму.
      Отсутствие строки в просмотренном тексте не означает отсутствие параметра.
      Факты, замечания и охват не сформированы.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующие коды нельзя оценивать
      по этому списку.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      конфигурация SHA-256 <code title={data.configSha256}>{shortHash(data.configSha256)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    <div aria-label="Статусы неразрешённых кодов">
      {data.codeRows.map((row) => <details key={row.parameterCode}>
        <summary><strong>{row.parameterCode}</strong> · ABSTAIN ·
          {" "}{familyLabels[row.candidateExtractorFamily] ?? row.candidateExtractorFamily} ·
          строк в просмотренном тексте: {row.leadCount}</summary>
        <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
        <p>В рамках выбранных источников: подходящих источников {row.eligibleSourceCount};
          страниц с кандидатом текстового слоя {row.textCandidatePageCount};
          отложенных страниц OCR_REQUIRED {row.ocrRequiredPageCount};
          слишком длинных строк {row.oversizeAnchorLineCount};
          скрытых из-за лимита строк {row.truncatedLeadCount}.</p>
        <p>Счётчик строк относится только к просмотренному тексту.
          Вывод об отсутствии параметра недоступен.</p>
        {row.leads.length === 0 && <p>Строк-подсказок нет. Это не результат проверки
          наличия или отсутствия параметра.</p>}
        {row.leads.length > 0 && <div className="missing-list"
          aria-label={`Строки-подсказки ${row.parameterCode}`}>
          {row.leads.map((lead) => <div key={lead.leadSha256}>
            <span>{lead.sourceStage}</span><div>
              <strong>«{lead.lineText}»</strong>
              <small>Совпавшие опорные слова: {lead.matchedAnchors.join("; ")}.
                Элемент или помещение: {lead.elementAssociationStatus}.</small>
              <small>Источник {lead.sourceFileId} · {lead.sourceStage}/{lead.sourceSection} ·
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
                lead.textArtifactSha256) && lead.locatorType === "TEXT_LINE_BBOX_ONLY"
                ? <p><a href={api.sourcePagePreviewUrl(objectId, lead.sourceFileId,
                  lead.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть лист PDF</a>
                  {" · "}<a href={api.sourceFileUrl(objectId, lead.sourceFileId)}
                    target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a></p>
                : <p role="status">Источник строки не совпал с пакетом. Откройте источник
                    через список файлов.</p>}
            </div>
          </div>)}
        </div>}
      </details>)}
    </div>
  </section>;
}
