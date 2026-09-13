import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket, WebSocketServer } from "ws";
import { RenderFlow, TerminalBroker } from "./terminal-broker.mjs";
import { historyCaptureRange } from "./history-range.mjs";
import { directorySuggestions, resolveDirectoryInput } from "./directory-suggestions.mjs";
import { createSessionNames } from "./session-name.mjs";
import { tmuxPath, tmuxArgs, codexPath, shellQuote, isExecutable } from "./runtime-paths.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const host = process.env.CODEX_TERMINAL_HOST || "127.0.0.1";
const port = Number(process.env.CODEX_TERMINAL_PORT || 7681);
const defaultCwd =
  process.env.CODEX_TERMINAL_DEFAULT_CWD || path.dirname(rootDir);
const exclusiveTerminal = process.env.CODEX_TERMINAL_EXCLUSIVE !== "0";
const historyCacheRefreshMs = boundedEnvNumber("CODEX_TERMINAL_HISTORY_CACHE_MS", 5000, 1000, 60000);
const historyCacheLines = boundedEnvNumber("CODEX_TERMINAL_HISTORY_CACHE_LINES", 3000, 200, 6000);
const historyCachePages = boundedEnvNumber("CODEX_TERMINAL_HISTORY_CACHE_PAGES", 10, 3, 30);
const historyCacheRebuildRatio = 0.8;
const historyCacheCaptureTimeoutMs = boundedEnvNumber(
  "CODEX_TERMINAL_HISTORY_CAPTURE_TIMEOUT_MS",
  3000,
  1000,
  10000,
);
const clientHeartbeatFreshMs = boundedEnvNumber("CODEX_TERMINAL_CLIENT_FRESH_MS", 6000, 3000, 30000);
const clientDisconnectGraceMs = boundedEnvNumber("CODEX_TERMINAL_CLIENT_GRACE_MS", 15000, clientHeartbeatFreshMs, 120000);
const clientActivityWindowMs = boundedEnvNumber("CODEX_TERMINAL_CLIENT_ACTIVITY_MS", 30000, 5000, 300000);
const terminalBrokerIdleMs = boundedEnvNumber("CODEX_TERMINAL_BROKER_IDLE_MS", 15 * 60 * 1000, 60 * 1000, 60 * 60 * 1000);
const renderHighWaterBytes = boundedEnvNumber("CODEX_TERMINAL_RENDER_HIGH_WATER_BYTES", 256 * 1024, 32 * 1024, 2 * 1024 * 1024);
const renderLowWaterBytes = Math.min(
  renderHighWaterBytes,
  boundedEnvNumber("CODEX_TERMINAL_RENDER_LOW_WATER_BYTES", 64 * 1024, 8 * 1024, renderHighWaterBytes),
);
const fieldSeparator = "\u001f";
const terminalBrokers = new Map();
const terminalSockets = new Set();
const historySnapshots = new Map();
const historyRefreshes = new Map();
const historyInterest = new Map();
const historyFailures = new Map();
const historyOutputBytes = new Map();
let activeClientId = null;
let activeClientClaimedAt = 0;
let activeClientSeenAt = 0;
let activeClientPresence = {
  visible: false,
  focused: false,
  lastActivityAt: 0,
};
let clientClaimQueue = Promise.resolve();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const startupCommands = {
  shell: null,
  codex: shellQuote(codexPath),
  resume: `${shellQuote(codexPath)} resume`,
};

function boundedEnvNumber(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, value)));
}

function log(message, details = "") {
  const suffix = details ? ` ${details}` : "";
  process.stdout.write(`[terminal-hub] ${message}${suffix}\n`);
}

function sessionToSlug(sessionName) {
  return Buffer.from(sessionName, "utf8").toString("base64url");
}

function slugToSession(slug) {
  try {
    const decoded = Buffer.from(slug, "base64url").toString("utf8");
    return sessionToSlug(decoded) === slug ? decoded : null;
  } catch {
    return null;
  }
}

function exactTarget(sessionName) {
  return `=${sessionName}`;
}

function validateClientId(value) {
  const clientId = `${value || ""}`;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(clientId)) {
    const error = new Error("Browser client id is invalid");
    error.statusCode = 400;
    throw error;
  }
  return clientId;
}

function normalizeClientPresence(payload = {}, now = Date.now()) {
  const reportedActivityAt = Number(payload.lastActivityAt);
  return {
    visible: payload.visible === true,
    focused: payload.focused === true,
    lastActivityAt: Number.isFinite(reportedActivityAt)
      ? Math.max(now - 24 * 60 * 60 * 1000, Math.min(now, reportedActivityAt))
      : now,
  };
}

