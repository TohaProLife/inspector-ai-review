/** Browser acceptance writes only synthetic T20 originals on the loopback stand.
 * Usage: node scripts/smoke-matrix-stair-bindings.cjs private-input.json new-private-output.json
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
const out = process.env.FEEDBACK_QA_OUTPUT || 'output/matrix-t20-20261017/browser';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const specs = {
  tread: { ruleId: 'matrix-ar-048-stair_tread_depth', attribute: 'STAIR_TREAD_DEPTH',
    role: 'STAIR_TREAD', threshold: '300', actual: '299', basis: 'FINISHED_HORIZONTAL_TREAD_CLEAR_DEPTH' },
  riser: { ruleId: 'matrix-ar-048-stair_riser_height', attribute: 'STAIR_RISER_HEIGHT',
    role: 'STAIR_RISER', threshold: '150', actual: '151', basis: 'FINISHED_VERTICAL_RISER_HEIGHT' },
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  let page;
  const errors = [], failedRequests = [], mutations = [], snapshots = [], runs = [], frames = [], reviews = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addCookies(Object.entries(state.cookies).map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/' })));
    const read = async endpoint => {
      const response = await context.request.get(`${base}/api/${endpoint}`);
      assert.equal(response.status(), 200, `GET ${endpoint}: ${response.status()}`);
      return response.json();
    };
    const files = (await read(`objects/${state.objectId}/files`)).items;
    assert.equal(files.length, 2);
    assert.deepEqual(files.map(file => file.name).sort(), ['matrix-stairs-binding-PD.pdf', 'matrix-stairs-binding-RD.pdf']);
    const allowedSources = new Set(files.map(file => file.id));
    let currentId = state.checkId;
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
    page.on('pageerror', error => errors.push(String(error)));
    page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    const execution = () => read(`checks/${currentId}/matrix-execution`);
    async function checkpoint() {
      let result = await execution(), response;
      for (let attempt = 0; attempt < 90; attempt++) {
        response = await context.request.get(`${base}/api/checks/${currentId}/submission`);
        if (response.status() === 200) break;
        assert.equal(response.status(), 409, 'Submission waits for terminal seal'); await page.waitForTimeout(1000);
      }
      assert.equal(response.status(), 200);
      result = await execution();
      const bytes = await response.body();
      assert.equal(sha(bytes), result.submission.contentHash);
      snapshots.push({ checkId: currentId, contentHash: result.contentHash, submissionSha256: sha(bytes) });
      fs.writeFileSync(`${outputState}.checkpoint-${snapshots.length}.json`, JSON.stringify({ ...state, checkId: currentId,
        cookies: Object.fromEntries((await context.cookies()).sort((a, b) => a.path.length - b.path.length).map(cookie => [cookie.name, cookie.value])) }),
      { mode: 0o600, flag: 'wx' });
      return result;
    }
    async function open() {
      await page.goto(base);
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
    async function edit(stage, kind, norm = true, expectedBindings = 2) {
      const spec = specs[kind], atomic = 'ATOMIC_SUBRULE_SCOPE:' + spec.ruleId;
      console.log(JSON.stringify({ phase: 'edit', stage, kind, normApplicable: norm, checkId: currentId }));
      const data = await execution(), fact = data.execution.observations.find(item => item.stage === stage && item.attribute === spec.attribute);
      assert.ok(fact); assert.equal(fact.value, stage === 'PD' ? kind === 'tread' ? '310' : '149' : spec.actual);
      const panel = await open(); await showFact(panel, fact); await verifyFrame(panel, fact, `${runs.length}-${stage}-${kind}`);
      const wrapper = panel.getByRole('region', { name: 'Сохранение привязки машинного факта', exact: true });
      const editor = wrapper.getByRole('region', { name: 'Привязка конкретного машинного факта', exact: true }); await editor.waitFor();
      const purpose = editor.getByLabel('Назначение лестницы', { exact: true }), basis = editor.getByLabel('База измерения ступени', { exact: true });
      assert.equal(await purpose.inputValue(), '', 'Evacuation purpose requires explicit human selection');
      assert.equal(await basis.inputValue(), '', 'Physical height basis must never be inferred');
      assert.equal(await editor.getByRole('checkbox', { name: /^Нормативное требование применимо/ }).isChecked(), false);
      await editor.getByLabel('Ключ здания, этажа или элемента', { exact: true }).fill(`synthetic:T20:${kind}-1`);
      await editor.getByLabel('Основание идентичности элемента', { exact: true }).fill(`Controlled T20 original: exact ${kind} clearance row independently reviewed`);
      await editor.getByLabel('Марш и ступень', { exact: true }).fill(`synthetic-${kind}-1`);
      await editor.getByLabel('Этаж и лестничная клетка', { exact: true }).fill('synthetic-floor-1-route-A');
      await purpose.selectOption('EVACUATION');
      assert.equal(await basis.inputValue(), '', 'Selecting evacuation purpose must not fill the physical basis');
      await basis.selectOption(spec.basis);
      for (const textarea of await editor.getByLabel('Основание условия', { exact: true }).all())
        await textarea.fill(`Controlled T20 ${kind}: original label, evacuation route, applicability and clear-height basis reviewed`);
      const normApplicable = editor.getByRole('checkbox', { name: /^Нормативное требование применимо/ });
      const normReviewed = editor.getByRole('checkbox', { name: /^Условие «Применимость нормативного требования»/ });
      await normApplicable.check();
      if (!norm) {
        await normReviewed.check(); await normApplicable.uncheck();
        assert.equal(await normReviewed.isChecked(), false, 'Removing applicability clears the prior norm confirmation');
      }
      for (const checkbox of await editor.getByRole('checkbox', { name: /^Условие «/ }).all()) {
        const text = await checkbox.getAttribute('aria-label') || await checkbox.evaluate(element => element.closest('label').innerText);
        if (!norm && text.includes('Применимость нормативного требования')) await checkbox.uncheck(); else await checkbox.check();
      }
      await editor.getByRole('checkbox', { name: /^Идентичность указанного элемента/ }).check();
      const apply = editor.getByRole('button', { name: 'Добавить привязку в черновик', exact: true });
      assert.equal(await apply.isEnabled(), true); await apply.click();
      await wrapper.getByLabel('Основание сохранения решения', { exact: true })
        .fill(`Controlled T20 fixture only: ${stage} ${kind} norm ${norm ? 'reviewed' : 'withdrawn'}; other fact bindings preserved`);
      await wrapper.getByRole('button', { name: 'Сохранить привязки источника', exact: true }).click();
      await wrapper.getByText(/^Решение по выбранным строкам сохранено\./).waitFor();
      const saved = await read(`objects/${state.objectId}/files/${fact.sourceFileId}/source-review`);
      assert.equal(saved.matrixScope.schemaVersion, 'matrix-fact-scopes-v1'); assert.equal(saved.matrixScope.bindings.length, expectedBindings);
      const binding = saved.matrixScope.bindings.find(item => item.ruleId === spec.ruleId); assert.ok(binding);
      assert.equal(binding.target.observationId, fact.id); assert.equal(binding.entityKey, `synthetic:T20:${kind}-1`);
      assert.equal(Object.keys(binding.contexts).length, norm ? 3 : 2);
      assert.ok(!Object.keys(binding.contexts).some(key => /^(RULE_SCOPE_COMPLETE|PARAMETER_SCOPE_COMPLETE)/.test(key)));
      assert.deepEqual(Object.fromEntries(['componentRole', 'componentKey', 'zoneKey', 'operatingModeKey', 'measurementBasisKey']
        .map(key => [key, binding.contexts[atomic][key]])), { componentRole: spec.role, componentKey: `synthetic-${kind}-1`,
        zoneKey: 'synthetic-floor-1-route-A', operatingModeKey: 'EVACUATION', measurementBasisKey: spec.basis });
      if (norm) assert.deepEqual(Object.fromEntries(['applicable', 'parameterCode', 'attribute', 'threshold', 'canonicalUnit']
        .map(key => [key, binding.contexts.NORM_APPLICABILITY_VERIFIED[key]])), {
        applicable: true, parameterCode: 'AR-048', attribute: spec.attribute, threshold: spec.threshold, canonicalUnit: 'mm' });
      else assert.equal(binding.contexts.NORM_APPLICABILITY_VERIFIED, undefined);
      reviews.push({ stage, kind, normApplicable: norm, sourceFileId: fact.sourceFileId, bindings: saved.matrixScope.bindings.length,
        observationId: fact.id, reviewedContexts: Object.keys(binding.contexts), purposeInitiallyEmpty: true, basisInitiallyEmpty: true });
      await wrapper.screenshot({ path: path.join(out, `${runs.length}-${stage}-${kind}-norm-${norm}.png`) });
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
      let result;
      for (let attempt = 0; attempt < 90; attempt++) {
        const fetched = await context.request.get(`${base}/api/checks/${currentId}/matrix-execution`);
        if (fetched.status() === 200) { result = await fetched.json(); break; }
        assert.equal(fetched.status(), 404); await page.waitForTimeout(1000);
      }
      assert.ok(result, 'New execution completed'); assert.equal(result.execution.observations.length, 4);
      const rows = result.execution.results.filter(item => item.parameterCode === 'AR-048');
      assert.equal(rows.filter(item => item.qualified).length, qualified);
      const tread = rows.find(item => item.ruleId === specs.tread.ruleId && item.entityKey === 'synthetic:T20:tread-1');
      const riser = rows.find(item => item.ruleId === specs.riser.ruleId && item.entityKey === 'synthetic:T20:riser-1');
      assert.ok(tread && riser); assert.equal(tread.machineStatus, 'CANDIDATE'); assert.equal(tread.qualified, true);
      assert.equal(riser.qualified, qualified === 2);
      assert.equal(riser.reasonCode, qualified === 2 ? 'CATALOG_TRIGGER_MATCHED' : 'CONTEXT_UNVERIFIED:NORM_APPLICABILITY_VERIFIED');
      assert.equal(result.execution.coverage.find(item => item.parameterCode === 'AR-048').executionStatus, 'PARTIAL');
      assert.ok(result.presentation.every(item => item.confidence.calibratedProbability === null));
      runs.push({ name, checkId: currentId, qualified, treadReason: tread.reasonCode, riserReason: riser.reasonCode });
      await checkpoint();
    }
    const baseline = await checkpoint(); assert.equal(baseline.execution.observations.length, 4);
    assert.equal(baseline.execution.results.filter(item => item.qualified).length, 0);
    assert.ok(baseline.execution.observations.every(fact => fact.entityKey === null));
    for (const fact of baseline.execution.observations) {
      const file = files.find(item => item.id === fact.sourceFileId); assert.ok(file); assert.equal(file.sha256, fact.sourceSha256);
      const original = await context.request.get(`${base}/api/objects/${state.objectId}/files/${file.id}/content`);
      assert.equal(original.status(), 200); assert.equal(sha(await original.body()), fact.sourceSha256);
    }
    await edit('PD', 'tread', true, 1); await edit('PD', 'riser', true, 2);
    await edit('RD', 'tread', true, 1); await edit('RD', 'riser', true, 2);
    await rerun('both-clearance-atoms-reviewed', 2);
    await edit('RD', 'riser', false, 2); await rerun('riser-norm-withdrawn-tread-preserved', 1);
    await edit('RD', 'riser', true, 2); await rerun('riser-norm-restored', 2);
    const panel = await open();
    await page.getByRole('region', { name: 'Кандидаты расхождений по общим правилам' })
      .getByRole('heading', { name: 'Кандидаты расхождений: 2', exact: true }).waitFor();
    const final = await execution(), responsive = [];
    const riser = final.execution.observations.find(fact => fact.stage === 'RD' && fact.attribute === specs.riser.attribute);
    const tread = final.execution.observations.find(fact => fact.stage === 'RD' && fact.attribute === specs.tread.attribute);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1050 });
      await showFact(panel, tread); await showFact(panel, riser); await verifyFrame(panel, riser, `riser-original-${width}`);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= width + 2, JSON.stringify(dimensions)); responsive.push(dimensions);
      await page.screenshot({ path: path.join(out, `stair-${width}.png`), fullPage: true });
    }
    for (const saved of snapshots) {
      assert.equal((await read(`checks/${saved.checkId}/matrix-execution`)).contentHash, saved.contentHash);
      const submission = await context.request.get(`${base}/api/checks/${saved.checkId}/submission`);
      assert.equal(submission.status(), 200); assert.equal(sha(await submission.body()), saved.submissionSha256);
    }
    assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []); assert.ok(mutations.every(item => item.allowed));
    const evidence = { status: 'PASS', objectId: state.objectId, originCheckId: state.checkId, finalCheckId: currentId,
      runs, reviews, snapshots, frames, responsive, pageErrors: errors, failedRequests,
      sourceReviewWrites: mutations.filter(item => item.path.endsWith('/source-review')).length,
      unauthorizedMutations: mutations.filter(item => !item.allowed) };
    fs.writeFileSync(path.join(out, 'browser-stair.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'PASS', objectId: state.objectId, finalCheckId: currentId,
      runs, frozenSnapshots: snapshots.length, responsive, pageErrors: errors }));
  } catch (error) {
    fs.writeFileSync(path.join(out, 'failure-diagnostics.json'), JSON.stringify({errors,failedRequests,mutations,snapshots,runs,reviews},null,2)+'\n');
    if (page) {
      await page.screenshot({ path: path.join(out, 'stair-failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, 'stair-failure.txt'), await page.locator('body').innerText());
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
