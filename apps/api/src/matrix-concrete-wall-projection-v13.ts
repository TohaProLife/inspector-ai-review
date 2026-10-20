/** OUTPUT ONLY: internal postconditions, never source/PDF/reviewer authority.
 * Caller authenticates all retained originals and runs the genuine frozen pair
 * helper first. These arguments contain data, never an authority/trust flag.
 */
import type { MatrixAtomicResult } from "@inspector-ai/contracts";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";
import {
  exactConcreteWallV13 as exact, plainConcreteWallV13 as plain,
  sameConcreteWallV13 as same, failConcreteWallV13 as fail,
} from "./matrix-concrete-wall-window-v13.js";

type Plain = Record<string, unknown>;
const RULE = "matrix-kr-055-concrete_class";
const HASH = /^[a-f0-9]{64}(?![\s\S])/u;
const ATOMIC = ["ruleId", "ruleVersion", "parameterCode", "entityKey", "comparisonVariant", "executionStatus",
  "machineStatus", "reasonCode", "qualified", "expectedObservationId", "actualObservationId", "expectedValue", "actualValue", "delta"] as const;
const FACT_KEYS = ["id", "sourceFileId", "sourceSha256", "stage", "pageNumber", "blockId", "bbox", "rawText", "rawValue", "rawUnit",
  "attribute", "value", "unit", "entityKey", "method", "extractorVersion", "parameterCodes", "sourceFlags", "evidenceFragments", "contextFragments"];
// Stage and complete raw/native evidence remain part of identity. Current
// sourceFlags/entity assignment are independently rebuilt caller metadata.
const SAME_FACT_KEYS = ["id", "sourceFileId", "sourceSha256", "stage", "pageNumber", "blockId", "bbox", "rawText", "rawValue", "rawUnit",
  "attribute", "value", "unit", "method", "extractorVersion", "evidenceFragments", "contextFragments"];
