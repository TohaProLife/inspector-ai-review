import {
  matrixFactScopeBindingSchema, sourceSectionCodes,
  type MatrixFactScopeBinding, type MatrixFactScopeTarget, type MatrixObservation,
} from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { portableEvidenceHash, portableEvidenceJson } from "./matrix-fact-scope.js";
import { extractSourceDeclarations } from "./matrix-source-declarations.js";
import { validConcreteTableContext } from "./matrix-table-context.js";
import {
  concreteWallNativeV1, extractConcreteWallCandidatesV1, CONCRETE_WALL_EXTRACTOR_VERSION,
  type ConcreteWallFragment,
} from "./matrix-concrete-wall-prose-v1.js";

export type ConcreteWallScopeValidationCode = "INVALID_INPUT" | "INPUT_LIMIT"
  | "SOURCE_PROVENANCE_UNVERIFIED" | "TARGET_UNVERIFIED";
export class ConcreteWallScopeValidationError extends Error {
  constructor(readonly code: ConcreteWallScopeValidationCode) { super(code); this.name = "ConcreteWallScopeValidationError"; }
}
type Plain = Record<string, unknown>;
type Stage = "PD" | "RD" | "ID" | "UNRESOLVED";
interface NormalizedBox { x: number; y: number; width: number; height: number }
interface Evidence { blockId: string; rawText: string; bbox: NormalizedBox }
interface ContextEvidence extends Evidence { pageNumber: number; role: "ATTRIBUTE_HEADER" | "TABLE_SCOPE" | "UNIT_DECLARATION" | "MATERIAL_SCOPE" }
interface WallFact {
  id: string; sourceFileId: string; sourceSha256: string; stage: Stage; pageNumber: number; blockId: string;
  bbox: NormalizedBox; rawText: string; rawValue: string; rawUnit: string; attribute: string;
  value: string; unit: string; entityKey: string | null; method: "TEXT_LAYER"; extractorVersion: string;
  parameterCodes: string[]; sourceFlags: string[]; evidenceFragments: Evidence[]; contextFragments: ContextEvidence[];
}
interface ReviewRef { decisionId: string; contentHash: string }
interface Source {
  objectId: string; sourceFileId: string; sourceSha256: string; stages: Stage[];
  revisionStatus: "UNKNOWN" | "CURRENT" | "SUPERSEDED";
  approvalStatus: "UNKNOWN" | "APPROVED" | "UNAPPROVED";
  sectionCode: string | null; linkGroupId: string | null; pageStages: Record<string, Stage>; reviewRef: ReviewRef;
}
interface Origin {
  target: MatrixFactScopeTarget; objectId: string; inputManifestHash: string; originalStages: Stage[];
  originalPageStages: Record<string, Stage>; artifact: Plain;
}
interface Side { fact: WallFact | null; origin: Origin; source: Source; binding: MatrixFactScopeBinding | null }
interface Pair { schemaVersion: "matrix-concrete-wall-pair-input-v1"; objectId: string; inputManifestHash: string; expected: Side; actual: Side }
export interface ConcreteWallPairDecision {
  ruleId: "matrix-kr-055-concrete_class"; ruleVersion: "1"; parameterCode: "KR-055";
  entityKey: string | null; comparisonVariant: "PD_RD"; executionStatus: "SUCCEEDED";
  machineStatus: "CANDIDATE" | "NEGATIVE_VERIFIED" | "MISSING_EVIDENCE" | "NOT_COMPARABLE" | "CLARIFICATION_REQUIRED";
  reasonCode: string; qualified: boolean; expectedObservationId: string | null; actualObservationId: string | null;
  expectedValue: string | null; actualValue: string | null; delta: string | null;
  wallScope: null | {
    policyVersion: "matrix-concrete-wall-reviewed-pair-v1"; entityKey: string; componentKey: string; zoneKey: string;
    floorKey: "-3" | "-2" | "-1" | "0" | "1";
    expectedTarget: MatrixFactScopeTarget; actualTarget: MatrixFactScopeTarget;
    expectedReview: ReviewRef; actualReview: ReviewRef;
  };
  confidence: { calibratedProbability: null; calibrationVersion: null; humanDecision: null };
  coverage: { parameterCode: "KR-055"; executionStatus: "PARTIAL"; successfulComparisons: 0 | 1;
    globalNoViolation: false; scopeCompleteUpgrade: false };
}

