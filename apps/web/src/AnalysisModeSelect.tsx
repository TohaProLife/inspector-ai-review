import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, FileSearch, FileText } from "./design-system/icons";
import "./analysis-mode-select.css";

type AnalysisMode = "SAMPLE" | "FULL";

const modes = [
  { value: "SAMPLE", title: "Выборочная обработка", detail: "До двух областей каждого исходника", Icon: FileSearch },
  { value: "FULL", title: "Все подходящие области", detail: "Все подходящие области и страницы", Icon: FileText },
] as const;

export function AnalysisModeSelect({ value, onChange, disabled = false }: {
  value: AnalysisMode;
  onChange: (value: AnalysisMode) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: "", time: 0 });
  const selectedIndex = modes.findIndex((mode) => mode.value === value);
  const selected = modes[selectedIndex];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [placement, setPlacement] = useState<"above" | "below">("below");
  const expanded = open && !disabled;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  const show = (index = selectedIndex) => {
    if (disabled) return;
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      const below = window.innerHeight - bounds.bottom;
      setPlacement(below < (listRef.current?.offsetHeight ?? 180) + 12 && bounds.top > below ? "above" : "below");
    }
    searchRef.current = { text: "", time: 0 };
    setActiveIndex(index);
    setOpen(true);
  };

  const choose = (index: number) => {
    if (disabled) return;
    onChange(modes[index].value);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) show();
      else setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + modes.length) % modes.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const index = event.key === "Home" ? 0 : modes.length - 1;
      if (expanded) setActiveIndex(index);
      else show(index);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else show();
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key.length === 1) {
      const now = Date.now();
      const key = event.key.toLocaleLowerCase("ru");
      let text = now - searchRef.current.time < 500 ? searchRef.current.text + key : key;
      const startIndex = expanded ? activeIndex : selectedIndex;
      const find = (prefix: string) => modes.findIndex((_, offset) => {
        const index = (startIndex + offset + 1) % modes.length;
        return modes[index].title.toLocaleLowerCase("ru").startsWith(prefix);
      });
      let offset = find(text);
      if (offset < 0) { text = key; offset = find(text); }
      if (offset >= 0) {
        event.preventDefault();
        const index = (startIndex + offset + 1) % modes.length;
        if (expanded) setActiveIndex(index);
        else show(index);
      }
      searchRef.current = { text, time: now };
    }
  };

  return (
    <div className="analysis-mode-field">
      <span className="analysis-mode__label" id={`${id}-label`}>Режим визуального анализа</span>
      <div className="analysis-mode" ref={rootRef} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
        <button className="analysis-mode__trigger" type="button" role="combobox" ref={triggerRef}
          aria-labelledby={`${id}-label ${id}-value`} aria-describedby={`${id}-hint`}
          aria-haspopup="listbox" aria-controls={`${id}-list`} aria-expanded={expanded}
          aria-activedescendant={expanded ? `${id}-option-${activeIndex}` : undefined}
          disabled={disabled} onKeyDown={handleKeyDown} onClick={() => expanded ? setOpen(false) : show()}>
          <span className="analysis-mode__icon" aria-hidden="true"><selected.Icon size={21} /></span>
          <span className="analysis-mode__copy"><strong id={`${id}-value`}>{selected.title}</strong><span>{selected.detail}</span></span>
          <ChevronDown className="analysis-mode__chevron" size={18} aria-hidden="true" />
        </button>
        <div className="analysis-mode__list" ref={listRef} id={`${id}-list`} role="listbox"
          aria-labelledby={`${id}-label`} aria-hidden={!expanded} inert={!expanded}
          data-open={expanded} data-placement={placement}>
          {modes.map((mode, index) => (
            <div className="analysis-mode__option" key={mode.value} id={`${id}-option-${index}`}
              role="option" aria-selected={value === mode.value} data-active={index === activeIndex}
              onPointerMove={() => expanded && setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()} onClick={() => expanded && choose(index)}>
              <span className="analysis-mode__icon" aria-hidden="true"><mode.Icon size={21} /></span>
              <span className="analysis-mode__copy"><strong>{mode.title}</strong><span>{mode.detail}</span></span>
              <span className="analysis-mode__check" aria-hidden="true">{value === mode.value && <Check size={14} />}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="analysis-mode__hint" id={`${id}-hint`}>{value === "FULL"
        ? "Все подходящие области пройдут очередь локальной модели. Большой комплект потребует больше времени. Ошибки и ограничения сохраняются в отчёте."
        : "Модель рассмотрит до двух областей каждого исходника. Число пропусков будет указано; это не полная проверка."}</p>
    </div>
  );
}
