import { useState } from "react";
import { api } from "./api";
export function InspectorGeometryRegistration({ objectId, sourceFileId }: { objectId: string; sourceFileId: string }) {
  const [id, setId] = useState(""); const [result, setResult] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function load() { setBusy(true); setError(null); setResult(null);
    try { setResult(await api.getGeometryRegistration(objectId, sourceFileId, id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Независимые контрольные точки недоступны"); }
    finally { setBusy(false); }
  }
  return <details><summary>Абсолютная геопривязка и погрешность</summary>
    <p>Для абсолютных координат здания нужен проверенный независимый источник системы координат и контрольных точек. Для локального сопоставления двух чертежей можно использовать их собственные оси и устойчивые опоры: с отдельными контрольными точками и оценкой погрешности. Такая локальная привязка не устанавливает абсолютное положение здания.</p>
    <label>Регистрационный номер пакета<input value={id} maxLength={80} pattern="[a-zA-Z0-9_-]+" onChange={e => setId(e.target.value)} /></label>
    <button type="button" disabled={busy || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)} onClick={() => void load()}>{busy ? "Проверка…" : "Проверить подписанную привязку"}</button>
    {error && <p role="alert">{error}. Абсолютное положение здания не установлено; локальное сопоставление оценивается отдельно.</p>}
    {result && <><p>Источник: {result.independentSource.authority} · {result.independentSource.reference} · SHA {result.independentSource.sha256}</p>
      <p>Согласовал: {result.independentSource.approvedBy} · {result.independentSource.approvedAt}</p>
      <p>Контрольные точки, не участвовавшие в расчёте: {result.result.holdouts.length}. Максимальная погрешность: {result.result.maxHoldoutResidualProjectUnits} {result.result.targetFrame.unit}; допуск: {result.result.holdoutToleranceProjectUnits}.</p>
      <p>Обратное преобразование: ошибка {result.result.maxRoundtripPageUnits}. Статус: проверка геометрии для инспектора. Автоматический вывод о нарушении не сформирован.</p></>}
  </details>;
}
