import { useEffect, useState } from "react";
import type { Finding, SourceFileSummary } from "@inspector-ai/contracts";
import { api } from "./api";
import { DocumentPairWorkspace } from "./DocumentPairWorkspace";
import type { DocumentEvidence } from "./document-pair-navigation";

/** Preserve source hashes and frames; displayed values are the saved finding's values. */
export function findingDocumentEvidence(finding: Finding): DocumentEvidence[] {
  return finding.evidence.map((source, index) => ({
    id: `${finding.id}:${index}`, stage: source.stage === "PD" || source.stage === "RD" || source.stage === "ID" ? source.stage : "UNRESOLVED",
    sourceFileId: source.fileId, sourceSha256: source.sha256,
    pageNumber: source.pdfPageNumber, sheet: source.documentSheetNumber === null ? null : String(source.documentSheetNumber),
    revision: null, element: finding.location, bbox: source.bbox, unit: null,
    value: (source.stage === "PD" ? finding.expectedValue : source.stage === "RD" ? finding.actualValue : source.stage === "ID" ? finding.idValue : null) ?? "",
  }));
}

export function FindingDocumentPair({ objectId, finding }: { objectId: string; finding: Finding }) {
  const [files, setFiles] = useState<SourceFileSummary[] | null>(null), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setFiles(null); setError("");
    void api.listSourceFiles(objectId).then(result => { if (active) setFiles(result.items); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [objectId, refresh]);
  const sources = findingDocumentEvidence(finding);
  const stages = ["PD", "RD", "ID"].filter(stage => sources.some(source => source.stage === stage));
  return error ? <p role="alert">Не удалось открыть исходники: {error}{" "}
    <button type="button" onClick={() => setRefresh(value => value + 1)}>Повторить</button></p>
    : files ? <DocumentPairWorkspace objectId={objectId} checkId={finding.checkId} files={files} sources={sources}
      stages={stages.length >= 2 ? stages : ["PD", "RD"]} title="Исходники замечания" />
      : <p role="status">Загружаем исходные документы…</p>;
}
