import { useEffect, useRef, useState } from "react";
import type { SourceFileSummary } from "@inspector-ai/contracts";
import type { LocalDocumentFrame, LocalDocumentRegistrationSaveInput,
  LocalDocumentRegistrationWorkspaceRead, PersistedLocalDocumentRegistrationReview } from "../../../packages/contracts/src/local-document-registration.js";
import { api } from "./api";
import { LocalDocumentRegistration } from "./LocalDocumentRegistration";
import { localRegistrationFrameIdentity } from "./local-document-registration-state";
import "./local-document-registration.css";

interface Selection { sourceFileId: string; page: number; floorKey: string; phaseKey: string }
interface OpenPages { source: LocalDocumentFrame; target: LocalDocumentFrame; saved: PersistedLocalDocumentRegistrationReview | null }
const emptySelection = (): Selection => ({ sourceFileId: "", page: 1, floorKey: "", phaseKey: "" });
const frameSelection = (frame: LocalDocumentFrame): Selection => ({ sourceFileId: frame.sourceFileId,
  page: frame.pdfPageNumber, floorKey: frame.floorKey, phaseKey: frame.phaseKey });
const validSelection = (value: Selection) => value.sourceFileId && Number.isSafeInteger(value.page)
  && value.page > 0 && value.page <= 10_000 && value.floorKey.trim() && value.phaseKey.trim();

