import { api, type UnresolvedConfigReviewV3Read } from "./api";

const expectedCodes = ["IOS1-068", "IOS1-069", "IOS1-070", "IOS4-076",
  "IOS4-078", "PPM-111", "PPM-113"];
const reasonLabels: Record<string, string> = {
  CONFIG_PINNED_REVIEW_ONLY: "Конфигурация допускает только просмотр",
  NETWORK_TOPOLOGY_UNVERIFIED: "Топология сети не проверена",
  ELEMENT_OR_SPACE_UNVERIFIED: "Элемент или помещение не идентифицированы",
  PD_RD_PAIR_UNVERIFIED: "Пара ПД/РД не подтверждена",
  SOURCE_STAGE_UNRESOLVED: "Стадия источника не подтверждена",
  SOURCE_REVIEW_REQUIRED: "Нет подтверждения актуальной утверждённой редакции источника",
  SOURCE_ROLE_NOT_ALLOWED: "Раздел или стадия источника не подходят для кода",
  TEXT_ARTIFACT_MISSING: "Проверенный текстовый артефакт недоступен",
  PAGE_STAGE_MAP_INCOMPLETE: "Стадии страниц указаны не для всех листов",
  PAGE_STAGE_UNRESOLVED_DEFERRED: "Страницы с неясной стадией отложены",
  OCR_REQUIRED_DEFERRED: "Страницы, которым нужно распознавание текста, отложены",
  OVERSIZE_ANCHOR_LINE_DEFERRED: "Слишком длинные строки с опорным словом отложены",
  LEAD_LIMIT_REACHED: "Показана только часть строк-подсказок",
  NO_ELIGIBLE_REVIEWED_SOURCE: "Нет подходящего проверенного источника",
  NO_EXACT_LINE_LEAD_IN_SCANNED_TEXT: "В просмотренном тексте строка-подсказка не найдена",
  NO_SCANNED_TEXT_IN_SCOPE: "Подходящий текст для просмотра отсутствует",
};
const proofLabels: Record<string, string> = {
  APPROVED_SOURCE_REVISIONS: "утверждённые редакции",
  VERIFIED_SECTION_STAGE: "подтверждённый раздел и стадия",
  SAME_ELEMENT_OR_SPACE: "тот же элемент или помещение",
  PD_RD_PAIR: "пара ПД/РД",
  DRAWING_GEOMETRY: "геометрия чертежа",
  GRAPH_CONNECTIVITY: "связность сети по схеме",
  CIRCUIT_DEVICE_ASSIGNMENT: "привязка устройств к цепям",
  CABLE_LINE_ASSIGNMENT: "привязка кабелей к линиям",
  GROUNDING_CIRCUIT_CLOSURE: "замкнутость контура заземления",
  PIPE_BRANCH_ASSIGNMENT: "привязка труб к ветвям",
  DUCT_SECTION_GEOMETRY: "геометрия участка воздуховода",
  BARRIER_PENETRATION: "проход через преграду",
  FIRE_WATER_NETWORK: "схема противопожарного водопровода",
  HYDRAULIC_CONTEXT: "гидравлический контекст",
  APPLICABLE_NORM: "применимая норма",
};
const shortHash = (value: string) => `${value.slice(0, 12)}…`;

export function UnresolvedConfigReviewV3({ data, objectId }: {
  data: UnresolvedConfigReviewV3Read;
  objectId: string;
}) {
  const complete = data.codeRows.length === expectedCodes.length
    && expectedCodes.every((code) => data.codeRows.some((row) => row.parameterCode === code));
  const sourceMatches = (sourceFileId: string, sourceSha256: string,
    textArtifactSha256: string) => data.sourceStageArtifacts.some((item) =>
    item.sourceFileId === sourceFileId && item.sourceSha256 === sourceSha256
    && item.textArtifactSha256 === textArtifactSha256);
  return <section className="surface" aria-label="Топология сетей: текстовые подсказки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только проверка документов · отдельный профиль</span>
      <h3>Топология сетей: 7 неразрешённых кодов</h3>
      <p>Адресные строки сохранённого текста по закреплённой конфигурации.</p>
    </div></div>
    <p><strong>{complete ? "Все 7 кодов имеют статус ABSTAIN."
      : "Полученные коды имеют статус ABSTAIN."}</strong> Совпадение слов не подтверждает
      связность сети, привязку оборудования и линий, геометрию схемы, применимую норму
      или пару ПД/РД. Факты, замечания и охват не сформированы. Отсутствие строки в
      просмотренном тексте не доказывает отсутствие параметра.</p>
    {!complete && <p role="status">Пакет неполный. Отсутствующие коды нельзя оценивать
      по этому списку.</p>}
    <p>Пакет SHA-256 <code title={data.contentHash}>{shortHash(data.contentHash)}</code> ·
      конфигурация SHA-256 <code title={data.configSha256}>{shortHash(data.configSha256)}</code> ·
      manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    <div aria-label="Статусы кодов топологии сетей">
      {data.codeRows.map((row) => <details key={row.parameterCode}>
        <summary><strong>{row.parameterCode}</strong> · ABSTAIN ·
          строк в просмотренном тексте: {row.leadCount}</summary>
        <p>Причины: {row.reasonCodes.map((reason) => reasonLabels[reason] ?? reason).join("; ")}.</p>
        <p>В рамках выбранных источников: подходящих источников {row.eligibleSourceCount};
          страниц с кандидатом текстового слоя {row.textCandidatePageCount};
          отложенных страниц, которым нужно распознавание текста, {row.ocrRequiredPageCount};
          слишком длинных строк {row.oversizeAnchorLineCount};
          скрытых из-за лимита строк {row.truncatedLeadCount}.</p>
        <p>Для предметного вывода требуются: {row.requiredProofGates
          .map((gate) => proofLabels[gate] ?? gate).join("; ")}.
          Этот пакет не подтверждает выполнение этих условий.</p>
        {row.leads.length === 0 && <p>Строк-подсказок нет. Вывод об отсутствии
          параметра недоступен.</p>}
        {row.leads.length > 0 && <div className="missing-list"
          aria-label={`Строки-подсказки ${row.parameterCode}`}>
          {row.leads.map((lead) => <div key={lead.leadSha256}>
            <span>{lead.sourceStage}</span><div>
              <strong>«{lead.lineText}»</strong>
              <small>Опорные слова: {lead.matchedAnchors.join("; ")}.
                Привязка элемента или помещения не подтверждена.</small>
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
