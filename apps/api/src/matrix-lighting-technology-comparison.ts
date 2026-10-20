import { createHash } from "node:crypto";
import { types } from "node:util";
import type { DocumentTextV3Artifact, LightingTechnologyComparisonInput, LightingTechnologyComparisonScopeRequest,
  LightingTechnologyComparisonScopeDecision, LightingTechnologyComparisonClaimDecision, LightingTechnologyComparisonSource,
  LightingTechnologyComparisonOrigin, LightingTechnologyComparisonResult, LightingTechnologyV3Declaration } from "@inspector-ai/contracts";
import { readDocumentTextV3Artifact } from "./document-text-v3.js";
import { reconstructLightingTechnologySourceV3, lightingTechnologyV3DeclarationContentHash } from "./matrix-lighting-technology-source-v3.js";

type RecordValue = Record<string, unknown>;
type NativeResult = { status: "VALID"; canonical: string } | { status: "INVALID" | "LIMIT" };
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nonnegative = (v: unknown): v is number => integer(v) && v >= 0;
const positive = (v: unknown): v is number => integer(v) && v > 0;
const record = (v: unknown): v is RecordValue => v !== null && typeof v === "object" && !types.isProxy(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: unknown, keys: readonly string[]): v is RecordValue => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const SHA = /^[a-f0-9]{64}$(?![\s\S])/u;
const shaValue = (v: unknown): v is string => typeof v === "string" && SHA.test(v);
const pyTrim = (v: string) => v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, "");
const key = (v: unknown, max = 200, min = 1): v is string => typeof v === "string" && [...v].length >= min && [...v].length <= max
  && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v) && pyTrim(v) === v;
const STAGES = new Set(["PD", "RD", "ID", "UNRESOLVED"]);
const SECTIONS = new Set(["PZ", "SPZU", "AR", "KR", "IOS1", "IOS2", "IOS3", "IOS4", "IOS5", "POS", "POD", "OOS", "PPM", "ODI", "ZU", "SM", "EOM", "GP", "GSV", "KJ", "KM", "NVK", "OV", "PP", "PPR", "SS", "VK"]);
const SCHEMA = "matrix-zu130-lighting-technology-comparison-v1";
const SCOPE = "matrix-zu130-lighting-technology-review-v1";
type Reason = Extract<LightingTechnologyComparisonResult, {status: "ABSTAIN"}>["reasonCode"];
const abstain = (reasonCode: Reason): LightingTechnologyComparisonResult => ({schemaVersion: SCHEMA, status: "ABSTAIN", reasonCode, calibratedProbability: null});
const compareCodepoints = (a: string, b: string): number => {
  const aa = Array.from(a, c => c.codePointAt(0)!), bb = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
};

/** Read descriptors before values; reject proxies, callbacks, sparse arrays and cycles. */
function portable(input: unknown): NativeResult {
  let nodes = 0, rawBytes = 0, limited = false;
  const ancestors = new Set<object>();
  function limit(): undefined { limited = true; return undefined; }
  function visit(value: unknown, depth: number): string | undefined {
    if (++nodes > 200000 || depth > 64) return limit();
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return integer(value) ? String(value) : undefined;
    if (typeof value === "string") {
      if (value.length > 4000000) return limit();
      let count = 0;
      for (const c of value) {
        if (++count > 2000000) return limit();
        const cp = c.codePointAt(0)!;
        if (cp >= 0xd800 && cp <= 0xdfff) return undefined;
      }
      rawBytes += Buffer.byteLength(value, "utf8");
      if (rawBytes > 8000000) return limit();
      return JSON.stringify(value);
    }
    if (value === null || typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) return undefined;
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.some(k => typeof k !== "string")) return undefined;
    let keys: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!nonnegative(length)) return undefined;
      if (length > 32768) return limit();
      if (names.length !== length + 1) return undefined;
      keys = Array.from({ length }, (_, i) => String(i));
    } else {
      if (names.length > 32768) return limit();
      keys = (names as string[]).sort(compareCodepoints);
    }
    ancestors.add(value);
    const parts: string[] = [];
    for (const key of keys) {
      const d = descriptors[key];
      if (!d || !d.enumerable || !Object.hasOwn(d, "value")) { ancestors.delete(value); return undefined; }
      const encodedKey = array ? "" : visit(key, depth + 1);
      if (encodedKey === undefined) { ancestors.delete(value); return undefined; }
      const encoded = visit(d.value, depth + 1);
      if (encoded === undefined) { ancestors.delete(value); return undefined; }
      parts.push(array ? encoded : `${encodedKey}:${encoded}`);
    }
    ancestors.delete(value);
    return array ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
  }
  try {
    const canonical = visit(input, 0);
    if (canonical === undefined) return { status: limited ? "LIMIT" : "INVALID" };
    if (Buffer.byteLength(canonical, "utf8") > 8000000) return { status: "LIMIT" };
    return { status: "VALID", canonical };
  } catch { return { status: "INVALID" }; }
}


