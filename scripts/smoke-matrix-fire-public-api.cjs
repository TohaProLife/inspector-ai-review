/** T38: authenticated HTTP readback of one complete allowlisted PDF; no browser claim. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const [statePath]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082',origin=new URL(base).origin;
if(!statePath||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state and loopback stand required');
assert.equal(fs.statSync(statePath).mode&0o777,0o600);
const state=JSON.parse(fs.readFileSync(statePath)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const key of ['objectId','checkId'])assert.match(state[key],/^[A-Za-z0-9_-]+$/u);
assert.ok(state.cookies&&typeof state.cookies==='object'&&!Array.isArray(state.cookies));
const out=path.resolve(process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t38-20261018/public-api-real');
const research=path.join(__dirname,'../output/matrix-t38-20261018'),fixtures=path.join(__dirname,'../services/worker/tests/fixtures/matrix-fire-table-v1');
const identity=JSON.parse(fs.readFileSync(path.join(research,'real-object-identity.json')));
assert.equal(identity.status,'PASS_READ_ONLY_IDENTITY');assert.equal(identity.objectId,state.objectId);assert.equal(identity.checkId,state.checkId);
assert.equal(identity.runObjectId,identity.internalObjectId);assert.match(identity.internalObjectId,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
const goldenBytes=fs.readFileSync(path.join(fixtures,'portable-goldens.json'));
assert.equal(sha(goldenBytes),'f70895bdd643316ad33bea29500938ed37e96fc0d5f419eca97086581bb7809c');
const golden=JSON.parse(goldenBytes),spec={sid:'F0106',stage:'PD',section:'KR',pages:139,page:51,bytes:23871472,sha256:'ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655'};
// Standalone oracle: no production parser or hash implementation imported.
function canonical(value,depth=0){
 assert.ok(depth<=64);
 if(value===null||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='string'){for(const c of value){const n=c.codePointAt(0);assert.ok(n<0xd800||n>0xdfff);}return JSON.stringify(value);}
 if(typeof value==='number'){assert.ok(Number.isSafeInteger(value));return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 assert.ok(value&&typeof value==='object');const keys=Object.keys(value).sort();for(const k of keys)assert.match(k,/^[\x00-\x7f]*$/u);
 return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
function expectedDeclarations(sourceFileId){
 const bytes=fs.readFileSync(path.join(fixtures,'F0106-full.text.json'));assert.equal(sha(bytes),'1aa99c72405982a5e67f7a669d3df297f7379c61738f99cc01ab1db4715b5473');
 const artifact=JSON.parse(bytes);assert.equal(artifact.sourceFileId,spec.sid);assert.equal(artifact.inputSha256,spec.sha256);assert.equal(artifact.pageCount,spec.pages);
 assert.deepEqual(artifact.pages.map(p=>p.pageNumber),Array.from({length:spec.pages},(_,i)=>i+1));
 artifact.sourceFileId=sourceFileId;
 const textArtifactHash=sha(canonical({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:artifact}));
 const page=artifact.pages[spec.page-1],candidates=golden.vectors.find(v=>v.name==='original').expected;assert.equal(candidates.length,6);
 const declarations=candidates.map(candidate=>{
  for(const fragment of [...candidate.primaryFragments,...candidate.scopeFragments,...candidate.headerFragments,...candidate.unitFragments]){
   const block=page.blocks[fragment.blockIndex];assert.equal(fragment.pageNumber,page.pageNumber);assert.equal(block.text.split('\n')[fragment.lineIndex],fragment.rawText);assert.deepEqual(block.lineBboxesMilliPoints[fragment.lineIndex],fragment.bboxMilliPoints);
  }
  const body={schemaVersion:'matrix-source-declaration-v1',kind:'SOURCE_AUTHORED_FIRE_RESISTANCE_DECLARATION',extractorVersion:'matrix-fire-resistance-table-v1',sourceFileId,sourceSha256:spec.sha256,textArtifactHash,
   stage:spec.stage,pageNumber:spec.page,widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints,entityKey:null,applicabilityStatus:'UNREVIEWED',...candidate};
  return {id:sha(canonical({hashDomain:'matrix-source-declaration-id-v1',declaration:body})),...body};
 }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return {artifact,page,declarations};
}
async function response(endpoint,authenticated=true){
 const headers=authenticated?{Cookie:Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; ')}:{};
 const r=await fetch(`${origin}/api/${endpoint}`,{headers,signal:AbortSignal.timeout(30000)});
 return {status:r.status,bytes:Buffer.from(await r.arrayBuffer()),headers:Object.fromEntries(r.headers)};
}
async function get(endpoint){const r=await response(endpoint);assert.equal(r.status,200,`GET ${endpoint}: HTTP${r.status}`);return r;}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-t38-api-'));
 try{
  const run=JSON.parse((await get(`checks/${state.checkId}`)).bytes);assert.equal(run.objectId,state.objectId);assert.equal(run.progress,100);assert.equal(run.mode,'NORMAL');assert.ok(['PARTIAL','COMPLETED'].includes(run.status));
  const endpoint=`checks/${state.checkId}/matrix-execution`,machineBytes=(await get(endpoint)).bytes,machine=JSON.parse(machineBytes),execution=machine.execution,evidence=machine.sourceDeclarations;
  assert.equal(machine.checkId,state.checkId);assert.equal(execution.objectId,identity.internalObjectId);assert.ok(evidence);
  assert.equal(evidence.schemaVersion,'matrix-source-declarations-v2');assert.equal(evidence.extractorVersion,'matrix-source-declarations-v2');assert.equal(evidence.purpose,'EVIDENCE_ONLY');
  assert.equal(evidence.objectId,identity.internalObjectId);assert.equal(evidence.inputManifestHash,execution.inputManifestHash);assert.equal(evidence.declarations.length,6);
  const sourceFileId=evidence.declarations[0].sourceFileId,expected=expectedDeclarations(sourceFileId);assert.deepEqual(evidence.declarations,expected.declarations);
  assert.ok(!Object.hasOwn(execution,'sourceDeclarations')&&!Object.hasOwn(execution,'declarations'));
  const ids=new Set(evidence.declarations.map(d=>d.id));
  assert.ok(execution.observations.every(o=>!ids.has(o.id)&&!Object.hasOwn(o,'criterion')&&!Object.hasOwn(o,'minutes')));
  assert.ok(execution.results.every(r=>!r.qualified&&r.parameterCode!=='KR-066'));
  assert.ok(machine.presentation.every(p=>p.confidence.calibratedProbability===null));
  const coverage=execution.coverage;assert.equal(coverage.length,132);
  const counts={parametersWithAtoms:coverage.filter(c=>c.implementedAtomicRules>0).length,atoms:coverage.reduce((n,c)=>n+c.implementedAtomicRules,0),unsupported:coverage.filter(c=>c.executionStatus==='UNSUPPORTED').length};
  assert.deepEqual(counts,{parametersWithAtoms:55,atoms:63,unsupported:77});assert.equal(coverage.find(c=>c.parameterCode==='KR-066').executionStatus,'UNSUPPORTED');
  const filesResponse=await get(`objects/${state.objectId}/files`),files=JSON.parse(filesResponse.bytes).items;assert.equal(files.length,1);const file=files[0];
  assert.equal(file.id,sourceFileId);assert.equal(file.sha256,spec.sha256);assert.equal(file.size,spec.bytes);assert.equal(file.pageCount,spec.pages);assert.deepEqual(file.stages,['PD']);assert.equal(file.review,null);
  const metadata=execution.metadata.find(m=>m.sourceFileId===sourceFileId);assert.ok(metadata);assert.equal(metadata.stage,'PD');assert.equal(metadata.sectionCode,null);assert.equal(metadata.approvalStatus,'UNKNOWN');assert.equal(metadata.revisionStatus,'UNKNOWN');assert.equal(metadata.pageCount,139);
  const pdf=(await get(`objects/${state.objectId}/files/${sourceFileId}/content`)).bytes;assert.equal(pdf.length,spec.bytes);assert.equal(sha(pdf),spec.sha256);
  const local=path.join(temporary,'F0106.pdf');fs.writeFileSync(local,pdf,{mode:0o600});
  const info=execFileSync('pdfinfo',['-f','51','-l','51','-box',local],{encoding:'utf8',timeout:30000,env:{...process.env,LC_ALL:'C'}});
  assert.match(info,/^Pages:\s+139\s*$/m);assert.match(info,/^Page\s+51\s+rot:\s+0\s*$/m);
  const crop=/^Page\s+51\s+CropBox:\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*$/m.exec(info);assert.ok(crop);
  assert.ok(Math.abs(Number(crop[3])-Number(crop[1])-expected.page.widthMilliPoints/1000)<.02);assert.ok(Math.abs(Number(crop[4])-Number(crop[2])-expected.page.heightMilliPoints/1000)<.02);
  const reviewPath=`objects/${state.objectId}/files/${sourceFileId}/source-review`,review=await response(reviewPath);assert.equal(review.status,404);
  const targetsResponse=await get(`checks/${state.checkId}/matrix-fact-targets`),targets=JSON.parse(targetsResponse.bytes);assert.equal(targets.executionContentHash,machine.contentHash);assert.equal(targets.items.length,execution.observations.length);assert.ok(targets.items.every(t=>!ids.has(t.target.observationId)));
  const snapshots=new Map([[endpoint,machineBytes],[`objects/${state.objectId}/files`,filesResponse.bytes],[`checks/${state.checkId}/matrix-fact-targets`,targetsResponse.bytes]]);
  for(const suffix of ['submission','findings','pilot-results'])snapshots.set(`checks/${state.checkId}/${suffix}`,(await get(`checks/${state.checkId}/${suffix}`)).bytes);
  assert.equal(sha(snapshots.get(`checks/${state.checkId}/submission`)),machine.submission.contentHash);
  for(const suffix of ['submission','findings','pilot-results'])for(const id of ids)assert.ok(!snapshots.get(`checks/${state.checkId}/${suffix}`).toString('utf8').includes(id));
  const unauthorized=await response(endpoint,false);assert.equal(unauthorized.status,401);
  for(const [url,bytes] of snapshots)assert.deepEqual((await get(url)).bytes,bytes);
  const reviewAfter=await response(reviewPath);assert.equal(reviewAfter.status,404);assert.equal(sha(reviewAfter.bytes),sha(review.bytes));
  const receipt={status:'PASS_API_ONLY_BROWSER_PENDING',objectId:state.objectId,internalObjectId:identity.internalObjectId,checkId:state.checkId,harnessSha256:sha(fs.readFileSync(__filename)),goldenSha256:sha(goldenBytes),fullPages:139,sourceDeclarations:6,
   primaryFragments:6,scopeFragments:7,headerFragments:12,unitFragments:6,expectedDeclarations:expected.declarations,original:{originalSourceFileId:'F0106',sourceFileId,sha256:spec.sha256,bytes:pdf.length,pages:139,pageNumber:51,manifestSection:'KR',sectionOverride:false,rotation:0},
   coverage:counts,fireParameterStatus:'UNSUPPORTED',qualifiedComparisons:0,sourceApproval:'UNKNOWN',calibratedProbability:null,domainWrites:0,browserCalls:0,browserExecuted:false,declarationTargets:0,declarationFindings:0,sourceReviews:0,immutableAfterReadback:true,unauthenticatedStatus:401,
   rawReadbackSha256:Object.fromEntries([...snapshots].map(([url,bytes])=>[url,sha(bytes)]))};
  fs.writeFileSync(path.join(out,`${state.checkId}-fire-api.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:receipt.status,checkId:state.checkId,sourceDeclarations:6,fullPages:139,qualified:0,domainWrites:0}));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
