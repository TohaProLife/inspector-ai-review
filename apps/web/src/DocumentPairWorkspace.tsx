import { useEffect, useRef, useState } from "react";
import type { SourceFileSummary } from "@inspector-ai/contracts";
import { InspectorEvidenceViewer, type ViewerPosition } from "./InspectorEvidenceViewer";
import { comparisonTextParts, type DocumentEvidence } from "./document-pair-navigation";
import { loadSearchableSourceText, searchSourceText, sourceTextEvidence,
  type SearchableSourceTextIndex, type SearchableSourceTextLine } from "./source-text-explorer";
import { listSourceAuditV4Full, selectSourceAuditV4Full } from "./SourceAuditV4FullWorkspace";
import "./document-pair.css";

const stageLabel = (stage: string) => ({ PD: "ПД", RD: "РД", ID: "ИД", UNRESOLVED: "Стадия не установлена" }[stage] ?? stage);
export interface DocumentPairWorkspaceProps {
  objectId: string; files: SourceFileSummary[]; sources: DocumentEvidence[];
  stages?: string[]; checkId?: string; title?: string;
  onOpened?: (evidence: DocumentEvidence | undefined) => void;
}
export async function pairSearchCheck(objectId: string, checkId: string, file: SourceFileSummary, signal: AbortSignal): Promise<string> {
  if (file.pageCount === null || file.pageCount <= 512) return checkId;
  const audit = selectSourceAuditV4Full(await listSourceAuditV4Full(objectId, signal), objectId);
  signal.throwIfAborted();
  if (!audit) throw new Error("Для поиска по всему этому PDF подготовьте полный аудит в разделе «Источники», затем повторите загрузку текста.");
  return audit.id;
}

