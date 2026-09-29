#!/usr/bin/env node
// Browser smoke for the source review screen on the isolated homeserver.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (index % 2 === 0) pairs.push([value, values[index + 1]]);
  return pairs;
}, []));
const base = (options["--base-url"] || "http://127.0.0.1:18081").replace(/\/$/, "");
const credentialsPath = options["--credentials-file"];
const objectId = options["--object-id"];
if (!credentialsPath || !objectId) {
  throw new Error("usage: node scripts/smoke-source-review-ui.mjs --credentials-file PATH --object-id OBJ-ID [--base-url URL] [--screenshot PATH] [--attach-stage-file ABSOLUTE_PDF_PATH] [--expect-review true]");
}
const credentials = Object.fromEntries((await readFile(credentialsPath, "utf8"))
  .split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const delimiter = line.indexOf("=");
    return [line.slice(0, delimiter), line.slice(delimiter + 1)];
  }));
if (!credentials.login || !credentials.password) throw new Error("credentials file needs login and password");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), "inspector-source-ui-"));
const chrome = spawn("google-chrome", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--remote-allow-origins=*",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1440,960",
  "about:blank",
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
    const result = await send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    const visible = await evaluate("document.body?.innerText?.slice(0, 500) ?? ''");
    throw new Error(`UI did not show ${label}; visible text: ${JSON.stringify(visible)}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 960, deviceScaleFactor: 1, mobile: false,
  });
  await send("Page.navigate", { url: base });
  await waitFor("document.readyState === 'complete' && Boolean(document.body)", "the app shell");
  const loginStatus = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(${JSON.stringify({ login: credentials.login, password: credentials.password })})
    });
    return response.status;
  })()`);
  if (loginStatus !== 200) throw new Error(`browser login returned ${loginStatus}`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor("[...document.querySelectorAll('nav button')].some(button => button.textContent.includes('Объекты'))", "object navigation");
  await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('Объекты')).click()");
  await waitFor("[...document.querySelectorAll('.object-card')].some(card => card.textContent.includes(" + JSON.stringify(objectId) + "))", "the target object");
  const opened = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.object-card')]
      .find(item => item.textContent.includes(${JSON.stringify(objectId)}));
    const button = card?.querySelector('button.text-action');
    button?.click(); return Boolean(button);
  })()`);
  if (!opened) throw new Error("could not open the target object");
  await waitFor("[...document.querySelectorAll('button')].some(button => button.textContent.includes('Исходные документы'))", "source documents action");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Исходные документы')).click()");
  const attachingStage = Boolean(options["--attach-stage-file"]);
  await waitFor(`document.body.textContent.includes('Проверка источников') && document.querySelectorAll('.source-review-file').length >= ${attachingStage ? 1 : 2}`, "source review screen");
  const selected = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.source-review-file')]
      .find(item => item.textContent.includes('rd-smoke.pdf'));
    button?.click(); return Boolean(button);
  })()`);
  if (!selected) throw new Error("mixed RD/ID original is missing from the UI");
  let attachedSourceId = null;
  if (attachingStage) {
    const original = await evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`/api/objects/${encodeURIComponent(objectId)}/files`)}, { credentials: 'include' });
      const data = await response.json();
      return { status: response.status, count: data.items?.length, sourceId: data.items?.[0]?.id,
        stages: data.items?.[0]?.stages };
    })()`);
    if (original.status !== 200 || original.count !== 1 || original.stages.join(",") !== "RD") {
      throw new Error(`expected one RD-only original: ${JSON.stringify(original)}`);
    }
    await waitFor("Boolean(document.querySelector('.source-review-stage-upload input[type=file]'))", "stage upload control");
    await send("DOM.enable");
    const document = await send("DOM.getDocument");
    const input = await send("DOM.querySelector", {
      nodeId: document.root.nodeId, selector: ".source-review-stage-upload input[type=file]",
    });
    if (!input.nodeId) throw new Error("stage upload file input is missing");
    await send("DOM.setFileInputFiles", {
      nodeId: input.nodeId, files: [options["--attach-stage-file"]],
    });
    await waitFor("[...document.querySelectorAll('.source-review-stage-upload button')].some(button => !button.disabled)", "enabled stage upload button");
    await evaluate("document.querySelector('.source-review-stage-upload button').click()");
    await waitFor("document.body.textContent.includes('Те же байты зарегистрированы как ID') && [...document.querySelectorAll('.source-review-file')].some(button => button.textContent.includes('RD / ID'))", "same source with RD/ID stages", 900);
    const persisted = await evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`/api/objects/${encodeURIComponent(objectId)}/files`)}, { credentials: 'include' });
      if (!response.ok) return { status: response.status };
      const data = await response.json();
      return { status: response.status, count: data.items.length,
        stages: data.items[0]?.stages, sourceId: data.items[0]?.id };
    })()`);
    if (persisted.status !== 200 || persisted.count !== 1 || persisted.sourceId !== original.sourceId
        || !persisted.stages.includes("RD") || !persisted.stages.includes("ID")) {
      throw new Error(`stage upload did not preserve one source: ${JSON.stringify(persisted)}`);
    }
    attachedSourceId = persisted.sourceId;
  }
  await waitFor("document.body.textContent.includes('Стадия каждой страницы') && document.body.textContent.includes('676')", "mixed page stage editor");
  const expectReview = options["--expect-review"] === "true";
  if (expectReview) {
    await waitFor("document.body.textContent.includes('Текущее решение от') && [...document.querySelectorAll('.source-review-form textarea')].some(item => item.value.includes('UNRESOLVED'))", "saved unresolved source review");
  }
  const summary = await evaluate(`(() => {
    const link = document.querySelector('.source-review-form a[href*="/content"]');
    const stageEditor = [...document.querySelectorAll('.source-review-form textarea')]
      .find(item => item.closest('label')?.textContent.includes('Стадия каждой страницы'));
    const save = [...document.querySelectorAll('.source-review-form button')]
      .find(item => item.textContent.includes('Сохранить решение'));
    return { fileCount: document.querySelectorAll('.source-review-file').length,
      downloadLink: Boolean(link), mixedStageEditor: Boolean(stageEditor),
      unresolvedVisible: Boolean(stageEditor?.value.includes('UNRESOLVED')),
      saveControl: Boolean(save), saveDisabledWithoutBasis: Boolean(save?.disabled) };
  })()`);
  if (summary.fileCount !== (attachingStage ? 1 : 2) || !summary.downloadLink || !summary.mixedStageEditor
      || (attachingStage ? summary.saveControl : (!summary.saveControl
        || (expectReview ? (!summary.unresolvedVisible || !summary.saveDisabledWithoutBasis)
          : !summary.saveDisabledWithoutBasis)))) {
    throw new Error(`source review UI failed: ${JSON.stringify(summary)}`);
  }
  if (options["--screenshot"]) {
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(options["--screenshot"], Buffer.from(screenshot.data, "base64"));
  }
  process.stdout.write(JSON.stringify({ objectId, ...summary, stageAttached: attachingStage,
    sourceId: attachedSourceId, screenshot: options["--screenshot"] || null }) + "\n");
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
