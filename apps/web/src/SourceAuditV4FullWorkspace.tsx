import { SourceOcrImportWorkspace } from "./SourceOcrImportWorkspace";
import { NativeAirflowWorkspace } from "./NativeAirflowWorkspace";
import { useEffect, useRef, useState } from "react";
import type { CheckRun, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { SourceTextExplorer } from "./SourceTextExplorer";
import { NativeCapacityWorkspace } from "./NativeCapacityWorkspace";

const PROFILE = "SOURCE_AUDIT_V4_FULL_SOURCE_V1";
const SEALED = new Set(["PARTIAL", "REVIEW_REQUIRED", "CLARIFICATION_REQUIRED", "READY_TO_FINALIZE", "FINALIZED"]);
const POLL_LIMIT = 120;
const STATUSES = new Set(["DRAFT", "UPLOADING", "VALIDATING", "PROCESSING", ...SEALED, "FAILED"]);
const matching = (check: CheckRun, objectId: string) => !!check && typeof check === "object" && check.objectId === objectId && check.mode === "NORMAL"
  && check.purpose === "SOURCE_AUDIT_ONLY" && check.sourceAuditProfileVersion === PROFILE
  && typeof check.id === "string" && check.id.length >= 1 && check.id.length <= 200 && !/[^A-Za-z0-9_-]/u.test(check.id)
  && STATUSES.has(check.status) && typeof check.currentStage === "string"
  && Number.isSafeInteger(check.progress) && check.progress >= 0 && check.progress <= 100
  && typeof check.startedAt === "string" && Number.isFinite(Date.parse(check.startedAt))
  && (check.completedAt === null || typeof check.completedAt === "string" && Number.isFinite(Date.parse(check.completedAt))
    && Date.parse(check.completedAt) >= Date.parse(check.startedAt));
const sealed = (check: CheckRun) => check.progress === 100 && !!check.completedAt
  && Number.isFinite(Date.parse(check.completedAt)) && SEALED.has(check.status);
const latest = (rows: CheckRun[]) => [...rows].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
  || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0] ?? null;
