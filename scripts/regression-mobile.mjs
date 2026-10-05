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
  stdin: { contents: source + "\nwindow.hubTest = { terminalViews, openHistoryCache, returnToLive, loadEarlierHistory, fitTerminal };", resolveDir: `${root}/src`, loader: "js" },
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
    Object.defineProperty(navigator, "clipboard", { value: {
      async writeText(text) {
        if (window.__denyCopy) throw new Error("denied");
        window.__copiedText = text;
      },
    } });
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
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
        window.__hubSocket = this;
        setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); this.message({ type: "ready" }); }, 20);
      }
      message(data) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
      send(raw) {
        const data = JSON.parse(raw);
        if (data.type === "resize") window.__hubResizeCount = (window.__hubResizeCount || 0) + 1;
        if (data.type === "input") (window.__hubInputs ||= []).push(data.data);
        if (data.type === "subscribe") setTimeout(() => this.message({ type: "snapshot", session: data.session, seq: 1, data: "LIVE\r\n" }), 0);
        if (data.type === "ping") this.message({ type: "pong", clientAt: data.clientAt });
        if (data.type === "session-ping") this.message({ type: "session-pong", session: data.session, clientAt: data.clientAt, connected: true });
        if (data.type === "input") {
          const ack = () => this.message({ type: "input-ack", inputId: data.inputId, session: data.session });
          if (window.__hubHoldAck) window.__hubReleaseAck = ack;
          else setTimeout(ack, 100);
        }
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = Socket;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?session=${session.slug}`);
  await page.waitForFunction(() => [...window.hubTest?.terminalViews.values() || []].some(view => view.inputReady && view.historyReady));
  assert.equal(await page.locator("#composerStatus").getAttribute("data-state"), "ready", "input-ready only after terminal snapshot");
  assert.equal(await page.locator(".composer-session-name").isVisible(), false, "mobile status omits session name");
  assert.equal(await page.locator("#windowStrip").isVisible(), false, "mobile omits tmux window strip");
  assert.equal(await page.locator("#newWindowButton").isVisible(), false, "mobile omits new window control");
  assert.equal(await page.locator("#openSidebar").isVisible(), true, "session menu remains accessible");
  assert.ok(await page.evaluate(() => Math.abs(
    document.querySelector("#terminalGrid").getBoundingClientRect().top
    - document.querySelector("#terminalView").getBoundingClientRect().top,
  ) < 1), "removed window strip must not leave an empty grid row");
  await page.locator("#openCopyText").tap();
  assert.match(await page.evaluate(() => window.__copiedText), /LIVE/);
  assert.equal(await page.locator("#copyTextDialog").evaluate(el => el.open), false, "successful mobile copy needs no dialog");
  const viewAction = async action => page.evaluate(action);
  await viewAction(async () => { await hubTest.openHistoryCache([...hubTest.terminalViews.values()][0]); });
  await page.waitForTimeout(250);

  const copyPosition = await viewAction(() => [...hubTest.terminalViews.values()][0].historyTerm.buffer.active.viewportY);
  await page.locator("#openCopyText").tap();
  const selectionText = page.locator(".history-text-selection pre");
  assert.match(await selectionText.textContent(), /历史第/);
  assert.equal(await selectionText.evaluate(el => getComputedStyle(el).webkitUserSelect), "text");
  assert.equal(await page.locator("#copyTextDialog").evaluate(el => el.open), false, "history selection stays in the session, not a dialog");
  const selected = await selectionText.evaluate(el => {
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.setEnd(el.firstChild, 6);
    const selection = getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    return selection.toString();
  });
  await page.locator("[data-copy-selection]").tap();
  assert.equal(await page.evaluate(() => window.__copiedText), selected, "copy the chosen substring, not all history");
  await page.locator("[data-copy-screen]").tap();
  assert.equal(await page.evaluate(() => window.__copiedText), await selectionText.textContent());
  assert.equal(await page.evaluate(() => [...hubTest.terminalViews.values()][0].historyActive), true, "copy preserves history mode");
  const frozenSelection = await selectionText.textContent();
  await page.evaluate(() => {
    window.__denyCopy = true;
    const view = [...hubTest.terminalViews.values()][0];
    window.__hubSocket.message({ type: "output", session: view.slug, seq: 2, data: "new output\r\n" });
  });
  await page.locator("[data-copy-screen]").tap();
  assert.match(await page.locator(".history-text-selection p").textContent(), /系统菜单/);
  assert.equal(await selectionText.textContent(), frozenSelection, "output must not mutate selected text");
  await page.locator("[data-close-selection]").tap();
  assert.equal(await viewAction(() => [...hubTest.terminalViews.values()][0].historyTerm.buffer.active.viewportY), copyPosition);
  assert.equal(await selectionText.count(), 0);
  await page.evaluate(() => { window.__denyCopy = false; });

  // Prepending must keep the reader's latest position, not the position when
  // the request started. Repeat to exercise replacement of an already-swapped DOM.
  delayPage = true;
  for (let pass = 0; pass < 2; pass++) {
    const position = await viewAction(async () => {
      const view = [...hubTest.terminalViews.values()][0];
      view.historyTerm.scrollToLine(50);
      const original = view.historyTerm;
      const pending = hubTest.loadEarlierHistory(view);
      await new Promise(resolve => setTimeout(resolve, 70));
      original.scrollToLine(65);
      const text = original.buffer.active.getLine(original.buffer.active.viewportY).translateToString();
      await pending;
      return { text, after: view.historyTerm.buffer.active.getLine(view.historyTerm.buffer.active.viewportY).translateToString(), replaced: original !== view.historyTerm, active: view.historyActive };
    });
    assert.equal(position.after, position.text, "prepend must preserve the exact viewed line");
    assert.equal(position.replaced, true);
    assert.equal(position.active, true);
  }
  await viewAction(() => {
    window.dispatchEvent(new Event("blur"));
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  assert.equal(await viewAction(() => [...hubTest.terminalViews.values()][0].historyActive), true,
    "temporary blur/backgrounding must preserve history mode");
  const readingLine = await viewAction(() => {
    const view = [...hubTest.terminalViews.values()][0];
    return view.historyTerm.buffer.active.getLine(view.historyTerm.buffer.active.viewportY).translateToString(true);
  });
  await viewAction(() => {
    const view = [...hubTest.terminalViews.values()][0];
    window.__hubSocket.message({ type: "output", session: view.slug, seq: 3, data: "background output\r\n".repeat(200) });
    mockViewport(360, 730);
  });
  await page.waitForTimeout(450);
  assert.equal(await viewAction(() => {
    const view = [...hubTest.terminalViews.values()][0];
    return view.historyTerm.buffer.active.getLine(view.historyTerm.buffer.active.viewportY).translateToString(true);
  }), readingLine, "live output and viewport reflow must not move the history reading line");
  await viewAction(() => mockViewport(390, 844));
  await page.waitForTimeout(300);
  delayPage = false;

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
  // The explicit resize above can move xterm's viewport; place the user at
  // the pagination boundary after it settles before testing a wheel request.
  await viewAction(() => [...hubTest.terminalViews.values()][0].historyTerm.scrollToTop());
  await page.locator(".xterm-history-host").dispatchEvent("wheel", { deltaY: -100 });
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].historyLoadingEarlier);
  await page.locator("#terminalInput").focus();
  await page.evaluate(() => mockViewport(390, 330, 65));
  await page.waitForTimeout(550);
  assert.equal(earlierRequests, before + 1);
  assert.equal(await viewAction(() => [...hubTest.terminalViews.values()][0].historyContent), frozen);
  assert.equal(await viewAction(() => [...hubTest.terminalViews.values()][0].historyActive), false);
  const focusedRequests = historyRequests;
  const keyboardResizes = await page.evaluate(() => window.__hubResizeCount || 0);
  for (const [width, height, top] of [[390, 280, 100], [320, 300, 0], [390, 410, 50]]) {
    await page.evaluate(([w, h, y]) => mockViewport(w, h, y), [width, height, top]);
    await page.waitForTimeout(250);
    const geometry = await page.evaluate(() => {
      const input = document.querySelector("#terminalInput").getBoundingClientRect();
      const composer = document.querySelector("#composer").getBoundingClientRect();
      const terminal = document.querySelector("#terminalView").getBoundingClientRect();
      const screen = document.querySelector(".xterm-host .xterm-screen").getBoundingClientRect();
      const host = document.querySelector(".xterm-host").getBoundingClientRect();
      return { inputTop: input.top, inputBottom: input.bottom, inputRight: input.right,
        composerTop: composer.top, terminalBottom: terminal.bottom,
        screenBottom: screen.bottom, hostBottom: host.bottom, hostTop: host.top };
    });
    assert.ok(geometry.inputTop >= top && geometry.inputBottom <= top + height + 1, JSON.stringify(geometry));
    assert.ok(geometry.inputRight <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.terminalBottom <= geometry.composerTop + 1, "input must not overlap the terminal");
    assert.ok(geometry.screenBottom <= geometry.hostBottom + 1
      && geometry.screenBottom > geometry.hostTop
      && Math.abs(geometry.screenBottom - geometry.hostBottom) <= 8,
    `the session's bottom row must stay visible above controls: ${JSON.stringify(geometry)}`);
  }
  await page.evaluate(() => {
    const view = [...hubTest.terminalViews.values()][0];
    view.term.focus();
    mockViewport(390, 300, 60);
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => {
    const view = [...hubTest.terminalViews.values()][0];
    const screen = view.host.querySelector(".xterm-screen").getBoundingClientRect();
    const host = view.host.getBoundingClientRect();
    return screen.bottom <= host.bottom + 1 && screen.bottom > host.top;
  }), true, "direct session typing must also retain the bottom input row");
  await page.locator("#terminalInput").focus();
  assert.equal(historyRequests, focusedRequests, "keyboard changes must not trigger history requests");
  // A browser may pan the layout after its last visualViewport event.
  await page.evaluate(() => { document.body.style.marginTop = "80px"; });
  await page.waitForTimeout(150);
  const inputWithinKeyboard = await page.locator("#terminalInput").evaluate(el => el.getBoundingClientRect().bottom <= visualViewport.offsetTop + visualViewport.height + 1);
  assert.equal(inputWithinKeyboard, true, "late keyboard pan must not cover the input");
  await page.evaluate(() => { document.body.style.marginTop = "0px"; });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__hubResizeCount || 0), keyboardResizes, "keyboard changes must not resize tmux through observers or timers");
  await page.locator("#terminalInput").fill("测试输入");
  await page.evaluate(() => { window.__hubHoldAck = true; });
  await page.locator("#terminalInput").press("Enter");
  assert.equal(await page.locator("#composerStatus").getAttribute("data-state"), "sending", `show pending terminal acknowledgement: ${JSON.stringify({ errors, input: await page.locator("#terminalInput").inputValue(), sent: await page.evaluate(() => window.__hubInputs) })}`);
  assert.equal(await page.locator("#terminalInput").evaluate(el => el.readOnly), true);
  await page.evaluate(() => { window.__hubHoldAck = false; window.__hubReleaseAck(); });
  await page.waitForFunction(() => document.querySelector("#terminalInput").value === "");
  assert.equal(await page.locator("#composerStatus").getAttribute("data-state"), "ready", "return to ready after acknowledgement");
  assert.equal(await page.locator("#terminalInput").evaluate(el => document.activeElement === el), true);
  assert.equal(historyRequests, focusedRequests, "input ACK must not start history loading");
  const punctuation = "，。！？：；‘’“”【】（）<>@#$%&*+-=_/\\";
  await page.locator("#terminalInput").fill(punctuation);
  const sentBeforeComposition = await page.evaluate(() => window.__hubInputs.length);
  await page.locator("#terminalInput").evaluate(el => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { data: "，", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  assert.equal(await page.evaluate(() => window.__hubInputs.length), sentBeforeComposition, "IME confirmation must not send or lock input");
  assert.equal(await page.locator("#terminalInput").evaluate(el => el.readOnly), false);
  assert.equal(await page.locator("#terminalInput").evaluate(el => {
    const event = new KeyboardEvent("keydown", {key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true});
    return el.dispatchEvent(event);
  }), true, "IME composition must not be prevented or submitted");
  await page.locator("#sendInputButton").tap();
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
  await page.evaluate(() => {
    document.activeElement.blur();
    mockViewport(390, 844);
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => [...hubTest.terminalViews.values()][0].term.element.style.transform), "",
    "closing the keyboard must remove the terminal-only lift");
  await page.setViewportSize({ width: 1280, height: 450 });
  await page.evaluate(() => mockViewport(1280, 450));
  await page.waitForTimeout(300);
  const desktop = await page.evaluate(() => ({
    inputBottom: document.querySelector("#terminalInput").getBoundingClientRect().bottom,
    terminalBottom: document.querySelector("#terminalView").getBoundingClientRect().bottom,
    composerTop: document.querySelector("#composer").getBoundingClientRect().top,
  }));
  assert.ok(desktop.inputBottom <= 450 && desktop.terminalBottom <= desktop.composerTop + 1, JSON.stringify(desktop));
  assert.equal(await page.locator(".composer-session-name").isVisible(), true, "desktop retains the target name");
  assert.equal(await page.locator("#windowStrip").isVisible(), true, "desktop retains window strip");
  assert.equal(await page.locator("#newWindowButton").isVisible(), true, "desktop retains new window control");
  assert.deepEqual(errors, []);
  console.log("Mobile regression passed: stable history prepend/reflow/background output, blur retention, gesture-only pagination, stale response discard, keyboard viewport containment, no overlap, input ACK, cancelled touch momentum, desktop layout.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
