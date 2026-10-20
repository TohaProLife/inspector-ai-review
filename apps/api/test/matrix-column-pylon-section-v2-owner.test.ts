/** Owner consumer tests before implementation; whole JSON expected frozen before code. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {compareKr060ColumnPylonSection,projectColumnPylonSectionReviewDecision,materializeColumnPylonSectionReview,
 parseColumnPylonSectionReviewInput,validateColumnPylonSectionReviewDecision,columnPylonSectionPairKey} from '../src/matrix-column-pylon-section-v2.js';
import {parseColumnPylonSectionReviewWire,normalizeColumnPylonSectionReviewWire} from '../src/matrix-column-pylon-section-v2-wire.js';
const load=(name:string,hash:string):any=>{const b=readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-v2/'+name,import.meta.url));expect(createHash('sha256').update(b).digest('hex')).toBe(hash);return JSON.parse(b.toString());};
const whole=load('owner-manual-whole.json','3d8ea1c261193984bb32cb294715daa8f310d45e4796ce4932b983b9f26a2d27');
const review=load('owner-manual-review.json','f8f55140d12b268342df73b65d98efe72eb207169e77325ef1e24248d08c38d2');
const base=()=>structuredClone(whole.cases[0].input),request=()=>structuredClone(review.projectionCases[0].expected);
const failure=(reasonCode:string)=>({status:'ABSTAIN',reasonCode});
describe('KR060 v2 owner frozen whole arithmetic/provenance',()=>{
 for(const c of whole.cases)it(c.name,()=>expect(compareKr060ColumnPylonSection(structuredClone(c.input))).toEqual(c.expected));
 for(const c of review.projectionCases)it(c.name,()=>expect(projectColumnPylonSectionReviewDecision(structuredClone(c.input))).toEqual(c.expected));
 for(const c of review.materializationCases)it(c.name,()=>expect(materializeColumnPylonSectionReview(structuredClone(c.input),structuredClone(c.context))).toEqual(c.expected));
 it('detaches native requests and projections',()=>{const r=request(),before=structuredClone(r),parsed=parseColumnPylonSectionReviewInput(r)!;parsed.actual.reference='edited';expect(r).toEqual(before);const j=base().review,beforeJ=structuredClone(j),p=projectColumnPylonSectionReviewDecision(j)!;p.actual.reference='edited';expect(j).toEqual(beforeJ);expect(validateColumnPylonSectionReviewDecision(j)).toEqual(j);});
 it('rejects getters/proxy/toJSON without invoking callbacks',()=>{let calls=0;const unsafe:any=base();Object.defineProperty(unsafe,'unexpected',{enumerable:true,get(){calls++;throw Error('getter');}});const proxy=new Proxy({}, {get(){calls++;throw Error('get');},getPrototypeOf(){calls++;throw Error('prototype');},ownKeys(){calls++;throw Error('keys');}});for(const x of [unsafe,{nested:proxy},{toJSON(){calls++;return {};}}]){expect(compareKr060ColumnPylonSection(x)).toMatchObject({status:'ABSTAIN',reasonCode:'INVALID_INPUT',identity:null});expect(parseColumnPylonSectionReviewInput(x)).toBeNull();expect(projectColumnPylonSectionReviewDecision(x)).toBeNull();}expect(calls).toBe(0);});
 it('rejects cycles/sparse/custom/native unsafe values',()=>{const cycle:any={};cycle.x=cycle;for(const x of [cycle,new Array(2),Object.create({x:1}),undefined,1n,NaN,Infinity,{x:1.5},{x:'\ud800'},{[Symbol('x')]:1}])expect(compareKr060ColumnPylonSection(x)).toMatchObject({status:'ABSTAIN',reasonCode:'INVALID_INPUT',identity:null});});
 it('pair key binds source direction',()=>{const v=base(),p=v.review.projection,k={objectId:v.objectId,identity:v.identity,expectedSourceFileId:p.expected.sourceFileId,actualSourceFileId:p.actual.sourceFileId};expect(columnPylonSectionPairKey(k)).toMatch(/^[a-f0-9]{64}$/);expect(columnPylonSectionPairKey({...k,expectedSourceFileId:k.actualSourceFileId,actualSourceFileId:k.expectedSourceFileId})).not.toBe(columnPylonSectionPairKey(k));});
});
describe('KR060 v2 isolated strict request wire',()=>{
 it('accepts detached request and exact JSON UTF8 transport',()=>{const n=normalizeColumnPylonSectionReviewWire(request());expect(n.status).toBe('VALID');if(n.status==='VALID')expect(parseColumnPylonSectionReviewWire(Buffer.from(n.canonical))).toEqual(n);});
 it.each(['1.0','1e0','01'])('rejects integer lexeme %s',lexeme=>expect(parseColumnPylonSectionReviewWire(Buffer.from(JSON.stringify(request()).replace('"pageNumber":1','"pageNumber":'+lexeme)))).toEqual(failure('INVALID_INPUT')));
 it('rejects duplicate/BOM/badUTF8/trailing/unexpected',()=>{const raw=JSON.stringify(request());for(const b of [Buffer.from('{"status":"UNKNOWN","\\u0073tatus":"APPROVED"}'),Buffer.from('\ufeff'+raw),Buffer.from([0xc0,0xaf]),Buffer.from(raw+'{}'),Buffer.from(raw.slice(0,-1)+',"probability":0.9}')])expect(parseColumnPylonSectionReviewWire(b)).toEqual(failure('INVALID_INPUT'));});
 it('bounds raw bytes/container/depth before schema',()=>{expect(parseColumnPylonSectionReviewWire(Buffer.alloc(524289,32))).toEqual(failure('INPUT_LIMIT'));expect(normalizeColumnPylonSectionReviewWire(Array(32769).fill(null))).toEqual(failure('INPUT_LIMIT'));let nested:any=null;for(let n=0;n<65;n++)nested=[nested];expect(normalizeColumnPylonSectionReviewWire(nested)).toEqual(failure('INPUT_LIMIT'));});
});
const fresh=()=>load('owner-fresh-materialization.json','78fbc9e25d969e9aa624b494eb2112579fc4c966c6d066bd26bc369b358df48f');
describe('fresh current materialization authority boundaries',()=>{
 it('reconstructs exact pre-DUT whole manual journal',()=>{const p=fresh();expect(materializeColumnPylonSectionReview(p.request,p.context)).toEqual(p.expected);});
 it('rejects stale source review even for UNKNOWN draft',()=>{const p=fresh();p.request.status='UNKNOWN';p.context.sources[1].review.contentHash='0'.repeat(64);expect(()=>materializeColumnPylonSectionReview(p.request,p.context)).toThrowError(expect.objectContaining({code:'STALE_REVIEW'}));});
});
