import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type OcrFactPairReviewList, type OcrTypedFactCandidate } from "./api";
import { makeOcrFactPairReviewInput, OcrFactPairPanel } from "./OcrFactPairReview";

const hash = (character: string) => character.repeat(64);
const fact = (stage: "PD" | "RD", marker: string): OcrTypedFactCandidate => ({
  schemaVersion: "typed-fact-v2", factId: hash(marker), targetCheckId: "CHK-1",
  inputManifestHash: hash("e"), objectId: "OBJ-1", sourceFileId: stage === "PD" ? "F0001" : "F0202",
  sourceSha256: hash(stage === "PD" ? "a" : "b"), stage, pageNumber: stage === "PD" ? 3 : 7,
  parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA", entityKey: "Здание 1",
  context: "ТЭП", rawText: "Площадь 100 м²", rawValue: "100", rawUnit: "м²",
  locator: { kind: "OCR_ROW", originInputManifestHash: hash("c"), ocrPageContentHash: hash("d"),
    renderSha256: hash("e"), ocrStageSha256: hash("f"), tableRowsContentHash: hash("0"),
    rowFingerprint: hash("1"), transcriptionDecisionId: "transcription-1",
    transcriptionDecisionHash: hash("2"), sourceReviewDecisionId: "source-1",
    sourceReviewDecisionHash: hash("3"), applicabilityDecisionId: "applicability-1",
    applicabilityDecisionHash: hash("4"), targetSnapshotHash: hash("5"),
    originCheckId: "CHK-0", sectionCode: "PZ", labelEvidence: {}, valueEvidence: {} },
});
const pd = fact("PD", "6");
const rd = fact("RD", "7");
const list: OcrFactPairReviewList = { items: [], canReview: true, candidates: [{
  parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA", entityKey: "Здание 1",
  context: "ТЭП", linkGroupId: "Группа А", pdFact: pd, rdFact: rd,
  pdLocatorHash: hash("8"), rdLocatorHash: hash("9"), artifactHash: hash("a"),
}] };
const selectedKey = `${pd.factId}:${rd.factId}`;
const callbacks = { onSelect: () => {}, onDecision: () => {}, onBasis: () => {},
  onPreviewOpen: () => {}, onSubmit: () => {} };
const panel = (overrides: Partial<Parameters<typeof OcrFactPairPanel>[0]> = {}) => ({
  list, checkId: "CHK-1", objectId: "OBJ-1", selectedKey, decision: "" as const,
  basis: "", saving: false, openedFactIds: new Set<string>(), ...callbacks, ...overrides,
});

describe("OCR fact pair review", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("derives exact request only from server candidate and explicit decision and basis", () => {
    expect(makeOcrFactPairReviewInput(list, "CHK-1", "", "PAIR_CONFIRMED", "Проверены оба листа"))
      .toBeNull();
    expect(makeOcrFactPairReviewInput(list, "CHK-1", selectedKey, "", "Проверены оба листа"))
      .toBeNull();
    expect(makeOcrFactPairReviewInput(list, "CHK-1", selectedKey, "PAIR_CONFIRMED", " "))
      .toBeNull();
    expect(makeOcrFactPairReviewInput({ ...list, canReview: false }, "CHK-1", selectedKey,
      "PAIR_CONFIRMED", "Проверены оба листа")).toBeNull();
    expect(makeOcrFactPairReviewInput({ ...list, candidates: [{ ...list.candidates[0],
      pdLocatorHash: "invalid" }] }, "CHK-1", selectedKey,
    "PAIR_CONFIRMED", "Проверены оба листа")).toBeNull();
    expect(makeOcrFactPairReviewInput(list, "CHK-1", selectedKey, "UNSURE",
      "Нет подтверждения элемента")).toEqual({
      schemaVersion: "ocr-fact-pair-review-v1", decision: "UNSURE", targetCheckId: "CHK-1",
      inputManifestHash: hash("e"), objectId: "OBJ-1", parameterCode: "PZ-002",
      attribute: "BUILDING_TOTAL_AREA", pdFactId: hash("6"), pdLocatorHash: hash("8"),
      rdFactId: hash("7"), rdLocatorHash: hash("9"), entityKey: "Здание 1",
      context: "ТЭП", linkGroupId: "Группа А", basis: "Нет подтверждения элемента",
    });
  });

  it("shows both original facts and locator provenance; requires both previews before save", () => {
    const html = renderToStaticMarkup(createElement(OcrFactPairPanel, panel()));
    expect(html).toContain("Только проверка пары ПД и РД");
    expect(html).toContain("Кандидатов пар: 1");
    expect(html).toContain("Происхождение факта PD");
    expect(html).toContain("Происхождение факта RD");
    expect(html).toContain("OCR_ROW");
    expect(html).toContain("/api/objects/OBJ-1/files/F0001/pages/3/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0202/pages/7/preview");
    expect(html).toContain("Выберите после проверки обоих исходных листов");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о паре<\/button>/);
    const filled = { decision: "PAIR_CONFIRMED" as const, basis: "Оба листа проверены" };
    const oneOpened = renderToStaticMarkup(createElement(OcrFactPairPanel,
      panel({ ...filled, openedFactIds: new Set([pd.factId]) })));
    expect(oneOpened).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о паре<\/button>/);
    const ready = renderToStaticMarkup(createElement(OcrFactPairPanel,
      panel({ ...filled, openedFactIds: new Set([pd.factId, rd.factId]) })));
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о паре<\/button>/);
  });

  it("stays empty without verified pairs and sends authenticated POST with CSRF", async () => {
    const html = renderToStaticMarkup(createElement(OcrFactPairPanel,
      panel({ list: { ...list, candidates: [] }, selectedKey: "" })));
    expect(html).toContain("Проверенных пар OCR-фактов пока нет");
    expect(html).not.toContain("Сохранить решение о паре");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "decision-1" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "inspector_csrf=csrf-token" });
    const input = makeOcrFactPairReviewInput(list, "CHK-1", selectedKey,
      "UNSURE", "Нет подтверждения элемента");
    await api.recordOcrFactPairReview("CHK-1", input!);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/checks/CHK-1/ocr-fact-pair-reviews");
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
