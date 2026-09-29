import { describe, expect, it } from "vitest";
import { ocrProfileLabel, ocrSourceStatusLabel } from "./SourceReviewScreen";

describe("OCR v6 source status labels", () => {
  it.each([
    ["SKIPPED_SOURCE_REVIEW_REQUIRED", "источник ещё не проверен экспертом"],
    ["SKIPPED_SOURCE_NOT_CURRENT_APPROVED", "редакция источника не подтверждена"],
    ["SKIPPED_SECTION_NOT_AR_VK", "не АР или ВК"],
    ["SKIPPED_PAGE_STAGE_UNRESOLVED", "стадия требующих OCR страниц не установлена"],
    ["SKIPPED_RENDER_PIXEL_LIMIT", "размер изображения страницы превышает"],
    ["SKIPPED_SOURCE_TOO_LARGE", "размер исходного файла превышает"],
    ["PARTIALLY_SCANNED", "остальные не проверены"],
  ])("explains %s without exposing raw code", (status, phrase) => {
    const label = ocrSourceStatusLabel(status);
    expect(label).toContain(phrase);
    expect(label).not.toContain(status);
  });

  it("preserves previous context warning and unknown-status behavior", () => {
    expect(ocrSourceStatusLabel("SKIPPED_NO_SUBJECT_CONTEXT"))
      .toContain("не означает, что в файле нет текста");
    expect(ocrSourceStatusLabel("FUTURE_STATUS")).toBe("FUTURE_STATUS");
  });

  it("names v6 for readers and preserves legacy profile labels", () => {
    expect(ocrProfileLabel("local-bounded-ocr-layout-v6"))
      .toBe("Адресное OCR для проверенных разделов АР/ВК");
    expect(ocrProfileLabel("local-bounded-ocr-layout-v5"))
      .toBe("Профиль local-bounded-ocr-layout-v5");
  });
});