const RULE = "matrix-kr-055-concrete_class", UNIT = "B_CLASS", ATTRIBUTE = "CONCRETE_CLASS";
const BASIS = "CONCRETE_COMPRESSIVE_STRENGTH_CLASS";
const SHA = /^[a-f0-9]{64}(?![\s\S])/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/iu;
const STAGES: readonly string[] = ["PD", "RD", "ID", "UNRESOLVED"];
const WALL_FLOORS = ["-3", "-2", "-1", "0", "1"] as const;
const fail = (code: ConcreteWallScopeValidationCode): never => { throw new ConcreteWallScopeValidationError(code); };
const record = (value: unknown): value is Plain => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is Plain => record(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const positive = (value: unknown): value is number => integer(value) && value > 0;
const clean = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0
  && value.length <= max && value.trim() === value && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && SHA.test(value);
const same = (left: unknown, right: unknown): boolean => portableEvidenceJson(left) === portableEvidenceJson(right);
const detached = <T>(value: T): T => structuredClone(value);
const stageList = (value: unknown): value is Stage[] => Array.isArray(value) && value.length <= 4
  && value.every(stage => typeof stage === "string" && STAGES.includes(stage)) && new Set(value).size === value.length;
const pageStages = (value: unknown): value is Record<string, Stage> => record(value)
  && Object.entries(value).every(([page, stage]) => /^[1-9][0-9]*(?![\s\S])/u.test(page)
    && typeof stage === "string" && STAGES.includes(stage));
function target(value: unknown): value is MatrixFactScopeTarget {
  return exact(value, ["checkId", "executionContentHash", "observationId", "evidenceHash", "textArtifactHash"])
    && clean(value.checkId, 120) && [value.executionContentHash, value.observationId, value.evidenceHash, value.textArtifactHash].every(hash);
}
function normalized(value: unknown): value is NormalizedBox {
  if (!exact(value, ["x", "y", "width", "height"])) return false;
  const { x, y, width, height } = value;
  return typeof x === "number" && typeof y === "number" && typeof width === "number" && typeof height === "number"
    && x >= 0 && y >= 0 && width > 0 && height > 0 && width <= 1 && height <= 1
    && x + width <= 1.000001 && y + height <= 1.000001;
}
function fragment(value: unknown, context = false): boolean {
  return exact(value, context ? ["pageNumber", "blockId", "rawText", "bbox", "role"] : ["blockId", "rawText", "bbox"])
    && typeof value.blockId === "string" && value.blockId.length <= 40 && /^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)(?![\s\S])/u.test(value.blockId)
    && typeof value.rawText === "string" && value.rawText.length > 0 && [...value.rawText].length <= 100_000
    && normalized(value.bbox) && (!context || (positive(value.pageNumber) && value.pageNumber <= 512
      && typeof value.role === "string" && ["ATTRIBUTE_HEADER", "TABLE_SCOPE", "UNIT_DECLARATION", "MATERIAL_SCOPE"].includes(value.role)));
}
function fact(value: unknown): value is WallFact {
  return exact(value, ["id", "sourceFileId", "sourceSha256", "stage", "pageNumber", "blockId", "bbox", "rawText", "rawValue", "rawUnit",
    "attribute", "value", "unit", "entityKey", "method", "extractorVersion", "parameterCodes", "sourceFlags", "evidenceFragments", "contextFragments"])
    && hash(value.id) && clean(value.sourceFileId) && hash(value.sourceSha256) && typeof value.stage === "string" && STAGES.includes(value.stage)
    && positive(value.pageNumber) && value.pageNumber <= 512 && typeof value.blockId === "string" && value.blockId.length <= 40
    && /^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)(?![\s\S])/u.test(value.blockId) && normalized(value.bbox)
    && typeof value.rawText === "string" && value.rawText.length > 0 && [...value.rawText].length <= 100_000
    && [value.rawValue, value.rawUnit, value.attribute, value.value, value.unit, value.extractorVersion].every(item => clean(item, 1000))
    && (value.entityKey === null || clean(value.entityKey)) && value.method === "TEXT_LAYER"
    && Array.isArray(value.parameterCodes) && value.parameterCodes.length <= 132 && value.parameterCodes.every(item => clean(item, 40))
    && Array.isArray(value.sourceFlags) && value.sourceFlags.length <= 100 && value.sourceFlags.every(item => clean(item))
    && Array.isArray(value.evidenceFragments) && value.evidenceFragments.length > 0 && value.evidenceFragments.length <= 100
    && value.evidenceFragments.every(item => fragment(item)) && Array.isArray(value.contextFragments)
    && value.contextFragments.length > 0 && value.contextFragments.length <= 8 && value.contextFragments.every(item => fragment(item, true));
}
function source(value: unknown): value is Source {
  return exact(value, ["objectId", "sourceFileId", "sourceSha256", "stages", "revisionStatus", "approvalStatus", "sectionCode", "linkGroupId", "pageStages", "reviewRef"])
    && clean(value.objectId) && clean(value.sourceFileId) && hash(value.sourceSha256) && stageList(value.stages)
    && typeof value.revisionStatus === "string" && ["UNKNOWN", "CURRENT", "SUPERSEDED"].includes(value.revisionStatus)
    && typeof value.approvalStatus === "string" && ["UNKNOWN", "APPROVED", "UNAPPROVED"].includes(value.approvalStatus)
    && (value.sectionCode === null || (sourceSectionCodes as readonly unknown[]).includes(value.sectionCode))
    && (value.linkGroupId === null || clean(value.linkGroupId)) && pageStages(value.pageStages)
    && exact(value.reviewRef, ["decisionId", "contentHash"]) && typeof value.reviewRef.decisionId === "string"
    && UUID.test(value.reviewRef.decisionId) && hash(value.reviewRef.contentHash);
}
function side(value: unknown): value is Side {
  if (!exact(value, ["fact", "origin", "source", "binding"]) || !(value.fact === null || fact(value.fact)) || !source(value.source)
    || !exact(value.origin, ["target", "objectId", "inputManifestHash", "originalStages", "originalPageStages", "artifact"])
    || !target(value.origin.target) || !clean(value.origin.objectId) || !hash(value.origin.inputManifestHash)
    || !stageList(value.origin.originalStages) || !pageStages(value.origin.originalPageStages) || !record(value.origin.artifact)) return false;
  if (value.binding === null) return true;
  if (value.fact === null) return false;
  const decoded = matrixFactScopeBindingSchema.safeParse(value.binding);
  // Never use schema trimming as silent source/review normalization.
  return decoded.success && same(value.binding, decoded.data) && decoded.data.ruleId === RULE
    && decoded.data.ruleVersion === "1" && decoded.data.parameterCode === "KR-055";
}
function stageAt(stages: Stage[], overrides: Record<string, Stage>, page: number): Stage {
  return overrides[String(page)] ?? (stages.length === 1 ? stages[0] : "UNRESOLVED");
}
function allPagesInRange(stages: Record<string, Stage>, count: number): boolean {
  const limit = String(count);
  return Object.keys(stages).every(page => page.length < limit.length || (page.length === limit.length && page <= limit));
}

