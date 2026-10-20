/** T30 read-only real public project-zero acceptance. Run after coherent deploy + seed terminal.
 * node scripts/smoke-matrix-project-zero-public.cjs private-state.json
 * Exactly one auth initialization per fresh width; every domain mutation blocked.
 * Golden geometry/raw text and full artifacts are independently remapped by SID only.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [statePath]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082',origin=new URL(base).origin;
if(!statePath||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state and loopback stand required');
assert.equal(fs.statSync(statePath).mode&0o777,0o600);
const state=JSON.parse(fs.readFileSync(statePath));
for(const key of ['objectId','checkId'])assert.match(state[key],/^[A-Za-z0-9_-]+$/u);
assert.ok(state.cookies&&typeof state.cookies==='object'&&!Array.isArray(state.cookies));
const out=process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t30-20261018/public-browser-real';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),clone=x=>JSON.parse(JSON.stringify(x));
const fixtureBytes=fs.readFileSync(path.join(__dirname,'../services/worker/tests/fixtures/project-zero-F0101-F0139.json'));
const goldenBytes=fs.readFileSync(path.join(__dirname,'../output/matrix-t30-20261018/python-golden.json'));
assert.equal(sha(fixtureBytes),'85fa82b17a4a69618e9c3a18d10f8d574fe4ae050fe673e6de0de6ddd30dcec5');
assert.equal(sha(goldenBytes),'483dcebc5482c85a012281ecc71448d4b0ed538439f33ac9b183681121fdaf51');
const fixture=JSON.parse(fixtureBytes),golden=JSON.parse(goldenBytes);
const ATTRIBUTE='PROJECT_ZERO_ABSOLUTE_ELEVATION',RULE='matrix-pz-009-declared_project_zero_absolute_elevation';
const specs=[{originalSid:'F0101',stage:'PD',pageNumber:13,pageCount:13,bytes:891618,sha256:'01db90e015c39a9502b99969ce04f27825265203bc8728da6141d7b6d2b1ef54',frame:[595220,842000],primary:['0:8','0:9'],context:[]},
 {originalSid:'F0139',stage:'RD',pageNumber:4,pageCount:22,bytes:2298875,sha256:'d59c225e75d1e0227f08869b31165bd93bf85ed4b1da005c3e86ebc27023b73f',frame:[1684000,1191000],primary:['40:0'],context:['32:18','32:19']}];
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
 const item=fixture.sources.find(s=>s.source.file_id===spec.originalSid),g=golden.cases.find(c=>c.sourceFileId===spec.originalSid);
 assert.ok(item&&g);assert.equal(item.source.sha256,spec.sha256);assert.equal(item.source.stage,spec.stage);
 assert.deepEqual(item.provenance.manifestGate,{split:'TRAIN_PUBLIC',distributionStatus:'INCLUDE',labelVisibility:'PUBLIC_TRAIN'});
 const artifact=clone(item.sourceArtifact);assert.equal(artifact.sourceFileId,spec.originalSid);assert.equal(artifact.inputSha256,spec.sha256);
 assert.equal(artifact.pageCount,spec.pageCount);assert.deepEqual(artifact.pages.map(p=>p.pageNumber),Array.from({length:spec.pageCount},(_,i)=>i+1));
 artifact.sourceFileId=sourceFileId; // Sole allowed full-artifact remap.
 const page=artifact.pages[spec.pageNumber-1];assert.deepEqual([page.widthMilliPoints,page.heightMilliPoints],spec.frame);
 const candidate=g.candidates[0];assert.equal(g.candidates.length,1);assert.equal(candidate.value,'159.95');
 const toFragment=part=>{
  const block=page.blocks[part.blockIndex],raw=block.text.split('\n')[part.lineIndex],box=block.lineBboxesMilliPoints[part.lineIndex];
  assert.equal(part.rawText,raw);assert.deepEqual(part.bboxMilliPoints,box);
  return {blockId:`${part.blockIndex}:${part.lineIndex}`,rawText:raw,bbox:normalized(box,page)};
 };
 const primary=candidate.primaryFragments.map(toFragment),context=candidate.unitAuthorityFragments.map(part=>({pageNumber:spec.pageNumber,...toFragment(part),role:'UNIT_DECLARATION'}));
 assert.deepEqual(primary.map(p=>p.blockId),spec.primary);assert.deepEqual(context.map(p=>p.blockId),spec.context);
 const boxes=candidate.primaryFragments.map(p=>p.bboxMilliPoints),union=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
 const identity={sourceFileId,sourceSha256:spec.sha256,stage:spec.stage,pageNumber:spec.pageNumber,blockIds:spec.primary,attribute:ATTRIBUTE,value:candidate.value,unit:'m',...(context.length?{contextFragments:context}:{})};
 const fact={id:sha(canonical(identity)),sourceFileId,sourceSha256:spec.sha256,stage:spec.stage,pageNumber:spec.pageNumber,blockId:spec.primary[0],bbox:normalized(union,page),rawText:primary.map(p=>p.rawText).join(' '),rawValue:candidate.rawValue,rawUnit:candidate.rawUnit,attribute:ATTRIBUTE,value:'159.95',unit:'m',entityKey:null,method:'TEXT_LAYER',extractorVersion:'matrix-text-facts-v1',parameterCodes:['PZ-009'],sourceFlags:['SOURCE_APPROVAL_UNKNOWN','SOURCE_REVISION_UNKNOWN'],evidenceFragments:primary,...(context.length?{contextFragments:context}:{})};
 const fields=['sourceFileId','sourceSha256','stage','pageNumber','blockId','attribute','value','unit','rawValue','rawUnit','rawText','method','extractorVersion','bbox','evidenceFragments'];
 const selector={schemaVersion:'matrix-fact-selector-v1',...Object.fromEntries(fields.map(k=>[k,fact[k]])),...(context.length?{contextFragments:context}:{}),textArtifactHash:portableHash(artifact)};
 const target={observationId:fact.id,evidenceHash:portableHash(selector),textArtifactHash:selector.textArtifactHash,...(context.length?{fragmentsHash:portableHash(context)}:{})};
 return {spec,artifact,fact,selector,target,page};
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});if(fs.readdirSync(out).some(n=>n.startsWith(state.checkId+'-')))throw Error('Fresh output directory required');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-t30-browser-'));
 const pageErrors=[],consoleErrors=[],failedRequests=[],httpErrors=[],mutations=[],expected404=[],expected404Console=[],authInitializations=[],frames=[],screenshots=[],responsive=[],searchChecks=[];
 let browser,page,currentWidth=null;
 try{
  browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});context.setDefaultTimeout(30000);
  await context.addCookies(Object.entries(state.cookies).map(([name,value])=>({name,value,domain:new URL(base).hostname,path:'/'})));
  async function get(endpoint){const r=await context.request.get(`${origin}/api/${endpoint}`,{timeout:30000});assert.equal(r.status(),200,`GET ${endpoint}: ${r.status()}`);return r;}
  const run=await(await get(`checks/${state.checkId}`)).json();assert.equal(run.objectId,state.objectId);assert.equal(run.progress,100);assert.equal(run.mode,'NORMAL');assert.ok(['PARTIAL','COMPLETED'].includes(run.status));
  const machineBytes=await(await get(`checks/${state.checkId}/matrix-execution`)).body(),machine=JSON.parse(machineBytes),execution=machine.execution;
  assert.equal(machine.checkId,state.checkId);assert.equal(execution.registryHash,'f5228a4a8e0e5d0e9114d06e9b0eb03cee658e1f427ba909bd766e7d41b5690c');
  assert.ok(execution.results.every(r=>!r.qualified));assert.ok(machine.presentation.every(p=>p.confidence.calibratedProbability===null));
  const facts=execution.observations.filter(o=>o.attribute===ATTRIBUTE);assert.equal(facts.length,2);
  const expected=specs.map(spec=>{const fact=facts.find(f=>f.stage===spec.stage);assert.ok(fact);const e=expectedSource(spec,fact.sourceFileId);assert.deepEqual(fact,e.fact);return e;});
  for(const e of expected){const metadata=execution.metadata.filter(m=>m.sourceFileId===e.fact.sourceFileId);assert.equal(metadata.length,1);assert.equal(metadata[0].sectionCode,null);assert.equal(metadata[0].revisionStatus,'UNKNOWN');assert.equal(metadata[0].approvalStatus,'UNKNOWN');assert.equal(metadata[0].pageCount,e.spec.pageCount);}
  assert.equal(execution.coverage.length,132);const counts={parameters:execution.coverage.filter(c=>c.implementedAtomicRules>0).length,atoms:execution.coverage.reduce((n,c)=>n+c.implementedAtomicRules,0),unsupported:execution.coverage.filter(c=>c.executionStatus==='UNSUPPORTED').length};assert.deepEqual(counts,{parameters:54,atoms:62,unsupported:78});
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
  async function sourceReviews(){const rows=[];for(const pathname of expectedAbsentPaths){const response=await context.request.get(origin+pathname,{timeout:30000});assert.equal(response.status(),404,'Unknown real source must have no source review');rows.push({path:pathname,status:404,sha256:sha(await response.body())});}return rows;}
  const reviewsBefore=await sourceReviews();
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){mutations.push({method:request.method(),path:url.pathname,reason:'NON_STAND'});return route.abort('blockedbyclient');}
   if(request.method()==='POST'&&url.pathname==='/api/auth/open-workspace'&&currentWidth!==null&&!authInitializations.some(a=>a.width===currentWidth)){authInitializations.push({width:currentWidth,path:url.pathname});return route.continue();}
   if(!['GET','HEAD','OPTIONS'].includes(request.method())){mutations.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}return route.continue();
  });
  page=await context.newPage();page.on('pageerror',e=>pageErrors.push(String(e)));page.on('requestfailed',r=>failedRequests.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400){const pathname=new URL(r.url()).pathname,record={path:pathname,status:r.status()};if(r.status()===404&&r.request().method()==='GET'&&expectedAbsentPaths.has(pathname))expected404.push(record);else httpErrors.push(record);}});
  page.on('console',m=>{if(m.type()==='error'){const location=m.location(),pathname=location.url?new URL(location.url,origin).pathname:'';const record={text:m.text(),path:pathname};if(expectedAbsentPaths.has(pathname)&&/^Failed to load resource:.*404/u.test(m.text()))expected404Console.push(record);else consoleErrors.push(record);}});
  for(const width of [1440,768,375]){
   currentWidth=width;await page.setViewportSize({width,height:1050});const navigation=await page.goto(base,{waitUntil:'networkidle'});assert.equal(navigation.status(),200);
   await page.getByRole('button',{name:'Открыть кабинет',exact:true}).first().click();const card=page.locator('.object-card').filter({hasText:state.objectId});assert.equal(await card.count(),1);await card.getByRole('button',{name:'Открыть проверку'}).click();
   const panel=page.getByRole('region',{name:'Общий машинный анализ',exact:true});await panel.waitFor();assert.match(await panel.innerText(),/Без калибровки — кандидат, уверенность не измерена/);
   const search=panel.getByLabel('Поиск извлечённых значений'),factCards=()=>panel.locator('article').filter({has:page.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})});
   for(const query of ['159.95','входного вестибюля','отметки - в метрах.',ATTRIBUTE,'несуществующий_факт_T30']){
    await search.fill(query);const matches=query===ATTRIBUTE||query==='159.95'?2:query==='несуществующий_факт_T30'?0:1;assert.equal(await factCards().count(),matches);searchChecks.push({width,query,matches});
   }
   await search.fill(ATTRIBUTE);assert.equal(await factCards().count(),2);
   const viewer=panel.locator('.inspector-review-viewers .inspector-evidence-pane');
   for(const e of expected){
    const factCard=factCards().filter({hasText:e.fact.sourceFileId});assert.equal(await factCard.count(),1);assert.equal(await factCard.locator(':scope > p').first().textContent(),e.fact.rawText);
    assert.equal(await factCard.getByRole('button',{name:/^Открыть контекст/u}).count(),e.spec.context.length);
    if(e.spec.stage==='RD')assert.match(await factCard.innerText(),/Геодезическое основание проверяется отдельно/);
    const selections=[{kind:'primary',bbox:e.fact.bbox,text:`${e.fact.stage}: ${e.fact.value} m`,button:factCard.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})},...e.fact.contextFragments?.map(fragment=>({kind:fragment.blockId,bbox:fragment.bbox,text:`${e.fact.stage}: ${fragment.rawText}`,button:factCard.getByRole('button',{name:`Открыть контекст · PDF ${fragment.pageNumber} · строка ${fragment.blockId}`,exact:true})}))??[]];
    for(const selected of selections){
     await selected.button.click();await viewer.getByRole('img',{name:`${e.spec.stage}, исходная страница ${e.spec.pageNumber}`,exact:true}).waitFor();
     const review=panel.getByRole('region',{name:'Сохранение привязки машинного факта',exact:true});await review.getByRole('button',{name:'Сохранить привязки источника',exact:true}).waitFor();assert.equal(await review.getByRole('button',{name:'Сохранить привязки источника',exact:true}).isDisabled(),true);assert.match(await review.innerText(),/Редакция: UNKNOWN · согласование: UNKNOWN/);
     await page.waitForFunction(()=>{const el=document.querySelector('.matrix-execution > .inspector-review-viewers .inspector-evidence-pane');const image=el?.querySelector('img'),box=el?.querySelector('.inspector-evidence-box')?.getBoundingClientRect(),v=el?.querySelector('.inspector-sheet-viewport')?.getBoundingClientRect();return image?.complete&&image.naturalWidth>0&&box&&v&&(box.left+box.right)/2>=v.left&&(box.left+box.right)/2<=v.right&&(box.top+box.bottom)/2>=v.top&&(box.top+box.bottom)/2<=v.bottom;});
     const frame=await viewer.evaluate(el=>{const box=el.querySelector('.inspector-evidence-box'),img=el.querySelector('img'),b=box.getBoundingClientRect(),v=el.querySelector('.inspector-sheet-viewport').getBoundingClientRect();return{x:parseFloat(box.style.left)/100,y:parseFloat(box.style.top)/100,width:parseFloat(box.style.width)/100,height:parseFloat(box.style.height)/100,imageWidth:img.naturalWidth,imageHeight:img.naturalHeight,highlightText:box.textContent,pixelCenter:{x:(b.left+b.right)/2,y:(b.top+b.bottom)/2},viewport:{x:v.left,y:v.top,width:v.width,height:v.height}};});
     nearBox(frame,selected.bbox,selected.kind);assert.ok(Math.abs(frame.imageWidth/frame.imageHeight-e.geometry.width/e.geometry.height)<.003);assert.equal(frame.highlightText.trim(),selected.text.trim());assert.equal(await viewer.getByLabel('Страница PDF').inputValue(),String(e.spec.pageNumber));assert.equal(await viewer.getByLabel('Показать рамку').isChecked(),true);assert.equal(await viewer.getByRole('link',{name:'Открыть оригинальный PDF',exact:true}).getAttribute('href'),`/api/objects/${state.objectId}/files/${e.fact.sourceFileId}/content#page=${e.spec.pageNumber}`);
     const label=`${e.spec.stage}-${selected.kind.replace(':','-')}-${width}`,filename=`${state.checkId}-${label}.png`;await viewer.screenshot({path:path.join(out,filename)});screenshots.push(filename);frames.push({viewportWidth:width,stage:e.spec.stage,pageNumber:e.spec.pageNumber,selection:selected.kind,sourceFileId:e.fact.sourceFileId,...frame});
     await page.waitForLoadState('networkidle');
    }
   }
   const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=width+2);responsive.push(dimensions);const filename=`${state.checkId}-page-${width}.png`;await page.screenshot({path:path.join(out,filename),fullPage:true});screenshots.push(filename);
   assert.equal(authInitializations.filter(a=>a.width===width).length,1);assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(failedRequests,[]);assert.deepEqual(httpErrors,[]);assert.deepEqual(mutations,[]);
  }
  currentWidth=null;assert.equal(authInitializations.length,3);assert.equal(frames.length,12);assert.equal(screenshots.length,15);
  for(const [endpoint,bytes] of [[`checks/${state.checkId}/matrix-execution`,machineBytes],[`checks/${state.checkId}/submission`,submissionBytes],[`checks/${state.checkId}/findings`,findingsBytes],[`checks/${state.checkId}/matrix-fact-targets`,targetsBytes],[`checks/${state.checkId}/pilot-results`,pilotBytes],[`objects/${state.objectId}/files`,filesBytes]])assert.deepEqual(await(await get(endpoint)).body(),bytes);
  if(decisionsApplicable)assert.deepEqual(await(await get(`checks/${state.checkId}/review-candidate-decisions`)).body(),decisionsBytes);assert.deepEqual(await sourceReviews(),reviewsBefore);
  const evidence={status:'PASS',checkId:state.checkId,objectId:state.objectId,harnessSha256:sha(fs.readFileSync(__filename)),fixtureSha256:sha(fixtureBytes),goldenSha256:sha(goldenBytes),artifactRemap:'sourceFileId only; full13+22 pages unchanged',expected:expected.map(e=>({fact:e.fact,selector:e.selector,target:e.target})),originals,coverage:counts,qualifiedComparisons:0,sourceReviews:reviewsBefore,reviewCandidatesPresent:Object.hasOwn(pilot,'reviewCandidates'),decisionsNotApplicable:!decisionsApplicable,expected404,expected404Console,authInitializations,domainMutations:mutations,pageErrors,consoleErrors,failedRequests,httpErrors,frames,screenshots,responsive,searchChecks,immutableAfterBrowser:true,rawReadbackSha256:{matrix:sha(machineBytes),submission:sha(submissionBytes),findings:sha(findingsBytes),targets:sha(targetsBytes),pilot:sha(pilotBytes),files:sha(filesBytes),decisions:decisionsBytes?sha(decisionsBytes):null}};
  fs.writeFileSync(path.join(out,`${state.checkId}-project-zero-browser.json`),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'PASS',checkId:state.checkId,zeroFacts:2,value:'159.95',fullPages:35,frames:frames.length,screenshots:screenshots.length,authInitializations:3,domainMutations:0,qualified:0,immutableAfterBrowser:true}));
 }catch(error){
  if(page){await page.screenshot({path:path.join(out,`${state.checkId}-failure.png`),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,`${state.checkId}-failure.txt`),await page.locator('body').innerText().catch(()=>'Page unavailable'));}
  fs.writeFileSync(path.join(out,`${state.checkId}-failure.json`),JSON.stringify({status:'FAIL',error:String(error),frames,responsive,authInitializations,mutations,pageErrors,consoleErrors,failedRequests,httpErrors,expected404,expected404Console},null,2)+'\n');throw error;
 }finally{try{if(browser)await browser.close();}finally{fs.rmSync(temporary,{recursive:true,force:true});}}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