function identity(v: unknown): boolean {
  return exact(v, ["entityKey", "buildingKey", "systemKey", "positionKey", "componentRole"])
    && [v.entityKey, v.buildingKey, v.systemKey, v.positionKey].every(x => key(x)) && v.componentRole === "LUMINAIRE_LIGHT_SOURCE";
}
function target(v: unknown): boolean {
  return exact(v, ["checkId", "inputManifestHash", "textStageContentHash", "textArtifactHash", "declarationContentHash"])
    && key(v.checkId, 120) && [v.inputManifestHash, v.textStageContentHash, v.textArtifactHash, v.declarationContentHash].every(shaValue);
}
function selection(v: unknown): boolean {
  return exact(v, ["pageNumber", "fragments"]) && positive(v.pageNumber) && v.pageNumber <= 512 && Array.isArray(v.fragments)
    && [1, 2].includes(v.fragments.length) && v.fragments.every(f => exact(f, ["sourcePath", "rawText"])
      && Array.isArray(f.sourcePath) && f.sourcePath.length >= 1 && f.sourcePath.length <= 64
      && f.sourcePath.every(n => nonnegative(n) && n <= 32767) && typeof f.rawText === "string" && f.rawText.length > 0);
}
function mapping(v: unknown): boolean {
  return exact(v, ["kind", "sourcePositionLabel", "assertion"]) && v.kind === "HUMAN_REVIEWED_LIGHTING_POSITION_MAPPING"
    && typeof v.sourcePositionLabel === "string" && /^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9_.-]{0,79}$(?![\s\S])/u.test(v.sourcePositionLabel)
    && ["UNKNOWN", "HUMAN_ASSERTED_SAME_LUMINAIRE_LIGHT_SOURCE_POSITION"].includes(v.assertion as string);
}
const box = (v: unknown): boolean => Array.isArray(v) && v.length === 4 && v.every(nonnegative);
const stringLength = (v: unknown, min: number, max: number): v is string => typeof v === "string" && [...v].length >= min && [...v].length <= max;
const nativeBox = (v: unknown): boolean => Array.isArray(v) && v.length === 4 && v.every(x => stringLength(x, 1, 64)
  && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$(?![\s\S])/u.test(x));
