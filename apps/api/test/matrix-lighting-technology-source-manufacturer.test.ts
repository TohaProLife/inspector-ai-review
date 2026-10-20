import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {reconstructLightingTechnologySource} from '../src/matrix-lighting-technology-source.js';
const b=readFileSync(new URL('../../../fixtures/matrix-lighting-technology-source-v1/research-manufacturer-boundary-goldens.json',import.meta.url));
expect(createHash('sha256').update(b).digest('hex')).toBe('f44bc4c2ea033ccc0d05e8bd21061c379b69c144d24efcf24c8ca71ae68b5a09');
for(const c of JSON.parse(b.toString()).cases)it(c.name,()=>{const value=structuredClone(c.input),before=JSON.stringify(value);expect(reconstructLightingTechnologySource(value)).toEqual(c.expected);expect(JSON.stringify(value)).toBe(before);});
