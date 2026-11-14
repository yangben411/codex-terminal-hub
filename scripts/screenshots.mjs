// Synthetic-data documentation captures. Never connects to the real Hub/tmux.
// Run after npm run build; set PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE_PATH if needed.
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}/docs/screenshots`;
await mkdir(output, { recursive: true });
const sessions = [
  ["web-demo", "示例网站", "node"], ["api-demo", "API 开发", "node"],
  ["docs-demo", "文档整理", "bash"], ["agent-demo", "规划与执行", "agy"],
].map(([name, displayName, command]) => ({ name, displayName, slug: Buffer.from(name).toString("base64url"),
  path: `/workspace/${name}`, windows: 1, attached: 1, activity: Math.floor(Date.now() / 1000),
  windowList: [{ index: 0, name: command, command, path: `/workspace/${name}`, active: true, panes: 1 }] }));
const screen = ["\x1b[1;36mDEMO WORKSPACE\x1b[0m", "Public demo · synthetic data", "",
  "$ npm test", "", "\x1b[32m✓ session routing", "✓ saved input drafts", "✓ mobile keyboard layout", "✓ history pagination\x1b[0m", "",
  "Tests: 4 passed", "", "$ npm run build", "\x1b[32mBuild completed successfully.\x1b[0m", "",
  "Next: review preview and docs.", "", "$ "].join("\r\n");
const history = Array.from({ length: 60 }, (_, i) => `\x1b[36m[demo ${String(i + 1).padStart(2, "0")}]\x1b[0m Checked example task — passed`).join("\r\n") + "\r\n";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = value => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
  if (url.pathname.includes("/history")) return json({ content: history, capturedAt: Date.now(), lines: 60, nextBefore: null, hasEarlier: false });
  if (url.pathname === "/api/sessions") return json({ sessions, defaultCwd: "/workspace" });
  if (url.pathname.startsWith("/api/")) return json({ active: true, occupied: true, phase: "live" });
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); return res.end(); }
  try {
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream");
    res.end(await readFile(`${root}/public/${file}`));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
  const context = await browser.newContext({ hasTouch: true });
  // Fail closed: no real network requests or real WebSocket connections.
  await context.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  await context.addInitScript(({ screen }) => {
    class DemoSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      readyState = 0;
      constructor() { super(); setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); this.message({ type: "ready" }); }, 20); }
      message(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
      send(raw) {
        const v = JSON.parse(raw);
        if (v.type === "subscribe") setTimeout(() => this.message({ type: "snapshot", session: v.session, seq: 1, data: screen }), 25);
        if (v.type === "ping") this.message({ type: "pong", clientAt: v.clientAt, sessions: (v.sessions || []).map(session => ({ session, connected: true })) });
        if (v.type === "session-ping") this.message({ type: "session-pong", session: v.session, clientAt: v.clientAt, connected: true });
      }
      close() { this.readyState = 3; }
    }
    window.WebSocket = DemoSocket;
  }, { screen });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(origin);
  await page.locator(".session-card").first().waitFor();
  await page.locator(`[data-open-session="${sessions[0].slug}"]`).first().click();
  await page.waitForFunction(() => document.querySelector('#composerStatus').dataset.state === 'ready');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${output}/desktop-terminal.png` });
  await page.locator('#overviewButton').click();
  await page.screenshot({ path: `${output}/desktop-overview.png` });
  await page.locator(`[data-open-session="${sessions[0].slug}"]`).first().click();
  await page.waitForTimeout(1800);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.locator("#mobileDirectionToggle").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/mobile-controls.png` });
  await page.locator("#mobileDirectionToggle").click();
  await page.locator(".terminal-history-status").click();
  await page.waitForSelector('.xterm-history-layer:not([hidden])');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${output}/mobile-history.png` });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Saved four synthetic-data screenshots to ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
