/** Independent T72 expected journal frozen before implementation; original operands are T70 authored PDFs. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {parseSteelApplicabilityReviewInput,validateSteelApplicabilityReviewDecision,materializeSteelApplicabilityReview,steelApplicabilityPairKey} from '../src/matrix-steel-applicability-review.js';
import {matrixSteelApplicabilityReviewInputSchema,matrixSteelApplicabilityReviewDecisionSchema} from '../../../packages/contracts/src/matrix-steel-applicability-review.js';
const manual=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-steel-execution-v1/qa-manual-whole-expectations.json',import.meta.url),'utf8'));
const clone=<T>(v:T):T=>structuredClone(v);
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const hash=(v:any)=>createHash('sha256').update(canonical(v)).digest('hex');
const original=()=>clone(manual.validCases[0].package);
function fixture(){const p=original(),old=p.applicabilityDecisions[0];p.applicabilityDecisions=[];
 const input={schemaVersion:'matrix-kr056-steel-applicability-review-v1',status:old.status,identity:old.identity,expected:old.expected,actual:old.actual,basis:old.basis,expectedReviewHash:null};
 const context={objectId:'OBJ-SYNTHETIC-T72',actorId:'11111111-1111-4111-8111-111111111111',id:'22222222-2222-4222-8222-222222222222',createdAt:'2026-10-18T12:20:00.000Z',previous:null,package:p};
 const {contentHash:_,...body}=old;body.decisionId=context.id;
 const projection={...body,contentHash:hash({hashDomain:'matrix-kr056-steel-applicability-decision-json-v1',decision:body})};
 const bodyJournal={id:context.id,objectId:context.objectId,actorId:context.actorId,previousReviewHash:null,projection,createdAt:context.createdAt};
 const expected={...bodyJournal,contentHash:hash({hashDomain:'matrix-kr056-steel-applicability-review-journal-v1',decision:bodyJournal})};
 return {input,context,expected};
}
const signedAgain=(d:any)=>{const {contentHash:_,...p}=d.projection;d.projection.contentHash=hash({hashDomain:'matrix-kr056-steel-applicability-decision-json-v1',decision:p});const {contentHash:__,...body}=d;d.contentHash=hash({hashDomain:'matrix-kr056-steel-applicability-review-journal-v1',decision:body});return d;};
describe('T72 authenticated journal pure boundary (no actor/PDF authentication)',()=>{
 it('matches independently fixed full journal and exact three domain hashes',()=>{const x=fixture(),before=clone(x);expect(x.expected.contentHash).toBe('7dbe4a5aed5cb743eb16f48479485b93723c0b55164112ad09b1f7ea170e8b7f');expect(x.expected.projection.contentHash).toBe('664ca1f3ee1a4e96330364356a7f15dcec7946a9064f2e43608069ac7232fcb4');expect(materializeSteelApplicabilityReview(x.input,x.context)).toEqual(x.expected);expect(validateSteelApplicabilityReviewDecision(x.expected)).toEqual(x.expected);expect(parseSteelApplicabilityReviewInput(x.input)).toEqual(x.input);expect(steelApplicabilityPairKey({objectId:x.context.package.objectId,identity:x.input.identity,expectedSourceFileId:x.input.expected.sourceFileId,actualSourceFileId:x.input.actual.sourceFileId})).toBe('854e00b1a36a90633a2e14c3166c217c77b66233bf6bfb7ab3c6d9cf4a7166b5');expect(x).toEqual(before);});
 it('strictly separates request/server fields in both browser and API',()=>{const x=fixture();expect(matrixSteelApplicabilityReviewInputSchema.parse(x.input)).toEqual(x.input);expect(matrixSteelApplicabilityReviewDecisionSchema.parse(x.expected)).toEqual(x.expected);for(const field of ['objectId','actorId','projection','contentHash','declarationSnapshot']){const bad={...x.input,[field]:'injected'};expect(matrixSteelApplicabilityReviewInputSchema.safeParse(bad).success).toBe(false);expect(()=>parseSteelApplicabilityReviewInput(bad)).toThrow();}expect(()=>parseSteelApplicabilityReviewInput({...x.input,expectedReviewHash:undefined})).toThrow();});
 it('requires full original and all retained claim integrity before unknown/approval',()=>{for(const status of ['APPROVED','UNKNOWN']){const x=fixture();x.input.status=status;x.context.package.origins[0].textArtifact.pages[0].blocks[0].text+=' forged';expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();}const x=fixture();x.context.package.applicabilityDecisions=original().applicabilityDecisions;expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();});
 it('retains unknown decision despite operational review gates; approval rejects same gate',()=>{const x=fixture();x.context.package.sources[0].review.approvalStatus='UNKNOWN';x.input.status='UNKNOWN';const d=materializeSteelApplicabilityReview(x.input,x.context);expect(d.projection.status).toBe('UNKNOWN');x.input.status='APPROVED';expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();});
 it('requires pair/source object/ref orientation and authentic original basis',()=>{for(const change of [(x:any)=>x.input.basis.expectedScopeFragments[0].rawText+=' forged',(x:any)=>x.input.expected.productScope.gradeStandard='invented',(x:any)=>x.input.actual=x.input.expected,(x:any)=>x.context.package.objectId='other',(x:any)=>[x.input.expected,x.input.actual]=[x.input.actual,x.input.expected]]){const x=fixture();change(x);expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();}});
 it('withdraws only exact previous pair with latest CAS; rejects first/retarget/stale',()=>{const x:any=fixture();expect(()=>materializeSteelApplicabilityReview({...x.input,status:'WITHDRAWN'},x.context)).toThrow();x.context.previous=x.expected;x.context.id='33333333-3333-4333-8333-333333333333';x.input.status='WITHDRAWN';x.input.expectedReviewHash=x.expected.contentHash;const d=materializeSteelApplicabilityReview(x.input,x.context);expect(d.previousReviewHash).toBe(x.expected.contentHash);expect(d.projection.status).toBe('WITHDRAWN');expect(d.projection.expected).toEqual(x.expected.projection.expected);for(const mutate of [(v:any)=>v.input.expectedReviewHash=null,(v:any)=>v.input.basis.reference+=' changed',(v:any)=>v.context.objectId='OBJ-OTHER',(v:any)=>v.context.previous.contentHash='0'.repeat(64),(v:any)=>v.context.previous.projection.objectId='other']){const bad=clone(x);mutate(bad);expect(()=>materializeSteelApplicabilityReview(bad.input,bad.context)).toThrow();}});
 it('checks both hashes and id association without claiming actor authority',()=>{for(const mutate of [(d:any)=>d.contentHash='0'.repeat(64),(d:any)=>d.projection.contentHash='0'.repeat(64),(d:any)=>d.actorId='bad',(d:any)=>d.id='33333333-3333-4333-8333-333333333333']){const d=fixture().expected;mutate(d);expect(()=>validateSteelApplicabilityReviewDecision(d)).toThrow();}const d=fixture().expected;d.actorId='44444444-4444-4444-8444-444444444444';signedAgain(d);expect(validateSteelApplicabilityReviewDecision(d)).toEqual(d);});
 it('uses canonical UTC milliseconds and UUIDs, no DB time normalization',()=>{for(const time of ['2026-10-18T12:20:00Z','2026-10-18T15:20:00.000+03:00','2026-02-30T12:20:00.000Z']){const x=fixture();x.context.createdAt=time;expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();}for(const field of ['actorId','id']){const x:any=fixture();x.context[field]='not-a-uuid';expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();}});
 it('detaches parsed/materialized/validated output and freezes old input values',()=>{const x=fixture(),before=clone(x);const a=parseSteelApplicabilityReviewInput(x.input);a.basis.expectedScopeFragments[0].rawText='changed';const d=materializeSteelApplicabilityReview(x.input,x.context);d.projection.identity.memberKey='changed';const valid=validateSteelApplicabilityReviewDecision(x.expected);valid.projection.actual.productScope.gradeStandard='changed';expect(x).toEqual(before);});
 it('rejects getters/proxies/cycles/holes/Unicode keys before any callback',()=>{let count=0;const getter={};Object.defineProperty(getter,'objectId',{enumerable:true,get(){count++;throw Error('getter')}});const proxy=new Proxy({}, {get(){count++;throw Error('get')},getPrototypeOf(){count++;throw Error('proto')},ownKeys(){count++;throw Error('keys')}});const cycle:any={};cycle.x=cycle;
 const funcs=[parseSteelApplicabilityReviewInput,validateSteelApplicabilityReviewDecision,steelApplicabilityPairKey,(raw:any)=>materializeSteelApplicabilityReview(fixture().input,raw)];for(const f of funcs)for(const raw of [getter,proxy,cycle,new Array(1),{'ключ':null},{number:.5},{number:9007199254740992}])expect(()=>f(raw)).toThrow();expect(count).toBe(0);});
 it('bounds whole request/context and exact Unicode codepoints/clean fields',()=>{const x=fixture();x.input.basis.expectedScopeFragments[0].rawText='x'.repeat(524288);expect(()=>parseSteelApplicabilityReviewInput(x.input)).toThrow();const y:any=fixture();y.context.extra='x'.repeat(8000000);expect(()=>materializeSteelApplicabilityReview(y.input,y.context)).toThrow();const z:any=fixture();z.input.identity.memberKey='😀'.repeat(200);expect(parseSteelApplicabilityReviewInput(z.input).identity.memberKey).toBe(z.input.identity.memberKey);z.input.identity.memberKey+='😀';expect(()=>parseSteelApplicabilityReviewInput(z.input)).toThrow();for(const value of [' blank','bad\nline','bad�line']){z.input.identity.memberKey=value;expect(()=>parseSteelApplicabilityReviewInput(z.input)).toThrow();}});
});

// Supplemental branch expectations fixed from pre-existing immutable T69 whole fixtures;
// no new extractor, comparator or boundary output supplies expected approval semantics.
describe('frozen T69 branch and historical package controls',()=>{
 it('permits catalog equality/reverse semantic abstentions after full eligible pair integrity',()=>{
  const cases=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-steel-comparison-v1/qa-manual-whole-goldens.json',import.meta.url),'utf8')).cases;
  for(const name of ['synthetic-reviewed-equal-C245','synthetic-reverse-C245-C345','synthetic-equal-C345']){
   const c=clone(cases.find((v:any)=>v.name===name).input),pair=c.applicabilityDecisions[0],x:any=fixture();
   x.input={schemaVersion:x.input.schemaVersion,status:'APPROVED',identity:pair.identity,expected:pair.expected,actual:pair.actual,basis:pair.basis,expectedReviewHash:null};
   x.context.package={schemaVersion:'matrix-kr056-steel-loader-inputs-v1',objectId:c.objectId,inputManifestHash:c.inputManifestHash,sources:c.sources,origins:c.origins,applicabilityDecisions:[],identities:[c.identity]};
   expect(materializeSteelApplicabilityReview(x.input,x.context).projection.status,name).toBe('APPROVED');
  }
 },30000);
 it('withdraws against supplied immutable historical package despite ineligible current fields; no retarget',()=>{
  const x:any=fixture();x.context.previous=x.expected;x.context.id='33333333-3333-4333-8333-333333333333';x.input.status='WITHDRAWN';x.input.expectedReviewHash=x.expected.contentHash;
  // Actual scope/authentication of this retained historical package is repository-owned.
  x.context.package.sources[0].stages=['UNRESOLVED'];x.context.package.sources[0].review.approvalStatus='UNKNOWN';x.context.package.sources[0].review.revisionStatus='SUPERSEDED';
  expect(materializeSteelApplicabilityReview(x.input,x.context).projection.status).toBe('WITHDRAWN');
  const removed=clone(x);removed.context.package.sources[0].review.steelComparisonScope=null;removed.context.package.identities=[];
  expect(()=>materializeSteelApplicabilityReview(removed.input,removed.context)).toThrow();
 });
});

function sameOriginalFixture(){
 const cases=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-steel-comparison-v1/qa-manual-whole-goldens.json',import.meta.url),'utf8')).cases;
 const c=clone(cases.find((v:any)=>v.name==='same-original-sha-two-stages').input),pair=c.applicabilityDecisions[0],x:any=fixture();
 x.input={schemaVersion:x.input.schemaVersion,status:'UNKNOWN',identity:pair.identity,expected:pair.expected,actual:pair.actual,basis:pair.basis,expectedReviewHash:null};
 x.context.package={schemaVersion:'matrix-kr056-steel-loader-inputs-v1',objectId:c.objectId,inputManifestHash:c.inputManifestHash,sources:c.sources,origins:c.origins,applicabilityDecisions:[],identities:[c.identity]};
 return x;
}
describe('canonical distinct original source invariant for every status',()=>{
 it('rejects same original SHA even for UNKNOWN while retaining full valid original DTOs',()=>{
  const x=sameOriginalFixture();expect(x.input.expected.sourceFileId).not.toBe(x.input.actual.sourceFileId);expect(x.input.expected.sourceSha256).toBe(x.input.actual.sourceSha256);
  expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();
 });
 it('rejects same original SHA for WITHDRAWN and does not retarget the prior pair',()=>{
  const x=sameOriginalFixture(),oldPair=clone(JSON.parse(readFileSync(new URL('../../../fixtures/matrix-steel-comparison-v1/qa-manual-whole-goldens.json',import.meta.url),'utf8')).cases.find((c:any)=>c.name==='same-original-sha-two-stages').input.applicabilityDecisions[0]);
  x.expected.projection={...oldPair,decisionId:x.expected.id,status:'UNKNOWN'};signedAgain(x.expected);
  x.context.previous=x.expected;x.context.id='33333333-3333-4333-8333-333333333333';x.input.status='WITHDRAWN';x.input.expectedReviewHash=x.expected.contentHash;
  expect(()=>materializeSteelApplicabilityReview(x.input,x.context)).toThrow();
 });
});
