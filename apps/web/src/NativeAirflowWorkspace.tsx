import { nativeSourceLineEvidence } from "./native-source-line-evidence";
import { useEffect, useRef, useState } from "react";
import type { NativeAirflowRecord, NativeAirflowWorkspace as AirflowWorkspace, NativeAirflowQuote, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { DocumentPairWorkspace } from "./DocumentPairWorkspace";
import type { DocumentEvidence } from "./document-pair-navigation";

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const reasons: Record<string, string> = {
  SELECTED_MEMBER_EVIDENCE_MISSING: "Для одной из выбранных систем нет поддержанной декларации расхода. Состав группы требует проверки.",
  AIRFLOW_DECLARATIONS_CONFLICT: "У выбранной системы встречаются разные расходы или давления. Нужна проверка редакций и режима работы.",
  SOURCE_ROLE_CONFLICT: "Выбранная роль ПД/РД противоречит сохранённой стадии документа.",
  UNSUPPORTED_AIRFLOW_GRAMMAR: "Формулировка расхода не поддержана строгим правилом.",
  UNLOCATED_SELECTED_SYSTEM: "У найденного упоминания системы нет проверенной исходной области.",
  MATCHING_PAGE_UNVERIFIED: "Страница с декларацией требует дополнительной проверки текстового слоя.",
  INPUT_LIMIT: "Превышен предел объёма исходного текста или цитат.",
};
export function parseAirflowSystemSelection(pd: string, rd: string) {
  const pdSystemId = pd.trim(), rdSystemIds = rd.trim().split(/[\s,;]+/u);
  const system = /^[ПВ][1-9][0-9]{0,5}(?:\.[1-9][0-9]{0,5})?$/u;
  if (!system.test(pdSystemId) || rdSystemIds.length < 1 || rdSystemIds.length > 16
    || rdSystemIds.some(id => !system.test(id)) || new Set(rdSystemIds).size !== rdSystemIds.length) return null;
  return { pdSystemId, rdSystemIds };
}
export function airflowQuoteEvidence(quote: NativeAirflowQuote, index: number): DocumentEvidence | null {
  return nativeSourceLineEvidence(quote, index, "airflow", "Заявленный расход выбранной системы");
}
function CapturedAirflow({ record, files }: { record: NativeAirflowRecord; files: SourceFileSummary[] }) {
  const comparison = record.comparison;
  const quotes = comparison.status === "COMPARED" ? [...comparison.quotes.PD, ...comparison.quotes.RD] : [];
  const evidence = quotes.map(airflowQuoteEvidence).filter((item): item is DocumentEvidence => !!item);
  const boundFiles = files.filter(file => file.id === record.input.pdSourceFileId && file.sha256 === record.bindings.pdSourceSha256
    || file.id === record.input.rdSourceFileId && file.sha256 === record.bindings.rdSourceSha256);
  const canView = boundFiles.length === 2 && evidence.length === quotes.length && evidence.length > 0;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `airflow-${record.id.replace(/[^A-Za-z0-9_-]/gu, "_")}.json`;
    document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Сохранённая сверка расходов вентиляции" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    {comparison.status === "COMPARED" ? <>
      <h3>{comparison.comparison === "EQUAL" ? `Заявленный расход совпадает: ${comparison.pdValue} / ${comparison.rdValue} м³/ч`
        : `Заявленный расход различается: ПД ${comparison.pdValue}, РД ${comparison.rdValue} м³/ч`}</h3>
      <p>Изменение РД относительно ПД: {comparison.deltaRdMinusPd} м³/ч. Цитат ПД: {comparison.quotes.PD.length}; РД: {comparison.quotes.RD.length}.</p>
      <div style={{ overflowX: "auto" }}><table><caption>Выбранный состав группы и отдельные давления</caption>
        <thead><tr><th>Роль</th><th>Система</th><th>Расход, м³/ч</th><th>Pc, Па</th></tr></thead>
        <tbody>{[comparison.memberValues.PD, ...comparison.memberValues.RD].map((member, index) => <tr key={index}>
          <td>{index === 0 ? "ПД" : "РД"}</td><td>{member.systemId}</td><td>{member.value}</td><td>{member.freePressurePa}</td></tr>)}</tbody>
      </table></div>
    </> : <><h3>Автоматическая сверка не выполнена</h3><p role="status">{reasons[comparison.reasonCode] ?? "Не удалось подтвердить входные данные для строгой сверки."} Код: {comparison.reasonCode}.</p></>}
    <p>Выбрано пользователем: ПД {record.input.selection.pdSystemId}; РД {record.input.selection.rdSystemIds.join(", ")}.</p>
    <p>Состав группы, физическое соответствие систем и совместный режим работы не подтверждены. Давления не складываются.
      Публичная привязка IOS4-079 конфликтует; равенство расходов не подтверждает кратность воздухообмена.</p>
    <p>Это сравнение исходных деклараций. Редакция, согласование и роль документов требуют проверки инспектора.
      Вероятность не рассчитана; инженерное нарушение и отсутствие нарушения этим не установлены. Машинное покрытие не изменено.</p>
    <p>Сохранено: {new Date(record.createdAt).toLocaleString("ru-RU")}. Проверка: {record.checkId}. Хеш: <code>{record.contentHash}</code>.</p>
    <button type="button" className="button button--secondary" onClick={download}>Скачать JSON сверки расходов вентиляции</button>
    <p><small>Отдельный исходный расчёт; автоматически в ранее сохранённый инженерный протокол не добавляется.</small></p>
    {canView && <DocumentPairWorkspace objectId={record.objectId} checkId={record.checkId} files={boundFiles} sources={evidence} title="Вентиляция: ПД и РД рядом" />}
    {quotes.length > 0 && !canView && <p role="alert">Исходники с сохранёнными SHA или рамки недоступны. Цитаты сохранены ниже; просмотр на другой редакции отключён.</p>}
    {quotes.length > 0 && <details><summary>Все исходные цитаты: {quotes.length}</summary><ol>{quotes.map((quote, index) => <li key={index}>
      {quote.inputRole}, физическая страница {quote.physicalPage}, путь {quote.sourcePath.join(".")}
      <pre style={{ whiteSpace: "pre-wrap" }}>{quote.rawText}</pre>
      <small>{quote.systemId}: {quote.value}м³/ч; Pc {quote.freePressurePa}Па.</small>
    </li>)}</ol></details>}
    {comparison.status === "COMPARED" && <details><summary>Упоминания выбранных систем без расхода: {comparison.references.PD.length + comparison.references.RD.length}</summary>
      <ol>{[...comparison.references.PD, ...comparison.references.RD].map((reference, index) => <li key={index}>
        {reference.inputRole}, физическая страница {reference.physicalPage}, путь {reference.sourcePath.join(".")}:
        <pre style={{ whiteSpace: "pre-wrap" }}>{reference.rawText}</pre></li>)}</ol>
    </details>}
  </section>;
}
export function NativeAirflowWorkspace(props: { objectId: string; checkId: string; disabled?: boolean }) {
  return <AirflowWorkspaceInner key={`${props.objectId}:${props.checkId}`} {...props} />;
}
function AirflowWorkspaceInner({ objectId, checkId, disabled }: { objectId: string; checkId: string; disabled?: boolean }) {
  const [opened, setOpened] = useState(false), [workspace, setWorkspace] = useState<AirflowWorkspace | null>(null);
  const [files, setFiles] = useState<SourceFileSummary[]>([]), [pd, setPd] = useState(""), [rd, setRd] = useState("");
  const [pdSystem, setPdSystem] = useState("П17"), [rdSystems, setRdSystems] = useState("П17.1, П17.2");
  const [selectedId, setSelectedId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!opened || disabled) { pending.current?.abort(); setBusy(false); return; }
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError("");
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    void Promise.all([api.listNativeAirflowComparisons(checkId, signal), api.listSourceFiles(objectId, signal)])
      .then(([value, sources]) => {
        if (controller.signal.aborted) return;
        if (value.schemaVersion !== "native-airflow-workspace-v1" || value.checkId !== checkId || !Array.isArray(value.items)
          || value.items.length > 1000 || value.items.some(item => item.schemaVersion !== "native-airflow-record-v1"
            || item.checkId !== checkId || item.objectId !== objectId) || !Array.isArray(sources.items)) throw new Error("Ответ не соответствует выбранной проверке");
        setWorkspace(value); setFiles(sources.items); setSelectedId(previous => value.items.some(item => item.id === previous) ? previous : value.items.at(-1)?.id ?? "");
        setPd(previous => previous || sources.items.find(file => file.stages.includes("PD"))?.id || "");
        setRd(previous => previous || sources.items.find(file => file.stages.includes("RD"))?.id || "");
      }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [opened, disabled, checkId, objectId, refresh]);
  const selection = parseAirflowSystemSelection(pdSystem, rdSystems);
  async function compare() {
    if (disabled || busy || !workspace?.canCompare || !pd || !rd || pd === rd || !selection) return;
    const controller = new AbortController(); pending.current?.abort(); pending.current = controller; setBusy(true); setError("");
    try {
      const record = await api.compareNativeAirflow(checkId, { schemaVersion: "native-airflow-command-v1", pdSourceFileId: pd, rdSourceFileId: rd, selection },
        AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]));
      if (controller.signal.aborted) return;
      if (record.schemaVersion !== "native-airflow-record-v1" || record.checkId !== checkId || record.objectId !== objectId)
        throw new Error("Сохранённая сверка относится к другой проверке");
      setWorkspace(value => value && { ...value, items: [...value.items.filter(item => item.id !== record.id), record] }); setSelectedId(record.id);
    } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const selected = workspace?.items.find(item => item.id === selectedId);
  return <section className="native-source-comparison" aria-label="Сверка расходов вентиляции ПД/РД" style={{ marginBlock: 20, minWidth: 0, overflowWrap: "anywhere" }}>
    <h3>Сверка расходов вентиляции ПД/РД по полному исходному тексту</h3>
    <p>Строгое сравнение явно записанных расходов выбранных систем по всем страницам двух сохранённых PDF.
      Группа задаётся пользователем. OCR и инженерная квалификация в этот расчёт не входят.</p>
    {!opened && <button type="button" className="button button--secondary" disabled={disabled} onClick={() => setOpened(true)}>Открыть сверку расходов вентиляции ПД/РД</button>}
    {opened && <>
      <button type="button" className="button button--secondary" disabled={disabled || busy} onClick={() => setRefresh(value => value + 1)}>Обновить историю сверок расходов вентиляции</button>
      {workspace && !workspace.canCompare && <p role="status">Для сравнения нужен завершённый полный аудит V4.</p>}
      {workspace && <><div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBlock: 12 }}>
        {(["PD", "RD"] as const).map(role => <label key={role} style={{ flex: "1 1 220px", minWidth: 0 }}>
          {role === "PD" ? "ПД" : "РД"} для сверки расходов вентиляции<select aria-label={`${role === "PD" ? "ПД" : "РД"} для сверки расходов вентиляции`} style={{ width: "100%", minWidth: 0 }}
            value={role === "PD" ? pd : rd} disabled={disabled || busy || !workspace.canCompare} onChange={event => role === "PD" ? setPd(event.target.value) : setRd(event.target.value)}>
            <option value="">Выберите исходный PDF</option>{files.map(file => <option key={file.id} value={file.id}>{file.name} · {file.stages.join("/")}</option>)}
          </select></label>)}
        <label style={{ flex: "1 1 220px", minWidth: 0 }}>Система ПД<input aria-label="Система ПД для сверки расходов" value={pdSystem}
          style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} disabled={disabled || busy || !workspace.canCompare} onChange={event => setPdSystem(event.target.value)} /></label>
        <label style={{ flex: "1 1 220px", minWidth: 0 }}>Системы РД через запятую<input aria-label="Системы РД для сверки расходов" value={rdSystems}
          style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} disabled={disabled || busy || !workspace.canCompare} onChange={event => setRdSystems(event.target.value)} /></label>
      </div>{!selection && <p role="status">Нужна одна система ПД и от1 до16 разных систем РД, например П17 и П17.1, П17.2.</p>}<button type="button" className="button button--primary" disabled={disabled || busy || !workspace.canCompare || !pd || !rd || pd === rd || !selection} onClick={() => void compare()}>
        {busy ? "Проверяем исходники…" : "Сравнить расход по исходному тексту"}</button>
        {workspace.items.length > 0 && <label style={{ display: "block", marginBlock: 12, minWidth: 0 }}>Сохранённая сверка расходов вентиляции<select style={{ width: "100%", maxWidth: "100%", minWidth: 0 }} aria-label="Сохранённая сверка расходов вентиляции" value={selectedId} disabled={disabled || busy} onChange={event => setSelectedId(event.target.value)}>
          {[...workspace.items].reverse().map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString("ru-RU")} · {item.id}</option>)}
        </select></label>}
      </>}
      {busy && <p role="status">Читаем сохранённые исходники и историю…</p>}
      {error && <p role="alert">{error}</p>}
      {selected && <CapturedAirflow record={selected} files={files} />}
    </>}
  </section>;
}
