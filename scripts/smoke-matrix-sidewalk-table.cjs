/** Read-only T16 acceptance against a terminal public F0126 run. Never saves reviews.
 * Usage: node scripts/smoke-matrix-sidewalk-table.cjs private-state.json
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [statePath] = process.argv.slice(2), base = process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082';
if (!statePath || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Private state and loopback stand required');
if (fs.statSync(statePath).mode & 0o077) throw Error('Auth state must have mode 0600');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const out = process.env.FEEDBACK_QA_OUTPUT || 'output/matrix-t16-20261017/browser';
const originalSha = 'b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addCookies(Object.entries(state.cookies).map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/' })));
    const read = async endpoint => {
      const response = await context.request.get(`${base}/api/${endpoint}`);
      assert.equal(response.status(), 200, `GET ${endpoint}: ${response.status()}`);
      return response.json();
    };
    const run = await read(`checks/${state.checkId}`);
    assert.equal(run.progress, 100); assert.ok(['PARTIAL', 'COMPLETED'].includes(run.status), 'Terminal run required');
    const before = await read(`checks/${state.checkId}/matrix-execution`);
    const facts = before.execution.observations.filter(fact => fact.attribute === 'SIDEWALK_TILE_AREA');
    assert.equal(facts.length, 1, 'Exactly one ground sidewalk fact');
    const fact = facts[0];
    assert.equal(fact.stage, 'PD'); assert.equal(fact.pageNumber, 20); assert.equal(fact.value, '112'); assert.equal(fact.unit, 'm2');
    assert.equal(fact.sourceSha256, originalSha); assert.equal(fact.entityKey, null);
    assert.ok(fact.sourceFlags.includes('TABLE_CONTEXT_UNVERIFIED'));
    assert.equal(fact.contextFragments.length, 6); assert.equal(fact.evidenceFragments.length, 5);
    assert.deepEqual(fact.contextFragments.map(fragment => fragment.rawText.trim()).sort(), [
      'ВЕДОМОСТЬ ПРОЕЗДОВ, ТРОТУАРОВ,', 'ДОРОЖЕК И ПЛОЩАДОК', '(в гр. ГПЗУ)',
      'Площадь', 'покрытия, кв.м. в', 'гр. ГПЗУ',
    ].sort());
    assert.deepEqual(fact.evidenceFragments.map(fragment => fragment.rawText), [
      'Тротуары пешеходные', 'из бетонной плитки,', 'по грунту', '- тип 3', '112 м²',
    ]);
    assert.ok(before.execution.results.every(result => !result.qualified));
    assert.ok(before.presentation.every(result => result.confidence.calibratedProbability === null));
    assert.equal(before.execution.coverage.find(row => row.parameterCode === 'SPZU-026').executionStatus, 'PARTIAL');
    const metadata = before.execution.metadata.find(source => source.sourceFileId === fact.sourceFileId);
    assert.equal(metadata.approvalStatus, 'UNKNOWN'); assert.equal(metadata.revisionStatus, 'UNKNOWN');
    const files = (await read(`objects/${state.objectId}/files`)).items;
    assert.equal(files.find(source => source.id === fact.sourceFileId).sha256, originalSha);
    const original = await context.request.get(`${base}/api/objects/${state.objectId}/files/${fact.sourceFileId}/content`);
    assert.equal(original.status(), 200); assert.equal(sha(await original.body()), originalSha);
    const submission = await context.request.get(`${base}/api/checks/${state.checkId}/submission`);
    assert.equal(submission.status(), 200);
    const frozenBytes = await submission.body();
    assert.equal(sha(frozenBytes), before.submission.contentHash);
    assert.equal(submission.headers()['x-content-sha256'], before.submission.contentHash);
    async function sourceReviewHash() {
      const response = await context.request.get(`${base}/api/objects/${state.objectId}/files/${fact.sourceFileId}/source-review`);
      assert.ok([200, 404].includes(response.status()));
      return response.status() === 200 ? sha(await response.body()) : null;
    }
    const reviewBefore = await sourceReviewHash(), mutations = [], authInitializations = [], errors = [], failedRequests = [];
    await context.route('**/api/**', async route => {
      const request = route.request();
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/open-workspace' && authInitializations.length === 0) {
        authInitializations.push({ method: request.method(), path: '/api/auth/open-workspace' });
        await route.continue(); return;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        mutations.push({ method: request.method(), path: new URL(request.url()).pathname });
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(25_000);
    page.on('pageerror', error => errors.push(String(error)));
    page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    await page.goto(base);
    await page.getByRole('button', { name: 'Открыть кабинет', exact: true }).first().click();
    await page.locator('.object-card').filter({ hasText: state.objectId }).getByRole('button', { name: 'Открыть проверку' }).click();
    const panel = page.getByRole('region', { name: 'Общий машинный анализ', exact: true }); await panel.waitFor();
    await panel.getByLabel('Поиск извлечённых значений').fill(fact.rawText);
    const card = panel.locator('article').filter({ hasText: fact.rawText })
      .filter({ has: page.getByRole('button', { name: 'Открыть исходный фрагмент', exact: true }) }).first();
    await card.waitFor();
    assert.equal(await card.getByRole('button', { name: /^Открыть контекст · PDF / }).count(), 6);
    assert.match(await card.innerText(), /112 m2/);
    assert.match(await card.innerText(), /Связь строки с контекстом таблицы не подтверждена/);
    const viewer = panel.locator('.inspector-evidence-pane'), frames = [];
    async function verifyFrame(bounds, label) {
      await viewer.getByRole('img', { name: 'PD, исходная страница 20', exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.inspector-evidence-pane img')]
        .every(image => image.complete && image.naturalWidth > 0));
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
      // Chromium serializes percentage CSS values to about six significant digits.
      for (const field of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(frame[field] - bounds[field]) < 1e-6,
        `${label} ${field}: rendered=${frame[field]}, source=${bounds[field]}`);
      assert.ok(Math.abs(frame.imageWidth / frame.imageHeight - 1684 / 1191) < 0.003, 'Visible original rotation and page aspect');
      assert.equal(await viewer.getByRole('link', { name: 'Открыть оригинальный PDF', exact: true }).getAttribute('href'),
        `/api/objects/${state.objectId}/files/${fact.sourceFileId}/content#page=20`);
      assert.equal(await viewer.getByLabel('Страница PDF').inputValue(), '20');
      frames.push({ label, ...frame, visible: true });
    }
    for (const [index, fragment] of fact.contextFragments.entries()) {
      assert.equal(fragment.pageNumber, 20);
      await card.getByRole('button', { name: `Открыть контекст · PDF ${fragment.pageNumber} · строка ${fragment.blockId}`, exact: true }).click();
      await verifyFrame(fragment.bbox, `context-${index + 1}-${fragment.role}`);
      await viewer.screenshot({ path: path.join(out, `${state.checkId}-context-${index + 1}.png`) });
    }
    await card.getByRole('button', { name: 'Открыть исходный фрагмент', exact: true }).click();
    await verifyFrame(fact.bbox, 'five-line-primary-union');
    await viewer.screenshot({ path: path.join(out, `${state.checkId}-primary.png`) });
    const responsive = [];
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1050 });
      await card.getByRole('button', { name: `Открыть контекст · PDF 20 · строка ${fact.contextFragments[0].blockId}`, exact: true }).click();
      await card.getByRole('button', { name: 'Открыть исходный фрагмент', exact: true }).click();
      await verifyFrame(fact.bbox, `primary-${width}`);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= width + 2, JSON.stringify(dimensions)); responsive.push(dimensions);
      await page.screenshot({ path: path.join(out, `${state.checkId}-${width}.png`), fullPage: true });
    }
    assert.deepEqual(mutations, []); assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
    assert.equal((await read(`checks/${state.checkId}/matrix-execution`)).contentHash, before.contentHash);
    const submissionAfter = await context.request.get(`${base}/api/checks/${state.checkId}/submission`);
    assert.equal(submissionAfter.status(), 200); assert.deepEqual(await submissionAfter.body(), frozenBytes);
    assert.equal(await sourceReviewHash(), reviewBefore);
    const evidence = { status: 'PASS', objectId: state.objectId, checkId: state.checkId, sourceFileId: fact.sourceFileId,
      sourceSha256: originalSha, pageNumber: 20, value: '112', unit: 'm2', primaryFragments: 5, contextFragments: 6,
      qualified: 0, sourceApproval: 'UNKNOWN', sourceRevision: 'UNKNOWN', machineHash: before.contentHash,
      submissionHash: sha(frozenBytes), reviewWritten: false, frames, responsive, authInitializations, mutations, pageErrors: errors, failedRequests };
    fs.writeFileSync(path.join(out, `${state.checkId}-sidewalk-table-browser.json`), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'PASS', checkId: state.checkId, primaryFragments: 5, contextFragments: 6,
      screenshots: 10, qualified: 0, reviewWritten: false }));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(out, `${state.checkId}-failure.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, `${state.checkId}-failure.txt`), await page.locator('body').innerText());
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
