import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { candidateFamilyPreviewSpecs } from "../src/candidate-family-preview.js";
import { normalizeFact, verifyComparatorOutcome, verifyFactFamilyProposals,
  verifiedReviewedFactEntityLinks,
  type FactFamilyVerificationInput } from "../src/fact-family-proposals.js";
import { pilotFactFamilyRules } from "../src/pilot-rules.js";

const objectId = "OBJ-1";
const manifestHash = "f".repeat(64);
const bbox = [100, 200, 900, 250];

function hashed<T extends Record<string, unknown>>(value: T): T & { contentHash: string } {
  return { ...value, contentHash: sha256(canonicalJson(value)) };
}

function fact(sourceFileId: string, sourceSha256: string, stage: string,
  rawValue: string): Record<string, unknown> {
  const rawText = `Строительный объем здания ${rawValue} м³`;
  const start = rawText.indexOf(rawValue);
  const value = {
    schemaVersion: "typed-fact-v1", parameterCode: "PZ-004", objectId,
    attribute: "BUILDING_VOLUME", stage, sourceFileId, sourceSha256,
    pageNumber: 1, rawText, rawValue, rawUnit: "м³",
    locator: { kind: "TEXT_BLOCK", blockIndex: 0, start, end: start + rawValue.length,
      bboxMilliPoints: bbox },
  };
  return { factId: sha256(canonicalJson(value)), ...value };
}

function comparison(rule: (typeof pilotFactFamilyRules)[number], reasonCode: string,
  expectedFactId: string | null = null, actualFactId: string | null = null) {
  return hashed({ schemaVersion: "fact-comparison-result-v1", ruleId: rule.ruleId,
    ruleVersion: rule.version, objectId, parameterCode: rule.parameterCode,
    attribute: rule.attribute, expectedStage: rule.expectedStage, actualStage: rule.actualStage,
    canonicalUnit: rule.canonicalUnit, status: "ABSTAIN", reasonCodes: [reasonCode],
    expectedFactId, actualFactId, normalizedExpected: null, normalizedActual: null,
    comparison: null });
}

function fixture(): FactFamilyVerificationInput {
  const pdSha = "a".repeat(64);
  const rdSha = "b".repeat(64);
  const pd = fact("PD", pdSha, "PD", "100");
  const rd = fact("RD", rdSha, "RD", "90");
  const textArtifacts: FactFamilyVerificationInput["textArtifacts"] = {};
  for (const [id, sourceSha, text] of [["PD", pdSha, pd.rawText], ["RD", rdSha, rd.rawText]]) {
    const content = { schemaVersion: "document-text-v2", sourceFileId: id,
      inputSha256: sourceSha, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1, pages: [{ pageNumber: 1, widthMilliPoints: 1000,
        heightMilliPoints: 1000, quality: { disposition: "TEXT_LAYER_CANDIDATE" },
        blocks: [{ text, bboxMilliPoints: bbox }] }] };
    textArtifacts[id as string] = { content_json: content,
      content_hash: sha256(canonicalJson(content)) };
  }
  const sourceReviews = Object.fromEntries(["PD", "RD"].map((id) => [id, {
    sourceSha256: id === "PD" ? pdSha : rdSha,
    revisionStatus: "CURRENT", approvalStatus: "APPROVED", linkGroupId: "building-1",
    pageStages: {}, contentHash: "c".repeat(64), decisionHash: "c".repeat(64),
  }]));
  const comparisons = pilotFactFamilyRules.map((rule, index) => comparison(rule,
    index === 0 ? "ENTITY_LINK_MISSING" : "REQUIRED_FACT_MISSING",
    index === 0 ? pd.factId as string : null, index === 0 ? rd.factId as string : null));
  return {
    objectId, inputManifestHash: manifestHash,
    sourceFiles: [
      { sourceFileId: "PD", objectId, sha256: pdSha, stages: ["PD"],
        sectionCode: "AR", sourceReviewHash: "c".repeat(64) },
      { sourceFileId: "RD", objectId, sha256: rdSha, stages: ["RD"],
        sectionCode: "AR", sourceReviewHash: "c".repeat(64) },
    ], sourceReviews, textArtifacts,
    rules: [...pilotFactFamilyRules], entityLinks: [],
    result: hashed({ schemaVersion: "fact-family-proposals-v1", inputManifestHash: manifestHash,
      objectId, facts: [pd, rd], comparisons, outputCount: 7, findingCount: 0 }),
  };
}

function rehash(input: FactFamilyVerificationInput): void {
  const result = input.result as Record<string, unknown>;
  const { contentHash: _ignored, ...content } = result;
  result.contentHash = sha256(canonicalJson(content));
}

function clone(): FactFamilyVerificationInput {
  return structuredClone(fixture());
}

