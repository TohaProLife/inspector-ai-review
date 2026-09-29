#!/usr/bin/env node
// Browser check of the separate review candidate panel on an isolated stack.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WebSocket = globalThis.WebSocket;
if (!WebSocket) throw new Error("Node.js with built-in WebSocket is required");
const [objectId, screenshotPath, baseUrl = "http://127.0.0.1:28081",
  selectedPage, selectedCode] = process.argv.slice(2);
if (!/^OBJ-[A-Z0-9]+$/u.test(objectId ?? "") || !screenshotPath) {
  throw new Error("usage: smoke-review-candidate-ui.mjs OBJ-ID SCREENSHOT [WEB_URL] [PAGE] [CODE]");
}
if (selectedPage && !/^[1-9][0-9]*$/u.test(selectedPage)) throw new Error("page must be positive");
if (selectedCode && !/^[A-Z0-9-]+$/u.test(selectedCode)) throw new Error("code must be a parameter code");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "inspector-review-candidate-ui-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--window-size=1440,960", "about:blank",
], { stdio: "ignore" });
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
      if (port) break;
    } catch { /* Chrome starting. */ }
    await pause(100);
  }
  if (!port) throw new Error("headless Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("Chrome page target missing");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
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
    const result = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label, attempts = 150) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    throw new Error(`${label} not visible`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 960, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: baseUrl });
  await waitFor("document.readyState === 'complete' && Boolean(document.body)", "app shell");
  await waitFor("document.cookie.includes('inspector_csrf=')", "open workspace session");
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
  await waitFor("Boolean(document.querySelector('button.summary-metric--button'))", "coverage action");
  await evaluate("document.querySelector('button.summary-metric--button').click()");
  await waitFor("Boolean(document.querySelector('section[aria-label=\"Кандидаты на замечания\"]'))", "review candidate panel");
  if (selectedPage || selectedCode) {
    const selected = await evaluate(`(() => {
      const button = [...document.querySelectorAll('.review-candidates-list button')]
        .find(item => item.textContent.includes(${JSON.stringify(selectedPage ? `PDF стр. ${selectedPage}` : "")})
          && item.textContent.includes(${JSON.stringify(selectedCode ?? "")}));
      button?.click(); return Boolean(button);
    })()`);
    if (!selected) throw new Error(`candidate ${selectedCode ?? ""} page ${selectedPage ?? ""} not visible`);
  }
  await evaluate("document.querySelector('.review-candidates-preview')?.scrollIntoView({ block: 'center' })");
  await waitFor("[...document.querySelectorAll('.review-candidates-preview img')].every(img => img.complete && img.naturalWidth > 0)", "source images", 600);
  const state = await evaluate(`(() => {
    const panel = document.querySelector('section[aria-label="Кандидаты на замечания"]');
    panel.scrollIntoView({ block: 'start' });
    const actions = [...panel.querySelectorAll('button')].map(button => button.textContent.trim());
    return { candidateCount: panel.querySelectorAll('.review-candidates-list button').length,
      selected: panel.querySelector('.review-candidates-detail')?.textContent.slice(0, 500),
      imageWidths: [...panel.querySelectorAll('.review-candidates-preview img')].map(img => img.naturalWidth),
      hasDecisionAction: actions.some(text => text.includes('Оставить для проверки')),
      hasExport: actions.some(text => text.includes('Экспорт подсказок')),
      hasProtocol: actions.some(text => text.includes('Открыть протокол')) };
  })()`);
  if (state.candidateCount < 1 || state.imageWidths.length < 2
    || !state.hasDecisionAction || !state.hasExport || !state.hasProtocol) {
    throw new Error(`review candidate UI incomplete: ${JSON.stringify(state)}`);
  }
  const screenshot = await send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: false,
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log(JSON.stringify({ objectId, ...state, screenshot: screenshotPath }));
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  if (chrome.exitCode === null) {
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), pause(2000)]);
  }
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
