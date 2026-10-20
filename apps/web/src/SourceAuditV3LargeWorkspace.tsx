import { useEffect, useRef, useState } from "react";
import type { CheckRun, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { SourceTextExplorer } from "./SourceTextExplorer";

const PROFILE = "SOURCE_AUDIT_V3_LARGE_VERTICAL_V1";
const SEALED = new Set(["PARTIAL", "REVIEW_REQUIRED", "CLARIFICATION_REQUIRED", "READY_TO_FINALIZE", "FINALIZED"]);
const POLL_LIMIT = 120;
const matching = (check: CheckRun, objectId: string) => !!check && check.objectId === objectId && check.mode === "NORMAL"
  && check.purpose === "SOURCE_AUDIT_ONLY" && check.sourceAuditProfileVersion === PROFILE
  && typeof check.id === "string" && check.id.length >= 1 && check.id.length <= 200 && !/[^A-Za-z0-9_-]/u.test(check.id)
  && Number.isSafeInteger(check.progress) && check.progress >= 0 && check.progress <= 100
  && Number.isFinite(Date.parse(check.startedAt));
const sealed = (check: CheckRun) => check.progress === 100 && !!check.completedAt
  && Number.isFinite(Date.parse(check.completedAt)) && SEALED.has(check.status);
const latest = (rows: CheckRun[]) => [...rows].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
  || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0] ?? null;
