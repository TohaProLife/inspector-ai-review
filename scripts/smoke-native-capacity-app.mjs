#!/usr/bin/env node
/** Opt-in local acceptance. Actual authored PDFs -> Python V4 -> PG -> production API/App.
 * node --import tsx scripts/smoke-native-capacity-app.mjs --admin-url-file SECRET --output DIR
 * Exported fixture also serves the focused PG test. No real-project/ML/queue-delivery claim.
 */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createServer } from 'vite';
import { buildApp } from '../apps/api/src/app.ts';
import { PostgresInspectionRepository } from '../apps/api/src/postgres-repository.ts';
import { runDatabaseMigrations } from '../apps/api/src/database-migrations.ts';
import { LocalObjectStorage } from '../apps/api/src/storage.ts';
import { loadReferenceData } from '../apps/api/src/reference-data.ts';
import { provisionLocalUser } from '../apps/api/src/user-provisioning.ts';

const root = path.resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const boundary = ['Synthetic authored three-page Cyrillic PDFs, independent expected capacity600 on pages1/3 of each source.',
  'Actual Python V4 producer, complete original SHA, production authenticated Fastify, disposable PostgreSQL and full App/CSS/PDF preview.',
  'Local transport/identity fixture only; no Rabbit/ML/real-project engineering qualification, no review decisions or production changes.'];
const pythonBin = process.env.PYTHON_BIN ?? process.env.INSPECTOR_PYTHON_BIN ?? path.join(root, 'services/worker/.venv/bin/python');
function python(code, input) {
  const child = spawnSync(pythonBin, ['-c', code], { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 33554432,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: path.join(root, 'services/worker') },
    input: input === undefined ? undefined : JSON.stringify(input) });
  assert.equal(child.status, 0, child.stderr); return child.stdout;
}

