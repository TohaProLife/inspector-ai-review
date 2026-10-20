import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NativeCapacityOrigin } from "../../../packages/contracts/src/native-capacity-comparison.js";
import { compareNativeCapacity, NATIVE_CAPACITY_LIMITS, verifyNativeCapacityComparisonHash } from "../src/native-capacity-comparison.js";
import { readDocumentTextV4FullArtifact } from "../src/document-text-v4.js";

const sha = (raw: string | Buffer) => createHash("sha256").update(raw).digest("hex");
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const profile = { schemaVersion: "document-text-extractor-profile-v1", textLayerSourceSha256: "1".repeat(64),
  documentTextV4SourceSha256: "2".repeat(64), pdfminerVersion: "20260107", geometryPolicyVersion: "document-text-v4-decimal-half-even-v1",
  cropPolicyVersion: "visible-crop-contained-epsilon-1e-6-v1", traversalPolicyVersion: "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1",
  qualityPolicyVersion: "document-text-quality-v4" };
const profileHash = sha(canonical({ hashDomain: "document-text-extractor-profile-v1", profile }));
const plainLine = (rawText: string, index: number) => ({ sourcePath: [index], rawText,
  nativeBoxPointStrings: ["20", "120", "230", "130"], bboxMilliPoints: [20000, 120000, 230000, 130000] });
function metrics(lines: any[], unlocated: any[]) {
  const chars = (rows: any[]) => [...rows.map(line => line.rawText).join("")].filter(c => !/\s/u.test(c)).length;
  return { locatedLineCount: lines.length, unlocatedLineCount: unlocated.length,
    locatedNonWhitespaceCharacters: chars(lines), unlocatedNonWhitespaceCharacters: chars(unlocated),
    replacementCharacters: 0, disallowedControlCharacters: 0, cidPlaceholders: 0 };
}
function artifact(texts: string[], id: string, digest: string): any {
  const lines = texts.map(plainLine), unlocated: any[] = [];
  return { schemaVersion: "document-text-v4", sourceFileId: id, inputSha256: digest,
    coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: 1, locatedTextPageCount: texts.length ? 1 : 0,
    unlocatedTextPageCount: 0, extractorProfile: structuredClone(profile), extractorProfileHash: profileHash,
    qualitySummary: { candidatePages: texts.length ? 1 : 0, partialPages: 0, ocrRequiredPages: texts.length ? 0 : 1 },
    pages: [{ pageNumber: 1, widthMilliPoints: 240000, heightMilliPoints: 160000,
      nativeFrame: { coordinateSystem: "PDFMINER_LAYOUT_POINTS", visibleBoxPointStrings: ["0", "0", "240", "160"] },
      locatedLines: lines, unlocatedLines: unlocated, quality: { disposition: texts.length ? "TEXT_LAYER_CANDIDATE" : "OCR_REQUIRED",
        reasonCodes: texts.length ? [] : ["NO_LOCATED_TEXT"], metrics: metrics(lines, unlocated) } }] };
}
function seal(a: any, role: "PD" | "RD" | "UNRESOLVED" = "PD"): NativeCapacityOrigin {
  const byteHash = sha(canonical(a)), contentHash = sha(canonical({ hashDomain: "document-text-v4-content-v1", artifact: a }));
  return { schemaVersion: "document-text-v4-full-source-read-v1", purpose: "SOURCE_AUDIT_ONLY",
    sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1", resourcePolicyVersion: "document-text-v4-full-source-bounds-v1",
    checkId: "CHECK-SYNTHETIC", sourceFileId: a.sourceFileId, sourceSha256: a.inputSha256,
    inputManifestHash: "c".repeat(64), textStageContentHash: byteHash, textArtifactByteSha256: byteHash,
    textArtifactContentHash: contentHash, extractorProfileHash: a.extractorProfileHash, stage: role,
    authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: a };
}
function pair(pd = ["«Школа на 600 мест, улица Примерная, 5»\n"], rd = ["Школа на 600 мест\n"]) {
  return [seal(artifact(pd, "PD", "a".repeat(64))), seal(artifact(rd, "RD", "b".repeat(64)), "RD")] as const;
}
function twoLine(value = "600"): any {
  const a = artifact(["Школа на\n", `${value} мест\n`], "PD", "a".repeat(64));
  a.pages[0].locatedLines[0] = { sourcePath: [23, 0], rawText: "Школа на\n",
    nativeBoxPointStrings: ["70", "120", "132", "134"], bboxMilliPoints: [70000, 120000, 132000, 134000] };
  a.pages[0].locatedLines[1] = { sourcePath: [23, 1], rawText: `${value} мест\n`,
    nativeBoxPointStrings: ["73", "101", "132", "115"], bboxMilliPoints: [73000, 101000, 132000, 115000] };
  return a;
}

