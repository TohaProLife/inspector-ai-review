import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeAirflowQuote } from "@inspector-ai/contracts";
import { airflowQuoteEvidence, NativeAirflowWorkspace, parseAirflowSystemSelection } from "./NativeAirflowWorkspace";
import { api } from "./api";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const quote: NativeAirflowQuote = { sourceFileId: "FIL-PD", sourceSha256: "a".repeat(64), physicalPage: 3, inputRole: "PD",
  pageWidthMilliPoints: 600000, pageHeightMilliPoints: 800000, bboxMilliPoints: [60000, 600000, 300000, 640000],
  coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", rawText: "П17 (L=9060 м3/ч, Pc=350 Па)\n", unit: "м³/ч",
  textArtifactContentHash: "b".repeat(64), evidenceKind: "NATIVE", sourcePath: [0, 1],
  nativeBoxPointStrings: ["60", "600", "300", "640"], matchedRangeCodePoints: [0, 17],
  systemId: "П17", rawValue: "9060", value: "9060", rawUnit: "м3/ч", freePressurePa: "350", rawPressureUnit: "Па", nativeFrame: {coordinateSystem: "PDFMINER_LAYOUT_POINTS", visibleBoxPointStrings: ["0", "0", "600", "800"]}, renderedVisibility: "UNVERIFIED", extractionMethod: "NATIVE_SINGLE_LINE_SYSTEM_AIRFLOW" };
it("maps bottom-left native coordinates to exact top-left viewer frame while preserving raw text", () => {
  expect(airflowQuoteEvidence(quote, 1)).toMatchObject({ id: "airflow-PD-1", pageNumber: 3,
    sourceFileId: "FIL-PD", sourceSha256: "a".repeat(64), bbox: [0.1, 0.19999999999999996, 0.5, 0.25], value: quote.rawText });
});
it.each([{ pageWidthMilliPoints: 0 }, { bboxMilliPoints: [0, 0, 700000, 10] }, { physicalPage: 0 }, { sourceSha256: "bad" }, { coordinateSystem: "OTHER" }])("does not overlay malformed or unbound geometry %j", patch => {
  expect(airflowQuoteEvidence({ ...quote, ...patch } as NativeAirflowQuote, 0)).toBeNull();
});
it("opens source computation explicitly; initial render starts no computation or history read", () => {
  const read = vi.spyOn(api, "listNativeAirflowComparisons"), compare = vi.spyOn(api, "compareNativeAirflow");
  const html = renderToStaticMarkup(<NativeAirflowWorkspace objectId="OBJ" checkId="CHK" />);
  expect(html).toContain("Открыть сверку расходов вентиляции ПД/РД"); expect(html).toContain("OCR и инженерная квалификация");
  expect(read).not.toHaveBeenCalled(); expect(compare).not.toHaveBeenCalled();
});
it("uses scoped authenticated routes and command idempotency headers", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "REC" }), { status: 201, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  await api.listNativeAirflowComparisons("CHK/escape");
  expect(fetch.mock.calls[0][0]).toBe("/api/checks/CHK%2Fescape/native-airflow-comparisons");
  await api.compareNativeAirflow("CHK", { schemaVersion: "native-airflow-command-v1", pdSourceFileId: "PD", rdSourceFileId: "RD", selection: {pdSystemId: "П17", rdSystemIds: ["П17.1", "П17.2"]} });
  expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: "include", method: "POST" });
  expect((fetch.mock.calls[1][1].headers as Headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/u);
});

it("accepts explicit Cyrillic distinct groups and rejects ambiguous member lists", () => {
  expect(parseAirflowSystemSelection(" П17 ", "П17.1, П17.2")).toEqual({pdSystemId: "П17", rdSystemIds: ["П17.1", "П17.2"]});
  for(const [pd,rd] of [["P17","П17.1"],["П17",""],["П17","П17.1,П17.1"],["П17","П17.0"],["П17","П17.1/П17.2"]])
    expect(parseAirflowSystemSelection(pd!,rd!)).toBeNull();
});