/** Entire retained original is validated before any selected/operational shortcut. No parsing discovery. */
function validateOrigin(pair: Pair, side: Side): void {
  const { source: current, origin } = side, artifact = origin.artifact;
  if (origin.objectId !== pair.objectId || current.objectId !== pair.objectId || origin.inputManifestHash !== pair.inputManifestHash
    || artifact.sourceFileId !== current.sourceFileId || artifact.inputSha256 !== current.sourceSha256) fail("SOURCE_PROVENANCE_UNVERIFIED");
  if (typeof artifact.pageCount === "number" && artifact.pageCount > 512) fail("INPUT_LIMIT");
  try {
    extractSourceDeclarations({ objectId: pair.objectId, inputManifestHash: pair.inputManifestHash,
      sources: [{ sourceFileId: current.sourceFileId, sha256: current.sourceSha256, stages: [] }], textArtifacts: [artifact] });
  } catch { fail("SOURCE_PROVENANCE_UNVERIFIED"); }
  if (!positive(artifact.pageCount) || !allPagesInRange(origin.originalPageStages, artifact.pageCount)
    || !allPagesInRange(current.pageStages, artifact.pageCount)) fail("SOURCE_PROVENANCE_UNVERIFIED");
  for (const page of artifact.pages as Plain[]) for (const block of page.blocks as Plain[]) {
    for (const line of (block.text as string).split("\n")) if ([...line].length > 100_000) fail("INPUT_LIMIT");
  }
  if (portableEvidenceHash(artifact) !== origin.target.textArtifactHash) fail("SOURCE_PROVENANCE_UNVERIFIED");
}
function nativeFragment(artifact: Plain, pageNumber: number, blockId: string): { evidence: Evidence; box: number[]; page: Plain } | null {
  const pages = artifact.pages as Plain[], page = pages[pageNumber - 1];
  if (!page || page.pageNumber !== pageNumber) return null;
  const [bi, li] = blockId.split(":").map(Number), block = (page.blocks as Plain[])[bi];
  if (!block || !Array.isArray(block.lineBboxesMilliPoints)) return null;
  const rawText = (block.text as string).split("\n")[li], b = block.lineBboxesMilliPoints[li];
  if (typeof rawText !== "string" || !Array.isArray(b)) return null;
  const w = page.widthMilliPoints as number, h = page.heightMilliPoints as number;
  return { evidence: { blockId, rawText, bbox: { x: b[0] / w, y: 1 - b[3] / h, width: (b[2] - b[0]) / w, height: (b[3] - b[1]) / h } }, box: b, page };
}
function reconstructFact(side: Side, expectedStage: "PD" | "RD"): void {
  const value = side.fact;
  if (value === null) return;
  const artifact = side.origin.artifact, at = (page: number) => stageAt(side.origin.originalStages, side.origin.originalPageStages, page);
  if (value.sourceFileId !== side.source.sourceFileId || value.sourceSha256 !== side.source.sourceSha256
    || value.stage !== expectedStage || value.stage !== at(value.pageNumber) || value.attribute !== ATTRIBUTE || value.unit !== UNIT
    || value.rawUnit !== UNIT || !same(value.parameterCodes, ["KR-055"]) || value.value !== value.rawValue
    || !/^[BВ][1-9][0-9]{0,2}(?:[.,][0-9])?(?![\s\S])/u.test(value.value)) fail("SOURCE_PROVENANCE_UNVERIFIED");
  const evidence = value.evidenceFragments.map(part => nativeFragment(artifact, value.pageNumber, part.blockId));
  if (evidence.some(part => !part) || !same(value.evidenceFragments, evidence.map(part => part!.evidence))
    || value.blockId !== value.evidenceFragments[0].blockId
    || value.rawText !== value.evidenceFragments.map(part => part.rawText).join(" ")) fail("SOURCE_PROVENANCE_UNVERIFIED");
  for (const part of value.contextFragments) {
    const original = nativeFragment(artifact, part.pageNumber, part.blockId);
    if (!original || at(part.pageNumber) !== expectedStage
      || !same({ blockId: part.blockId, rawText: part.rawText, bbox: part.bbox }, original.evidence)) fail("SOURCE_PROVENANCE_UNVERIFIED");
  }
  const page = (artifact.pages as Plain[])[value.pageNumber - 1], boxes = evidence.map(part => part!.box);
  const w = page.widthMilliPoints as number, h = page.heightMilliPoints as number;
  const union = { x: Math.min(...boxes.map(b => b[0])) / w, y: 1 - Math.max(...boxes.map(b => b[3])) / h,
    width: (Math.max(...boxes.map(b => b[2])) - Math.min(...boxes.map(b => b[0]))) / w,
    height: (Math.max(...boxes.map(b => b[3])) - Math.min(...boxes.map(b => b[1]))) / h };
  if (!same(value.bbox, union)) fail("SOURCE_PROVENANCE_UNVERIFIED");
  const preimage = { sourceFileId: value.sourceFileId, sourceSha256: value.sourceSha256, stage: value.stage,
    pageNumber: value.pageNumber, blockIds: value.evidenceFragments.map(part => part.blockId), attribute: value.attribute,
    value: value.value, unit: value.unit, contextFragments: value.contextFragments };
  let id: string;
  if (expectedStage === "PD") {
    if (value.extractorVersion !== "matrix-text-facts-v1" || !value.sourceFlags.includes("TABLE_CONTEXT_UNVERIFIED")
      || value.pageNumber !== 50 || !same(value.evidenceFragments.map(part => part.blockId), ["1:2", "2:2"])
      || value.evidenceFragments[0].rawText !== "стены -3го по +1"
      || !same(value.contextFragments.map(part => [part.pageNumber, part.blockId, part.role]),
        [[49, "10:0", "ATTRIBUTE_HEADER"], [49, "10:1", "ATTRIBUTE_HEADER"], [50, "0:0", "TABLE_SCOPE"]])
      || !validConcreteTableContext(value as unknown as MatrixObservation, artifact, at)) fail("SOURCE_PROVENANCE_UNVERIFIED");
    id = sha256(canonicalJson(preimage));
  } else {
    if (value.extractorVersion !== CONCRETE_WALL_EXTRACTOR_VERSION || !value.sourceFlags.includes("CONCRETE_WALL_SCOPE_UNVERIFIED")) fail("SOURCE_PROVENANCE_UNVERIFIED");
    const candidates = extractConcreteWallCandidatesV1(page, "RD");
    if (candidates.length !== 1) fail("SOURCE_PROVENANCE_UNVERIFIED");
    const candidate = candidates[0];
    const part = (item: ConcreteWallFragment): Evidence => nativeFragment(artifact, item.pageNumber, `${item.blockIndex}:${item.lineIndex}`)!.evidence;
    if (candidate.value !== value.value || !same(value.evidenceFragments, candidate.primaryFragments.map(part))
      || !same(value.contextFragments, candidate.contextFragments.map(item => ({ pageNumber: item.pageNumber, ...part(item), role: item.role })))) fail("SOURCE_PROVENANCE_UNVERIFIED");
    id = portableEvidenceHash({ schemaVersion: "matrix-concrete-wall-observation-v1", ...preimage, extractorVersion: value.extractorVersion });
  }
  const selector = { schemaVersion: "matrix-fact-selector-v1", sourceFileId: value.sourceFileId,
    sourceSha256: value.sourceSha256, stage: value.stage, pageNumber: value.pageNumber, blockId: value.blockId,
    attribute: value.attribute, value: value.value, unit: value.unit, rawValue: value.rawValue, rawUnit: value.rawUnit,
    rawText: value.rawText, method: value.method, extractorVersion: value.extractorVersion, bbox: value.bbox,
    evidenceFragments: value.evidenceFragments, contextFragments: value.contextFragments, textArtifactHash: side.origin.target.textArtifactHash };
  if (value.id !== id || side.origin.target.observationId !== id || side.origin.target.evidenceHash !== portableEvidenceHash(selector)) fail("SOURCE_PROVENANCE_UNVERIFIED");
}
function operationalReason(side: Side, stage: "PD" | "RD"): string | null {
  const { source, fact } = side;
  const pages = [fact!.pageNumber, ...fact!.contextFragments.map(part => part.pageNumber)];
  if (pages.some(page => stageAt(source.stages, source.pageStages, page) !== stage)) return "SOURCE_STAGE_UNVERIFIED";
  if (source.revisionStatus === "UNKNOWN") return "SOURCE_REVISION_UNRESOLVED";
  if (source.revisionStatus === "SUPERSEDED") return "SOURCE_REVISION_SUPERSEDED";
  if (source.approvalStatus === "UNKNOWN") return "SOURCE_APPROVAL_UNRESOLVED";
  if (source.approvalStatus === "UNAPPROVED") return "SOURCE_UNAPPROVED";
  if (!(stage === "PD" ? ["KR"] : ["KJ", "KR"]).includes(source.sectionCode ?? "")) return "SOURCE_SECTION_UNVERIFIED";
  return null;
}
function closedContext(value: unknown, keys: string[]): value is Plain {
  return exact(value, keys) && clean(value.reference, 1000) && (value.reference as string).length >= 8;
}

