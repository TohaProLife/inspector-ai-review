import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { sourceSectionCodes } from '@inspector-ai/contracts';
import type { MatrixSteelSourceDeclaration, SourceDeclarationFragment, SteelComparisonAbstainReason,
  SteelComparisonApplicabilityDecision, SteelComparisonIdentity, SteelComparisonInput, SteelComparisonOrigin,
  SteelComparisonReference, SteelComparisonResult, SteelComparisonReview, SteelComparisonScopeClaimDecision,
  SteelComparisonScopeDecision, SteelComparisonScopeRequest, SteelComparisonSource } from '@inspector-ai/contracts';
import { canonicalSourceDeclarationJson as canonical, extractSourceDeclarations, sourceDeclarationId } from './matrix-source-declarations.js';
import { compareSteelCatalogExample } from './matrix-steel-prose.js';

type Obj = Record<string, unknown>;
type Native = { status: 'VALID'; canonical: string } | { status: 'INVALID' | 'LIMIT' };
const VERSION = 'matrix-kr056-steel-comparison-v1';
const SCOPE = 'matrix-kr056-steel-review-v1';
const STAGES = ['PD', 'RD', 'ID', 'UNRESOLVED'];
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const nonnegative = (v: unknown): v is number => integer(v) && v >= 0;
const positive = (v: unknown): v is number => integer(v) && v > 0;
const record = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !types.isProxy(v)
  && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: unknown, keys: readonly string[]): v is Obj => record(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const deep = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const hash = (v: unknown): string => createHash('sha256').update(canonical(v), 'utf8').digest('hex');
const trim = (v: string) => v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '');
const key = (v: unknown, max = 200, min = 1): v is string => typeof v === 'string' && [...v].length >= min
  && [...v].length <= max && trim(v) === v && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$(?![\s\S])/u.test(v);
const list = (v: unknown, minimum: number, maximum: number, check: (x: unknown) => boolean): v is unknown[] =>
  Array.isArray(v) && v.length >= minimum && v.length <= maximum && v.every(check);
const box = (v: unknown): v is [number, number, number, number] => list(v, 4, 4, nonnegative);

/** Descriptor-first native JSON admission. No input method, getter or proxy trap runs. */
function native(raw: unknown, byteLimit = 8_000_000): Native {
  let nodes = 0, encodedBytes = 0, limited = false;
  const ancestors = new Set<object>();
  const limit = (): undefined => { limited = true; return undefined; };
  const add = (count: number): boolean => { encodedBytes += count; if (encodedBytes > byteLimit) { limited = true; return false; } return true; };
  function visit(v: unknown, depth: number): string | undefined {
    if (++nodes > 200_000 || depth > 64) return limit();
    if (v === null || typeof v === 'boolean' || typeof v === 'number') {
      if (typeof v === 'number' && !integer(v)) return undefined;
      const encoded = JSON.stringify(v); return add(encoded.length) ? encoded : undefined;
    }
    if (typeof v === 'string') {
      if (v.length > 4_000_000) return limit();
      let points = 0;
      for (const c of v) { if (++points > 2_000_000) return limit(); const cp = c.codePointAt(0)!; if (cp >= 0xd800 && cp <= 0xdfff) return undefined; }
      const encoded = JSON.stringify(v); return add(Buffer.byteLength(encoded, 'utf8')) ? encoded : undefined;
    }
    if (!v || typeof v !== 'object' || types.isProxy(v) || ancestors.has(v)) return undefined;
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(v), names = Reflect.ownKeys(descriptors);
    if (names.some(n => typeof n !== 'string')) return undefined;
    let keys: string[];
    if (array) {
      const length: unknown = descriptors.length?.value;
      if (!nonnegative(length)) return undefined;
      if (length > 32_768) return limit();
      if (names.length !== length + 1) return undefined;
      keys = Array.from({ length }, (_, i) => String(i));
    } else {
      if (names.length > 32_768) return limit();
      keys = (names as string[]).sort();
      if (keys.some(k => !/^[\x00-\x7f]*$/.test(k))) return undefined;
    }
    if (!add(2 + Math.max(0, keys.length - 1) + (array ? 0 : keys.length))) return undefined;
    ancestors.add(v);
    const parts: string[] = [];
    for (const k of keys) {
      const d = descriptors[k];
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) { ancestors.delete(v); return undefined; }
      const encodedKey = array ? '' : visit(k, depth + 1);
      if (encodedKey === undefined) { ancestors.delete(v); return undefined; }
      const value = visit(d.value, depth + 1);
      if (value === undefined) { ancestors.delete(v); return undefined; }
      parts.push(array ? value : `${encodedKey}:${value}`);
    }
    ancestors.delete(v);
    return array ? `[${parts.join(',')}]` : `{${parts.join(',')}}`;
  }
  try { const encoded = visit(raw, 0); return encoded === undefined ? { status: limited ? 'LIMIT' : 'INVALID' } : { status: 'VALID', canonical: encoded }; }
  catch { return { status: 'INVALID' }; }
}