/** Structural DTO checks only; source semantics are deliberately checked at reconstruction gate6. */
function declarationShape(v: unknown): boolean {
  return exact(v, ["schemaVersion", "extractorVersion", "bindingPolicyVersion", "sourceFileId", "sourceSha256", "textArtifactHash", "extractorProfileHash", "stage", "pageNumber", "pageWidthMilliPoints", "pageHeightMilliPoints", "nativeFrame", "regionBoxMilliPoints", "technology", "rawTechnology", "positionLabel", "scopeStatus", "primaryFragments", "authorityStatus", "renderedVisibility", "calibratedProbability"])
    && v.schemaVersion === "matrix-zu130-lighting-technology-v3-declaration-v1"
    && v.extractorVersion === "matrix-zu130-lighting-technology-source-v3-v1"
    && v.bindingPolicyVersion === "matrix-zu130-explicit-lighting-technology-v3-literals-v1"
    && key(v.sourceFileId) && [v.sourceSha256, v.textArtifactHash, v.extractorProfileHash].every(shaValue)
    && STAGES.has(v.stage as string) && positive(v.pageNumber) && v.pageNumber <= 512
    && positive(v.pageWidthMilliPoints) && positive(v.pageHeightMilliPoints) && box(v.regionBoxMilliPoints)
    && exact(v.nativeFrame, ["coordinateSystem", "visibleBoxPointStrings"]) && v.nativeFrame.coordinateSystem === "PDFMINER_LAYOUT_POINTS" && nativeBox(v.nativeFrame.visibleBoxPointStrings)
    && ["LED", "FLUORESCENT", "INCANDESCENT"].includes(v.technology as string) && stringLength(v.rawTechnology, 1, 200)
    && (v.positionLabel === null || stringLength(v.positionLabel, 1, 80)) && ["NAMED_POSITION_LITERAL", "UNBOUND_GROUP_DECLARATION"].includes(v.scopeStatus as string)
    && v.authorityStatus === "SOURCE_DECLARED_UNVERIFIED" && v.renderedVisibility === "UNVERIFIED" && v.calibratedProbability === null
    && Array.isArray(v.primaryFragments) && [1, 2].includes(v.primaryFragments.length) && v.primaryFragments.every(f =>
      exact(f, ["pageNumber", "sourcePath", "rawText", "nativeBoxPointStrings", "bboxMilliPoints", "usedTextRange"])
      && positive(f.pageNumber) && f.pageNumber <= 512 && Array.isArray(f.sourcePath) && f.sourcePath.length >= 1 && f.sourcePath.length <= 64
      && f.sourcePath.every(n => nonnegative(n) && n <= 32767) && stringLength(f.rawText, 1, 2000000) && nativeBox(f.nativeBoxPointStrings)
      && box(f.bboxMilliPoints) && exact(f.usedTextRange, ["start", "end"]) && nonnegative(f.usedTextRange.start) && positive(f.usedTextRange.end));
}
function claim(v: unknown, decision: boolean): boolean {
  return exact(v, ["target", "selection", "identity", "positionMapping", "reference", ...(decision ? ["declarationSnapshot"] : [])])
    && target(v.target) && selection(v.selection) && identity(v.identity) && mapping(v.positionMapping) && key(v.reference, 1000, 8)
    && (!decision || declarationShape(v.declarationSnapshot));
}
function scope(v: unknown, decision: boolean): boolean {
  return exact(v, ["schemaVersion", "claims"]) && v.schemaVersion === SCOPE && Array.isArray(v.claims)
    && v.claims.length <= 16 && v.claims.every(c => claim(c, decision));
}
function pageStages(v: unknown): boolean {
  return record(v) && Object.entries(v).every(([p, s]) => /^[1-9][0-9]{0,15}$(?![\s\S])/u.test(p) && positive(Number(p)) && STAGES.has(s as string));
}
function review(v: unknown): boolean {
  return exact(v, ["decisionId", "contentHash", "objectId", "sourceFileId", "sourceSha256", "actorId", "revisionStatus", "approvalStatus", "sectionCode", "linkGroupId", "pageStages", "lightingTechnologyScope"])
    && [v.decisionId, v.objectId, v.sourceFileId, v.actorId].every(x => key(x)) && shaValue(v.contentHash) && shaValue(v.sourceSha256)
    && ["CURRENT", "SUPERSEDED", "UNKNOWN"].includes(v.revisionStatus as string) && ["APPROVED", "UNAPPROVED", "UNKNOWN"].includes(v.approvalStatus as string)
    && (v.sectionCode === null || SECTIONS.has(v.sectionCode as string)) && (v.linkGroupId === null || key(v.linkGroupId, 120))
    && pageStages(v.pageStages) && (v.lightingTechnologyScope === null || scope(v.lightingTechnologyScope, true));
}
function sourceShape(v: unknown): boolean {
  return exact(v, ["sourceFileId", "sourceSha256", "stages", "reviewSnapshot", "review"]) && key(v.sourceFileId) && shaValue(v.sourceSha256)
    && Array.isArray(v.stages) && v.stages.length <= 4 && v.stages.every(s => STAGES.has(s))
    && (v.reviewSnapshot === null || (exact(v.reviewSnapshot, ["decisionId", "contentHash"]) && key(v.reviewSnapshot.decisionId) && shaValue(v.reviewSnapshot.contentHash)))
    && (v.review === null || review(v.review));
}
function originShape(v: unknown): boolean {
  return exact(v, ["checkId", "objectId", "sourceFileId", "sourceSha256", "inputManifestHash", "textStageContentHash", "textArtifactHash", "textArtifact"])
    && key(v.checkId, 120) && key(v.objectId) && key(v.sourceFileId) && [v.sourceSha256, v.inputManifestHash, v.textStageContentHash, v.textArtifactHash].every(shaValue)
    && record(v.textArtifact);
}
function collectionLimit(input: unknown): boolean {
  if (!record(input)) return false;
  if (Array.isArray(input.sources) && input.sources.length > 64 || Array.isArray(input.origins) && input.origins.length > 128) return true;
  let claims = 0;
  if (Array.isArray(input.sources)) for (const s of input.sources) {
    if (!record(s) || !record(s.review) || !record(s.review.lightingTechnologyScope) || !Array.isArray(s.review.lightingTechnologyScope.claims)) continue;
    const count = s.review.lightingTechnologyScope.claims.length;
    if (count > 16 || (claims += count) > 128) return true;
  }
  return false;
}
const encoded = (v: unknown): string => {const n = portable(v); if (n.status !== "VALID") throw Error("invalid portable value"); return n.canonical;};
const same = (a: unknown, b: unknown) => encoded(a) === encoded(b);
const originKey = (sourceFileId: string, checkId: string) => JSON.stringify([sourceFileId, checkId]);
const uniqueHashes = (claims: Array<{target: {declarationContentHash: string}}>) => new Set(claims.map(c => c.target.declarationContentHash)).size === claims.length;

