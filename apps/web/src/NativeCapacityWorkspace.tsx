import { nativeSourceLineEvidence } from "./native-source-line-evidence";
import { useEffect, useRef, useState } from "react";
import type { NativeCapacityRecord, NativeCapacityWorkspace as CapacityWorkspace, NativeCapacityQuote, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { DocumentPairWorkspace } from "./DocumentPairWorkspace";
import type { DocumentEvidence } from "./document-pair-navigation";

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const reasons: Record<string, string> = {
  CAPACITY_EVIDENCE_MISSING: "В одном из документов нет поддержанной декларации вместимости школы.",
  CAPACITY_DECLARATIONS_CONFLICT: "В исходнике встречаются разные значения вместимости. Нужна проверка редакций и объекта.",
  SOURCE_ROLE_CONFLICT: "Выбранная роль ПД/РД противоречит сохранённой стадии документа.",
  TITLE_CONTINUATION_UNRESOLVED: "Продолжение заголовка нельзя однозначно связать с числом мест.",
  UNSUPPORTED_TITLE_GRAMMAR: "Формулировка заголовка не поддержана строгим правилом.",
  AMBIGUOUS_TITLE_ENTITY: "Не удалось однозначно установить сущность заголовка.",
  UNLOCATED_TITLE: "У найденного заголовка нет проверенной исходной области.",
  MATCHING_PAGE_UNVERIFIED: "Страница с декларацией требует дополнительной проверки текстового слоя.",
  INPUT_LIMIT: "Превышен предел объёма исходного текста или цитат.",
};
export function capacityQuoteEvidence(quote: NativeCapacityQuote, index: number): DocumentEvidence | null {
  return nativeSourceLineEvidence(quote, index, "capacity", "Заявленная вместимость школы");
}
function CapturedCapacity({ record, files }: { record: NativeCapacityRecord; files: SourceFileSummary[] }) {
  const comparison = record.comparison;
  const quotes = comparison.status === "COMPARED" ? [...comparison.quotes.PD, ...comparison.quotes.RD] : [];
  const evidence = quotes.map(capacityQuoteEvidence).filter((item): item is DocumentEvidence => !!item);
  const boundFiles = files.filter(file => file.id === record.input.pdSourceFileId && file.sha256 === record.bindings.pdSourceSha256
    || file.id === record.input.rdSourceFileId && file.sha256 === record.bindings.rdSourceSha256);
  const canView = boundFiles.length === 2 && evidence.length === quotes.length && evidence.length > 0;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `capacity-${record.id.replace(/[^A-Za-z0-9_-]/gu, "_")}.json`;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Сохранённая сверка вместимости" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    {comparison.status === "COMPARED" ? <>
      <h3>{comparison.comparison === "EQUAL" ? `Заявленная вместимость совпадает: ${comparison.pdValue} / ${comparison.rdValue} мест`
        : `Заявленная вместимость различается: ПД ${comparison.pdValue}, РД ${comparison.rdValue} мест`}</h3>
      <p>Изменение РД относительно ПД: {comparison.deltaRdMinusPd} мест. Цитат ПД: {comparison.quotes.PD.length}; РД: {comparison.quotes.RD.length}.</p>
    </> : <><h3>Автоматическая сверка не выполнена</h3><p role="status">{reasons[comparison.reasonCode] ?? "Не удалось подтвердить входные данные для строгой сверки."} Код: {comparison.reasonCode}.</p></>}
    <p>Это сравнение исходных деклараций. Редакция, согласование и роль документов требуют проверки инспектора.
      Вероятность не рассчитана; инженерное нарушение и отсутствие нарушения этим не установлены. Машинное покрытие не изменено.</p>
    <p>Сохранено: {new Date(record.createdAt).toLocaleString("ru-RU")}. Проверка: {record.checkId}. Хеш: <code>{record.contentHash}</code>.</p>
    <button type="button" className="button button--secondary" onClick={download}>Скачать JSON сверки вместимости</button>
    <p><small>Отдельный исходный расчёт; автоматически в ранее сохранённый инженерный протокол не добавляется.</small></p>
    {comparison.excludedTitleFragments.length > 0 && <details><summary>Неоднозначные фрагменты заголовков: {comparison.excludedTitleFragments.length}</summary>
      <ol>{comparison.excludedTitleFragments.map((item, index) => <li key={index}>{item.inputRole}, стр. {item.physicalPage}: <pre style={{ whiteSpace: "pre-wrap" }}>{item.rawText}</pre>{item.reason}</li>)}</ol>
    </details>}
    {canView && <DocumentPairWorkspace objectId={record.objectId} checkId={record.checkId} files={boundFiles} sources={evidence} title="Вместимость: ПД и РД рядом" />}
    {quotes.length > 0 && !canView && <p role="alert">Исходники с сохранёнными SHA или рамки недоступны. Цитаты сохранены ниже; просмотр на другой редакции отключён.</p>}
    {quotes.length > 0 && <details><summary>Все исходные цитаты: {quotes.length}</summary><ol>{quotes.map((quote, index) => <li key={index}>
      {quote.inputRole}, физическая страница {quote.physicalPage}, путь {quote.sourcePath.join(".")}
      {quote.contextTitleLine && <><p>Предыдущая строка того же блока, отдельная исходная цитата:</p><pre style={{ whiteSpace: "pre-wrap" }}>{quote.contextTitleLine.rawText}</pre></>}
      <pre style={{ whiteSpace: "pre-wrap" }}>{quote.rawText}</pre>
      {quote.extractionMethod === "NATIVE_SAME_BLOCK_TWO_LINE_TITLE" && <small>Заголовок и количество связаны строгим правилом соседних строк одного блока.</small>}
    </li>)}</ol></details>}
  </section>;
}
export function NativeCapacityWorkspace(props: { objectId: string; checkId: string; disabled?: boolean }) {
  return <CapacityWorkspaceInner key={`${props.objectId}:${props.checkId}`} {...props} />;
}
function CapacityWorkspaceInner({ objectId, checkId, disabled }: { objectId: string; checkId: string; disabled?: boolean }) {
  const [opened, setOpened] = useState(false), [workspace, setWorkspace] = useState<CapacityWorkspace | null>(null);
  const [files, setFiles] = useState<SourceFileSummary[]>([]), [pd, setPd] = useState(""), [rd, setRd] = useState("");
  const [selectedId, setSelectedId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!opened || disabled) { pending.current?.abort(); setBusy(false); return; }
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError("");
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    void Promise.all([api.listNativeCapacityComparisons(checkId, signal), api.listSourceFiles(objectId, signal)])
      .then(([value, sources]) => {
        if (controller.signal.aborted) return;
        if (value.schemaVersion !== "native-capacity-workspace-v1" || value.checkId !== checkId || !Array.isArray(value.items)
          || value.items.length > 1000 || value.items.some(item => item.schemaVersion !== "native-capacity-record-v1"
            || item.checkId !== checkId || item.objectId !== objectId) || !Array.isArray(sources.items)) throw new Error("Ответ не соответствует выбранной проверке");
        setWorkspace(value); setFiles(sources.items); setSelectedId(previous => value.items.some(item => item.id === previous) ? previous : value.items.at(-1)?.id ?? "");
        setPd(previous => previous || sources.items.find(file => file.stages.includes("PD"))?.id || "");
        setRd(previous => previous || sources.items.find(file => file.stages.includes("RD"))?.id || "");
      }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [opened, disabled, checkId, objectId, refresh]);
  async function compare() {
    if (disabled || busy || !workspace?.canCompare || !pd || !rd || pd === rd) return;
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller; setBusy(true); setError("");
    try {
      const record = await api.compareNativeCapacity(checkId, { schemaVersion: "native-capacity-command-v1", pdSourceFileId: pd, rdSourceFileId: rd },
        AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]));
      if (controller.signal.aborted) return;
      if (record.schemaVersion !== "native-capacity-record-v1" || record.checkId !== checkId || record.objectId !== objectId)
        throw new Error("Сохранённая сверка относится к другой проверке");
      setWorkspace(value => value && { ...value, items: [...value.items.filter(item => item.id !== record.id), record] }); setSelectedId(record.id);
    } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const selected = workspace?.items.find(item => item.id === selectedId);
  return <section aria-label="Сверка вместимости ПД/РД" style={{ marginBlock: 20, minWidth: 0, overflowWrap: "anywhere" }}>
    <h3>Сверка вместимости ПД/РД по полному исходному тексту</h3>
    <p>Строгое сравнение деклараций «Школа на N мест» по всем страницам двух сохранённых PDF. OCR и инженерная квалификация в этот расчёт не входят.</p>
    {!opened && <button type="button" className="button button--secondary" disabled={disabled} onClick={() => setOpened(true)}>Открыть сверку вместимости ПД/РД</button>}
    {opened && <>
      <button type="button" className="button button--secondary" disabled={disabled || busy} onClick={() => setRefresh(value => value + 1)}>Обновить историю сверок вместимости</button>
      {workspace && !workspace.canCompare && <p role="status">Для сравнения нужен завершённый полный аудит V4.</p>}
      {workspace && <><div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBlock: 12 }}>
        {(["PD", "RD"] as const).map(role => <label key={role} style={{ flex: "1 1 220px", minWidth: 0 }}>
          {role === "PD" ? "ПД" : "РД"} для сверки вместимости<select aria-label={`${role === "PD" ? "ПД" : "РД"} для сверки вместимости`} style={{ width: "100%", minWidth: 0 }}
            value={role === "PD" ? pd : rd} disabled={disabled || busy || !workspace.canCompare} onChange={event => role === "PD" ? setPd(event.target.value) : setRd(event.target.value)}>
            <option value="">Выберите исходный PDF</option>{files.map(file => <option key={file.id} value={file.id}>{file.name} · {file.stages.join("/")}</option>)}
          </select></label>)}
      </div><button type="button" className="button button--primary" disabled={disabled || busy || !workspace.canCompare || !pd || !rd || pd === rd} onClick={() => void compare()}>
        {busy ? "Проверяем исходники…" : "Сравнить вместимость по исходному тексту"}</button>
        {workspace.items.length > 0 && <label style={{ display: "block", marginBlock: 12, minWidth: 0 }}>Сохранённая сверка вместимости<select style={{ width: "100%", maxWidth: "100%", minWidth: 0 }} aria-label="Сохранённая сверка вместимости" value={selectedId} disabled={disabled || busy} onChange={event => setSelectedId(event.target.value)}>
          {[...workspace.items].reverse().map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString("ru-RU")} · {item.id}</option>)}
        </select></label>}
      </>}
      {busy && <p role="status">Читаем сохранённые исходники и историю…</p>}
      {error && <p role="alert">{error}</p>}
      {selected && <CapturedCapacity record={selected} files={files} />}
    </>}
  </section>;
}
