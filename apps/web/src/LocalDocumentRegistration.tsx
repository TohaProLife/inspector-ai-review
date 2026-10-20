import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { LocalDocumentAnchor, LocalDocumentFrame, LocalDocumentPoint, LocalDocumentRegistrationPacket,
  LocalDocumentRegistrationPreview, LocalDocumentRegistrationReview } from "../../../packages/contracts/src/local-document-registration.js";
import { createLocalRegistrationDraft, localRegistrationDraftIssues, localRegistrationFrameIdentity, savedLocalRegistrationMatches } from "./local-document-registration-state";
import "./local-document-registration.css";

export interface LocalDocumentRegistrationProps {
  sourceFrame: LocalDocumentFrame;
  targetFrame: LocalDocumentFrame;
  sourcePreviewUrl: string;
  targetPreviewUrl: string;
  initialPacket?: LocalDocumentRegistrationPacket;
  initialReview?: LocalDocumentRegistrationReview;
  readOnly?: boolean;
  onPreview?: (packet: LocalDocumentRegistrationPacket) => Promise<LocalDocumentRegistrationPreview>;
  onSaveReview?: (packet: LocalDocumentRegistrationPacket,
    preview: LocalDocumentRegistrationPreview) => Promise<LocalDocumentRegistrationReview>;
}

export function LocalDocumentRegistrationOutcome({ preview, review }: {
  preview: LocalDocumentRegistrationPreview | null; review: LocalDocumentRegistrationReview | null;
}) {
  if (!preview) return null;
  const result = preview.result;
  if (result.status === "ABSTAIN") return <p role="status">Локальная привязка не принята: {result.reasonCode}.</p>;
  const saved = savedLocalRegistrationMatches(preview, review);
  return <section aria-label="Результат локальной привязки" className="local-registration-outcome">
    <p>{saved ? "Локальная привязка сохранена" : "Предварительный расчёт; решение по опорам ещё не сохранено"}.</p>
    <p>Опор для расчёта: {result.fitResiduals.length}; контрольных вне расчёта: {result.holdoutResiduals.length}.
      Максимальный остаток: {result.maxResidualTargetPoints.toPrecision(4)} пункта листа.
      Погрешность с локализацией: {result.uncertaintyTargetPoints.toPrecision(4)} пункта.</p>
    <p>{result.metricScale ? `Масштаб: ${result.metricScale.metresPerVisiblePoint} м/пункт; основание: ${result.metricScale.evidenceRef}.`
      : "Метрический масштаб не установлен. Расстояния в метрах не оцениваются."}</p>
    <p>Сравнение допустимо только внутри области опор. Абсолютная система координат не подтверждалась.</p>
    {saved && review && <p>Решение {review.reviewId} · инспектор {review.actorId} · {review.reviewedAt}</p>}
  </section>;
}

