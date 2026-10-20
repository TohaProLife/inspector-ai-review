#!/usr/bin/env node
/** Opt-in authored originals -> fresh native V4 -> PostgreSQL -> authenticated production App. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { seedNativeCapacityFixture } from './smoke-native-capacity-app.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const boundary = ['Synthetic authored three-page Cyrillic originals: PD П17 L9060/Pc350, RD П17.1 L3340/Pc540 and П17.2 L5720/Pc540 on pages1/3.',
  'Actual fresh Python native V4 producer, complete original SHA, production authenticated Fastify, disposable PostgreSQL and full App/CSS/PDF preview.',
  'Local download transport/identity fixture only; no Rabbit, ML, real-project engineering, physical group equivalence or operating-mode claim.'];
export async function seedNativeAirflowFixture(adminUrl, options = {}) {
  return seedNativeCapacityFixture(adminUrl, { ...options, scenario: 'AIRFLOW' });
}

async function main() {
  const argv = process.argv.slice(2);
  assert.equal(argv.length % 2, 0, 'Use key/value arguments');
  const args = Object.fromEntries(argv.reduce((rows, value, index) => index % 2 ? rows : [...rows, [value, argv[index + 1]]], []));
  assert(args['--admin-url-file'] && args['--output'], 'Provide --admin-url-file SECRET --output DIR');
  const output = path.resolve(args['--output']); await mkdir(output, { recursive: true });
  const startedAt = new Date().toISOString(), checks = [], issues = [], requests = [], screenshots = [], layouts = [], browserErrors = [], consoleMessages = [], resourceErrors = [];
  let fixture, vite, browser, page;
  const pass = name => { checks.push(name); process.stdout.write(`PASS ${name}\n`); };
  const pins = async () => Promise.all(['scripts/smoke-native-airflow-app.mjs', 'scripts/smoke-native-capacity-app.mjs', 'apps/api/src/app.ts', 'apps/api/src/postgres-native-airflow.ts',
    'apps/api/src/native-airflow-comparison.ts', 'apps/api/src/postgres-native-source-comparison-scope.ts',
    'apps/api/src/native-source-comparison-origin.ts', 'apps/api/src/native-source-comparison-error.ts', 'apps/api/src/native-source-comparison-storage.ts',
    'apps/api/src/native-airflow-routes.ts', 'apps/api/src/native-airflow-input.ts',
    'apps/api/src/postgres-repository.ts', 'apps/api/src/postgres-document-text-v4-full-source.ts', 'apps/api/src/pdf-preview.ts',
    'apps/api/src/api-contract.ts', 'migrations/049_native_airflow_comparisons.sql', 'migrations/050_native_source_comparison_nested_bindings.sql',
    'apps/web/src/App.tsx', 'apps/web/src/api.ts',
    'apps/web/src/NativeAirflowWorkspace.tsx', 'apps/web/src/native-source-line-evidence.ts', 'apps/web/src/SourceAuditV4FullWorkspace.tsx', 'apps/web/src/DocumentPairWorkspace.tsx',
    'apps/web/src/SourceReviewScreen.tsx', 'apps/web/src/source-preview-loader.ts', 'apps/web/src/InspectorEvidenceViewer.tsx',
    'services/worker/inspector_worker/document_text_v4.py', 'services/worker/inspector_worker/durable_text_v4_full.py',
    'apps/web/src/styles.css', 'apps/web/src/themes.css', 'apps/web/src/workspace.css']
    .map(async file => ({ path: file, sha256: sha(await readFile(path.join(root, file))) })));
  const initialPins = await pins(); await writeFile(path.join(output, 'source-pins-start.json'), JSON.stringify(initialPins, null, 2));
  async function screenshot(name, fullPage = true) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage }); screenshots.push(`${name}.png`); }
  try {
    fixture = await seedNativeAirflowFixture((await readFile(args['--admin-url-file'], 'utf8')).trim());
    await writeFile(path.join(output, 'fixture.json'), JSON.stringify({ objectId: fixture.objectId, checkId: fixture.checkId,
      files: fixture.files, boundary, nativeArtifacts: fixture.results.sources.map(source => ({ sourceFileId: source.sourceFileId,
        inputSha256: source.inputSha256, artifact: source.artifact })) }, null, 2));
    vite = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'),
      server: { host: '127.0.0.1', port: 28193, strictPort: true, fs: { allow: [root] } }, plugins: [{ name: 'native-airflow-production-api', configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/api/')) return next();
          try {
            assert(request.method === 'GET' || request.method === 'POST' && (request.url === '/api/auth/open-workspace'
              || /^\/api\/checks\/[^/]+\/native-airflow-comparisons$/.test(request.url)), 'Unexpected mutation');
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const result = await fixture.app.inject({ method: request.method, url: request.url, headers: request.headers,
              ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}) });
            requests.push({ method: request.method, url: request.url, status: result.statusCode, contentType: result.headers['content-type'],
              ...(request.url.includes('native-airflow') ? { body: result.json() } : {}),
              ...(result.statusCode >= 400 && result.headers['content-type']?.includes('application/json') ? { errorBody: result.json() } : {}) });
            response.writeHead(result.statusCode, result.headers); response.end(result.rawPayload);
          } catch (error) { next(error); }
        });
      } }] }); await vite.listen();
    const { chromium } = createRequire(import.meta.url)(process.env.INSPECTOR_PLAYWRIGHT_PATH
      ?? '/home/freetok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 375, height: 1100 }, colorScheme: 'light', acceptDownloads: true });
    page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('requestfailed', request => resourceErrors.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => { if (!response.url().includes('/api/') && response.status() >= 400)
      resourceErrors.push({ url: response.url(), status: response.status() }); });
    async function openWorkspace({ navigate = true } = {}) {
      if (navigate) await page.goto('http://127.0.0.1:28193/');
      const landing = page.getByRole('button', { name: /Открыть кабинет/ }).first();
      const home = page.getByRole('heading', { name: 'Объекты проверки', exact: true });
      await Promise.any([landing.waitFor({ state: 'visible' }), home.waitFor({ state: 'visible' })]);
      if (await landing.isVisible()) await landing.click();
      await home.waitFor();
      await page.getByRole('button', { name: 'Открыть проверку', exact: true }).first().click();
      await page.getByRole('button', { name: 'Исходные документы', exact: true }).click();
      const opener = page.getByRole('button', { name: 'Открыть сверку расходов вентиляции ПД/РД', exact: true });
      await opener.waitFor();
      const openingLayout = await opener.evaluate(button => ({ right: button.getBoundingClientRect().right,
        documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
      assert(openingLayout.right <= openingLayout.viewportWidth + 1 && openingLayout.documentWidth <= openingLayout.viewportWidth + 1,
        `Unopened airflow control overflow: ${JSON.stringify(openingLayout)}`);
      await opener.click();
    }
    await openWorkspace(); pass('production-App-scoped-PG-V4-workspace');
    await page.getByRole('combobox', { name: 'ПД для сверки расходов вентиляции', exact: true }).selectOption(fixture.files[0].id);
    await page.getByRole('combobox', { name: 'РД для сверки расходов вентиляции', exact: true }).selectOption(fixture.files[1].id);
    await page.getByRole('textbox', { name: 'Система ПД для сверки расходов', exact: true }).fill('П17');
    await page.getByRole('textbox', { name: 'Системы РД для сверки расходов', exact: true }).fill('П17.1, П17.2');
    await page.getByRole('button', { name: 'Сравнить расход по исходному тексту', exact: true }).click();
    await page.getByText('Заявленный расход совпадает: 9060 / 9060 м³/ч', { exact: true }).waitFor();
    const post = requests.find(row => row.method === 'POST' && row.url.endsWith('/native-airflow-comparisons'));
    assert.equal(post?.status, 201); assert.equal(post.body.comparison.p, null); assert.equal(post.body.comparison.factEligible, false);
    const record = post.body;
    assert.deepEqual(record.input.selection, { pdSystemId: 'П17', rdSystemIds: ['П17.1', 'П17.2'] });
    assert.equal(record.comparison.pdValue, '9060'); assert.equal(record.comparison.rdValue, '9060');
    assert.equal(record.comparison.deltaRdMinusPd, '0'); assert.equal(record.comparison.parameterMappingStatus, 'PUBLIC_MAPPING_CONFLICT');
    assert.deepEqual(record.comparison.memberValues, { PD: { systemId: 'П17', value: '9060', unit: 'м³/ч', freePressurePa: '350', quoteCount: 2 },
      RD: [{ systemId: 'П17.1', value: '3340', unit: 'м³/ч', freePressurePa: '540', quoteCount: 2 },
        { systemId: 'П17.2', value: '5720', unit: 'м³/ч', freePressurePa: '540', quoteCount: 2 }] });
    assert.equal(record.comparison.quotes.PD.length, 2); assert.equal(record.comparison.quotes.RD.length, 4);
    pass('actual-POST-source-only-airflow9060-native-quotes');
    const pair = page.getByRole('region', { name: 'Вентиляция: ПД и РД рядом', exact: true });
    for (const role of ['ПД', 'РД']) {
      await pair.getByRole('combobox', { name: `Фрагмент ${role}`, exact: true }).selectOption({ index: role === 'ПД' ? 1 : 3 });
      await pair.getByRole('button', { name: `Перейти к фрагменту ${role}`, exact: true }).click();
      await pair.getByRole('spinbutton', { name: `Страница PDF ${role}`, exact: true }).waitFor();
      assert.equal(await pair.getByRole('spinbutton', { name: `Страница PDF ${role}`, exact: true }).inputValue(), '3');
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.document-pair-workspace .document-pair-quote')]
      .every(quote => quote.textContent.includes('стр. 3')));
    pass('independent-native-quote-selection-jumps-both-originals-to-physical3');
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const mode of ['light', 'dark']) {
        await page.getByRole('button', { name: mode === 'dark' ? 'Тёмная тема' : 'Светлая тема', exact: true }).click();
        await page.waitForFunction(value => document.documentElement.dataset.colorResolved === value
          && !document.documentElement.hasAttribute('data-color-transition'), mode);
        await pair.locator('.inspector-evidence-pane').first().waitFor();
        await page.evaluate(() => { window.__nativeGeometry = undefined; });
        await page.waitForFunction(() => {
          if (document.documentElement.hasAttribute('data-color-transition')) return false;
          const panes = [...document.querySelectorAll('.document-pair-workspace .inspector-evidence-pane')];
          if (panes.length !== 2) return false;
          const geometry = panes.map(pane => {
            const image = pane.querySelector('img.document-source-image'), frame = pane.querySelector('.inspector-evidence-box--active')?.getBoundingClientRect();
            const viewport = pane.querySelector('.inspector-sheet-viewport')?.getBoundingClientRect();
            return { loaded: image?.complete && image.naturalWidth > 0, frame, viewport };
          });
          if (!geometry.every(({ loaded, frame, viewport }) => loaded && frame?.width > 0 && viewport
            && frame.x + frame.width / 2 >= viewport.x && frame.x + frame.width / 2 <= viewport.right
            && frame.y + frame.height / 2 >= viewport.y && frame.y + frame.height / 2 <= viewport.bottom)) return false;
          const key = JSON.stringify(geometry), prior = window.__nativeGeometry;
          window.__nativeGeometry = { key, count: prior?.key === key ? prior.count + 1 : 1 };
          return window.__nativeGeometry.count >= 3;
        }, undefined, { timeout: 10000, polling: 'raf' });
        const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          overflowingControls: [...document.querySelectorAll('main select, main input, main button, main label')]
            .map(node => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect }) => rect.right > innerWidth + 1)
            .map(({ node, rect }) => ({ tag: node.tagName, ariaLabel: node.getAttribute('aria-label'), text: node.textContent?.slice(0, 160),
              x: rect.x, width: rect.width, right: rect.right, computedWidth: getComputedStyle(node).width,
              minWidth: getComputedStyle(node).minWidth, maxWidth: getComputedStyle(node).maxWidth, outerHTML: node.outerHTML.slice(0, 1500),
              ancestors: [node.parentElement, node.parentElement?.parentElement, node.parentElement?.parentElement?.parentElement]
                .filter(Boolean).map(parent => ({ tag: parent.tagName, className: parent.className, style: parent.getAttribute('style'),
                  width: parent.getBoundingClientRect().width })) })).slice(0, 30),
          panes: [...document.querySelectorAll('.inspector-evidence-pane')].map(pane => ({ text: pane.innerText,
            images: [...pane.querySelectorAll('img')].map(image => ({ complete: image.complete, width: image.naturalWidth })),
            frames: pane.querySelectorAll('.inspector-evidence-box--active').length })) }));
        layouts.push({ mode, ...layout }); assert(layout.documentWidth <= width + 1, 'Horizontal overflow');
        assert.deepEqual(layout.overflowingControls, [], 'Clipped controls');
        await screenshot(`native-airflow-${width}-${mode}`);
        await pair.screenshot({ path: path.join(output, `native-pair-${width}-${mode}.png`) }); screenshots.push(`native-pair-${width}-${mode}.png`);
        for (const role of ['ПД', 'РД']) {
          await pair.getByRole('region', { name: `Документ ${role}`, exact: true }).locator('.inspector-sheet-viewport').scrollIntoViewIfNeeded();
          const physical = await pair.getByRole('region', { name: `Документ ${role}`, exact: true }).evaluate(pane => {
            const frame = pane.querySelector('.inspector-evidence-box--active').getBoundingClientRect();
            const fixedBottom = Math.max(0, ...[...document.querySelectorAll('header')].filter(node => getComputedStyle(node).position === 'fixed'
              || getComputedStyle(node).position === 'sticky').map(node => node.getBoundingClientRect().bottom));
            return { centerX: frame.x + frame.width / 2, centerY: frame.y + frame.height / 2, fixedBottom, width: innerWidth, height: innerHeight };
          });
          assert(physical.centerX > 0 && physical.centerX < physical.width && physical.centerY > physical.fixedBottom
            && physical.centerY < physical.height, `Physical ${role} frame hidden: ${JSON.stringify(physical)}`);
          await screenshot(`native-visible-${role === 'ПД' ? 'pd' : 'rd'}-${width}-${mode}`, false);
        }
        pass(`${width}-${mode}-actual-PDF-images-active-native-frames`);
      }
    }
    const downloadPending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать JSON сверки расходов вентиляции', exact: true }).click();
    const download = await downloadPending; assert.equal(await download.failure(), null);
    await download.saveAs(path.join(output, 'airflow-record.json'));
    assert.deepEqual(JSON.parse(await readFile(path.join(output, 'airflow-record.json'), 'utf8')), record);
    pass('downloaded-JSON-exact-record-source-bindings');
    await page.reload(); await openWorkspace({ navigate: false });
    await page.getByText('Заявленный расход совпадает: 9060 / 9060 м³/ч', { exact: true }).waitFor();
    const persisted = (await fixture.app.inject({ url: `/api/checks/${fixture.checkId}/native-airflow-comparisons`, headers: fixture.headers })).json();
    assert.equal(persisted.items.length, 1); assert.deepEqual(persisted.items[0], record);
    assert.equal(await page.getByRole('combobox', { name: 'Сохранённая сверка расходов вентиляции', exact: true }).inputValue(), record.id);
    pass('reload-history-retains-exact-PG-comparison');
    assert.deepEqual(browserErrors, []);
    const expectedEmptyReview = row => row.method === 'GET' && row.status === 404 && row.errorBody?.error === 'NOT_FOUND'
      && row.errorBody?.message === 'Решение не найдено' && fixture.files.slice(0, 2)
        .some(file => row.url === `/api/objects/${fixture.objectId}/files/${file.id}/source-review`);
    const emptyReviewResponses = requests.filter(row => row.status >= 400 && expectedEmptyReview(row));
    assert.deepEqual(requests.filter(row => row.status >= 400 && !expectedEmptyReview(row)), []);
    assert(!requests.some(row => /\/(matrix-execution|visual-proposals|ocr-layout)(?:\?|$)/.test(row.url)), 'Source-audit UI must not request unavailable analysis');
    assert.equal((await fixture.db.query('SELECT count(*)::int n FROM rule_results')).rows[0].n, 0);
    const finalPins = await pins(); await writeFile(path.join(output, 'source-pins-end.json'), JSON.stringify(finalPins, null, 2));
    assert.deepEqual(finalPins, initialPins, 'Runtime source changed during acceptance');
    await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ status: 'PASS_NATIVE_AIRFLOW_APP_LOCAL', startedAt,
      finishedAt: new Date().toISOString(), checks, issues, requests, screenshots, layouts, browserErrors, consoleMessages, resourceErrors, emptyReviewResponses, boundary }, null, 2));
  } catch (error) {
    if (page) { await screenshot('first-red').catch(() => {}); await writeFile(path.join(output, 'first-red-body.txt'), await page.locator('body').innerText().catch(() => '')); }
    if (page) await writeFile(path.join(output, 'first-red-document.html'), await page.content().catch(() => ''));
    await writeFile(path.join(output, 'first-red.json'), JSON.stringify({ status: 'FIRST_RED', error: error.stack ?? String(error), checks,
      requests, screenshots, layouts, browserErrors, consoleMessages, resourceErrors, boundary }, null, 2)); throw error;
  } finally { await browser?.close(); await vite?.close(); await fixture?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
