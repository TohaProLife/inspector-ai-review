import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "./icons";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "inverted" | "accent";
  loading?: boolean;
};

export function Button({ variant = "primary", loading, children, className = "", disabled, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={`button button--${variant} ${className}`.trim()}>{loading && <LoaderCircle size={15} className="spin" />}{children}</button>;
}

export function Field({ label, hint, error, id, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptions = [describedBy, hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined;
  return <div className="ds-field"><label htmlFor={inputId}>{label}{props.required && <span aria-hidden="true"> *</span>}</label><input {...props} id={inputId} aria-invalid={error ? true : invalid ?? false} aria-describedby={descriptions} />{hint && <small id={`${inputId}-hint`}>{hint}</small>}{error && <small id={`${inputId}-error`} className="ds-field__error" role="alert">{error}</small>}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="ds-eyebrow"><i aria-hidden="true" />{children}</span>;
}

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <span className={`ds-brand ${inverse ? "ds-brand--inverse" : ""}`}><span className="ds-brand__mark" aria-hidden="true"><i /><i /><i /></span><span className="ds-brand__wordmark">инспектор<span className="ds-brand__ai">ии</span></span></span>;
}
