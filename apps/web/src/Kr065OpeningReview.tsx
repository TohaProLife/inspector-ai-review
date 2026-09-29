import { api, type Kr065OpeningReviewRead, type LayerAssemblyLocatorRead } from "./api";

const reasons: Record<string, string> = {
  REVIEW_ONLY_NOT_TYPED_FACT: "Текстовые метки служат только для просмотра чертежа",
  CONTOUR_ASSOCIATION_UNVERIFIED: "Связь метки с контуром проёма не проверена",
  SAME_ELEMENT_UNVERIFIED: "Принадлежность метки и детали одному элементу не установлена",
  PD_RD_PAIR_UNVERIFIED: "Пара ПД/РД не подтверждена",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена",
  SOURCE_ROLE_NOT_ALLOWED: "Раздел источника не подходит для кода",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  OCR_REQUIRED_DEFERRED: "Страницы, которым нужно распознавание текста, отложены",
  OVERSIZE_ANCHOR_LINE_DEFERRED: "Слишком длинные строки отложены",
  DUPLICATE_ANCHOR_DEFERRED: "Повторные метки отложены для проверки",
  PROPOSAL_LIMIT_REACHED: "Показана только часть текстовых меток",
  ABSTENTION_LIMIT_REACHED: "Показана только часть отложенных строк",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_SAFE_PROPOSAL_IN_SCANNED_TEXT: "В просмотренном тексте нет безопасной подсказки",
  NO_SCANNED_TEXT_IN_SCOPE: "Подходящий текст для просмотра отсутствует",
  DUPLICATE_OPENING_LABEL: "Повторная метка проёма: контекст не установлен",
  DUPLICATE_HEADING_CONTEXT_UNVERIFIED: "Повторный заголовок: контекст не установлен",
  OPENING_LABEL_AMBIGUOUS: "Метка проёма или размер неоднозначны",
};
const kinds: Record<string, string> = {
  OPENING_LABEL_DIMENSION_NAVIGATION: "Текстовая метка проёма и размера",
  DESIGNED_CLOSURE_HEADING_NAVIGATION: "Заголовок детали заделки",
  DETAIL_HEADING_NAVIGATION: "Заголовок детали",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;
type SourceItem = Kr065OpeningReviewRead["codeRows"][number]["proposals"][number]
  | Kr065OpeningReviewRead["codeRows"][number]["abstentions"][number];

function Locator({ anchor }: { anchor: LayerAssemblyLocatorRead }) {
  return <div>
    <strong>Строка: «{anchor.lineText}»</strong>
    <small>Текстовый блок {anchor.blockIndex + 1} · строка {anchor.lineIndex + 1} ·
      рамка [{anchor.bboxMilliPoints.join(", ")}] координат PDF ×1000.</small>
    <small>Блок SHA-256 <code title={anchor.blockTextSha256}>{shortHash(anchor.blockTextSha256)}</code> ·
      строка SHA-256 <code title={anchor.lineTextSha256}>{shortHash(anchor.lineTextSha256)}</code>.</small>
  </div>;
}

export function Kr065OpeningReview({ data, objectId }: {
  data: Kr065OpeningReviewRead;
  objectId: string;
}) {
  const bound = (item: SourceItem) => data.objectId === objectId
    && data.sourceStageArtifacts.some((artifact) => artifact.sourceFileId === item.sourceFileId
      && artifact.sourceSha256 === item.sourceSha256
      && artifact.textArtifactSha256 === item.textArtifactSha256);
  const provenance = (item: SourceItem) => <>
    <small>Источник {item.sourceFileId} · {item.sourceStage}/{item.sourceSection} ·
      PDF-страница {item.pageNumber}.</small>
    <small>PDF SHA-256 <code title={item.sourceSha256}>{shortHash(item.sourceSha256)}</code> ·
      текстовый артефакт SHA-256 <code title={item.textArtifactSha256}>{shortHash(item.textArtifactSha256)}</code> ·
      страница текста SHA-256 <code title={item.pageSha256}>{shortHash(item.pageSha256)}</code> ·
      подсказка SHA-256 <code title={item.scopedSha256}>{shortHash(item.scopedSha256)}</code>.</small>
    <Locator anchor={item.anchor} />
    {bound(item)
      ? <p><a href={api.sourcePagePreviewUrl(objectId, item.sourceFileId, item.pageNumber)}
          target="_blank" rel="noopener noreferrer">Открыть лист PDF</a>
          {" · "}<a href={api.sourceFileUrl(objectId, item.sourceFileId)}
            target="_blank" rel="noopener noreferrer">Открыть исходный PDF</a></p>
      : <p role="status">Источник строки не совпал с пакетом. Откройте источник
          через список файлов.</p>}
  </>;

  return <section className="surface" aria-label="КР-065: проёмы для проверки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов · отдельный профиль</span>
      <h3>КР-065: метки проёмов для ручного просмотра</h3>
    </div></div>
    <p><strong>Статус ABSTAIN.</strong> {data.codeRows.some((row) => row.proposalCount > 0)
      ? "Есть текстовые строки для ручного просмотра. "
      : "Текстовых подсказок для ручного просмотра нет. "}
      Связь метки с контуром чертежа, деталью и одним конструктивным элементом не установлена.
      Наличие усиления или неразрешённой заделки не установлено. Нет вывода о нарушении,
      сравнения ПД/РД и оценки охвата. Отсутствие метки здесь не означает отсутствие
      проёма в документе.</p>
    <p>Просмотр SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    {data.codeRows.map((row) => <details key={row.parameterCode}>
      <summary><strong>{row.parameterCode}</strong> · ABSTAIN · текстовых подсказок:
        {" "}{row.proposalCount}</summary>
      <p>Причины: {row.reasonCodes.map((code) => reasons[code] ?? code).join("; ")}.</p>
      <p>Подходящих источников {row.eligibleSourceCount}; страниц с кандидатом текстового слоя
        {" "}{row.textCandidatePageCount}; отложенных для распознавания страниц
        {" "}{row.ocrRequiredPageCount}; слишком длинных строк {row.oversizeAnchorLineCount};
        повторных меток {row.duplicateAnchorCount}; скрытых из-за лимита подсказок
        {" "}{row.truncatedProposalCount}; отложенных строк {row.abstentionCount}, из них скрытых
        {" "}{row.truncatedAbstentionCount}.</p>
      {row.proposals.length === 0 && <p>Подсказок нет. Это не подтверждает отсутствие
        проёмов в документах.</p>}
      {row.proposals.length > 0 && <div className="missing-list"
        aria-label="Текстовые метки проёмов">
        {row.proposals.map((item) => <div key={item.scopedSha256}>
          <span>РД</span><div>
            <strong>{kinds[item.proposalKind] ?? "Строка для проверки"}</strong>
            {item.rawOpeningNumber !== null && <small>Номер на строке: «№ {item.rawOpeningNumber}»
              — принадлежность контуру не проверена.</small>}
            {item.rawDimensionsText !== null && <small>Размер на строке: «{item.rawDimensionsText}»
              — принадлежность контуру не проверена.</small>}
            {provenance(item)}
          </div></div>)}
      </div>}
      {row.abstentions.length > 0 && <div aria-label="Отложенные строки проёмов">
        <p>Отложенные строки требуют отдельной проверки:</p>
        {row.abstentions.map((item) => <div key={item.scopedSha256}>
          <p>{reasons[item.reasonCode] ?? item.reasonCode}.</p>
          {provenance(item)}
        </div>)}
      </div>}
    </details>)}
  </section>;
}
