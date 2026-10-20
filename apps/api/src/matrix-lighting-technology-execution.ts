/** Typed lighting consistency. Protected loaders still own PDF, actor and sealed-origin authority. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { readFileSync } from 'node:fs';
import type { MatrixCoverage } from '@inspector-ai/contracts';
import type { LightingTechnologyComparisonIdentity as Identity, LightingTechnologyComparisonResult as Comparison, LightingTechnologyComparisonSource as Source } from '@inspector-ai/contracts';
import type { LightingTechnologyExecutionLoaderPackage as Loader, LightingTechnologyExecutionComparisons as Envelope, LightingTechnologyExecutionExecutionResult as Result, LightingTechnologyExecutionEvidence as Evidence } from '@inspector-ai/contracts';
import { compareZu130LightingTechnologies, projectLightingTechnologyScopeDecision } from './matrix-lighting-technology-comparison.js';
import { reconstructLightingTechnologySourceV3, lightingTechnologyV3DeclarationContentHash } from './matrix-lighting-technology-source-v3.js';

type Obj = Record<string, any>;
const fail = (why: string): never => { throw Error(`Lighting execution integrity: ${why}`); };
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const nonnegative = (v: unknown): v is number => integer(v) && v >= 0;
const record = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !types.isProxy(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: unknown, keys: readonly string[]): v is Obj => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}(?![\s\S])/u.test(v);
const trim = (v: string) => v.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '');
const key = (v: unknown): v is string => typeof v === 'string' && [...v].length > 0 && [...v].length <= 200 && trim(v) === v && !/[\u0000-\u0008\u000a-\u001f\u2028\u2029\ufffd]/u.test(v);
const codepoints = (a: string, b: string): number => {
  const x = Array.from(a, c => c.codePointAt(0)!), y = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
/** Descriptor-first portable JSON, including encoded punctuation in the total byte budget. */
function encoded(input: unknown): string {
  let nodes = 0, rawBytes = 0;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): string {
    if (++nodes > 200000 || depth > 64) fail('native limit');
    if (v === null) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return integer(v) ? String(v) : fail('native integer');
    if (typeof v === 'string') {
      if (v.length > 4000000) fail('native string limit');
      let points = 0;
      for (const c of v) { const cp = c.codePointAt(0)!; if (++points > 2000000) fail('native string limit'); if (cp >= 0xd800 && cp <= 0xdfff) fail('Unicode scalar'); }
      rawBytes += Buffer.byteLength(v, 'utf8'); if (rawBytes > 8000000) fail('native byte limit');
      return JSON.stringify(v);
    }
    if (!v || typeof v !== 'object' || types.isProxy(v) || ancestors.has(v)) return fail('native object');
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype)) fail('native prototype');
    const descriptors = Object.getOwnPropertyDescriptors(v), names = Reflect.ownKeys(descriptors);
    if (names.some(k => typeof k !== 'string')) fail('native symbol');
    let keys: string[];
    if (array) {
      const length = descriptors.length?.value;
      if (!nonnegative(length) || length > 32768 || names.length !== length + 1) return fail('native array');
      keys = Array.from({length}, (_, i) => String(i));
    } else { if (names.length > 32768) fail('native container'); keys = (names as string[]).sort(codepoints); }
    ancestors.add(v);
    const parts: string[] = [];
    for (const k of keys) {
      const d = descriptors[k]; if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('native descriptor');
      const name = array ? '' : visit(k, depth + 1), value = visit(d.value, depth + 1);
      parts.push(array ? value : `${name}:${value}`);
    }
    ancestors.delete(v);
    return array ? `[${parts.join(',')}]` : `{${parts.join(',')}}`;
  }
  const output = visit(input, 0); if (Buffer.byteLength(output, 'utf8') > 8000000) fail('encoded byte limit'); return output;
}
const clone = <T>(v: T): T => JSON.parse(encoded(v)) as T;
const same = (a: unknown, b: unknown) => encoded(a) === encoded(b);
const hash = (v: unknown) => createHash('sha256').update(encoded(v)).digest('hex');
const RULE = 'matrix-zu-130-declared_led_technology_replacement';
const GAP = 'PARTIAL_SUBRULES_ONLY:REVIEWED_NAMED_LUMINAIRE_LIGHT_SOURCE_POSITION_PD_LED_TO_RD_FLUORESCENT_OR_INCANDESCENT_ONLY;UNNAMED_GROUPS_OTHER_TECHNOLOGIES_EFFICIENCY_CAPACITY_QUANTITIES_CONTROLS_AND_NORMATIVE_COMPLIANCE_UNSUPPORTED';
const REGISTRY = {schemaVersion: 'matrix-lighting-technology-capabilities-v1', entries: [{parameterCode: 'ZU-130', matrixCode: 'M-130', ruleId: RULE, ruleVersion: '1', enabled: true, comparisonVariant: 'PD_RD', family: 'ENUM_TRANSITION', executionKind: 'REVIEWED_NAMED_LIGHTING_TECHNOLOGY', resultSchemaVersion: 'matrix-zu130-lighting-technology-comparison-v1', partialGap: GAP}]};
export const LIGHTING_TECHNOLOGY_CAPABILITY_REGISTRY = clone(REGISTRY);
export const lightingTechnologyCapabilityRegistryHash = hash(REGISTRY);
const registry = (raw: unknown) => { if (!same(raw, REGISTRY)) fail('capability registry'); };
const integrity = new Set(['INVALID_INPUT', 'INPUT_LIMIT', 'SOURCE_PROVENANCE_UNVERIFIED', 'DECLARATION_RECONSTRUCTION_UNVERIFIED']);
const operational = new Set(['SOURCE_STAGE_UNVERIFIED', 'POSITION_IDENTITY_CONFLICT', 'AMBIGUOUS_DECLARATION_SCOPE', 'MATCHED_DECLARATION_PAIR_UNVERIFIED', 'SOURCE_REVIEW_UNVERIFIED', 'SOURCE_SECTION_UNVERIFIED', 'LINK_SCOPE_UNVERIFIED', 'NAMED_POSITION_UNVERIFIED', 'POSITION_MAPPING_UNVERIFIED', 'DIRECTED_TRANSITION_UNSUPPORTED']);
const check = (c: Comparison) => { if (c.status === 'ABSTAIN' && integrity.has(c.reasonCode)) fail(c.reasonCode); };
const identity = (v: unknown): v is Identity => exact(v, ['entityKey', 'buildingKey', 'systemKey', 'positionKey', 'componentRole']) && ['entityKey', 'buildingKey', 'systemKey', 'positionKey'].every(k => key(v[k])) && v.componentRole === 'LUMINAIRE_LIGHT_SOURCE';
const sentinel: Identity = {entityKey: 'wrapper-structural-boundary', buildingKey: 'wrapper-structural-boundary', systemKey: 'wrapper-structural-boundary', positionKey: 'wrapper-structural-boundary', componentRole: 'LUMINAIRE_LIGHT_SOURCE'};
const projection = (pkg: Pick<Loader, 'objectId'|'inputManifestHash'|'sources'|'origins'>, id: Identity) => ({schemaVersion: 'matrix-zu130-lighting-technology-comparison-input-v1', objectId: pkg.objectId, inputManifestHash: pkg.inputManifestHash, identity: id, sources: pkg.sources, origins: pkg.origins});

