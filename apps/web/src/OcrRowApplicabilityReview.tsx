import { useEffect, useState, type FormEvent } from "react";
import { api, type OcrRowApplicabilityReviewInput,
  type OcrRowApplicabilityReviewList } from "./api";

type Candidate = OcrRowApplicabilityReviewList["candidates"][number];
type Decision = OcrRowApplicabilityReviewInput["decision"] | "";
const hash = (value: string) => /^[a-f0-9]{64}$/u.test(value);
const shortHash = (value: string) => `${value.slice(0, 12)}…`;
const revisionName: Record<Candidate["sourceReview"]["revisionStatus"], string> = {
  CURRENT: "актуальна", SUPERSEDED: "заменена", UNKNOWN: "не установлена",
};
const approvalName: Record<Candidate["sourceReview"]["approvalStatus"], string> = {
  APPROVED: "утверждён", UNAPPROVED: "не утверждён", UNKNOWN: "не установлен",
};
const safeText = (value: string, maxBytes: number) => value.length > 0
  && new TextEncoder().encode(value).byteLength <= maxBytes
  && !/[\p{Cc}\p{Cf}]/u.test(value);

export function makeOcrRowApplicabilityInput(
  list: OcrRowApplicabilityReviewList, checkId: string, rowFingerprint: string,
  codeOptionIndex: string, decision: Decision, entityKey: string,
  context: string, basis: string,
): OcrRowApplicabilityReviewInput | null {
  if (!list.canReview || !safeText(checkId, 128) || !hash(rowFingerprint)
    || (decision !== "APPLICABLE" && decision !== "NOT_APPLICABLE"
      && decision !== "UNSURE")) return null;
  const candidate = list.candidates.find((item) => item.rowFingerprint === rowFingerprint);
  if (!candidate || !hash(candidate.sourceSha256) || !hash(candidate.renderSha256)
    || !hash(candidate.ocrStageSha256) || !hash(candidate.transcriptionDecisionHash)
    || !hash(candidate.sourceReviewDecisionHash)
    || !safeText(candidate.sourceFileId, 128)
    || !safeText(candidate.transcriptionDecisionId, 128)
    || !safeText(candidate.sourceReviewDecisionId, 128)
    || !Number.isSafeInteger(candidate.pageNumber) || candidate.pageNumber < 1) return null;
  const index = Number(codeOptionIndex);
  const option = /^[0-9]+$/u.test(codeOptionIndex) ? candidate.codeOptions[index] : undefined;
  if (!option || !safeText(option.parameterCode, 32) || !safeText(option.attribute, 128)
    || !["PD", "RD"].includes(option.stage)) return null;
  const checkedEntity = entityKey.trim();
  const checkedContext = context.trim();
  const checkedBasis = basis.trim();
  if (!safeText(checkedEntity, 256) || !safeText(checkedContext, 1000)
    || !safeText(checkedBasis, 1000)) return null;
  if (decision === "APPLICABLE" && (candidate.transcriptionDecision !== "CONFIRMED_TRANSCRIPTION"
    || candidate.sourceReview.revisionStatus !== "CURRENT"
    || candidate.sourceReview.approvalStatus !== "APPROVED"
    || !candidate.sourceReview.sectionCode
    || candidate.sourceReview.pageStage !== option.stage)) return null;
  return {
    schemaVersion: "ocr-row-applicability-review-v1", decision, targetCheckId: checkId,
    sourceFileId: candidate.sourceFileId, sourceSha256: candidate.sourceSha256,
    pageNumber: candidate.pageNumber, renderSha256: candidate.renderSha256,
    ocrStageSha256: candidate.ocrStageSha256, rowFingerprint,
    transcriptionDecisionId: candidate.transcriptionDecisionId,
    transcriptionDecisionHash: candidate.transcriptionDecisionHash,
    sourceReviewDecisionId: candidate.sourceReviewDecisionId,
    sourceReviewDecisionHash: candidate.sourceReviewDecisionHash,
    parameterCode: option.parameterCode, attribute: option.attribute, stage: option.stage,
    entityKey: checkedEntity, context: checkedContext, basis: checkedBasis,
  };
}

