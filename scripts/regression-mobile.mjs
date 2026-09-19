// Optional browser regression: requires Playwright (or PLAYWRIGHT_MODULE pointing
// to its index.mjs). Uses only synthetic sessions; never contacts the live Hub.
// CHROMIUM_EXECUTABLE_PATH may select an already installed browser.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
// Hooks only exist in this in-memory test bundle, never in public/terminal.js.
const compiled = await build({
  stdin: { contents: source + "\nwindow.hubTest = { terminalViews, openHistoryCache, returnToLive };", resolveDir: `${root}/src`, loader: "js" },
  bundle: true, format: "esm", platform: "browser", write: false, outfile: "terminal.js",
});
let earlierRequests = 0, historyRequests = 0;
let delayPage = false;
const session = { name: "fixture", displayName: "测试", slug: "Zml4dHVyZQ", path: "/tmp", windows: 1, attached: 1,
  windowList: [{ index: 0, name: "shell", active: true, panes: 1, path: "/tmp", command: "bash" }] };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const json = body => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
  if (url.pathname.includes("/history")) {
    historyRequests++;
    if (url.searchParams.has("before")) {
      earlierRequests++;
      if (delayPage) await new Promise(resolve => setTimeout(resolve, 250));
    }
    return json({ content: Array.from({ length: 160 }, (_, i) => `历史第 ${i} 行\r\n`).join(""),
      lines: 160, capturedAt: historyRequests, nextBefore: historyRequests * 160, hasEarlier: true, pending: false });
  }
  if (url.pathname === "/api/sessions") return json({ sessions: [session], defaultCwd: "/tmp" });
  if (url.pathname.startsWith("/api/")) return json({ active: true, phase: "live" });
  if (url.pathname === "/terminal.js") {
    response.setHeader("Content-Type", "text/javascript");
    return response.end(compiled.outputFiles.find(file => file.path.endsWith(".js")).text);
  }
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[a-zA-Z0-9.-]+$/.test(name)) { response.writeHead(404); return response.end(); }
  try {
    const file = await readFile(`${root}/public/${name}`);
    response.setHeader("Content-Type", name.endsWith(".css") ? "text/css" : name.endsWith(".html") ? "text/html" : "application/octet-stream");
    response.end(file);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    // Emulate the independently shrinking/panning visual viewport of a keyboard.
    const visual = new EventTarget();
    Object.assign(visual, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: visual });
    window.mockViewport = (width, height, offsetTop = 0) => {
      Object.assign(visual, { width, height, offsetTop });
      visual.dispatchEvent(new Event("resize"));
      visual.dispatchEvent(new Event("scroll"));
    };
    class Socket extends EventTarget {
      static OPEN = 1; static CONNECTING = 0; static CLOSING = 2; static CLOSED = 3;
      readyState = 0;
      constructor() {
        super();
        setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); this.message({ type: "ready" }); }, 20);
      }
      message(data) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
      send(raw) {
        const data = JSON.parse(raw);
        if (data.type === "input") (window.__hubInputs ||= []).push(data.data);
        if (data.type === "subscribe") setTimeout(() => this.message({ type: "snapshot", session: data.session, seq: 1, data: "LIVE\r\n" }), 0);
        if (data.type === "ping") this.message({ type: "pong", clientAt: data.clientAt });
        if (data.type === "input") setTimeout(() => this.message({ type: "input-ack", inputId: data.inputId, session: data.session }), 0);
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = Socket;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?session=${session.slug}`);
  await page.waitForFunction(() => [...window.hubTest?.terminalViews.values() || []].some(view => view.inputReady && view.historyReady));
  const viewAction = async action => page.evaluate(action);
  await viewAction(async () => { await hubTest.openHistoryCache([...hubTest.terminalViews.values()][0]); });
  await page.waitForTimeout(250);

  // A programmatic xterm scroll/resize is not a user request for another page.
  const initialPages = earlierRequests;
  await viewAction(() => {
    const view = [...hubTest.terminalViews.values()][0];
    view.historyTerm.scrollToTop();
    view.historyTerm.resize(28, 12);
  });
  await page.waitForTimeout(350);
  assert.equal(earlierRequests, initialPages, "resize/programmatic scrolling must not fetch older pages");

  // An actual upward wheel gesture still loads one page. Focus while it is in
  // flight; its late response and the keyboard must not reopen/rebuild history.
  delayPage = true;
  const before = earlierRequests;
  const frozen = await viewAction(() => [...hubTest.terminalViews.values()][0].historyContent);
  await page.locator(".xterm-history-host").dispatchEvent("wheel", { deltaY: -100 });
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].historyLoadingEarlier);
  await page.locator("#terminalInput").focus();
  await page.evaluate(() => mockViewport(390, 330, 65));
  await page.waitForTimeout(550);
  assert.equal(earlierRequests, before + 1);
  assert.equal(await viewAction(() => [...hubTest.terminalViews.values()][0].historyContent), frozen);
  assert.equal(await viewAction(() => [...hubTest.terminalViews.values()][0].historyActive), false);
  const focusedRequests = historyRequests;
  for (const [width, height, top] of [[390, 280, 100], [320, 300, 0], [390, 410, 50]]) {
    await page.evaluate(([w, h, y]) => mockViewport(w, h, y), [width, height, top]);
    await page.waitForTimeout(250);
    const geometry = await page.evaluate(() => {
      const input = document.querySelector("#terminalInput").getBoundingClientRect();
      const composer = document.querySelector("#composer").getBoundingClientRect();
      const terminal = document.querySelector("#terminalView").getBoundingClientRect();
      return { inputTop: input.top, inputBottom: input.bottom, inputRight: input.right,
        composerTop: composer.top, terminalBottom: terminal.bottom };
    });
    assert.ok(geometry.inputTop >= top && geometry.inputBottom <= top + height + 1, JSON.stringify(geometry));
    assert.ok(geometry.inputRight <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.terminalBottom <= geometry.composerTop + 1, "input must not overlap the terminal");
  }
  assert.equal(historyRequests, focusedRequests, "keyboard changes must not trigger history requests");
  await page.locator("#terminalInput").fill("测试输入");
  await page.locator("#terminalInput").press("Enter");
  await page.waitForFunction(() => document.querySelector("#terminalInput").value === "");
  assert.equal(await page.locator("#terminalInput").evaluate(el => document.activeElement === el), true);
  assert.equal(historyRequests, focusedRequests, "input ACK must not start history loading");
  const punctuation = "，。！？：；‘’“”【】（）<>@#$%&*+-=_/\\";
  await page.locator("#terminalInput").fill(punctuation);
  await page.locator("#terminalInput").press("Enter");
  await page.waitForFunction(() => document.querySelector("#terminalInput").value === "");
  assert.ok(await page.evaluate(expected => window.__hubInputs?.some(value => value === `${expected}\r`), punctuation), "punctuation must reach the terminal unchanged");

  // Focusing input cancels an already-started touch fling, not just requests.
  await page.evaluate(async () => {
    document.activeElement.blur();
    const view = [...hubTest.terminalViews.values()][0];
    await hubTest.openHistoryCache(view);
    view.historyTerm.options.smoothScrollDuration = 0;
  });
  await page.waitForTimeout(200);
  const stoppedAt = await page.evaluate(() => {
    const view = [...hubTest.terminalViews.values()][0];
    const host = view.historyHost;
    for (const [type, y] of [["pointerdown", 140], ["pointermove", 180], ["pointerup", 180]]) {
      host.dispatchEvent(new PointerEvent(type, { pointerType: "touch", pointerId: 7, clientY: y, bubbles: true, cancelable: true }));
    }
    document.querySelector("#terminalInput").focus({ preventScroll: true });
    return view.historyTerm.buffer.active.viewportY;
  });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => [...hubTest.terminalViews.values()][0].historyTerm.buffer.active.viewportY), stoppedAt,
    "history momentum must stop when input gets focus");

  // Desktop uses the same bottom-row layout without covering terminal cells.
  await page.setViewportSize({ width: 1280, height: 450 });
  await page.evaluate(() => mockViewport(1280, 450));
  await page.waitForTimeout(300);
  const desktop = await page.evaluate(() => ({
    inputBottom: document.querySelector("#terminalInput").getBoundingClientRect().bottom,
    terminalBottom: document.querySelector("#terminalView").getBoundingClientRect().bottom,
    composerTop: document.querySelector("#composer").getBoundingClientRect().top,
  }));
  assert.ok(desktop.inputBottom <= 450 && desktop.terminalBottom <= desktop.composerTop + 1, JSON.stringify(desktop));
  assert.deepEqual(errors, []);
  console.log("Mobile regression passed: gesture-only pagination, stale response discard, keyboard viewport containment, no overlap, input ACK, cancelled touch momentum, desktop layout.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