/** Pure integrity and scoped comparison. It never authenticates a reviewer or grants global KR-055 clearance. */
export function evaluateConcreteWallPairV1(raw: unknown): ConcreteWallPairDecision {
  const native = concreteWallNativeV1(raw);
  if (native) fail(native);
  if (!exact(raw, ["schemaVersion", "objectId", "inputManifestHash", "expected", "actual"])
    || raw.schemaVersion !== "matrix-concrete-wall-pair-input-v1" || !clean(raw.objectId) || !hash(raw.inputManifestHash)
    || !side(raw.expected) || !side(raw.actual)) fail("INVALID_INPUT");
  const pair = raw as unknown as Pair, { expected, actual } = pair;
  // Whole retained origins before selected source eligibility, including a missing counterpart.
  validateOrigin(pair, expected); validateOrigin(pair, actual);
  if (expected.source.sourceFileId === actual.source.sourceFileId || expected.source.sourceSha256 === actual.source.sourceSha256) fail("SOURCE_PROVENANCE_UNVERIFIED");
  reconstructFact(expected, "PD"); reconstructFact(actual, "RD");
  for (const current of [expected, actual]) if (current.binding !== null && !same(current.binding.target, current.origin.target)) fail("TARGET_UNVERIFIED");
  const result = (reasonCode: string, machineStatus: ConcreteWallPairDecision["machineStatus"] = "CLARIFICATION_REQUIRED"): ConcreteWallPairDecision => ({
    ruleId: RULE, ruleVersion: "1", parameterCode: "KR-055",
    entityKey: expected.fact && actual.fact ? expected.binding?.entityKey ?? actual.binding?.entityKey ?? null : null,
    comparisonVariant: "PD_RD", executionStatus: "SUCCEEDED", machineStatus, reasonCode, qualified: false,
    expectedObservationId: expected.fact?.id ?? null, actualObservationId: actual.fact?.id ?? null,
    expectedValue: expected.fact?.value ?? null, actualValue: actual.fact?.value ?? null, delta: null, wallScope: null,
    confidence: { calibratedProbability: null, calibrationVersion: null, humanDecision: null },
    coverage: { parameterCode: "KR-055", executionStatus: "PARTIAL", successfulComparisons: 0, globalNoViolation: false, scopeCompleteUpgrade: false },
  });
  if (!expected.fact || !actual.fact) return result("REQUIRED_FACT_MISSING", "MISSING_EVIDENCE");
  for (const [current, stage] of [[expected, "PD"], [actual, "RD"]] as const) {
    const reason = operationalReason(current, stage); if (reason) return result(reason);
  }
  if (!expected.source.linkGroupId || expected.source.linkGroupId !== actual.source.linkGroupId) return result("LINK_GROUP_MISMATCH");
  const eb = expected.binding, ab = actual.binding;
  if (!eb || !ab || eb.entityKey !== ab.entityKey) return result("CONTEXT_UNVERIFIED:ELEMENT_IDENTITY");
  const ei = eb.contexts.ELEMENT_IDENTITY, ai = ab.contexts.ELEMENT_IDENTITY;
  const identityKeys = ["reference", "componentRole", "componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey"];
  const identity = (value: unknown): value is Plain => closedContext(value, identityKeys)
    && value.componentRole === "MONOLITHIC_LOAD_BEARING_WALL" && clean(value.componentKey) && clean(value.zoneKey)
    && value.operatingModeKey === "CAST_IN_PLACE_LOAD_BEARING_WALL" && value.measurementBasisKey === BASIS;
  if (!identity(ei) || !identity(ai) || ei.componentKey !== ai.componentKey || ei.zoneKey !== ai.zoneKey) return result("CONTEXT_UNVERIFIED:ELEMENT_IDENTITY");
  const material = (value: unknown): boolean => closedContext(value, ["reference", "attribute", "canonicalUnit", "measurementBasisKey"])
    && value.attribute === ATTRIBUTE && value.canonicalUnit === UNIT && value.measurementBasisKey === BASIS;
  if (!material(eb.contexts.MATERIAL_CLASS_BASIS) || !material(ab.contexts.MATERIAL_CLASS_BASIS)) return result("CONTEXT_UNVERIFIED:MATERIAL_CLASS_BASIS");
  const ef = eb.contexts.CONCRETE_WALL_FLOOR_SCOPE_V1, af = ab.contexts.CONCRETE_WALL_FLOOR_SCOPE_V1;
  const floor = (value: unknown): value is Plain => closedContext(value, ["reference", "componentRole", "componentKey", "zoneKey", "measurementBasisKey"])
    && value.componentRole === "EXACT_STOREY" && (WALL_FLOORS as readonly unknown[]).includes(value.componentKey)
    && value.zoneKey === ei.zoneKey && value.measurementBasisKey === "EXACT_COMMON_STOREY";
  if (!floor(ef) || !floor(af) || ef.componentKey !== af.componentKey) return result("CONTEXT_UNVERIFIED:CONCRETE_WALL_FLOOR_SCOPE_V1");
  for (const current of [expected, actual]) {
    const review = current.binding!.tableContextReview;
    const relevantPages = [current.fact!.pageNumber, ...current.fact!.contextFragments.map(part => part.pageNumber)];
    if (!review || review.fragmentsHash !== portableEvidenceHash(current.fact!.contextFragments)
      || relevantPages.some(number => (((current.origin.artifact.pages as Plain[])[number - 1].quality as Plain).disposition !== "TEXT_LAYER_CANDIDATE"))) return result("TEXT_OR_STAGE_QUALITY_UNVERIFIED");
  }
  // The grammar permits at most one fractional decimal digit, so integer tenths are exact.
  const tenths = (value: string) => { const [whole, decimal = "0"] = value.slice(1).replace(",", ".").split("."); return BigInt(whole) * 10n + BigInt(decimal); };
  const difference = tenths(actual.fact.value) - tenths(expected.fact.value), absolute = difference < 0n ? -difference : difference;
  const delta = `${difference < 0n ? "-" : ""}${absolute / 10n}${absolute % 10n ? `.${absolute % 10n}` : ""}`;
  const decision = result(difference < 0n ? "CONCRETE_WALL_SCOPED_DECREASE_V1" : "CONCRETE_WALL_SCOPED_NO_DECREASE_V1",
    difference < 0n ? "CANDIDATE" : "NEGATIVE_VERIFIED");
  decision.qualified = true; decision.delta = delta; decision.coverage.successfulComparisons = 1;
  decision.wallScope = { policyVersion: "matrix-concrete-wall-reviewed-pair-v1", entityKey: eb.entityKey,
    componentKey: ei.componentKey as string, zoneKey: ei.zoneKey as string, floorKey: ef.componentKey as NonNullable<ConcreteWallPairDecision["wallScope"]>["floorKey"],
    expectedTarget: detached(expected.origin.target), actualTarget: detached(actual.origin.target),
    expectedReview: detached(expected.source.reviewRef), actualReview: detached(actual.source.reviewRef) };
  return decision;
}