function identity(v: unknown): v is SteelComparisonIdentity {
  return exact(v, ['entityKey', 'buildingKey', 'zoneKey', 'memberKey', 'componentRole'])
    && ['entityKey', 'buildingKey', 'zoneKey', 'memberKey'].every(k => key(v[k])) && v.componentRole === 'DISTRIBUTION_BELT_I_BEAM';
}
function target(v: unknown, declaration: boolean): boolean {
  return exact(v, ['checkId', 'inputManifestHash', 'textStageContentHash', 'textArtifactHash', ...(declaration ? ['declarationId'] : [])])
    && key(v.checkId, 120) && ['inputManifestHash', 'textStageContentHash', 'textArtifactHash', ...(declaration ? ['declarationId'] : [])].every(k => sha(v[k]));
}
function fragment(v: unknown): v is SourceDeclarationFragment {
  return exact(v, ['pageNumber', 'blockIndex', 'lineIndex', 'rawText', 'bboxMilliPoints'])
    && positive(v.pageNumber) && v.pageNumber <= 512 && nonnegative(v.blockIndex) && nonnegative(v.lineIndex)
    && typeof v.rawText === 'string' && [...v.rawText].length >= 1 && [...v.rawText].length <= 2_000_000 && box(v.bboxMilliPoints);
}
const fragments = (v: unknown, min = 1, max = 16) => list(v, min, max, fragment);
function product(v: unknown, original: boolean): boolean {
  if (!exact(v, ['role', 'productKind', 'profile', 'count', 'tier', 'productStandard', 'gradeStandard'])
    || !['DISTRIBUTION_BELT_I_BEAMS', 'I_BEAM_GENERIC_DECLARATION'].includes(v.role as string) || v.productKind !== 'I_BEAM'
    || !(v.profile === null || key(v.profile)) || !(v.count === null || positive(v.count)) || !(v.tier === null || positive(v.tier))
    || !key(v.productStandard) || !key(v.gradeStandard)) return false;
  if (!original) return true;
  return v.role === 'DISTRIBUTION_BELT_I_BEAMS'
    ? v.profile === '70Б3' && v.count === 3 && v.tier === 2 && v.productStandard === 'ГОСТ Р 35087-2024' && v.gradeStandard === 'ГОСТ 27772-2015'
    : v.profile === null && v.count === null && v.tier === null && v.productStandard === 'ГОСТ Р 57837-2017' && v.gradeStandard === 'ГОСТ 27772-2021';
}
function declaration(v: unknown): v is MatrixSteelSourceDeclaration {
  return exact(v, ['schemaVersion', 'id', 'kind', 'extractorVersion', 'sourceFileId', 'sourceSha256', 'textArtifactHash', 'stage',
    'pageNumber', 'widthMilliPoints', 'heightMilliPoints', 'value', 'rawValue', 'rawUnit', 'canonicalUnit', 'entityKey', 'applicabilityStatus', 'primaryFragments', 'scopeFragments', 'productScope'])
    && v.schemaVersion === 'matrix-source-declaration-v1' && sha(v.id) && v.kind === 'SOURCE_AUTHORED_STEEL_DECLARATION'
    && v.extractorVersion === 'matrix-steel-prose-v1' && key(v.sourceFileId) && sha(v.sourceSha256) && sha(v.textArtifactHash)
    && (v.stage === 'PD' || v.stage === 'RD') && positive(v.pageNumber) && v.pageNumber <= 512 && positive(v.widthMilliPoints)
    && positive(v.heightMilliPoints) && ['С245', 'С345'].includes(v.value as string) && ['C245', 'С245', 'C345', 'С345'].includes(v.rawValue as string)
    && v.rawUnit === null && v.canonicalUnit === 'steel_catalog_example' && v.entityKey === null && v.applicabilityStatus === 'UNREVIEWED'
    && fragments(v.primaryFragments, 1, 2) && fragments(v.scopeFragments, 3, 3) && product(v.productScope, true);
}
function mapping(v: unknown): boolean {
  return exact(v, ['assertion', 'identity', 'scopeFragments', 'reference']) && ['UNKNOWN', 'HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER'].includes(v.assertion as string)
    && identity(v.identity) && fragments(v.scopeFragments) && key(v.reference, 1000, 8);
}
function claim(v: unknown, materialized: boolean): boolean {
  return exact(v, ['target', 'identity', 'memberMapping', ...(materialized ? ['declarationSnapshot'] : [])])
    && target(v.target, true) && identity(v.identity) && mapping(v.memberMapping) && (!materialized || declaration(v.declarationSnapshot));
}
function scope(v: unknown, materialized: boolean): boolean {
  return exact(v, ['schemaVersion', 'claims']) && v.schemaVersion === SCOPE && list(v.claims, 0, 16, c => claim(c, materialized));
}
function stages(v: unknown): boolean { return list(v, 0, 4, s => typeof s === 'string' && STAGES.includes(s)) && new Set(v).size === v.length; }
function pageStages(v: unknown): v is Record<string, string> {
  return record(v) && Object.keys(v).length <= 512 && Object.entries(v).every(([p, s]) => /^[1-9][0-9]*$(?![\s\S])/u.test(p)
    && typeof s === 'string' && STAGES.includes(s));
}
const pageOutOfRange = (page: string, pageCount: number): boolean => {
  const maximum = String(pageCount);
  return page.length > maximum.length || (page.length === maximum.length && page > maximum);
};
function review(v: unknown): boolean {
  return exact(v, ['decisionId', 'contentHash', 'revisionStatus', 'approvalStatus', 'sectionCode', 'linkGroupId', 'pageStages', 'steelComparisonScope'])
    && key(v.decisionId) && sha(v.contentHash) && ['CURRENT', 'SUPERSEDED', 'UNKNOWN'].includes(v.revisionStatus as string)
    && ['APPROVED', 'UNAPPROVED', 'UNKNOWN'].includes(v.approvalStatus as string)
    && (v.sectionCode === null || (sourceSectionCodes as readonly unknown[]).includes(v.sectionCode)) && (v.linkGroupId === null || key(v.linkGroupId, 120))
    && pageStages(v.pageStages) && (v.steelComparisonScope === null || scope(v.steelComparisonScope, true));
}
function source(v: unknown): boolean {
  return exact(v, ['sourceFileId', 'sourceSha256', 'objectId', 'stages', 'review']) && key(v.sourceFileId) && sha(v.sourceSha256)
    && key(v.objectId) && stages(v.stages) && (v.review === null || review(v.review));
}
/** Structural artifact DTO only. Frozen extractor owns envelope semantics and geometry. */
function artifact(v: unknown): boolean {
  if (!exact(v, ['schemaVersion', 'sourceFileId', 'inputSha256', 'coordinateSystem', 'pageCount', 'textPageCount', 'qualityPolicyVersion', 'qualitySummary', 'pages'])
    || v.schemaVersion !== 'document-text-v2' || !key(v.sourceFileId) || !sha(v.inputSha256) || v.coordinateSystem !== 'PDF_BOTTOM_LEFT_MILLI_POINTS'
    || !positive(v.pageCount) || v.pageCount > 512 || !nonnegative(v.textPageCount) || v.textPageCount > 512
    || !['text-layer-quality-v1', 'text-layer-quality-v2'].includes(v.qualityPolicyVersion as string)
    || !exact(v.qualitySummary, ['textLayerCandidatePageCount', 'ocrRequiredPageCount'])
    || !Object.values(v.qualitySummary).every(n => nonnegative(n) && n <= 512)) return false;
  return list(v.pages, 1, 512, p => {
    if (!exact(p, ['pageNumber', 'widthMilliPoints', 'heightMilliPoints', 'blocks', 'quality']) || !positive(p.pageNumber) || p.pageNumber > 512
      || !positive(p.widthMilliPoints) || !positive(p.heightMilliPoints)
      || !exact(p.quality, ['disposition', 'metrics', 'reasonCodes']) || !['TEXT_LAYER_CANDIDATE', 'OCR_REQUIRED'].includes(p.quality.disposition as string)
      || !exact(p.quality.metrics, ['alphanumericCharacterCount', 'blockCount', 'disallowedControlCharacterCount', 'nonWhitespaceCharacterCount', 'replacementCharacterCount'])
      || !Object.values(p.quality.metrics).every(nonnegative) || !list(p.quality.reasonCodes, 0, 32, c => typeof c === 'string' && [...c].length >= 1 && [...c].length <= 200)) return false;
    return list(p.blocks, 0, 32768, b => (exact(b, ['text', 'bboxMilliPoints']) || exact(b, ['text', 'bboxMilliPoints', 'lineBboxesMilliPoints']))
      && typeof b.text === 'string' && [...b.text].length <= 2_000_000 && box(b.bboxMilliPoints)
      && (!Object.hasOwn(b, 'lineBboxesMilliPoints') || list(b.lineBboxesMilliPoints, 1, 32768, box)));
  });
}
function origin(v: unknown): boolean {
  return exact(v, ['sourceFileId', 'sourceSha256', 'target', 'artifactContentSha256', 'textArtifact', 'stages', 'pageStages'])
    && key(v.sourceFileId) && sha(v.sourceSha256) && target(v.target, false) && sha(v.artifactContentSha256)
    && artifact(v.textArtifact) && stages(v.stages) && pageStages(v.pageStages);
}
function referenceShape(v: unknown): boolean {
  return exact(v, ['sourceFileId', 'sourceSha256', 'reviewDecisionId', 'reviewContentHash', 'target', 'productScope'])
    && key(v.sourceFileId) && sha(v.sourceSha256) && key(v.reviewDecisionId) && sha(v.reviewContentHash) && target(v.target, true) && product(v.productScope, false);
}
function applicability(v: unknown): boolean {
  return exact(v, ['schemaVersion', 'decisionId', 'contentHash', 'objectId', 'status', 'authorityKind', 'identity', 'expected', 'actual', 'basis'])
    && v.schemaVersion === 'matrix-kr056-steel-applicability-decision-v1' && key(v.decisionId) && sha(v.contentHash) && key(v.objectId)
    && ['UNKNOWN', 'APPROVED', 'WITHDRAWN'].includes(v.status as string) && v.authorityKind === 'HUMAN_REVIEWED_DECLARATION_APPLICABILITY'
    && identity(v.identity) && referenceShape(v.expected) && referenceShape(v.actual)
    && exact(v.basis, ['reference', 'expectedScopeFragments', 'actualScopeFragments', 'catalogScope', 'standardsTreatment', 'profilesTreatment'])
    && key(v.basis.reference, 1000, 8) && fragments(v.basis.expectedScopeFragments) && fragments(v.basis.actualScopeFragments)
    && v.basis.catalogScope === 'ONLY_KR056_EXPLICIT_C345_TO_C245'
    && v.basis.standardsTreatment === 'RETAINED_DIFFERENCES_HUMAN_REVIEWED_NO_NORMATIVE_EQUIVALENCE'
    && v.basis.profilesTreatment === 'RETAINED_DIFFERENCES_NO_GEOMETRY_OR_STRENGTH_RANK';
}
function projection(v: unknown): v is SteelComparisonInput {
  return exact(v, ['schemaVersion', 'objectId', 'inputManifestHash', 'identity', 'sources', 'origins', 'applicabilityDecisions'])
    && v.schemaVersion === 'matrix-kr056-steel-comparison-input-v1' && key(v.objectId) && sha(v.inputManifestHash) && identity(v.identity)
    && list(v.sources, 0, 64, source) && list(v.origins, 0, 128, origin) && list(v.applicabilityDecisions, 0, 16, applicability);
}
function collectionLimit(v: unknown): boolean {
  if (!record(v)) return false;
  for (const [field, cap] of [['sources', 64], ['origins', 128], ['applicabilityDecisions', 16]] as const)
    if (Array.isArray(v[field]) && v[field].length > cap) return true;
  let claims = 0;
  if (Array.isArray(v.sources)) for (const s of v.sources) {
    if (!record(s) || !record(s.review) || !record(s.review.steelComparisonScope) || !Array.isArray(s.review.steelComparisonScope.claims)) continue;
    const count = s.review.steelComparisonScope.claims.length;
    if (count > 16 || (claims += count) > 128) return true;
  }
  return false;
}

