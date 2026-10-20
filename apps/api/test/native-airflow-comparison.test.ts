import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NativeAirflowOrigin, NativeAirflowSelection } from "../../../packages/contracts/src/native-airflow-comparison.js";
import { compareNativeAirflow, NATIVE_AIRFLOW_LIMITS, verifyNativeAirflowComparisonHash } from "../src/native-airflow-comparison.js";
import { readDocumentTextV4FullArtifact } from "../src/document-text-v4.js";

// Independent hand-authored origin/geometry/hash fixture, no product fixture builders.
const sha = (raw: string | Buffer) => createHash("sha256").update(raw).digest("hex");
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const profile = { schemaVersion: "document-text-extractor-profile-v1", textLayerSourceSha256: "1".repeat(64),
  documentTextV4SourceSha256: "2".repeat(64), pdfminerVersion: "20260107", geometryPolicyVersion: "document-text-v4-decimal-half-even-v1",
  cropPolicyVersion: "visible-crop-contained-epsilon-1e-6-v1", traversalPolicyVersion: "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1",
  qualityPolicyVersion: "document-text-quality-v4" };
const profileHash = sha(canonical({ hashDomain: "document-text-extractor-profile-v1", profile }));
const line = (rawText: string, index: number) => ({ sourcePath: [index], rawText,
  nativeBoxPointStrings: ["20", "120", "230", "130"] as [string, string, string, string],
  bboxMilliPoints: [20000, 120000, 230000, 130000] as [number, number, number, number] });
function metrics(lines: any[], unlocated: any[]) {
  const chars = (rows: any[]) => [...rows.map(l => l.rawText).join("")].filter(c => !/\s/u.test(c)).length;
  return { locatedLineCount: lines.length, unlocatedLineCount: unlocated.length,
    locatedNonWhitespaceCharacters: chars(lines), unlocatedNonWhitespaceCharacters: chars(unlocated),
    replacementCharacters: 0, disallowedControlCharacters: 0, cidPlaceholders: 0 };
}
function artifact(texts: string[], id: string, digest: string): any {
  const lines = texts.map(line), unlocated: any[] = [];
  return { schemaVersion: "document-text-v4", sourceFileId: id, inputSha256: digest,
    coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: 1, locatedTextPageCount: texts.length ? 1 : 0,
    unlocatedTextPageCount: 0, extractorProfile: structuredClone(profile), extractorProfileHash: profileHash,
    qualitySummary: { candidatePages: texts.length ? 1 : 0, partialPages: 0, ocrRequiredPages: texts.length ? 0 : 1 },
    pages: [{ pageNumber: 1, widthMilliPoints: 240000, heightMilliPoints: 160000,
      nativeFrame: { coordinateSystem: "PDFMINER_LAYOUT_POINTS", visibleBoxPointStrings: ["0", "0", "240", "160"] },
      locatedLines: lines, unlocatedLines: unlocated, quality: { disposition: texts.length ? "TEXT_LAYER_CANDIDATE" : "OCR_REQUIRED",
        reasonCodes: texts.length ? [] : ["NO_LOCATED_TEXT"], metrics: metrics(lines, unlocated) } }] };
}
function seal(a: any, stage: "PD" | "RD" | "UNRESOLVED" = "PD"): NativeAirflowOrigin {
  const byte = sha(canonical(a)), semantic = sha(canonical({ hashDomain: "document-text-v4-content-v1", artifact: a }));
  return { schemaVersion: "document-text-v4-full-source-read-v1", purpose: "SOURCE_AUDIT_ONLY",
    sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1", resourcePolicyVersion: "document-text-v4-full-source-bounds-v1",
    checkId: "OFFLINE-SYNTHETIC-CHECK", sourceFileId: a.sourceFileId, sourceSha256: a.inputSha256, inputManifestHash: "c".repeat(64),
    textStageContentHash: byte, textArtifactByteSha256: byte, textArtifactContentHash: semantic, extractorProfileHash: a.extractorProfileHash,
    stage, authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: a };
}
const declaration = (id: string, value: string, pressure = "540") => `${id} (L=${value} м3/ч, Pc=${pressure} Па)\n`;
const selected: NativeAirflowSelection = { pdSystemId: "П17", rdSystemIds: ["П17.1", "П17.2"] };
function pair(pd = [declaration("П17", "9060", "350")], rd = [declaration("П17.1", "3340"), declaration("П17.2", "5720")]) {
  return [seal(artifact(pd, "PD", "a".repeat(64))), seal(artifact(rd, "RD", "b".repeat(64)), "RD")] as const;
}
const run = (pd?: string[], rd?: string[], selection = selected) => compareNativeAirflow(...pair(pd, rd), selection);

