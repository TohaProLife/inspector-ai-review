import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeMatrixCoverage, verifyMatrixAtomicResults } from "../src/matrix-rule-verifier.js";
import { loadMatrixGoldenFixtures, type MatrixGoldenFixture } from "./matrix-golden-fixtures.js";
import { pythonAvailable } from "./python.js";

const registry = JSON.parse(readFileSync(new URL("../../../services/worker/rules/matrix-execution-v1.json", import.meta.url), "utf8"));
const fixtures = pythonAvailable ? loadMatrixGoldenFixtures() : [];
const fixture = (name: string): MatrixGoldenFixture => structuredClone(fixtures.find(f => f.name === name)!);
const row = (f: MatrixGoldenFixture, code = "PZ-002", variant = "PD_RD") => f.execution.results.find(r => r.parameterCode === code && r.comparisonVariant === variant)!;

describe.skipIf(!pythonAvailable)("independent matrix atomic rule verifier", () => {
  it("accepts every real Python atomic, unknown, unit, scope, class, and ID golden", () => {
    expect(fixtures.filter(f => f.name.startsWith("atomic:"))).toHaveLength(61);
    // Dedicated source-bound suites cover adopted project zero and categorical reinforcement prose.
    // Preserve all61 existing generic positives; neither narrow grammar accepts generic labels.
    const dedicated=["matrix-pz-009-declared_project_zero_absolute_elevation","matrix-kr-057-catalog_a500c_to_a400"];
    const enabled=registry.entries.flatMap((entry:any)=>entry.atomicRules.filter((rule:any)=>rule.enabled).map((rule:any)=>rule.ruleId));
    expect(fixtures.filter(f=>f.name.startsWith("atomic:")).map(f=>f.ruleId).sort())
      .toEqual(enabled.filter((id:string)=>!dedicated.includes(id)).sort());
    expect(dedicated.every(id=>enabled.includes(id))).toBe(true);
    expect(fixtures.filter(f => f.name.startsWith("atomic:")
      && dedicated.includes(f.ruleId??"" ))).toHaveLength(0);
    for (const f of fixtures) {
      expect(verifyMatrixAtomicResults(f.execution, f.input, registry), f.name).toBe(true);
      expect(computeMatrixCoverage(f.execution, f.input, registry), f.name).toEqual(f.execution.coverage);
      if (f.ruleId && f.name.startsWith("atomic:")) {
        expect(f.execution.results.find(r => r.ruleId === f.ruleId)?.qualified, f.name).toBe(true);
      }
    }
  });

  it("keeps selected bindings separate from neighbouring rows and scope completeness", () => {
    const concrete=fixture("fact-binding:KR-055"), rows=concrete.execution.results.filter(r=>r.parameterCode==="KR-055");
    expect(rows.some(r=>r.entityKey===null&&!r.qualified)).toBe(true);
    expect(rows.filter(r=>r.qualified)).toHaveLength(1);
    expect(concrete.execution.observations.filter(o=>o.sourceFileId==="pd"&&o.entityKey===null)).toHaveLength(5);
    expect(concrete.execution.coverage.find(c=>c.parameterCode==="KR-055")?.executionStatus).toBe("PARTIAL");
    expect(fixture("fact-binding:negative-abstain").execution.results.find(r=>r.parameterCode==="KR-059")?.reasonCode)
      .toBe("NEGATIVE_SCOPE_UNVERIFIED");
  });

  it("rejects replay, unreviewed context, removed raw flags and foreign binding provenance", () => {
    const mutations: Array<(f:MatrixGoldenFixture)=>void> = [
      f=>{(f.input.sources[0].review!.scopeProofs!.FACT_BINDINGS as any).inputManifestHash="0".repeat(64);},
      f=>{(f.input.sources[0].review!.scopeProofs!.FACT_BINDINGS as any).reference=" ";},
      f=>{(f.input.sources[0].review!.scopeProofs!.FACT_BINDINGS as any).bindings[0].target.evidenceHash="0".repeat(64);},
      f=>{(f.input.sources[0].review!.scopeProofs!.FACT_BINDINGS as any).bindings[0].tableContextReview.fragmentsHash="0".repeat(64);},
      f=>{(f.input.sources[0].review!.scopeProofs!.FACT_BINDINGS as any).bindings[0].contexts={};},
      f=>{f.execution.observations.find(o=>o.entityKey!==null&&o.sourceFileId==="pd")!.sourceFlags=[];},
      f=>{f.execution.observations.find(o=>o.entityKey===null)!.entityKey="reviewed-component-1";},
      f=>{f.execution.results=f.execution.results.filter(r=>r.entityKey!==null);},
      f=>{f.execution.coverage.find(c=>c.parameterCode==="KR-055")!.executionStatus="EVALUATED";},
    ];
    for(const mutate of mutations) {const f=fixture("fact-binding:KR-055");mutate(f);
      expect(verifyMatrixAtomicResults(f.execution,f.input,registry)).toBe(false);}
  });

  it("keeps strict one-percent boundaries and exact repeating percentages", () => {
    expect(row(fixture("boundary:one-percent")).machineStatus).toBe("NEGATIVE_VERIFIED");
    expect(row(fixture("boundary:above-one-percent")).machineStatus).toBe("CANDIDATE");
    expect(row(fixture("boundary:below-one-percent")).machineStatus).toBe("NEGATIVE_VERIFIED");
    expect(row(fixture("boundary:three-percent")).delta).toBe("3");
    expect(row(fixture("boundary:repeating")).delta).toHaveLength(81);
    expect(row(fixture("boundary:zero")).reasonCode).toBe("ZERO_BASELINE");
  });

  it("qualifies tile area changes only with independent approval and exact surface identities", () => {
    for (const name of ["increase", "decrease"]) {
      const f=fixture(`sidewalk:${name}`), result=row(f,"SPZU-026");
      expect(result).toMatchObject({qualified:true,machineStatus:"CANDIDATE"});
      expect(f.execution.coverage.find(c=>c.parameterCode==="SPZU-026")?.executionStatus).toBe("PARTIAL");
    }
    expect(row(fixture("sidewalk:equal-unverified"),"SPZU-026").reasonCode).toBe("NEGATIVE_SCOPE_UNVERIFIED");
    for(const f of fixtures.filter(f=>f.name.startsWith("sidewalk:")&&!['sidewalk:increase','sidewalk:decrease'].includes(f.name)))
      expect(f.execution.results.filter(r=>r.parameterCode==="SPZU-026").every(r=>!r.qualified),f.name).toBe(true);
  });

  it("rejects widening the bounded tile-area policy to other families, stages, units or contexts", () => {
    const f=fixture("sidewalk:increase");
    for(const patch of [{family:"DECREASE"},{attribute:"HARD_SURFACE_AREA"},{canonicalUnit:"mm"},
      {allowedStagePairs:[["PD","RD"],["PD","ID"]],comparisonVariants:["PD_RD","PD_ID"]},
      {requiredContext:["ATOMIC_SUBRULE_SCOPE:matrix-spzu-026-sidewalk_tile_area"]},
      {unitAliases:["мм"]},{labels:["Площадь твердых покрытий"]}]) {
      const changed=structuredClone(registry);
      Object.assign(changed.entries.find((e:any)=>e.parameterCode==="SPZU-026").atomicRules[0],patch);
      expect(verifyMatrixAtomicResults(f.execution,f.input,changed)).toBe(false);
    }
  });

  it("rejects forged status, sign, decimal, identity, reference, stage pair, and absent/duplicate rows", () => {
    const mutate: Array<[string, (f: MatrixGoldenFixture) => void]> = [
      ["trigger", f => { row(f).machineStatus = "NEGATIVE_VERIFIED"; }],
      ["qualification", f => { row(f).qualified = false; }],
      ["delta", f => { row(f).delta = "-3"; }],
      ["delta formatting", f => { row(f).delta = "3.0"; }],
      ["reason", f => { row(f).reasonCode = "SCOPED_TRIGGER_NOT_MATCHED"; }],
      ["value", f => { row(f).actualValue = "104"; }],
      ["source ref", f => { row(f).actualObservationId = row(f).expectedObservationId; }],
      ["entity", f => { row(f).entityKey = "building-2"; }],
      ["stage pair", f => { row(f).comparisonVariant = "RD_ID"; }],
      ["rule version", f => { row(f).ruleVersion = "2"; }],
      ["self-reported failure", f => { row(f).executionStatus = "FAILED"; }],
      ["missing row", f => { f.execution.results.splice(f.execution.results.indexOf(row(f)), 1); }],
      ["duplicate", f => { f.execution.results.push(structuredClone(row(f))); }],
      ["extra", f => { f.execution.results.push({ ...row(f), entityKey: "extra-building" }); }],
      ["coverage", f => { f.execution.coverage.find(c => c.parameterCode === "PZ-002")!.successfulComparisons = 100; }],
      ["omitted coverage", f => { f.execution.coverage.pop(); }],
      ["unit", f => { f.execution.observations[0].unit = "kW"; }],
      ["attribute", f => { f.execution.observations[0].attribute = "APARTMENT_COUNT"; }],
      ["parameter", f => { f.execution.observations[0].parameterCodes = ["PZ-007"]; }],
      ["duplicate fact", f => { f.execution.observations.push(structuredClone(f.execution.observations[0])); }],
      ["entity on fact", f => { f.execution.observations[0].entityKey = "building-2"; }],
    ];
    for (const [name, change] of mutate) {
      const f = fixture("boundary:three-percent"); change(f);
      expect(verifyMatrixAtomicResults(f.execution, f.input, registry), name).toBe(false);
    }
  });

  it("binds all review proofs to exact source, object, manifest and explicit section", () => {
    const mutations: Array<[string, (f: MatrixGoldenFixture) => void]> = [
      ["SHA", f => { f.input.sources[1].review!.scopeProofs!.ENTITY_SCOPE = {
        ...(f.input.sources[1].review!.scopeProofs!.ENTITY_SCOPE as object), sourceSha256: "0".repeat(64) }; }],
      ["manifest", f => { f.input.inputManifestHash = "a".repeat(64); }],
      ["object", f => { f.input.objectId = "other-object"; }],
      ["approval", f => { f.input.sources[1].review!.approvalStatus = "UNKNOWN"; }],
      ["revision", f => { f.input.sources[1].review!.revisionStatus = "SUPERSEDED"; }],
      ["group", f => { f.input.sources[1].review!.linkGroupId = "different-group"; }],
      ["section", f => { f.input.sources[1].review!.sectionCode = "OTHER"; }],
      ["reference", f => { (f.input.sources[1].review!.scopeProofs!.ENTITY_SCOPE as Record<string, unknown>).reference = " "; }],
      ["parameter scope", f => { delete f.input.sources[1].review!.scopeProofs!["PARAMETER_SCOPE_COMPLETE:PZ-002"]; }],
    ];
    for (const [name, change] of mutations) {
      const f = fixture("boundary:three-percent"); change(f);
      expect(verifyMatrixAtomicResults(f.execution, f.input, registry), name).toBe(false);
    }
    const id = fixture("id:pd-verified");
    delete id.input.sources[1].review!.scopeProofs!.DRAWING_SECTION_VERIFIED;
    expect(verifyMatrixAtomicResults(id.execution, id.input, registry)).toBe(false);
    const negative = fixture("boundary:one-percent");
    delete negative.input.sources[0].review!.scopeProofs!["RULE_SCOPE_COMPLETE:matrix-pz-002-building_total_area"];
    expect(verifyMatrixAtomicResults(negative.execution, negative.input, registry)).toBe(false);
  });

  it("cannot remove unknown or OCR/header candidate flags to qualify facts", () => {
    for (const name of ["unknown", "mixed:unresolved", "table:header-approved", "table:header-unknown"]) {
      const f = fixture(name); expect(f.execution.observations.length).toBeGreaterThan(0);
      f.execution.observations[0].sourceFlags = [];
      expect(verifyMatrixAtomicResults(f.execution, f.input, registry), name).toBe(false);
    }
  });

  it("requires exact normative applicability and extra conditional proof fields", () => {
    for (const [ruleId, key, field, value] of [
      ["matrix-ar-040-evacuation_corridor_width", "NORM_APPLICABILITY_VERIFIED", "applicable", false],
      ["matrix-ar-040-evacuation_corridor_width", "NORM_APPLICABILITY_VERIFIED", "threshold", "2"],
      ["matrix-pz-004-building_volume", "APPROVED_CHANGE_STATUS", "approvedChangePresent", true],
      ["matrix-pz-014-design_electric_power", "TECHNICAL_CONDITIONS_LIMIT", "limitValue", "101"],
      ["matrix-zu-125-wall_insulation_thickness", "THERMAL_RESISTANCE_REDUCTION_VERIFIED", "reductionConfirmed", false],
    ] as const) {
      const original = fixtures.find(f => f.ruleId === ruleId);
      expect(original, ruleId).toBeDefined();
      const f = structuredClone(original!);
      (f.input.sources[1].review!.scopeProofs![key] as Record<string, unknown>)[field] = value;
      expect(verifyMatrixAtomicResults(f.execution, f.input, registry), ruleId).toBe(false);
    }
  });

  it("requires matched subrule component, zone, mode and measurement basis and retains catalog gaps", () => {
    const atomic = fixtures.filter(f => f.name.startsWith("atomic:") && f.input.sources[1].review?.scopeProofs?.[`ATOMIC_SUBRULE_SCOPE:${f.ruleId}`]);
    expect(atomic).toHaveLength(14);
    for (const original of atomic) {
      const coverage = original.execution.coverage.find(c => c.parameterCode === original.parameterCode)!;
      expect(coverage.executionStatus).toBe("PARTIAL");
      for (const [field,value] of Object.entries({componentRole:"wrong",componentKey:"another-component",zoneKey:"another-zone",
        operatingModeKey:"another-mode",measurementBasisKey:"another-basis",parameterCode:"wrong",attribute:"wrong",
        canonicalUnit:"wrong",sourceSha256:"0".repeat(64)})) {
        const f = structuredClone(original);
        (f.input.sources[1].review!.scopeProofs![`ATOMIC_SUBRULE_SCOPE:${f.ruleId}`] as Record<string,unknown>)[field]=value;
        expect(verifyMatrixAtomicResults(f.execution,f.input,registry),`${f.ruleId}:${field}`).toBe(false);
      }
      const wrong=fixture(`subrule:wrong-context:${original.ruleId}`);
      expect(wrong.execution.results.find(r=>r.ruleId===original.ruleId)!.reasonCode).toBe(`CONTEXT_UNVERIFIED:ATOMIC_SUBRULE_SCOPE:${original.ruleId}`);
    }
  });
});
