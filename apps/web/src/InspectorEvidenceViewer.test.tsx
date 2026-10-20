import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InspectorEvidenceViewer, type InspectorEvidenceViewerProps } from "./InspectorEvidenceViewer";

const evidence = { id: "pd-evidence", sourceFileId: "PD", sourceSha256: "a".repeat(64), stage: "PD" as const,
  pageNumber: 13, sheet: null, revision: null, element: "Declared project zero",
  bbox: [.1, .2, .4, .3] as [number, number, number, number], value: "159.95", unit: "m" };
const props: InspectorEvidenceViewerProps = { objectId: "OBJ", stage: "PD", evidence, onOpened: () => {} };

describe("source-coherent evidence viewer navigation", () => {
  it("remounts page state when the source, evidence page or object changes", () => {
    const prior = InspectorEvidenceViewer(props);
    for (const next of [
      { ...props, stage: "RD", evidence: { ...evidence, sourceFileId: "RD", pageNumber: 4, stage: "RD" as const } },
      { ...props, evidence: { ...evidence, pageNumber: 4 } },
      { ...props, objectId: "OTHER" },
      { ...props, evidence: undefined },
    ]) expect(InspectorEvidenceViewer(next).key).not.toBe(prior.key);
    const rd = InspectorEvidenceViewer({ ...props, stage: "RD", evidence: { ...evidence, sourceFileId: "RD", pageNumber: 4 } });
    const html = renderToStaticMarkup(rd);
    expect(html).toContain('value="4"');
    expect(html).toContain('/files/RD/content#page=4');
    expect(html).not.toContain('#page=13');
  });
  it("preserves manual navigation for a new frame on the same source page", () => {
    const next = { ...props, evidence: { ...evidence, id: "another-frame", value: "metres",
      bbox: [.2, .3, .5, .4] as [number, number, number, number] } };
    expect(InspectorEvidenceViewer(next).key).toBe(InspectorEvidenceViewer(props).key);
  });
});
