import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SourceOcrImportOrigin } from "@inspector-ai/contracts";
import { deriveSourceOcrImport, parseSourceOcrImportBundle, SOURCE_OCR_IMPORT_LIMITS, verifySourceOcrImportDerivedHash } from "../src/source-ocr-import.js";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
// Independent canonical encoder for this fixture's ASCII property names, not a product builder.
const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const profileId = "ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1";
const profile = { schemaVersion: "document-text-extractor-profile-v1", textLayerSourceSha256: "1".repeat(64),
  documentTextV4SourceSha256: "2".repeat(64), pdfminerVersion: "20260107", geometryPolicyVersion: "document-text-v4-decimal-half-even-v1",
  cropPolicyVersion: "visible-crop-contained-epsilon-1e-6-v1", traversalPolicyVersion: "pdfminer-analyzed-figures-boxes-flow-none-vertical-v1", qualityPolicyVersion: "document-text-quality-v4" };
function seal(artifact: any): SourceOcrImportOrigin {
  const byte = sha(canonical(artifact));
  return { schemaVersion: "document-text-v4-full-source-read-v1", purpose: "SOURCE_AUDIT_ONLY", sourceAuditProfileVersion: "SOURCE_AUDIT_V4_FULL_SOURCE_V1",
    resourcePolicyVersion: "document-text-v4-full-source-bounds-v1", checkId: "OFFLINE-IMPORT-FIXTURE", sourceFileId: artifact.sourceFileId,
    sourceSha256: artifact.inputSha256, inputManifestHash: "c".repeat(64), textStageContentHash: byte, textArtifactByteSha256: byte,
    textArtifactContentHash: sha(canonical({ hashDomain: "document-text-v4-content-v1", artifact })), extractorProfileHash: artifact.extractorProfileHash,
    stage: "UNRESOLVED", authorityStatus: "SOURCE_DECLARED_UNVERIFIED", renderedVisibility: "UNVERIFIED", calibratedProbability: null, textArtifact: artifact };
}
function origin(pages = 1): SourceOcrImportOrigin {
  return seal({ schemaVersion: "document-text-v4", sourceFileId: "SYNTHETIC-SOURCE", inputSha256: "a".repeat(64),
    coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: pages, locatedTextPageCount: 0, unlocatedTextPageCount: 0,
    extractorProfile: structuredClone(profile), extractorProfileHash: sha(canonical({ hashDomain: "document-text-extractor-profile-v1", profile })),
    qualitySummary: { candidatePages: 0, partialPages: 0, ocrRequiredPages: pages },
    pages: Array.from({ length: pages }, (_, n) => ({ pageNumber: n + 1, widthMilliPoints: 600000, heightMilliPoints: 800000,
      nativeFrame: { coordinateSystem: "PDFMINER_LAYOUT_POINTS", visibleBoxPointStrings: ["0", "0", "600", "800"] }, locatedLines: [], unlocatedLines: [],
      quality: { disposition: "OCR_REQUIRED", reasonCodes: ["NO_LOCATED_TEXT"], metrics: { locatedLineCount: 0, unlocatedLineCount: 0,
        locatedNonWhitespaceCharacters: 0, unlocatedNonWhitespaceCharacters: 0, replacementCharacters: 0, disallowedControlCharacters: 0, cidPlaceholders: 0 } } })) });
}
function response(texts = ["  Кириллица <&> №1 😀\n", "", " \t\n"]) {
  return { schemaVersion: "document-ai-ocr-response-v1", profileId, script: "eslav", results: [{ width: 1200, height: 1600,
    overall_ocr_res: { rec_texts: texts, rec_scores: texts.map(() => 0.875), rec_boxes: texts.map(() => [10.25, 20, 300.5, 40]) } }] };
}
function bundle(count = 1): any {
  return { schemaVersion: "source-ocr-import-bundle-v1", sourceSha256: "a".repeat(64), profileId,
    pages: Array.from({ length: count }, (_, n) => ({ pageNumber: n + 1, pdfWidthMilliPoints: 600000, pdfHeightMilliPoints: 800000,
      rasterWidth: 1200, rasterHeight: 1600, renderSha256: "d".repeat(64), rawResponseJson: JSON.stringify(response()) })) };
}
function changedResponse(change: (r: any) => void) { const b = bundle(), r = response(); change(r); b.pages[0].rawResponseJson = JSON.stringify(r); return b; }
const rejectCode = (b: any, code: string, o = origin()) => {
  try { deriveSourceOcrImport(b, o); throw Error("Expected rejection"); }
  catch (error) { expect(error).toMatchObject({ code }); }
};

