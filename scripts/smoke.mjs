import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, realpath, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import http from "node:http";
import { gunzipSync } from "node:zlib";
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
      CODEX_TERMINAL_WORKSPACE_SAVE: "1", CODEX_TERMINAL_WORKSPACE_FILE: path.join(directory, "workspace.json"),
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
  assert.equal((await request("/api/client/claim", { clientId, reason: "foreground" })).active, true,
    "same page inherits ownership without force");
  const otherClient = `${clientId}_other`;
  assert.equal((await request("/api/client/claim", { clientId: otherClient })).active, false,
    "new page cannot automatically steal control");
  assert.equal((await request("/api/client/claim", { clientId: otherClient, force: true })).active, true);
  assert.equal((await request("/api/client/claim", { clientId, reason: "foreground" })).active, false,
    "old page cannot reclaim after a newer explicit takeover");
  assert.equal((await request("/api/client/claim", { clientId, force: true })).active, true);
  assert.deepEqual((await request("/api/sessions")).sessions, [], "first run works without any tmux server");
  await runTmux("new-session", "-d", "-s", "fixture", "/bin/bash --noprofile --norc");
  await runTmux("set-option", "-g", "default-shell", "/bin/bash");
  const html = await (await fetch(base)).text();
  assert.match(html, /terminal\.js/);
  assert.match(html, /id="bootStatus"/);
  const compressed = await new Promise((resolve, reject) => {
    http.get(`${base}/terminal.js`, { headers: { "Accept-Encoding": "gzip" } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
  const original = await readFile(path.join(root, "public", "terminal.js"));
  assert.equal(compressed.headers["content-encoding"], "gzip");
  assert.deepEqual(gunzipSync(compressed.body), original);
  assert.ok(compressed.body.length < original.length * 0.5, "bundle should transfer less than half its original bytes");
  const unchanged = await fetch(`${base}/terminal.js`, { headers: { "If-None-Match": compressed.headers.etag } });
  assert.equal(unchanged.status, 304);
  assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  const changed = await fetch(`${base}/terminal.js`, { headers: { "If-None-Match": 'W/"obsolete"', "Accept-Encoding": "gzip;q=0" } });
  assert.equal(changed.status, 200);
  assert.equal(changed.headers.get("content-encoding"), null);
  await changed.arrayBuffer();
  const head = await fetch(`${base}/terminal.js`, { method: "HEAD", headers: { "Accept-Encoding": "identity" } });
  assert.equal(Number(head.headers.get("content-length")), original.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  console.log(`Static transfer verified: ${original.length} -> ${compressed.body.length} bytes; unchanged request returns 304.`);
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
  const createdPath = path.join(directory, "新项目", "子目录");
  await assert.rejects(stat(createdPath), { code: "ENOENT" });
  const autoCreated = await request("/api/sessions", { name: "auto_directory", cwd: "新项目/子目录", startup: "shell" });
  assert.ok((await stat(createdPath)).isDirectory());
  const actualCwd = await runTmux("display-message", "-p", "-t", `=${autoCreated.session.name}:`, "#{pane_current_path}");
  assert.equal(await realpath(actualCwd.stdout.trim()), await realpath(createdPath));
  const occupied = await fetch(`${base}/api/sessions`, {
    method: "POST", headers, body: JSON.stringify({ name: "file_path", cwd: path.join(root, "package.json"), startup: "shell" }),
  });
  assert.equal(occupied.ok, false);
  assert.match((await occupied.json()).error, /文件占用/);
  const duplicate = await request("/api/sessions", { name: "测试", cwd: directory, startup: "shell" });
  assert.equal(duplicate.session.name, "ce-shi-2");
  const renamed = await request(`/api/sessions/${session.slug}/display-name`, { displayName: "工作终端" });
  assert.equal(renamed.session.displayName, "工作终端");
  assert.equal(renamed.session.name, session.name);
  const marker = `OUTPUT_${Date.now()}`;
  await runTmux("copy-mode", "-t", `=${session.name}:`);
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
        send({ type: "ping", clientAt: Date.now(), sessions: [session.slug], presence: { visible: true, focused: true } });
      }
      if (message.type === "pong") {
        assert.equal(message.sessions?.[0]?.session, session.slug);
        assert.equal(message.sessions?.[0]?.connected, true);
        pong = true;
      }
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
  assert.ok(history.snapshotId);
  // Deliberately mutate only the isolated smoke pane between page requests.
  await runTmux("send-keys", "-t", `=${session.name}:`, "printf 'NEW_HISTORY_ROW\\n'", "Enter");
  await request(`/api/sessions/${session.slug}/history?refresh=1`);
  const frozenTail = await request(`/api/sessions/${session.slug}/history?before=1&snapshot=${history.snapshotId}`);
  assert.equal(frozenTail.snapshotId, history.snapshotId);
  const oldRows = history.content.split("\n").slice(0, -1);
  assert.equal(frozenTail.content, oldRows.slice(0, -1).join("\n") + "\n",
    "later output and fresh captures cannot change a frozen page");
  const expired = await fetch(`${base}/api/sessions/${session.slug}/history?before=1&snapshot=missing`, { headers });
  assert.equal(expired.status, 410, "unknown versions cannot silently page through live history");
  await request(`/api/sessions/${session.slug}/windows`, { name: "second", cwd: directory, startup: "shell" });
  const listed = await request("/api/sessions");
  assert.equal(listed.sessions.find(item => item.slug === session.slug).windows, 2);
  assert.ok(!listed.sessions.some(item => item.name === "missing_cli"));
  const health = await request("/api/health");
  assert.equal(health.workspacePersistence.ready, true);
  const savedWorkspace = JSON.parse(await readFile(path.join(directory, "workspace.json"), "utf8"));
  assert.equal(savedWorkspace.sessions.find(item => item.name === session.name).windows.length, 2);
  assert.equal(savedWorkspace.sessions.find(item => item.name === session.name).displayName, "工作终端");
  assert.ok(health.terminalBrokers.some(item => item.session === session.name));
  assert.ok(!("ttyd" in health));
  socket.close();
  socket = new WebSocket(`${base.replace("http:", "ws:")}/api/terminal-stream?clientId=${clientId}&attempt=200`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ordered stream open timeout")), 5000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
  const staleStatus = await new Promise((resolve, reject) => {
    const stale = new WebSocket(`${base.replace("http:", "ws:")}/api/terminal-stream?clientId=${clientId}&attempt=199`);
    const timer = setTimeout(() => { stale.terminate(); reject(new Error("stale upgrade timeout")); }, 5000);
    stale.on("error", () => {});
    stale.once("unexpected-response", (_, response) => {
      clearTimeout(timer); response.resume(); stale.terminate(); resolve(response.statusCode);
    });
    stale.once("open", () => { clearTimeout(timer); stale.close(); reject(new Error("stale upgrade accepted")); });
  });
  assert.equal(staleStatus, 409);
  assert.equal(socket.readyState, WebSocket.OPEN, "stale handshake must not replace the newer live socket");
  socket.close();
  for (const item of [session, duplicate.session]) await request(`/api/sessions/${item.slug}`, null, "DELETE");
  const afterDelete = JSON.parse(await readFile(path.join(directory, "workspace.json"), "utf8"));
  assert.ok(!afterDelete.sessions.some(item => [session.name, duplicate.session.name].includes(item.name)),
    "explicit session deletion must immediately update the persisted workspace");
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
