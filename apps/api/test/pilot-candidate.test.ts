import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { verifyPilotPz002Candidate, type PilotCandidateSource } from "../src/pilot-candidate.js";

const objectId = "OBJ-1";

function fixture(options: { pdText?: string; rdText?: string; pdUnit?: string; rdUnit?: string } = {}) {
  const sources: PilotCandidateSource[] = [
    { sourceFileId: "FIL-PD", sha256: "a".repeat(64), name: "pd.pdf", stages: ["PD"] },
    { sourceFileId: "FIL-RD", sha256: "b".repeat(64), name: "rd.pdf", stages: ["RD"] },
  ].map((source, index) => {
    const block = {
      bboxMilliPoints: [10_000, 20_000, 300_000, 40_000],
      text: (index === 0 ? options.pdText : options.rdText)
        ?? `Общая площадь здания: ${index === 0 ? "100" : "102"} м2`,
    };
    const textArtifact = {
      schemaVersion: "document-text-v2", sourceFileId: source.sourceFileId,
      inputSha256: source.sha256, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1, qualitySummary: { ocrRequiredPageCount: 0 },
      pages: [{
        pageNumber: 1, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
        quality: { disposition: "TEXT_LAYER_CANDIDATE" }, blocks: [block],
      }],
    };
    return {
      ...source,
      review: {
        sourceSha256: source.sha256, revisionStatus: "CURRENT",
        approvalStatus: "APPROVED", linkGroupId: "building-1", pageStages: {},
      },
      textArtifact, textArtifactHash: sha256(canonicalJson(textArtifact)),
    };
  });
  const evidence = sources.map((source, index) => ({
    role: index === 0 ? "EXPECTED" : "ACTUAL",
    stage: index === 0 ? "PD" : "RD",
    sourceFileId: source.sourceFileId, inputSha256: source.sha256, pageNumber: 1,
    evidenceKind: "TEXT_LAYER", coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
    blockIndex: 0, bboxMilliPoints: [10_000, 20_000, 300_000, 40_000],
    rawValue: index === 0 ? "100" : "102",
    rawUnit: (index === 0 ? options.pdUnit : options.rdUnit) ?? "м2",
    sourceUnit: ((index === 0 ? options.pdUnit : options.rdUnit) ?? "м2").replace(/ /g, ""),
    normalizedValue: index === 0 ? "100" : "102", canonicalUnit: "m2",
  }));
  const evaluation = {
    machineStatus: "CANDIDATE", reasonCode: "THRESHOLD_EXCEEDED",
    entityKey: "building-total", canonicalUnit: "m2",
    normalizedExpected: "100", normalizedActual: "102", delta: "0.02", evidence,
    evidenceFingerprint: sha256(canonicalJson({
      ruleId: "pilot-pz-002-area", ruleVersion: "1", parameterCode: "PZ-002",
      objectId, entityKey: "building-total", evidence,
    })),
  };
  return { analysis: { evaluation, ocrArtifacts: [], ocrRequiredPageCount: 0, ocrProcessedPageCount: 0 }, sources };
}

