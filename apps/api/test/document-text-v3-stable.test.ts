import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readDocumentTextV3Artifact,documentTextV3ContentHash} from '../src/document-text-v3.js';
import {buildDocumentTextV3AuditReleaseTextLayer,validateDocumentTextV3AuditRelease} from '../src/document-text-v3-audit-release.js';
const bytes=readFileSync(new URL('../../../fixtures/document-text-v3-stable-v1/qa-whole-manual-goldens.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('f4ecc2e66b67419b10782d577936975d337abd4a7337038e5874478d59272eb1');
const corpus=JSON.parse(bytes.toString());
const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const h=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
it('three complete stable-profile original-backed bodies/hash no mutation',()=>{
 for(const c of corpus.cases){const before=structuredClone(c.artifact);expect(readDocumentTextV3Artifact(c.artifact),c.name).toEqual(c.expectedRead);expect(documentTextV3ContentHash(c.artifact)).toBe(c.expectedRead.contentHash);expect(c.artifact).toEqual(before);}
});
it('current release selects new policy; prior immutable analyzed releases remain historical-only',()=>{
 const current=buildDocumentTextV3AuditReleaseTextLayer();expect(current.extractorProfile.traversalPolicyVersion).toBe(corpus.traversalPolicyVersion);expect(validateDocumentTextV3AuditRelease(current,{requireCurrentProducer:true})).toBe(true);
 const historical=structuredClone(current);historical.extractorProfile.traversalPolicyVersion='pdfminer-analyzed-figures-whole-lines-v1';historical.extractorProfileHash=h({hashDomain:'document-text-extractor-profile-v1',profile:historical.extractorProfile});
 expect(validateDocumentTextV3AuditRelease(historical,{requireCurrentProducer:false})).toBe(true);expect(validateDocumentTextV3AuditRelease(historical,{requireCurrentProducer:true})).toBe(false);
});
it('old profile exact full artifacts stay valid; unknown selector is never a coercion',()=>{
 for(const name of ['document-text-v3-v1','document-text-v3-figures-v1']){const old=JSON.parse(readFileSync(new URL(`../../../fixtures/${name}/qa-core-manual-goldens.json`,import.meta.url),'utf8'));for(const c of old.cases)expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);}
 const a=structuredClone(corpus.cases[0].artifact);a.extractorProfile.traversalPolicyVersion='pdfminer-guessed-order';a.extractorProfileHash=h({hashDomain:'document-text-extractor-profile-v1',profile:a.extractorProfile});expect(readDocumentTextV3Artifact(a)).toEqual({status:'ABSTAIN',reasonCode:'INVALID_TEXT_ARTIFACT'});expect(()=>documentTextV3ContentHash(a)).toThrow();
});
