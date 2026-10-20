import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readDocumentTextV3Artifact,documentTextV3ContentHash} from '../src/document-text-v3.js';
const bytes=readFileSync(new URL('../../../fixtures/document-text-v3-figures-v1/qa-portable-profile-path-goldens.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('079e9293fc78faf4554dddc96e5f6b8bfdede40df47ea6800f1dedbc65efd140');
for(const c of JSON.parse(bytes.toString()).cases)it(c.name,()=>{const before=structuredClone(c.artifact);expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);if(c.expectedRead.status==='VALID')expect(documentTextV3ContentHash(c.artifact)).toBe(c.expectedRead.contentHash);else expect(()=>documentTextV3ContentHash(c.artifact)).toThrow();expect(c.artifact).toEqual(before);});
