/** T71 semantic clarification: current eligibility never rewrites immutable producer origin. */
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {steelComparisonScopeDecisionToInput} from '@inspector-ai/contracts';
import {PostgresInspectionRepository} from '../src/postgres-repository.js';
const manual=JSON.parse(readFileSync(new URL('../../../fixtures/matrix-steel-comparison-v1/qa-manual-whole-goldens.json',import.meta.url),'utf8'));
describe('T71 original reconstruction vs current eligibility',()=>{
 it.each(['RD','UNRESOLVED'])('keeps exact original snapshot under current %s page metadata',async stage=>{
  const input=structuredClone(manual.cases.find((c:any)=>c.expected.status==='CANDIDATE').input),o=input.origins[0];
  const repo=Object.create(PostgresInspectionRepository.prototype) as any;
  repo.loadInventoryOrigin=async()=>({source:{sourceFileId:o.sourceFileId,sha256:o.sourceSha256,stages:o.stages},inputManifestHash:o.target.inputManifestHash,textStageContentHash:o.target.textStageContentHash,textArtifactHash:o.target.textArtifactHash,textArtifact:o.textArtifact,stage:o.stages[0],originalPageStages:o.pageStages});
  const original=input.sources[0].review.steelComparisonScope,request=steelComparisonScopeDecisionToInput(original),before=structuredClone(request);
  const decision=await repo.materializeSteelComparisonScope({},input.objectId,o.sourceFileId,o.sourceSha256,{'1':stage},request);
  expect(decision).toEqual(original);expect(request).toEqual(before);
 });
});
