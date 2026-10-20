/** Owner boundaries frozen before implementation; independent whole goldens live in QA suite. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareKr056SteelDeclarations, projectSteelComparisonScopeDecision, validateSteelComparisonScopeRequest } from '../src/matrix-steel-comparison.js';
import { canonicalSourceDeclarationJson } from '../src/matrix-source-declarations.js';

const fixture = (name: string, pin: string): any => {
  const bytes = readFileSync(new URL('../../../fixtures/matrix-steel-comparison-v1/' + name, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin);
  return JSON.parse(bytes.toString());
};
const whole = fixture('qa-manual-whole-goldens.json', 'ce67d3f673f286d3432903f1382db1ae46c64f0254ae0e933db2fd0b63157f4c').cases;
const projection = fixture('qa-review-projection-manual-goldens.json', '7ab47b66eef119eca587006820194f0a47eb44dbbe4710bc7ab7e49247fd3488').cases;
const candidate = (): any => structuredClone(whole.find((c: any) => c.name === 'synthetic-directed-C345-C245').input);
const identity = candidate().identity;
const expected = (reasonCode: string, selected: unknown = null) => ({ schemaVersion: 'matrix-kr056-steel-comparison-v1',
  status: 'ABSTAIN', reasonCode, identity: selected, comparison: null, calibratedProbability: null });
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('steel comparison owner finite native and helper boundaries', () => {
  it('preserves valid identity on another structural error, but never before native success', () => {
    expect(compareKr056SteelDeclarations({ identity, extra: true })).toEqual(expected('INVALID_INPUT', identity));
    let calls = 0;
    const getter = { identity };
    Object.defineProperty(getter, 'unexpected', { enumerable: true, get() { calls++; return true; } });
    expect(compareKr056SteelDeclarations(getter)).toEqual(expected('INVALID_INPUT'));
    const nestedProxy = new Proxy({}, { get() { calls++; throw new Error('get'); },
      getPrototypeOf() { calls++; throw new Error('prototype'); }, ownKeys() { calls++; throw new Error('keys'); } });
    expect(compareKr056SteelDeclarations({ identity, nestedProxy })).toEqual(expected('INVALID_INPUT'));
    expect(calls).toBe(0);
  });
  it('rejects toJSON callbacks, custom prototypes, symbols, sparse arrays, cycles and unsafe native values', () => {
    let calls = 0;
    const cycle: any = { identity }; cycle.cycle = cycle;
    const symbol = { identity, [Symbol('x')]: 1 };
    for (const input of [{ identity, toJSON() { calls++; return {}; } }, Object.create(null), Object.create({}),
      symbol, new Array(2), cycle, { value: 1.1 }, { value: Infinity }, { value: Number.MAX_SAFE_INTEGER + 1 },
      { value: '\ud800' }, { value: undefined }, { value: 1n }]) {
      expect(compareKr056SteelDeclarations(input)).toEqual(expected('INVALID_INPUT'));
    }
    expect(calls).toBe(0);
  });
  it.each([false, true])('counts full encoded UTF8 including escaping and punctuation (escaped=%s)', escaped => {
    const padding = Array.from({ length: 3 }, () => escaped ? '\n'.repeat(1_000_000) : 'x'.repeat(2_000_000));
    const input = { identity, padding: [...padding, ''] };
    input.padding[3] = 'x'.repeat(8_000_000 - bytes(input));
    expect(bytes(input)).toBe(8_000_000);
    expect(compareKr056SteelDeclarations(input)).toEqual(expected('INVALID_INPUT', identity));
    input.padding[3] += 'x';
    expect(bytes(input)).toBe(8_000_001);
    expect(compareKr056SteelDeclarations(input)).toEqual(expected('INPUT_LIMIT'));
  });
  it('counts keys as nodes and treats depth root as zero', () => {
    const keyed = Array.from({ length: 23_000 }, () => ({ a: 1, b: 2, c: 3, d: 4 }));
    expect(compareKr056SteelDeclarations(keyed)).toEqual(expected('INPUT_LIMIT'));
    let nested: unknown = null;
    for (let i = 0; i < 64; i++) nested = [nested];
    expect(compareKr056SteelDeclarations(nested)).toEqual(expected('INVALID_INPUT'));
    expect(compareKr056SteelDeclarations([nested])).toEqual(expected('INPUT_LIMIT'));
    expect(compareKr056SteelDeclarations(Array(32_769).fill(null))).toEqual(expected('INPUT_LIMIT'));
  });
  it('accepts exactly524288 encoded request bytes and rejects one extra byte without throwing', () => {
    const request = structuredClone(projection[0].expectedRequest);
    const fragment = request.claims[0].memberMapping.scopeFragments[0];
    fragment.rawText = '';
    fragment.rawText = 'x'.repeat(524_288 - bytes(request));
    expect(bytes(request)).toBe(524_288);
    expect(validateSteelComparisonScopeRequest(request)).toEqual(request);
    fragment.rawText += 'x';
    expect(validateSteelComparisonScopeRequest(request)).toBeNull();
  });
  it('detaches staged requests and projections, and rejects target/snapshot self-inconsistency', () => {
    const decision = structuredClone(projection[0].decision);
    const before = structuredClone(decision);
    const result = projectSteelComparisonScopeDecision(decision)!;
    const staged = validateSteelComparisonScopeRequest(result)!;
    staged.claims[0].identity.memberKey = 'modified';
    staged.claims[0].memberMapping.scopeFragments[0].bboxMilliPoints[0]++;
    expect(decision).toEqual(before);
    expect(result).toEqual(projection[0].expectedRequest);
    decision.claims[0].target.textArtifactHash = 'f'.repeat(64);
    expect(projectSteelComparisonScopeDecision(decision)).toBeNull();
  });
  it('verifies an unselected malformed applicability decision before unbound selection', () => {
    const input = candidate();
    input.identity.memberKey = 'UNSELECTED';
    input.applicabilityDecisions[0].contentHash = 'f'.repeat(64);
    expect(compareKr056SteelDeclarations(input)).toEqual(expected('APPLICABILITY_DECISION_UNVERIFIED', input.identity));
  });
  it('rejects syntactically valid out-of-range current or original page keys as provenance before selection', () => {
    for (const original of [false, true]) {
      const input = candidate();
      const page = '9'.repeat(5000);
      if (original) input.origins[0].pageStages = { [page]: 'PD' };
      else input.sources[0].review.pageStages = { [page]: 'PD' };
      expect(compareKr056SteelDeclarations(input)).toEqual(expected('SOURCE_PROVENANCE_UNVERIFIED', input.identity));
    }
  });
  it('binds text stage content hash to plain artifact bytes even when every pair target is rebound', () => {
    const input = candidate();
    const hash = 'e'.repeat(64);
    input.origins[0].target.textStageContentHash = hash;
    input.sources[0].review.steelComparisonScope.claims[0].target.textStageContentHash = hash;
    const decision = input.applicabilityDecisions[0];
    decision.expected.target.textStageContentHash = hash;
    const { contentHash: _hash, ...body } = decision;
    decision.contentHash = createHash('sha256').update(canonicalSourceDeclarationJson({
      hashDomain: 'matrix-kr056-steel-applicability-decision-json-v1', decision: body,
    })).digest('hex');
    expect(compareKr056SteelDeclarations(input)).toEqual(expected('SOURCE_PROVENANCE_UNVERIFIED', input.identity));
  });
  it('retains immutable parser bytes and canonical schema', () => {
    for (const [path, pin] of [
      ['../src/matrix-source-declarations.ts', 'f3e99dc130ec99fa0ab7ee8aebb6480349c00a21fcfd769fd39fa103eda3e58a'],
      ['../../../packages/contracts/src/matrix-source-declarations.ts', '6a4c5f8b4115a110df1a509cb3ecdc16505c5506956a590d8e8b54e0b952825b'],
      ['../../../packages/contracts/src/matrix-steel-comparison.schema.json', 'cb3a8f8041a3b808c7c7e4fb26f6d8d4b0c6cdd23b8515cfa065dbdd508e6f11'],
    ]) expect(createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')).toBe(pin);
  });
});
