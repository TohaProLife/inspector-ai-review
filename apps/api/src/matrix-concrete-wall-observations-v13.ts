/** OUTPUT ONLY. Genuine source reconstruction, never persisted reviewer/PDF authority. */
import type { MatrixAtomicResult, MatrixObservation, MatrixFactScopeBinding } from "@inspector-ai/contracts";
import { matrixFactScopeBindingSchema } from "@inspector-ai/contracts";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { portableEvidenceHash } from "./matrix-fact-scope.js";
import { extractSourceDeclarations } from "./matrix-source-declarations.js";
import { validConcreteTableContext } from "./matrix-table-context.js";
import { CONCRETE_WALL_EXTRACTOR_VERSION, extractConcreteWallCandidatesV1 } from "./matrix-concrete-wall-prose-v1.js";
import { assertConcreteWallLeaseNativeV13 } from "./matrix-concrete-wall-native-v13.js";
import { validateConcreteWallWindowV13, isConcreteWallClaimV13,
  sameConcreteWallV13 as same, plainConcreteWallV13 as plain, failConcreteWallV13 as fail } from "./matrix-concrete-wall-window-v13.js";
import { validateConcreteWallRetainedOriginalSideV13, evaluateConcreteWallRetainedPairV13 } from "./matrix-concrete-wall-retained-pair-v13.js";
import { mergeConcreteWallAtomicV13 } from "./matrix-concrete-wall-projection-v13.js";
import type { MatrixRuleVerificationSource } from "./matrix-rule-verifier-v13.js";

type Plain = Record<string, unknown>;
type Box = { x: number; y: number; width: number; height: number };
type Stage = "PD" | "RD" | "ID" | "UNRESOLVED";
export interface MatrixConcreteWallV13Input { window: unknown; textArtifacts: unknown }
export interface ConcreteWallRetainedSideV13 { stage: "PD" | "RD"; side: Plain }
export interface ConcreteWallPreparedV13 {
  window: Plain; sources: MatrixRuleVerificationSource[]; walls: MatrixObservation[];
  retained: ConcreteWallRetainedSideV13[];
}
const RULE = "matrix-kr-055-concrete_class";
const ANCHOR = /класс бетона по прочности на сжатие для стен/iu;
const IDENTITY = ["id", "sourceFileId", "sourceSha256", "stage", "pageNumber", "blockId", "bbox", "rawText",
  "rawValue", "rawUnit", "attribute", "value", "unit", "method", "extractorVersion", "evidenceFragments", "contextFragments"] as const;
const stageAt = (stages: string[], pages: Plain, page: number): Stage =>
  (stages.length === 1 ? stages[0] : pages[String(page)] ?? "UNRESOLVED") as Stage;
const pagesInRange = (pages: Plain, count: number): boolean => Object.keys(pages).every(key =>
  key.length < String(count).length || (key.length === String(count).length && key <= String(count)));
