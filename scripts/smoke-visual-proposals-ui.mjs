#!/usr/bin/env node
// Read-only browser check for persisted, unclassified drawing proposals.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (index % 2 === 0) pairs.push([value, values[index + 1]]);
  return pairs;
}, []));
const base = (args["--base-url"] || "http://127.0.0.1:18081").replace(/\/$/, "");
const objectId = args["--object-id"];
let sourceName = args["--source-name"];
const sourceFileId = args["--source-file-id"];
const expected = Number(args["--expected-proposals"]);
const expectedPages = Number(args["--expected-pages"] ?? 36);
const expectedScanned = Number(args["--expected-scanned"] ?? expectedPages);
const credentialsPath = args["--credentials-file"];
if (!objectId || !credentialsPath || !Number.isSafeInteger(expected) || expected < 0
    || !Number.isSafeInteger(expectedPages) || expectedPages < 1
    || !Number.isSafeInteger(expectedScanned) || expectedScanned < 0 || expectedScanned > expectedPages) {
  throw new Error("usage: --credentials-file PATH --object-id OBJ-ID --expected-proposals COUNT [--screenshot PATH]");
}
const credentials = Object.fromEntries((await readFile(credentialsPath, "utf8"))
  .split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const delimiter = line.indexOf("=");
    return [line.slice(0, delimiter), line.slice(delimiter + 1)];
  }));
