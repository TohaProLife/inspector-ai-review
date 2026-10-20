import { expect,it } from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readDocumentTextV3Artifact,documentTextV3ContentHash} from '../src/document-text-v3.js';
const bytes=readFileSync(new URL('../../../fixtures/document-text-v3-figures-v1/qa-core-manual-goldens.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('fd74d2d5dfd1ce782bb1e874928f754a48cdb37ccfb064ff226b15cfd2b2ff48');
for(const c of JSON.parse(bytes.toString()).cases)it(c.name+' whole new-profile artifact',()=>{const before=structuredClone(c.artifact);expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);expect(documentTextV3ContentHash(c.artifact)).toBe(c.expectedRead.contentHash);expect(c.artifact).toEqual(before);});
