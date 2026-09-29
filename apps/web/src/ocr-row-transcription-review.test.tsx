import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeOcrRowTranscriptionInput, OcrRowTranscriptionPanel } from "./OcrRowTranscriptionReview";
import { api, type OcrRowTranscriptionReviewList } from "./api";

const hash = (value: string) => value.repeat(64);
const fingerprint = hash("f");
const list: OcrRowTranscriptionReviewList = {
  canReview: true,
  ocrStageSha256: hash("a"),
  items: [],
  candidates: [{
    rowFingerprint: fingerprint,
    proposal: {
      sourceFileId: "F0202", inputSha256: hash("b"), pageNumber: 7,
      renderSha256: hash("c"), ocrPageContentHash: hash("d"),
      headerEvidence: [],
      labelEvidence: { role: "rowLabel", lineIndex: 10, text: "Строительный объем здания",
        bboxPx: [12, 34, 56, 78], score: 0.96 },
      valueEvidence: { role: "rawValue", lineIndex: 11, text: "60997,93",
        bboxPx: [90, 34, 155, 78], score: 0.95 },
    },
  }],
};

const callbacks = {
  onSelect: () => {}, onDecision: () => {}, onLabel: () => {}, onValue: () => {},
  onUnit: () => {}, onBasis: () => {}, onPreviewOpen: () => {}, onSubmit: () => {},
};

describe("OCR row transcription review", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("requires selected row, explicit decision, transcription and basis", () => {
    expect(makeOcrRowTranscriptionInput(list, "", "CONFIRMED_TRANSCRIPTION",
      "Подпись", "123", "м²", "Видно на листе")).toBeNull();
    expect(makeOcrRowTranscriptionInput(list, fingerprint, "", "Подпись", "123", "м²", "Видно на листе")).toBeNull();
    expect(makeOcrRowTranscriptionInput(list, fingerprint, "CONFIRMED_TRANSCRIPTION",
      "", "123", "м²", "Видно на листе")).toBeNull();
    expect(makeOcrRowTranscriptionInput(list, fingerprint, "CONFIRMED_TRANSCRIPTION",
      "Подпись", "123", "м²", "коротко")).toBeNull();
    expect(makeOcrRowTranscriptionInput({ ...list, canReview: false }, fingerprint,
      "CONFIRMED_TRANSCRIPTION", "Подпись", "123", "м²", "Видно на листе")).toBeNull();
    expect(makeOcrRowTranscriptionInput(list, fingerprint, "CONFIRMED_TRANSCRIPTION",
      " Подпись ", " 123 ", " м² ", "Видно на листе")).toEqual({
      schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: hash("a"),
      rowFingerprint: fingerprint, decision: "CONFIRMED_TRANSCRIPTION",
      reviewedLabel: "Подпись", reviewedValue: "123", reviewedUnit: "м²", basis: "Видно на листе",
    });
    expect(makeOcrRowTranscriptionInput(list, fingerprint, "REJECTED",
      "ignored", "ignored", "ignored", "Ошибка чтения OCR")).toEqual({
      schemaVersion: "ocr-row-transcription-review-v1", ocrStageSha256: hash("a"),
      rowFingerprint: fingerprint, decision: "REJECTED",
      reviewedLabel: null, reviewedValue: null, reviewedUnit: null, basis: "Ошибка чтения OCR",
    });
  });

  it("shows immutable evidence and keeps action disabled until preview link is opened", () => {
    const props = { list, objectId: "OBJ-1", selectedFingerprint: fingerprint,
      decision: "CONFIRMED_TRANSCRIPTION" as const, reviewedLabel: "Строительный объем здания",
      reviewedValue: "60997,93", reviewedUnit: "м³", basis: "Значение видно на листе",
      saving: false, previewOpened: false, ...callbacks };
    const html = renderToStaticMarkup(createElement(OcrRowTranscriptionPanel, props));
    expect(html).toContain("Только проверка чтения строки");
    expect(html).toContain("не подтверждает факт, редакцию или согласование источника");
    expect(html).toContain("OCR предложил:");
    expect(html).toContain("строки OCR 11 и 12");
    expect(html).toContain("Рамка подписи [12, 34, 56, 78]");
    expect(html).toContain("рендер SHA-256");
    expect(html).toContain("/api/objects/OBJ-1/files/F0202/pages/7/preview");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о чтении<\/button>/);
    expect(html).not.toContain("PZ-004");
    const afterOpen = renderToStaticMarkup(createElement(OcrRowTranscriptionPanel,
      { ...props, previewOpened: true }));
    expect(afterOpen).not.toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о чтении<\/button>/);
  });

  it("shows both original v3 label lines while leaving confirmation to expert", () => {
    const proposal = structuredClone(list.candidates[0].proposal);
    proposal.labelContinuationEvidence = [{ role: "rowLabelContinuation", lineIndex: 12,
      text: "и сооружения", bboxPx: [13, 79, 85, 99], score: 0.87 }];
    const v3List = { ...list, candidates: [{ ...list.candidates[0], proposal }] };
    const html = renderToStaticMarkup(createElement(OcrRowTranscriptionPanel, {
      list: v3List, objectId: "OBJ-1", selectedFingerprint: fingerprint,
      decision: "" as const, reviewedLabel: "", reviewedValue: "", reviewedUnit: "",
      basis: "", saving: false, previewOpened: false, ...callbacks,
    }));
    expect(html).toContain("Строительный объем здания и сооружения");
    expect(html).toContain("Подпись: OCR-строка 11");
    expect(html).toContain("оценка OCR 0.960");
    expect(html).toContain("Продолжение подписи: OCR-строка 13");
    expect(html).toContain("рамка [13, 79, 85, 99] px, оценка OCR 0.870");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить решение о чтении<\/button>/);
  });

  it("uses authenticated check route with CSRF and idempotency for a human command", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "decision-1" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "inspector_csrf=csrf-token" });
    const input = makeOcrRowTranscriptionInput(list, fingerprint, "REJECTED",
      "", "", "", "OCR не совпадает с листом");
    expect(input).not.toBeNull();
    await api.recordOcrRowTranscriptionReview("CHK-1", input!);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/checks/CHK-1/ocr-row-reviews");
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect((init.headers as Headers).get("X-CSRF-Token")).toBe("csrf-token");
    expect((init.headers as Headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