/** Source-only helper: exact DTO/associations, without claiming full-origin authority. */
export function deriveLightingTechnologyIdentities(raw: unknown): Identity[] {
  encoded(raw); if (!Array.isArray(raw) || raw.length > 64) fail('identity sources');
  const sources = clone(raw) as Source[], ids = new Map<string, Identity>(); let total = 0;
  for (const s of sources) {
    if (!record(s)) fail('source DTO');
    const r = s.review;
    if (record(r) && Object.hasOwn(r, 'lightingTechnologyScope') && r.lightingTechnologyScope !== null) {
      const projected = projectLightingTechnologyScopeDecision(r.lightingTechnologyScope);
      if (!projected) fail('scope DTO/hash');
      const claims = r.lightingTechnologyScope.claims;
      if ((total += claims.length) > 128) fail('total claim limit');
      for (const c of claims) {
        if (c.declarationSnapshot.sourceFileId !== s.sourceFileId || c.declarationSnapshot.sourceSha256 !== s.sourceSha256) fail('snapshot source association');
        ids.set(encoded(c.identity), c.identity);
      }
      r.lightingTechnologyScope = {...r.lightingTechnologyScope, claims: []};
    }
  }
  const objectId = sources.find(s => record(s) && record(s.review))?.review?.objectId ?? 'wrapper-structural-boundary';
  check(compareZu130LightingTechnologies(projection({objectId, inputManifestHash: '0'.repeat(64), sources, origins: []}, sentinel)));
  return clone([...ids.entries()].sort(([a], [b]) => codepoints(a, b)).map(([, value]) => value));
}

