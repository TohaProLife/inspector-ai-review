import { api, type OcrTableRowEvidence, type OcrTableRowsRead } from "./api";

const evidenceNames: Record<string, string> = {
  labelHeader: "Заголовок левого столбца",
  valueHeader: "Заголовок правого столбца",
  rowLabel: "Подпись строки",
  rowLabelContinuation: "Продолжение подписи строки",
  rawValue: "Строка значения",
};

const abstentionNames: Record<string, string> = {
  TWO_COLUMN_HEADER_UNRESOLVED: "Два столбца не распознаны однозначно",
  ROW_PAIR_AMBIGUOUS: "Подпись и значение нельзя однозначно связать",
  ROW_LABEL_CONTINUATION_AMBIGUOUS: "Продолжение подписи нельзя однозначно связать со строкой",
  OCR_SCORE_TOO_LOW: "Низкая оценка OCR для строки",
};

function shortHash(value: string) {
  return `${value.slice(0, 12)}…`;
}

function joinedLabel(proposal: OcrTableRowsRead["proposals"][number]): string {
  return [proposal.labelEvidence, ...(proposal.labelContinuationEvidence ?? [])]
    .map((evidence) => evidence.text.trim()).filter(Boolean).join(" ");
}

function EvidenceLine({ evidence }: { evidence: OcrTableRowEvidence }) {
  return <li>
    <strong>{evidenceNames[evidence.role] ?? evidence.role} · OCR-строка {evidence.lineIndex + 1}</strong>
    <blockquote>«{evidence.text}»</blockquote>
    <small>Оценка OCR {evidence.score.toFixed(3)} · рамка [{evidence.bboxPx.join(", ")}] px, начало координат в верхнем левом углу изображения</small>
  </li>;
}

export function OcrTableRowsReview({ data, objectId }: {
  data: OcrTableRowsRead;
  objectId: string;
}) {
  return <section className="surface" aria-label="Непроверенные строки таблиц OCR" style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Помощь эксперту · OCR таблиц</span><h3>Непроверенные строки таблиц</h3><p>Предложения из сохранённой OCR-стадии этого запуска.</p></div></div>
    <p><strong>Только для ручной проверки.</strong> OCR может ошибиться в подписи, значении или расположении строки. Предложения не получают код параметра, не становятся нормализованными фактами или находками и не подтверждают сравнение документов.</p>
    <p>Предложений: {data.proposalCount}. Воздержаний: {data.abstentionCount}. Показано: {data.proposals.length} и {data.abstentions.length} соответственно.</p>
    {data.truncated && <p role="status">Список сокращён. Отсутствие строки среди показанных не подтверждает её отсутствие в документе.</p>}
    <p>Manifest SHA-256 <code title={data.inputManifestHash}>{shortHash(data.inputManifestHash)}</code>.</p>
    <details>
      <summary>Строки для сверки с исходным листом: {data.proposals.length}</summary>
      {data.proposals.length === 0 && <p>Предложений нет. Это не подтверждает отсутствие табличных данных.</p>}
      <ol>{data.proposals.map((proposal, index) => <li key={`${proposal.sourceFileId}-${proposal.pageNumber}-${proposal.labelEvidence.lineIndex}-${proposal.valueEvidence.lineIndex}-${index}`} style={{ marginTop: "var(--space-md)" }}>
        <strong>OCR прочитал: «{joinedLabel(proposal)}» · «{proposal.valueEvidence.text}»</strong>
        {(proposal.labelContinuationEvidence?.length ?? 0) > 0 && <p>Подпись собрана из двух отдельных OCR-строк. Сверьте обе строки и их рамки с исходным листом.</p>}
        <p>Источник {proposal.sourceFileId} · страница PDF {proposal.pageNumber}. Значение сохранено как исходный текст OCR, без нормализации единицы и привязки к параметру.</p>
        <ol aria-label="Исходные строки OCR">
          {proposal.headerEvidence.map((evidence, headerIndex) => <EvidenceLine evidence={evidence} key={`${evidence.role}-${evidence.lineIndex}-${headerIndex}`} />)}
          <EvidenceLine evidence={proposal.labelEvidence} />
          {proposal.labelContinuationEvidence?.map((evidence) => <EvidenceLine evidence={evidence}
            key={`${evidence.role}-${evidence.lineIndex}`} />)}
          <EvidenceLine evidence={proposal.valueEvidence} />
        </ol>
        <a href={api.sourcePagePreviewUrl(objectId, proposal.sourceFileId, proposal.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {proposal.pageNumber}</a>
        <details><summary>Хеши источника, OCR и рендера</summary>
          <p>Источник SHA-256 <code title={proposal.inputSha256}>{shortHash(proposal.inputSha256)}</code> · OCR-страница SHA-256 <code title={proposal.ocrPageContentHash}>{shortHash(proposal.ocrPageContentHash)}</code> · Рендер SHA-256 <code title={proposal.renderSha256}>{shortHash(proposal.renderSha256)}</code>.</p>
        </details>
      </li>)}</ol>
    </details>
    <details style={{ marginTop: "var(--space-md)" }}>
      <summary>Где сопоставление строк остановлено: {data.abstentionCount}</summary>
      {data.abstentionCount === 0 && <p>Воздержаний в сохранённом результате нет.</p>}
      {data.truncated && <p>Показаны не все причины воздержания.</p>}
      <ul>{data.abstentions.map((item, index) => <li key={`${item.sourceFileId}-${item.pageNumber}-${item.lineIndex ?? "page"}-${index}`}>
        <strong>{abstentionNames[item.reasonCode] ?? item.reasonCode}</strong> · источник {item.sourceFileId} · страница PDF {item.pageNumber}{item.lineIndex !== null ? ` · OCR-строка ${item.lineIndex + 1}` : " · вся страница"}.
        <span> SHA-256 источника <code title={item.inputSha256}>{shortHash(item.inputSha256)}</code>. </span>
        <a href={api.sourcePagePreviewUrl(objectId, item.sourceFileId, item.pageNumber)} target="_blank" rel="noopener noreferrer">Открыть исходный лист {item.pageNumber}</a>
      </li>)}</ul>
    </details>
  </section>;
}
