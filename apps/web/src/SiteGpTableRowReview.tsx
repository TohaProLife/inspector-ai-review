import { api, type SiteGpTableBlockRead, type SiteGpTableRowReviewRead } from "./api";

const codeLabels: Record<string, string> = {
  "SPZU-029": "Ведомость МАФ",
  "SPZU-032": "Конструкция дорожной одежды",
};
const proposalLabels: Record<string, string> = {
  MAF_POSITION_NAME_ADJACENCY: "Соседство позиции и наименования МАФ",
  ROAD_LAYER_THICKNESS_ADJACENCY: "Соседство материала и толщины",
  ROAD_ASSEMBLY_WORK_TYPE_ADJACENCY: "Соседство работы и типа конструкции",
};
const roleLabels: Record<string, string> = {
  mafHeading: "Заголовок ведомости", positionHeader: "Заголовок позиции",
  nameHeader: "Заголовок наименования", quantityHeader: "Заголовок количества",
  position: "Позиция", name: "Наименование", roadHeading: "Заголовок конструкции",
  unitHeader: "Заголовок единицы", material: "Материал", thickness: "Толщина",
  work: "Работа", type: "Тип",
};
const reasonLabels: Record<string, string> = {
  REVIEW_ONLY_NOT_TYPED_FACT: "Соседство блоков не образует проверенный факт",
  ROW_ASSOCIATION_UNVERIFIED: "Принадлежность блоков одной строке не проверена",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена как ПД",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  DRAWING_SECTION_UNRESOLVED: "Раздел ГП не подтверждён",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_IN_SCOPE: "Часть страниц требует отдельного OCR",
  PROPOSAL_LIMIT_REACHED: "Показана только часть соседств блоков",
  ABSTENTION_LIMIT_REACHED: "Показана только часть причин воздержания",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_UNAMBIGUOUS_ROW_PROPOSAL: "Однозначное соседство блоков не найдено",
  ROAD_TABLE_HEADERS_AMBIGUOUS: "Заголовки дорожной таблицы неоднозначны",
  ROAD_TABLE_COLUMNS_AMBIGUOUS: "Колонки дорожной таблицы неоднозначны",
  ROAD_LAYER_ALIGNMENT_AMBIGUOUS: "Материал и толщина не сопоставлены однозначно",
  ROAD_ASSEMBLY_TYPE_ALIGNMENT_AMBIGUOUS: "Работа и тип не сопоставлены однозначно",
  MAF_TABLE_HEADERS_AMBIGUOUS: "Заголовки ведомости МАФ неоднозначны",
  MAF_TABLE_COLUMNS_AMBIGUOUS: "Колонки ведомости МАФ неоднозначны",
  MAF_POSITION_NAME_ALIGNMENT_AMBIGUOUS: "Позиция и наименование не сопоставлены однозначно",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

function BlockAddress({ role, block }: { role: string; block: SiteGpTableBlockRead }) {
  return <li><strong>{roleLabels[role] ?? role}:</strong> «{block.blockText}» ·
    блок {block.blockIndex + 1} · [{block.bboxMilliPoints.join(", ")}] PDF ×1000 ·
    SHA-256 <code title={block.blockTextSha256}>{shortHash(block.blockTextSha256)}</code></li>;
}

export function SiteGpTableRowReview({ data, objectId }: {
  data: SiteGpTableRowReviewRead;
  objectId: string;
}) {
  const complete = ["SPZU-029", "SPZU-032"].every((code) =>
    data.codeRows.some((row) => row.parameterCode === code)) && data.codeRows.length === 2;
  const sourceMatches = (sourceFileId: string, sourceSha256: string,
    textArtifactSha256: string) => data.sourceStageArtifacts.some((item) =>
    item.sourceFileId === sourceFileId && item.sourceSha256 === sourceSha256
    && item.textArtifactSha256 === textArtifactSha256);
  return <section className="surface" aria-label="ГП: соседство табличных блоков"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Проверка исходного листа · ГП</span>
      <h3>Табличные блоки: МАФ и дорожная одежда</h3>
    </div></div>
    <p><strong>{complete ? "Оба кода имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Показано только соседство
      текстовых блоков на одной странице. <strong>Принадлежность одной строке не проверена
      (ROW_ASSOCIATION_UNVERIFIED).</strong> Количество МАФ неизвестно. Значения, состав
      слоёв, тип конструкции, факты, сравнение и охват не установлены.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствие кода не означает отсутствие
      данных в документе.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    {data.codeRows.map((row) => <details key={row.parameterCode}>
      <summary><strong>{row.parameterCode}</strong> · {codeLabels[row.parameterCode]} ·
        ABSTAIN · соседств: {row.proposalCount} · воздержаний: {row.abstentionCount}</summary>
      <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
      <p>В рамках выбранных источников: подходящих источников {row.eligibleSourceCount};
        страниц с кандидатом текстового слоя {row.textCandidatePageCount};
        страниц, требующих OCR, {row.ocrRequiredPageCount}.</p>
      {(row.proposalCount > row.proposals.length || row.abstentionCount > row.abstentions.length)
        && <p>Показана только часть пакета. По списку нельзя судить о полноте документа.</p>}
      {row.proposals.length === 0 && <p>Соседств блоков нет. Это не подтверждает отсутствие
        элемента или параметра на листах.</p>}
      {row.proposals.map((proposal) => <section key={proposal.scopedSha256}
        aria-label={`Непроверенное соседство ${proposal.proposalKind}`}>
        <h4>{proposalLabels[proposal.proposalKind]}</h4>
        <p><strong>Непроверенное соседство блоков.</strong> Причина:
          {" "}{proposal.reasonCodes.join(", ")}.</p>
        <p>Источник {proposal.sourceFileId} · ПД/ГП · PDF-страница {proposal.pageNumber} ·
          PDF SHA-256 <code title={proposal.sourceSha256}>{shortHash(proposal.sourceSha256)}</code> ·
          текстовый артефакт SHA-256 <code title={proposal.textArtifactSha256}>{shortHash(proposal.textArtifactSha256)}</code>.</p>
        <ul>{(Object.entries(proposal.roles) as Array<[string, SiteGpTableBlockRead]>)
          .map(([role, block]) => <BlockAddress key={role} role={role} block={block} />)}</ul>
        {proposal.proposalKind === "MAF_POSITION_NAME_ADJACENCY" &&
          <p>Количество: неизвестно. Ячейка количества не прочитана и не связана с позицией.</p>}
        {proposal.proposalKind === "ROAD_LAYER_THICKNESS_ADJACENCY" &&
          <p>Единица толщины и принадлежность конструкции не проверены.</p>}
        {proposal.proposalKind === "ROAD_ASSEMBLY_WORK_TYPE_ADJACENCY" &&
          <p>Связь типа конструкции со слоем не установлена.</p>}
        <p>Соседство SHA-256 <code title={proposal.adjacencyEvidenceSha256}>
          {shortHash(proposal.adjacencyEvidenceSha256)}</code> · пакетный локатор SHA-256
          {" "}<code title={proposal.scopedSha256}>{shortHash(proposal.scopedSha256)}</code>.</p>
        {sourceMatches(proposal.sourceFileId, proposal.sourceSha256,
          proposal.textArtifactSha256) && proposal.sourceRole === "PD_GP_TABLE"
          ? <p><a href={api.sourcePagePreviewUrl(objectId, proposal.sourceFileId,
            proposal.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть лист PDF</a>
            {" · "}<a href={api.sourceFileUrl(objectId, proposal.sourceFileId)}
              target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a></p>
          : <p role="status">Источник соседства не совпал с пакетом. Откройте источник
              через список файлов.</p>}
      </section>)}
      {row.abstentions.length > 0 && <details><summary>Где сопоставление блоков не удалось</summary>
        <ul>{row.abstentions.map((item) => <li key={item.scopedSha256}>
          {reasonLabels[item.reasonCode] ?? item.reasonCode} · источник {item.sourceFileId} ·
          PDF-страница {item.pageNumber} · блок {item.anchor.blockIndex + 1}
          «{item.anchor.blockText}».
          {sourceMatches(item.sourceFileId, item.sourceSha256, item.textArtifactSha256)
            && item.sourceRole === "PD_GP_TABLE"
            && <a href={api.sourcePagePreviewUrl(objectId, item.sourceFileId,
              item.pageNumber)} target="_blank" rel="noopener noreferrer"> Открыть лист PDF</a>}
        </li>)}</ul>
      </details>}
    </details>)}
  </section>;
}
