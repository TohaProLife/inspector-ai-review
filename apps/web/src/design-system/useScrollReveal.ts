import { useEffect, useRef } from "react";

export function revealElement(element: HTMLElement, delay = 0) {
  if (!element.animate) return null;
  try {
    return element.animate(
      [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }],
      { duration: 480, delay: Number.isFinite(delay) ? Math.max(0, Math.min(delay, 120)) : 0, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
    );
  } catch { return null; }
}

/** Progressive enhancement: content stays visible if motion or observers are unavailable. */
export function observeReveals(root: HTMLElement) {
  if (!window.matchMedia || !window.IntersectionObserver) return () => undefined;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const animations = new Set<Animation>();
  const pending = new Set(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  let disposed = false;
  const observer = new IntersectionObserver(entries => {
    if (disposed || document.hidden || preference.matches) return;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target as HTMLElement;
      if (preference.matches || !pending.has(element)) continue;
      observer.unobserve(element);
      pending.delete(element);
      if (element.contains(document.activeElement)) continue;
      const animation = revealElement(element, Number(element.dataset.revealDelay) || 0);
      if (!animation) continue;
      animations.add(animation);
      animation.onfinish = () => animations.delete(animation);
      animation.oncancel = () => animations.delete(animation);
    }
  }, { threshold: 0.08 });
  const cancelAnimations = () => {
    animations.forEach(animation => animation.cancel());
    animations.clear();
  };
  const onPreferenceChange = () => {
    if (disposed) return;
    if (preference.matches || document.hidden) { observer.disconnect(); cancelAnimations(); }
    else pending.forEach(element => observer.observe(element));
  };
  onPreferenceChange();
  // Keyboard interaction never waits for a reveal to finish.
  root.addEventListener("focusin", cancelAnimations);
  root.addEventListener("pointerdown", cancelAnimations, { passive: true });
  preference.addEventListener("change", onPreferenceChange);
  document.addEventListener("visibilitychange", onPreferenceChange);
  return () => {
    disposed = true;
    observer.disconnect();
    cancelAnimations();
    root.removeEventListener("focusin", cancelAnimations);
    root.removeEventListener("pointerdown", cancelAnimations);
    preference.removeEventListener("change", onPreferenceChange);
    document.removeEventListener("visibilitychange", onPreferenceChange);
  };
}

export function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current ? observeReveals(ref.current) : undefined, []);
  return ref;
}
