import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import type { ProtocolVersion } from "@inspector-ai/contracts";
import { api } from "./api";

export function ProtocolDownloads({ protocol, compact = false }: { protocol: ProtocolVersion; compact?: boolean }) {
  const [busy, setBusy] = useState<"pdf" | "docx" | "xml" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, [protocol.id]);
  const download = async (format: "pdf" | "docx" | "xml") => {
    if (busy) return;
    const requestController = new AbortController(); controller.current = requestController;
    setBusy(format); setError(null); setMessage(null);
    try {
      const { blob } = await api.downloadProtocolArtifact(protocol.id, format, AbortSignal.any([requestController.signal, AbortSignal.timeout(120000)]));
      if (!mounted.current || requestController.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `protocol-${protocol.id.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 160)}-v${protocol.version}.${format}`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`${format.toUpperCase()} версии ${protocol.version} подготовлен для скачивания.`);
    } catch (caught) {
      if (mounted.current && !requestController.signal.aborted) setError(caught instanceof Error ? caught.message : "Не удалось скачать протокол.");
    } finally { if (mounted.current) setBusy(null); }
  };
  return <div className={`protocol-downloads${compact ? " protocol-downloads--compact" : ""}`} aria-label={`Экспорт протокола версии ${protocol.version}`}>
    {!compact && <p>Скачать сохранённую версию {protocol.version}{protocol.status === "DRAFT" ? " · черновик" : ""}{protocol.validity === "REVOKED" ? " · отозвана" : ""}</p>}
    <div className="protocol-downloads__formats">
      {(["pdf", "docx", "xml"] as const).map(format => <button key={format} type="button" className="button button--secondary protocol-downloads__format" disabled={Boolean(busy)}
        onClick={() => { void download(format); }} aria-label={`Скачать ${format.toUpperCase()} версии ${protocol.version}`}>
        {busy === format ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{format.toUpperCase()}
      </button>)}
      <a className="button button--secondary protocol-downloads__format" href={api.exportUrl(protocol.id)} aria-label={`Скачать JSON версии ${protocol.version}`}><Download size={14} />JSON</a>
    </div>
    {error && <p className="protocol-downloads__error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!compact && <small>Данные этой версии сохраняются при новых решениях. Электронная подпись не сформирована.</small>}
    {!compact && protocol.status === "FINAL" && protocol.validity === "VALID" && <a href={api.iaisPullUrl(protocol.id)} target="_blank" rel="noopener noreferrer">Пакет для тестового обмена с ИАИС</a>}
  </div>;
}