/** Staging shape only; a caller-supplied hash does not authenticate the original. */
export function validateLightingTechnologyScopeRequest(input: unknown): LightingTechnologyComparisonScopeRequest | null {
  if (portable(input).status !== "VALID" || !scope(input, false)) return null;
  const value = input as LightingTechnologyComparisonScopeRequest;
  return uniqueHashes(value.claims) ? structuredClone(value) : null;
}
/** Project a consistent stored snapshot without inventing a source-v3 envelope. */
export function projectLightingTechnologyScopeDecision(input: unknown): LightingTechnologyComparisonScopeRequest | null {
  if (portable(input).status !== "VALID" || !scope(input, true)) return null;
  const value = input as LightingTechnologyComparisonScopeDecision;
  if (!uniqueHashes(value.claims)) return null;
  let source: string | undefined;
  try {
    for (const c of value.claims) {
      const d = c.declarationSnapshot, pair = JSON.stringify([d.sourceFileId, d.sourceSha256]);
      if (source !== undefined && pair !== source) return null;
      source = pair;
      if (lightingTechnologyV3DeclarationContentHash(d) !== c.target.declarationContentHash || d.textArtifactHash !== c.target.textArtifactHash
        || !same(c.selection, {pageNumber: d.pageNumber, fragments: d.primaryFragments.map(f => ({sourcePath: f.sourcePath, rawText: f.rawText}))})) return null;
    }
    return {schemaVersion: SCOPE, claims: value.claims.map(({declarationSnapshot: _snapshot, ...request}) => structuredClone(request))};
  } catch { return null; }
}

