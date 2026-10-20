/** Explicit browser reviews of synthetic T30 originals only; never approves real project data. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [statePath,outputState]=process.argv.slice(2),base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082';
if(!statePath||!outputState||fs.existsSync(outputState)||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('New private output and loopback stand required');
assert.equal(fs.statSync(statePath).mode&0o077,0);
const state=JSON.parse(fs.readFileSync(statePath)),out=process.env.FEEDBACK_QA_OUTPUT||'output/matrix-t30-20261018/controlled-browser';
const rule='matrix-pz-009-declared_project_zero_absolute_elevation',attribute='PROJECT_ZERO_ABSOLUTE_ELEVATION',authorityKey='PROJECT_ZERO_GEODETIC_AUTHORITY';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
(async()=>{
 fs.mkdirSync(out,{recursive:true});assert.ok(!fs.existsSync(path.join(out,'browser.json'))&&!fs.existsSync(path.join(out,'failure.json')));
 const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
 const errors=[],failedRequests=[],mutations=[],snapshots=[],runs=[],reviews=[],frames=[];let page,currentId=state.checkId;
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  await context.addCookies(Object.entries(state.cookies).map(([name,value])=>({name,value,domain:new URL(base).hostname,path:'/'})));
  const read=async endpoint=>{const response=await context.request.get(`${base}/api/${endpoint}`);assert.equal(response.status(),200,endpoint);return response.json();};
  const files=(await read(`objects/${state.objectId}/files`)).items;
  assert.deepEqual(files.map(f=>f.name).sort(),['matrix-project-zero-binding-PD.pdf','matrix-project-zero-binding-RD.pdf']);
  const sourcePaths=new Set(files.map(f=>`/api/objects/${state.objectId}/files/${f.id}/source-review`));
  await context.route('**/api/**',async route=>{
   const request=route.request(),pathname=new URL(request.url()).pathname;
   if(['GET','HEAD','OPTIONS'].includes(request.method()))return route.continue();
   const allowed=request.method()==='POST'&&(sourcePaths.has(pathname)||pathname==='/api/auth/open-workspace'||pathname===`/api/checks/${currentId}/reprocess`);
   mutations.push({path:pathname,method:request.method(),allowed});return allowed?route.continue():route.abort('blockedbyclient');
  });
  page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('requestfailed',request=>failedRequests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText}));
  const pending=new Set();page.on('request',r=>{if(r.method()==='GET'&&['fetch','xhr'].includes(r.resourceType()))pending.add(r);});
  page.on('requestfinished',r=>pending.delete(r));page.on('requestfailed',r=>pending.delete(r));
  async function settle(){for(let i=0;i<100;i++){if(!pending.size){await page.waitForTimeout(100);if(!pending.size)return;}await page.waitForTimeout(50);}assert.equal(pending.size,0);}
  async function open(){await settle();await page.goto(base);await page.getByRole('button',{name:'Открыть кабинет',exact:true}).first().click();
   await page.locator('.object-card').filter({hasText:state.objectId}).getByRole('button',{name:'Открыть проверку'}).click();
   const panel=page.getByRole('region',{name:'Общий машинный анализ',exact:true});await panel.waitFor();await settle();return panel;}
  async function savePrivate(file){const cookies=Object.fromEntries((await context.cookies()).sort((a,b)=>a.path.length-b.path.length).map(c=>[c.name,c.value]));
   const value={...state,checkId:currentId,cookies};fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
   const durable=path.join(process.env.HOME,'.local/state/inspector-feedback-20261017',`${currentId}.json`);fs.writeFileSync(durable,JSON.stringify(value),{mode:0o600});}
  async function snapshot(name,qualified,reason){
   let result;
   for(let i=0;i<600;i++){const response=await context.request.get(`${base}/api/checks/${currentId}/matrix-execution`);
    if(response.status()===200){result=await response.json();break;}assert.equal(response.status(),404);await page.waitForTimeout(1000);}
   assert.ok(result);assert.equal(result.execution.observations.length,2);
   const row=result.execution.results.find(r=>r.ruleId===rule);assert.ok(row);assert.equal(row.qualified,qualified===1);
   if(reason)assert.equal(row.reasonCode,reason);if(qualified)assert.equal(row.machineStatus,'CANDIDATE');
   assert.equal(result.execution.coverage.find(r=>r.parameterCode==='PZ-009').executionStatus,'PARTIAL');
   assert.ok(result.presentation.every(p=>p.confidence.calibratedProbability===null));
   let submission;
   for(let i=0;i<600;i++){submission=await context.request.get(`${base}/api/checks/${currentId}/submission`);if(submission.status()===200)break;assert.equal(submission.status(),409);await page.waitForTimeout(1000);}
   assert.equal(submission.status(),200);result=await read(`checks/${currentId}/matrix-execution`);
   const machine=await context.request.get(`${base}/api/checks/${currentId}/matrix-execution`),bytes=await submission.body();
   assert.equal(sha(bytes),result.submission.contentHash);
   snapshots.push({checkId:currentId,contentHash:result.contentHash,machineSha256:sha(await machine.body()),submissionSha256:sha(bytes)});
   runs.push({name,checkId:currentId,qualified,reason:row.reasonCode});
   await savePrivate(`${outputState}.checkpoint-${snapshots.length}.json`);await savePrivate(outputState);
   fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({runs,snapshots,reviews,mutations},null,2));return result;
  }
  async function sources(){await open();await page.getByRole('button',{name:/^(Проверить источники и повторить|Исходные документы)$/}).first().click();
   const list=page.getByRole('region',{name:'Исходные файлы',exact:true});await list.waitFor();await settle();
   for(const file of files){await settle();await list.getByRole('button').filter({hasText:file.name}).click();const form=page.locator('.source-review-form');
    await form.getByRole('heading',{name:file.name,exact:true}).waitFor();await settle();
    assert.equal(await form.getByRole('combobox',{name:/^Редакция/}).inputValue(),'UNKNOWN');
    assert.equal(await form.getByRole('combobox',{name:/^Согласование/}).inputValue(),'UNKNOWN');
    await form.getByRole('combobox',{name:/^Редакция/}).selectOption('CURRENT');await form.getByRole('combobox',{name:/^Согласование/}).selectOption('APPROVED');
    await form.getByRole('combobox',{name:/^Раздел документа/}).selectOption(file.stages[0]==='PD'?'PZ':'KR');
    await form.getByLabel('Группа связанных документов',{exact:true}).fill('synthetic:T30:project-zero');
    await form.getByLabel('Основание решения',{exact:true}).fill('Controlled synthetic T30 original; explicit source approval only, no real project authority');
    await form.getByRole('button',{name:'Сохранить решение',exact:true}).click();await page.getByText('Решение сохранено. Только новая проверка использует его.').waitFor();await settle();}
  }
  async function edit(stage,phase){const panel=await open(),result=await read(`checks/${currentId}/matrix-execution`),fact=result.execution.observations.find(f=>f.stage===stage&&f.attribute===attribute);
   await panel.getByLabel('Поиск извлечённых значений').fill(fact.rawText);
   const card=panel.locator('article').filter({hasText:fact.rawText}).filter({has:page.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})}).first();
   await card.getByRole('button',{name:'Открыть исходный фрагмент',exact:true}).click();
   const wrapper=panel.getByRole('region',{name:'Сохранение привязки машинного факта',exact:true}),editor=wrapper.getByRole('region',{name:'Привязка конкретного машинного факта',exact:true});
   await editor.waitFor();await settle();
   await editor.getByLabel('Ключ здания, этажа или элемента',{exact:true}).fill('synthetic:T30:building-1');
   await editor.getByLabel('Основание идентичности элемента',{exact:true}).fill(`Controlled synthetic T30 original identity; ${stage} ${phase}`);
   await editor.getByLabel('Здание или строительный объём',{exact:true}).fill('synthetic:T30:building-1');
   await editor.getByLabel('Общий ноль и соответствующий пол',{exact:true}).fill('synthetic:T30:same-finished-floor');
   await editor.getByLabel('Высотная система и datum',{exact:true}).fill('synthetic:T30:explicit-vertical-datum');
   const basis=editor.getByLabel('База абсолютной отметки проектного нуля',{exact:true});assert.equal(await basis.inputValue(),'');
   await basis.selectOption('FINISHED_FLOOR_PROJECT_ZERO_TO_APPROVED_ABSOLUTE_DATUM');
   await editor.getByRole('combobox',{name:'Согласованное изменение',exact:true}).selectOption('ABSENT');
   if(stage==='RD'){const choice=editor.getByRole('combobox',{name:'Основание ПД',exact:true});assert.equal(await choice.inputValue(),'');
    const choices=await choice.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));assert.equal(choices.length,1);await choice.selectOption(choices[0]);}
   for(const textarea of await editor.getByLabel('Основание условия',{exact:true}).all())await textarea.fill(`Controlled synthetic T30; explicit original geodetic classification and same floor/datum; ${phase}`);
   for(const checkbox of await editor.getByRole('checkbox',{name:/^Условие «/}).all())await checkbox.check();
   await editor.getByRole('checkbox',{name:/^Идентичность указанного элемента/}).check();
   const apply=editor.getByRole('button',{name:'Добавить привязку в черновик',exact:true});assert.ok(await apply.isEnabled());await apply.click();
   await wrapper.getByLabel('Основание сохранения решения',{exact:true}).fill(`Controlled synthetic T30 source-bound authority ${stage} ${phase}`);
   await wrapper.getByRole('button',{name:'Сохранить привязки источника',exact:true}).click();await wrapper.getByText(/^Решение по выбранным строкам сохранено\./).waitFor();await settle();
   const saved=await read(`objects/${state.objectId}/files/${fact.sourceFileId}/source-review`),binding=saved.matrixScope.bindings[0],authority=binding.contexts[authorityKey].projectZeroAuthority;
   assert.equal(saved.revisionStatus,'CURRENT');assert.equal(saved.approvalStatus,'APPROVED');assert.equal(binding.ruleId,rule);
   assert.equal(authority.kind,'APPROVED_PD_GEODETIC_BASIS');assert.equal(authority.sourceFileId,files.find(f=>f.stages[0]==='PD').id);
   if(stage==='PD')assert.equal(authority.reviewContentHash,undefined);else assert.equal(authority.reviewContentHash,(await read(`objects/${state.objectId}/files/${authority.sourceFileId}/source-review`)).contentHash);
   reviews.push({stage,phase,reviewContentHash:saved.contentHash,bindingTarget:binding.target,authority});
   await wrapper.screenshot({path:path.join(out,`${phase}-${stage}-review.png`)});return saved;
  }
  async function rerun(name,qualified,reason){await open();await page.getByRole('button',{name:/^(Проверить источники и повторить|Исходные документы)$/}).first().click();
   const pending=page.waitForResponse(r=>r.url()===`${base}/api/checks/${currentId}/reprocess`&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Новая проверка',exact:true}).click();const response=await pending;assert.equal(response.status(),200);currentId=(await response.json()).id;
   await savePrivate(outputState);return snapshot(name,qualified,reason);}
  const baseline=await snapshot('unreviewed-originals',0);
  assert.ok(baseline.execution.metadata.every(s=>s.revisionStatus==='UNKNOWN'&&s.approvalStatus==='UNKNOWN'));
  for(const file of files){const response=await context.request.get(`${base}/api/objects/${state.objectId}/files/${file.id}/source-review`);assert.equal(response.status(),404);
   const original=await context.request.get(`${base}/api/objects/${state.objectId}/files/${file.id}/content`);assert.equal(original.status(),200);assert.equal(sha(await original.body()),file.sha256);}
  await sources();const firstPd=await edit('PD','first-authority');await edit('RD','first-reference');
  await rerun('authority-reviewed',1,'CATALOG_TRIGGER_MATCHED');
  const secondPd=await edit('PD','new-authority-review');assert.notEqual(secondPd.contentHash,firstPd.contentHash);
  await rerun('old-rd-reference-stale',0,`CONTEXT_UNVERIFIED:${authorityKey}`);
  await edit('RD','fresh-reference');const final=await rerun('fresh-rd-reference',1,'CATALOG_TRIGGER_MATCHED');
  for(const width of [1440,768,375]){await page.setViewportSize({width,height:1050});const panel=await open();
   await panel.getByRole('heading',{name:'Кандидаты расхождений: 1',exact:true}).waitFor();
   const fact=final.execution.observations.find(f=>f.stage==='RD'&&f.attribute===attribute);await panel.getByLabel('Поиск извлечённых значений').fill(fact.rawText);
   await panel.locator('article').filter({hasText:fact.rawText}).filter({has:page.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})}).first().getByRole('button',{name:'Открыть исходный фрагмент',exact:true}).click();await settle();
   const viewer=panel.locator('.inspector-evidence-pane');await viewer.locator('img').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.inspector-evidence-pane img')].every(i=>i.complete&&i.naturalWidth>0));
   const frame=await viewer.evaluate(e=>{const b=e.querySelector('.inspector-evidence-box');return{x:parseFloat(b.style.left)/100,y:parseFloat(b.style.top)/100,width:parseFloat(b.style.width)/100,height:parseFloat(b.style.height)/100};});
   for(const k of ['x','y','width','height'])assert.ok(Math.abs(frame[k]-fact.bbox[k])<1e-6);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   frames.push({width,factId:fact.id,bbox:frame});await panel.screenshot({path:path.join(out,`candidate-${width}.png`)});}
  for(const snapshot of snapshots){const machine=await context.request.get(`${base}/api/checks/${snapshot.checkId}/matrix-execution`),submission=await context.request.get(`${base}/api/checks/${snapshot.checkId}/submission`);
   assert.equal(sha(await machine.body()),snapshot.machineSha256);assert.equal(sha(await submission.body()),snapshot.submissionSha256);}
  assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);assert.ok(mutations.every(m=>m.allowed));
  const result={status:'PASS',syntheticOnly:true,harnessSha256:sha(fs.readFileSync(__filename)),runs,reviews,frames,snapshots,mutations,errors,failedRequests};
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:'PASS',runs:runs.map(r=>r.qualified),responsiveWidths:frames.map(f=>f.width),output:out}));
 }catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),currentId,runs,reviews,snapshots,mutations,errors,failedRequests},null,2));if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
 finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