interface Entry { source: SteelComparisonSource; review: SteelComparisonReview; claim: SteelComparisonScopeClaimDecision; origin: SteelComparisonOrigin; }
const originKey = (sourceFileId: string, target: unknown) => canonical({ sourceFileId, target });
const originPart = ({ declarationId: _id, ...rest }: SteelComparisonScopeClaimDecision['target']) => rest;
const reference = (e: Entry): SteelComparisonReference => ({ sourceFileId: e.source.sourceFileId, sourceSha256: e.source.sourceSha256,
  reviewDecisionId: e.review.decisionId, reviewContentHash: e.review.contentHash, target: e.claim.target, productScope: e.claim.declarationSnapshot.productScope });
function originalFragments(raw: SourceDeclarationFragment[], e: Entry): boolean {
  const pages = e.origin.textArtifact.pages as { pageNumber: number; blocks: { text: string; bboxMilliPoints: number[]; lineBboxesMilliPoints?: number[][] }[] }[];
  return raw.every(f => {
    const page = pages.find(p => p.pageNumber === f.pageNumber), block = page?.blocks[f.blockIndex], lines = block?.text.split('\n');
    const bounds = block?.lineBboxesMilliPoints?.[f.lineIndex]
      ?? (block?.lineBboxesMilliPoints === undefined && lines?.length === 1 && f.lineIndex === 0 ? block?.bboxMilliPoints : undefined);
    return !!bounds && lines?.[f.lineIndex] === f.rawText && same(bounds, f.bboxMilliPoints);
  });
}
const duplicateClaims = (claims: SteelComparisonScopeClaimDecision[]) => new Set(claims.map(c => c.target.declarationId)).size !== claims.length;

