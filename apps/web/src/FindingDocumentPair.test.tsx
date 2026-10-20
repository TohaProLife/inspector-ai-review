import { expect, it } from "vitest";
import type { Finding } from "@inspector-ai/contracts";
import { findingDocumentEvidence } from "./FindingDocumentPair";

it("keeps every saved stage, original hash, page and frame when opening a finding", () => {
  const finding = { id: "finding", location: "room147", expectedValue: "В2.10", actualValue: "В2.2 / В2.3", idValue: null,
    evidence: [
      { stage: "PD", fileId: "uploaded-PD", pdfPageNumber: 88, documentSheetNumber: 86, sha256: "a".repeat(64), bbox: [.1,.2,.4,.5] },
      { stage: "RD", fileId: "uploaded-RD", pdfPageNumber: 18, documentSheetNumber: null, sha256: "b".repeat(64), bbox: null },
      { stage: "RD", fileId: "uploaded-RD", pdfPageNumber: 19, documentSheetNumber: null, sha256: "b".repeat(64), bbox: null },
    ] } as Finding;
  const before = structuredClone(finding), sources = findingDocumentEvidence(finding);
  expect(sources).toHaveLength(3);
  expect(new Set(sources.map(source => source.id)).size).toBe(3);
  expect(sources[0]).toMatchObject({ sourceFileId: "uploaded-PD", sourceSha256: "a".repeat(64),
    pageNumber: 88, sheet: "86", bbox: [.1,.2,.4,.5], value: "В2.10", revision: null });
  expect(sources[1]).toMatchObject({ pageNumber: 18, bbox: null, value: "В2.2 / В2.3", stage: "RD" });
  expect(finding).toEqual(before);
});
