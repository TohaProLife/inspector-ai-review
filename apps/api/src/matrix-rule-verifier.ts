import type { MatrixAtomicResult, MatrixCoverage, MatrixExecution, MatrixObservation } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { prepareMatrixFactBindings, type MatrixFactScopeResolver } from "./matrix-fact-bindings.js";
import { isConcreteProseFact, validConcreteSourceBinding } from "./matrix-concrete-prose.js";

/** The caller supplies authenticated review snapshots, never worker-produced proofs. */
export interface MatrixRuleVerificationSource {
  sourceFileId: string; sha256: string; stages: string[]; objectId?: string;
  revisionStatus?: string; approvalStatus?: string; linkGroupId?: string | null;
  pageStages?: Record<string, string>; sectionCode?: string | null;
  scopeProofs?: Record<string, unknown>;
  review?: { revisionStatus?: string; approvalStatus?: string; linkGroupId?: string | null;
    pageStages?: Record<string, string>; sectionCode?: string | null;
    scopeProofs?: Record<string, unknown> } | null;
  textArtifact?: Record<string, unknown> | null;
}
export interface MatrixRuleVerificationInput {
  objectId: string; inputManifestHash: string; sources: MatrixRuleVerificationSource[];
}
type Stage = "PD" | "RD" | "ID";
type Proof = Record<string, unknown> & { entityKey: string };
type Source = MatrixRuleVerificationSource & {
  revisionStatus: string; approvalStatus: string; pageStages: Record<string, string>;
  factScope?: MatrixFactScopeResolver | null;
};
type Rule = {
  ruleId: string; version: string; enabled: boolean; attribute: string; canonicalUnit: string;
  requiredContext: string[]; expectedSections: string[]; actualSections: string[];
  allowedStagePairs: [Stage, Stage][]; comparisonVariants: string[];
  family: string; valueKind: string; allowedValues: string[];
  threshold: { value: string; unit: string; strict: true } | null;
  subruleContext?: { schemaVersion: string; componentRole: string; identityFields: string[] };
};
type Entry = { parameterCode: string; gap: string | null; atomicRules: Rule[] };
type Registry = { schemaVersion: string; version: string; entries: Entry[] };
type Rational = { n: bigint; d: bigint };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === "string");
const hash = /^[a-f0-9]{64}$/u;
const stages = new Set(["PD", "RD", "ID"]);
const families = new Set(["DIFFERENT", "INCREASE", "DECREASE", "RELATIVE_DELTA", "RELATIVE_INCREASE",
  "CLASS_DECREASE", "LOWER_BOUND", "UPPER_BOUND"]);
const egressHeightSpecs = [
  { ruleId: "matrix-ar-042-evacuation_corridor_clear_height", attribute: "EVACUATION_CORRIDOR_CLEAR_HEIGHT",
    role: "EVACUATION_CORRIDOR_CLEARANCE", label: "Высота эвакуационного коридора в свету", threshold: "2",
    basis: "CLEAR_FINISHED_FLOOR_TO_LOWEST_OBSTRUCTION" },
  { ruleId: "matrix-ar-042-evacuation_door_clear_height", attribute: "EVACUATION_DOOR_CLEAR_HEIGHT",
    role: "EVACUATION_DOOR_CLEARANCE", label: "Высота эвакуационной двери в свету", threshold: "1.9",
    basis: "CLEAR_FINISHED_FLOOR_TO_OPENING_HEAD" },
];

const stairSpecs = [
  { ruleId: "matrix-ar-048-stair_tread_depth", attribute: "STAIR_TREAD_DEPTH", role: "STAIR_TREAD",
    label: "Глубина проступи лестницы в свету", family: "LOWER_BOUND", threshold: "300",
    basis: "FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH" },
  { ruleId: "matrix-ar-048-stair_riser_height", attribute: "STAIR_RISER_HEIGHT", role: "STAIR_RISER",
    label: "Высота подступенка лестницы после отделки", family: "UPPER_BOUND", threshold: "150",
    basis: "FINISHED_VERTICAL_RISER_HEIGHT" },
];
const rebarRuleId = "matrix-kr-057-catalog_a500c_to_a400";
const rebarAttribute = "WORKING_REINFORCEMENT_CLASS";
const projectZeroRuleId = "matrix-pz-009-declared_project_zero_absolute_elevation";
const projectZeroAttribute = "PROJECT_ZERO_ABSOLUTE_ELEVATION";
const projectZeroBasis = "FINISHED_FLOOR_PROJECT_ZERO_TO_APPROVED_ABSOLUTE_DATUM";
const fenceRuleId = "matrix-spzu-036-territory_fence_height";
const fenceAttribute = "TERRITORY_FENCE_HEIGHT";

