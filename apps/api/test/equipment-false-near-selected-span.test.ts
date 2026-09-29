import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { sha256 } from "../src/canonical-json.js";
import { replayEquipmentFalseNearSelectedSpanFromInspection,
  verifyEquipmentFalseNearSelectedSpan } from "../src/equipment-false-near-selected-span.js";
import { type IndependentPdfPageWords } from "../src/poppler-page-words.js";
import { pythonHash } from "../src/trusted-page-words.js";

type FileId = "F0165" | "F0160";
type Box = [number, number, number, number];
const objectId = "OBJ-TYUMENSKAYA-5-GOLD-SEED";
const cases = {
  F0165: { sha: "f4a34324aaf6779f05fc89379ddb2b15499a22dc0e9181389d87047ab1a39f64",
    size: 24_884_908, pages: 38, section: "VK", page: 26, code: "IOS2-073",
    kind: "FIRE_SPRINKLER_PUMP", exclusion: "FIRE_SPRINKLER_SYSTEM_NOT_DOMESTIC_DRINKING_WATER",
    nearText: "Насосная установка для пожарной системы (спринклеры)",
    pageWidth: 595_320, pageHeight: 841_920, wordCount: 232, wordStart: 2,
    wordLayout: "8565d9985bec2b2e85aa3394e85598a2276832542c81d6b48573019bcbedbda8",
    contentHash: "1b45b7f9f0ff7557c9e557d01239f0fae0eedd676e513e62e9c1752030085fa5",
    words: ["Насосная", "установка", "для", "пожарной", "системы", "(спринклеры)"],
    boxes: [[63744, 176600, 120732, 189980], [124164, 176600, 184332, 189980],
      [187970, 176600, 210182, 189980], [213530, 176600, 272630, 189980],
      [275906, 176600, 328130, 189980], [331430, 176600, 413162, 189980]] as Box[],
    popWords: ["Насосная", "установка", "для", "пожарной", "системы", "(спринклеры)"],
    popBoxes: [[63744, 176600, 120732, 189980], [124164, 176600, 184332, 189980],
      [187970, 176600, 210182, 189980], [213530, 176600, 272630, 189980],
      [275906, 176600, 328130, 189980], [331430, 176600, 413162, 189980]] as Box[],
  },
  F0160: { sha: "72fc8a91a7e09c20ac9769f513f2f0a763d7ffd6d9c0e9c198432834286537cd",
    size: 38_153_328, pages: 126, section: "EOM", page: 37, code: "ODI-115",
    kind: "LIFT_POWER_BOARD_LEGEND", exclusion: "POWER_BOARD_NOT_INSTALLED_LIFT",
    nearText: "ЩЛ - щит лифта (подъемника МГН);",
    pageWidth: 3_574_000, pageHeight: 1_684_000, wordCount: 878, wordStart: 102,
    wordLayout: "fe38d8fbca6eb916f35f9a3b4b0e2263f01b2bf159352d705c7da4272c21d8dc",
    contentHash: "da64c3055868304f1903ffcbb3ffd87aa332a489a79bd8ee7df6b9c22193ac36",
    words: ["ЩЛ", "-", "щит", "лифта", "(подъемника", "МГН);"],
    boxes: [[3058620, 1028625, 3072556, 1038530], [3075000, 1028625, 3080141, 1038530],
      [3082560, 1028625, 3101646, 1038530], [3104083, 1028625, 3133441, 1038530],
      [3135840, 1028625, 3193991, 1038530], [3196427, 1028625, 3220597, 1038530]] as Box[],
    popWords: ["ЩЛ", "-", "щит", "лифта", "(", "подъемника", "МГН", ");"],
    popBoxes: [[3058620, 1029158, 3072556, 1038370], [3075000, 1029158, 3080141, 1038370],
      [3082560, 1029158, 3101647, 1038370], [3104083, 1029158, 3133441, 1038370],
      [3135840, 1029158, 3138772, 1038370], [3140040, 1029158, 3193991, 1038370],
      [3196428, 1029158, 3214039, 1038370], [3215100, 1029158, 3220597, 1038370]] as Box[],
  },
};

