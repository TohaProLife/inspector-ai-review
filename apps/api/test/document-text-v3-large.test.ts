/** Independent T76 contract tests: whole rejected originals, no partial facade. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {readDocumentTextV3Artifact,documentTextV3ContentHash,readDocumentTextV3LargeArtifact,documentTextV3LargeContentHash} from '../src/document-text-v3.js';
const F=new URL('../../../fixtures/document-text-v3-large-v1/',import.meta.url);
const bytes=readFileSync(new URL('qa-manual-expectations.json',F));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('d9fd434efb171c49b4d46493b544a5f91d3724c9df46fe11f6c57e772dfadcf8');
const M=JSON.parse(bytes.toString()),POLICY='document-text-v3-large-source-bounds-v1';
const reject=(reasonCode:string)=>({status:'ABSTAIN',resourcePolicyVersion:POLICY,reasonCode});
const whole=()=>M.wholeCases.map((c:any)=>{const b=readFileSync(new URL(c.file,F));expect(createHash('sha256').update(b).digest('hex')).toBe(c.fileSha256);return{c,a:JSON.parse(b.toString())};});
function nodes(n:number):unknown[]{let remaining=n-1;const root:unknown[]=[];while(remaining>0){remaining--;const count=Math.min(32768,remaining);root.push(Array(count).fill(0));remaining-=count;}return root;}
function byteTree(n:number):string[]{const count=20,payload=n-(3*count+1),q=Math.floor(payload/2),odd=payload%2;let left=q;const values=Array.from({length:count},()=>{const take=Math.min(left,1999999);left-=take;return '\n'.repeat(take);});if(odd)values[count-1]+='a';expect(left).toBe(0);expect(Buffer.byteLength(JSON.stringify(values))).toBe(n);return values;}
it('small full original bodies retain identical old and explicit large domain hash/result label',()=>{
 for(const c of M.smallCases){const before=structuredClone(c.artifact);expect(readDocumentTextV3Artifact(c.artifact)).toEqual(c.expectedRead);expect(readDocumentTextV3LargeArtifact(c.artifact)).toEqual({...c.expectedRead,resourcePolicyVersion:POLICY});expect(documentTextV3LargeContentHash(c.artifact)).toBe(documentTextV3ContentHash(c.artifact));expect(c.artifact).toEqual(before);}
});
it('both complete rejected originals admit only explicit large, every page/raw retained and hashed',()=>{
 for(const{c,a}of whole()){const before=JSON.stringify(a);expect(a.pages).toHaveLength(c.pageCount);expect(a.pages.reduce((n:number,p:any)=>n+p.locatedLines.length,0)).toBe(c.locatedLines);expect(readDocumentTextV3Artifact(a)).toEqual({status:'ABSTAIN',reasonCode:'INPUT_LIMIT'});expect(()=>documentTextV3ContentHash(a)).toThrow();expect(readDocumentTextV3LargeArtifact(a)).toEqual({status:'VALID',resourcePolicyVersion:POLICY,contentHash:c.expectedContentHash});expect(documentTextV3LargeContentHash(a)).toBe(c.expectedContentHash);expect(JSON.stringify(a)).toBe(before);}
},30000);
it('whole last-page/profile/raw/quality/frame/path corruption refuses even unrelated retained pages',()=>{
 const base=whole()[0].a;for(const mutate of [(a:any)=>a.extractorProfileHash='f'.repeat(64),(a:any)=>a.pages.at(-1).quality.metrics.cidPlaceholders++,(a:any)=>a.pages.at(-1).widthMilliPoints=0,(a:any)=>a.pages.at(-1).locatedLines[0].sourcePath=[],(a:any)=>a.pages.at(-1).locatedLines[0].rawText+='\ufffd']){const a=structuredClone(base);mutate(a);expect(readDocumentTextV3LargeArtifact(a)).toEqual(reject('INVALID_TEXT_ARTIFACT'));expect(()=>documentTextV3LargeContentHash(a)).toThrow();}
},30000);
it('native node counting includes root and object keys; standard/default never upgrades, exact large edge',()=>{
 for(const n of [200000,200001]){const a={k:nodes(n-2)};expect(readDocumentTextV3Artifact(a)).toEqual({status:'ABSTAIN',reasonCode:n===200000?'INVALID_TEXT_ARTIFACT':'INPUT_LIMIT'});expect(readDocumentTextV3LargeArtifact(a)).toEqual(reject('INVALID_TEXT_ARTIFACT'));}
 for(const n of [1400000,1400001])expect(readDocumentTextV3LargeArtifact({k:nodes(n-2)})).toEqual(reject(n===1400000?'INVALID_TEXT_ARTIFACT':'INPUT_LIMIT'));
},30000);
it('serialized canonical byte edges count JSON escapes/punctuation, independent string limit unchanged',()=>{
 for(const n of [8000000,8000001]){const a=byteTree(n);expect(readDocumentTextV3Artifact(a)).toEqual({status:'ABSTAIN',reasonCode:n===8000000?'INVALID_TEXT_ARTIFACT':'INPUT_LIMIT'});expect(readDocumentTextV3LargeArtifact(a)).toEqual(reject('INVALID_TEXT_ARTIFACT'));}
 for(const n of [32000000,32000001])expect(readDocumentTextV3LargeArtifact(byteTree(n))).toEqual(reject(n===32000000?'INVALID_TEXT_ARTIFACT':'INPUT_LIMIT'));
},30000);
it('common depth/container/string/pages/record bounds remain exact and precede semantics',()=>{
 for(const d of [64,65]){let a:unknown=0;for(let i=0;i<d;i++)a=[a];expect(readDocumentTextV3LargeArtifact(a)).toEqual(reject(d===64?'INVALID_TEXT_ARTIFACT':'INPUT_LIMIT'));}
 for(const a of [Array(32769).fill(0),'a'.repeat(2000001),{pages:Array(513).fill(null)},{pages:Array.from({length:4},()=>({locatedLines:Array(25001).fill(null),unlocatedLines:[]}))}])expect(readDocumentTextV3LargeArtifact(a)).toEqual(reject('INPUT_LIMIT'));
},30000);
it('native accessor/proxy/toJSON/symbol/hidden/sparse/cycle/float/surrogate reject with zero callbacks',()=>{
 let callbacks=0;const getter=Object.defineProperty({},'x',{enumerable:true,get(){callbacks++;return 1;}}),proxy=new Proxy({},{ownKeys(){callbacks++;return[];}}),toJSON={toJSON(){callbacks++;return{};}},hidden=Object.defineProperty({},'x',{value:1}),cycle:any={};cycle.x=cycle;
 for(const value of [getter,proxy,toJSON,hidden,{[Symbol('x')]:1},[,],cycle,0.5,NaN,Infinity,9007199254740992,'\ud800']){expect(readDocumentTextV3LargeArtifact(value)).toEqual(reject('INVALID_INPUT'));expect(()=>documentTextV3LargeContentHash(value)).toThrow();}expect(callbacks).toBe(0);
});