export function OcrRowApplicabilityPanel({ list, checkId, objectId,
  selectedFingerprint, codeOptionIndex, decision, entityKey, context, basis,
  saving, previewOpened, onSelect, onCodeOption, onDecision,
  onEntityKey, onContext, onBasis, onPreviewOpen, onSourceReviewOpen, onSubmit,
}: {
  list: OcrRowApplicabilityReviewList;
  checkId: string;
  objectId: string;
  selectedFingerprint: string;
  codeOptionIndex: string;
  decision: Decision;
  entityKey: string;
  context: string;
  basis: string;
  saving: boolean;
  previewOpened: boolean;
  onSelect: (value: string) => void;
  onCodeOption: (value: string) => void;
  onDecision: (value: Decision) => void;
  onEntityKey: (value: string) => void;
  onContext: (value: string) => void;
  onBasis: (value: string) => void;
  onPreviewOpen: () => void;
  onSourceReviewOpen: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const candidate = list.candidates.find((item) => item.rowFingerprint === selectedFingerprint);
  const saved = list.items.filter((item) => item.review.rowFingerprint === selectedFingerprint);
  const input = makeOcrRowApplicabilityInput(list, checkId, selectedFingerprint,
    codeOptionIndex, decision, entityKey, context, basis);
  return <>
    <p><strong>Только предметная проверка строки.</strong> Отдельное решение о чтении OCR и решение по источнику должны входить в неизменяемый запуск. Даже «Применима» не создаёт типизированный факт, пару ПД/РД, замечание или охват.</p>
    <p>Проверяемых снимков: {list.candidates.length}. Сохранённых решений: {list.items.length}.</p>
    {!list.canReview && <p>У вас нет права сохранять решения для этого запуска.</p>}
    {list.candidates.length === 0 ? <p role="status">В этом запуске нет проверенных снимков OCR-строки и источника. После отдельных решений о чтении строки и источнике нужен новый запуск; здесь сохранять нечего.</p> : <>
      <label className="source-review-form"><span>Строка с сохранёнными решениями</span>
        <select aria-label="Выберите проверенную OCR-строку" value={selectedFingerprint}
          onChange={(event) => onSelect(event.target.value)} disabled={saving}>
          <option value="">Выберите строку</option>
          {list.candidates.map((item) => <option key={item.rowFingerprint} value={item.rowFingerprint}>
            {item.sourceFileId}, PDF-страница {item.pageNumber}: {item.reviewedLabel ?? "чтение отклонено"} · {item.reviewedValue ?? "—"}
          </option>)}
        </select>
      </label>
      {candidate && <>
        <CandidateProvenance candidate={candidate} objectId={objectId}
          onPreviewOpen={onPreviewOpen} onSourceReviewOpen={onSourceReviewOpen} />
        {saved.length > 0 && <div aria-label="История решений о применимости">
          <h4>История решений: {saved.length}</h4>
          <ol>{saved.map((item) => <li key={item.id}>
            <strong>{item.review.decision === "APPLICABLE" ? "Применима для отдельной проверки факта"
              : item.review.decision === "NOT_APPLICABLE" ? "Не применима" : "Не определено"}</strong>
            <span> · {item.review.parameterCode}/{item.review.attribute} · {item.review.stage} · {item.review.entityKey}</span>
            <p>Основание: {item.review.basis}. {new Date(item.createdAt).toLocaleString("ru-RU")} · решение {item.id}.</p>
          </li>)}</ol>
        </div>}
        {list.canReview && <form className="source-review-form" onSubmit={onSubmit}>
          <h4>Новое решение о предметной применимости</h4>
          <label><span>Код, атрибут и стадия из правил</span>
            <select aria-label="Код, атрибут и стадия" value={codeOptionIndex}
              onChange={(event) => onCodeOption(event.target.value)} disabled={saving}>
              <option value="">Выберите после проверки документа</option>
              {candidate.codeOptions.map((option, index) => <option value={index} key={`${option.parameterCode}-${option.attribute}-${option.stage}`}>
                {option.parameterCode} · {option.attribute} · {option.stage}
              </option>)}
            </select>
          </label>
          {candidate.codeOptions.length === 0 && <p role="status">Для проверенного раздела нет разрешённых кодов в закреплённых правилах. Решение по коду недоступно.</p>}
          <label><span>Решение</span><select aria-label="Решение о применимости" value={decision}
            onChange={(event) => onDecision(event.target.value as Decision)} disabled={saving}>
            <option value="">Выберите после проверки листа и источника</option>
            <option value="APPLICABLE">Применима к выбранному атрибуту</option>
            <option value="NOT_APPLICABLE">Не применима к выбранному атрибуту</option>
            <option value="UNSURE">Недостаточно оснований</option>
          </select></label>
          <label><span>Объект или элемент на листе</span><input value={entityKey} maxLength={256}
            onChange={(event) => onEntityKey(event.target.value)} disabled={saving}
            placeholder="Точный объект или элемент, без догадки по имени файла" /></label>
          <label><span>Контекст строки</span><textarea value={context} maxLength={1000}
            onChange={(event) => onContext(event.target.value)} disabled={saving}
            placeholder="Помещение, система, таблица, раздел или иной проверенный контекст" /></label>
          <label><span>Основание решения</span><textarea value={basis} maxLength={1000}
            onChange={(event) => onBasis(event.target.value)} disabled={saving}
            placeholder="Что проверено на исходном листе и в решении по источнику" /></label>
          <p>Перед сохранением откройте исходный лист и сверьте показанный снимок решения по источнику. Поля пусты по умолчанию. Значения OCR и стадия из имени файла не подставляются как факты.</p>
          <button type="submit" className="button button--primary"
            disabled={!input || saving || !previewOpened}>
            {saving ? "Сохраняем…" : "Сохранить решение о применимости"}
          </button>
        </form>}
      </>}
    </>}
  </>;
}

function CandidateProvenance({ candidate, objectId, onPreviewOpen, onSourceReviewOpen }: {
  candidate: Candidate;
  objectId: string;
  onPreviewOpen: () => void;
  onSourceReviewOpen: () => void;
}) {
  const source = candidate.sourceReview;
  return <div aria-label="Происхождение строки и решений">
    <p>Проверенное чтение: {candidate.transcriptionDecision === "CONFIRMED_TRANSCRIPTION"
      ? `«${candidate.reviewedLabel}» · «${candidate.reviewedValue}» ${candidate.reviewedUnit ?? ""}`
      : "OCR-строка отклонена"}.</p>
    <p>Источник {candidate.sourceFileId} · PDF-страница {candidate.pageNumber} · раздел {source.sectionCode ?? "не установлен"} · стадия страницы {source.pageStage ?? "не установлена"}.</p>
    <p>Снимок проверки источника: редакция {revisionName[source.revisionStatus]}, статус согласования {approvalName[source.approvalStatus]}. Эти статусы не выводятся из OCR.</p>
    <p>PDF SHA-256 <code title={candidate.sourceSha256}>{shortHash(candidate.sourceSha256)}</code> · рендер SHA-256 <code title={candidate.renderSha256}>{shortHash(candidate.renderSha256)}</code> · OCR stage SHA-256 <code title={candidate.ocrStageSha256}>{shortHash(candidate.ocrStageSha256)}</code> · строка SHA-256 <code title={candidate.rowFingerprint}>{shortHash(candidate.rowFingerprint)}</code>.</p>
    <p>Снимок решения о чтении <code title={candidate.transcriptionDecisionHash}>{candidate.transcriptionDecisionId}</code> · снимок решения по источнику <code title={candidate.sourceReviewDecisionHash}>{candidate.sourceReviewDecisionId}</code>. Текущая проверка источника может уже отличаться от снимка запуска.</p>
    <div className="source-review-actions">
      <a href={api.sourcePagePreviewUrl(objectId, candidate.sourceFileId, candidate.pageNumber)}
        onClick={onPreviewOpen} target="_blank" rel="noopener noreferrer">Открыть исходный лист {candidate.pageNumber}</a>
      <button type="button" className="button button--secondary" onClick={onSourceReviewOpen}>
        Открыть текущую проверку источника
      </button>
    </div>
  </div>;
}

export function OcrRowApplicabilityReview({ checkId, objectId, onSources }: {
  checkId: string;
  objectId: string;
  onSources: () => void;
}) {
  const [list, setList] = useState<OcrRowApplicabilityReviewList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedFingerprint, setSelectedFingerprint] = useState("");
  const [codeOptionIndex, setCodeOptionIndex] = useState("");
  const [decision, setDecision] = useState<Decision>("");
  const [entityKey, setEntityKey] = useState("");
  const [context, setContext] = useState("");
  const [basis, setBasis] = useState("");
  const [saving, setSaving] = useState(false);
  const [openedFingerprints, setOpenedFingerprints] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setList(null); setLoading(true); setError(null); setNotice(null);
    setSelectedFingerprint(""); setCodeOptionIndex(""); setDecision("");
    setEntityKey(""); setContext(""); setBasis("");
    setOpenedFingerprints(new Set());
    void api.getOcrRowApplicabilityReviews(checkId).then((value) => {
      if (!cancelled) setList(value);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить решения");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [checkId]);

  const select = (value: string) => {
    setSelectedFingerprint(value); setCodeOptionIndex(""); setDecision("");
    setEntityKey(""); setContext(""); setBasis(""); setNotice(null);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!list || saving || !openedFingerprints.has(selectedFingerprint)) return;
    const input = makeOcrRowApplicabilityInput(list, checkId, selectedFingerprint,
      codeOptionIndex, decision, entityKey, context, basis);
    if (!input) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.recordOcrRowApplicabilityReview(checkId, input);
      setCodeOptionIndex(""); setDecision(""); setEntityKey(""); setContext(""); setBasis("");
      setNotice("Решение сохранено. Оно не создаёт факт, пару документов или замечание.");
      try { setList(await api.getOcrRowApplicabilityReviews(checkId)); }
      catch { setError("Решение сохранено, но история не обновилась. Перезагрузите страницу."); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение");
    } finally { setSaving(false); }
  };

  return <section className="surface" aria-label="Ручная проверка применимости OCR-строки"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Решение эксперта · предметная проверка</span>
      <h3>Проверить применимость строки</h3>
      <p>Отдельное решение по сохранённым снимкам чтения и источника.</p></div></div>
    {loading && <p role="status">Загружаем проверенные снимки…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {list && <OcrRowApplicabilityPanel list={list} checkId={checkId} objectId={objectId}
      selectedFingerprint={selectedFingerprint} codeOptionIndex={codeOptionIndex}
      decision={decision} entityKey={entityKey} context={context} basis={basis}
      saving={saving} previewOpened={openedFingerprints.has(selectedFingerprint)}
      onSelect={select}
      onCodeOption={setCodeOptionIndex} onDecision={setDecision}
      onEntityKey={setEntityKey} onContext={setContext} onBasis={setBasis}
      onPreviewOpen={() => setOpenedFingerprints((current) => new Set(current).add(selectedFingerprint))}
      onSourceReviewOpen={onSources}
      onSubmit={(event) => void save(event)} />}
  </section>;
}
