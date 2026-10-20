/** Read-only T28 browser acceptance against one new real public F0151 run.
 * Run only after the new provider/API/web release is READY.
 * Usage: node scripts/smoke-matrix-project-constraints.cjs /tmp/private-state.json
 * Three fresh navigations permit exactly one auth initialization each; all domain mutations blocked.
 * Expected facts/hashes are computed here, never imported from the API/worker extractor.
 */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [statePath] = process.argv.slice(2);
const base = process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082';
const origin = new URL(base).origin;
if (!statePath || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Private state and loopback stand required');
if ((fs.statSync(statePath).mode & 0o777) !== 0o600) throw Error('Auth state must have mode 0600');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
assert.ok(typeof state.checkId === 'string' && /^[A-Za-z0-9_-]+$/.test(state.checkId));
assert.ok(typeof state.objectId === 'string' && /^[A-Za-z0-9_-]+$/.test(state.objectId));
assert.ok(state.cookies && typeof state.cookies === 'object' && !Array.isArray(state.cookies));
const out = process.env.FEEDBACK_QA_OUTPUT || 'output/matrix-t28-20261018/public-browser';
const originalSha = 'afcd36eb35b235849627a7a4a8fb6065e463c13d5bf1a8e66baae05842bb418a';
const originalBytes = 7_666_331, originalPages = 40, pageNumber = 22;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fixturePath = path.join(__dirname, '../services/worker/tests/fixtures/pd-door-bound-F0151-p22.json');
const goldenPath = path.join(__dirname, '../output/matrix-t28-20261018/python-golden.json');
const fixtureBytes = fs.readFileSync(fixturePath), goldenBytes = fs.readFileSync(goldenPath);
assert.equal(sha(fixtureBytes), '7d281f00c070273df9a4bf437bd21dc8f10c1147435012a44adf46bd7209407a');
assert.equal(sha(goldenBytes), '2779a1e7e10498501b802600b78383d98668a3866dba8be7c0dc4edebe23f980');
const fixture = JSON.parse(fixtureBytes), golden = JSON.parse(goldenBytes);
assert.equal(fixture.source.sha256, originalSha);
assert.equal(fixture.sourceArtifact.inputSha256, originalSha);
assert.equal(fixture.sourceArtifact.sourceFileId, 'F0151');
assert.equal(fixture.sourceArtifact.pageCount, originalPages);
assert.deepEqual(fixture.sourceArtifact.pages.map(p => p.pageNumber), Array.from({ length: originalPages }, (_, i) => i + 1));
assert.equal(fixture.provenance.originalPdfPage, pageNumber);
assert.equal(fixture.provenance.fullOriginalPdfPageCount, originalPages);
assert.deepEqual(fixture.provenance.manifestGate, { split: 'TRAIN_PUBLIC', distributionStatus: 'INCLUDE', labelVisibility: 'PUBLIC_TRAIN' });
const clone = value => JSON.parse(JSON.stringify(value));
// New constraint hash policy: ASCII keys, code-order sorting (never localeCompare), safe integers only.
function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value) && !Object.is(value, -0), 'Hash numbers must be safe integers');
    return String(value);
  }
  if (typeof value === 'string') {
    for (const character of value) assert.ok(!/[\uD800-\uDFFF]/u.test(character), 'Unpaired surrogate in hash input');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  assert.ok(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  const keys = Object.keys(value).sort();
  for (const key of keys) assert.match(key, /^[\x20-\x7E]+$/u, 'Hash keys must be ASCII');
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const artifactHash = artifact => sha(canonical({ hashDomain: 'matrix-project-constraint-text-artifact-v1', textArtifact: artifact }));
function factHash(fact) {
  const body = clone(fact); delete body.id;
  return sha(canonical({ hashDomain: 'matrix-project-constraint-id-v1', fact: body }));
}
assert.equal(artifactHash(fixture.sourceArtifact), golden.constraints[0].textArtifactHash);
assert.equal(factHash(golden.constraints[0]), golden.constraints[0].id);
assert.deepEqual(golden.constraints[0].fragments.map(f => f.usedTextRange.end), [69, 73, 71, 27]);
assert.equal(golden.constraints[0].fragments.length, 4);
for (const [index, fragment] of golden.constraints[0].fragments.entries()) {
  const block = fixture.sourceArtifact.pages[pageNumber - 1].blocks[index];
  assert.equal(fragment.blockIndex, index); assert.equal(fragment.lineIndex, 0);
  assert.equal(fragment.rawText, block.text); assert.deepEqual(fragment.bboxMilliPoints, block.bboxMilliPoints);
  assert.equal(fragment.usedTextRange.start, 0);
}
const normalized = box => ({ x: box[0] / 595320, y: 1 - box[3] / 841920,
  width: (box[2] - box[0]) / 595320, height: (box[3] - box[1]) / 841920 });
function nearBox(actual, expected, label) {
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-6, `${label}: ${key}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const evidencePath = path.join(out, `${state.checkId}-project-constraints-browser.json`);
  if (fs.existsSync(evidencePath) || fs.readdirSync(out).some(name => name.startsWith(`${state.checkId}-`))) {
    throw Error('Use a new output directory for another acceptance attempt');
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-t28-public-qa-'));
  const pageErrors = [], consoleErrors = [], failedRequests = [], httpErrors = [], mutations = [];
  const authInitializations = [], frames = [], responsive = [], screenshots = [], searchChecks = [];
  let browser, page, currentWidth = null;
  try {
    browser = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
    context.setDefaultTimeout(30_000);
    await context.addCookies(Object.entries(state.cookies).map(([name, value]) => ({ name, value, domain: new URL(base).hostname, path: '/' })));
    const get = async endpoint => {
      const response = await context.request.get(`${origin}/api/${endpoint}`, { timeout: 30_000 });
      assert.equal(response.status(), 200, `GET ${endpoint}: ${response.status()}`); return response;
    };
    const run = await (await get(`checks/${state.checkId}`)).json();
    assert.equal(run.objectId, state.objectId); assert.equal(run.progress, 100);
    assert.ok(['PARTIAL', 'COMPLETED'].includes(run.status), 'Terminal new run required');
    assert.equal(run.mode, 'NORMAL');
    const machineBytes = await (await get(`checks/${state.checkId}/matrix-execution`)).body();
    const machine = JSON.parse(machineBytes), execution = machine.execution;
    assert.equal(machine.checkId, state.checkId);
    assert.ok(machine.projectConstraints, 'New release must expose separate top-level projectConstraints');
    assert.equal(Object.hasOwn(execution, 'projectConstraints'), false);
    assert.equal(Object.hasOwn(execution, 'constraints'), false);
    assert.match(execution.objectId, /^[a-f0-9-]{36}$/u, 'Execution identity must retain internal manifest UUID');
    assert.match(execution.inputManifestHash, /^[a-f0-9]{64}$/u);
    assert.equal(machine.projectConstraints.constraints.length, 1);
    const fact = machine.projectConstraints.constraints[0], sourceFileId = fact.sourceFileId;
    assert.ok(typeof sourceFileId === 'string' && /^[A-Za-z0-9_-]+$/.test(sourceFileId));
    if (state.sourceFileId !== undefined) assert.equal(sourceFileId, state.sourceFileId);
    const expectedTextArtifact = clone(fixture.sourceArtifact);
    // Sole permitted mutation of the full original artifact; no page/block/geometry/quality rewriting.
    expectedTextArtifact.sourceFileId = sourceFileId;
    const expected = clone(golden);
    expected.objectId = execution.objectId; expected.inputManifestHash = execution.inputManifestHash;
    expected.constraints[0].sourceFileId = sourceFileId;
    expected.constraints[0].textArtifactHash = artifactHash(expectedTextArtifact);
    expected.constraints[0].id = factHash(expected.constraints[0]);
    assert.deepEqual(machine.projectConstraints, expected, 'Actual whole constraint envelope must match independent golden remap');
    assert.equal(fact.entityKey, null); assert.equal(fact.applicabilityStatus, 'UNREVIEWED');
    assert.equal(fact.relation, 'GE'); assert.equal(fact.limitValue, '0.9'); assert.equal(fact.canonicalUnit, 'm');
    for (const observation of execution.observations) {
      assert.equal(Object.hasOwn(observation, 'relation'), false, 'Legacy exact fact cannot acquire bound relation');
      assert.equal(Object.hasOwn(observation, 'limitValue'), false, 'Legacy exact fact cannot acquire bound limit');
      assert.notEqual(observation.id, fact.id);
    }
    assert.equal(execution.observations.filter(o => o.attribute === 'DOOR_CLEAR_OPENING_WIDTH').length, 0,
      'Project minimum must not become exact opening width');
    assert.ok(execution.results.every(result => !result.qualified), 'Unapproved public input cannot qualify');
    assert.ok(machine.presentation.every(item => item.confidence.calibratedProbability === null));
    const coverage = execution.coverage;
    assert.equal(coverage.length, 132);
    const coverageCounts = { implementedParameters: coverage.filter(c => c.implementedAtomicRules > 0).length,
      atomicRules: coverage.reduce((sum, c) => sum + c.implementedAtomicRules, 0),
      unsupportedParameters: coverage.filter(c => c.executionStatus === 'UNSUPPORTED').length };
    assert.deepEqual(coverageCounts, { implementedParameters: 53, atomicRules: 61, unsupportedParameters: 79 });
    const metadata = execution.metadata.filter(item => item.sourceFileId === sourceFileId);
    assert.equal(metadata.length, 1); assert.equal(metadata[0].stage, 'PD');
    assert.equal(metadata[0].sectionCode, null); assert.equal(metadata[0].approvalStatus, 'UNKNOWN');
    assert.equal(metadata[0].revisionStatus, 'UNKNOWN');
    const filesBytes = await (await get(`objects/${state.objectId}/files`)).body();
    const files = JSON.parse(filesBytes).items;
    assert.equal(files.length, 1); assert.equal(files[0].id, sourceFileId);
    assert.equal(files[0].sha256, originalSha); assert.equal(files[0].pageCount, originalPages);
    const original = await (await get(`objects/${state.objectId}/files/${sourceFileId}/content`)).body();
    assert.equal(original.length, originalBytes); assert.equal(sha(original), originalSha);
    const pdfPath = path.join(temporary, 'F0151-original.pdf'); fs.writeFileSync(pdfPath, original, { mode: 0o600 });
    const info = execFileSync('pdfinfo', ['-f', '22', '-l', '22', '-box', pdfPath],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env, LC_ALL: 'C' } });
    assert.match(info, /^Pages:\s+40\s*$/m); assert.match(info, /^Page\s+22\s+rot:\s+0\s*$/m);
    const crop = /^Page\s+22\s+CropBox:\s*([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)\s*$/m.exec(info);
    assert.ok(crop, 'Original PDF22 CropBox required');
    const geometry = { width: Number(crop[3]) - Number(crop[1]), height: Number(crop[4]) - Number(crop[2]) };
    assert.ok(Math.abs(geometry.width - 595.32) < .02 && Math.abs(geometry.height - 841.92) < .02);
    const submissionResponse = await get(`checks/${state.checkId}/submission`), submissionBytes = await submissionResponse.body();
    assert.equal(sha(submissionBytes), machine.submission.contentHash);
    assert.equal(submissionResponse.headers()['x-content-sha256'], machine.submission.contentHash);
    const findingsBytes = await (await get(`checks/${state.checkId}/findings`)).body();
    const targetsBytes = await (await get(`checks/${state.checkId}/matrix-fact-targets`)).body();
    const targets = JSON.parse(targetsBytes);
    assert.ok(targets.items.every(item => item.target.observationId !== fact.id), 'Constraint must have no legacy fact binding target');
    // The decisions journal exists only for runs with review candidates. Snapshot the
    // successful pilot-results read in every run; never treat a 404 as a journal read.
    const pilotBytes = await (await get(`checks/${state.checkId}/pilot-results`)).body();
    const pilot = JSON.parse(pilotBytes);
    assert.equal(pilot.checkId, state.checkId);
    const hasReviewCandidates = Object.hasOwn(pilot, 'reviewCandidates');
    if (hasReviewCandidates) assert.ok(Number.isSafeInteger(pilot.reviewCandidates.candidateCount)
      && pilot.reviewCandidates.candidateCount >= 0);
    const reviewDecisionsApplicable = hasReviewCandidates && pilot.reviewCandidates.candidateCount > 0;
    const reviewsBytes = reviewDecisionsApplicable
      ? await (await get(`checks/${state.checkId}/review-candidate-decisions`)).body() : null;
    async function sourceReviewSnapshot() {
      const response = await context.request.get(`${origin}/api/objects/${state.objectId}/files/${sourceFileId}/source-review`, { timeout: 30_000 });
      assert.ok([200, 404].includes(response.status()));
      const body = await response.body();
      if (response.status() === 200) {
        const prior = JSON.parse(body);
        assert.ok(!prior || !prior.matrixScope || !prior.matrixScope.bindings?.some(binding => binding.target?.observationId === fact.id));
      }
      return { status: response.status(), sha256: sha(body) };
    }
    const sourceReviewBefore = await sourceReviewSnapshot();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) {
        mutations.push({ method: request.method(), path: url.pathname, reason: 'NON_STAND_REQUEST' }); await route.abort('blockedbyclient'); return;
      }
      if (request.method() === 'POST' && url.pathname === '/api/auth/open-workspace' && currentWidth !== null
        && !authInitializations.some(item => item.width === currentWidth)) {
        authInitializations.push({ width: currentWidth, method: 'POST', path: url.pathname }); await route.continue(); return;
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        mutations.push({ method: request.method(), path: url.pathname }); await route.abort('blockedbyclient'); return;
      }
      await route.continue();
    });
    page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    for (const width of [1440, 768, 375]) {
      currentWidth = width; await page.setViewportSize({ width, height: 1050 });
      const navigation = await page.goto(base, { waitUntil: 'networkidle' });
      assert.equal(navigation.status(), 200);
      await page.getByRole('button', { name: 'Открыть кабинет', exact: true }).first().click();
      const objectCard = page.locator('.object-card').filter({ hasText: state.objectId });
      assert.equal(await objectCard.count(), 1);
      await objectCard.getByRole('button', { name: 'Открыть проверку' }).click();
      const panel = page.getByRole('region', { name: 'Общий машинный анализ', exact: true }); await panel.waitFor();
      const section = panel.getByRole('region', { name: 'Проектные ограничения из исходников', exact: true });
      await section.waitFor();
      const search = panel.getByLabel('Поиск извлечённых значений');
      assert.match(await panel.innerText(), /Без калибровки — кандидат, уверенность не измерена/);
      for (const query of ['0.9', 'порогов', 'несуществующее_условие_T28', fact.attribute]) {
        await search.fill(query);
        const count = query === 'несуществующее_условие_T28' ? 0 : 1;
        await section.getByText(`Проектных ограничений: ${count} / 1`, { exact: true }).waitFor();
        assert.equal(await section.locator('article').count(), count);
        searchChecks.push({ width, query, matches: count });
      }
      const card = section.locator('article');
      assert.equal(await card.count(), 1);
      const cardText = await card.innerText();
      assert.match(cardText, /не менее 0\.9 м/); assert.match(cardText, /Применимость|Проём не сопоставлен/);
      assert.match(cardText, /Кандидат проектного ограничения/); assert.equal(/\d(?:[.,]\d+)?\s*%/u.test(cardText), false);
      assert.equal(await card.getByRole('button').count(), 4);
      const rawParagraphs = card.locator('div > p');
      assert.equal(await rawParagraphs.count(), 4);
      for (let index = 0; index < 4; index++) {
        const fragment = fact.fragments[index], paragraph = rawParagraphs.nth(index);
        assert.equal(await paragraph.textContent(), fragment.rawText, 'Complete raw line, including unused tail, retained');
        const used = Array.from(fragment.rawText).slice(fragment.usedTextRange.start, fragment.usedTextRange.end).join('');
        assert.equal(await paragraph.locator('mark').textContent(), used);
      }
      const tail = Array.from(fact.fragments[3].rawText).slice(27).join('');
      assert.ok(tail.includes('порогов')); assert.ok((await rawParagraphs.nth(3).textContent()).endsWith(tail));
      assert.equal(await panel.getByRole('region', { name: 'Привязка конкретного машинного факта', exact: true }).count(), 0);
      for (let index = 0; index < 4; index++) {
        const fragment = fact.fragments[index], label = `width-${width}-fragment-${index + 1}`;
        await card.getByRole('button', { name: `Открыть условие · PDF 22 · фрагмент ${index + 1}`, exact: true }).click();
        await section.getByText(`Выбрано проектное условие · PDF 22 · фрагмент ${index + 1}. Выделена исходная строка; цвет текста в карточке показывает использованную часть предложения.`, { exact: true }).waitFor();
        const viewer = section.locator('.inspector-evidence-pane');
        assert.equal(await viewer.count(), 1);
        await viewer.getByRole('img', { name: 'PD, исходная страница 22', exact: true }).waitFor();
        await page.waitForFunction(() => {
          const element = document.querySelector('[aria-label="Проектные ограничения из исходников"] .inspector-evidence-pane');
          const image = element?.querySelector('img'), box = element?.querySelector('.inspector-evidence-box')?.getBoundingClientRect();
          const viewport = element?.querySelector('.inspector-sheet-viewport')?.getBoundingClientRect();
          return image?.complete && image.naturalWidth > 0 && box && viewport
            && (box.left + box.right) / 2 >= viewport.left && (box.left + box.right) / 2 <= viewport.right
            && (box.top + box.bottom) / 2 >= viewport.top && (box.top + box.bottom) / 2 <= viewport.bottom;
        });
        const frame = await viewer.evaluate(element => {
          const box = element.querySelector('.inspector-evidence-box'), image = element.querySelector('img');
          const position = box.getBoundingClientRect(), viewport = element.querySelector('.inspector-sheet-viewport').getBoundingClientRect();
          return { x: parseFloat(box.style.left) / 100, y: parseFloat(box.style.top) / 100,
            width: parseFloat(box.style.width) / 100, height: parseFloat(box.style.height) / 100,
            imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, highlightText: box.textContent,
            pixelCenter: { x: (position.left + position.right) / 2, y: (position.top + position.bottom) / 2 },
            viewport: { x: viewport.left, y: viewport.top, width: viewport.width, height: viewport.height } };
        });
        nearBox(frame, normalized(fragment.bboxMilliPoints), label);
        assert.ok(Math.abs(frame.imageWidth / frame.imageHeight - geometry.width / geometry.height) < .003);
        assert.equal(frame.highlightText.trim(), `PD: ${Array.from(fragment.rawText).slice(0, fragment.usedTextRange.end).join('')}`.trim());
        assert.equal(await viewer.getByLabel('Страница PDF').inputValue(), '22');
        assert.equal(await viewer.getByLabel('Показать рамку').isChecked(), true);
        assert.equal(await viewer.getByRole('link', { name: 'Открыть оригинальный PDF', exact: true }).getAttribute('href'),
          `/api/objects/${state.objectId}/files/${sourceFileId}/content#page=22`);
        assert.equal(await section.getByRole('button', { name: /привяз|сохран|соглас|подтверд|решени|проверить применимость/iu }).count(), 0);
        assert.equal(await panel.getByRole('region', { name: 'Привязка конкретного машинного факта', exact: true }).count(), 0);
        frames.push({ label, width, fragmentIndex: index, blockIndex: fragment.blockIndex, lineIndex: fragment.lineIndex,
          pageNumber, sourceSha256: originalSha, bboxMilliPoints: fragment.bboxMilliPoints, usedTextRange: fragment.usedTextRange, ...frame });
        const filename = `${state.checkId}-${label}.png`;
        await viewer.screenshot({ path: path.join(out, filename) }); screenshots.push(filename);
      }
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= width + 2, `Horizontal document overflow at ${width}: ${dimensions.scroll}`);
      const sectionOverflow = await section.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
      assert.ok(sectionOverflow.scroll <= sectionOverflow.client + 2, `Constraint section overflow at ${width}`);
      responsive.push({ ...dimensions, section: sectionOverflow });
      const filename = `${state.checkId}-page-${width}.png`;
      await page.screenshot({ path: path.join(out, filename), fullPage: true }); screenshots.push(filename);
      await page.waitForLoadState('networkidle');
      assert.equal(authInitializations.filter(item => item.width === width).length, 1);
      assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(failedRequests, []);
      assert.deepEqual(httpErrors, []); assert.deepEqual(mutations, []);
    }
    currentWidth = null;
    assert.equal(authInitializations.length, 3); assert.equal(frames.length, 12);
    assert.deepEqual(await (await get(`checks/${state.checkId}/matrix-execution`)).body(), machineBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/submission`)).body(), submissionBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/findings`)).body(), findingsBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/matrix-fact-targets`)).body(), targetsBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/pilot-results`)).body(), pilotBytes);
    if (reviewDecisionsApplicable) {
      assert.deepEqual(await (await get(`checks/${state.checkId}/review-candidate-decisions`)).body(), reviewsBytes);
    }
    assert.deepEqual(await (await get(`objects/${state.objectId}/files`)).body(), filesBytes);
    assert.deepEqual(await sourceReviewSnapshot(), sourceReviewBefore);
    const evidence = { status: 'PASS', harnessSha256: sha(fs.readFileSync(__filename)),
      fixtureSha256: sha(fixtureBytes), goldenSha256: sha(goldenBytes), responsiveOpenMode: 'fresh-navigation-per-width',
      objectId: state.objectId, manifestObjectId: execution.objectId, checkId: state.checkId, sourceFileId,
      originalSha256: originalSha, originalBytes, originalPages, pageNumber, originalPdfGeometry: geometry, originalPdfRotation: 0,
      expectedTextArtifactHash: fact.textArtifactHash, expectedConstraintId: fact.id, expectedProjectConstraints: expected,
      artifactRemapPolicy: 'sourceArtifact.sourceFileId only; all40 pages and all other fields unchanged',
      sourceSection: null, sourceApproval: 'UNKNOWN', sourceRevision: 'UNKNOWN', entityKey: null, applicabilityStatus: 'UNREVIEWED',
      calibratedProbability: null, legacyBoundObservations: 0, legacyConstraintBindingTargets: 0, coverageCounts,
      frames, responsive, screenshots, searchChecks, authInitializations, domainMutations: mutations,
      pageErrors, consoleErrors, failedRequests, httpErrors,
      machineContentHash: machine.contentHash, machineResponseSha256: sha(machineBytes), submissionHash: sha(submissionBytes),
      findingsResponseSha256: sha(findingsBytes), factTargetsResponseSha256: sha(targetsBytes),
      pilotResultsResponseSha256: sha(pilotBytes), reviewCandidatesPresent: hasReviewCandidates,
      reviewDecisionsApplicable, reviewDecisionsResponseSha256: reviewsBytes === null ? null : sha(reviewsBytes),
      filesResponseSha256: sha(filesBytes), sourceReview: sourceReviewBefore,
      immutableAfterBrowser: true, reviewWritten: false };
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'PASS', checkId: state.checkId, constraints: 1, relation: 'GE', limitValue: '0.9',
      pageNumber, fragments: 4, widths: [1440, 768, 375], frames: frames.length, screenshots: screenshots.length,
      authInitializations: authInitializations.length, domainMutations: 0, immutableAfterBrowser: true }));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(out, `${state.checkId}-failure.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, `${state.checkId}-failure.txt`), await page.locator('body').innerText().catch(() => 'Page unavailable'));
    }
    fs.writeFileSync(path.join(out, `${state.checkId}-failure.json`), JSON.stringify({ status: 'FAIL', error: String(error),
      frames, responsive, authInitializations, mutations, pageErrors, consoleErrors, failedRequests, httpErrors }, null, 2) + '\n');
    throw error;
  } finally {
    try { if (browser) await browser.close(); } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
