import { useEffect, useState, type FormEvent } from "react";
import { api, type OcrFactPairQuantityReviewInput,
  type OcrFactPairQuantityReviewList, type OcrTypedFactCandidate } from "./api";

type Decision = OcrFactPairQuantityReviewInput["decision"] | "";
type Basis = OcrFactPairQuantityReviewInput["basis"];
const blankBasis = (): Basis => ({ scope: "", quantityType: "", period: "", aggregation: "" });
const hash = (value: string) => /^[a-f0-9]{64}$/u.test(value);
const uuid = (value: string) => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const shortHash = (value: string) => `${value.slice(0, 12)}…`;
const safeText = (value: string, maxBytes: number) => value.length > 0
  && value === value.trim() && new TextEncoder().encode(value).byteLength <= maxBytes
  && !/[\p{Cc}\p{Cf}]/u.test(value);
const explanation = (value: string) => safeText(value, 1000)
  && Array.from(value).length >= 12
  && !/^(?:unknown|unsure|n\/?a|none|нет|не знаю|неизвестно|не уверен|\?+|[-—]+)[.!?\s]*$/iu.test(value);

export function makeOcrFactPairQuantityReviewInput(list: OcrFactPairQuantityReviewList,
  checkId: string, selectedDecisionId: string, decision: Decision,
  pdDenominatorAffirmed: boolean, basis: Basis): OcrFactPairQuantityReviewInput | null {
  const candidate = list.candidates.find((item) =>
    item.pairSnapshot.decisionId === selectedDecisionId);
  if (!list.canReview || !candidate || !safeText(checkId, 128)
    || !["SAME_SCALAR_TOTAL", "NOT_COMPARABLE", "UNSURE"].includes(decision)) return null;
  const { pairSnapshot: snapshot, pdFact: pd, rdFact: rd } = candidate;
  const review = snapshot.review;
  if (!snapshot.eligibleForPairReview || snapshot.targetCheckId !== checkId
    || snapshot.originCheckId === snapshot.targetCheckId
    || snapshot.reasonCode !== "REBOUND" || review?.decision !== "PAIR_CONFIRMED"
    || !hash(snapshot.targetReviewHash ?? "") || !uuid(snapshot.decisionId)
    || !snapshot.provenance || !hash(snapshot.provenance.artifactHash)
    || pd.schemaVersion !== "typed-fact-v2" || rd.schemaVersion !== "typed-fact-v2"
    || pd.locator.kind !== "OCR_ROW" || rd.locator.kind !== "OCR_ROW"
    || pd.stage !== "PD" || rd.stage !== "RD"
    || pd.factId !== review.pdFactId || rd.factId !== review.rdFactId
    || !hash(pd.factId) || !hash(rd.factId) || pd.factId === rd.factId
    || pd.targetCheckId !== checkId || rd.targetCheckId !== checkId
    || pd.inputManifestHash !== review.inputManifestHash
    || rd.inputManifestHash !== review.inputManifestHash
    || pd.objectId !== review.objectId || rd.objectId !== review.objectId
    || pd.sourceSha256 === rd.sourceSha256
    || pd.parameterCode !== review.parameterCode || rd.parameterCode !== review.parameterCode
    || pd.attribute !== review.attribute || rd.attribute !== review.attribute
    || pd.entityKey !== review.entityKey || rd.entityKey !== review.entityKey
    || pd.context !== review.context || rd.context !== review.context
    || !hash(review.pdLocatorHash) || !hash(review.rdLocatorHash)
    || !Number.isSafeInteger(pd.pageNumber) || pd.pageNumber < 1 || pd.pageNumber > 100000
    || !Number.isSafeInteger(rd.pageNumber) || rd.pageNumber < 1 || rd.pageNumber > 100000
    || (decision === "SAME_SCALAR_TOTAL" && !pdDenominatorAffirmed)) return null;
  const checkedBasis = {
    scope: basis.scope.trim(), quantityType: basis.quantityType.trim(),
    period: basis.period.trim(), aggregation: basis.aggregation.trim(),
    ...(review.parameterCode === "SM-132" ? { priceBasis: basis.priceBasis?.trim() ?? "" } : {}),
  };
  if (!explanation(checkedBasis.scope)
    || !explanation(checkedBasis.quantityType)
    || !explanation(checkedBasis.period)
    || !explanation(checkedBasis.aggregation)
    || (review.parameterCode === "SM-132" && !explanation(checkedBasis.priceBasis ?? ""))) {
    return null;
  }
  return { schemaVersion: "ocr-fact-pair-quantity-review-v1",
    decision: decision as OcrFactPairQuantityReviewInput["decision"],
    targetCheckId: checkId, inputManifestHash: review.inputManifestHash,
    objectId: review.objectId, parameterCode: review.parameterCode,
    attribute: review.attribute, entityKey: review.entityKey, context: review.context,
    pdFactId: pd.factId, pdLocatorHash: review.pdLocatorHash,
    rdFactId: rd.factId, rdLocatorHash: review.rdLocatorHash,
    pairDecisionId: snapshot.decisionId, pairTargetReviewHash: snapshot.targetReviewHash!,
    pdDenominatorAffirmed, pdPageNumber: pd.pageNumber, rdPageNumber: rd.pageNumber,
    basis: checkedBasis };
}

