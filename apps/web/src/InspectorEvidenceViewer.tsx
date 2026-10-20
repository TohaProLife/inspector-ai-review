import { useEffect, useRef, useState } from "react";
import type { SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { SourceImage, SourceImageState } from "./design-system/SourceImage";
import { evidenceMatchesFile, parseDocumentPage, validEvidenceBox, type DocumentEvidence } from "./document-pair-navigation";
import { loadSourcePreview } from "./source-preview-loader";
import "./inspector-review.css";

export interface ViewerPosition { zoom: number; x: number; y: number }
export interface InspectorEvidenceViewerProps {
  evidence?: DocumentEvidence; file?: SourceFileSummary; objectId: string; stage: string;
  syncPosition?: ViewerPosition; onPosition?: (position: ViewerPosition) => void; onOpened: () => void;
  focusRequest?: number; highlights?: DocumentEvidence[];
}
export function InspectorEvidenceViewer(props: InspectorEvidenceViewerProps) {
  return <InspectorEvidencePageViewer key={JSON.stringify([props.objectId, props.evidence?.sourceFileId ?? props.file?.id,
    props.file?.sha256 ?? props.evidence?.sourceSha256, props.evidence?.pageNumber])} {...props} />;
}
function InspectorEvidencePageViewer({ evidence, file, objectId, stage, syncPosition, onPosition, onOpened,
  focusRequest = 0, highlights = [] }: InspectorEvidenceViewerProps) {
  const fragmentZoom = () => evidence && validEvidenceBox(evidence.bbox)
    ? Math.max(1, Math.min(4, 0.75 / Math.max(evidence.bbox[2] - evidence.bbox[0], .18))) : 1;
  const [zoom, setZoom] = useState(fragmentZoom), [page, setPage] = useState(evidence?.pageNumber ?? 1);
  const [draft, setDraft] = useState(String(evidence?.pageNumber ?? 1));
  const [highlight, setHighlight] = useState(true), [imageLoaded, setImageLoaded] = useState(false);
  const [imageRequest, setImageRequest] = useState<{ src: string; url: string | null; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0), [focus, setFocus] = useState(0), [viewerError, setViewerError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const applying = useRef(false), reportedOpen = useRef(false);
  const latestSyncPosition = useRef(syncPosition); latestSyncPosition.current = syncPosition;
  const sourceMatches = !evidence || evidenceMatchesFile(evidence, file);
  const sourceId = sourceMatches ? evidence?.sourceFileId ?? file?.id : undefined;
  const pageCount = file?.pageCount ?? null, maxPage = pageCount ?? 10000;
  function navigate(next: number) {
    if (next < 1 || next > maxPage) return;
    setPage(next); setDraft(String(next)); setViewerError(null);
  }
  function returnToFragment() {
    if (!evidence || !sourceMatches) return;
    navigate(evidence.pageNumber); setHighlight(true); setFocus(value => value + 1);
    setZoom(fragmentZoom());
  }
  useEffect(() => { if (focusRequest > 0) returnToFragment(); }, [focusRequest]);
  useEffect(() => {
    if (!imageLoaded || !evidence || !validEvidenceBox(evidence.bbox) || page !== evidence.pageNumber) return;
    const box = evidence.bbox;
    let frame = 0;
    const center = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const node = viewport.current, sheet = node?.querySelector<HTMLElement>(".inspector-sheet");
      if (!node || !sheet) return;
      applying.current = true;
      const linked = latestSyncPosition.current;
      node.scrollLeft = linked ? linked.x * Math.max(0, node.scrollWidth - node.clientWidth)
        : (box[0] + box[2]) / 2 * sheet.offsetWidth - node.clientWidth / 2;
      node.scrollTop = linked ? linked.y * Math.max(0, node.scrollHeight - node.clientHeight)
        : (box[1] + box[3]) / 2 * sheet.offsetHeight - node.clientHeight / 2;
      requestAnimationFrame(() => { applying.current = false; });
    }); };
    const node = viewport.current, sheet = node?.querySelector<HTMLElement>(".inspector-sheet");
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(center);
    const theme = typeof MutationObserver === "undefined" ? null : new MutationObserver(center);
    if (node) observer?.observe(node);
    if (sheet) observer?.observe(sheet);
    theme?.observe(document.documentElement, { attributes: true,
      attributeFilter: ["data-color-resolved", "data-color-mode", "data-color-transition", "data-theme"] });
    center();
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); theme?.disconnect(); };
  }, [evidence?.id, evidence?.bbox?.join(","), imageLoaded, page, focus, zoom]);
  useEffect(() => {
    if (!syncPosition || !viewport.current) return;
    applying.current = true; setZoom(syncPosition.zoom);
    const frame = requestAnimationFrame(() => {
      const node = viewport.current;
      if (node) { node.scrollLeft = syncPosition.x * Math.max(0, node.scrollWidth - node.clientWidth);
        node.scrollTop = syncPosition.y * Math.max(0, node.scrollHeight - node.clientHeight); }
      requestAnimationFrame(() => { applying.current = false; });
    });
    return () => cancelAnimationFrame(frame);
  }, [syncPosition]);
  function publish(nextZoom = zoom) {
    const node = viewport.current;
    if (!node || applying.current) return;
    onPosition?.({ zoom: nextZoom, x: node.scrollLeft / Math.max(1, node.scrollWidth - node.clientWidth),
      y: node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight) });
  }
  function changeZoom(value: number) { const next = Math.max(0.5, Math.min(8, value)); setZoom(next); publish(next); }
  const resolution = zoom >= 4 ? 4800 : zoom >= 2 ? 2400 : 1200;
  const src = sourceId ? `${api.sourcePagePreviewUrl(objectId, sourceId, page)}?resolution=${resolution}` : null;
  const currentSrc = useRef(src); currentSrc.current = src;
  useEffect(() => {
    setImageLoaded(false); reportedOpen.current = false; setImageRequest(null);
    if (!src) return;
    const abort = new AbortController(); let url: string | null = null;
    void (async () => {
      try {
        const blob = await loadSourcePreview(src, abort.signal);
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob); setImageRequest({ src, url, error: false });
      } catch { if (!abort.signal.aborted) setImageRequest({ src, url: null, error: true }); }
    })();
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src, retry]);
  const frames = sourceMatches ? [evidence, ...highlights].filter((item): item is DocumentEvidence => !!item
    && item.sourceFileId === sourceId && item.sourceSha256 === (file?.sha256 ?? evidence?.sourceSha256)
    && item.pageNumber === page && validEvidenceBox(item.bbox))
    .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index) : [];
  return <section className="inspector-evidence-pane" ref={panel} aria-label={`Документ ${stage}`}>
    <header><strong>{stage}</strong><span>{file?.name ?? evidence?.sourceFileId ?? "Документ отсутствует"}</span></header>
    {!sourceMatches ? <p role="alert">Редакция документа не совпадает с доказательством. Подсветка и просмотр скрыты; выберите исходный файл с нужным SHA-256.</p> : sourceId ? <>
      <p className="inspector-source-address">Редакция: {evidence?.revision ?? "не подтверждена"} · лист: {evidence?.sheet ?? "не указан"}<br />
        SHA-256 <code title={file?.sha256 ?? evidence?.sourceSha256}>{(file?.sha256 ?? evidence?.sourceSha256)?.slice(0, 12)}…</code></p>
      <div className="inspector-viewer-toolbar">
        <button type="button" aria-label={`Уменьшить ${stage}`} onClick={() => changeZoom(zoom / 1.25)}>−</button>
        <output aria-label={`Масштаб ${stage}`}>{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label={`Увеличить ${stage}`} onClick={() => changeZoom(zoom * 1.25)}>+</button>
        <button type="button" onClick={() => { changeZoom(1); viewport.current?.scrollTo(0, 0); }}>Вписать</button>
        <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : panel.current?.requestFullscreen())
          ?.catch(() => setViewerError("Полноэкранный режим недоступен в этом браузере"))}>Весь экран</button>
      </div>
      <form className="inspector-page-navigation" onSubmit={event => {
        event.preventDefault(); const next = parseDocumentPage(draft, pageCount);
        if (next === null) { setViewerError(`Укажите целую страницу от 1 до ${maxPage}`); return; } navigate(next);
      }}>
        <button type="button" aria-label={`Предыдущая страница ${stage}`} disabled={page <= 1} onClick={() => navigate(page - 1)}>‹</button>
        <label className="inspector-page-control">Страница PDF <input type="number" min={1} max={maxPage}
          aria-label={`Страница PDF ${stage}`} value={draft} onChange={event => setDraft(event.target.value)} /> / {pageCount ?? "?"}</label>
        <button type="submit" aria-label={`Перейти к странице ${stage}`}>Перейти</button>
        <button type="button" aria-label={`Следующая страница ${stage}`} disabled={page >= maxPage} onClick={() => navigate(page + 1)}>›</button>
      </form>
      <div className="inspector-fragment-controls">
        <button type="button" disabled={!evidence} onClick={returnToFragment}>К расхождению · {stage}</button>
        <label><input type="checkbox" checked={highlight} onChange={event => setHighlight(event.target.checked)} /> Подсветка</label>
      </div>
      <div className="inspector-sheet-viewport" ref={viewport} tabIndex={0} aria-label={`Лист ${stage}; прокрутка и перемещение`}
        onScroll={() => publish()} onPointerDown={event => {
          if (event.button !== 0 || event.pointerType === "touch" || !viewport.current) return;
          viewport.current.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
        }} onPointerMove={event => { if (drag.current && viewport.current) {
          viewport.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
          viewport.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
        } }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => {
          if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault(); navigate(page + (event.key === "ArrowLeft" ? -1 : 1));
          }
        }}>
        <div className="inspector-sheet" style={{ width: `${zoom * 100}%` }}>
          {imageRequest?.src === src && imageRequest.url ? <SourceImage src={imageRequest.url} alt={`${stage}, исходная страница ${page}`} loading="eager"
            onLoad={() => { if (currentSrc.current !== src) return;
              setImageLoaded(true); if (!reportedOpen.current) { reportedOpen.current = true; onOpened(); } }}
            onError={() => { if (currentSrc.current === src) setImageLoaded(false); }} />
            : <SourceImageState status={imageRequest?.src === src && imageRequest.error ? "error" : "loading"}
              description={`${stage}, исходная страница ${page}`} onRetry={() => setRetry(value => value + 1)} />}
          {imageLoaded && imageRequest?.src === src && imageRequest.url && highlight && frames.map(item => {
            const box = item.bbox!;
            return <div key={item.id} className={`inspector-evidence-box${item.id === evidence?.id ? " inspector-evidence-box--active" : ""}`} role="img"
              aria-label={`Выделенный фрагмент ${stage}: ${item.value}`} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`,
                width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }}><span>{stage}: {item.value} {item.unit}</span></div>;
          })}
        </div>
      </div>
      <small>{frames.length ? "Выделена исходная область; смысл расхождения требует проверки." : "На этой странице рамка не задана. Это не подтверждение соответствия."} Alt+← / Alt+→ — листание.</small>
      {viewerError && <p role="alert">{viewerError}</p>}
      <a href={`${api.sourceFileUrl(objectId, sourceId)}#page=${page}`} target="_blank" rel="noopener noreferrer"
        onClick={onOpened}>Открыть оригинальный PDF · стр. {page}</a>
    </> : <p>Загрузите {stage} или выберите источник в редакторе доказательств.</p>}
  </section>;
}