// Own output-only v13 adapter footer. The complete strict scope source above
// remains byte-exact. This entry never invokes the public8M pure comparator.
import { assertConcreteWallLeaseNativeV13, sha256PortableEvidenceNativeV13 } from "./matrix-concrete-wall-native-v13.js";

function validateOriginNativeV13(pair: Pair, side: Side): void {
  const { source: current, origin } = side, artifact = origin.artifact;
  if (origin.objectId !== pair.objectId || current.objectId !== pair.objectId || origin.inputManifestHash !== pair.inputManifestHash
    || artifact.sourceFileId !== current.sourceFileId || artifact.inputSha256 !== current.sourceSha256) fail("SOURCE_PROVENANCE_UNVERIFIED");
  if (typeof artifact.pageCount === "number" && artifact.pageCount > 512) fail("INPUT_LIMIT");
  try {
    extractSourceDeclarations({ objectId: pair.objectId, inputManifestHash: pair.inputManifestHash,
      sources: [{ sourceFileId: current.sourceFileId, sha256: current.sourceSha256, stages: [] }], textArtifacts: [artifact] });
  } catch { fail("SOURCE_PROVENANCE_UNVERIFIED"); }
  if (!positive(artifact.pageCount) || !allPagesInRange(origin.originalPageStages, artifact.pageCount)
    || !allPagesInRange(current.pageStages, artifact.pageCount)) fail("SOURCE_PROVENANCE_UNVERIFIED");
  for (const page of artifact.pages as Plain[]) for (const block of page.blocks as Plain[]) {
    for (const line of (block.text as string).split("\n")) if ([...line].length > 100_000) fail("INPUT_LIMIT");
  }
  if (sha256PortableEvidenceNativeV13(artifact) !== origin.target.textArtifactHash) fail("SOURCE_PROVENANCE_UNVERIFIED");
}