function QuantityFact({ fact, objectId, onPreviewOpen }: {
  fact: OcrTypedFactCandidate; objectId: string; onPreviewOpen: (factId: string) => void;
}) {
  return <div aria-label={`Источник количества ${fact.stage}`}>
    <p><strong>{fact.stage}: «{fact.rawValue} {fact.rawUnit}»</strong> · {fact.rawText}.</p>
    <p>{fact.sourceFileId} · PDF-страница {fact.pageNumber} · раздел {fact.locator.sectionCode} ·
      факт SHA-256 <code title={fact.factId}>{shortHash(fact.factId)}</code>.</p>
    <p>PDF SHA-256 <code title={fact.sourceSha256}>{shortHash(fact.sourceSha256)}</code> ·
      рендер SHA-256 <code title={fact.locator.renderSha256}>{shortHash(fact.locator.renderSha256)}</code> ·
      строка OCR SHA-256 <code title={fact.locator.rowFingerprint}>{shortHash(fact.locator.rowFingerprint)}</code>.</p>
    <a href={api.sourcePagePreviewUrl(objectId, fact.sourceFileId, fact.pageNumber)}
      target="_blank" rel="noopener noreferrer" onClick={() => onPreviewOpen(fact.factId)}>
      Открыть исходный лист {fact.pageNumber}</a>
  </div>;
}

