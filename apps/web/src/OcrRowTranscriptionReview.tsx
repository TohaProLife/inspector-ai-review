import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  type OcrRowTranscriptionReviewInput,
  type OcrRowTranscriptionReviewList,
} from "./api";

type Candidate = OcrRowTranscriptionReviewList["candidates"][number];
type Decision = OcrRowTranscriptionReviewInput["decision"] | "";
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const safeText = (value: string, maxBytes: number) =>
  value.length > 0 && byteLength(value) <= maxBytes && !/[\p{Cc}\p{Cf}]/u.test(value);

function joinedLabel(proposal: Candidate["proposal"]): string {
  return [proposal.labelEvidence, ...(proposal.labelContinuationEvidence ?? [])]
    .map((evidence) => evidence.text.trim()).filter(Boolean).join(" ");
}

function shortHash(value: string): string {
  return `${value.slice(0, 12)}…`;
}

export function makeOcrRowTranscriptionInput(
  list: OcrRowTranscriptionReviewList,
  rowFingerprint: string,
  decision: Decision,
  reviewedLabel: string,
  reviewedValue: string,
  reviewedUnit: string,
  basis: string,
): OcrRowTranscriptionReviewInput | null {
  if (!list.canReview || !list.candidates.some((item) => item.rowFingerprint === rowFingerprint)
    || !/^[a-f0-9]{64}$/.test(list.ocrStageSha256)
    || !/^[a-f0-9]{64}$/.test(rowFingerprint)) return null;
  const reason = basis.trim();
  if (reason.length < 8 || !safeText(reason, 1000)) return null;
  if (decision === "REJECTED") {
    return { schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: list.ocrStageSha256,
      rowFingerprint, decision, reviewedLabel: null, reviewedValue: null, reviewedUnit: null, basis: reason };
  }
  if (decision !== "CONFIRMED_TRANSCRIPTION") return null;
  const label = reviewedLabel.trim();
  const value = reviewedValue.trim();
  const unit = reviewedUnit.trim();
  if (!safeText(label, 512) || !safeText(value, 512)
    || (unit && !safeText(unit, 64))) return null;
  return { schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: list.ocrStageSha256,
    rowFingerprint, decision, reviewedLabel: label, reviewedValue: value,
    reviewedUnit: unit || null, basis: reason };
}