/** Native/closed shape first, then genuine retained original reconstruction.
 * Selected operational stage, row projection and eligibility are not called.
 * This function provides no persisted review/PDF-byte/server authority.
 */
export function validateConcreteWallRetainedOriginalSideV13(raw: unknown, stage: "PD" | "RD"): void {
  assertConcreteWallLeaseNativeV13(raw);
  if (!exact(raw, ["schemaVersion", "objectId", "inputManifestHash", "expected", "actual"])
    || raw.schemaVersion !== "matrix-concrete-wall-pair-input-v1" || !clean(raw.objectId) || !hash(raw.inputManifestHash)
    || !side(raw.expected) || !side(raw.actual)) fail("INVALID_INPUT");
  if (stage !== "PD" && stage !== "RD") fail("INVALID_INPUT");
  const pair = raw as unknown as Pair;
  const selected = stage === "PD" ? pair.expected : pair.actual;
  try {
    validateOriginNativeV13(pair, selected);
    reconstructFact(selected, stage);
  } catch (error) {
    if (error instanceof ConcreteWallScopeValidationError) fail("TARGET_UNVERIFIED");
    throw error;
  }
}


/** Full fixed64MiB sibling entry. Original public8MiB function above is unchanged. */
export function evaluateConcreteWallRetainedPairV13(raw: unknown): ConcreteWallPairDecision {
  assertConcreteWallLeaseNativeV13(raw);
  if (!exact(raw, ["schemaVersion", "objectId", "inputManifestHash", "expected", "actual"])
    || raw.schemaVersion !== "matrix-concrete-wall-pair-input-v1" || !clean(raw.objectId) || !hash(raw.inputManifestHash)
    || !side(raw.expected) || !side(raw.actual)) fail("INVALID_INPUT");
  const pair = raw as unknown as Pair, { expected, actual } = pair;
  // Whole retained origins before selected source eligibility, including a missing counterpart.
  validateOriginNativeV13(pair, expected); validateOriginNativeV13(pair, actual);
  if (expected.source.sourceFileId === actual.source.sourceFileId || expected.source.sourceSha256 === actual.source.sourceSha256) fail("SOURCE_PROVENANCE_UNVERIFIED");
  reconstructFact(expected, "PD"); reconstructFact(actual, "RD");
  for (const current of [expected, actual]) if (current.binding !== null && !same(current.binding.target, current.origin.target)) fail("TARGET_UNVERIFIED");
  const result = (reasonCode: string, machineStatus: ConcreteWallPairDecision["machineStatus"] = "CLARIFICATION_REQUIRED"): ConcreteWallPairDecision => ({
    ruleId: RULE, ruleVersion: "1", parameterCode: "KR-055",
    entityKey: expected.fact && actual.fact ? expected.binding?.entityKey ?? actual.binding?.entityKey ?? null : null,
    comparisonVariant: "PD_RD", executionStatus: "SUCCEEDED", machineStatus, reasonCode, qualified: false,
    expectedObservationId: expected.fact?.id ?? null, actualObservationId: actual.fact?.id ?? null,
    expectedValue: expected.fact?.value ?? null, actualValue: actual.fact?.value ?? null, delta: null, wallScope: null,
    confidence: { calibratedProbability: null, calibrationVersion: null, humanDecision: null },
    coverage: { parameterCode: "KR-055", executionStatus: "PARTIAL", successfulComparisons: 0, globalNoViolation: false, scopeCompleteUpgrade: false },
  });
  if (!expected.fact || !actual.fact) return result("REQUIRED_FACT_MISSING", "MISSING_EVIDENCE");
  for (const [current, stage] of [[expected, "PD"], [actual, "RD"]] as const) {
    const reason = operationalReason(current, stage); if (reason) return result(reason);
  }
  if (!expected.source.linkGroupId || expected.source.linkGroupId !== actual.source.linkGroupId) return result("LINK_GROUP_MISMATCH");
  const eb = expected.binding, ab = actual.binding;
  if (!eb || !ab || eb.entityKey !== ab.entityKey) return result("CONTEXT_UNVERIFIED:ELEMENT_IDENTITY");
  const ei = eb.contexts.ELEMENT_IDENTITY, ai = ab.contexts.ELEMENT_IDENTITY;
  const identityKeys = ["reference", "componentRole", "componentKey", "zoneKey", "operatingModeKey", "measurementBasisKey"];
  const identity = (value: unknown): value is Plain => closedContext(value, identityKeys)
    && value.componentRole === "MONOLITHIC_LOAD_BEARING_WALL" && clean(value.componentKey) && clean(value.zoneKey)
    && value.operatingModeKey === "CAST_IN_PLACE_LOAD_BEARING_WALL" && value.measurementBasisKey === BASIS;
  if (!identity(ei) || !identity(ai) || ei.componentKey !== ai.componentKey || ei.zoneKey !== ai.zoneKey) return result("CONTEXT_UNVERIFIED:ELEMENT_IDENTITY");
  const material = (value: unknown): boolean => closedContext(value, ["reference", "attribute", "canonicalUnit", "measurementBasisKey"])
    && value.attribute === ATTRIBUTE && value.canonicalUnit === UNIT && value.measurementBasisKey === BASIS;
  if (!material(eb.contexts.MATERIAL_CLASS_BASIS) || !material(ab.contexts.MATERIAL_CLASS_BASIS)) return result("CONTEXT_UNVERIFIED:MATERIAL_CLASS_BASIS");
  const ef = eb.contexts.CONCRETE_WALL_FLOOR_SCOPE_V1, af = ab.contexts.CONCRETE_WALL_FLOOR_SCOPE_V1;
  const floor = (value: unknown): value is Plain => closedContext(value, ["reference", "componentRole", "componentKey", "zoneKey", "measurementBasisKey"])
    && value.componentRole === "EXACT_STOREY" && (WALL_FLOORS as readonly unknown[]).includes(value.componentKey)
    && value.zoneKey === ei.zoneKey && value.measurementBasisKey === "EXACT_COMMON_STOREY";
  if (!floor(ef) || !floor(af) || ef.componentKey !== af.componentKey) return result("CONTEXT_UNVERIFIED:CONCRETE_WALL_FLOOR_SCOPE_V1");
  for (const current of [expected, actual]) {
    const review = current.binding!.tableContextReview;
    const relevantPages = [current.fact!.pageNumber, ...current.fact!.contextFragments.map(part => part.pageNumber)];
    if (!review || review.fragmentsHash !== portableEvidenceHash(current.fact!.contextFragments)
      || relevantPages.some(number => (((current.origin.artifact.pages as Plain[])[number - 1].quality as Plain).disposition !== "TEXT_LAYER_CANDIDATE"))) return result("TEXT_OR_STAGE_QUALITY_UNVERIFIED");
  }
  // The grammar permits at most one fractional decimal digit, so integer tenths are exact.
  const tenths = (value: string) => { const [whole, decimal = "0"] = value.slice(1).replace(",", ".").split("."); return BigInt(whole) * 10n + BigInt(decimal); };
  const difference = tenths(actual.fact.value) - tenths(expected.fact.value), absolute = difference < 0n ? -difference : difference;
  const delta = `${difference < 0n ? "-" : ""}${absolute / 10n}${absolute % 10n ? `.${absolute % 10n}` : ""}`;
  const decision = result(difference < 0n ? "CONCRETE_WALL_SCOPED_DECREASE_V1" : "CONCRETE_WALL_SCOPED_NO_DECREASE_V1",
    difference < 0n ? "CANDIDATE" : "NEGATIVE_VERIFIED");
  decision.qualified = true; decision.delta = delta; decision.coverage.successfulComparisons = 1;
  decision.wallScope = { policyVersion: "matrix-concrete-wall-reviewed-pair-v1", entityKey: eb.entityKey,
    componentKey: ei.componentKey as string, zoneKey: ei.zoneKey as string, floorKey: ef.componentKey as NonNullable<ConcreteWallPairDecision["wallScope"]>["floorKey"],
    expectedTarget: detached(expected.origin.target), actualTarget: detached(actual.origin.target),
    expectedReview: detached(expected.source.reviewRef), actualReview: detached(actual.source.reviewRef) };
  return decision;
}

