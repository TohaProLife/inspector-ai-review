import { useEffect, useMemo, useRef, useState } from "react";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";
import { loadSearchableSourceText, searchSourceText, sourceTextEvidence,
  type SourceTextIdentity, type SourceTextLoadProgress, type SearchableSourceTextIndex as SourceTextIndex, type SearchableSourceTextLine as SourceTextLine } from "./source-text-explorer";

export interface SourceTextExplorerProps extends SourceTextIdentity { disabled?: boolean }
export function SourceTextSearchResults({ index, query, onSelect }: {
  index: SourceTextIndex; query: string; onSelect: (line: SourceTextLine) => void;
}) {
  const found = useMemo(() => searchSourceText(index, query), [index, query]);
  if (!found.queryValid) return <p>Введите от 2 до 200 символов. Поиск буквальный, без учёта регистра и повторных пробелов.</p>;
  return <>
    <p role="status">Совпадений в сохранённом тексте: {found.total}.{found.truncated && " Показаны первые 100; уточните запрос."}</p>
    {found.total === 0 && <p>Совпадений в текстовом слое не найдено. Это не доказывает отсутствие сведений на PDF или в OCR.</p>}
    <ol style={{ paddingInlineStart: 24, maxHeight: 480, overflowY: "auto" }}>{found.items.map(line => <li key={line.key} style={{ paddingBlock: 8 }}>
      <p>PDF {line.pageNumber} · {line.sourcePath ? `Путь исходной строки: ${line.sourcePath.join(" / ")}`
        : `блок ${line.blockIndex! + 1}, строка ${line.lineIndex! + 1}`}</p>
      {line.sourcePath && <p>Видимость строки на PDF не подтверждена: Form может содержать скрытый или перекрытый текст.</p>}
      <blockquote style={{ marginInline: 0, whiteSpace: "pre-wrap" }}>{line.rawText}</blockquote>
      {line.bboxMilliPoints ? <button type="button" className="button button--secondary"
        style={{ maxWidth: "100%", whiteSpace: "normal" }} onClick={() => onSelect(line)}>Открыть строку на PDF</button>
        : <p>Точные координаты строки недоступны. Подсветка не построена.{line.unlocatedReasonCode === "MILLI_POINT_COLLAPSE"
          ? " Положительный размер слишком мал для точной рамки в выбранных единицах."
          : line.unlocatedReasonCode === "NATIVE_ZERO_AREA" ? " Исходная геометрия имеет нулевую площадь." : ""}</p>}
    </li>)}</ol>
  </>;
}
export function SourceTextExplorer(props: SourceTextExplorerProps) {
  return <SourceTextSearch key={JSON.stringify([props.objectId, props.checkId, props.file.id, props.file.sha256, props.reviewHash])} {...props} />;
}
function SourceTextSearch(props: SourceTextExplorerProps) {
  const [index, setIndex] = useState<SourceTextIndex | null>(null), [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SourceTextLine | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState<SourceTextLoadProgress | null>(null);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => { if (props.disabled) { generation.current++; request.current?.abort(); setBusy(false); setSelected(null); setIndex(null); } }, [props.disabled]);
  async function load() {
    if (props.disabled) return;
    const id = ++generation.current; request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setSelected(null); setIndex(null); setProgress(null);
    try { const next = await loadSearchableSourceText(props, controller.signal, value => {
      if (id === generation.current && !controller.signal.aborted) setProgress(value);
    }); if (id === generation.current && !controller.signal.aborted) setIndex(next); }
    catch (cause) { if (id === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === generation.current) setBusy(false); }
  }
  const evidence = index && selected ? sourceTextEvidence(index, selected) : undefined;
  return <section className="surface" aria-label="Поиск по исходному тексту" style={{ marginBlock: 20, minWidth: 0, overflowWrap: "anywhere", padding: 20 }}>
    <h2>Поиск по исходному тексту</h2>
    <p>{props.file.name}. Сохранённый текст выбранного запуска; значения и единицы автоматически не выводятся. Совпадение не означает ошибку или подтверждённый факт.</p>
    <button type="button" className="button button--secondary" disabled={props.disabled || busy} onClick={() => void load()}>
      {busy ? "Загружаем исходный текст…" : index ? "Обновить исходный текст" : "Загрузить текст выбранного PDF"}</button>
    {busy && progress && <p role="status">Проверяем полный набор страниц: {progress.loadedPages} / {progress.totalPages}. Поиск откроется после полной загрузки.</p>}
    {error && <p role="alert">{error}</p>}
    {index && <>
      <p>Исходных страниц: {index.pageCount}. Строк текста: {index.lines.length}. Без точных координат: {index.unlocatedLines}.
        {index.emptyPages.length > 0 && ` Страниц без строк текстового слоя: ${index.emptyPages.length}.`}</p>
      <p>Стадия в сохранённом запуске: {index.origin.stage === "UNRESOLVED" ? "не установлена" : index.origin.stage}. SHA-256 {index.identity.file.sha256}</p>
      <p>Поиск охватывает сохранённый текстовый слой. Графика, пустые листы и OCR требуют отдельной проверки.</p>
      {"renderedVisibility" in index.origin && <p>Исходный текст {"qualitySummary" in index ? "V4" : "v3"}: видимость строк и достоверность проектных сведений не подтверждены. Числовая вероятность не рассчитана.</p>}
      {"qualitySummary" in index ? <p>Полный аудит V4: все {index.pageCount} страниц получены пакетами одного сохранённого артефакта.
        Страниц с текстом: {index.qualitySummary.candidatePages}; частичный текст: {index.qualitySummary.partialPages}; требуют OCR: {index.qualitySummary.ocrRequiredPages}.
        OCR этим аудитом не выполняется. Поиск охватывает все полученные страницы, включая страницы после 512.</p>
        : "sourceAuditProfileVersion" in index.origin && <p>Сохранённый большой аудит: вертикальный текст включён. Строки показаны по исходным путям; совпадение остаётся кандидатом для проверки человеком.</p>}
      <div className="field-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", marginBlock: 16 }}>
        <label><span>Текст для поиска</span><input type="search" value={query} maxLength={400} onChange={e => { setQuery(e.target.value); setSelected(null); }} /></label>
      </div>
      <SourceTextSearchResults index={index} query={query} onSelect={line => { if (line.bboxMilliPoints) setSelected(line); }} />
      {selected && evidence && <>
        <h3>Исходная строка PDF {selected.pageNumber}</h3><blockquote style={{ marginInline: 0, whiteSpace: "pre-wrap" }}>{selected.rawText}</blockquote>
        <p>{selected.sourcePath ? `Путь исходной строки: ${selected.sourcePath.join(" / ")}`
          : `Блок ${selected.blockIndex! + 1}, строка ${selected.lineIndex! + 1}`}. Единицы, смысл значения и привязка к конструкции этим просмотром не подтверждаются.</p>
        <InspectorEvidenceViewer objectId={index.identity.objectId} file={index.identity.file} evidence={evidence} stage={index.origin.stage} onOpened={() => {}} />
      </>}
    </>}
  </section>;
}
