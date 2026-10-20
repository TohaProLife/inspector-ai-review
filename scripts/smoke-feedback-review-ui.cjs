/** Acceptance writes are restricted to the three named synthetic fixture PDFs.
 * Usage: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/smoke-feedback-review-ui.cjs /secure/state.json
 * state: { objectId, checkId, cookies: { cookieName: cookieValue } }; never commit it.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.FEEDBACK_WEB_URL || 'http://127.0.0.1:28082';
const output = process.env.FEEDBACK_QA_OUTPUT || 'output/feedback-20261017';
const statePath = process.argv[2];
if (!statePath || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
  throw new Error('Provide a fixture state file and a loopback test stand URL');
}
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const executablePath = process.env.FEEDBACK_BROWSER_EXECUTABLE
  || ['/opt/google/chrome/chrome', '/usr/bin/chromium'].find(fs.existsSync);

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.addCookies(Object.entries(state.cookies).map(([name, value]) => ({
      name, value, domain: new URL(base).hostname, path: '/',
    })));
    async function read(endpoint) {
      const response = await context.request.get(`${base}/api/${endpoint}`);
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    }
    const files = await read(`objects/${state.objectId}/files`);
    assert.deepEqual(files.items.map(file => file.name).sort(),
      ['ID-feedback.pdf', 'PD-feedback.pdf', 'RD-feedback.pdf']);
    const machineBefore = await read(`checks/${state.checkId}`);
    const findingsBefore = await read(`checks/${state.checkId}/findings`);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    async function open() {
      await page.goto(base);
      await page.getByRole('button', { name: 'Открыть кабинет', exact: true }).first().click();
      await page.locator('.object-card').filter({ hasText: state.objectId })
        .getByRole('button', { name: 'Открыть проверку' }).click();
      await page.getByRole('button', { name: 'Открыть кандидатов на замечания', exact: true }).click();
      await page.locator('.inspector-evidence-pane img').first().waitFor();
    }
    await open();
    const historyHeading = page.getByText(/История решений и доказательств \(/);
    const prior = Number((await historyHeading.innerText()).match(/\((\d+)\)/)[1]);
    const review = page.locator('.inspector-review');
    const detail = page.locator('.inspector-candidate-detail');
    const list = page.locator('.inspector-candidate-list button');
    assert.equal(await list.count(), 12);
    await review.getByLabel('Поиск', { exact: true }).fill('тепловая');
    assert.equal(await list.count(), 3);
    await review.getByLabel('Поиск', { exact: true }).fill('');
    await list.first().click();
    await detail.getByText('Исправить доказательства, добавить источник или разделить замечание', { exact: true }).click();
    const editor = page.locator('.inspector-evidence-editor');
    await editor.getByLabel('Объект / этаж / помещение / элемент', { exact: true }).fill('Тестовое здание A');
    for (const [index, value] of ['100', '102', '103'].entries()) {
      const section = editor.locator(':scope > section').nth(index);
      if (index === 2) await section.getByLabel('Файл').selectOption({ label: 'ID-feedback.pdf' });
      await section.getByLabel('Элемент в этом источнике', { exact: true }).fill('Тестовое здание A');
      await section.getByLabel('Значение', { exact: true }).fill(value);
      await section.getByLabel('Единица', { exact: true }).fill('м2');
      await section.getByLabel('Обозначение листа', { exact: true }).fill('ТЭП-1');
      await section.getByLabel('Редакция', { exact: true }).fill('Fixture 1');
      await section.getByLabel(/Рамка x0/).fill('0.067, 0.108, 0.42, 0.125');
      await section.getByLabel(/Рамка x0/).blur();
    }
    await editor.getByLabel('Правило').selectOption('PERCENT');
    await editor.getByLabel('Допуск', { exact: true }).fill('1');
    await editor.getByLabel('Нормативное основание / пункт', { exact: true })
      .fill('Синтетический тест матрицы PZ-002: порог 1%');
    await editor.getByLabel('Условие применения', { exact: true })
      .fill('Общая площадь одного тестового здания в трёх стадиях');
    await editor.getByLabel('Проверил: выбранные источники относятся к указанному элементу', { exact: true }).check();
    await review.getByLabel('Сравниваемые стадии').selectOption('PD_RD_ID');
    await page.waitForFunction(() => document.querySelectorAll('.inspector-evidence-pane img').length === 3
      && [...document.querySelectorAll('.inspector-evidence-pane img')].every(image => image.complete && image.naturalWidth > 0));
    const panes = page.locator('.inspector-evidence-pane');
    assert.equal(await panes.count(), 3);
    async function boxRatios() {
      return panes.first().locator('.inspector-evidence-box').evaluate(element => {
        const box = element.getBoundingClientRect(), sheet = element.parentElement.getBoundingClientRect();
        return [(box.x - sheet.x) / sheet.width, (box.y - sheet.y) / sheet.height,
          box.width / sheet.width, box.height / sheet.height];
      });
    }
    // Start independent; inherited saved decisions may have a different zoom.
    await review.getByLabel('Синхронизировать масштаб и перемещение', { exact: true }).uncheck();
    const before = await boxRatios();
    await panes.first().getByRole('button', { name: 'Увеличить ПД', exact: true }).click();
    assert.equal(await panes.first().locator('output').innerText(), '125%');
    assert.equal(await panes.nth(1).locator('output').innerText(), '100%');
    const after = await boxRatios();
    before.forEach((value, index) => assert.ok(Math.abs(value - after[index]) < 0.0001));
    const viewport = panes.first().locator('.inspector-sheet-viewport');
    await viewport.scrollIntoViewIfNeeded();
    const bounds = await viewport.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.7 - 40, bounds.y + bounds.height * 0.5);
    await page.mouse.up();
    assert.ok(await viewport.evaluate(element => element.scrollLeft > 0), 'drag pans the original sheet');
    const panned = await boxRatios();
    before.forEach((value, index) => assert.ok(Math.abs(value - panned[index]) < 0.0001));
    for (let index = 0; index < 6; index++) {
      await panes.first().getByRole('button', { name: 'Увеличить ПД', exact: true }).click();
    }
    await page.waitForFunction(() => {
      const image = document.querySelector('.inspector-evidence-pane img');
      return image?.complete && Math.max(image.naturalWidth, image.naturalHeight) === 4800;
    });
    await panes.first().getByRole('button', { name: 'Вписать', exact: true }).click();
    await panes.first().getByRole('button', { name: 'Увеличить ПД', exact: true }).click();
    await panes.first().getByLabel('Показать рамку', { exact: true }).uncheck();
    assert.equal(await panes.first().locator('.inspector-evidence-box').count(), 0);
    await panes.first().getByLabel('Показать рамку', { exact: true }).check();
    await panes.first().getByLabel('Страница PDF').fill('2');
    assert.equal(await panes.first().locator('.inspector-evidence-box').count(), 0);
    await panes.first().getByLabel('Страница PDF').fill('1');
    await review.getByLabel('Синхронизировать масштаб и перемещение', { exact: true }).check();
    await panes.first().getByRole('button', { name: 'Увеличить ПД', exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(await panes.nth(1).locator('output').innerText(), await panes.first().locator('output').innerText());
    await panes.first().getByRole('button', { name: 'Весь экран', exact: true }).click();
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
    await page.evaluate(() => document.exitFullscreen());
    async function decide(button, note) {
      await review.getByLabel('Причина решения', { exact: true }).fill(note);
      const response = page.waitForResponse(value => value.url().includes('/review-candidate-decisions')
        && value.request().method() === 'POST');
      await review.getByRole('button', { name: button, exact: true }).click();
      const saved = await response;
      assert.equal(saved.status(), 201, await saved.text());
      await page.waitForTimeout(300);
    }
    await decide('Сохранить исправления; повторное рассмотрение',
      'Fixture QA: уточнены три источника, значения и рамки');
    // A new evidence version requires another deliberate visit to its original.
    await panes.first().getByRole('link', { name: 'Открыть оригинальный PDF', exact: true }).click();
    await decide('Подтвердить нарушение', 'Fixture QA: оригиналы просмотрены, дельта 3% превышает 1%');
    await historyHeading.click();
    assert.ok((await detail.innerText()).includes(`Версия ${prior + 2}: Подтверждено инспектором`));
    const downloading = page.waitForEvent('download');
    await review.getByRole('button', { name: 'Экспорт источников и решений JSON', exact: true }).click();
    await (await downloading).saveAs(path.join(output, 'review-export.json'));
    const exported = JSON.parse(fs.readFileSync(path.join(output, 'review-export.json')));
    assert.ok(exported.decisions.some(event => event.decision === 'CORRECT_EVIDENCE'));
    assert.ok(exported.decisions.some(event => event.decision === 'CONFIRM'));
    assert.equal(exported.machineFindingsChanged, false);
    // Compact screenshots retain the original panes; detailed history stays in JSON.
    await historyHeading.click();
    await detail.getByText('Исправить доказательства, добавить источник или разделить замечание', { exact: true }).click();
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(300); // Let the existing responsive sidebar transition finish.
      await review.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `card-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
        `horizontal page overflow at ${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open();
    await historyHeading.click();
    assert.ok((await detail.innerText()).includes(`Версия ${prior + 2}: Подтверждено инспектором`));
    await review.getByRole('button', { name: 'Открыть протокол', exact: true }).click();
    await page.getByRole('heading', { name: 'Решения инспектора по исходным листам', exact: true }).waitFor();
    await page.getByText('Fixture QA: оригиналы просмотрены, дельта 3% превышает 1%', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Финализировать', exact: true }).isDisabled(), true);
    assert.deepEqual((await read(`checks/${state.checkId}`)).stats, machineBefore.stats);
    assert.deepEqual(await read(`checks/${state.checkId}/findings`), findingsBefore);
    assert.deepEqual(errors, []);
    const result = { status: 'PASS', objectId: state.objectId, checkId: state.checkId,
      assertions: ['search', 'three-stages', 'independent-zoom', 'pan', 'high-resolution-4800', 'bbox-transform', 'bbox-hide', 'page-switch',
        'opt-in-sync', 'fullscreen', 'correction', 'confirm', 'export', 'reload-history',
        'responsive-1440-768-375', 'protocol-decisions', 'pending-blocks-finalization', 'machine-results-unchanged', 'no-js-errors'],
      visualRegression: 'INCONCLUSIVE_NO_BASELINE' };
    fs.writeFileSync(path.join(output, 'browser-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
