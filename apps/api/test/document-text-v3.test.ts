import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readDocumentTextV3Artifact, documentTextV3ContentHash } from '../src/document-text-v3.js';
const fixture = fileURLToPath(new URL('../../../fixtures/document-text-v3-v1/qa-core-manual-goldens.json',import.meta.url));
const bytes=readFileSync(fixture); expect(createHash('sha256').update(bytes).digest('hex')).toBe('ae21c102629e8e2d88edd54b113cd25d2d62fb2dbb599788731ce1dd0b204e28');
const manual=JSON.parse(bytes.toString('utf8'));
describe('document-text-v3 independent original-backed historical manual',()=>{
 for(const c of manual.cases){
  it(`${c.name}: complete historical artifact and whole hash`,()=>{ const before=JSON.stringify(c.artifact);expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);expect(documentTextV3ContentHash(c.artifact)).toBe(c.expectedRead.contentHash);expect(JSON.stringify(c.artifact)).toBe(before); });
 }
 it('no fabricated located bbox on unlocated literal',()=>{const a=structuredClone(manual.cases[1].artifact);a.pages[0].unlocatedLines[0].bboxMilliPoints=[80000,120000,80001,120001];expect(readDocumentTextV3Artifact(a)).toEqual({status:'ABSTAIN',reasonCode:'INVALID_TEXT_ARTIFACT'});expect(()=>documentTextV3ContentHash(a)).toThrow();});
});
