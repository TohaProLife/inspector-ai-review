/** Browser acceptance writes only synthetic T22 originals on the loopback stand.
 * Usage: node scripts/smoke-matrix-fence-bindings.cjs private-input.json new-private-output.json
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [statePath, outputState] = process.argv.slice(2), base = process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082';
if (!statePath || !outputState || fs.existsSync(outputState) || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw Error('Private input, new output and loopback stand required');
if (fs.statSync(statePath).mode & 0o077) throw Error('Auth state must have mode 0600');
if ([1, 2, 3, 4].some(index => fs.existsSync(`${outputState}.checkpoint-${index}.json`)))
  throw Error('Checkpoint output files must be new');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const resumeStatePath = process.env.FEEDBACK_QA_RESUME_STATE, resumeEvidencePath = process.env.FEEDBACK_QA_RESUME_EVIDENCE;
if (!!resumeStatePath !== !!resumeEvidencePath) throw Error('Resume requires private state and preserved failure evidence');
let resumeState, resumeEvidence;
if (resumeStatePath) {
  if (fs.statSync(resumeStatePath).mode & 0o077) throw Error('Resume auth state must have mode 0600');
  resumeState = JSON.parse(fs.readFileSync(resumeStatePath)); resumeEvidence = JSON.parse(fs.readFileSync(resumeEvidencePath));
  assert.equal(resumeState.objectId, state.objectId); assert.notEqual(resumeState.checkId, state.checkId);
  assert.equal(resumeState.previousCheckId, state.checkId);
  assert.deepEqual(resumeEvidence.errors, []); assert.deepEqual(resumeEvidence.failedRequests, []);
  assert.equal(resumeEvidence.snapshots.length, 1); assert.equal(resumeEvidence.snapshots[0].checkId, state.checkId);
  assert.equal(resumeEvidence.runs.length, 1); assert.equal(resumeEvidence.runs[0].qualified, 0);
  assert.equal(resumeEvidence.reviews.filter(item => item.phase === 'source-approval').length, 2);
  assert.equal(resumeEvidence.reviews.filter(item => item.phase === 'fact-binding' && item.fenceTypeReviewed).length, 2);
  assert.equal(resumeEvidence.mutations.filter(item => item.path.endsWith('/source-review')).length, 4);
  assert.ok(resumeEvidence.mutations.every(item => item.allowed));
}
const harnessSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const out = process.env.FEEDBACK_QA_OUTPUT || 'output/matrix-t22-20261018/browser';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const spec = { ruleId: 'matrix-spzu-036-territory_fence_height', attribute: 'TERRITORY_FENCE_HEIGHT',
  role: 'TERRITORY_FENCE_SEGMENT', mode: 'TERRITORY_BOUNDARY', basis: 'FINISHED_GROUND_TO_FENCE_TOP',
  entity: 'synthetic:T22:fence-segment-1', component: 'synthetic-fence-segment-1', zone: 'synthetic-boundary-zone-A' };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(path.join(out, 'browser-fence.json')) || fs.existsSync(path.join(out, 'failure-diagnostics.json')))
    throw Error('Use a new output directory for another acceptance attempt');
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  let page;
  const errors = [], failedRequests = [], mutations = [...(resumeEvidence?.mutations ?? [])],
    snapshots = [...(resumeEvidence?.snapshots ?? [])], runs = [...(resumeEvidence?.runs ?? [])],
    frames = [], reviews = [...(resumeEvidence?.reviews ?? [])];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addCookies(Object.entries((resumeState ?? state).cookies).map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/' })));
    const read = async endpoint => {
      const response = await context.request.get(`${base}/api/${endpoint}`);
      assert.equal(response.status(), 200, `GET ${endpoint}: ${response.status()}`);
      return response.json();
    };
    const files = (await read(`objects/${state.objectId}/files`)).items;
    assert.equal(files.length, 2);
    assert.deepEqual(files.map(file => file.name).sort(), ['matrix-fence-binding-PD.pdf', 'matrix-fence-binding-RD.pdf']);
    const allowedSources = new Set(files.map(file => file.id));
    let currentId = resumeState?.checkId ?? state.checkId;
    await context.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { await route.continue(); return; }
      const sourceWrite = [...allowedSources].some(source => pathname === `/api/objects/${state.objectId}/files/${source}/source-review`);
      const allowed = request.method() === 'POST' && (pathname === '/api/auth/open-workspace'
        || sourceWrite || pathname === `/api/checks/${currentId}/reprocess`);
      mutations.push({ method: request.method(), path: pathname, allowed });
      if (allowed) await route.continue(); else await route.abort('blockedbyclient');
    });
    page = await context.newPage(); page.setDefaultTimeout(25_000);
    const pendingReads = new Set();
    page.on('request', request => { if (request.method() === 'GET' && ['fetch', 'xhr'].includes(request.resourceType())) pendingReads.add(request); });
    page.on('requestfinished', request => pendingReads.delete(request));
    page.on('requestfailed', request => pendingReads.delete(request));
    async function settleReads() {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (pendingReads.size === 0) { await page.waitForTimeout(100); if (pendingReads.size === 0) return; }
        await page.waitForTimeout(50);
      }
      assert.equal(pendingReads.size, 0, 'Complete reads before changing source or page');
    }
    page.on('pageerror', error => errors.push(String(error)));
    page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    const execution = () => read(`checks/${currentId}/matrix-execution`);
    async function checkpoint() {
      let result = await execution(), response;
      for (let attempt = 0; attempt < 600; attempt++) {
        response = await context.request.get(`${base}/api/checks/${currentId}/submission`);
        if (response.status() === 200) break;
        assert.equal(response.status(), 409, 'Submission waits for terminal seal'); await page.waitForTimeout(1000);
      }
      assert.equal(response.status(), 200);
      result = await execution();
      const bytes = await response.body();
      assert.equal(sha(bytes), result.submission.contentHash);
      const machineResponse = await context.request.get(`${base}/api/checks/${currentId}/matrix-execution`);
      assert.equal(machineResponse.status(), 200);
      snapshots.push({ checkId: currentId, contentHash: result.contentHash, machineResponseSha256: sha(await machineResponse.body()), submissionSha256: sha(bytes) });
      fs.writeFileSync(`${outputState}.checkpoint-${snapshots.length}.json`, JSON.stringify({ ...state, checkId: currentId,
        cookies: Object.fromEntries((await context.cookies()).sort((a, b) => a.path.length - b.path.length).map(cookie => [cookie.name, cookie.value])) }),
      { mode: 0o600, flag: 'wx' });
      return result;
    }
    async function open() {
      await settleReads(); await page.goto(base);
      await page.getByRole('button', { name: 'Открыть кабинет', exact: true }).first().click();
      await page.locator('.object-card').filter({ hasText: state.objectId }).getByRole('button', { name: 'Открыть проверку' }).click();
      const panel = page.getByRole('region', { name: 'Общий машинный анализ', exact: true }); await panel.waitFor(); return panel;
    }
    async function showFact(panel, fact) {
      await panel.getByLabel('Поиск извлечённых значений').fill(fact.rawText);
      const card = panel.locator('article').filter({ hasText: fact.rawText })
        .filter({ has: page.getByRole('button', { name: 'Открыть исходный фрагмент', exact: true }) }).first();
      await card.getByRole('button', { name: 'Открыть исходный фрагмент', exact: true }).click();
      await panel.locator('.inspector-evidence-pane img').waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.inspector-evidence-pane img')]
        .every(image => image.complete && image.naturalWidth > 0));
      // The image can load before the independently fetched target/review. Finish this
      // selection before choosing another fact, rather than treating its AbortController as a network failure.
      await panel.getByRole('region', { name: 'Привязка конкретного машинного факта', exact: true }).waitFor();
      return card;
    }
    async function verifyFrame(panel, fact, label) {
      const viewer = panel.locator('.inspector-evidence-pane');
      await viewer.getByRole('img', { name: `${fact.stage}, исходная страница ${fact.pageNumber}`, exact: true }).waitFor();
      await page.waitForFunction(() => {
        const box = document.querySelector('.inspector-evidence-pane .inspector-evidence-box')?.getBoundingClientRect();
        const viewport = document.querySelector('.inspector-evidence-pane .inspector-sheet-viewport')?.getBoundingClientRect();
        return box && viewport && (box.left + box.right) / 2 >= viewport.left && (box.left + box.right) / 2 <= viewport.right
          && (box.top + box.bottom) / 2 >= viewport.top && (box.top + box.bottom) / 2 <= viewport.bottom;
      });
      const frame = await viewer.evaluate(element => {
        const box = element.querySelector('.inspector-evidence-box'), image = element.querySelector('img');
        return { x: parseFloat(box.style.left) / 100, y: parseFloat(box.style.top) / 100,
          width: parseFloat(box.style.width) / 100, height: parseFloat(box.style.height) / 100,
          imageWidth: image.naturalWidth, imageHeight: image.naturalHeight };
      });
      for (const field of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(frame[field] - fact.bbox[field]) < 1e-6,
        `${label} ${field}: rendered=${frame[field]}, source=${fact.bbox[field]}`);
      assert.ok(frame.imageWidth > 0 && frame.imageHeight > 0);
      assert.equal(await viewer.getByLabel('Страница PDF').inputValue(), String(fact.pageNumber));
      assert.equal(await viewer.getByRole('link', { name: 'Открыть оригинальный PDF', exact: true }).getAttribute('href'),
        `/api/objects/${state.objectId}/files/${fact.sourceFileId}/content#page=${fact.pageNumber}`);
      frames.push({ label, sourceFileId: fact.sourceFileId, sourceSha256: fact.sourceSha256,
        pageNumber: fact.pageNumber, blockId: fact.blockId, attribute: fact.attribute, value: fact.value, ...frame });
    }
    async function approveSources() {
      await open();
      await page.getByRole('button', { name: /^(Проверить источники и повторить|Исходные документы)$/ }).first().click();
      const list = page.getByRole('region', { name: 'Исходные файлы', exact: true }); await list.waitFor();
      await settleReads();
      for (const file of files) {
        await settleReads(); await list.getByRole('button').filter({ hasText: file.name }).click();
        const form = page.locator('.source-review-form');
        await form.getByRole('heading', { name: file.name, exact: true }).waitFor(); await settleReads();
        assert.equal(await form.getByRole('combobox', { name: /^Редакция/ }).inputValue(), 'UNKNOWN');
        assert.equal(await form.getByRole('combobox', { name: /^Согласование/ }).inputValue(), 'UNKNOWN');
        assert.equal(await form.getByRole('combobox', { name: /^Раздел документа/ }).inputValue(), '');
        await form.getByRole('combobox', { name: /^Редакция/ }).selectOption('CURRENT');
        await form.getByRole('combobox', { name: /^Согласование/ }).selectOption('APPROVED');
        await form.getByRole('combobox', { name: /^Раздел документа/ }).selectOption('GP');
        await form.getByLabel('Группа связанных документов', { exact: true }).fill('synthetic-fence-bindings-20261018');
        await form.getByLabel('Основание решения', { exact: true }).fill('Controlled synthetic T22 originals only; explicit GP PD/RD approval for browser acceptance, no real project approval');
        await form.getByRole('button', { name: 'Сохранить решение', exact: true }).click();
        await page.getByText('Решение сохранено. Только новая проверка использует его.', { exact: true }).waitFor();
        await settleReads();
        const saved = await read(`objects/${state.objectId}/files/${file.id}/source-review`);
        assert.equal(saved.revisionStatus, 'CURRENT'); assert.equal(saved.approvalStatus, 'APPROVED'); assert.equal(saved.sectionCode, 'GP');
        assert.equal(saved.linkGroupId, 'synthetic-fence-bindings-20261018');
        assert.equal(saved.matrixScope?.bindings?.length ?? 0, 0);
        reviews.push({ phase: 'source-approval', sourceFileId: file.id, stage: file.stages[0], explicitBrowserReview: true });
      }
    }
    async function edit(stage, fenceType = true) {
      const atomic = 'ATOMIC_SUBRULE_SCOPE:' + spec.ruleId;
      console.log(JSON.stringify({ phase: 'edit', stage, fenceTypeReviewed: fenceType, checkId: currentId }));
      const data = await execution(), facts = data.execution.observations.filter(item => item.stage === stage && item.attribute === spec.attribute);
      assert.equal(facts.length, 1); const fact = facts[0];
      assert.equal(fact.value, stage === 'PD' ? '2.5' : '2.4'); assert.equal(fact.unit, 'm');
      const panel = await open(); await showFact(panel, fact); await verifyFrame(panel, fact, `${runs.length}-${stage}-fence`);
      const wrapper = panel.getByRole('region', { name: 'Сохранение привязки машинного факта', exact: true });
      const editor = wrapper.getByRole('region', { name: 'Привязка конкретного машинного факта', exact: true }); await editor.waitFor();
      const purpose = editor.getByLabel('Назначение ограждения', { exact: true }), basis = editor.getByLabel('База измерения ограждения', { exact: true });
      assert.equal(await purpose.inputValue(), '', 'Boundary mode requires explicit selection');
      assert.equal(await basis.inputValue(), '', 'Finished-ground height basis must never be inferred');
      const change = editor.getByLabel('Согласованное изменение', { exact: true });
      assert.equal(await change.inputValue(), '', 'Approved change status requires explicit selection');
      await editor.getByLabel('Ключ здания, этажа или элемента', { exact: true }).fill(spec.entity);
      await editor.getByLabel('Основание идентичности элемента', { exact: true }).fill('Controlled T22 exact territory fence segment independently reviewed');
      await editor.getByLabel('Участок ограждения', { exact: true }).fill(spec.component);
      await editor.getByLabel('Граница территории и зона', { exact: true }).fill(spec.zone);
      await purpose.selectOption({ label: 'Граница территории подтверждена' });
      assert.equal(await purpose.inputValue(), spec.mode);
      assert.equal(await basis.inputValue(), '', 'Selecting boundary mode must not fill the height basis');
      await basis.selectOption({ label: 'От поверхности готового грунта до верха ограждения' });
      assert.equal(await basis.inputValue(), spec.basis); await change.selectOption('ABSENT');
      for (const textarea of await editor.getByLabel('Основание условия', { exact: true }).all())
        await textarea.fill('Controlled T22: same fence segment, boundary zone, fence type/function and finished-ground-to-top measurement independently reviewed');
      for (const checkbox of await editor.getByRole('checkbox', { name: /^Условие «/ }).all()) {
        const text = await checkbox.getAttribute('aria-label') || await checkbox.evaluate(element => element.closest('label').innerText);
        if (!fenceType && text.includes('Тип и функция ограждения территории')) await checkbox.uncheck(); else await checkbox.check();
      }
      await editor.getByRole('checkbox', { name: /^Идентичность указанного элемента/ }).check();
      const apply = editor.getByRole('button', { name: 'Добавить привязку в черновик', exact: true });
      assert.equal(await apply.isEnabled(), true); await apply.click();
      await wrapper.getByLabel('Основание сохранения решения', { exact: true })
        .fill(`Controlled T22 only: ${stage} fence type identity ${fenceType ? 'reviewed' : 'withdrawn'}; same independently reviewed segment`);
      await wrapper.getByRole('button', { name: 'Сохранить привязки источника', exact: true }).click();
      await wrapper.getByText(/^Решение по выбранным строкам сохранено\./).waitFor(); await settleReads();
      const saved = await read(`objects/${state.objectId}/files/${fact.sourceFileId}/source-review`);
      assert.equal(saved.revisionStatus, 'CURRENT'); assert.equal(saved.approvalStatus, 'APPROVED'); assert.equal(saved.sectionCode, 'GP');
      assert.equal(saved.matrixScope.schemaVersion, 'matrix-fact-scopes-v1'); assert.equal(saved.matrixScope.bindings.length, 1);
      const binding = saved.matrixScope.bindings[0];
      assert.equal(binding.ruleId, spec.ruleId); assert.equal(binding.target.observationId, fact.id); assert.equal(binding.entityKey, spec.entity);
      assert.equal(Object.keys(binding.contexts).length, fenceType ? 4 : 3);
      assert.ok(!Object.keys(binding.contexts).some(key => /^(RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)/.test(key)));
      assert.deepEqual(Object.fromEntries(['parameterCode', 'attribute', 'canonicalUnit', 'componentRole', 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']
        .map(key => [key, binding.contexts[atomic][key]])), { parameterCode: 'SPZU-036', attribute: spec.attribute, canonicalUnit: 'm', componentRole: spec.role,
          componentKey: spec.component, zoneKey: spec.zone, operatingModeKey: spec.mode, measurementBasisKey: spec.basis });
      assert.equal(binding.contexts.APPROVED_CHANGE_STATUS.approvedChangePresent, false);
      assert.ok(binding.contexts.ZONE_IDENTITY.reference.length >= 8);
      if (fenceType) assert.ok(binding.contexts.FENCE_TYPE_IDENTITY.reference.length >= 8);
      else assert.equal(binding.contexts.FENCE_TYPE_IDENTITY, undefined);
      reviews.push({ phase: 'fact-binding', stage, fenceTypeReviewed: fenceType, sourceFileId: fact.sourceFileId,
        observationId: fact.id, reviewedContexts: Object.keys(binding.contexts), purposeInitiallyEmpty: true, basisInitiallyEmpty: true, changeInitiallyEmpty: true });
      await wrapper.screenshot({ path: path.join(out, `${runs.length}-${stage}-fence-type-${fenceType}.png`) });
    }
    async function rerun(name, qualified) {
      console.log(JSON.stringify({ phase: 'rerun', name, checkId: currentId }));
      await open(); await page.getByRole('button', { name: /^(Проверить источники и повторить|Исходные документы)$/ }).first().click();
      const responsePromise = page.waitForResponse(response => response.url() === `${base}/api/checks/${currentId}/reprocess`
        && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Новая проверка', exact: true }).click();
      const response = await responsePromise; assert.equal(response.status(), 200);
      const previous = currentId; currentId = (await response.json()).id;
      fs.writeFileSync(outputState, JSON.stringify({ ...state, checkId: currentId, previousCheckId: previous,
        cookies: Object.fromEntries((await context.cookies()).sort((a, b) => a.path.length - b.path.length).map(cookie => [cookie.name, cookie.value])) }),
      { mode: 0o600, ...(!fs.existsSync(outputState) ? { flag: 'wx' } : {}) });
      await acceptCurrent(name, qualified);
    }
    async function acceptCurrent(name, qualified) {
      let result;
      for (let attempt = 0; attempt < 600; attempt++) {
        const fetched = await context.request.get(`${base}/api/checks/${currentId}/matrix-execution`);
        if (fetched.status() === 200) { result = await fetched.json(); break; }
        assert.equal(fetched.status(), 404); await page.waitForTimeout(1000);
      }
      assert.ok(result, 'New execution completed'); assert.equal(result.execution.observations.length, 2);
      const rows = result.execution.results.filter(item => item.parameterCode === 'SPZU-036');
      assert.equal(rows.filter(item => item.qualified).length, qualified);
      const fence = rows.find(item => item.ruleId === spec.ruleId && item.entityKey === spec.entity); assert.ok(fence);
      assert.equal(fence.qualified, qualified === 1);
      assert.equal(fence.reasonCode, qualified === 1 ? 'CATALOG_TRIGGER_MATCHED' : 'CONTEXT_UNVERIFIED:FENCE_TYPE_IDENTITY');
      if (qualified === 1) assert.equal(fence.machineStatus, 'CANDIDATE');
      assert.equal(result.execution.coverage.find(item => item.parameterCode === 'SPZU-036').executionStatus, 'PARTIAL');
      assert.ok(result.presentation.every(item => item.confidence.calibratedProbability === null));
      runs.push({ name, checkId: currentId, qualified, fenceReason: fence.reasonCode });
      await checkpoint();
    }
    const baseline = resumeState ? await read(`checks/${state.checkId}/matrix-execution`) : await checkpoint(); assert.equal(baseline.execution.observations.length, 2);
    assert.equal(baseline.execution.results.filter(item => item.qualified).length, 0);
    assert.ok(baseline.execution.observations.every(fact => fact.entityKey === null));
    for (const fact of baseline.execution.observations) {
      const file = files.find(item => item.id === fact.sourceFileId); assert.ok(file); assert.equal(file.sha256, fact.sourceSha256);
      const original = await context.request.get(`${base}/api/objects/${state.objectId}/files/${file.id}/content`);
      assert.equal(original.status(), 200); assert.equal(sha(await original.body()), fact.sourceSha256);
    }
    assert.ok(baseline.execution.metadata.every(source => source.revisionStatus === 'UNKNOWN' && source.approvalStatus === 'UNKNOWN' && source.sectionCode === null));
    if (resumeState) {
      for (const file of files) {
        const saved = await read(`objects/${state.objectId}/files/${file.id}/source-review`);
        assert.equal(saved.revisionStatus, 'CURRENT'); assert.equal(saved.approvalStatus, 'APPROVED'); assert.equal(saved.sectionCode, 'GP');
        assert.equal(saved.linkGroupId, 'synthetic-fence-bindings-20261018');
        assert.equal(saved.matrixScope.bindings.length, 1);
        const binding = saved.matrixScope.bindings[0]; assert.equal(binding.ruleId, spec.ruleId); assert.equal(binding.entityKey, spec.entity);
        assert.deepEqual(Object.keys(binding.contexts).sort(), ['APPROVED_CHANGE_STATUS', 'FENCE_TYPE_IDENTITY', 'ZONE_IDENTITY', 'ATOMIC_SUBRULE_SCOPE:' + spec.ruleId].sort());
        assert.equal(binding.contexts.APPROVED_CHANGE_STATUS.approvedChangePresent, false);
        const atomic = binding.contexts['ATOMIC_SUBRULE_SCOPE:' + spec.ruleId];
        assert.deepEqual(Object.fromEntries(['componentRole','componentKey','zoneKey','operatingModeKey','measurementBasisKey'].map(key=>[key,atomic[key]])),
          {componentRole:spec.role,componentKey:spec.component,zoneKey:spec.zone,operatingModeKey:spec.mode,measurementBasisKey:spec.basis});
      }
      await acceptCurrent('same-fence-segment-reviewed', 1);
    } else {
      for (const file of files) {
        const response = await context.request.get(`${base}/api/objects/${state.objectId}/files/${file.id}/source-review`);
        assert.equal(response.status(), 404, 'No synthetic source review may be seeded silently');
      }
      runs.push({ name: 'unreviewed-unbound-baseline', checkId: currentId, qualified: 0 });
      await approveSources(); await edit('PD', true); await edit('RD', true);
      await rerun('same-fence-segment-reviewed', 1);
    }
    await edit('RD', false); await rerun('rd-fence-type-withdrawn', 0);
    await edit('RD', true); await rerun('rd-fence-type-restored', 1);
    const panel = await open();
    await page.getByRole('region', { name: 'Кандидаты расхождений по общим правилам' })
      .getByRole('heading', { name: 'Кандидаты расхождений: 1', exact: true }).waitFor();
    const final = await execution(), responsive = [];
    const rd = final.execution.observations.find(fact => fact.stage === 'RD' && fact.attribute === spec.attribute);
    const pd = final.execution.observations.find(fact => fact.stage === 'PD' && fact.attribute === spec.attribute);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1050 });
      await showFact(panel, pd); await showFact(panel, rd); await verifyFrame(panel, rd, `fence-original-${width}`);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= width + 2, JSON.stringify(dimensions)); responsive.push(dimensions);
      await page.screenshot({ path: path.join(out, `fence-${width}.png`), fullPage: true });
    }
    await settleReads();
    for (const saved of snapshots) {
      const machineResponse = await context.request.get(`${base}/api/checks/${saved.checkId}/matrix-execution`);
      assert.equal(machineResponse.status(), 200); assert.equal(sha(await machineResponse.body()), saved.machineResponseSha256);
      assert.equal((await machineResponse.json()).contentHash, saved.contentHash);
      const submission = await context.request.get(`${base}/api/checks/${saved.checkId}/submission`);
      assert.equal(submission.status(), 200); assert.equal(sha(await submission.body()), saved.submissionSha256);
    }
    assert.equal(mutations.filter(item => item.path.endsWith('/source-review')).length, 6, 'Two source reviews and four fact-binding writes');
    assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []); assert.ok(mutations.every(item => item.allowed));
    const evidence = { status: 'PASS', harnessSha256, resumedFrom: resumeEvidencePath ? { evidencePath: resumeEvidencePath, evidenceSha256: sha(fs.readFileSync(resumeEvidencePath)), checkId: resumeState.checkId } : null, objectId: state.objectId, originCheckId: state.checkId, finalCheckId: currentId,
      identityPolicy: 'matched-atomic-context-v1', runs, reviews, snapshots, frames, responsive, pageErrors: errors, failedRequests,
      sourceReviewWrites: mutations.filter(item => item.path.endsWith('/source-review')).length,
      unauthorizedMutations: mutations.filter(item => !item.allowed) };
    fs.writeFileSync(path.join(out, 'browser-fence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'PASS', objectId: state.objectId, finalCheckId: currentId,
      runs, frozenSnapshots: snapshots.length, responsive, pageErrors: errors }));
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failure-diagnostics.json'), JSON.stringify({errors,failedRequests,mutations,snapshots,runs,reviews},null,2)+'\n');
    if (page) {
      await page.screenshot({ path: path.join(out, 'fence-failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, 'fence-failure.txt'), await page.locator('body').innerText());
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