function clientPresenceSnapshot(requesterClientId = null, now = Date.now()) {
  if (!activeClientId) {
    return {
      active: false,
      occupied: false,
      phase: "idle",
      displayed: false,
      focused: false,
      inUse: false,
      claimedAt: null,
      seenAt: null,
      seenAgoMs: null,
      graceMs: clientDisconnectGraceMs,
      graceRemainingMs: 0,
    };
  }

  const seenAgoMs = Math.max(0, now - activeClientSeenAt);
  const phase = seenAgoMs <= clientHeartbeatFreshMs
    ? "live"
    : seenAgoMs <= clientDisconnectGraceMs
      ? "grace"
      : "stale";
  const displayed = phase === "live" && activeClientPresence.visible;
  const recentlyActive = now - activeClientPresence.lastActivityAt <= clientActivityWindowMs;

  return {
    active: requesterClientId === activeClientId,
    occupied: true,
    phase,
    displayed,
    focused: displayed && activeClientPresence.focused,
    inUse: displayed && (activeClientPresence.focused || recentlyActive),
    claimedAt: activeClientClaimedAt || null,
    seenAt: activeClientSeenAt || null,
    seenAgoMs,
    graceMs: clientDisconnectGraceMs,
    graceRemainingMs: Math.max(0, clientDisconnectGraceMs - seenAgoMs),
  };
}

function requireActiveClientRequest(request) {
  return assertActiveClient(request.headers["x-terminal-client-id"]);
}

function assertActiveClient(value) {
  const clientId = validateClientId(value);
  if (!activeClientId || clientId !== activeClientId) {
    const error = new Error("This browser window is no longer active");
    error.statusCode = 409;
    throw error;
  }
  activeClientSeenAt = Date.now();
  return clientId;
}

async function runTmux(args, options = {}) {
  try {
    const execOptions = {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    };
    if (options.timeoutMs) {
      execOptions.timeout = options.timeoutMs;
      execOptions.killSignal = "SIGKILL";
    }
    const result = await execFileAsync(tmuxPath, [...tmuxArgs, ...args], execOptions);
    return options.preserveWhitespace ? result.stdout : result.stdout.trimEnd();
  } catch (error) {
    if (options.allowNoServer) {
      const message = `${error.stderr || error.message || ""}`;
      if (message.includes("no server running")
        || /error connecting to .*\((No such file or directory|Connection refused)\)/.test(message)) return "";
    }
    throw error;
  }
}

async function captureSessionHistory(session, { before = 0 } = {}) {
  const target = `${exactTarget(session.name)}:`;
  const metadata = await runTmux([
    "display-message",
    "-p",
    "-t",
    target,
    ["#{history_size}", "#{pane_width}", "#{pane_height}"].join(fieldSeparator),
  ], { timeoutMs: historyCacheCaptureTimeoutMs });
  const [historySize, paneWidthValue, paneHeightValue] = metadata.split(fieldSeparator);
  const paneWidth = Number(paneWidthValue) || 80;
  const paneHeight = Number(paneHeightValue) || 24;
  const pageLines = Math.max(paneHeight, Math.min(historyCacheLines, paneHeight * historyCachePages));
  const historySizeNumber = Number(historySize) || 0;
  const range = historyCaptureRange({ historySize: historySizeNumber, paneHeight, pageLines, before });
  const captureOptions = { timeoutMs: historyCacheCaptureTimeoutMs, preserveWhitespace: true };
  let captured = { content: "", degraded: false };

  if (range.lines > 0) {
    const captureArgs = [
      "capture-pane",
      "-p",
      "-S",
      String(range.start),
      "-E",
      String(range.end),
      "-t",
      target,
    ];
    captured = await runTmux(
      ["capture-pane", "-e", ...captureArgs.slice(1)],
      captureOptions,
    ).then(
      (content) => ({ content, degraded: false }),
      async (ansiError) => {
        const content = await runTmux(captureArgs, captureOptions);
        log("history cache used plain-text fallback", `${session.name} ${ansiError.message || ansiError}`);
        return { content, degraded: true };
      },
    );
  }

  return {
    content: captured.content,
    lines: range.lines,
    before: range.before,
    nextBefore: range.nextBefore,
    hasEarlier: range.nextBefore !== null,
    totalLines: range.totalLines,
    historySize: historySizeNumber,
    paneWidth,
    paneHeight,
    capacityLines: pageLines,
    capacityPages: Math.ceil(pageLines / paneHeight),
    activityBytesAtCapture: historyOutputBytes.get(session.name) || 0,
    degraded: captured.degraded,
    capturedAt: Date.now(),
  };
}