function fixture(fileId: FileId) {
  const profile = cases[fileId];
  const source = { file_id: fileId, object_id: objectId, split: "TRAIN_PUBLIC",
    distribution_status: "INCLUDE", label_visibility: "PUBLIC_TRAIN",
    sha256: profile.sha, size_bytes: profile.size, pdf_pages: profile.pages,
    stage: "PD", section: profile.section };
  const wordLocators = profile.words.map((rawText, index) => ({
    wordIndex: profile.wordStart + index, rawText, wordTextSha256: sha256(rawText),
    bboxMilliPointsTopLeft: [...profile.boxes[index]],
  }));
  const proposalBody = { proposalKind: profile.kind, sourceFileId: fileId,
    sourceSha256: profile.sha, pageNumber: profile.page,
    nearText: profile.nearText, wordLocators, eligibility: "INELIGIBLE_FOR_PARAMETER_FACT",
    reasonCodes: [profile.exclusion, "REVIEW_ONLY_NOT_TYPED_FACT",
      "EQUIPMENT_IDENTITY_AND_INSTALLATION_UNVERIFIED"] };
  const body = { schemaVersion: "equipment-spec-false-near-v1",
    profileId: "equipment-spec-false-near-public-review-v1", purpose: "REVIEW_ONLY",
    parameterCode: profile.code, sourceFileId: fileId, objectId,
    sourceSha256: profile.sha, sourceStageFromManifest: "PD",
    sourceSectionFromManifest: profile.section, sourceApprovalStatus: "UNVERIFIED",
    pageNumber: profile.page, pageWidthMilliPoints: profile.pageWidth,
    pageHeightMilliPoints: profile.pageHeight, wordLayoutSha256: profile.wordLayout,
    wordCount: profile.wordCount, status: "ABSTAIN",
    reasonCodes: ["EQUIPMENT_IDENTITY_AND_INSTALLATION_UNVERIFIED", profile.exclusion,
      "PD_RD_PAIR_UNVERIFIED", "REVIEW_ONLY_NOT_TYPED_FACT",
      "SOURCE_APPROVAL_UNVERIFIED"].sort(), proposalCount: 1,
    proposals: [{ ...proposalBody, proposalSha256: pythonHash(proposalBody) }],
    typedFact: null, findingCount: null, parameterCoverage: null };
  const result = { ...body, contentHash: pythonHash(body) };
  assert.equal(result.contentHash, profile.contentHash);
  const words = profile.popWords.map((rawText, wordIndex) => ({
    wordIndex, rawText, bboxMilliPointsTopLeft: [...profile.popBoxes[wordIndex]] as Box,
  }));
  const inspectionBody = { providerId: "api-poppler-pdftotext-bbox-layout-v1@25.03.0",
    sourceSha256: profile.sha, pdfPageCount: profile.pages, pageNumber: profile.page,
    pageWidthMilliPoints: profile.pageWidth,
    pageHeightMilliPoints: profile.pageHeight, xmlSha256: "a".repeat(64),
    plainTextSha256: "b".repeat(64), pageText: profile.nearText, words };
  const inspection = { ...inspectionBody,
    inspectionSha256: pythonHash(inspectionBody) } as IndependentPdfPageWords;
  return { source, result, inspection };
}

function rehashWorker(result: Record<string, unknown>) {
  const proposal = (result.proposals as Record<string, unknown>[])[0];
  const { proposalSha256: _oldProposal, ...proposalBody } = proposal;
  proposal.proposalSha256 = pythonHash(proposalBody);
  const { contentHash: _oldResult, ...body } = result;
  result.contentHash = pythonHash(body);
}

function rehashInspection(inspection: IndependentPdfPageWords) {
  const { inspectionSha256: _old, ...body } = inspection;
  inspection.inspectionSha256 = pythonHash(body);
}

