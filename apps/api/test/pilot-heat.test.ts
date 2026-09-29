import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyPilotHeatAnalysis } from "../src/pilot-heat.js";
import type { PilotCandidateSource } from "../src/pilot-candidate.js";

const manifestHash = "f".repeat(64);

function source(id: string, sha: string, stage: "PD" | "RD", text: string): PilotCandidateSource {
  const textArtifact = {
    schemaVersion: "document-text-v2", sourceFileId: id, inputSha256: sha,
    pages: [{ pageNumber: 1, quality: { disposition: "TEXT_LAYER_CANDIDATE" },
      blocks: [{ text, bboxMilliPoints: [1000, 2000, 9000, 3000] }] }],
  };
  return {
    sourceFileId: id, sha256: sha, name: id, stages: [stage], review: null,
    textArtifact, textArtifactHash: sha256(canonicalJson(textArtifact)),
  };
}

function fact(sourceFileId: string, inputSha256: string, stage: "PD" | "RD",
  component: string, text: string, rawValue: string): Record<string, unknown> {
  const evidence = [{ role: "line", sourceFileId, inputSha256, pageNumber: 1,
    blockIndex: 0, lineIndex: 0, text, bboxMilliPoints: [1000, 2000, 9000, 3000] }];
  return {
    parameterCode: "PZ-017", extractionProfile: "pz-017-heat-components-v1", stage,
    entityKey: "building-total", component, sourceFileId, inputSha256,
    pageNumber: 1, blockIndex: 0, lineIndex: 0, rawValue, rawUnit: "Гкал/ч",
    normalizedValue: rawValue.replace(",", "."), canonicalUnit: "Gcal/h", evidence,
  };
}

function fixture() {
  const pdText = "Тепловая нагрузка на отопление — 0,335 Гкал/ч";
  const rdText = "Тепловой поток на вентиляцию: 0,926 Гкал/ч";
  const sources = [source("PD", "a".repeat(64), "PD", pdText),
    source("RD", "b".repeat(64), "RD", rdText)];
  const pd = fact("PD", sources[0].sha256, "PD", "HEATING", pdText, "0,335");
  const rd = fact("RD", sources[1].sha256, "RD", "VENTILATION", rdText, "0,926");
  const analysis = {
    schemaVersion: "pz-017-analysis-v1", objectId: "OBJ-1", selectedManifestHash: manifestHash,
    selectedFileIds: ["PD", "RD"], extractionProfile: "pz-017-heat-components-v1",
    pdFacts: [pd], rdFacts: [rd], scannedPages: { PD: 1, RD: 1 }, ocrRequiredPageCount: 0,
    comparison: { schemaVersion: "pz-017-component-comparison-v1", parameterCode: "PZ-017",
      disposition: "ABSTAIN", reasonCode: "COMPONENT_BASIS_MISMATCH",
      pdComponents: ["HEATING"], rdComponents: ["VENTILATION"], totalComparable: false, finding: null },
    evaluation: { schemaVersion: "typed-rule-result-v1", ruleId: "pilot-pz-017-heat", ruleVersion: "1",
      parameterCode: "PZ-017", objectId: "OBJ-1", executionStatus: "SUCCEEDED",
      machineStatus: "CLARIFICATION_REQUIRED", reasonCode: "COMPONENT_BASIS_MISMATCH",
      evidence: [], finding: null },
  };
  return { sources, analysis };
}

