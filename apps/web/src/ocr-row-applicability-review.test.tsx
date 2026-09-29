import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type OcrRowApplicabilityReviewList } from "./api";
import { makeOcrRowApplicabilityInput, OcrRowApplicabilityPanel } from "./OcrRowApplicabilityReview";

const hash = (character: string) => character.repeat(64);
const fingerprint = hash("f");
const list: OcrRowApplicabilityReviewList = {
  items: [], canReview: true,
  candidates: [{
    sourceFileId: "F0202", sourceSha256: hash("a"), pageNumber: 7,
    renderSha256: hash("b"), ocrStageSha256: hash("c"), rowFingerprint: fingerprint,
    transcriptionDecisionId: "transcription-1", transcriptionDecisionHash: hash("d"),
    sourceReviewDecisionId: "source-1", sourceReviewDecisionHash: hash("e"),
    transcriptionDecision: "CONFIRMED_TRANSCRIPTION",
    reviewedLabel: "Площадь здания", reviewedValue: "1250", reviewedUnit: "м²",
    sourceReview: { revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      sectionCode: "PZ", pageStage: "PD" },
    codeOptions: [{ parameterCode: "PZ-002", attribute: "BUILDING_TOTAL_AREA", stage: "PD" }],
  }],
};
const callbacks = { onSelect: () => {}, onCodeOption: () => {}, onDecision: () => {},
  onEntityKey: () => {}, onContext: () => {}, onBasis: () => {},
  onPreviewOpen: () => {}, onSourceReviewOpen: () => {}, onSubmit: () => {} };

describe("OCR row applicability review", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts blank, requires immutable snapshots and explicit code, decision, entity and context", () => {
    const make = (source = list, row = fingerprint, option = "0", decision = "APPLICABLE" as const,
      entity = "Здание 1", context = "ТЭП основного здания", basis = "Проверено на исходном листе") =>
      makeOcrRowApplicabilityInput(source, "CHK-1", row, option, decision, entity, context, basis);
    expect(make(list, "")).toBeNull();
    expect(make(list, fingerprint, "")).toBeNull();
    expect(make(list, fingerprint, "0", "" as "APPLICABLE")).toBeNull();
    expect(make(list, fingerprint, "0", "APPLICABLE", "")).toBeNull();
    expect(make(list, fingerprint, "0", "APPLICABLE", "Здание 1", "")).toBeNull();
    expect(make({ ...list, canReview: false })).toBeNull();
    expect(make({ ...list, candidates: [] })).toBeNull();
    expect(make({ ...list, candidates: [{ ...list.candidates[0], sourceReviewDecisionHash: "bad" }] })).toBeNull();
    expect(make({ ...list, candidates: [{ ...list.candidates[0], codeOptions: [] }] })).toBeNull();
    expect(make()).toEqual({
      schemaVersion: "ocr-row-applicability-review-v1", decision: "APPLICABLE",
      targetCheckId: "CHK-1", sourceFileId: "F0202", sourceSha256: hash("a"),
      pageNumber: 7, renderSha256: hash("b"), ocrStageSha256: hash("c"),
      rowFingerprint: fingerprint, transcriptionDecisionId: "transcription-1",
      transcriptionDecisionHash: hash("d"), sourceReviewDecisionId: "source-1",
      sourceReviewDecisionHash: hash("e"), parameterCode: "PZ-002",
      attribute: "BUILDING_TOTAL_AREA", stage: "PD", entityKey: "Здание 1",
      context: "ТЭП основного здания", basis: "Проверено на исходном листе",
    });
  });

  it("blocks positive decision without confirmed text or approved source, allows unsure", () => {
    const altered = { ...list, candidates: [{ ...list.candidates[0],
      transcriptionDecision: "REJECTED" as const,
      sourceReview: { ...list.candidates[0].sourceReview,
        revisionStatus: "UNKNOWN" as const, approvalStatus: "UNKNOWN" as const },
    }] };
    expect(makeOcrRowApplicabilityInput(altered, "CHK-1", fingerprint, "0", "APPLICABLE",
      "Здание 1", "Раздел ТЭП", "Нет подтверждения источника")).toBeNull();
    expect(makeOcrRowApplicabilityInput(altered, "CHK-1", fingerprint, "0", "UNSURE",
      "Здание 1", "Раздел ТЭП", "Нет подтверждения источника")?.decision).toBe("UNSURE");
  });

  it("shows decision provenance and keeps save disabled before explicit selection and source-page preview", () => {
    const props = { list, checkId: "CHK-1", objectId: "OBJ-1",
      selectedFingerprint: fingerprint, codeOptionIndex: "", decision: "" as const,
      entityKey: "", context: "", basis: "", saving: false, previewOpened: false,
      ...callbacks };
    const html = renderToStaticMarkup(createElement(OcrRowApplicabilityPanel, props));
    expect(html).toContain("Только предметная проверка строки");
    expect(html).toContain("не создаёт типизированный факт, пару ПД/РД, замечание или охват");
    expect(html).toContain("transcription-1");
    expect(html).toContain("source-1");
    expect(html).toContain("PDF SHA-256");
    expect(html).toContain("/api/objects/OBJ-1/files/F0202/pages/7/preview");
    expect(html).toContain("Открыть текущую проверку источника");
    expect(html).toContain("Текущая проверка источника может уже отличаться от снимка запуска");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о применимости<\/button>/);
    const filled = { ...props, codeOptionIndex: "0", decision: "APPLICABLE" as const,
      entityKey: "Здание 1", context: "ТЭП основного здания",
      basis: "Проверено на исходном листе", previewOpened: true };
    const ready = renderToStaticMarkup(createElement(OcrRowApplicabilityPanel, filled));
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о применимости<\/button>/);
  });

  it("uses scoped authenticated POST with CSRF and idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "decision-1" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "inspector_csrf=csrf-token" });
    const input = makeOcrRowApplicabilityInput(list, "CHK-1", fingerprint, "0", "UNSURE",
      "Здание 1", "Раздел ТЭП", "Требуется проверка применимости");
    expect(input).not.toBeNull();
    await api.recordOcrRowApplicabilityReview("CHK-1", input!);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/checks/CHK-1/ocr-row-applicability-reviews");
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
