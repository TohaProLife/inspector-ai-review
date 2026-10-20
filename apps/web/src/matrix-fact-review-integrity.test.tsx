/** Additive T56 known-field integrity regression. First49/manual remain frozen.
 * Parse neither whole materialized source decision nor semantic eligibility. */
import assert from 'node:assert/strict';
import {describe,it} from 'vitest';
import type {MatrixObservation} from '@inspector-ai/contracts';
import {buildMatrixFactReviewPreflight} from './matrix-fact-review-preflight';
const H=(c:string)=>c.repeat(64);
function input():Parameters<typeof buildMatrixFactReviewPreflight>[0] {
 const fact:MatrixObservation={id:H('1'),sourceFileId:'SRC-T56',sourceSha256:H('a'),stage:'PD',pageNumber:1,blockId:'0:0',bbox:{x:.1,y:.1,width:.2,height:.02},rawText:'Класс бетона В30',attribute:'CONCRETE_CLASS',value:'В30',unit:'B_CLASS',entityKey:null,method:'TEXT_LAYER',extractorVersion:'matrix-text-facts-v1',parameterCodes:['KR-055'],sourceFlags:[]};
 return {objectId:'OBJ-T56',savedRun:{checkId:'CHK-T56',executionContentHash:H('b'),reasonCode:null},target:{checkId:'CHK-T56',executionContentHash:H('b'),observationId:fact.id,evidenceHash:H('c'),textArtifactHash:H('d')},fact,selectedRuleId:'matrix-kr-055-concrete_class',currentFile:{id:fact.sourceFileId,sha256:fact.sourceSha256},latestDecision:{id:'REVIEW-T56',objectId:'OBJ-T56',sourceFileId:fact.sourceFileId,sourceSha256:fact.sourceSha256,revisionStatus:'UNKNOWN',approvalStatus:'UNKNOWN',sectionCode:null,linkGroupId:null,pageStages:{},basis:{reference:'Синтетическое сохранённое решение'},actorId:'HUMAN-SYNTHETIC',createdAt:'2026-10-18T00:00:00Z',contentHash:H('e')}};
}
describe('T56 additive runtime source metadata integrity',()=>{
 it.each(['OTHER','',123])('invalid runtime section %j is an integrity error, not a recorded section',section=>{const i=input();(i.latestDecision as any).sectionCode=section;const before=structuredClone(i),x=buildMatrixFactReviewPreflight(i);assert.equal(x.status,'INVALID_INPUT');assert.equal(x.invalidReason,'INVALID_STORED_SCOPE');assert.equal(x.sourceNavigation,null);assert.deepEqual(i,before);});
 it.each(['','   ',123,true,{},'x'.repeat(201)])('invalid runtime link %j is an integrity error, not missing or recorded authority',link=>{const i=input();(i.latestDecision as any).linkGroupId=link;const before=structuredClone(i),x=buildMatrixFactReviewPreflight(i);assert.equal(x.status,'INVALID_INPUT');assert.equal(x.invalidReason,'INVALID_STORED_SCOPE');assert.equal(x.sourceNavigation,null);assert.deepEqual(i,before);});
 it.each([null,'KR','PZ'] as const)('valid source section %j stays a record; no new comparison validation',section=>{const i=input();i.latestDecision!.sectionCode=section;const x=buildMatrixFactReviewPreflight(i);assert.equal(x.status,'RECORDED_STATE');assert.equal(x.sourceSection,section);assert.equal(x.semanticContextStatus,'NOT_CHECKED');assert.equal(x.counterpart,'NOT_CHECKED');});
 it('valid Unicode link is preserved as source-local, never checked against a partner',()=>{const i=input();i.latestDecision!.linkGroupId='комплект-Ж/😀';const x=buildMatrixFactReviewPreflight(i);assert.equal(x.status,'RECORDED_STATE');assert.deepEqual(x.linkGroup,{status:'RECORDED_SELECTED_SOURCE_ONLY',value:'комплект-Ж/😀'});assert.equal(x.counterpart,'NOT_CHECKED');});
 it('null link remains a legitimate missing human decision',()=>{const x=buildMatrixFactReviewPreflight(input());assert.equal(x.status,'RECORDED_STATE');assert.deepEqual(x.linkGroup,{status:'NOT_RECORDED',value:null});});
});
