import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { documentCoordinateInputSha256, type DocumentCoordinatePageFrame } from "@inspector-ai/contracts";
import { parseDocumentCoordinateInput, previewDocumentCoordinates } from "../src/document-coordinate-preview.js";

// Authored before implementation; independent scalar calculation and original associations.
const golden = JSON.parse(readFileSync(new URL("../../../fixtures/document-coordinate-v1/real-coordinate-golden.json", import.meta.url), "utf8"));
const frame: DocumentCoordinatePageFrame = { sourceFileId: "FIL-real-pzu", sourceSha256: golden.provenance.sourceSha256, pdfPageNumber: 13,
  pageFrameSha256: "a".repeat(64), coordinateSpace: "CANONICAL_VISIBLE_NORMALIZED", visibleWidthPt: 1684,
  visibleHeightPt: 1191, rotate: 270, geometryPrecisionPt: 0.01 };
function input() {
  return { schemaVersion: "document-coordinate-preview-v1", checkId: "CHK-real-preview", sourceFrame: structuredClone(frame),
    target: { label: "МСК-50: надпись листа, описание СК не проверено", unit: "m", yAxis: "UP",
      minScale: 200, maxScale: 310, maxHoldoutResidual: 0.02 },
    points: golden.input.points.map((point: any) => ({ id: point.id, page: [...point.pageNormalized],
      printed: [...point.documentCoordinates], role: point.pointRole, reference: `PDF13, blue leader drawing ${point.drawingIndex}` })),
    queryPoints: [] as number[][] };
}
describe("printed-coordinate calculation is explicit stateless arithmetic only", () => {
  it("reproduces independent real holdout/normalized scales and keeps every authority unverified", () => {
    const value = input(), before = structuredClone(value);
    const result = previewDocumentCoordinates(value, frame);
    expect(value).toEqual(before);
    expect(result).toMatchObject({ status: "PREVIEW_ONLY", sourceFrame: frame,
      coordinateAuthority: "USER_DECLARED_UNVERIFIED", absoluteGeoreference: false,
      physicalPositionValidated: false, calibratedProbability: null, facts: [], result: { status: "CALCULATED" } });
    expect(result.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.result.status).toBe("CALCULATED");
    if (result.result.status !== "CALCULATED") throw Error("missing numerical result");
    const calculation = result.result.calibration;
    expect(calculation.fitResiduals.map(p => p.id)).toEqual(["LL", "LR", "UL"]);
    expect(calculation.holdoutResiduals.map(p => p.id)).toEqual(["UR"]);
    expect(calculation.maxHoldoutResidual).toBeCloseTo(golden.expected.holdoutResidualPrintedUnits, 9);
    calculation.holdoutResiduals[0].predicted.forEach((x, i) => expect(x).toBeCloseTo(golden.expected.predictedHoldoutXY[i], 8));
    calculation.scaleRangeProjectUnitsPerNormalizedPageUnit.forEach((x, i) =>
      expect(x).toBeCloseTo(golden.expected.normalizedScaleRangePrintedUnitsPerNormalizedPageUnit[i], 8));
    expect(calculation.supportedDomain).toHaveLength(4);
    expect(calculation.declaredTolerance).toBe(0.02);
    expect(calculation.maxRoundtripPageUnits).toBeLessThan(1e-8);
    expect(previewDocumentCoordinates(value, frame)).toEqual(result);
    // Explicit unit hypothesis is not independently confirmed by a successful calculation.
    value.target.unit = "cm";
    expect(previewDocumentCoordinates(value, frame).coordinateAuthority).toBe("USER_DECLARED_UNVERIFIED");
  });
  it.each(["sourceFileId", "sourceSha256", "pageFrameSha256", "pdfPageNumber", "rotate", "visibleWidthPt", "visibleHeightPt", "geometryPrecisionPt"])(
    "rejects supplied frame mismatch in %s without replacing it", key => {
      const value = input(); const selected = value.sourceFrame as Record<string, unknown>;
      selected[key] = typeof selected[key] === "number" ? (selected[key] as number) + (key === "rotate" ? -90 : 1)
        : key === "sourceFileId" ? "FIL-other" : "b".repeat(64);
      expect(previewDocumentCoordinates(value, frame)).toMatchObject({ status: "PREVIEW_ONLY", sourceFrame: frame,
        result: { status: "ABSTAIN", reasonCode: "PAGE_FRAME_MISMATCH" }, facts: [], calibratedProbability: null });
    });
  it.each([
    ["no holdout", (v: ReturnType<typeof input>) => { v.points[3].role = "FIT"; }],
    ["two FIT", (v: ReturnType<typeof input>) => { v.points[2].role = "HOLDOUT"; }],
    ["duplicate id", (v: ReturnType<typeof input>) => { v.points[1].id = v.points[0].id; }],
    ["duplicate page", (v: ReturnType<typeof input>) => { v.points[1].page = [...v.points[0].page]; }],
    ["duplicate printed", (v: ReturnType<typeof input>) => { v.points[1].printed = [...v.points[0].printed]; }],
    ["collinear", (v: ReturnType<typeof input>) => { v.points[0].page = [0, 0]; v.points[1].page = [.25, .25]; v.points[2].page = [.5, .5]; }],
    ["wrong handedness", (v: ReturnType<typeof input>) => { v.target.yAxis = "DOWN"; }],
    ["point units applied to normalized frame", (v: ReturnType<typeof input>) => { v.target.minScale = .17; v.target.maxScale = .18; }],
    ["holdout outside declared tolerance", (v: ReturnType<typeof input>) => { v.target.maxHoldoutResidual = .001; }],
    ["query outside supported hull", (v: ReturnType<typeof input>) => { v.queryPoints = [[.9, .9]]; }],
  ] as const)("abstains for %s; preserves analyst policy and selected roles", (_, mutate) => {
    const value = input(); mutate(value); const before = structuredClone(value);
    expect(previewDocumentCoordinates(value, frame)).toMatchObject({ status: "PREVIEW_ONLY",
      result: { status: "ABSTAIN", reasonCode: "REGISTRATION_POLICY_REJECTED" }, calibratedProbability: null, facts: [] });
    expect(value).toEqual(before);
  });
  it("projects only explicit in-domain queries using exactly the chosen three FIT points", () => {
    const value = input(); value.queryPoints = [[.34, .48]];
    const result = previewDocumentCoordinates(value, frame);
    expect(result.result.status).toBe("CALCULATED");
    if (result.result.status !== "CALCULATED") throw Error("missing result");
    expect(result.result.calibration.queryPoints).toHaveLength(1);
    expect(result.result.calibration.queryPoints[0].page).toEqual([.34, .48]);
    expect(result.result.calibration.queryPoints[0].project.every(Number.isFinite)).toBe(true);
  });
  it("browser WebCrypto binds the exact request with locale-independent canonical keys", async () => {
    const value = input();
    const parsed = parseDocumentCoordinateInput(value);
    const expected = previewDocumentCoordinates(value, frame).inputSha256;
    expect(await documentCoordinateInputSha256(parsed)).toBe(expected);
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    expect(await documentCoordinateInputSha256(parseDocumentCoordinateInput(reordered))).toBe(expected);
    parsed.points[3].printed[0] += 0.001;
    expect(await documentCoordinateInputSha256(parsed)).not.toBe(expected);
  });
  it.each([
    ["unknown field", (v: any) => { v.trusted = true; }],
    ["off-page", (v: any) => { v.points[0].page[0] = -1e-8; }],
    ["missing unit", (v: any) => { delete v.target.unit; }],
    ["zero tolerance", (v: any) => { v.target.maxHoldoutResidual = 0; }],
    ["inverted bounds", (v: any) => { v.target.minScale = 400; }],
    ["NaN", (v: any) => { v.points[0].printed[0] = NaN; }],
    ["bool number", (v: any) => { v.points[0].printed[0] = true; }],
    ["under4", (v: any) => { v.points.pop(); }],
    ["over32", (v: any) => { v.points = Array.from({ length: 33 }, () => v.points[0]); }],
    ["missing source locator", (v: any) => { v.points[0].reference = ""; }],
    ["over128 queries", (v: any) => { v.queryPoints = Array.from({ length: 129 }, () => [.3, .4]); }],
    ["sparse tuple", (v: any) => { v.points[0].page = Array(2); }],
    ["unpaired surrogate", (v: any) => { v.target.label = "bad\ud800"; }],
  ])("rejects malformed %s before numerical traversal", (_, mutate) => {
    const value = input(); mutate(value); expect(() => parseDocumentCoordinateInput(value)).toThrow();
  });
  it("rejects getters, proxies, cycles and custom prototypes without evaluating callbacks", () => {
    let calls = 0; const getter = input(); Object.defineProperty(getter, "target", { enumerable: true, get() { calls++; throw Error("getter ran"); } });
    expect(() => parseDocumentCoordinateInput(getter)).toThrow();
    const proxy = new Proxy(input(), { ownKeys() { calls++; throw Error("proxy ran"); } });
    expect(() => parseDocumentCoordinateInput(proxy)).toThrow();
    const cycle: any = input(); cycle.queryPoints = [cycle]; expect(() => parseDocumentCoordinateInput(cycle)).toThrow();
    const custom = input(); Object.setPrototypeOf(custom.target, { authority: true });
    expect(() => parseDocumentCoordinateInput(custom)).toThrow(); expect(calls).toBe(0);
  });
});
