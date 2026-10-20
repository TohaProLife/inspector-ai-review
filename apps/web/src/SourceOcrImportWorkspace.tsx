import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceFileSummary, SourceOcrImportBundle, SourceOcrImportRecord, SourceOcrImportWorkspace as Workspace, SourceOcrReviewRecord } from "@inspector-ai/contracts";
import { api } from "./api";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";
import type { DocumentEvidence } from "./document-pair-navigation";
import { sourceOcrHeatUnitHint } from "./source-ocr-unit-quality";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function sourceOcrPageEvidence(record: SourceOcrImportRecord, pageNumber: number): DocumentEvidence {
  return { id: `ocr-page-${record.id}-${pageNumber}`, sourceFileId: record.sourceFileId, sourceSha256: record.bindings.sourceSha256,
    pageNumber, stage: "UNRESOLVED", sheet: null, revision: null, bbox: null, value: "", unit: null, element: "Страница для ручной сверки OCR" };
}
export function latestSourceOcrReview(reviews: SourceOcrReviewRecord[], importId: string, pageNumber: number, ordinal: number) {
  return [...reviews].reverse().find(item => item.importId === importId && item.pageNumber === pageNumber && item.ordinal === ordinal);
}
export function SourceOcrUnitQualityNotice({ text }: { text: string }) {
  const hint = sourceOcrHeatUnitHint(text);
  if (!hint) return null;
  return <aside role="note" aria-label="Кандидат для сверки двойных единиц" style={{ marginBlock: 12, padding: 12, border: "1px solid currentColor", borderRadius: 12, overflowWrap: "anywhere" }}>
    <strong>Кандидат: проверьте двойные единицы</strong>
    <p>В строке указано {hint.kilowattsLiteral} кВт. Запись {hint.gigacaloriesPerHourLiteral} Гкал/ч соответствует интервалу
      {" "}{hint.equivalentKilowatts.lower.replace(".", ",")}–{hint.equivalentKilowatts.upper.replace(".", ",")} кВт с учётом округления записанных чисел.
      Сверьте число и единицы на исходной странице.</p>
    <p>Это подсказка по буквальной записи; вероятность не рассчитана. Несогласованность может быть в распознавании или в самом оригинале.
      Подтверждение текста не подтверждает правильность проектного значения.</p>
    <small>Пересчёт использует 1 Гкал/ч = 1163 кВт для международной калории.
      {" "}<a href="https://www.nist.gov/pml/special-publication-811/nist-guide-si-footnotes" target="_blank" rel="noopener noreferrer">Определение единицы, NIST</a>.</small>
  </aside>;
}
function ImportedText({ record, file, workspace, disabled, onReview }: {
  record: SourceOcrImportRecord; file: SourceFileSummary; workspace: Workspace; disabled: boolean;
  onReview: (pageNumber: number, ordinal: number, decision: "CONFIRMED" | "REJECTED", basis: string) => Promise<void>;
}) {
  const [pageNumber, setPageNumber] = useState(record.derived.pages[0]?.pageNumber ?? 1), [ordinal, setOrdinal] = useState<number | null>(null);
  const [query, setQuery] = useState(""), [basis, setBasis] = useState("");
  const reviewElement = useRef<HTMLDivElement>(null), pendingUnitJump = useRef(false);
  const unitHints = useMemo(() => record.derived.pages.flatMap(item => item.lines.flatMap(value =>
    sourceOcrHeatUnitHint(value.text) ? [{ pageNumber: item.pageNumber, ordinal: value.ordinal, text: value.text }] : [])), [record.derived.pages]);
  useEffect(() => {
    if (!pendingUnitJump.current) return;
    pendingUnitJump.current = false;
    reviewElement.current?.focus({ preventScroll: true });
    reviewElement.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [pageNumber, ordinal]);
  const page = record.derived.pages.find(item => item.pageNumber === pageNumber), line = page?.lines.find(item => item.ordinal === ordinal);
  const current = line ? latestSourceOcrReview(workspace.reviews, record.id, pageNumber, line.ordinal) : undefined;
  const matches = query.trim().length >= 2 ? record.derived.pages.flatMap(item => item.lines
    .filter(value => value.text.toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU")))
    .map(value => ({ page: item.pageNumber, line: value }))) : [];
  const originalMatches = file.id === record.sourceFileId && file.sha256 === record.bindings.sourceSha256;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ record, reviews: workspace.reviews.filter(item => item.importId === record.id) }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `source-ocr-${record.id}.json`;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function selectPage(value: number) { setPageNumber(value); setOrdinal(null); setBasis(""); }
  function selectUnitHint(value: typeof unitHints[number]) {
    if (pageNumber === value.pageNumber && ordinal === value.ordinal) {
      reviewElement.current?.focus({ preventScroll: true });
      reviewElement.current?.scrollIntoView({ block: "start", behavior: "auto" });
    } else {
      pendingUnitJump.current = true; selectPage(value.pageNumber); setOrdinal(value.ordinal);
    }
  }
  return <section aria-label="Сохранённый импорт OCR" style={{ minWidth: 0 }}>
    <p>Страниц импорта: {record.derived.pages.length}; строк-кандидатов: {record.derived.pages.reduce((sum, value) => sum + value.lines.length, 0)};
      неразрешённых страниц: {record.derived.pages.filter(value => value.status === "UNRESOLVED").length}.</p>
    <p>Импортирован сохранённый ответ OCR. Происхождение внешнего растра и выполнение провайдера не подтверждены.
      Координаты OCR не нанесены на PDF. Сверьте буквальный текст с исходной страницей.</p>
    <p>Вероятность не рассчитана. Ручное подтверждение текста не создаёт инженерное замечание и не увеличивает машинное покрытие.</p>
    <p>Сохранено {new Date(record.createdAt).toLocaleString("ru-RU")}. Хеш: <code>{record.contentHash}</code>.</p>
    <button type="button" className="button button--secondary" onClick={download}>Скачать импорт OCR и журнал сверки</button>
    {unitHints.length > 0 && <details style={{ marginBlock: 12 }} aria-label="Кандидаты для сверки двойных единиц">
      <summary>Кандидаты для сверки единиц: {unitHints.length}</summary>
      <p>Подсказки только для однозначной пары кВт и Гкал/ч в одной строке. Другие записи этим не проверены. Инженерное нарушение не установлено.</p>
      <ol style={{ maxHeight: 240, overflowY: "auto", overflowWrap: "anywhere" }}>{unitHints.slice(0, 100).map(value => <li key={`${value.pageNumber}:${value.ordinal}`}>
        <button type="button" onClick={() => selectUnitHint(value)} style={{ maxWidth: "100%", whiteSpace: "pre-wrap", overflowWrap: "anywhere", textAlign: "left" }}>
          К единицам · стр. {value.pageNumber}, строка {value.ordinal + 1}: {value.text}</button></li>)}</ol>
      {unitHints.length > 100 && <p>Показаны первые 100 кандидатов.</p>}
    </details>}
    <label style={{ display: "block", marginBlock: 12 }}>Поиск в импортированном OCR<input type="search" aria-label="Поиск в импортированном OCR" value={query} maxLength={200}
      style={{ width: "100%", boxSizing: "border-box" }} onChange={event => setQuery(event.target.value)} /></label>
    {query.trim().length >= 2 && <><p role="status">Совпадений: {matches.length}{matches.length > 100 ? "; показаны первые100" : ""}.</p>
      {matches.length === 0 && <p>Текст не найден. Отсутствие сведений на PDF этим не установлено.</p>}
      <ol style={{ maxHeight: 240, overflowY: "auto", overflowWrap: "anywhere" }}>{matches.slice(0, 100).map(value => <li key={`${value.page}:${value.line.ordinal}`}>
        <button type="button" onClick={() => { selectPage(value.page); setOrdinal(value.line.ordinal); }}>Стр. {value.page}, строка {value.line.ordinal + 1}: {value.line.text}</button></li>)}</ol></>}
    <label style={{ display: "block", marginBlock: 12 }}>Страница импорта OCR<select aria-label="Страница импорта OCR" value={pageNumber}
      style={{ width: "100%", minWidth: 0 }} onChange={event => selectPage(Number(event.target.value))}>
      {record.derived.pages.map(value => <option key={value.pageNumber} value={value.pageNumber}>Стр. {value.pageNumber} · {value.lines.length ? `${value.lines.length} строк` : "НЕ РАЗРЕШЕНО: текста нет"}</option>)}</select></label>
    <div className="source-ocr-columns">
      <div style={{ minWidth: 0 }}>
        <h4>Распознанный текст · стр. {pageNumber}</h4>
        {page?.status === "UNRESOLVED" && <p role="status">OCR не вернул непустого текста. Страница остаётся неразрешённой; это не доказательство отсутствия сведений.</p>}
        <p>Номера строк сохранены из ответа OCR. Пропуск номера означает пустую строку ответа.</p>
        <ol aria-label="Строки OCR на выбранной странице" style={{ maxHeight: 480, overflowY: "auto", paddingInlineStart: "4em" }}>{page?.lines.map(value => {
          const review = latestSourceOcrReview(workspace.reviews, record.id, pageNumber, value.ordinal);
          return <li key={value.ordinal} value={value.ordinal + 1} style={{ paddingBlock: 6 }}><button type="button" aria-pressed={ordinal === value.ordinal}
            style={{ width: "100%", textAlign: "left", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            onClick={() => { setOrdinal(value.ordinal); setBasis(""); }}>{value.text}</button>
            <small>{review ? review.decision === "CONFIRMED" ? "Текст сверен человеком" : "Текст отклонён человеком" : "Кандидат OCR; не сверен"}</small></li>;
        })}</ol>
        {line && <div ref={reviewElement} tabIndex={-1} style={{ scrollMarginTop: 120 }} aria-label="Ручная сверка строки OCR">
          <h4>Проверяемая строка {line.ordinal + 1} · стр. {pageNumber}</h4><blockquote style={{ marginInline: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{line.text}</blockquote>
          <p>Оценка распознавателя: {line.recognitionScore}. Это не вероятность инженерного нарушения.</p>
          <SourceOcrUnitQualityNotice text={line.text} />
          {current && <p role="status">Последнее решение: {current.decision === "CONFIRMED" ? "текст совпадает" : "текст не совпадает"}. Основание: {current.basis}.</p>}
          <label>Основание сверки<textarea aria-label="Основание сверки OCR" value={basis} maxLength={2000}
            style={{ width: "100%", boxSizing: "border-box" }} disabled={disabled || !workspace.canReview}
            onChange={event => setBasis(event.target.value)} /></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{(["CONFIRMED", "REJECTED"] as const).map(decision => <button key={decision} type="button" className="button button--secondary"
            disabled={disabled || !workspace.canReview || !originalMatches || basis.trim().length < 3}
            onClick={() => void onReview(pageNumber, line.ordinal, decision, basis)}>{decision === "CONFIRMED" ? "Текст совпадает с PDF" : "Текст не совпадает с PDF"}</button>)}</div>
          {!workspace.canReview && <p>Нужно право проверки исходных данных.</p>}
        </div>}
      </div>
      <div style={{ minWidth: 0 }}>{originalMatches ? <InspectorEvidenceViewer objectId={record.objectId} file={file} stage="Исходный PDF для OCR"
        evidence={sourceOcrPageEvidence(record, pageNumber)} onOpened={() => {}} />
        : <p role="alert">SHA исходника изменился. Просмотр и ручная сверка этой редакции отключены.</p>}</div>
    </div>
    <details><summary>Журнал ручной сверки этого импорта</summary><ol>{workspace.reviews.filter(value => value.importId === record.id).map(value => <li key={value.id}>
      Стр. {value.pageNumber}, строка {value.ordinal + 1}: {value.decision === "CONFIRMED" ? "текст совпадает" : "текст не совпадает"}; {value.basis}.
      {" "}{new Date(value.createdAt).toLocaleString("ru-RU")} · <code>{value.contentHash}</code></li>)}</ol></details>
  </section>;
}
export function SourceOcrImportWorkspace(props: { objectId: string; checkId: string; file: SourceFileSummary; disabled?: boolean }) {
  return <OcrWorkspace key={`${props.objectId}:${props.checkId}:${props.file.id}:${props.file.sha256}`} {...props} />;
}
function OcrWorkspace({ objectId, checkId, file, disabled }: { objectId: string; checkId: string; file: SourceFileSummary; disabled?: boolean }) {
  const [opened, setOpened] = useState(false), [workspace, setWorkspace] = useState<Workspace | null>(null), [selectedId, setSelectedId] = useState("");
  const [bundle, setBundle] = useState<SourceOcrImportBundle | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), pending = useRef<AbortController | null>(null), generation = useRef(0), uploadGeneration = useRef(0);
  useEffect(() => () => { generation.current++; uploadGeneration.current++; pending.current?.abort(); }, []);
  function accept(value: Workspace) {
    if (value.schemaVersion !== "source-ocr-import-workspace-v1" || value.checkId !== checkId || !Array.isArray(value.items)
      || value.items.length > 8 || value.items.some(item => item.objectId !== objectId || item.checkId !== checkId)) throw new Error("История OCR относится к другой проверке");
    setWorkspace(value); setSelectedId(previous => value.items.some(item => item.id === previous && item.sourceFileId === file.id) ? previous
      : value.items.filter(item => item.sourceFileId === file.id).at(-1)?.id ?? "");
  }
  useEffect(() => {
    if (!opened || disabled) { generation.current++; pending.current?.abort(); setBusy(false); return; }
    const controller = new AbortController(), id = ++generation.current; pending.current = controller; setBusy(true); setError("");
    void api.listSourceOcrImports(checkId, AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]))
      .then(value => { if (!controller.signal.aborted && id === generation.current) accept(value); })
      .catch(cause => { if (!controller.signal.aborted && id === generation.current) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted && id === generation.current) setBusy(false); });
    return () => controller.abort();
  }, [opened, disabled, checkId, refresh]);
  async function chooseFile(upload?: File) {
    const selection = ++uploadGeneration.current;
    setBundle(null); setError(""); if (!upload) return;
    try {
      if (upload.size > 8388608) throw new Error("Размер JSON OCR превышает8MiB");
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await upload.arrayBuffer())) as SourceOcrImportBundle;
      if (value.schemaVersion !== "source-ocr-import-bundle-v1" || value.sourceSha256 !== file.sha256 || !Array.isArray(value.pages) || !value.pages.length)
        throw new Error("Пакет OCR не соответствует SHA выбранного PDF");
      if (selection === uploadGeneration.current) setBundle(value);
    } catch (cause) { if (selection === uploadGeneration.current) setError(message(cause)); }
  }
  const selected = workspace?.items.find(item => item.id === selectedId && item.sourceFileId === file.id);
  async function save(review?: { pageNumber: number; ordinal: number; decision: "CONFIRMED" | "REJECTED"; basis: string }) {
    if (disabled || busy || !workspace || (!review && (!bundle || !workspace.canImport)) || review && (!selected || !workspace.canReview)) return;
    const controller = new AbortController(), id = ++generation.current; pending.current?.abort(); pending.current = controller; setBusy(true); setError("");
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    try {
      if (review && selected) {
        const line = selected.derived.pages.find(page => page.pageNumber === review.pageNumber)?.lines.find(item => item.ordinal === review.ordinal);
        if (!line) throw new Error("Выбранная строка OCR недоступна");
        await api.reviewSourceOcr(checkId, { schemaVersion: "source-ocr-review-command-v1", importId: selected.id, importContentHash: selected.contentHash,
          ...review, lineHash: line.lineHash, expectedReviewHash: latestSourceOcrReview(workspace.reviews, selected.id, review.pageNumber, review.ordinal)?.contentHash ?? null }, signal);
      } else if (bundle) {
        const record = await api.importSourceOcr(checkId, file.id, bundle, signal); if (id === generation.current && !controller.signal.aborted) setSelectedId(record.id);
      }
      const next = await api.listSourceOcrImports(checkId, signal);
      if (!controller.signal.aborted && id === generation.current) { accept(next); uploadGeneration.current++; setBundle(null); }
    } catch (cause) { if (!controller.signal.aborted && id === generation.current) setError(message(cause)); }
    finally { if (!controller.signal.aborted && id === generation.current) setBusy(false); }
  }
  return <section className="native-source-comparison" aria-label="OCR пропусков полного аудита" style={{ marginBlock: 20, minWidth: 0, overflowWrap: "anywhere" }}>
    <h3>OCR страниц без исходного текста</h3>
    <p>Сохранённые OCR responses можно добавить отдельно к полному аудиту. Импорт не запускает распознавание, не изменяет исходный текст и не подтверждает полноту PDF.</p>
    {!opened ? <button type="button" className="button button--secondary" disabled={disabled} onClick={() => setOpened(true)}>Открыть историю OCR пропусков</button> : <>
      <button type="button" className="button button--secondary" disabled={disabled || busy} onClick={() => setRefresh(value => value + 1)}>Обновить историю OCR</button>
      {workspace && <>
        {workspace.availability !== "READY" && <p>Нужен завершённый полный аудит V4.</p>}
        <label style={{ display: "block", marginBlock: 12 }}>JSON-пакет сохранённого OCR<input type="file" accept="application/json,.json" aria-label="JSON-пакет сохранённого OCR"
          style={{ maxWidth: "100%" }} disabled={disabled || busy || !workspace.canImport} onChange={event => void chooseFile(event.target.files?.[0])} /></label>
        {bundle && <p>Выбрано страниц: {bundle.pages.length}. Перед сохранением сервер проверит полный набор пропусков и исходный PDF.</p>}
        <button type="button" className="button button--primary" disabled={disabled || busy || !workspace.canImport || !bundle} onClick={() => void save()}>Сохранить отдельный импорт OCR</button>
        {workspace.items.some(item => item.sourceFileId === file.id) && <label style={{ display: "block", marginBlock: 12 }}>Сохранённый импорт OCR<select aria-label="Сохранённый импорт OCR" value={selectedId}
          style={{ width: "100%", minWidth: 0 }} disabled={disabled || busy} onChange={event => setSelectedId(event.target.value)}>
          {workspace.items.filter(item => item.sourceFileId === file.id).map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString("ru-RU")} · {item.id}</option>)}</select></label>}
      </>}
      {busy && <p role="status">Проверяем исходник и сохраняем историю OCR…</p>}
      {error && <p role="alert">{error}</p>}
      {selected && workspace && <ImportedText key={selected.id} record={selected} file={file} workspace={workspace} disabled={!!disabled || busy}
        onReview={async (pageNumber, ordinal, decision, basis) => { await save({ pageNumber, ordinal, decision, basis }); }} />}
    </>}
  </section>;
}