it("compares independently authored whole V4 origins, preserves every quote/frame/hash, and never mutates inputs", () => {
  const [pd, rd] = pair(); expect(readDocumentTextV4FullArtifact(pd.textArtifact).status).toBe("VALID");
  const before = canonical([pd, rd, selected]), r = compareNativeAirflow(pd, rd, selected);
  expect(r).toMatchObject({ status: "COMPARED", comparison: "EQUAL", pdValue: "9060", rdValue: "9060", deltaRdMinusPd: "0",
    purpose: "SOURCE_ONLY", associatedParameterCode: "IOS4-079", parameterMappingStatus: "PUBLIC_MAPPING_CONFLICT",
    p: null, calibratedProbability: null, factEligible: false, coverageDelta: 0, engineeringQualification: false, completeConfiguration: false });
  if (r.status !== "COMPARED") throw Error(r.reasonCode);
  expect(r.quotes.PD[0]).toMatchObject({ rawText: declaration("П17", "9060", "350"), rawValue: "9060", value: "9060", rawUnit: "м3/ч",
    unit: "м³/ч", freePressurePa: "350", extractionMethod: "NATIVE_SINGLE_LINE_SYSTEM_AIRFLOW", sourcePath: [0],
    nativeFrame: pd.textArtifact.pages[0].nativeFrame, bboxMilliPoints: [20000, 120000, 230000, 130000], matchedRangeCodePoints: [7, 11] });
  expect(r.memberValues.RD).toEqual([{ systemId: "П17.1", value: "3340", freePressurePa: "540", unit: "м³/ч", quoteCount: 1 },
    { systemId: "П17.2", value: "5720", freePressurePa: "540", unit: "м³/ч", quoteCount: 1 }]);
  expect(r.sources.PD).toMatchObject({ checkId: pd.checkId, inputManifestHash: pd.inputManifestHash, textArtifactByteSha256: pd.textArtifactByteSha256,
    textArtifactContentHash: pd.textArtifactContentHash, extractorProfileHash: profileHash, scannedNativeLineCount: 1, roleQualification: "UNVERIFIED" });
  expect(Object.isFrozen(r.quotes.PD[0].nativeFrame.visibleBoxPointStrings)).toBe(true);
  expect(Object.isFrozen(r.selection.rdSystemIds)).toBe(true); expect(Object.isFrozen(selected.rdSystemIds)).toBe(false);
  expect(Object.isFrozen(pd.textArtifact)).toBe(false); expect(canonical([pd, rd, selected])).toBe(before);
  expect(compareNativeAirflow(pd, rd, selected)).toEqual(r);
  const { contentHash, ...body } = r; expect(contentHash).toBe(sha(canonical({ hashDomain: "native-airflow-comparison-v1", result: body })));
  expect(JSON.stringify(r)).not.toMatch(/NO_VIOLATION|CONFIRMED_VIOLATION/);
});
it("counts each exact member once, retains repeated quotes, and never deduplicates distinct members by equal value", () => {
  const r = run(undefined, ["Проект: " + declaration("П17.1", "3340"), declaration("П17.1", "3340"),
    "Итого по " + declaration("П17.1", "3340"), declaration("П17.2", "5720")]);
  expect(r).toMatchObject({ status: "COMPARED", rdValue: "9060", memberValues: { RD: [{ quoteCount: 3 }, { quoteCount: 1 }] } });
  if (r.status === "COMPARED") expect(r.quotes.RD).toHaveLength(4);
  expect(run([declaration("П17", "6680")], [declaration("П17.1", "3340"), declaration("П17.2", "3340")])).toMatchObject({ status: "COMPARED", rdValue: "6680", comparison: "EQUAL" });
});
it.each([["3000", "DECREASE", "-340"], ["4000", "INCREASE", "660"]])("signed exact source delta for selected member%s", (value, comparison, delta) => {
  expect(run(undefined, [declaration("П17.1", value), declaration("П17.2", "5720")])).toMatchObject({ status: "COMPARED", comparison, deltaRdMinusPd: delta });
});
it("sums16 distinct selected CyrillicП/В members exactly and preserves explicit selection order", () => {
  const ids = Array.from({ length: 16 }, (_, n) => `${n % 2 ? "В" : "П"}${n + 1}.10`), texts = ids.map(id => declaration(id, "999999999999"));
  const r = run([declaration("В1", "1")], texts, { pdSystemId: "В1", rdSystemIds: ids });
  expect(r).toMatchObject({ status: "COMPARED", rdValue: "15999999999984", deltaRdMinusPd: "15999999999983", selection: { rdSystemIds: ids } });
});
it("retains all bound plain references including multiple systems andККБ without creating extra members", () => {
  const r = run(["Приточные установки систем П3, П17, П18 оборудованы\n", "П17/ККБ\n", declaration("П17", "9060")],
    ["П17.1 П17.2\n", "Проект: ККБ для П17.1\n", declaration("П17.1", "3340"), declaration("П17.2", "5720")]);
  expect(r.status).toBe("COMPARED"); if (r.status !== "COMPARED") throw Error(r.reasonCode);
  expect(r.references.PD).toHaveLength(2); expect(r.references.RD).toHaveLength(2);
  expect(r.references.RD[0]).toMatchObject({ systemIds: ["П17.1", "П17.2"], rawText: "П17.1 П17.2\n", reason: "SELECTED_SYSTEM_REFERENCE_WITHOUT_AIRFLOW" });
  expect(r.sources.RD.scannedNativeLineCount).toBe(4);
});
it("never infers suffix membership, physical grouping, same mode, or role qualification", () => {
  const r = run([declaration("В4", "9060")], undefined, { pdSystemId: "В4", rdSystemIds: ["П17.2", "П17.1"] });
  expect(r).toMatchObject({ status: "COMPARED", selection: { pdSystemId: "В4", rdSystemIds: ["П17.2", "П17.1"] } });
  expect(r.notices).toContain("PHYSICAL_GROUP_AND_OPERATING_MODE_UNVERIFIED");
  const [pd, rd] = pair(); rd.stage = "UNRESOLVED";
  expect(compareNativeAirflow(pd, rd, selected)).toMatchObject({ status: "COMPARED", sources: { RD: { declaredStage: "UNRESOLVED", roleQualification: "UNVERIFIED" } } });
});
it.each(["П170", "П17.10", "П17.100", "В17.1", "P17.1", "АП17.1", "П17.1A"])("does not bind unselected or substring system%s", id => {
  const r = run(undefined, [declaration(id, "3340"), declaration("П17.2", "5720")]);
  expect(r).toMatchObject({ status: "ABSTAIN", reasonCode: id === "П17.1A" ? "UNSUPPORTED_AIRFLOW_GRAMMAR" : "SELECTED_MEMBER_EVIDENCE_MISSING" });
});
it("ignores complete unselected-system declarations with conflicting values", () => {
  expect(run(undefined, [declaration("П17.10", "999"), declaration("П170", "999"), declaration("П17.1", "3340"), declaration("П17.2", "5720")])).toMatchObject({ status: "COMPARED", rdValue: "9060" });
});
it("П17 never bindsП170 or suffix systems; exact selectedП17.10 remains independently selectable", () => {
  expect(run([declaration("П170", "9060"), declaration("П17.10", "9060")])).toMatchObject({ status: "ABSTAIN", reasonCode: "SELECTED_MEMBER_EVIDENCE_MISSING" });
  expect(run([declaration("П17", "9060"), declaration("П170", "999"), declaration("П17.10", "999")])).toMatchObject({ status: "COMPARED", pdValue: "9060" });
  expect(run([declaration("П17.10", "9060")], undefined, { pdSystemId: "П17.10", rdSystemIds: selected.rdSystemIds })).toMatchObject({ status: "COMPARED", pdValue: "9060" });
});
it.each(["value", "pressure"])("conflicting%s declarations for one selected member refuse all partial evidence", field => {
  const bad = declaration("П17.1", field === "value" ? "3000" : "3340", field === "pressure" ? "550" : "540");
  const r = run(undefined, [declaration("П17.1", "3340"), declaration("П17.2", "5720"), bad]);
  expect(r).toMatchObject({ status: "ABSTAIN", reasonCode: "AIRFLOW_DECLARATIONS_CONFLICT" }); expect(r).not.toHaveProperty("quotes"); expect(r).not.toHaveProperty("pdValue");
});
it.each(["П17.1 (L=-3340 м3/ч, Pc=540 Па)", "П17.1 (L=0 м3/ч, Pc=540 Па)", "П17.1 (L=03340 м3/ч, Pc=540 Па)",
  "П17.1 (L=3340.5 м3/ч, Pc=540 Па)", "П17.1 (L=3340,5 м3/ч, Pc=540 Па)", "П17.1 (L=3e3 м3/ч, Pc=540 Па)",
  "П17.1 (L=3340 м³/ч, Pc=540 Па)", "П17.1 (L=3340 м3/с, Pc=540 Па)", "П17.1 (L=3340 м3/ч, Pc=0 Па)",
  "П17.1 (L=3340 м3/ч, Pc=0540 Па)", "П17.1 (L=3340 м3/ч, Pc=-540 Па)", "П17.1 (L=3340 м3/ч, Pc=540 кПа)",
  "летний П17.1 (L=3340 м3/ч, Pc=540 Па)", "П17.1 (L=3340 м3/ч, Pc=540 Па) зимой", "П17.1 3340",
  "П17.1 (L=3340/3000 м3/ч, Pc=540 Па)", "П17.1 (L=3340 м3/ч, Pc=540 Па)\nL=3000",
  "П17.1.2 (L=3340 м3/ч, Pc=540 Па)", "П17.1..2 (L=3340 м3/ч, Pc=540 Па)", "П17.1 (L=1000000000000 м3/ч, Pc=540 Па)"])("malformed selected value-bearing line refuses:%s", bad => {
  expect(run(undefined, [declaration("П17.1", "3340"), declaration("П17.2", "5720"), bad])).toMatchObject({ status: "ABSTAIN", reasonCode: "UNSUPPORTED_AIRFLOW_GRAMMAR" });
});
it("two selected value-bearing system entities in one line are ambiguous", () => {
  expect(run(undefined, [declaration("П17.1", "3340") + declaration("П17.2", "5720")])).toMatchObject({ status: "ABSTAIN", reasonCode: "AMBIGUOUS_SELECTED_SYSTEM" });
});
it("plain references or absent supported declaration never imply absence/zero", () => {
  const r = run(["П17\n", "Проект: ККБ для П17\n"]); expect(r).toMatchObject({ status: "ABSTAIN", reasonCode: "SELECTED_MEMBER_EVIDENCE_MISSING" });
  expect(r).not.toHaveProperty("pdValue"); expect(r).not.toHaveProperty("references");
});
it.each([null, {}, { ...selected, extra: true }, { ...selected, rdSystemIds: [] }, { ...selected, rdSystemIds: ["П17.1", "П17.1"] },
  { ...selected, rdSystemIds: Array.from({ length: 17 }, (_, i) => `П${i + 1}`) }, { ...selected, rdSystemIds: new Array(1) },
  ...["P17", "п17", "П0", "П017", "П17.0", "П17.01", "П17.1.2", "П17\n", "П1000000", "П17.1000000", " П17", "П17 "].map(pdSystemId => ({ ...selected, pdSystemId }))])("invalid/ambiguous user selection refuses:%j", selection => {
  expect(compareNativeAirflow(...pair(), selection as any)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_SELECTION" });
});
it("selection accessors/proxies/symbol fields/array callbacks never execute", () => {
  let calls = 0; const getter = { ...selected }; Object.defineProperty(getter, "rdSystemIds", { enumerable: true, get: () => { calls++; return []; } });
  const items: any[] = ["П17.1"]; Object.defineProperty(items, "0", { enumerable: true, get: () => { calls++; return "П17.1"; } });
  for (const value of [getter, new Proxy(selected, {}), { ...selected, rdSystemIds: new Proxy(["П17.1"], {}) },
    { ...selected, rdSystemIds: items }, { ...selected, [Symbol("x")]: true }]) {
    expect(compareNativeAirflow(...pair(), value as any)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_SELECTION" });
  }
  expect(calls).toBe(0);
});
it.each(["manifest", "check", "source id", "source hash", "pd role", "rd role"])("rejects whole-origin pair substitution:%s", mode => {
  const [pd, rd] = pair(); let reason = "PAIR_SCOPE_MISMATCH";
  if (mode === "manifest") rd.inputManifestHash = "d".repeat(64);
  if (mode === "check") rd.checkId = "OTHER-RUN";
  if (mode === "source id") { rd.sourceFileId = pd.sourceFileId; reason = "IDENTICAL_SOURCE"; }
  if (mode === "source hash") { rd.sourceSha256 = pd.sourceSha256; reason = "IDENTICAL_SOURCE"; }
  if (mode === "pd role") { pd.stage = "RD"; reason = "SOURCE_ROLE_CONFLICT"; }
  if (mode === "rd role") { rd.stage = "PD"; reason = "SOURCE_ROLE_CONFLICT"; }
  expect(compareNativeAirflow(pd, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: reason });
});
it.each(["sourceSha256", "sourceFileId", "textStageContentHash", "textArtifactByteSha256", "textArtifactContentHash", "extractorProfileHash"])("rejects origin/artifact mismatch:%s", field => {
  const [pd, rd] = pair(); (pd as any)[field] = field === "sourceFileId" ? "OTHER" : "e".repeat(64);
  expect(compareNativeAirflow(pd, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: field === "extractorProfileHash" ? "EXTRACTOR_PROFILE_MISMATCH" : "ORIGIN_ARTIFACT_MISMATCH" });
});
it("rejects otherwise valid mismatched extractor profile and validates unrelated pages", () => {
  const [pd, rd] = pair(), a = structuredClone(rd.textArtifact);
  a.extractorProfile.textLayerSourceSha256 = "e".repeat(64);
  a.extractorProfileHash = sha(canonical({ hashDomain: "document-text-extractor-profile-v1", profile: a.extractorProfile }));
  expect(readDocumentTextV4FullArtifact(a).status).toBe("VALID");
  expect(compareNativeAirflow(pd, seal(a, "RD"), selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "EXTRACTOR_PROFILE_MISMATCH" });
  const broken = structuredClone(pd.textArtifact), last = structuredClone(broken.pages[0]); last.pageNumber = 2;
  last.locatedLines = [line("Нейтральная строка\n", 0)]; last.quality.metrics = metrics(last.locatedLines, []);
  broken.pages.push(last); broken.pageCount = 2; broken.locatedTextPageCount = 2; broken.qualitySummary.candidatePages = 2;
  last.locatedLines[0].bboxMilliPoints[0]++;
  expect(compareNativeAirflow(seal(broken), rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
});
it("rejects origin/nested getters, proxies, extra evidence and callbacks before serialization", () => {
  const [pd, rd] = pair(); let calls = 0;
  const getter = { ...pd }; Object.defineProperty(getter, "textArtifact", { enumerable: true, get: () => { calls++; return pd.textArtifact; } });
  for (const value of [getter, new Proxy(pd, {}), { ...pd, latestReviewHash: null }, { ...pd, quotes: [] }]) {
    expect(compareNativeAirflow(value as any, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_ORIGIN" });
  }
  const nested = structuredClone(pd.textArtifact); Object.defineProperty(nested.pages[0].locatedLines[0], "rawText", { enumerable: true, get: () => { calls++; return ""; } });
  expect(compareNativeAirflow({ ...pd, textArtifact: nested }, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
  expect(compareNativeAirflow({ ...pd, textArtifact: new Proxy(pd.textArtifact, {}) }, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
  const serializer = { ...pd.textArtifact, toJSON: () => { calls++; return pd.textArtifact; } };
  expect(compareNativeAirflow({ ...pd, textArtifact: serializer } as any, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
  const cycle: any = { ...pd.textArtifact }; cycle.self = cycle;
  expect(compareNativeAirflow({ ...pd, textArtifact: cycle }, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INVALID_TEXT_ARTIFACT" });
  expect(calls).toBe(0);
});
it("rejects unlocated selected mentions and selected declarations on partial pages", () => {
  const a = artifact([declaration("П17", "9060")], "PD", "a".repeat(64));
  a.pages[0].unlocatedLines = [{ sourcePath: [1], rawText: "П17\n", nativeBoxPointStrings: ["20", "120", "20", "130"], reasonCode: "NATIVE_ZERO_AREA" }];
  a.unlocatedTextPageCount = 1; a.qualitySummary = { candidatePages: 0, partialPages: 1, ocrRequiredPages: 0 };
  a.pages[0].quality = { disposition: "PARTIAL_TEXT_LAYER", reasonCodes: ["UNLOCATED_TEXT_PRESENT"], metrics: metrics(a.pages[0].locatedLines, a.pages[0].unlocatedLines) };
  expect(readDocumentTextV4FullArtifact(a).status).toBe("VALID");
  expect(compareNativeAirflow(seal(a), pair()[1], selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "UNLOCATED_SELECTED_SYSTEM" });
  a.pages[0].unlocatedLines[0].rawText = "Другой фрагмент\n"; a.pages[0].quality.metrics = metrics(a.pages[0].locatedLines, a.pages[0].unlocatedLines);
  expect(compareNativeAirflow(seal(a), pair()[1], selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "MATCHING_PAGE_UNVERIFIED" });
});
it("explicit record and UTF8 caps reject whole result without truncation", () => {
  for (const text of [declaration("П17", "9060"), "П17\n"]) {
    const a = artifact(Array.from({ length: NATIVE_AIRFLOW_LIMITS.maxQuotesPerSource + 1 }, () => text), "PD", "a".repeat(64));
    expect(readDocumentTextV4FullArtifact(a).status).toBe("VALID");
    expect(compareNativeAirflow(seal(a), pair()[1], selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INPUT_LIMIT" });
  }
  const large = artifact([declaration("П17", "9060").trimEnd() + " ".repeat(NATIVE_AIRFLOW_LIMITS.maxQuoteUtf8BytesPerSource) + "\n"], "PD", "a".repeat(64));
  expect(compareNativeAirflow(seal(large), pair()[1], selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INPUT_LIMIT" });
  const [pd, rd] = pair(); (pd.textArtifact as any).pages = Array(1025).fill(null);
  expect(compareNativeAirflow(pd, rd, selected)).toMatchObject({ status: "ABSTAIN", reasonCode: "INPUT_LIMIT" });
  expect(NATIVE_AIRFLOW_LIMITS.maxNativeLinesPerSource).toBe(128000);
});
it("accepts exactly4096 quotes and exactly1MiB unchanged raw text, rejects next UTF8 byte", () => {
  const a = artifact(Array.from({ length: NATIVE_AIRFLOW_LIMITS.maxQuotesPerSource }, () => declaration("П17", "9060")), "PD", "a".repeat(64));
  const r = compareNativeAirflow(seal(a), pair()[1], selected);
  expect(r.status).toBe("COMPARED"); if (r.status === "COMPARED") expect(r.quotes.PD).toHaveLength(4096);
  const raw = declaration("П17", "9060").trimEnd(), spare = NATIVE_AIRFLOW_LIMITS.maxQuoteUtf8BytesPerSource - Buffer.byteLength(raw + "\n", "utf8");
  for (const extra of [0, 1]) {
    const b = artifact([raw + " ".repeat(spare + extra) + "\n"], "PD", "a".repeat(64));
    expect(compareNativeAirflow(seal(b), pair()[1], selected).status).toBe(extra ? "ABSTAIN" : "COMPARED");
  }
});
it("stored hash verifier accepts saved JSON/key reordering, rejects nested/profile/selection tamper and callbacks", () => {
  const r = run(), saved = JSON.parse(JSON.stringify(r));
  expect(verifyNativeAirflowComparisonHash(saved)).toBe(true);
  expect(verifyNativeAirflowComparisonHash(Object.fromEntries(Object.entries(saved).reverse()) as any)).toBe(true);
  for (const mutate of [(v: any) => v.sources.PD.extractorProfile.pdfminerVersion = "OTHER", (v: any) => v.selection.rdSystemIds.reverse(),
    (v: any) => v.quotes.RD[0].rawText += "X", (v: any) => v.contentHash = "0".repeat(64)]) {
    const v = JSON.parse(JSON.stringify(r)); mutate(v); expect(verifyNativeAirflowComparisonHash(v)).toBe(false);
  }
  expect(verifyNativeAirflowComparisonHash(JSON.parse(JSON.stringify(run(["Не найдено"]))))).toBe(true);
  let calls = 0; const getter = { ...r }; Object.defineProperty(getter, "quotes", { enumerable: true, get: () => { calls++; return {}; } });
  expect(verifyNativeAirflowComparisonHash(getter as any)).toBe(false); expect(calls).toBe(0);
  expect(verifyNativeAirflowComparisonHash(new Proxy(r, {}))).toBe(false);
  const cycle: any = { ...r }; cycle.self = cycle; expect(verifyNativeAirflowComparisonHash(cycle)).toBe(false);
});

const realPd = process.env.INSPECTOR_NATIVE_AIRFLOW_PD_V4, realRd = process.env.INSPECTOR_NATIVE_AIRFLOW_RD_V4;
(realPd && realRd ? describe : describe.skip)("opt-in real public full V4 native source replay (not repository authentication/calibration)", () => {
  it("reads pinned real7 complete quotes, all10 other references and9060=3340+5720 without manual rows/OCR", () => {
    const pb = readFileSync(realPd!), rb = readFileSync(realRd!);
    expect(sha(pb)).toBe("39860d4278f002cfd43a598a97b6b0c4849b38ed6bed2cb5561f820e1e55ef09");
    expect(sha(rb)).toBe("64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9");
    const pd = seal(JSON.parse(pb.toString())), rd = seal(JSON.parse(rb.toString()), "UNRESOLVED");
    expect(pd.sourceSha256).toBe("a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc");
    expect(rd.sourceSha256).toBe("0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd");
    const r = compareNativeAirflow(pd, rd, selected);
    expect(r).toMatchObject({ status: "COMPARED", pdValue: "9060", rdValue: "9060", deltaRdMinusPd: "0", comparison: "EQUAL" });
    if (r.status !== "COMPARED") throw Error(r.reasonCode);
    expect(r.quotes.PD).toHaveLength(1); expect(r.quotes.RD).toHaveLength(6); expect(r.references.PD).toHaveLength(7); expect(r.references.RD).toHaveLength(3);
    expect(r.quotes.PD[0]).toMatchObject({ physicalPage: 156, sourcePath: [77, 0], rawText: "П17 (L=9060 м3/ч, Pc=350 Па)\n", bboxMilliPoints: [238859, 453254, 355420, 462256] });
    expect(r.quotes.RD.map(q => [q.physicalPage, q.sourcePath])).toEqual([[272, [13, 0]], [279, [13, 0]], [646, [106, 0]], [647, [19, 0]], [647, [21, 0]], [647, [124, 0]]]);
    expect(r.memberValues.RD.map(m => [m.systemId, m.value, m.freePressurePa, m.quoteCount])).toEqual([["П17.1", "3340", "540", 3], ["П17.2", "5720", "540", 3]]);
    expect(r.sources.PD.scannedNativeLineCount).toBe(19127); expect(r.sources.RD.scannedNativeLineCount).toBe(50887);
    expect(verifyNativeAirflowComparisonHash(JSON.parse(JSON.stringify(r)))).toBe(true);
  }, 30000);
});
