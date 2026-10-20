import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readDocumentTextV3Artifact,documentTextV3ContentHash } from '../src/document-text-v3.js';
const bytes=readFileSync(new URL('../../../fixtures/document-text-v3-v1/qa-rotation-manual-goldens.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('6eabbca0c2c53b03b145bd2b0a95f13f1365b16086943bce5fb0e7f5ad202c5a');
for(const c of JSON.parse(bytes.toString()).cases)it(c.name,()=>{const before=structuredClone(c.artifact);expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);expect(documentTextV3ContentHash(c.artifact)).toBe(c.expectedRead.contentHash);expect(c.artifact).toEqual(before);});
