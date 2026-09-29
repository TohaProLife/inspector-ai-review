import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sourceSectionCodes } from "@inspector-ai/contracts";
import { SourceSectionCodeField } from "./SourceReviewScreen";

describe("explicit document section review", () => {
  it("offers only pinned project and working documentation sections and starts unresolved", () => {
    const html = renderToStaticMarkup(createElement(SourceSectionCodeField, {
      value: null, onChange: () => undefined, disabled: false,
    }));

    expect(sourceSectionCodes).toHaveLength(27);
    expect(html.match(/<option/g)).toHaveLength(28);
    expect(html).toContain('<option value="" selected="">Не установлен</option>');
    expect(html).toContain('<option value="AR">Раздел 3. АР</option>');
    expect(html).toContain('<option value="KR">Раздел 4. КР</option>');
    expect(html).toContain('<option value="VK">РД: ВК</option>');
    expect(html).toContain("только после явного выбора и сохранения решения");
  });

  it("shows saved section without inferring it from file stage", () => {
    const html = renderToStaticMarkup(createElement(SourceSectionCodeField, {
      value: "KR", onChange: () => undefined, disabled: true,
    }));

    expect(html).toContain('<option value="KR" selected="">Раздел 4. КР</option>');
    expect(html).toContain('disabled=""');
  });
});
