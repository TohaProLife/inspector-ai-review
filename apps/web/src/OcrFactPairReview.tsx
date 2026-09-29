import { useEffect, useState, type FormEvent } from "react";
import { api, type OcrFactPairCandidate, type OcrFactPairReviewInput,
  type OcrFactPairReviewList, type OcrTypedFactCandidate } from "./api";

type Decision = OcrFactPairReviewInput["decision"] | "";
const hash = (value: string) => /^[a-f0-9]{64}$/u.test(value);
const shortHash = (value: string) => `${value.slice(0, 12)}…`;
const safeText = (value: string, maxBytes: number) => value.length > 0
  && value === value.trim() && new TextEncoder().encode(value).byteLength <= maxBytes
  && !/[\p{Cc}\p{Cf}]/u.test(value);
const candidateKey = (candidate: OcrFactPairCandidate) =>
  `${candidate.pdFact.factId}:${candidate.rdFact.factId}`;

/** The server rederives facts, source decisions, locator hashes and pair eligibility. */
export function makeOcrFactPairReviewInput(list: OcrFactPairReviewList, checkId: string,
  selectedKey: string, decision: Decision, basis: string): OcrFactPairReviewInput | null {
  const candidate = list.candidates.find((item) => candidateKey(item) === selectedKey);
  const checkedBasis = basis.trim();
  if (!list.canReview || !candidate || !safeText(checkId, 128)
    || !["PAIR_CONFIRMED", "PAIR_REJECTED", "UNSURE"].includes(decision)
    || !safeText(checkedBasis, 2000) || !hash(candidate.artifactHash)
    || !hash(candidate.pdLocatorHash) || !hash(candidate.rdLocatorHash)
    || !hash(candidate.pdFact.factId) || !hash(candidate.rdFact.factId)
    || candidate.pdFact.factId === candidate.rdFact.factId
    || candidate.pdFact.stage !== "PD" || candidate.rdFact.stage !== "RD"
    || candidate.pdFact.targetCheckId !== checkId || candidate.rdFact.targetCheckId !== checkId
    || candidate.pdFact.objectId !== candidate.rdFact.objectId
    || candidate.pdFact.inputManifestHash !== candidate.rdFact.inputManifestHash
    || !hash(candidate.pdFact.inputManifestHash)
    || candidate.pdFact.sourceSha256 === candidate.rdFact.sourceSha256
    || candidate.pdFact.parameterCode !== candidate.parameterCode
    || candidate.rdFact.parameterCode !== candidate.parameterCode
    || candidate.pdFact.attribute !== candidate.attribute
    || candidate.rdFact.attribute !== candidate.attribute
    || candidate.pdFact.entityKey !== candidate.entityKey
    || candidate.rdFact.entityKey !== candidate.entityKey
    || candidate.pdFact.context !== candidate.context || candidate.rdFact.context !== candidate.context
    || !safeText(candidate.linkGroupId, 256)) return null;
  return { schemaVersion: "ocr-fact-pair-review-v1", decision: decision as OcrFactPairReviewInput["decision"],
    targetCheckId: checkId, inputManifestHash: candidate.pdFact.inputManifestHash,
    objectId: candidate.pdFact.objectId, parameterCode: candidate.parameterCode,
    attribute: candidate.attribute, pdFactId: candidate.pdFact.factId,
    pdLocatorHash: candidate.pdLocatorHash, rdFactId: candidate.rdFact.factId,
    rdLocatorHash: candidate.rdLocatorHash, entityKey: candidate.entityKey,
    context: candidate.context, linkGroupId: candidate.linkGroupId, basis: checkedBasis };
}

