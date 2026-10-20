import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as dut from '../src/matrix-column-pylon-section-execution.js';

const oracle = JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json', import.meta.url), 'utf8'));
const clone = (x: any): any => JSON.parse(JSON.stringify(x));
const api: any = dut;
function rejected(run: () => unknown, code: string) {
  try { run(); } catch (error) { expect((error as any).code).toBe(code); return; }
  throw new Error(`Expected ${code}`);
}
function operation(c: any) {
  const optional = Object.hasOwn(c, 'registry') ? [c.registry] : [];
  switch (c.operation) {
    case 'build': return api.buildColumnPylonSectionComparisons(c.package, c.snapshot, ...optional);
    case 'validate': return api.validateColumnPylonSectionComparisons(c.envelope);
    case 'evidence': return api.columnPylonSectionComparisonEvidence(c.package, c.snapshot, c.envelope, ...optional);
    case 'merge': return api.mergeColumnPylonSectionCoverage(c.coverage, c.envelope, ...optional);
    default: throw new Error(`Unknown frozen operation ${c.operation}`);
  }
}
describe('independent T83 full-package execution', () => {
  it('matches all sixteen whole envelopes, evidence and 132 coverage rows without mutating inputs', () => {
    for (const original of oracle.wholeCases) {
      const c = clone(original); const before = JSON.stringify(c);
      expect(api.validateColumnPylonSectionLoaderPackage(c.package, c.snapshot), c.name).toEqual(c.package);
      const envelope = api.buildColumnPylonSectionComparisons(c.package, c.snapshot);
      expect(envelope, c.name).toEqual(c.expected.envelope);
      expect(api.validateColumnPylonSectionComparisons(envelope), c.name).toEqual(c.expected.envelope);
      expect(api.columnPylonSectionComparisonEvidence(c.package, c.snapshot, envelope), c.name).toEqual(c.expected.evidence);
      expect(api.mergeColumnPylonSectionCoverage(oracle.baseCoverage, envelope), c.name).toEqual(c.expected.coverage);
      expect(JSON.stringify(c), c.name).toBe(before);
    }
  }, 120000);
  it('rejects nineteen independent retained-integrity, snapshot, standalone, registry and coverage vectors at the frozen stage', () => {
    for (const c of oracle.throwCases) rejected(() => operation(clone(c)), c.expectedErrorCode);
  }, 120000);
  it('calculates exact inclusion for nineteen inputs, globally checking present SHA before missing operands', () => {
    for (const original of oracle.inclusionCases) {
      const c = clone(original); const before = JSON.stringify(c);
      if (c.expectedErrorCode) rejected(() => api.calculateColumnPylonSectionSnapshotInclusion(c.input), c.expectedErrorCode);
      else expect(api.calculateColumnPylonSectionSnapshotInclusion(c.input), c.name).toEqual(c.expected);
      expect(JSON.stringify(c)).toBe(before);
    }
  }, 120000);
  it('rejects hostile native values before access, including sparse arrays and depth limits', () => {
    let callbacks = 0;
    const getter = Object.defineProperty({}, 'schemaVersion', { enumerable: true, get() { callbacks++; return 'forged'; } });
    const proxy = new Proxy({}, { ownKeys() { callbacks++; return []; }, get() { callbacks++; return undefined; } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    const cycle: any = {}; cycle.self = cycle;
    const sparse = new Array(1);
    for (const value of [getter, proxy, revoked.proxy, Object.create({}), cycle, sparse, { x: 0.5 }, { x: '\ud800' }]) {
      rejected(() => api.validateColumnPylonSectionLoaderPackage(value, oracle.wholeCases[0].snapshot), 'INVALID_INPUT');
    }
    expect(callbacks).toBe(0);
    let deep: any = {}; for (let i = 0; i < 70; i++) deep = { child: deep };
    rejected(() => api.validateColumnPylonSectionLoaderPackage(deep, oracle.wholeCases[0].snapshot), 'INPUT_LIMIT');
  });
  it('exports the frozen registry and detaches returned packages, envelopes and inclusion', () => {
    expect(api.columnPylonSectionCapabilityRegistry).toEqual(oracle.registry);
    expect(api.columnPylonSectionCapabilityRegistryHash).toBe(oracle.registryHash);
    const c = oracle.wholeCases[0];
    const validated = api.validateColumnPylonSectionLoaderPackage(c.package, c.snapshot);
    expect(validated).not.toBe(c.package);
    expect(validated.sources).not.toBe(c.package.sources);
    const envelope = api.validateColumnPylonSectionComparisons(c.expected.envelope);
    expect(envelope).not.toBe(c.expected.envelope); expect(envelope.results).not.toBe(c.expected.envelope.results);
    const copiedRegistry = clone(api.columnPylonSectionCapabilityRegistry); copiedRegistry.changed = true;
    expect(api.buildColumnPylonSectionComparisons(c.package, c.snapshot)).toEqual(c.expected.envelope);
  }, 120000);
});