function refreshSessionHistoryCache(session) {
  const existing = historyRefreshes.get(session.name);
  if (existing) return existing;

  const refresh = captureSessionHistory(session)
    .then((snapshot) => {
      historySnapshots.set(session.name, snapshot);
      historyFailures.delete(session.name);
      return snapshot;
    })
    .catch((error) => {
      historyFailures.set(session.name, {
        failedAt: Date.now(),
        message: `${error.message || error}`,
      });
      if (!historySnapshots.has(session.name)) {
        log("history cache failed", `${session.name} ${error.message || error}`);
      }
      return null;
    })
    .finally(() => historyRefreshes.delete(session.name));
  historyRefreshes.set(session.name, refresh);
  return refresh;
}

function markHistoryInterest(session) {
  const now = Date.now();
  historyInterest.set(session.name, now);
  const failure = historyFailures.get(session.name);
  const retryReady = !failure || now - failure.failedAt >= historyCacheRefreshMs;
  if (!historySnapshots.has(session.name) && retryReady) refreshSessionHistoryCache(session);
}

function historyCacheNearBoundary(sessionName, snapshot) {
  if (!snapshot) return true;
  const outputBytes = historyOutputBytes.get(sessionName) || 0;
  const bytesSinceCapture = Math.max(0, outputBytes - (snapshot.activityBytesAtCapture || 0));
  const pageCapacityBytes = Math.max(1024, snapshot.paneWidth * snapshot.capacityLines);
  return bytesSinceCapture >= pageCapacityBytes * historyCacheRebuildRatio;
}

function cachedSessionHistory(session) {
  markHistoryInterest(session);
  const snapshot = historySnapshots.get(session.name);
  if (!snapshot) {
    const failure = historyFailures.get(session.name);
    const retryAfterMs = failure
      ? Math.max(0, historyCacheRefreshMs - (Date.now() - failure.failedAt))
      : 0;
    return {
      source: "cache",
      pending: true,
      refreshing: historyRefreshes.has(session.name),
      failed: Boolean(failure),
      retryAfterMs,
      content: "",
      lines: 0,
      historySize: 0,
      paneWidth: 0,
      paneHeight: 0,
      capturedAt: null,
      cacheAgeMs: null,
    };
  }
  return {
    ...snapshot,
    source: "cache",
    pending: false,
    refreshing: historyRefreshes.has(session.name),
    cacheAgeMs: Math.max(0, Date.now() - snapshot.capturedAt),
  };
}

function refreshInterestedHistoryCaches() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [sessionName, interestedAt] of historyInterest) {
    if (interestedAt < cutoff) {
      historyInterest.delete(sessionName);
      historySnapshots.delete(sessionName);
      historyFailures.delete(sessionName);
      continue;
    }
    const snapshot = historySnapshots.get(sessionName);
    if (historyCacheNearBoundary(sessionName, snapshot)) {
      refreshSessionHistoryCache({ name: sessionName });
    }
  }
}

function parseRows(output, keys) {
  if (!output.trim()) return [];
  return output.split("\n").map((line) => {
    const values = line.split(fieldSeparator);
    return Object.fromEntries(keys.map((key, index) => [key, values[index] || ""]));
  });
}

async function listSessions() {
  const sessionFormat = [
    "#{session_name}",
    "#{session_path}",
    "#{session_windows}",
    "#{session_attached}",
    "#{session_activity}",
    "#{session_last_attached}",
    "#{@codex_web_display_name}",
  ].join(fieldSeparator);
  const windowFormat = [
    "#{session_name}",
    "#{window_index}",
    "#{window_name}",
    "#{window_active}",
    "#{window_panes}",
    "#{pane_current_path}",
    "#{pane_current_command}",
  ].join(fieldSeparator);

  const sessionOutput = await runTmux(
    ["list-sessions", "-F", sessionFormat],
    { allowNoServer: true },
  );
  if (!sessionOutput) return [];

  const windowOutput = await runTmux(["list-windows", "-a", "-F", windowFormat]);
  const windows = parseRows(windowOutput, [
    "sessionName",
    "index",
    "name",
    "active",
    "panes",
    "path",
    "command",
  ]);

  const sessions = parseRows(sessionOutput, [
    "name",
    "path",
    "windows",
    "attached",
    "activity",
    "lastAttached",
    "displayName",
  ]).map((session) => ({
    ...session,
    slug: sessionToSlug(session.name),
    windows: Number(session.windows),
    attached: Number(session.attached),
    activity: Number(session.activity),
    lastAttached: Number(session.lastAttached),
    terminalReady: terminalBrokers.has(session.name),
    windowList: windows
      .filter((window) => window.sessionName === session.name)
      .map((window) => ({
        index: Number(window.index),
        name: window.name,
        active: window.active === "1",
        panes: Number(window.panes),
        path: window.path,
        command: window.command,
      })),
  }));

  return sessions.sort((left, right) => right.activity - left.activity);
}

