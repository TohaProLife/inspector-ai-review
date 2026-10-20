/** Independent whole original native vertical source lines; no engineering interpretation. */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readDocumentTextV3Artifact,readDocumentTextV3LargeArtifact,documentTextV3ContentHash,documentTextV3LargeContentHash} from '../src/document-text-v3.js';
import {buildDocumentTextV3AuditReleaseTextLayer} from '../src/document-text-v3-audit-release.js';
const bytes=readFileSync(new URL('../../../fixtures/document-text-v3-vertical-v1/qa-whole-manual-goldens.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('acea8244f1c29256b4df0ca7ab8573c334ae6b196d24eb0b3f6a4abdb5f8735b');
const C=JSON.parse(bytes.toString());const LARGE='document-text-v3-large-source-bounds-v1';
const canonical=(v:any):string=>v!==null&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const h=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const rehash=(a:any)=>a.extractorProfileHash=h({hashDomain:'document-text-extractor-profile-v1',profile:a.extractorProfile});
it('five whole native original bodies standard/large exact independent hashes and immutable',()=>{
 for(const c of C.cases){const a=structuredClone(c.artifact),before=structuredClone(a);expect(readDocumentTextV3Artifact(a),c.name).toEqual(c.expectedRead);expect(readDocumentTextV3LargeArtifact(a)).toEqual({...c.expectedRead,resourcePolicyVersion:LARGE});expect(documentTextV3ContentHash(a)).toBe(c.expectedRead.contentHash);expect(documentTextV3LargeContentHash(a)).toBe(c.expectedRead.contentHash);expect(a).toEqual(before);}
});
it('original source SHA/raw and crop native order preserve whole lines without visibility claim',()=>{
 for(const c of C.cases)expect(createHash('sha256').update(readFileSync(new URL('../../../'+c.originalPath,import.meta.url))).digest('hex')).toBe(c.originalSha256);
 const p=C.cases.find((x:any)=>x.name==='crop-and-offcrop').artifact.pages[0];expect(p.locatedLines.map((x:any)=>[x.sourcePath,x.rawText])).toEqual([[[0,0],'500\n'],[[3,0],'H\n'],[[4,0,0,0],'1500\n']]);expect(readDocumentTextV3Artifact(C.cases[4].artifact)).toEqual(C.cases[4].expectedRead);
});
it('all three historical profiles retain exact old bodies and hashes; release selector unchanged',()=>{
 for(const [dir,file]of[['document-text-v3-v1','qa-core-manual-goldens.json'],['document-text-v3-figures-v1','qa-core-manual-goldens.json'],['document-text-v3-stable-v1','qa-whole-manual-goldens.json']]){const old=JSON.parse(readFileSync(new URL(`../../../fixtures/${dir}/${file}`,import.meta.url),'utf8'));for(const c of old.cases){const before=structuredClone(c.artifact);expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);expect(documentTextV3ContentHash(c.artifact)).toBe(c.expectedRead.contentHash);expect(c.artifact).toEqual(before);}}
 expect(buildDocumentTextV3AuditReleaseTextLayer().extractorProfile.traversalPolicyVersion).toBe('pdfminer-analyzed-figures-boxes-flow-none-v1');
});
it('profile/raw/frame/path/quality tampering rejects full artifact and hash',()=>{
 const mutations=[(a:any)=>a.extractorProfileHash='f'.repeat(64),(a:any)=>a.extractorProfile.traversalPolicyVersion='guessed',(a:any)=>a.pages[0].locatedLines[0].rawText+='\ufffd',(a:any)=>a.pages[0].widthMilliPoints++,(a:any)=>a.pages[0].locatedLines[1].sourcePath=[0,0],(a:any)=>a.pages[0].quality.metrics.locatedLineCount++];
 for(const mutate of mutations){const a=structuredClone(C.cases[0].artifact);mutate(a);expect(readDocumentTextV3Artifact(a)).toEqual({status:'ABSTAIN',reasonCode:'INVALID_TEXT_ARTIFACT'});expect(()=>documentTextV3ContentHash(a)).toThrow();}
});
it('new path64/index32767 exact boundary; old top-level path2 remains strict',()=>{
 const a=structuredClone(C.cases[0].artifact);a.pages[0].locatedLines=a.pages[0].locatedLines.slice(0,1);a.pages[0].locatedLines[0].sourcePath=Array(64).fill(32767);a.pages[0].quality.metrics.locatedLineCount=1;a.pages[0].quality.metrics.locatedNonWhitespaceCharacters=3;
 expect(readDocumentTextV3Artifact(a)).toEqual({status:'VALID',contentHash:h({hashDomain:'document-text-v3-content-v1',artifact:a})});
 for(const path of [Array(65).fill(0),[32768]]){const b=structuredClone(a);b.pages[0].locatedLines[0].sourcePath=path;expect(readDocumentTextV3Artifact(b)).toEqual({status:'ABSTAIN',reasonCode:'INVALID_TEXT_ARTIFACT'});}
 a.extractorProfile.traversalPolicyVersion='pdfminer-top-level-whole-lines-v1';rehash(a);expect(readDocumentTextV3Artifact(a)).toEqual({status:'ABSTAIN',reasonCode:'INVALID_TEXT_ARTIFACT'});
});
it('native accessor/proxy/sparse/cycle/float/surrogate rejected with zero callbacks',()=>{
 let calls=0;const getter=Object.defineProperty({},'x',{enumerable:true,get(){calls++;throw Error('getter');}});const proxy=new Proxy({}, {ownKeys(){calls++;throw Error('proxy');}});const cycle:any={};cycle.x=cycle;const sparse=Array(4);const values=[getter,proxy,cycle,sparse,.5,NaN,'\ud800'];
 for(const v of values){expect(readDocumentTextV3Artifact(v)).toEqual({status:'ABSTAIN',reasonCode:'INVALID_INPUT'});expect(()=>documentTextV3ContentHash(v)).toThrow();}expect(calls).toBe(0);
});
