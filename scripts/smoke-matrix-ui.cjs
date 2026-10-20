/** Browser acceptance. Reads real runs; optional --geometry writes only guarded synthetic grid fixtures. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.FEEDBACK_WEB_URL||'http://127.0.0.1:28082',state=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('loopback stand required');
const geometry=process.argv.includes('--geometry'),readGeometry=process.argv.includes('--read-geometry'),out=process.env.FEEDBACK_QA_OUTPUT||'output/matrix-20261017';
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
try{const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addCookies(Object.entries(state.cookies).map(([name,value])=>({name,value,domain:new URL(base).hostname,path:'/'})));
 const read=async endpoint=>{const response=await context.request.get(`${base}/api/${endpoint}`);assert.equal(response.status(),200,await response.text());return response.json();};
 const files=(await read(`objects/${state.objectId}/files`)).items, before=await read(`checks/${state.checkId}/matrix-execution`);
 const submissionBefore=await context.request.get(`${base}/api/checks/${state.checkId}/submission`);assert.equal(submissionBefore.status(),200);const frozenBefore=await submissionBefore.body();assert.equal(crypto.createHash("sha256").update(frozenBefore).digest("hex"),before.submission.contentHash);assert.equal(submissionBefore.headers()["x-content-sha256"],before.submission.contentHash);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(20000);
 await page.goto(base);await page.getByRole('button',{name:'Открыть кабинет',exact:true}).first().click();
 await page.locator('.object-card').filter({hasText:state.objectId}).getByRole('button',{name:'Открыть проверку'}).click();
 const panel=page.getByRole('region',{name:'Общий машинный анализ'});await panel.waitFor();
 const installed=before.execution.coverage.filter(c=>c.implementedAtomicRules>0).length;
 assert.match(await panel.innerText(),new RegExp(`${installed}.*132`,'s'));assert.match(await panel.innerText(),/Без калибровки — кандидат/);
 const ruleCandidates=before.execution.results.filter(r=>r.machineStatus==='CANDIDATE'&&r.executionStatus!=='FAILED').length;
 const candidatePanel=panel.getByRole('region',{name:'Кандидаты расхождений по общим правилам'});
 await candidatePanel.getByRole('heading',{name:`Кандидаты расхождений: ${ruleCandidates}`,exact:true}).waitFor();
 if(ruleCandidates){await candidatePanel.getByRole('button',{name:'Сопоставляемое значение: открыть оригинал',exact:true}).first().click();await panel.locator('.inspector-evidence-pane img').first().waitFor();}
 const count=before.execution.observations.length;if(count){const fact=before.execution.observations[0];
  await panel.getByLabel('Поиск извлечённых значений').fill(fact.value);assert.match(await panel.getByRole('status').first().innerText(),/Наблюдений:/);
  await panel.getByRole('button',{name:'Открыть исходный фрагмент',exact:true}).first().click();
  await panel.locator('.inspector-evidence-pane img').first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.inspector-evidence-pane img')].every(i=>i.complete&&i.naturalWidth>0));
  await panel.getByLabel('Поиск извлечённых значений').fill('');
 }
 const tableContextChecks=[];
 for(const attribute of [process.argv.includes('--table-context')?'CONCRETE_CLASS':null,process.argv.includes('--slab-context')?'SLAB_THICKNESS':null].filter(Boolean)) {
  const fact=before.execution.observations.find(f=>f.attribute===attribute&&f.stage==='PD'&&f.contextFragments?.length);
  assert.ok(fact,`${attribute} table observation required`);
  if(attribute==='CONCRETE_CLASS')assert.ok(fact.contextFragments.some(c=>c.pageNumber!==fact.pageNumber),'cross-page context required');
  if(attribute==='SLAB_THICKNESS') {
   assert.equal(fact.value,'250');
   const actual=before.execution.observations.find(f=>f.attribute===attribute&&f.stage==='RD');
   assert.ok(actual);assert.equal(actual.value,'250');assert.match(actual.rawText,/500мм/);
  }
  await panel.getByLabel('Поиск извлечённых значений').fill(fact.rawText);
  const card=panel.locator('article').filter({hasText:fact.rawText}).filter({has:page.getByRole('button',{name:'Открыть исходный фрагмент',exact:true})}).first();
  for(const fragment of fact.contextFragments) {
   await card.getByRole('button',{name:`Открыть контекст · PDF ${fragment.pageNumber} · строка ${fragment.blockId}`,exact:true}).click();
   const viewer=panel.locator('.inspector-evidence-pane');
   await viewer.getByRole('img',{name:`${fact.stage}, исходная страница ${fragment.pageNumber}`,exact:true}).waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('.inspector-evidence-pane img')].every(i=>i.complete&&i.naturalWidth>0));
   await page.waitForFunction(()=>{
    const box=document.querySelector('.inspector-evidence-pane .inspector-evidence-box')?.getBoundingClientRect();
    const viewport=document.querySelector('.inspector-evidence-pane .inspector-sheet-viewport')?.getBoundingClientRect();
    return box&&viewport&&(box.top+box.bottom)/2>=viewport.top&&(box.top+box.bottom)/2<=viewport.bottom
     &&(box.left+box.right)/2>=viewport.left&&(box.left+box.right)/2<=viewport.right;
   });
   assert.equal(await viewer.getByRole('link',{name:'Открыть оригинальный PDF',exact:true}).getAttribute('href'),`/api/objects/${state.objectId}/files/${fact.sourceFileId}/content#page=${fragment.pageNumber}`);
   await viewer.screenshot({path:path.join(out,`${state.checkId}-context-${fragment.pageNumber}-${fragment.blockId.replace(':','-')}.png`)});
   tableContextChecks.push({attribute,pageNumber:fragment.pageNumber,blockId:fragment.blockId,role:fragment.role,frameVisible:true});
  }
  await card.getByRole('button',{name:'Открыть исходный фрагмент',exact:true}).click();
  await panel.getByRole('img',{name:`${fact.stage}, исходная страница ${fact.pageNumber}`,exact:true}).waitFor();
  await page.screenshot({path:path.join(out,`${state.checkId}-${attribute}-table-context.png`),fullPage:true});
  await panel.getByLabel('Поиск извлечённых значений').fill('');
 }
 await page.screenshot({path:path.join(out,`${state.checkId}-desktop.png`),fullPage:true});
 const responsive=[];for(const width of [768,375]){await page.setViewportSize({width,height:900});await page.waitForTimeout(350);const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=width+2,JSON.stringify(dimensions));responsive.push(dimensions);await page.screenshot({path:path.join(out,`${state.checkId}-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});
 let saved=null;
 if(geometry){assert.ok(files.some(f=>f.name==='matrix-geometry-PD.pdf')&&files.some(f=>f.name==='matrix-geometry-RD.pdf'),'guarded synthetic grid files required');
  const workspace=panel.locator('.local-registration-workspace');await workspace.locator('summary').click();
  for(const [name,fileName]of [['Исходный документ','matrix-geometry-PD.pdf'],['Сопоставляемый документ','matrix-geometry-RD.pdf']]){const group=workspace.getByRole('group',{name,exact:true});await group.getByRole('combobox',{name:'Файл',exact:true}).selectOption(files.find(f=>f.name===fileName).id);await group.getByLabel('Этаж по оригиналу').fill('synthetic-floor-1');await group.getByLabel('Этап строительства по оригиналу').fill('synthetic-phase-A');}
  await workspace.getByLabel('Основание решения инспектора',{exact:true}).fill('Синтетическая сетка: четыре видимых пересечения проверены; четвёртое вне расчёта');
  await workspace.getByRole('button',{name:'Открыть листы для расстановки опор'}).click();
  const add=workspace.getByRole('button',{name:'Добавить опору вручную'});await add.waitFor();
  const anchors=[[.125,.7857142857142857],[.875,.7857142857142857],[.125,.21428571428571427],[.875,.21428571428571427]];
  for(const [i,[x,y]]of anchors.entries()){await add.click();const group=workspace.getByRole('group',{name:`Опора ${i+1}`,exact:true});
   for(const [label,value]of [['Исходный x',x],['Исходный y',y],['Сопоставляемый x',x],['Сопоставляемый y',y]])await group.getByLabel(label,{exact:true}).fill(String(value));
   await group.getByLabel('Обозначение на исходном листе',{exact:true}).fill(`Synthetic PD grid intersection ${i+1}`);await group.getByLabel('Обозначение на сопоставляемом листе',{exact:true}).fill(`Synthetic RD grid intersection ${i+1}`);
  }
  await workspace.getByLabel('Адреса основания на оригиналах',{exact:true}).fill('Синтетические PD/RD PDF1: сетка x40/160, y40/120; опора4 вне расчёта');
  await workspace.getByRole('button',{name:'Рассчитать и проверить остатки'}).click();await workspace.getByText('Предварительный расчёт; решение по опорам ещё не сохранено.',{exact:true}).waitFor();
  await workspace.getByLabel('Проверил оригиналы и соответствие опор.',{exact:false}).check();await workspace.getByRole('button',{name:'Сохранить решение по локальной привязке'}).click();await workspace.getByText('Локальная привязка сохранена.',{exact:true}).waitFor();
  saved=await read(`objects/${state.objectId}/local-registrations`);assert.equal(saved.latest.result.absoluteGeoreference,false);assert.equal(saved.latest.result.status,'REGISTERED_RELATIVE');
  await workspace.getByRole('button',{name:'Загрузить сохранённое решение'}).click();await workspace.getByText('Локальная привязка сохранена.',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,`${state.checkId}-local-registration.png`),fullPage:true});
 }
 if(readGeometry&&!geometry){saved=await read(`objects/${state.objectId}/local-registrations`);assert.equal(saved.latest.result.absoluteGeoreference,false);assert.equal(saved.latest.result.status,'REGISTERED_RELATIVE');
  const workspace=panel.locator('.local-registration-workspace');await workspace.locator('summary').click();await workspace.getByRole('button',{name:'Загрузить сохранённое решение'}).click();await workspace.getByText('Локальная привязка сохранена.',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,`${state.checkId}-local-registration.png`),fullPage:true});}
 assert.deepEqual(errors,[]);assert.equal((await read(`checks/${state.checkId}/matrix-execution`)).contentHash,before.contentHash);
 let sourceContextDraft=false;
 if(process.argv.includes('--source-context')){
  assert.ok(files.some(f=>f.name==='matrix-equipment-IOS2-073-PD.pdf'),'explicit synthetic pump fixture required');
  await page.getByRole('button',{name:/^(Проверить источники и повторить|Исходные документы)$/}).first().click();
  await page.locator('.source-review-file').filter({hasText:'matrix-equipment-IOS2-073-PD.pdf'}).click();
  const scope=page.locator('.source-review-form .matrix-source-scope');await scope.locator(':scope > summary').click();
  await scope.getByLabel('Ключ здания, этажа или элемента',{exact:true}).fill('synthetic:IOS2-073');
  await scope.getByLabel(/^Параметр/).selectOption('IOS2-073');
  await scope.getByLabel('Основание связи и применимости условий',{exact:true}).fill('Synthetic browser draft: original pump duty point checked; no real project approval');
  const flow=scope.getByRole('group',{name:'PUMP_FLOW_RATE · m3/h',exact:true});
  for(const [label,value]of [['Позиция оборудования или слой','synthetic:pump-P1'],['Зона обслуживания или участок','synthetic:zone-A'],['Режим работы или состояние конструкции','synthetic:design-point-1'],['База измерения и расчётная точка','synthetic:volumetric-flow']])await flow.getByLabel(label,{exact:true}).fill(value);
  await scope.getByRole('checkbox',{name:/Проверены идентичность элемента/}).check();
  const apply=scope.getByRole('button',{name:'Добавить проверенный контекст к решению',exact:true});assert.equal(await apply.isEnabled(),true);
  const head=scope.getByRole('group',{name:'PUMP_HEAD · m',exact:true});
  await head.getByLabel('Позиция оборудования или слой',{exact:true}).fill('incomplete-draft');assert.equal(await apply.isEnabled(),false);
  await head.getByLabel('Позиция оборудования или слой',{exact:true}).fill('');
  await scope.getByRole('checkbox',{name:/Проверены идентичность элемента/}).check();await apply.click();
  const prepared=scope.locator('details').last();await prepared.locator('summary').click();
  assert.match(await prepared.innerText(),/ATOMIC_SUBRULE_SCOPE:matrix-ios2-073-pump_flow_rate/);
  assert.doesNotMatch(await prepared.innerText(),/ATOMIC_SUBRULE_SCOPE:matrix-ios2-073-pump_head|RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE/);
  await page.setViewportSize({width:375,height:900});await page.waitForTimeout(200);
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=377,JSON.stringify(dimensions));
  await page.screenshot({path:path.join(out,`${state.checkId}-source-context.png`),fullPage:true});sourceContextDraft=true;
 }
 assert.deepEqual(errors,[]);
 const after=await context.request.get(`${base}/api/checks/${state.checkId}/submission`);assert.deepEqual(await after.body(),frozenBefore);
 fs.writeFileSync(path.join(out,`${state.checkId}-browser.json`),JSON.stringify({objectId:state.objectId,checkId:state.checkId,observationCount:count,ruleCandidates,ocrCandidates:before.execution.ocrCandidates?.length??0,responsive,errors,machineHash:before.contentHash,submissionHash:before.submission.contentHash,geometryReviewId:saved?.latest?.reviewId??null,geometryWritten:geometry,geometryReloaded:geometry||readGeometry,sourceContextDraft,tableContextChecks},null,2));
 console.log(JSON.stringify({checkId:state.checkId,status:'PASS',observations:count,geometry:!!saved,sourceContextDraft}));
}catch(error){const failedPage=browser.contexts()[0]?.pages()[0];if(failedPage){await failedPage.screenshot({path:path.join(out,`${state.checkId}-failure.png`),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,`${state.checkId}-failure.txt`),await failedPage.locator('body').innerText());}throw error;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