async function resolveSession(slug) {
  const name = slugToSession(slug);
  if (!name) return null;
  const sessions = await listSessions();
  return sessions.find((session) => session.name === name) || null;
}

async function configureAdaptiveWindowSize(session) {
  const output = await runTmux([
    "list-windows",
    "-t",
    exactTarget(session.name),
    "-F",
    "#{window_id}",
  ]);
  const windowIds = output.split("\n").filter(Boolean);
  await Promise.all(
    windowIds.map((windowId) =>
      runTmux(["set-window-option", "-t", windowId, "window-size", "latest"]),
    ),
  );
}

async function claimBrowserClient(payload = {}) {
  const clientId = validateClientId(payload.clientId);
  const force = payload.force === true;
  let result;
  const operation = clientClaimQueue.then(async () => {
    if (activeClientId && activeClientId !== clientId && !force) {
      result = {
        ...clientPresenceSnapshot(clientId),
        claimed: false,
        replacedPrevious: false,
        manualReconnectRequired: true,
      };
      return;
    }

    const previousClientId = activeClientId;
    const changed = activeClientId !== clientId;
    activeClientId = clientId;
    activeClientSeenAt = Date.now();
    activeClientPresence = normalizeClientPresence(payload, activeClientSeenAt);
    if (changed) {
      activeClientClaimedAt = activeClientSeenAt;
      for (const record of terminalSockets) {
        if (record.clientId !== clientId && record.socket.readyState === WebSocket.OPEN) {
          record.socket.close(4001, "Terminal opened in another browser");
        }
      }
      log("browser claimed", clientId.slice(0, 8));
    }
    result = {
      ...clientPresenceSnapshot(clientId),
      claimed: true,
      replacedPrevious: Boolean(previousClientId && changed),
      manualReconnectRequired: false,
    };
  });
  clientClaimQueue = operation.catch(() => {});
  await operation;
  return result;
}

async function ensureTerminalBroker(session, cols = 100, rows = 30) {
  const current = terminalBrokers.get(session.name);
  if (current && !current.closed) {
    current.resize(cols, rows);
    return current;
  }
  if (current) terminalBrokers.delete(session.name);

  await runTmux(["has-session", "-t", exactTarget(session.name)]);
  await configureAdaptiveWindowSize(session);
  const broker = new TerminalBroker({
    session: session.name,
    tmuxPath,
    tmuxArgs,
    exactTarget,
    exclusive: exclusiveTerminal,
    cols,
    rows,
    scrollbackPages: historyCachePages,
    idleTimeoutMs: terminalBrokerIdleMs,
    captureHistory: () => refreshSessionHistoryCache(session),
    onOutput: (item) => {
      historyOutputBytes.set(
        session.name,
        (historyOutputBytes.get(session.name) || 0) + item.bytes,
      );
    },
    onClipboard: (text) => {
      // A one-time event, separate from render replay and reconnect snapshots.
      for (const record of terminalSockets) {
        const subscription = record.subscriptions.get(session.slug);
        if (record.clientId !== activeClientId || !subscription?.active || subscription.broker !== broker) continue;
        sendTerminalMessage(record.socket, { type: "clipboard", session: session.slug, text });
      }
    },
    logger: log,
    onIdle: (candidate) => {
      if (terminalBrokers.get(session.name) !== candidate) return;
      terminalBrokers.delete(session.name);
      candidate.close();
      log("pty reclaimed", `${session.name} idle=${terminalBrokerIdleMs}ms`);
    },
  });
  terminalBrokers.set(session.name, broker);
  broker.onExit(() => {
    if (terminalBrokers.get(session.name) === broker) terminalBrokers.delete(session.name);
    queueMicrotask(() => broker.close());
  });
  try {
    await broker.start();
    return broker;
  } catch (error) {
    if (terminalBrokers.get(session.name) === broker) terminalBrokers.delete(session.name);
    broker.close();
    throw error;
  }
}

