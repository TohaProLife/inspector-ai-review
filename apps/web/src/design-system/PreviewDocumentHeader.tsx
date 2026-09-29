import type { EvidenceRef } from "@inspector-ai/contracts";

export function PreviewDocumentHeader({ source }: { source: Pick<EvidenceRef, "stage" | "documentSheetNumber" | "imageUrl"> }) {
  const stage = source.stage === "PD" ? "ПД" : source.stage === "RD" ? "РД" : "ИД";
  return <header className="preview-document__header">
    <div className="preview-document__identity">
      <strong>{stage}</strong>
      <span>{source.documentSheetNumber == null ? "Лист не указан" : `Лист ${source.documentSheetNumber}`}</span>
    </div>
    {source.imageUrl && <a className="preview-document__open" href={source.imageUrl} target="_blank" rel="noreferrer" aria-label={`Открыть лист ${stage} в новой вкладке`}>Открыть лист</a>}
  </header>;
}