/** Whole retained integrity is independent of selected identity; no dummy member is needed. */
function validateRetained(raw: Omit<SteelComparisonInput, 'identity'>):
  { status: 'VALID'; entries: Entry[] } | { status: 'INVALID'; reasonCode: SteelComparisonAbstainReason } {
  const denied = (reasonCode: SteelComparisonAbstainReason) => ({ status: 'INVALID' as const, reasonCode });
  const sources = new Map(raw.sources.map(s => [s.sourceFileId, s]));
  const origins = new Map(raw.origins.map(o => [originKey(o.sourceFileId, o.target), o]));
  if (sources.size !== raw.sources.length || origins.size !== raw.origins.length || raw.sources.some(s => s.objectId !== raw.objectId)) return denied('SOURCE_PROVENANCE_UNVERIFIED');
  const rebuilt = new Map<string, MatrixSteelSourceDeclaration[]>();
  for (const o of raw.origins) {
    const s = sources.get(o.sourceFileId);
    if (!s || s.sourceSha256 !== o.sourceSha256 || o.textArtifact.sourceFileId !== o.sourceFileId || o.textArtifact.inputSha256 !== o.sourceSha256
      || o.target.textStageContentHash !== o.artifactContentSha256
      || hash(o.textArtifact) !== o.artifactContentSha256
      || hash({ hashDomain: 'matrix-source-declaration-text-artifact-v1', textArtifact: o.textArtifact }) !== o.target.textArtifactHash) return denied('SOURCE_PROVENANCE_UNVERIFIED');
    try {
      const result = extractSourceDeclarations({ objectId: raw.objectId, inputManifestHash: o.target.inputManifestHash,
        sources: [{ sourceFileId: o.sourceFileId, sha256: o.sourceSha256, stages: o.stages, pageStages: o.pageStages }], textArtifacts: [o.textArtifact] });
      if (s.review && Object.keys(s.review.pageStages).some(p => pageOutOfRange(p, o.textArtifact.pageCount as number))) return denied('SOURCE_PROVENANCE_UNVERIFIED');
      rebuilt.set(originKey(o.sourceFileId, o.target), result.declarations);
    } catch { return denied('SOURCE_PROVENANCE_UNVERIFIED'); }
  }
  const entries: Entry[] = [];
  for (const s of raw.sources) for (const c of s.review?.steelComparisonScope?.claims ?? []) {
    const o = origins.get(originKey(s.sourceFileId, originPart(c.target)));
    if (!o) return denied('DECLARATION_RECONSTRUCTION_UNVERIFIED');
    const expected = rebuilt.get(originKey(s.sourceFileId, o.target))!.find(d => d.id === c.target.declarationId);
    if (!expected || !same(expected, c.declarationSnapshot)) return denied('DECLARATION_RECONSTRUCTION_UNVERIFIED');
    const entry = { source: s, review: s.review!, claim: c, origin: o };
    if (!originalFragments(c.memberMapping.scopeFragments, entry)) return denied('DECLARATION_RECONSTRUCTION_UNVERIFIED');
    entries.push(entry);
  }
  const decisions = new Set<string>();
  for (const d of raw.applicabilityDecisions) {
    const { contentHash: _hash, ...body } = d;
    if (decisions.has(d.decisionId) || d.objectId !== raw.objectId || hash({ hashDomain: 'matrix-kr056-steel-applicability-decision-json-v1', decision: body }) !== d.contentHash)
      return denied('APPLICABILITY_DECISION_UNVERIFIED');
    decisions.add(d.decisionId);
    const bound = (ref: SteelComparisonReference, stage: 'PD' | 'RD', evidence: SourceDeclarationFragment[]) => {
      const matched = entries.filter(e => same(reference(e), ref) && same(e.claim.identity, d.identity) && e.claim.declarationSnapshot.stage === stage);
      return matched.length >= 1 && matched.every(e => originalFragments(evidence, e));
    };
    if (!bound(d.expected, 'PD', d.basis.expectedScopeFragments) || !bound(d.actual, 'RD', d.basis.actualScopeFragments)) return denied('APPLICABILITY_DECISION_UNVERIFIED');
  }
  if (raw.sources.some(s => duplicateClaims(s.review?.steelComparisonScope?.claims ?? []))) return denied('DUPLICATE_DECLARATION');
  return { status: 'VALID', entries };
}