function FactProvenance({ fact, objectId, onPreviewOpen }: {
  fact: OcrTypedFactCandidate; objectId: string; onPreviewOpen: (factId: string) => void;
}) {
  return <div aria-label={`Происхождение факта ${fact.stage}`}>
    <p><strong>{fact.stage} · {fact.parameterCode}/{fact.attribute}</strong> · {fact.entityKey} · {fact.context}.</p>
    <p>Проверенная запись: «{fact.rawText}» · значение «{fact.rawValue} {fact.rawUnit}».</p>
    <p>Источник {fact.sourceFileId} · PDF-страница {fact.pageNumber} · раздел {fact.locator.sectionCode}.</p>
    <p>PDF SHA-256 <code title={fact.sourceSha256}>{shortHash(fact.sourceSha256)}</code> ·
      рендер SHA-256 <code title={fact.locator.renderSha256}>{shortHash(fact.locator.renderSha256)}</code> ·
      OCR-строка SHA-256 <code title={fact.locator.rowFingerprint}>{shortHash(fact.locator.rowFingerprint)}</code> ·
      локатор OCR_ROW · факт SHA-256 <code title={fact.factId}>{shortHash(fact.factId)}</code>.</p>
    <p>Снимок решения по источнику {fact.locator.sourceReviewDecisionId} ·
      снимок предметной проверки {fact.locator.applicabilityDecisionId}.</p>
    <a href={api.sourcePagePreviewUrl(objectId, fact.sourceFileId, fact.pageNumber)}
      onClick={() => onPreviewOpen(fact.factId)} target="_blank" rel="noopener noreferrer">
      Открыть исходный лист {fact.pageNumber}</a>
  </div>;
}

