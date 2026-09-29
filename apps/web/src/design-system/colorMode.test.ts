import { afterEach, describe, expect, it, vi } from "vitest";
import { readColorMode } from "./colorMode";

afterEach(() => vi.unstubAllGlobals());

describe("initial color mode", () => {
  it("opens in light mode when no preference was saved", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    expect(readColorMode()).toBe("light");
  });

  it("keeps an explicit theme choice", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "dark" } });
    expect(readColorMode()).toBe("dark");
  });

  it("migrates the old automatically saved system default to light", () => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === "inspector-ai-color-mode" ? "system" : null } });
    expect(readColorMode()).toBe("light");
  });

  it("keeps system mode when the user chose it explicitly", () => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === "inspector-ai-color-mode" ? "system" : "true" } });
    expect(readColorMode()).toBe("system");
  });
});