export function OcrRowTranscriptionPanel({ list, objectId, selectedFingerprint, decision,
  reviewedLabel, reviewedValue, reviewedUnit, basis, saving, previewOpened,
  onSelect, onDecision, onLabel, onValue, onUnit, onBasis, onPreviewOpen, onSubmit }: {
  list: OcrRowTranscriptionReviewList;
  objectId: string;
  selectedFingerprint: string;
  decision: Decision;
  reviewedLabel: string;
  reviewedValue: string;
  reviewedUnit: string;
  basis: string;
  saving: boolean;
  previewOpened: boolean;
  onSelect: (value: string) => void;
  onDecision: (value: Decision) => void;
  onLabel: (value: string) => void;
  onValue: (value: string) => void;
  onUnit: (value: string) => void;
  onBasis: (value: string) => void;
  onPreviewOpen: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const candidate = list.candidates.find((item) => item.rowFingerprint === selectedFingerprint);
  const saved = list.items.filter((item) => item.review.rowFingerprint === selectedFingerprint);
  const input = makeOcrRowTranscriptionInput(list, selectedFingerprint, decision,
    reviewedLabel, reviewedValue, reviewedUnit, basis);
  return <>
    <p><strong>Только проверка чтения строки.</strong> Решение не задаёт код параметра, не подтверждает факт, редакцию или согласование источника, не создаёт находку.</p>
    <p>OCR-строк для проверки: {list.candidates.length}. Сохранённых решений: {list.items.length}. OCR stage SHA-256 <code title={list.ocrStageSha256}>{shortHash(list.ocrStageSha256)}</code>.</p>
    {!list.canReview && <p>У вас нет права сохранять решение для этого запуска. Строки доступны только для просмотра.</p>}
    {list.candidates.length === 0 ? <p>Проверяемых строк нет. Это не доказывает отсутствие таблиц.</p> : <>
      <label className="source-review-form"><span>Строка OCR</span><select aria-label="Выберите строку OCR" value={selectedFingerprint}
        onChange={(event) => onSelect(event.target.value)} disabled={saving}>
        <option value="">Выберите строку</option>
        {list.candidates.map(({ rowFingerprint, proposal }) => <option key={rowFingerprint} value={rowFingerprint}>
          {proposal.sourceFileId}, стр. {proposal.pageNumber}: {joinedLabel(proposal)} · {proposal.valueEvidence.text}
        </option>)}
      </select></label>
      {candidate && <>
        <OcrRowEvidence candidate={candidate} objectId={objectId} onPreviewOpen={onPreviewOpen} />
        {saved.length > 0 && <div aria-label="История решений по строке">
          <h4>История решений: {saved.length}</h4>
          <ol>{saved.map((item) => <li key={item.id}>
            <strong>{item.review.decision === "CONFIRMED_TRANSCRIPTION" ? "Чтение строки подтверждено" : "Предложение отклонено"}</strong>
            {item.review.decision === "CONFIRMED_TRANSCRIPTION" && <span> · «{item.review.reviewedLabel}» · «{item.review.reviewedValue}» {item.review.reviewedUnit ?? ""}</span>}
            <p>Основание: {item.review.basis}. {new Date(item.createdAt).toLocaleString("ru-RU")} · решение {item.id}.</p>
          </li>)}</ol>
        </div>}
        {list.canReview && <form className="source-review-form" onSubmit={onSubmit}>
          <h4>Новое решение эксперта по чтению строки</h4>
          <label><span>Решение</span><select aria-label="Решение по OCR-строке" value={decision}
            onChange={(event) => onDecision(event.target.value as Decision)} disabled={saving}>
            <option value="">Выберите после сверки с листом</option>
            <option value="CONFIRMED_TRANSCRIPTION">Подтвердить прочитанный текст</option>
            <option value="REJECTED">Отклонить предложение OCR</option>
          </select></label>
          {decision === "CONFIRMED_TRANSCRIPTION" && <>
            <label><span>Проверенная подпись</span><input value={reviewedLabel} maxLength={512} disabled={saving}
              onChange={(event) => onLabel(event.target.value)} placeholder="Перепишите подпись с исходного листа" /></label>
            <label><span>Проверенное значение</span><input value={reviewedValue} maxLength={512} disabled={saving}
              onChange={(event) => onValue(event.target.value)} placeholder="Перепишите значение с исходного листа" /></label>
            <label><span>Единица на листе, если указана</span><input value={reviewedUnit} maxLength={64} disabled={saving}
              onChange={(event) => onUnit(event.target.value)} placeholder="Например, м²" /></label>
          </>}
          <label><span>Основание решения</span><input value={basis} minLength={8} maxLength={1000}
            disabled={saving} onChange={(event) => onBasis(event.target.value)}
            placeholder="Что видно на исходном листе и почему OCR-строка верна или ошибочна" />
            <small>Одна строка, до 1000 байт. Решение касается только чтения OCR.</small></label>
          <p>Сверьте исходный лист. Пустые поля не заполняются данными OCR автоматически. {previewOpened
            ? "Ссылка на исходный лист открыта." : "Откройте исходный лист по ссылке выше перед сохранением."}</p>
          <button type="submit" className="button button--primary" disabled={!input || saving || !previewOpened}>
            {saving ? "Сохраняем…" : "Сохранить решение о чтении"}
          </button>
        </form>}
      </>}
    </>}
  </>;
}

function OcrRowEvidence({ candidate, objectId, onPreviewOpen }: {
  candidate: Candidate;
  objectId: string;
  onPreviewOpen: () => void;
}) {
  const { proposal, rowFingerprint } = candidate;
  return <div aria-label="Происхождение строки OCR">
    <p><strong>OCR предложил:</strong> «{joinedLabel(proposal)}» · «{proposal.valueEvidence.text}».</p>
    <p>Источник {proposal.sourceFileId} · страница PDF {proposal.pageNumber} · строки OCR {proposal.labelEvidence.lineIndex + 1} и {proposal.valueEvidence.lineIndex + 1}.</p>
    <p>Подпись: OCR-строка {proposal.labelEvidence.lineIndex + 1}, «{proposal.labelEvidence.text}», рамка [{proposal.labelEvidence.bboxPx.join(", ")}] px, оценка OCR {proposal.labelEvidence.score.toFixed(3)}.</p>
    {proposal.labelContinuationEvidence?.map((evidence) => <p key={evidence.lineIndex}>
      Продолжение подписи: OCR-строка {evidence.lineIndex + 1}, «{evidence.text}», рамка [{evidence.bboxPx.join(", ")}] px, оценка OCR {evidence.score.toFixed(3)}.
    </p>)}
    <p>Рамка подписи [{proposal.labelEvidence.bboxPx.join(", ")}] px; рамка значения [{proposal.valueEvidence.bboxPx.join(", ")}] px, оценка OCR {proposal.valueEvidence.score.toFixed(3)}.</p>
    <p>PDF SHA-256 <code title={proposal.inputSha256}>{shortHash(proposal.inputSha256)}</code> · рендер SHA-256 <code title={proposal.renderSha256}>{shortHash(proposal.renderSha256)}</code> · OCR-страница SHA-256 <code title={proposal.ocrPageContentHash}>{shortHash(proposal.ocrPageContentHash)}</code> · строка SHA-256 <code title={rowFingerprint}>{shortHash(rowFingerprint)}</code>.</p>
    <a href={api.sourcePagePreviewUrl(objectId, proposal.sourceFileId, proposal.pageNumber)}
      onClick={onPreviewOpen}
      target="_blank" rel="noopener noreferrer">Открыть исходный лист {proposal.pageNumber}</a>
  </div>;
}

export function OcrRowTranscriptionReview({ checkId, objectId }: { checkId: string; objectId: string }) {
  const [list, setList] = useState<OcrRowTranscriptionReviewList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedFingerprint, setSelectedFingerprint] = useState("");
  const [decision, setDecision] = useState<Decision>("");
  const [reviewedLabel, setReviewedLabel] = useState("");
  const [reviewedValue, setReviewedValue] = useState("");
  const [reviewedUnit, setReviewedUnit] = useState("");
  const [basis, setBasis] = useState("");
  const [saving, setSaving] = useState(false);
  const [openedFingerprints, setOpenedFingerprints] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setList(null); setLoading(true); setError(null); setNotice(null);
    setSelectedFingerprint(""); setDecision(""); setReviewedLabel(""); setReviewedValue("");
    setReviewedUnit(""); setBasis(""); setOpenedFingerprints(new Set());
    void api.getOcrRowTranscriptionReviews(checkId).then((value) => {
      if (!cancelled) setList(value);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить решения OCR");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [checkId]);

  const select = (value: string) => {
    setSelectedFingerprint(value); setDecision(""); setReviewedLabel(""); setReviewedValue("");
    setReviewedUnit(""); setBasis(""); setNotice(null);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!list || saving || !openedFingerprints.has(selectedFingerprint)) return;
    const input = makeOcrRowTranscriptionInput(list, selectedFingerprint, decision,
      reviewedLabel, reviewedValue, reviewedUnit, basis);
    if (!input) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await api.recordOcrRowTranscriptionReview(checkId, input);
      setDecision(""); setReviewedLabel(""); setReviewedValue(""); setReviewedUnit(""); setBasis("");
      setNotice("Решение о чтении строки сохранено. Оно не подтверждает параметр или источник.");
      try { setList(await api.getOcrRowTranscriptionReviews(checkId)); }
      catch { setError("Решение сохранено, но история не обновилась. Перезагрузите страницу для актуального списка."); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить решение OCR");
    } finally { setSaving(false); }
  };

  return <section className="surface" aria-label="Ручное подтверждение чтения OCR-строк"
    style={{ marginTop: "var(--space-lg)", padding: "var(--space-lg)" }}>
    <div className="surface-title"><div><span className="kicker">Решение эксперта · OCR</span>
      <h3>Проверить чтение строки таблицы</h3><p>Запись привязана к сохранённому запуску и исходному листу.</p></div></div>
    {loading && <p role="status">Загружаем строки и решения…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {list && <OcrRowTranscriptionPanel list={list} objectId={objectId}
      selectedFingerprint={selectedFingerprint} decision={decision}
      reviewedLabel={reviewedLabel} reviewedValue={reviewedValue} reviewedUnit={reviewedUnit}
      basis={basis} saving={saving} previewOpened={openedFingerprints.has(selectedFingerprint)}
      onSelect={select} onDecision={setDecision}
      onLabel={setReviewedLabel} onValue={setReviewedValue} onUnit={setReviewedUnit}
      onBasis={setBasis} onPreviewOpen={() => setOpenedFingerprints((current) => new Set(current).add(selectedFingerprint))}
      onSubmit={(event) => void save(event)} />}
  </section>;
}
