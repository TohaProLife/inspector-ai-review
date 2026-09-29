import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type ColorMode = "system" | "light" | "dark";

export const colorModeStorageKey = "inspector-ai-color-mode";
const explicitColorModeStorageKey = "inspector-ai-color-mode-chosen";

export function readColorMode(): ColorMode {
  try {
    const saved = window.localStorage.getItem(colorModeStorageKey);
    if (saved === "light" || saved === "dark") return saved;
    // Older releases wrote "system" on mount, including when no theme was chosen.
    if (saved === "system" && window.localStorage.getItem(explicitColorModeStorageKey) === "true") return saved;
  } catch { /* A blocked storage API must not prevent rendering. */ }
  return "light";
}

export function resolveColorMode(mode: ColorMode, systemDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

/** CSS interpolates live colors; state and hit testing never wait for a snapshot. */
export function createColorModeMotion() {
  let revision = 0;
  let timer: number | undefined;
  let detachEnvironment = () => {};
  const cancel = () => {
    revision++;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    detachEnvironment();
    detachEnvironment = () => {};
    delete document.documentElement.dataset.colorTransition;
  };
  const run = (update: () => void, animate = true) => {
    cancel();
    const ticket = revision;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!animate || preference?.matches || document.hidden) {
      update();
      return;
    }
    document.documentElement.dataset.colorTransition = "true";
    try { update(); } catch (error) { cancel(); throw error; }
    const onEnvironmentChange = () => { if (document.hidden || preference?.matches) cancel(); };
    preference?.addEventListener?.("change", onEnvironmentChange);
    document.addEventListener("visibilitychange", onEnvironmentChange);
    detachEnvironment = () => {
      preference?.removeEventListener?.("change", onEnvironmentChange);
      document.removeEventListener("visibilitychange", onEnvironmentChange);
    };
    // This timeout only removes presentation rules. The chosen mode is already applied.
    timer = window.setTimeout(() => { if (revision === ticket) cancel(); }, 220);
  };
  return { run, cancel };
}

function applyColorMode(mode: ColorMode, systemDark: boolean) {
  const resolved = resolveColorMode(mode, systemDark);
  document.documentElement.dataset.colorMode = mode;
  document.documentElement.dataset.colorResolved = resolved;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f8faff" : "#0e0d0b");
  try { window.localStorage.setItem(colorModeStorageKey, mode); } catch { /* Rendering still works without storage. */ }
}

export function useColorMode() {
  const [mode, updateMode] = useState<ColorMode>(readColorMode);
  const requested = useRef(mode);
  const motion = useRef<ReturnType<typeof createColorModeMotion> | null>(null);
  if (!motion.current) motion.current = createColorModeMotion();
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    // Initial paint and operating-system updates stay immediate.
    applyColorMode(requested.current, media?.matches ?? false);
    const syncSystem = () => {
      const next = requested.current;
      if (document.documentElement.dataset.colorResolved === resolveColorMode(next, media?.matches ?? false) && document.documentElement.dataset.colorMode === next) return;
      motion.current!.run(() => {
        applyColorMode(next, media?.matches ?? false);
        updateMode(next);
      }, false);
    };
    media?.addEventListener?.("change", syncSystem);
    return () => { media?.removeEventListener?.("change", syncSystem); motion.current?.cancel(); };
  }, []);
  const setMode = useCallback((next: ColorMode) => {
    if (requested.current === next) return;
    requested.current = next;
    try { window.localStorage.setItem(explicitColorModeStorageKey, "true"); } catch { /* The choice still works for this session. */ }
    const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const changesPalette = document.documentElement.dataset.colorResolved !== resolveColorMode(next, systemDark);
    motion.current!.run(() => {
      applyColorMode(next, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
      flushSync(() => updateMode(next));
    }, changesPalette);
  }, []);
  return [mode, setMode] as const;
}
