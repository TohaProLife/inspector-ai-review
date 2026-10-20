#!/usr/bin/env node
/** Full App export acceptance with a synthetic NORMAL snapshot in disposable PG.
 * Production auth, API, renderer and byte cache; no engineering/queue/finalize claim.
 * node --import tsx scripts/smoke-protocol-export-app.mjs --admin-url-file SECRET --output DIR
 * Optional INSPECTOR_PLAYWRIGHT_PATH and INSPECTOR_PYTHON_BIN override local runtime paths.
 */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Pool } from 'pg';
import { createServer } from 'vite';
import { buildApp } from '../apps/api/src/app.ts';
import { PostgresInspectionRepository } from '../apps/api/src/postgres-repository.ts';
import { runDatabaseMigrations } from '../apps/api/src/database-migrations.ts';
import { canonicalJson } from '../apps/api/src/canonical-json.ts';

const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
assert.equal(argv.length % 2, 0, 'Arguments must be key/value pairs');
const args = Object.fromEntries(argv.reduce((rows, value, index) => index % 2 ? rows : [...rows, [value, argv[index + 1]]], []));
assert(args['--admin-url-file'] && args['--output'], 'Provide --admin-url-file SECRET --output DIR');
const output = path.resolve(args['--output']); await mkdir(output, { recursive: true });
await mkdir(path.join(output, 'downloads'), { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], issues = [], requests = [], browserErrors = [], mutations = [], screenshots = [], downloads = [], layouts = [];
const startedAt = new Date().toISOString();
const databaseName = `protocol_browser_${randomUUID().replaceAll('-', '')}`;
const sourceFiles = ['scripts/smoke-protocol-export-app.mjs', 'apps/api/src/app.ts', 'apps/api/src/api-contract.ts',
  'apps/api/src/protocol-report-routes.ts', 'apps/api/src/protocol-report-model.ts', 'apps/api/src/protocol-report-renderer.ts',
  'apps/api/src/protocol-report-document.ts', 'apps/api/src/postgres-repository.ts', 'migrations/047_protocol_rendered_artifacts.sql',
  'apps/web/src/main.tsx', 'apps/web/src/App.tsx', 'apps/web/src/ProtocolDownloads.tsx', 'apps/web/src/api.ts',
  'apps/web/src/styles.css', 'apps/web/src/workspace.css', 'apps/web/src/themes.css', 'apps/web/src/color-mode.css',
  'apps/api/assets/protocol-fonts/DejaVuSans.ttf', 'apps/api/assets/protocol-fonts/DejaVuSans-Bold.ttf'];
const pins = async () => Promise.all(sourceFiles.map(async file => ({ path: file, sha256: sha(await readFile(path.join(root, file))) })));
const startPins = await pins(); await writeFile(path.join(output, 'source-pins-start.json'), JSON.stringify(startPins, null, 2));
const admin = new Pool({ connectionString: (await readFile(args['--admin-url-file'], 'utf8')).trim(), max: 1 });
let db, repository, app, vite, browser, page, createdDatabase = false;
const pass = name => { checks.push(name); process.stdout.write(`PASS ${name}\n`); };
const expected = new Map(), baseline = new Map();
let actor, foreignActor, checkId, objectId, historical, current, bad, mutableFindings = [];
const token = randomBytes(32).toString('hex'), foreignToken = randomBytes(32).toString('hex');
const boundary = ['Synthetic NORMAL fixture, manually seeded frozen protocol snapshots. No real document analysis, queue delivery or finalization claim.',
  'Actual disposable PostgreSQL cache and production Fastify/auth/UI/rendering paths. Current findings are a scoped mutable fixture override.',
  'No production service changes, no review/decision writes through API, no signing/IAIS claim, no physical-device proof.'];
async function screenshot(name) { const file = `${name}.png`; await page.screenshot({ path: path.join(output, file), fullPage: true }); screenshots.push(file); }
async function extract(file, format, frozen) {
  const python = process.env.INSPECTOR_PYTHON_BIN ?? path.join(root, 'services/worker/.venv/bin/python');
  const code = `import json,sys,zipfile,xml.etree.ElementTree as E\np,fmt=sys.argv[1:3]\nif fmt=='pdf':\n import fitz\n d=fitz.open(p); t='\\n'.join(x.get_text() for x in d); out={'text':t,'pages':len(d),'embedded':d.embfile_get('canonical-snapshot.json').decode('utf8')}\nelif fmt=='docx':\n z=zipfile.ZipFile(p); t=E.fromstring(z.read('word/document.xml')); out={'text':''.join(t.itertext()),'names':z.namelist()}\nelse:\n r=E.parse(p).getroot(); out={'text':''.join(r.itertext()),'attributes':r.attrib,'embedded':r.find('{urn:inspector-ai:protocol-report:v1}canonicalSnapshot').text}\nprint(json.dumps(out,ensure_ascii=False))`;
  const result = spawnSync(python, ['-c', code, file, format], { encoding: 'utf8', maxBuffer: 8388608 });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert(value.text.includes(frozen.protocol.id), `${format} must name exact snapshot protocol`);
  assert(value.text.includes(frozen.hash), `${format} must name exact canonical snapshot hash`);
  assert(value.text.includes('SNAPSHOT-FROZEN'), `${format} must contain frozen object identity`);
  assert(!value.text.includes('CURRENT-LIVE-MUTATED'), `${format} must not rebuild live findings/object`);
  if (value.embedded) assert.equal(value.embedded, frozen.json, `${format} embeds exact canonical JSON`);
  await writeFile(`${file}.inspection.json`, JSON.stringify(value, null, 2));
}
async function clickDownload(version, format, name) {
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: `Скачать ${format.toUpperCase()} версии ${version}`, exact: true }).first().click();
  const event = await pending; assert.equal(await event.failure(), null);
  const file = path.join(output, 'downloads', `${name}-v${version}.${format}`); await event.saveAs(file);
  const bytes = await readFile(file), record = requests.filter(item => item.format === format && item.protocolVersion === version && item.status === 200).at(-1);
  assert(record, 'Actual successful API download must exist');
  const frozen = expected.get(version); assert.equal(sha(bytes), record.headers['x-content-sha256']);
  assert.equal(record.headers['x-protocol-snapshot-sha256'], frozen.hash);
  assert.equal(record.headers['content-type'].split(';')[0], { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xml: 'application/xml' }[format]);
  assert.equal(record.headers['cache-control'], 'private, no-store');
  assert.equal(record.headers.etag, `"sha256-${sha(bytes)}"`);
  assert(event.suggestedFilename().endsWith(`-v${version}.${format}`));
  const key = `${version}/${format}`;
  if (baseline.has(key)) assert(bytes.equals(baseline.get(key)), `${key} repeated bytes differ`);
  else { baseline.set(key, bytes); await extract(file, format, frozen); }
  downloads.push({ name: path.basename(file), version, format, bytes: bytes.length, sha256: sha(bytes), snapshotHash: frozen.hash, headers: record.headers });
}
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`); createdDatabase = true;
  const connection = new URL((await readFile(args['--admin-url-file'], 'utf8')).trim()); connection.pathname = `/${databaseName}`;
  await runDatabaseMigrations(connection.toString()); db = new Pool({ connectionString: connection.toString(), max: 3 });
  const organizationSlug = `protocol-browser-${randomUUID()}`;
  repository = await PostgresInspectionRepository.create({ connectionString: connection.toString(), organizationSlug, parameters: [] });
  const object = await repository.createObject({ name: 'Synthetic NORMAL export QA · SNAPSHOT-FROZEN', address: 'Локальная проверка экспорта; не инженерное заключение' }); objectId = object.id;
  const organizationId = (await db.query('SELECT id FROM organizations WHERE slug=$1', [organizationSlug])).rows[0].id;
  async function identity() {
    const id = (await db.query("INSERT INTO inspector_users(login,provider_subject,display_name) VALUES($1,$2,'Экспорт QA только чтение') RETURNING id", [`export-${randomUUID()}`, randomUUID()])).rows[0].id;
    return { sessionId: randomUUID(), userId: id, displayName: 'Экспорт QA только чтение', organizationId, roles: ['INSPECTOR'], capabilities: [], csrfHash: '', expiresAt: '2030-01-01T00:00:00Z' };
  }
  actor = await identity(); foreignActor = await identity();
  await db.query("INSERT INTO object_memberships(object_id,user_id,permission_set) SELECT id,$2,ARRAY['READ']::text[] FROM objects WHERE api_id=$1", [objectId, actor.userId]);
  const source = Buffer.from('Synthetic source registration metadata; original PDF not used by this fixture');
  await repository.registerIngestedFiles(objectId, [{ id: `FIL-${randomUUID()}`, name: 'synthetic-source.pdf', stage: 'PD', size: source.length, mimeType: 'application/pdf', sha256: sha(source), scanStatus: 'CLEAN', status: 'STORED', storageKey: 'fixture-not-read' }]);
  const check = await repository.startCheck(objectId); assert(check); checkId = check.id;
  await repository.completeCheck(checkId);
  const run = (await db.query('SELECT id,inspection_id FROM analysis_runs WHERE api_id=$1', [checkId])).rows[0];
  const finding = { id: 'QA-FROZEN-FINDING', checkId, groupId: 'QA-SYNTHETIC', parameterId: null, parameterCode: 'QA-001', title: 'Синтетическое сохранённое решение', location: 'Проверка выгрузки', status: 'CONFIRMED_VIOLATION', severity: 'CRITICAL', criticality: 'Только synthetic fixture', confidence: null, comparisonResult: 'SYNTHETIC_SNAPSHOT', documentStatus: 'UNVERIFIED', expectedValue: 'Фиксированное значение ПД', actualValue: 'Фиксированное значение РД', idValue: null, rationale: 'SYNTHETIC frozen rationale <&> Кириллица', evidence: [], decision: { type: 'CONFIRM', reason: 'Синтетическое решение для проверки сериализации', author: 'QA fixture', decidedAt: '2026-10-20T10:00:00.000Z' } };
  mutableFindings = [{ ...finding, id: 'QA-CURRENT', title: 'CURRENT-LIVE-V1' }];
  async function protocol(version, status, corrupt = false) {
    const protocolId = `PRT-EXPORT-QA-${version}-${randomUUID()}`;
    const protocol = { id: protocolId, checkId, version, status, createdAt: '2026-10-20T10:00:00.000Z', createdBy: 'Synthetic frozen fixture', stats: { total: 3, unsupported: 1, candidates: 1, confirmed: 1, negativeVerified: 0, notComparable: 0, clarification: 0, suspicion: 0 } };
    const snapshot = { schemaVersion: '1.0', protocol,
      scope: { organizationId, object: { id: objectId, name: `SNAPSHOT-FROZEN-V${version}`, address: 'Synthetic frozen address' }, inspection: { id: run.inspection_id, lifecycle: status === 'FINAL' ? 'FINALIZED' : 'OPEN', rowVersion: version }, run: { id: checkId, state: 'PARTIAL' } },
      integrity: { inputManifestHash: '1'.repeat(64), outputHash: '2'.repeat(64), decisionSetHash: '3'.repeat(64) },
      sources: [{ fileId: 'QA-SOURCE', fileName: 'synthetic-source.pdf', sha256: sha(source), byteSize: source.length, mediaType: 'application/pdf', stages: ['PD'] }],
      coverage: { totalParameters: 3, executedParameters: 2, unsupportedParameters: 1, gapsHash: '4'.repeat(64), gaps: [{ parameterId: 3, parameterCode: 'QA-UNSUPPORTED', parameterName: 'Синтетический пробел', executionStatus: 'UNSUPPORTED', reason: 'MISSING_ID: synthetic source unavailable' }], acknowledgement: null },
      findings: [finding, { ...finding, id: 'QA-FROZEN-CANDIDATE', status: 'CANDIDATE', severity: 'WARNING', decision: null, title: 'Не подтверждённый synthetic кандидат' }] };
    const json = canonicalJson(snapshot), hash = sha(json), storedBytes = corrupt ? Buffer.from('{invalid saved canonical json}') : Buffer.from(json);
    const id = (await db.query(`INSERT INTO inspection_protocol_versions(api_id,inspection_id,run_id,version,kind,snapshot_json,snapshot_hash,decision_set_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'QA fixture') RETURNING id`, [protocolId, run.inspection_id, run.id, version, status, JSON.stringify(snapshot), hash, '3'.repeat(64)])).rows[0].id;
    await db.query("INSERT INTO protocol_artifacts(api_id,protocol_id,format,media_type,canonicalization_version,byte_size,content_hash,content_bytes) VALUES($1,$2,'JSON','application/json','inspector-c14n-v1',$3,$4,$5)", [`ART-${randomUUID()}`, id, storedBytes.length, hash, storedBytes]);
    expected.set(version, { protocol, json, hash, id }); return expected.get(version);
  }
  historical = await protocol(1, 'FINAL'); current = await protocol(2, 'DRAFT'); bad = await protocol(3, 'DRAFT', true);
  await writeFile(path.join(output, 'fixture.json'), JSON.stringify({ mode: 'NORMAL', synthetic: true, objectId, checkId, versions: [...expected.values()].map(({ protocol, hash }) => ({ protocol, hash })), boundaries: boundary }, null, 2));
  const scopedRepository = new Proxy(repository, { get(target, property) {
    if (property === 'getFindings') return async (id, currentActor) => {
      const resource = await target.getCheck(id, currentActor);
      return resource === 'AUTH_REQUIRED' ? resource : resource ? structuredClone(mutableFindings) : undefined;
    };
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  app = await buildApp({ repository: scopedRepository, openWorkspace: true, identityService: {
    login: async () => undefined, createOpenWorkspaceSession: async () => ({ actor, sessionToken: token, csrfToken: 'readonly-qa' }),
    resolveSession: async value => value === token ? actor : value === foreignToken ? foreignActor : undefined,
    verifyCsrf: () => false, revokeSession: async () => {}, close: async () => {},
  } }); await app.ready();
  for (const format of ['pdf', 'docx', 'xml']) {
    const url = `/api/protocols/${historical.protocol.id}/artifacts/${format}`;
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { cookie: `inspector_session=${foreignToken}` } })).statusCode, 404);
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM protocol_rendered_artifacts')).rows[0].n, 0); pass('production-unauthorized-and-foreign-READ-refuse-before-render-cache');
  vite = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), server: { host: '127.0.0.1', port: 28191, strictPort: true, fs: { allow: [root] } }, plugins: [{ name: 'protocol-export-production-api', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/api/')) return next();
      try {
        if (request.method !== 'GET' && !(request.method === 'POST' && request.url === '/api/auth/open-workspace')) {
          mutations.push({ method: request.method, url: request.url }); throw Error('Forbidden API mutation in read-only acceptance');
        }
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const result = await app.inject({ method: request.method, url: request.url, headers: request.headers, ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}) });
        const match = request.url.match(/^\/api\/protocols\/([^/]+)\/artifacts\/(pdf|docx|xml)$/);
        const protocolVersion = match ? [...expected.values()].find(value => value.protocol.id === match[1])?.protocol.version : undefined;
        requests.push({ method: request.method, url: request.url, status: result.statusCode, ...(match ? { format: match[2], protocolVersion, headers: result.headers } : {}) });
        response.writeHead(result.statusCode, result.headers); response.end(result.rawPayload);
      } catch (error) { next(error); }
    });
  } }] }); await vite.listen();
  const { chromium } = createRequire(import.meta.url)(process.env.INSPECTOR_PLAYWRIGHT_PATH ?? '/home/freetok/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light', acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('http://127.0.0.1:28191/'); await page.getByRole('button', { name: /Открыть кабинет/ }).first().click();
  await page.getByRole('heading', { name: 'Объекты проверки', exact: true }).waitFor();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Протоколы', exact: true }).click();
  await page.getByRole('heading', { name: 'Версии', exact: true }).waitFor();
  for (const filename of ['styles.css', 'themes.css', 'workspace.css', 'color-mode.css']) assert((await page.locator('style[data-vite-dev-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-vite-dev-id')))).some(value => value.endsWith(`/${filename}`)));
  pass('production-App-auth-normal-protocol-history-and-full-CSS');
  for (const format of ['pdf', 'docx', 'xml']) await clickDownload(1, format, 'before-current-change');
  await db.query("UPDATE objects SET name='CURRENT-LIVE-MUTATED' WHERE api_id=$1", [objectId]);
  mutableFindings = mutableFindings.map(value => ({ ...value, title: 'CURRENT-LIVE-MUTATED', rationale: 'CURRENT-LIVE-MUTATED' }));
  await db.query("INSERT INTO protocol_revocations(api_id,protocol_id,actor_user_id,reason_code,comment,replacement_protocol_id) VALUES($1,$2,$3,'OTHER','Synthetic revocation envelope after initial download',$4)", [`REV-${randomUUID()}`, historical.id, actor.userId, current.id]);
  await page.reload(); await page.getByRole('button', { name: /Открыть кабинет/ }).first().click();
  await page.getByRole('heading', { name: 'Объекты проверки', exact: true }).waitFor();
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Протоколы', exact: true }).click();
  await page.locator('.version-row--revoked').waitFor(); pass('current-name-findings-and-revocation-envelope-changed-with-frozen-snapshot');
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const mode of ['light', 'dark']) {
      await page.getByRole('button', { name: mode === 'dark' ? 'Тёмная тема' : 'Светлая тема', exact: true }).click();
      await page.waitForFunction(value => document.documentElement.dataset.colorResolved === value && !document.documentElement.hasAttribute('data-color-transition'), mode);
      for (const version of [1, 2]) for (const format of ['pdf', 'docx', 'xml']) await clickDownload(version, format, `${width}-${mode}`);
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll('main *')].map(node => ({ node, rect: node.getBoundingClientRect() })).filter(({ node, rect }) => rect.width && rect.right > innerWidth + 2 && getComputedStyle(node).position !== 'fixed').slice(0, 12).map(({ node, rect }) => ({ tag: node.tagName, className: node.className, text: node.textContent?.slice(0, 100), x: rect.x, width: rect.width })) }));
      layouts.push({ mode, ...layout }); if (layout.scrollWidth > width + 1) issues.push({ code: 'HORIZONTAL_OVERFLOW', mode, ...layout });
      await screenshot(`protocol-${width}-${mode}`); pass(`${width}-${mode}-six-real-click-downloads-and-byte-exact-historical-replay`);
    }
  }
  await page.getByRole('button', { name: 'Скачать PDF версии 3', exact: true }).first().click();
  await page.getByRole('alert').filter({ hasText: 'Контрольная сумма сохранённого протокола не совпала' }).first().waitFor();
  await screenshot('error-visible-375-dark'); pass('canonical-integrity-error-visible-in-export-component');
  for (const format of ['pdf', 'docx', 'xml']) {
    const repeat = await app.inject({ url: `/api/protocols/${historical.protocol.id}/artifacts/${format}`, headers: { cookie: `inspector_session=${token}` } });
    assert.equal(repeat.headers['x-protocol-validity'], 'REVOKED'); assert(repeat.rawPayload.equals(baseline.get(`1/${format}`)));
  }
  const count = (await db.query('SELECT count(*)::int n FROM protocol_rendered_artifacts')).rows[0].n; assert.equal(count, 6);
  assert.deepEqual(browserErrors, []); assert.deepEqual(mutations, []);
  assert.deepEqual(requests.filter(item => item.status >= 400 && !(item.protocolVersion === 3 && item.format === 'pdf' && item.status === 409)), []);
  pass('six-durable-artifacts-no-review-writes-and-only-expected-integrity-409');
  const endPins = await pins(); await writeFile(path.join(output, 'source-pins-end.json'), JSON.stringify(endPins, null, 2));
  if (JSON.stringify(endPins) !== JSON.stringify(startPins)) issues.push({ code: 'SOURCE_CHANGED_DURING_ACCEPTANCE', changed: endPins.filter((value, index) => value.sha256 !== startPins[index].sha256).map(value => value.path) });
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ status: issues.length ? 'NEEDS_FIXES' : 'PASS_FULL_APP_PROTOCOL_EXPORT_LOCAL', startedAt, finishedAt: new Date().toISOString(), browser: browser.version(), checks, issues, requests, downloads, screenshots, layouts, browserErrors, mutations, durableArtifactCount: count, boundaries: boundary }, null, 2));
  if (issues.length) process.exitCode = 1;
} catch (error) {
  if (page) { await screenshot('first-red').catch(() => {}); await writeFile(path.join(output, 'first-red-body.txt'), await page.locator('body').innerText().catch(() => '')); }
  await writeFile(path.join(output, 'first-red.json'), JSON.stringify({ status: 'FIRST_RED', error: error.stack ?? String(error), checks, issues, requests, downloads, screenshots, browserErrors, mutations, boundaries: boundary }, null, 2));
  throw error;
} finally {
  await browser?.close(); await vite?.close(); if (app) await app.close(); else await repository?.close();
  await db?.end(); if (createdDatabase) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`); await admin.end();
}
