import { useEffect, useId, useRef, useState } from "react";
import { readDrainageCacheFile, drainageQuoteParts } from "./DrainageSourceCandidates";
import type { Ppm113SourceCandidatesV1, Ppm113SourcePreviewInputV1 } from "./ppm113-source-types";

export function ppm113MatchesSource(data: Ppm113SourceCandidatesV1,
  input: Pick<Ppm113SourcePreviewInputV1, "sourceFileId" | "declaredCachePage">, sourceSha: string): boolean {
  return data.schemaVersion === "ppm113-source-candidates-v1"
    && data.policyVersion === "ppm113-named-ring-internal-diameter-literals-v1" && data.parameterCode === "PPM-113"
    && data.purpose === "SOURCE_REVIEW_ONLY" && data.provenance === "OCR_CACHE_UNVERIFIED"
    && data.probability === null && data.findings === null && data.parameterCoverage === null
    && Array.isArray(data.references) && data.references.length <= 32 && data.references.every(ref =>
      ref.sourceFileId === input.sourceFileId && ref.sourcePdfSha256 === sourceSha
      && ref.declaredCachePage === input.declaredCachePage && ref.probability === null
      && ref.status === "SOURCE_CANDIDATE" && ref.provenance === "OCR_CACHE_UNVERIFIED"
      && ref.rawReferenceType === "NAMED_VPV_RING_INTERNAL_DIAMETER");
}

export function Ppm113SourceCandidateResults({ data, sourceName, sourceUrl }: {
  data: Ppm113SourceCandidatesV1; sourceName: string; sourceUrl: string;
}) {
  return <div aria-label="Кольца ВПВ и внутренний диаметр из OCR">
    <p role="status">Найдено цитат: {data.references.length}. Вероятность инженерной ошибки не оценена.</p>
    <p>Инженерное сравнение не выполнено. Расход воды, число струй и кранов здесь не проверяются.</p>
    {data.truncated && <p className="inline-message">Показаны первые 32 цитаты. Это не полный перечень колец.</p>}
    {data.references.length === 0 && <p>Нет точной строки с именем кольца ВПВ и внутренним диаметром. Иные обозначения, DN и наружный диаметр не распознаются. Это не подтверждает отсутствие кольца или нарушения.</p>}
    <ol>{data.references.map(ref => {
      const parts = drainageQuoteParts(ref);
      return <li key={ref.cacheJsonPointer}>
        <h4>Кольцо <bdi>{ref.ringId}</bdi> · внутренний диаметр {ref.internalDiameterMm} мм</h4>
        <p><strong>Кандидат · OCR не проверен.</strong> {sourceName}, физическая страница PDF {ref.declaredCachePage}.</p>
        <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {parts ? <>{parts[0]}<mark>{parts[1]}</mark>{parts[2]}</> : ref.rawOcrText}
        </blockquote>
        <a href={`${sourceUrl.split("#")[0]}#page=${ref.declaredCachePage}`} target="_blank" rel="noreferrer">Открыть оригинал · страница {ref.declaredCachePage}</a>
        <details><summary>Ссылка на распознанную строку</summary>
          <p style={{ overflowWrap: "anywhere" }}>Строка в OCR: <code>{ref.cacheJsonPointer}</code><br />SHA-256 OCR: <code>{ref.cacheSha256}</code></p>
          <p>Текст и положение OCR не проверены по оригиналу. Рамка из кэша не накладывается на PDF. Одинаковое имя в двух цитатах не устанавливает тождество колец.</p>
        </details>
      </li>;
    })}</ol>
  </div>;
}

export function Ppm113SourceCandidates({ checkId, sourceFile, sourceUrl, disabled = false, preview }: {
  checkId: string; sourceFile: { id: string; name: string; sha256: string; pageCount: number | null };
  sourceUrl: string; disabled?: boolean;
  preview(input: Ppm113SourcePreviewInputV1, signal: AbortSignal): Promise<Ppm113SourceCandidatesV1>;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null), [page, setPage] = useState("1");
  const [data, setData] = useState<Ppm113SourceCandidatesV1 | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
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
    invalidate(); const controller = new AbortController(); pending.current = controller; setBusy(true);
    try {
      const cacheJson = await readDrainageCacheFile(file, controller.signal);
      const input = { checkId, sourceFileId: sourceFile.id, declaredCachePage: pageNumber, cacheJson };
      const value = await preview(input, controller.signal);
      controller.signal.throwIfAborted();
      if (!ppm113MatchesSource(value, input, sourceFile.sha256)) throw new Error("Ответ относится к другому исходнику. Обновите проверку.");
      if (pending.current === controller) setData(value);
    } catch (caught) {
      if (!controller.signal.aborted && pending.current === controller)
        setError(caught instanceof Error ? caught.message : "Не удалось прочитать цитаты ВПВ");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  return <details className="surface visual-proposal-panel">
    <summary>PPM-113 · кольцо ВПВ и диаметр из сохранённого OCR</summary>
    <p>Загрузите JSON распознавания одного листа выбранного PDF. Ищем только явную строку, например: «Кольцевой трубопровод ВПВ К1: внутренний диаметр 100 мм».</p>
    <p>Это поиск цитат для проверки исходника. OCR пока не проверен; согласование и инженерная ошибка не установлены.</p>
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
      {busy ? "Проверяем файл OCR…" : "Найти кольцо и диаметр"}
    </button>
    {error && <p className="inline-message" role="alert">{error}</p>}
    {data && <Ppm113SourceCandidateResults data={data} sourceName={sourceFile.name} sourceUrl={sourceUrl} />}
  </details>;
}