function linkedFixture(): FactFamilyVerificationInput {
  const input = clone();
  const result = input.result as Record<string, unknown>;
  const facts = result.facts as Record<string, unknown>[];
  const [pd, rd] = facts;
  input.entityLinks = [{ schemaVersion: "fact-entity-link-v1", pdFactId: pd.factId,
    actualFactId: rd.factId, objectId, linkGroupId: "building-1", basis: "Same building",
    evidence: facts.map((item) => ({ factId: item.factId, sourceFileId: item.sourceFileId,
      sourceSha256: item.sourceSha256, pageNumber: item.pageNumber, locator: item.locator })) }];
  const comparisons = result.comparisons as Record<string, unknown>[];
  const { contentHash: _ignored, ...base } = comparisons[0];
  comparisons[0] = hashed({ ...base, status: "REVIEW_REQUIRED",
    reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"], normalizedExpected: "100",
    normalizedActual: "90", comparison: { family: "DIFFERENT", operator: "!=",
      threshold: "0", observed: "10", triggered: true } });
  rehash(input);
  return input;
}

function pythonMultiFixture(): FactFamilyVerificationInput {
  const pythonBox = [1000, 1000, 300000, 3000];
  const specs = [
    { id: "PD", sha: "a".repeat(64), stage: "PD", value: "100" },
    { id: "RD", sha: "b".repeat(64), stage: "RD", value: "90" },
    { id: "RD2", sha: "d".repeat(64), stage: "RD", value: "95" },
  ];
  const facts = specs.map(({ id, sha, stage, value }) => {
    const rawText = `Строительный объем здания ${value} м³`;
    const body = { schemaVersion: "typed-fact-v1", parameterCode: "PZ-004", objectId,
      attribute: "BUILDING_VOLUME", stage, sourceFileId: id, sourceSha256: sha,
      pageNumber: 1, rawText, rawValue: value, rawUnit: "м³",
      locator: { kind: "TEXT_BLOCK", blockIndex: 0, start: 26, end: 26 + value.length,
        bboxMilliPoints: pythonBox } };
    return { factId: sha256(canonicalJson(body)), ...body };
  });
  expect(facts.map((item) => item.factId)).toEqual([
    "79378137bbc88021c63ba62e2b12e43c7a051b0266a181a7f57ebfadf79a596b",
    "30933f945cbea44eea7374508593882edecfa772642fcd8a66cd16d36d893167",
    "bb8aacd9d6d14b6abe54e2d36ed1fe847a511a863419aa219c153283b140d586",
  ]);
  const textArtifacts: FactFamilyVerificationInput["textArtifacts"] = {};
  for (const [index, spec] of specs.entries()) {
    const content = { schemaVersion: "document-text-v2", sourceFileId: spec.id,
      inputSha256: spec.sha, coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1, pages: [{ pageNumber: 1, widthMilliPoints: 600000,
        heightMilliPoints: 800000, quality: { disposition: "TEXT_LAYER_CANDIDATE" },
        blocks: [{ text: facts[index].rawText, bboxMilliPoints: pythonBox }] }] };
    textArtifacts[spec.id] = { content_json: content, content_hash: sha256(canonicalJson(content)) };
  }
  const comparisons = pilotFactFamilyRules.map((rule, index) => comparison(rule,
    index === 0 ? "AMBIGUOUS_FACTS" : "REQUIRED_FACT_MISSING"));
  expect(comparisons[0].contentHash).toBe(
    "163affbf82a22f67cc574876d14e2a8caa6448375ac321b31e592106ebdcde68");
  const result = hashed({ schemaVersion: "fact-family-proposals-v1", inputManifestHash: manifestHash,
    objectId, facts, comparisons, outputCount: 8, findingCount: 0 });
  expect(result.contentHash).toBe("396db2126d3ae10dfb1553a6343e3c0c76915e39eff5171787da1dcea6a733d0");
  return { objectId, inputManifestHash: manifestHash,
    sourceFiles: specs.map((spec) => ({ sourceFileId: spec.id, objectId,
      sha256: spec.sha, stages: [spec.stage], sectionCode: "AR",
      sourceReviewHash: "c".repeat(64) })),
    sourceReviews: Object.fromEntries(specs.map((spec) => [spec.id, {
      sourceSha256: spec.sha, revisionStatus: "CURRENT", approvalStatus: "APPROVED",
      linkGroupId: "building-1", pageStages: {}, contentHash: "c".repeat(64),
      decisionHash: "c".repeat(64),
    }])),
    textArtifacts, rules: [...pilotFactFamilyRules], entityLinks: [], result };
}

