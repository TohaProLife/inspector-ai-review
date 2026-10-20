import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as dut from '../src/matrix-column-pylon-section-run-snapshot.js';
const oracle = JSON.parse(readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-execution-v1/qa-whole-expectations-v2.json', import.meta.url), 'utf8'));
const api: any = dut;
function rejected(run: () => unknown, code: string) {
  try { run(); } catch (error) { expect((error as any).code).toBe(code); return; }
  throw new Error(`Expected ${code}`);
}
describe('independent T83 immutable snapshot core', () => {
  it('builds and validates four whole snapshots including BIGINT maximum and same-identity distinct pairs', () => {
    for (const c of oracle.snapshotCases) {
      const before = JSON.stringify(c);
      expect(api.buildColumnPylonSectionRunSnapshot(c.buildInput), c.name).toEqual(c.expected);
      const result = api.validateColumnPylonSectionRunSnapshot(c.expected);
      expect(result, c.name).toEqual(c.expected);
      expect(result).not.toBe(c.expected); expect(result.entries).not.toBe(c.expected.entries);
      expect(JSON.stringify(c)).toBe(before);
    }
  });
  it('rejects seven closed-shape, BIGINT, ordering and exclusion vectors without normalization', () => {
    for (const c of oracle.snapshotThrowCases) rejected(() => api.validateColumnPylonSectionRunSnapshot(c.input), c.expectedErrorCode);
  });
  it('rejects native getters, proxy and depth before shape without callbacks', () => {
    let calls = 0;
    const getter = Object.defineProperty({}, 'entries', { enumerable: true, get() { calls++; return []; } });
    const proxy = new Proxy({}, { ownKeys() { calls++; return []; } });
    for (const value of [getter, proxy, new Array(1), { x: 1.5 }, { x: '\ud800' }]) rejected(() => api.validateColumnPylonSectionRunSnapshot(value), 'INVALID_INPUT');
    expect(calls).toBe(0);
    let deep: any = {}; for (let i = 0; i < 66; i++) deep = { child: deep };
    rejected(() => api.validateColumnPylonSectionRunSnapshot(deep), 'INPUT_LIMIT');
  });
});
