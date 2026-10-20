import { useEffect, useRef, useState } from "react";
import type { DocumentCoordinatePageFrame } from "@inspector-ai/contracts";
import { InspectorEvidenceViewer, type InspectorEvidenceViewerProps } from "./InspectorEvidenceViewer";
import { loadSourceText, type SourceTextIdentity } from "./source-text-explorer";
import { buildDocumentCoordinateReferenceNotes, type DocumentCoordinateReferenceRead } from "./document-coordinate-reference-notes";
import { DocumentCoordinateReferenceNotes } from "./DocumentCoordinateReferenceNotes";

export interface DocumentCoordinateReferenceWorkspaceProps {
  identity: SourceTextIdentity; frame: DocumentCoordinatePageFrame; disabled?: boolean;
}
/** Capture the expected authenticated identity before awaiting. The text index
 * cannot establish PDF rotation or frame hash independently. */
export async function loadDocumentCoordinateReferenceNotes(identity: SourceTextIdentity, frame: DocumentCoordinatePageFrame,
  signal: AbortSignal): Promise<DocumentCoordinateReferenceRead> {
  signal.throwIfAborted();
  const expected = structuredClone(identity), expectedFrame = structuredClone(frame);
  const index = await loadSourceText(expected, signal);
  signal.throwIfAborted();
  const result = buildDocumentCoordinateReferenceNotes(index, expected, expectedFrame);
  signal.throwIfAborted();
  return result;
}
export function DocumentCoordinateReferenceWorkspace(props: DocumentCoordinateReferenceWorkspaceProps) {
  return <ReferenceWorkspace key={JSON.stringify([props.identity.objectId, props.identity.checkId,
    props.identity.file.id, props.identity.file.sha256, props.identity.reviewHash, props.frame])} {...props} />;
}
function ReferenceWorkspace({ identity, frame, disabled }: DocumentCoordinateReferenceWorkspaceProps) {
  const [value, setValue] = useState<DocumentCoordinateReferenceRead | null>(null);
  const [selected, setSelected] = useState<NonNullable<InspectorEvidenceViewerProps["evidence"]> | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    if (disabled) { generation.current++; request.current?.abort(); setBusy(false); setValue(null); setSelected(null); setError(""); }
  }, [disabled]);
  async function load() {
    if (disabled || busy) return;
    const current = ++generation.current; request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setValue(null); setSelected(null); setError("");
    try {
      const next = await loadDocumentCoordinateReferenceNotes(identity, frame, controller.signal);
      if (current === generation.current && !controller.signal.aborted) setValue(next);
    } catch (cause) {
      if (current === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (current === generation.current) setBusy(false); }
  }
  return <section aria-label="Заметки выбранной исходной страницы" style={{ minWidth: 0, overflowWrap: "anywhere", marginBlock: 16 }}>
    <p>Исходный лист PDF {frame.pdfPageNumber}. Заметки загружаются отдельно; поля ручного расчёта не заполняются.</p>
    <button type="button" className="button button--secondary" disabled={disabled || busy} onClick={() => void load()}>
      {busy ? "Загружаем заметки…" : "Загрузить заметки исходного листа"}</button>
    {error && <p role="alert">{error}</p>}
    {!disabled && value && <DocumentCoordinateReferenceNotes value={value} onOpenEvidence={evidence => setSelected(evidence)} />}
    {!disabled && value && selected && <InspectorEvidenceViewer objectId={identity.objectId} file={identity.file}
      evidence={selected} stage={value.origin.stage} onOpened={() => {}} />}
  </section>;
}
