/** T34 real original material declarations. HTTP GET only; no browser acceptance. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const [statePath]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082',origin=new URL(base).origin;
if(!statePath||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state and loopback stand required');
assert.equal(fs.statSync(statePath).mode&0o777,0o600);
const state=JSON.parse(fs.readFileSync(statePath)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const key of ['objectId','checkId'])assert.match(state[key],/^[A-Za-z0-9_-]+$/u);
assert.ok(state.cookies&&typeof state.cookies==='object'&&!Array.isArray(state.cookies));
const output=path.resolve(process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t34-20261018/public-api-real');
const research=path.join(__dirname,'../output/matrix-t34-20261018');
const identity=JSON.parse(fs.readFileSync(path.join(research,'real-object-identity.json')));
assert.equal(identity.status,'PASS_READ_ONLY_IDENTITY');assert.equal(identity.objectId,state.objectId);assert.equal(identity.checkId,state.checkId);
assert.equal(identity.runObjectId,identity.internalObjectId);assert.match(identity.internalObjectId,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
const goldenBytes=fs.readFileSync(path.join(research,'research-parser-golden.json'));
assert.equal(sha(goldenBytes),'60f159ae69d2cde527d84260cb4f8b225565744ede2a684617f0218b4ba43d78');
const golden=JSON.parse(goldenBytes),specs=[
 {sid:'F0105',stage:'PD',section:'KR',pages:29,page:14,bytes:3831452,sha256:'8156fe22033fa94ba65ccc063e934b90168de8d0614a4bbecfde5def1e8b4a89',artifactSha:'0871c85b52dde6debf214f70067432ea37cb9608c5ca2dafbaf6f2868b795d15',primary:1,scope:3},
 {sid:'F0145',stage:'RD',section:'OTHER',pages:14,page:4,bytes:2902999,sha256:'0be3a646cc793b86257e3ce4aeb9d0f15326369aa8a37a9205670e82635eaa05',artifactSha:'bf8028af09e6f5eb9a4347166d106b5d95488f5314083504932a5afed4d0a023',primary:2,scope:3}];
// Independent portable serializer: no production parser/hash implementation imported.
function canonical(value,depth=0){
 assert.ok(depth<=64);
 if(value===null||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='string'){for(const c of value){const n=c.codePointAt(0);assert.ok(n<0xd800||n>0xdfff);}return JSON.stringify(value);}
 if(typeof value==='number'){assert.ok(Number.isSafeInteger(value));return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 assert.ok(value&&typeof value==='object');const keys=Object.keys(value).sort();for(const k of keys)assert.match(k,/^[\x00-\x7f]*$/u);
 return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
function expectedDeclaration(spec,sourceFileId){
 const artifactBytes=fs.readFileSync(path.join(research,`research-${spec.sid}-full.text.json`));assert.equal(sha(artifactBytes),spec.artifactSha);
 const artifact=JSON.parse(artifactBytes);assert.equal(artifact.sourceFileId,spec.sid);assert.equal(artifact.inputSha256,spec.sha256);
 assert.equal(artifact.pageCount,spec.pages);assert.deepEqual(artifact.pages.map(p=>p.pageNumber),Array.from({length:spec.pages},(_,i)=>i+1));
 artifact.sourceFileId=sourceFileId; // Sole allowed remap; all original pages and raw data survive.
 const page=artifact.pages[spec.page-1],vector=golden.cases.find(c=>c.name===`original-${spec.sid}`);
 assert.equal(vector.stage,spec.stage);assert.equal(vector.expected.length,1);
 const candidate=JSON.parse(JSON.stringify(vector.expected[0]));assert.equal(candidate.value,'С245');
 assert.equal(candidate.primaryFragments.length,spec.primary);assert.equal(candidate.scopeFragments.length,spec.scope);
 for(const fragment of [...candidate.primaryFragments,...candidate.scopeFragments]){
  const originalPage=artifact.pages[fragment.pageNumber-1],block=originalPage.blocks[fragment.blockIndex];
  assert.equal(block.text.split('\n')[fragment.lineIndex],fragment.rawText);assert.deepEqual(block.lineBboxesMilliPoints[fragment.lineIndex],fragment.bboxMilliPoints);
 }
 const body={schemaVersion:'matrix-source-declaration-v1',kind:'SOURCE_AUTHORED_STEEL_DECLARATION',extractorVersion:'matrix-steel-prose-v1',sourceFileId,sourceSha256:spec.sha256,
  textArtifactHash:sha(canonical({hashDomain:'matrix-source-declaration-text-artifact-v1',textArtifact:artifact})),stage:spec.stage,pageNumber:spec.page,widthMilliPoints:page.widthMilliPoints,heightMilliPoints:page.heightMilliPoints,
  entityKey:null,applicabilityStatus:'UNREVIEWED',...candidate};
 return {spec,artifact,page,declaration:{id:sha(canonical({hashDomain:'matrix-source-declaration-id-v1',declaration:body})),...body}};
}
async function response(endpoint,authenticated=true){
 const headers=authenticated?{Cookie:Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; ')}:{};
 const r=await fetch(`${origin}/api/${endpoint}`,{headers,signal:AbortSignal.timeout(30000)}),bytes=Buffer.from(await r.arrayBuffer());
 return {status:r.status,bytes,headers:Object.fromEntries(r.headers)};
}
async function get(endpoint){const r=await response(endpoint);assert.equal(r.status,200,`GET ${endpoint}: HTTP${r.status}`);return r;}
(async()=>{
 fs.mkdirSync(output,{recursive:true});const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-t34-api-'));
 try{
  const run=JSON.parse((await get(`checks/${state.checkId}`)).bytes);assert.equal(run.objectId,state.objectId);assert.equal(run.progress,100);assert.equal(run.mode,'NORMAL');assert.ok(['PARTIAL','COMPLETED'].includes(run.status));
  const endpoint=`checks/${state.checkId}/matrix-execution`,machineResponse=await get(endpoint),machineBytes=machineResponse.bytes,machine=JSON.parse(machineBytes),execution=machine.execution;
  assert.equal(machine.checkId,state.checkId);assert.equal(execution.objectId,identity.internalObjectId);
  const evidence=machine.sourceDeclarations;assert.ok(evidence);assert.equal(evidence.schemaVersion,'matrix-source-declarations-v1');assert.equal(evidence.extractorVersion,'matrix-source-declarations-v1');assert.equal(evidence.purpose,'EVIDENCE_ONLY');
  assert.equal(evidence.objectId,identity.internalObjectId);assert.equal(evidence.inputManifestHash,execution.inputManifestHash);assert.equal(evidence.declarations.length,2);
  const expected=specs.map(spec=>{const declaration=evidence.declarations.find(d=>d.stage===spec.stage);assert.ok(declaration);const value=expectedDeclaration(spec,declaration.sourceFileId);assert.deepEqual(declaration,value.declaration);return value;});
  assert.notDeepEqual(expected[0].declaration.productScope,expected[1].declaration.productScope);
  assert.equal(expected[0].declaration.productScope.profile,'70Б3');assert.equal(expected[0].declaration.productScope.tier,2);assert.equal(expected[1].declaration.productScope.profile,null);
  assert.ok(!Object.hasOwn(execution,'sourceDeclarations'));assert.ok(!Object.hasOwn(execution,'declarations'));
  const ids=new Set(evidence.declarations.map(d=>d.id));
  assert.ok(execution.observations.every(o=>!ids.has(o.id)&&o.unit!=='steel_catalog_example'&&!Object.hasOwn(o,'productScope')));
  assert.ok(execution.results.every(r=>!r.qualified&&r.parameterCode!=='KR-056'));
  assert.ok(machine.presentation.every(p=>p.confidence.calibratedProbability===null));
  const coverage=execution.coverage;assert.equal(coverage.length,132);
  const counts={parametersWithAtoms:coverage.filter(c=>c.implementedAtomicRules>0).length,atoms:coverage.reduce((n,c)=>n+c.implementedAtomicRules,0),unsupported:coverage.filter(c=>c.executionStatus==='UNSUPPORTED').length};
  assert.deepEqual(counts,{parametersWithAtoms:55,atoms:63,unsupported:77});assert.equal(coverage.find(c=>c.parameterCode==='KR-056').executionStatus,'UNSUPPORTED');
  const filesResponse=await get(`objects/${state.objectId}/files`),files=JSON.parse(filesResponse.bytes).items;assert.equal(files.length,2);
  const originals=[],reviews=[];
  for(const item of expected){const {spec,declaration,page}=item,file=files.find(f=>f.id===declaration.sourceFileId);assert.ok(file);
   assert.equal(file.sha256,spec.sha256);assert.equal(file.size,spec.bytes);assert.equal(file.pageCount,spec.pages);assert.deepEqual(file.stages,[spec.stage]);assert.equal(file.review,null);
   const metadata=execution.metadata.find(m=>m.sourceFileId===file.id);assert.ok(metadata);assert.equal(metadata.stage,spec.stage);assert.equal(metadata.sectionCode,null);assert.equal(metadata.approvalStatus,'UNKNOWN');assert.equal(metadata.revisionStatus,'UNKNOWN');assert.equal(metadata.pageCount,spec.pages);
   const pdf=(await get(`objects/${state.objectId}/files/${file.id}/content`)).bytes;assert.equal(pdf.length,spec.bytes);assert.equal(sha(pdf),spec.sha256);
   const local=path.join(temporary,spec.sid+'.pdf');fs.writeFileSync(local,pdf,{mode:0o600});
   const info=execFileSync('pdfinfo',['-f',String(spec.page),'-l',String(spec.page),'-box',local],{encoding:'utf8',timeout:30000,env:{...process.env,LC_ALL:'C'}});
   assert.match(info,new RegExp(`^Pages:\\s+${spec.pages}\\s*$`,'m'));assert.match(info,new RegExp(`^Page\\s+${spec.page}\\s+rot:\\s+0\\s*$`,'m'));
   const crop=new RegExp(`^Page\\s+${spec.page}\\s+CropBox:\\s*([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s*$`,'m').exec(info);assert.ok(crop);
   assert.ok(Math.abs(Number(crop[3])-Number(crop[1])-page.widthMilliPoints/1000)<.02);assert.ok(Math.abs(Number(crop[4])-Number(crop[2])-page.heightMilliPoints/1000)<.02);
   originals.push({originalSourceFileId:spec.sid,sourceFileId:file.id,sha256:spec.sha256,bytes:pdf.length,pages:spec.pages,pageNumber:spec.page,manifestSection:spec.section,sectionOverride:false,rotation:0});
   const reviewPath=`objects/${state.objectId}/files/${file.id}/source-review`,review=await response(reviewPath);assert.equal(review.status,404);reviews.push({endpoint:reviewPath,status:404,sha256:sha(review.bytes)});
  }
  const targetsResponse=await get(`checks/${state.checkId}/matrix-fact-targets`),targets=JSON.parse(targetsResponse.bytes);
  assert.equal(targets.executionContentHash,machine.contentHash);assert.equal(targets.items.length,execution.observations.length);
  assert.ok(targets.items.every(t=>!ids.has(t.target.observationId)));
  const snapshots=new Map([[endpoint,machineBytes],[`objects/${state.objectId}/files`,filesResponse.bytes],[`checks/${state.checkId}/matrix-fact-targets`,targetsResponse.bytes]]);
  for(const suffix of ['submission','findings','pilot-results']) snapshots.set(`checks/${state.checkId}/${suffix}`,(await get(`checks/${state.checkId}/${suffix}`)).bytes);
  const submission=snapshots.get(`checks/${state.checkId}/submission`);assert.equal(sha(submission),machine.submission.contentHash);
  for(const bytes of [submission,snapshots.get(`checks/${state.checkId}/findings`),snapshots.get(`checks/${state.checkId}/pilot-results`)])for(const id of ids)assert.ok(!bytes.toString('utf8').includes(id));
  const unauthorized=await response(endpoint,false);assert.equal(unauthorized.status,401);
  const firstState=JSON.parse(fs.readFileSync(statePath));assert.ok(firstState.cookies); // Input private state never rewritten by GETs.
  for(const [url,bytes] of snapshots)assert.deepEqual((await get(url)).bytes,bytes);
  for(const review of reviews){const after=await response(review.endpoint);assert.equal(after.status,404);assert.equal(sha(after.bytes),review.sha256);}
  const receipt={status:'PASS_API_ONLY_BROWSER_PENDING',objectId:state.objectId,internalObjectId:identity.internalObjectId,checkId:state.checkId,harnessSha256:sha(fs.readFileSync(__filename)),goldenSha256:sha(goldenBytes),fullPages:43,sourceDeclarations:2,primaryFragments:3,scopeFragments:6,
   expectedDeclarations:expected.map(e=>e.declaration),originals,coverage:counts,steelParameterStatus:'UNSUPPORTED',qualifiedComparisons:0,sourceApproval:'UNKNOWN',calibratedProbability:null,domainWrites:0,browserCalls:0,browserExecuted:false,
   declarationTargets:0,declarationFindings:0,sourceReviews:reviews,immutableAfterReadback:true,unauthenticatedStatus:401,rawReadbackSha256:Object.fromEntries([...snapshots].map(([url,bytes])=>[url,sha(bytes)]))};
  fs.writeFileSync(path.join(output,`${state.checkId}-steel-api.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:receipt.status,checkId:state.checkId,sourceDeclarations:2,fullPages:43,qualified:0,domainWrites:0}));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
