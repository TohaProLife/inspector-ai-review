import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type OcrFactPairQuantityReviewList, type OcrTypedFactCandidate } from "./api";
import { makeOcrFactPairQuantityReviewInput, OcrFactPairQuantityPanel } from "./OcrFactPairQuantityReview";

const hash = (character: string) => character.repeat(64);
const fact = (stage: "PD" | "RD", marker: string): OcrTypedFactCandidate => ({
  schemaVersion: "typed-fact-v2", factId: hash(marker), targetCheckId: "CHK-2",
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
const decisionId = "11111111-1111-4111-8111-111111111111";
const review = { schemaVersion: "ocr-fact-pair-review-v1" as const,
  decision: "PAIR_CONFIRMED" as const, targetCheckId: "CHK-2",
  inputManifestHash: hash("e"), objectId: "OBJ-1", parameterCode: "PZ-002",
  attribute: "BUILDING_TOTAL_AREA", pdFactId: pd.factId, pdLocatorHash: hash("8"),
  rdFactId: rd.factId, rdLocatorHash: hash("9"), entityKey: "Здание 1",
  context: "ТЭП", linkGroupId: "Группа А", basis: "Исходные листы проверены" };
const pairSnapshot = { decisionId, decisionContentHash: hash("a"), actorId: "actor-1",
  originCheckId: "CHK-1", targetCheckId: "CHK-2", originReview: review,
  review, targetReviewHash: hash("b"), provenance: { artifactHash: hash("c"),
    pdSourceFileId: "F0001", pdSourceSha256: hash("a"), pdSourceReviewHash: hash("d"),
    rdSourceFileId: "F0202", rdSourceSha256: hash("b"), rdSourceReviewHash: hash("e") },
  eligibleForPairReview: true, reasonCode: "REBOUND" as const };
const list: OcrFactPairQuantityReviewList = { items: [], effectiveItems: [],
  candidates: [{ pairSnapshot, pdFact: pd, rdFact: rd }], canReview: true, reasonCode: null };
const basis = { scope: "Площадь всего здания", quantityType: "Общая площадь, м²",
  period: "Одна редакция проекта", aggregation: "Итог по зданию" };
const callbacks = { onSelect: () => {}, onDecision: () => {}, onDenominator: () => {},
  onBasis: () => {}, onPreviewOpen: () => {}, onSubmit: () => {} };
const panel = (overrides: Partial<Parameters<typeof OcrFactPairQuantityPanel>[0]> = {}) => ({
  list, checkId: "CHK-2", objectId: "OBJ-1", selectedDecisionId: decisionId,
  decision: "" as const, pdDenominatorAffirmed: false, basis: {
    scope: "", quantityType: "", period: "", aggregation: "" }, saving: false,
  openedFactIds: new Set<string>(), ...callbacks, ...overrides,
});

describe("OCR pair quantity review", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires next-run immutable pair snapshot, explicit decision and full basis", () => {
    const make = (source = list,
      decision: "SAME_SCALAR_TOTAL" | "NOT_COMPARABLE" | "UNSURE" = "SAME_SCALAR_TOTAL",
      denominator = true, evidence = basis) => makeOcrFactPairQuantityReviewInput(
      source, "CHK-2", decisionId, decision, denominator, evidence);
    expect(make({ ...list, candidates: [], reasonCode: "OCR_QUANTITY_SNAPSHOT_REQUIRED" })).toBeNull();
    expect(make({ ...list, canReview: false })).toBeNull();
    expect(make({ ...list, candidates: [{ ...list.candidates[0], pairSnapshot: {
      ...pairSnapshot, eligibleForPairReview: false } }] })).toBeNull();
    expect(make({ ...list, candidates: [{ ...list.candidates[0], pairSnapshot: {
      ...pairSnapshot, targetReviewHash: null } }] })).toBeNull();
    expect(make({ ...list, candidates: [{ ...list.candidates[0], pairSnapshot: {
      ...pairSnapshot, originCheckId: "CHK-2" } }] })).toBeNull();
    expect(make({ ...list, candidates: [{ ...list.candidates[0], pairSnapshot: {
      ...pairSnapshot, provenance: null } }] })).toBeNull();
    expect(make(list, "SAME_SCALAR_TOTAL", false)).toBeNull();
    expect(make(list, "SAME_SCALAR_TOTAL", true, { ...basis, period: "" })).toBeNull();
    expect(make(list, "SAME_SCALAR_TOTAL", true, { ...basis, period: "неизвестно" })).toBeNull();
    expect(make()).toEqual({ schemaVersion: "ocr-fact-pair-quantity-review-v1",
      decision: "SAME_SCALAR_TOTAL", targetCheckId: "CHK-2",
      inputManifestHash: hash("e"), objectId: "OBJ-1", parameterCode: "PZ-002",
      attribute: "BUILDING_TOTAL_AREA", entityKey: "Здание 1", context: "ТЭП",
      pdFactId: pd.factId, pdLocatorHash: hash("8"), rdFactId: rd.factId,
      rdLocatorHash: hash("9"), pairDecisionId: decisionId,
      pairTargetReviewHash: hash("b"), pdDenominatorAffirmed: true,
      pdPageNumber: 3, rdPageNumber: 7, basis });
    expect(make(list, "UNSURE", false)?.decision).toBe("UNSURE");
  });

  it("requires price basis for SM-132 and omits it for other codes", () => {
    const smReview = { ...review, parameterCode: "SM-132" };
    const smPd = { ...pd, parameterCode: "SM-132" };
    const smRd = { ...rd, parameterCode: "SM-132" };
    const smList: OcrFactPairQuantityReviewList = { ...list, candidates: [{
      pairSnapshot: { ...pairSnapshot, review: smReview }, pdFact: smPd, rdFact: smRd,
    }] };
    expect(makeOcrFactPairQuantityReviewInput(smList, "CHK-2", decisionId,
      "NOT_COMPARABLE", false, basis)).toBeNull();
    expect(makeOcrFactPairQuantityReviewInput(smList, "CHK-2", decisionId,
      "NOT_COMPARABLE", false, { ...basis, priceBasis: "Базис 2024 года" })?.basis.priceBasis)
      .toBe("Базис 2024 года");
    expect(makeOcrFactPairQuantityReviewInput(list, "CHK-2", decisionId,
      "UNSURE", false, { ...basis, priceBasis: "ignored" })?.basis.priceBasis).toBeUndefined();
  });

  it("explains rerun gate and keeps submit disabled until both source pages are opened", () => {
    const empty = renderToStaticMarkup(createElement(OcrFactPairQuantityPanel,
      panel({ list: { ...list, candidates: [], reasonCode: "OCR_QUANTITY_SNAPSHOT_REQUIRED" },
        selectedDecisionId: "" })));
    expect(empty).toContain("Нужен повторный запуск после подтверждения пары");
    expect(empty).not.toContain("Сохранить решение о сопоставимости");
    const normal = renderToStaticMarkup(createElement(OcrFactPairQuantityPanel, panel()));
    expect(normal).toContain("Источник количества PD");
    expect(normal).toContain("Источник количества RD");
    expect(normal).toContain("PDF SHA-256");
    expect(normal).toContain("/api/objects/OBJ-1/files/F0001/pages/3/preview");
    expect(normal).toContain("/api/objects/OBJ-1/files/F0202/pages/7/preview");
    expect(normal).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о сопоставимости<\/button>/);
    const one = renderToStaticMarkup(createElement(OcrFactPairQuantityPanel,
      panel({ decision: "SAME_SCALAR_TOTAL", pdDenominatorAffirmed: true, basis,
        openedFactIds: new Set([pd.factId]) })));
    expect(one).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о сопоставимости<\/button>/);
    const ready = renderToStaticMarkup(createElement(OcrFactPairQuantityPanel,
      panel({ decision: "SAME_SCALAR_TOTAL", pdDenominatorAffirmed: true, basis,
        openedFactIds: new Set([pd.factId, rd.factId]) })));
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о сопоставимости<\/button>/);
  });

  it("uses authenticated scoped POST with CSRF and idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "decision-1" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "inspector_csrf=csrf-token" });
    const input = makeOcrFactPairQuantityReviewInput(list, "CHK-2", decisionId,
      "UNSURE", false, basis);
    await api.recordOcrFactPairQuantityReview("CHK-2", input!);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/checks/CHK-2/ocr-fact-pair-quantity-reviews");
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
