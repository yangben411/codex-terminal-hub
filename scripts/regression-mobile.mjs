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
  stdin: { contents: source + "\nwindow.hubTest = { state, connectionProgress, resumeForeground, heartbeat, pingStream, sessionLatency, getOrCreateClientId, checkStreamHealth, inputDelivery, terminalViews, openHistoryCache, returnToLive, loadEarlierHistory, fitTerminal };", resolveDir: `${root}/src`, loader: "js" },
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
      assert.equal(url.searchParams.get("snapshot"), "frozen-history-test", "pagination must retain the frozen snapshot identity");
      earlierRequests++;
      if (delayPage) await new Promise(resolve => setTimeout(resolve, 250));
    }
    return json({ content: Array.from({ length: 160 }, (_, i) => `\x1b[31m历史第\x1b[0m ${i} 行\r\n`).join(""),
      snapshotId: "frozen-history-test", lines: 160, capturedAt: historyRequests, nextBefore: historyRequests * 160, hasEarlier: true, pending: false });
  }
  if (url.pathname === "/api/sessions") return json({ sessions: [session], defaultCwd: "/tmp" });
  if (url.pathname.startsWith("/api/")) return json({ active: true, occupied: true, phase: "live" });
  if (url.pathname === "/terminal.js") {
    response.setHeader("Content-Type", "text/javascript");
    return response.end(compiled.outputFiles.find(file => file.path.endsWith(".js")).text);
  }
  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[a-zA-Z0-9.-]+$/.test(name)) { response.writeHead(404); return response.end(); }
  try {
    const file = await readFile(`${root}/public/${name}`);
    response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".html") ? "text/html" : "application/octet-stream");
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
    localStorage.setItem("terminal-hub-language", "zh");
    window.__holdSessionReady = true;
    Object.defineProperty(navigator, "standalone", { value: true });
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
        if (data.type === "ping" && !this.dropPong) this.message({ type: "pong", clientAt: data.clientAt,
          sessions: (data.sessions || []).map(session => ({ session, connected: true })) });
        if (data.type === "session-ping") {
          const reply = () => this.message({ type: "session-pong", session: data.session, clientAt: data.clientAt, connected: true });
          if (window.__holdSessionReady) window.__releaseSessionReady = reply;
          else reply();
        }
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
  let releaseProgram;
  let programContinued;
  const programRouteDone = new Promise(resolve => { programContinued = resolve; });
  await page.route("**/terminal.js?*", async route => {
    await new Promise(resolve => { releaseProgram = resolve; });
    await route.continue();
    programContinued();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?session=${session.slug}`, { waitUntil: "commit" });
  await page.locator("#bootStatus").waitFor({ state: "visible" });
  assert.match(await page.locator("#bootStatus").textContent(), /正在加载终端程序/);
  assert.equal(await page.evaluate(() => Boolean(window.hubTest)), false, "loading UI appears before the terminal bundle executes");
  await page.waitForFunction(() => document.getElementById("bootTime")?.textContent.includes("已等待"));
  if (process.env.BOOT_SCREENSHOT) await page.screenshot({ path: process.env.BOOT_SCREENSHOT });
  assert.ok(releaseProgram, "terminal resource was delayed for this test");
  releaseProgram();
  await programRouteDone;
  await page.unroute("**/terminal.js?*");
  await page.waitForFunction(() => [...window.hubTest?.terminalViews.values() || []].some(view => view.inputReady));
  await page.waitForTimeout(1250);
  assert.equal(historyRequests, 0, "first frame alone must not trigger history loading before session readiness");
  await page.evaluate(() => { window.__holdSessionReady = false; window.__releaseSessionReady(); });
  await page.waitForFunction(() => [...window.hubTest?.terminalViews.values() || []].some(view => view.inputReady && view.historyReady));
  assert.equal(await page.locator("#bootStatus").count(), 0, "main app removes the early loading UI");
  assert.equal(await page.locator("#composerStatus").getAttribute("data-state"), "ready", "input-ready only after terminal snapshot");
  assert.equal(await page.locator("#connectionProgress li").count(), 5);
  assert.match(await page.locator("#connectionProgressTitle").textContent(), /5\/5/);
  if (process.env.CONNECTION_SCREENSHOT) {
    await page.evaluate(() => hubTest.connectionProgress(2, "正在打开当前会话，只同步当前屏幕。"));
    await page.screenshot({ path: process.env.CONNECTION_SCREENSHOT });
    await page.evaluate(() => hubTest.connectionProgress(4, "当前会话已确认可操作。"));
  }
  let redundantCalls = 0;
  await page.route("**/api/client/heartbeat", route => { redundantCalls++; return route.fulfill({ json: { active: true, occupied: true } }); });
  await page.route("**/api/client/claim", route => { redundantCalls++; return route.fulfill({ json: { active: true, occupied: true } }); });
  await page.evaluate(async () => { await hubTest.heartbeat(); await hubTest.resumeForeground(); });
  assert.equal(redundantCalls, 0, "healthy owner needs neither HTTP polling nor repeated foreground claim");
  await page.unroute("**/api/client/heartbeat");
  await page.unroute("**/api/client/claim");
  await page.evaluate(() => {
    window.__beforeNetworkChange = hubTest.state.stream;
    window.dispatchEvent(new Event("online"));
    if (hubTest.state.stream !== window.__beforeNetworkChange) throw new Error("online must not discard a healthy transport");
    window.__newNetworkStream = hubTest.state.stream;
  });
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].inputReady);
  assert.equal(await page.evaluate(() => hubTest.state.stream === window.__newNetworkStream), true,
    "foreground verification must not cancel a newly connecting socket");
  assert.equal(await page.locator(".composer-session-name").isVisible(), false, "mobile status omits session name");
  await page.evaluate(() => {
    const {state, terminalViews, pingStream, sessionLatency, checkStreamHealth} = hubTest;
    const view = [...terminalViews.values()][0];
    const socket = state.stream;
    const delayedProbe = Date.now() - 20000;
    state.streamProbeAt = delayedProbe;
    state.streamPongAt = delayedProbe;
    view.sessionProbeAt = delayedProbe;
    view.sessionPongAt = delayedProbe;
    if (sessionLatency(view) !== '响应较慢') throw new Error('stale RTT must become slow, not a false numeric latency');
    checkStreamHealth();
    if (state.stream !== socket) throw new Error('20-second silence must retain socket');
    pingStream();
    if (state.streamProbeAt !== delayedProbe) throw new Error('do not supersede a delayed probe');
    socket.message({type:'pong',clientAt:delayedProbe,sessions:[{session:view.slug,connected:true}]});
    if (state.streamProbeAt !== 0 || !sessionLatency(view).endsWith(' ms')) throw new Error('late valid pong must recover without reconnecting');
  });
  await page.locator("#mobileDirectionToggle").tap();
  await page.locator('#mobileDpad [data-key="escape"]').tap();
  assert.equal(await page.evaluate(() => window.__hubInputs.at(-1)), "\x1b", "Esc sends the escape byte to the session");
  await page.waitForFunction(() => document.querySelector('#composerStatus').dataset.state === 'ready');
  const modeInputsBefore = await page.evaluate(() => window.__hubInputs.length);
  await page.locator('#mobileDpad [data-key="shift-tab"]').tap();
  assert.equal(await page.evaluate(() => window.__hubInputs.length), modeInputsBefore + 1);
  assert.equal(await page.evaluate(() => window.__hubInputs.at(-1)), "\x1b[Z", "mode key sends only Shift+Tab, without Enter");
  await page.evaluate(() => { [...hubTest.terminalViews.values()][0].inputReady = false; });
  await page.locator('#mobileDpad [data-key="shift-tab"]').tap();
  assert.equal(await page.evaluate(() => window.__hubInputs.length), modeInputsBefore + 1, "unready mode switches are not sent or queued");
  await page.evaluate(() => { [...hubTest.terminalViews.values()][0].inputReady = true; });
  await page.locator("#mobileDirectionToggle").tap();
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
  await viewAction(async () => { await hubTest.openHistoryCache([...hubTest.terminalViews.values()][0], { native: false }); });
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
  // A sparse screen must not be lifted to its empty final row. Also cover a
  // agy-style TUI: the cursor is parked at the top, but the actual input and
  // footer are at the bottom. A parked cursor must not pin the visible region.
  for (const footer of [false, true]) {
    await page.evaluate(async footer => {
      const view = [...hubTest.terminalViews.values()][0];
      await new Promise(resolve => view.term.write("\x1b[2J\x1b[Hvisible prompt\r\n> "
        + (footer ? `\x1b[${view.term.rows - 1};1Hsession input\x1b[${view.term.rows};1Hmodel footer\x1b[1;3H` : ""), resolve));
      hubTest.fitTerminal(view);
    }, footer);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(footer => {
      const view = [...hubTest.terminalViews.values()][0];
      const screen = view.host.querySelector(".xterm-screen").getBoundingClientRect();
      const host = view.host.getBoundingClientRect();
      const rowHeight = screen.height / view.term.rows;
      const firstRow = footer ? view.term.rows - 2 : view.term.buffer.active.cursorY;
      const lastRow = footer ? view.term.rows - 1 : firstRow;
      const firstTop = screen.top + firstRow * rowHeight;
      const lastBottom = screen.top + (lastRow + 1) * rowHeight;
      return firstTop >= host.top && lastBottom <= host.bottom;
    }, footer), true, footer
      ? "parked top cursor must not crop agy's bottom input and model footer"
      : "sparse prompt must remain visible instead of an empty black tail");
  }
  // Clearing a tall agy screen must release the old keyboard lift even when
  // output keeps arriving, and also when the clear is the final output chunk.
  for (const streaming of [true, false]) {
    const lift = await page.evaluate(async streaming => {
      const view = [...hubTest.terminalViews.values()][0];
      await new Promise(resolve => view.term.write(`\x1b[2J\x1b[${view.term.rows};1Hfooter`, resolve));
      hubTest.fitTerminal(view);
      const before = view.lastKeyboardLift;
      view.lastOutputAt = Date.now();
      await new Promise(resolve => view.term.write("\x1b[2J\x1b[Hvisible prompt\r\n> ", resolve));
      hubTest.fitTerminal(view);
      const interval = streaming ? setInterval(() => {
        view.lastOutputAt = Date.now();
        hubTest.fitTerminal(view);
      }, 30) : null;
      await new Promise(resolve => setTimeout(resolve, 450));
      clearInterval(interval);
      return { before, after: view.lastKeyboardLift };
    }, streaming);
    assert.ok(lift.before > 0, "fixture must start with a lifted terminal");
    assert.equal(lift.after, 0, `old agy lift must expire without requiring silence or another output: ${streaming}`);
  }
  await page.locator("#terminalInput").fill("保留草稿");
  await page.locator("#dismissKeyboard").tap();
  assert.equal(await page.locator("#terminalInput").evaluate(el => document.activeElement === el), false);
  assert.equal(await page.locator("#terminalInput").inputValue(), "保留草稿");
  await page.locator("#terminalInput").focus();
  await page.evaluate(async () => {
    const view = [...hubTest.terminalViews.values()][0];
    await new Promise(resolve => view.term.write("\x1b[2J\x1b[H" + Array.from({ length: view.term.rows }, () => "filled row").join("\r\n"), resolve));
    hubTest.fitTerminal(view);
  });
  for (const [width, height, top] of [[390, 280, 100], [320, 300, 0], [390, 410, 50]]) {
    await page.evaluate(([w, h, y]) => mockViewport(w, h, y), [width, height, top]);
    await page.waitForTimeout(250);
    const geometry = await page.evaluate(() => {
      const input = document.querySelector("#terminalInput").getBoundingClientRect();
      const composer = document.querySelector("#composer").getBoundingClientRect();
      const terminal = document.querySelector("#terminalView").getBoundingClientRect();
      const screen = document.querySelector(".xterm-host .xterm-screen").getBoundingClientRect();
      const host = document.querySelector(".xterm-host").getBoundingClientRect();
      const dismiss = document.querySelector("#dismissKeyboard").getBoundingClientRect();
      return { inputTop: input.top, inputBottom: input.bottom, inputRight: input.right,
        dismissTop: dismiss.top, dismissBottom: dismiss.bottom,
        composerTop: composer.top, terminalBottom: terminal.bottom,
        screenBottom: screen.bottom, hostBottom: host.bottom, hostTop: host.top,
        screenLeft: screen.left, screenRight: screen.right, hostLeft: host.left, hostRight: host.right };
    });
    assert.ok(geometry.inputTop >= top && geometry.inputBottom <= top + height + 1, JSON.stringify(geometry));
    assert.ok(geometry.inputRight <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.screenLeft >= geometry.hostLeft && geometry.screenRight <= geometry.hostRight + 1,
      `terminal input and footer must fit the visible width without PTY reflow: ${JSON.stringify(geometry)}`);
    assert.equal(await page.locator(".composer-row").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true,
      "the entire input row, including send button, must fit its container");
    assert.ok(geometry.dismissTop >= top && geometry.dismissBottom <= top + height, "dismiss button stays in the visual viewport");
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
  const scrollSamples = await page.evaluate(() => {
    const view = [...hubTest.terminalViews.values()][0];
    const samples = [];
    for (const offset of [0, 30, 60, 90]) {
      view.host.scrollTop = offset;
      samples.push({ offset: view.host.scrollTop, gap: view.host.getBoundingClientRect().bottom - view.host.querySelector(".xterm-screen").getBoundingClientRect().bottom });
    }
    view.host.scrollTop = 0;
    return samples;
  });
  for (const sample of scrollSamples) {
    assert.equal(sample.offset, 0, "outer terminal wrapper must not accumulate focus-induced scroll");
    assert.ok(sample.gap >= 0 && sample.gap <= 8, `terminal bottom must stay aligned: ${JSON.stringify(sample)}`);
  }
  await page.locator("#terminalInput").focus();
  assert.equal(historyRequests, focusedRequests, "keyboard changes must not trigger history requests");
  // A browser may pan the layout after its last visualViewport event.
  await page.evaluate(() => { document.body.style.marginTop = "80px"; });
  await page.waitForTimeout(150);
  const inputWithinKeyboard = await page.locator("#terminalInput").evaluate(el => el.getBoundingClientRect().bottom <= visualViewport.offsetTop + visualViewport.height + 1);
  assert.equal(inputWithinKeyboard, true, "late keyboard pan must not cover the input");
  // Moving focus into the terminal must not stop tracking after the old
  // composer-only 800ms grace period and leave its compensation behind.
  await page.evaluate(() => [...hubTest.terminalViews.values()][0].term.focus());
  await page.waitForTimeout(1000);
  await page.evaluate(() => { document.body.style.marginTop = "0px"; });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--app-keyboard-shift")), "",
    "the old lift must fall to zero while direct terminal input remains focused");
  for (const pan of [95, 35, 0, 70, 0]) {
    await page.evaluate(pan => { document.body.style.marginTop = `${pan}px`; }, pan);
    await page.waitForTimeout(100);
    const compensation = await page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--app-keyboard-shift")) || 0);
    assert.ok(Math.abs(compensation - pan) <= 1, `compensation follows current pan, including decreases: ${compensation} vs ${pan}`);
  }
  await page.locator("#terminalInput").focus();
  assert.equal(await page.evaluate(() => window.__hubResizeCount || 0), keyboardResizes, "keyboard changes must not resize tmux through observers or timers");
  await page.locator("#terminalInput").fill("测试输入");
  await page.evaluate(() => { window.__hubHoldAck = true; });
  await page.locator("#terminalInput").press("Enter");
  assert.equal(await page.locator("#composerStatus").getAttribute("data-state"), "sending", `show pending terminal acknowledgement: ${JSON.stringify({ errors, input: await page.locator("#terminalInput").inputValue(), sent: await page.evaluate(() => window.__hubInputs) })}`);
  assert.equal(await page.locator("#terminalInput").evaluate(el => el.readOnly), true);
  assert.equal(await page.locator(".composer-row").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true,
    "pending acknowledgement text must not push input controls outside the screen");
  await page.locator("#dismissKeyboard").tap();
  await page.evaluate(() => { window.__hubHoldAck = false; window.__hubReleaseAck(); });
  await page.waitForFunction(() => document.querySelector("#terminalInput").value === "");
  assert.equal(await page.locator("#composerStatus").getAttribute("data-state"), "ready", "return to ready after acknowledgement");
  assert.equal(await page.locator("#terminalInput").evaluate(el => document.activeElement === el), false,
    "late input ACK must not reopen the dismissed keyboard");
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
    await hubTest.openHistoryCache(view, { native: false });
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
  assert.equal(await page.evaluate(() => [...hubTest.terminalViews.values()][0].term.options.fontSize), 14,
    "closing the keyboard restores the original terminal font size");
  await page.evaluate(async () => { await hubTest.openHistoryCache([...hubTest.terminalViews.values()][0]); });
  const nativeReader = page.locator(".native-history-reader pre");
  await nativeReader.waitFor({ state: "visible" });
  assert.equal(await nativeReader.locator("span").first().evaluate(el => getComputedStyle(el).color), "rgb(255, 123, 134)", "native selection keeps the terminal's ANSI theme color");
  if (process.env.HISTORY_SCREENSHOT) await page.screenshot({ path: process.env.HISTORY_SCREENSHOT });
  assert.ok(await nativeReader.evaluate(el => el.scrollHeight > el.clientHeight * 3), "native history contains multiple screens, not a viewport snapshot");
  // Reproduce the blanket outside-focus teardown with a tiny native Range.
  // This validates our event policy, not whether iOS actually emits the event.
  const smallSelection = await nativeReader.evaluate(el => {
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(text, 0); range.setEnd(text, Math.min(1, text.length));
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.body.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    document.body.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    return { connected: el.isConnected, selected: getSelection().toString() };
  });
  assert.equal(smallSelection.connected, true, "body focus must not destroy the history text layer");
  assert.equal(smallSelection.selected.length, 1, "a one-character selection must survive outside non-control events");
  await page.evaluate(() => getSelection().removeAllRanges());
  delayPage = true;
  const pagesBeforeHold = earlierRequests;
  await nativeReader.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 99 });
  await nativeReader.evaluate(el => { el.scrollTop = 0; });
  await nativeReader.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 99 });
  await page.waitForTimeout(650);
  assert.equal(earlierRequests, pagesBeforeHold, "long-press preparation must freeze pagination before a Range exists");
  await nativeReader.dispatchEvent("touchend", { touches: [], changedTouches: [] });
  await page.waitForTimeout(450);
  assert.equal(earlierRequests, pagesBeforeHold, "native handoff remains protected after release without relying on a 400ms timeout");
  // An explicit new swipe with no selection permits pagination again.
  await nativeReader.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 100, clientY: 20 });
  await nativeReader.dispatchEvent("pointermove", { pointerType: "touch", pointerId: 100, clientY: 80 });
  await nativeReader.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 100 });
  await nativeReader.dispatchEvent("touchend", { touches: [], changedTouches: [] });
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].historyLoadingEarlier);
  const crossScreenText = await nativeReader.evaluate(el => {
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    range.setStart(first, 0);
    let node = first, remaining = Math.min(900, el.textContent.length);
    while (remaining > node.length) { remaining -= node.length; node = walker.nextNode(); }
    range.setEnd(node, remaining);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    el.scrollTop = el.clientHeight;
    return getSelection().toString();
  });
  const selectedNodeText = await nativeReader.textContent();
  await page.waitForTimeout(400);
  assert.equal(await nativeReader.textContent(), selectedNodeText, "in-flight pagination cannot replace a native selection");
  assert.equal(await page.evaluate(() => getSelection().toString()), crossScreenText, "cross-screen selection survives scrolling and network completion");
  const frozenPages = earlierRequests;
  await nativeReader.evaluate(el => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  assert.equal(earlierRequests, frozenPages, "selection pauses pagination");
  await page.locator("[data-copy-selection]").tap();
  assert.equal(await page.evaluate(() => window.__copiedText), crossScreenText);
  await page.evaluate(() => getSelection().removeAllRanges());
  await nativeReader.evaluate(el => { el.scrollTop = 200; });
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].historyLoadingEarlier);
  await page.waitForFunction(() => ![...hubTest.terminalViews.values()][0].historyLoadingEarlier);
  assert.ok((await nativeReader.textContent()).length > selectedNodeText.length, "clearing selection resumes lazy history loading");
  await page.locator("[data-native-select]").tap();
  const nativeField = page.locator(".history-native-input");
  assert.equal(await nativeField.isVisible(), true);
  const fieldSelection = await nativeField.evaluate(el => {
    if (!el.readOnly) throw new Error("selection fallback must never allow terminal text edits");
    el.setSelectionRange(0, 900);
    return el.value.slice(el.selectionStart, el.selectionEnd);
  });
  await page.locator("[data-copy-selection]").tap();
  assert.equal(await page.evaluate(() => window.__copiedText), fieldSelection);
  assert.equal(await page.evaluate(() => [...hubTest.terminalViews.values()][0].historyActive), true);
  await page.locator("[data-native-select]").tap();
  assert.equal(await nativeReader.isVisible(), true);
  await page.locator("#terminalInput").focus();
  assert.equal(await nativeReader.count(), 0);
  assert.equal(await page.evaluate(() => [...hubTest.terminalViews.values()][0].historyActive), false);
  await page.locator("#terminalInput").blur();
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
  // Simulate Safari sockets that never dispatch close: the watchdog must
  // replace them, re-subscribe, and never replay an unacknowledged input.
  for (const failure of ["handshake", "heartbeat", "snapshot"]) {
    await page.evaluate((failure) => {
      const { state, terminalViews, checkStreamHealth, inputDelivery } = hubTest;
      const view = [...terminalViews.values()][0];
      window.__oldSocket = state.stream;
      window.__inputCountBeforeRecovery = (window.__hubInputs || []).length;
      window.__hubHoldAck = true;
      inputDelivery.submit("uncertain-delivery", view.slug);
      inputDelivery.flush(view.slug, true);
      if (failure === "handshake") {
        state.streamReady = false;
        state.streamStartedAt = Date.now() - 31000;
        state.stream.readyState = WebSocket.CONNECTING;
      } else if (failure === "heartbeat") state.streamPongAt = Date.now() - 61000;
      else {
        view.inputReady = false;
        view.subscriptionStartedAt = Date.now() - 61000;
      }
      checkStreamHealth();
      if (inputDelivery.job) throw new Error("uncertain input must be stopped");
    }, failure);
    await page.waitForFunction(() => hubTest.state.stream && hubTest.state.stream !== window.__oldSocket
      && [...hubTest.terminalViews.values()][0].inputReady);
    assert.equal(await page.evaluate(() => window.__hubInputs.length - window.__inputCountBeforeRecovery), 1, "recovery must not resend input");
    await page.evaluate(() => {
      window.__oldSocket.message({ type: "snapshot", session: [...hubTest.terminalViews.keys()][0], seq: 999, data: "STALE" });
      window.__hubHoldAck = false;
    });
    assert.notEqual(await page.evaluate(() => [...hubTest.terminalViews.values()][0].lastSeq), 999, "retired socket cannot overwrite current screen");
  }
  await page.evaluate(async () => {
    const oldSocket = hubTest.state.stream;
    oldSocket.dropPong = true;
    // A transport can remain OPEN after Safari resumes even though outbound
    // messages no longer reach the server. Buffered old pongs prove nothing.
    const recovery = hubTest.resumeForeground();
    setTimeout(() => oldSocket.message({ type: "pong", clientAt: 1 }), 100);
    await recovery;
    if (hubTest.state.stream === oldSocket) throw new Error("foreground must replace a half-open socket despite stale pong");
  });
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].inputReady);
  await page.evaluate(async () => {
    const { state, terminalViews, resumeForeground, getOrCreateClientId } = hubTest;
    const id = state.clientId;
    window.name = "";
    if (getOrCreateClientId() !== id) throw new Error("session storage must preserve identity when window.name is lost");
    state.idleSuspended = true;
    for (const view of terminalViews.values()) { view.serverActive = false; view.inputReady = false; }
    await resumeForeground();
    if (state.idleSuspended) throw new Error("foreground recovery must leave idle suspension without a touch");
  });
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].inputReady);
  // An earlier heartbeat response must not undo a later successful resume.
  let releaseHeartbeat;
  await page.route("**/api/client/heartbeat", async route => {
    await new Promise(resolve => { releaseHeartbeat = resolve; });
    await route.fulfill({ json: { active: false, occupied: true, phase: "live" } });
  });
  await page.evaluate(() => { hubTest.state.streamReady = false; window.__pendingHeartbeat = hubTest.heartbeat(); });
  while (!releaseHeartbeat) await new Promise(resolve => setTimeout(resolve, 10));
  await page.evaluate(() => { hubTest.state.streamReady = true; return hubTest.resumeForeground(); });
  releaseHeartbeat();
  await page.evaluate(() => window.__pendingHeartbeat);
  assert.equal(await page.evaluate(() => hubTest.state.clientActive), true, "stale heartbeat cannot revoke recovered ownership");
  await page.unroute("**/api/client/heartbeat");
  await page.route("**/api/client/claim", route => route.fulfill({ json: { active: false, occupied: true, phase: "live" } }));
  await page.evaluate(() => { hubTest.state.clientActive = false; });
  assert.equal(await page.evaluate(() => hubTest.resumeForeground()), false);
  assert.equal(await page.evaluate(() => hubTest.state.clientActive), false, "newer owner requires manual reconnect");
  assert.equal(await page.evaluate(() => hubTest.state.stream), null);
  await page.unroute("**/api/client/claim");
  await page.evaluate(() => { hubTest.state.idleSuspended = true; });
  await page.locator("#reclaimClient").click();
  await page.waitForFunction(() => [...hubTest.terminalViews.values()][0].inputReady);
  assert.equal(await page.evaluate(() => hubTest.state.idleSuspended), false, "manual reconnect also clears idle suspension");
  const installedId = await page.evaluate(() => hubTest.state.clientId);
  await page.evaluate(() => {
    sessionStorage.clear();
    window.name = "";
    history.replaceState(null, "", "/");
  });
  await page.reload();
  await page.waitForFunction(() => [...hubTest.terminalViews.values()].some(view => view.inputReady));
  assert.equal(await page.evaluate(() => hubTest.state.clientId), installedId, "installed app survives page identity loss");
  assert.equal(await page.evaluate(() => hubTest.state.activeSlug), session.slug, "root URL restores last terminal without another tap");
  assert.deepEqual(errors, []);
  console.log("Mobile regression passed: stable history prepend/reflow/background output, blur retention, gesture-only pagination, stale response discard, keyboard viewport containment, no overlap, input ACK, cancelled touch momentum, desktop layout.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
