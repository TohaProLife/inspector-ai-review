import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("visual system guardrails", () => {
  it("keeps common AI-dashboard treatments out of the stylesheet", () => {
    expect(css).not.toMatch(/border-(?:left|right):\s*[2-9][0-9]*px/i);
    expect(css).not.toMatch(/background-clip:\s*text/i);
    expect(css).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/i);
  });

  it("keeps keyboard and reduced-motion affordances", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
