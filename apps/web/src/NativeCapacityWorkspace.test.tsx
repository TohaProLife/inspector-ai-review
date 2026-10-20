import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeCapacityQuote } from "@inspector-ai/contracts";
import { capacityQuoteEvidence, NativeCapacityWorkspace } from "./NativeCapacityWorkspace";
import { api } from "./api";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const quote: NativeCapacityQuote = { sourceFileId: "FIL-PD", sourceSha256: "a".repeat(64), physicalPage: 3, inputRole: "PD",
  pageWidthMilliPoints: 600000, pageHeightMilliPoints: 800000, bboxMilliPoints: [60000, 600000, 300000, 640000],
  coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", rawText: "Школа на 600 мест\n", unit: "мест",
  textArtifactContentHash: "b".repeat(64), evidenceKind: "NATIVE", sourcePath: [0, 1],
  nativeBoxPointStrings: ["60", "600", "300", "640"], matchedRangeCodePoints: [0, 17],
  rawValue: "600", value: "600", renderedVisibility: "UNVERIFIED", extractionMethod: "NATIVE_SINGLE_LINE_TITLE" };
it("maps bottom-left native coordinates to exact top-left viewer frame while preserving raw text", () => {
  expect(capacityQuoteEvidence(quote, 1)).toMatchObject({ id: "capacity-PD-1", pageNumber: 3,
    sourceFileId: "FIL-PD", sourceSha256: "a".repeat(64), bbox: [0.1, 0.19999999999999996, 0.5, 0.25], value: quote.rawText });
});
it.each([{ pageWidthMilliPoints: 0 }, { bboxMilliPoints: [0, 0, 700000, 10] }, { physicalPage: 0 }, { sourceSha256: "bad" }, { coordinateSystem: "OTHER" }])("does not overlay malformed or unbound geometry %j", patch => {
  expect(capacityQuoteEvidence({ ...quote, ...patch } as NativeCapacityQuote, 0)).toBeNull();
});
it("opens source computation explicitly; initial render starts no computation or history read", () => {
  const read = vi.spyOn(api, "listNativeCapacityComparisons"), compare = vi.spyOn(api, "compareNativeCapacity");
  const html = renderToStaticMarkup(<NativeCapacityWorkspace objectId="OBJ" checkId="CHK" />);
  expect(html).toContain("Открыть сверку вместимости ПД/РД"); expect(html).toContain("OCR и инженерная квалификация");
  expect(read).not.toHaveBeenCalled(); expect(compare).not.toHaveBeenCalled();
});
it("uses scoped authenticated routes and command idempotency headers", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "REC" }), { status: 201, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  await api.listNativeCapacityComparisons("CHK/escape");
  expect(fetch.mock.calls[0][0]).toBe("/api/checks/CHK%2Fescape/native-capacity-comparisons");
  await api.compareNativeCapacity("CHK", { schemaVersion: "native-capacity-command-v1", pdSourceFileId: "PD", rdSourceFileId: "RD" });
  expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: "include", method: "POST" });
  expect((fetch.mock.calls[1][1].headers as Headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/u);
});