describe("independent PZ-002 candidate verification", () => {
  it("checks three same-row table cells against saved text blocks", () => {
    const { analysis, sources } = fixture();
    const pdPage = (sources[0].textArtifact!.pages as Array<{ blocks: unknown[] }>)[0];
    pdPage.blocks = [
      { bboxMilliPoints: [10_000, 20_000, 300_000, 120_000],
        text: "Количество мест\nОбщая площадь здания, в т.ч.:\n- выше отм. 0,000" },
      { bboxMilliPoints: [340_000, 90_000, 370_000, 110_000], text: "м ²" },
      { bboxMilliPoints: [400_000, 20_000, 470_000, 120_000], text: "600\n100\n90" },
    ];
    sources[0].textArtifactHash = sha256(canonicalJson(sources[0].textArtifact));
    const row = {
      label: { blockIndex: 0, lineIndex: 1, bboxMilliPoints: [10_000, 90_000, 280_000, 110_000] },
      unit: { blockIndex: 1, lineIndex: 0, bboxMilliPoints: [345_000, 90_000, 365_000, 110_000] },
      value: { blockIndex: 2, lineIndex: 1, bboxMilliPoints: [410_000, 90_000, 460_000, 110_000] },
    };
    const evidence = (analysis.evaluation.evidence as Array<Record<string, unknown>>);
    const visualContent = {
      schemaVersion: "document-ocr-page-v1", sourceFileId: "FIL-PD",
      inputSha256: "a".repeat(64), pageNumber: 1,
      render: { sha256: "c".repeat(64), widthPx: 1000, heightPx: 1000,
        dpi: 120, rendererProfileId: "test-render" },
      provider: { profileId: "test-ocr", script: "eslav" },
      lines: [
        { text: "Общая площадь здания, в т.ч.:", score: 0.96, bboxPx: [10, 100, 350, 130] },
        { text: "100", score: 0.99, bboxPx: [500, 101, 590, 130] },
      ],
    };
    const visual = { ...visualContent, contentHash: sha256(canonicalJson(visualContent)) };
    const crosscheck = {
      sourceFileId: "FIL-PD", inputSha256: "a".repeat(64), pageNumber: 1, rawValue: "100",
      ocrArtifactHash: visual.contentHash, renderSha256: "c".repeat(64),
      labelLineIndex: 0, valueLineIndex: 1, minimumOcrScore: 0.96,
    };
    Object.assign(analysis, { tableOcrArtifacts: [visual], tableCrosschecks: [crosscheck] });
    evidence[0] = {
      ...evidence[0], evidenceKind: "TABLE_ROW", tableRow: row, rawUnit: "м ²", sourceUnit: "м²",
      bboxMilliPoints: [10_000, 90_000, 460_000, 110_000], tableVisual: crosscheck,
    };
    delete evidence[0].blockIndex;
    analysis.evaluation.evidenceFingerprint = sha256(canonicalJson({
      ruleId: "pilot-pz-002-area", ruleVersion: "1", parameterCode: "PZ-002",
      objectId, entityKey: "building-total", evidence,
    }));
    expect(verifyPilotPz002Candidate(analysis, objectId, sources)).toMatchObject({
      expectedValue: "100 м²", actualValue: "102 м²",
    });
    expect(verifyPilotPz002Candidate({ ...analysis, tableOcrArtifacts: [] }, objectId, sources)).toBeNull();
    const forged = structuredClone(analysis);
    (forged.evaluation.evidence as Array<Record<string, unknown>>)[0] = {
      ...evidence[0], tableRow: { ...row, value: { ...row.value, lineIndex: 2 } },
    };
    expect(verifyPilotPz002Candidate(forged, objectId, sources)).toBeNull();
  });

  it("accepts one approved PD/RD text pair exceeding the 1% threshold", () => {
    const { analysis, sources } = fixture();
    expect(verifyPilotPz002Candidate(analysis, objectId, sources)).toMatchObject({
      expectedValue: "100 м²", actualValue: "102 м²",
      evidence: [{ fileId: "FIL-PD", pdfPageNumber: 1 }, { fileId: "FIL-RD", pdfPageNumber: 1 }],
    });
  });

  it("skips mapped ID pages and rejects unresolved mixed pages", () => {
    const { analysis, sources } = fixture();
    const rd = sources[1];
    rd.stages = ["RD", "ID"];
    rd.review!.pageStages = { "1": "RD", "2": "ID" };
    rd.textArtifact!.pageCount = 2;
    (rd.textArtifact!.pages as Array<Record<string, unknown>>).push({
      pageNumber: 2, widthMilliPoints: 595_000, heightMilliPoints: 842_000,
      quality: { disposition: "TEXT_LAYER_CANDIDATE" },
      blocks: [{ bboxMilliPoints: [10_000, 20_000, 300_000, 40_000], text: "Каталог оборудования" }],
    });
    rd.textArtifactHash = sha256(canonicalJson(rd.textArtifact));
    expect(verifyPilotPz002Candidate(analysis, objectId, sources)).toMatchObject({ actualValue: "102 м²" });
    rd.review!.pageStages["2"] = "UNRESOLVED";
    expect(verifyPilotPz002Candidate(analysis, objectId, sources)).toBeNull();
    delete rd.review!.pageStages["2"];
    expect(verifyPilotPz002Candidate(analysis, objectId, sources)).toBeNull();
  });

  it("verifies table unit-before-value and area-variable forms from source blocks", () => {
    const { analysis, sources } = fixture({
      pdText: "Общая площадь здания, в т.ч.:\nм ²\n100\n- выше отм. 0,000 90",
      rdText: "Общая площадь здания S=102 кв.м;",
      pdUnit: "м ²", rdUnit: "кв.м",
    });
    expect(verifyPilotPz002Candidate(analysis, objectId, sources)).toMatchObject({
      expectedValue: "100 м²", actualValue: "102 м²",
    });
  });

  it("rejects changed evidence, unapproved input, duplicate facts and OCR", () => {
    const { analysis, sources } = fixture();
    const evaluation = analysis.evaluation;
    expect(verifyPilotPz002Candidate({ ...analysis, evaluation: {
      ...evaluation, normalizedActual: "103",
    } }, objectId, sources)).toBeNull();
    expect(verifyPilotPz002Candidate(analysis, objectId, [sources[0], {
      ...sources[1], review: { ...sources[1].review!, approvalStatus: "UNAPPROVED" },
    }])).toBeNull();
    const duplicate = structuredClone(sources);
    (duplicate[1].textArtifact!.pages as Array<{
      blocks: Array<{ text: string; bboxMilliPoints: number[] }>;
    }>)[0].blocks.push({
      text: "Общая площадь здания: 102 м2",
      bboxMilliPoints: [10_000, 50_000, 300_000, 70_000],
    });
    duplicate[1].textArtifactHash = sha256(canonicalJson(duplicate[1].textArtifact));
    expect(verifyPilotPz002Candidate(analysis, objectId, duplicate)).toBeNull();
    expect(verifyPilotPz002Candidate({ ...analysis, ocrRequiredPageCount: 1 }, objectId, sources)).toBeNull();
  });
});
