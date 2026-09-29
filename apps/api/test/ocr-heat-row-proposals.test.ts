import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { stageContent, validateOcrHeatRowProposals } from "../src/ocr-heat-row-proposals.js";
import { boundedOcrConfigHashV3, boundedOcrProfileIdV3,
  boundedOcrProfileV3, boundedOcrConfigHashV4, boundedOcrProfileIdV4,
  boundedOcrProfileV4, boundedOcrConfigHashV5, boundedOcrProfileIdV5,
  boundedOcrProfileV5 } from "../src/ocr-layout.js";

const sourceId = "FIL-1";
const sourceHash = "a".repeat(64);
const manifestHash = "b".repeat(64);
const sourceFiles = [{ sourceFileId: sourceId, sha256: sourceHash, stages: ["RD"] }];
const line = (text: string, bboxPx: number[], score = 0.95) => ({ text, bboxPx, score });

function fixture() {
  const lines = [
    line("Система горячего водоснабжения", [215, 561, 476, 589]),
    line("Максимальный расчетный расход тепла с учетом", [213, 599, 567, 626]),
    line("722,64 кВт. (0,621 Гкал/час)", [595, 607, 799, 639], 0.84),
    line("циркуляции", [214, 623, 304, 648]),
    line("Средний расчетный расход тепла", [214, 666, 460, 696]),
    line("225,11 кВт. (0,194 Гкал/час)", [594, 665, 798, 696], 0.85),
  ];
  const page: Record<string, unknown> = {
    schemaVersion: "document-ocr-page-v1", sourceFileId: sourceId,
    inputSha256: sourceHash, pageNumber: 8,
    render: { sha256: "c".repeat(64), widthPx: 993, heightPx: 1403, dpi: 120,
      rendererProfileId: boundedOcrProfileV3.rendererProfileId },
    provider: { profileId: boundedOcrProfileV3.ocrProviderProfileIds[0], script: "eslav" },
    lines,
  };
  page.contentHash = sha256(canonicalJson(page));
  const stage = {
    schemaVersion: "analysis-stage-result-v2", jobType: "DOCUMENT_OCR_LAYOUT",
    inputManifestHash: manifestHash, disposition: "OCR_LAYOUT_BOUNDED",
    reasonCode: "BOUNDED_OCR_ONLY", providerKind: "OCR_LAYOUT",
    providerProfileId: boundedOcrProfileIdV3, providerConfigHash: boundedOcrConfigHashV3,
    outputCount: 1,
    analysis: { schemaVersion: "bounded-ocr-layout-analysis-v3", objectId: "OBJ-1",
      inputManifestHash: manifestHash, profile: boundedOcrProfileV3,
      sourceCount: 1, processedPageCount: 1,
      sources: [{ sourceFileId: sourceId, sourceSha256: sourceHash,
        processedPageCount: 1, pages: [page] }],
    },
  };
  const canonical = canonicalJson(stage);
  const persisted = { content_json: stage, content_hash: sha256(canonical),
    byte_size: Buffer.byteLength(canonical), provider_profile_id: boundedOcrProfileIdV3,
    provider_config_hash: boundedOcrConfigHashV3, input_manifest_hash: manifestHash };
  const evidence = (index: number, role: string) => ({ role, lineIndex: index, ...lines[index] });
  const base = { sourceFileId: sourceId, inputSha256: sourceHash, pageNumber: 8,
    stage: "RD", component: "DHW", ocrPageContentHash: page.contentHash,
    renderSha256: "c".repeat(64) };
  const result = { schemaVersion: "ocr-heat-row-proposals-v1",
    profileId: "conservative-ocr-heat-rows-v1", inputManifestHash: manifestHash,
    proposals: [
      { ...base, basis: "MAX_INCLUDING_CIRCULATION", values: { kW: "722.64", "Gcal/h": "0.621" },
        evidence: [evidence(0, "section"), evidence(1, "rowLabel"),
          evidence(3, "basisContinuation"), evidence(2, "value")] },
      { ...base, basis: "MEAN", values: { kW: "225.11", "Gcal/h": "0.194" },
        evidence: [evidence(0, "section"), evidence(4, "rowLabel"), evidence(5, "value")] },
    ], abstentions: [], findingCount: 0 };
  const reviews = { [sourceId]: { sourceSha256: sourceHash, pageStages: { "8": "RD" } } };
  return { stage, page, lines, persisted, result, reviews };
}