const hash = (x: unknown): x is string => typeof x === "string" && HASH.test(x);
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
function box(x: unknown): boolean {
  if (!exact(x, ["x", "y", "width", "height"])) return false;
  const a = x.x, b = x.y, w = x.width, h = x.height;
  return typeof a === "number" && typeof b === "number" && typeof w === "number" && typeof h === "number"
    && a >= 0 && b >= 0 && w > 0 && h > 0 && w <= 1 && h <= 1 && a + w <= 1.000001 && b + h <= 1.000001;
}
function fragment(x: unknown, context: boolean): boolean {
  if (!exact(x, context ? ["pageNumber", "blockId", "rawText", "bbox", "role"] : ["blockId", "rawText", "bbox"])) return false;
  return text(x.blockId) && /^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)(?![\s\S])/u.test(x.blockId)
    && text(x.rawText) && box(x.bbox) && (!context || (typeof x.pageNumber === "number" && Number.isSafeInteger(x.pageNumber)
      && x.pageNumber >= 1 && x.pageNumber <= 512 && typeof x.role === "string"
      && ["ATTRIBUTE_HEADER", "TABLE_SCOPE", "UNIT_DECLARATION", "MATERIAL_SCOPE"].includes(x.role)));
}
function originalFact(x: unknown, stage: "PD" | "RD"): x is Plain {
  return exact(x, FACT_KEYS) && hash(x.id) && text(x.sourceFileId) && hash(x.sourceSha256) && x.stage === stage
    && typeof x.pageNumber === "number" && Number.isSafeInteger(x.pageNumber) && x.pageNumber >= 1 && x.pageNumber <= 512
    && text(x.blockId) && text(x.rawText) && box(x.bbox) && x.attribute === "CONCRETE_CLASS" && x.unit === "B_CLASS"
    && x.rawUnit === "B_CLASS" && text(x.value) && x.rawValue === x.value && x.method === "TEXT_LAYER" && text(x.extractorVersion)
    && (x.entityKey === null || text(x.entityKey)) && Array.isArray(x.parameterCodes) && x.parameterCodes.includes("KR-055")
    && x.parameterCodes.every(text) && Array.isArray(x.sourceFlags) && x.sourceFlags.every(text)
    && Array.isArray(x.evidenceFragments) && x.evidenceFragments.length > 0 && x.evidenceFragments.every(p => fragment(p, false))
    && Array.isArray(x.contextFragments) && x.contextFragments.length > 0 && x.contextFragments.every(p => fragment(p, true));
}
function originals(raw: unknown): { expected: Plain; actual: Plain } {
  if (!exact(raw, ["expected", "actual"]) || !originalFact(raw.expected, "PD") || !originalFact(raw.actual, "RD")
    || raw.expected.id === raw.actual.id || raw.expected.sourceFileId === raw.actual.sourceFileId
    || raw.expected.sourceSha256 === raw.actual.sourceSha256) fail("TARGET_UNVERIFIED");
  return { expected: raw.expected, actual: raw.actual };
}
function currentIndex(raw: unknown): { rows: Plain[]; byId: Map<string, Plain> } {
  if (!Array.isArray(raw)) fail("INVALID_INPUT");
  const byId = new Map<string, Plain>();
  for (const fact of raw) {
    if (!plain(fact) || !hash(fact.id) || byId.has(fact.id)) fail("TARGET_UNVERIFIED");
    byId.set(fact.id, fact);
  }
  return { rows: raw as Plain[], byId };
}
function checkedDecision(raw: unknown, facts: { expected: Plain; actual: Plain }): Plain {
  if (!exact(raw, [...ATOMIC, "wallScope", "confidence", "coverage"]) || raw.ruleId !== RULE || raw.ruleVersion !== "1"
    || raw.parameterCode !== "KR-055" || !text(raw.entityKey) || raw.comparisonVariant !== "PD_RD"
    || raw.executionStatus !== "SUCCEEDED" || typeof raw.machineStatus !== "string"
    || !["CANDIDATE", "NEGATIVE_VERIFIED", "MISSING_EVIDENCE", "NOT_COMPARABLE", "CLARIFICATION_REQUIRED"].includes(raw.machineStatus)
    || !text(raw.reasonCode) || typeof raw.qualified !== "boolean"
    || raw.expectedObservationId !== facts.expected.id || raw.actualObservationId !== facts.actual.id
    || raw.expectedValue !== facts.expected.value || raw.actualValue !== facts.actual.value
    || !(raw.delta === null || typeof raw.delta === "string")
    || !exact(raw.confidence, ["calibratedProbability", "calibrationVersion", "humanDecision"])
    || Object.values(raw.confidence).some(v => v !== null)
    || !exact(raw.coverage, ["parameterCode", "executionStatus", "successfulComparisons", "globalNoViolation", "scopeCompleteUpgrade"])
    || raw.coverage.parameterCode !== "KR-055" || raw.coverage.executionStatus !== "PARTIAL"
    || raw.coverage.successfulComparisons !== Number(raw.qualified) || raw.coverage.globalNoViolation !== false
    || raw.coverage.scopeCompleteUpgrade !== false || (raw.qualified ? !plain(raw.wallScope) : raw.wallScope !== null)) fail("TARGET_UNVERIFIED");
  return raw;
}
function presentSide(original: Plain, current: Plain | undefined, entity: unknown): boolean {
  if (current === undefined) return false;
  if (!SAME_FACT_KEYS.every(k => Object.hasOwn(current, k) && same(current[k], original[k]))
    || !Array.isArray(current.parameterCodes) || !current.parameterCodes.includes("KR-055")
    || current.entityKey !== entity) fail("TARGET_UNVERIFIED");
  return true;
}
function projectChecked(decision: Plain, facts: { expected: Plain; actual: Plain }, byId: Map<string, Plain>): MatrixAtomicResult {
  const hasExpected = presentSide(facts.expected, byId.get(facts.expected.id as string), decision.entityKey);
  const hasActual = presentSide(facts.actual, byId.get(facts.actual.id as string), decision.entityKey);
  const nullable = decision.reasonCode === "SOURCE_STAGE_UNVERIFIED" && decision.qualified === false
    && decision.machineStatus === "CLARIFICATION_REQUIRED" && decision.delta === null && decision.wallScope === null;
  if ((!hasExpected || !hasActual) && !nullable) fail("TARGET_UNVERIFIED");
  const row: Plain = {};
  for (const key of ATOMIC) row[key] = structuredClone(decision[key]);
  if (!hasExpected) { row.expectedObservationId = null; row.expectedValue = null; }
  if (!hasActual) { row.actualObservationId = null; row.actualValue = null; }
  if (decision.qualified === true) row.wallScope = structuredClone(decision.wallScope);
  return row as MatrixAtomicResult;
}