export function LocalDocumentRegistration(props: LocalDocumentRegistrationProps) {
  const scope = `${localRegistrationFrameIdentity(props.sourceFrame)}|${localRegistrationFrameIdentity(props.targetFrame)}`;
  const initial = () => props.initialPacket
    && localRegistrationFrameIdentity(props.initialPacket.sourceFrame) === localRegistrationFrameIdentity(props.sourceFrame)
    && localRegistrationFrameIdentity(props.initialPacket.targetFrame) === localRegistrationFrameIdentity(props.targetFrame)
    ? structuredClone(props.initialPacket) : createLocalRegistrationDraft(props.sourceFrame, props.targetFrame);
  const [packet, setPacket] = useState(initial);
  const [draftScope, setDraftScope] = useState(scope);
  const generation = useRef(0);
  const [pendingSource, setPendingSource] = useState<LocalDocumentPoint | null>(null);
  const restoredReview = () => props.initialPacket && props.initialReview
    && localRegistrationFrameIdentity(props.initialPacket.sourceFrame) === localRegistrationFrameIdentity(props.sourceFrame)
    && localRegistrationFrameIdentity(props.initialPacket.targetFrame) === localRegistrationFrameIdentity(props.targetFrame)
    && localRegistrationFrameIdentity(props.initialReview.result.sourceFrame) === localRegistrationFrameIdentity(props.sourceFrame)
    && localRegistrationFrameIdentity(props.initialReview.result.targetFrame) === localRegistrationFrameIdentity(props.targetFrame)
    ? props.initialReview : null;
  const [preview, setPreview] = useState<LocalDocumentRegistrationPreview | null>(() => {
    const saved = restoredReview(); return saved ? { status: "PREVIEW_ONLY", result: saved.result } : null;
  });
  const [review, setReview] = useState<LocalDocumentRegistrationReview | null>(restoredReview);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (scope === draftScope) return;
    generation.current += 1; setPacket(initial()); setDraftScope(scope); setPendingSource(null);
    const saved = restoredReview();
    setPreview(saved ? { status: "PREVIEW_ONLY", result: saved.result } : null); setReview(saved);
    setAcknowledged(false); setBusy(false); setError(null);
  }, [scope, draftScope]);
  const issues = localRegistrationDraftIssues(packet);
  const disabled = props.readOnly === true || busy;
  function change(next: LocalDocumentRegistrationPacket) {
    generation.current += 1;
    setPacket(next); setPreview(null); setReview(null); setAcknowledged(false); setError(null);
  }
  function updateAnchor(id: string, patch: Partial<LocalDocumentAnchor>) {
    change({ ...packet, anchors: packet.anchors.map((anchor) => anchor.id === id ? { ...anchor, ...patch } : anchor) });
  }
  function addAnchor(source: LocalDocumentPoint, target: LocalDocumentPoint) {
    if (packet.anchors.length >= 64) return;
    let ordinal = packet.anchors.length + 1;
    while (packet.anchors.some((anchor) => anchor.id === `anchor-${ordinal}`)) ordinal += 1;
    change({ ...packet, anchors: [...packet.anchors, { id: `anchor-${ordinal}`, source, target,
      role: packet.anchors.filter((anchor) => anchor.role === "FIT").length < 3 ? "FIT" : "HOLDOUT",
      referenceKind: "DOCUMENT_AXIS", sourceLocator: "", targetLocator: "" }] });
  }
  function selectPoint(event: MouseEvent<HTMLButtonElement>, side: "source" | "target") {
    if (disabled) return;
    const box = event.currentTarget.querySelector("img")?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const selected: LocalDocumentPoint = event.detail === 0 ? [0.5, 0.5]
      : [Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
        Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))];
    if (side === "source") setPendingSource(selected);
    else if (pendingSource) { addAnchor(pendingSource, selected); setPendingSource(null); }
  }
  async function calculate() {
    if (!props.onPreview || disabled || issues.length) return;
    const requestGeneration = ++generation.current;
    setBusy(true); setError(null); setReview(null);
    try { const value = await props.onPreview(packet); if (generation.current === requestGeneration) setPreview(value); }
    catch (caught) { if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : "Расчёт недоступен"); }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  async function save() {
    if (!props.onSaveReview || !preview || preview.result.status !== "REGISTERED_RELATIVE" || !acknowledged || disabled) return;
    const requestGeneration = ++generation.current;
    setBusy(true); setError(null);
    try {
      const receipt = await props.onSaveReview(packet, preview);
      if (!savedLocalRegistrationMatches(preview, receipt)) throw new Error("Сохранённое решение не соответствует расчёту");
      if (generation.current === requestGeneration) setReview(receipt);
    } catch (caught) { if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : "Решение не сохранено"); }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "local-document-registration-draft.json";
    link.click(); URL.revokeObjectURL(url);
  }
  const framePanel = (side: "source" | "target", frame: LocalDocumentFrame, url: string) => <section>
    <h4>{side === "source" ? "Исходный лист" : "Сопоставляемый лист"}</h4>
    <p>{frame.sourceFileId} · страница PDF {frame.pdfPageNumber} · редакция {frame.revisionKey}<br />
      Этаж {frame.floorKey} · этап {frame.phaseKey}<br /><code title={frame.sourceSha256}>SHA-256 {frame.sourceSha256.slice(0, 12)}…</code></p>
    <button type="button" className="local-registration-sheet" disabled={disabled}
      onClick={event => selectPoint(event, side)} aria-label={`Отметить опору: ${side === "source" ? "исходный" : "сопоставляемый"} лист`}>
      <img src={url} alt={`${frame.sourceFileId}, исходная страница PDF ${frame.pdfPageNumber}`} />
      {packet.anchors.map((anchor, i) => <span key={anchor.id} className={`local-registration-marker ${anchor.role.toLowerCase()}`}
        style={{ left: `${anchor[side][0] * 100}%`, top: `${anchor[side][1] * 100}%` }}>{i + 1}</span>)}
      {side === "source" && pendingSource && <span className="local-registration-marker pending"
        style={{ left: `${pendingSource[0] * 100}%`, top: `${pendingSource[1] * 100}%` }}>+</span>}
    </button>
  </section>;
  if (scope !== draftScope) return <p role="status">Обновление листов локальной привязки…</p>;
  return <section className="local-document-registration" aria-label="Локальная привязка чертежей">
    <h3>Локальная привязка по осям и устойчивым опорам</h3>
    <p>Сопоставьте минимум три неколлинеарные опоры; ещё одну оставьте для независимой проверки расчёта.
      Контур проверяемого здания нельзя использовать для устранения его собственного смещения.</p>
    <p>{pendingSource ? "Теперь отметьте ту же опору на сопоставляемом листе." : "Отметьте опору сначала на исходном, затем на сопоставляемом листе. Координаты можно задать вручную ниже."}</p>
    <div className="local-registration-sheets">
      {framePanel("source", packet.sourceFrame, props.sourcePreviewUrl)}
      {framePanel("target", packet.targetFrame, props.targetPreviewUrl)}
    </div>
    <div className="local-registration-controls">
      <label>Преобразование<select disabled={disabled} value={packet.method} onChange={event => change({ ...packet,
        method: event.target.value as LocalDocumentRegistrationPacket["method"] })}>
        <option value="RIGID">Перенос и поворот</option><option value="SIMILARITY">Перенос, поворот и единый масштаб</option>
        <option value="AFFINE">Аффинное: только при искажении скана</option></select></label>
      <label>Основание<select disabled={disabled} value={packet.basis.kind} onChange={event => change({ ...packet,
        basis: { ...packet.basis, kind: event.target.value as LocalDocumentRegistrationPacket["basis"]["kind"] } })}>
        <option value="DOCUMENT_AXES">Оси документов</option><option value="STABLE_REFERENCES">Устойчивые опоры</option>
        <option value="SCAN_DISTORTION">Подтверждённое искажение скана</option></select></label>
      <label>Адреса основания на оригиналах<textarea disabled={disabled} value={packet.basis.evidenceRefs.join("\n")}
        placeholder="Документ, страница, оси или размерная цепочка" onChange={event => change({ ...packet,
          basis: { ...packet.basis, evidenceRefs: event.target.value.split("\n").filter(Boolean) } })} /></label>
      <label>Максимальный остаток, пунктов<input disabled={disabled} type="number" min="0.000001" step="0.1"
        value={packet.maxResidualTargetPoints} onChange={event => change({ ...packet, maxResidualTargetPoints: Number(event.target.value) })} /></label>
      <label>Нижняя граница масштаба<input disabled={disabled} type="number" min="0.000001" step="0.01"
        value={packet.minScale} onChange={event => change({ ...packet, minScale: Number(event.target.value) })} /></label>
      <label>Верхняя граница масштаба<input disabled={disabled} type="number" min="0.000001" step="0.01"
        value={packet.maxScale} onChange={event => change({ ...packet, maxScale: Number(event.target.value) })} /></label>
      <label>Максимальное отношение масштабов осей<input disabled={disabled} type="number" min="1" max="2" step="0.01"
        value={packet.maxAnisotropy} onChange={event => change({ ...packet, maxAnisotropy: Number(event.target.value) })} /></label>
      <label>Погрешность опор исходного листа, пунктов<input disabled={disabled} type="number" min="0" step="0.1"
        value={packet.sourceLocalizationUncertaintyPt} onChange={event => change({ ...packet, sourceLocalizationUncertaintyPt: Number(event.target.value) })} /></label>
      <label>Погрешность опор сопоставляемого листа, пунктов<input disabled={disabled} type="number" min="0" step="0.1"
        value={packet.targetLocalizationUncertaintyPt} onChange={event => change({ ...packet, targetLocalizationUncertaintyPt: Number(event.target.value) })} /></label>
      <label>Метрический масштаб, м/пункт<input disabled={disabled} type="number" min="0.000001" step="0.001"
        value={packet.targetScale ? packet.targetScale.unitsPerVisiblePoint * ({ m: 1, cm: 0.01, mm: 0.001 }[packet.targetScale.unit]) : ""} placeholder="Не установлен" onChange={event => change({ ...packet,
          targetScale: event.target.value ? { unit: "m", unitsPerVisiblePoint: Number(event.target.value),
            relativeUncertainty: packet.targetScale?.relativeUncertainty ?? 0.01, evidenceRef: packet.targetScale?.evidenceRef ?? "" } : null })} /></label>
      {packet.targetScale && <label>Основание масштаба<input disabled={disabled} value={packet.targetScale.evidenceRef}
        onChange={event => change({ ...packet, targetScale: { ...packet.targetScale!, evidenceRef: event.target.value } })} /></label>}
      {packet.targetScale && <label>Относительная погрешность масштаба<input disabled={disabled} type="number" min="0" max="0.9999" step="0.001"
        value={packet.targetScale.relativeUncertainty} onChange={event => change({ ...packet,
          targetScale: { ...packet.targetScale!, relativeUncertainty: Number(event.target.value) } })} /></label>}
    </div>
    <div className="local-registration-anchors">{packet.anchors.map((anchor, i) => <fieldset key={anchor.id} disabled={disabled}>
      <legend>Опора {i + 1}</legend>
      <label>Роль<select value={anchor.role} onChange={event => updateAnchor(anchor.id, { role: event.target.value as LocalDocumentAnchor["role"] })}>
        <option value="FIT">Для расчёта</option><option value="HOLDOUT">Контрольная, вне расчёта</option></select></label>
      <label>Тип<select value={anchor.referenceKind} onChange={event => updateAnchor(anchor.id, { referenceKind: event.target.value as LocalDocumentAnchor["referenceKind"] })}>
        <option value="DOCUMENT_AXIS">Пересечение осей</option><option value="STABLE_REFERENCE">Устойчивая опора</option></select></label>
      {(["source", "target"] as const).map(side => <div key={side}>
        <label>{side === "source" ? "Обозначение на исходном листе" : "Обозначение на сопоставляемом листе"}
          <input value={anchor[`${side}Locator`]} onChange={event => updateAnchor(anchor.id, { [`${side}Locator`]: event.target.value })} /></label>
        <div className="local-registration-coordinates">{([0, 1] as const).map(axis => <label key={axis}>{side === "source" ? "Исходный" : "Сопоставляемый"} {axis ? "y" : "x"}
          <input type="number" min={0} max={1} step="0.000001" value={anchor[side][axis]}
            onChange={event => { const next: LocalDocumentPoint = [...anchor[side]]; next[axis] = Number(event.target.value); updateAnchor(anchor.id, { [side]: next }); }} /></label>)}</div>
      </div>)}
      <button type="button" onClick={() => change({ ...packet, anchors: packet.anchors.filter(item => item.id !== anchor.id) })}>Удалить опору {i + 1}</button>
    </fieldset>)}</div>
    <button type="button" disabled={disabled || packet.anchors.length >= 64} onClick={() => addAnchor([0.5, 0.5], [0.5, 0.5])}>Добавить опору вручную</button>
    {issues.length > 0 && <ul aria-label="Недостающие условия привязки">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <div className="local-registration-actions">
      <button type="button" disabled={disabled || issues.length > 0 || !props.onPreview} onClick={() => void calculate()}>{busy ? "Проверка…" : "Рассчитать и проверить остатки"}</button>
      <button type="button" disabled={busy} onClick={download}>Скачать пакет опор</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <LocalDocumentRegistrationOutcome preview={preview} review={review} />
    {preview?.result.status === "REGISTERED_RELATIVE" && !savedLocalRegistrationMatches(preview, review) && <>
      <label className="local-registration-acknowledgement"><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
        Проверил оригиналы и соответствие опор. Контрольные точки не использованы при расчёте; объект, этаж и этап совпадают.</label>
      <button type="button" disabled={disabled || !acknowledged || !props.onSaveReview} onClick={() => void save()}>Сохранить решение по локальной привязке</button>
    </>}
  </section>;
}
