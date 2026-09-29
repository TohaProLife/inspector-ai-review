import { useId, useState } from "react";
import { ChevronDown } from "./icons";

/** Mounted content lets CSS reverse a disclosure from its current position. */
export function FaqItem({ question, answer, defaultOpen = false }: { question: string; answer: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <div className="faq-item" data-open={open} data-reveal>
    <h3><button className="faq-trigger" type="button" id={`${id}-question`} aria-expanded={open} aria-controls={`${id}-answer`} onClick={() => setOpen(value => !value)}>
      <span>{question}</span><ChevronDown size={18} aria-hidden="true" />
    </button></h3>
    <div className="faq-answer" id={`${id}-answer`} role="region" aria-labelledby={`${id}-question`} aria-hidden={!open} inert={!open}>
      <div className="faq-answer__clip"><p>{answer}</p></div>
    </div>
  </div>;
}