async function validateDirectory(value) {
  const directory = resolveDirectoryInput(value || "", defaultCwd);
  const metadata = await stat(directory);
  if (!metadata.isDirectory()) throw new Error("Working directory is not a directory");
  await access(directory);
  return directory;
}

function validateSessionName(value) {
  const name = `${value || ""}`.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(name)) {
    throw new Error("Session name must use 1-48 letters, numbers, dashes, or underscores");
  }
  return name;
}

function validateWindowName(value) {
  const name = `${value || ""}`.trim();
  if (!name || name.length > 48 || /[\r\n]/.test(name)) {
    throw new Error("Window name must contain 1-48 characters");
  }
  return name;
}

function validatePreset(preset) {
  if (!Object.hasOwn(startupCommands, preset)) throw new Error("Unknown startup option");
  if (preset !== "shell" && !isExecutable(codexPath)) {
    throw new Error("Codex CLI 未安装或不在 PATH 中。请先安装，或选择只打开 Shell。");
  }
  return preset;
}

async function startPreset(target, preset) {
  const command = startupCommands[validatePreset(preset)];
  if (!command) return;
  await runTmux(["send-keys", "-t", target, "-l", "--", command]);
  await runTmux(["send-keys", "-t", target, "Enter"]);
}

async function createSession(payload) {
  validatePreset(payload.startup || "codex");
  const { name: generatedName, displayName } = createSessionNames(payload.name, new Set((await listSessions()).map(session => session.name)));
  const name = validateSessionName(generatedName);
  const cwd = await validateDirectory(payload.cwd);
  const windowName = validateWindowName(payload.windowName || "codex");
  const existing = (await listSessions()).some((session) => session.name === name);
  if (existing) {
    const error = new Error("A session with this name already exists");
    error.statusCode = 409;
    throw error;
  }

  await runTmux(["new-session", "-d", "-s", name, "-c", cwd, "-n", windowName]);
  if (displayName) {
    await runTmux(["set-option", "-t", `${exactTarget(name)}:`, "@codex_web_display_name", displayName]);
  }
  const index = await runTmux([
    "display-message",
    "-p",
    "-t",
    `${name}:`,
    "#{window_index}",
  ]);
  await startPreset(`${name}:${index}`, payload.startup || "codex");
  return (await listSessions()).find((session) => session.name === name);
}

async function createWindow(session, payload) {
  validatePreset(payload.startup || "codex");
  const cwd = await validateDirectory(payload.cwd || session.path);
  const name = validateWindowName(payload.name || "codex");
  const index = await runTmux([
    "new-window",
    "-d",
    "-P",
    "-F",
    "#{window_index}",
    "-t",
    `${session.name}:`,
    "-n",
    name,
    "-c",
    cwd,
  ]);
  await startPreset(
    `${session.name}:${index}`,
    payload.startup || "codex",
  );
  return { index: Number(index), name, cwd };
}

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; frame-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'self'",
  );
}