function reviewedEnvelope(input: FactFamilyVerificationInput, actualIndex = 1): Record<string, unknown> {
  const facts = (input.result as Record<string, unknown>).facts as Record<string, unknown>[];
  const pd = facts[0];
  const rd = facts[actualIndex];
  const link = { schemaVersion: "fact-entity-link-v1", pdFactId: pd.factId,
    actualFactId: rd.factId, objectId, linkGroupId: "building-1", basis: "Same building",
    evidence: [pd, rd].map((fact) => ({ factId: fact.factId, sourceFileId: fact.sourceFileId,
      sourceSha256: fact.sourceSha256, pageNumber: fact.pageNumber, locator: fact.locator })) };
  const contentHash = sha256(canonicalJson({ actorId: "reviewer-1", link }));
  if (actualIndex === 1) expect(contentHash).toBe(
    "d1d7af2df30d355306f03d830ad26a5b2f829fe201179cb56798b614715fb170");
  return { schemaVersion: "reviewed-fact-entity-link-v1", link, actorId: "reviewer-1",
    contentHash, decisionHash: contentHash };
}

describe("fact-family proposal admission", () => {
  it("accepts every pinned scalar candidate unit without inferring a class or set order", () => {
    const nonScalar = new Set(["set", "finish_fire_class", "fire_rating",
      "reliability_category", "energy_class", "fire_resistance_degree",
      "structural_fire_hazard_class"]);
    for (const spec of Object.values(candidateFamilyPreviewSpecs)) {
      for (const [attribute, unit] of Object.entries(spec.attributes)) {
        if (nonScalar.has(unit)) continue;
        expect(normalizeFact({ rawValue: "1", rawUnit: unit, attribute }, unit),
          `${attribute} / ${unit}`).not.toBeNull();
      }
    }
  });

  it("normalizes pinned numeric-family units exactly and rejects incompatible OCR units", () => {
    const value = (rawValue: string, rawUnit: string) => ({
      rawValue, rawUnit, attribute: "TOTAL_HEATING_LOAD",
    });
    expect(normalizeFact(value("15,814", "м"), "m"))
      .toEqual({ numerator: 15814n, denominator: 1000n });
    expect(normalizeFact(value("15814", "мм"), "m"))
      .toEqual({ numerator: 15814n, denominator: 1000n });
    expect(normalizeFact(value("389,893", "кВт"), "kW"))
      .toEqual({ numerator: 389893n, denominator: 1000n });
    expect(normalizeFact(value("0,335", "Гкал/час"), "Gcal/h"))
      .toEqual({ numerator: 335n, denominator: 1000n });
    expect(normalizeFact(value("1000", "кг"), "t"))
      .toEqual({ numerator: 1000n, denominator: 1000n });
    expect(normalizeFact(value("389,893", "кВт"), "Gcal/h")).toBeNull();
    expect(normalizeFact(value("0,335", "Гкал/ч"), "kW")).toBeNull();
    expect(normalizeFact(value("15,814", "метров"), "m")).toBeNull();
  });

  it("normalizes кв. only as an apartment count observation", () => {
    const apartment = { parameterCode: "PZ-010", rawValue: "42", rawUnit: "кв.",
      attribute: "APARTMENT_COUNT" };
    expect(normalizeFact(apartment, "count")).toEqual({ numerator: 42n, denominator: 1n });
    expect(normalizeFact({ ...apartment, attribute: "ABOVE_GROUND_FLOOR_COUNT" }, "count"))
      .toBeNull();
    expect(normalizeFact(apartment, "m2")).toBeNull();
  });

  it("matches Python's strict concrete class syntax", () => {
    const fact = { rawValue: "В30", rawUnit: "В", attribute: "CONCRETE_CLASS" };
    expect(normalizeFact(fact, "B_CLASS")).toEqual({ numerator: 30n, denominator: 1n });
    for (const rawValue of ["В-30", "В1 000", "В30 ", "В+30", "В0.5.1"]) {
      expect(normalizeFact({ ...fact, rawValue }, "B_CLASS")).toBeNull();
    }
  });

  it("matches Python INCREASE results and requires a strict threshold", () => {
    const comparator = { family: "INCREASE", operator: ">", threshold: "4" };
    const triggered = { status: "REVIEW_REQUIRED", reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"],
      comparison: { family: "INCREASE", operator: ">", threshold: "4",
        observed: "5", triggered: true } };
    expect(verifyComparatorOutcome(comparator, "100", "105", triggered)).toBe(true);
    expect(verifyComparatorOutcome(comparator, "100", "105", {
      ...triggered, comparison: { ...triggered.comparison, observed: "-5" } })).toBe(false);
    const equalThreshold = { family: "INCREASE", operator: ">", threshold: "5" };
    expect(verifyComparatorOutcome(equalThreshold, "100", "105", {
      status: "REVIEW_REQUIRED", reasonCodes: ["COMPARISON_NOT_TRIGGERED_REVIEW"],
      comparison: { family: "INCREASE", operator: ">", threshold: "5",
        observed: "5", triggered: false } })).toBe(true);
    expect(verifyComparatorOutcome({ family: "INCREASE", operator: ">", threshold: "0" },
      "100", "95", { status: "REVIEW_REQUIRED",
        reasonCodes: ["COMPARISON_NOT_TRIGGERED_REVIEW"],
        comparison: { family: "INCREASE", operator: ">", threshold: "0",
          observed: "-5", triggered: false } })).toBe(true);
  });

  it("matches Python RELATIVE_INCREASE results, including recurring decimals", () => {
    const comparator = { family: "RELATIVE_INCREASE", operator: ">", threshold: "0.1" };
    expect(verifyComparatorOutcome(comparator, "100", "112", {
      status: "REVIEW_REQUIRED", reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"],
      comparison: { family: "RELATIVE_INCREASE", operator: ">", threshold: "0.1",
        observed: "0.12", triggered: true } })).toBe(true);
    expect(verifyComparatorOutcome({ ...comparator, threshold: "0.12" }, "100", "112", {
      status: "REVIEW_REQUIRED", reasonCodes: ["COMPARISON_NOT_TRIGGERED_REVIEW"],
      comparison: { family: "RELATIVE_INCREASE", operator: ">", threshold: "0.12",
        observed: "0.12", triggered: false } })).toBe(true);
    expect(verifyComparatorOutcome({ ...comparator, threshold: "0" }, "100", "95", {
      status: "REVIEW_REQUIRED", reasonCodes: ["COMPARISON_NOT_TRIGGERED_REVIEW"],
      comparison: { family: "RELATIVE_INCREASE", operator: ">", threshold: "0",
        observed: "-0.05", triggered: false } })).toBe(true);
    const pythonThird = "0.33333333333333333333333333333333333333333333333333333333333333333333333333333333";
    expect(verifyComparatorOutcome({ ...comparator, threshold: "0.3" }, "3", "4", {
      status: "REVIEW_REQUIRED", reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"],
      comparison: { family: "RELATIVE_INCREASE", operator: ">", threshold: "0.3",
        observed: pythonThird, triggered: true } })).toBe(true);
  });

  it("requires ZERO_BASELINE abstention for relative increase", () => {
    const comparator = { family: "RELATIVE_INCREASE", operator: ">", threshold: "0" };
    expect(verifyComparatorOutcome(comparator, "0", "10", {
      status: "ABSTAIN", reasonCodes: ["ZERO_BASELINE"], comparison: null })).toBe(true);
    expect(verifyComparatorOutcome(comparator, "0", "10", {
      status: "REVIEW_REQUIRED", reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"],
      comparison: { family: "RELATIVE_INCREASE", operator: ">", threshold: "0",
        observed: "10", triggered: true } })).toBe(false);
    expect(verifyComparatorOutcome({ ...comparator, operator: "!=" }, "0", "10", {
      status: "ABSTAIN", reasonCodes: ["ZERO_BASELINE"], comparison: null })).toBe(false);
  });

  it("accepts Python multiple-fact ABSTAIN without a reviewed link", () => {
    const input = pythonMultiFixture();
    expect(verifyFactFamilyProposals(input)).toBe(true);
    const forged = structuredClone(input);
    const comparisons = (forged.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
    comparisons[0].status = "REVIEW_REQUIRED";
    comparisons[0].contentHash = sha256(canonicalJson(Object.fromEntries(
      Object.entries(comparisons[0]).filter(([key]) => key !== "contentHash"))));
    rehash(forged);
    expect(verifyFactFamilyProposals(forged)).toBe(false);
  });

  it("accepts Python selected pair only through one hashed reviewed link", () => {
    const input = pythonMultiFixture();
    const envelope = reviewedEnvelope(input);
    const facts = (input.result as Record<string, unknown>).facts;
    input.entityLinks = verifiedReviewedFactEntityLinks([envelope], objectId, facts,
      input.sourceFiles, input.sourceReviews);
    expect(input.entityLinks).toEqual([envelope.link]);
    const comparisons = (input.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
    const { contentHash: _ignored, ...content } = comparisons[0];
    comparisons[0] = hashed({ ...content, status: "REVIEW_REQUIRED",
      reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"],
      expectedFactId: (facts as Record<string, unknown>[])[0].factId,
      actualFactId: (facts as Record<string, unknown>[])[1].factId,
      normalizedExpected: "100", normalizedActual: "90",
      comparison: { family: "DIFFERENT", operator: "!=", threshold: "0",
        observed: "10", triggered: true } });
    expect(comparisons[0].contentHash).toBe(
      "d0b82d3bedd53d0cdfb7d844467a7742c8891a7213a0507f96b790f17b20bf8d");
    rehash(input);
    expect((input.result as Record<string, unknown>).contentHash).toBe(
      "7fb1e86e651cc11a7d1f551338a30830df4a62d95ccfcb9e9d958e4f4db06e77");
    expect(verifyFactFamilyProposals(input)).toBe(true);
  });

  it("selects the linked later RD fact, never the first candidate", () => {
    const input = pythonMultiFixture();
    const facts = (input.result as Record<string, unknown>).facts as Record<string, unknown>[];
    const envelope = reviewedEnvelope(input, 2);
    input.entityLinks = verifiedReviewedFactEntityLinks([envelope], objectId, facts,
      input.sourceFiles, input.sourceReviews);
    expect(input.entityLinks).toEqual([envelope.link]);
    const comparisons = (input.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
    const { contentHash: _ignored, ...content } = comparisons[0];
    comparisons[0] = hashed({ ...content, status: "REVIEW_REQUIRED",
      reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"],
      expectedFactId: facts[0].factId, actualFactId: facts[2].factId,
      normalizedExpected: "100", normalizedActual: "95",
      comparison: { family: "DIFFERENT", operator: "!=", threshold: "0",
        observed: "5", triggered: true } });
    expect(comparisons[0].contentHash).toBe(
      "5f5dd5d3995634bb81050d895287f2f848e98d9903e6e047fd8799fa93003e47");
    rehash(input);
    expect(verifyFactFamilyProposals(input)).toBe(true);
    const forged = structuredClone(input);
    (forged.result as Record<string, unknown>).comparisons = [
      hashed({ ...content, status: "REVIEW_REQUIRED",
        reasonCodes: ["COMPARISON_TRIGGERED_REVIEW"],
        expectedFactId: facts[0].factId, actualFactId: facts[1].factId,
        normalizedExpected: "100", normalizedActual: "90",
        comparison: { family: "DIFFERENT", operator: "!=", threshold: "0",
          observed: "10", triggered: true } }), ...comparisons.slice(1)];
    rehash(forged);
    expect(verifyFactFamilyProposals(forged)).toBe(false);
  });

  it("keeps multiple facts abstained for duplicate links and rejects stale envelope hashes", () => {
    const input = pythonMultiFixture();
    const envelope = reviewedEnvelope(input);
    const facts = (input.result as Record<string, unknown>).facts;
    const changed = { ...envelope, decisionHash: "0".repeat(64) };
    expect(verifiedReviewedFactEntityLinks([changed], objectId, facts,
      input.sourceFiles, input.sourceReviews)).toEqual([]);
    expect(verifiedReviewedFactEntityLinks([envelope], objectId, facts,
      input.sourceFiles, { ...input.sourceReviews,
        RD: { ...input.sourceReviews.RD, approvalStatus: "UNAPPROVED" } })).toEqual([]);
    input.entityLinks = verifiedReviewedFactEntityLinks([envelope, envelope], objectId, facts,
      input.sourceFiles, input.sourceReviews);
    expect(input.entityLinks).toHaveLength(2);
    const comparisons = (input.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
    comparisons[0].reasonCodes = ["AMBIGUOUS_ENTITY_LINK"];
    comparisons[0].contentHash = sha256(canonicalJson(Object.fromEntries(
      Object.entries(comparisons[0]).filter(([key]) => key !== "contentHash"))));
    rehash(input);
    expect(verifyFactFamilyProposals(input)).toBe(true);
  });

  it("accepts actual Python pipeline output hashes across JSON canonicalization", () => {
    // Generated by evaluate_fact_family_bundle with one PD document-text-v2 artifact.
    const pythonFact = {
      factId: "d05cca9394c93ea0b201a1a81bc5f097e8ea6ae94929516c9b0d280a74f730f0",
      schemaVersion: "typed-fact-v1", parameterCode: "PZ-004", objectId: "OBJECT-A",
      attribute: "BUILDING_VOLUME", stage: "PD", sourceFileId: "FILE-A",
      sourceSha256: "a".repeat(64), pageNumber: 1,
      rawText: "Строительный объем здания V = 60997.93 куб. м",
      rawValue: "60997.93", rawUnit: "куб. м",
      locator: { kind: "TEXT_BLOCK", blockIndex: 0, start: 30, end: 38,
        bboxMilliPoints: [1000, 1000, 300000, 3000] },
    };
    const pythonComparisonHashes = [
      "6117a19037c34b7baebc91baa142f029f5014919dbc0fc25c3b1f2a39ec19e92",
      "f05e55e24ec9d06993b73e46bfb407b291494890d1098b495e201c2917c0e565",
      "2b3948f7afec175fd452a3db6a5ada3848147da6c00f68005d4097397d11612d",
      "bc3ecb495c7fac521770052226e407e2abe9fca87985200ca2aab93fc1b17f77",
      "5bfc30535c7b0a3d479518f98e80881288e9d13ce007d42df931e52732da3439",
    ];
    const comparisons = pilotFactFamilyRules.map((rule) => hashed({
      schemaVersion: "fact-comparison-result-v1", ruleId: rule.ruleId,
      ruleVersion: rule.version, objectId: "OBJECT-A", parameterCode: rule.parameterCode,
      attribute: rule.attribute, expectedStage: rule.expectedStage, actualStage: rule.actualStage,
      canonicalUnit: rule.canonicalUnit, status: "ABSTAIN",
      reasonCodes: ["REQUIRED_FACT_MISSING"], expectedFactId: null, actualFactId: null,
      normalizedExpected: null, normalizedActual: null, comparison: null,
    }));
    expect(comparisons.map((item) => item.contentHash)).toEqual(pythonComparisonHashes);
    const content = { schemaVersion: "fact-family-proposals-v1", inputManifestHash: manifestHash,
      objectId: "OBJECT-A", facts: [pythonFact], comparisons, outputCount: 6, findingCount: 0 };
    const result = hashed(content);
    expect(result.contentHash).toBe("06b7add153fffc85f3787ed9718d755d20319265c759e117524e26162d0c999d");
    const artifact = { schemaVersion: "document-text-v2", sourceFileId: "FILE-A",
      inputSha256: "a".repeat(64), coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS",
      pageCount: 1, pages: [{ pageNumber: 1, widthMilliPoints: 600000,
        heightMilliPoints: 800000, quality: { disposition: "TEXT_LAYER_CANDIDATE" },
        blocks: [{ text: pythonFact.rawText, bboxMilliPoints: pythonFact.locator.bboxMilliPoints }] }] };
    const input: FactFamilyVerificationInput = {
      objectId: "OBJECT-A", inputManifestHash: manifestHash,
      sourceFiles: [{ sourceFileId: "FILE-A", objectId: "OBJECT-A", sha256: "a".repeat(64),
        stages: ["PD"], sectionCode: null, sourceReviewHash: null }],
      sourceReviews: {}, textArtifacts: { "FILE-A": { content_json: artifact,
        content_hash: sha256(canonicalJson(artifact)) } },
      result, rules: [...pilotFactFamilyRules], entityLinks: [],
    };
    expect(verifyFactFamilyProposals(input)).toBe(true);
  });

  it("checks Python PZ row and KR context locators against their own blocks", () => {
    const pz = {
      factId: "64872e37271b25e6edd2b3684740768d427631c8326d862c6fd8cf91d647c1d6",
      schemaVersion: "typed-fact-v1", parameterCode: "PZ-004", objectId: "OBJ",
      attribute: "BUILDING_VOLUME", stage: "PD", sourceFileId: "PZ",
      sourceSha256: "a".repeat(64), pageNumber: 1, rawText: "60997.93",
      rawValue: "60997.93", rawUnit: "м³",
      locator: { kind: "TEXT_BLOCK", blockIndex: 2, start: 0, end: 8,
        bboxMilliPoints: [270000, 1000, 350000, 3000] },
      labelLocator: { kind: "TEXT_BLOCK", blockIndex: 0, start: 0, end: 25,
        bboxMilliPoints: [1000, 1000, 190000, 3000], text: "Строительный объем здания" },
      unitLocator: { kind: "TEXT_BLOCK", blockIndex: 1, start: 0, end: 2,
        bboxMilliPoints: [220000, 1000, 250000, 3000], text: "м³" },
    };
    const kr = {
      schemaVersion: "typed-fact-v1", parameterCode: "KR-058", objectId: "OBJ",
      attribute: "FOUNDATION_THICKNESS", stage: "PD", sourceFileId: "KR",
      sourceSha256: "b".repeat(64), pageNumber: 1, rawText: "250 мм",
      rawValue: "250", rawUnit: "мм",
      locator: { kind: "TEXT_BLOCK", blockIndex: 1, start: 0, end: 3,
        bboxMilliPoints: [180000, 100000, 210000, 110000] },
      elementType: "FOUNDATION",
      contextLocator: { kind: "TEXT_BLOCK", blockIndex: 0, start: 0, end: 26,
        bboxMilliPoints: [1000, 100000, 120000, 110000], text: "Толщина фундаментной плиты" },
      factId: "8ff1bc2f1368e4fa291bcc0b52c5e3105c9caad95125db1a91cdae28deeac05d",
    };
    const blocks = {
      PZ: [pz.labelLocator, pz.unitLocator, { ...pz.locator, text: pz.rawText }],
      KR: [kr.contextLocator, { ...kr.locator, text: kr.rawText }],
    };
    const textArtifacts: FactFamilyVerificationInput["textArtifacts"] = {};
    for (const id of ["PZ", "KR"] as const) {
      const content = { schemaVersion: "document-text-v2", sourceFileId: id,
        inputSha256: (id === "PZ" ? "a" : "b").repeat(64),
        coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: 1,
        pages: [{ pageNumber: 1, widthMilliPoints: 600000, heightMilliPoints: 800000,
          quality: { disposition: "TEXT_LAYER_CANDIDATE" },
          blocks: blocks[id].map((block) => ({ text: block.text,
            bboxMilliPoints: block.bboxMilliPoints })) }] };
      textArtifacts[id] = { content_json: content, content_hash: sha256(canonicalJson(content)) };
    }
    const comparisons = pilotFactFamilyRules.map((rule) => hashed({
      schemaVersion: "fact-comparison-result-v1", ruleId: rule.ruleId,
      ruleVersion: rule.version, objectId: "OBJ", parameterCode: rule.parameterCode,
      attribute: rule.attribute, expectedStage: rule.expectedStage, actualStage: rule.actualStage,
      canonicalUnit: rule.canonicalUnit, status: "ABSTAIN",
      reasonCodes: ["REQUIRED_FACT_MISSING"], expectedFactId: null, actualFactId: null,
      normalizedExpected: null, normalizedActual: null, comparison: null,
    }));
    const input: FactFamilyVerificationInput = {
      objectId: "OBJ", inputManifestHash: manifestHash,
      sourceFiles: ["PZ", "KR"].map((id) => ({ sourceFileId: id, objectId: "OBJ",
        sha256: (id === "PZ" ? "a" : "b").repeat(64), stages: ["PD"],
        sectionCode: null, sourceReviewHash: null })),
      sourceReviews: {}, textArtifacts, rules: [...pilotFactFamilyRules], entityLinks: [],
      result: hashed({ schemaVersion: "fact-family-proposals-v1", inputManifestHash: manifestHash,
        objectId: "OBJ", facts: [pz, kr], comparisons, outputCount: 7, findingCount: 0 }),
    };
    expect(verifyFactFamilyProposals(input)).toBe(true);
    const result = input.result as Record<string, unknown>;
    const facts = result.facts as Record<string, unknown>[];
    ((facts[0].unitLocator as Record<string, unknown>).bboxMilliPoints as number[])[0] = 1;
    facts[0].factId = sha256(canonicalJson(Object.fromEntries(
      Object.entries(facts[0]).filter(([key]) => key !== "factId"))));
    rehash(input);
    expect(verifyFactFamilyProposals(input)).toBe(false);
  });

  it("accepts anchored facts and independently justified abstentions", () => {
    expect(verifyFactFamilyProposals(fixture())).toBe(true);
  });

  it("accepts a review-only comparison only with an explicit verified entity link", () => {
    const input = linkedFixture();
    expect(verifyFactFamilyProposals(input)).toBe(true);

    input.sourceFiles[1].sectionCode = "OV";
    expect(verifyFactFamilyProposals(input)).toBe(false);
  });

  it("rejects forged linked-pair arithmetic, evidence, and frozen review status", () => {
    const changes: Array<(input: FactFamilyVerificationInput) => void> = [
      (input) => { const rows = (input.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
        (rows[0].comparison as Record<string, unknown>).observed = "11"; },
      (input) => { const rows = (input.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
        (rows[0].comparison as Record<string, unknown>).triggered = false; },
      (input) => { const rows = (input.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
        rows[0].normalizedActual = "91"; },
      (input) => { const link = input.entityLinks[0] as Record<string, unknown>;
        ((link.evidence as Record<string, unknown>[])[1].locator as Record<string, unknown>).start = 1; },
      (input) => { input.sourceReviews.RD.approvalStatus = "UNAPPROVED"; },
      (input) => { input.sourceReviews.RD.revisionStatus = "SUPERSEDED"; },
      (input) => { input.sourceReviews.RD.linkGroupId = "different-building"; },
      (input) => { input.rules = [...input.rules].reverse(); },
    ];
    for (const change of changes) {
      const input = linkedFixture();
      change(input);
      const result = input.result as Record<string, unknown>;
      const comparisons = result.comparisons as Record<string, unknown>[];
      comparisons[0].contentHash = sha256(canonicalJson(Object.fromEntries(
        Object.entries(comparisons[0]).filter(([key]) => key !== "contentHash"))));
      rehash(input);
      expect(verifyFactFamilyProposals(input)).toBe(false);
    }
  });

  it("abstains when linked facts name different entity context", () => {
    const input = linkedFixture();
    const result = input.result as Record<string, unknown>;
    const facts = result.facts as Record<string, unknown>[];
    facts[0].zone = "Корпус К1";
    facts[1].zone = "Корпус К2";
    for (const fact of facts) {
      fact.factId = sha256(canonicalJson(Object.fromEntries(
        Object.entries(fact).filter(([key]) => key !== "factId"))));
    }
    const link = input.entityLinks[0] as Record<string, unknown>;
    link.pdFactId = facts[0].factId;
    link.actualFactId = facts[1].factId;
    link.evidence = facts.map((fact) => ({ factId: fact.factId, sourceFileId: fact.sourceFileId,
      sourceSha256: fact.sourceSha256, pageNumber: fact.pageNumber, locator: fact.locator }));
    const comparisons = result.comparisons as Record<string, unknown>[];
    comparisons[0].expectedFactId = facts[0].factId;
    comparisons[0].actualFactId = facts[1].factId;
    comparisons[0].status = "ABSTAIN";
    comparisons[0].reasonCodes = ["ENTITY_CONTEXT_MISMATCH"];
    comparisons[0].normalizedExpected = null;
    comparisons[0].normalizedActual = null;
    comparisons[0].comparison = null;
    comparisons[0].contentHash = sha256(canonicalJson(Object.fromEntries(
      Object.entries(comparisons[0]).filter(([key]) => key !== "contentHash"))));
    rehash(input);
    expect(verifyFactFamilyProposals(input)).toBe(true);

    comparisons[0].status = "REVIEW_REQUIRED";
    comparisons[0].reasonCodes = ["COMPARISON_TRIGGERED_REVIEW"];
    comparisons[0].normalizedExpected = "100";
    comparisons[0].normalizedActual = "90";
    comparisons[0].comparison = { family: "DIFFERENT", operator: "!=", threshold: "0",
      observed: "10", triggered: true };
    comparisons[0].contentHash = sha256(canonicalJson(Object.fromEntries(
      Object.entries(comparisons[0]).filter(([key]) => key !== "contentHash"))));
    rehash(input);
    expect(verifyFactFamilyProposals(input)).toBe(false);
  });

  it("rejects changed source, page, stage, text, value, unit, bbox, and identities", () => {
    const changes: Array<(input: FactFamilyVerificationInput) => void> = [
      (input) => { input.sourceFiles[0].objectId = "OTHER"; },
      (input) => { input.sourceFiles[0].sha256 = "0".repeat(64); },
      (input) => { input.sourceFiles[0].sourceReviewHash = "0".repeat(64); },
      (input) => { input.sourceReviews.PD.pageStages = { "1": "RD" }; },
      (input) => { (input.textArtifacts.PD.content_json as Record<string, unknown>).inputSha256 = "0".repeat(64); },
      (input) => { const page = ((input.textArtifacts.PD.content_json as Record<string, unknown>).pages as Record<string, unknown>[])[0];
        (page.quality as Record<string, unknown>).disposition = "OCR_REQUIRED";
        input.textArtifacts.PD.content_hash = sha256(canonicalJson(input.textArtifacts.PD.content_json)); },
      (input) => { const value = ((input.result as Record<string, unknown>).facts as Record<string, unknown>[])[0];
        value.rawText = "forged"; value.factId = sha256(canonicalJson(Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "factId")))); rehash(input); },
      (input) => { const value = ((input.result as Record<string, unknown>).facts as Record<string, unknown>[])[0];
        value.rawValue = "900"; value.factId = sha256(canonicalJson(Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "factId")))); rehash(input); },
      (input) => { const value = ((input.result as Record<string, unknown>).facts as Record<string, unknown>[])[0];
        value.rawUnit = "мм"; value.factId = sha256(canonicalJson(Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "factId")))); rehash(input); },
      (input) => { const value = ((input.result as Record<string, unknown>).facts as Record<string, unknown>[])[0];
        (value.locator as Record<string, unknown>).bboxMilliPoints = [1, 2, 3, 4];
        value.factId = sha256(canonicalJson(Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "factId")))); rehash(input); },
      (input) => { const value = ((input.result as Record<string, unknown>).facts as Record<string, unknown>[])[0];
        value.objectId = "OTHER"; value.factId = sha256(canonicalJson(Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "factId")))); rehash(input); },
    ];
    for (const change of changes) {
      const input = clone();
      change(input);
      expect(verifyFactFamilyProposals(input)).toBe(false);
    }
  });

  it("rejects count tampering, duplicate facts, forged comparison, and missing review for mixed source", () => {
    const count = clone();
    (count.result as Record<string, unknown>).outputCount = 8;
    rehash(count);
    expect(verifyFactFamilyProposals(count)).toBe(false);
    const duplicate = clone();
    const result = duplicate.result as Record<string, unknown>;
    (result.facts as unknown[]).push((result.facts as unknown[])[0]);
    result.outputCount = 8;
    rehash(duplicate);
    expect(verifyFactFamilyProposals(duplicate)).toBe(false);
    const forged = clone();
    const comparisons = (forged.result as Record<string, unknown>).comparisons as Record<string, unknown>[];
    comparisons[0].status = "REVIEW_REQUIRED";
    comparisons[0].contentHash = sha256(canonicalJson(Object.fromEntries(
      Object.entries(comparisons[0]).filter(([key]) => key !== "contentHash"))));
    rehash(forged);
    expect(verifyFactFamilyProposals(forged)).toBe(false);
    const mixed = clone();
    mixed.sourceFiles[0].stages = ["PD", "RD"];
    expect(verifyFactFamilyProposals(mixed)).toBe(false);
  });
});
