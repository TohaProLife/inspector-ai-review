import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INVENTORY_REVIEW_LIMITS } from "@inspector-ai/contracts";
import { assertInventoryReviewNative } from "../src/matrix-inventory-review.js";
import { assertSourceTextNative, SOURCE_TEXT_READ_LIMITS } from "../src/source-text-native.js";

const original = JSON.parse(readFileSync(new URL("../../../services/worker/tests/fixtures/rebar-F0106-F0139.json", import.meta.url), "utf8"));
describe("full source text has a separate read budget", () => {
  it("reads all139 original F0106 pages without widening the review envelope", () => {
    const artifact = original.sources.find((s: any) => s.source.file_id === "F0106").sourceArtifact;
    expect(artifact.pageCount).toBe(139);
    expect(artifact.pages[52].blocks[0].text.split("\n")[0]).toBe("Отметка нуля принята на абсолютной отметке +159.950.");
    const before = JSON.stringify(artifact);
    expect(() => assertInventoryReviewNative(artifact, "MATERIALIZED")).toThrow(/limits/u);
    expect(() => assertSourceTextNative(artifact)).not.toThrow();
    expect(JSON.stringify(artifact)).toBe(before);
    expect(INVENTORY_REVIEW_LIMITS.nodes).toBe(200000);
    expect(INVENTORY_REVIEW_LIMITS.materializedBytes).toBe(8000000);
  });
  it("retains full22-page RD original, including geometry", () => {
    const artifact = original.sources.find((s: any) => s.source.file_id === "F0139").sourceArtifact;
    expect(artifact.pageCount).toBe(22);
    expect(() => assertSourceTextNative(artifact)).not.toThrow();
  });
  it("bounds total nodes even when bytes and each container fit", () => {
    const dense = Array.from({ length: 1000 }, () => Array(1000).fill(0));
    expect(Buffer.byteLength(JSON.stringify(dense))).toBeLessThan(SOURCE_TEXT_READ_LIMITS.bytes);
    expect(() => assertSourceTextNative(dense)).toThrow(/bounded/u);
  });
  it("counts escaped JSON bytes and fixed depth/container limits", () => {
    expect(() => assertSourceTextNative("a".repeat(7_999_998))).not.toThrow();
    expect(() => assertSourceTextNative("a".repeat(7_999_999))).toThrow(/bounded/u);
    expect(() => assertSourceTextNative("\u0000".repeat(1_400_000))).toThrow(/bounded/u);
    expect(() => assertSourceTextNative(Array(32769).fill(0))).toThrow(/bounded/u);
    let deep: any = {}; const root = deep; for (let i = 0; i < 66; i++) { deep.next = {}; deep = deep.next; }
    expect(() => assertSourceTextNative(root)).toThrow(/bounded/u);
  });
  it("rejects holes, extra fields, aliases with cycles, symbols and nonportable values", () => {
    const cycle: any = {}; cycle.self = cycle;
    const extra: any = [1]; extra.other = 2;
    for (const value of [Array(2), extra, cycle, { [Symbol("x")]: 1 }, Object.create(null), new Date(),
      { n: NaN }, { n: Infinity }, { n: 0.1 }, { n: Number.MAX_SAFE_INTEGER + 1 }, { s: "\ud800" }, { v: undefined }, { v: 1n }])
      expect(() => assertSourceTextNative(value)).toThrow();
    const shared = { n: 1 }; expect(() => assertSourceTextNative([shared, shared])).not.toThrow();
  });
  it("never executes getters, toJSON or proxy traps", () => {
    let calls = 0;
    const getter = Object.defineProperty({}, "rawText", { enumerable: true, get() { calls++; throw Error("getter"); } });
    const serializer = { toJSON() { calls++; throw Error("serializer"); } };
    const proxy = new Proxy({}, { ownKeys() { calls++; throw Error("proxy"); } });
    for (const value of [getter, serializer, proxy]) expect(() => assertSourceTextNative(value)).toThrow();
    expect(calls).toBe(0);
  });
});