if (!credentials.login || !credentials.password) throw new Error("credentials file needs login and password");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "inspector-visual-ui-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1440,960", "about:blank",
], { stdio: "ignore" });
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      if (port) break;
    } catch { /* Chrome is starting. */ }
    await pause(100);
  }
  if (!port) throw new Error("headless Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("Chrome has no page target");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  let nextId = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    const visible = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Сохранённый OCR"]');
      const image = panel?.querySelector('.visual-proposal-image-wrap img');
      return { body: document.body?.innerText?.slice(0, 500) ?? '',
        ocr: panel?.innerText?.slice(0, 1000) ?? '',
        image: image ? { complete: image.complete, width: image.naturalWidth,
          src: image.currentSrc } : null };
    })()`);
    throw new Error(`UI did not show ${label}; visible: ${JSON.stringify(visible)}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 960, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: base });
  await waitFor("document.readyState === 'complete' && Boolean(document.body)", "app shell");
  const loginStatus = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(${JSON.stringify({ login: credentials.login, password: credentials.password })})
    });
    return response.status;
  })()`);
  if (loginStatus !== 200) throw new Error(`browser login returned ${loginStatus}`);
  if (sourceFileId) {
    const source = await evaluate(`(async () => {
      const response = await fetch('/api/objects/${encodeURIComponent(objectId)}/files', { credentials: 'include' });
      if (!response.ok) throw new Error('source list returned ' + response.status);
      return (await response.json()).items.filter(item => item.id === ${JSON.stringify(sourceFileId)})
        .map(item => item.name);
    })()`);
    if (source.length !== 1 || (sourceName && source[0] !== sourceName)) {
      throw new Error(`source id ${sourceFileId} is absent or does not match source name`);
    }
    sourceName = source[0];
  }
  await send("Page.reload", { ignoreCache: true });
  await waitFor("[...document.querySelectorAll('nav button')].some(button => button.textContent.includes('Объекты'))", "object navigation");
  await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('Объекты')).click()");
  await waitFor(`([...document.querySelectorAll('.object-card')].some(card => card.textContent.includes(${JSON.stringify(objectId)})))`, "target object");
  const opened = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.object-card')]
      .find(item => item.textContent.includes(${JSON.stringify(objectId)}));
    const button = card?.querySelector('button.text-action');
    button?.click(); return Boolean(button);
  })()`);
  if (!opened) throw new Error("target object could not be opened");
  let ocrTranscriptionCandidateCount = null;
  if (args["--expected-ocr-transcription-candidates"] !== undefined) {
    const expectedOcrRows = Number(args["--expected-ocr-transcription-candidates"]);
    if (!Number.isSafeInteger(expectedOcrRows) || expectedOcrRows < 0) {
      throw new Error("invalid OCR transcription candidate count");
    }
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
    await evaluate("document.querySelector('button.summary-metric--button').click()");
    await waitFor(`(() => {
      const panel = document.querySelector('section[aria-label="Ручное подтверждение чтения OCR-строк"]');
      return panel?.textContent?.includes('OCR-строк для проверки: ${expectedOcrRows}');
    })()`, "OCR transcription review panel");
    ocrTranscriptionCandidateCount = expectedOcrRows;
    if (expectedOcrRows > 0) {
      const gate = await evaluate(`(() => {
        const panel = document.querySelector('section[aria-label="Ручное подтверждение чтения OCR-строк"]');
        const select = panel?.querySelector('select[aria-label="Выберите строку OCR"]');
        if (!select || select.options.length !== ${expectedOcrRows + 1}) return { valid: false };
        const expectedContinuation = ${JSON.stringify(args["--expected-ocr-continuation-text"] ?? null)};
        const selected = expectedContinuation
          ? [...select.options].find(option => option.textContent?.includes(expectedContinuation))
          : select.options[1];
        if (!selected) return { valid: false };
        select.value = selected.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { valid: true };
      })()`);
      if (!gate.valid) throw new Error("OCR reviewer candidate selector mismatch");
      await waitFor("Boolean(document.querySelector('[aria-label=\"Происхождение строки OCR\"]'))", "OCR row evidence");
      if (args["--expected-ocr-continuation-text"]) {
        await waitFor(`(() => {
          const evidence = document.querySelector('[aria-label="Происхождение строки OCR"]');
          return evidence?.textContent?.includes('Продолжение подписи: OCR-строка')
            && evidence.textContent.includes(${JSON.stringify(args["--expected-ocr-continuation-text"])});
        })()`, "OCR label continuation provenance");
      }
      const safeDefault = await evaluate(`(() => {
        const panel = document.querySelector('section[aria-label="Ручное подтверждение чтения OCR-строк"]');
        const submit = panel?.querySelector('button[type="submit"]');
        const preview = panel?.querySelector('a[target="_blank"]');
        const decision = panel?.querySelector('select[aria-label="Решение по OCR-строке"]');
        return Boolean(submit?.disabled && preview?.href && decision?.value === '');
      })()`);
      if (!safeDefault) throw new Error("OCR reviewer did not start with disabled save and empty decision");
    }
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent?.includes('К результатам'))?.click()");
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "return to result");
  }
  let ocrApplicabilityCandidateCount = null;
  if (args["--expected-ocr-applicability-candidates"] !== undefined) {
    const count = Number(args["--expected-ocr-applicability-candidates"]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("invalid OCR applicability candidate count");
    }
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
    await evaluate("document.querySelector('button.summary-metric--button').click()");
    await waitFor(`(() => {
      const panel = document.querySelector('section[aria-label="Ручная проверка применимости OCR-строки"]');
      return panel?.textContent?.includes('Проверяемых снимков: ${count}');
    })()`, "OCR applicability review panel");
    const state = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Ручная проверка применимости OCR-строки"]');
      const button = panel?.querySelector('button[type="submit"]');
      return { candidateCount: ${count}, saveAvailable: Boolean(button && !button.disabled),
        emptyMessage: panel?.textContent?.includes('нет проверенных снимков OCR-строки') };
    })()`);
    if (count === 0 && (state.saveAvailable || !state.emptyMessage)) {
      throw new Error(`empty OCR applicability gate is unsafe: ${JSON.stringify(state)}`);
    }
    ocrApplicabilityCandidateCount = count;
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent?.includes('К результатам'))?.click()");
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "return to result");
  }
  let ocrPairCandidateCount = null;
  if (args["--expected-ocr-pair-candidates"] !== undefined) {
    const count = Number(args["--expected-ocr-pair-candidates"]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("invalid OCR pair candidate count");
    }
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
    await evaluate("document.querySelector('button.summary-metric--button').click()");
    await waitFor(`(() => {
      const panel = document.querySelector('section[aria-label="Проверка пары OCR-фактов ПД и РД"]');
      return panel?.textContent?.includes('Кандидатов пар: ${count}.');
    })()`, "OCR pair review panel");
    const safe = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Проверка пары OCR-фактов ПД и РД"]');
      const save = panel?.querySelector('button[type="submit"]');
      return ${count} === 0 ? !save && panel?.textContent?.includes('Проверенных пар OCR-фактов пока нет')
        : Boolean(save?.disabled);
    })()`);
    if (!safe) throw new Error("OCR pair review did not start closed");
    ocrPairCandidateCount = count;
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent?.includes('К результатам'))?.click()");
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "return to result");
  }
  let ocrQuantityCandidateCount = null;
  if (args["--expected-ocr-quantity-candidates"] !== undefined) {
    const count = Number(args["--expected-ocr-quantity-candidates"]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("invalid OCR quantity candidate count");
    }
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
    await evaluate("document.querySelector('button.summary-metric--button').click()");
    await waitFor(`(() => {
      const panel = document.querySelector('section[aria-label="Количественная сопоставимость OCR-пары"]');
      return panel?.textContent?.includes('Проверенных снимков пар: ${count}.');
    })()`, "OCR quantity review panel");
    const safe = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Количественная сопоставимость OCR-пары"]');
      const save = panel?.querySelector('button[type="submit"]');
      return ${count} === 0 ? !save && panel?.textContent?.includes('Количественное сопоставление остановлено')
        : Boolean(save?.disabled);
    })()`);
    if (!safe) throw new Error("OCR quantity review did not start closed");
    ocrQuantityCandidateCount = count;
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent?.includes('К результатам'))?.click()");
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "return to result");
  }
  let ocrComparisonItemCount = null;
  if (args["--expected-ocr-comparison-items"] !== undefined) {
    const count = Number(args["--expected-ocr-comparison-items"]);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("invalid OCR comparison item count");
    }
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
    await evaluate("document.querySelector('button.summary-metric--button').click()");
    await waitFor(`(() => {
      const panel = document.querySelector('section[aria-label="Численные подсказки по OCR-парам"]');
      return Boolean(panel?.textContent?.includes('Остановленных проверок:'))
        && panel.querySelectorAll('article[aria-label^="Подсказка по решению"]').length === ${count};
    })()`, "OCR comparison preview panel");
    const safe = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Численные подсказки по OCR-парам"]');
      return ${count} === 0 ? panel?.textContent?.includes('Численное сравнение не выполнялось')
        : Boolean(panel?.textContent?.includes('Только вычисленная подсказка'));
    })()`);
    if (!safe) throw new Error("OCR comparison preview did not abstain as expected");
    ocrComparisonItemCount = count;
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent?.includes('К результатам'))?.click()");
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "return to result");
  }
  if (args["--expected-unresolved-family-codes"] !== undefined) {
    const codes = args["--expected-unresolved-family-codes"].split(",").map((code) => code.trim()).filter(Boolean);
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
    await evaluate("document.querySelector('button.summary-metric--button').click()");
    await waitFor("Boolean(document.querySelector('section[aria-label=\"Неразрешённые семейства: текстовые подсказки\"]'))", "unresolved family review panel");
    const panel = await evaluate(`(() => {
      const section = document.querySelector('section[aria-label="Неразрешённые семейства: текстовые подсказки"]');
      return { text: section?.textContent ?? '', rows: [...(section?.querySelectorAll('details > summary') ?? [])].map(row => row.textContent) };
    })()`);
    if (panel.rows.length !== codes.length || codes.some((code) =>
      !panel.rows.some((row) => row.includes(code) && row.includes("ABSTAIN")))
      || !panel.text.includes("Строки требуют проверки на исходном PDF")) {
      throw new Error(`unresolved family review panel mismatch: ${JSON.stringify(panel)}`);
    }
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent?.includes('К результатам'))?.click()");
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "return to result");
  }
  if (args["--expected-partial-coverage"]) {
    const expectedCodes = args["--expected-partial-coverage"].split(",").map(value => value.trim()).filter(Boolean);
    await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
    await evaluate("document.querySelector('button.summary-metric--button').click()");
    await waitFor("document.body?.textContent?.includes('Покрытие по параметрам') && Boolean(document.querySelector('[aria-label=\"Частично проверенные параметры\"]'))", "coverage list");
    const foundCodes = await evaluate("[...document.querySelectorAll('[aria-label=\"Частично проверенные параметры\"] > div > span')].map(node => node.textContent)");
    for (const code of expectedCodes) {
      if (!foundCodes.includes(code)) throw new Error(`partial coverage ${code} missing from UI: ${JSON.stringify(foundCodes)}`);
    }
    if (args["--expected-pilot-parameters"]) {
      const expectedPilot = args["--expected-pilot-parameters"].split(",").map(value => value.trim()).filter(Boolean);
      await waitFor("Boolean(document.querySelector('[aria-label=\"Сохранённые факты пилотных правил\"]'))", "pilot rule facts");
      const pilotText = await evaluate("document.querySelector('[aria-label=\"Сохранённые факты пилотных правил\"]').textContent");
      for (const code of expectedPilot) {
        if (!pilotText.includes(code)) throw new Error(`pilot rule ${code} missing from UI`);
      }
      if (!pilotText.includes("страница PDF 23") || !pilotText.includes("страница PDF 14")) {
        throw new Error("pilot source pages are missing from UI");
      }
    }
    if (args["--expected-ocr-heat-abstentions"] !== undefined) {
      const abstentions = Number(args["--expected-ocr-heat-abstentions"]);
      const proposals = Number(args["--expected-ocr-heat-proposals"] ?? 0);
      if (![abstentions, proposals].every(Number.isSafeInteger) || abstentions < 0 || proposals < 0) {
        throw new Error("invalid OCR heat review counts");
      }
      await waitFor("Boolean(document.querySelector('[aria-label=\"Непроверенные подсказки OCR по тепловым нагрузкам\"]'))", "OCR heat review aid");
      const review = await evaluate(`(() => {
        const panel = document.querySelector('[aria-label="Непроверенные подсказки OCR по тепловым нагрузкам"]');
        return { text: panel?.textContent ?? '', proposals: panel?.querySelectorAll('.ocr-heat-proposals > li').length ?? -1,
          abstentions: panel?.querySelectorAll('.ocr-heat-abstentions > details').length ?? -1 };
      })()`);
      if (!review.text.includes(`Всего: предложения — ${proposals}, воздержания — ${abstentions}`)
          || !review.text.includes("Требуется ручная сверка")
          || review.proposals !== proposals || review.abstentions !== abstentions) {
        throw new Error(`OCR heat review aid mismatch: ${JSON.stringify(review)}`);
      }
      if (abstentions > 0) {
        const preview = await evaluate(`(async () => {
          const first = document.querySelector('[aria-label="Непроверенные подсказки OCR по тепловым нагрузкам"] .ocr-heat-abstentions details');
          first.open = true;
          const link = first.querySelector('a[href*="/preview"]');
          if (!link || !first.textContent.includes('Исходные строки OCR')) return { status: 0, contentType: '' };
          const response = await fetch(link.href, { credentials: 'include' });
          return { status: response.status, contentType: response.headers.get('content-type') ?? '' };
        })()`);
        if (preview.status !== 200 || !preview.contentType.startsWith("image/")) {
          throw new Error(`OCR evidence original-page link failed: ${JSON.stringify(preview)}`);
        }
      }
    }
    if (args["--coverage-screenshot"]) {
      await evaluate(`(() => { const panel = document.querySelector('[aria-label="Сохранённые факты пилотных правил"]'); const heat = [...(panel?.querySelectorAll('details') ?? [])].find(node => node.textContent.includes('PZ-017')); if (heat) heat.open = true; (document.querySelector('[aria-label="Непроверенные подсказки OCR по тепловым нагрузкам"]') ?? panel ?? document.querySelector('[aria-label="Частично проверенные параметры"]'))?.scrollIntoView({block:'start'}); })()`);
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(args["--coverage-screenshot"], Buffer.from(screenshot.data, "base64"));
    }
    await evaluate("document.querySelector('button.back-link').click()");
  }
  await waitFor("[...document.querySelectorAll('button')].some(button => button.textContent.includes('Исходные документы'))", "source action");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Исходные документы')).click()");
  if (sourceName) {
    await waitFor("document.querySelectorAll('.source-review-file').length > 0", "source file list");
    const matchingSources = await evaluate(`([...document.querySelectorAll('.source-review-file')]
      .filter(button => button.querySelector('strong')?.textContent === ${JSON.stringify(sourceName)})).length`);
    if (matchingSources !== 1) throw new Error(`expected one source named ${sourceName}, found ${matchingSources}`);
    await evaluate(`[...document.querySelectorAll('.source-review-file')]
      .find(button => button.querySelector('strong')?.textContent === ${JSON.stringify(sourceName)}).click()`);
  }
  if (args["--expected-ocr-source-text"]) {
    await waitFor(`document.querySelector('section[aria-label="Сохранённый OCR"]')
      ?.textContent?.includes(${JSON.stringify(args["--expected-ocr-source-text"])})`,
    "bounded OCR source status");
  }
  if (args["--ocr-screenshot"] && args["--expected-ocr-page"] === undefined) {
    await evaluate(`document.querySelector('section[aria-label="Сохранённый OCR"]')
      ?.scrollIntoView({block:'center'})`);
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(args["--ocr-screenshot"], Buffer.from(screenshot.data, "base64"));
  }
  if (args["--expected-ocr-page"] !== undefined) {
    const ocrPage = Number(args["--expected-ocr-page"]);
    const ocrLines = Number(args["--expected-ocr-lines"]);
    const ocrRequired = Number(args["--expected-ocr-required"]);
    const ocrDeferred = Number(args["--expected-ocr-deferred"]);
    if (![ocrPage, ocrLines, ocrRequired, ocrDeferred].every(Number.isSafeInteger)
        || ocrPage < 1 || ocrLines < 0 || ocrRequired < 1 || ocrDeferred < 0) {
      throw new Error("OCR smoke requires page, lines, required and deferred counts");
    }
    await waitFor(`(() => {
      const panel = document.querySelector('section[aria-label="Сохранённый OCR"]');
      const value = panel?.textContent ?? '';
      return value.includes('Текст не проверен человеком')
        && value.includes('OCR требовался для ${ocrRequired} стр.; обработано')
        && value.includes('отложено ${ocrDeferred}')
        && [...(panel?.querySelectorAll('button') ?? [])]
          .some(button => button.textContent.includes('Страница ${ocrPage} · ${ocrLines} строк'));
    })()`, "bounded OCR page and caution");
    await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Сохранённый OCR"]');
      [...panel.querySelectorAll('button')]
        .find(button => button.textContent.includes('Страница ${ocrPage} · ${ocrLines} строк')).click();
    })()`);
    await waitFor(`(() => {
      const panel = document.querySelector('section[aria-label="Сохранённый OCR"]');
      const image = panel?.querySelector('.visual-proposal-image-wrap img');
      return image?.complete && image.naturalWidth > 0
        && panel.textContent.includes('Исходный лист ${ocrPage}')
        && panel.textContent.includes('Сохранённые строки (1–${Math.min(50, ocrLines)} из ${ocrLines})');
    })()`, "OCR original page and first text slice");
    if (ocrLines > 50) {
      await evaluate(`(() => {
        const panel = document.querySelector('section[aria-label="Сохранённый OCR"]');
        [...panel.querySelectorAll('button')]
          .find(button => button.textContent.includes('Следующие 50')).click();
      })()`);
      await waitFor(`document.querySelector('section[aria-label="Сохранённый OCR"]')
        ?.textContent?.includes('Сохранённые строки (51–${Math.min(100, ocrLines)} из ${ocrLines})')`,
        "second bounded OCR text slice");
    }
    if (args["--ocr-select-line-text"]) {
      const selectedText = args["--ocr-select-line-text"];
      const found = await evaluate(`(() => {
        const panel = document.querySelector('section[aria-label="Сохранённый OCR"]');
        const line = [...panel.querySelectorAll('.ocr-line-select')]
          .find(button => button.textContent.includes(${JSON.stringify(selectedText)}));
        line?.click(); return Boolean(line);
      })()`);
      if (!found) throw new Error(`OCR text was absent from current 50-line slice: ${selectedText}`);
      await waitFor(`(() => {
        const panel = document.querySelector('section[aria-label="Сохранённый OCR"]');
        const box = panel?.querySelector('.ocr-line-bbox')?.getBoundingClientRect();
        const image = panel?.querySelector('.visual-proposal-image-wrap img')?.getBoundingClientRect();
        const selected = panel?.querySelector('.ocr-line-select[aria-pressed="true"]');
        return Boolean(box && image && selected?.textContent.includes(${JSON.stringify(selectedText)})
          && box.width > 0 && box.height > 0 && box.left >= image.left
          && box.top >= image.top && box.right <= image.right + 2 && box.bottom <= image.bottom + 2);
      })()`, "selected OCR line and bbox inside original page");
      await waitFor(`(() => {
        const image = document.querySelector('section[aria-label="Сохранённый OCR"] .ocr-line-crop img');
        return image?.complete && image.naturalWidth > 0;
      })()`, "original PDF crop for selected OCR line");
    }
    if (args["--ocr-screenshot"]) {
      await evaluate(`document.querySelector('section[aria-label="Сохранённый OCR"] ${args["--ocr-select-line-text"] ? ".ocr-line-inspection" : ""}')
        ?.scrollIntoView({block:'center'})`);
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(args["--ocr-screenshot"], Buffer.from(screenshot.data, "base64"));
    }
  }
  await waitFor(`(() => {
    const panel = document.querySelector('section[aria-label="Визуальные предложения"]');
    return Boolean(panel?.textContent?.includes('обработано'))
      && ${sourceName ? `[...panel.querySelectorAll('p > strong')].some(node => node.textContent === ${JSON.stringify(sourceName)})` : "true"}
      && panel.querySelectorAll('.visual-proposal-list li').length === ${expected};
  })()`, "visual proposals");
  const panel = await evaluate(`(() => {
    const node = document.querySelector('section[aria-label="Визуальные предложения"]');
    node?.scrollIntoView();
    return { count: node?.querySelectorAll('.visual-proposal-list li').length ?? 0,
      label: node?.textContent ?? '' };
  })()`);
  if (!panel.label.includes("Не подтверждены")
      || !panel.label.includes(`обработано ${expectedScanned} из ${expectedPages}`)
      || (expectedScanned < expectedPages && !panel.label.includes("Проверена только равномерная выборка листов"))) {
    throw new Error(`visual proposal caveat or page scope is missing from UI: ${JSON.stringify(panel.label.slice(0, 1600))}`);
  }
  if (args["--expected-context-label"] && !panel.label.includes(`Подсказка из титула файла: ${args["--expected-context-label"]}`)) {
    throw new Error(`visual source context is missing from UI: ${JSON.stringify(panel.label.slice(0, 1600))}`);
  }
  const previewPage = args["--preview-page"] ? Number(args["--preview-page"]) : null;
  const proposalOrdinal = args["--select-proposal-ordinal"] === undefined
    ? null : Number(args["--select-proposal-ordinal"]);
  if (proposalOrdinal !== null && (!Number.isSafeInteger(proposalOrdinal)
      || proposalOrdinal < 0 || proposalOrdinal >= expected || previewPage === null)) {
    throw new Error("--select-proposal-ordinal requires a valid proposal index and --preview-page");
  }
  let reviewFormVisible = false;
  let reviewHistoryCount = null;
  let cropWidth = null;
  if (previewPage !== null) {
    if (!Number.isSafeInteger(previewPage) || previewPage < 1) throw new Error("invalid preview page");
    const clicked = await evaluate(`(() => {
      const button = ${proposalOrdinal === null
    ? `[...document.querySelectorAll('.visual-proposal-select')].find(node => node.querySelector('strong')?.textContent === 'Страница ${previewPage}')`
    : `document.querySelectorAll('.visual-proposal-select')[${proposalOrdinal}]`};
      button?.click(); return Boolean(button);
    })()`);
    if (!clicked) throw new Error(`no proposal on page ${previewPage}`);
    await waitFor("(() => { const panel = document.querySelector('section[aria-label=\"Визуальные предложения\"]'); const img = panel?.querySelector('.visual-proposal-image-wrap img'); return img?.complete && img.naturalWidth > 0 && Boolean(panel.querySelector('.visual-proposal-bbox')); })()", "page preview and proposal box");
    await waitFor("(() => { const img = document.querySelector('.visual-proposal-crop-wrap img'); return img?.complete && img.naturalWidth > 0; })()", "enlarged proposal crop");
    cropWidth = await evaluate("document.querySelector('.visual-proposal-crop-wrap img').naturalWidth");
    const geometry = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Визуальные предложения"]');
      const image = panel.querySelector('.visual-proposal-image-wrap img').getBoundingClientRect();
      const box = panel.querySelector('.visual-proposal-bbox').getBoundingClientRect();
      panel.querySelector('.visual-proposal-preview').scrollIntoView({block:'start'});
      return { imageWidth: image.width, imageHeight: image.height,
        withinImage: box.left >= image.left && box.top >= image.top && box.right <= image.right + 2 && box.bottom <= image.bottom + 2 };
    })()`);
    if (!geometry.withinImage) throw new Error(`proposal box outside preview: ${JSON.stringify(geometry)}`);
    if (args["--expected-vlm-text"]) {
      const expectedVlmText = args["--expected-vlm-text"];
      await waitFor(`document.querySelector('section[aria-label="Визуальные предложения"] .visual-proposal-preview')?.textContent?.includes(${JSON.stringify(expectedVlmText)})`,
        "VLM observation and caution");
      await evaluate(`(() => {
        const note = [...document.querySelectorAll('section[aria-label="Визуальные предложения"] .visual-proposal-preview .source-review-note')]
          .find(node => node.textContent.includes(${JSON.stringify(expectedVlmText)}));
        note?.scrollIntoView({block:'center'});
      })()`);
    }
    if (args["--expect-review-form"] === "true") {
      await waitFor("(() => { const form = document.querySelector('.visual-proposal-review-form'); return Boolean(form?.querySelector('select') && form.querySelector('textarea') && form.querySelector('button[type=submit]')); })()", "visual review form");
      await evaluate("document.querySelector('.visual-proposal-review-form').scrollIntoView({block:'center'})");
      reviewFormVisible = true;
    }
    if (args["--expected-review-history"] !== undefined) {
      const count = Number(args["--expected-review-history"]);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("invalid expected review history count");
      await waitFor(`document.querySelector('.visual-proposal-history summary')?.textContent?.includes('История решений (${count})')`, "visual review history");
      reviewHistoryCount = count;
      await evaluate("document.querySelector('.visual-proposal-history').open = true");
    }
  }
  if (args["--screenshot"]) {
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(args["--screenshot"], Buffer.from(screenshot.data, "base64"));
  }
  console.log(JSON.stringify({ objectId, proposalCount: panel.count, previewPage, proposalOrdinal,
    ocrTranscriptionCandidateCount, ocrApplicabilityCandidateCount,
    ocrPairCandidateCount, ocrQuantityCandidateCount, ocrComparisonItemCount,
    cropWidth, reviewFormVisible, reviewHistoryCount,
    screenshot: args["--screenshot"] || null }));
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
