import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceFileSummary } from "@inspector-ai/contracts";
import { evidenceMatchesFile, parseDocumentPage, validEvidenceBox, comparisonTextParts } from "./document-pair-navigation";
import { InspectorEvidenceViewer } from "./InspectorEvidenceViewer";
import { DocumentPairWorkspace } from "./DocumentPairWorkspace";
import { realDocumentPairs } from "./real-document-pairs";
import { RealDocumentPairsPanel } from "./RealDocumentPairs";

const file: SourceFileSummary = { id: "F0171", name: "F0171.pdf", sha256: "a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc",
  size: 1, pageCount: 177, registeredAt: "2026-10-20T10:00:00Z", stages: ["PD"], review: null };
const rd: SourceFileSummary = { ...file, id: "F0201", name: "F0201.pdf", stages: ["RD", "ID"], pageCount: 676,
  sha256: "0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd" };
const evidence = { id: "region", stage: "PD" as const, sourceFileId: file.id, sourceSha256: file.sha256,
  pageNumber: 88, sheet: null, revision: null, element: "room", value: "В2.10", unit: null, bbox: [.1, .2, .4, .3] as [number, number, number, number] };

describe("paired source navigation and evidence boundaries", () => {
  it("commits only full integer pages inside original page count", () => {
    expect(parseDocumentPage("676", 676)).toBe(676);
    for (const draft of ["", "0", "-1", "1.2", "1e2", " 2", "02", "677", "999999"]) expect(parseDocumentPage(draft, 676)).toBeNull();
    expect(parseDocumentPage("10000", null)).toBe(10000); expect(parseDocumentPage("10001", null)).toBeNull();
  });
  it("refuses wrong revisions, IDs, pages and nonfinite frames", () => {
    expect(evidenceMatchesFile(evidence, file)).toBe(true);
    expect(evidenceMatchesFile(evidence, { ...file, sha256: "f".repeat(64) })).toBe(false);
    expect(evidenceMatchesFile(evidence, rd)).toBe(false);
    expect(evidenceMatchesFile({ ...evidence, pageNumber: 178 }, file)).toBe(false);
    for (const box of [[0, 0, 0, 1], [-.1, 0, 1, 1], [0, 0, 1.1, 1], [0, 0, NaN, 1]]) expect(validEvidenceBox(box)).toBe(false);
  });
  it("highlights literal tokens without rewriting quotes or inferring a violation", () => {
    const parts = comparisonTextParts("В2.2 / В2.3\nВ2.10", "В2.2 / В2.4");
    expect(parts.map(part => part.text).join("")).toBe("В2.2 / В2.3\nВ2.10");
    expect(parts.filter(part => part.different).map(part => part.text)).toEqual(["В2.3", "В2.10"]);
    expect(comparisonTextParts("В2.2", "В2.2").some(part => part.different)).toBe(false);
    expect(comparisonTextParts("A A", "A").filter(part => part.different).map(part => part.text)).toEqual(["A"]);
    expect(comparisonTextParts("A B", "B A").filter(part => part.different)).toHaveLength(1);
    expect(comparisonTextParts("<script>  A\nA", "A").map(part => part.text).join("")).toBe("<script>  A\nA");
  });
  it("can browse a whole original without an evidence frame", () => {
    const html = renderToStaticMarkup(<InspectorEvidenceViewer objectId="OBJ" stage="РД" file={rd} onOpened={() => {}} />);
    expect(html).toContain('aria-label="Страница PDF РД"'); expect(html).toContain('max="676"');
    expect(html).toContain('/files/F0201/content#page=1'); expect(html).not.toContain("Загрузите РД");
  });
  it("hides both the preview target and frame when SHA no longer matches", () => {
    const html = renderToStaticMarkup(<InspectorEvidenceViewer objectId="OBJ" stage="ПД" evidence={evidence}
      file={{ ...file, sha256: "f".repeat(64) }} onOpened={() => {}} />);
    expect(html).toContain("Редакция документа не совпадает"); expect(html).not.toContain('class="inspector-sheet');
    expect(html).not.toContain('/content#page=');
  });
  it("keeps source identity in component key when a revision changes", () => {
    const props = { objectId: "OBJ", stage: "ПД", file, evidence, onOpened: () => {} };
    expect(InspectorEvidenceViewer(props).key).not.toBe(InspectorEvidenceViewer({ ...props, file: { ...file, sha256: "f".repeat(64) } }).key);
  });
  it("renders independent page controls, explicit jump and safe literal markup", () => {
    const html = renderToStaticMarkup(<DocumentPairWorkspace objectId="OBJ" files={[file, rd]}
      sources={[evidence, { ...evidence, id: "rd", stage: "RD", sourceFileId: rd.id, sourceSha256: rd.sha256, value: "В2.4" }]} />);
    expect(html).toContain('aria-label="Страница PDF ПД"'); expect(html).toContain('aria-label="Страница PDF РД"');
    expect(html).toContain("К расхождению в обоих документах"); expect(html).toContain("<mark>В2.10</mark>");
    expect(html).toContain("Связь прокрутки не устанавливает геопривязку");
  });
  it("replays only byte-identified real pairs, independent from stage labels and names", () => {
    const pairs = realDocumentPairs([{ ...file, id: "uploaded-PD", name: "renamed", stages: ["ID"] }, { ...rd, id: "uploaded-RD", name: "other" }]);
    expect(pairs.map(pair => pair.roomId)).toEqual(["147", "198"]);
    expect(pairs[0].sources.find(source => source.stage === "PD")?.value).toBe("В2.10");
    expect(pairs[0].sources.find(source => source.stage === "RD")?.value).toBe("В2.2 / В2.3 / В2.4");
    expect(pairs.flatMap(pair => pair.sources).every(source => validEvidenceBox(source.bbox))).toBe(true);
    expect(pairs[0].sources[0].sourceFileId).toBe("uploaded-PD");
  });
  it("never first-matches duplicates, wrong originals or incomplete page metadata", () => {
    expect(realDocumentPairs([file, { ...rd, sha256: "f".repeat(64) }])).toEqual([]);
    expect(realDocumentPairs([file, rd, { ...rd, id: "duplicate" }])).toEqual([]);
    expect(realDocumentPairs([file, { ...rd, pageCount: 17 }])).toEqual([]);
    expect(realDocumentPairs([file, { ...rd, pageCount: null }])).toEqual([]);
  });
  it("calls real room differences candidates and labels manual transcriptions", () => {
    const html = renderToStaticMarkup(<RealDocumentPairsPanel objectId="OBJ" files={[file, rd]} />);
    expect(html).toContain("Кандидат · вероятность не оценена"); expect(html).toContain("расшифрованы вручную");
    expect(html).toContain("полный состав систем не установлен"); expect(html).toContain("Помещение 198");
  });
});
