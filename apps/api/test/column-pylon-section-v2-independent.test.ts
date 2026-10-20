import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { compareKr060ColumnPylonSection, parseColumnPylonSectionReviewInput, validateColumnPylonSectionReviewDecision, projectColumnPylonSectionReviewDecision, columnPylonSectionPairKey, materializeColumnPylonSectionReview } from '../src/matrix-column-pylon-section-v2.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-v2-v1/qa-independent-whole-goldens.json',import.meta.url));
const manual=JSON.parse(bytes.toString('utf8')); const cases=[...manual.portCases,...manual.nativeCases];
describe('independent frozen column/pylon wire v2',()=>{
 it('replays all32 complete manual outputs without input mutation',()=>{
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('e2ef856b9976f23f408044652f94e2cb18aac16f719c07d0742ae2d9f26efbed');expect(cases).toHaveLength(32);
  for(const c of cases){const input=structuredClone(c.input);const before=structuredClone(input);expect(compareKr060ColumnPylonSection(input),c.name).toEqual(c.expected);expect(input,c.name).toEqual(before);}
 },120000);
});

const helperBytes=readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-v2-v1/qa-independent-helper-goldens.json',import.meta.url));
const helpers=JSON.parse(helperBytes.toString('utf8'));
const reviewedBytes=readFileSync(new URL('../../../fixtures/matrix-column-pylon-section-v2-v1/qa-review-v2-goldens.json',import.meta.url));
const reviewed=JSON.parse(reviewedBytes.toString('utf8'));
describe('independent exact helper and native boundary',()=>{
 it('projects APPROVED UNKNOWN WITHDRAWN without authority snapshots and detaches all data',()=>{
  expect(createHash('sha256').update(helperBytes).digest('hex')).toBe('72edfb08632920b75381c54d46a62a854b6d549598beaffcfaac9c33ea2f6746');
  for(const c of helpers.cases){const original=structuredClone(c);expect(validateColumnPylonSectionReviewDecision(c.journal)).toEqual(c.journal);expect(projectColumnPylonSectionReviewDecision(c.journal)).toEqual(c.expectedRequest);expect(parseColumnPylonSectionReviewInput(c.expectedRequest)).toEqual(c.expectedRequest);expect(columnPylonSectionPairKey(c.pairKeyInput)).toBe(c.expectedPairKey);
   const projection=projectColumnPylonSectionReviewDecision(c.journal)!;expect(JSON.stringify(projection)).not.toContain('literalSnapshot');expect(JSON.stringify(projection)).not.toContain('selectionContentHash');expect(JSON.stringify(projection)).not.toContain('nativeBoxPointStrings');projection.reference='changed';const request=parseColumnPylonSectionReviewInput(c.expectedRequest)!;request.reference='changed';const journal=validateColumnPylonSectionReviewDecision(c.journal);journal.projection.reference='changed';expect(c).toEqual(original);}
 });
 it('replays pre-DUT mixed projection and exact prior withdrawal materialization',()=>{
  expect(createHash('sha256').update(reviewedBytes).digest('hex')).toBe('f8f55140d12b268342df73b65d98efe72eb207169e77325ef1e24248d08c38d2');
  for(const c of reviewed.projectionCases)expect(projectColumnPylonSectionReviewDecision(c.input)).toEqual(c.expected);
  for(const c of reviewed.materializationCases){const before=structuredClone(c);expect(materializeColumnPylonSectionReview(c.input,c.context)).toEqual(c.expected);expect(c).toEqual(before);}
 },120000);
 it('native rejection executes zero getters/proxy/toJSON callbacks',()=>{
  let calls=0;const accessor=Object.defineProperty({},'schemaVersion',{enumerable:true,get(){calls++;throw Error('getter');}});const proxy=new Proxy({},{ownKeys(){calls++;throw Error('proxy');},get(){calls++;throw Error('get');},getPrototypeOf(){calls++;throw Error('prototype');}});const cycle:any={};cycle.self=cycle;const sparse=new Array(2);sparse[1]=1;const hidden=Object.defineProperty({},'x',{value:1});const symbol:any={};symbol[Symbol('x')]=1;
  for(const value of [accessor,proxy,cycle,{a:sparse},hidden,symbol,{toJSON(){calls++;return null;}},{x:1.5},{x:Infinity},{x:9007199254740992},{x:'\ud800'},new Date()]){
   const result=compareKr060ColumnPylonSection(value);expect(result.status).toBe('ABSTAIN');expect(result.reasonCode).toBe('INVALID_INPUT');expect(result.identity).toBeNull();expect(result.comparison).toBeNull();expect(result.calibratedProbability).toBeNull();expect(parseColumnPylonSectionReviewInput(value)).toBeNull();expect(projectColumnPylonSectionReviewDecision(value)).toBeNull();expect(()=>validateColumnPylonSectionReviewDecision(value)).toThrow();expect(()=>columnPylonSectionPairKey(value)).toThrow();expect(()=>materializeColumnPylonSectionReview(value,{})).toThrow();}
  expect(calls).toBe(0);
 });
 it('native budget diagnostic precedes DTO shape and never yields authority',()=>{
  let deep:unknown=null;for(let i=0;i<69;i++)deep={x:deep};
  for(const value of [{x:'a'.repeat(2000001)},{x:Array(32769).fill(0)},deep]){const result=compareKr060ColumnPylonSection(value);expect(result.status).toBe('ABSTAIN');expect(result.reasonCode).toBe('INPUT_LIMIT');expect(result.identity).toBeNull();expect(result.comparison).toBeNull();expect(result.calibratedProbability).toBeNull();}
 });
});
