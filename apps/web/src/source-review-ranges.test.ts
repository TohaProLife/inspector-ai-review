import { describe, expect, it } from "vitest";
import { formatPageStageRanges, parsePageStageRanges } from "./source-review-ranges";

describe("mixed source page stages", () => {
  it("expands a complete range and can display a saved decision", () => {
    const stages = parsePageStageRanges("1-3=RD, 4-5=ID", ["RD", "ID"], 5);
    expect(stages).toEqual({ "1": "RD", "2": "RD", "3": "RD", "4": "ID", "5": "ID" });
    expect(formatPageStageRanges(stages)).toBe("1-3=RD, 4-5=ID");
  });

  it("rejects gaps, overlaps, out-of-file pages and unsupported stages", () => {
    expect(() => parsePageStageRanges("1-3=RD", ["RD", "ID"], 5)).toThrow(/каждой страницы/);
    expect(() => parsePageStageRanges("1-3=RD, 3-5=ID", ["RD", "ID"], 5)).toThrow(/дважды/);
    expect(() => parsePageStageRanges("1-6=RD", ["RD", "ID"], 5)).toThrow(/вне/);
    expect(() => parsePageStageRanges("1-5=PD", ["RD", "ID"], 5)).toThrow(/вне/);
  });

  it("keeps unconfirmed pages explicit without assigning them to RD or ID", () => {
    const stages = parsePageStageRanges("1-2=RD, 3-5=UNRESOLVED", ["RD", "ID"], 5);
    expect(stages).toEqual({ "1": "RD", "2": "RD", "3": "UNRESOLVED", "4": "UNRESOLVED", "5": "UNRESOLVED" });
    expect(formatPageStageRanges(stages)).toBe("1-2=RD, 3-5=UNRESOLVED");
  });

  it("keeps a one-page RD drawing with an execution mark unresolved", () => {
    const stages = parsePageStageRanges("1=UNRESOLVED", ["RD", "ID"], 1);
    expect(stages).toEqual({ "1": "UNRESOLVED" });
    expect(formatPageStageRanges(stages)).toBe("1=UNRESOLVED");
  });
});
