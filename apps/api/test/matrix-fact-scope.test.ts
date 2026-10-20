import { describe, expect, it } from "vitest";
import { matrixFactScopeSchema, type MatrixFactScopeBinding }
  from "../../../packages/contracts/src/matrix-fact-scope.js";
import { spawnSync } from "node:child_process";
import { deriveMatrixFactSelector, deriveMatrixFactTarget, resolveMatrixFactScopeTarget,
  portableEvidenceJson, portableEvidenceHash, prepareMatrixFactArtifact }
  from "../src/matrix-fact-scope.js";
import { pythonAvailable, pythonEnv, pythonExecutable } from "./python.js";

const h = (character: string) => character.repeat(64);
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function fixture() {
  const textArtifact = { schemaVersion: "document-text-v2", sourceFileId: "source-pd",
    inputSha256: h("a"), coordinateSystem: "PDF_BOTTOM_LEFT_MILLI_POINTS", pageCount: 2,
    pages: [
      { pageNumber: 1, widthMilliPoints: 800000, heightMilliPoints: 800000,
        frame: { cropBoxMilliPoints: [20000, 10000, 820000, 810000], rotationDegrees: 0 },
        blocks: [{ text: "Классы бетона по прочности", bboxMilliPoints: [100000, 600000, 600000, 650000] }] },
      { pageNumber: 2, widthMilliPoints: 800000, heightMilliPoints: 800000,
        blocks: [{ text: "Подземная часть", bboxMilliPoints: [100000, 600000, 400000, 650000] },
          { text: "фундаментная плита", bboxMilliPoints: [100000, 400000, 400000, 450000] },
          { text: "В30", bboxMilliPoints: [500000, 400000, 600000, 450000] }] },
    ] };
  const contextFragments = [
    { pageNumber: 1, blockId: "0:0", rawText: "Классы бетона по прочности",
      bbox: box(.125, .1875, .625, .0625), role: "ATTRIBUTE_HEADER" as const },
    { pageNumber: 2, blockId: "0:0", rawText: "Подземная часть",
      bbox: box(.125, .1875, .375, .0625), role: "TABLE_SCOPE" as const },
  ];
  const fact = { id: h("b"), sourceFileId: "source-pd", sourceSha256: h("a"), stage: "PD" as const,
    pageNumber: 2, blockId: "1:0", attribute: "CONCRETE_CLASS", value: "В30", unit: "B_CLASS",
    rawValue: "В30", rawUnit: "B_CLASS", rawText: "фундаментная плита В30", method: "TEXT_LAYER" as const,
    extractorVersion: "matrix-text-facts-v1", bbox: box(.125, .4375, .625, .0625),
    evidenceFragments: [{ blockId: "1:0", rawText: "фундаментная плита", bbox: box(.125, .4375, .375, .0625) },
      { blockId: "2:0", rawText: "В30", bbox: box(.625, .4375, .125, .0625) }], contextFragments,
    entityKey: null, sourceFlags: ["TABLE_CONTEXT_UNVERIFIED"], parameterCodes: ["KR-055"],
    objectId: "old-object", inputManifestHash: h("c") };
  const evidence = deriveMatrixFactTarget(fact, textArtifact)!;
  const target = { checkId: "CHK-ORIGIN", executionContentHash: h("d"),
    observationId: evidence.observationId, evidenceHash: evidence.evidenceHash, textArtifactHash: evidence.textArtifactHash };
  const binding: MatrixFactScopeBinding = { ruleId: "matrix-kr-055-concrete-class", ruleVersion: "1",
    parameterCode: "KR-055", entityKey: "foundation-slab", reference: "Проверены исходные листы 1–2",
    target, contexts: { COMPONENT_SCOPE: { reference: "Фундаментная плита на исходном листе", componentKey: "slab-1",
      componentRole: "FOUNDATION_SLAB", zoneKey: "underground" } },
    tableContextReview: { fragmentsHash: evidence.fragmentsHash!, reference: "Проверены заголовок и область таблицы" } };
  return { fact, textArtifact, target, binding, origin: { checkId: target.checkId,
    executionContentHash: target.executionContentHash, fact, textArtifact } };
}

