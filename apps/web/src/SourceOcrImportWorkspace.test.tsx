import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { SourceFileSummary, SourceOcrImportRecord, SourceOcrReviewRecord } from "@inspector-ai/contracts";
import { api } from "./api";
import { latestSourceOcrReview, sourceOcrPageEvidence, SourceOcrImportWorkspace, SourceOcrUnitQualityNotice } from "./SourceOcrImportWorkspace";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("opens explicitly without OCR execution or automatic history mutation", () => {
  const read = vi.spyOn(api, "listSourceOcrImports"), capture = vi.spyOn(api, "importSourceOcr"), review = vi.spyOn(api, "reviewSourceOcr");
  const html = renderToStaticMarkup(<SourceOcrImportWorkspace objectId="OBJ" checkId="CHK" file={{ id: "FIL", sha256: "a".repeat(64) } as SourceFileSummary} />);
  expect(html).toContain("Открыть историю OCR пропусков"); expect(html).toContain("Импорт не запускает распознавание");
  expect(read).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
});
it("opens the exact source page without projecting unverified raster coordinates onto PDF", () => {
  const record = { id: "IMPORT", sourceFileId: "FIL", bindings: { sourceSha256: "a".repeat(64) } } as SourceOcrImportRecord;
  expect(sourceOcrPageEvidence(record, 634)).toMatchObject({ sourceFileId: "FIL", sourceSha256: "a".repeat(64), pageNumber: 634, bbox: null, value: "" });
});
it("selects latest review only for exact import/page/ordinal", () => {
  const make = (id: string, importId = "IMPORT", pageNumber = 2, ordinal = 0) => ({ id, importId, pageNumber, ordinal } as SourceOcrReviewRecord);
  const reviews = [make("first"), make("other", "OTHER"), make("third", "IMPORT", 3), make("last")];
  expect(latestSourceOcrReview(reviews, "IMPORT", 2, 0)?.id).toBe("last"); expect(latestSourceOcrReview(reviews, "IMPORT", 2, 1)).toBeUndefined();
});
it("explains a literal unit contradiction as an uncalibrated candidate beside the original", () => {
  const html = renderToStaticMarkup(<SourceOcrUnitQualityNotice text="107,687 кВт (0,926 Гкал/час)" />);
  expect(html).toContain('role="note"');
  expect(html).toContain("107,687 кВт");
  expect(html).toContain("1076,3565–1077,5195 кВт");
  expect(html).toContain("Кандидат: проверьте двойные единицы");
  expect(html).toContain("вероятность не рассчитана");
  expect(html).toContain("или в самом оригинале");
  expect(html).toContain("Подтверждение текста не подтверждает правильность проектного значения");
  expect(html).toContain("https://www.nist.gov/pml/special-publication-811/nist-guide-si-footnotes");
  expect(html).not.toContain('role="alert"');
});
it("does not imply a unit check passed when notation is absent or intervals overlap", () => {
  for (const text of ["389,893 кВт (0,335 ГКАл/час)", "107,687 кВт", "Нагрузка не указана"]) {
    expect(renderToStaticMarkup(<SourceOcrUnitQualityNotice text={text} />)).toBe("");
  }
});
it("uses encoded scoped authenticated import/review routes and command keys", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetch);
  await api.listSourceOcrImports("CHK/escape"); expect(fetch.mock.calls[0][0]).toBe("/api/checks/CHK%2Fescape/source-ocr-imports");
  await api.importSourceOcr("CHK", "FIL/escape", {} as never);
  expect(fetch.mock.calls[1][0]).toBe("/api/checks/CHK/sources/FIL%2Fescape/source-ocr-imports");
  await api.reviewSourceOcr("CHK", {} as never);
  for (const index of [1, 2]) { expect(fetch.mock.calls[index][1]).toMatchObject({ credentials: "include", method: "POST" });
    expect((fetch.mock.calls[index][1].headers as Headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/u); }
});
