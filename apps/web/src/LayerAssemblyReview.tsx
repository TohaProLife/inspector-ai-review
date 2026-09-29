import { api, type LayerAssemblyLocatorRead, type LayerAssemblyReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "SPZU-032": "Слои дорожной одежды",
  "AR-044": "Слои кровли",
  "ZU-125": "Утепление наружной стены",
};
const reasonLabels: Record<string, string> = {
  REVIEW_ONLY_NOT_TYPED_FACT: "Подсказки служат только для просмотра документов",
  ROW_ASSOCIATION_UNVERIFIED: "Связь материала и соседней строки не проверена",
  TYPE_OR_ZONE_LINK_UNVERIFIED: "Тип конструкции и участок не установлены",
  PD_RD_PAIR_UNVERIFIED: "Пара ПД/РД не подтверждена",
  EXISTING_SITE_GP_TABLE_ROW_REVIEW: "Для дорожных покрытий есть отдельный просмотр строк таблицы ГП",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена",
  SOURCE_ROLE_NOT_ALLOWED: "Раздел источника не подходит для кода",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_DEFERRED: "Страницы, которым нужно распознавание текста, отложены",
  OVERSIZE_ANCHOR_LINE_DEFERRED: "Слишком длинные строки отложены",
  PROPOSAL_LIMIT_REACHED: "Показана только часть подсказок",
  ABSTENTION_LIMIT_REACHED: "Показана только часть отложенных строк",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_SAFE_PROPOSAL_IN_SCANNED_TEXT: "В просмотренном тексте нет безопасной подсказки",
  NO_SCANNED_TEXT_IN_SCOPE: "Подходящий текст для просмотра отсутствует",
  ROOF_TYPE_CONTEXT_AMBIGUOUS: "Тип кровли рядом со строкой не определён однозначно",
  MATERIAL_THICKNESS_ROW_UNVERIFIED: "Связь материала и соседней размерной строки не проверена",
  WALL_TYPE_CONTEXT_UNVERIFIED: "Тип стены для строки не установлен",
  ROOF_TYPE_NOT_WALL_TYPE: "Ближайший тип относится к кровле, а не к стене",
  SECTION_BOUNDARY_BETWEEN_TYPE_AND_LAYER: "Между типом и строкой проходит граница раздела",
};
const kindLabels: Record<string, string> = {
  ROOF_HEADING_NAVIGATION: "Заголовок о кровле",
  ROOF_MATERIAL_THICKNESS_NEIGHBORHOOD: "Соседние строки о кровле для проверки",
  WALL_MATERIAL_THICKNESS_NEIGHBORHOOD: "Соседние строки о стене для проверки",
};
const roleLabels: Record<string, string> = {
  heading: "Заголовок",
  type: "Указание типа без проверенной привязки",
  material: "Строка о материале без проверенной привязки",
  thickness: "Соседняя размерная строка без проверенной привязки",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

function Locator({ role, locator }: { role: string; locator: LayerAssemblyLocatorRead }) {
  return <div>
    <strong>{roleLabels[role] ?? "Строка для проверки"}: «{locator.lineText}»</strong>
    <small>Текстовый блок {locator.blockIndex + 1} · строка {locator.lineIndex + 1} ·
      рамка [{locator.bboxMilliPoints.join(", ")}] координат PDF ×1000.</small>
    <small>Блок SHA-256 <code title={locator.blockTextSha256}>{shortHash(locator.blockTextSha256)}</code> ·
      строка SHA-256 <code title={locator.lineTextSha256}>{shortHash(locator.lineTextSha256)}</code>.</small>
  </div>;
}

export function LayerAssemblyReview({ data, objectId }: {
  data: LayerAssemblyReviewRead;
  objectId: string;
}) {
  const complete = data.codeRows.length === 3 && ["SPZU-032", "AR-044", "ZU-125"]
    .every((code) => data.codeRows.some((row) => row.parameterCode === code));
  const sourceMatches = (sourceFileId: string, sourceSha256: string,
    textArtifactSha256: string) => data.objectId === objectId
    && data.sourceStageArtifacts.some((item) => item.sourceFileId === sourceFileId
      && item.sourceSha256 === sourceSha256 && item.textArtifactSha256 === textArtifactSha256);
  const pageLink = (sourceFileId: string, sourceSha256: string,
    textArtifactSha256: string, pageNumber: number) =>
    sourceMatches(sourceFileId, sourceSha256, textArtifactSha256)
      ? <p><a href={api.sourcePagePreviewUrl(objectId, sourceFileId, pageNumber)}
        target="_blank" rel="noopener noreferrer">Открыть лист PDF</a>
        {" · "}<a href={api.sourceFileUrl(objectId, sourceFileId)}
          target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a></p>
      : <p role="status">Источник строки не совпал с пакетом. Откройте источник
          через список файлов.</p>;
  return <section className="surface" aria-label="Слои конструкций: строки для проверки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов · отдельный профиль</span>
      <h3>Слои конструкций: три неразрешённых кода</h3>
    </div></div>
    <p><strong>{complete ? "Все три кода имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Соседство текстовых блоков
      служит адресом для ручного просмотра, но не подтверждает строку таблицы,
      состав или толщину слоя, тип и участок конструкции. Толщина и количество
      не определены. Нет сравнения ПД/РД, замечаний и оценки охвата.
      Отсутствие подсказки не означает отсутствие слоя в документе.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующий код нельзя оценивать
      по этому списку.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    {data.codeRows.map((row) => <details key={row.parameterCode}>
      <summary><strong>{row.parameterCode}</strong> · {codeLabels[row.parameterCode]} ·
        ABSTAIN · подсказок: {row.proposalCount}</summary>
      <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
      <p>В выбранных источниках: подходящих источников {row.eligibleSourceCount};
        страниц с кандидатом текстового слоя {row.textCandidatePageCount};
        отложенных для распознавания страниц {row.ocrRequiredPageCount};
        слишком длинных строк {row.oversizeAnchorLineCount};
        скрытых из-за лимита подсказок {row.truncatedProposalCount};
        отложенных строк {row.abstentionCount}, из них скрытых {row.truncatedAbstentionCount}.</p>
      {row.parameterCode === "SPZU-032" && <p>Предложений для этого кода здесь нет.
        Строки дорожных покрытий просматриваются в отдельном разделе ГП;
        их связь со слоями и участком не подтверждена.</p>}
      {row.proposals.length === 0 && row.parameterCode !== "SPZU-032" &&
        <p>Подсказок нет. Это не подтверждает отсутствие слоёв в документах.</p>}
      {row.proposals.length > 0 && <div className="missing-list"
        aria-label={`Текстовые подсказки ${row.parameterCode}`}>
        {row.proposals.map((proposal) => <div key={proposal.scopedSha256}>
          <span>{proposal.sourceStage}</span><div>
            <strong>{kindLabels[proposal.proposalKind] ?? "Строки для проверки"}</strong>
            <small>Связь строки, типа и участка не проверена. Толщина и количество
              не определены.</small>
            <small>Источник {proposal.sourceFileId} · {proposal.sourceStage}/{proposal.sourceSection} ·
              PDF-страница {proposal.pageNumber}.</small>
            <small>PDF SHA-256 <code title={proposal.sourceSha256}>{shortHash(proposal.sourceSha256)}</code> ·
              текстовый артефакт SHA-256 <code title={proposal.textArtifactSha256}>{shortHash(proposal.textArtifactSha256)}</code> ·
              страница текста SHA-256 <code title={proposal.pageSha256}>{shortHash(proposal.pageSha256)}</code> ·
              подсказка SHA-256 <code title={proposal.scopedSha256}>{shortHash(proposal.scopedSha256)}</code>.</small>
            {Object.entries(proposal.roles).map(([role, locator]) =>
              <Locator key={role} role={role} locator={locator} />)}
            {pageLink(proposal.sourceFileId, proposal.sourceSha256,
              proposal.textArtifactSha256, proposal.pageNumber)}
          </div></div>)}
        </div>}
      {row.abstentions.length > 0 && <div aria-label={`Отложенные строки ${row.parameterCode}`}>
        <p>Отложенные строки требуют отдельной проверки:</p>
        {row.abstentions.map((item) => <div key={item.scopedSha256}>
          <p>{reasonLabels[item.reasonCode] ?? item.reasonCode} · источник {item.sourceFileId} ·
            PDF-страница {item.pageNumber} · страница текста SHA-256
            {" "}<code title={item.pageSha256}>{shortHash(item.pageSha256)}</code>.</p>
          <small>PDF SHA-256 <code title={item.sourceSha256}>{shortHash(item.sourceSha256)}</code> ·
            текстовый артефакт SHA-256 <code title={item.textArtifactSha256}>{shortHash(item.textArtifactSha256)}</code> ·
            отложенная строка SHA-256 <code title={item.scopedSha256}>{shortHash(item.scopedSha256)}</code>.</small>
          <Locator role="anchor" locator={item.anchor} />
          {pageLink(item.sourceFileId, item.sourceSha256,
            item.textArtifactSha256, item.pageNumber)}
        </div>)}
      </div>}
    </details>)}
  </section>;
}
