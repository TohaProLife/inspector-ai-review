import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reconstructLightingTechnologySourceV3,lightingTechnologyV3DeclarationContentHash} from '../src/matrix-lighting-technology-source-v3.js';
const load=(name:string,hash:string)=>{const b=readFileSync(new URL(`../../../fixtures/matrix-lighting-technology-source-v3-v1/${name}`,import.meta.url));expect(createHash('sha256').update(b).digest('hex')).toBe(hash);return JSON.parse(b.toString());};
const C=load('qa-whole-manual-goldens.json','8e4c79db22f8b97864129a6b1d55868c277821cc3c1b776074364d39e6342feb').cases;
const V=load('qa-portable-boundary-goldens.json','dbda36639a3d5a2f7a4037aade04ff4e179a349724ebc85d617249dae4ccceb3').cases;
const RES='matrix-zu130-lighting-technology-source-v3-result-v1';
it('13 original-backed full outputs/hash and input immutability',()=>{
 expect(C).toHaveLength(13);for(const c of C){const x=structuredClone(c.input),before=structuredClone(x);const out=reconstructLightingTechnologySourceV3(x);expect(out,c.name).toEqual(c.expected);expect(x).toEqual(before);if(out.status==='RECONSTRUCTED')expect(lightingTechnologyV3DeclarationContentHash(out.declaration)).toBe(c.expectedDeclarationContentHash);}
});
it('17 exact full-artifact source/range/profile/unlocated manual boundaries',()=>{
 expect(V).toHaveLength(17);for(const c of V){const x=structuredClone(c.input),before=structuredClone(x);expect(reconstructLightingTechnologySourceV3(x),c.name).toEqual(c.expected);expect(x).toEqual(before);}
});
it('native descriptor/proxy/sparse/cycle/float guards execute zero callbacks',()=>{
 let calls=0;const getter=Object.defineProperty({},'selection',{enumerable:true,get(){calls++;throw Error('callback');}});const proxy=new Proxy({}, {ownKeys(){calls++;throw Error('callback');},get(){calls++;throw Error('callback');}});const cycle:any={};cycle.self=cycle;
 for(const value of [getter,proxy,cycle,{float:0.5},{surrogate:'\ud800'},{sparse:Array(1)}])expect(reconstructLightingTechnologySourceV3(value)).toEqual({schemaVersion:RES,status:'ABSTAIN',reasonCode:'INVALID_INPUT'});
 expect(reconstructLightingTechnologySourceV3({oversize:Array(32769).fill(null)})).toEqual({schemaVersion:RES,status:'ABSTAIN',reasonCode:'INPUT_LIMIT'});expect(calls).toBe(0);
});
it('hash helper rejects malformed exact DTO/range and authority flags',()=>{
 const valid=C[0].expected.declaration;const bad:any[]=[];for(const [k,v] of [['extra',null],['calibratedProbability',0.99],['pageWidthMilliPoints',0],['authorityStatus','APPROVED']] as Array<[string,unknown]>){const d=structuredClone(valid);d[k]=v;bad.push(d);}
 const d=structuredClone(valid);d.primaryFragments[0].usedTextRange.end=Array.from(d.primaryFragments[0].rawText).length+1;bad.push(d);const b=structuredClone(valid);b.primaryFragments[0].usedTextRange.start=true;bad.push(b);
 for(const x of bad){const before=structuredClone(x);expect(()=>lightingTechnologyV3DeclarationContentHash(x)).toThrow();expect(x).toEqual(before);}
});
it('real whole38 preserves literal ranges, no position/authority/visibility/confidence promotion',()=>{
 const c=C.at(-1);expect(c.input.textArtifact.pageCount).toBe(38);const out=reconstructLightingTechnologySourceV3(structuredClone(c.input));expect(out).toEqual(c.expected);if(out.status!=='RECONSTRUCTED')throw Error('manual expected reconstruction');const d=out.declaration;
 expect(d.textArtifactHash).toBe('4af1b87c575376089edd997387a8737e4c1178bf216241559616a01e26e215ba');expect(d.primaryFragments.map(x=>x.usedTextRange)).toEqual([{start:1,end:83},{start:0,end:51}]);expect(d.scopeStatus).toBe('UNBOUND_GROUP_DECLARATION');expect(d.positionLabel).toBeNull();expect(d.calibratedProbability).toBeNull();expect(d.renderedVisibility).toBe('UNVERIFIED');
});
it('output detached from full input and future repeated reconstruction',()=>{
 const x=structuredClone(C[0].input),before=structuredClone(x);const out=reconstructLightingTechnologySourceV3(x);if(out.status!=='RECONSTRUCTED')throw Error('manual expected reconstruction');out.declaration.primaryFragments[0].sourcePath[0]=999;out.declaration.nativeFrame.visibleBoxPointStrings[0]='999';expect(x).toEqual(before);expect(reconstructLightingTechnologySourceV3(x)).toEqual(C[0].expected);
});
