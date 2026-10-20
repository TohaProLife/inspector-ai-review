/** Source-review integration expectations frozen before production edits (T71). */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {sourceReviewSchema,steelComparisonScopeDecisionToInput} from '@inspector-ai/contracts';
import {apiSchemas} from '../src/api-contract.js';
import {PostgresInspectionRepository} from '../src/postgres-repository.js';
import {canonicalJson,sha256} from '../src/canonical-json.js';
const bytes=readFileSync(new URL('../../../fixtures/matrix-steel-comparison-v1/qa-manual-whole-goldens.json',import.meta.url));
expect(createHash('sha256').update(bytes).digest('hex')).toBe('ce67d3f673f286d3432903f1382db1ae46c64f0254ae0e933db2fd0b63157f4c');
const manual=JSON.parse(bytes.toString());
const fresh=()=>structuredClone(manual.cases.find((c:any)=>c.expected.status==='CANDIDATE')!.input);
const body=(scope:any)=>({sourceSha256:'a'.repeat(64),revisionStatus:'UNKNOWN',approvalStatus:'UNKNOWN',linkGroupId:null,pageStages:{},basis:{reference:'Independent source review integration expectation'},...(scope===undefined?{}:{steelComparisonScope:scope})});
const scope=()=>steelComparisonScopeDecisionToInput(fresh().sources[0].review.steelComparisonScope);
function seam(input:any){const o=input.origins[0];return {source:{sourceFileId:o.sourceFileId,sha256:o.sourceSha256,stages:o.stages},inputManifestHash:o.target.inputManifestHash,textStageContentHash:o.target.textStageContentHash,textArtifactHash:o.target.textArtifactHash,textArtifact:o.textArtifact,stage:o.stages[0],originalPageStages:o.pageStages};}
async function materialize(input:any,request:any,current:any={}){const repo=Object.create(PostgresInspectionRepository.prototype) as any;repo.loadInventoryOrigin=async()=>seam(input);return repo.materializeSteelComparisonScope({},input.objectId,input.origins[0].sourceFileId,input.origins[0].sourceSha256,current,request);}
describe('T71 optional steel source review integration',()=>{
 it('accepts request scope without adding a key to historical omission',()=>{expect(sourceReviewSchema.parse(body(undefined))).not.toHaveProperty('steelComparisonScope');expect(sourceReviewSchema.parse(body(scope()))).toHaveProperty('steelComparisonScope',scope());expect(sourceReviewSchema.parse(body({schemaVersion:'matrix-kr056-steel-review-v1',claims:[]}))).toHaveProperty('steelComparisonScope.claims',[]);});
 it('rejects materialized snapshots and unknown fields through public parent schema',()=>{const s=fresh().sources[0].review.steelComparisonScope;expect(()=>sourceReviewSchema.parse(body(s))).toThrow();expect(()=>sourceReviewSchema.parse({...body(scope()),unexpected:true})).toThrow();});
 it('advertises exact optional steel request and decision HTTP properties',()=>{expect(apiSchemas.SourceReviewInput.properties).toHaveProperty('steelComparisonScope',{$ref:'#/components/schemas/MatrixSteelComparisonScopeInput'});expect(apiSchemas.SourceReviewDecision.properties).toHaveProperty('steelComparisonScope',{$ref:'#/components/schemas/MatrixSteelComparisonScopeDecision'});expect((apiSchemas as any).MatrixSteelComparisonScopeInput.properties.claims.items.properties).not.toHaveProperty('declarationSnapshot');expect((apiSchemas as any).MatrixSteelComparisonScopeDecision.properties.claims.items.properties).toHaveProperty('declarationSnapshot');});
 it('materializes exact immutable producer snapshot, keeps UNKNOWN, never mutates input',async()=>{const input=fresh(),before=structuredClone(input),request=steelComparisonScopeDecisionToInput(input.sources[0].review.steelComparisonScope);request.claims[0].memberMapping.assertion='UNKNOWN';const result=await materialize(input,request);expect(result.claims[0].declarationSnapshot).toEqual(input.sources[0].review.steelComparisonScope.claims[0].declarationSnapshot);expect(result.claims[0].memberMapping.assertion).toBe('UNKNOWN');expect(input).toEqual(before);});
 it('rejects stale target, forged raw mapping and non-own geometry',async()=>{const input=fresh();for(const change of[(r:any)=>r.claims[0].target.textStageContentHash='f'.repeat(64),(r:any)=>r.claims[0].target.declarationId='forged',(r:any)=>r.claims[0].memberMapping.scopeFragments[0].rawText+=' forged',(r:any)=>r.claims[0].memberMapping.scopeFragments[0].bboxMilliPoints[0]++]){const r=steelComparisonScopeDecisionToInput(input.sources[0].review.steelComparisonScope);change(r);await expect(materialize(input,r)).rejects.toThrow();}expect(await materialize(input,steelComparisonScopeDecisionToInput(input.sources[0].review.steelComparisonScope),{'1':'RD'})).toEqual(input.sources[0].review.steelComparisonScope);});
 it('withdraws explicitly without loading any original',async()=>{const repo=Object.create(PostgresInspectionRepository.prototype) as any;repo.loadInventoryOrigin=async()=>{throw Error('no origin for explicit withdrawal')};const empty={schemaVersion:'matrix-kr056-steel-review-v1',claims:[]};expect(await repo.materializeSteelComparisonScope({},'OBJECT','SOURCE','a'.repeat(64),{},empty)).toEqual(empty);});
 it('migration is nullable and rollback explicit; no default rewrites historical rows',()=>{const sql=readFileSync(new URL('../../../migrations/040_matrix_steel_comparison_scope.sql',import.meta.url),'utf8'),rollback=readFileSync(new URL('../../../migrations/rollback/040_matrix_steel_comparison_scope.sql',import.meta.url),'utf8');expect(sql).toMatch(/ADD COLUMN steel_comparison_scope JSONB/);expect(sql).not.toMatch(/\b(?:DEFAULT|NOT NULL|UPDATE)\b/i);expect(sql).toContain('matrix-kr056-steel-review-v1');expect(rollback).toMatch(/DROP COLUMN steel_comparison_scope/);});
});

