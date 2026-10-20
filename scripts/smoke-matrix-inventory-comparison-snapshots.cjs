/** T42 synthetic frozen-review regression. Authenticated HTTP, never browser evidence.
 * supersede positive-private-state new-unknown-private-state | verify unknown-private-state
 * supersede changes one source approval to UNKNOWN and starts one consumer check.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const [mode,statePath,nextPath]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082';
assert.ok(['supersede','verify'].includes(mode)&&statePath&&['127.0.0.1','localhost'].includes(new URL(base).hostname));
assert.equal(fs.statSync(statePath).mode&0o777,0o600);const state=JSON.parse(fs.readFileSync(statePath));assert.equal(state.syntheticOnly,true);
const out=path.resolve(process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t42-20261018/controlled-api');fs.mkdirSync(out,{recursive:true});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function canonical(value,legacy=false){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(v=>canonical(v,legacy)).join(',')+']';return '{'+Object.keys(value).sort(legacy?(a,b)=>a.localeCompare(b):undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k],legacy)).join(',')+'}';}
let successfulDomainCommands=0;
async function call(endpoint,options={}){
  const headers=new Headers({'Cookie':Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; ')});
  if(options.method){headers.set('X-CSRF-Token',decodeURIComponent(state.cookies.inspector_csrf||''));headers.set('Idempotency-Key',crypto.randomUUID());headers.set('Content-Type','application/json');}
  const response=await fetch(`${base}/api/${endpoint}`,{...options,headers,signal:AbortSignal.timeout(60000)});
  for(const cookie of response.headers.getSetCookie()){const[kv]=cookie.split(';'),[key,...value]=kv.split('=');state.cookies[key]=value.join('=');}
  const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(bytes);}catch{data=null;}
  assert.ok(response.ok,`${endpoint}: HTTP ${response.status}`);if(options.method)successfulDomainCommands++;
  return {data,bytes};
}
function savePrivate(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
async function terminal(checkId){const run=(await call(`checks/${checkId}`)).data;assert.equal(run.objectId,state.objectId);assert.equal(run.progress,100);assert.ok(['PARTIAL','COMPLETED'].includes(run.status));return run;}
function reviewHash(review){return sha(canonical({objectApiId:state.objectId,sourceFileApiId:review.sourceFileId,sourceSha256:review.sourceSha256,revisionStatus:review.revisionStatus,approvalStatus:review.approvalStatus,linkGroupId:review.linkGroupId,...(review.sectionCode?{sectionCode:review.sectionCode}:{}),pageStages:review.pageStages,basis:review.basis,...(review.matrixScope?{matrixScope:review.matrixScope}:{}),...(review.inventoryScope?{inventoryScope:review.inventoryScope}:{}),actorId:review.actorId},true));}
function expectedAbstention(positive,inputManifestHash){const previous=positive.inventoryComparisons;assert.equal(previous.results.length,1);const {id,...body}=previous.results[0];const result={...body,comparison:{schemaVersion:'matrix-ar053-inventory-comparison-v1',status:'ABSTAIN',reasonCode:'SOURCE_REVIEW_UNVERIFIED',calibratedProbability:null}};
  return {...previous,inputManifestHash,results:[{...result,id:sha(canonical({hashDomain:'matrix-inventory-execution-result-id-v1',objectId:state.objectId,inputManifestHash,capabilityRegistryHash:previous.capabilityRegistryHash,result}))}]};}
function diagnostic(row){return {parameter_code:'M-053',location:row.identity.entityKey,pd_value:null,rd_value:null,id_value:null,violation_label:'COMPARISON_IMPOSSIBLE',protocol_status:'COMPARISON_IMPOSSIBLE',criticality:'SOURCE_REVIEW_UNVERIFIED',evidence:[]};}
(async()=>{
  if(mode==='supersede'){
    assert.ok(nextPath&&!fs.existsSync(nextPath)&&!fs.existsSync(nextPath+'.journal'));await terminal(state.checkId);
    const positive=await call(`checks/${state.checkId}/matrix-execution`),submission=await call(`checks/${state.checkId}/submission`);
    assert.equal(positive.data.inventoryComparisons.results[0].comparison.status,'CANDIDATE');assert.equal(positive.data.inventoryComparisons.results[0].comparison.calibratedProbability,null);
    const rd=state.sources.find(source=>source.stage==='RD');assert.ok(rd);const endpoint=`objects/${state.objectId}/files/${rd.sourceFileId}/source-review`;
    const latest=(await call(endpoint)).data;assert.equal(latest.contentHash,reviewHash(latest));assert.equal(latest.approvalStatus,'APPROVED');
    const projected={schemaVersion:latest.inventoryScope.schemaVersion,claims:latest.inventoryScope.claims.map(({inventorySnapshot,...claim})=>claim)};
    const input={sourceSha256:latest.sourceSha256,revisionStatus:latest.revisionStatus,approvalStatus:'UNKNOWN',linkGroupId:latest.linkGroupId,sectionCode:latest.sectionCode,pageStages:latest.pageStages,basis:{reference:'SYNTHETIC ONLY: later RD approval UNKNOWN; prior machine snapshots must remain unchanged'},...(latest.matrixScope?{matrixScope:latest.matrixScope}:{}),inventoryScope:projected,expectedReviewHash:latest.contentHash};
    const changed=(await call(endpoint,{method:'POST',body:JSON.stringify(input)})).data;assert.equal(changed.contentHash,reviewHash(changed));assert.equal(changed.approvalStatus,'UNKNOWN');assert.deepEqual(changed.inventoryScope,latest.inventoryScope);
    const partial={...state,positiveCheckId:state.checkId,positiveMachineSha256:sha(positive.bytes),positiveSubmissionSha256:sha(submission.bytes),unknownReview:{sourceFileId:rd.sourceFileId,id:changed.id,hash:changed.contentHash}};
    savePrivate(nextPath+'.journal',partial);
    assert.equal(sha((await call(`checks/${state.checkId}/matrix-execution`)).bytes),partial.positiveMachineSha256);assert.equal(sha((await call(`checks/${state.checkId}/submission`)).bytes),partial.positiveSubmissionSha256);
    const created=(await call(`objects/${state.objectId}/checks`,{method:'POST',body:JSON.stringify({analysisMode:'FULL'})})).data;
    const next={...partial,checkId:created.id};savePrivate(nextPath,next);
    savePrivate(path.join(os.homedir(),'.local/state/inspector-feedback-20261017',`${next.checkId}.json`),next);
    const receipt={status:'PASS_SUPERSEDED_PENDING_CONSUMER',objectId:state.objectId,positiveCheckId:state.checkId,unknownCheckId:next.checkId,syntheticOnly:true,successfulDomainCommands,historicalPositiveUnchanged:true,browserCalls:0};
    fs.writeFileSync(path.join(out,'supersede-result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
  }else{
    await terminal(state.checkId);const positive=await call(`checks/${state.positiveCheckId}/matrix-execution`),oldSubmission=await call(`checks/${state.positiveCheckId}/submission`);
    assert.equal(sha(positive.bytes),state.positiveMachineSha256);assert.equal(sha(oldSubmission.bytes),state.positiveSubmissionSha256);
    const current=(await call(`checks/${state.checkId}/matrix-execution`)).data,typed=expectedAbstention(positive.data,current.execution.inputManifestHash);
    assert.deepEqual(current.inventoryComparisons,typed);assert.deepEqual(current.inventoryComparisonEvidence,[]);
    assert.deepEqual(current.execution.results,positive.data.execution.results);assert.deepEqual(current.execution.observations,positive.data.execution.observations);
    const base=current.execution.coverage,merged=current.effectiveCoverage;assert.equal(merged.length,132);assert.deepEqual(merged.filter(row=>row.parameterCode!=='AR-053'),base.filter(row=>row.parameterCode!=='AR-053'));
    const ar=merged.find(row=>row.parameterCode==='AR-053');assert.equal(ar.implementedAtomicRules,1);assert.equal(ar.evaluatedAtomicRules,1);assert.equal(ar.successfulComparisons,0);assert.equal(ar.abstentions,1);assert.equal(ar.failures,0);assert.equal(ar.executionStatus,'PARTIAL');
    const review=(await call(`objects/${state.objectId}/files/${state.unknownReview.sourceFileId}/source-review`)).data;assert.equal(review.id,state.unknownReview.id);assert.equal(review.contentHash,state.unknownReview.hash);assert.equal(review.contentHash,reviewHash(review));
    const sub=await call(`checks/${state.checkId}/submission`);assert.equal(sha(sub.bytes),current.submission.contentHash);assert.deepEqual(sub.data.checks.slice(0,current.execution.results.length),oldSubmission.data.checks.slice(0,current.execution.results.length));assert.deepEqual(sub.data.checks.slice(current.execution.results.length),typed.results.map(diagnostic));
    assert.ok(current.presentation.every(value=>value.confidence.calibratedProbability===null));assert.equal(successfulDomainCommands,0);
    const receipt={status:'PASS',objectId:state.objectId,positiveCheckId:state.positiveCheckId,unknownCheckId:state.checkId,typedReason:'SOURCE_REVIEW_UNVERIFIED',typedCandidates:0,typedAbstentions:1,historicalPositiveUnchanged:true,scalarSubmissionRowsUnchanged:true,typedSubmissionConservative:true,syntheticOnly:true,successfulDomainCommands,browserCalls:0};
    fs.writeFileSync(path.join(out,'unknown-consumer-result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
