/** Read-only T20 acceptance of allowlisted public F0151 original; no reviews or new runs.
 * Usage: node scripts/smoke-matrix-stair-public.cjs private-state.json
 */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [statePath] = process.argv.slice(2);
const base = process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082';
if (!statePath || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Private state and loopback stand required');
if (fs.statSync(statePath).mode & 0o077) throw Error('Auth state must have mode 0600');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const out = process.env.FEEDBACK_QA_OUTPUT || 'output/matrix-t20-20261017/public-browser';
const originalSha = 'afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a';
const originalBytes = 7_666_331, originalPages = 40, pageNumber = 17;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const literalLines = [
  'Ширина проступей ступеней предусмотрена 0,3 м, а высота подъема',
  'ступеней - 0,15м. Уклоны лестниц - 1:2. Стальные ограждения лестничных',
];
const lineBoxes = [[85095, 349335, 500439, 363375], [85095, 325214, 537769, 339254]];
const normalized = box => ({ x: box[0] / 595320, y: 1 - box[3] / 841920,
  width: (box[2] - box[0]) / 595320, height: (box[3] - box[1]) / 841920 });
const union = normalized([85095, 325214, 537769, 363375]);
const specs = [{ attribute: 'STAIR_TREAD_DEPTH', value: '300', rawValue: '0,3' },
  { attribute: 'STAIR_RISER_HEIGHT', value: '150', rawValue: '0,15' }];
const nearBox = (actual, expected, label) => {
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${label}: ${key}`);
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const evidencePath = path.join(out, `${state.checkId}-stair-public-browser.json`);
  if (fs.existsSync(evidencePath)) throw Error('Use a new output directory for another acceptance attempt');
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-t20-public-qa-'));
  const pageErrors = [], failedRequests = [], mutations = [], authInitializations = [], frames = [], responsive = [], screenshots = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addCookies(Object.entries(state.cookies).map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/' })));
    const get = async endpoint => {
      const response = await context.request.get(`${base}/api/${endpoint}`);
      assert.equal(response.status(), 200, `GET ${endpoint}: ${response.status()}`); return response;
    };
    const run = await (await get(`checks/${state.checkId}`)).json();
    assert.equal(run.objectId, state.objectId); assert.equal(run.progress, 100);
    assert.ok(['PARTIAL', 'COMPLETED'].includes(run.status), 'Terminal run required');
    const machineBytes = await (await get(`checks/${state.checkId}/matrix-execution`)).body();
    const machine = JSON.parse(machineBytes);
    const facts = machine.execution.observations.filter(fact => specs.some(spec => spec.attribute === fact.attribute));
    assert.equal(facts.length, 2, 'Exactly two public stair observations');
    const sourceIds = new Set(facts.map(fact => fact.sourceFileId)); assert.equal(sourceIds.size, 1);
    const sourceFileId = facts[0].sourceFileId;
    for (const spec of specs) {
      const matches = facts.filter(fact => fact.attribute === spec.attribute); assert.equal(matches.length, 1);
      const fact = matches[0];
      assert.equal(fact.method, 'TEXT_LAYER'); assert.equal(fact.stage, 'PD'); assert.equal(fact.pageNumber, pageNumber);
      assert.equal(fact.value, spec.value); assert.equal(fact.unit, 'mm'); assert.equal(fact.rawValue, spec.rawValue); assert.equal(fact.rawUnit, 'м');
      assert.equal(fact.sourceSha256, originalSha); assert.equal(fact.entityKey, null); assert.deepEqual(fact.parameterCodes, ['AR-048']);
      assert.equal(fact.contextFragments, undefined); assert.ok(!fact.sourceFlags.includes('TABLE_CONTEXT_UNVERIFIED'));
      assert.deepEqual(fact.evidenceFragments.map(fragment => fragment.blockId), ['15:0', '16:0']);
      assert.deepEqual(fact.evidenceFragments.map(fragment => fragment.rawText), literalLines);
      fact.evidenceFragments.forEach((fragment, index) => {
        // Primary fragment page is inherited from the pinned fact; only context fragments carry their own page.
        nearBox(fragment.bbox, normalized(lineBoxes[index]), `${spec.attribute} primary fragment ${index}`);
      });
      nearBox(fact.bbox, union, `${spec.attribute} union`);
    }
    assert.deepEqual(facts[0].evidenceFragments, facts[1].evidenceFragments);
    assert.ok(machine.execution.results.every(result => !result.qualified), 'Public unapproved source never qualifies');
    assert.ok(machine.presentation.every(result => result.confidence.calibratedProbability === null));
    const metadata = machine.execution.metadata.filter(item => item.sourceFileId === sourceFileId);
    assert.equal(metadata.length, 1); assert.equal(metadata[0].stage, 'PD'); assert.equal(metadata[0].sectionCode, null, 'No reviewed section inferred from public index or filename');
    assert.equal(metadata[0].approvalStatus, 'UNKNOWN'); assert.equal(metadata[0].revisionStatus, 'UNKNOWN');
    const files = (await (await get(`objects/${state.objectId}/files`)).json()).items;
    assert.equal(files.length, 1); assert.equal(files[0].id, sourceFileId); assert.equal(files[0].sha256, originalSha); assert.equal(files[0].pageCount, originalPages);
    const original = await (await get(`objects/${state.objectId}/files/${sourceFileId}/content`)).body();
    assert.equal(original.length, originalBytes); assert.equal(sha(original), originalSha);
    const pdfPath = path.join(temporary, 'F0151-original.pdf'); fs.writeFileSync(pdfPath, original);
    const info = execFileSync('pdfinfo', ['-f', String(pageNumber), '-l', String(pageNumber), '-box', pdfPath], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    assert.match(info, /^Pages:\s+40\s*$/m); assert.match(info, /^Page\s+17\s+rot:\s+0\s*$/m);
    const crop = /^Page\s+17\s+CropBox:\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*$/m.exec(info);
    assert.ok(crop); const geometry = { width: Number(crop[3]) - Number(crop[1]), height: Number(crop[4]) - Number(crop[2]) };
    assert.ok(Math.abs(geometry.width - 595.32) < .02 && Math.abs(geometry.height - 841.92) < .02);
    const submissionResponse = await get(`checks/${state.checkId}/submission`), submissionBytes = await submissionResponse.body();
    assert.equal(sha(submissionBytes), machine.submission.contentHash); assert.equal(submissionResponse.headers()['x-content-sha256'], machine.submission.contentHash);
    const findingsBytes = await (await get(`checks/${state.checkId}/findings`)).body();
    async function sourceReviewSnapshot() {
      const response = await context.request.get(`${base}/api/objects/${state.objectId}/files/${sourceFileId}/source-review`);
      assert.ok([200, 404].includes(response.status())); return { status: response.status(), sha256: sha(await response.body()) };
    }
    const sourceReviewBefore = await sourceReviewSnapshot();
    await context.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === '/api/auth/open-workspace' && authInitializations.length === 0) {
        authInitializations.push({ method: request.method(), path: pathname }); await route.continue(); return;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        mutations.push({ method: request.method(), path: pathname }); await route.abort('blockedbyclient');
      } else await route.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(30_000);
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    await page.goto(base); await page.getByRole('button', { name: 'Открыть кабинет', exact: true }).first().click();
    await page.locator('.object-card').filter({ hasText: state.objectId }).getByRole('button', { name: 'Открыть проверку' }).click();
    const panel = page.getByRole('region', { name: 'Общий машинный анализ', exact: true }); await panel.waitFor();
    assert.match(await panel.innerText(), /Без калибровки — кандидат, уверенность не измерена/);
    const viewer = panel.locator('.inspector-evidence-pane');
    async function showAndVerify(fact, label) {
      await panel.getByLabel('Поиск извлечённых значений').fill(fact.attribute);
      const card = panel.locator('article').filter({ hasText: fact.attribute })
        .filter({ has: page.getByRole('button', { name: 'Открыть исходный фрагмент', exact: true }) });
      assert.equal(await card.count(), 1); assert.match(await card.innerText(), new RegExp(`${fact.value} mm`));
      assert.equal(await card.getByRole('button', { name: /^Открыть контекст/ }).count(), 0);
      await card.getByRole('button', { name: 'Открыть исходный фрагмент', exact: true }).click();
      await viewer.getByRole('img', { name: 'PD, исходная страница 17', exact: true }).waitFor();
      await panel.getByRole('region', { name: 'Привязка конкретного машинного факта', exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.inspector-evidence-pane img')].every(image => image.complete && image.naturalWidth > 0));
      await page.waitForFunction(() => {
        const box = document.querySelector('.inspector-evidence-pane .inspector-evidence-box')?.getBoundingClientRect();
        const viewport = document.querySelector('.inspector-evidence-pane .inspector-sheet-viewport')?.getBoundingClientRect();
        return box && viewport && (box.left + box.right) / 2 >= viewport.left && (box.left + box.right) / 2 <= viewport.right
          && (box.top + box.bottom) / 2 >= viewport.top && (box.top + box.bottom) / 2 <= viewport.bottom;
      });
      const frame = await viewer.evaluate(element => {
        const box = element.querySelector('.inspector-evidence-box'), image = element.querySelector('img');
        return { x: parseFloat(box.style.left) / 100, y: parseFloat(box.style.top) / 100,
          width: parseFloat(box.style.width) / 100, height: parseFloat(box.style.height) / 100, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight };
      });
      nearBox(frame, union, label); assert.ok(Math.abs(frame.imageWidth / frame.imageHeight - geometry.width / geometry.height) < .003);
      assert.equal(await viewer.getByLabel('Страница PDF').inputValue(), '17');
      assert.equal(await viewer.getByRole('link', { name: 'Открыть оригинальный PDF', exact: true }).getAttribute('href'),
        `/api/objects/${state.objectId}/files/${sourceFileId}/content#page=17`);
      frames.push({ label, attribute: fact.attribute, sourceSha256: originalSha, pageNumber, visible: true, ...frame });
    }
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1050 });
      for (const fact of facts) {
        await showAndVerify(fact, `${fact.attribute}-width-${width}`);
        const filename = `${state.checkId}-${fact.attribute}-${width}.png`;
        await viewer.screenshot({ path: path.join(out, filename) }); screenshots.push(filename);
      }
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= width + 2, JSON.stringify(dimensions)); responsive.push(dimensions);
      const filename = `${state.checkId}-${width}.png`; await page.screenshot({ path: path.join(out, filename), fullPage: true }); screenshots.push(filename);
    }
    assert.deepEqual(pageErrors, []); assert.deepEqual(failedRequests, []); assert.deepEqual(mutations, []);
    assert.deepEqual(await (await get(`checks/${state.checkId}/matrix-execution`)).body(), machineBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/submission`)).body(), submissionBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/findings`)).body(), findingsBytes);
    assert.deepEqual(await sourceReviewSnapshot(), sourceReviewBefore);
    const evidence = { status: 'PASS', objectId: state.objectId, checkId: state.checkId, sourceFileId, sourceSha256: originalSha,
      originalBytes, originalPages, pageNumber, sourceSection: null, publicIndexSection: 'OTHER', sectionApproved: false, sourceApproval: 'UNKNOWN', sourceRevision: 'UNKNOWN',
      facts: facts.map(fact => ({ id: fact.id, attribute: fact.attribute, value: fact.value, unit: fact.unit,
        rawValue: fact.rawValue, rawUnit: fact.rawUnit, primaryFragments: fact.evidenceFragments.length, contextFragments: 0, entityKey: fact.entityKey })),
      sharedPrimaryFragmentCount: 2, qualified: 0, calibratedProbability: null, frames, responsive, screenshots,
      machineHash: machine.contentHash, machineResponseSha256: sha(machineBytes), submissionHash: sha(submissionBytes),
      findingsResponseSha256: sha(findingsBytes), sourceReview: sourceReviewBefore, immutableAfterBrowser: true,
      reviewWritten: false, authInitializations, mutations, pageErrors, failedRequests };
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'PASS', checkId: state.checkId, originalPages, stairFacts: 2,
      qualified: 0, primaryFragmentsPerFact: 2, screenshots: screenshots.length, reviewWritten: false }));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(out, `${state.checkId}-failure.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, `${state.checkId}-failure.txt`), await page.locator('body').innerText());
    }
    fs.writeFileSync(path.join(out, `${state.checkId}-failure.json`), JSON.stringify({ status: 'FAIL', error: String(error), frames,
      responsive, authInitializations, mutations, pageErrors, failedRequests }, null, 2) + '\n'); throw error;
  } finally { await browser.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
