import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { linkableFacts, makeFactLinkInput, SavedFactLink } from "./FactLinkReview";
import type { FactLinkRecord, PilotResultsRead } from "./api";

const pdId = "a".repeat(64);
const rdId = "b".repeat(64);
const otherId = "c".repeat(64);
const family: NonNullable<PilotResultsRead["factFamily"]> = {
  schemaVersion: "fact-family-proposals-v1",
  inputManifestHash: "d".repeat(64),
  objectId: "OBJ-1",
  facts: [
    { schemaVersion: "typed-fact-v1", objectId: "OBJ-1", factId: pdId,
      parameterCode: "KR-055", stage: "PD", rawValue: "B40", rawUnit: "B",
      sourceFileId: "FILE-PD", sourceSha256: "1".repeat(64), pageNumber: 49 },
    { schemaVersion: "typed-fact-v1", objectId: "OBJ-1", factId: rdId,
      parameterCode: "KR-055", stage: "RD", rawValue: "B40", rawUnit: "B",
      sourceFileId: "FILE-RD", sourceSha256: "2".repeat(64), pageNumber: 27 },
    { schemaVersion: "typed-fact-v1", objectId: "OBJ-1", factId: otherId,
      parameterCode: "KR-058", stage: "RD", rawValue: "180", rawUnit: "мм",
      sourceFileId: "FILE-OTHER", sourceSha256: "3".repeat(64), pageNumber: 3 },
  ],
  comparisons: [], outputCount: 3, findingCount: 0, contentHash: "e".repeat(64),
};

describe("manual fact links", () => {
  it("needs explicit PD and RD IDs, same parameter, and an expert basis", () => {
    expect(linkableFacts(family)).toHaveLength(3);
    expect(makeFactLinkInput(family, "", "", "Одинаковый текст")).toBeNull();
    expect(makeFactLinkInput(family, rdId, pdId, "Один элемент")).toBeNull();
    expect(makeFactLinkInput(family, pdId, otherId, "Один элемент")).toBeNull();
    expect(makeFactLinkInput(family, pdId, rdId, "кратко")).toBeNull();
    expect(makeFactLinkInput(family, pdId, rdId,
      "Корпус 1, фундаментная плита на отметке -13,750 в обоих документах"))
      .toEqual({ factFamilyContentHash: family.contentHash, pdFactId: pdId, actualFactId: rdId,
        basis: { reference: "Корпус 1, фундаментная плита на отметке -13,750 в обоих документах" } });
  });

  it("shows saved decision and both source pages without claiming a finding", () => {
    const item: FactLinkRecord = {
      id: "LINK-1", checkId: "CHECK-1", objectId: "OBJ-1",
      link: { pdFactId: pdId, actualFactId: rdId,
        basis: { reference: "Фундаментная плита одного корпуса и отметки" } },
      actorId: "USER-1", contentHash: "f".repeat(64), createdAt: "2026-09-27T10:00:00Z",
    };
    const html = renderToStaticMarkup(createElement(SavedFactLink, {
      item, facts: linkableFacts(family), objectId: "OBJ-1",
    }));

    expect(html).toContain("KR-055 · связь ПД и RD");
    expect(html).toContain("Основание эксперта: Фундаментная плита одного корпуса и отметки");
    expect(html).toContain("/api/objects/OBJ-1/files/FILE-PD/pages/49/preview");
    expect(html).toContain("/api/objects/OBJ-1/files/FILE-RD/pages/27/preview");
    expect(html).not.toContain("нарушение");
  });
});