test.each(["F0165", "F0160"] as FileId[])(
  "%s selected exclusion is corroborated, without fact or completeness", (fileId) => {
    const { source, result, inspection } = fixture(fileId);
    const receipt = replayEquipmentFalseNearSelectedSpanFromInspection(
      source, result, inspection);
    assert.equal(receipt?.status, "ABSTAIN");
    assert.equal(receipt?.providerId, "api-poppler-pdftotext-bbox-layout-v1@25.03.0");
    assert.deepEqual(receipt?.reasonCodes, ["PAGE_SCAN_COMPLETENESS_UNVERIFIED"]);
    assert.equal(receipt?.eligibility, "INELIGIBLE_FOR_PARAMETER_FACT");
    assert.equal(receipt?.durableSaveAllowed, false);
    assert.equal(receipt?.typedFact, null);
    assert.equal(receipt?.findingCount, null);
    assert.equal(receipt?.parameterCoverage, null);
  });

test.each(["F0165", "F0160"] as FileId[])(
  "%s rejects source, phrase, context and fact substitution", (fileId) => {
    const edits: Array<(item: ReturnType<typeof fixture>) => void> = [
      (item) => { item.source.split = "TEST_HIDDEN"; },
      (item) => { item.source.sha256 = "0".repeat(64); },
      (item) => { item.result.status = "PASS"; },
      (item) => { item.result.typedFact = { value: "fabricated" } as never; },
      (item) => { item.result.findingCount = 0 as never; },
      (item) => { item.result.parameterCoverage = "COMPLETE" as never; },
      (item) => { item.result.proposals[0].nearText = "wrong context"; },
      (item) => { item.result.proposals[0].eligibility = "ELIGIBLE"; },
      (item) => { item.result.proposals[0].wordLocators[0].rawText = "другое"; },
      (item) => { item.result.proposals[0].wordLocators[0].wordIndex += 1; },
      (item) => { item.result.proposals[0].wordLocators[0].bboxMilliPointsTopLeft[0] += 601; },
      (item) => { item.inspection.words[0].rawText = "другое"; },
      (item) => { item.inspection.words[0].bboxMilliPointsTopLeft[0] += 601; },
      (item) => { item.inspection.providerId = "api-poppler-pdftotext-bbox-layout-v1@25.12.0"; },
    ];
    edits.forEach((edit, index) => {
      const item = fixture(fileId); edit(item);
      rehashWorker(item.result);
      rehashInspection(item.inspection);
      assert.equal(replayEquipmentFalseNearSelectedSpanFromInspection(
        item.source, item.result, item.inspection), null, `tamper ${index}`);
    });
  });

test.each(["F0165", "F0160"] as FileId[])(
  "%s rejects duplicate exact phrase even with valid page receipt hash", (fileId) => {
    const item = fixture(fileId);
    const duplicated = structuredClone(item.inspection.words).map((word, index) => ({
      ...word, wordIndex: item.inspection.words.length + index,
    }));
    item.inspection.words.push(...duplicated);
    rehashInspection(item.inspection);
    assert.equal(replayEquipmentFalseNearSelectedSpanFromInspection(
      item.source, item.result, item.inspection), null);
  });

for (const fileId of ["F0165", "F0160"] as FileId[]) {
  const path = `/tmp/inspector-equipment-false-near-${fileId}.pdf`;
  test.skipIf(!existsSync(path))(
    `${fileId} accepts only independently re-extracted original under Poppler 25.03.0`, async () => {
    const { source, result } = fixture(fileId);
    const originalPdfBytes = readFileSync(path);
    assert.equal(sha256(originalPdfBytes), cases[fileId].sha);
    const receipt = await verifyEquipmentFalseNearSelectedSpan({
      originalPdfBytes, publicSource: source, result });
    assert.equal(receipt?.sourceFileId, fileId);
    assert.equal(receipt?.pageScanCompleteness, "UNVERIFIED");
    assert.ok(receipt!.maxBoxEdgeDeltaMilliPoints <= 600);
    assert.equal(await verifyEquipmentFalseNearSelectedSpan({
      originalPdfBytes: Buffer.from("not the original"), publicSource: source, result }), null);
    });
}