function rehash(persisted: ReturnType<typeof fixture>["persisted"]): void {
  const page = (persisted.content_json.analysis as unknown as {
    sources: Array<{ pages: Array<Record<string, unknown>> }>;
  }).sources[0].pages[0];
  const { contentHash: _old, ...pageWithoutHash } = page;
  page.contentHash = sha256(canonicalJson(pageWithoutHash));
  const canonical = canonicalJson(persisted.content_json);
  persisted.content_hash = sha256(canonical);
  persisted.byte_size = Buffer.byteLength(canonical);
}

describe("independent OCR heat-row verifier", () => {
  it("accepts the same review-only rows from a pinned v4 OCR stage", () => {
    const { persisted, result, reviews } = fixture();
    persisted.provider_profile_id = boundedOcrProfileIdV4;
    persisted.provider_config_hash = boundedOcrConfigHashV4;
    persisted.content_json.providerProfileId = boundedOcrProfileIdV4;
    persisted.content_json.providerConfigHash = boundedOcrConfigHashV4;
    persisted.content_json.analysis.schemaVersion = "bounded-ocr-layout-analysis-v4";
    (persisted.content_json.analysis as Record<string, unknown>).profile = boundedOcrProfileV4;
    rehash(persisted);
    expect(validateOcrHeatRowProposals(result, persisted, reviews, sourceFiles, manifestHash)).toBe(true);
  });
  it("accepts four-page v5 stage and rejects four-page v4 stage", () => {
    const { persisted } = fixture();
    persisted.provider_profile_id = persisted.content_json.providerProfileId = boundedOcrProfileIdV5;
    persisted.provider_config_hash = persisted.content_json.providerConfigHash = boundedOcrConfigHashV5;
    const analysis = persisted.content_json.analysis as Record<string, any>;
    analysis.schemaVersion = "bounded-ocr-layout-analysis-v5";
    analysis.profile = boundedOcrProfileV5;
    analysis.processedPageCount = persisted.content_json.outputCount = 4;
    rehash(persisted);
    expect(stageContent(persisted, manifestHash)).not.toBeNull();
    persisted.provider_profile_id = persisted.content_json.providerProfileId = boundedOcrProfileIdV4;
    persisted.provider_config_hash = persisted.content_json.providerConfigHash = boundedOcrConfigHashV4;
    analysis.schemaVersion = "bounded-ocr-layout-analysis-v4";
    analysis.profile = boundedOcrProfileV4;
    rehash(persisted);
    expect(stageContent(persisted, manifestHash)).toBeNull();
  });
  it("rederives two different DHW bases from trusted OCR lines", () => {
    const { persisted, result, reviews } = fixture();
    expect(validateOcrHeatRowProposals(result, persisted, reviews, sourceFiles, manifestHash)).toBe(true);
  });

  it("rejects forged manifest, profile, stage hash, and page hash", () => {
    const { persisted, result, reviews } = fixture();
    expect(validateOcrHeatRowProposals(result, persisted, reviews, sourceFiles, "f".repeat(64))).toBe(false);
    expect(validateOcrHeatRowProposals(result,
      { ...persisted, provider_profile_id: "local-bounded-ocr-layout-v2" }, reviews, sourceFiles, manifestHash)).toBe(false);
    expect(validateOcrHeatRowProposals(result,
      { ...persisted, content_hash: "0".repeat(64) }, reviews, sourceFiles, manifestHash)).toBe(false);
    const stale = structuredClone(persisted);
    (((stale.content_json.analysis as unknown as { sources: Array<{ pages: Array<{ lines: Array<{ text: string }> }> }> })
      .sources[0].pages[0].lines[2])).text = "999 кВт";
    const canonical = canonicalJson(stale.content_json);
    stale.content_hash = sha256(canonical);
    stale.byte_size = Buffer.byteLength(canonical);
    expect(validateOcrHeatRowProposals(result, stale, reviews, sourceFiles, manifestHash)).toBe(false);
  });

  it("derives single-stage RD from manifest and rejects stale or forged review", () => {
    const { persisted, result, reviews } = fixture();
    expect(validateOcrHeatRowProposals(result, persisted, {}, sourceFiles, manifestHash)).toBe(true);
    expect(validateOcrHeatRowProposals(result, persisted,
      { [sourceId]: { sourceSha256: sourceHash, pageStages: { "8": "UNRESOLVED" } } },
      sourceFiles, manifestHash)).toBe(false);
    expect(validateOcrHeatRowProposals(result, persisted,
      { [sourceId]: { sourceSha256: "d".repeat(64), pageStages: { "8": "RD" } } },
      sourceFiles, manifestHash)).toBe(false);
    expect(validateOcrHeatRowProposals(result, persisted,
      { [sourceId]: { sourceSha256: sourceHash, pageStages: { "8": "PD" } } },
      sourceFiles, manifestHash)).toBe(false);
    expect(reviews[sourceId].pageStages["8"]).toBe("RD");
  });

  it("requires explicit reviewed RD page on mixed-stage source", () => {
    const { persisted, result, reviews } = fixture();
    const mixed = [{ ...sourceFiles[0], stages: ["PD", "RD"] }];
    expect(validateOcrHeatRowProposals(result, persisted, {}, mixed, manifestHash)).toBe(false);
    expect(validateOcrHeatRowProposals(result, persisted, reviews, mixed, manifestHash)).toBe(true);
    expect(validateOcrHeatRowProposals(result, persisted,
      { [sourceId]: { sourceSha256: sourceHash, pageStages: { "8": "RD", "7": "ID" } } },
      mixed, manifestHash)).toBe(false);
  });

  it("never promotes single-stage PD or ID to RD and rejects stale manifest source", () => {
    const { persisted, result, reviews, lines } = fixture();
    for (const stage of ["PD", "ID"]) {
      const abstained = structuredClone(result) as {
        proposals: unknown[]; abstentions: unknown[]; findingCount: number;
      };
      abstained.proposals = [];
      abstained.abstentions = [2, 5].map((index) => ({ sourceFileId: sourceId,
        inputSha256: sourceHash, pageNumber: 8, lineIndex: index,
        reasonCode: "PAGE_STAGE_NOT_RD",
        evidence: [{ role: "value", lineIndex: index, ...lines[index] }] }));
      expect(validateOcrHeatRowProposals(abstained, persisted, {},
        [{ ...sourceFiles[0], stages: [stage] }], manifestHash)).toBe(true);
      expect(validateOcrHeatRowProposals(result, persisted, {},
        [{ ...sourceFiles[0], stages: [stage] }], manifestHash)).toBe(false);
      expect(validateOcrHeatRowProposals(result, persisted, reviews,
        [{ ...sourceFiles[0], stages: [stage] }], manifestHash)).toBe(false);
    }
    expect(validateOcrHeatRowProposals(result, persisted, reviews,
      [{ ...sourceFiles[0], sha256: "d".repeat(64) }], manifestHash)).toBe(false);
    expect(validateOcrHeatRowProposals(result, persisted, reviews, [], manifestHash)).toBe(false);
  });

  it("rejects forged evidence text, index, score, bbox, render and duplicate proposal", () => {
    const { persisted, result, reviews } = fixture();
    for (const field of ["text", "lineIndex", "score", "bboxPx"] as const) {
      const forged = structuredClone(result);
      const evidence = forged.proposals[0].evidence[3] as Record<string, unknown>;
      evidence[field] = field === "text" ? "999 кВт" : field === "lineIndex" ? 4
        : field === "score" ? 0.99 : [1, 1, 20, 20];
      expect(validateOcrHeatRowProposals(forged, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
    }
    const render = structuredClone(result);
    render.proposals[0].renderSha256 = "e".repeat(64);
    expect(validateOcrHeatRowProposals(render, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
    const duplicate = structuredClone(result);
    duplicate.proposals.push(structuredClone(duplicate.proposals[0]));
    expect(validateOcrHeatRowProposals(duplicate, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
  });

  it("rejects false numeric pair, wrong unit, and missing basis qualifier", () => {
    const { persisted, result, reviews } = fixture();
    const numeric = structuredClone(result);
    numeric.proposals[0].values.kW = "999";
    expect(validateOcrHeatRowProposals(numeric, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
    const wrongUnit = structuredClone(result);
    wrongUnit.proposals[0].evidence[3].text = "722,64 кВт. (0,621 ГкАл/чАС)";
    expect(validateOcrHeatRowProposals(wrongUnit, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
    const missing = structuredClone(result);
    missing.proposals[0].evidence.splice(2, 1);
    expect(validateOcrHeatRowProposals(missing, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
  });

  it("rejects semantically false pair even when OCR and envelope hashes are recomputed", () => {
    const { persisted, result, reviews } = fixture();
    const page = (persisted.content_json.analysis as unknown as {
      sources: Array<{ pages: Array<{ lines: Array<{ text: string }> ; contentHash: string }> }>;
    }).sources[0].pages[0];
    page.lines[2].text = "722,64 кВт. (0,999 Гкал/час)";
    rehash(persisted);
    const forged = structuredClone(result);
    forged.proposals[0].values["Gcal/h"] = "0.999";
    forged.proposals[0].ocrPageContentHash = page.contentHash;
    forged.proposals[0].evidence[3].text = page.lines[2].text;
    expect(validateOcrHeatRowProposals(forged, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
  });

  it("preserves leading zeros in accepted paired values", () => {
    const { persisted, result, reviews } = fixture();
    const page = (persisted.content_json.analysis as unknown as {
      sources: Array<{ pages: Array<{ lines: Array<{ text: string }> ; contentHash: string }> }>;
    }).sources[0].pages[0];
    page.lines[2].text = "00722,64 кВт. (0,621 Гкал/час)";
    rehash(persisted);
    const proposal = structuredClone(result);
    proposal.proposals[0].values.kW = "00722.64";
    proposal.proposals[0].ocrPageContentHash = page.contentHash;
    proposal.proposals[0].evidence[3].text = page.lines[2].text;
    proposal.proposals[1].ocrPageContentHash = page.contentHash;
    expect(validateOcrHeatRowProposals(proposal, persisted, reviews, sourceFiles, manifestHash)).toBe(true);
  });

  it("abstains on out-of-bounds decimal precision or width despite matching hashes", () => {
    for (const raw of [
      "722,6400001 кВт. (0,621 Гкал/час)",
      "722,64 кВт. (0,6210001 Гкал/час)",
      "0000000000722,64 кВт. (0,621 Гкал/час)",
    ]) {
      const { persisted, result, reviews } = fixture();
      const page = (persisted.content_json.analysis as unknown as {
        sources: Array<{ pages: Array<{ lines: Array<{ text: string; score: number; bboxPx: number[] }>;
          contentHash: string }> }>;
      }).sources[0].pages[0];
      page.lines[2].text = raw;
      rehash(persisted);
      const expected = structuredClone(result) as typeof result & { abstentions: Array<Record<string, unknown>> };
      expected.proposals.shift();
      expected.proposals[0].ocrPageContentHash = page.contentHash;
      expected.abstentions.push({ sourceFileId: sourceId, inputSha256: sourceHash, pageNumber: 8,
        lineIndex: 2, reasonCode: "OCR_UNIT_UNREADABLE",
        evidence: [
          { role: "section", lineIndex: 0, ...page.lines[0] },
          { role: "rowLabel", lineIndex: 1, ...page.lines[1] },
          { role: "basisContinuation", lineIndex: 3, ...page.lines[3] },
          { role: "value", lineIndex: 2, ...page.lines[2] },
        ] });
      expect(validateOcrHeatRowProposals(expected, persisted, reviews, sourceFiles, manifestHash)).toBe(true);
    }
  });

  it("rejects ambiguous maximum basis with otherwise matching OCR evidence", () => {
    const { persisted, result, reviews } = fixture();
    const page = (persisted.content_json.analysis as unknown as {
      sources: Array<{ pages: Array<{ lines: Array<{ text: string }> ; contentHash: string }> }>;
    }).sources[0].pages[0];
    page.lines[3].text = "без циркуляции";
    rehash(persisted);
    const forged = structuredClone(result);
    for (const proposal of forged.proposals) proposal.ocrPageContentHash = page.contentHash;
    forged.proposals[0].evidence[2].text = page.lines[3].text;
    expect(validateOcrHeatRowProposals(forged, persisted, reviews, sourceFiles, manifestHash)).toBe(false);
  });

  it("keeps unresolved pages as abstentions, never findings", () => {
    const { persisted, result } = fixture();
    const unresolved = structuredClone(result) as {
      proposals: unknown[]; abstentions: unknown[]; findingCount: number;
    };
    unresolved.proposals = [];
    const page = (persisted.content_json.analysis as unknown as {
      sources: Array<{ pages: Array<{ lines: Array<{ text: string; score: number; bboxPx: number[] }> }> }>;
    }).sources[0].pages[0];
    const value = (index: number) => ({ sourceFileId: sourceId, inputSha256: sourceHash,
      pageNumber: 8, lineIndex: index, reasonCode: "PAGE_STAGE_UNRESOLVED",
      evidence: [{ role: "value", lineIndex: index, ...page.lines[index] }] });
    unresolved.abstentions = [value(2), value(5)];
    const mixed = [{ ...sourceFiles[0], stages: ["PD", "RD"] }];
    expect(validateOcrHeatRowProposals(unresolved, persisted, {}, mixed, manifestHash)).toBe(true);
    unresolved.findingCount = 1;
    expect(validateOcrHeatRowProposals(unresolved, persisted, {}, mixed, manifestHash)).toBe(false);
  });
});