export async function seedNativeCapacityFixture(adminUrl, { seal = true, scenario = 'CAPACITY' } = {}) {
  assert(['CAPACITY', 'AIRFLOW', 'OCR'].includes(scenario), 'Unknown authored native source scenario');
  const databaseName = `native_${scenario.toLowerCase()}_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  let db, repo, app, directory, created = false;
  async function close() {
    if (app) await app.close(); else await repo?.close();
    await db?.end(); if (created) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end(); if (directory) await rm(directory, { recursive: true, force: true });
  }
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    const connection = new URL(adminUrl); connection.pathname = `/${databaseName}`;
    await runDatabaseMigrations(connection.toString()); db = new Pool({ connectionString: connection.toString(), max: 5 });
    directory = await mkdtemp(path.join(tmpdir(), 'native-capacity-'));
    python(`import json,sys,fitz\nfrom pathlib import Path\nx=json.load(sys.stdin)\nfor role in ('PD','RD','FOREIGN'):\n d=fitz.open()\n for n in range(1,4):\n  p=d.new_page(width=595,height=842);p.insert_font(fontname='qa',fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')\n  if x['scenario']=='OCR':\n   if n==1: p.insert_text((70,100),'Исходная текстовая страница '+role,fontname='qa',fontsize=18)\n   elif n==2:\n    image=fitz.open();q=image.new_page(width=595,height=842);q.insert_font(fontname='qa',fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')\n    q.insert_text((70,100),'107,687 кВт (0,926 Гкал/час)',fontname='qa',fontsize=18)\n    q.insert_text((70,140),'<script>window.OCR_XSS=1</script>',fontname='qa',fontsize=14)\n    p.insert_image(p.rect,stream=q.get_pixmap().tobytes('png'));image.close()\n   else: p.draw_rect(fitz.Rect(30,30,565,812))\n  elif x['scenario']=='AIRFLOW':\n   texts=(['П17 (L=9060 м3/ч, Pc=350 Па)'] if role=='PD' else ['Проект: П17.1 (L=3340 м3/ч, Pc=540 Па)','Проект: П17.2 (L=5720 м3/ч, Pc=540 Па)']) if n in (1,3) else ['Нейтральная страница без характеристик']\n   for i,text in enumerate(texts): p.insert_text((70,100+i*35),text,fontname='qa',fontsize=18)\n   p.insert_text((70,180),'QA '+role+' PAGE '+str(n),fontname='qa',fontsize=12)\n  else:\n   text='Школа на 600 мест' if n in (1,3) else 'Нейтральная страница без вместимости'\n   p.insert_text((70,100),text,fontname='qa',fontsize=18)\n   p.insert_text((70,150),'QA '+role+' PAGE '+str(n),fontname='qa',fontsize=12)\n d.save(str(Path(x['directory'])/(role+'.pdf')));d.close()`, { directory, scenario });
    const storage = new LocalObjectStorage(directory), parameters = (await loadReferenceData()).parameters;
    const organizationSlug = `native-capacity-${randomUUID()}`;
    repo = await PostgresInspectionRepository.create({ connectionString: connection.toString(), organizationSlug, parameters,
      analysisProfile: 'MATRIX_V1', storage });
    const objectId = (await repo.createObject({ name: scenario === 'AIRFLOW' ? 'Synthetic NativeAirflow · П17' : 'Synthetic NativeCapacity · 600 мест', address: 'Локальный QA, без инженерного заключения' })).id;
    const foreignObjectId = (await repo.createObject({ name: 'Foreign NativeCapacity neighbour', address: 'Local QA' })).id;
    const identities = [];
    for (const permitted of [true, false]) {
      const user = await provisionLocalUser(db, { organizationSlug, login: `qa-${randomUUID()}`, displayName: 'NativeCapacity QA',
        password: 'Synthetic-NativeCapacity-2026!', objectApiIds: permitted ? [objectId] : [], objectPermissions: scenario === 'OCR' ? ['READ', 'RUN', 'REVIEW_DECIDE'] : ['READ', 'RUN'] });
      identities.push({ sessionId: randomUUID(), userId: user.id, organizationId: user.organizationId, displayName: 'NativeCapacity QA',
        roles: ['INSPECTOR'], capabilities: ['SOURCE_REVIEW', 'RUN_START'], csrfHash: '', expiresAt: '2030-01-01T00:00:00Z' });
    }
    const [actor, foreignActor] = identities, token = randomBytes(32).toString('hex'), foreignToken = randomBytes(32).toString('hex');
    const files = [];
    for (const role of ['PD', 'RD', 'FOREIGN']) {
      const bytes = await readFile(path.join(directory, `${role}.pdf`));
      const file = { id: `FIL-${randomUUID()}`, name: `${role}.pdf`, stage: role === 'PD' ? 'PD' : 'RD', size: bytes.length,
        mimeType: 'application/pdf', sha256: sha(bytes), scanStatus: 'CLEAN', status: 'STORED', storageKey: `${role}.pdf` };
      await repo.registerIngestedFiles(role === 'FOREIGN' ? foreignObjectId : objectId, [file]); files.push(file);
    }
    const workerToken = 'native-capacity-local-worker';
    app = await buildApp({ repository: repo, storage, workerToken, openWorkspace: true, identityService: {
      login: async () => undefined, createOpenWorkspaceSession: async () => ({ actor, sessionToken: token, csrfToken: 'native-qa-csrf' }),
      resolveSession: async value => value === token ? actor : value === foreignToken ? foreignActor : undefined,
      verifyCsrf: (_actor, value) => value === 'native-qa-csrf', revokeSession: async () => {}, close: async () => {},
    } });
    const headers = { cookie: `inspector_session=${token}; inspector_csrf=native-qa-csrf`, 'x-csrf-token': 'native-qa-csrf' };
    const started = await app.inject({ method: 'POST', url: `/api/objects/${objectId}/source-audit-v4-full-source-v1`,
      headers: { ...headers, 'idempotency-key': randomUUID() }, payload: {} });
    assert.equal(started.statusCode, 201, started.body); const checkId = started.json().id;
    let results;
    async function claim(type) {
      const rows = (await db.query("SELECT job.id FROM analysis_jobs job JOIN analysis_runs run ON run.id=job.run_id WHERE run.api_id=$1 AND job.job_type=$2 AND job.state='READY'", [checkId, type])).rows;
      assert.equal(rows.length, 1); const acquired = await repo.claimJob(rows[0].id, { workerId: 'native-capacity-qa', capabilities: [type] });
      assert.equal(acquired.kind, 'acquired'); return { id: rows[0].id, lease: acquired.lease,
        attempt: { attemptId: acquired.lease.attemptId, fencingToken: acquired.lease.fencingToken } };
    }
    async function finish() {
      const inventory = await claim('ANALYSIS_INVENTORY');
      assert.equal((await repo.completeJob(inventory.id, { ...inventory.attempt, result: {
        disposition: 'MANIFEST_INVENTORIED', sourceCount: 2, stageCounts: { PD: 1, RD: 1, ID: 0 } } })).kind, 'completed');
      const text = await claim('DOCUMENT_TEXT_LAYER');
      results = JSON.parse(python(`import json,sys,shutil,os,hashlib\nfrom pathlib import Path\nfrom unittest.mock import patch\nfrom inspector_worker import durable_text_v4_full as mod\nx=json.load(sys.stdin)\ndef download(key,destination,expected_sha,expected_size,attempt):\n source=next(f for f in x['files'] if f['id']==key.rsplit('/',1)[-1])\n original=Path(x['directory'])/source['storageKey'];assert original.stat().st_size==expected_size\n assert hashlib.sha256(original.read_bytes()).hexdigest()==expected_sha;shutil.copyfile(original,destination)\nos.environ.pop('INSPECTOR_DURABLE_TEXT_CACHE_ROOT',None)\nwith patch.object(mod,'_download_source',side_effect=download):\n result=mod.process_document_text_layer_v4_full(x['lease'],x['attempt'],'native-capacity-qa')\njson.dump(result,sys.stdout,ensure_ascii=False,separators=(',',':'))`, { ...text, directory, files }));
      assert.equal(results.sources.length, 2);
      for (const source of results.sources) { assert.equal(source.artifact.pageCount, 3);
        assert.equal(source.inputSha256, files.find(file => file.id === source.sourceFileId).sha256); }
      const response = await app.inject({ method: 'POST', url: `/api/internal/v1/jobs/${text.id}/complete-source-audit-v4-full-source-v1`,
        headers: { 'x-worker-token': workerToken, 'content-type': 'application/json' }, payload: JSON.stringify({ ...text.attempt, result: results }) });
      assert.equal(response.statusCode, 200, response.body);
      for (const type of ['DOCUMENT_RENDER', 'DOCUMENT_METADATA', 'DOCUMENT_LINKING', 'ENTITY_EXTRACTION', 'RULE_EVALUATION', 'EVIDENCE_VALIDATION']) {
        const job = await claim(type);
        const result = JSON.parse(python("import json,sys\nfrom inspector_worker.stage_scaffold import DEFAULT_STAGE_PROVIDER_REGISTRY\nx=json.load(sys.stdin)\njson.dump(DEFAULT_STAGE_PROVIDER_REGISTRY.execute(x['type'],x['lease'],x['attempt']),sys.stdout)", { type, ...job }));
        assert.equal(result.outputCount, 0); assert.equal((await repo.completeJob(job.id, { ...job.attempt, result })).kind, 'completed');
      }
      const job = await claim('ANALYSIS_SEAL_UNSUPPORTED');
      assert.equal((await repo.completeJob(job.id, { ...job.attempt, result: { disposition: 'UNSUPPORTED_COVERAGE_SEALED' } })).kind, 'completed');
      return results;
    }
    if (seal) await finish();
    return { admin, db, repo, app, directory, scenario, connectionString: connection.toString(), organizationSlug, parameters, actor, foreignActor,
      token, foreignToken, headers, objectId, foreignObjectId, checkId, files, finish, get results() { return results; }, close };
  } catch (error) { await close(); throw error; }
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
  const pins = async () => Promise.all(['scripts/smoke-native-capacity-app.mjs', 'apps/api/src/app.ts', 'apps/api/src/postgres-native-capacity.ts',
    'apps/api/src/native-capacity-comparison.ts', 'apps/api/src/native-capacity-routes.ts', 'apps/api/src/native-capacity-input.ts',
    'apps/api/src/postgres-repository.ts', 'apps/api/src/postgres-document-text-v4-full-source.ts', 'apps/api/src/pdf-preview.ts',
    'apps/api/src/api-contract.ts', 'migrations/048_native_capacity_comparisons.sql', 'apps/web/src/App.tsx', 'apps/web/src/api.ts',
    'apps/web/src/NativeCapacityWorkspace.tsx', 'apps/web/src/SourceAuditV4FullWorkspace.tsx', 'apps/web/src/DocumentPairWorkspace.tsx',
    'apps/web/src/SourceReviewScreen.tsx', 'apps/web/src/source-preview-loader.ts', 'apps/web/src/InspectorEvidenceViewer.tsx',
    'services/worker/inspector_worker/document_text_v4.py', 'services/worker/inspector_worker/durable_text_v4_full.py',
    'apps/web/src/styles.css', 'apps/web/src/themes.css', 'apps/web/src/workspace.css']
    .map(async file => ({ path: file, sha256: sha(await readFile(path.join(root, file))) })));
  const initialPins = await pins(); await writeFile(path.join(output, 'source-pins-start.json'), JSON.stringify(initialPins, null, 2));
  async function screenshot(name, fullPage = true) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage }); screenshots.push(`${name}.png`); }
  try {
    fixture = await seedNativeCapacityFixture((await readFile(args['--admin-url-file'], 'utf8')).trim());
    await writeFile(path.join(output, 'fixture.json'), JSON.stringify({ objectId: fixture.objectId, checkId: fixture.checkId,
      files: fixture.files, boundary, nativeArtifacts: fixture.results.sources.map(source => ({ sourceFileId: source.sourceFileId,
        inputSha256: source.inputSha256, artifact: source.artifact })) }, null, 2));
    vite = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'),
      server: { host: '127.0.0.1', port: 28192, strictPort: true, fs: { allow: [root] } }, plugins: [{ name: 'native-capacity-production-api', configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/api/')) return next();
          try {
            assert(request.method === 'GET' || request.method === 'POST' && (request.url === '/api/auth/open-workspace'
              || /^\/api\/checks\/[^/]+\/native-capacity-comparisons$/.test(request.url)), 'Unexpected mutation');
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const result = await fixture.app.inject({ method: request.method, url: request.url, headers: request.headers,
              ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}) });
            requests.push({ method: request.method, url: request.url, status: result.statusCode, contentType: result.headers['content-type'],
              ...(request.url.includes('native-capacity') ? { body: result.json() } : {}),
              ...(result.statusCode >= 400 && result.headers['content-type']?.includes('application/json') ? { errorBody: result.json() } : {}) });
            response.writeHead(result.statusCode, result.headers); response.end(result.rawPayload);
          } catch (error) { next(error); }
        });
      } }] }); await vite.listen();
    const { chromium } = createRequire(import.meta.url)(process.env.INSPECTOR_PLAYWRIGHT_PATH
      ?? '/home/freetok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light', acceptDownloads: true });
    page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('requestfailed', request => resourceErrors.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => { if (!response.url().includes('/api/') && response.status() >= 400)
      resourceErrors.push({ url: response.url(), status: response.status() }); });
    async function openWorkspace({ navigate = true } = {}) {
      if (navigate) await page.goto('http://127.0.0.1:28192/');
      const landing = page.getByRole('button', { name: /Открыть кабинет/ }).first();
      const home = page.getByRole('heading', { name: 'Объекты проверки', exact: true });
      await Promise.any([landing.waitFor({ state: 'visible' }), home.waitFor({ state: 'visible' })]);
      if (await landing.isVisible()) await landing.click();
      await home.waitFor();
      await page.getByRole('button', { name: 'Открыть проверку', exact: true }).first().click();
      await page.getByRole('button', { name: 'Исходные документы', exact: true }).click();
      await page.getByRole('button', { name: 'Открыть сверку вместимости ПД/РД', exact: true }).click();
    }
    await openWorkspace(); pass('production-App-scoped-PG-V4-workspace');
    await page.getByRole('combobox', { name: 'ПД для сверки вместимости', exact: true }).selectOption(fixture.files[0].id);
    await page.getByRole('combobox', { name: 'РД для сверки вместимости', exact: true }).selectOption(fixture.files[1].id);
    await page.getByRole('button', { name: 'Сравнить вместимость по исходному тексту', exact: true }).click();
    await page.getByText('Заявленная вместимость совпадает: 600 / 600 мест', { exact: true }).waitFor();
    const post = requests.find(row => row.method === 'POST' && row.url.endsWith('/native-capacity-comparisons'));
    assert.equal(post?.status, 201); assert.equal(post.body.comparison.p, null); assert.equal(post.body.comparison.factEligible, false);
    const record = post.body; pass('actual-POST-source-only-capacity600-native-quotes');
    const pair = page.getByRole('region', { name: 'Вместимость: ПД и РД рядом', exact: true });
    for (const role of ['ПД', 'РД']) {
      await pair.getByRole('combobox', { name: `Фрагмент ${role}`, exact: true }).selectOption({ index: 1 });
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
        await screenshot(`native-capacity-${width}-${mode}`);
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
    await page.getByRole('button', { name: 'Скачать JSON сверки вместимости', exact: true }).click();
    const download = await downloadPending; assert.equal(await download.failure(), null);
    await download.saveAs(path.join(output, 'capacity-record.json'));
    assert.deepEqual(JSON.parse(await readFile(path.join(output, 'capacity-record.json'), 'utf8')), record);
    pass('downloaded-JSON-exact-record-source-bindings');
    await page.reload(); await openWorkspace({ navigate: false });
    await page.getByText('Заявленная вместимость совпадает: 600 / 600 мест', { exact: true }).waitFor();
    const persisted = (await fixture.app.inject({ url: `/api/checks/${fixture.checkId}/native-capacity-comparisons`, headers: fixture.headers })).json();
    assert.equal(persisted.items.length, 1); assert.deepEqual(persisted.items[0], record);
    assert.equal(await page.getByRole('combobox', { name: 'Сохранённая сверка вместимости', exact: true }).inputValue(), record.id);
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
    await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ status: 'PASS_NATIVE_CAPACITY_APP_LOCAL', startedAt,
      finishedAt: new Date().toISOString(), checks, issues, requests, screenshots, layouts, browserErrors, consoleMessages, resourceErrors, emptyReviewResponses, boundary }, null, 2));
  } catch (error) {
    if (page) { await screenshot('first-red').catch(() => {}); await writeFile(path.join(output, 'first-red-body.txt'), await page.locator('body').innerText().catch(() => '')); }
    if (page) await writeFile(path.join(output, 'first-red-document.html'), await page.content().catch(() => ''));
    await writeFile(path.join(output, 'first-red.json'), JSON.stringify({ status: 'FIRST_RED', error: error.stack ?? String(error), checks,
      requests, screenshots, layouts, browserErrors, consoleMessages, resourceErrors, boundary }, null, 2)); throw error;
  } finally { await browser?.close(); await vite?.close(); await fixture?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