const invalid = () => new Error("Ответ не подтверждает полный аудит V4 выбранного объекта. Обновите список запусков.");
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function selectSourceAuditV4Full(rows: CheckRun[], objectId: string): CheckRun | null {
  return latest(rows.filter(check => matching(check, objectId) && sealed(check)));
}
/** Latest attempt status is independent from the older source result selected for reading. */
export function selectSourceAuditV4FullStatus(rows: CheckRun[], objectId: string): CheckRun | null {
  return latest(rows.filter(check => matching(check, objectId)));
}
export async function listSourceAuditV4Full(objectId: string, signal: AbortSignal): Promise<CheckRun[]> {
  signal.throwIfAborted(); const data = await api.listObjectChecks(objectId, signal); signal.throwIfAborted();
  if (!data || !Array.isArray(data.items) || data.items.length > 100) throw invalid();
  const rows: CheckRun[] = [], seen = new Set<string>();
  for (const check of data.items) {
    if (!check || typeof check !== "object") throw invalid();
    if (check.sourceAuditProfileVersion !== PROFILE) continue;
    if (!matching(check, objectId) || seen.has(check.id)) throw invalid();
    seen.add(check.id); rows.push(check);
  }
  return rows;
}
export async function startSourceAuditV4Full(objectId: string, signal: AbortSignal): Promise<CheckRun> {
  signal.throwIfAborted(); const check = await api.startSourceAuditV4Full(objectId, signal); signal.throwIfAborted();
  if (!matching(check, objectId)) throw invalid(); return check;
}
export async function readSourceAuditV4FullCheck(objectId: string, checkId: string, signal: AbortSignal): Promise<CheckRun> {
  signal.throwIfAborted(); const check = await api.getCheck(checkId, signal); signal.throwIfAborted();
  if (!matching(check, objectId) || check.id !== checkId) throw invalid(); return check;
}
export function SourceAuditV4FullStatus({ check }: { check: CheckRun | null }) {
  if (!check) return <p>Сохранённых запусков полного аудита V4 пока нет.</p>;
  return <p role="status">Аудит {check.id}: {sealed(check) ? "Исходный текст готов" : check.status === "FAILED"
    ? "Ошибка подготовки исходников" : "Подготовка исходников"} · {check.progress}% · {check.currentStage}.
    {check.failure && ` ${check.failure.code}: ${check.failure.message}`}</p>;
}
interface Props { objectId: string; file: SourceFileSummary; reviewHash: string | null; canRun: boolean; runUnavailableReason?: string; disabled?: boolean }
export function SourceAuditV4FullWorkspace(props: Props) {
  return <FullWorkspace key={JSON.stringify([props.objectId, props.file.id, props.file.sha256, props.reviewHash])} {...props} />;
}
function FullWorkspace(props: Props) {
  const [checks, setChecks] = useState<CheckRun[]>([]), [selectedId, setSelectedId] = useState("");
  const [olderCheckId, setOlderCheckId] = useState(""), [opening, setOpening] = useState(false);
  const [starting, setStarting] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [pollCount, setPollCount] = useState(0), [pollFailed, setPollFailed] = useState(false);
  const startRequest = useRef<AbortController | null>(null), generation = useRef(0), activeId = useRef(""), pinnedHistoryId = useRef("");
  useEffect(() => () => { generation.current++; startRequest.current?.abort(); }, []);
  useEffect(() => { if (props.disabled) { generation.current++; startRequest.current?.abort(); setStarting(false); setOpening(false); } }, [props.disabled]);
  useEffect(() => {
    if (props.disabled) { setRefreshing(false); return; }
    const controller = new AbortController(); setRefreshing(true); setError("");
    void listSourceAuditV4Full(props.objectId, controller.signal).then(rows => {
      if (!controller.signal.aborted) setChecks(previous => [...rows, ...previous.filter(check => check.id === pinnedHistoryId.current
        && !rows.some(row => row.id === check.id))]);
    })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [props.objectId, refresh, props.disabled]);
  const audits = checks.filter(check => matching(check, props.objectId) && sealed(check));
  const active = latest(checks.filter(check => matching(check, props.objectId) && !check.completedAt && check.status !== "FAILED"));
  const chosen = selectedId ? audits.find(check => check.id === selectedId) ?? null : selectSourceAuditV4Full(checks, props.objectId);
  useEffect(() => {
    if (activeId.current !== (active?.id ?? "")) { activeId.current = active?.id ?? ""; setPollCount(0); setPollFailed(false); }
  }, [active?.id]);
  useEffect(() => {
    if (!active || props.disabled || pollFailed || pollCount >= POLL_LIMIT) return;
    const controller = new AbortController(), timer = setTimeout(() => {
      void readSourceAuditV4FullCheck(props.objectId, active.id, controller.signal).then(check => {
        if (!controller.signal.aborted) { setChecks(rows => rows.map(row => row.id === check.id ? check : row)); setPollCount(count => count + 1); }
      }).catch(cause => { if (!controller.signal.aborted) { setError(message(cause)); setPollFailed(true); } });
    }, 3000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, props.objectId, props.disabled, pollCount, pollFailed]);
  async function start() {
    if (!props.canRun || props.disabled || starting || opening || active || refreshing) return;
    const id = ++generation.current; startRequest.current?.abort(); const controller = new AbortController(); startRequest.current = controller;
    setStarting(true); setError(""); setPollFailed(false); setPollCount(0);
    try {
      const check = await startSourceAuditV4Full(props.objectId, controller.signal);
      if (id === generation.current && !controller.signal.aborted) { setChecks(rows => [check, ...rows.filter(row => row.id !== check.id)]); setSelectedId(""); }
    } catch (cause) { if (id === generation.current && !controller.signal.aborted) setError(message(cause)); }
    finally { if (id === generation.current) setStarting(false); }
  }
  async function openOlder() {
    if (props.disabled || starting || opening || refreshing || !/^[A-Za-z0-9_-]{1,200}$/u.test(olderCheckId)) return;
    const id = ++generation.current; startRequest.current?.abort(); const controller = new AbortController(); startRequest.current = controller;
    setOpening(true); setError("");
    try {
      const check = await readSourceAuditV4FullCheck(props.objectId, olderCheckId, controller.signal);
      if (id === generation.current && !controller.signal.aborted) {
        pinnedHistoryId.current = check.id;
        setChecks(rows => [check, ...rows.filter(row => row.id !== check.id)]); setSelectedId(sealed(check) ? check.id : "");
      }
    } catch (cause) { if (id === generation.current && !controller.signal.aborted) setError(message(cause)); }
    finally { if (id === generation.current) setOpening(false); }
  }
  return <section className="surface" aria-label="Полный аудит исходного текста V4" style={{ marginBlock: 20, padding: 20, minWidth: 0, overflowWrap: "anywhere" }}>
    <h2>Полный аудит PDF до 1024 страниц</h2>
    <p>Отдельная подготовка исходного текста всего объекта. До 1024 физических страниц на PDF; чтение всех страниц пакетами одного сохранённого артефакта, затем поиск по полному тексту. Выбранный PDF: {props.file.name}.</p>
    <p>Подготовка выполняется в фоне; состояние обновляется автоматически. Готовность текста не подтверждает инженерные выводы, видимость строки или решение по источнику. Числовая вероятность не рассчитана.</p>
    <button type="button" className="button button--primary" disabled={!props.canRun || props.disabled || starting || opening || refreshing || !!active} onClick={() => void start()}>
      {starting ? "Ставим полный аудит V4 в очередь…" : "Полный аудит PDF до 1024 страниц"}</button>{" "}
    <button type="button" className="button button--secondary" disabled={props.disabled || starting || opening || refreshing} onClick={() => {
      setPollCount(0); setPollFailed(false); setRefresh(n => n + 1);
    }}>{refreshing ? "Обновляем список…" : "Обновить список полных аудитов V4"}</button>
    {!props.canRun && <p role="status">{props.runUnavailableReason ?? "У вашей учётной записи нет права запускать аудит."}</p>}
    <SourceAuditV4FullStatus check={selectSourceAuditV4FullStatus(checks, props.objectId)} />
    {(pollCount >= POLL_LIMIT || pollFailed) && active && <p>Автоматическое обновление остановлено. Проверьте состояние кнопкой «Обновить список полных аудитов V4».</p>}
    {error && <p role="alert">{error}</p>}
    <p>В списке — полные аудиты V4 среди последних 100 запусков объекта. Исторические аудиты V3 доступны отдельно.</p>
    {audits.length > 0 && <label><span>Сохранённый полный аудит V4</span><select value={chosen?.id ?? ""} disabled={props.disabled || starting}
      onChange={event => setSelectedId(event.target.value)}>
      {audits.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).map(check => <option key={check.id} value={check.id}>
        {check.id} · {new Date(check.startedAt).toLocaleString("ru-RU")}</option>)}
    </select></label>}
    <details style={{ marginBlock: 12 }}><summary>Открыть более ранний полный аудит по ID</summary>
      <label><span>ID полного аудита V4</span><input value={olderCheckId} maxLength={200}
        onChange={event => setOlderCheckId(event.target.value.trim())} disabled={props.disabled || starting || opening} /></label>
      <button type="button" className="button button--secondary" onClick={() => void openOlder()}
        disabled={props.disabled || starting || opening || refreshing || !/^[A-Za-z0-9_-]{1,200}$/u.test(olderCheckId)}>
        {opening ? "Проверяем аудит…" : "Открыть аудит по ID"}</button>
    </details>
    {chosen && <SourceTextExplorer objectId={props.objectId} checkId={chosen.id} file={props.file} reviewHash={props.reviewHash}
      disabled={props.disabled || starting} />}
    {chosen && <SourceOcrImportWorkspace objectId={props.objectId} checkId={chosen.id} file={props.file} disabled={props.disabled || starting} />}
    {chosen && <NativeCapacityWorkspace objectId={props.objectId} checkId={chosen.id} disabled={props.disabled || starting} />}
    {chosen && <NativeAirflowWorkspace objectId={props.objectId} checkId={chosen.id} disabled={props.disabled || starting} />}
  </section>;
}
