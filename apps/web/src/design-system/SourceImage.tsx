import { useEffect, useState, type CSSProperties } from "react";
import { FileText } from "./icons";
import { loadSourcePreview } from "../source-preview-loader";

export type SourceImageStatus = "loading" | "missing" | "error";

/** The same source states are used by the document viewer and component reference. */
export function SourceImageState({ status, description, onRetry }: {
  status: SourceImageStatus; description: string; onRetry?: () => void;
}) {
  if (status === "loading") return <div className="source-image-loading" data-source-state={status} role="status" aria-busy="true" aria-label={`Загрузка: ${description}`}><FileText size={24} aria-hidden="true" /><span>Загружаем лист…</span></div>;
  return <div className="source-image-empty" data-source-state={status} role="status" aria-label={description}><FileText size={24} aria-hidden="true" /><strong>Изображение недоступно</strong><span>{status === "error" ? "Не удалось загрузить лист. Проверьте подключение и повторите попытку." : "Для этого источника нет изображения страницы."}</span>{status === "error" && onRetry && <button type="button" className="button button--secondary" onClick={onRetry}>Повторить загрузку</button>}</div>;
}

type SourceImageProps = {
  src: string | null; alt: string; style?: CSSProperties; loading?: "eager" | "lazy";
  onLoad?: () => void; onError?: () => void;
};

function AvailableSourceImage({ src, alt, style, loading = "lazy", onLoad, onError }: SourceImageProps & { src: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  if (status === "error") return <SourceImageState status="error" description={alt} onRetry={() => { setStatus("loading"); setAttempt(value => value + 1); }} />;
  const pending = status === "loading";
  return <>
    {pending && <SourceImageState status="loading" description={alt} />}
    <img key={attempt} className="document-source-image" src={src} alt={alt} aria-busy={pending || undefined} style={{ ...style, ...(pending ? { opacity: 0 } : {}) }} loading={loading} decoding="async" onLoad={event => {
      const image = event.currentTarget;
      const reveal = () => { setStatus("loaded"); onLoad?.(); };
      if (typeof image.decode === "function") void image.decode().then(reveal, reveal);
      else reveal();
    }} onError={() => { setStatus("error"); onError?.(); }} />
  </>;
}

/** Changing the URL resets its request state, including returning to a failed URL. */
export function SourceImage(props: SourceImageProps) {
  // Native <img> preview requests also consume the server's render slots. Put
  // landing/source thumbnails through the same queue as the paired viewer.
  if (props.src && /^\/api\/objects\/[^/?#]+\/files\/[^/?#]+\/pages\/[1-9]\d*\/preview(?:\?[^#]*)?$/u.test(props.src)) {
    return <ScheduledSourceImage key={props.src} {...props} src={props.src} />;
  }
  return props.src ? <AvailableSourceImage key={props.src} {...props} src={props.src} /> : <SourceImageState status="missing" description={props.alt} />;
}
function ScheduledSourceImage(props: SourceImageProps & { src: string }) {
  const [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let objectUrl: string | null = null;
    setUrl(null); setFailed(false);
    void loadSourcePreview(props.src, abort.signal).then(blob => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!abort.signal.aborted) { setFailed(true); props.onError?.(); } });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [props.src, retry]);
  return url ? <AvailableSourceImage {...props} src={url} /> : <SourceImageState status={failed ? "error" : "loading"}
    description={props.alt} onRetry={() => setRetry(value => value + 1)} />;
}