function normalized(box: number[], page: Plain): Box {
  const w = page.widthMilliPoints as number, h = page.heightMilliPoints as number;
  return { x: box[0] / w, y: 1 - box[3] / h, width: (box[2] - box[0]) / w, height: (box[3] - box[1]) / h };
}
function fragment(artifact: Plain, number: number, id: string): Plain | null {
  const page = (artifact.pages as Plain[])[number - 1];
  if (!page || page.pageNumber !== number) return null;
  const [bi, li] = id.split(":").map(Number), block = (page.blocks as Plain[])[bi];
  if (!block || !Array.isArray(block.lineBboxesMilliPoints) || !Array.isArray(block.lineBboxesMilliPoints[li])) return null;
  const rawText = (block.text as string).split("\n")[li];
  return typeof rawText === "string" ? { blockId: id, rawText, bbox: normalized(block.lineBboxesMilliPoints[li] as number[], page) } : null;
}
function sourceFlags(source: MatrixRuleVerificationSource, page: Plain, stage: string, marker: string): string[] {
  const flags = [marker], review = source.review;
  if (review?.revisionStatus !== "CURRENT") flags.push(`SOURCE_REVISION_${review?.revisionStatus ?? "UNKNOWN"}`);
  if (review?.approvalStatus !== "APPROVED") flags.push(`SOURCE_APPROVAL_${review?.approvalStatus ?? "UNKNOWN"}`);
  if (stage === "UNRESOLVED") flags.push("SOURCE_STAGE_UNRESOLVED");
  if ((page.quality as Plain).disposition !== "TEXT_LAYER_CANDIDATE") flags.push("PAGE_TEXT_REQUIRES_OCR");
  return [...new Set(flags)].sort();
}
function makeFact(source: MatrixRuleVerificationSource, page: Plain, stage: "PD" | "RD", primary: Plain[], contexts: Plain[], value: string, box: Box, wall: boolean): MatrixObservation {
  const identity = { sourceFileId: source.sourceFileId, sourceSha256: source.sha256, stage,
    pageNumber: page.pageNumber, blockIds: primary.map(part => part.blockId), attribute: "CONCRETE_CLASS", value, unit: "B_CLASS", contextFragments: contexts };
  const extractorVersion = wall ? CONCRETE_WALL_EXTRACTOR_VERSION : "matrix-text-facts-v1";
  return { id: wall ? portableEvidenceHash({ schemaVersion: "matrix-concrete-wall-observation-v1", ...identity, extractorVersion }) : sha256(canonicalJson(identity)),
    sourceFileId: source.sourceFileId, sourceSha256: source.sha256, stage, pageNumber: page.pageNumber as number,
    blockId: primary[0].blockId as string, bbox: box, rawText: primary.map(part => part.rawText).join(" "),
    rawValue: value, rawUnit: "B_CLASS", attribute: "CONCRETE_CLASS", value, unit: "B_CLASS", entityKey: null,
    method: "TEXT_LAYER", extractorVersion, parameterCodes: ["KR-055"],
    sourceFlags: sourceFlags(source, page, stage, wall ? "CONCRETE_WALL_SCOPE_UNVERIFIED" : "TABLE_CONTEXT_UNVERIFIED"),
    evidenceFragments: primary, contextFragments: contexts as unknown as NonNullable<MatrixObservation["contextFragments"]> };
}
function wallFacts(source: MatrixRuleVerificationSource, artifact: Plain, stages: string[], overrides: Plain): MatrixObservation[] {
  const result: MatrixObservation[] = [];
  for (const page of artifact.pages as Plain[]) {
    const stage = stageAt(stages, overrides, page.pageNumber as number);
    if (stage !== "RD") continue;
    for (const candidate of extractConcreteWallCandidatesV1(page, stage)) {
      const primary = candidate.primaryFragments.map(part => fragment(artifact, part.pageNumber, `${part.blockIndex}:${part.lineIndex}`));
      const context = candidate.contextFragments.map(part => ({ pageNumber: part.pageNumber,
        ...fragment(artifact, part.pageNumber, `${part.blockIndex}:${part.lineIndex}`)!, role: part.role }));
      if (primary.some(part => part === null)) fail("TARGET_UNVERIFIED");
      result.push(makeFact(source, page, "RD", primary as Plain[], context, candidate.value, primary[0]!.bbox as Box, true));
    }
  }
  return result;
}
/** Frozen retained PD selector only; never arbitrary nearby B-values. */
function pdOriginal(source: MatrixRuleVerificationSource, artifact: Plain, origin: Plain): MatrixObservation[] {
  const page = (artifact.pages as Plain[])[49], headerPage = (artifact.pages as Plain[])[48];
  if (!page || !headerPage || stageAt(origin.originalStages as string[], origin.originalPageStages as Plain, 50) !== "PD"
    || stageAt(origin.originalStages as string[], origin.originalPageStages as Plain, 49) !== "PD") return [];
  const primary = [fragment(artifact, 50, "1:2"), fragment(artifact, 50, "2:2")];
  const hs = [fragment(artifact, 49, "10:0"), fragment(artifact, 49, "10:1")], scope = fragment(artifact, 50, "0:0");
  if (primary.some(p => !p) || hs.some(p => !p) || !scope || primary[0]!.rawText !== "стены -3го по +1") return [];
  const value = String(primary[1]!.rawText).replace(/\s+/gu, " ").trim();
  const match = /^([BВ][1-9][0-9]{0,2}(?:[.,][0-9])?)\s*[.;]?$/u.exec(value);
  if (!match) return [];
  const contexts = [...hs.map(part => ({ pageNumber: 49, ...part!, role: "ATTRIBUTE_HEADER" })), { pageNumber: 50, ...scope, role: "TABLE_SCOPE" }];
  const boxes = [((page.blocks as Plain[])[1].lineBboxesMilliPoints as number[][])[2], ((page.blocks as Plain[])[2].lineBboxesMilliPoints as number[][])[2]];
  const union = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
  const fact = makeFact(source, page, "PD", primary as Plain[], contexts, match[1], normalized(union, page), false);
  return validConcreteTableContext(fact, artifact, n => stageAt(origin.originalStages as string[], origin.originalPageStages as Plain, n)) ? [fact] : [];
}
export function isReservedConcreteWallObservationV13(fact: Plain): boolean {
  return fact.extractorVersion === CONCRETE_WALL_EXTRACTOR_VERSION
    || (fact.attribute === "CONCRETE_CLASS" && typeof fact.rawText === "string" && ANCHOR.test(fact.rawText));
}
export function concreteWallObservationOrderV13(a: MatrixObservation, b: MatrixObservation): number {
  const compare = (x: string, y: string) => Buffer.compare(Buffer.from(x, "utf8"), Buffer.from(y, "utf8"));
  return compare(a.sourceFileId, b.sourceFileId) || a.pageNumber - b.pageNumber || compare(a.blockId, b.blockId)
    || compare(a.attribute, b.attribute) || compare(a.id, b.id);
}
/** Full raw artifacts/originals first. Returned data is never external authority. */
export function prepareConcreteWallObservationsV13(input: MatrixConcreteWallV13Input): ConcreteWallPreparedV13 {
  assertConcreteWallLeaseNativeV13(input);
  if (!plain(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, "window") || !Object.hasOwn(input, "textArtifacts")) fail();
  const window = validateConcreteWallWindowV13(input.window), inputs = window.inputs as Plain;
  if (!Array.isArray(input.textArtifacts)) fail();
  const files = inputs.sourceFiles as Plain[], decisions = inputs.sourceDecisions as Plain, records = (inputs.concreteWallOriginsV1 as Plain).records as Plain[];
  const byArtifact = new Map<string, Plain>();
  try {
    extractSourceDeclarations({ objectId: window.objectId as string, inputManifestHash: window.inputManifestHash as string,
      sources: files.map(source => ({ sourceFileId: source.sourceFileId, sha256: source.sha256, stages: [] })), textArtifacts: input.textArtifacts });
  } catch { fail("SOURCE_PROVENANCE_UNVERIFIED"); }
  for (const artifact of input.textArtifacts) {
    if (!plain(artifact) || typeof artifact.sourceFileId !== "string" || typeof artifact.pageCount !== "number" || artifact.pageCount > 512 || byArtifact.has(artifact.sourceFileId)) fail("SOURCE_PROVENANCE_UNVERIFIED");
    const source = files.find(file => file.sourceFileId === artifact.sourceFileId);
    if (!source || source.mediaType !== "application/pdf" || source.sha256 !== artifact.inputSha256) fail("SOURCE_PROVENANCE_UNVERIFIED");
    const decision = decisions[artifact.sourceFileId] as Plain | undefined;
    if (decision && !pagesInRange(decision.pageStages as Plain, artifact.pageCount)) fail("SOURCE_PROVENANCE_UNVERIFIED");
    for (const page of artifact.pages as Plain[]) for (const block of page.blocks as Plain[]) {
      if ((block.text as string).split("\n").some(line => [...line].length > 100_000)) fail("INPUT_LIMIT");
    }
    byArtifact.set(artifact.sourceFileId, artifact);
  }
  if (files.filter(file => file.mediaType === "application/pdf").length !== byArtifact.size) fail("SOURCE_PROVENANCE_UNVERIFIED");
  const sources: MatrixRuleVerificationSource[] = files.map(file => {
    const decision = decisions[file.sourceFileId as string] as Plain | undefined;
    const review = { revisionStatus: (decision?.revisionStatus ?? "UNKNOWN") as string, approvalStatus: (decision?.approvalStatus ?? "UNKNOWN") as string,
      linkGroupId: (decision?.linkGroupId ?? null) as string | null, pageStages: (decision?.pageStages ?? {}) as Record<string, string>,
      sectionCode: (decision ? decision.sectionCode : file.sectionCode) as string | null, scopeProofs: (decision?.scopeProofs ?? {}) as Plain };
    return { sourceFileId: file.sourceFileId as string, sha256: file.sha256 as string, stages: file.stages as string[], objectId: window.objectId as string,
      ...review, review, textArtifact: byArtifact.get(file.sourceFileId as string) ?? null };
  });
  // Preserve inherited scalar source semantics, independently from the wider lexical transport.
  for (const source of sources) for (const stage of Object.values(source.review!.pageStages!)) {
    if (!source.stages.includes(stage) && stage !== "UNRESOLVED") throw new Error("Invalid source");
  }
  const walls = sources.flatMap(source => source.textArtifact ? wallFacts(source, source.textArtifact, source.stages, source.review!.pageStages!) : []);
  const retained: ConcreteWallRetainedSideV13[] = [];
  const bindings: Array<{ sourceId: string; binding: Plain }> = [];
  for (const [sourceId, decision] of Object.entries(decisions)) {
    const proof = ((decision as Plain).scopeProofs as Plain).FACT_BINDINGS as Plain | undefined;
    if (proof) for (const binding of proof.bindings as Plain[]) bindings.push({ sourceId, binding });
  }
  for (const record of records) {
    const source = sources.find(source => source.sourceFileId === record.sourceFileId)!, artifact = byArtifact.get(source.sourceFileId);
    const decision = decisions[source.sourceFileId] as Plain | undefined;
    const matching = bindings.filter(item => item.sourceId === source.sourceFileId && same(item.binding.target, record.target));
    if (!artifact || !decision || matching.length !== 1 || !pagesInRange(record.originalPageStages as Plain, artifact.pageCount as number)) fail("TARGET_UNVERIFIED");
    const binding = matching[0].binding, parsed = matrixFactScopeBindingSchema.safeParse(binding);
    if (!parsed.success || !same(binding, parsed.data) || binding.ruleId !== RULE || binding.ruleVersion !== "1" || binding.parameterCode !== "KR-055") fail();
    const candidates = [...wallFacts(source, artifact, record.originalStages as string[], record.originalPageStages as Plain), ...pdOriginal(source, artifact, record)];
    const selected = candidates.filter(fact => fact.id === (record.target as Plain).observationId);
    if (selected.length !== 1 || !["PD", "RD"].includes(selected[0].stage)) fail("TARGET_UNVERIFIED");
    const fact = selected[0], stage = fact.stage as "PD" | "RD";
    const side: Plain = { fact, origin: { target: record.target, objectId: record.objectId, inputManifestHash: record.inputManifestHash,
      originalStages: record.originalStages, originalPageStages: record.originalPageStages, artifact },
      source: { objectId: window.objectId, sourceFileId: source.sourceFileId, sourceSha256: source.sha256, stages: source.stages,
        revisionStatus: decision.revisionStatus, approvalStatus: decision.approvalStatus, sectionCode: decision.sectionCode,
        linkGroupId: decision.linkGroupId, pageStages: decision.pageStages,
        reviewRef: { decisionId: decision.reviewDecisionId, contentHash: decision.reviewContentHash } }, binding };
    const pair = { schemaVersion: "matrix-concrete-wall-pair-input-v1", objectId: window.objectId, inputManifestHash: record.inputManifestHash, expected: side, actual: side };
    validateConcreteWallRetainedOriginalSideV13(pair, stage);
    fact.entityKey = binding.entityKey as string;
    retained.push({ stage, side });
  }
  if (new Set(retained.map(row => row.stage)).size !== retained.length || retained.some((row, i) => i > 0 && row.stage === "PD")) fail("TARGET_UNVERIFIED");
  for (const wall of walls) {
    const matching = retained.filter(row => (row.side.fact as MatrixObservation).id === wall.id);
    if (matching.length > 1) fail("TARGET_UNVERIFIED");
    if (matching.length === 1) wall.entityKey = (matching[0].side.binding as Plain).entityKey as string;
  }
  walls.sort(concreteWallObservationOrderV13);
  return { window, sources, walls, retained };
}
/** Exact reserved family completeness/order. Called only after every raw row's source checks. */
export function verifyConcreteWallObservationSetV13(observations: MatrixObservation[], prepared: ConcreteWallPreparedV13): void {
  const reserved = observations.filter(fact => isReservedConcreteWallObservationV13(fact));
  if (!same(reserved, prepared.walls)) fail("TARGET_UNVERIFIED");
  const inputs = prepared.window.inputs as Plain, decisions = inputs.sourceDecisions as Plain;
  const byId = new Map(observations.map(fact => [fact.id, fact]));
  for (const [sourceId, decision] of Object.entries(decisions)) {
    const proof = ((decision as Plain).scopeProofs as Plain).FACT_BINDINGS as Plain | undefined;
    if (!proof) continue;
    for (const binding of proof.bindings as Plain[]) {
      const fact = byId.get((binding.target as Plain).observationId as string);
      if (isConcreteWallClaimV13(binding, fact) && !prepared.retained.some(row =>
        (row.side.source as Plain).sourceFileId === sourceId && same((row.side.binding as Plain).target, binding.target))) fail("TARGET_UNVERIFIED");
    }
  }
  for (const { side } of prepared.retained) {
    const original = side.fact as MatrixObservation, current = byId.get(original.id);
    if (current && (!IDENTITY.every(key => same(current[key], original[key])) || current.entityKey !== (side.binding as Plain).entityKey)) fail("TARGET_UNVERIFIED");
  }
}
/** Internal resolver extension only for exact reconstructed wall targets. Other rules use old resolver unchanged. */
export function concreteWallBindingForFactV13(fact: MatrixObservation, prepared: ConcreteWallPreparedV13): MatrixFactScopeBinding | null {
  const matches = prepared.retained.filter(row => (row.side.fact as MatrixObservation).id === fact.id
    && (row.side.source as Plain).sourceFileId === fact.sourceFileId);
  if (matches.length > 1) fail("TARGET_UNVERIFIED");
  if (!matches.length) return null;
  if (!IDENTITY.every(key => same(fact[key], (matches[0].side.fact as MatrixObservation)[key]))) fail("TARGET_UNVERIFIED");
  return matches[0].side.binding as unknown as MatrixFactScopeBinding;
}
export function overlayConcreteWallResultV13(rows: MatrixAtomicResult[], observations: MatrixObservation[], prepared: ConcreteWallPreparedV13): MatrixAtomicResult[] {
  if (prepared.retained.length === 2) {
    const [expected, actual] = prepared.retained.map(row => row.side);
    const decision = evaluateConcreteWallRetainedPairV13({ schemaVersion: "matrix-concrete-wall-pair-input-v1",
      objectId: prepared.window.objectId, inputManifestHash: (expected.origin as Plain).inputManifestHash, expected, actual });
    if ((expected.binding as Plain).entityKey !== (actual.binding as Plain).entityKey) return rows;
    return mergeConcreteWallAtomicV13(rows, decision, { expected: expected.fact, actual: actual.fact }, observations);
  }
  for (const { side } of prepared.retained) if (!observations.some(fact => fact.id === (side.fact as MatrixObservation).id)) fail("TARGET_UNVERIFIED");
  return rows;
}
