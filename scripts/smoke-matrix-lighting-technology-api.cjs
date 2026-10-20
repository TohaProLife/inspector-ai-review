/** Finite original-backed SYNTHETIC HTTP v9 acceptance. No runtime comparator imports. */
'use strict';
const h=require('./seed-matrix-water-node-controlled.cjs');
const {fs,path,assert,crypto,sha,clone,canonical,privateRead}=h;
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/matrix-t67-20261018');
const goldenBytes=fs.readFileSync(path.join(root,'fixtures/matrix-lighting-technology-execution-v1/qa-manual-execution-goldens.json'));
assert.equal(sha(goldenBytes),'264c3ed29f73f03a65e2e286b85ce6a6e91f8b4b76e42e019b6930fa6b85390e');
const manual=JSON.parse(goldenBytes).validCases[0].package;
const specs=manual.sources.map((s,i)=>{const body=fs.readFileSync(path.join(root,`fixtures/matrix-lighting-technology-source-v1/research-${i?'named-fluorescent':'named-led'}.pdf`));assert.equal(sha(body),s.sourceSha256);return {stage:i?'RD':'PD',sha256:s.sourceSha256,body};});
const domain=(hashDomain,key,value)=>sha(canonical({hashDomain,[key]:value}));
const statePath='/tmp/matrix-t67-lighting-controlled-private.json';
function save(s){h.atomicPrivate(statePath,s);}
async function request(s,url,opt={}){return h.request(s,url,opt);}
async function get(s,url){return h.get(s,url);}
async function command(s,label,url,body,contentType='application/json'){
 s.operations??={};const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));let op=s.operations[label];
 if(!op){op=s.operations[label]={key:crypto.randomUUID(),url,bodyHash:sha(bytes),contentType,status:'PENDING'};save(s);}
 assert.equal(op.url,url);assert.equal(op.bodyHash,sha(bytes));assert.equal(op.contentType,contentType);
 if(op.status==='DONE')return clone(op.response);
 const r=await request(s,url,{method:'POST',body:bytes,headers:{'Content-Type':contentType},key:op.key});save(s);
 assert.equal(r.status,201,`${label} HTTP${r.status} ${r.data?.error||''}`);op.response=r.data;op.status='DONE';op.responseHash=sha(r.bytes);save(s);return clone(r.data);
}
async function terminal(s,id){const until=Date.now()+180000;let last;while(Date.now()<until){last=(await get(s,`checks/${id}`)).data;if(['PARTIAL','COMPLETED','FAILED','CANCELLED'].includes(last.status)){assert.ok(['PARTIAL','COMPLETED'].includes(last.status),`Check ${id} ${last.status} ${last.failure?.code||''}`);assert.equal(last.progress,100);return last;}await new Promise(r=>setTimeout(r,1500));}throw Error('Check bounded wait expired; journal retained '+id);}
async function expectedOrigin(s,i){const spec=s.sources[i],a=clone(manual.origins[i].textArtifact);a.sourceFileId=spec.sourceFileId;
 const original=manual.sources[i].review.lightingTechnologyScope.claims[0],declaration={...clone(original.declarationSnapshot),sourceFileId:spec.sourceFileId,textArtifactHash:domain('document-text-v3-content-v1','artifact',a)};
 return {artifact:a,declaration,selection:clone(original.selection),identity:clone(original.identity),positionMapping:clone(original.positionMapping)};
}
function inputFromReview(d){return {sourceSha256:d.sourceSha256,revisionStatus:d.revisionStatus,approvalStatus:d.approvalStatus,sectionCode:d.sectionCode,linkGroupId:d.linkGroupId,pageStages:d.pageStages,basis:d.basis,expectedReviewHash:d.contentHash,
 lightingTechnologyScope:{schemaVersion:'matrix-zu130-lighting-technology-review-v1',claims:d.lightingTechnologyScope.claims.map(({declarationSnapshot,...claim})=>clone(claim))}};}