it("independent whole-origin fixture validates and compares all unchanged quotes with immutable source-only semantics", () => {
  const [pd, rd] = pair(["😀 «Школа на 600 мест»\n", "Школа на 600 мест\n"]);
  expect(readDocumentTextV4FullArtifact(pd.textArtifact).status).toBe("VALID");
  const before = canonical([pd, rd]), r = compareNativeCapacity(pd, rd);
  expect(r).toMatchObject({ status: "COMPARED", comparison: "EQUAL", pdValue: "600", rdValue: "600", deltaRdMinusPd: "0",
    p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0, engineeringQualification: false, completeConfiguration: false });
  if (r.status !== "COMPARED") throw Error(r.reasonCode);
  expect(r.quotes.PD.map(q => q.rawText)).toEqual(pd.textArtifact.pages[0].locatedLines.map(l => l.rawText));
  expect(r.quotes.PD[0].matchedRangeCodePoints).toEqual([3, 20]);
  expect(r.quotes.PD[0].extractionMethod).toBe("NATIVE_SINGLE_LINE_TITLE");
  expect(r.sources.PD).toMatchObject({ checkId: pd.checkId, inputManifestHash: pd.inputManifestHash,
    sourceSha256: pd.sourceSha256, textArtifactByteSha256: pd.textArtifactByteSha256,
    textArtifactContentHash: pd.textArtifactContentHash, extractorProfileHash: pd.extractorProfileHash,
    roleQualification: "UNVERIFIED", scannedNativeLineCount: 2 });
  expect(Object.isFrozen(r.quotes.PD[0].sourcePath)).toBe(true);
  expect(Object.isFrozen(pd.textArtifact)).toBe(false); expect(canonical([pd, rd])).toBe(before);
  expect(compareNativeCapacity(pd, rd)).toEqual(r);
  const { contentHash, ...body } = r;
  expect(contentHash).toBe(sha(canonical({ hashDomain: "native-capacity-comparison-v1", result: body })));
  expect(JSON.stringify(r)).not.toMatch(/NO_VIOLATION|CONFIRMED_VIOLATION/);
});
it("saved JSON hash verification survives object key order and rejects nested or hash tampering without invoking getters", () => {
  const r = compareNativeCapacity(...pair()), saved = JSON.parse(JSON.stringify(r));
  expect(verifyNativeCapacityComparisonHash(saved)).toBe(true);
  expect(verifyNativeCapacityComparisonHash(Object.fromEntries(Object.entries(saved).reverse()) as any)).toBe(true);
  saved.sources.PD.extractorProfile.pdfminerVersion = "DIFFERENT";
  expect(verifyNativeCapacityComparisonHash(saved)).toBe(false);
  saved.contentHash = "0".repeat(64); expect(verifyNativeCapacityComparisonHash(saved)).toBe(false);
  const abstained = compareNativeCapacity(...pair(["Без декларации"]));
  expect(verifyNativeCapacityComparisonHash(JSON.parse(JSON.stringify(abstained)))).toBe(true);
  let calls = 0; const getter = { ...r }; Object.defineProperty(getter, "quotes", { enumerable: true, get: () => { calls++; return {}; } });
  expect(verifyNativeCapacityComparisonHash(getter as any)).toBe(false); expect(calls).toBe(0);
  const proxy = new Proxy(r, {}); expect(verifyNativeCapacityComparisonHash(proxy)).toBe(false);
});
it.each([["500", "DECREASE", "-100"], ["700", "INCREASE", "100"]])("source arithmetic600→%s has correct signed delta only", (value, comparison, delta) => {
  expect(compareNativeCapacity(...pair(undefined, [`Школа на ${value} мест\n`]))).toMatchObject({ status: "COMPARED", comparison, deltaRdMinusPd: delta });
});
it("accepts horizontal NBSP separators and case; preserves exact codepoint ranges/raw", () => {
  const text = "«ШКОЛА\u00a0на\u202f600 мест»\n", r = compareNativeCapacity(...pair([text]));
  expect(r.status).toBe("COMPARED"); if (r.status === "COMPARED") expect(r.quotes.PD[0].rawText).toBe(text);
});
it("keeps an explicitly selected mixed source role unverified", () => {
  const [pd, rd] = pair(); rd.stage = "UNRESOLVED";
  const r = compareNativeCapacity(pd, rd); expect(r).toMatchObject({ status: "COMPARED", sources: { RD: { declaredStage: "UNRESOLVED", selectedRole: "RD", roleQualification: "UNVERIFIED" } } });
  expect(r.notices).toContain("SOURCE_ROLE_UNVERIFIED");
});
it.each(["600", "700"])("explicit same-block two-line title reads%s without joining either raw line", value => {
  const pd = seal(twoLine(value)), [, rd] = pair(undefined, [`Школа на ${value} мест\n`]);
  const r = compareNativeCapacity(pd, rd); expect(r).toMatchObject({ status: "COMPARED", pdValue: value, rdValue: value });
  if (r.status !== "COMPARED") throw Error(r.reasonCode);
  expect(r.quotes.PD[0]).toMatchObject({ extractionMethod: "NATIVE_SAME_BLOCK_TWO_LINE_TITLE", rawText: `${value} мест\n`, sourcePath: [23, 1],
    contextTitleLine: { sourcePath: [23, 0], rawText: "Школа на\n", bboxMilliPoints: [70000, 120000, 132000, 134000] } });
  expect(r.quotes.PD).toHaveLength(1); expect(r.excludedTitleFragments).toHaveLength(0);
});
it("two-line overlap80percent and gap2heights boundaries are inclusive, one milli-point outside refuses", () => {
  for (const over of [false, true]) {
    const a = twoLine(), line = a.pages[0].locatedLines[1];
    line.bboxMilliPoints = [82400 + Number(over), 78000, 144400 + Number(over), 92000];
    line.nativeBoxPointStrings = over ? ["82.401", "78", "144.401", "92"] : ["82.4", "78", "144.4", "92"];
    expect(compareNativeCapacity(seal(a), pair()[1]).status).toBe(over ? "ABSTAIN" : "COMPARED");
  }
  const a = twoLine(), line = a.pages[0].locatedLines[1];
  line.bboxMilliPoints = [73000, 77999, 132000, 91999]; line.nativeBoxPointStrings = ["73", "77.999", "132", "91.999"];
  expect(compareNativeCapacity(seal(a), pair()[1])).toMatchObject({ status: "ABSTAIN", reasonCode: "TITLE_CONTINUATION_UNRESOLVED" });
});
it("same-block split700 conflicts with a complete600 declaration", () => {
  const a = twoLine("700"); a.pages[0].locatedLines.push({ ...plainLine("Школа на 600 мест\n", 24), sourcePath: [24, 0] });
  a.pages[0].quality.metrics = metrics(a.pages[0].locatedLines, []);
  expect(compareNativeCapacity(seal(a), pair()[1])).toMatchObject({ status: "ABSTAIN", reasonCode: "CAPACITY_DECLARATIONS_CONFLICT" });
});
it("two quantity continuations and two quantities after a title are ambiguous", () => {
  const a = twoLine(); a.pages[0].locatedLines.push({ ...plainLine("700 мест\n", 24), sourcePath: [23, 2] });
  a.pages[0].quality.metrics = metrics(a.pages[0].locatedLines, []);
  expect(compareNativeCapacity(seal(a), pair()[1])).toMatchObject({ status: "ABSTAIN", reasonCode: "AMBIGUOUS_TITLE_ENTITY" });
  expect(compareNativeCapacity(...pair(["Школа на 600 мест и 700 мест\n"]))).toMatchObject({ status: "ABSTAIN", reasonCode: "AMBIGUOUS_TITLE_ENTITY" });
  expect(compareNativeCapacity(...pair(["Школа на 600 мест/700\n"]))).toMatchObject({ status: "ABSTAIN", reasonCode: "UNSUPPORTED_TITLE_GRAMMAR" });
});
it.each(["next block", "child gap", "path depth", "vertical gap", "horizontal overlap", "quantity above", "reordered"])("rejects unsupported two-line relation:%s", mode => {
  const a = twoLine(), lines = a.pages[0].locatedLines;
  if (mode === "next block") lines[1].sourcePath = [24, 0];
  if (mode === "child gap") lines[1].sourcePath = [23, 2];
  if (mode === "path depth") { lines[0].sourcePath = [0]; lines[1].sourcePath = [1]; }
  if (mode === "vertical gap") { lines[1].bboxMilliPoints = [73000, 51000, 132000, 65000]; lines[1].nativeBoxPointStrings = ["73", "51", "132", "65"]; }
  if (mode === "horizontal overlap") { lines[1].bboxMilliPoints = [120000, 101000, 179000, 115000]; lines[1].nativeBoxPointStrings = ["120", "101", "179", "115"]; }
  if (mode === "quantity above") { lines[1].bboxMilliPoints = [73000, 137000, 132000, 151000]; lines[1].nativeBoxPointStrings = ["73", "137", "132", "151"]; }
  if (mode === "reordered") { [lines[0].rawText, lines[1].rawText] = [lines[1].rawText, lines[0].rawText]; }
  const r = compareNativeCapacity(seal(a), pair()[1]);
  expect(r).toMatchObject({ status: "ABSTAIN", reasonCode: "TITLE_CONTINUATION_UNRESOLVED" });
  expect(r).not.toHaveProperty("pdValue"); expect(r.excludedTitleFragments[0].continuationLines).toHaveLength(1);
});
it.each(["0 мест\n", "0600 мест\n", "600.5 мест\n", "600/700 мест\n", "600 или700 мест\n", "600\n"])("refuses malformed quantity continuation%s", text => {
  const a = twoLine(); a.pages[0].locatedLines[1].rawText = text; a.pages[0].quality.metrics = metrics(a.pages[0].locatedLines, []);
  expect(compareNativeCapacity(seal(a), pair()[1])).toMatchObject({ status: "ABSTAIN", reasonCode: "TITLE_CONTINUATION_UNRESOLVED" });
});
it("retains a value-free unsupported fragment separately without inferring quantity/completeness", () => {
  const [pd, rd] = pair(["Школа на 600 мест\n", "Школа на\n", "Наименование объекта\n"]);
  const r = compareNativeCapacity(pd, rd); expect(r.status).toBe("COMPARED");
  expect(r.notices).toContain("NATIVE_TITLE_FRAGMENTS_UNRESOLVED");
  expect(r.excludedTitleFragments).toMatchObject([{ reason: "TITLE_WITHOUT_QUANTITY", rawText: "Школа на\n", sourcePath: [1], continuationLines: [] }]);
});
it.each(["Школа на 0 мест", "Школа на 0600 мест", "Школа на 600.5 мест", "Школа на 1000000 мест", "Школа на 600", "Школа на рабочих местах"])("unsupported titlegrammar fails closed:%s", text => {
  expect(compareNativeCapacity(...pair([text]))).toMatchObject({ status: "ABSTAIN", reasonCode: "UNSUPPORTED_TITLE_GRAMMAR" });
});
it("no keyword/unsupported other form yields missing evidence, never absence or zero", () => {
  for (const text of ["Вместимость школы600", "Учебное здание на 600 мест", "Школа рассчитана на600мест", "Автошкола на 600 мест"]) {
    const r = compareNativeCapacity(...pair([text])); expect(r).toMatchObject({ status: "ABSTAIN", reasonCode: "CAPACITY_EVIDENCE_MISSING" });
    expect(r).not.toHaveProperty("quotes"); expect(r).not.toHaveProperty("pdValue");
  }
});
it("conflicting complete declarations or two entities in one line refuse all partial results", () => {
  expect(compareNativeCapacity(...pair(["Школа на 600 мест", "Школа на 700 мест"]))).toMatchObject({ status: "ABSTAIN", reasonCode: "CAPACITY_DECLARATIONS_CONFLICT" });
  expect(compareNativeCapacity(...pair(["Школа на 600 мест и школа на 700 мест"]))).toMatchObject({ status: "ABSTAIN", reasonCode: "AMBIGUOUS_TITLE_ENTITY" });
});
it.each(["manifest", "check", "source id", "source hash", "pd role", "rd role"])("rejects pair binding substitution:%s", mode => {
  const [pd, rd] = pair(); let reason = "PAIR_SCOPE_MISMATCH";
  if (mode === "manifest") rd.inputManifestHash = "d".repeat(64);
  if (mode === "check") rd.checkId = "FOREIGN-CHECK";
  if (mode === "source id") { rd.sourceFileId = pd.sourceFileId; reason = "IDENTICAL_SOURCE"; }
  if (mode === "source hash") { rd.sourceSha256 = pd.sourceSha256; reason = "IDENTICAL_SOURCE"; }
  if (mode === "pd role") { pd.stage = "RD"; reason = "SOURCE_ROLE_CONFLICT"; }
  if (mode === "rd role") { rd.stage = "PD"; reason = "SOURCE_ROLE_CONFLICT"; }
  expect(compareNativeCapacity(pd, rd)).toMatchObject({ status: "ABSTAIN", reasonCode: reason });
});
it.each(["sourceSha256", "sourceFileId", "textStageContentHash", "textArtifactByteSha256", "textArtifactContentHash", "extractorProfileHash"])("refuses origin/artifact substitution:%s", field => {
  const [pd, rd] = pair(); (pd as any)[field] = field === "sourceFileId" ? "OTHER" : "e".repeat(64);
  expect(compareNativeCapacity(pd, rd)).toMatchObject({ status: "ABSTAIN", reasonCode: field === "extractorProfileHash" ? "EXTRACTOR_PROFILE_MISMATCH" : "ORIGIN_ARTIFACT_MISMATCH" });
});
it("otherwise valid historical extractor substitution cannot cross a shared run/release profile", () => {
  const [pd, rd] = pair(), a = structuredClone(rd.textArtifact); a.extractorProfile.textLayerSourceSha256 = "e".repeat(64);
  a.extractorProfileHash = sha(canonical({ hashDomain: "document-text-extractor-profile-v1", profile: a.extractorProfile }));
  expect(readDocumentTextV4FullArtifact(a).status).toBe("VALID");
  expect(compareNativeCapacity(pd, seal(a, "RD"))).toMatchObject({ status: "ABSTAIN", reasonCode: "EXTRACTOR_PROFILE_MISMATCH" });
});
it("refuses resealed invalid geometry/quality/profile and complete artifact damage on unrelated last page", () => {
  for (const mutate of [(a: any) => a.pages[0].locatedLines[0].bboxMilliPoints[0]++, (a: any) => a.pages[0].quality.metrics.locatedLineCount++,
    (a: any) => a.extractorProfileHash = "f".repeat(64), (a: any) => a.pageCount++]) {
    const [pd, rd] = pair(), a = structuredClone(pd.textArtifact); mutate(a);
    expect(compareNativeCapacity(seal(a), rd)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
  }
  const [pd, rd] = pair(), a = structuredClone(pd.textArtifact), last = structuredClone(a.pages[0]);
  last.pageNumber = 2; last.locatedLines[0].rawText = "Нейтральная строка\n";
  last.quality.metrics = metrics(last.locatedLines, []); a.pages.push(last); a.pageCount = 2;
  a.locatedTextPageCount = 2; a.qualitySummary.candidatePages = 2;
  last.locatedLines[0].bboxMilliPoints[3]++;
  expect(compareNativeCapacity(seal(a), rd)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
});
it("rejects getters/proxies/cycles before callbacks and rejects complete source-read widening", () => {
  const [pd, rd] = pair(); let calls = 0;
  const getter = { ...pd }; Object.defineProperty(getter, "textArtifact", { enumerable: true, get: () => { calls++; return pd.textArtifact; } });
  for (const value of [getter, new Proxy(pd, {}), { ...pd, latestReviewHash: null }]) expect(compareNativeCapacity(value as any, rd)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_ORIGIN" });
  expect(calls).toBe(0);
});
it("refuses unlocated matching title and matched partial-page source", () => {
  const a = artifact(["Нейтральная строка\n"], "PD", "a".repeat(64));
  a.pages[0].unlocatedLines = [{ sourcePath: [1], rawText: "Школа на 700 мест\n", nativeBoxPointStrings: ["20", "120", "20", "130"], reasonCode: "NATIVE_ZERO_AREA" }];
  a.unlocatedTextPageCount = 1; a.qualitySummary = { candidatePages: 0, partialPages: 1, ocrRequiredPages: 0 };
  a.pages[0].quality = { disposition: "PARTIAL_TEXT_LAYER", reasonCodes: ["UNLOCATED_TEXT_PRESENT"], metrics: metrics(a.pages[0].locatedLines, a.pages[0].unlocatedLines) };
  expect(readDocumentTextV4FullArtifact(a).status).toBe("VALID");
  expect(compareNativeCapacity(seal(a), pair()[1])).toMatchObject({ status: "ABSTAIN", reasonCode: "UNLOCATED_TITLE" });
  a.pages[0].locatedLines[0].rawText = "Школа на 600 мест\n"; a.pages[0].unlocatedLines[0].rawText = "Иной фрагмент\n";
  a.pages[0].quality.metrics = metrics(a.pages[0].locatedLines, a.pages[0].unlocatedLines);
  expect(compareNativeCapacity(seal(a), pair()[1])).toMatchObject({ status: "ABSTAIN", reasonCode: "MATCHING_PAGE_UNVERIFIED" });
});
it("quote cap and quote-byte cap refuse instead of silently returning early declarations", () => {
  const tooMany = artifact(Array.from({ length: NATIVE_CAPACITY_LIMITS.maxQuotesPerSource + 1 }, () => "Школа на 600 мест\n"), "PD", "a".repeat(64));
  expect(readDocumentTextV4FullArtifact(tooMany).status).toBe("VALID");
  const r = compareNativeCapacity(seal(tooMany), pair()[1]); expect(r).toMatchObject({ status: "ABSTAIN", reasonCode: "INPUT_LIMIT" }); expect(r).not.toHaveProperty("quotes");
  const large = artifact([`Школа на 600 мест, ${"Ж".repeat(NATIVE_CAPACITY_LIMITS.maxQuoteUtf8BytesPerSource / 2)}\n`], "PD", "a".repeat(64));
  expect(compareNativeCapacity(seal(large), pair()[1])).toMatchObject({ status: "ABSTAIN", reasonCode: "INPUT_LIMIT" });
  const [pd, rd] = pair(); (pd.textArtifact as any).pages = Array(1025).fill(null);
  expect(compareNativeCapacity(pd, rd)).toMatchObject({ status: "ABSTAIN", reasonCode: "INPUT_LIMIT" });
});

const realPd = process.env.INSPECTOR_NATIVE_CAPACITY_PD_V4, realRd = process.env.INSPECTOR_NATIVE_CAPACITY_RD_V4;
(realPd && realRd ? describe : describe.skip)("explicit real public whole-PDF V4 replay (not a calibration or authority test)", () => {
  it("authenticates pinned originals/artifacts and preserves30PD/9RDdeclarations including same-block pair", () => {
    const pdBytes = readFileSync(realPd!), rdBytes = readFileSync(realRd!);
    expect(sha(pdBytes)).toBe("39860d4278f002cfd43a598a97b6b0c4849b38ed6bed2cb5561f820e1e55ef09");
    expect(sha(rdBytes)).toBe("64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9");
    const pd = seal(JSON.parse(pdBytes.toString())), rd = seal(JSON.parse(rdBytes.toString()), "UNRESOLVED");
    expect(pd.sourceSha256).toBe("a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc");
    expect(rd.sourceSha256).toBe("0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd");
    const r = compareNativeCapacity(pd, rd); expect(r).toMatchObject({ status: "COMPARED", comparison: "EQUAL", pdValue: "600", rdValue: "600", deltaRdMinusPd: "0" });
    if (r.status !== "COMPARED") throw Error(r.reasonCode);
    expect(r.quotes.PD).toHaveLength(30); expect(r.quotes.RD).toHaveLength(9);
    expect(r.quotes.PD.filter(q => q.extractionMethod === "NATIVE_SAME_BLOCK_TWO_LINE_TITLE")).toMatchObject([{ physicalPage: 71,
      sourcePath: [23, 1], rawText: "600 мест  \n", contextTitleLine: { sourcePath: [23, 0], rawText: "Школа на \n" } }]);
    expect(r.quotes.RD[0]).toMatchObject({ physicalPage: 1, sourcePath: [2, 0], bboxMilliPoints: [111680, 565395, 501435, 579375] });
    expect(r.excludedTitleFragments).toHaveLength(0);
  }, 30000);
});