const invalid = () => new Error("Ответ не подтверждает большой аудит исходников выбранного объекта. Обновите список запусков.");
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function selectSourceAuditV3Large(rows: CheckRun[], objectId: string): CheckRun | null {
  return latest(rows.filter(check => matching(check, objectId) && sealed(check)));
}
/** Latest attempt status is independent from the older source result selected for reading. */
export function selectSourceAuditV3LargeStatus(rows: CheckRun[], objectId: string): CheckRun | null {
  return latest(rows.filter(check => matching(check, objectId)));
}
export async function listSourceAuditV3Large(objectId: string, signal: AbortSignal): Promise<CheckRun[]> {
  signal.throwIfAborted(); const data = await api.listObjectChecks(objectId, signal); signal.throwIfAborted();
  if (!Array.isArray(data.items)) throw invalid();
  return data.items.filter(check => matching(check, objectId));
}
export async function startSourceAuditV3Large(objectId: string, signal: AbortSignal): Promise<CheckRun> {
  signal.throwIfAborted(); const check = await api.startSourceAuditV3LargeVertical(objectId, signal); signal.throwIfAborted();
  if (!matching(check, objectId)) throw invalid(); return check;
}
export async function readSourceAuditV3LargeCheck(objectId: string, checkId: string, signal: AbortSignal): Promise<CheckRun> {
  signal.throwIfAborted(); const check = await api.getCheck(checkId, signal); signal.throwIfAborted();
  if (!matching(check, objectId) || check.id !== checkId) throw invalid(); return check;
}
export function SourceAuditV3LargeStatus({ check }: { check: CheckRun | null }) {
  if (!check) return <p>Сохранённых запусков большого аудита пока нет.</p>;
  return <p role="status">Аудит {check.id}: {sealed(check) ? "Исходный текст готов" : check.status === "FAILED"
    ? "Ошибка подготовки исходников" : "Подготовка исходников"} · {check.progress}% · {check.currentStage}.
    {check.failure && ` ${check.failure.code}: ${check.failure.message}`}</p>;
}
interface Props { objectId: string; file: SourceFileSummary; reviewHash: string | null; canRun: boolean; runUnavailableReason?: string; disabled?: boolean }
export function SourceAuditV3LargeWorkspace(props: Props) {
  return <LargeWorkspace key={JSON.stringify([props.objectId, props.file.id, props.file.sha256, props.reviewHash])} {...props} />;
}
function LargeWorkspace(props: Props) {
  const [checks, setChecks] = useState<CheckRun[]>([]), [selectedId, setSelectedId] = useState("");
  const [starting, setStarting] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [pollCount, setPollCount] = useState(0), [pollFailed, setPollFailed] = useState(false);
  const startRequest = useRef<AbortController | null>(null), generation = useRef(0), activeId = useRef("");
  useEffect(() => () => { generation.current++; startRequest.current?.abort(); }, []);
  useEffect(() => { if (props.disabled) { generation.current++; startRequest.current?.abort(); setStarting(false); } }, [props.disabled]);
  useEffect(() => {
    if (props.disabled) { setRefreshing(false); return; }
    const controller = new AbortController(); setRefreshing(true); setError("");
    void listSourceAuditV3Large(props.objectId, controller.signal).then(rows => { if (!controller.signal.aborted) setChecks(rows); })
      .catch(cause => { if (!controller.signal.aborted) setError(message(cause)); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [props.objectId, refresh, props.disabled]);
  const audits = checks.filter(check => matching(check, props.objectId) && sealed(check));
  const active = latest(checks.filter(check => matching(check, props.objectId) && !check.completedAt && check.status !== "FAILED"));
  const chosen = selectedId ? audits.find(check => check.id === selectedId) ?? null : selectSourceAuditV3Large(checks, props.objectId);
  useEffect(() => {
    if (activeId.current !== (active?.id ?? "")) { activeId.current = active?.id ?? ""; setPollCount(0); setPollFailed(false); }
  }, [active?.id]);
  useEffect(() => {
    if (!active || props.disabled || pollFailed || pollCount >= POLL_LIMIT) return;
    const controller = new AbortController(), timer = setTimeout(() => {
      void readSourceAuditV3LargeCheck(props.objectId, active.id, controller.signal).then(check => {
        if (!controller.signal.aborted) { setChecks(rows => rows.map(row => row.id === check.id ? check : row)); setPollCount(count => count + 1); }
      }).catch(cause => { if (!controller.signal.aborted) { setError(message(cause)); setPollFailed(true); } });
    }, 3000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, props.objectId, props.disabled, pollCount, pollFailed]);
  async function start() {
    if (!props.canRun || props.disabled || starting || active || refreshing) return;
    const id = ++generation.current; startRequest.current?.abort(); const controller = new AbortController(); startRequest.current = controller;
    setStarting(true); setError(""); setPollFailed(false); setPollCount(0);
    try {
      const check = await startSourceAuditV3Large(props.objectId, controller.signal);
      if (id === generation.current && !controller.signal.aborted) { setChecks(rows => [check, ...rows.filter(row => row.id !== check.id)]); setSelectedId(""); }
    } catch (cause) { if (id === generation.current && !controller.signal.aborted) setError(message(cause)); }
    finally { if (id === generation.current) setStarting(false); }
  }
  return <section className="surface" aria-label="Большой аудит исходного текста" style={{ marginBlock: 20, padding: 20, minWidth: 0, overflowWrap: "anywhere" }}>
    <h2>Большой PDF и вертикальный текст</h2>
    <p>Отдельный аудит всего объекта с чтением вертикального текста. Предел сохранённого текстового представления PDF: 32 000 000 байт, 512 страниц и 100 000 исходных строк для поиска. Выбранный PDF: {props.file.name}.</p>
    <p>Подготовка выполняется в фоне; состояние обновляется автоматически. Готовность текста не подтверждает инженерные выводы, видимость строки или решение по источнику. Числовая вероятность не рассчитана.</p>
    <button type="button" className="button button--primary" disabled={!props.canRun || props.disabled || starting || refreshing || !!active} onClick={() => void start()}>
      {starting ? "Ставим большой аудит в очередь…" : "Большой PDF и вертикальный текст"}</button>{" "}
    <button type="button" className="button button--secondary" disabled={props.disabled || starting || refreshing} onClick={() => {
      setPollCount(0); setPollFailed(false); setRefresh(n => n + 1);
    }}>{refreshing ? "Обновляем список…" : "Обновить список больших аудитов"}</button>
    {!props.canRun && <p role="status">{props.runUnavailableReason ?? "У вашей учётной записи нет права запускать аудит."}</p>}
    <SourceAuditV3LargeStatus check={selectSourceAuditV3LargeStatus(checks, props.objectId)} />
    {(pollCount >= POLL_LIMIT || pollFailed) && active && <p>Автоматическое обновление остановлено. Проверьте состояние кнопкой «Обновить список больших аудитов».</p>}
    {error && <p role="alert">{error}</p>}
    {audits.length > 0 && <label><span>Сохранённый большой аудит</span><select value={chosen?.id ?? ""} disabled={props.disabled || starting}
      onChange={event => setSelectedId(event.target.value)}>
      {audits.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).map(check => <option key={check.id} value={check.id}>
        {check.id} · {new Date(check.startedAt).toLocaleString("ru-RU")}</option>)}
    </select></label>}
    {chosen && <SourceTextExplorer objectId={props.objectId} checkId={chosen.id} file={props.file} reviewHash={props.reviewHash}
      disabled={props.disabled || starting} />}
  </section>;
}
