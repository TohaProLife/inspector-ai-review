import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareSteelCatalogExample, extractSteelCandidates, normalizeSteelCatalogGrade, STEEL_EXTRACTOR_VERSION } from "../src/matrix-steel-prose.js";

const root = new URL("../../../services/worker/tests/fixtures/matrix-steel-v1/", import.meta.url);
const rawGolden = readFileSync(new URL("research-parser-golden.json", root));
const golden = JSON.parse(rawGolden.toString("utf8"));
const sources = new Map<string, any>(golden.sources.map((s: any) => [s.sourceFileId, s.page]));
function apply(page: any, operations: any[]): any {
  const result = structuredClone(page);
  for (const op of operations) {
    if (op.op === "set") {
      let node = result;
      for (const key of op.path.slice(0, -1)) node = node[key];
      node[op.path.at(-1)] = structuredClone(op.value);
    } else if (op.op === "replaceText") {
      expect(result.blocks[op.blockIndex].text).toContain(op.old);
      result.blocks[op.blockIndex].text = result.blocks[op.blockIndex].text.replaceAll(op.old, op.new);
    } else if (op.op === "appendBlock") result.blocks.push(structuredClone(op.value));
    else if (op.op === "swapBlocks") {
      const [a, b] = op.indices;
      [result.blocks[a], result.blocks[b]] = [result.blocks[b], result.blocks[a]];
    } else throw new Error(`Unknown frozen operation: ${op.op}`);
  }
  return result;
}
describe("independent steel source grammar", () => {
  it("pins the pre-implementation research vector set", () => {
    expect(createHash("sha256").update(rawGolden).digest("hex")).toBe("60f159ae69d2cde527d84260cb4f8b225565744ede2a684617f0218b4ba43d78");
    expect(golden.cases).toHaveLength(143);
    expect(golden.cases.filter((c: any) => c.expected.length)).toHaveLength(19);
    expect(STEEL_EXTRACTOR_VERSION).toBe("matrix-steel-prose-v1");
  });
  for (const vector of golden.cases) it(vector.name, () => {
    const page = apply(sources.get(vector.sourceFileId), vector.operations), before = structuredClone(page);
    expect(extractSteelCandidates(page, vector.stage)).toEqual(vector.expected);
    expect(page).toEqual(before);
    expect(extractSteelCandidates(page, vector.stage)).toEqual(vector.expected);
  });
  for (const [i, vector] of golden.predicateCases.entries()) it(`bounded directed predicate ${i}`, () => {
    expect(compareSteelCatalogExample(vector.expected, vector.actual)).toBe(vector.result);
  });
  it("scans all 43 authentic pages without source/section relabeling", () => {
    const receipts = JSON.parse(readFileSync(new URL("research-extraction-receipts.json", root), "utf8"));
    const found: unknown[] = []; let pages = 0;
    for (const receipt of receipts) {
      const raw = readFileSync(new URL(receipt.artifactPath, root));
      expect(createHash("sha256").update(raw).digest("hex")).toBe(receipt.fullTextArtifactSha256);
      const artifact = JSON.parse(raw.toString("utf8")), before = structuredClone(artifact);
      expect(artifact.inputSha256).toBe(receipt.source.sha256);
      expect(artifact.pages).toHaveLength(receipt.source.pdf_pages);
      pages += artifact.pages.length;
      for (const page of artifact.pages) for (const item of extractSteelCandidates(page, receipt.source.stage)) {
        found.push([receipt.source.file_id, page.pageNumber, receipt.source.section, item.value]);
        expect(Object.keys(item)).not.toContain("probability");
      }
      expect(artifact).toEqual(before);
    }
    expect(pages).toBe(43);
    expect(found).toEqual([["F0105", 14, "KR", "С245"], ["F0145", 4, "OTHER", "С245"]]);
  });
  for (const [i, invalid] of ["С235", "С255", "С355", "С345С", "c345", " С345", "С345 ", "C345\u200b", "", null, true, 345, ["С345"], { value: "С345" }].entries()) {
    it(`rejects nonliteral grade alias ${i}`, () => {
      expect(normalizeSteelCatalogGrade(invalid)).toBeNull();
      expect(compareSteelCatalogExample(invalid, "С245")).toBeNull();
      expect(compareSteelCatalogExample("С345", invalid)).toBeNull();
    });
  }
  for (const [i, invalid] of [null, [], true, 1, "page", undefined, new Date()].entries()) {
    it(`rejects native page/stage shape ${i}`, () => {
      expect(extractSteelCandidates(invalid, "PD")).toEqual([]);
      expect(extractSteelCandidates(sources.get("F0105"), invalid)).toEqual([]);
    });
  }
  for (const [sid, stage, bi] of [["F0105", "PD", 30], ["F0145", "RD", 40]] as const) {
    for (const [i, invalid] of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, true].entries()) {
      it(`${sid} rejects native coordinate/page ${i}`, () => {
        const first = structuredClone(sources.get(sid)); first.pageNumber = invalid;
        expect(extractSteelCandidates(first, stage)).toEqual([]);
        const second = structuredClone(sources.get(sid)); second.blocks[bi].lineBboxesMilliPoints[0][0] = invalid;
        expect(extractSteelCandidates(second, stage)).toEqual([]);
      });
    }
    it(`${sid} rejects unpaired surrogates, accessors, hidden keys, sparse arrays and cyclic blocks`, () => {
      const page = () => structuredClone(sources.get(sid));
      const surrogate = page(); surrogate.blocks[bi].text += "\ud800";
      expect(extractSteelCandidates(surrogate, stage)).toEqual([]);
      let reads = 0;
      const accessor = page(); Object.defineProperty(accessor.blocks[bi], "text", { enumerable: true, get() { reads++; return "forged"; } });
      expect(extractSteelCandidates(accessor, stage)).toEqual([]); expect(reads).toBe(0);
      const hidden = page(); Object.defineProperty(hidden, "approved", { value: true });
      expect(extractSteelCandidates(hidden, stage)).toEqual([]);
      const sparse = page(); delete sparse.blocks[0];
      expect(extractSteelCandidates(sparse, stage)).toEqual([]);
      const cycle = page(); cycle.blocks.push(cycle);
      expect(extractSteelCandidates(cycle, stage)).toEqual([]);
      const symbol = page(); symbol.blocks[bi][Symbol("identity")] = true;
      expect(extractSteelCandidates(symbol, stage)).toEqual([]);
    });
  }
  it("keeps output geometry and product descriptions independent of inputs and other calls", () => {
    for (const [sid, stage] of [["F0105", "PD"], ["F0145", "RD"]]) {
      const page = structuredClone(sources.get(sid)), before = structuredClone(page);
      const first = extractSteelCandidates(page, stage), second = extractSteelCandidates(page, stage);
      (first[0].productScope as any).profile = "forged";
      for (const part of [...first[0].primaryFragments, ...first[0].scopeFragments]) part.bboxMilliPoints[0] = -1;
      expect(page).toEqual(before); expect(extractSteelCandidates(page, stage)).toEqual(second);
    }
  });
});