/** Pure comparison of an already authenticated internal snapshot; never authenticates PDF or a human journal. */
export function compareKr056SteelDeclarations(raw: unknown): SteelComparisonResult {
  const checked = native(raw);
  const abstain = (reasonCode: SteelComparisonAbstainReason, selected: SteelComparisonIdentity | null = null): SteelComparisonResult =>
    ({ schemaVersion: VERSION, status: 'ABSTAIN', reasonCode, identity: selected === null ? null : deep(selected), comparison: null, calibratedProbability: null });
  if (checked.status !== 'VALID') return abstain(checked.status === 'LIMIT' ? 'INPUT_LIMIT' : 'INVALID_INPUT');
  const selected = record(raw) && identity(raw.identity) ? raw.identity : null;
  if (collectionLimit(raw)) return abstain('INPUT_LIMIT', selected);
  if (!projection(raw)) return abstain('INVALID_INPUT', selected);
  const denied = (reason: SteelComparisonAbstainReason) => abstain(reason, raw.identity);
  const retained = validateRetained(raw);
  if (retained.status === 'INVALID') return denied(retained.reasonCode);
  const selectedEntries = retained.entries.filter(e => same(e.claim.identity, raw.identity));
  const pd = selectedEntries.filter(e => e.claim.declarationSnapshot.stage === 'PD'), rd = selectedEntries.filter(e => e.claim.declarationSnapshot.stage === 'RD');
  if (pd.length > 1 || rd.length > 1) return denied('AMBIGUOUS_DECLARATION_SCOPE');
  if (pd.length !== 1 || rd.length !== 1) return denied('REVIEWED_STEEL_DECLARATION_IDENTITY_MISSING');
  const expected = pd[0], actual = rd[0], pair = [expected, actual];
  if (pair.some(e => e.source.stages.length !== 1 || e.source.stages[0] !== e.claim.declarationSnapshot.stage
    || Object.values(e.review.pageStages).some(stage => stage !== e.claim.declarationSnapshot.stage))) return denied('SOURCE_STAGE_UNVERIFIED');
  if (pair.some(e => e.review.revisionStatus !== 'CURRENT' || e.review.approvalStatus !== 'APPROVED')) return denied('SOURCE_REVIEW_UNVERIFIED');
  if (pair.some(e => e.review.sectionCode !== 'KR')) return denied('SOURCE_SECTION_UNVERIFIED');
  if (expected.source.sourceFileId === actual.source.sourceFileId || expected.source.sourceSha256 === actual.source.sourceSha256
    || !expected.review.linkGroupId || expected.review.linkGroupId !== actual.review.linkGroupId) return denied('SOURCE_LINK_UNVERIFIED');
  if (pair.some(e => e.claim.memberMapping.assertion !== 'HUMAN_REVIEWED_SAME_PHYSICAL_MEMBER' || !same(e.claim.memberMapping.identity, raw.identity)))
    return denied('PHYSICAL_MEMBER_MAPPING_UNVERIFIED');
  const applicable = raw.applicabilityDecisions.filter(d => same(d.identity, raw.identity)
    && same(d.expected, reference(expected)) && same(d.actual, reference(actual)));
  if (!applicable.length) return denied('APPLICABILITY_DECISION_MISSING');
  if (applicable.length > 1) return denied('AMBIGUOUS_APPLICABILITY_DECISION');
  const decision = applicable[0];
  if (decision.status !== 'APPROVED') return denied('APPLICABILITY_DECISION_UNVERIFIED');
  const comparison = compareSteelCatalogExample(expected.claim.declarationSnapshot.value, actual.claim.declarationSnapshot.value);
  if (comparison !== true) return denied(comparison === false ? 'NEGATIVE_SCOPE_UNVERIFIED' : 'UNSUPPORTED_CATEGORY_TRANSITION');
  return { schemaVersion: VERSION, status: 'CANDIDATE', reasonCode: 'EXPLICIT_C345_TO_C245_IN_REVIEWED_SAME_MEMBER', identity: deep(raw.identity),
    comparison: deep({ scope: 'HUMAN_REVIEWED_PHYSICAL_MEMBER_AND_DECLARATION_APPLICABILITY_ONLY' as const,
      expected: reference(expected), actual: reference(actual), expectedValue: 'С345' as const, actualValue: 'С245' as const,
      applicabilityDecisionId: decision.decisionId, applicabilityDecisionContentHash: decision.contentHash }), calibratedProbability: null };
}

