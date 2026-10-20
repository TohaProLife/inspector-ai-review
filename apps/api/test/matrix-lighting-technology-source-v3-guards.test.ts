import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {
  lightingTechnologyV3DeclarationContentHash,
  reconstructLightingTechnologySourceV3,
} from '../src/matrix-lighting-technology-source-v3.js';

const bytes = readFileSync(new URL('../../../fixtures/matrix-lighting-technology-source-v3-v1/qa-guard-regression-goldens.json', import.meta.url));
if (createHash('sha256').update(bytes).digest('hex') !== '601c6fac3e51cca363922d98eb091493b65ad890217a8a5e173d89d6a7d839c8') throw Error('frozen manual changed');
const manual = JSON.parse(bytes.toString('utf8'));

describe('additive lighting-v3 hash and key guard regressions', () => {
  it('rejects all five parser/native-geometry forgeries without mutation', () => {
    expect(manual.hashCases).toHaveLength(5);
    for (const c of manual.hashCases) {
      expect(c.expected).toBe('THROW');
      const input = structuredClone(c.declaration), before = structuredClone(input);
      expect(() => lightingTechnologyV3DeclarationContentHash(input), c.name).toThrow();
      expect(input).toEqual(before);
    }
  });
  it('preserves the three exact consumer-key versus full-source-key diagnostics', () => {
    expect(manual.sourceCases).toHaveLength(3);
    for (const c of manual.sourceCases) {
      const input = structuredClone(c.input), before = structuredClone(input);
      expect(reconstructLightingTechnologySourceV3(input), c.name).toEqual(c.expected);
      expect(input).toEqual(before);
    }
  });
});