it('HTTP parent keeps materialized response, passes request only, rejects snapshots/duplicate keys before record',async()=>{
 const {randomUUID}=await import('node:crypto'),{buildApp}=await import('../src/app.js');
 const actor={sessionId:randomUUID(),userId:randomUUID(),organizationId:randomUUID(),displayName:'Synthetic steel transport reviewer',roles:['INSPECTOR'],capabilities:['SOURCE_REVIEW'],csrfHash:'a'.repeat(64),expiresAt:'2030-01-01T00:00:00Z'};
 const input=fresh(),decision=input.sources[0].review.steelComparisonScope,request={...body(steelComparisonScopeDecisionToInput(decision)),sourceSha256:input.sources[0].sourceSha256,expectedReviewHash:null,sectionCode:'KR'};
 let calls=0,received:any;
 const stored={...request,steelComparisonScope:decision,id:randomUUID(),objectId:input.objectId,sourceFileId:input.sources[0].sourceFileId,actorId:actor.userId,contentHash:'b'.repeat(64),createdAt:'2026-10-18T12:00:00Z'};
 const repository={hasObjectPermission:async()=>true,recordSourceReviewCommand:async(_object:any,_source:any,raw:any)=>{calls++;received=raw;return {kind:'success',value:stored,replayed:false}}};
 const identity={login:async()=>undefined,resolveSession:async(t:string)=>t==='session'?actor:undefined,verifyCsrf:(_a:any,t:string)=>t==='csrf',revokeSession:async()=>undefined,close:async()=>undefined};
 const app=await buildApp({repository:repository as any,identityService:identity});
 const url=`/api/objects/${input.objectId}/files/${input.sources[0].sourceFileId}/source-review`,headers={cookie:'inspector_session=session; inspector_csrf=csrf','x-csrf-token':'csrf','idempotency-key':randomUUID(),'content-type':'application/json'};
 try{
  const response=await app.inject({method:'POST',url,headers,payload:request});expect(response.statusCode,response.body).toBe(201);expect(response.json().steelComparisonScope).toEqual(decision);expect(received.steelComparisonScope).toEqual(request.steelComparisonScope);expect(received.steelComparisonScope.claims[0]).not.toHaveProperty('declarationSnapshot');expect(calls).toBe(1);
  for(const payload of[{...request,steelComparisonScope:decision},JSON.stringify({...request,steelComparisonScope:{schemaVersion:'matrix-kr056-steel-review-v1',claims:[]}}).replace('"claims":[]','"claims":[],"claims":[]'),{...request,'недопустимыйКлюч':true}]){const rejected=await app.inject({method:'POST',url,headers,payload});expect(rejected.statusCode).toBe(400);expect(calls).toBe(1);}
 }finally{await app.close();}
});