function PairSourceSearch({ objectId, checkId, file, onSelect }: {
  objectId: string; checkId: string; file: SourceFileSummary; onSelect: (value: DocumentEvidence) => void;
}) {
  const [index, setIndex] = useState<SearchableSourceTextIndex | null>(null), [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [readCheckId, setReadCheckId] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function load() {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(""); setIndex(null); setReadCheckId("");
    try {
      const sourceCheckId = await pairSearchCheck(objectId, checkId, file, controller.signal);
      const value = await loadSearchableSourceText({ objectId, checkId: sourceCheckId, file, reviewHash: file.review?.contentHash ?? null }, controller.signal);
      if (!controller.signal.aborted) { setIndex(value); setReadCheckId(sourceCheckId); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const found = index ? searchSourceText(index, query) : null;
  function open(line: SearchableSourceTextLine) {
    if (index && line.bboxMilliPoints) onSelect(sourceTextEvidence(index, line));
  }
  return <details className="pair-source-search"><summary>Найти текст в этом документе</summary>
    <p>Поиск по сохранённому тексту выбранного запуска. Графические надписи могут требовать OCR.</p>
    <button type="button" disabled={busy} onClick={() => void load()}>{busy ? "Читаем страницы…" : "Загрузить текст для поиска"}</button>
    {error && <p role="alert">{error}</p>}
    {index && <>{readCheckId !== checkId && <p>Для поиска прочитан полный текст из аудита {readCheckId}. Исходная проверка пары сохранена.</p>}
      <label>Текст для поиска<input type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>
      <p role="status">Страниц: {index.pageCount}. {found?.queryValid ? `Совпадений: ${found.total}${found.truncated ? "; показаны первые 100" : ""}.` : "Введите от 2 символов."}</p>
      {found?.queryValid && found.total === 0 && <p>В текстовом слое не найдено; отсутствие на чертеже этим не установлено.</p>}
      <ol>{found?.items.map(line => <li key={line.key}><button type="button" disabled={!line.bboxMilliPoints} onClick={() => open(line)}>
        Стр. {line.pageNumber}: {line.rawText}</button>{!line.bboxMilliPoints && <small>Точной рамки нет.</small>}</li>)}</ol>
    </>}
  </details>;
}

/** A viewing aid. Page positions and literal differences do not qualify an engineering finding. */
export function DocumentPairWorkspace(props: DocumentPairWorkspaceProps) {
  return <PairWorkspace key={JSON.stringify([props.objectId, props.checkId, props.stages,
    props.sources.map(value => [value.id, value.sourceFileId, value.sourceSha256, value.pageNumber, value.bbox, value.value]),
    props.files.map(file => [file.id, file.sha256, file.review?.contentHash])])} {...props} />;
}
function PairWorkspace({ objectId, files, sources, stages = ["PD", "RD"], checkId, title = "Сравнение документов", onOpened }: DocumentPairWorkspaceProps) {
  const [selected, setSelected] = useState<Record<string, string>>({}), [fileIds, setFileIds] = useState<Record<string, string>>({});
  const [searchSelections, setSearchSelections] = useState<Record<string, DocumentEvidence>>({});
  const [focusRequests, setFocusRequests] = useState<Record<string, number>>({}), [sync, setSync] = useState(false), [wide, setWide] = useState(false);
  const [position, setPosition] = useState<{ stage: string; value: ViewerPosition } | null>(null), [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!wide) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setWide(false); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [wide]);
  const uniqueStages = [...new Set(stages)];
  function focusStage(stage: string) { setFocusRequests(values => ({...values,[stage]:(values[stage] ?? 0) + 1})); }
  function sourceFor(stage: string) {
    if (searchSelections[stage]) return searchSelections[stage];
    return sources.find(value => value.stage === stage && value.id === selected[stage]) ?? sources.find(value => value.stage === stage);
  }
  function fileFor(stage: string) {
    const id = fileIds[stage] ?? sourceFor(stage)?.sourceFileId;
    return files.find(file => file.id === id) ?? (!id ? files.find(file => file.stages.some(value => value === stage)) : undefined);
  }
  function evidenceFor(stage: string) {
    const source = sourceFor(stage), file = fileFor(stage);
    return source && (!fileIds[stage] || fileIds[stage] === source.sourceFileId) ? source : undefined;
  }
  return <section ref={panel} className={`document-pair-workspace${wide ? " document-pair-workspace--wide" : ""}`} aria-label={title}>
    <div className="document-pair-toolbar"><div><span className="kicker">Исходные документы рядом</span><h3>{title}</h3></div>
      <button type="button" onClick={() => { setSearchSelections({}); setFileIds({}); setPosition(null);
        setFocusRequests(values => Object.fromEntries(uniqueStages.map(stage => [stage,(values[stage] ?? 0) + 1]))); }}>К расхождению в обоих документах</button>
      <button type="button" aria-pressed={wide} onClick={() => setWide(value => !value)}>{wide ? "Обычная ширина" : "Развернуть сравнение"}</button>
      <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : panel.current?.requestFullscreen())
        ?.catch(() => setError("Полноэкранный режим недоступен; используйте «Развернуть сравнение»."))}>Два документа на весь экран</button>
      <label><input type="checkbox" checked={sync} onChange={event => { setSync(event.target.checked); setPosition(null); }} /> Связать масштаб и прокрутку</label>
    </div>
    <p className="document-pair-help">Листайте каждую сторону отдельно. Цветом отмечены буквальные различия текста; рамки показывают исходные области. Связь прокрутки не устанавливает геопривязку.</p>
    {error && <p role="alert">{error}</p>}
    <div className="document-pair-columns">{uniqueStages.map((stage, stageIndex) => {
      const evidence = evidenceFor(stage), file = fileFor(stage), other = evidenceFor(uniqueStages[stageIndex === 0 ? 1 : 0]);
      const sameStageSources = sources.filter(value => value.stage === stage);
      return <div className="document-pair-column" key={stage}>
        <label className="document-pair-file">Документ {stageLabel(stage)}<select aria-label={`Документ для ${stageLabel(stage)}`} value={file?.id ?? ""} onChange={event => {
          setFileIds(value => ({ ...value, [stage]: event.target.value })); setSearchSelections(value => { const next = { ...value }; delete next[stage]; return next; }); setPosition(null);
        }}><option value="" disabled>Выберите документ</option>{files.map(item => <option key={item.id} value={item.id}>{item.name} · {item.stages.join("/")}</option>)}</select></label>
        {sameStageSources.length > 1 && <label>Фрагмент {stageLabel(stage)}<select aria-label={`Фрагмент ${stageLabel(stage)}`} value={evidence?.id ?? ""} onChange={event => {
          const next = sameStageSources.find(value => value.id === event.target.value);
          if (!next) return;
          setSelected(value => ({ ...value, [stage]: next.id })); setFileIds(value => ({ ...value, [stage]: next.sourceFileId }));
          setSearchSelections(value => { const updated = { ...value }; delete updated[stage]; return updated; }); setPosition(null); focusStage(stage);
        }}>{sameStageSources.map(item => <option key={item.id} value={item.id}>Стр. {item.pageNumber} · {item.value || item.element}</option>)}</select></label>}
        <button className="document-pair-quote" type="button" disabled={!evidence} aria-label={`Перейти к фрагменту ${stageLabel(stage)}`} onClick={() => {
          setPosition(null); focusStage(stage);
        }}><span>{stageLabel(stage)} · {evidence ? `исходный фрагмент, стр. ${evidence.pageNumber}` : "Фрагмент не задан"}</span>
          <q>{evidence?.value ? comparisonTextParts(evidence.value, other?.value).map((part, index) => part.different
            ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>) : "Текст значения не установлен"}</q>
          {evidence?.unit && <small>{evidence.unit}</small>}</button>
        <InspectorEvidenceViewer objectId={objectId} stage={stageLabel(stage)} file={file} evidence={evidence}
          highlights={sameStageSources} focusRequest={focusRequests[stage] ?? 0} syncPosition={sync && position?.stage !== stage ? position?.value : undefined}
          onPosition={sync ? value => setPosition({ stage, value }) : undefined} onOpened={() => onOpened?.(evidence)} />
        {checkId && file && <PairSourceSearch key={`${checkId}:${file.id}:${file.sha256}:${file.review?.contentHash}`} objectId={objectId} checkId={checkId} file={file}
          onSelect={value => { setSearchSelections(current => ({ ...current, [stage]: value })); setPosition(null); focusStage(stage); }} />}
      </div>;
    })}</div>
  </section>;
}