/** All retained claims are rebuilt before interpreting even an operational refusal. */
export function validateLightingTechnologyLoaderPackage(raw: unknown): Loader {
  encoded(raw);
  if (!exact(raw, ['schemaVersion', 'objectId', 'inputManifestHash', 'sources', 'origins', 'identities']) || raw.schemaVersion !== 'matrix-zu130-lighting-technology-loader-inputs-v1' || !key(raw.objectId) || !sha(raw.inputManifestHash) || !Array.isArray(raw.sources) || raw.sources.length > 64 || !Array.isArray(raw.origins) || raw.origins.length > 128 || !Array.isArray(raw.identities) || raw.identities.length > 128 || !raw.identities.every(identity)) fail('loader DTO');
  const pkg = raw as Loader, ids = deriveLightingTechnologyIdentities(pkg.sources);
  if (!same(ids, pkg.identities)) fail('claim-derived identities');
  // Comparator validates every full origin and association before its stage gate.
  check(compareZu130LightingTechnologies(projection(pkg, sentinel)));
  const origins = new Map(pkg.origins.map(o => [encoded([o.sourceFileId, o.checkId]), o]));
  for (const s of pkg.sources) for (const c of s.review?.lightingTechnologyScope?.claims ?? []) {
    const o = origins.get(encoded([s.sourceFileId, c.target.checkId])) ?? fail('claim origin');
    const snapshot = c.declarationSnapshot;
    // Snapshot stage reconstructs immutable content only. Current eligibility remains the comparator's job.
    const rebuilt = reconstructLightingTechnologySourceV3({sourceFileId: s.sourceFileId, sourceSha256: s.sourceSha256, stage: snapshot.stage, pageStages: s.review!.pageStages, textArtifact: o.textArtifact, selection: c.selection});
    if (rebuilt.status !== 'RECONSTRUCTED' || !same(rebuilt.declaration, snapshot) || snapshot.textArtifactHash !== o.textArtifactHash || lightingTechnologyV3DeclarationContentHash(snapshot) !== c.target.declarationContentHash) fail('full claim reconstruction');
  }
  for (const id of ids) check(compareZu130LightingTechnologies(projection(pkg, id)));
  return clone(pkg);
}
const common = {schemaVersion: 'matrix-lighting-technology-execution-result-v1', ruleId: RULE, ruleVersion: '1', parameterCode: 'ZU-130', comparisonVariant: 'PD_RD'} as const;
const resultId = (e: Pick<Envelope, 'objectId'|'inputManifestHash'|'capabilityRegistryHash'>, r: Obj) => { const {id: _, ...body} = r; return hash({hashDomain: 'matrix-lighting-technology-execution-result-id-v1', objectId: e.objectId, inputManifestHash: e.inputManifestHash, capabilityRegistryHash: e.capabilityRegistryHash, result: body}); };
export function buildLightingTechnologyComparisons(raw: unknown, rawRegistry: unknown = REGISTRY): Envelope {
  registry(rawRegistry); const pkg = validateLightingTechnologyLoaderPackage(raw);
  const envelope: Envelope = {schemaVersion: 'matrix-lighting-technology-comparisons-v1', purpose: 'MACHINE_COMPARISON', objectId: pkg.objectId, inputManifestHash: pkg.inputManifestHash, capabilityRegistryHash: lightingTechnologyCapabilityRegistryHash, results: []};
  const bodies = pkg.identities.length ? pkg.identities.map(id => ({...common, kind: 'SCOPED_COMPARISON', identity: id, comparison: compareZu130LightingTechnologies(projection(pkg, id))})) : [{...common, kind: 'UNBOUND_ATOM_ABSTENTION', reasonCode: 'REVIEWED_LIGHTING_POSITION_IDENTITY_MISSING', calibratedProbability: null}];
  envelope.results = bodies.map(r => ({...r, id: resultId(envelope, r)}) as Result);
  return validateLightingTechnologyComparisons(envelope);
}
function reference(v: unknown): boolean { return exact(v, ['sourceFileId', 'sourceSha256', 'reviewDecisionId', 'reviewContentHash', 'declarationContentHash']) && key(v.sourceFileId) && key(v.reviewDecisionId) && [v.sourceSha256, v.reviewContentHash, v.declarationContentHash].every(sha); }
function comparison(v: unknown, id: Identity): boolean {
  if (!record(v) || v.schemaVersion !== 'matrix-zu130-lighting-technology-comparison-v1' || v.calibratedProbability !== null) return false;
  if (v.status === 'ABSTAIN') return exact(v, ['schemaVersion', 'status', 'reasonCode', 'calibratedProbability']) && operational.has(v.reasonCode);
  return exact(v, ['schemaVersion', 'status', 'ruleId', 'ruleVersion', 'parameterCode', 'reasonCode', 'calibratedProbability', 'comparisonScope', 'identity', 'expected', 'actual', 'expectedTechnology', 'actualTechnology']) && v.status === 'CANDIDATE' && v.ruleId === RULE && v.ruleVersion === '1' && v.parameterCode === 'ZU-130' && v.reasonCode === 'LED_REPLACED_BY_FLUORESCENT_OR_INCANDESCENT' && v.comparisonScope === 'REVIEWED_NAMED_LUMINAIRE_LIGHT_SOURCE_POSITION_ONLY' && identity(v.identity) && same(v.identity, id) && reference(v.expected) && reference(v.actual) && v.expected.sourceFileId !== v.actual.sourceFileId && v.expected.sourceSha256 !== v.actual.sourceSha256 && v.expectedTechnology === 'LED' && ['FLUORESCENT', 'INCANDESCENT'].includes(v.actualTechnology);
}
/** Structural/hash validation only; evidence/seal/read must rebuild from authenticated sources. */
export function validateLightingTechnologyComparisons(raw: unknown): Envelope {
  encoded(raw);
  if (!exact(raw, ['schemaVersion', 'purpose', 'objectId', 'inputManifestHash', 'capabilityRegistryHash', 'results']) || raw.schemaVersion !== 'matrix-lighting-technology-comparisons-v1' || raw.purpose !== 'MACHINE_COMPARISON' || !key(raw.objectId) || !sha(raw.inputManifestHash) || raw.capabilityRegistryHash !== lightingTechnologyCapabilityRegistryHash || !Array.isArray(raw.results) || raw.results.length < 1 || raw.results.length > 128) fail('envelope DTO');
  const envelope = raw as Envelope;
  let previous: string | undefined;
  for (const r of envelope.results) {
    if (!record(r) || r.schemaVersion !== common.schemaVersion || r.ruleId !== RULE || r.ruleVersion !== '1' || r.parameterCode !== 'ZU-130' || r.comparisonVariant !== 'PD_RD' || !sha(r.id)) fail('result DTO');
    if (r.kind === 'UNBOUND_ATOM_ABSTENTION') {
      if (!exact(r, ['schemaVersion', 'id', 'ruleId', 'ruleVersion', 'parameterCode', 'comparisonVariant', 'kind', 'reasonCode', 'calibratedProbability']) || envelope.results.length !== 1 || r.reasonCode !== 'REVIEWED_LIGHTING_POSITION_IDENTITY_MISSING' || r.calibratedProbability !== null) fail('unbound result');
    } else if (r.kind === 'SCOPED_COMPARISON') {
      if (!exact(r, ['schemaVersion', 'id', 'ruleId', 'ruleVersion', 'parameterCode', 'comparisonVariant', 'kind', 'identity', 'comparison']) || !identity(r.identity) || !comparison(r.comparison, r.identity)) fail('scoped result');
      const k = encoded(r.identity); if (previous !== undefined && codepoints(previous, k) >= 0) fail('identity order'); previous = k;
    } else fail('result kind');
    if (resultId(raw as Envelope, r) !== r.id) fail('result ID');
  }
  return clone(raw as Envelope);
}
export function lightingTechnologyComparisonEvidence(rawPackage: unknown, rawEnvelope: unknown, rawRegistry: unknown = REGISTRY): Evidence[] {
  const pkg = validateLightingTechnologyLoaderPackage(rawPackage), envelope = validateLightingTechnologyComparisons(rawEnvelope);
  if (!same(envelope, buildLightingTechnologyComparisons(pkg, rawRegistry))) fail('evidence envelope reconstruction');
  const items: Evidence[] = [];
  for (const result of envelope.results) {
    if (result.kind !== 'SCOPED_COMPARISON' || result.comparison.status !== 'CANDIDATE') continue;
    for (const role of ['EXPECTED', 'ACTUAL'] as const) {
      const ref = result.comparison[role === 'EXPECTED' ? 'expected' : 'actual'];
      const source = pkg.sources.find(s => s.sourceFileId === ref.sourceFileId && s.sourceSha256 === ref.sourceSha256 && s.review?.decisionId === ref.reviewDecisionId && s.review?.contentHash === ref.reviewContentHash) ?? fail('evidence source');
      const claims = (source.review!.lightingTechnologyScope?.claims ?? []).filter(c => same(c.identity, result.identity) && c.target.declarationContentHash === ref.declarationContentHash);
      if (claims.length !== 1) fail('evidence claim');
      const claim = claims[0], d = claim.declarationSnapshot;
      for (const fragment of d.primaryFragments) items.push({resultId: result.id, role, ...ref, originCheckId: claim.target.checkId, pageNumber: d.pageNumber, pageFrame: {widthMilliPoints: d.pageWidthMilliPoints, heightMilliPoints: d.pageHeightMilliPoints}, nativeFrame: d.nativeFrame, fragmentRole: 'PRIMARY', fragment});
    }
  }
  return clone(items);
}
const scalarRegistry = JSON.parse(readFileSync(new URL('../../../services/worker/rules/matrix-execution-v1.json', import.meta.url), 'utf8')) as {entries: Obj[]};
const counters = ['implementedAtomicRules', 'enabledAtomicRules', 'evaluatedAtomicRules', 'successfulComparisons', 'abstentions', 'failures'];
export function mergeLightingTechnologyCoverage(raw: unknown, rawEnvelope: unknown, rawRegistry: unknown = REGISTRY): MatrixCoverage[] {
  encoded(raw); registry(rawRegistry); const envelope = validateLightingTechnologyComparisons(rawEnvelope);
  if (!Array.isArray(raw) || raw.length !== 132 || scalarRegistry.entries.length !== 132 || scalarRegistry.entries.some(e => e.atomicRules.some((r: Obj) => r.ruleId === RULE))) fail('coverage registry overlap/order');
  const rows = raw as Obj[];
  for (let i = 0; i < rows.length; i++) { const row = rows[i]; if (!exact(row, ['parameterCode', ...counters, 'executionStatus', 'reason']) || row.parameterCode !== scalarRegistry.entries[i].parameterCode || !counters.every(k => nonnegative(row[k])) || !['UNSUPPORTED', 'PARTIAL', 'EVALUATED', 'TECHNICAL_FAILURE'].includes(row.executionStatus) || typeof row.reason !== 'string') fail('coverage row'); }
  const base = rows.find(r => r.parameterCode === 'ZU-130'); if (!base || base.executionStatus !== 'UNSUPPORTED' || !counters.every(k => base[k] === 0)) fail('lighting overlap');
  const successes = envelope.results.filter(r => r.kind === 'SCOPED_COMPARISON' && r.comparison.status === 'CANDIDATE').length;
  return clone(rows.map(row => row.parameterCode !== 'ZU-130' ? row : {...row, implementedAtomicRules: 1, enabledAtomicRules: 1, evaluatedAtomicRules: 1, successfulComparisons: successes, abstentions: envelope.results.length - successes, failures: 0, executionStatus: 'PARTIAL', reason: GAP})) as MatrixCoverage[];
}
