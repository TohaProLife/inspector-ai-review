import { useEffect, useState } from "react";
import { api, type OcrFactPairComparisonPreviewList,
  type OcrFactPairQuantityReviewRecord } from "./api";

const shortHash = (value: string) => `${value.slice(0, 12)}…`;
const reasonLabels: Record<string, string> = {
  CONTEXT_INVALID: "Контекст проверки недействителен",
  LATEST_DECISION_UNVERIFIED: "Последнее решение не подтверждено",
  PAIR_NOT_CONFIRMED: "Пара фактов не подтверждена",
  PAIR_SUPERSEDED_IN_CURRENT_RUN: "Появилось новое решение о паре в текущем запуске; нужен повторный запуск",
  SNAPSHOT_SCOPE_INVALID: "Снимок не относится к этому запуску",
  SNAPSHOT_TAMPERED: "Целостность снимка не подтверждена",
  CATALOG_RULE_UNSUPPORTED: "Правило или порог не поддерживается",
  QUANTITY_CONTEXT_UNVERIFIED: "Количественная сопоставимость не подтверждена",
  TARGET_FACT_UNAVAILABLE: "Факты недоступны в текущем запуске",
  UNIT_AMBIGUOUS: "Единицы измерения неоднозначны",
  QUANTITY_VALUE_UNUSABLE: "Числа не пригодны для расчёта",
  THRESHOLD_INVALID: "Порог правила недействителен",
};

export function OcrFactPairComparisonPreviewPanel({ data, quantityDecisions }: {
  data: OcrFactPairComparisonPreviewList;
  quantityDecisions: OcrFactPairQuantityReviewRecord[];
}) {
  const decisions = new Map(quantityDecisions.map((item) => [item.id, item]));
  return <>
    <p><strong>Только вычисленная подсказка.</strong> Эти расчёты не утверждают нарушение,
      не создают замечание и не увеличивают охват. Эксперт проверяет исходные документы отдельно.</p>
    <p>Численных подсказок: {data.items.filter((item) => item.preview.status === "COMPARISON_CANDIDATE").length}.
      Остановленных проверок: {data.items.filter((item) => item.preview.status === "ABSTAIN").length}.</p>
    {data.items.length === 0 && <p role="status">Подтверждённых количественных решений нет. Численное сравнение не выполнялось.</p>}
    {data.items.map((item) => {
      const decision = decisions.get(item.quantityDecisionId);
      const preview = item.preview;
      const evidenceMatches = decision && (preview.status === "ABSTAIN"
        || (preview.comparison && preview.comparison.quantityEvidenceHash === decision.evidenceHash));
      return <article key={item.quantityDecisionId} className="missing-list"
        aria-label={`Подсказка по решению ${item.quantityDecisionId}`}>
        <h4>{preview.status === "ABSTAIN" ? "Сравнение остановлено"
          : "Кандидат численного сравнения"}</h4>
        <p>Решение о количестве: {item.quantityDecisionId}
          {decision && <> · решение SHA-256 <code title={decision.contentHash}>{shortHash(decision.contentHash)}</code>
            · доказательство SHA-256 <code title={decision.evidenceHash}>{shortHash(decision.evidenceHash)}</code></>}.
        </p>
        {!decision && <p role="status">Сохранённое решение не удалось сопоставить с подсказкой. Проверьте журнал решений.</p>}
        {!evidenceMatches ? <p role="status">Снимок основания количества не совпал с подсказкой. Численный результат скрыт до повторной проверки.</p>
          : preview.purpose !== "REVIEW_ONLY" || preview.schemaVersion !== "ocr-fact-pair-comparison-preview-v1"
          ? <p role="status">Формат подсказки не подтверждён.</p>
          : preview.status === "ABSTAIN" ? <p role="status">Причина остановки:
              {reasonLabels[preview.reasonCode ?? ""] ?? "Требуется проверка контекста"}
              {preview.reasonCode ? ` (${preview.reasonCode})` : ""}. Значения не сопоставлялись.</p>
            : preview.comparison ? <>
                <p>{preview.comparison.parameterCode}/{preview.comparison.attribute} ·
                  {preview.comparison.family === "RELATIVE_DELTA" ? "модуль относительного изменения"
                    : "относительное увеличение"}.</p>
                <p>ПД: {preview.comparison.pdValue} {preview.comparison.canonicalUnit} ·
                  РД: {preview.comparison.rdValue} {preview.comparison.canonicalUnit}.</p>
                <p>Расчёт: <strong>{preview.comparison.observedPercent.numerator}/
                    {preview.comparison.observedPercent.denominator} %</strong> ·
                  порог правила {preview.comparison.thresholdPercent} %.
                  {preview.comparison.exceedsThreshold
                    ? " Вычисленное значение выше порога; это ещё не подтверждённое нарушение."
                    : " Вычисленное значение не выше порога; это ещё не вывод эксперта."}</p>
                <p>Факт ПД SHA-256 <code title={preview.comparison.pdFactId}>{shortHash(preview.comparison.pdFactId)}</code> ·
                  факт РД SHA-256 <code title={preview.comparison.rdFactId}>{shortHash(preview.comparison.rdFactId)}</code>.</p>
                <p>Снимок пары SHA-256 <code title={preview.comparison.targetReviewHash}>{shortHash(preview.comparison.targetReviewHash)}</code> ·
                  артефакт SHA-256 <code title={preview.comparison.artifactHash}>{shortHash(preview.comparison.artifactHash)}</code> ·
                  основание количества SHA-256 <code title={preview.comparison.quantityEvidenceHash}>{shortHash(preview.comparison.quantityEvidenceHash)}</code>.</p>
              </> : <p role="status">Расчёт недоступен: сервер не вернул проверенное сравнение.</p>}
        {decision && <p>Исходные листы: <a href={api.sourcePagePreviewUrl(decision.objectId,
          decision.provenance.pdSourceFileId, decision.review.pdPageNumber)}
          target="_blank" rel="noopener noreferrer">ПД, PDF-страница {decision.review.pdPageNumber}</a> · <a
          href={api.sourcePagePreviewUrl(decision.objectId,
            decision.provenance.rdSourceFileId, decision.review.rdPageNumber)}
          target="_blank" rel="noopener noreferrer">РД, PDF-страница {decision.review.rdPageNumber}</a>.</p>}
      </article>;
    })}
  </>;
}

export function OcrFactPairComparisonPreview({ checkId }: { checkId: string }) {
  const [data, setData] = useState<OcrFactPairComparisonPreviewList | null>(null);
  const [decisions, setDecisions] = useState<OcrFactPairQuantityReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setDecisions([]); setLoading(true); setError(null);
    void Promise.all([api.getOcrFactPairComparisonPreviews(checkId),
      api.getOcrFactPairQuantityReviews(checkId)]).then(([previewList, reviewList]) => {
      if (!cancelled) { setData(previewList); setDecisions(reviewList.items); }
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить подсказки");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [checkId]);

  return <section className="surface" aria-label="Численные подсказки по OCR-парам"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Только чтение</span>
      <h3>Проверка чисел ПД и РД</h3></div></div>
    {loading && <p role="status">Загружаем подсказки…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <OcrFactPairComparisonPreviewPanel data={data} quantityDecisions={decisions} />}
  </section>;
}