/** No helper invocation or authority claim here. All original integrity runs
 * before this internal projection; absence is not permission to skip it. */
export function projectConcreteWallAtomicV13(decision: unknown, originalFacts: unknown, currentObservations: unknown): MatrixAtomicResult {
  assertConcreteWallLeaseNativeV13({ decision, originalFacts, currentObservations });
  const facts = originals(originalFacts), checked = checkedDecision(decision, facts), current = currentIndex(currentObservations);
  return projectChecked(checked, facts, current.byId);
}

function atomicRow(raw: unknown): raw is Plain {
  return plain(raw) && ATOMIC.every(k => Object.hasOwn(raw, k)) && text(raw.ruleId) && text(raw.ruleVersion)
    && typeof raw.parameterCode === "string" && (raw.entityKey === null || text(raw.entityKey))
    && typeof raw.comparisonVariant === "string" && ["PD_RD", "PD_ID", "RD_ID"].includes(raw.comparisonVariant)
    && typeof raw.executionStatus === "string" && ["SUCCEEDED", "FAILED"].includes(raw.executionStatus)
    && text(raw.machineStatus) && text(raw.reasonCode) && typeof raw.qualified === "boolean"
    && [raw.expectedObservationId, raw.actualObservationId, raw.expectedValue, raw.actualValue, raw.delta]
      .every(v => v === null || typeof v === "string");
}
function selectedRowAssociation(row: Plain, candidates: Set<string>, facts: { expected: Plain; actual: Plain }): boolean {
  for (const [name, original] of [["expected", facts.expected], ["actual", facts.actual]] as const) {
    const id = row[`${name}ObservationId`], value = row[`${name}Value`];
    if (id === null) { if (value !== null) return false; }
    else if (id !== original.id || !candidates.has(id as string) || value !== original.value) return false;
  }
  return true;
}

/** Exact v13 row overlay. All unrelated rows survive with their order/bytes.
 * Native fixed caps remain, including32768 array items; schema50000 is no lift. */
export function mergeConcreteWallAtomicV13(
  rows: unknown, decision: unknown, originalFacts: unknown, currentObservations: unknown,
): MatrixAtomicResult[] {
  assertConcreteWallLeaseNativeV13({ rows, decision, originalFacts, currentObservations });
  if (!Array.isArray(rows) || !rows.every(atomicRow)) fail("INVALID_INPUT");
  const facts = originals(originalFacts), checked = checkedDecision(decision, facts), current = currentIndex(currentObservations);
  const legacy = rows as Plain[];
  const group = (r: Plain): boolean => r.ruleId === RULE && r.parameterCode === "KR-055" && r.comparisonVariant === "PD_RD";
  const groupIndices = legacy.map((r, i) => group(r) ? i : -1).filter(i => i >= 0);
  if (!groupIndices.length) fail("TARGET_UNVERIFIED");
  const keyIndices = legacy.map((r, i) => r.ruleId === RULE && r.entityKey === checked.entityKey
    && r.comparisonVariant === "PD_RD" ? i : -1).filter(i => i >= 0);
  if (keyIndices.length > 1 || (keyIndices.length === 1 && !group(legacy[keyIndices[0]]))) fail("TARGET_UNVERIFIED");
  // Inspect ALL current candidates, not a caller-supplied selected-fact list.
  const candidates = new Set(current.rows.filter(f => f.attribute === "CONCRETE_CLASS"
    && f.entityKey === checked.entityKey && (f.stage === "PD" || f.stage === "RD")).map(f => f.id as string));
  const selected = new Set([facts.expected.id, facts.actual.id]);
  if ([...candidates].some(id => !selected.has(id))) return structuredClone(legacy) as MatrixAtomicResult[];
  if (keyIndices.length === 1 && !selectedRowAssociation(legacy[keyIndices[0]], candidates, facts)) fail("TARGET_UNVERIFIED");
  const row = projectChecked(checked, facts, current.byId);
  const result = structuredClone(legacy) as MatrixAtomicResult[];
  if (keyIndices.length === 1) result[keyIndices[0]] = row;
  else {
    if (result.length + 1 > 50_000) fail("INPUT_LIMIT");
    result.splice(groupIndices[groupIndices.length - 1] + 1, 0, row);
  }
  assertConcreteWallLeaseNativeV13(result);
  return result;
}
