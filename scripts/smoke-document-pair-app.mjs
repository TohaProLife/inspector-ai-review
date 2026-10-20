#!/usr/bin/env node
/** Full production App/CSS browser acceptance. Read-only in-memory repository;
 * real authenticated Fastify routes, original PDFs and native V4 artifact.
 * No database/queue/model execution, review decision or engineering assertion.
 *
 * INSPECTOR_PLAYWRIGHT_PATH=/absolute/node_modules/playwright node --import tsx \
 *   scripts/smoke-document-pair-app.mjs --sources DIR --output DIR [--artifact PATH]
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createServer } from 'vite';
import { buildApp } from '../apps/api/src/app.ts';
import { InspectorStore } from '../apps/api/src/store.ts';
import { createBrowserV4RealFixture } from './browser-v4-real-fixture.ts';

const root = path.resolve(import.meta.dirname, '..');
const values = process.argv.slice(2);
assert.equal(values.length % 2, 0, 'Arguments must be key/value pairs');
const args = Object.fromEntries(values.reduce((pairs, value, index) => index % 2 ? pairs : [...pairs, [value, values[index + 1]]], []));
assert(args['--sources'] && args['--output'] && process.env.INSPECTOR_PLAYWRIGHT_PATH,
  'Provide --sources DIR --output DIR and INSPECTOR_PLAYWRIGHT_PATH');
const output = path.resolve(args['--output']), sources = path.resolve(args['--sources']);
await mkdir(output, { recursive: true });
const startedAt = new Date().toISOString(), checks = [], issues = [], network = [], browserErrors = [], mutations = [], screenshots = [], recoveredPreviews = [];
const codePaths = [
  'scripts/smoke-document-pair-app.mjs', 'scripts/browser-v4-real-fixture.ts',
  'apps/web/src/main.tsx', 'apps/web/src/App.tsx', 'apps/web/src/Landing.tsx',
  'apps/web/src/RealDocumentPairs.tsx', 'apps/web/src/DocumentPairWorkspace.tsx',
  'apps/web/src/InspectorEvidenceViewer.tsx', 'apps/web/src/source-preview-loader.ts',
  'apps/web/src/design-system/SourceImage.tsx', 'apps/web/src/design-system/PreviewComparison.tsx',
  'apps/web/src/api.ts', 'apps/web/src/source-text-explorer.ts',
  'apps/web/src/document-pair.css', 'apps/web/src/inspector-review.css', 'apps/web/src/styles.css',
  'apps/web/src/themes.css', 'apps/web/src/workspace.css', 'apps/web/src/color-mode.css', 'apps/web/src/design-system/colorMode.ts',
  'apps/api/src/app.ts', 'apps/api/src/store.ts', 'apps/api/src/pdf-preview.ts',
  'apps/api/src/document-text-v4-full-batch.ts',
  'fixtures/real-public-room-pairs-v1/manual-source-bindings.json',
  'fixtures/real-parameter-source-comparisons-v1/viewer-bindings.json',
];
const pins = async () => Promise.all(codePaths.map(async file => ({ path: file,
  sha256: createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') })));
const sourcePins = await pins();
await writeFile(path.join(output, 'source-pins-start.json'), JSON.stringify(sourcePins, null, 2));
const files = [];
for (const pin of [
  { id: 'F0171', sha256: 'a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc', stages: ['PD'], pageCount: 177 },
  { id: 'F0201', sha256: '0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd', stages: ['RD', 'ID'], pageCount: 676 },
]) {
  const bytes = await readFile(path.join(sources, `${pin.id}.pdf`));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, `${pin.id} original SHA`);
  files.push({ ...pin, name: `${pin.id}.pdf`, size: bytes.length, registeredAt: startedAt, review: null });
}
const actor = { sessionId: 'full-app-qa-session', userId: 'full-app-qa-viewer', displayName: 'Локальная проверка только чтения',
  organizationId: 'full-app-qa-org', roles: ['VIEWER'], capabilities: ['READ'], csrfHash: '', expiresAt: new Date(Date.now() + 3600000).toISOString() };
const token = randomBytes(32).toString('hex');
const fixture = await createBrowserV4RealFixture({ artifactPath: path.resolve(args['--artifact'] ?? 'output/local-work-20261020/full-source-v14-v1/F0201-document-text-v4.json'),
  objectId: 'OBJ-FULL-APP-QA', checkId: 'CHK-V4-FULL-APP-QA', actor, files });
const object = { id: fixture.check.objectId, name: 'Локальный просмотр исходных ПД и РД; fixture без инженерных выводов',
  address: 'QA · Тюменская, 5 · исходные документы', status: 'PARTIAL', createdAt: startedAt, updatedAt: startedAt,
  stages: [{ stage: 'PD', status: 'COMPLETE', fileCount: 1, pageCount: 177 }, { stage: 'RD_ID_MIXED', status: 'MIXED', fileCount: 1, pageCount: 676 }],
  fileCount: 2, pageCount: 853, activeCheckId: fixture.check.id, stats: fixture.check.stats };
// Mechanical legacy FindingDocumentPair fixture. Source coordinates are public,
// manually inspected original bindings; no machine analysis or violation claimed.
const bindings = JSON.parse(await readFile(path.join(root, 'fixtures/real-public-room-pairs-v1/manual-source-bindings.json'), 'utf8'));
const evidence = bindings.records.filter(record => record.roomId === '147').map(record => {
  const file = files.find(value => value.sha256 === record.sourceSha256), quote = record.systemQuotes[0], box = quote.bboxMilliPoints;
  assert(file && quote);
  return { stage: record.inputRole, fileId: file.id, fileName: file.name, pdfPageNumber: record.physicalPage,
    documentSheetNumber: null, imageUrl: `/api/objects/${object.id}/files/${file.id}/pages/${record.physicalPage}/preview`,
    bbox: [box[0] / record.pageWidthMilliPoints, 1 - box[3] / record.pageHeightMilliPoints,
      box[2] / record.pageWidthMilliPoints, 1 - box[1] / record.pageHeightMilliPoints], sha256: file.sha256 };
});
const finding = { id: 'FND-VIEWER-FIXTURE', checkId: fixture.check.id, groupId: 'QA-VIEWER', parameterId: null,
  parameterCode: 'QA-VIEWER', title: 'QA: просмотр исходников, инженерный вывод не задан', location: 'Помещение 147', status: 'SUSPICION',
  severity: 'INFO', criticality: 'Не оценено', confidence: null, comparisonResult: 'SOURCE_VIEWER_FIXTURE', documentStatus: 'UNVERIFIED',
  expectedValue: 'Выбранный фрагмент ПД', actualValue: 'Выбранный фрагмент РД', idValue: null,
  rationale: 'Механическая проверка viewer в режиме NORMAL; не результат правил и не подтверждение нарушения.', evidence, decision: null };
const allowed = current => current?.sessionId === actor.sessionId && current.userId === actor.userId && current.organizationId === actor.organizationId;
const scoped = (current, matches, value) => !current ? 'AUTH_REQUIRED' : allowed(current) && matches ? value : undefined;
const memory = await InspectorStore.create();
let storageReads = 0;
const repository = new Proxy(memory, { get(target, property) {
  if (property === 'listObjects') return current => allowed(current) ? [object] : [];
  if (property === 'getObject') return (id, current) => scoped(current, id === object.id, object);
  if (property === 'getCheck') return (id, current) => scoped(current, id === fixture.check.id, fixture.check);
  if (property === 'getFindings') return (id, current) => scoped(current, id === fixture.check.id, [finding]);
  if (property === 'getProtocols') return (id, current) => scoped(current, id === fixture.check.id, []);
  if (property === 'getPilotResults') return (id, current) => scoped(current, id === fixture.check.id,
    { checkId: fixture.check.id, status: 'READY', items: [], ocrHeatRows: null });
  if (property === 'listSourceFiles') return (id, current) => scoped(current, id === object.id, files);
  if (property === 'listObjectChecks') return (id, current) => scoped(current, id === object.id, [fixture.check]);
  if (property === 'getDocumentTextV4FullSource') return fixture.readSource;
  if (property === 'hasObjectPermission') return () => false;
  if (property === 'getSourceFileContent') return (id, fileId, current) => {
    const file = files.find(value => value.id === fileId);
    return allowed(current) && id === object.id && file
      ? { name: file.name, storageKey: file.id, byteSize: file.size, sha256: file.sha256, mediaType: 'application/pdf' } : undefined;
  };
  const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
} });
const app = await buildApp({ repository, openWorkspace: true, identityService: {
  login: async () => undefined, createOpenWorkspaceSession: async () => ({ actor, sessionToken: token, csrfToken: 'readonly-fixture' }),
  resolveSession: async value => value === token ? actor : undefined, verifyCsrf: () => false, revokeSession: async () => {}, close: async () => {},
}, storage: { putFile: async () => { throw Error('Read-only fixture'); }, getFile: async key => {
  const file = files.find(value => value.id === key); assert(file, 'Unknown original'); storageReads++;
  return { body: createReadStream(path.join(sources, file.name)), size: (await stat(path.join(sources, file.name))).size };
} } });
await app.ready();
let vite, browser, page;
const pass = name => { checks.push(name); process.stdout.write(`PASS ${name}\n`); };
async function screenshot(name, fullPage = true) { const filename = `${name}.png`; await page.screenshot({ path: path.join(output, filename), fullPage }); screenshots.push(filename); }
async function layout(name) {
  // ResizeObserver and focus run asynchronously; require the final frame position.
  await page.evaluate(() => { window.__pairGeometryStable = undefined; });
  await page.waitForFunction(() => {
    if (document.documentElement.hasAttribute('data-color-transition')) return false;
    const values = [...document.querySelectorAll('.inspector-evidence-pane')].map(pane => {
      const viewport = pane.querySelector('.inspector-sheet-viewport')?.getBoundingClientRect();
      const frame = pane.querySelector('.inspector-evidence-box--active')?.getBoundingClientRect();
      return { viewport, frame, inside: viewport && frame && frame.x + frame.width / 2 >= viewport.x
        && frame.x + frame.width / 2 <= viewport.right && frame.y + frame.height / 2 >= viewport.y
        && frame.y + frame.height / 2 <= viewport.bottom };
    });
    if (!values.length || !values.every(value => value.inside)) return false;
    const key = JSON.stringify(values);
    const previous = window.__pairGeometryStable;
    window.__pairGeometryStable = { key, count: previous?.key === key ? previous.count + 1 : 1 };
    return window.__pairGeometryStable.count >= 3;
  }, undefined, { timeout: 5000, polling: 'raf' }).catch(error => { issues.push({ code: 'LAYOUT_DID_NOT_SETTLE', view: name, error: error.message }); });
  const dimensions = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    frames: [...document.querySelectorAll('.inspector-evidence-pane')].map(pane => {
      const viewport = pane.querySelector('.inspector-sheet-viewport')?.getBoundingClientRect();
      const frame = pane.querySelector('.inspector-evidence-box--active')?.getBoundingClientRect();
      const node = pane.querySelector('.inspector-sheet-viewport');
      const sheet = pane.querySelector('.inspector-sheet');
      const frameNode = pane.querySelector('.inspector-evidence-box--active');
      const image = pane.querySelector('img.document-source-image');
      const metrics = element => element && ({ clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight, scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop,
        offsetLeft: element.offsetLeft, offsetTop: element.offsetTop, rect: element.getBoundingClientRect().toJSON(),
        css: Object.fromEntries(['width', 'height', 'min-width', 'max-width', 'overflow-x', 'overflow-y', 'box-sizing',
          'padding-left', 'padding-right', 'border-left-width', 'transform', 'position', 'overflow-anchor', 'direction'].map(key => [key, getComputedStyle(element).getPropertyValue(key)])) });
      return { stage: pane.getAttribute('aria-label'), viewport: viewport?.toJSON(), frame: frame?.toJSON(),
        computed: { viewport: metrics(node), sheet: metrics(sheet), frame: metrics(frameNode), image: metrics(image),
          frameInlineStyle: frameNode?.getAttribute('style'), imageNaturalWidth: image?.naturalWidth,
          imageNaturalHeight: image?.naturalHeight },
        centerInside: !!viewport && !!frame && frame.x + frame.width / 2 >= viewport.x && frame.x + frame.width / 2 <= viewport.right
          && frame.y + frame.height / 2 >= viewport.y && frame.y + frame.height / 2 <= viewport.bottom };
    }),
    overflowing: [...document.querySelectorAll('main *')].filter(element => {
      const box = element.getBoundingClientRect(); return box.width > 0 && box.right > innerWidth + 2 && getComputedStyle(element).position !== 'fixed';
    }).slice(0, 12).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 90) })) }));
  if (dimensions.documentWidth > dimensions.width + 1) issues.push({ code: 'HORIZONTAL_OVERFLOW', view: name, ...dimensions });
  else pass(`${name}-no-page-horizontal-overflow`);
  for (const frame of dimensions.frames) if (!frame.centerInside) issues.push({ code: 'FRAME_CENTER_OUTSIDE_SOURCE_VIEWPORT', view: name, ...frame });
  return dimensions;
}
try {
  assert.equal((await app.inject({ method: 'GET', url: `/api/checks/${fixture.check.id}` })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: `/api/objects/FOREIGN/files/F0201/pages/676/preview`, headers: { cookie: `inspector_session=${token}` } })).statusCode, 404);
  assert.equal(storageReads, 0); pass('production-auth-and-object-scope-refuse-before-original-read');
  vite = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 28190, strictPort: true, fs: { allow: [root] } }, plugins: [{ name: 'full-app-readonly-qa', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          if (req.method !== 'GET' && !(req.method === 'POST' && req.url === '/api/auth/open-workspace')) {
            mutations.push({ method: req.method, url: req.url }); throw Error('Forbidden mutation in read-only QA');
          }
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const response = await app.inject({ method: req.method, url: req.url, headers: req.headers,
            ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}) });
          res.writeHead(response.statusCode, response.headers); res.end(response.rawPayload);
        } catch (error) { next(error); }
      });
    } }] });
  await vite.listen();
  const { chromium } = createRequire(import.meta.url)(process.env.INSPECTOR_PLAYWRIGHT_PATH);
  browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, colorScheme: 'light' });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('response', response => { if (response.url().includes('/api/')) network.push({ method: response.request().method(),
    url: new URL(response.url()).pathname + new URL(response.url()).search, status: response.status() }); });
  await page.goto('http://127.0.0.1:28190/');
  await page.getByRole('button', { name: /Открыть кабинет/ }).first().click();
  await page.getByRole('heading', { name: 'Объекты проверки', exact: true }).waitFor();
  assert.equal(await page.locator('.object-card').count(), 1); pass('actual-app-open-workspace-auth-and-object-list');
  const styles = await page.evaluate(() => [...document.querySelectorAll('style[data-vite-dev-id]')].map(element => element.getAttribute('data-vite-dev-id')));
  for (const filename of ['styles.css', 'themes.css', 'workspace.css', 'color-mode.css']) assert(styles.some(value => value.endsWith(`/${filename}`)), `${filename} not loaded`);
  await screenshot('objects-1440-light'); pass('production-main-and-all-real-css-loaded');
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Кандидаты', exact: true }).click();
  const pair = page.getByRole('region', { name: 'Сравнение реальных ПД и РД', exact: true }); await pair.waitFor();
  const pd = pair.getByRole('region', { name: 'Документ ПД', exact: true }), rd = pair.getByRole('region', { name: 'Документ РД', exact: true });
  async function loaded() { for (const pane of [pd, rd]) { await pane.locator('img.document-source-image').waitFor();
    await pane.locator('img.document-source-image[aria-busy]').waitFor({ state: 'detached', timeout: 90000 });
    await pane.locator('.inspector-evidence-box').first().waitFor(); } }
  await loaded(); assert.equal(await pd.getByLabel('Страница PDF ПД', { exact: true }).inputValue(), '88');
  assert.equal(await rd.getByLabel('Страница PDF РД', { exact: true }).inputValue(), '18'); pass('app-candidates-real-originals-and-both-native-frames');
  await page.getByRole('button', { name: 'Помещение 198', exact: true }).click(); await loaded();
  assert((await pair.locator('.document-pair-quote').first().innerText()).includes('В2.2 / В2.3')); pass('app-real-room-navigation-updates-source-quotes');
  await page.getByRole('button', { name: 'Помещение 147', exact: true }).click(); await loaded();
  const search = pair.locator('.document-pair-column').nth(1).locator('.pair-source-search');
  await search.locator('summary').click(); await search.getByRole('button', { name: 'Загрузить текст для поиска', exact: true }).click();
  await search.getByRole('searchbox', { name: 'Текст для поиска', exact: true }).waitFor({ timeout: 120000 });
  await search.getByRole('searchbox', { name: 'Текст для поиска', exact: true }).fill(fixture.lateQuery);
  await search.getByRole('button', { name: `Стр. ${fixture.latePage}: ${fixture.lateQuery}`, exact: true }).click();
  await rd.getByRole('img', { name: `РД, исходная страница ${fixture.latePage}`, exact: true }).waitFor({ timeout: 90000 });
  await rd.locator('.inspector-evidence-box').first().waitFor();
  assert((await search.innerText()).includes('Страниц: 676. Совпадений: 1.')); pass('app-full-v4-search676-unique-late-result-opens-original-and-frame');
  const batches = network.filter(item => item.url.includes('/source-text-v4-full-source-v1/pages?'));
  assert.deepEqual(batches.map(item => Number(new URL(item.url, 'http://localhost').searchParams.get('startPage'))), [1, 129, 257, 385, 513, 641]);
  assert(batches.every(item => item.status === 200)); pass('actual-app-six-production-hash-pinned-v4-batches');
  await search.locator('summary').click();
  await pair.getByRole('button', { name: 'К расхождению в обоих документах', exact: true }).click(); await loaded();
  for (const selection of [
    { label: 'Вместимость · PZ-013', pd: '1', rd: '5', secondary: '7', screenshot: 'capacity-source-only', quote: '600' },
    { label: 'П17 · IOS4-079', pd: '156', rd: '272', secondary: '279', screenshot: 'p17-source-only', quote: '9060' },
  ]) {
    await pair.getByRole('button', { name: selection.label, exact: true }).click(); await loaded();
    assert.equal(await pd.getByLabel('Страница PDF ПД', { exact: true }).inputValue(), selection.pd);
    assert.equal(await rd.getByLabel('Страница PDF РД', { exact: true }).inputValue(), selection.rd);
    assert((await pair.innerText()).includes(selection.quote));
    await pair.getByText('Исходные цитаты и способ извлечения', { exact: true }).click();
    assert((await pair.innerText()).includes('Стадия страниц смешанного РД/ИД отдельно не подтверждена.'));
    await screenshot(selection.screenshot); pass(`app-${selection.screenshot}-actual-pages-quotes-and-unverified-scope`);
    const fragments = pair.getByLabel('Фрагмент РД', { exact: true });
    const secondary = await fragments.locator('option').evaluateAll((options, pageNumber) => options.find(option => option.textContent.startsWith(`Стр. ${pageNumber} ·`))?.value, selection.secondary);
    assert(secondary, 'Second independent RD source citation must be selectable');
    await fragments.selectOption(secondary); await loaded();
    assert.equal(await rd.getByLabel('Страница PDF РД', { exact: true }).inputValue(), selection.secondary);
    await screenshot(`${selection.screenshot}-rd-${selection.secondary}`); pass(`app-${selection.screenshot}-secondary-rd-${selection.secondary}-original-and-frame`);
  }
  await pair.getByRole('button', { name: 'Помещение 147', exact: true }).click(); await loaded();
  const layouts = [];
  await page.evaluate(() => {
    window.__pairGeometryEvents = [];
    const capture = (type, node) => {
      const panes = node ? [node] : [...document.querySelectorAll('.inspector-sheet-viewport')];
      window.__pairGeometryEvents.push({ type, time: performance.now(), theme: document.documentElement.dataset.colorResolved,
        width: innerWidth, panes: panes.map(viewport => ({ stage: viewport.closest('section')?.getAttribute('aria-label'),
          scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, scrollWidth: viewport.scrollWidth,
          clientWidth: viewport.clientWidth, frame: viewport.querySelector('.inspector-evidence-box--active')?.getBoundingClientRect().toJSON() })) });
    };
    document.addEventListener('scroll', event => {
      if (event.target instanceof Element && event.target.matches('.inspector-sheet-viewport')) capture('scroll', event.target);
    }, true);
    new MutationObserver(() => capture('theme')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-resolved'] });
    const observer = new ResizeObserver(() => capture('resize-observer'));
    for (const node of document.querySelectorAll('.inspector-sheet-viewport, .inspector-sheet')) observer.observe(node);
  });
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const mode of ['light', 'dark']) {
      await page.getByRole('button', { name: mode === 'dark' ? 'Тёмная тема' : 'Светлая тема', exact: true }).click();
      await page.waitForFunction(expected => document.documentElement.dataset.colorResolved === expected, mode);
      const name = `pair-${width}-${mode}`;
      layouts.push({ name, ...(await layout(name)) });
      // A visible browser viewport is the physical frame boundary. Capture each
      // source after outer-page scrolling only; never use the viewer's jump.
      for (const [stage, pane] of [['pd', pd], ['rd', rd]]) {
        await pane.locator('.inspector-sheet-viewport').scrollIntoViewIfNeeded();
        layouts.push({ name: `${name}-${stage}-before-visible`, ...(await layout(`${name}-${stage}-before-visible`)) });
        const physical = await pane.locator('.inspector-evidence-box--active').evaluate(frame => {
          const box = frame.getBoundingClientRect();
          return { centerX: box.x + box.width / 2, centerY: box.y + box.height / 2, width: innerWidth, height: innerHeight };
        });
        assert(physical.centerX >= 0 && physical.centerX <= physical.width && physical.centerY >= 0 && physical.centerY <= physical.height,
          `${name}-${stage}: selected frame must be inside the visible browser viewport`);
        await screenshot(`${name}-${stage}-visible`, false);
        layouts.push({ name: `${name}-${stage}-after-visible`, physical, ...(await layout(`${name}-${stage}-after-visible`)) });
        pass(`${name}-${stage}-visible-frame-screen-boundary`);
      }
      // Long screenshots are supplementary; browsers may relayout fixed/scroll
      // content while creating them. Visible before/after captures are decisive.
      await screenshot(name);
      assert.equal(await pd.locator('.inspector-evidence-box').count() > 0, true);
      assert.equal(await rd.locator('.inspector-evidence-box').count() > 0, true);
      pass(`${name}-both-original-frames-present`);
    }
  }
  await writeFile(path.join(output, 'layout.json'), JSON.stringify(layouts, null, 2));
  await writeFile(path.join(output, 'geometry-events.json'), JSON.stringify(await page.evaluate(() => window.__pairGeometryEvents), null, 2));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Быстрый поиск', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Поиск по рабочему пространству', exact: true });
  await dialog.getByRole('textbox', { name: 'Поисковый запрос', exact: true }).fill('QA-VIEWER');
  await dialog.getByRole('button', { name: /QA: просмотр исходников/ }).click();
  const legacy = page.getByRole('region', { name: 'Исходники замечания', exact: true }); await legacy.waitFor();
  for (const label of ['Документ ПД', 'Документ РД']) await legacy.getByRole('region', { name: label, exact: true }).locator('.inspector-evidence-box').first().waitFor({ timeout: 90000 });
  assert.equal(await legacy.locator('img.document-source-image').count(), 2);
  const decisions = page.locator('.decision-actions');
  assert.equal(await decisions.getByRole('status').innerText(), 'Режим просмотра: нет права сохранять решения.');
  assert.equal(await decisions.getByRole('textbox').isDisabled(), true);
  for (const label of ['Отклонить кандидат', 'Запросить уточнение', 'Подтвердить нарушение']) {
    assert.equal(await decisions.getByRole('button', { name: label, exact: true }).isDisabled(), true);
  }
  pass('read-only-actor-decision-input-and-all-three-buttons-disabled');
  await screenshot('normal-finding-shared-viewer-1440-dark');
  pass('normal-legacy-finding-opens-common-pair-viewer-through-app-search');
  assert.deepEqual(mutations, []); assert.deepEqual(browserErrors, []);
  const failures = network.filter(item => item.status >= 400 && item.status !== 429); assert.deepEqual(failures, [], 'No unsupported API failures accepted');
  for (const [index, item] of network.entries()) if (item.status === 429) {
    assert(item.url.includes('/preview'), 'Only production preview capacity responses may recover');
    assert(network.slice(index + 1).some(later => later.url === item.url && later.status === 200), 'Every busy preview must later succeed with the exact same URL');
    recoveredPreviews.push(item);
  }
  assert.equal(await page.locator('[data-source-state="error"]').count(), 0);
  assert.equal(recoveredPreviews.length, 0, 'Frozen preview scheduler should prevent even recovered429 responses');
  pass('no-review-writes-no-browser-errors-and-zero-http-errors');
  const finalPins = await pins();
  await writeFile(path.join(output, 'source-pins-end.json'), JSON.stringify(finalPins, null, 2));
  assert.deepEqual(finalPins, sourcePins, 'Production source changed during acceptance; repeat on frozen sources');
  pass('source-pins-stable-through-run');
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ status: issues.length ? 'NEEDS_FIXES' : 'PASS_FULL_APP_LOCAL_BROWSER',
    startedAt, finishedAt: new Date().toISOString(), browser: browser.version(), checks, issues, screenshots, network, browserErrors, mutations,
    storageReads, files, recoveredPreviews, lateQuery: fixture.lateQuery, latePage: fixture.latePage,
    boundaries: ['Full production App/main/styles with scoped in-memory repository; no DB seal/queue/model/review claim.',
      'Finding is an explicitly mechanical legacy-viewer fixture; original quotes/frames do not establish a violation.',
      'No visual baseline, screen-reader, accessibility audit or physical-device proof.'] }, null, 2));
  if (issues.length) process.exitCode = 1;
} catch (error) {
  if (page) { await screenshot('first-red').catch(() => {}); await writeFile(path.join(output, 'first-red-body.txt'), await page.locator('body').innerText().catch(() => '')); }
  await writeFile(path.join(output, 'first-red.json'), JSON.stringify({ status: 'FIRST_RED', error: error.stack ?? String(error), checks, issues,
    network, browserErrors, mutations, screenshots, boundaries: ['In-memory fixture; no DB or review mutation.'] }, null, 2));
  throw error;
} finally { await browser?.close(); await vite?.close(); await app.close(); }
