import { useEffect, type RefObject } from "react";

/** Decorative motion runs only while it is visible and the user's motion preference permits it. */
export function observeAmbientMotion(root: HTMLElement) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-ambient]"));
  if (!elements.length || !window.IntersectionObserver || !window.matchMedia) return () => undefined;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const visible = new Set<Element>();
  let disposed = false;
  const update = () => {
    if (disposed) return;
    elements.forEach(element => {
      element.dataset.motionActive = String(!preference.matches && !document.hidden && visible.has(element));
    });
  };
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
    update();
  });
  const syncObservation = () => {
    if (disposed) return;
    observer.disconnect();
    visible.clear();
    update();
    if (!preference.matches && !document.hidden) elements.forEach(element => observer.observe(element));
  };
  syncObservation();
  document.addEventListener("visibilitychange", syncObservation);
  preference.addEventListener("change", syncObservation);
  return () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener("visibilitychange", syncObservation);
    preference.removeEventListener("change", syncObservation);
    elements.forEach(element => { delete element.dataset.motionActive; });
  };
}

export function useAmbientMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => root.current ? observeAmbientMotion(root.current) : undefined, [root]);
}