function registryValue(raw: unknown): Registry {
  if (!record(raw) || raw.schemaVersion !== "matrix-execution-registry-v1" || raw.version !== "1"
    || !Array.isArray(raw.entries) || raw.entries.length !== 132) throw new Error("Invalid matrix registry");
  const codes = new Set<string>(), ids = new Set<string>();
  for (const entry of raw.entries) {
    if (!record(entry) || typeof entry.parameterCode !== "string" || codes.has(entry.parameterCode)
      || !Array.isArray(entry.atomicRules) || (entry.gap !== null && typeof entry.gap !== "string")
      || (!entry.atomicRules.length && !entry.gap)) throw new Error("Invalid matrix entry");
    codes.add(entry.parameterCode);
    for (const rule of entry.atomicRules) {
      if (!record(rule) || typeof rule.ruleId !== "string" || ids.has(rule.ruleId)
        || rule.version !== "1" || typeof rule.enabled !== "boolean" || typeof rule.attribute !== "string"
        || typeof rule.canonicalUnit !== "string" || !strings(rule.requiredContext)
        || !strings(rule.expectedSections) || !rule.expectedSections.length
        || !strings(rule.actualSections) || !rule.actualSections.length || !strings(rule.allowedValues)
        || !strings(rule.comparisonVariants) || !families.has(String(rule.family))
        || !["DECIMAL", "INTEGER", "CATEGORY", "CONCRETE_CLASS"].includes(String(rule.valueKind))
        || !Array.isArray(rule.allowedStagePairs) || !rule.allowedStagePairs.length
        || rule.allowedStagePairs.some(pair => !strings(pair) || !["PD_RD", "PD_ID", "RD_ID"].includes(pair.join("_")))
        || canonicalJson(rule.allowedStagePairs[0]) !== '["PD","RD"]'
        || new Set(rule.allowedStagePairs.map(pair => (pair as string[]).join("_"))).size !== rule.allowedStagePairs.length
        || canonicalJson(rule.comparisonVariants) !== canonicalJson(rule.allowedStagePairs.map(pair => (pair as string[]).join("_")))) {
        throw new Error("Invalid atomic definition");
      }
      if (rule.threshold !== null && (!record(rule.threshold) || typeof rule.threshold.value !== "string"
        || rule.threshold.strict !== true || typeof rule.threshold.unit !== "string")) throw new Error("Invalid threshold");
      if (rule.threshold !== null) decimal((rule.threshold as { value: string }).value);
      if (egressHeightSpecs.some(spec => spec.ruleId === rule.ruleId || spec.attribute === rule.attribute)
        && rule.subruleContext === undefined) throw new Error("Missing egress height policy");
      if (stairSpecs.some(spec => spec.ruleId === rule.ruleId || spec.attribute === rule.attribute)
        && rule.subruleContext === undefined) throw new Error("Missing stair dimensions policy");
      if ((rule.ruleId === fenceRuleId || rule.attribute === fenceAttribute)
        && rule.subruleContext === undefined) throw new Error("Missing territory fence policy");
      if ((rule.ruleId === rebarRuleId || rule.attribute === rebarAttribute || rule.canonicalUnit === "rebar_catalog_example")
        && rule.subruleContext === undefined) throw new Error("Missing working reinforcement policy");
      if ((rule.ruleId === projectZeroRuleId || rule.attribute === projectZeroAttribute)
        && rule.subruleContext === undefined) throw new Error("Missing project zero policy");
      if (rule.subruleContext !== undefined) {
        const policy = rule.subruleContext;
        const legacyDecrease = ["POTABLE_WATER_PUMP", "RADIATOR", "SMOKE_CONTROL_FAN", "ASPHALT_LAYER", "CRUSHED_STONE_LAYER"]
          .includes(String(record(policy) && policy.componentRole))
          && canonicalJson(rule.requiredContext) === canonicalJson([`ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`])
          && rule.family === "DECREASE";
        const sidewalkArea = record(policy) && policy.componentRole === "SIDEWALK_TILE_PAVING"
          && entry.parameterCode === "SPZU-026" && rule.ruleId === "matrix-spzu-026-sidewalk_tile_area"
          && entry.family === "DIFFERENT"
          && entry.gap === "PARTIAL_SUBRULES_ONLY:SIDEWALK_TILE_AREA_ONLY;OTHER_PAVING_QUANTITIES_AND_FULL_SCOPE_UNSUPPORTED"
          && rule.attribute === "SIDEWALK_TILE_AREA" && rule.canonicalUnit === "m2"
          && rule.family === "DIFFERENT" && rule.valueKind === "DECIMAL" && rule.threshold === null
          && rule.enabled === true && rule.scopePolicy === "EXPLICIT_REVIEWED_CONTEXT"
          && rule.comparisonPurpose === "CATALOG_TRIGGER" && canonicalJson(rule.allowedValues) === "[]"
          && canonicalJson(rule.requiredContext) === canonicalJson(["APPROVED_CHANGE_STATUS", "SURFACE_TYPE_IDENTITY",
            "ZONE_IDENTITY", "ATOMIC_SUBRULE_SCOPE:matrix-spzu-026-sidewalk_tile_area"])
          && canonicalJson(rule.allowedStagePairs) === '[["PD","RD"]]'
          && canonicalJson(rule.expectedSections) === '["SPZU","GP"]'
          && canonicalJson(rule.actualSections) === '["PP","GP"]'
          && canonicalJson(rule.labels) === canonicalJson(["Площадь тротуарного плиточного покрытия", "Площадь тротуаров из бетонной плитки"])
          && canonicalJson(rule.unitAliases) === canonicalJson(["м²", "м2", "m²", "m2", "кв.м", "кв. м"]);
        const egressSpec = egressHeightSpecs.find(spec => spec.ruleId === rule.ruleId);
        const egressHeight = !!egressSpec && record(policy) && policy.componentRole === egressSpec.role
          && entry.parameterCode === "AR-042" && entry.family === "LOWER_BOUND"
          && entry.gap === "SCOPED_LITERAL_HEIGHT_ONLY;DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_AND_PD_BASELINE_REVIEW_REQUIRED"
          && rule.attribute === egressSpec.attribute && rule.canonicalUnit === "m"
          && rule.family === "LOWER_BOUND" && rule.valueKind === "DECIMAL"
          && canonicalJson(rule.threshold) === canonicalJson({ value: egressSpec.threshold, unit: "m", strict: true })
          && rule.enabled === true && rule.scopePolicy === "EXPLICIT_REVIEWED_CONTEXT"
          && rule.comparisonPurpose === "CATALOG_TRIGGER" && canonicalJson(rule.allowedValues) === "[]"
          && canonicalJson(rule.requiredContext) === canonicalJson(["NORM_APPLICABILITY_VERIFIED", "EVACUATION_ROUTE_IDENTITY",
            `ATOMIC_SUBRULE_SCOPE:${egressSpec.ruleId}`])
          && canonicalJson(rule.allowedStagePairs) === '[["PD","RD"]]'
          && canonicalJson(rule.expectedSections) === '["AR"]' && canonicalJson(rule.actualSections) === '["AR"]'
          && canonicalJson(rule.labels) === canonicalJson([egressSpec.label])
          && canonicalJson(rule.unitAliases) === canonicalJson(["м", "m", "мм", "mm", "см", "cm"]);
        const stairSpec = stairSpecs.find(spec => spec.ruleId === rule.ruleId);
        const stairDimension = !!stairSpec && record(policy) && policy.componentRole === stairSpec.role
          && entry.parameterCode === "AR-048" && entry.family === null
          && entry.gap === "SCOPED_LITERAL_STAIR_DIMENSIONS_ONLY;STEP_COUNT_DRAWING_GEOMETRY_COMPLETE_INVENTORY_NORM_EXCEPTIONS_PD_BASELINE_AND_ID_REQUIRED"
          && rule.attribute === stairSpec.attribute && rule.canonicalUnit === "mm"
          && rule.family === stairSpec.family && rule.valueKind === "DECIMAL"
          && canonicalJson(rule.threshold) === canonicalJson({ value: stairSpec.threshold, unit: "mm", strict: true })
          && rule.enabled === true && rule.scopePolicy === "EXPLICIT_REVIEWED_CONTEXT"
          && rule.comparisonPurpose === "CATALOG_TRIGGER" && canonicalJson(rule.allowedValues) === "[]"
          && canonicalJson(rule.requiredContext) === canonicalJson(["NORM_APPLICABILITY_VERIFIED", "STAIR_FLIGHT_STEP_IDENTITY",
            `ATOMIC_SUBRULE_SCOPE:${stairSpec.ruleId}`])
          && canonicalJson(rule.allowedStagePairs) === '[["PD","RD"]]'
          && canonicalJson(rule.expectedSections) === '["AR"]' && canonicalJson(rule.actualSections) === '["AR"]'
          && canonicalJson(rule.labels) === canonicalJson([stairSpec.label])
          && canonicalJson(rule.unitAliases) === canonicalJson(["мм", "mm", "м", "m", "см", "cm"]);
        const fenceHeight = record(policy) && policy.componentRole === "TERRITORY_FENCE_SEGMENT"
          && entry.parameterCode === "SPZU-036" && entry.family === null && entry.atomicRules.length === 1
          && entry.gap === "PARTIAL_SUBRULES_ONLY:TERRITORY_FENCE_HEIGHT_DECREASE_ONLY;FENCE_TYPE_REPLACEMENT_GATE_DIMENSIONS_DRAWING_GEOMETRY_COMPLETE_INVENTORY_AND_ID_UNSUPPORTED"
          && rule.ruleId === fenceRuleId && rule.attribute === fenceAttribute && rule.canonicalUnit === "m"
          && rule.family === "DECREASE" && rule.valueKind === "DECIMAL" && rule.threshold === null
          && rule.enabled === true && rule.scopePolicy === "EXPLICIT_REVIEWED_CONTEXT"
          && rule.comparisonPurpose === "CATALOG_TRIGGER" && canonicalJson(rule.allowedValues) === "[]"
          && canonicalJson(rule.requiredContext) === canonicalJson(["APPROVED_CHANGE_STATUS", "FENCE_TYPE_IDENTITY",
            "ZONE_IDENTITY", `ATOMIC_SUBRULE_SCOPE:${fenceRuleId}`])
          && canonicalJson(rule.allowedStagePairs) === '[["PD","RD"]]'
          && canonicalJson(rule.expectedSections) === '["SPZU","GP"]' && canonicalJson(rule.actualSections) === '["AR","PP","GP"]'
          && canonicalJson(rule.labels) === canonicalJson(["Высота ограждения территории"])
          && canonicalJson(rule.unitAliases) === canonicalJson(["м", "m", "мм", "mm", "см", "cm"]);
        const projectZero = record(policy) && policy.componentRole === "PROJECT_ZERO_DATUM"
          && entry.parameterCode === "PZ-009" && entry.family === null && entry.atomicRules.length === 1
          && entry.gap === "PARTIAL_SUBRULES_ONLY:DECLARED_PROJECT_ZERO_ABSOLUTE_ELEVATION_ONLY;INDEPENDENT_GEOREFERENCE_TOPOGRAPHIC_BASE_CONTROL_POINTS_DATUM_TRANSFORM_AND_COMPLETE_INVENTORY_UNSUPPORTED"
          && rule.ruleId === projectZeroRuleId && rule.attribute === projectZeroAttribute && rule.canonicalUnit === "m"
          && rule.family === "DIFFERENT" && rule.valueKind === "DECIMAL" && rule.threshold === null
          && rule.enabled === true && rule.scopePolicy === "EXPLICIT_REVIEWED_CONTEXT"
          && rule.comparisonPurpose === "CATALOG_TRIGGER" && canonicalJson(rule.allowedValues) === "[]"
          && canonicalJson(rule.requiredContext) === canonicalJson(["APPROVED_CHANGE_STATUS", "PROJECT_ZERO_GEODETIC_AUTHORITY",
            `ATOMIC_SUBRULE_SCOPE:${projectZeroRuleId}`])
          && canonicalJson(rule.allowedStagePairs) === '[["PD","RD"]]'
          && canonicalJson(rule.expectedSections) === '["PZ"]' && canonicalJson(rule.actualSections) === '["KR","AR"]'
          && canonicalJson(rule.labels) === canonicalJson(["Абсолютная отметка проектного нуля"])
          && canonicalJson(rule.unitAliases) === canonicalJson(["м", "метрах"]);
        const rebar = record(policy) && policy.componentRole === "WORKING_REINFORCEMENT_POSITION"
          && entry.parameterCode === "KR-057" && entry.family === null && entry.atomicRules.length === 1
          && entry.gap === "PARTIAL_SUBRULES_ONLY:CATALOG_A500C_TO_A400_EXAMPLE_ONLY;OTHER_GRADES_PLASTICITY_SCALE_NONWORKING_REINFORCEMENT_COMPLETE_INVENTORY_AND_ID_UNSUPPORTED"
          && rule.ruleId === rebarRuleId && rule.attribute === rebarAttribute && rule.canonicalUnit === "rebar_catalog_example"
          && rule.family === "CLASS_DECREASE" && rule.valueKind === "CATEGORY" && rule.threshold === null
          && rule.enabled === true && rule.scopePolicy === "EXPLICIT_REVIEWED_CONTEXT"
          && rule.comparisonPurpose === "CATALOG_TRIGGER" && canonicalJson(rule.allowedValues) === canonicalJson(["А500С","А400"])
          && canonicalJson(rule.requiredContext) === canonicalJson(["APPROVED_CHANGE_STATUS", "REINFORCEMENT_APPLICATION_SCOPE",`ATOMIC_SUBRULE_SCOPE:${rebarRuleId}`])
          && canonicalJson(rule.allowedStagePairs) === '[["PD","RD"]]'
          && canonicalJson(rule.expectedSections) === '["KR"]' && canonicalJson(rule.actualSections) === '["KR"]'
          && canonicalJson(rule.labels) === canonicalJson(["Класс рабочей арматуры"])
          && canonicalJson(rule.unitAliases) === "[]";
        if (!record(policy) || policy.schemaVersion !== "matched-atomic-context-v1"
          || canonicalJson(Object.keys(policy).sort()) !== canonicalJson(["schemaVersion","componentRole","identityFields"].sort())
          || canonicalJson(policy.identityFields) !== canonicalJson([
            "componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey"])
          || (!legacyDecrease && !sidewalkArea && !egressHeight && !stairDimension && !fenceHeight && !projectZero && !rebar)
          || (egressHeightSpecs.some(spec => spec.ruleId === rule.ruleId || spec.attribute === rule.attribute) && !egressHeight)
          || (stairSpecs.some(spec => spec.ruleId === rule.ruleId || spec.attribute === rule.attribute) && !stairDimension)
          || ((rule.ruleId === fenceRuleId || rule.attribute === fenceAttribute) && !fenceHeight)
          || ((rule.ruleId === rebarRuleId || rule.attribute === rebarAttribute || rule.canonicalUnit === "rebar_catalog_example") && !rebar)
          || ((rule.ruleId === projectZeroRuleId || rule.attribute === projectZeroAttribute) && !projectZero)
          || !entry.gap) throw new Error("Invalid subrule context");
      }
      if (rule.requiredContext.some(key => key.startsWith("ATOMIC_SUBRULE_SCOPE:")) && rule.subruleContext === undefined) {
        throw new Error("Missing subrule context policy");
      }
      ids.add(rule.ruleId);
    }
  }
  return raw as unknown as Registry;
}