describe("isolated per-fact review contract", () => {
  const scope = (bindings: unknown[]) => ({ schemaVersion: "matrix-fact-scopes-v1", bindings });

  it("accepts explicit empty scope and bounded human details without manufacturing trust", () => {
    const { binding } = fixture();
    expect(matrixFactScopeSchema.parse(scope([])).bindings).toEqual([]);
    expect(matrixFactScopeSchema.parse(scope([binding])).bindings[0]).toEqual(binding);
    for (const injected of [
      { ...binding, status: "VERIFIED" },
      { ...binding, contexts: { COMPONENT_SCOPE: { ...binding.contexts.COMPONENT_SCOPE, status: "VERIFIED" } } },
      { ...binding, target: { ...binding.target, sourceFileId: "invented" } },
      { ...binding, tableContextReview: { ...binding.tableContextReview, actorId: "someone" } },
    ]) expect(matrixFactScopeSchema.safeParse(scope([injected])).success).toBe(false);
  });

  it("rejects duplicate observation-rule pairs across versions or origin checks", () => {
    const { binding } = fixture();
    for (const duplicate of [binding, { ...binding, ruleVersion: "2" },
      { ...binding, target: { ...binding.target, checkId: "CHK-OTHER" } }])
      expect(matrixFactScopeSchema.safeParse(scope([binding, duplicate])).success).toBe(false);
    expect(matrixFactScopeSchema.safeParse(scope([binding, { ...binding, ruleId: "another-rule" }])).success).toBe(true);
  });

  it("rejects assigning one observation to different entities but permits different facts in one file", () => {
    const { binding } = fixture();
    const other = { ...binding, ruleId: "another-rule", entityKey: "another-entity" };
    expect(matrixFactScopeSchema.safeParse(scope([binding, other])).success).toBe(false);
    expect(matrixFactScopeSchema.safeParse(scope([binding,
      { ...other, target: { ...other.target, observationId: h("e") } }])).success).toBe(true);
  });

  it("rejects completeness contexts and oversized or malformed input", () => {
    const { binding } = fixture();
    for (const key of ["RULE_SCOPE_COMPLETE", "RULE_SCOPE_COMPLETE:matrix-kr-055", "PARAMETER_SCOPE_COMPLETE",
      "PARAMETER_SCOPE_COMPLETE:KR-055"]) expect(matrixFactScopeSchema.safeParse(scope([
      { ...binding, contexts: { [key]: { reference: "Запрещённая полнота" } } },
    ])).success).toBe(false);
    const contexts = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`CONTEXT_${i}`, { reference: "Проверенный контекст" }]));
    for (const invalid of [scope([{ ...binding, contexts }]), scope(Array(501).fill(binding)),
      scope([{ ...binding, reference: "short" }]), scope([{ ...binding, entityKey: " " }]),
      scope([{ ...binding, target: { ...binding.target, evidenceHash: "a" } }]),
      { ...scope([binding]), sourceTrust: "APPROVED" }])
      expect(matrixFactScopeSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("portable immutable fact evidence", () => {
  const numberBoundary = () => ({ "😀": "\u2028", "\uE000": "Чертёж", "я": 1e-7, z: 1, A: -0 });

  it("preserves float64 bits, UTF-8 key order and distinct literal types without tag collisions", () => {
    expect(portableEvidenceJson(-0)).toBe('["$number","8000000000000000"]');
    expect(portableEvidenceJson(0)).toBe('["$number","0000000000000000"]');
    expect(portableEvidenceJson(1)).toBe('["$number","3ff0000000000000"]');
    expect(portableEvidenceHash(-0)).not.toBe(portableEvidenceHash(0));
    expect(portableEvidenceHash(1)).not.toBe(portableEvidenceHash(["$number", "3ff0000000000000"]));
    expect(portableEvidenceHash([])).not.toBe(portableEvidenceHash(["$array", []]));
    expect(portableEvidenceHash({})).not.toBe(portableEvidenceHash(["$object", []]));
    expect(portableEvidenceJson(numberBoundary())).toBe('["$object",[["A",["$number","8000000000000000"]],'
      + '["z",["$number","3ff0000000000000"]],["я",["$number","3e7ad7f29abcaf48"]],'
      + '["\uE000","Чертёж"],["😀","\u2028"]]]');
    const types = [null, false, true, "", "1", 1, [], {}];
    expect(new Set(types.map(portableEvidenceHash)).size).toBe(types.length);
    expect(portableEvidenceHash(numberBoundary())).toBe(portableEvidenceHash(
      Object.fromEntries(Object.entries(numberBoundary()).reverse())));
  });

  it("rejects unsupported JSON values, cycles, infinities and lone Unicode surrogates", () => {
    const cyclic: unknown[] = []; cyclic.push(cyclic);
    for (const invalid of [undefined, Number.NaN, Infinity, -Infinity, 1n, new Date(), new Map(), cyclic,
      "\uD800", { "\uDFFF": "invalid" }, [undefined], { invalid: undefined }])
      expect(() => portableEvidenceHash(invalid)).toThrow(TypeError);
  });

  it.runIf(pythonAvailable)("matches Python bytes, numeric edge cases, selector and all three evidence hashes", () => {
    const { fact, textArtifact } = fixture();
    const process = spawnSync(pythonExecutable, ["-c", `import json,sys
from inspector_worker.matrix_fact_scope import portable_evidence_json,portable_evidence_hash,derive_matrix_fact_selector,derive_matrix_fact_target
value=json.load(sys.stdin)
boundary={'\\U0001f600':'\\u2028','\\ue000':'Чертёж','я':1e-7,'z':1,'A':-0.0}
selector=derive_matrix_fact_selector(value['fact'],value['textArtifact'])
json.dump({'boundaryJson':portable_evidence_json(boundary),'boundaryHash':portable_evidence_hash(boundary),
'selectorJson':portable_evidence_json(selector),'target':derive_matrix_fact_target(value['fact'],value['textArtifact'])},sys.stdout,ensure_ascii=False)`],
    { input: JSON.stringify({ fact, textArtifact }), encoding: "utf8", env: { ...globalThis.process.env, ...pythonEnv }, timeout: 10000 });
    expect(process.status, process.stderr).toBe(0);
    expect(JSON.parse(process.stdout)).toEqual({ boundaryJson: portableEvidenceJson(numberBoundary()),
      boundaryHash: portableEvidenceHash(numberBoundary()), selectorJson: portableEvidenceJson(deriveMatrixFactSelector(fact, textArtifact)),
      target: deriveMatrixFactTarget(fact, textArtifact) });
  });

  it("hashes exactly the documented selector and entire artifact with ordered context", () => {
    const { fact, textArtifact, target, origin } = fixture();
    const selector = deriveMatrixFactSelector(fact, textArtifact)!;
    expect(Object.keys(selector).sort()).toEqual(["schemaVersion", "sourceFileId", "sourceSha256", "stage", "pageNumber",
      "blockId", "attribute", "value", "unit", "rawValue", "rawUnit", "rawText", "method", "extractorVersion", "bbox",
      "evidenceFragments", "contextFragments", "textArtifactHash"].sort());
    expect(selector.textArtifactHash).toBe(portableEvidenceHash(textArtifact));
    expect(target.evidenceHash).toBe(portableEvidenceHash(selector));
    expect(resolveMatrixFactScopeTarget(target, origin)).toEqual({ observationId: fact.id,
      evidenceHash: target.evidenceHash, textArtifactHash: target.textArtifactHash,
      fragmentsHash: portableEvidenceHash(fact.contextFragments) });
    expect(selector).not.toHaveProperty("entityKey");
    expect(selector).not.toHaveProperty("sourceFlags");
    expect(selector).not.toHaveProperty("objectId");
  });

  it("pins a portable canonical payload golden, including Unicode raw text", () => {
    const { fact, textArtifact } = fixture();
    const selector = deriveMatrixFactSelector(fact, textArtifact)!;
    expect(portableEvidenceHash(textArtifact)).toBe("ee2be1d6cce0f1c02ef3dcc666c5f3505462de496b0c898506fd59fbca816084");
    expect(portableEvidenceHash(selector)).toBe("2eba529ff1d5fa28b7f8d219a1f9286c7d4ccb13760e05e2fd33fcfd6f764f64");
    expect(portableEvidenceHash(selector.contextFragments)).toBe("51f433ab0194552e30a2cdec0d1d8259180264965106ee97356ca69de76dc5c9");
  });

  it("keeps evidence portable across review/entity, object, manifest and origin reference changes", () => {
    const { fact, textArtifact, target, origin } = fixture();
    const changed = { ...fact, entityKey: "reviewed-slab", sourceFlags: [], parameterCodes: ["other"],
      objectId: "new-object", inputManifestHash: h("f"), sourceReview: { reference: "new decision", status: "VERIFIED" },
      checkId: "CHK-NEW", executionContentHash: h("e") };
    expect(deriveMatrixFactTarget(changed, textArtifact)).toEqual(deriveMatrixFactTarget(fact, textArtifact));
    expect(resolveMatrixFactScopeTarget(target, { ...origin, fact: changed })).not.toBeNull();
    expect(resolveMatrixFactScopeTarget(target, { ...origin, checkId: "CHK-NEW" })).toBeNull();
    expect(resolveMatrixFactScopeTarget(target, { ...origin, executionContentHash: h("e") })).toBeNull();
  });

  it("prepares a private artifact snapshot once without trusting caller hashes or mutable cache entries", () => {
    const { fact, textArtifact } = fixture();
    const prepared = prepareMatrixFactArtifact(textArtifact)!;
    const expected = deriveMatrixFactTarget(fact, textArtifact);
    expect(prepared.deriveTarget(fact)).toEqual(expected);
    expect(prepared.deriveSelector(fact)).toEqual(deriveMatrixFactSelector(fact, textArtifact));
    textArtifact.pages[0].frame!.rotationDegrees = 90;
    expect(prepared.deriveTarget(fact)).toEqual(expected);
    expect(deriveMatrixFactTarget(fact, textArtifact)).not.toEqual(expected);
    const returned = prepared.deriveSelector(fact)!; returned.contextFragments![0].rawText = "external mutation";
    expect(prepared.deriveTarget(fact)).toEqual(expected);
    expect(prepared.deriveTarget({ ...fact, sourceFileId: "foreign" })).toBeNull();
    expect(prepareMatrixFactArtifact({ ...textArtifact, coordinateSystem: "UNKNOWN" })).toBeNull();
  });

  it("rejects submitted hash, observation and origin tampering", () => {
    const { target, origin } = fixture();
    for (const key of ["checkId", "executionContentHash", "observationId", "evidenceHash", "textArtifactHash"])
      expect(resolveMatrixFactScopeTarget({ ...target, [key]: key === "checkId" ? "CHK-OTHER" : h("e") }, origin)).toBeNull();
    expect(resolveMatrixFactScopeTarget({ ...target, status: "VERIFIED" }, origin)).toBeNull();
  });

  it("invalidates any selected raw text, value, geometry, context, source or extractor changes", () => {
    const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
      v => { v.fact.rawValue = "В40"; }, v => { v.fact.rawUnit = "different"; },
      v => { v.fact.rawText += " "; }, v => { v.fact.value = "В40"; }, v => { v.fact.unit = "other"; },
      v => { v.fact.attribute = "OTHER"; }, v => { v.fact.extractorVersion = "next-version"; },
      v => { v.fact.method = "OCR" as "TEXT_LAYER"; }, v => { v.fact.bbox.x += .01; },
      v => { v.fact.evidenceFragments[0].rawText += " "; },
      v => { v.fact.evidenceFragments[0].bbox.x += .01; },
      v => { v.fact.contextFragments[0].rawText += " "; },
      v => { v.fact.contextFragments[0].bbox.width += .01; },
      v => { v.fact.contextFragments[0].pageNumber = 2; },
      v => { v.fact.contextFragments[0].role = "TABLE_SCOPE"; },
      v => { v.fact.contextFragments.reverse(); },
      v => { v.fact.sourceFileId = "different-source"; }, v => { v.fact.sourceSha256 = h("f"); },
      v => { v.fact.stage = "RD" as "PD"; }, v => { v.fact.pageNumber = 1; },
      v => { v.fact.blockId = "2:0"; },
    ];
    for (const mutate of mutations) {
      const value = fixture(); mutate(value);
      expect(resolveMatrixFactScopeTarget(value.target, value.origin), String(mutate)).toBeNull();
    }
  });

  it("invalidates frame, artifact metadata, unselected original text and source mutations", () => {
    const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
      v => { v.textArtifact.pages[0].frame!.rotationDegrees = 90; },
      v => { v.textArtifact.pages[0].frame!.cropBoxMilliPoints[0]++; },
      v => { v.textArtifact.pageCount = 3; },
      v => { v.textArtifact.pages[0].blocks.push({ text: "Other original text", bboxMilliPoints: [1, 1, 2, 2] }); },
      v => { v.textArtifact.inputSha256 = h("f"); }, v => { v.textArtifact.sourceFileId = "different-source"; },
      v => { v.textArtifact.pages[1].widthMilliPoints++; },
    ];
    for (const mutate of mutations) {
      const value = fixture(); mutate(value);
      expect(resolveMatrixFactScopeTarget(value.target, value.origin), String(mutate)).toBeNull();
    }
  });

  it("omits absent context hashes and preserves raw transcription limitations without qualifying them", () => {
    const value = fixture(), fact: Record<string, unknown> = { ...value.fact };
    delete fact.contextFragments;
    const selector = deriveMatrixFactSelector(fact, value.textArtifact)!;
    expect(selector).not.toHaveProperty("contextFragments");
    expect(deriveMatrixFactTarget(fact, value.textArtifact)).not.toHaveProperty("fragmentsHash");
    const evidence = deriveMatrixFactTarget(value.fact, value.textArtifact)!;
    expect(evidence).not.toHaveProperty("qualified");
    expect(value.fact.sourceFlags).toEqual(["TABLE_CONTEXT_UNVERIFIED"]);
    expect(value.fact.entityKey).toBeNull();
  });

  it("fails closed for invalid frames, duplicate pages, missing provenance and non-JSON artifacts", () => {
    const value = fixture();
    for (const fact of [null, { ...value.fact, rawValue: undefined }, { ...value.fact, evidenceFragments: [] },
      { ...value.fact, contextFragments: [] }, { ...value.fact, sourceSha256: "bad" },
      { ...value.fact, bbox: { ...value.fact.bbox, x: Number.NaN } }])
      expect(deriveMatrixFactTarget(fact, value.textArtifact)).toBeNull();
    const duplicate = structuredClone(value.textArtifact); duplicate.pages.push(duplicate.pages[0]);
    const cyclic: Record<string, unknown> = { ...value.textArtifact }; cyclic.self = cyclic;
    for (const artifact of [null, duplicate, cyclic, { ...value.textArtifact, missing: undefined },
      { ...value.textArtifact, invalid: Number.NaN }, { ...value.textArtifact, invalid: new Date() },
      { ...value.textArtifact, coordinateSystem: "UNKNOWN" }])
      expect(deriveMatrixFactTarget(value.fact, artifact)).toBeNull();
    const invalidFrame = structuredClone(value.textArtifact); invalidFrame.pages[1].widthMilliPoints = 0;
    expect(deriveMatrixFactTarget(value.fact, invalidFrame)).toBeNull();
  });
});
