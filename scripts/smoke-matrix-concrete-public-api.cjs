/** T32 API-only real public staircase concrete acceptance; browser remains pending. Run after coherent deploy + seed terminal.
 * node scripts/smoke-matrix-concrete-public-api.cjs private-state.json
 * HTTP GET only. Existing run reprocessing is performed separately after deployment.
 * Golden geometry/raw text and full artifacts are independently remapped by SID only.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const [statePath]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082',origin=new URL(base).origin;
if(!statePath||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state and loopback stand required');
assert.equal(fs.statSync(statePath).mode&0o777,0o600);
const state=JSON.parse(fs.readFileSync(statePath));
for(const key of ['objectId','checkId'])assert.match(state[key],/^[A-Za-z0-9_-]+$/u);
assert.ok(state.cookies&&typeof state.cookies==='object'&&!Array.isArray(state.cookies));
const out=process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t32-20261018/public-api-real';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),clone=x=>JSON.parse(JSON.stringify(x));
const fixtureBytes=fs.readFileSync(path.join(__dirname,'../services/worker/tests/fixtures/rebar-F0106-F0139.json'));
const goldenBytes=fs.readFileSync(path.join(__dirname,'../output/matrix-t32-20261018/research-production-parser-golden.json'));
assert.equal(sha(fixtureBytes),'ee4c645f50f87d44e056b62f215170067e8cd75555837473e2599072c9fa6b54');
assert.equal(sha(goldenBytes),'85a9a09f26ccc40ca05586ad3769231b4ffa43e59fbc11bc0be3baa7c837b086');
const fixture=JSON.parse(fixtureBytes),golden=JSON.parse(goldenBytes);
const ATTRIBUTE='CONCRETE_CLASS',RULE='matrix-kr-055-concrete_class';
const specs=[{originalSid:'F0106',stage:'PD',pageNumber:50,pageCount:139,bytes:23871472,sha256:'ae8b16439650526a5ef6e1975c852fa38c2ab4466cd73ab725a47bcb32a6b655',frame:[595200,841920],primary:['3:0'],context:['49:10:0','49:10:1','50:0:0']},
 {originalSid:'F0139',stage:'RD',pageNumber:4,pageCount:22,bytes:2298875,sha256:'d59c225e75d1e0227f08869b31165bd93bf85ed4b1da005c3e86ebc27023b73f',frame:[1684000,1191000],primary:['44:0'],context:['4:1:3']}];
// Existing matrix observation hashing: sorted ASCII keys, ordinary JSON finite numbers.
function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){assert.ok(Number.isFinite(value));return JSON.stringify(value);}
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 assert.ok(value&&typeof value==='object');const keys=Object.keys(value).sort();for(const k of keys)assert.match(k,/^[\x20-\x7e]+$/u);
 return `{${keys.map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`;
}
// Portable selector hashing is separate from legacy observation-ID hashing.
function portableTree(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return value;
 if(typeof value==='number'){assert.ok(Number.isFinite(value));const b=Buffer.alloc(8);b.writeDoubleBE(value);return ['$number',b.toString('hex')];}
 if(Array.isArray(value))return ['$array',value.map(portableTree)];
 return ['$object',Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>[k,portableTree(value[k])])];
}
const portableHash=value=>sha(JSON.stringify(portableTree(value)));
const normalized=(box,page)=>({x:box[0]/page.widthMilliPoints,y:1-box[3]/page.heightMilliPoints,width:(box[2]-box[0])/page.widthMilliPoints,height:(box[3]-box[1])/page.heightMilliPoints});
function nearBox(actual,expected,label){for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<1e-6,`${label} ${key}`);}
function expectedSource(spec,sourceFileId){
 const item=fixture.sources.find(s=>s.source.file_id===spec.originalSid),g=golden.cases.find(c=>c.name===`original-${spec.stage}`&&c.originalSourceFileId===spec.originalSid&&c.synthetic===false);
 assert.ok(item&&g);assert.equal(item.source.sha256,spec.sha256);assert.equal(item.source.stage,spec.stage);
 assert.deepEqual(item.provenance.manifestGate,{split:'TRAIN_PUBLIC',distributionStatus:'INCLUDE',labelVisibility:'PUBLIC_TRAIN'});
 const artifact=clone(item.sourceArtifact);assert.equal(artifact.sourceFileId,spec.originalSid);assert.equal(artifact.inputSha256,spec.sha256);
 assert.equal(artifact.pageCount,spec.pageCount);assert.deepEqual(artifact.pages.map(p=>p.pageNumber),Array.from({length:spec.pageCount},(_,i)=>i+1));
 artifact.sourceFileId=sourceFileId; // Sole allowed full-artifact remap.
 const page=artifact.pages[spec.pageNumber-1];assert.deepEqual([page.widthMilliPoints,page.heightMilliPoints],spec.frame);
 const candidate=g.expectedCandidates[0];assert.equal(g.expectedCandidates.length,1);assert.equal(candidate.value,'В30');
 const toFragment=part=>{
  const sourcePage=artifact.pages[part.pageNumber-1],block=sourcePage.blocks[part.blockIndex],raw=block.text.split('\n')[part.lineIndex],box=block.lineBboxesMilliPoints[part.lineIndex];
  assert.equal(part.rawText,raw);assert.deepEqual(part.bboxMilliPoints,box);
  return {blockId:`${part.blockIndex}:${part.lineIndex}`,rawText:raw,bbox:normalized(box,sourcePage)};
 };
 const primary=candidate.primaryFragments.map(toFragment),context=candidate.contextFragments.map(part=>({pageNumber:part.pageNumber,...toFragment(part),role:part.role}));
 assert.deepEqual(primary.map(p=>p.blockId),spec.primary);assert.deepEqual(context.map(p=>`${p.pageNumber}:${p.blockId}`),spec.context);
 const boxes=candidate.primaryFragments.map(p=>p.bboxMilliPoints),union=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
 const identity={sourceFileId,sourceSha256:spec.sha256,stage:spec.stage,pageNumber:spec.pageNumber,blockIds:spec.primary,attribute:ATTRIBUTE,value:candidate.value,unit:'B_CLASS',...(context.length?{contextFragments:context}:{})};
 const fact={id:sha(canonical(identity)),sourceFileId,sourceSha256:spec.sha256,stage:spec.stage,pageNumber:spec.pageNumber,blockId:spec.primary[0],bbox:normalized(union,page),rawText:primary.map(p=>p.rawText).join(' '),rawValue:candidate.rawValue,rawUnit:candidate.rawUnit,attribute:ATTRIBUTE,value:'В30',unit:'B_CLASS',entityKey:null,method:'TEXT_LAYER',extractorVersion:'matrix-text-facts-v1',parameterCodes:['KR-055'],sourceFlags:['SOURCE_APPROVAL_UNKNOWN','SOURCE_REVISION_UNKNOWN'],evidenceFragments:primary,...(context.length?{contextFragments:context}:{})};
 const fields=['sourceFileId','sourceSha256','stage','pageNumber','blockId','attribute','value','unit','rawValue','rawUnit','rawText','method','extractorVersion','bbox','evidenceFragments'];
 const selector={schemaVersion:'matrix-fact-selector-v1',...Object.fromEntries(fields.map(k=>[k,fact[k]])),...(context.length?{contextFragments:context}:{}),textArtifactHash:portableHash(artifact)};
 const target={observationId:fact.id,evidenceHash:portableHash(selector),textArtifactHash:selector.textArtifactHash,...(context.length?{fragmentsHash:portableHash(context)}:{})};
 return {spec,artifact,fact,selector,target,page};
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-t32-api-'));
 async function requestGet(url){
  const response=await fetch(url,{headers:{Cookie:Object.entries(state.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await response.arrayBuffer());return {status:()=>response.status,body:async()=>bytes,json:async()=>JSON.parse(bytes),headers:()=>Object.fromEntries(response.headers)};
 }
 async function get(endpoint){const r=await requestGet(`${origin}/api/${endpoint}`);assert.equal(r.status(),200,`GET ${endpoint}: ${r.status()}`);return r;}
 try{
  const run=await(await get(`checks/${state.checkId}`)).json();assert.equal(run.objectId,state.objectId);assert.equal(run.progress,100);assert.equal(run.mode,'NORMAL');assert.ok(['PARTIAL','COMPLETED'].includes(run.status));
  const machineBytes=await(await get(`checks/${state.checkId}/matrix-execution`)).body(),machine=JSON.parse(machineBytes),execution=machine.execution;
  assert.equal(machine.checkId,state.checkId);assert.equal(execution.registryHash,sha(canonical(JSON.parse(fs.readFileSync(path.join(__dirname,'../services/worker/rules/matrix-execution-v1.json'))))));
  assert.ok(execution.results.every(r=>!r.qualified));assert.ok(machine.presentation.every(p=>p.confidence.calibratedProbability===null));
  const facts=execution.observations.filter(o=>o.attribute===ATTRIBUTE&&o.contextFragments?.some(p=>p.role==='MATERIAL_SCOPE'));assert.equal(facts.length,2);
  assert.equal(execution.observations.length,15);
  const baselineBytes=fs.readFileSync(path.join(__dirname,'../output/matrix-t32-20261018/t31-original-baseline.json'));assert.equal(sha(baselineBytes),'d4ebd95b225eae217ce6af8184cd0475b542eaa8c1f702cc23a666721338781c');
  const baseline=JSON.parse(baselineBytes);assert.equal(baseline.checkId,state.previousCheckId);assert.equal(state.previousCheckId,'CHK-BE327395');
  assert.deepEqual(await(await get(`checks/${state.previousCheckId}/matrix-execution`)).body(),baselineBytes);
  const oldFacts=execution.observations.filter(o=>!facts.some(f=>f.id===o.id));assert.deepEqual(oldFacts,baseline.execution.observations);
  const expected=specs.map(spec=>{const fact=facts.find(f=>f.stage===spec.stage);assert.ok(fact);const e=expectedSource(spec,fact.sourceFileId);assert.deepEqual(fact,e.fact);return e;});
  for(const e of expected){const metadata=execution.metadata.filter(m=>m.sourceFileId===e.fact.sourceFileId);assert.equal(metadata.length,1);assert.equal(metadata[0].sectionCode,null);assert.equal(metadata[0].revisionStatus,'UNKNOWN');assert.equal(metadata[0].approvalStatus,'UNKNOWN');assert.equal(metadata[0].pageCount,e.spec.pageCount);}
  assert.equal(execution.coverage.length,132);const counts={parameters:execution.coverage.filter(c=>c.implementedAtomicRules>0).length,atoms:execution.coverage.reduce((n,c)=>n+c.implementedAtomicRules,0),unsupported:execution.coverage.filter(c=>c.executionStatus==='UNSUPPORTED').length};assert.deepEqual(counts,{parameters:55,atoms:63,unsupported:77});
  const row=execution.results.find(r=>r.ruleId===RULE);assert.ok(row);assert.equal(row.qualified,false);assert.notEqual(row.machineStatus,'NEGATIVE_VERIFIED');
  const filesBytes=await(await get(`objects/${state.objectId}/files`)).body(),files=JSON.parse(filesBytes).items;assert.equal(files.length,2);
  const originals=[];
  for(const e of expected){
   const file=files.find(f=>f.id===e.fact.sourceFileId);assert.ok(file);assert.equal(file.sha256,e.spec.sha256);assert.equal(file.size,e.spec.bytes);assert.equal(file.pageCount,e.spec.pageCount);assert.deepEqual(file.stages,[e.spec.stage]);assert.equal(file.review,null);
   const pdf=await(await get(`objects/${state.objectId}/files/${file.id}/content`)).body();assert.equal(pdf.length,e.spec.bytes);assert.equal(sha(pdf),e.spec.sha256);
   const pdfPath=path.join(temporary,e.spec.originalSid+'.pdf');fs.writeFileSync(pdfPath,pdf,{mode:0o600});
   const info=execFileSync('pdfinfo',['-f',String(e.spec.pageNumber),'-l',String(e.spec.pageNumber),'-box',pdfPath],{encoding:'utf8',timeout:30000,env:{...process.env,LC_ALL:'C'}});
   assert.match(info,new RegExp(`^Pages:\\s+${e.spec.pageCount}\\s*$`,'m'));assert.match(info,new RegExp(`^Page\\s+${e.spec.pageNumber}\\s+rot:\\s+0\\s*$`,'m'));
   const crop=new RegExp(`^Page\\s+${e.spec.pageNumber}\\s+CropBox:\\s*([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s*$`,'m').exec(info);assert.ok(crop);
   e.geometry={width:Number(crop[3])-Number(crop[1]),height:Number(crop[4])-Number(crop[2])};assert.ok(Math.abs(e.geometry.width-e.spec.frame[0]/1000)<.02&&Math.abs(e.geometry.height-e.spec.frame[1]/1000)<.02);
   originals.push({sourceFileId:file.id,originalSourceFileId:e.spec.originalSid,sha256:e.spec.sha256,bytes:pdf.length,pages:e.spec.pageCount,pageNumber:e.spec.pageNumber,geometry:e.geometry,rotation:0});
  }
  const submissionResponse=await get(`checks/${state.checkId}/submission`),submissionBytes=await submissionResponse.body();assert.equal(sha(submissionBytes),machine.submission.contentHash);assert.equal(submissionResponse.headers()['x-content-sha256'],machine.submission.contentHash);
  const findingsBytes=await(await get(`checks/${state.checkId}/findings`)).body(),targetsBytes=await(await get(`checks/${state.checkId}/matrix-fact-targets`)).body(),targets=JSON.parse(targetsBytes);
  assert.equal(targets.checkId,state.checkId);assert.equal(targets.executionContentHash,machine.contentHash);
  for(const e of expected){const found=targets.items.filter(t=>t.sourceFileId===e.fact.sourceFileId&&t.target.observationId===e.fact.id);assert.equal(found.length,1);assert.deepEqual(found[0].target,{checkId:state.checkId,executionContentHash:machine.contentHash,...Object.fromEntries(Object.entries(e.target).filter(([k])=>k!=='fragmentsHash'))});if(e.target.fragmentsHash)assert.equal(found[0].fragmentsHash,e.target.fragmentsHash);}
  const pilotBytes=await(await get(`checks/${state.checkId}/pilot-results`)).body(),pilot=JSON.parse(pilotBytes);assert.equal(pilot.checkId,state.checkId);
  const decisionsApplicable=!!pilot.reviewCandidates?.candidateCount,decisionsBytes=decisionsApplicable?await(await get(`checks/${state.checkId}/review-candidate-decisions`)).body():null;
  const expectedAbsentPaths=new Set(expected.map(e=>`/api/objects/${state.objectId}/files/${e.fact.sourceFileId}/source-review`));
  async function sourceReviews(){const rows=[];for(const pathname of expectedAbsentPaths){const response=await requestGet(origin+pathname);assert.equal(response.status(),404,'Unknown real source must have no source review');rows.push({path:pathname,status:404,sha256:sha(await response.body())});}return rows;}
  const reviewsBefore=await sourceReviews();

  for(const [endpoint,bytes] of [[`checks/${state.checkId}/matrix-execution`,machineBytes],[`checks/${state.checkId}/submission`,submissionBytes],[`checks/${state.checkId}/findings`,findingsBytes],[`checks/${state.checkId}/matrix-fact-targets`,targetsBytes],[`checks/${state.checkId}/pilot-results`,pilotBytes],[`objects/${state.objectId}/files`,filesBytes]])assert.deepEqual(await(await get(endpoint)).body(),bytes);
  if(decisionsApplicable)assert.deepEqual(await(await get(`checks/${state.checkId}/review-candidate-decisions`)).body(),decisionsBytes);
  assert.deepEqual(await sourceReviews(),reviewsBefore);
  const result={status:'PASS_API_ONLY_BROWSER_PENDING',checkId:state.checkId,objectId:state.objectId,harnessSha256:sha(fs.readFileSync(__filename)),fixtureSha256:sha(fixtureBytes),goldenSha256:sha(goldenBytes),fullPages:161,concreteProseFacts:2,allFacts:execution.observations.length,expected:expected.map(e=>({fact:e.fact,selector:e.selector,target:e.target})),originals,coverage:counts,qualifiedComparisons:0,sourceReviews:reviewsBefore,sourceApproval:'UNKNOWN',calibratedProbability:null,browserExecuted:false,domainWrites:0,oldObservationsPreserved:13,previousCheckId:state.previousCheckId,previousMatrixUnchanged:true,immutableAfterReadback:true,rawReadbackSha256:{matrix:sha(machineBytes),submission:sha(submissionBytes),findings:sha(findingsBytes),targets:sha(targetsBytes),pilot:sha(pilotBytes),files:sha(filesBytes),decisions:decisionsBytes?sha(decisionsBytes):null}};
  fs.writeFileSync(path.join(out,`${state.checkId}-concrete-api.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,checkId:state.checkId,concreteProseFacts:2,allFacts:execution.observations.length,fullPages:161,qualified:0,domainWrites:0}));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
