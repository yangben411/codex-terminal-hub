import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { tmuxPath } from "../runtime-paths.mjs";

// Never connect to a running hub or the user's default tmux server.
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), "terminal-hub-smoke-"));
const socketName = `hub_smoke_${process.pid}_${Date.now()}`;
const runTmux = (...args) => exec(tmuxPath, ["-L", socketName, "-f", "/dev/null", ...args]);
const clientId = `smoke_${process.pid}_${Date.now()}`;
const headers = { "Content-Type": "application/json", "X-Terminal-Client-Id": clientId };
let child;
let socket;
try {
  await mkdir(path.join(directory, "Alpha"));
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, CODEX_TERMINAL_HOST: "127.0.0.1", CODEX_TERMINAL_PORT: "0",
      CODEX_TERMINAL_DEFAULT_CWD: directory, CODEX_TERMINAL_TMUX_SOCKET: socketName,
      CODEX_PATH: path.join(directory, "not-installed"), TMUX_PATH: tmuxPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = await new Promise((resolve, reject) => {
    let logs = "";
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 10000);
    child.on("error", reject);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}: ${logs}`)); });
    child.stderr.on("data", data => { logs += data; });
    child.stdout.on("data", data => {
      logs += data;
      const match = logs.match(/ready (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  async function request(route, payload, method = payload ? "POST" : "GET") {
    const response = await fetch(`${base}${route}`, {
      method, headers, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    assert.ok(response.ok, `${route}: ${JSON.stringify(data)}`);
    return data;
  }
  assert.equal((await fetch(`${base}/api/directories`)).status, 400);
  const claim = await request("/api/client/claim", { clientId, visible: true, focused: true });
  assert.equal(claim.active, true);
  assert.deepEqual((await request("/api/sessions")).sessions, [], "first run works without any tmux server");
  await runTmux("new-session", "-d", "-s", "fixture", "/bin/bash --noprofile --norc");
  await runTmux("set-option", "-g", "default-shell", "/bin/bash");
  const html = await (await fetch(base)).text();
  assert.match(html, /terminal\.js/);
  for (const route of ["/api/output-buffer", "/terminal/old", "/app.js", "/app-v2.js"]) {
    assert.equal((await fetch(`${base}${route}`)).status, 404, `removed endpoint: ${route}`);
  }
  const directories = await request(`/api/directories?path=${encodeURIComponent(`${directory}/a`)}`);
  assert.equal(directories.directories[0].path, path.join(directory, "Alpha"));
  const invalid = await fetch(`${base}/api/sessions`, {
    method: "POST", headers, body: JSON.stringify({ name: "missing_cli", startup: "codex", cwd: directory }),
  });
  assert.equal(invalid.status, 400);
  const { session } = await request("/api/sessions", { name: "测试", cwd: directory, startup: "shell" });
  assert.equal(session.name, "ce-shi");
  assert.equal(session.displayName, "测试");
  const duplicate = await request("/api/sessions", { name: "测试", cwd: directory, startup: "shell" });
  assert.equal(duplicate.session.name, "ce-shi-2");
  const renamed = await request(`/api/sessions/${session.slug}/display-name`, { displayName: "工作终端" });
  assert.equal(renamed.session.displayName, "工作终端");
  assert.equal(renamed.session.name, session.name);
  const marker = `OUTPUT_${Date.now()}`;
  const inputId = `input_${Date.now()}`;
  socket = new WebSocket(`${base.replace(/^http/, "ws")}/api/terminal-stream?clientId=${clientId}`);
  await new Promise((resolve, reject) => {
    let output = "", sent = false, pong = false, ack = false, sessionPong = false, disconnectedPong = false;
    const timer = setTimeout(() => reject(new Error(`Terminal timeout: ${output.slice(-500)}`)), 10000);
    const send = data => socket.send(JSON.stringify(data));
    socket.on("error", error => { clearTimeout(timer); reject(error); });
    socket.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "ready") {
        send({ type: "session-ping", session: session.slug, clientAt: Date.now() });
        send({ type: "subscribe", session: session.slug, cols: 90, rows: 24 });
        send({ type: "ping", clientAt: Date.now() });
      }
      if (message.type === "pong") pong = true;
      if (message.type === "session-pong" && message.session === session.slug) {
        if (message.connected === true) sessionPong = true;
        if (message.connected === false) disconnectedPong = true;
      }
      if (message.type === "input-ack" && message.inputId === inputId) ack = true;
      if (["snapshot", "output"].includes(message.type)) {
        output += message.data || "";
        send({ type: "ack", session: session.slug, seq: message.seq });
        if (!sent && message.type === "snapshot") {
          sent = true;
          send({ type: "session-ping", session: session.slug, clientAt: Date.now() });
          // Split marker in the command so an echoed command is not a passing result.
          send({ type: "input", session: session.slug, inputId, data: `printf '%s%s\\n' 'OUTPUT_' '${marker.slice(7)}'\r` });
        }
      }
      if (message.type === "error") { clearTimeout(timer); reject(new Error(message.message)); }
      if (pong && sessionPong && disconnectedPong && ack && output.includes(marker)) { clearTimeout(timer); resolve(); }
    });
  });
  const history = await request(`/api/sessions/${session.slug}/history?refresh=1`);
  assert.equal(history.pending, false);
  assert.ok(history.content.includes(marker));
  await request(`/api/sessions/${session.slug}/windows`, { name: "second", cwd: directory, startup: "shell" });
  const listed = await request("/api/sessions");
  assert.equal(listed.sessions.find(item => item.slug === session.slug).windows, 2);
  assert.ok(!listed.sessions.some(item => item.name === "missing_cli"));
  const health = await request("/api/health");
  assert.ok(health.terminalBrokers.some(item => item.session === session.name));
  assert.ok(!("ttyd" in health));
  socket.close();
  for (const item of [session, duplicate.session]) await request(`/api/sessions/${item.slug}`, null, "DELETE");
  console.log("Smoke passed: isolated server, directory completion, Chinese names, labels, windows, WebSocket input/render ACK, RTT, history and deletion.");
} finally {
  socket?.terminate();
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  await runTmux("kill-server").catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
