#!/usr/bin/env node
/** Synthetic native V4 gaps + authored imported OCR response. No inference claim. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { seedNativeCapacityFixture } from './smoke-native-capacity-app.mjs';
const root = path.resolve(import.meta.dirname, '..');
const sha = value => createHash('sha256').update(value).digest('hex');
export const sourceOcrManualExpectation = Object.freeze({
  pages: [2, 3], textCandidates: ['107,687 кВт (0,926 Гкал/час)', '<script>window.OCR_XSS=1</script>'],
  nonemptyLines: 2, unresolvedPages: [3], p: null, factEligible: false, coverageDelta: 0,
  providerExecutionVerified: false, renderDerivationVerified: false,
  boundary: 'Authored OCR response fixture; image-only PDF2 and border-only PDF3. No provider execution or engineering qualification.',
});
export async function seedSourceOcrFixture(adminUrl, options = {}) {
  const fixture = await seedNativeCapacityFixture(adminUrl, { ...options, scenario: 'OCR' });
  try {
    const render = spawnSync(process.env.PYTHON_BIN ?? path.join(root, 'services/worker/.venv/bin/python'), ['-c',
      'import json,sys,fitz,hashlib\nx=json.load(sys.stdin);d=fitz.open(x["path"]);json.dump([{ "pageNumber":n,"rasterWidth":d[n-1].rect.width.__int__(),"rasterHeight":d[n-1].rect.height.__int__(),"renderSha256":hashlib.sha256(d[n-1].get_pixmap().tobytes("png")).hexdigest()} for n in [2,3]],sys.stdout)'],
      { input: JSON.stringify({ path: path.join(fixture.directory, 'PD.pdf') }), encoding: 'utf8', timeout: 30000 });
    if (render.status !== 0) throw new Error(render.stderr);
    const rasters = JSON.parse(render.stdout);
    const bundle = { schemaVersion: 'source-ocr-import-bundle-v1', sourceSha256: fixture.files[0].sha256,
      profileId: 'ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1', pages: rasters.map(raster => ({ ...raster,
        pdfWidthMilliPoints: 595000, pdfHeightMilliPoints: 842000,
        rawResponseJson: JSON.stringify({ schemaVersion: 'document-ai-ocr-response-v1', profileId: 'ocr-paddle-3.7.0-ru-en-mobile-no-tables-v1',
          script: 'eslav', results: [{ width: raster.rasterWidth, height: raster.rasterHeight, overall_ocr_res: {
            rec_texts: raster.pageNumber === 2 ? ['', ...sourceOcrManualExpectation.textCandidates] : [''],
            rec_scores: raster.pageNumber === 2 ? [0, 0.91, 0.88] : [0],
            rec_boxes: raster.pageNumber === 2 ? [[30, 30, 40, 40], [70, 80, 430, 110], [70, 120, 470, 145]] : [[30, 30, 40, 40]],
          } }] }),
      })) };
    return { ...fixture, get results() { return fixture.results; }, bundle, manualExpectation: sourceOcrManualExpectation, bundleSha256: sha(JSON.stringify(bundle)) };
  } catch (error) { await fixture.close(); throw error; }
}

const browserBoundary = [
  'Fresh authored three-page Cyrillic PDF; native V4 producer identifies page2 image-only and page3 border-only gaps.',
  'OCR responses are hand-authored synthetic JSON. No OCR provider execution, raster derivation, calibrated probability or engineering accuracy claim.',
  'Production App/CSS, authenticated Fastify routes, original SHA-verified PDF preview and disposable PostgreSQL; local fixture identity/download transport only.',
  'Only auth/open, separate OCR import and human transcription review writes; sealed native parent, engineering findings and machine coverage must remain unchanged.',
];

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    process.stdout.write('node --import tsx scripts/smoke-source-ocr-app.mjs --admin-url-file SECRET_0600_FILE --output NEW_OUTPUT_DIR\nLocal synthetic production-App acceptance; loopback28194; owned UUID PostgreSQL database is removed.\n');
    return;
  }
  assert.equal(argv.length % 2, 0, 'Use key/value arguments');
  const args = Object.fromEntries(argv.reduce((rows, value, index) => index % 2 ? rows : [...rows, [value, argv[index + 1]]], []));
  assert(args['--admin-url-file'] && args['--output'], 'Provide --admin-url-file SECRET --output NEW_DIR');
  const output = path.resolve(args['--output']); await mkdir(output, { recursive: false });
  const startedAt = new Date().toISOString(), started = Date.now();
  const checks = [], requests = [], screenshots = [], layouts = [], browserErrors = [], consoleMessages = [], resourceErrors = [];
  let fixture, vite, browser, page, initialPins, baseline, record, review;
  const pass = name => { checks.push(name); process.stdout.write(`PASS ${name}\n`); };
  const pinFiles = ['scripts/smoke-source-ocr-app.mjs', 'scripts/smoke-native-capacity-app.mjs',
    'apps/api/src/app.ts', 'apps/api/src/api-contract.ts', 'apps/api/src/postgres-repository.ts',
    'apps/api/src/source-ocr-import.ts', 'apps/api/src/postgres-source-ocr-import.ts', 'apps/api/src/source-ocr-import-routes.ts',
    'apps/api/src/source-ocr-import-api-contract.ts', 'apps/api/src/postgres-native-source-comparison-scope.ts',
    'apps/api/src/postgres-document-text-v4-full-source.ts', 'apps/api/src/pdf-preview.ts',
    'packages/contracts/src/source-ocr-import.ts', 'packages/contracts/src/source-ocr-import-record.ts',
    'migrations/051_source_ocr_imports.sql', 'apps/web/src/App.tsx', 'apps/web/src/api.ts',
    'apps/web/src/SourceOcrImportWorkspace.tsx', 'apps/web/src/source-ocr-unit-quality.ts', 'apps/web/src/SourceAuditV4FullWorkspace.tsx', 'apps/web/src/SourceReviewScreen.tsx',
    'apps/web/src/InspectorEvidenceViewer.tsx', 'apps/web/src/design-system/SourceImage.tsx', 'apps/web/src/source-preview-loader.ts',
    'apps/web/src/styles.css', 'apps/web/src/themes.css', 'apps/web/src/workspace.css',
    'services/worker/inspector_worker/document_text_v4.py', 'services/worker/inspector_worker/durable_text_v4_full.py'];
  const pins = async () => Promise.all(pinFiles.map(async file => ({ path: file, sha256: sha(await readFile(path.join(root, file))) })));
  const screenshot = async (name, locator) => {
    const file = `${name}.png`;
    if (locator) await locator.screenshot({ path: path.join(output, file) });
    else await page.screenshot({ path: path.join(output, file), fullPage: false });
    screenshots.push(file);
  };
  async function domain() {
    return { rows: (await fixture.db.query(`SELECT
      (SELECT row_to_json(run) FROM analysis_runs run WHERE run.api_id=$1) AS sealed_run,
      (SELECT count(*)::int FROM rule_results) AS rules,
      (SELECT count(*)::int FROM source_review_decisions) AS source_decisions,
      (SELECT count(*)::int FROM inspection_protocol_versions) AS protocols,
      (SELECT string_agg(content_hash,',' ORDER BY id) FROM analysis_text_artifacts) AS native_artifacts,
      (SELECT string_agg(content_hash,',' ORDER BY release_id) FROM analysis_releases) AS releases,
      (SELECT count(*)::int FROM analysis_jobs) AS jobs`, [fixture.checkId])).rows,
      coverage: await fixture.repo.getCoverage(fixture.checkId, fixture.actor) };
  }
  try {
    initialPins = await pins(); await writeFile(path.join(output, 'source-pins-start.json'), JSON.stringify(initialPins, null, 2));
    fixture = await seedSourceOcrFixture((await readFile(args['--admin-url-file'], 'utf8')).trim());
    assert.deepEqual(fixture.results.sources[0].artifact.pages.map(value => value.quality.disposition),
      ['TEXT_LAYER_CANDIDATE', 'OCR_REQUIRED', 'OCR_REQUIRED']);
    baseline = await domain();
    await writeFile(path.join(output, 'manual-expectation.json'), JSON.stringify(sourceOcrManualExpectation, null, 2));
    await writeFile(path.join(output, 'input-bundle.json'), JSON.stringify(fixture.bundle, null, 2));
    await writeFile(path.join(output, 'fixture.json'), JSON.stringify({ objectId: fixture.objectId, checkId: fixture.checkId,
      files: fixture.files, native: fixture.results.sources.map(value => ({ sourceFileId: value.sourceFileId, artifact: value.artifact })),
      bundleSha256: fixture.bundleSha256, boundary: browserBoundary }, null, 2));
    await writeFile(path.join(output, 'domain-before.json'), JSON.stringify(baseline, null, 2));
    vite = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'),
      server: { host: '127.0.0.1', port: 28194, strictPort: true, fs: { allow: [root] } }, plugins: [{ name: 'source-ocr-production-api', configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/api/')) return next();
          try {
            assert(request.method === 'GET' || request.method === 'POST' && (request.url === '/api/auth/open-workspace'
              || /^\/api\/checks\/[^/]+\/sources\/[^/]+\/source-ocr-imports$/.test(request.url)
              || /^\/api\/checks\/[^/]+\/source-ocr-reviews$/.test(request.url)), 'Unexpected mutation');
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const result = await fixture.app.inject({ method: request.method, url: request.url, headers: request.headers,
              ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}) });
            const isJson = result.headers['content-type']?.includes('application/json');
            requests.push({ method: request.method, url: request.url, status: result.statusCode,
              contentType: result.headers['content-type'], bytes: result.rawPayload.length, sha256: sha(result.rawPayload),
              ...(chunks.length && request.url.includes('/source-ocr-') ? { payloadSha256: sha(Buffer.concat(chunks)) } : {}),
              ...(request.url.includes('/source-ocr-') && isJson ? { body: result.json() } : {}),
              ...(result.statusCode >= 400 && isJson ? { errorBody: result.json() } : {}) });
            if (request.url.startsWith(`/api/objects/${fixture.objectId}/files/${fixture.files[0].id}/pages/2/preview`) && result.statusCode === 200) {
              assert.equal(result.headers['content-type'], 'image/png');
              assert.equal(result.rawPayload.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
              await writeFile(path.join(output, `original-page2-${sha(result.rawPayload).slice(0, 12)}.png`), result.rawPayload);
            }
            response.writeHead(result.statusCode, result.headers); response.end(result.rawPayload);
          } catch (error) { next(error); }
        });
      } }] }); await vite.listen();
    const { chromium } = createRequire(import.meta.url)(process.env.INSPECTOR_PLAYWRIGHT_PATH
      ?? '/home/freetok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 375, height: 1100 }, colorScheme: 'light', acceptDownloads: true });
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', value => consoleMessages.push({ type: value.type(), text: value.text() }));
    page.on('requestfailed', request => resourceErrors.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => { if (!response.url().includes('/api/') && response.status() >= 400)
      resourceErrors.push({ url: response.url(), status: response.status() }); });
    async function openWorkspace(navigate = true) {
      if (navigate) await page.goto('http://127.0.0.1:28194/');
      const landing = page.getByRole('button', { name: /Открыть кабинет/ }).first(), home = page.getByRole('heading', { name: 'Объекты проверки', exact: true });
      await Promise.any([landing.waitFor({ state: 'visible' }), home.waitFor({ state: 'visible' })]);
      if (await landing.isVisible()) await landing.click();
      await home.waitFor(); await page.getByRole('button', { name: 'Открыть проверку', exact: true }).first().click();
      await page.getByRole('button', { name: 'Исходные документы', exact: true }).click();
      await page.getByRole('region', { name: 'Исходные файлы', exact: true }).getByRole('button', { name: /PD\.pdf/ }).click();
      await page.getByRole('button', { name: 'Открыть историю OCR пропусков', exact: true }).click();
      await page.getByRole('button', { name: 'Обновить историю OCR', exact: true }).waitFor();
    }
    await openWorkspace();
    const workspace = page.getByRole('region', { name: 'OCR пропусков полного аудита', exact: true });
    const delayedBundle = structuredClone(fixture.bundle), delayedResponse = JSON.parse(delayedBundle.pages[0].rawResponseJson);
    delayedResponse.results[0].overall_ocr_res.rec_texts[0] = 'Запоздалый пакет A';
    delayedBundle.pages[0].rawResponseJson = JSON.stringify(delayedResponse);
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      window.__restoreOcrFileRead = () => { File.prototype.arrayBuffer = original; };
      File.prototype.arrayBuffer = function () {
        const bytes = original.call(this);
        return this.name === 'delayed-A.json' ? bytes.then(value => new Promise(resolve => {
          window.__releaseOcrA = () => resolve(value);
        })) : bytes;
      };
    });
    const upload = workspace.getByLabel('JSON-пакет сохранённого OCR', { exact: true });
    await upload.setInputFiles({ name: 'delayed-A.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(delayedBundle)) });
    await page.waitForFunction(() => typeof window.__releaseOcrA === 'function');
    await upload.setInputFiles(path.join(output, 'input-bundle.json'));
    await workspace.getByText('Выбрано страниц: 2. Перед сохранением сервер проверит полный набор пропусков и исходный PDF.', { exact: true }).waitFor();
    await page.evaluate(async () => {
      window.__releaseOcrA(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.__restoreOcrFileRead();
    });
    await workspace.getByRole('button', { name: 'Сохранить отдельный импорт OCR', exact: true }).click();
    const saved = workspace.getByRole('region', { name: 'Сохранённый импорт OCR', exact: true });
    await saved.waitFor();
    const imported = requests.find(row => row.method === 'POST' && row.url.endsWith('/source-ocr-imports'));
    assert.equal(imported?.status, 201); record = imported.body;
    assert.equal(imported.payloadSha256, fixture.bundleSha256, 'Late fileA must not replace latest selected fileB');
    pass('delayed-fileA-fileB-lateA-persists-only-latest-bundleB');
    assert.equal(record.sourceFileId, fixture.files[0].id); assert.equal(record.bindings.sourceSha256, fixture.files[0].sha256);
    assert.equal(record.bindings.originalBytesVerified, true);
    assert.equal(record.derived.status, 'IMPORTED_OCR_UNVERIFIED');
    for (const [key, expected] of Object.entries({ p: null, factEligible: false, coverageDelta: 0, providerExecutionVerified: false, renderDerivationVerified: false }))
      assert.equal(record.derived[key], expected, key);
    assert.deepEqual(record.derived.pages.map(value => value.pageNumber), [2, 3]);
    assert.deepEqual(record.derived.pages.map(value => value.status), ['TEXT_CANDIDATE', 'UNRESOLVED']);
    assert.deepEqual(record.derived.pages[0].lines.map(value => value.text), sourceOcrManualExpectation.textCandidates);
    assert.deepEqual(record.derived.pages[1].lines, []);
    await saved.getByRole('button', { name: sourceOcrManualExpectation.textCandidates[1], exact: true }).waitFor();
    assert.equal(await page.evaluate(() => typeof window.OCR_XSS), 'undefined');
    assert.equal(await saved.locator('script').count(), 0);
    pass('actual-App-authenticated-file-upload-201-exact-authored-lines-escaped');
    await saved.getByRole('combobox', { name: 'Страница импорта OCR', exact: true }).selectOption('3');
    await saved.getByText('OCR не вернул непустого текста. Страница остаётся неразрешённой; это не доказательство отсутствия сведений.', { exact: true }).waitFor();
    pass('empty-page3-remains-UNRESOLVED');
    const unitCandidates = saved.locator('details[aria-label="Кандидаты для сверки двойных единиц"]');
    await unitCandidates.locator('summary').click();
    assert.equal(await unitCandidates.getByRole('button').count(), 1);
    await unitCandidates.getByRole('button', { name: `К единицам · стр. 2, строка 2: ${sourceOcrManualExpectation.textCandidates[0]}`, exact: true }).click();
    const unitNotice = saved.getByRole('note', { name: 'Кандидат для сверки двойных единиц', exact: true });
    await unitNotice.getByText('Кандидат: проверьте двойные единицы', { exact: true }).waitFor();
    assert((await unitNotice.innerText()).includes('1076,3565–1077,5195 кВт'));
    assert((await unitNotice.innerText()).includes('вероятность не рассчитана'));
    await page.waitForFunction(() => {
      const node = document.activeElement, rect = node?.getBoundingClientRect();
      return node?.getAttribute('aria-label') === 'Ручная сверка строки OCR' && rect.top >= 0 && rect.top < innerHeight;
    });
    const viewer = saved.getByRole('region', { name: 'Документ Исходный PDF для OCR', exact: true });
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Документ Исходный PDF для OCR"] img.document-source-image')]
      .some(image => image.complete && image.naturalWidth > 0));
    assert.equal(await viewer.getByRole('spinbutton', { name: 'Страница PDF Исходный PDF для OCR', exact: true }).inputValue(), '2');
    assert.equal(await saved.locator('.inspector-evidence-box').count(), 0);
    const imageHash = await viewer.locator('img.document-source-image').evaluate(async image => {
      const bytes = await (await fetch(image.src)).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    });
    assert(requests.some(row => row.url.startsWith(`/api/objects/${fixture.objectId}/files/${fixture.files[0].id}/pages/2/preview`)
      && row.status === 200 && row.sha256 === imageHash), 'Visible PNG must match exact authenticated original page2 response');
    const lineItems = saved.getByRole('list', { name: 'Строки OCR на выбранной странице', exact: true }).locator(':scope > li');
    assert.deepEqual(await lineItems.evaluateAll(items => items.map(item => item.value)), [2, 3]);
    assert.deepEqual(record.derived.pages[0].lines.map(value => value.ordinal), [1, 2]);
    await saved.getByRole('heading', { name: 'Проверяемая строка 2 · стр. 2', exact: true }).waitFor();
    pass('raw-empty-line-preserves-list-search-review-ordinal-without-renumbering');
    pass('unit-candidate-jumps-to-exact-page-line-original-PNG-with-focus-and-null-probability');
    await saved.getByRole('searchbox', { name: 'Поиск в импортированном OCR', exact: true }).fill('107,687');
    await saved.getByRole('button', { name: `Стр. 2, строка 2: ${sourceOcrManualExpectation.textCandidates[0]}`, exact: true }).click();
    assert.equal(await viewer.getByRole('spinbutton', { name: 'Страница PDF Исходный PDF для OCR', exact: true }).inputValue(), '2');
    pass('search-selects-physical2-actual-original-PNG-with-no-OCR-PDF-frame');
    await saved.getByRole('textbox', { name: 'Основание сверки OCR', exact: true }).fill('Сверено с изображением исходной страницы 2; только буквальная транскрипция.');
    await saved.getByRole('button', { name: 'Текст совпадает с PDF', exact: true }).click();
    await saved.getByText('Текст сверен человеком', { exact: true }).waitFor();
    const reviewed = requests.find(row => row.method === 'POST' && row.url.endsWith('/source-ocr-reviews'));
    assert.equal(reviewed?.status, 201); review = reviewed.body;
    assert.equal(review.importId, record.id); assert.equal(review.importContentHash, record.contentHash);
    assert.equal(review.pageNumber, 2); assert.equal(review.ordinal, 1); assert.equal(review.lineHash, record.derived.pages[0].lines[0].lineHash);
    assert.equal(review.humanTranscriptionOnly, true); assert.equal(review.decision, 'CONFIRMED');
    for (const [key, expected] of Object.entries({ p: null, factEligible: false, coverageDelta: 0 })) assert.equal(review[key], expected);
    pass('actual-201-review-is-only-hash-bound-human-transcription');
    await unitNotice.getByText('Кандидат: проверьте двойные единицы', { exact: true }).waitFor();
    pass('human-confirmed-transcription-preserves-unit-candidate-and-exact-source-text');
    await saved.getByRole('searchbox', { name: 'Поиск в импортированном OCR', exact: true }).fill('');
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const mode of ['light', 'dark']) {
        await page.getByRole('button', { name: mode === 'dark' ? 'Тёмная тема' : 'Светлая тема', exact: true }).click();
        await page.waitForFunction(value => document.documentElement.dataset.colorResolved === value
          && !document.documentElement.hasAttribute('data-color-transition'), mode);
        await viewer.locator('img.document-source-image').waitFor();
        await unitCandidates.getByRole('button', { name: `К единицам · стр. 2, строка 2: ${sourceOcrManualExpectation.textCandidates[0]}`, exact: true }).click();
        await page.waitForFunction(() => {
          const node = document.activeElement, rect = node?.getBoundingClientRect();
          return node?.getAttribute('aria-label') === 'Ручная сверка строки OCR' && rect.top >= 0 && rect.top < innerHeight;
        });
        assert.equal(await viewer.getByRole('spinbutton', { name: 'Страница PDF Исходный PDF для OCR', exact: true }).inputValue(), '2');
        const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          overflowingControls: [...document.querySelectorAll('main select, main input, main button, main label, main textarea')]
            .map(node => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1))
            .map(({ node, rect }) => ({ tag: node.tagName, ariaLabel: node.getAttribute('aria-label'), text: node.textContent?.slice(0, 120),
              x: rect.x, right: rect.right, width: rect.width, outerHTML: node.outerHTML.slice(0, 1200),
              ancestors: [node.parentElement, node.parentElement?.parentElement, node.parentElement?.parentElement?.parentElement].filter(Boolean)
                .map(parent => ({ className: parent.className, style: parent.getAttribute('style'), width: parent.getBoundingClientRect().width })) })),
          OCR_XSS: typeof window.OCR_XSS,
          ocrFrames: document.querySelectorAll('[aria-label="Сохранённый импорт OCR"] .inspector-evidence-box').length }));
        layouts.push({ mode, ...layout }); assert(layout.documentWidth <= width + 1, 'Horizontal overflow');
        assert.deepEqual(layout.overflowingControls, [], 'Clipped controls'); assert.equal(layout.OCR_XSS, 'undefined'); assert.equal(layout.ocrFrames, 0);
        await screenshot(`source-ocr-${width}-${mode}`, saved);
        await viewer.locator('.inspector-sheet-viewport').scrollIntoViewIfNeeded();
        await screenshot(`source-ocr-original-page2-${width}-${mode}`);
        pass(`${width}-${mode}-original-visible-untrusted-text-no-overflow`);
      }
    }
    async function download(name) {
      const pending = page.waitForEvent('download');
      await saved.getByRole('button', { name: 'Скачать импорт OCR и журнал сверки', exact: true }).click();
      const download = await pending; assert.equal(await download.failure(), null); await download.saveAs(path.join(output, name));
      return readFile(path.join(output, name));
    }
    const downloaded = await download('source-ocr-record-and-review.json');
    assert.deepEqual(JSON.parse(downloaded), { record, reviews: [review] });
    await page.reload(); await openWorkspace(false); await saved.waitFor();
    assert.equal(await workspace.getByRole('combobox', { name: 'Сохранённый импорт OCR', exact: true }).inputValue(), record.id);
    const afterDownload = await download('source-ocr-record-and-review-after-reload.json'); assert.deepEqual(afterDownload, downloaded);
    const history = requests.filter(row => row.method === 'GET' && row.url === `/api/checks/${fixture.checkId}/source-ocr-imports`).at(-1)?.body;
    assert.deepEqual(history.items, [record]); assert.deepEqual(history.reviews, [review]);
    pass('reload-PG-history-and-downloaded-record-review-byte-exact');
    await unitCandidates.locator('summary').click();
    await unitCandidates.getByRole('button', { name: `К единицам · стр. 2, строка 2: ${sourceOcrManualExpectation.textCandidates[0]}`, exact: true }).click();
    await unitNotice.getByText('Кандидат: проверьте двойные единицы', { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const node = document.activeElement, rect = node?.getBoundingClientRect();
      return node?.getAttribute('aria-label') === 'Ручная сверка строки OCR' && rect.top >= 0 && rect.top < innerHeight;
    });
    assert.equal(await viewer.getByRole('spinbutton', { name: 'Страница PDF Исходный PDF для OCR', exact: true }).inputValue(), '2');
    pass('unit-candidate-after-reload-is-display-only-record-review-download-unchanged');
    assert.deepEqual(await domain(), baseline); await writeFile(path.join(output, 'domain-after.json'), JSON.stringify(await domain(), null, 2));
    const counts = (await fixture.db.query('SELECT (SELECT count(*)::int FROM source_ocr_imports) AS imports,(SELECT count(*)::int FROM source_ocr_reviews) AS reviews')).rows[0];
    assert.deepEqual(counts, { imports: 1, reviews: 1 });
    const expectedEmptyReview = row => row.method === 'GET' && row.status === 404 && row.errorBody?.error === 'NOT_FOUND'
      && row.errorBody?.message === 'Решение не найдено' && fixture.files.slice(0, 2).some(file => row.url === `/api/objects/${fixture.objectId}/files/${file.id}/source-review`);
    assert.deepEqual(requests.filter(row => row.status >= 400 && !expectedEmptyReview(row)), []);
    assert(!requests.some(row => /\/(matrix-execution|visual-proposals|ocr-layout)(?:\?|$)/.test(row.url)), 'Source-audit UI must not schedule/query engineering/OCR provider analysis');
    assert.deepEqual(browserErrors, []); assert.equal(await page.evaluate(() => typeof window.OCR_XSS), 'undefined');
    const finalPins = await pins(); assert.deepEqual(finalPins, initialPins, 'Runtime source changed during acceptance');
    await writeFile(path.join(output, 'source-pins-end.json'), JSON.stringify(finalPins, null, 2));
    pass('sealed-parent-native-artifacts-coverage-engineering-unchanged');
    await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ status: 'PASS_SOURCE_OCR_IMPORT_APP_LOCAL', startedAt,
      finishedAt: new Date().toISOString(), wallSeconds: (Date.now() - started) / 1000, checks, requests, screenshots, layouts,
      browserErrors, consoleMessages, resourceErrors, imageHash, record, review, counts, boundary: browserBoundary }, null, 2));
  } catch (error) {
    if (page) { await screenshot('first-red').catch(() => {}); await writeFile(path.join(output, 'first-red-body.txt'), await page.locator('body').innerText().catch(() => ''));
      await writeFile(path.join(output, 'first-red-document.html'), await page.content().catch(() => '')); }
    await writeFile(path.join(output, 'first-red.json'), JSON.stringify({ status: 'FIRST_RED', error: error.stack ?? String(error), checks,
      requests, screenshots, layouts, browserErrors, consoleMessages, resourceErrors, boundary: browserBoundary }, null, 2)); throw error;
  } finally { await browser?.close(); await vite?.close(); await fixture?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