export function OcrFactPairPanel({ list, checkId, objectId, selectedKey, decision,
  basis, saving, openedFactIds, onSelect, onDecision, onBasis, onPreviewOpen, onSubmit }: {
  list: OcrFactPairReviewList; checkId: string; objectId: string;
  selectedKey: string; decision: Decision; basis: string; saving: boolean;
  openedFactIds: ReadonlySet<string>;
  onSelect: (value: string) => void; onDecision: (value: Decision) => void;
  onBasis: (value: string) => void; onPreviewOpen: (factId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const candidate = list.candidates.find((item) => candidateKey(item) === selectedKey);
  const input = makeOcrFactPairReviewInput(list, checkId, selectedKey, decision, basis);
  const saved = list.items.filter((item) => candidate
    && item.review.pdFactId === candidate.pdFact.factId
    && item.review.rdFactId === candidate.rdFact.factId);
  return <>
    <p><strong>Только проверка пары ПД и РД.</strong> Решение не сравнивает значения, не создаёт замечание или охват.</p>
    <p>Кандидатов пар: {list.candidates.length}. Сохранённых решений: {list.items.length}.</p>
    {!list.canReview && <p>У вас нет права сохранять решение по этой паре.</p>}
    {list.candidates.length === 0 ? <p role="status">Проверенных пар OCR-фактов пока нет. Нужны отдельные решения по обоим источникам, строкам и предметной применимости; сравнение остаётся остановленным.</p> : <>
      <label className="source-review-form"><span>Пара проверенных OCR-фактов</span>
        <select aria-label="Выберите пару OCR-фактов" value={selectedKey}
          onChange={(event) => onSelect(event.target.value)} disabled={saving}>
          <option value="">Выберите после проверки обоих листов</option>
          {list.candidates.map((item) => <option key={candidateKey(item)} value={candidateKey(item)}>
            {item.parameterCode}/{item.attribute} · {item.entityKey} ·
            ПД {item.pdFact.sourceFileId}:{item.pdFact.pageNumber} ·
            РД {item.rdFact.sourceFileId}:{item.rdFact.pageNumber}
          </option>)}
        </select>
      </label>
      {candidate && <>
        <p>Общий контекст: {candidate.context}. Проверенная группа источников: {candidate.linkGroupId}.</p>
        <p>Кандидаты происходят из сохранённого артефакта SHA-256
          <code title={candidate.artifactHash}> {shortHash(candidate.artifactHash)}</code>.
          Сопоставимость содержимого эксперт ещё не подтвердил.</p>
        <FactProvenance fact={candidate.pdFact} objectId={objectId} onPreviewOpen={onPreviewOpen} />
        <FactProvenance fact={candidate.rdFact} objectId={objectId} onPreviewOpen={onPreviewOpen} />
        <p>Локатор ПД SHA-256 <code title={candidate.pdLocatorHash}>{shortHash(candidate.pdLocatorHash)}</code> ·
          локатор РД SHA-256 <code title={candidate.rdLocatorHash}>{shortHash(candidate.rdLocatorHash)}</code>.</p>
        {saved.length > 0 && <div aria-label="История решений по OCR-паре">
          <h4>История решений: {saved.length}</h4>
          <ol>{saved.map((item) => <li key={item.id}>
            <strong>{item.review.decision === "PAIR_CONFIRMED" ? "Пара подтверждена"
              : item.review.decision === "PAIR_REJECTED" ? "Пара отклонена" : "Недостаточно оснований"}</strong>
            <p>Основание: {item.review.basis}. {new Date(item.createdAt).toLocaleString("ru-RU")} · решение {item.id}.</p>
          </li>)}</ol>
        </div>}
        {list.canReview && <form className="source-review-form" onSubmit={onSubmit}>
          <h4>Новое решение о соответствии элементов</h4>
          <label><span>Решение эксперта</span><select aria-label="Решение по OCR-паре" value={decision}
            onChange={(event) => onDecision(event.target.value as Decision)} disabled={saving}>
            <option value="">Выберите после проверки обоих исходных листов</option>
            <option value="PAIR_CONFIRMED">Факты относятся к одному элементу</option>
            <option value="PAIR_REJECTED">Факты не относятся к одному элементу</option>
            <option value="UNSURE">Недостаточно оснований</option>
          </select></label>
          <label><span>Основание решения</span><textarea aria-label="Основание OCR-пары" value={basis}
            maxLength={2000} onChange={(event) => onBasis(event.target.value)} disabled={saving}
            placeholder="Укажите обозначение элемента и проверенные ссылки на оба листа" /></label>
          <p>Откройте оба исходных листа. Поля решения пусты по умолчанию. Совпадение числа или текста само по себе не подтверждает пару.</p>
          <button type="submit" className="button button--primary"
            disabled={!input || saving || !openedFactIds.has(candidate.pdFact.factId)
              || !openedFactIds.has(candidate.rdFact.factId)}>
            {saving ? "Сохраняем…" : "Сохранить решение о паре"}
          </button>
        </form>}
      </>}
    </>}
  </>;
}

export function OcrFactPairReview({ checkId, objectId }: { checkId: string; objectId: string }) {
  const [list, setList] = useState<OcrFactPairReviewList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [decision, setDecision] = useState<Decision>("");
  const [basis, setBasis] = useState("");
  const [saving, setSaving] = useState(false);
  const [openedFactIds, setOpenedFactIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setList(null); setLoading(true); setError(null); setNotice(null);
    setSelectedKey(""); setDecision(""); setBasis(""); setOpenedFactIds(new Set());
    void api.getOcrFactPairReviews(checkId).then((value) => {
      if (!cancelled) setList(value);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить пары");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [checkId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!list || saving) return;
    const candidate = list.candidates.find((item) => candidateKey(item) === selectedKey);
    const input = makeOcrFactPairReviewInput(list, checkId, selectedKey, decision, basis);
    if (!candidate || !input || !openedFactIds.has(candidate.pdFact.factId)
      || !openedFactIds.has(candidate.rdFact.factId)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.recordOcrFactPairReview(checkId, input);
      setList(await api.getOcrFactPairReviews(checkId));
      setDecision(""); setBasis("");
      setNotice("Решение сохранено. Сравнение и замечание не создавались.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение");
    } finally { setSaving(false); }
  };

  return <section className="surface" aria-label="Проверка пары OCR-фактов ПД и РД"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Решение эксперта</span>
      <h3>Пара фактов из OCR-строк</h3></div></div>
    {loading && <p role="status">Загружаем проверенные пары…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {list && <OcrFactPairPanel list={list} checkId={checkId} objectId={objectId}
      selectedKey={selectedKey} decision={decision} basis={basis} saving={saving}
      openedFactIds={openedFactIds}
      onSelect={(value) => { setSelectedKey(value); setDecision(""); setBasis(""); setNotice(null); }}
      onDecision={setDecision} onBasis={setBasis}
      onPreviewOpen={(factId) => setOpenedFactIds((current) => new Set(current).add(factId))}
      onSubmit={(event) => void save(event)} />}
  </section>;
}
