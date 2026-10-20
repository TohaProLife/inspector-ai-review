/** Read-only T19 V8 acceptance against terminal public F0126 FULL run.
 * Usage: node scripts/smoke-matrix-visual-crop.cjs private-state.json [public-oracle.json]
 * One workspace authentication initialization is allowed; reviews/runs/uploads are forbidden.
 */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [statePath, oraclePath = '/tmp/matrix-t19-v8-real-replay.json'] = process.argv.slice(2);
const base = process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082';
if (!statePath || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw Error('Private input and loopback stand required');
if (fs.statSync(statePath).mode & 0o077) throw Error('Auth state must have mode 0600');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const out = process.env.FEEDBACK_QA_OUTPUT || 'output/matrix-t19-20261017/browser';
const originalSha = 'b4846376535dd97aa24a8e384e0cb71f40792084fc61981dad587b15bbf63088';
const oracleSha = '60376a8ada499558653404726aaa27a18dae5a8dffbe2fa69f9a7852123d42d0';
const profileSha = 'b6c559590a69e0e4ff2018fcfe7f9389c98ab0080bf32373ba24de6a9a441476';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const oracleBytes = fs.readFileSync(oraclePath);
assert.equal(sha(oracleBytes), oracleSha, 'Frozen public raster oracle');
const oracle = JSON.parse(oracleBytes);
assert.equal(oracle.sourceSha256, originalSha); assert.equal(oracle.rows.length, 33);
assert.equal(oracle.modelCalled, false, 'Raster oracle must be independent of model responses');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const evidencePath = path.join(out, `${state.checkId}-visual-crop-browser.json`);
  if (fs.existsSync(evidencePath)) throw Error('Use a new output directory for another acceptance attempt');
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-t19-qa-'));
  const errors = [], failedRequests = [], mutations = [], authInitializations = [], frames = [], responsive = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    await context.addCookies(Object.entries(state.cookies).map(([name, value]) => ({ name, value,
      domain: new URL(base).hostname, path: '/' })));
    const get = async endpoint => {
      const response = await context.request.get(`${base}/api/${endpoint}`);
      assert.equal(response.status(), 200, `GET ${endpoint}: ${response.status()}`); return response;
    };
    const read = async endpoint => (await get(endpoint)).json();
    const run = await read(`checks/${state.checkId}`);
    assert.equal(run.objectId, state.objectId, 'API object identity for this check');
    assert.equal(run.progress, 100); assert.ok(['PARTIAL', 'COMPLETED'].includes(run.status), 'Terminal run required');
    const visualResponse = await get(`checks/${state.checkId}/visual-proposals`);
    const visualBytes = await visualResponse.body(), visual = JSON.parse(visualBytes);
    assert.match(visual.objectId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, 'Immutable artifact object UUID');
    assert.equal(visual.schemaVersion, 'visual-proposal-analysis-v8');
    assert.equal(visual.status, 'PROPOSAL_ONLY_UNVERIFIED');
    assert.equal(visual.profile.schemaVersion, 'visual-proposal-profile-v8');
    assert.equal(visual.profile.analysisMode, 'FULL');
    assert.equal(visual.profile.coordinateSystem, 'NORMALIZED_TOP_LEFT');
    assert.equal(visual.profile.vlmCropMethodId, 'normalized-display-square-v2');
    assert.equal(sha(canonical(visual.profile)), profileSha, 'Frozen V8 FULL profile');
    assert.equal(visual.sources.length, 1);
    const source = visual.sources[0];
    assert.equal(source.sourceSha256, originalSha); assert.equal(source.pageCount, 23);
    assert.equal(source.scannedPageCount, 23); assert.equal(source.status, 'SCANNED');
    assert.equal(source.proposalLimitReached, false); assert.equal(source.unretainedProposalCount, 0);
    assert.equal(source.proposals.length, 33);
    const vlm = source.vlm;
    assert.equal(vlm.schemaVersion, 'visual-vlm-observations-v1');
    assert.equal(vlm.methodId, 'all-saved-proposals-v1'); assert.equal(vlm.eligibleProposalCount, 33);
    assert.deepEqual(vlm.selectedOrdinals, Array.from({ length: 33 }, (_, ordinal) => ordinal));
    assert.equal(vlm.omittedProposalCount, 0); assert.equal(vlm.observations.length, 33);
    const cropProof = vlm.observations.map((observation, ordinal) => {
      const proposal = source.proposals[ordinal], reference = oracle.rows[ordinal];
      assert.equal(proposal.status, 'GEOMETRIC_PROPOSAL_NOT_CLASSIFIED');
      assert.equal(observation.proposalOrdinal, ordinal); assert.equal(observation.sourceSha256, originalSha);
      assert.equal(observation.pageNumber, proposal.pageNumber);
      assert.deepEqual(observation.bboxNormalized, proposal.bboxNormalized);
      assert.equal(reference.ordinal, ordinal); assert.equal(reference.pageNumber, proposal.pageNumber);
      assert.deepEqual(reference.bboxNormalized, proposal.bboxNormalized);
      assert.notEqual(observation.reasonCode, 'CROP_RENDER_ERROR');
      assert.equal(observation.cropSha256, reference.pngSha256, `V8 crop ${ordinal} independent raster oracle`);
      assert.ok(['RADIATOR_HINT', 'OTHER_HINT', 'ABSTAIN'].includes(observation.decision));
      assert.equal('calibratedProbability' in observation, false, 'No invented probability on visual hint');
      return { ordinal, pageNumber: observation.pageNumber, rotation: reference.rotation,
        cropSha256: observation.cropSha256, reasonCode: observation.reasonCode,
        decision: observation.decision, responseSha256: observation.responseSha256 };
    });
    const matrixResponse = await get(`checks/${state.checkId}/matrix-execution`);
    const matrixBytes = await matrixResponse.body(), matrix = JSON.parse(matrixBytes);
    assert.equal(visual.objectId, matrix.execution.objectId, 'Immutable visual and machine artifact object identity');
    assert.ok(cropProof.some(item => item.responseSha256 !== null), 'Live VLM response required for actual-model acceptance');
    assert.ok(matrix.execution.results.every(result => !result.qualified), 'Public unapproved sources remain unqualified');
    assert.ok(matrix.presentation.every(row => row.confidence.calibratedProbability === null));
    const sidewalk = matrix.execution.observations.filter(fact => fact.attribute === 'SIDEWALK_TILE_AREA');
    assert.equal(sidewalk.length, 1); assert.equal(sidewalk[0].value, '112'); assert.equal(sidewalk[0].unit, 'm2');
    assert.equal(sidewalk[0].pageNumber, 20); assert.equal(sidewalk[0].sourceSha256, originalSha);
    assert.equal(sidewalk[0].entityKey, null); assert.ok(sidewalk[0].sourceFlags.includes('TABLE_CONTEXT_UNVERIFIED'));
    const metadata = matrix.execution.metadata.find(item => item.sourceFileId === source.sourceFileId);
    assert.equal(metadata.approvalStatus, 'UNKNOWN'); assert.equal(metadata.revisionStatus, 'UNKNOWN');
    const files = (await read(`objects/${state.objectId}/files`)).items;
    const file = files.find(item => item.id === source.sourceFileId);
    assert.equal(file.sha256, originalSha); assert.equal(file.pageCount, 23);
    const originalBytes = await (await get(`objects/${state.objectId}/files/${source.sourceFileId}/content`)).body();
    assert.equal(originalBytes.length, 7_676_220); assert.equal(sha(originalBytes), originalSha);
    const pdfPath = path.join(temporary, 'original.pdf'); fs.writeFileSync(pdfPath, originalBytes);
    const pdfInfo = execFileSync('pdfinfo', ['-f', '16', '-l', '23', '-box', pdfPath],
      { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    assert.match(pdfInfo, /^Pages:\s+23\s*$/m);
    function pageGeometry(pageNumber) {
      const crop = new RegExp(`^Page\\s+${pageNumber}\\s+CropBox:\\s*([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s+([-+\\d.]+)\\s*$`, 'm').exec(pdfInfo);
      const rotation = Number(new RegExp(`^Page\\s+${pageNumber}\\s+rot:\\s*(0|90|180|270)\\s*$`, 'm').exec(pdfInfo)?.[1]);
      assert.ok(crop, `PDF ${pageNumber} visible CropBox`); assert.ok(Number.isFinite(rotation));
      const [, x0, y0, x1, y1] = crop.map(Number); let width = x1 - x0, height = y1 - y0;
      if ([90, 270].includes(rotation)) [width, height] = [height, width];
      return { width, height, rotation };
    }
    const submissionResponse = await get(`checks/${state.checkId}/submission`), frozenBytes = await submissionResponse.body();
    assert.equal(sha(frozenBytes), matrix.submission.contentHash);
    assert.equal(submissionResponse.headers()['x-content-sha256'], matrix.submission.contentHash);
    const findingsBytes = await (await get(`checks/${state.checkId}/findings`)).body();
    const visualReviewsBytes = await (await get(`checks/${state.checkId}/visual-proposals/reviews`)).body();
    async function sourceReviewSnapshot() {
      const response = await context.request.get(`${base}/api/objects/${state.objectId}/files/${source.sourceFileId}/source-review`);
      assert.ok([200, 404].includes(response.status()));
      return { status: response.status(), sha256: sha(await response.body()) };
    }
    const reviewBefore = await sourceReviewSnapshot();
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
    page.on('pageerror', error => errors.push(String(error)));
    page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    await page.goto(base);
    await page.getByRole('button', { name: 'Открыть кабинет', exact: true }).first().click();
    await page.locator('.object-card').filter({ hasText: state.objectId }).getByRole('button', { name: 'Открыть проверку' }).click();
    await page.getByRole('region', { name: 'Общий машинный анализ', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Исходные документы', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Визуальные предложения', exact: true }); await panel.waitFor();
    await panel.locator('.visual-proposal-select').last().waitFor();
    await page.waitForFunction(() => !document.querySelector('.source-review-screen [role="status"]')
      && [...document.querySelectorAll('.source-review-screen img')].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await panel.locator('.visual-proposal-select').count(), 33);
    assert.match(await panel.innerText(), /Класс элемента и соответствие чертежу здесь не подтверждены/);
    assert.match(await panel.innerText(), /Ответы — неподтверждённые подсказки/);
    const fileButton = page.getByRole('region', { name: 'Исходные файлы', exact: true }).getByRole('button').filter({ hasText: file.name });
    assert.equal(await fileButton.getAttribute('aria-current'), 'true');
    assert.equal(await page.getByRole('link', { name: 'Скачать оригинал', exact: true }).getAttribute('href'),
      `/api/objects/${state.objectId}/files/${source.sourceFileId}/content`);
    async function showAndVerify(ordinal, label) {
      const proposal = source.proposals[ordinal], geometry = pageGeometry(proposal.pageNumber);
      const selector = panel.locator('.visual-proposal-select').nth(ordinal);
      if (await selector.getAttribute('aria-pressed') !== 'true') await selector.click();
      const preview = panel.locator('.visual-proposal-preview');
      await preview.getByRole('heading', { name: `Лист ${proposal.pageNumber}, кандидат ${ordinal + 1}`, exact: true }).waitFor();
      await preview.locator('.visual-proposal-bbox').waitFor();
      await page.waitForFunction(() => {
        const images = [...document.querySelectorAll('.visual-proposal-preview img')];
        return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0)
          && document.querySelectorAll('.visual-proposal-preview [role="status"]').length === 0;
      });
      const fullImage = preview.getByRole('region', { name: 'Исходный лист целиком', exact: true }).getByRole('img');
      const cropImage = preview.getByRole('region', { name: 'Увеличенный фрагмент исходного листа', exact: true }).getByRole('img');
      const expectedPrefix = `/api/objects/${state.objectId}/files/${source.sourceFileId}/pages/${proposal.pageNumber}/preview`;
      assert.equal(await fullImage.getAttribute('src'), expectedPrefix);
      assert.equal(await cropImage.getAttribute('src'), `${expectedPrefix}?crop=${proposal.bboxNormalized.join(',')}`);
      const frame = await preview.evaluate(element => {
        const box = element.querySelector('.visual-proposal-bbox'), image = element.querySelector('img');
        const crop = element.querySelector('.visual-proposal-crop-wrap img');
        return { x: parseFloat(box.style.left) / 100, y: parseFloat(box.style.top) / 100,
          width: parseFloat(box.style.width) / 100, height: parseFloat(box.style.height) / 100,
          imageWidth: image.naturalWidth, imageHeight: image.naturalHeight,
          cropWidth: crop.naturalWidth, cropHeight: crop.naturalHeight };
      });
      const expected = { x: proposal.bboxNormalized[0], y: proposal.bboxNormalized[1],
        width: proposal.bboxNormalized[2] - proposal.bboxNormalized[0], height: proposal.bboxNormalized[3] - proposal.bboxNormalized[1] };
      // CSSOM serializes percentage values to about six significant digits.
      for (const field of Object.keys(expected)) assert.ok(Math.abs(frame[field] - expected[field]) < 1e-6, `${label}: ${field}`);
      assert.ok(Math.abs(frame.imageWidth / frame.imageHeight - geometry.width / geometry.height) < 0.003, `${label}: displayed PDF rotation`);
      assert.ok(frame.cropWidth > 50 && frame.cropHeight > 50 && frame.cropWidth <= 1600 && frame.cropHeight <= 1600);
      assert.match(await preview.innerText(), /ответ не меняет результат проверки и не создаёт замечание/);
      assert.equal(await preview.getByRole('alert').count(), 0);
      frames.push({ label, ordinal, pageNumber: proposal.pageNumber, rotation: geometry.rotation, ...frame,
        originalUrl: expectedPrefix, sourceSha256: originalSha });
      return preview;
    }
    const ordinals = [16, 21, 22, 23].map(pageNumber => source.proposals.findIndex(item => item.pageNumber === pageNumber));
    assert.ok(ordinals.every(ordinal => ordinal >= 0));
    for (const ordinal of ordinals) {
      const preview = await showAndVerify(ordinal, `page-${source.proposals[ordinal].pageNumber}`);
      await preview.screenshot({ path: path.join(out, `${state.checkId}-page-${source.proposals[ordinal].pageNumber}.png`) });
    }
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1050 });
      const preview = await showAndVerify(ordinals[3], `rotated-page-23-width-${width}`);
      await preview.scrollIntoViewIfNeeded();
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= width + 2, JSON.stringify(dimensions)); responsive.push(dimensions);
      await preview.screenshot({ path: path.join(out, `${state.checkId}-viewer-${width}.png`) });
      await page.screenshot({ path: path.join(out, `${state.checkId}-${width}.png`), fullPage: true });
    }
    assert.deepEqual(mutations, []); assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
    assert.deepEqual(await (await get(`checks/${state.checkId}/matrix-execution`)).body(), matrixBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/submission`)).body(), frozenBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/visual-proposals`)).body(), visualBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/visual-proposals/reviews`)).body(), visualReviewsBytes);
    assert.deepEqual(await (await get(`checks/${state.checkId}/findings`)).body(), findingsBytes);
    assert.deepEqual(await sourceReviewSnapshot(), reviewBefore);
    const evidence = { status: 'PASS', objectId: state.objectId, checkId: state.checkId, sourceFileId: source.sourceFileId,
      sourceSha256: originalSha, profileHash: profileSha, visualContentHash: visual.contentHash,
      schemaVersion: visual.schemaVersion, cropMethodId: visual.profile.vlmCropMethodId,
      analysisMode: 'FULL', pages: 23, scannedPages: 23, savedProposals: 33, selected: 33, observations: 33,
      modelResponses: cropProof.filter(item => item.responseSha256 !== null).length, cropRenderErrors: 0,
      independentRasterOracleSha256: oracleSha, independentRasterMatches: 33, cropProof,
      qualified: 0, calibratedProbability: null, sourceApproval: 'UNKNOWN', sourceRevision: 'UNKNOWN',
      preservedSidewalkFact: { value: '112', unit: 'm2', pageNumber: 20 },
      machineHash: matrix.contentHash, machineResponseSha256: sha(matrixBytes), submissionHash: sha(frozenBytes),
      sourceReview: reviewBefore, visualReviewResponseSha256: sha(visualReviewsBytes), findingsResponseSha256: sha(findingsBytes),
      immutableAfterBrowser: true, reviewWritten: false, frames, responsive, authInitializations,
      mutations, pageErrors: errors, failedRequests, screenshots: 10 };
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'PASS', checkId: state.checkId, pages: 23, selected: 33,
      observations: 33, cropRenderErrors: 0, independentRasterMatches: 33, modelResponses: evidence.modelResponses,
      qualified: 0, screenshots: 10, reviewWritten: false }));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(out, `${state.checkId}-failure.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(out, `${state.checkId}-failure.txt`), await page.locator('body').innerText());
    }
    fs.writeFileSync(path.join(out, `${state.checkId}-failure.json`), JSON.stringify({ status: 'FAIL', error: String(error),
      frames, responsive, authInitializations, mutations, pageErrors: errors, failedRequests }, null, 2) + '\n');
    throw error;
  } finally { await browser.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
