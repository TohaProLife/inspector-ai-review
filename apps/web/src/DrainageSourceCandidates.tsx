import { useEffect, useId, useRef, useState } from "react";
import type { DrainageRawReferenceType, DrainageRawSourceReferenceV1,
  DrainageSourceCandidatesV1 } from "./drainage-source-candidates-types";

export interface DrainageSourcePreviewRequest {
  checkId: string;
  sourceFileId: string;
  declaredCachePage: number;
  cacheJson: string;
}

/** Preserve exact UTF-8 cache bytes, including a BOM, for server identity checks. */
export async function readDrainageCacheFile(file: Pick<File, "size" | "arrayBuffer">,
  signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (file.size > 1048576) throw new Error("Файл OCR больше 1 МиБ. Выберите один сохранённый лист.");
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  if (bytes.byteLength > 1048576) throw new Error("Файл OCR больше 1 МиБ.");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("Файл OCR должен содержать корректный UTF-8 JSON."); }
}

const labels: Record<DrainageRawReferenceType, string> = {
  DRAINAGE_PLAN_REFERENCE: "Упоминание плана дренажа",
  DRAINAGE_TRAY_REFERENCE: "Упоминание дренажного лотка",
  DRAINAGE_PIPE_REFERENCE: "Упоминание дренажной трубы",
  TUBULAR_DRAINAGE_REFERENCE: "Упоминание трубчатого дренажа",
};

/** API spans count Unicode codepoints; String.slice would split astral characters. */
export function drainageQuoteParts(reference: Pick<DrainageRawSourceReferenceV1,
  "rawOcrText" | "matchedText" | "matchedSpanCodepoints">): [string, string, string] | null {
  const chars = Array.from(reference.rawOcrText);
  const [start, end] = reference.matchedSpanCodepoints;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end
    || end > chars.length || chars.slice(start, end).join("") !== reference.matchedText) return null;
  return [chars.slice(0, start).join(""), reference.matchedText, chars.slice(end).join("")];
}

export function DrainageSourceCandidateResults({ data, sourceName, sourceUrl }: {
  data: DrainageSourceCandidatesV1; sourceName: string; sourceUrl: string;
}) {
  return <div aria-label="Найденные упоминания дренажа">
    <p role="status">Найдено упоминаний: {data.references.length}. Вероятность инженерной ошибки не оценена.</p>
    {data.truncated && <p className="inline-message">Показаны первые 32 упоминания. Результат сокращён; полный перечень сооружений не установлен.</p>}
    {data.references.length === 0 && <p>По ограниченному набору формулировок упоминания не найдены. Это не подтверждает отсутствие дренажных сооружений.</p>}
    <ol>{data.references.map(reference => {
      const parts = drainageQuoteParts(reference);
      return <li key={`${reference.cacheJsonPointer}:${reference.rawReferenceType}`}>
        <h4>{labels[reference.rawReferenceType]}</h4>
        <p><strong>Кандидат · OCR не проверен.</strong> {sourceName}, физическая страница PDF {reference.declaredCachePage}.</p>
        <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {parts ? <>{parts[0]}<mark>{parts[1]}</mark>{parts[2]}</> : reference.rawOcrText}
        </blockquote>
        <a href={`${sourceUrl.split("#")[0]}#page=${reference.declaredCachePage}`} target="_blank" rel="noreferrer">Открыть оригинал · страница {reference.declaredCachePage}</a>
        <details><summary>Ссылка на распознанный фрагмент</summary>
          <p style={{ overflowWrap: "anywhere" }}>Строка в OCR: <code>{reference.cacheJsonPointer}</code><br />SHA-256 OCR: <code>{reference.cacheSha256}</code></p>
          <p>Текст и положение OCR не проверены по оригиналу. Рамка из этого файла на изображение страницы не накладывается.</p>
        </details>
      </li>;
    })}</ol>
  </div>;
}

export function DrainageSourceCandidates({ checkId, sourceFile, sourceUrl, disabled = false, preview }: {
  checkId: string;
  sourceFile: { id: string; name: string; sha256: string; pageCount: number | null };
  sourceUrl: string;
  disabled?: boolean;
  preview(input: DrainageSourcePreviewRequest, signal: AbortSignal): Promise<DrainageSourceCandidatesV1>;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState("1");
  const [data, setData] = useState<DrainageSourceCandidatesV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  function invalidate() {
    pending.current?.abort(); pending.current = null;
    setBusy(false); setData(null); setError(null);
  }
  useEffect(() => {
    invalidate(); setFile(null); setPage("1");
    return () => { pending.current?.abort(); pending.current = null; };
  }, [checkId, sourceFile.id, sourceFile.sha256]);
  useEffect(() => { if (disabled) invalidate(); }, [disabled]);
  const pageNumber = /^[1-9][0-9]{0,5}$/.test(page) ? Number(page) : 0;
  const validPage = pageNumber >= 1 && pageNumber <= 100000
    && (sourceFile.pageCount === null || pageNumber <= sourceFile.pageCount);

  async function load() {
    if (disabled || busy || !file || !validPage) return;
    invalidate();
    const controller = new AbortController(); pending.current = controller; setBusy(true);
    try {
      const cacheJson = await readDrainageCacheFile(file, controller.signal);
      const value = await preview({ checkId, sourceFileId: sourceFile.id,
        declaredCachePage: pageNumber, cacheJson }, controller.signal);
      controller.signal.throwIfAborted();
      if (pending.current === controller) setData(value);
    } catch (caught) {
      if (!controller.signal.aborted && pending.current === controller)
        setError(caught instanceof Error ? caught.message : "Не удалось прочитать OCR-фрагменты");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <details className="surface visual-proposal-panel">
    <summary>Упоминания дренажа из сохранённого OCR</summary>
    <p>Загрузите JSON распознавания одного листа выбранного PDF. Упоминания помогут найти исходный фрагмент. Текст OCR пока не проверен; тип сооружения и вероятность ошибки не установлены.</p>
    <p>Источник: {sourceFile.name} · {sourceFile.id}</p>
    <div className="source-review-fields">
      <label htmlFor={`${id}-cache`}>Сохранённый OCR листа, JSON до 1 МиБ
        <input key={`${checkId}:${sourceFile.id}:${sourceFile.sha256}`} id={`${id}-cache`} type="file" accept=".json,application/json" disabled={disabled}
          onChange={event => { invalidate(); setFile(event.target.files?.[0] ?? null); }} />
      </label>
      <label htmlFor={`${id}-page`}>Физическая страница PDF
        <input id={`${id}-page`} type="number" inputMode="numeric" min={1} max={Math.min(sourceFile.pageCount ?? 100000, 100000)}
          value={page} disabled={disabled} onChange={event => { invalidate(); setPage(event.target.value); }} />
      </label>
    </div>
    <button type="button" className="button button--secondary" disabled={disabled || busy || !file || !validPage} onClick={() => void load()}>
      {busy ? "Проверяем файл OCR…" : "Найти упоминания"}
    </button>
    {error && <p className="inline-message" role="alert">{error}</p>}
    {data && <DrainageSourceCandidateResults data={data} sourceName={sourceFile.name} sourceUrl={sourceUrl} />}
  </details>;
}
