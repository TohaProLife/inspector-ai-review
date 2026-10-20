import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readDocumentTextV3Artifact, documentTextV3ContentHash } from '../src/document-text-v3.js';
function corpus(name:string,sha:string){const bytes=readFileSync(fileURLToPath(new URL(`../../../fixtures/document-text-v3-v1/${name}`,import.meta.url)));expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);return JSON.parse(bytes.toString('utf8'));}
const layouts=corpus('qa-layout-manual-goldens.json','623d3e9e84885a11d140d816d0d569b18eea7da441b74d934cb6ca3100119b03');
const portable=corpus('qa-portable-boundary-goldens.json','e9a56c23d475bb8c5abcd66f761a3af66cb71c61022528684189b07f8c519778');
for(const c of [...layouts.cases,...portable.cases])it(`whole portable ${c.name}`,()=>{const before=JSON.stringify(c.artifact);expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);if(c.expectedRead.status==='VALID')expect(documentTextV3ContentHash(c.artifact)).toBe(c.expectedRead.contentHash);else expect(()=>documentTextV3ContentHash(c.artifact)).toThrow();expect(JSON.stringify(c.artifact)).toBe(before);});
const base=()=>structuredClone(layouts.cases[0].artifact);
function reject(value:unknown,reasonCode='INVALID_INPUT'){expect(readDocumentTextV3Artifact(value)).toEqual({status:'ABSTAIN',reasonCode});expect(()=>documentTextV3ContentHash(value)).toThrow();}
it('descriptor getter never executes',()=>{let calls=0;const a=base();Object.defineProperty(a,'pages',{enumerable:true,get(){calls++;throw Error('TRAP');}});reject(a);expect(calls).toBe(0);});
it('proxy traps never execute',()=>{let calls=0;const p=new Proxy(base(),{ownKeys(){calls++;throw Error('TRAP');},get(){calls++;throw Error('TRAP');},getPrototypeOf(){calls++;throw Error('TRAP');}});reject(p);expect(calls).toBe(0);});
it('class instance rejected before user serialization',()=>{let calls=0;class X{toJSON(){calls++;return {};}}reject(new X());expect(calls).toBe(0);});
it('cycle native invalid',()=>{const a=base();a.cycle=a;reject(a);});
it('nonfinite native number invalid',()=>{const a=base();a.pages[0].heightMilliPoints=NaN;reject(a);});
it('unsafe native number invalid',()=>{const a=base();a.pages[0].heightMilliPoints=Number.MAX_SAFE_INTEGER+1;reject(a);});
it('unpaired surrogate invalid',()=>{const a=base();a.pages[0].locatedLines[0].rawText='\ud800';reject(a);});
it('codepoint string cap before semantic walk',()=>{const a=base();a.pages[0].locatedLines[0].rawText='X'.repeat(2_000_001);reject(a,'INPUT_LIMIT');});
it('container cap before semantic walk',()=>{const a=base();a.pages=Array.from({length:32769},()=>null);reject(a,'INPUT_LIMIT');});
