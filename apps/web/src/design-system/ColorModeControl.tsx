import type { ColorMode } from "./colorMode";

const choices = [
  { mode: "system", label: "Как в системе", glyph: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></> },
  { mode: "light", label: "Светлая тема", glyph: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></> },
  { mode: "dark", label: "Тёмная тема", glyph: <path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.6 8.6 0 1 0 20.2 15.3Z" /> },
] as const;

export function ColorModeControl({ mode, onChange, className = "" }: { mode: ColorMode; onChange: (mode: ColorMode) => void; className?: string }) {
  return <div className={`color-mode-control ${className}`.trim()} role="group" aria-label="Цветовая тема">
    {choices.map(choice => <button
      key={choice.mode}
      type="button"
      className={mode === choice.mode ? "is-selected" : ""}
      aria-label={choice.label}
      aria-pressed={mode === choice.mode}
      title={choice.label}
      onClick={() => onChange(choice.mode)}
    ><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{choice.glyph}</svg></button>)}
  </div>;
}