export function OcrFactPairQuantityPanel({ list, checkId, objectId,
  selectedDecisionId, decision, pdDenominatorAffirmed, basis, saving, openedFactIds,
  onSelect, onDecision, onDenominator, onBasis, onPreviewOpen, onSubmit }: {
  list: OcrFactPairQuantityReviewList; checkId: string; objectId: string;
  selectedDecisionId: string; decision: Decision; pdDenominatorAffirmed: boolean;
  basis: Basis; saving: boolean; openedFactIds: ReadonlySet<string>;
  onSelect: (value: string) => void; onDecision: (value: Decision) => void;
  onDenominator: (value: boolean) => void; onBasis: (value: Basis) => void;
  onPreviewOpen: (factId: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const candidate = list.candidates.find((item) =>
    item.pairSnapshot.decisionId === selectedDecisionId);
  const input = makeOcrFactPairQuantityReviewInput(list, checkId, selectedDecisionId,
    decision, pdDenominatorAffirmed, basis);
  const saved = list.items.filter((item) => item.review.pairDecisionId === selectedDecisionId);
  return <>
    <p><strong>Только предметная проверка количеств.</strong> Решение о связи фактов и решение о сопоставимости количеств отдельны. Эта форма не запускает сравнение, не создаёт замечание или охват.</p>
    <p>Проверенных снимков пар: {list.candidates.length}. Сохранённых решений о количестве: {list.items.length}.</p>
    {list.reasonCode === "OCR_QUANTITY_SNAPSHOT_REQUIRED" &&
      <p role="status"><strong>Нужен повторный запуск после подтверждения пары.</strong> Только новый запуск зафиксирует решение о паре в неизменяемом снимке.</p>}
    {list.candidates.length === 0 && list.reasonCode !== "OCR_QUANTITY_SNAPSHOT_REQUIRED" &&
      <p role="status">Проверенной пары с неизменяемым снимком в этом запуске нет. Количественное сопоставление остановлено.</p>}
    {!list.canReview && <p>У вас нет права сохранять решения для этого запуска.</p>}
    {list.candidates.length > 0 && <>
      <label className="source-review-form"><span>Пара из неизменяемого снимка</span>
        <select aria-label="Выберите снимок OCR-пары" value={selectedDecisionId}
          disabled={saving} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Выберите после проверки исходных листов</option>
          {list.candidates.map((item) => <option key={item.pairSnapshot.decisionId}
            value={item.pairSnapshot.decisionId}>
            {item.pairSnapshot.review?.parameterCode}/{item.pairSnapshot.review?.attribute} ·
            {item.pairSnapshot.review?.entityKey} · ПД {item.pdFact.sourceFileId}:{item.pdFact.pageNumber} ·
            РД {item.rdFact.sourceFileId}:{item.rdFact.pageNumber}
          </option>)}
        </select>
      </label>
      {candidate && <>
        <p>Решение о паре {candidate.pairSnapshot.decisionId} · снимок SHA-256
          <code title={candidate.pairSnapshot.targetReviewHash ?? ""}> {shortHash(candidate.pairSnapshot.targetReviewHash ?? "")}</code>.
          Объект и контекст: {candidate.pairSnapshot.review?.entityKey} · {candidate.pairSnapshot.review?.context}.</p>
        <QuantityFact fact={candidate.pdFact} objectId={objectId} onPreviewOpen={onPreviewOpen} />
        <QuantityFact fact={candidate.rdFact} objectId={objectId} onPreviewOpen={onPreviewOpen} />
        {saved.length > 0 && <div aria-label="История решений о сопоставимости количества">
          <h4>История решений: {saved.length}</h4>
          <ol>{saved.map((item) => <li key={item.id}>
            <strong>{item.review.decision === "SAME_SCALAR_TOTAL" ? "Одинаковый тип суммарной величины"
              : item.review.decision === "NOT_COMPARABLE" ? "Несопоставимо" : "Недостаточно оснований"}</strong>
            <p>Область: {item.review.basis.scope}. Тип: {item.review.basis.quantityType}.
              {new Date(item.createdAt).toLocaleString("ru-RU")} · решение {item.id}.</p>
          </li>)}</ol>
        </div>}
        {list.canReview && <form className="source-review-form" onSubmit={onSubmit}>
          <h4>Новое решение о количественной сопоставимости</h4>
          <label><span>Решение эксперта</span><select aria-label="Решение о количественной сопоставимости"
            value={decision} disabled={saving}
            onChange={(event) => onDecision(event.target.value as Decision)}>
            <option value="">Выберите после проверки обоих листов</option>
            <option value="SAME_SCALAR_TOTAL">Одинаковая суммарная величина</option>
            <option value="NOT_COMPARABLE">Количество несопоставимо</option>
            <option value="UNSURE">Недостаточно оснований</option>
          </select></label>
          <label><input type="checkbox" checked={pdDenominatorAffirmed} disabled={saving}
            onChange={(event) => onDenominator(event.target.checked)} />
            Подтверждаю: значение ПД служит знаменателем для относительной проверки</label>
          <label><span>Область и границы подсчёта</span><textarea value={basis.scope}
            aria-label="Основание: область" maxLength={1000} disabled={saving}
            onChange={(event) => onBasis({ ...basis, scope: event.target.value })}
            placeholder="Какие помещения, системы или элементы входят в оба значения" /></label>
          <label><span>Тип величины и единица</span><textarea value={basis.quantityType}
            aria-label="Основание: тип величины" maxLength={1000} disabled={saving}
            onChange={(event) => onBasis({ ...basis, quantityType: event.target.value })}
            placeholder="Почему обе строки описывают один и тот же тип количества" /></label>
          <label><span>Период или состояние</span><textarea value={basis.period}
            aria-label="Основание: период" maxLength={1000} disabled={saving}
            onChange={(event) => onBasis({ ...basis, period: event.target.value })}
            placeholder="Период, редакция или состояние, к которым относятся значения" /></label>
          <label><span>Способ агрегации</span><textarea value={basis.aggregation}
            aria-label="Основание: агрегация" maxLength={1000} disabled={saving}
            onChange={(event) => onBasis({ ...basis, aggregation: event.target.value })}
            placeholder="Сумма, итог по объекту или другая проверенная агрегация" /></label>
          {candidate.pairSnapshot.review?.parameterCode === "SM-132" &&
            <label><span>Ценовой базис сметы</span><textarea value={basis.priceBasis ?? ""}
              aria-label="Основание: ценовой базис" maxLength={1000} disabled={saving}
              onChange={(event) => onBasis({ ...basis, priceBasis: event.target.value })}
              placeholder="Базисные или текущие цены, дата и индекс" /></label>}
          <p>Для положительного решения подтвердите знаменатель ПД и откройте оба исходных листа. Поля пусты по умолчанию. Сохранение не запускает сравнение.</p>
          <button type="submit" className="button button--primary"
            disabled={!input || saving || !openedFactIds.has(candidate.pdFact.factId)
              || !openedFactIds.has(candidate.rdFact.factId)}>
            {saving ? "Сохраняем…" : "Сохранить решение о сопоставимости"}
          </button>
        </form>}
      </>}
    </>}
  </>;
}

export function OcrFactPairQuantityReview({ checkId, objectId }: {
  checkId: string; objectId: string;
}) {
  const [list, setList] = useState<OcrFactPairQuantityReviewList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedDecisionId, setSelectedDecisionId] = useState("");
  const [decision, setDecision] = useState<Decision>("");
  const [pdDenominatorAffirmed, setPdDenominatorAffirmed] = useState(false);
  const [basis, setBasis] = useState<Basis>(blankBasis);
  const [saving, setSaving] = useState(false);
  const [openedFactIds, setOpenedFactIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setList(null); setLoading(true); setError(null); setNotice(null);
    setSelectedDecisionId(""); setDecision(""); setPdDenominatorAffirmed(false);
    setBasis(blankBasis()); setOpenedFactIds(new Set());
    void api.getOcrFactPairQuantityReviews(checkId).then((value) => {
      if (!cancelled) setList(value);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить решения");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [checkId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!list || saving) return;
    const candidate = list.candidates.find((item) =>
      item.pairSnapshot.decisionId === selectedDecisionId);
    const input = makeOcrFactPairQuantityReviewInput(list, checkId, selectedDecisionId,
      decision, pdDenominatorAffirmed, basis);
    if (!candidate || !input || !openedFactIds.has(candidate.pdFact.factId)
      || !openedFactIds.has(candidate.rdFact.factId)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.recordOcrFactPairQuantityReview(checkId, input);
      setList(await api.getOcrFactPairQuantityReviews(checkId));
      setDecision(""); setPdDenominatorAffirmed(false); setBasis(blankBasis());
      setNotice("Решение сохранено. Сравнение и замечание не создавались.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение");
    } finally { setSaving(false); }
  };

  return <section className="surface" aria-label="Количественная сопоставимость OCR-пары"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Решение эксперта</span>
      <h3>Сопоставимость количеств ПД и РД</h3></div></div>
    {loading && <p role="status">Загружаем снимки пар…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {list && <OcrFactPairQuantityPanel list={list} checkId={checkId} objectId={objectId}
      selectedDecisionId={selectedDecisionId} decision={decision}
      pdDenominatorAffirmed={pdDenominatorAffirmed} basis={basis} saving={saving}
      openedFactIds={openedFactIds}
      onSelect={(value) => { setSelectedDecisionId(value); setDecision("");
        setPdDenominatorAffirmed(false); setBasis(blankBasis()); setNotice(null); }}
      onDecision={(value) => { setDecision(value); setPdDenominatorAffirmed(false); }}
      onDenominator={setPdDenominatorAffirmed} onBasis={setBasis}
      onPreviewOpen={(factId) => setOpenedFactIds((current) => new Set(current).add(factId))}
      onSubmit={(event) => void save(event)} />}
  </section>;
}
