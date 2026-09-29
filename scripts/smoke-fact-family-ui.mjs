#!/usr/bin/env node
// Read-only browser check of the persisted fact-family review panel.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WebSocket = createRequire(import.meta.url)("ws");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (index % 2 === 0) pairs.push([value, values[index + 1]]);
  return pairs;
}, []));
const objectId = args["--object-id"];
const checkId = args["--check-id"];
const credentialsPath = args["--credentials-file"];
const base = (args["--base-url"] || "http://127.0.0.1:18081").replace(/\/$/, "");
const expectedFacts = Number(args["--expected-facts"]);
const expectedLinks = Number(args["--expected-links"] ?? 0);
const expectedCandidateCodes = args["--expected-candidate-codes"] === undefined
  ? null : Number(args["--expected-candidate-codes"]);
const expectedObservationCodes = args["--expected-observation-codes"] === undefined
  ? null : Number(args["--expected-observation-codes"]);
const expectedObservationCount = args["--expected-observations"] === undefined
  ? null : Number(args["--expected-observations"]);
const expectedOcrObservationCodes = args["--expected-ocr-observation-codes"] === undefined
  ? null : Number(args["--expected-ocr-observation-codes"]);
const expectedOcrTableRows = args["--expected-ocr-table-rows"] === undefined
  ? null : Number(args["--expected-ocr-table-rows"]);
if (!objectId || !credentialsPath || !Number.isSafeInteger(expectedFacts) || expectedFacts < 0) {
  throw new Error("usage: --credentials-file PATH --object-id OBJ-ID --expected-facts COUNT [--screenshot PATH]");
}
if (checkId && (!Number.isSafeInteger(expectedLinks) || expectedLinks < 0)) {
  throw new Error("--expected-links must be a non-negative integer");
}
if (expectedCandidateCodes !== null && (!Number.isSafeInteger(expectedCandidateCodes)
    || expectedCandidateCodes < 1)) {
  throw new Error("--expected-candidate-codes must be a positive integer");
}
if (expectedObservationCodes !== null && (!Number.isSafeInteger(expectedObservationCodes)
    || expectedObservationCodes < 1)) {
  throw new Error("--expected-observation-codes must be a positive integer");
}
if (expectedObservationCount !== null && (!Number.isSafeInteger(expectedObservationCount)
    || expectedObservationCount < 0)) {
  throw new Error("--expected-observations must be a non-negative integer");
}
if (expectedOcrObservationCodes !== null && (!Number.isSafeInteger(expectedOcrObservationCodes)
    || expectedOcrObservationCodes < 1)) {
  throw new Error("--expected-ocr-observation-codes must be a positive integer");
}
if (expectedOcrTableRows !== null && (!Number.isSafeInteger(expectedOcrTableRows)
    || expectedOcrTableRows < 0)) {
  throw new Error("--expected-ocr-table-rows must be a non-negative integer");
}
const credentials = Object.fromEntries((await readFile(credentialsPath, "utf8"))
  .split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split), line.slice(split + 1)];
  }));
