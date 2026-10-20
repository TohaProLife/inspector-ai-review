/** T42 authenticated HTTP integration, explicitly synthetic source assertions. Not a browser test.
 * Usage: review private-seed.json new-private-consumer.json | verify private-consumer.json
 * Never import the production inventory extractor or hash implementation as the oracle.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [mode,statePath,consumerPath]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082';
assert.ok(['review','verify'].includes(mode)&&statePath&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
assert.equal(fs.statSync(statePath).mode&0o777,0o600);const state=JSON.parse(fs.readFileSync(statePath));assert.equal(state.syntheticOnly,true);
const fixtures=path.join(__dirname,'../services/worker/tests/fixtures/matrix-inventory-v1'),golden=JSON.parse(fs.readFileSync(path.join(fixtures,'portable-goldens.json')));
const out=path.resolve(process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t42-20261018/controlled-api');fs.mkdirSync(out,{recursive:true});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function canonical(value,legacy=false){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){assert.ok(Number.isSafeInteger(value));return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,legacy)).join(',')+']';
 const keys=Object.keys(value).sort(legacy?(a,b)=>a.localeCompare(b):undefined);return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k],legacy)).join(',')+'}';
}
function expected(spec){
 const f=golden.fixtures.find(f=>f.name===spec.fixtureName);assert.ok(f);const artifact=structuredClone(f.input.textArtifact);artifact.sourceFileId=spec.sourceFileId;
 const textArtifactHash=sha(canonical({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:artifact}));
 const inventory={...structuredClone(f.expected.inventory),sourceFileId:spec.sourceFileId,textArtifactHash};
 return {artifact,inventory,selection:structuredClone(f.input.selection),inventoryContentHash:sha(canonical({hashDomain:'matrix-inventory-source-id-v1',inventory}))};
}

const capabilityRegistryHash='4041e18e6325759fc44fdbc2c67045130fd194ade42d208ba1fda24d8decd76a';
const common={schemaVersion:'matrix-inventory-execution-result-v1',ruleId:'matrix-ar-053-declared_joint_damping_tape_omission',ruleVersion:'1',parameterCode:'AR-053',comparisonVariant:'PD_RD'};
function typedEnvelope(inputManifestHash,bodies){return {schemaVersion:'matrix-inventory-comparisons-v1',purpose:'MACHINE_COMPARISON',objectId:state.objectId,inputManifestHash,capabilityRegistryHash,results:bodies.map(result=>({...result,id:sha(canonical({hashDomain:'matrix-inventory-execution-result-id-v1',objectId:state.objectId,inputManifestHash,capabilityRegistryHash,result}))}))};}
function unbound(manifest){return typedEnvelope(manifest,[{...common,kind:'UNBOUND_ATOM_ABSTENTION',reasonCode:'REVIEWED_INVENTORY_IDENTITY_MISSING',calibratedProbability:null}]);}
function assertMergedCoverage(data,successful,abstentions){
 const base=data.execution.coverage,merged=data.effectiveCoverage;assert.equal(merged.length,132);
 assert.deepEqual(merged.filter(r=>r.parameterCode!=='AR-053'),base.filter(r=>r.parameterCode!=='AR-053'));
 assert.deepEqual(base.find(r=>r.parameterCode==='AR-053'),{parameterCode:'AR-053',implementedAtomicRules:0,enabledAtomicRules:0,evaluatedAtomicRules:0,successfulComparisons:0,abstentions:0,failures:0,executionStatus:'UNSUPPORTED',reason:'ENUMERATION_COMPLETE_AND_NEGATIVE_SCOPE_REQUIRED'});
 assert.deepEqual(merged.find(r=>r.parameterCode==='AR-053'),{parameterCode:'AR-053',implementedAtomicRules:1,enabledAtomicRules:1,evaluatedAtomicRules:1,successfulComparisons:successful,abstentions,failures:0,executionStatus:'PARTIAL',reason:'PARTIAL_SUBRULES_ONLY:REVIEWED_DECLARED_JOINT_DAMPING_TAPE_MEMBERSHIP_ONLY;GLOBAL_OR_PHYSICAL_ABSENCE_AND_SUBSTITUTION_UNSUPPORTED'});
 return {parametersWithAtoms:merged.filter(r=>r.implementedAtomicRules>0).length,atoms:merged.reduce((n,r)=>n+r.implementedAtomicRules,0),unsupported:merged.filter(r=>r.executionStatus==='UNSUPPORTED').length};
}
function expectedCandidate(manifest,origins){
 const identity={entityKey:'SYNTHETIC-building-A',componentRole:'PARTITION_SLAB_JOINT',componentKey:'SYNTHETIC-joint-P01',zoneKey:'SYNTHETIC-axes-A1',operatingModeKey:'DECLARED_NOISE_PROTECTION_MEASURES',measurementBasisKey:'SOURCE_AUTHORED_MEASURE_MEMBERSHIP'};
 function reference(stage){const source=origins.find(v=>v.spec.stage===stage),review=state.sourceReviewAssertions.find(v=>v.sourceFileId===source.spec.sourceFileId);return {sourceFileId:source.spec.sourceFileId,sourceSha256:source.spec.sha256,reviewDecisionId:review.reviewId,reviewContentHash:review.reviewHash,inventoryContentHash:source.e.inventoryContentHash};}
 const comparison={schemaVersion:'matrix-ar053-inventory-comparison-v1',status:'CANDIDATE',ruleId:common.ruleId,ruleVersion:'1',parameterCode:'AR-053',reasonCode:'DAMPING_TAPE_NOT_LISTED_IN_REVIEWED_RD_REGION',calibratedProbability:null,comparisonScope:'REVIEWED_DECLARED_REGIONS_ONLY',identity,expected:reference('PD'),actual:reference('RD'),missingFeatureKeys:['DAMPING_TAPE']};
 return typedEnvelope(manifest,[{...common,kind:'SCOPED_COMPARISON',identity,comparison}]);
}
function expectedEvidence(envelope,origins,originCheckId){
 const row=envelope.results[0],items=[];
 for(const role of ['EXPECTED','ACTUAL']){const ref=role==='EXPECTED'?row.comparison.expected:row.comparison.actual,source=origins.find(v=>v.spec.sourceFileId===ref.sourceFileId),inventory=source.e.inventory;
 const groups=[['HEADER',inventory.headerFragments],['SCOPE',inventory.scopeFragments],['FEATURE',inventory.featureRows.flatMap(r=>r.fragments)]];
 for(const[fragmentRole,fragments]of groups)for(const fragment of fragments){const page=source.e.artifact.pages.find(v=>v.pageNumber===fragment.pageNumber);items.push({resultId:row.id,role,...ref,originCheckId,pageNumber:fragment.pageNumber,pageFrame:{widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints},fragmentRole,fragment});}}
 return items;
}
function diagnostic(row){return {parameter_code:'M-053',location:row.kind==='SCOPED_COMPARISON'?row.identity.entityKey:'Область ведомости не установлена',pd_value:null,rd_value:null,id_value:null,violation_label:'COMPARISON_IMPOSSIBLE',protocol_status:'COMPARISON_IMPOSSIBLE',criticality:row.kind==='SCOPED_COMPARISON'?row.comparison.reasonCode:row.reasonCode,evidence:[]};}

let successfulDomainCommands=0,readOnlyPreviews=0;
async function call(endpoint,{method,body,key,authenticated=true,csrf=true}={}){
 const headers=new Headers();if(authenticated)headers.set('Cookie',Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; '));
 if(method){if(csrf)headers.set('X-CSRF-Token',decodeURIComponent(state.cookies.inspector_csrf||''));headers.set('Idempotency-Key',key||crypto.randomUUID());headers.set('Content-Type','application/json');}
 const response=await fetch(`${base}/api/${endpoint}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
 for(const c of response.headers.getSetCookie()){const[kv]=c.split(';'),[k,...v]=kv.split('=');state.cookies[k]=v.join('=');}
 const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(bytes);}catch{data=null;}
 if(method&&response.ok){if(endpoint.endsWith('/source-inventory-preview'))readOnlyPreviews++;else if(response.headers.get('Idempotency-Replayed')!=='true')successfulDomainCommands++;}
 return {status:response.status,data,bytes,replayed:response.headers.get('Idempotency-Replayed')};
}
async function get(endpoint){const r=await call(endpoint);assert.equal(r.status,200,`GET ${endpoint}: HTTP${r.status}`);return r;}
function reviewHash(review){const body={objectApiId:state.objectId,sourceFileApiId:review.sourceFileId,sourceSha256:review.sourceSha256,
 revisionStatus:review.revisionStatus,approvalStatus:review.approvalStatus,linkGroupId:review.linkGroupId,
 ...(review.sectionCode?{sectionCode:review.sectionCode}:{}),pageStages:review.pageStages,basis:review.basis,
 ...(review.matrixScope?{matrixScope:review.matrixScope}:{}),...(review.inventoryScope?{inventoryScope:review.inventoryScope}:{}),actorId:review.actorId};
 return sha(canonical(body,true));}
function project(scope){return {schemaVersion:scope.schemaVersion,claims:scope.claims.map(({inventorySnapshot,...input})=>input)};}
async function terminal(checkId){const run=(await get(`checks/${checkId}`)).data;assert.equal(run.objectId,state.objectId);assert.equal(run.progress,100);assert.ok(['PARTIAL','COMPLETED'].includes(run.status));return run;}
(async()=>{
 await terminal(state.checkId);const originalCheckId=mode==='review'?state.checkId:state.originCheckId;assert.ok(originalCheckId);
 const originMachine=(await get(`checks/${originalCheckId}/matrix-execution`)),originHash=sha(originMachine.bytes);
 const oldSubmission=await get(`checks/${originalCheckId}/submission`);const origins=[];
 assert.deepEqual(originMachine.data.inventoryComparisons,unbound(originMachine.data.execution.inputManifestHash));assertMergedCoverage(originMachine.data,0,1);assert.deepEqual(originMachine.data.inventoryComparisonEvidence,[]);assert.deepEqual(oldSubmission.data.checks.slice(originMachine.data.execution.results.length),originMachine.data.inventoryComparisons.results.map(diagnostic));
 for(const spec of state.sources){
  const e=expected(spec),endpoint=`checks/${originalCheckId}/source-inventory-pages?sourceFileId=${encodeURIComponent(spec.sourceFileId)}`;
  assert.equal((await call(endpoint,{authenticated:false})).status,401);
  const pages=(await get(endpoint)).data;assert.equal(pages.checkId,originalCheckId);assert.equal(pages.sourceSha256,spec.sha256);assert.equal(pages.stage,spec.stage);assert.deepEqual(pages.textArtifact,e.artifact);assert.equal(pages.textArtifactHash,e.inventory.textArtifactHash);
  const previewBody={sourceFileId:spec.sourceFileId,selection:e.selection};
  assert.equal((await call(`checks/${originalCheckId}/source-inventory-preview`,{method:'POST',body:previewBody,csrf:false})).status,403);
  const p=await call(`checks/${originalCheckId}/source-inventory-preview`,{method:'POST',body:previewBody});assert.equal(p.status,200);assert.deepEqual(p.data.result,{schemaVersion:'matrix-inventory-source-result-v1',status:'RECONSTRUCTED',inventory:e.inventory});
  const target={checkId:originalCheckId,inputManifestHash:pages.inputManifestHash,textStageContentHash:pages.textStageContentHash,textArtifactHash:pages.textArtifactHash,inventoryContentHash:e.inventoryContentHash};assert.deepEqual(p.data.target,target);
  assert.equal((await call(`checks/${originalCheckId}/source-inventory-preview`,{method:'POST',body:{...previewBody,inventorySnapshot:e.inventory}})).status,400);
  origins.push({spec,e,target});
 }
 const decisions=[];
 if(mode==='review'){
  assert.ok(consumerPath&&!fs.existsSync(consumerPath));assert.equal(state.sources.length,2);
  for(const {spec,e,target} of origins){
   const endpoint=`objects/${state.objectId}/files/${spec.sourceFileId}/source-review`;assert.equal((await call(endpoint)).status,404);
   const claim={target,selection:e.selection,entityKey:'SYNTHETIC-building-A',componentRole:'PARTITION_SLAB_JOINT',componentKey:'SYNTHETIC-joint-P01',zoneKey:'SYNTHETIC-axes-A1',
    operatingModeKey:'DECLARED_NOISE_PROTECTION_MEASURES',measurementBasisKey:'SOURCE_AUTHORED_MEASURE_MEMBERSHIP',assertion:'HUMAN_ASSERTED_COMPLETE',reference:'SYNTHETIC ONLY: controlled source-region completeness assertion for API integration test'};
   const input={sourceSha256:spec.sha256,revisionStatus:'CURRENT',approvalStatus:'APPROVED',sectionCode:'AR',linkGroupId:'T42-SYNTHETIC-ONLY',pageStages:{},basis:{reference:'SYNTHETIC ONLY: controlled source review, not an actual project approval'},
    inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[claim]},expectedReviewHash:null};
   const key=crypto.randomUUID(),first=await call(endpoint,{method:'POST',body:input,key});assert.equal(first.status,201);assert.equal(first.data.contentHash,reviewHash(first.data));assert.deepEqual(first.data.inventoryScope.claims[0].inventorySnapshot,e.inventory);
   const replay=await call(endpoint,{method:'POST',body:input,key});assert.equal(replay.status,201);assert.equal(replay.replayed,'true');assert.deepEqual(replay.data,first.data);
   const stale=await call(endpoint,{method:'POST',body:input});assert.equal(stale.status,409);assert.equal(stale.data.error,'SOURCE_REVIEW_STALE');
   let latest=first.data;
   if(spec.stage==='PD'){
    const {inventoryScope,...withoutInventory}=input;delete withoutInventory.expectedReviewHash;
    assert.equal((await call(endpoint,{method:'POST',body:withoutInventory})).status,409);
    const preserved=await call(endpoint,{method:'POST',body:{...withoutInventory,basis:{reference:'SYNTHETIC ONLY: legacy omission preserves the checked inventory sibling'},expectedReviewHash:latest.contentHash}});assert.equal(preserved.status,201);assert.deepEqual(preserved.data.inventoryScope,latest.inventoryScope);assert.equal(preserved.data.contentHash,reviewHash(preserved.data));latest=preserved.data;
    const withdraw=await call(endpoint,{method:'POST',body:{...input,inventoryScope:{schemaVersion:'matrix-inventory-review-v1',claims:[]},expectedReviewHash:latest.contentHash}});assert.equal(withdraw.status,201);assert.equal(withdraw.data.inventoryScope.claims.length,0);latest=withdraw.data;
    const restore=await call(endpoint,{method:'POST',body:{...input,expectedReviewHash:latest.contentHash}});assert.equal(restore.status,201);assert.deepEqual(restore.data.inventoryScope.claims[0].inventorySnapshot,e.inventory);latest=restore.data;
   }
   assert.equal(latest.contentHash,reviewHash(latest));assert.deepEqual((await get(endpoint)).data,latest);decisions.push({sourceFileId:spec.sourceFileId,reviewId:latest.id,reviewHash:latest.contentHash,inventoryContentHash:target.inventoryContentHash,assertion:latest.inventoryScope.claims[0].assertion});
  }
  assert.equal(sha((await get(`checks/${originalCheckId}/matrix-execution`)).bytes),originHash);assert.equal(sha((await get(`checks/${originalCheckId}/submission`)).bytes),sha(oldSubmission.bytes));
  const created=await call(`objects/${state.objectId}/checks`,{method:'POST',body:{analysisMode:'FULL'}});assert.equal(created.status,201);
  const next={...state,checkId:created.data.id,originCheckId:originalCheckId,originMachineBytesSha256:originHash,originSubmissionSha256:sha(oldSubmission.bytes),sourceReviewAssertions:decisions};
  fs.writeFileSync(consumerPath,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});const backup=path.join(os.homedir(),'.local/state/inspector-feedback-20261017',`${next.checkId}.json`);fs.writeFileSync(backup,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});
  const receipt={status:'PASS_REVIEW_PENDING_CONSUMER',syntheticOnly:true,objectId:state.objectId,originCheckId:originalCheckId,consumerCheckId:next.checkId,sourceReviews:decisions,successfulDomainCommands,readOnlyPreviews,originUnchanged:true,browserCalls:0,realPublicPair:false};
  fs.writeFileSync(path.join(out,'review-result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
 }else{
  assert.equal(originHash,state.originMachineBytesSha256);assert.equal(sha(oldSubmission.bytes),state.originSubmissionSha256);
  for(const {spec,e,target} of origins){const review=(await get(`objects/${state.objectId}/files/${spec.sourceFileId}/source-review`)).data;const saved=state.sourceReviewAssertions.find(s=>s.sourceFileId===spec.sourceFileId);
   assert.equal(review.id,saved.reviewId);assert.equal(review.contentHash,saved.reviewHash);assert.equal(reviewHash(review),review.contentHash);assert.deepEqual(review.inventoryScope.claims[0].inventorySnapshot,e.inventory);assert.deepEqual(project(review.inventoryScope).claims[0].target,target);}
  const current=(await get(`checks/${state.checkId}/matrix-execution`)).data,execution=current.execution;
  assert.notEqual(execution.inputManifestHash,originMachine.data.execution.inputManifestHash);assert.deepEqual(execution.observations,originMachine.data.execution.observations);assert.deepEqual(execution.results,originMachine.data.execution.results);
  assert.ok(execution.results.every(r=>!r.qualified));assert.ok(current.presentation.every(p=>p.confidence.calibratedProbability===null));
  const counts={parametersWithAtoms:execution.coverage.filter(c=>c.implementedAtomicRules>0).length,atoms:execution.coverage.reduce((n,c)=>n+c.implementedAtomicRules,0),unsupported:execution.coverage.filter(c=>c.executionStatus==='UNSUPPORTED').length};
  assert.deepEqual(counts,{parametersWithAtoms:55,atoms:63,unsupported:77});const typed=expectedCandidate(execution.inputManifestHash,origins);assert.deepEqual(current.inventoryComparisons,typed);const effective=assertMergedCoverage(current,1,0);assert.deepEqual(effective,{parametersWithAtoms:56,atoms:64,unsupported:76});const sorted=items=>items.map(item=>canonical(item)).sort();assert.deepEqual(sorted(current.inventoryComparisonEvidence),sorted(expectedEvidence(typed,origins,originalCheckId)));assert.equal(new Set(sorted(current.inventoryComparisonEvidence)).size,current.inventoryComparisonEvidence.length);const sub=await get(`checks/${state.checkId}/submission`);assert.equal(sha(sub.bytes),current.submission.contentHash);assert.deepEqual(sub.data.checks.slice(0,execution.results.length),oldSubmission.data.checks.slice(0,execution.results.length));assert.deepEqual(sub.data.checks.slice(execution.results.length),typed.results.map(diagnostic));assert.ok(sub.data.checks.every(row=>row.violation_label==='COMPARISON_IMPOSSIBLE'&&row.protocol_status==='COMPARISON_IMPOSSIBLE'));
  assert.equal(successfulDomainCommands,0);const receipt={status:'PASS',syntheticOnly:true,objectId:state.objectId,originCheckId:originalCheckId,consumerCheckId:state.checkId,originalPages:4,sourceReviews:state.sourceReviewAssertions,qualified:0,scalarRegistry:counts,effectiveCoverage:effective,typedCandidates:1,typedAbstentions:0,originalEvidenceFragments:current.inventoryComparisonEvidence.length,oldOriginUnchanged:true,scalarSubmissionRowsUnchanged:true,typedSubmissionConservative:true,successfulDomainCommands,readOnlyPreviews,browserCalls:0,realPublicPair:false};
  fs.writeFileSync(path.join(out,'consumer-result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