function sendJson(response, statusCode, payload) {
  applySecurityHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^[A-Za-z0-9._/-]+$/.test(requested) || requested.includes("..")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const filePath = path.join(publicDir, requested);
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new Error("Not a file");
    applySecurityHeaders(response);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function sendTerminalMessage(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function terminalSocketStats() {
  const subscriptions = [...terminalSockets].reduce(
    (total, record) => total + record.subscriptions.size,
    0,
  );
  const outstandingBytes = [...terminalSockets].reduce(
    (total, record) => total + [...record.subscriptions.values()].reduce(
      (subtotal, subscription) => subtotal + subscription.flow.outstandingBytes,
      0,
    ),
    0,
  );
  return {
    connections: terminalSockets.size,
    subscriptions,
    outstandingBytes,
    highWaterBytes: renderHighWaterBytes,
    lowWaterBytes: renderLowWaterBytes,
  };
}

function deactivateTerminalSubscription(subscription) {
  if (!subscription.active) return;
  subscription.active = false;
  subscription.broker.removeListener(subscription.listener);
}

function forgetTerminalSubscription(record, subscription) {
  deactivateTerminalSubscription(subscription);
  subscription.removeExitListener?.();
  record.subscriptions.delete(subscription.slug);
}

async function sendTerminalSnapshot(record, subscription) {
  if (!subscription.active || subscription.snapshotPromise) return subscription.snapshotPromise;
  subscription.snapshotPromise = (async () => {
    const snapshot = await subscription.broker.snapshot();
    if (!subscription.active || record.socket.readyState !== WebSocket.OPEN) return;
    subscription.flow.reset(snapshot.seq);
    subscription.awaitingSnapshotSeq = snapshot.seq;
    subscription.pending = false;
    sendTerminalMessage(record.socket, {
      type: "snapshot",
      session: subscription.slug,
      ...snapshot,
    });
    subscription.flow.sent(snapshot.seq, Buffer.byteLength(snapshot.data, "utf8"));
  })().catch((error) => {
    sendTerminalMessage(record.socket, {
      type: "error",
      session: subscription.slug,
      message: error.message || `${error}`,
    });
  }).finally(() => {
    subscription.snapshotPromise = null;
  });
  return subscription.snapshotPromise;
}

function sendTerminalOutput(record, subscription, item) {
  if (!subscription.active || subscription.awaitingSnapshotSeq !== null) {
    subscription.pending = true;
    return;
  }
  if (!subscription.flow.canSend(item.bytes) || record.socket.bufferedAmount > renderHighWaterBytes) {
    subscription.flow.paused = true;
    subscription.pending = true;
    sendTerminalMessage(record.socket, {
      type: "flow",
      session: subscription.slug,
      state: "buffering",
      queuedBytes: subscription.flow.outstandingBytes,
    });
    return;
  }
  if (sendTerminalMessage(record.socket, {
    type: "output",
    session: subscription.slug,
    seq: item.seq,
    data: item.data,
  })) {
    subscription.flow.sent(item.seq, item.bytes);
  }
}

async function reconcileTerminalSubscription(record, subscription) {
  if (!subscription.active || subscription.snapshotPromise) return;
  const replay = subscription.broker.outputSince(subscription.flow.ackedSeq);
  const replayBytes = replay?.reduce((total, item) => total + item.bytes, 0) || 0;
  if (!replay || replayBytes > renderHighWaterBytes) {
    await sendTerminalSnapshot(record, subscription);
    return;
  }
  subscription.pending = false;
  for (const item of replay) {
    sendTerminalOutput(record, subscription, item);
    if (subscription.pending) break;
  }
  if (!subscription.pending) {
    sendTerminalMessage(record.socket, {
      type: "flow",
      session: subscription.slug,
      state: "live",
      queuedBytes: subscription.flow.outstandingBytes,
    });
  }
}

async function subscribeTerminal(record, message) {
  const slug = `${message.session || ""}`;
  const session = await resolveSession(slug);
  if (!session) throw new Error("tmux session no longer exists");
  const cols = Math.max(2, Math.min(500, Number(message.cols) || 100));
  const rows = Math.max(2, Math.min(200, Number(message.rows) || 30));
  let subscription = record.subscriptions.get(slug);
  if (subscription?.broker.closed) {
    forgetTerminalSubscription(record, subscription);
    subscription = null;
  }
  if (!subscription) {
    const broker = await ensureTerminalBroker(session, cols, rows);
    subscription = {
      slug,
      broker,
      active: false,
      pending: false,
      awaitingSnapshotSeq: null,
      snapshotPromise: null,
      flow: new RenderFlow({
        highWaterBytes: renderHighWaterBytes,
        lowWaterBytes: renderLowWaterBytes,
      }),
      listener: null,
      removeExitListener: null,
    };
    subscription.listener = (item) => sendTerminalOutput(record, subscription, item);
    subscription.removeExitListener = broker.onExit((details) => {
      sendTerminalMessage(record.socket, { type: "exit", session: slug, ...details });
      subscription.active = false;
      record.subscriptions.delete(slug);
    });
    record.subscriptions.set(slug, subscription);
  }
  subscription.broker.resize(cols, rows);
  if (!subscription.active) {
    subscription.active = true;
    subscription.broker.addListener(subscription.listener);
  }
  await sendTerminalSnapshot(record, subscription);
}

async function handleTerminalSocketMessage(record, raw) {
  if (raw.length > 128 * 1024) throw new Error("Terminal message is too large");
  const message = JSON.parse(raw.toString("utf8"));
  activeClientSeenAt = Date.now();
  if (message.type === "ping") {
    sendTerminalMessage(record.socket, {
      type: "pong",
      clientAt: Number(message.clientAt) || null,
      serverAt: Date.now(),
    });
    return;
  }
  const subscription = record.subscriptions.get(`${message.session || ""}`);

  if (message.type === "subscribe") {
    await subscribeTerminal(record, message);
    return;
  }
  if (!subscription) throw new Error("Terminal session is not subscribed");

  if (message.type === "active") {
    if (message.active === false) {
      forgetTerminalSubscription(record, subscription);
    } else {
      subscription.broker.resize(message.cols, message.rows);
      if (!subscription.active) {
        subscription.active = true;
        subscription.broker.addListener(subscription.listener);
      }
      await sendTerminalSnapshot(record, subscription);
    }
    return;
  }
  if (message.type === "resize") {
    subscription.broker.resize(message.cols, message.rows);
    return;
  }
  if (message.type === "input") {
    const data = message.encoding === "base64"
      ? Buffer.from(`${message.data || ""}`, "base64")
      : `${message.data || ""}`;
    if (!data.length || data.length > 20000) throw new Error("Terminal input is invalid");
    subscription.broker.write(data);
    sendTerminalMessage(record.socket, {
      type: "input-ack",
      session: subscription.slug,
      inputId: `${message.inputId || ""}`.slice(0, 128),
    });
    return;
  }
  if (message.type === "ack") {
    const seq = Math.max(0, Number(message.seq) || 0);
    const snapshotAcknowledged = subscription.awaitingSnapshotSeq !== null
      && seq >= subscription.awaitingSnapshotSeq;
    const resumed = subscription.flow.acknowledge(seq);
    if (snapshotAcknowledged) subscription.awaitingSnapshotSeq = null;
    if ((snapshotAcknowledged || resumed) && (subscription.pending || subscription.broker.seq > seq)) {
      await reconcileTerminalSubscription(record, subscription);
    }
    return;
  }
  if (message.type === "snapshot") {
    await sendTerminalSnapshot(record, subscription);
    return;
  }
  throw new Error("Unknown terminal message");
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      host,
      port,
      defaultCwd,
      tmux: tmuxPath,
      exclusiveTerminal,
      exclusiveScope: "service",
      activeBrowser: Boolean(activeClientId),
      activeBrowserClaimedAt: activeClientClaimedAt || null,
      clientHeartbeatFreshMs,
      clientDisconnectGraceMs,
      clientPresence: clientPresenceSnapshot(activeClientId),
      historyCache: {
        refreshMs: historyCacheRefreshMs,
        lines: historyCacheLines,
        pages: historyCachePages,
        paged: true,
        unlimited: true,
        rebuildAtPercent: Math.round(historyCacheRebuildRatio * 100),
        snapshots: historySnapshots.size,
        refreshing: historyRefreshes.size,
      },
      terminalBrokers: [...terminalBrokers.values()].map((broker) => broker.stats()),
      terminalStream: terminalSocketStats(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/client/claim") {
    const payload = await readJson(request);
    sendJson(response, 200, await claimBrowserClient(payload));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/client/heartbeat") {
    const payload = await readJson(request);
    const clientId = validateClientId(payload.clientId);
    const active = clientId === activeClientId;
    if (active) {
      activeClientSeenAt = Date.now();
      activeClientPresence = normalizeClientPresence(payload, activeClientSeenAt);
    }
    sendJson(response, 200, clientPresenceSnapshot(clientId));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    requireActiveClientRequest(request);
    const sessions = await listSessions();
    sendJson(response, 200, {
      sessions,
      defaultCwd,
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/directories") {
    requireActiveClientRequest(request);
    sendJson(response, 200, await directorySuggestions(url.searchParams.get("path") || "", defaultCwd));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    requireActiveClientRequest(request);
    const payload = await readJson(request);
    const session = await createSession(payload);
    sendJson(response, 201, { session });
    return true;
  }

  const deleteMatch = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    requireActiveClientRequest(request);
    const session = await resolveSession(deleteMatch[1]);
    if (!session) {
      sendJson(response, 404, { error: "tmux session no longer exists" });
      return true;
    }
    const broker = terminalBrokers.get(session.name);
    if (broker) {
      terminalBrokers.delete(session.name);
      broker.close();
    }
    await runTmux(["kill-session", "-t", exactTarget(session.name)]);
    historySnapshots.delete(session.name);
    historyInterest.delete(session.name);
    historyFailures.delete(session.name);
    historyOutputBytes.delete(session.name);
    sendJson(response, 200, { ok: true, session: session.name });
    return true;
  }

  const match = url.pathname.match(
    /^\/api\/sessions\/([A-Za-z0-9_-]+)\/(windows|history|select-window|display-name)$/,
  );
  if (!match) return false;
  if (match[2] === "history" && request.method !== "GET") return false;
  if (match[2] !== "history" && request.method !== "POST") return false;
  requireActiveClientRequest(request);
  const session = await resolveSession(match[1]);
  if (!session) {
    sendJson(response, 404, { error: "tmux session no longer exists" });
    return true;
  }

  if (match[2] === "display-name") {
    const payload = await readJson(request);
    if (typeof payload.displayName !== "string" || payload.displayName.length > 64
      || /[\u0000-\u001f\u007f-\u009f]/u.test(payload.displayName)) {
      throw new Error("显示名称请使用 64 个字符以内的单行文字");
    }
    const displayName = payload.displayName.trim();
    // Session-scoped metadata shared across browsers. Never rename-session:
    // all connections, URLs and tmux targets continue to use the real name.
    if (displayName) {
      await runTmux(["set-option", "-t", `${exactTarget(session.name)}:`, "@codex_web_display_name", displayName]);
    } else {
      await runTmux(["set-option", "-u", "-t", `${exactTarget(session.name)}:`, "@codex_web_display_name"]);
    }
    sendJson(response, 200, { session: { ...session, displayName } });
    return true;
  }

  if (match[2] === "history") {
    if (url.searchParams.has("before") && url.searchParams.get("before") !== "0") {
      const before = Math.max(0, Math.floor(Number(url.searchParams.get("before")) || 0));
      markHistoryInterest(session);
      const page = await captureSessionHistory(session, { before });
      sendJson(response, 200, {
        ...page,
        source: "cache-page",
        pending: false,
        refreshing: historyRefreshes.has(session.name),
        cacheAgeMs: null,
      });
      return true;
    }
    if (url.searchParams.get("refresh") === "1") {
      await refreshSessionHistoryCache(session);
    }
    sendJson(response, 200, cachedSessionHistory(session));
    return true;
  }

  const payload = await readJson(request);

  if (match[2] === "windows") {
    const window = await createWindow(session, payload);
    sendJson(response, 201, { window });
    return true;
  }

  if (match[2] === "select-window") {
    if (!Number.isInteger(payload.index) || payload.index < 0) {
      throw new Error("Window index is invalid");
    }
    await runTmux([
      "select-window",
      "-t",
      `${session.name}:${payload.index}`,
    ]);
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) sendJson(response, 404, { error: "API endpoint not found" });
      return;
    }

    await serveStatic(request, response, url.pathname);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    sendJson(response, statusCode, { error: error.message || "Unexpected error" });
  }
});

const terminalWebSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 128 * 1024,
  perMessageDeflate: false,
});

terminalWebSocketServer.on("connection", (socket, request, context) => {
  for (const current of terminalSockets) {
    if (current.clientId === context.clientId && current.socket.readyState === WebSocket.OPEN) {
      current.socket.close(4000, "Replaced by a newer connection from this page");
    }
  }
  const record = {
    socket,
    clientId: context.clientId,
    subscriptions: new Map(),
    messageQueue: Promise.resolve(),
  };
  terminalSockets.add(record);
  socket.on("message", (data) => {
    record.messageQueue = record.messageQueue
      .then(() => handleTerminalSocketMessage(record, data))
      .catch((error) => {
        sendTerminalMessage(socket, {
          type: "error",
          message: error.message || `${error}`,
        });
      });
  });
  socket.on("close", () => {
    for (const subscription of record.subscriptions.values()) {
      forgetTerminalSubscription(record, subscription);
    }
    record.subscriptions.clear();
    terminalSockets.delete(record);
  });
  socket.on("error", (error) => log("terminal socket error", error.message));
  sendTerminalMessage(socket, {
    type: "ready",
    protocol: 2,
    renderHighWaterBytes,
    idleTimeoutMs: terminalBrokerIdleMs,
  });
});

server.on("upgrade", async (request, socket, head) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/terminal-stream") {
      const clientId = assertActiveClient(url.searchParams.get("clientId"));
      terminalWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        terminalWebSocketServer.emit("connection", webSocket, request, { clientId });
      });
      return;
    }
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  } catch {
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  }
});

function shutdown(signal) {
  log("shutting down", signal);
  clearInterval(historyCacheTimer);
  for (const record of terminalSockets) record.socket.close(1001, "Server shutting down");
  for (const broker of terminalBrokers.values()) broker.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const historyCacheTimer = setInterval(
  refreshInterestedHistoryCaches,
  historyCacheRefreshMs,
);
historyCacheTimer.unref();

server.listen(port, host, () => {
  log("ready", `http://${host}:${server.address().port}`);
  log("default directory", defaultCwd);
});