/** Staging DTO only. No snapshots, PDF authentication or automatic applicability decision. */
export function validateSteelComparisonScopeRequest(raw: unknown): SteelComparisonScopeRequest | null {
  if (native(raw, 524_288).status !== 'VALID' || !scope(raw, false)) return null;
  const value = raw as SteelComparisonScopeRequest;
  if (new Set(value.claims.map(c => c.target.declarationId)).size !== value.claims.length) return null;
  return deep(value);
}
/** Detach request fields after structural and snapshot/hash self-consistency checks only. */
export function projectSteelComparisonScopeDecision(raw: unknown): SteelComparisonScopeRequest | null {
  if (native(raw).status !== 'VALID' || !scope(raw, true)) return null;
  const value = raw as SteelComparisonScopeDecision;
  if (duplicateClaims(value.claims)) return null;
  const first = value.claims[0]?.declarationSnapshot;
  for (const c of value.claims) {
    const d = c.declarationSnapshot;
    if (d.sourceFileId !== first!.sourceFileId || d.sourceSha256 !== first!.sourceSha256 || d.textArtifactHash !== c.target.textArtifactHash
      || d.id !== c.target.declarationId || sourceDeclarationId(d) !== d.id) return null;
  }
  return { schemaVersion: SCOPE, claims: value.claims.map(c => ({ target: deep(c.target), identity: deep(c.identity), memberMapping: deep(c.memberMapping) })) };
}

/** API-internal reuse for the typed wrapper; not a contracts runtime export. */
export const steelComparisonExecutionInternal = Object.freeze({
  native, identity, source, origin, applicability, referenceShape, collectionLimit, validateRetained,
});
