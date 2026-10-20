#!/usr/bin/env node
/** Browser acceptance of production pair components + real authenticated PDF preview route.
 * A scoped in-memory source repository is a test fixture; no DB, jobs, approvals or GPU evidence.
 * Run: INSPECTOR_PLAYWRIGHT_PATH=/absolute/node_modules/playwright node --import tsx scripts/smoke-document-pair-ui.mjs --sources DIR --output DIR
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
const args = Object.fromEntries(process.argv.slice(2).reduce((values, item, index, all) => { if (index % 2 === 0) values.push([item, all[index + 1]]); return values; }, []));
if (!args['--sources'] || !args['--output'] || !process.env.INSPECTOR_PLAYWRIGHT_PATH) throw Error('Provide --sources DIR --output DIR and INSPECTOR_PLAYWRIGHT_PATH');
const output = path.resolve(args['--output']), sourceDir = path.resolve(args['--sources']);
await mkdir(output, { recursive: true });
const startedAt = new Date().toISOString(), events = [], errors = [], network = [];
const pins = [
  { id: 'F0171', sha256: 'a9070055b75adeea0d47651cf9dca3ca818ca5f54ac7ce9ddcd86efc817db7dc', stages: ['PD'], pageCount: 177 },
  { id: 'F0201', sha256: '0c398d7bca356455568413a6fc3b14044b7e538a902251b80e2a5574d80184fd', stages: ['RD', 'ID'], pageCount: 676 },
];
const files = [];
for (const pin of pins) {
  const sourcePath = path.join(sourceDir, `${pin.id}.pdf`), bytes = await readFile(sourcePath);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
  files.push({ ...pin, name: `${pin.id}.pdf`, size: bytes.length, registeredAt: startedAt, review: null });
}
const token = randomBytes(32).toString('hex');
const actor = { sessionId: 'pair-ui-session', userId: 'pair-ui-reviewer', displayName: 'Локальная проверка',
  organizationId: 'pair-ui-org', roles: ['INSPECTOR'], capabilities: ['READ'], csrfHash: '', expiresAt: new Date(Date.now() + 3600000).toISOString() };
const v4 = await createBrowserV4RealFixture({ artifactPath: path.resolve(args['--artifact'] ?? 'output/local-work-20261020/full-source-v14-v1/F0201-document-text-v4.json'),
  files, objectId: 'OBJ-PAIR-QA', checkId: 'CHK-V4-REAL-QA', actor });
const memory = await InspectorStore.create();
let storageReads = 0;
const repository = new Proxy(memory, { get(target, property) {
  if (property === 'getDocumentTextV4FullSource') return v4.readSource;
  if (property === 'listObjectChecks') return async (objectId, currentActor) => objectId === v4.check.objectId && currentActor.userId === actor.userId ? [v4.check] : undefined;
  if (property === 'getCheck') return async (checkId, currentActor) => !currentActor ? 'AUTH_REQUIRED'
    : checkId === v4.check.id && currentActor.userId === actor.userId ? v4.check : undefined;
  if (property === 'getSourceFileContent') return async (objectId, sourceFileId, currentActor) => {
    const file = files.find(value => value.id === sourceFileId);
    return objectId === 'OBJ-PAIR-QA' && currentActor.userId === actor.userId && file
      ? { name: file.name, storageKey: file.id, byteSize: file.size, sha256: file.sha256, mediaType: 'application/pdf' } : undefined;
  };
  const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
} });
const app = await buildApp({ repository, identityService: { login: async () => undefined, resolveSession: async value => value === token ? actor : undefined,
  verifyCsrf: () => false, revokeSession: async () => {}, close: async () => {} }, storage: {
  putFile: async () => { throw Error('read-only fixture'); },
  getFile: async key => { const file = files.find(value => value.id === key); if (!file) throw Error('unknown source'); storageReads++;
    return { body: createReadStream(path.join(sourceDir, file.name)), size: (await stat(path.join(sourceDir, file.name))).size }; },
} });
await app.ready();
const endpoint = '/api/objects/OBJ-PAIR-QA/files/F0171/pages/88/preview';
assert.equal((await app.inject({ method: 'GET', url: endpoint })).statusCode, 401);
assert.equal((await app.inject({ method: 'GET', url: endpoint.replace('OBJ-PAIR-QA', 'OBJ-foreign'), headers: { cookie: `inspector_session=${token}` } })).statusCode, 404);
assert.equal(storageReads, 0);
assert.equal((await app.inject({method:'GET',url:`/api/checks/${v4.check.id}`,headers:{cookie:`inspector_session=${token}`}})).statusCode, 200);
const entryUrl = "/@fs/" + path.join(output, "entry.tsx");
const html = '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ПД / РД — локальная приёмка</title><style>body{margin:0;background:#f4f6f7;font-family:Arial,sans-serif;color:#172e35}*{box-sizing:border-box}main{max-width:1480px;margin:auto;padding:12px}</style></head><body><main id="root"></main><script type="module" src="' + entryUrl + '"></script></body></html>';
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {RealDocumentPairsPanel} from '/@fs/${root}/apps/web/src/RealDocumentPairs.tsx';
import {SourceAuditV4FullWorkspace} from '/@fs/${root}/apps/web/src/SourceAuditV4FullWorkspace.tsx';
createRoot(document.getElementById('root')).render(<><RealDocumentPairsPanel objectId="OBJ-PAIR-QA" checkId="CHK-COMPARE-QA" files={${JSON.stringify(files)}}/>
<SourceAuditV4FullWorkspace objectId="OBJ-PAIR-QA" file={${JSON.stringify(files[1])}} reviewHash={null} canRun={false}/></>);`;
let vite, browser, activePage;
const checks = [];
const pass = name => { checks.push(name); process.stdout.write(`PASS ${name}\n`); };
try {
  vite = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: Number(args['--port'] ?? 28187), strictPort: true, fs: { allow: [root] } },
    plugins: [{ name: 'pair-browser-qa-only', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.url?.startsWith('/api/')) {
            const response = await app.inject({ method: 'GET', url: req.url, headers: { cookie: req.headers.cookie ?? '' } });
            res.writeHead(response.statusCode, response.headers); res.end(response.rawPayload); return;
          }
          if (req.url === '/__pair-qa') { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__pair-qa', html)); return; }
          next();
        } catch (error) { next(error); }
      });
    } }],
  });
  await writeFile(path.join(output, 'entry.tsx'), entry);
  await vite.listen();
  const base = `http://127.0.0.1:${vite.config.server.port}`;
  const require = createRequire(import.meta.url), { chromium } = require(process.env.INSPECTOR_PLAYWRIGHT_PATH);
  browser = await chromium.launch({ executablePath: process.env.INSPECTOR_CHROME_PATH ?? '/opt/google/chrome/chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'inspector_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/api/')) network.push({ url: new URL(response.url()).pathname + new URL(response.url()).search, status: response.status() }); });
  await page.goto(base + '/__pair-qa');
  const pd = page.getByRole('region', { name: 'Документ ПД', exact: true }), rd = page.getByRole('region', { name: 'Документ РД', exact: true });
  const loaded = async () => { await pd.locator('img.document-source-image[aria-busy]').waitFor({ state: 'detached', timeout: 60000 });
    await rd.locator('img.document-source-image[aria-busy]').waitFor({ state: 'detached', timeout: 60000 });
    await pd.locator('.inspector-evidence-box').first().waitFor({ timeout: 60000 }); await rd.locator('.inspector-evidence-box').first().waitFor({ timeout: 60000 }); };
  await loaded();
  assert.equal(await pd.getByLabel('Страница PDF ПД', { exact: true }).inputValue(), '88');
  assert.equal(await rd.getByLabel('Страница PDF РД', { exact: true }).inputValue(), '18');
  const pdBox = await pd.boundingBox(), rdBox = await rd.boundingBox(); assert(pdBox.x < rdBox.x && Math.abs(pdBox.y - rdBox.y) < 6);
  pass('real-147-two-original-pages-left-and-right');
  assert.equal(await page.locator('.document-pair-quote mark').count(), 4); pass('literal-text-differences-highlighted');
  await pd.getByRole('button', { name: 'Следующая страница ПД', exact: true }).click();
  await pd.getByRole('img', { name: 'ПД, исходная страница 89', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await rd.getByLabel('Страница PDF РД', { exact: true }).inputValue(), '18');
  assert.equal(await pd.locator('.inspector-evidence-box').count(), 0); pass('independent-paging-no-stale-frame');
  await pd.getByLabel('Лист ПД; прокрутка и перемещение', { exact: true }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await pd.getByRole('img', { name: 'ПД, исходная страница 90', exact: true }).waitFor({timeout:60000});
  assert.equal(await rd.getByLabel('Страница PDF РД', { exact: true }).inputValue(), '18');
  pass('keyboard-paging-stays-in-focused-document');
  await rd.getByLabel('Страница PDF РД', { exact: true }).fill('676'); await rd.getByRole('button', { name: 'Перейти к странице РД', exact: true }).click();
  await rd.getByRole('img', { name: 'РД, исходная страница 676', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await rd.getByRole('button', { name: 'Следующая страница РД', exact: true }).isDisabled(), true);
  pass('real-last-page-676-with-boundary');
  await page.getByRole('button', { name: 'К расхождению в обоих документах', exact: true }).click(); await loaded();
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector-evidence-pane')].every(pane => {
    const frame = pane.querySelector('.inspector-evidence-box--active')?.getBoundingClientRect(), viewport = pane.querySelector('.inspector-sheet-viewport')?.getBoundingClientRect();
    return frame && viewport && frame.x + frame.width / 2 >= viewport.x && frame.x + frame.width / 2 <= viewport.right
      && frame.y + frame.height / 2 >= viewport.y && frame.y + frame.height / 2 <= viewport.bottom;
  }));
  pass('jump-both-original-fragments-centered');
  await pd.getByLabel('Подсветка', { exact: true }).uncheck(); assert.equal(await pd.locator('.inspector-evidence-box').count(), 0);
  assert((await rd.locator('.inspector-evidence-box').count()) > 0); await pd.getByLabel('Подсветка', { exact: true }).check(); pass('independent-highlight-toggle');
  await pd.getByLabel('Страница PDF ПД', { exact: true }).fill('178'); await pd.getByRole('button', { name: 'Перейти к странице ПД', exact: true }).click();
  assert.equal(await pd.getByLabel('Страница PDF ПД', { exact: true }).evaluate(input => input.validity.rangeOverflow), true);
  assert.equal(await pd.getByRole('img', { name: 'ПД, исходная страница 88', exact: true }).count(), 1);
  await pd.getByLabel('Страница PDF ПД', { exact: true }).fill('88'); pass('page-input-cannot-request-out-of-range');
  await page.getByRole('button', { name: 'К расхождению в обоих документах', exact: true }).click(); await loaded();
  await page.waitForFunction(() => [...document.querySelectorAll('.inspector-evidence-pane')].every(pane => {
    const frame = pane.querySelector('.inspector-evidence-box--active')?.getBoundingClientRect(), viewport = pane.querySelector('.inspector-sheet-viewport')?.getBoundingClientRect();
    return frame && viewport && frame.x + frame.width / 2 >= viewport.x && frame.x + frame.width / 2 <= viewport.right
      && frame.y + frame.height / 2 >= viewport.y && frame.y + frame.height / 2 <= viewport.bottom;
  }));
  await writeFile(path.join(output, 'viewport-geometry.json'), JSON.stringify(await page.locator('.inspector-evidence-pane').evaluateAll(panes => panes.map(pane => {
    const viewport = pane.querySelector('.inspector-sheet-viewport'), frame = pane.querySelector('.inspector-evidence-box--active');
    return {scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop,viewport:viewport.getBoundingClientRect().toJSON(),frame:frame.getBoundingClientRect().toJSON()};
  })), null, 2));
  await page.screenshot({ path: path.join(output, 'desktop-147.png'), fullPage: true });
  await page.getByRole('button', { name: 'Помещение 198', exact: true }).click(); await loaded();
  assert((await page.locator('.document-pair-quote').first().innerText()).includes('В2.2 / В2.3'));
  assert((await page.locator('.document-pair-quote').nth(1).innerText()).includes('В2.8 / В2.9 / В2.10'));
  pass('real-198-navigation-updates-both-quotes-and-frames');
  await page.getByRole('button', { name: 'Развернуть сравнение', exact: true }).click();
  assert.equal(await page.locator('.document-pair-workspace--wide').count(), 1);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.document-pair-workspace--wide').count(), 0); pass('wide-comparison-open-and-escape-close');
  await page.getByRole('button', { name: 'Два документа на весь экран', exact: true }).click();
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), true); await page.evaluate(() => document.exitFullscreen()); pass('paired-fullscreen');
  for (const width of [768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: path.join(output, `responsive-${width}.png`), fullPage: true }); pass(`responsive-${width}-no-horizontal-overflow`);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('checkbox', { name: 'Связать масштаб и прокрутку', exact: true }).check();
  await pd.getByRole('button', { name: 'Увеличить ПД', exact: true }).click();
  await page.waitForFunction(() => { const values = [...document.querySelectorAll('.inspector-viewer-toolbar output')].map(node => node.textContent); return values.length === 2 && values[0] === values[1]; });
  pass('linked-zoom');
  await loaded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const viewport = pd.getByLabel('Лист ПД; прокрутка и перемещение', { exact: true });
  await viewport.evaluate(node => { node.scrollLeft = (node.scrollWidth - node.clientWidth) * .63; node.scrollTop = (node.scrollHeight - node.clientHeight) * .42; });
  await page.waitForFunction(() => {
    const panes = [...document.querySelectorAll('.document-pair-columns .inspector-sheet-viewport')];
    const normalized = panes.map(node => [node.scrollLeft / Math.max(1, node.scrollWidth - node.clientWidth), node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight)]);
    return normalized.length === 2 && Math.abs(normalized[0][0] - normalized[1][0]) < .02 && Math.abs(normalized[0][1] - normalized[1][1]) < .02;
  });
  pass('linked-scroll-normalized-independent-page-frames');
  const full = page.getByRole('region', { name: 'Полный аудит исходного текста V4', exact: true });
  await full.getByText('Исходный текст готов', { exact: false }).waitFor();
  assert.equal(await full.getByRole('button', { name: 'Полный аудит PDF до 1024 страниц', exact: true }).isDisabled(), true);
  await full.getByRole('button', { name: 'Загрузить текст выбранного PDF', exact: true }).click();
  await Promise.race([
    full.getByText('Исходных страниц: 676.', { exact: false }).waitFor({ timeout: 60000 }),
    full.getByRole('alert').waitFor({timeout:60000}).then(async () => {throw Error(await full.getByRole('alert').innerText());}),
  ]);
  const batches = network.filter(item => item.url.includes('/source-text-v4-full-source-v1/pages?'));
  assert.equal(batches.length, 6); assert(batches.every(item => item.status === 200));
  const starts = batches.map(item => Number(new URL(item.url, base).searchParams.get('startPage')));
  assert.deepEqual(starts, [1,129,257,385,513,641]);
  for (const item of batches.slice(1)) assert.equal(new URL(item.url, base).searchParams.get('expectedArtifactContentHash'), v4.sourceRead.textArtifactContentHash);
  assert((await full.innerText()).includes('Строк текста: 50887'));
  pass('v4-all-676-pages-six-hash-pinned-batches-before-search');
  await full.getByLabel('Текст для поиска', { exact: true }).fill(v4.lateQuery);
  await full.getByText('Совпадений в сохранённом тексте: 1.', { exact: true }).waitFor();
  await full.getByRole('button', { name: 'Открыть строку на PDF', exact: true }).click();
  await full.getByRole('img', { name: `UNRESOLVED, исходная страница ${v4.latePage}`, exact: true }).waitFor({ timeout: 60000 });
  await full.locator('.inspector-evidence-box--active').waitFor();
  await full.locator('.inspector-evidence-pane').scrollIntoViewIfNeeded();
  await full.screenshot({ path: path.join(output, 'v4-late-page-676.png') });
  pass('v4-unique-last-page-quote-opens-original-png-with-highlight');
  await writeFile(path.join(output, 'v4-source-origin.json'), JSON.stringify({check: v4.check, sourceSha256:v4.sourceRead.sourceSha256,
    textArtifactByteSha256:v4.sourceRead.textArtifactByteSha256,textArtifactContentHash:v4.sourceRead.textArtifactContentHash,
    lateQuery:v4.lateQuery,latePage:v4.latePage,lateLine:v4.lateLine,batches}, null, 2));
  await page.getByRole('checkbox', { name: 'Связать масштаб и прокрутку', exact: true }).uncheck();
  const pairedSearch = page.locator('.document-pair-column').nth(1).locator('.pair-source-search');
  await pairedSearch.locator('summary').click();
  await pairedSearch.getByRole('button', {name:'Загрузить текст для поиска',exact:true}).click();
  await pairedSearch.getByText('Страниц: 676.',{exact:false}).waitFor({timeout:60000});
  assert((await pairedSearch.innerText()).includes('из аудита CHK-V4-REAL-QA'));
  await pairedSearch.getByLabel('Текст для поиска',{exact:true}).fill(v4.lateQuery);
  await pairedSearch.getByRole('button').filter({hasText:'Стр. 676:'}).click();
  await rd.getByRole('img',{name:'РД, исходная страница 676',exact:true}).waitFor({timeout:60000});
  await rd.locator('.inspector-evidence-box--active').waitFor();
  assert.equal(await pd.getByLabel('Страница PDF ПД',{exact:true}).inputValue(),'88');
  pass('paired-search-opens-late-page-without-changing-other-side-or-comparison');
  await page.getByRole('button',{name:'К расхождению в обоих документах',exact:true}).click(); await loaded();
  assert.equal(await rd.getByLabel('Страница PDF РД',{exact:true}).inputValue(),'18');
  pass('jump-restores-original-disagreement-after-search');
  await page.getByLabel('Документ для ПД',{exact:true}).selectOption('F0201');
  await pd.getByRole('img',{name:'ПД, исходная страница 1',exact:true}).waitFor({timeout:60000});
  assert.equal(await pd.locator('.inspector-evidence-box').count(),0);
  assert.equal(await pd.getByLabel('Страница PDF ПД',{exact:true}).getAttribute('max'),'676');
  await page.getByRole('button',{name:'К расхождению в обоих документах',exact:true}).click(); await loaded();
  assert.equal(await pd.getByLabel('Документ для ПД',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('Документ для ПД',{exact:true}).inputValue(),'F0171');
  pass('source-switch-clears-old-frames-and-restores-correct-hash-on-jump');
  await page.getByRole('button',{name:'Вместимость · PZ-013',exact:true}).click(); await loaded();
  assert.equal(await pd.getByLabel('Страница PDF ПД',{exact:true}).inputValue(),'1');
  assert.equal(await rd.getByLabel('Страница PDF РД',{exact:true}).inputValue(),'5');
  assert((await page.getByRole('region',{name:'Сравнение реальных ПД и РД',exact:true}).innerText()).includes('получены OCR'));
  await page.getByLabel('Фрагмент РД',{exact:true}).selectOption({label:'Стр. 7 · 600'}); await loaded();
  assert.equal(await rd.getByLabel('Страница PDF РД',{exact:true}).inputValue(),'7');
  await page.getByRole('region',{name:'Сравнение реальных ПД и РД',exact:true}).screenshot({path:path.join(output,'capacity-rotated-ocr-page7.png')});
  pass('real-capacity-pair-with-separate-ocr-label-and-rotated-page7-frame');
  await page.getByRole('button',{name:'П17 · IOS4-079',exact:true}).click(); await loaded();
  assert.equal(await pd.getByLabel('Страница PDF ПД',{exact:true}).inputValue(),'156');
  assert.equal(await rd.getByLabel('Страница PDF РД',{exact:true}).inputValue(),'272');
  await pd.getByRole('button',{name:'Следующая страница ПД',exact:true}).click();
  await pd.getByRole('img',{name:'ПД, исходная страница 157',exact:true}).waitFor({timeout:60000});
  await page.getByLabel('Фрагмент РД',{exact:true}).selectOption({label:'Стр. 279 · 5720'});
  await rd.getByRole('img',{name:'РД, исходная страница 279',exact:true}).waitFor({timeout:60000});
  await rd.locator('.inspector-evidence-box--active').waitFor();
  assert.equal(await pd.getByLabel('Страница PDF ПД',{exact:true}).inputValue(),'157');
  await page.getByRole('button',{name:'К расхождению в обоих документах',exact:true}).click(); await loaded();
  assert.equal(await pd.getByLabel('Страница PDF ПД',{exact:true}).inputValue(),'156');
  assert.equal(await rd.getByLabel('Страница PDF РД',{exact:true}).inputValue(),'279');
  await page.getByRole('region',{name:'Сравнение реальных ПД и РД',exact:true}).screenshot({path:path.join(output,'p17-paired-source-flows.png')});
  pass('real-p17-both-rd-members-and-independent-fragment-navigation');
  assert.deepEqual(errors, []);
  assert(network.every(item => item.status === 200 || item.status === 429));
  pass('no-browser-exceptions-or-unexpected-api-failures');
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ status: 'PASS_LOCAL_BROWSER_PAIR_COMPONENT_AND_REAL_PDF_ROUTE', startedAt,
    finishedAt: new Date().toISOString(), browser: browser.version(), checks, sourceFiles: files, storageReads, network, errors,
    v4: {pageCount:676,lineCount:50887,latePage:v4.latePage,artifactContentHash:v4.sourceRead.textArtifactContentHash},
    boundaries: ['Production React components and authenticated Fastify PNG route; source repository/session are scoped test fixtures.',
      'No real database/queue/review writes or calibration acceptance.', 'No historical visual baseline; screenshots are a first baseline.', 'No H100/CUDA/model inference.'] }, null, 2) + '\n');
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await writeFile(path.join(output,'first-red-scroll-geometry.json'), JSON.stringify(await activePage.locator('.inspector-evidence-pane').evaluateAll(panes => panes.map(pane => {
      const node=pane.querySelector('.inspector-sheet-viewport'), sheet=pane.querySelector('.inspector-sheet');
      return {stage:pane.getAttribute('aria-label'),zoom:pane.querySelector('output')?.textContent,
        left:node?.scrollLeft,top:node?.scrollTop,width:node?.clientWidth,height:node?.clientHeight,
        scrollWidth:node?.scrollWidth,scrollHeight:node?.scrollHeight,sheetWidth:sheet?.offsetWidth,sheetHeight:sheet?.offsetHeight};
    })),null,2)).catch(() => {});
    await activePage.screenshot({path:path.join(output,'first-red.png'),fullPage:true}).catch(() => {});
    await writeFile(path.join(output,'first-red-dom.txt'),await activePage.locator('body').innerText()).catch(() => {});
  }
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ status: 'FIRST_RED', startedAt, checks, errors, network, error: String(error), stack: error.stack }, null, 2));
  throw error;
} finally { await browser?.close(); await vite?.close(); await app.close(); }