it("binds all native gap pages, preserves exact raw/text/ordinal/float coordinates, and never claims PDF evidence", () => {
  const b = bundle(), o = origin(), before = JSON.stringify([b, o]), derived = deriveSourceOcrImport(b, o);
  expect(derived).toMatchObject({ schemaVersion: "source-ocr-import-derived-v1", status: "IMPORTED_OCR_UNVERIFIED", policyVersion: "source-ocr-import-v1",
    p: null, factEligible: false, coverageDelta: 0, providerExecutionVerified: false, renderDerivationVerified: false });
  expect(derived.pages[0]).toMatchObject({ rawResponseJson: b.pages[0].rawResponseJson, rawResponseSha256: sha(b.pages[0].rawResponseJson), status: "TEXT_CANDIDATE",
    lines: [{ ordinal: 0, text: "  Кириллица <&> №1 😀\n", recognitionScore: 0.875, rasterBbox: [10.25, 20, 300.5, 40] }] });
  expect(derived.pages[0].lines).toHaveLength(1);
  const { lineHash, ...line } = derived.pages[0].lines[0];
  expect(lineHash).toBe(sha(canonical({ hashDomain: "source-ocr-import-line-v1", value: { sourceSha256: b.sourceSha256, profileId,
    pageNumber: 1, renderSha256: b.pages[0].renderSha256, rawResponseSha256: sha(b.pages[0].rawResponseJson), line } })));
  expect(derived.bundleHash).toBe(sha(canonical({ hashDomain: "source-ocr-import-bundle-v1", value: b })));
  const { contentHash, ...body } = derived;
  expect(contentHash).toBe(sha(canonical({ hashDomain: "source-ocr-import-derived-v1", value: body })));
  expect(JSON.stringify(derived)).not.toMatch(/bboxMilliPoints|PDF_BOTTOM_LEFT|NO_VIOLATION/);
  expect(derived.notices).toContain("EMPTY_RECOGNITION_UNRESOLVED");
  expect(Object.isFrozen(derived.pages[0].lines[0].rasterBbox)).toBe(true);
  expect(Object.isFrozen(b.pages)).toBe(false); expect(JSON.stringify([b, o])).toBe(before);
  expect(deriveSourceOcrImport(b, o)).toEqual(derived);
});
it("retains repeated exact text independently and preserves provider array ordinals across empty entries", () => {
  const b = changedResponse(r => { r.results[0] = response(["", "Повтор", "Повтор"]).results[0]; });
  const r = deriveSourceOcrImport(b, origin()); expect(r.pages[0].lines.map(l => l.ordinal)).toEqual([1, 2]);
  expect(r.pages[0].lines[0].lineHash).not.toBe(r.pages[0].lines[1].lineHash);
});
it.each(["Текст\u0000", "\u0000"])("rejects escaped NUL before storage, without removing/replacing characters:%j", text => {
  const b = changedResponse(r => { r.results[0] = response([text]).results[0]; });
  const unchanged = b.pages[0].rawResponseJson;
  try { deriveSourceOcrImport(b, origin()); throw Error("Expected rejection"); }
  catch (error) { expect(error).toMatchObject({ statusCode: 422, code: "SOURCE_OCR_IMPORT_INVALID_RESPONSE" }); }
  expect(b.pages[0].rawResponseJson).toBe(unchanged);
});
it("empty OCR arrays and whitespace-only recognition remain unresolved, never zero/absence/successful fact", () => {
  for (const texts of [[], ["", " \n"]]) {
    const b = changedResponse(r => { r.results[0] = response(texts).results[0]; });
    const r = deriveSourceOcrImport(b, origin()); expect(r.pages[0]).toMatchObject({ status: "UNRESOLVED", lines: [] });
    expect(r.factEligible).toBe(false); expect(r.p).toBeNull(); expect(r).not.toHaveProperty("absenceProof", true);
  }
});
it("a different well-formed external raster claim changes hashes but never becomes authenticated raster provenance", () => {
  const a = deriveSourceOcrImport(bundle(), origin()), b = bundle(); b.pages[0].renderSha256 = "e".repeat(64);
  const other = deriveSourceOcrImport(b, origin()); expect(other.renderDerivationVerified).toBe(false);
  expect(other.contentHash).not.toBe(a.contentHash); expect(other.pages[0].lines[0].lineHash).not.toBe(a.pages[0].lines[0].lineHash);
});
it.each(["schemaVersion", "profileId", "sourceSha256", "extra"])("rejects wrong bundle field%s", field => {
  const b = bundle(); b[field] = "FOREIGN"; expect(() => parseSourceOcrImportBundle(b)).toThrow();
});
it.each(["extra", "pageNumber", "pdfWidthMilliPoints", "pdfHeightMilliPoints", "rasterWidth", "rasterHeight", "renderSha256", "rawResponseJson"])("rejects malformed page field%s", field => {
  const b = bundle(); b.pages[0][field] = field === "extra" ? true : null; expect(() => parseSourceOcrImportBundle(b)).toThrow();
});
it.each(["partial", "duplicate", "reordered", "candidate-instead-gap"])("rejects ambiguous/incomplete full-source page set:%s", mode => {
  const b = bundle(2), o = origin(2);
  if (mode === "partial") b.pages.pop();
  if (mode === "duplicate") b.pages[1].pageNumber = 1;
  if (mode === "reordered") b.pages.reverse();
  if (mode === "candidate-instead-gap") b.pages[1].pageNumber = 3;
  expect(() => deriveSourceOcrImport(b, o)).toThrow();
});
it.each(["pdfWidthMilliPoints", "pdfHeightMilliPoints"])("rejects substituted native geometry%s", field => {
  const b = bundle(); b.pages[0][field]++; rejectCode(b, "SOURCE_OCR_IMPORT_GEOMETRY_MISMATCH");
});
it("rejects source/hash substitution and checks the whole V4 artifact, not just requested pages", () => {
  const b = bundle(); b.sourceSha256 = "b".repeat(64); rejectCode(b, "SOURCE_OCR_IMPORT_SOURCE_MISMATCH");
  for (const field of ["sourceFileId", "sourceSha256", "inputManifestHash", "textStageContentHash", "textArtifactByteSha256", "textArtifactContentHash", "extractorProfileHash"]) {
    const o = structuredClone(origin()) as any; o[field] = "FOREIGN"; rejectCode(bundle(), "SOURCE_OCR_IMPORT_INVALID_ORIGIN", o);
  }
  const o = structuredClone(origin(2)); o.textArtifact.pages[1].quality.metrics.locatedLineCount = 1;
  rejectCode(bundle(2), "SOURCE_OCR_IMPORT_INVALID_ORIGIN", o);
});
it.each(["schemaVersion", "profileId", "script"])("rejects wrong raw response%s", field => {
  rejectCode(changedResponse(r => { r[field] = "FOREIGN"; }), "SOURCE_OCR_IMPORT_PROFILE_MISMATCH");
});
it.each([{ results: [] }, { results: [{ width: 1200, height: 1600 }] }, { results: [response().results[0], response().results[0]] }])("requires exactly one result with OCR arrays:%j", ({ results }) => {
  rejectCode(changedResponse(r => { r.results = results; }), "SOURCE_OCR_IMPORT_INVALID_RESPONSE");
});
it.each(["width", "height"])("rejects changed raster%s", field => {
  rejectCode(changedResponse(r => { r.results[0][field]++; }), "SOURCE_OCR_IMPORT_RASTER_MISMATCH");
});
it.each(["rec_texts", "rec_scores", "rec_boxes"])("rejects mismatched raw array%s", field => {
  rejectCode(changedResponse(r => { r.results[0].overall_ocr_res[field] = []; }), "SOURCE_OCR_IMPORT_INVALID_RESPONSE");
});
it.each([-0.1, 1.1, true, null, "0.9"])("rejects invalid recognition score%j", score => {
  rejectCode(changedResponse(r => { r.results[0].overall_ocr_res.rec_scores[0] = score; }), "SOURCE_OCR_IMPORT_INVALID_RESPONSE");
});
it.each([[-1, 0, 1, 1], [0, -1, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [0, 0, 1201, 1], [0, 0, 1, 1601], [0, 0, 1], [0, 0, "1", 1]].map(box => ({ box })))("rejects unsafe raster box%j", ({ box }) => {
  rejectCode(changedResponse(r => { r.results[0].overall_ocr_res.rec_boxes[0] = box; }), "SOURCE_OCR_IMPORT_INVALID_RESPONSE");
});
it.each(["NaN", "Infinity", "1e999"])("rejects nonfinite JSON token%s", token => {
  const b = bundle(); b.pages[0].rawResponseJson = JSON.stringify(response()).replace("0.875", token);
  rejectCode(b, "SOURCE_OCR_IMPORT_INVALID_RESPONSE");
});
it("rejects duplicate raw JSON keys, trailing data, escaped lone surrogates and unsupported depth", () => {
  for (const raw of [JSON.stringify(response()).replace('"script":"eslav"', '"script":"eslav","script":"eslav"'), JSON.stringify(response()) + "false",
    JSON.stringify(response()).replace("Кириллица", "\\ud800"), '{"x":' + "[".repeat(50) + "0" + "]".repeat(50) + "}"]) {
    const b = bundle(); b.pages[0].rawResponseJson = raw; expect(() => deriveSourceOcrImport(b, origin())).toThrow();
  }
});
it("callback-free bundle/origin admission rejects proxies, accessors, sparse arrays and serializer hooks", () => {
  let calls = 0; const getter = bundle(); Object.defineProperty(getter, "pages", { enumerable: true, get: () => { calls++; return []; } });
  const nested = bundle(); Object.defineProperty(nested.pages[0], "rawResponseJson", { enumerable: true, get: () => { calls++; return "{}"; } });
  for (const value of [getter, nested, new Proxy(bundle(), {}), { ...bundle(), pages: new Proxy(bundle().pages, {}) }, { ...bundle(), pages: new Array(1) },
    { ...bundle(), toJSON: () => { calls++; return bundle(); } }]) expect(() => parseSourceOcrImportBundle(value)).toThrow();
  const o = origin(); Object.defineProperty(o, "textArtifact", { enumerable: true, get: () => { calls++; return {}; } });
  rejectCode(bundle(), "SOURCE_OCR_IMPORT_INVALID_ORIGIN", o); expect(calls).toBe(0);
});
it("enforces page, raster, UTF8 bundle and per-line codepoint bounds without truncation", () => {
  expect(() => parseSourceOcrImportBundle(bundle(13))).toThrow();
  const huge = bundle(); huge.pages[0].rasterWidth = 2500001; huge.pages[0].rasterHeight = 1;
  expect(() => parseSourceOcrImportBundle(huge)).toThrow();
  const over = bundle(); over.pages[0].rawResponseJson = "x".repeat(8 * 1024 * 1024); expect(() => parseSourceOcrImportBundle(over)).toThrow();
  const exact = changedResponse(r => { r.results[0] = response(["😀".repeat(12000)]).results[0]; });
  expect(deriveSourceOcrImport(exact, origin()).pages[0].lines[0].text).toBe("😀".repeat(12000));
  rejectCode(changedResponse(r => { r.results[0] = response(["😀".repeat(12001)]).results[0]; }), "SOURCE_OCR_IMPORT_INPUT_LIMIT");
});
it("accepts exactly10000/page and20000 total array entries; rejects the next entry even when all are empty", () => {
  const b = bundle(2);
  for (const p of b.pages) p.rawResponseJson = JSON.stringify(response(Array(10000).fill("")));
  expect(deriveSourceOcrImport(b, origin(2)).pages.map(p => p.lines.length)).toEqual([0, 0]);
  const perPage = bundle(); perPage.pages[0].rawResponseJson = JSON.stringify(response(Array(10001).fill("")));
  rejectCode(perPage, "SOURCE_OCR_IMPORT_INPUT_LIMIT");
  const total = bundle(3); for (const p of total.pages) p.rawResponseJson = JSON.stringify(response(Array(7000).fill("")));
  rejectCode(total, "SOURCE_OCR_IMPORT_INPUT_LIMIT", origin(3));
});
it("stored integrity verifier handles fresh parsed float data and rejects nested tampering/callbacks", () => {
  const derived = deriveSourceOcrImport(bundle(), origin()), saved = JSON.parse(JSON.stringify(derived));
  expect(verifySourceOcrImportDerivedHash(saved)).toBe(true);
  expect(verifySourceOcrImportDerivedHash(Object.fromEntries(Object.entries(saved).reverse()))).toBe(true);
  for (const change of [(r: any) => r.pages[0].lines[0].text += "x", (r: any) => r.pages[0].rawResponseJson += " ",
    (r: any) => r.pages[0].lines[0].recognitionScore = 0.5, (r: any) => r.renderDerivationVerified = true, (r: any) => r.bundleHash = "0".repeat(64)]) {
    const r = structuredClone(saved); change(r); expect(verifySourceOcrImportDerivedHash(r)).toBe(false);
  }
  let calls = 0; const getter = { ...saved }; Object.defineProperty(getter, "pages", { enumerable: true, get: () => { calls++; return []; } });
  expect(verifySourceOcrImportDerivedHash(getter)).toBe(false); expect(calls).toBe(0);
  expect(verifySourceOcrImportDerivedHash(new Proxy(saved, {}))).toBe(false);
  const cycle: any = { ...saved }; cycle.self = cycle; expect(verifySourceOcrImportDerivedHash(cycle)).toBe(false);
});

const realBundle = process.env.INSPECTOR_SOURCE_OCR_IMPORT_BUNDLE, realV4 = process.env.INSPECTOR_SOURCE_OCR_IMPORT_NATIVE_V4;
(realBundle && realV4 ? describe : describe.skip)("opt-in real saved responses; no provider execution or repository authentication", () => {
  it("derives all264 nonempty lines on12gap pages; eight empty recognitions stay unresolved", () => {
    const rawBundle = readFileSync(realBundle!), rawV4 = readFileSync(realV4!);
    expect(sha(rawBundle)).toBe("8806ba05fdace4901010cc3b75a4f9ba46c16eedc37306c70d95cd43399d5d5a");
    expect(sha(rawV4)).toBe("64d86a69aeafcd5c8f27ffbd2ad44060d165b68b387318905392027fbb548aa9");
    const r = deriveSourceOcrImport(JSON.parse(rawBundle.toString()), seal(JSON.parse(rawV4.toString())));
    expect(r.pages.map(p => p.pageNumber)).toEqual([5, 7, 8, 9, 596, 604, 610, 614, 618, 624, 630, 634]);
    expect(r.pages.map(p => p.lines.length)).toEqual([35, 78, 82, 69, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.pages.filter(p => p.status === "UNRESOLVED")).toHaveLength(8);
    expect(r.pages.reduce((count, p) => count + p.lines.length, 0)).toBe(264);
    expect(r.providerExecutionVerified).toBe(false); expect(r.renderDerivationVerified).toBe(false);
    expect(verifySourceOcrImportDerivedHash(JSON.parse(JSON.stringify(r)))).toBe(true);
  }, 30000);
});