function sourceIndex(input: MatrixRuleVerificationInput, registry: Registry): Map<string, Source> {
  if (!input.objectId.trim() || !hash.test(input.inputManifestHash) || !Array.isArray(input.sources)) throw new Error("Invalid input");
  const result = new Map<string, Source>();
  for (const raw of input.sources) {
    const source = { ...raw } as Source;
    if (record(raw.review)) for (const key of ["revisionStatus", "approvalStatus", "linkGroupId", "pageStages", "sectionCode", "scopeProofs"] as const) {
      if (Object.hasOwn(raw.review, key)) Object.assign(source, { [key]: raw.review[key] });
    }
    source.revisionStatus ??= "UNKNOWN"; source.approvalStatus ??= "UNKNOWN"; source.pageStages ??= {};
    if (!source.sourceFileId.trim() || result.has(source.sourceFileId) || !hash.test(source.sha256)
      || (source.objectId !== undefined && source.objectId !== input.objectId)
      || !strings(source.stages) || !source.stages.length || new Set(source.stages).size !== source.stages.length
      || source.stages.some(s => !stages.has(s)) || !["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(source.revisionStatus)
      || !["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(source.approvalStatus)
      || !record(source.pageStages) || Object.entries(source.pageStages).some(([n, stage]) => !/^[1-9]\d*$/u.test(n)
        || !(source.stages.includes(stage) || stage === "UNRESOLVED"))
      || (source.sectionCode != null && typeof source.sectionCode !== "string")) throw new Error("Invalid source");
    source.factScope = prepareMatrixFactBindings(source, input, registry.entries.flatMap(entry =>
      entry.atomicRules.filter(rule => rule.enabled).map(rule => ({ ...rule, parameterCode: entry.parameterCode }))));
    result.set(source.sourceFileId, source);
  }
  return result;
}

function proof(source: Source, key: string, input: MatrixRuleVerificationInput,
  fact?: MatrixObservation, rule?: Rule, parameterCode?: string): Proof | null {
  if (source.factScope) return fact && rule && parameterCode
    ? source.factScope.proof(fact, rule, parameterCode, key) as Proof | null : null;
  if (key === "PROJECT_ZERO_GEODETIC_AUTHORITY" || key === "REINFORCEMENT_APPLICATION_SCOPE") return null;
  const p = source.scopeProofs?.[key];
  return record(p) && p.status === "VERIFIED" && typeof p.reference === "string" && !!p.reference.trim()
    && p.sourceFileId === source.sourceFileId && p.sourceSha256 === source.sha256 && p.objectId === input.objectId
    && p.inputManifestHash === input.inputManifestHash && typeof p.entityKey === "string" && !!p.entityKey.trim()
    ? p as Proof : null;
}

function validateObservations(observations: MatrixObservation[], sources: Map<string, Source>, input: MatrixRuleVerificationInput,
  registry: Registry): void {
  const ids = new Set<string>(), entries = new Map(registry.entries.map(e => [e.parameterCode, e]));
  for (const fact of observations) {
    const source = sources.get(fact.sourceFileId), codes = fact.parameterCodes;
    if (!source || ids.has(fact.id) || fact.sourceSha256 !== source.sha256 || !strings(codes) || !codes.length
      || new Set(codes).size !== codes.length || !Number.isSafeInteger(fact.pageNumber) || fact.pageNumber < 1
      || fact.entityKey !== (source.factScope ? source.factScope.entity(fact) : proof(source, "ENTITY_SCOPE", input)?.entityKey ?? null)
      || codes.some(code => !entries.get(code)?.atomicRules.some(rule => rule.enabled
        && rule.attribute === fact.attribute && rule.canonicalUnit === fact.unit))) throw new Error("Invalid typed fact");
    const stage = source.stages.length === 1 ? source.stages[0] : source.pageStages[String(fact.pageNumber)] ?? "UNRESOLVED";
    if (stage !== fact.stage || !Array.isArray(source.textArtifact?.pages)) throw new Error("Invalid fact stage or artifact");
    const page = source.textArtifact.pages.find((p: unknown) => record(p) && p.pageNumber === fact.pageNumber);
    if (!record(page) || !record(page.quality) || typeof page.quality.disposition !== "string") throw new Error("Missing page quality");
    const flags: string[] = [];
    if (source.revisionStatus !== "CURRENT") flags.push(`SOURCE_REVISION_${source.revisionStatus}`);
    if (source.approvalStatus !== "APPROVED") flags.push(`SOURCE_APPROVAL_${source.approvalStatus}`);
    if (stage === "UNRESOLVED") flags.push("SOURCE_STAGE_UNRESOLVED");
    if (page.quality.disposition !== "TEXT_LAYER_CANDIDATE") flags.push("PAGE_TEXT_REQUIRES_OCR");
    const concreteProse=isConcreteProseFact(fact);
    if(concreteProse&&!validConcreteSourceBinding(fact as unknown as Record<string,unknown>,Array.isArray(fact.evidenceFragments)?fact.evidenceFragments:[],source.textArtifact,
      n=>source.stages.length===1?source.stages[0]:source.pageStages[String(n)]??"UNRESOLVED"))throw new Error("Invalid concrete prose source");
    if(fact.contextFragments!==undefined) {
      if(!Array.isArray(fact.contextFragments)||!fact.contextFragments.length||fact.contextFragments.length>8)
        throw new Error("Invalid table context");
      if (fact.attribute !== projectZeroAttribute && fact.attribute !== rebarAttribute && !concreteProse) flags.push("TABLE_CONTEXT_UNVERIFIED");
      for(const fragment of fact.contextFragments) {
        const contextPage=source.textArtifact.pages.find((p:unknown)=>record(p)&&p.pageNumber===fragment.pageNumber);
        const contextStage=source.stages.length===1?source.stages[0]:source.pageStages[String(fragment.pageNumber)]??"UNRESOLVED";
        if(!record(contextPage)||!record(contextPage.quality)||contextStage!==stage)throw new Error("Invalid table context page");
        if(contextPage.quality.disposition!=="TEXT_LAYER_CANDIDATE")flags.push("PAGE_TEXT_REQUIRES_OCR");
      }
    }
    const fragments = fact.evidenceFragments;
    // Header-derived units are deliberately candidates, even with approved documents.
    if (Array.isArray(fragments) && fragments.length === 3 && record(fragments[1]) && record(fragments[2])
      && typeof fragments[1].rawText === "string" && typeof fact.rawValue === "string"
      && fragments[1].rawText.replace(/\s+/gu, " ").trim() === fact.rawValue.replace(/\s+/gu, " ").trim()
      && typeof fragments[2].rawText === "string"
      && /^(?:В гр\. ГПЗУ|Значение|Показатель|Площадь)\s*[,;:]?\s*\S/u.test(fragments[2].rawText.trim())) {
      flags.push("TABLE_HEADER_UNIT_SCOPE_UNVERIFIED");
    }
    if (!strings(fact.sourceFlags) || canonicalJson(fact.sourceFlags) !== canonicalJson([...new Set(flags)].sort())) {
      throw new Error("Invalid source flags");
    }
    const matching = codes.flatMap(code => entries.get(code)!.atomicRules.filter(r => r.enabled
      && r.attribute === fact.attribute && r.canonicalUnit === fact.unit));
    if (matching.some(rule => rule.valueKind === "CATEGORY" && !rule.allowedValues.includes(fact.value))) throw new Error("Invalid class value");
    if (matching.some(rule => rule.valueKind === "DECIMAL" || rule.valueKind === "INTEGER")) {
      const value = decimal(fact.value);
      if ((value.n < 0n && !(fact.attribute === projectZeroAttribute && matching.every(rule => rule.ruleId === projectZeroRuleId))) || matching.some(rule => rule.valueKind === "INTEGER") && value.n % value.d !== 0n) throw new Error("Invalid numeric fact");
    } else if (!(fact.attribute === rebarAttribute && fact.unit === "rebar_catalog_example"
      && ["А500С", "А400"].includes(fact.value)) && !classRank(fact.value, fact.unit)) throw new Error("Invalid class fact");
    ids.add(fact.id);
  }
}

function validProjectZeroAuthority(expected: Source, actual: Source, expectedFact: MatrixObservation,
  actualFact: MatrixObservation, rule: Rule, input: MatrixRuleVerificationInput, parameterCode: string, entity: string): boolean {
  if (!expected.factScope || !actual.factScope) return false;
  const key = "PROJECT_ZERO_GEODETIC_AUTHORITY";
  const a = proof(expected, key, input, expectedFact, rule, parameterCode);
  const b = proof(actual, key, input, actualFact, rule, parameterCode);
  if (a?.entityKey !== entity || b?.entityKey !== entity || !record(a.projectZeroAuthority)
    || !record(b.projectZeroAuthority)) return false;
  const authority = a.projectZeroAuthority, reference = b.projectZeroAuthority;
  return expectedFact.stage === "PD" && actualFact.stage === "RD"
    && authority.kind === "APPROVED_PD_GEODETIC_BASIS" && authority.sourceFileId === expected.sourceFileId
    && authority.sourceSha256 === expected.sha256 && authority.pageNumber === expectedFact.pageNumber
    && canonicalJson(authority.target) === canonicalJson(a.bindingTarget) && !Object.hasOwn(authority, "reviewContentHash")
    && typeof a.serverReviewContentHash === "string" && hash.test(a.serverReviewContentHash)
    && canonicalJson(reference) === canonicalJson({ ...authority, reviewContentHash: a.serverReviewContentHash });
}

function context(rule: Rule, expected: Source, actual: Source, entity: string | null,
  input: MatrixRuleVerificationInput, parameterCode: string, expectedValue: string, expectedStage: Stage, actualStage: Stage,
  expectedFact: MatrixObservation, actualFact: MatrixObservation): string | null {
  if (entity === null) return "ENTITY_SCOPE_UNVERIFIED";
  const expectedSections = expectedStage === "PD" ? rule.expectedSections : rule.actualSections;
  for (const [source, sections, fact, stage] of [[expected, expectedSections, expectedFact, expectedStage], [actual, rule.actualSections, actualFact, actualStage]] as const) {
    if (proof(source, "ENTITY_SCOPE", input, fact, rule, parameterCode)?.entityKey !== entity) return "ENTITY_SCOPE_MISMATCH";
    if (source.revisionStatus !== "CURRENT") return source.revisionStatus === "UNKNOWN" ? "SOURCE_REVISION_UNRESOLVED" : "SOURCE_REVISION_SUPERSEDED";
    if (source.approvalStatus !== "APPROVED") return source.approvalStatus === "UNKNOWN" ? "SOURCE_APPROVAL_UNRESOLVED" : "SOURCE_UNAPPROVED";
    if (stage === "ID" || !sections.includes(source.sectionCode ?? "")) {
      if (!sections.includes(String(proof(source, "DRAWING_SECTION_VERIFIED", input, fact, rule, parameterCode)?.drawingSection))) return "SOURCE_SECTION_UNVERIFIED";
    }
  }
  if (!expected.linkGroupId || expected.linkGroupId !== actual.linkGroupId) return "LINK_GROUP_MISMATCH";
  if (rule.ruleId === rebarRuleId && (!expected.factScope || !actual.factScope))
    return "CONTEXT_UNVERIFIED:REINFORCEMENT_APPLICATION_SCOPE";
  const concreteProse=rule.ruleId==="matrix-kr-055-concrete_class"&&(isConcreteProseFact(expectedFact)||isConcreteProseFact(actualFact));
  if(concreteProse&&(expectedStage!=="PD"||actualStage!=="RD"||!expected.factScope||!actual.factScope))return "CONTEXT_UNVERIFIED:ELEMENT_IDENTITY";
  for (const key of rule.requiredContext) for (const [source, fact, otherSource, otherFact]
    of [[expected, expectedFact, actual, actualFact], [actual, actualFact, expected, expectedFact]] as const) {
    const reason = `CONTEXT_UNVERIFIED:${key}`;
    if (rule.ruleId === projectZeroRuleId && key === "PROJECT_ZERO_GEODETIC_AUTHORITY") {
      if (!validProjectZeroAuthority(expected, actual, expectedFact, actualFact, rule, input, parameterCode, entity)) return reason;
      continue;
    }
    const p = proof(source, key, input, fact, rule, parameterCode);
    if (p?.entityKey !== entity) return reason;
    if(concreteProse&&key==="ELEMENT_IDENTITY") {
      const other=proof(otherSource,key,input,otherFact,rule,parameterCode);
      if(!other||p.componentRole!=="MONOLITHIC_LOAD_BEARING_STAIR"||other.componentRole!=="MONOLITHIC_LOAD_BEARING_STAIR"
        ||["componentKey","zoneKey","operatingModeKey","measurementBasisKey"].some(field=>typeof p[field]!=="string"||!(p[field] as string).trim()||p[field]!==other[field])
        ||p.operatingModeKey!=="CAST_IN_PLACE_LOAD_BEARING_STAIR"||p.measurementBasisKey!=="CONCRETE_COMPRESSIVE_STRENGTH_CLASS")return reason;
    }
    if(concreteProse&&key==="MATERIAL_CLASS_BASIS"&&(p.attribute!=="CONCRETE_CLASS"||p.canonicalUnit!=="B_CLASS"
      ||p.measurementBasisKey!=="CONCRETE_COMPRESSIVE_STRENGTH_CLASS"))return reason;
    if (key === "NORM_APPLICABILITY_VERIFIED" && (p.applicable !== true || p.parameterCode !== parameterCode
      || p.attribute !== rule.attribute || p.threshold !== rule.threshold?.value || p.canonicalUnit !== rule.canonicalUnit)) return reason;
    if (key === "TECHNICAL_CONDITIONS_LIMIT" && (p.limitValue !== expectedValue || p.canonicalUnit !== rule.canonicalUnit)) return reason;
    if (key === "APPROVED_CHANGE_STATUS" && p.approvedChangePresent !== false) return reason;
    if (key === "THERMAL_RESISTANCE_REDUCTION_VERIFIED" && p.reductionConfirmed !== true) return reason;
    if (key === `ATOMIC_SUBRULE_SCOPE:${rule.ruleId}`) {
      const policy = rule.subruleContext, other = proof(otherSource, key, input, otherFact, rule, parameterCode);
      if (!policy || p.parameterCode !== parameterCode || p.attribute !== rule.attribute
        || p.canonicalUnit !== rule.canonicalUnit || p.componentRole !== policy.componentRole
        || !other || policy.identityFields.some(field => typeof p[field] !== "string"
          || !(p[field] as string).trim() || p[field] !== other[field])) return reason;
      const egressSpec = egressHeightSpecs.find(spec => spec.role === policy.componentRole);
      const stairSpec = stairSpecs.find(spec => spec.role === policy.componentRole);
      if (stairSpec && (p.operatingModeKey !== "EVACUATION" || p.measurementBasisKey !== stairSpec.basis)) return reason;
      if (egressSpec && (p.operatingModeKey !== "EVACUATION" || p.measurementBasisKey !== egressSpec.basis)) return reason;
      if (policy.componentRole === "WORKING_REINFORCEMENT_POSITION" && (p.operatingModeKey !== "WORKING_NOT_CONSTRUCTIVE_ASSEMBLY_OR_EMBEDDED"
        || p.measurementBasisKey !== "DECLARED_REINFORCEMENT_CLASS")) return reason;
      if (policy.componentRole === "PROJECT_ZERO_DATUM" && p.measurementBasisKey !== projectZeroBasis) return reason;
      if (policy.componentRole === "TERRITORY_FENCE_SEGMENT" && (p.operatingModeKey !== "TERRITORY_BOUNDARY"
        || p.measurementBasisKey !== "FINISHED_GROUND_TO_FENCE_TOP")) return reason;
    }
  }
  return null;
}

function decimal(text: string): Rational {
  if (typeof text !== "string" || text.length > 1000 || !/^-?\d+(?:\.\d+)?$/u.test(text)) throw new Error("Invalid decimal");
  const negative = text.startsWith("-"), [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  return { n: BigInt(whole + fraction) * (negative ? -1n : 1n), d: 10n ** BigInt(fraction.length) };
}
const abs = (a: bigint) => a < 0n ? -a : a;
const compare = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;
const difference = (a: Rational, b: Rational): Rational => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
function coefficientText(coefficient: bigint, places: number): string {
  const negative = coefficient < 0n, digits = abs(coefficient).toString();
  const text = places <= 0 ? digits + "0".repeat(-places)
    : digits.padStart(places + 1, "0").slice(0, -places) + "." + digits.padStart(places + 1, "0").slice(-places);
  const clean = text.includes(".") ? text.replace(/0+$/u, "").replace(/\.$/u, "") : text;
  return negative && coefficient !== 0n ? `-${clean}` : clean;
}
/** Decimal ROUND_HALF_EVEN, with the worker's significant-digit context. */
function decimalText(value: Rational, precision = 1000): string {
  if (value.n === 0n) return "0";
  const numerator = abs(value.n), denominator = value.d;
  let exponent = numerator.toString().length - denominator.toString().length;
  if (exponent >= 0 ? numerator < denominator * 10n ** BigInt(exponent)
    : numerator * 10n ** BigInt(-exponent) < denominator) exponent--;
  const places = precision - 1 - exponent;
  const scaledNumerator = numerator * (places >= 0 ? 10n ** BigInt(places) : 1n);
  const scaledDenominator = denominator * (places < 0 ? 10n ** BigInt(-places) : 1n);
  let q = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  if (remainder * 2n > scaledDenominator || remainder * 2n === scaledDenominator && q % 2n === 1n) q++;
  return coefficientText(value.n < 0n ? -q : q, places);
}
function classRank(value: string, unit: string): [string, Rational] | null {
  if (unit === "B_CLASS") {
    const match = /^[BВ](\d+(?:[.,]\d+)?)$/u.exec(value);
    return match ? ["B", decimal(match[1].replace(",", "."))] : null;
  }
  if (unit === "fire_rating") {
    const match = /^(EI|E|I)-(\d+)$/u.exec(value);
    return match ? [match[1], decimal(match[2])] : null;
  }
  let rank: number | undefined;
  if (unit === "reliability_category") rank = ({ I: 3, "1": 3, II: 2, "2": 2, III: 1, "3": 1 } as Record<string, number>)[value];
  if (unit === "energy_class") {
    const token = ({ А: "A", В: "B", С: "C", Д: "D", Е: "E" } as Record<string, string>)[value] ?? value;
    const index = ["G", "F", "E", "D", "C", "B", "A"].indexOf(token); if (index >= 0) rank = index;
  }
  if (unit === "fire_resistance_degree") rank = ({ I: 5, II: 4, III: 3, IV: 2, V: 1 } as Record<string, number>)[value];
  if (unit === "structural_fire_hazard_class") { const m = /^[CС]([0-3])$/u.exec(value); if (m) rank = 3 - Number(m[1]); }
  if (unit === "finish_fire_class") { const m = /^(?:КМ|KM)([0-5])$/u.exec(value); if (m) rank = 5 - Number(m[1]); }
  return rank === undefined ? null : [unit, { n: BigInt(rank), d: 1n }];
}

function compareValues(rule: Rule, expected: string, actual: string): { triggered: boolean | null; delta: string | null; reason: string | null } {
  const unavailable = (reason: string) => ({ triggered: null, delta: null, reason });
  if (rule.ruleId === rebarRuleId) {
    if (!["А500С","А400"].includes(expected) || !["А500С","А400"].includes(actual)) return unavailable("CLASS_DOMAIN_NOT_COMPARABLE");
    if (expected === actual) return { triggered:false, delta:null, reason:null };
    return expected === "А500С" && actual === "А400" ? { triggered:true,delta:null,reason:null }
      : unavailable("UNSUPPORTED_CATEGORY_TRANSITION");
  }
  if (rule.family === "CLASS_DECREASE") {
    const a = classRank(expected, rule.canonicalUnit), b = classRank(actual, rule.canonicalUnit);
    if (!a || !b || a[0] !== b[0]) return unavailable("CLASS_DOMAIN_NOT_COMPARABLE");
    return { triggered: compare(b[1], a[1]) < 0n, delta: decimalText(difference(b[1], a[1])), reason: null };
  }
  const a = decimal(expected), b = decimal(actual), delta = difference(b, a);
  // Decimal ignores leading zeroes when setting the worker's precision.
  const digits = (s: string) => s.replace(/^-|\./gu, "").replace(/^0+/u, "").length || 1;
  const precision = Math.max(80, digits(expected) + digits(actual) + 20);
  if (rule.family === "RELATIVE_DELTA" || rule.family === "RELATIVE_INCREASE") {
    if (a.n === 0n) return unavailable("ZERO_BASELINE");
    // Python rounds the division before multiplying by 100; preserving that intermediate matters for repeating values.
    const relative: Rational = { n: (rule.family === "RELATIVE_DELTA" ? abs(delta.n) : delta.n) * a.d,
      d: delta.d * abs(a.n) };
    const divided = decimal(decimalText(relative, precision));
    const percentage = decimal(decimalText({ n: divided.n * 100n, d: divided.d }, precision));
    return { triggered: compare(percentage, decimal(rule.threshold!.value)) > 0n,
      delta: decimalText(percentage, precision), reason: null };
  }
  if (rule.family === "LOWER_BOUND" || rule.family === "UPPER_BOUND") {
    const bound = decimal(rule.threshold!.value), lower = rule.family === "LOWER_BOUND";
    if (lower ? compare(a, bound) < 0n : compare(a, bound) > 0n) return unavailable("PROJECT_BASELINE_OUTSIDE_BOUND");
    return { triggered: lower ? compare(b, bound) < 0n : compare(b, bound) > 0n,
      delta: decimalText(difference(b, bound), precision), reason: null };
  }
  return { triggered: rule.family === "DIFFERENT" ? delta.n !== 0n : rule.family === "INCREASE" ? delta.n > 0n : delta.n < 0n,
    delta: decimalText(delta, precision), reason: null };
}

function evaluate(execution: MatrixExecution, input: MatrixRuleVerificationInput, registry: Registry, sources: Map<string, Source>): MatrixAtomicResult[] {
  const results: MatrixAtomicResult[] = [];
  const hasId = [...sources.values()].some(s => s.stages.includes("ID"));
  for (const entry of registry.entries) for (const rule of entry.atomicRules.filter(r => r.enabled)) {
    for (const [expectedStage, actualStage] of rule.allowedStagePairs) {
      if (actualStage === "ID" && !hasId) continue;
      const facts = execution.observations.filter(f => (f.parameterCodes as string[]).includes(entry.parameterCode)
        && f.attribute === rule.attribute && f.unit === rule.canonicalUnit && (f.stage === expectedStage || f.stage === actualStage));
      const entities: Array<string | null> = [...new Set(facts.map(f => f.entityKey).filter((e): e is string => e !== null))].sort();
      if (!entities.length || facts.some(fact => fact.entityKey === null)) entities.push(null);
      for (const entity of entities) {
        const row: MatrixAtomicResult = { ruleId: rule.ruleId, ruleVersion: rule.version, parameterCode: entry.parameterCode,
          entityKey: entity, comparisonVariant: `${expectedStage}_${actualStage}` as MatrixAtomicResult["comparisonVariant"],
          executionStatus: "SUCCEEDED", machineStatus: "MISSING_EVIDENCE", reasonCode: "REQUIRED_FACT_MISSING",
          expectedObservationId: null, actualObservationId: null, expectedValue: null, actualValue: null, delta: null, qualified: false };
        const selected = facts.filter(f => f.entityKey === entity), a = selected.filter(f => f.stage === expectedStage), b = selected.filter(f => f.stage === actualStage);
        results.push(row);
        if (!a.length || !b.length) {
          if (new Set(facts.map(f => f.stage)).size === 2) Object.assign(row, { machineStatus: "NOT_COMPARABLE", reasonCode: "ENTITY_SCOPE_MISMATCH" });
          continue;
        }
        if (a.length !== 1 || b.length !== 1) { Object.assign(row, { machineStatus: "CLARIFICATION_REQUIRED", reasonCode: "AMBIGUOUS_FACTS" }); continue; }
        const expected = a[0], actual = b[0], pd = sources.get(expected.sourceFileId)!, rd = sources.get(actual.sourceFileId)!;
        Object.assign(row, { expectedObservationId: expected.id, actualObservationId: actual.id,
          expectedValue: expected.value, actualValue: actual.value });
        const reason = context(rule, pd, rd, entity, input, entry.parameterCode, expected.value, expectedStage, actualStage, expected, actual)
          ?? ((pd.factScope?.effectiveFlags(expected, rule, entry.parameterCode) ?? expected.sourceFlags as string[]).length
            || (rd.factScope?.effectiveFlags(actual, rule, entry.parameterCode) ?? actual.sourceFlags as string[]).length
            ? "TEXT_OR_STAGE_QUALITY_UNVERIFIED" : null);
        if (reason) { Object.assign(row, { machineStatus: "CLARIFICATION_REQUIRED", reasonCode: reason }); continue; }
        const compared = compareValues(rule, expected.value, actual.value); row.delta = compared.delta;
        if (compared.reason) { Object.assign(row, { machineStatus: "NOT_COMPARABLE", reasonCode: compared.reason }); continue; }
        if (!compared.triggered && [pd, rd].some(s => proof(s, `RULE_SCOPE_COMPLETE:${rule.ruleId}`, input)?.entityKey !== entity)) {
          Object.assign(row, { machineStatus: "CLARIFICATION_REQUIRED", reasonCode: "NEGATIVE_SCOPE_UNVERIFIED" }); continue;
        }
        Object.assign(row, { machineStatus: compared.triggered ? "CANDIDATE" : "NEGATIVE_VERIFIED",
          reasonCode: compared.triggered ? "CATALOG_TRIGGER_MATCHED" : "SCOPED_TRIGGER_NOT_MATCHED", qualified: true });
      }
    }
  }
  return results;
}

function coverageFor(execution: MatrixExecution, results: MatrixAtomicResult[], input: MatrixRuleVerificationInput,
  registry: Registry, sources: Map<string, Source>): MatrixCoverage[] {
  const observedSources = new Map<string, Set<string>>();
  for (const fact of execution.observations) for (const code of fact.parameterCodes as string[]) {
    if (!observedSources.has(code)) observedSources.set(code, new Set());
    observedSources.get(code)!.add(fact.sourceFileId);
  }
  return registry.entries.map(entry => {
    const rules = entry.atomicRules, enabled = rules.filter(r => r.enabled), rows = results.filter(r => r.parameterCode === entry.parameterCode);
    const failures = rows.filter(r => r.executionStatus === "FAILED").length, comparisons = rows.filter(r => r.qualified).length;
    const abstentions = rows.filter(r => !r.qualified && r.executionStatus === "SUCCEEDED").length;
    const completeSources = [...observedSources.get(entry.parameterCode) ?? []].map(identity => sources.get(identity)!);
    const complete = entry.gap === null && rows.length > 0 && comparisons === rows.length && completeSources.length > 0 && completeSources.every(source => {
      const p = proof(source, `PARAMETER_SCOPE_COMPLETE:${entry.parameterCode}`, input), entity = proof(source, "ENTITY_SCOPE", input);
      return !!p && !!entity && p.entityKey === entity.entityKey;
    });
    return { parameterCode: entry.parameterCode, implementedAtomicRules: rules.length, enabledAtomicRules: enabled.length,
      evaluatedAtomicRules: new Set(rows.map(r => r.ruleId)).size, successfulComparisons: comparisons, abstentions, failures,
      executionStatus: !rules.length ? "UNSUPPORTED" : failures && !comparisons && !abstentions ? "TECHNICAL_FAILURE"
        : complete && enabled.length === rules.length ? "EVALUATED" : "PARTIAL",
      reason: entry.gap ?? (complete ? "ALL_CONFIGURED_RULE_SCOPES_VERIFIED" : "SCOPED_EXECUTION_WITH_GAPS") };
  });
}

const resultFields = ["ruleId", "ruleVersion", "parameterCode", "entityKey", "comparisonVariant", "executionStatus", "machineStatus",
  "reasonCode", "expectedObservationId", "actualObservationId", "expectedValue", "actualValue", "delta", "qualified"] as const;
const projection = (row: MatrixAtomicResult) => Object.fromEntries(resultFields.map(key => [key, row[key]]));
const rowKey = (row: MatrixAtomicResult) => canonicalJson([row.ruleId, row.entityKey, row.comparisonVariant]);

/** Recompute coverage from rules and authenticated context, without trusting worker counts or statuses. */
export function computeMatrixCoverage(execution: MatrixExecution, input: MatrixRuleVerificationInput, rawRegistry: unknown): MatrixCoverage[] {
  const registry = registryValue(rawRegistry), sources = sourceIndex(input, registry);
  validateObservations(execution.observations, sources, input, registry);
  return coverageFor(execution, evaluate(execution, input, registry, sources), input, registry, sources);
}

/** Exact independent evaluation. Evidence text/geometry/normalization is checked by the caller's source boundary first. */
export function verifyMatrixAtomicResults(execution: MatrixExecution, input: MatrixRuleVerificationInput, rawRegistry: unknown): boolean {
  try {
    if (execution.schemaVersion !== "matrix-execution-v1" || execution.objectId !== input.objectId
      || execution.inputManifestHash !== input.inputManifestHash || execution.registryHash !== sha256(canonicalJson(rawRegistry))) return false;
    const registry = registryValue(rawRegistry), sources = sourceIndex(input, registry);
    validateObservations(execution.observations, sources, input, registry);
    const expected = evaluate(execution, input, registry, sources), actual = new Map<string, MatrixAtomicResult>();
    for (const row of execution.results) { const key = rowKey(row); if (actual.has(key)) return false; actual.set(key, row); }
    if (expected.length !== actual.size || expected.some(row => !actual.has(rowKey(row))
      || canonicalJson(projection(row)) !== canonicalJson(projection(actual.get(rowKey(row))!)))) return false;
    return canonicalJson(execution.coverage) === canonicalJson(coverageFor(execution, expected, input, registry, sources));
  } catch { return false; }
}
