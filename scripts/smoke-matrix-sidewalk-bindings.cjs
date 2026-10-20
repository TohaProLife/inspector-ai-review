/** Browser acceptance writes only controlled T14 originals on the loopback stand. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [statePath,outputState]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082';
if(!statePath||!outputState||fs.existsSync(outputState)||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Private input, new output and loopback stand required');
if((fs.statSync(statePath).mode&0o077)!==0)throw Error('Private state required');
const state=JSON.parse(fs.readFileSync(statePath)),out=process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t14-20261017/browser';
const ruleId='matrix-spzu-026-sidewalk_tile_area',atomic='ATOMIC_SUBRULE_SCOPE:'+ruleId;
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}});
 await context.addCookies(Object.entries(state.cookies).map(([name,value])=>({name,value,domain:new URL(base).hostname,path:'/'})));
 const read=async endpoint=>{const response=await context.request.get(`${base}/api/${endpoint}`);assert.equal(response.status(),200,endpoint);return response.json();};
 const files=(await read(`objects/${state.objectId}/files`)).items;
 assert.equal(files.length,2);assert.ok(files.every(file=>/^matrix-sidewalk-binding-(PD|RD)\.pdf$/.test(file.name)),'Only controlled T14 originals');
 const page=await context.newPage(),errors=[],snapshots=[],runs=[];page.on('pageerror',error=>errors.push(String(error)));page.setDefaultTimeout(20000);
 let currentId=state.checkId;
 const execution=async()=>read(`checks/${currentId}/matrix-execution`);
 async function checkpoint(){const result=await execution();let response;
  for(let attempt=0;attempt<60;attempt++){response=await context.request.get(`${base}/api/checks/${currentId}/submission`);if(response.status()===200)break;assert.equal(response.status(),409,'Submission waits for the terminal seal');await page.waitForTimeout(1000);}
  assert.equal(response.status(),200);
  snapshots.push({checkId:currentId,contentHash:result.contentHash,submissionSha256:crypto.createHash('sha256').update(await response.body()).digest('hex')});return result;}
 async function open(){await page.goto(base);await page.getByRole('button',{name:'Открыть кабинет',exact:true}).first().click();
  await page.locator('.object-card').filter({hasText:state.objectId}).getByRole('button',{name:'Открыть проверку'}).click();
  const panel=page.getByRole('region',{name:'Общий машинный анализ'});await panel.waitFor();return panel;}
 async function edit(stage,approval='ABSENT',mode='ground'){
  console.log(JSON.stringify({phase:'edit',stage,approval,mode,checkId:currentId}));
  const data=await execution(),fact=data.execution.observations.find(f=>f.stage===stage&&f.value===(stage==='PD'?'100':'110')&&f.attribute==='SIDEWALK_TILE_AREA');assert.ok(fact);
  const panel=await open();await panel.getByLabel('Поиск извлечённых значений').fill(fact.rawText);
  await panel.locator('article').filter({hasText:fact.rawText}).filter({has:page.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})}).first()
   .getByRole('button',{name:'Открыть исходный фрагмент',exact:true}).click();
  const wrapper=panel.getByRole('region',{name:'Сохранение привязки машинного факта',exact:true}),editor=wrapper.getByRole('region',{name:'Привязка конкретного машинного факта',exact:true});await editor.waitFor();
  await panel.locator('.inspector-evidence-pane img').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.inspector-evidence-pane img')].every(i=>i.complete&&i.naturalWidth>0));
  await editor.getByLabel('Ключ здания, этажа или элемента',{exact:true}).fill('synthetic:T14:yard-ground');
  await editor.getByLabel('Основание идентичности элемента',{exact:true}).fill('Controlled T14 original: first tile-paving row and its yard reviewed');
  await editor.getByLabel('Тип и конструкция плиточного покрытия',{exact:true}).fill('synthetic-tile-type-3');
  await editor.getByLabel('Участок и границы мощения',{exact:true}).fill('synthetic-yard-A');
  await editor.getByLabel('Размещение по грунту или на кровле',{exact:true}).fill(mode);
  await editor.getByLabel('База расчёта площади мощения',{exact:true}).fill('synthetic-net-paving-area');
  await editor.getByLabel('Согласованное изменение',{exact:true}).selectOption(approval);
  for(const textarea of await editor.getByLabel('Основание условия',{exact:true}).all())await textarea.fill('Controlled T14 fixture: selected row and each condition independently reviewed');
  for(const checkbox of await editor.getByRole('checkbox',{name:/^Условие «/}).all())await checkbox.check();
  await editor.getByRole('checkbox',{name:/^Идентичность указанного элемента/}).check();
  assert.equal(await editor.getByRole('button',{name:'Добавить привязку в черновик',exact:true}).isEnabled(),true);
  await editor.getByRole('button',{name:'Добавить привязку в черновик',exact:true}).click();
  await wrapper.getByLabel('Основание сохранения решения',{exact:true}).fill('Controlled T14 fixture only: separate approval, surface, zone and area basis');
  await wrapper.getByRole('button',{name:'Сохранить привязки источника',exact:true}).click();
  await wrapper.getByText(/^Решение по выбранным строкам сохранено\./).waitFor();
  const saved=await read(`objects/${state.objectId}/files/${fact.sourceFileId}/source-review`);assert.equal(saved.matrixScope.bindings.length,1);
  const binding=saved.matrixScope.bindings[0];assert.equal(binding.ruleId,ruleId);assert.equal(binding.contexts.APPROVED_CHANGE_STATUS.approvedChangePresent,approval==='PRESENT');
  assert.equal(binding.contexts[atomic].operatingModeKey,mode);assert.equal(binding.contexts[atomic].componentRole,'SIDEWALK_TILE_PAVING');
  await wrapper.screenshot({path:path.join(out,`${runs.length}-${stage}-${approval}-${mode}.png`)});
 }
 async function rerun(name,qualified,reason){
  console.log(JSON.stringify({phase:'rerun',name,checkId:currentId}));
  await open();await page.getByRole('button',{name:/^(Проверить источники и повторить|Исходные документы)$/}).first().click();
  const responsePromise=page.waitForResponse(response=>response.url()===`${base}/api/checks/${currentId}/reprocess`&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Новая проверка',exact:true}).click();const response=await responsePromise;assert.equal(response.status(),200);
  const previous=currentId;currentId=(await response.json()).id;
  const next={...state,checkId:currentId,previousCheckId:previous,cookies:Object.fromEntries((await context.cookies()).sort((a,b)=>a.path.length-b.path.length).map(c=>[c.name,c.value]))};
  fs.writeFileSync(outputState,JSON.stringify(next),{mode:0o600,...(!fs.existsSync(outputState)?{flag:'wx'}:{})});
  let result;for(let attempt=0;attempt<60;attempt++){const r=await context.request.get(`${base}/api/checks/${currentId}/matrix-execution`);
   if(r.status()===200){result=await r.json();break;}assert.equal(r.status(),404);await page.waitForTimeout(1000);}
  assert.ok(result,'New execution completed');assert.equal(result.execution.observations.length,4);
  const rows=result.execution.results.filter(r=>r.ruleId===ruleId),selected=rows.find(r=>r.entityKey==='synthetic:T14:yard-ground');assert.ok(selected);
  assert.equal(rows.filter(r=>r.qualified).length,qualified,name);if(reason)assert.equal(selected.reasonCode,reason);
  if(qualified){assert.equal(selected.machineStatus,'CANDIDATE');assert.equal(selected.delta,'10');}
  assert.equal(result.execution.observations.filter(f=>f.entityKey===null).length,2);
  assert.equal(result.execution.coverage.find(r=>r.parameterCode==='SPZU-026').executionStatus,'PARTIAL');
  assert.ok(result.presentation.every(r=>r.confidence.calibratedProbability===null));
  runs.push({name,checkId:currentId,qualified,reasonCode:selected.reasonCode,delta:selected.delta});await checkpoint();
 }
 const baseline=await checkpoint();assert.equal(baseline.execution.observations.length,4);assert.equal(baseline.execution.results.filter(r=>r.qualified).length,0);
 await edit('PD');await edit('RD');await rerun('same-ground-no-approved-change',1);
 await edit('RD','PRESENT');await rerun('approved-change',0,'CONTEXT_UNVERIFIED:APPROVED_CHANGE_STATUS');
 await edit('RD','ABSENT','roof');await rerun('ground-roof-mismatch',0,'CONTEXT_UNVERIFIED:'+atomic);
 await edit('RD');await rerun('same-ground-restored',1);
 const panel=await open();await page.getByRole('region',{name:'Кандидаты расхождений по общим правилам'}).getByRole('heading',{name:'Кандидаты расхождений: 1',exact:true}).waitFor();
 const responsive=[];for(const width of [1440,768,375]){await page.setViewportSize({width,height:1050});await page.waitForTimeout(150);
  const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=width+2);responsive.push(size);
  await page.screenshot({path:path.join(out,`sidewalk-${width}.png`),fullPage:true});}
 for(const saved of snapshots){assert.equal((await read(`checks/${saved.checkId}/matrix-execution`)).contentHash,saved.contentHash);
  const response=await context.request.get(`${base}/api/checks/${saved.checkId}/submission`);assert.equal(response.status(),200);
  assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),saved.submissionSha256);}
 assert.deepEqual(errors,[]);const evidence={status:'PASS',objectId:state.objectId,originCheckId:state.checkId,finalCheckId:currentId,runs,snapshots,responsive,pageErrors:errors};
 fs.writeFileSync(path.join(out,'browser-sidewalk.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
