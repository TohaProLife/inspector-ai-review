import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnresolvedConfigCodeV3, UnresolvedConfigReviewV3Read } from "./api";
import { UnresolvedConfigReviewV3 } from "./UnresolvedConfigReviewV3";

const hash = (character: string) => character.repeat(64);
const codes: UnresolvedConfigCodeV3[] = ["IOS1-068", "IOS1-069", "IOS1-070",
  "IOS4-076", "IOS4-078", "PPM-111", "PPM-113"];
type Lead = UnresolvedConfigReviewV3Read["codeRows"][number]["leads"][number];
const lead: Lead = { sourceFileId: "F0163", sourceSha256: hash("a"),
  textArtifactSha256: hash("b"), sourceStage: "PD", sourceSection: "EOM",
  pageNumber: 7, blockIndex: 3, lineIndex: 1, blockTextSha256: hash("c"),
  lineText: "Линия электропитания", lineTextSha256: hash("d"),
  bboxMilliPoints: [1000, 2000, 3000, 4000], matchedAnchors: ["линия"],
  locatorType: "TEXT_LINE_BBOX_ONLY", elementAssociationStatus: "UNVERIFIED",
  leadSha256: hash("e") };
const data: UnresolvedConfigReviewV3Read = {
  schemaVersion: "unresolved-config-run-review-v3",
  profileId: "unresolved-review-config-v3", purpose: "REVIEW_ONLY",
  objectId: "OBJ-1", inputManifestHash: hash("f"), configSha256: hash("1"),
  registrySha256: hash("2"), sourceStageArtifacts: [{ sourceFileId: "F0163",
    sourceSha256: hash("a"), textArtifactSha256: hash("b") }],
  codeRows: codes.map((parameterCode, index) => ({ parameterCode,
    candidateExtractorFamily: "NETWORK_TOPOLOGY" as const,
    locatorType: "TEXT_LINE_BBOX_ONLY" as const,
    requiredProofGates: ["DRAWING_GEOMETRY", "GRAPH_CONNECTIVITY",
      index === 0 ? "CIRCUIT_DEVICE_ASSIGNMENT" : "APPLICABLE_NORM"],
    status: "ABSTAIN" as const,
    reasonCodes: index === 0 ? ["CONFIG_PINNED_REVIEW_ONLY",
      "NETWORK_TOPOLOGY_UNVERIFIED", "OCR_REQUIRED_DEFERRED",
      "PAGE_STAGE_UNRESOLVED_DEFERRED"] : ["CONFIG_PINNED_REVIEW_ONLY",
      "NETWORK_TOPOLOGY_UNVERIFIED", "NO_SCANNED_TEXT_IN_SCOPE"],
    eligibleSourceCount: index === 0 ? 1 : 0,
    textCandidatePageCount: index === 0 ? 1 : 0,
    ocrRequiredPageCount: index === 0 ? 2 : 0,
    oversizeAnchorLineCount: 0, leadCount: index === 0 ? 1 : 0,
    truncatedLeadCount: 0, leadCountSemantics: "MATCHES_IN_SCANNED_TEXT_ONLY" as const,
    absenceConclusion: "NOT_AVAILABLE" as const,
    leads: index === 0 ? [lead] : [],
  })), findingCount: null, parameterCoverage: null, contentHash: hash("0"),
};

describe("unresolved config review v3", () => {
  it("shows seven abstentions, topology proof gaps, deferred reasons and SHA locator", () => {
    const html = renderToStaticMarkup(createElement(UnresolvedConfigReviewV3,
      { data, objectId: "OBJ-1" }));
    expect(html).toContain("Все 7 кодов имеют статус ABSTAIN");
    for (const code of codes) expect(html).toContain(code);
    expect(html).toContain("Топология сети не проверена");
    expect(html).toContain("связность сети по схеме");
    expect(html).toContain("привязка устройств к цепям");
    expect(html).toContain("Страницы с неясной стадией отложены");
    expect(html).toContain("отложенных страниц, которым нужно распознавание текста, 2");
    expect(html).not.toContain("OCR_REQUIRED");
    expect(html).not.toContain("UNVERIFIED");
    expect(html).toContain("Подходящий текст для просмотра отсутствует");
    expect(html).toContain("PDF-страница 7");
    expect(html).toContain("текстовый блок 4");
    expect(html).toContain("строка 2");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/F0163/content");
    expect(html).toContain("Отсутствие строки в");
    expect(html).toContain("Факты, замечания и охват не сформированы");
  });

  it("hides PDF links when source or text artifact hash differs", () => {
    const altered: UnresolvedConfigReviewV3Read = { ...data, sourceStageArtifacts: [{
      ...data.sourceStageArtifacts[0], textArtifactSha256: hash("9") }] };
    const html = renderToStaticMarkup(createElement(UnresolvedConfigReviewV3,
      { data: altered, objectId: "OBJ-1" }));
    expect(html).toContain("Источник строки не совпал с пакетом");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/pages/7/preview");
    expect(html).not.toContain("/api/objects/OBJ-1/files/F0163/content");
  });
});
