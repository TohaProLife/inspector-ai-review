import { useState, type CSSProperties } from "react";
import { FileText } from "./icons";

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
  return props.src ? <AvailableSourceImage key={props.src} {...props} src={props.src} /> : <SourceImageState status="missing" description={props.alt} />;
}
