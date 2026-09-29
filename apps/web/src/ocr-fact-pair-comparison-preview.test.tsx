import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type OcrFactPairComparisonPreviewList,
  type OcrFactPairQuantityReviewRecord } from "./api";
import { OcrFactPairComparisonPreviewPanel } from "./OcrFactPairComparisonPreview";

const hash = (character: string) => character.repeat(64);
const decisionId = "11111111-1111-4111-8111-111111111111";
const quantityDecision: OcrFactPairQuantityReviewRecord = {
  id: decisionId, checkId: "CHK-2", objectId: "OBJ-1",
  review: { schemaVersion: "ocr-fact-pair-quantity-review-v1", decision: "SAME_SCALAR_TOTAL",
    targetCheckId: "CHK-2", inputManifestHash: hash("a"), objectId: "OBJ-1",
    parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
    entityKey: "Здание 1", context: "ТЭП", pdFactId: hash("b"), pdLocatorHash: hash("c"),
    rdFactId: hash("d"), rdLocatorHash: hash("e"),
    pairDecisionId: "22222222-2222-4222-8222-222222222222", pairTargetReviewHash: hash("f"),
    pdDenominatorAffirmed: true, pdPageNumber: 3, rdPageNumber: 7,
    basis: { scope: "Площадь всего здания", quantityType: "Общая площадь здания",
      period: "Одна редакция проекта", aggregation: "Итог по всему зданию" } },
  provenance: { artifactHash: hash("0"), pairDecisionId: "22222222-2222-4222-8222-222222222222",
    pairDecisionContentHash: hash("1"), pairTargetReviewHash: hash("f"),
    candidateRulePackSha256: hash("2"), canonicalUnit: "m2", pdSourceFileId: "F0001",
    pdSourceSha256: hash("3"), pdSourceReviewHash: hash("4"),
    pdApplicabilityDecisionHash: hash("5"), pdTargetSnapshotHash: hash("6"),
    rdSourceFileId: "F0202", rdSourceSha256: hash("7"), rdSourceReviewHash: hash("8"),
    rdApplicabilityDecisionHash: hash("9"), rdTargetSnapshotHash: hash("a") },
  eligibleForComparison: true, evidenceHash: hash("b"), actorId: "actor-1",
  contentHash: hash("c"), createdAt: "2026-09-28T00:00:00.000Z",
};
const comparison = { parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA",
  family: "RELATIVE_DELTA" as const, canonicalUnit: "m2", pdValue: "100", rdValue: "101.5",
  thresholdPercent: "1", observedPercent: { numerator: "3", denominator: "2" },
  exceedsThreshold: true, pdFactId: hash("b"), rdFactId: hash("d"),
  pdLocatorHash: hash("c"), rdLocatorHash: hash("e"), targetReviewHash: hash("f"),
  artifactHash: hash("0"), quantityEvidenceHash: hash("b") };

describe("OCR fact pair comparison preview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("states clearly when no confirmed quantity decision exists", () => {
    const html = renderToStaticMarkup(createElement(OcrFactPairComparisonPreviewPanel,
      { data: { items: [] }, quantityDecisions: [] }));
    expect(html).toContain("Подтверждённых количественных решений нет");
    expect(html).toContain("не создают замечание");
    expect(html).not.toContain("Сохранить");
  });

  it("separates ABSTAIN with reason and decision hashes", () => {
    const data: OcrFactPairComparisonPreviewList = { items: [{ quantityDecisionId: decisionId,
      preview: { schemaVersion: "ocr-fact-pair-comparison-preview-v1", purpose: "REVIEW_ONLY",
        status: "ABSTAIN", reasonCode: "UNIT_AMBIGUOUS", comparison: null } }] };
    const html = renderToStaticMarkup(createElement(OcrFactPairComparisonPreviewPanel,
      { data, quantityDecisions: [quantityDecision] }));
    expect(html).toContain("Сравнение остановлено");
    expect(html).toContain("Единицы измерения неоднозначны");
    expect(html).toContain("UNIT_AMBIGUOUS");
    expect(html).toContain("решение SHA-256");
    expect(html).toContain("доказательство SHA-256");
    expect(html).toContain("/api/objects/OBJ-1/files/F0001/pages/3/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0202/pages/7/preview");
    expect(html).not.toContain("Кандидат численного сравнения");
  });

  it("shows exact rational percent and threshold only as review hint", () => {
    const data: OcrFactPairComparisonPreviewList = { items: [{ quantityDecisionId: decisionId,
      preview: { schemaVersion: "ocr-fact-pair-comparison-preview-v1", purpose: "REVIEW_ONLY",
        status: "COMPARISON_CANDIDATE", reasonCode: null, comparison } }] };
    const html = renderToStaticMarkup(createElement(OcrFactPairComparisonPreviewPanel,
      { data, quantityDecisions: [quantityDecision] }));
    expect(html).toContain("Кандидат численного сравнения");
    expect(html).toContain("3/2 %");
    expect(html).toContain("порог правила 1 %");
    expect(html).toContain("это ещё не подтверждённое нарушение");
    expect(html).toContain("основание количества SHA-256");
    expect(html).not.toContain("Сохранить");
    expect(html).not.toContain("Подтвердить нарушение");
    const mismatched = renderToStaticMarkup(createElement(OcrFactPairComparisonPreviewPanel,
      { data, quantityDecisions: [{ ...quantityDecision, evidenceHash: hash("e") }] }));
    expect(mismatched).toContain("Численный результат скрыт");
    expect(mismatched).not.toContain("3/2 %");
  });

  it("uses authenticated exact GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await api.getOcrFactPairComparisonPreviews("CHK-2");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/checks/CHK-2/ocr-fact-pair-comparison-previews");
    expect(init.credentials).toBe("include");
    expect(init.method).toBeUndefined();
  });
});