/** Source bytes and canonical frames always come from the authenticated API. Anchors are never pre-invented. */
export function LocalRegistrationWorkspace({ objectId, checkId }: { objectId: string; checkId?: string | null }) {
  const [files, setFiles] = useState<SourceFileSummary[]>([]);
  const [workspace, setWorkspace] = useState<LocalDocumentRegistrationWorkspaceRead | null>(null);
  const [source, setSource] = useState<Selection>(emptySelection);
  const [target, setTarget] = useState<Selection>(emptySelection);
  const [pages, setPages] = useState<OpenPages | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const command = useRef<{ body: string; key: string } | null>(null);
  const currentObject = useRef(objectId); currentObject.current = objectId;

  async function openPages(left: Selection, right: Selection, saved: PersistedLocalDocumentRegistrationReview | null,
    requestGeneration: number) {
    const frame = (selection: Selection) => api.getLocalRegistrationFrame(objectId, selection.sourceFileId,
      selection.page, selection.floorKey.trim(), selection.phaseKey.trim());
    const [sourceFrame, targetFrame] = await Promise.all([frame(left), frame(right)]);
    if (generation.current !== requestGeneration) return;
    if (saved && (localRegistrationFrameIdentity(saved.packet.sourceFrame) !== localRegistrationFrameIdentity(sourceFrame)
      || localRegistrationFrameIdentity(saved.packet.targetFrame) !== localRegistrationFrameIdentity(targetFrame))) {
      throw new Error("Канонические страницы сохранённого решения изменились; требуется новая проверка опор");
    }
    setPages({ source: sourceFrame, target: targetFrame, saved });
  }

  async function reload() {
    const requestGeneration = ++generation.current;
    setBusy(true); setError(null); setPages(null); command.current = null;
    try {
      const [fileRead, read] = await Promise.all([api.listSourceFiles(objectId), api.getLocalRegistrationWorkspace(objectId)]);
      if (generation.current !== requestGeneration) return;
      setFiles(fileRead.items); setWorkspace(read);
      const saved = read.latest;
      const left = saved ? frameSelection(saved.packet.sourceFrame)
        : { ...emptySelection(), sourceFileId: (fileRead.items.find(file => file.stages.includes("PD")) ?? fileRead.items[0])?.id ?? "" };
      const right = saved ? frameSelection(saved.packet.targetFrame)
        : { ...emptySelection(), sourceFileId: (fileRead.items.find(file => file.stages.includes("RD")) ?? fileRead.items[1])?.id ?? "" };
      setSource(left); setTarget(right); setReason(saved?.reason ?? "");
      if (saved) await openPages(left, right, saved, requestGeneration);
    } catch (caught) { if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : "Привязка недоступна"); }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  useEffect(() => {
    setWorkspace(null); setFiles([]); setSource(emptySelection()); setTarget(emptySelection()); setReason("");
    void reload();
    return () => { generation.current += 1; };
  }, [objectId, checkId]);

  function select(side: "source" | "target", next: Selection) {
    generation.current += 1; command.current = null; setPages(null); setError(null);
    if (side === "source") setSource(next); else setTarget(next);
  }
  async function openSelected() {
    if (!validSelection(source) || !validSelection(target)) return;
    const requestGeneration = ++generation.current;
    setBusy(true); setError(null); setPages(null); command.current = null;
    try { await openPages(source, target, null, requestGeneration); }
    catch (caught) { if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : "Исходные страницы недоступны"); }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  const selectionPanel = (side: "source" | "target", value: Selection) => <fieldset disabled={busy}>
    <legend>{side === "source" ? "Исходный документ" : "Сопоставляемый документ"}</legend>
    <label>Файл<select value={value.sourceFileId} onChange={event => select(side, { ...value, sourceFileId: event.target.value, page: 1 })}>
      <option value="">Выберите файл PDF</option>
      {files.map(file => <option key={file.id} value={file.id}>{file.name} · {file.stages.join("/")} · {file.sha256.slice(0, 10)}</option>)}
    </select></label>
    <label>Страница PDF<input type="number" min="1" max="10000" value={value.page}
      onChange={event => select(side, { ...value, page: Number(event.target.value) })} /></label>
    <label>Этаж по оригиналу<input maxLength={128} value={value.floorKey}
      onChange={event => select(side, { ...value, floorKey: event.target.value })} /></label>
    <label>Этап строительства по оригиналу<input maxLength={128} value={value.phaseKey}
      onChange={event => select(side, { ...value, phaseKey: event.target.value })} /></label>
    {value.sourceFileId && <a href={api.sourceFileUrl(objectId, value.sourceFileId)} target="_blank" rel="noreferrer">Открыть исходный PDF</a>}
  </fieldset>;
  return <details className="local-document-registration local-registration-workspace">
    <summary>Локальная привязка двух исходных листов</summary>
    <p>Собственные оси документов позволяют сопоставлять листы без внешней геодезической ведомости.
      Этаж и этап укажите по оригиналам; совпадение этих значений нужно проверить при сохранении.</p>
    <button type="button" disabled={busy} onClick={() => void reload()}>Загрузить сохранённое решение</button>
    {busy && <p role="status">Проверка оригиналов…</p>}
    {error && <p role="alert">{error}</p>}
    {workspace && <>
      <p>Текущая проверка: {workspace.checkId ?? "ещё не запущена"}. Сохранённых решений: {workspace.history.length}{workspace.history.length === 20 ? "+" : ""}.</p>
      {checkId && workspace.checkId !== checkId && <p role="alert">Выбрана другая проверка. Локальная привязка относится к текущей проверке объекта.</p>}
      <div className="local-registration-controls">{selectionPanel("source", source)}{selectionPanel("target", target)}</div>
      <button type="button" disabled={busy || !workspace.checkId || !validSelection(source) || !validSelection(target)}
        onClick={() => void openSelected()}>Открыть листы для расстановки опор</button>
      {workspace.lifecycle === "FINALIZED" && <p>Инспекция завершена. Сохранённые решения доступны для чтения.</p>}
      {!workspace.canReview && <p>Для сохранения решения требуется право проверки. Предварительный расчёт доступен для чтения исходников.</p>}
      <label>Основание решения инспектора<textarea value={reason} maxLength={2000} disabled={busy || workspace.lifecycle !== "OPEN"}
        placeholder="Какие оригиналы, оси и этап проверены" onChange={event => setReason(event.target.value)} /></label>
      {pages && workspace.checkId && <LocalDocumentRegistration
        key={`${objectId}:${workspace.checkId}:${localRegistrationFrameIdentity(pages.source)}:${localRegistrationFrameIdentity(pages.target)}:${pages.saved?.reviewId ?? "draft"}`}
        sourceFrame={pages.source} targetFrame={pages.target}
        sourcePreviewUrl={api.sourcePagePreviewUrl(objectId, pages.source.sourceFileId, pages.source.pdfPageNumber)}
        targetPreviewUrl={api.sourcePagePreviewUrl(objectId, pages.target.sourceFileId, pages.target.pdfPageNumber)}
        initialPacket={pages.saved?.packet} initialReview={pages.saved ?? undefined}
        readOnly={workspace.lifecycle !== "OPEN" || busy}
        onPreview={packet => api.previewLocalRegistration(objectId, { checkId: workspace.checkId!, packet })}
        onSaveReview={!workspace.canReview ? undefined : async packet => {
          if (reason.trim().length < 3) throw new Error("Укажите основание решения инспектора: минимум три символа");
          const input: LocalDocumentRegistrationSaveInput = { schemaVersion: "local-document-registration-review-command-v1",
            checkId: workspace.checkId!, packet, expectedReviewHash: workspace.expectedReviewHash,
            originalsReviewed: true, stableReferencesConfirmed: true, scopeConfirmed: true, reason: reason.trim() };
          const body = JSON.stringify(input);
          if (!command.current || command.current.body !== body) command.current = { body, key: crypto.randomUUID() };
          const saved = await api.saveLocalRegistrationReview(objectId, input, command.current.key);
          if (currentObject.current === objectId) setWorkspace(current => current?.checkId === saved.checkId ? {
            ...current, latest: saved, expectedReviewHash: saved.contentHash,
            history: [{ reviewId: saved.reviewId, contentHash: saved.contentHash, registrationSha256: saved.registrationSha256,
              actorId: saved.actorId, reviewedAt: saved.reviewedAt }, ...current.history.filter(value => value.reviewId !== saved.reviewId)].slice(0, 20),
          } : current);
          return saved;
        }} />}
    </>}
  </details>;
}