describe("independent PZ-017 text and geometry verification", () => {
  it("accepts only checked partial evidence with no total or finding", () => {
    const { sources, analysis } = fixture();
    expect(verifyPilotHeatAnalysis(analysis, "OBJ-1", manifestHash, sources)).toBe(true);
  });

  it("rejects forged source, page, line, block geometry and value", () => {
    const mutations = [
      (item: ReturnType<typeof fixture>["analysis"]) => { (item.pdFacts[0].evidence as Record<string, unknown>[])[0].inputSha256 = "c".repeat(64); },
      (item: ReturnType<typeof fixture>["analysis"]) => { (item.pdFacts[0].evidence as Record<string, unknown>[])[0].pageNumber = 2; },
      (item: ReturnType<typeof fixture>["analysis"]) => { (item.pdFacts[0].evidence as Record<string, unknown>[])[0].lineIndex = 1; },
      (item: ReturnType<typeof fixture>["analysis"]) => { (item.pdFacts[0].evidence as Record<string, unknown>[])[0].bboxMilliPoints = [1, 2, 3, 4]; },
      (item: ReturnType<typeof fixture>["analysis"]) => { item.pdFacts[0].rawValue = "9,335"; },
      (item: ReturnType<typeof fixture>["analysis"]) => { item.scannedPages.PD = 2; },
      (item: ReturnType<typeof fixture>["analysis"]) => { (item.evaluation as Record<string, unknown>).finding = { severity: "HIGH" }; },
      (item: ReturnType<typeof fixture>["analysis"]) => { item.comparison.schemaVersion = "forged"; },
      (item: ReturnType<typeof fixture>["analysis"]) => { item.comparison.pdComponents = ["DHW"]; },
    ];
    for (const mutate of mutations) {
      const { sources, analysis } = fixture();
      mutate(analysis);
      expect(verifyPilotHeatAnalysis(analysis, "OBJ-1", manifestHash, sources)).toBe(false);
    }
  });

  it("rejects stale artifact hash and unresolved mixed-source page", () => {
    const { sources, analysis } = fixture();
    sources[1].textArtifactHash = "0".repeat(64);
    expect(verifyPilotHeatAnalysis(analysis, "OBJ-1", manifestHash, sources)).toBe(false);
    const fresh = fixture();
    fresh.sources[1].stages = ["RD", "ID"];
    expect(verifyPilotHeatAnalysis(fresh.analysis, "OBJ-1", manifestHash, fresh.sources)).toBe(false);
  });

  it("checks multiline table blocks against committed text and block bboxes", () => {
    const { sources, analysis } = fixture();
    const heading = { text: "Тепловая\nнагрузка Q,\nГкал/час\nТемперату",
      bboxMilliPoints: [77184, 107867, 150530, 170627] };
    const label = { text: "Отопле\nние", bboxMilliPoints: [157820, 197417, 201884, 227537] };
    const value = { text: "0,331", bboxMilliPoints: [164900, 156587, 200000, 170627] };
    (sources[0].textArtifact!.pages as Record<string, unknown>[])[0].blocks = [heading, label, value];
    sources[0].textArtifactHash = sha256(canonicalJson(sources[0].textArtifact));
    const locators = [heading, label, value].map((block, blockIndex) => ({
      role: ["thermalHeading", "componentHeader", "valueCell"][blockIndex],
      sourceFileId: "PD", inputSha256: sources[0].sha256, pageNumber: 1,
      blockIndex, lineIndex: 0, text: block.text, textKind: "BLOCK",
      bboxMilliPoints: block.bboxMilliPoints,
    }));
    analysis.pdFacts[0] = {
      ...analysis.pdFacts[0], rawValue: "0,331", rawUnit: "Гкал/час",
      normalizedValue: "0.331", blockIndex: 2, evidence: locators,
    };
    expect(verifyPilotHeatAnalysis(analysis, "OBJ-1", manifestHash, sources)).toBe(true);
    locators[1].bboxMilliPoints = [0, 0, 10, 10];
    expect(verifyPilotHeatAnalysis(analysis, "OBJ-1", manifestHash, sources)).toBe(false);
  });

  it("accepts abstention when components match but the units differ", () => {
    const pdText = "Тепловая нагрузка на отопление — 0,335 Гкал/ч";
    const rdText = "Тепловая нагрузка на отопление — 335 кВт";
    const sources = [source("PD", "a".repeat(64), "PD", pdText),
      source("RD", "b".repeat(64), "RD", rdText)];
    const pd = fact("PD", sources[0].sha256, "PD", "HEATING", pdText, "0,335");
    const rd = fact("RD", sources[1].sha256, "RD", "HEATING", rdText, "335");
    rd.rawUnit = "кВт";
    rd.canonicalUnit = "kW";
    const analysis = {
      ...fixture().analysis, pdFacts: [pd], rdFacts: [rd],
      comparison: { schemaVersion: "pz-017-component-comparison-v1", parameterCode: "PZ-017",
        disposition: "ABSTAIN", reasonCode: "UNIT_BASIS_MISMATCH",
        totalComparable: false, finding: null },
      evaluation: { ...fixture().analysis.evaluation, reasonCode: "UNIT_BASIS_MISMATCH" },
    };
    expect(verifyPilotHeatAnalysis(analysis, "OBJ-1", manifestHash, sources)).toBe(true);
  });
});
