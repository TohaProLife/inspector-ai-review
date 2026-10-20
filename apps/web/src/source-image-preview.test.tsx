import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceImage } from "./design-system/SourceImage";

it("schedules authenticated PDF thumbnails instead of letting native images bypass the render limit", () => {
  const html = renderToStaticMarkup(<SourceImage src="/api/objects/OBJ/files/FILE/pages/18/preview?resolution=1200" alt="Original" />);
  expect(html).toContain('data-source-state="loading"');
  expect(html).not.toContain('<img');
});
it("preserves static illustrations and already authenticated blob images", () => {
  for (const src of ["/assets/example.png", "blob:http://localhost/verified-preview"]) {
    const html = renderToStaticMarkup(<SourceImage src={src} alt="Illustration" />);
    expect(html).toContain(`src="${src}"`);
    expect(html).toContain('<img');
  }
});
