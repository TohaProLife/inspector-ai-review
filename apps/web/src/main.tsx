import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/onest";
import "@fontsource-variable/source-serif-4";
import { App } from "./App";
import { readColorMode, resolveColorMode } from "./design-system/colorMode";
import "./styles.css";
import "./design-system/tokens.css";
import "./design-system/components.css";
import "./workspace.css";
import "./design-system/icons.css";
import "./landing.css";
import "./color-mode.css";
import "./themes.css";
import "./design-system/motion.css";
import "./design-system/navigation.css";
import "./design-system/workspace-adapter.css";

const initialMode = readColorMode();
document.documentElement.dataset.colorMode = initialMode;
document.documentElement.dataset.colorResolved = resolveColorMode(initialMode,
  window.matchMedia("(prefers-color-scheme: dark)").matches);
document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content",
  document.documentElement.dataset.colorResolved === "light" ? "#f8faff" : "#0e0d0b");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