if (!credentials.login || !credentials.password) throw new Error("credentials file needs login/password");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "inspector-fact-family-ui-"));
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
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let nextId = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
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
    throw new Error(`UI did not show ${label}`);
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
      body: JSON.stringify(${JSON.stringify(credentials)})
    });
    return response.status;
  })()`);
  if (loginStatus !== 200) throw new Error(`browser login returned ${loginStatus}`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor("[...document.querySelectorAll('nav button')].some(button => button.textContent.includes('Объекты'))", "object navigation");
  await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('Объекты')).click()");
  await waitFor(`[...document.querySelectorAll('.object-card')].some(card => card.textContent.includes(${JSON.stringify(objectId)}))`, "target object");
  const opened = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.object-card')]
      .find(item => item.textContent.includes(${JSON.stringify(objectId)}));
    const button = card?.querySelector('button.text-action');
    button?.click(); return Boolean(button);
  })()`);
  if (!opened) throw new Error("target object could not be opened");
  await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
  await evaluate("document.querySelector('button.summary-metric--button').click()");
  await waitFor("Boolean(document.querySelector('section[aria-label=\"Предложения по фактам и сравнениям\"]'))", "fact-family panel");
  await waitFor("Boolean(document.querySelector('section[aria-label=\"Ручная связь фактов ПД и РД\"]'))", "fact-link review panel");
  const summary = await evaluate(`(() => {
    const panel = document.querySelector('section[aria-label="Предложения по фактам и сравнениям"]');
    return { text: panel?.textContent ?? '', rules: [...(panel?.querySelectorAll('details > summary') ?? [])]
      .map(node => node.textContent), sourceLinks: panel?.querySelectorAll('a[href*="/preview"]').length ?? -1 };
  })()`);
  for (const code of ["PZ-004", "PZ-007", "KR-055", "KR-058", "KR-059"]) {
    if (!summary.rules.some((row) => row.includes(code) && row.includes("Сравнение остановлено"))) {
      throw new Error(`missing abstaining rule ${code}`);
    }
  }
  if (summary.rules.length !== 5 || !summary.text.includes(`Предложений по фактам: ${expectedFacts}.`)
      || !summary.text.includes("Находок: 0.") || (expectedFacts && summary.sourceLinks < expectedFacts)) {
    throw new Error(`fact-family UI mismatch: ${JSON.stringify(summary)}`);
  }
  let linkRead = null;
  if (checkId) {
    linkRead = await evaluate(`(async () => {
      const response = await fetch('/api/checks/${encodeURIComponent(checkId)}/fact-links',
        { credentials: 'include' });
      return { status: response.status, body: await response.json() };
    })()`);
    if (linkRead.status !== 200 || !Array.isArray(linkRead.body.items)
      || linkRead.body.items.length !== expectedLinks
      || typeof linkRead.body.canReview !== "boolean"
      || typeof linkRead.body.canRun !== "boolean") {
      throw new Error(`fact-link API mismatch: ${JSON.stringify(linkRead)}`);
    }
    await waitFor(`document.querySelector('section[aria-label="Ручная связь фактов ПД и РД"]')
      ?.textContent.includes('Сохранённые связи: ${expectedLinks}')`, "fact-link count");
  }
  let candidateSummary = null;
  let observationSummary = null;
  let ocrObservationSummary = null;
  let ocrTableSummary = null;
  if (expectedObservationCodes !== null) {
    await waitFor("Boolean(document.querySelector('section[aria-label=\"Адресные наблюдения по параметрам\"]'))", "candidate observation panel");
    observationSummary = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Адресные наблюдения по параметрам"]');
      return { text: panel?.textContent ?? '', rows: [...(panel?.querySelectorAll('details details > summary') ?? [])]
        .map(row => row.textContent ?? ''), sourceLinks: panel?.querySelectorAll('a[href*="/preview"]').length ?? -1 };
    })()`);
    if (observationSummary.rows.length !== expectedObservationCodes
        || observationSummary.rows.some((row) => !row.includes("вывод не сделан"))
        || !observationSummary.text.includes(`Для всех ${expectedObservationCodes} кодов вывод не сделан.`)
        || (expectedObservationCount !== null
          && !observationSummary.text.includes(`Наблюдений для просмотра: ${expectedObservationCount}.`))) {
      throw new Error(`candidate observation UI mismatch: ${JSON.stringify(observationSummary)}`);
    }
  } else if (expectedCandidateCodes !== null) {
    await waitFor("Boolean(document.querySelector('section[aria-label=\"Подсказки по семействам параметров\"]'))", "candidate family panel");
    candidateSummary = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Подсказки по семействам параметров"]');
      const summaries = [...(panel?.querySelectorAll('details details > summary') ?? [])];
      return { text: panel?.textContent ?? '', rows: summaries.map(row => row.textContent ?? ''),
        sourceLinks: panel?.querySelectorAll('a[href*="/preview"]').length ?? -1 };
    })()`);
    if (candidateSummary.rows.length !== expectedCandidateCodes
        || candidateSummary.rows.some((row) => !row.includes("вывод не сделан"))
        || !candidateSummary.text.includes(`Кодов без вывода: ${expectedCandidateCodes}.`)
        || !candidateSummary.text.includes("не подтверждают факт, расхождение")) {
      throw new Error(`candidate family UI mismatch: ${JSON.stringify(candidateSummary)}`);
    }
  }
  if (expectedOcrObservationCodes !== null) {
    await waitFor("Boolean(document.querySelector('section[aria-label=\"Адресные OCR-подсказки\"]'))", "OCR observation panel");
    ocrObservationSummary = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Адресные OCR-подсказки"]');
      return { text: panel?.textContent ?? '', rows: [...(panel?.querySelectorAll(':scope > details > details > details > summary') ?? [])]
        .map(row => row.textContent ?? '') };
    })()`);
    if (ocrObservationSummary.rows.length !== expectedOcrObservationCodes
        || ocrObservationSummary.rows.some((row) => !row.includes("ABSTAIN"))
        || !ocrObservationSummary.text.includes(`Для всех ${expectedOcrObservationCodes} кодов вывод не сделан (ABSTAIN).`)
        || !ocrObservationSummary.text.includes("не является подтверждённым фактом")) {
      throw new Error(`OCR observation UI mismatch: rows=${ocrObservationSummary.rows.length}, allAbstain=${ocrObservationSummary.rows.every((row) => row.includes("ABSTAIN"))}`);
    }
  }
  if (expectedOcrTableRows !== null) {
    await waitFor("Boolean(document.querySelector('section[aria-label=\"Непроверенные строки таблиц OCR\"]'))", "OCR table review panel");
    ocrTableSummary = await evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Непроверенные строки таблиц OCR"]');
      return { text: panel?.textContent ?? '', sourceLinks: panel?.querySelectorAll('a[href*="/preview"]').length ?? -1 };
    })()`);
    if (!ocrTableSummary.text.includes(`Предложений: ${expectedOcrTableRows}.`)
        || !ocrTableSummary.text.includes("Только для ручной проверки.")
        || !ocrTableSummary.text.includes("не становятся нормализованными фактами")
        || (expectedOcrTableRows && ocrTableSummary.sourceLinks < expectedOcrTableRows)) {
      throw new Error(`OCR table UI mismatch: ${JSON.stringify(ocrTableSummary)}`);
    }
  }
  if (args["--screenshot"]) {
    await evaluate(expectedOcrTableRows !== null
      ? "document.querySelector('section[aria-label=\"Непроверенные строки таблиц OCR\"]').scrollIntoView({block:'start'})"
      : expectedObservationCodes !== null
      ? "document.querySelector('section[aria-label=\"Адресные наблюдения по параметрам\"]').scrollIntoView({block:'start'})"
      : expectedCandidateCodes === null
      ? "document.querySelector('section[aria-label=\"Предложения по фактам и сравнениям\"]').scrollIntoView({block:'start'})"
      : "document.querySelector('section[aria-label=\"Подсказки по семействам параметров\"]').scrollIntoView({block:'start'})");
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(args["--screenshot"], Buffer.from(screenshot.data, "base64"));
  }
  console.log(JSON.stringify({ objectId, factCount: expectedFacts, ruleCount: summary.rules.length,
    sourceLinks: summary.sourceLinks, linkCount: linkRead?.body.items.length ?? null,
    candidateCodeCount: candidateSummary?.rows.length ?? null,
    candidateSourceLinks: candidateSummary?.sourceLinks ?? null,
    observationCodeCount: observationSummary?.rows.length ?? null,
    observationSourceLinks: observationSummary?.sourceLinks ?? null,
    ocrObservationCodeCount: ocrObservationSummary?.rows.length ?? null,
    ocrTableRowCount: expectedOcrTableRows === null ? null : expectedOcrTableRows,
    screenshot: args["--screenshot"] || null }));
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