type BoundClaim = {source: LightingTechnologyComparisonSource; claim: LightingTechnologyComparisonClaimDecision; origin: LightingTechnologyComparisonOrigin; stage: "PD" | "RD"; declaration?: LightingTechnologyV3Declaration};
/** Pure consistency comparison. Repository loaders must authenticate sealed origins and stored review actors. */
export function compareZu130LightingTechnologies(input: unknown): LightingTechnologyComparisonResult {
  const native = portable(input);
  if (native.status !== "VALID") return abstain(native.status === "LIMIT" ? "INPUT_LIMIT" : "INVALID_INPUT");
  if (collectionLimit(input)) return abstain("INPUT_LIMIT");
  if (!exact(input, ["schemaVersion", "objectId", "inputManifestHash", "identity", "sources", "origins"])
    || input.schemaVersion !== "matrix-zu130-lighting-technology-comparison-input-v1" || !key(input.objectId) || !shaValue(input.inputManifestHash)
    || !identity(input.identity) || !Array.isArray(input.sources) || !input.sources.every(sourceShape)
    || !Array.isArray(input.origins) || !input.origins.every(originShape)) return abstain("INVALID_INPUT");
  const value = input as LightingTechnologyComparisonInput;
  const sources = new Map<string, LightingTechnologyComparisonSource>(), origins = new Map<string, LightingTechnologyComparisonOrigin>();
  const bound: BoundClaim[] = [];
  // Gate3: every retained association, including scopes unrelated to requested identity.
  for (const s of value.sources) {
    if (sources.has(s.sourceFileId) || new Set(s.stages).size !== s.stages.length) return abstain("SOURCE_PROVENANCE_UNVERIFIED");
    sources.set(s.sourceFileId, s);
    if ((s.review === null) !== (s.reviewSnapshot === null)) return abstain("SOURCE_PROVENANCE_UNVERIFIED");
    if (s.review && (s.review.sourceFileId !== s.sourceFileId || s.review.sourceSha256 !== s.sourceSha256 || s.review.objectId !== value.objectId
      || s.review.decisionId !== s.reviewSnapshot!.decisionId || s.review.contentHash !== s.reviewSnapshot!.contentHash)) return abstain("SOURCE_PROVENANCE_UNVERIFIED");
  }
  for (const o of value.origins) {
    const k = originKey(o.sourceFileId, o.checkId), s = sources.get(o.sourceFileId);
    if (origins.has(k) || !s || s.sourceSha256 !== o.sourceSha256 || o.objectId !== value.objectId) return abstain("SOURCE_PROVENANCE_UNVERIFIED");
    origins.set(k, o);
  }
  for (const s of value.sources) for (const c of s.review?.lightingTechnologyScope?.claims ?? []) {
    const o = origins.get(originKey(s.sourceFileId, c.target.checkId));
    if (!o || c.target.inputManifestHash !== o.inputManifestHash || c.target.textStageContentHash !== o.textStageContentHash
      || c.target.textArtifactHash !== o.textArtifactHash) return abstain("SOURCE_PROVENANCE_UNVERIFIED");
    bound.push({source: s, claim: c, origin: o, stage: s.stages[0] as "PD" | "RD"});
  }
  // Gate4: whole original envelopes and both hashes; never relabel a selected fragment as an artifact.
  for (const o of value.origins) {
    const read = readDocumentTextV3Artifact(o.textArtifact);
    if (read.status !== "VALID") return abstain(read.reasonCode === "INPUT_LIMIT" ? "INPUT_LIMIT" : "SOURCE_PROVENANCE_UNVERIFIED");
    if (o.textArtifact.sourceFileId !== o.sourceFileId || o.textArtifact.inputSha256 !== o.sourceSha256 || read.contentHash !== o.textArtifactHash
      || createHash("sha256").update(encoded(o.textArtifact), "utf8").digest("hex") !== o.textStageContentHash
      || Object.keys(sources.get(o.sourceFileId)!.review?.pageStages ?? {}).some(p => Number(p) > o.textArtifact.pageCount)) return abstain("SOURCE_PROVENANCE_UNVERIFIED");
  }
  // Gate5 precedes all reconstructions, even for an unrelated retained claim.
  for (const b of bound) {
    const stages = b.source.stages, overrides = b.source.review!.pageStages;
    if (stages.length !== 1 || !["PD", "RD"].includes(stages[0]) || Object.values(overrides).some(s => s !== "UNRESOLVED" && s !== stages[0])
      || (overrides[String(b.claim.selection.pageNumber)] ?? stages[0]) !== stages[0]) return abstain("SOURCE_STAGE_UNVERIFIED");
  }
  for (const b of bound) {
    const rebuilt = reconstructLightingTechnologySourceV3({sourceFileId: b.source.sourceFileId, sourceSha256: b.source.sourceSha256,
      stage: b.stage, pageStages: b.source.review!.pageStages, textArtifact: b.origin.textArtifact, selection: b.claim.selection});
    if (rebuilt.status !== "RECONSTRUCTED") return abstain(rebuilt.reasonCode === "INPUT_LIMIT" ? "INPUT_LIMIT" : "DECLARATION_RECONSTRUCTION_UNVERIFIED");
    try {
      if (!same(rebuilt.declaration, b.claim.declarationSnapshot) || lightingTechnologyV3DeclarationContentHash(rebuilt.declaration) !== b.claim.target.declarationContentHash) return abstain("DECLARATION_RECONSTRUCTION_UNVERIFIED");
    } catch { return abstain("DECLARATION_RECONSTRUCTION_UNVERIFIED"); }
    b.declaration = rebuilt.declaration;
  }
  const wanted = value.identity;
  const selected = bound.filter(b => b.claim.identity.entityKey === wanted.entityKey || ["buildingKey", "systemKey", "positionKey"].every(k => b.claim.identity[k as keyof typeof wanted] === wanted[k as keyof typeof wanted]));
  if (selected.some(b => !same(b.claim.identity, wanted))) return abstain("POSITION_IDENTITY_CONFLICT");
  const pd = selected.filter(b => b.stage === "PD"), rd = selected.filter(b => b.stage === "RD");
  if ([pd, rd].some(group => !uniqueHashes(group.map(b => b.claim)))) return abstain("INVALID_INPUT");
  if (pd.length > 1 || rd.length > 1) return abstain("AMBIGUOUS_DECLARATION_SCOPE");
  if (pd.length !== 1 || rd.length !== 1 || pd[0].source.sourceFileId === rd[0].source.sourceFileId || pd[0].source.sourceSha256 === rd[0].source.sourceSha256) return abstain("MATCHED_DECLARATION_PAIR_UNVERIFIED");
  const pair = [pd[0], rd[0]], [a, b] = pair, ar = a.source.review!, br = b.source.review!;
  if (pair.some(c => c.source.review!.revisionStatus !== "CURRENT" || c.source.review!.approvalStatus !== "APPROVED")) return abstain("SOURCE_REVIEW_UNVERIFIED");
  if (!["ZU", "IOS1"].includes(ar.sectionCode ?? "") || !["IOS1", "EOM"].includes(br.sectionCode ?? "")) return abstain("SOURCE_SECTION_UNVERIFIED");
  if (!ar.linkGroupId || ar.linkGroupId !== br.linkGroupId) return abstain("LINK_SCOPE_UNVERIFIED");
  if (pair.some(c => c.declaration!.scopeStatus !== "NAMED_POSITION_LITERAL" || c.declaration!.positionLabel === null)) return abstain("NAMED_POSITION_UNVERIFIED");
  if (pair.some(c => c.claim.positionMapping.assertion !== "HUMAN_ASSERTED_SAME_LUMINAIRE_LIGHT_SOURCE_POSITION" || c.claim.positionMapping.sourcePositionLabel !== c.declaration!.positionLabel)) return abstain("POSITION_MAPPING_UNVERIFIED");
  if (a.declaration!.technology !== "LED" || !["FLUORESCENT", "INCANDESCENT"].includes(b.declaration!.technology)) return abstain("DIRECTED_TRANSITION_UNSUPPORTED");
  const reference = (c: BoundClaim) => ({sourceFileId: c.source.sourceFileId, sourceSha256: c.source.sourceSha256,
    reviewDecisionId: c.source.review!.decisionId, reviewContentHash: c.source.review!.contentHash, declarationContentHash: c.claim.target.declarationContentHash});
  return {schemaVersion: SCHEMA, status: "CANDIDATE", ruleId: "matrix-zu-130-declared_led_technology_replacement", ruleVersion: "1", parameterCode: "ZU-130",
    reasonCode: "LED_REPLACED_BY_FLUORESCENT_OR_INCANDESCENT", calibratedProbability: null, comparisonScope: "REVIEWED_NAMED_LUMINAIRE_LIGHT_SOURCE_POSITION_ONLY",
    identity: structuredClone(wanted), expected: reference(a), actual: reference(b), expectedTechnology: "LED", actualTechnology: b.declaration!.technology as "FLUORESCENT" | "INCANDESCENT"};
}