async function verify(s,phase){const id=s[phase+'CheckId'];await terminal(s,id);const r=await get(s,`checks/${id}/matrix-execution`),m=r.data,lighting=m.lightingTechnologyComparisons;
 assert.equal(lighting.schemaVersion,'matrix-lighting-technology-comparisons-v1');assert.equal(lighting.results.length,1);const row=lighting.results[0];assert.equal(row.kind,'SCOPED_COMPARISON');
 assert.equal(row.comparison.status,phase==='revoked'?'ABSTAIN':'CANDIDATE');assert.equal(row.comparison.calibratedProbability,null);
 const c=m.effectiveCoverage;assert.equal(c.length,132);assert.equal(c.filter(x=>x.implementedAtomicRules>0).length,60);assert.equal(c.reduce((n,x)=>n+x.implementedAtomicRules,0),68);assert.equal(c.filter(x=>x.executionStatus==='UNSUPPORTED').length,72);
 assert.equal(c.find(x=>x.parameterCode==='ZU-130').executionStatus,'PARTIAL');
 assert.ok(m.presentation.every(x=>x.policyVersion==='machine-confidence-policy-v2'&&x.machineDisposition!=='WARNING'));
 for(const key of ['inventoryComparisons','callInventoryComparisons','railInventoryComparisons','waterNodeComparisons'])assert.ok(m[key].results.every(x=>x.kind==='UNBOUND_ATOM_ABSTENTION'));
 const evidence=m.lightingTechnologyComparisonEvidence;assert.equal(evidence.length,phase==='revoked'?0:2);
 if(phase!=='revoked'){assert.equal(row.comparison.expectedTechnology,'LED');assert.equal(row.comparison.actualTechnology,'FLUORESCENT');for(let i=0;i<2;i++){const e=await expectedOrigin(s,i);assert.equal(evidence[i].sourceSha256,s.sources[i].sha256);assert.deepEqual(evidence[i].fragment,e.declaration.primaryFragments[0]);assert.deepEqual(evidence[i].nativeFrame,e.declaration.nativeFrame);}}
 const sub=await get(s,`checks/${id}/submission`);assert.equal(sha(sub.bytes),m.submission.contentHash);const last=sub.data.checks.at(-1);assert.equal(last.parameter_code,'M-130');assert.equal(last.violation_label,'COMPARISON_IMPOSSIBLE');assert.equal(last.protocol_status,'COMPARISON_IMPOSSIBLE');assert.deepEqual(last.evidence,[]);assert.equal(last.pd_value,null);assert.equal(last.rd_value,null);
 const value={status:'PASS_ACTUAL_HTTP_V9',phase,checkId:id,objectId:s.objectId,syntheticOnly:true,realQualifiedPairs:0,counts:{parameters:60,atoms:68,unsupported:72},candidate:phase!=='revoked',calibratedProbability:null,nativeEvidenceCount:evidence.length,executionHash:m.contentHash,matrixResponseSha256:sha(r.bytes),submissionSha256:sha(sub.bytes),browserCalls:0};
 const receipt=path.join(out,`stand-${phase}-http.json`);if(fs.existsSync(receipt))assert.deepEqual(JSON.parse(fs.readFileSync(receipt)),value);else fs.writeFileSync(receipt,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 s.historical??={};const history={matrixSha256:sha(r.bytes),submissionSha256:sha(sub.bytes)};if(s.historical[id])assert.deepEqual(s.historical[id],history);else{s.historical[id]=history;save(s);}return value;
}
async function verifyHistory(s){for(const [id,v]of Object.entries(s.historical??{})){assert.equal(sha((await get(s,`checks/${id}/matrix-execution`)).bytes),v.matrixSha256);assert.equal(sha((await get(s,`checks/${id}/submission`)).bytes),v.submissionSha256);}return {status:'PASS_CONTROLLED_HISTORICAL_BYTES',checks:Object.keys(s.historical??{}).length,browserCalls:0};}
async function main(){const mode=process.argv[2];assert.ok(['--self-test','seed','review','positive','revoke','revoked','restore','restored','history'].includes(mode));if(mode==='--self-test'){for(let i=0;i<2;i++){const a=manual.origins[i].textArtifact,d=manual.sources[i].review.lightingTechnologyScope.claims[0].declarationSnapshot;assert.equal(domain('document-text-v3-content-v1','artifact',a),d.textArtifactHash);assert.equal(domain('matrix-zu130-lighting-technology-v3-source-id-v1','declaration',d),manual.sources[i].review.lightingTechnologyScope.claims[0].target.declarationContentHash);}console.log(JSON.stringify({status:'PASS_FROZEN_MANUAL_ORIGINALS',originals:2,runtimeOracleImports:0}));return;}
 let s;if(fs.existsSync(statePath))s=privateRead(statePath);else{assert.equal(mode,'seed');const auth=privateRead('/tmp/matrix-t54-current-workspace-auth.json');s={schemaVersion:'matrix-t67-lighting-controlled-private-v1',journalId:crypto.randomUUID(),cookies:auth.cookies,syntheticOnly:true,sources:[],operations:{}};save(s);}assert.equal(s.syntheticOnly,true);
 if(mode==='seed'){const object=await command(s,'create-object','objects',{name:'T67 SYNTHETIC ONLY — named LED replacement',address:'Two authored original PDFs; no real project approval'});s.objectId=object.id;save(s);
 for(let i=0;i<2;i++){const spec=specs[i],boundary='----t67-'+s.journalId+'-'+i,body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="T67-SYNTHETIC-${spec.stage}.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),spec.body,Buffer.from(`\r\n--${boundary}--\r\n`)]);await command(s,'upload-'+i,`objects/${s.objectId}/files?stage=${spec.stage}`,body,'multipart/form-data; boundary='+boundary);const files=(await get(s,`objects/${s.objectId}/files`)).data.items,found=files.filter(f=>f.sha256===spec.sha256);assert.equal(found.length,1);s.sources[i]={sourceFileId:found[0].id,sha256:spec.sha256,stage:spec.stage};save(s);}
 const audit=await command(s,'audit',`objects/${s.objectId}/source-audit-v3`,{});s.auditCheckId=audit.id;save(s);const check=await terminal(s,audit.id);assert.equal(check.purpose,'SOURCE_AUDIT_ONLY');console.log(JSON.stringify({status:'SOURCE_AUDIT_COMPLETED',checkId:audit.id,objectId:s.objectId}));return;}
 if(mode==='review'){await terminal(s,s.auditCheckId);for(let i=0;i<2;i++){const spec=s.sources[i],e=await expectedOrigin(s,i),read=(await get(s,`checks/${s.auditCheckId}/source-text-v3?sourceFileId=${spec.sourceFileId}`)).data;assert.deepEqual(read.textArtifact,e.artifact);
 const preview=await request(s,`checks/${s.auditCheckId}/source-files/${spec.sourceFileId}/lighting-technology-preview`,{method:'POST',body:JSON.stringify({selection:e.selection}),headers:{'Content-Type':'application/json'}});assert.equal(preview.status,200);assert.deepEqual(preview.data.result.declaration,e.declaration);
 const input={sourceSha256:spec.sha256,revisionStatus:'CURRENT',approvalStatus:'APPROVED',sectionCode:'IOS1',linkGroupId:'T67-SYNTHETIC-ONLY-NAMED-LIGHT',pageStages:{},basis:{reference:'SYNTHETIC ONLY: same authored lighting source position; no actual project approval'},expectedReviewHash:null,lightingTechnologyScope:{schemaVersion:'matrix-zu130-lighting-technology-review-v1',claims:[{target:preview.data.target,selection:e.selection,identity:e.identity,positionMapping:e.positionMapping,reference:'SYNTHETIC ONLY: original-backed named-position mapping, not actual project approval'}]}};
 const d=await command(s,'review-'+i,`objects/${s.objectId}/files/${spec.sourceFileId}/source-review`,input);assert.deepEqual(d.lightingTechnologyScope.claims[0].declarationSnapshot,e.declaration);s.reviewInputs??=[];s.reviewInputs[i]=input;save(s);}
 const check=await command(s,'positive',`objects/${s.objectId}/checks`,{analysisMode:'FULL'});s.positiveCheckId=check.id;save(s);console.log(JSON.stringify({status:'POSITIVE_STARTED',checkId:check.id}));return;}
 if(mode==='revoke'||mode==='restore'){const spec=s.sources[1],url=`objects/${s.objectId}/files/${spec.sourceFileId}/source-review`;s.phaseInputs??={};if(!s.phaseInputs[mode]){const d=(await get(s,url)).data,input=inputFromReview(d);input.lightingTechnologyScope=mode==='revoke'?{schemaVersion:'matrix-zu130-lighting-technology-review-v1',claims:[]}:clone(s.reviewInputs[1].lightingTechnologyScope);s.phaseInputs[mode]=input;save(s);}await command(s,mode,url,s.phaseInputs[mode]);const check=await command(s,mode+'-check',`objects/${s.objectId}/checks`,{analysisMode:'FULL'});s[(mode==='revoke'?'revoked':'restored')+'CheckId']=check.id;save(s);console.log(JSON.stringify({status:'PHASE_STARTED',phase:mode,checkId:check.id}));return;}
 if(mode==='history'){console.log(JSON.stringify(await verifyHistory(s)));return;}
 console.log(JSON.stringify(await verify(s,mode)));console.log(JSON.stringify(await verifyHistory(s)));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
