/** T73 profile expectations fixed before owned production changes. */
import {describe,it,expect} from 'vitest';
import {matrixLightingTechnologyDefinitions,matrixLightingTechnologyConfigHash,MATRIX_LIGHTING_TECHNOLOGY_PROFILE} from '../src/matrix-lighting-technology-profile.js';
import {matrixConfidencePolicyForProfile} from '../src/matrix-confidence-profile.js';
describe('T73 additive ordinary v10 profile',()=>{
 it('inherits exact v9 while selecting a separate v10 branch and strict confidence',async()=>{
  const m=await import('../src/matrix-steel-comparison-profile.js');
  expect(m.MATRIX_STEEL_COMPARISON_PROFILE).toBe('matrix-text-facts-steel-comparison-v10');
  expect(m.MATRIX_STEEL_COMPARISON_ADAPTER_VERSION).toBe('10');
  const {steelExecution,...old}=m.matrixSteelComparisonDefinitions;
  expect(old).toEqual(matrixLightingTechnologyDefinitions);
  expect(steelExecution.baseProfileId).toBe(MATRIX_LIGHTING_TECHNOLOGY_PROFILE);
  expect(steelExecution.baseConfigHash).toBe(matrixLightingTechnologyConfigHash);
  expect(m.matrixFullPolicyForProfile(m.MATRIX_STEEL_COMPARISON_PROFILE)).toMatchObject({adapterVersion:'10',steelComparisons:true,lightingTechnologyComparisons:true});
  expect(m.matrixFullPolicyForProfile(MATRIX_LIGHTING_TECHNOLOGY_PROFILE)).toMatchObject({adapterVersion:'9',steelComparisons:false});
  expect(matrixConfidencePolicyForProfile(m.MATRIX_STEEL_COMPARISON_PROFILE).policyVersion).toBe('machine-confidence-policy-v2');
  expect(m.selectMatrixRuntimePolicy({steel:true,lighting:true,water:true,rail:true,call:true,inventory:true}).profileId).toBe(m.MATRIX_STEEL_COMPARISON_PROFILE);
 });
});

it('v6 worker download requires exact lease query and worker token before durable delegate',async()=>{
 const {buildApp}=await import('../src/app.js'),{RoutedInspectionRepository}=await import('../src/repository-factory.js'),{InspectorStore}=await import('../src/store.js'),{randomUUID}=await import('node:crypto');
 const canonical='{"schemaVersion":"matrix-reviewed-inventory-loader-inputs-v6"}',attemptId=randomUUID();let calls=0,received:unknown;
 const normal={close:async()=>undefined,getJobSteelReviewedInventoryComparisonInputs:async(jobId:string,input:unknown)=>{calls++;received={jobId,input};return {kind:'available',canonical,contentHash:'a'.repeat(64),byteSize:Buffer.byteLength(canonical),inputManifestHash:'b'.repeat(64),schemaVersion:'matrix-reviewed-inventory-loader-inputs-v6'}}};
 const app=await buildApp({repository:new RoutedInspectionRepository(await InspectorStore.create(),normal as any),workerToken:'synthetic-T73-worker-token'});
 const path='/api/internal/v1/jobs/JOB-T73/steel-reviewed-inventory-comparison-inputs',query=`?attemptId=${attemptId}&fencingToken=1`,headers={'x-worker-token':'synthetic-T73-worker-token'};
 try{
  expect((await app.inject({url:path+query})).statusCode).toBe(401);expect(calls).toBe(0);
  for(const bad of [`${query}&other=1`,`${query}&attemptId=${attemptId}`,`?attemptId=${attemptId}&fencingToken=9007199254740992`,`?attemptId=${attemptId}&fencingToken=0`])expect((await app.inject({url:path+bad,headers})).statusCode).toBe(400);
  expect(calls).toBe(0);const response=await app.inject({url:path+query,headers});expect(response.statusCode,response.body).toBe(200);expect(response.body).toBe(canonical);expect(response.headers['x-artifact-schema-version']).toBe('matrix-reviewed-inventory-loader-inputs-v6');expect(response.headers['x-content-sha256']).toBe('a'.repeat(64));expect(response.headers['cache-control']).toBe('private, no-store');expect(received).toEqual({jobId:'JOB-T73',input:{attemptId,fencingToken:1}});expect(calls).toBe(1);
 }finally{await app.close();}
});

it('v10 preserves strict null-confidence candidates and historical v9 config bytes',async()=>{
 const {matrixPresentationForProfile}=await import('../src/matrix-confidence-profile.js');
 const {MATRIX_STEEL_COMPARISON_PROFILE,matrixSteelComparisonDefinitions}=await import('../src/matrix-steel-comparison-profile.js');
 const result=matrixPresentationForProfile({results:[{qualified:true,executionStatus:'SUCCEEDED'}]} as any,MATRIX_STEEL_COMPARISON_PROFILE)[0];
 expect(result.policyVersion).toBe('machine-confidence-policy-v2');expect(result).toMatchObject({machineDisposition:'CANDIDATE'});
 expect(matrixLightingTechnologyConfigHash).toBe('c7b195df5c43a8fb05abed342ac8402b28bf92378c6165bb7e4de7a94b7ada84');
 expect(matrixSteelComparisonDefinitions.lightingTechnologyExecution).toEqual(matrixLightingTechnologyDefinitions.lightingTechnologyExecution);
});
