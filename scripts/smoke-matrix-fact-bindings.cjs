/** Browser writes only explicitly named controlled T13 fixture sources. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [statePath,outputState]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082';
if(!statePath||!outputState||fs.existsSync(outputState)||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private state, new output and loopback stand required');
if((fs.statSync(statePath).mode&0o077)!==0)throw Error('Private state required');
const state=JSON.parse(fs.readFileSync(statePath)),out=process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t13-20261017';
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
try{const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies(Object.entries(state.cookies).map(([name,value])=>({name,value,domain:new URL(base).hostname,path:'/'})));
 const read=async endpoint=>{const response=await context.request.get(`${base}/api/${endpoint}`);assert.equal(response.status(),200);return response.json();};
 const files=(await read(`objects/${state.objectId}/files`)).items;
 assert.equal(files.length,2);assert.ok(files.every(file=>/^matrix-fact-binding-(PD|RD)\.pdf$/.test(file.name)),'Only controlled T13 originals');
 const before=await read(`checks/${state.checkId}/matrix-execution`),frozen=await context.request.get(`${base}/api/checks/${state.checkId}/submission`);assert.equal(frozen.status(),200);const oldBytes=await frozen.body();
 assert.equal(before.execution.observations.length,4);assert.equal(before.execution.results.filter(row=>row.qualified).length,0);
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));page.setDefaultTimeout(20000);
 await page.goto(base);await page.getByRole('button',{name:'Открыть кабинет',exact:true}).first().click();
 await page.locator('.object-card').filter({hasText:state.objectId}).getByRole('button',{name:'Открыть проверку'}).click();
 const panel=page.getByRole('region',{name:'Общий машинный анализ'});await panel.waitFor();
 const reviews=[];
 for(const [stage,value]of [['PD','100'],['RD','103']]){
  const fact=before.execution.observations.find(f=>f.stage===stage&&f.value===value);assert.ok(fact);
  await panel.getByLabel('Поиск извлечённых значений').fill(fact.rawText);
  const card=panel.locator('article').filter({hasText:fact.rawText}).filter({has:page.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})}).first();
  await card.getByRole('button',{name:'Открыть исходный фрагмент',exact:true}).click();
  const wrapper=panel.getByRole('region',{name:'Сохранение привязки машинного факта',exact:true});
  const editor=wrapper.getByRole('region',{name:'Привязка конкретного машинного факта',exact:true});await editor.waitFor();
  await panel.locator('.inspector-evidence-pane img').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.inspector-evidence-pane img')].every(i=>i.complete&&i.naturalWidth>0));
  await editor.getByLabel('Ключ здания, этажа или элемента',{exact:true}).fill('synthetic:T13:building-one');
  await editor.getByLabel('Основание идентичности элемента',{exact:true}).fill('Controlled synthetic original: first building row independently reviewed');
  for(const textarea of await editor.getByLabel('Основание условия',{exact:true}).all())await textarea.fill('Controlled synthetic original: selected building and area basis reviewed');
  for(const checkbox of await editor.getByRole('checkbox',{name:/^Условие «/}).all())await checkbox.check();
  await editor.getByRole('checkbox',{name:/^Идентичность указанного элемента/}).check();
  const apply=editor.getByRole('button',{name:'Добавить привязку в черновик',exact:true});assert.equal(await apply.isEnabled(),true);await apply.click();
  await wrapper.getByLabel('Основание сохранения решения',{exact:true}).fill('Controlled synthetic T13: original first row and contexts reviewed');
  await wrapper.getByRole('button',{name:'Сохранить привязки источника',exact:true}).click();
  await wrapper.getByText(/^Решение по выбранным строкам сохранено\./).waitFor();
  const review=await read(`objects/${state.objectId}/files/${fact.sourceFileId}/source-review`);
  assert.equal(review.matrixScope.schemaVersion,'matrix-fact-scopes-v1');assert.equal(review.matrixScope.bindings.length,1);
  assert.equal(review.matrixScope.bindings[0].target.observationId,fact.id);assert.equal(review.revisionStatus,'CURRENT');assert.equal(review.approvalStatus,'APPROVED');
  reviews.push({sourceFileId:fact.sourceFileId,contentHash:review.contentHash,observationId:fact.id});
  await wrapper.screenshot({path:path.join(out,`binding-${stage}.png`)});await panel.getByLabel('Поиск извлечённых значений').fill('');
 }
 // A second inspector changes the same controlled source after this editor loaded it.
 const neighbour=before.execution.observations.find(f=>f.stage==='PD'&&f.value==='200');assert.ok(neighbour);
 await panel.getByLabel('Поиск извлечённых значений').fill(neighbour.rawText);
 await panel.locator('article').filter({hasText:neighbour.rawText}).filter({has:page.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})})
  .first().getByRole('button',{name:'Открыть исходный фрагмент',exact:true}).click();
 const staleWrapper=panel.getByRole('region',{name:'Сохранение привязки машинного факта',exact:true});
 const staleEditor=staleWrapper.getByRole('region',{name:'Привязка конкретного машинного факта',exact:true});await staleEditor.waitFor();
 const current=await read(`objects/${state.objectId}/files/${neighbour.sourceFileId}/source-review`);
 const csrf=(await context.cookies()).find(cookie=>cookie.name==='inspector_csrf');assert.ok(csrf);
 const concurrent=await context.request.post(`${base}/api/objects/${state.objectId}/files/${neighbour.sourceFileId}/source-review`,{
  headers:{'X-CSRF-Token':decodeURIComponent(csrf.value),'Idempotency-Key':crypto.randomUUID()},
  data:{sourceSha256:current.sourceSha256,revisionStatus:current.revisionStatus,approvalStatus:current.approvalStatus,
   linkGroupId:current.linkGroupId,sectionCode:current.sectionCode,pageStages:current.pageStages,matrixScope:current.matrixScope,
   basis:{reference:'Controlled T13 concurrent inspector changed review basis'},expectedReviewHash:current.contentHash}});
 assert.equal(concurrent.status(),201);
 await staleEditor.getByLabel('Ключ здания, этажа или элемента',{exact:true}).fill('synthetic:T13:building-two');
 await staleEditor.getByLabel('Основание идентичности элемента',{exact:true}).fill('Controlled synthetic second row; this draft must be rejected as stale');
 await staleEditor.getByRole('checkbox',{name:/^Идентичность указанного элемента/}).check();
 await staleEditor.getByRole('button',{name:'Добавить привязку в черновик',exact:true}).click();
 await staleWrapper.getByRole('button',{name:'Сохранить привязки источника',exact:true}).click();
 await staleWrapper.getByRole('alert').filter({hasText:/Решение по источнику изменилось/}).waitFor();
 await staleEditor.getByRole('heading',{name:'Привязки в черновике: 2',exact:true}).waitFor();
 assert.equal((await read(`objects/${state.objectId}/files/${neighbour.sourceFileId}/source-review`)).matrixScope.bindings.length,1);
 await staleWrapper.getByRole('button',{name:'Перезагрузить решение и сбросить черновик',exact:true}).click();
 await staleEditor.getByRole('heading',{name:'Привязки в черновике: 1',exact:true}).waitFor();
 await panel.getByLabel('Поиск извлечённых значений').fill('');
 const responsive=[];for(const width of [1440,768,375]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);
  const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=width+2);responsive.push(size);
  await page.screenshot({path:path.join(out,`bindings-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});
 assert.equal((await read(`checks/${state.checkId}/matrix-execution`)).contentHash,before.contentHash);
 assert.deepEqual(await (await context.request.get(`${base}/api/checks/${state.checkId}/submission`)).body(),oldBytes);
 await page.getByRole('button',{name:/^(Проверить источники и повторить|Исходные документы)$/}).first().click();
 const createdPromise=page.waitForResponse(response=>response.url()===`${base}/api/checks/${state.checkId}/reprocess`&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Новая проверка',exact:true}).click();const response=await createdPromise;assert.equal(response.status(),200);const check=await response.json();
 const next={...state,previousCheckId:state.checkId,checkId:check.id};fs.writeFileSync(outputState,JSON.stringify(next),{mode:0o600,flag:'wx'});
 const cookies=await context.cookies();next.cookies=Object.fromEntries(cookies.sort((a,b)=>a.path.length-b.path.length).map(cookie=>[cookie.name,cookie.value]));fs.writeFileSync(outputState,JSON.stringify(next),{mode:0o600});
 let after;for(let attempt=0;attempt<60;attempt++){
  const result=await context.request.get(`${base}/api/checks/${check.id}/matrix-execution`);if(result.status()===200){after=await result.json();break;}
  if(result.status()!==404)throw Error(`New execution read HTTP ${result.status()}`);
  await page.waitForTimeout(1000);
 }
 assert.ok(after,'New matrix execution must complete');assert.equal(after.execution.observations.length,4);
 const qualified=after.execution.results.filter(row=>row.qualified);assert.equal(qualified.length,1);assert.equal(qualified[0].machineStatus,'CANDIDATE');assert.equal(qualified[0].delta,'3');
 assert.equal(after.execution.observations.filter(f=>f.entityKey===null).length,2);assert.equal(after.execution.coverage.find(row=>row.parameterCode==='PZ-002').executionStatus,'PARTIAL');
 assert.ok(after.execution.results.some(row=>row.parameterCode==='PZ-002'&&row.entityKey===null&&!row.qualified));
 assert.equal((await read(`checks/${state.checkId}/matrix-execution`)).contentHash,before.contentHash);
 assert.deepEqual(await(await context.request.get(`${base}/api/checks/${state.checkId}/submission`)).body(),oldBytes);
 await page.reload();await page.getByRole('button',{name:'Открыть кабинет',exact:true}).first().click();
 await page.locator('.object-card').filter({hasText:state.objectId}).getByRole('button',{name:'Открыть проверку'}).click();
 await page.getByRole('region',{name:'Кандидаты расхождений по общим правилам'}).getByRole('heading',{name:'Кандидаты расхождений: 1',exact:true}).waitFor();
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'new-run-candidate.png'),fullPage:true});
 const evidence={status:'PASS',objectId:state.objectId,originCheckId:state.checkId,newCheckId:check.id,originContentHash:before.contentHash,
  newContentHash:after.contentHash,observations:4,qualified:1,unbound:2,coverage:'PARTIAL',staleReviewRejected:true,oldBytesSha256:crypto.createHash('sha256').update(oldBytes).digest('hex'),reviews,responsive,pageErrors:errors};
 fs.writeFileSync(path.join(out,'browser-bindings.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser.close();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
