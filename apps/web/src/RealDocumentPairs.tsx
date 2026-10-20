import { useEffect, useState } from "react";
import type { SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { DocumentPairWorkspace } from "./DocumentPairWorkspace";
import { realDocumentPairs } from "./real-document-pairs";
import { realParameterPairs } from "./real-parameter-pairs";

export function RealDocumentPairsPanel({ objectId, checkId, files }: { objectId: string; checkId?: string; files: SourceFileSummary[] }) {
  const pairs = realDocumentPairs(files), [roomId, setRoomId] = useState("147");
  const parameters = realParameterPairs(files), parameter = parameters.find(value => value.id === roomId);
  const pair = parameter ? undefined : pairs.find(value => value.roomId === roomId) ?? pairs[0];
  return <section className="surface inspector-review" aria-label="Сравнение реальных ПД и РД">
    <h2>ПД и РД рядом</h2>
    {pair || parameter ? <>
      <div className="inspector-actions" aria-label="Реальные пары помещений">{pairs.map(value => <button key={value.roomId} type="button"
        aria-pressed={value.roomId === pair?.roomId} onClick={() => setRoomId(value.roomId)}>Помещение {value.roomId}</button>)}
        {parameters.map(value => <button key={value.id} type="button" aria-pressed={value.id === parameter?.id}
          onClick={() => setRoomId(value.id)}>{value.label}</button>)}
      </div>
      <p><strong>Кандидат · вероятность не оценена.</strong>{pair ? <> Сравнивается выбранная серия В2, полный состав систем не установлен.
        Марки РД расшифрованы вручную по оригиналу.</> : parameter?.parameterCode === "PZ-013"
        ? <> Сверяем заявленные 600 мест. Цитаты правого документа получены OCR и требуют проверки по листу.</>
        : <> Сверяем выбранную группу П17. Расход ПД 9060 м³/ч; сумма двух выбранных установок РД: 3340 + 5720 = 9060 м³/ч. Снижение расхода не установлено; кратность воздухообмена не проверена.</>}
        {" "}Тождество объекта и применимость редакций требуют подтверждения.{parameter && " Стадия страниц смешанного РД/ИД отдельно не подтверждена."}</p>
      {parameter && <details><summary>Исходные цитаты и способ извлечения</summary><ul>{parameter.citations.map((citation, index) => <li key={index}>
        {citation.sourceFileId} · PDF {citation.page} · {citation.kind === "OCR" ? "OCR, не проверено человеком" : "текстовый слой"}
        <blockquote>{citation.rawText}</blockquote></li>)}</ul></details>}
      <DocumentPairWorkspace objectId={objectId} checkId={checkId} files={files} sources={parameter?.sources ?? pair!.sources}
        title={parameter ? `${parameter.label} · ПД / РД` : `Помещение ${pair!.roomId} · ПД / РД`} />
    </> : <>
      <p>Выберите документы для просмотра. Для известных исходных PDF F0171/F0201 здесь появятся пары помещений 147 и 198 после проверки SHA-256.</p>
      <DocumentPairWorkspace objectId={objectId} checkId={checkId} files={files} sources={[]} />
    </>}
  </section>;
}
export function RealDocumentPairs({ objectId, checkId }: { objectId: string; checkId?: string }) {
  const [files, setFiles] = useState<SourceFileSummary[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true; setFiles(null); setError("");
    void api.listSourceFiles(objectId).then(result => { if (active) setFiles(result.items); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [objectId, checkId]);
  return error ? <p role="alert">Не удалось загрузить документы для сравнения: {error}</p>
    : files ? <RealDocumentPairsPanel key={`${objectId}:${checkId}`} objectId={objectId} checkId={checkId} files={files} />
      : <p role="status">Готовим документы для сравнения…</p>;
}
