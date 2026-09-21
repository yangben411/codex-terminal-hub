import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { isBareTerminalProtocolArtifact, isTerminalProtocolReply } from "./terminal-protocol.js";
import { terminalPlainText } from "./terminal-text.js";
import { GestureClipboard } from "./gesture-clipboard.js";
import "@xterm/xterm/css/xterm.css";

const state = {
  sessions: [],
  defaultCwd: "",
  mode: "overview",
  activeSlug: null,
  multiSelection: new Set(),
  multiOpen: [],
  targetSlug: null,
  search: "",
  clientId: null,
  clientActive: false,
  clientStatus: null,
  lastActivityAt: Date.now(),
  composerOpen: false,
  stream: null,
  streamReady: false,
  streamAttempt: 0,
  streamTimer: null,
  idleSuspended: false,
  latencyMs: null,
  pendingInputs: new Map(),
  queuedInput: null,
  inputHistoryIndex: -1,
  inputHistoryDraft: "",
  mobileDpadInputMode: false,
  inputDraftSlug: null,
  inputDraftTimer: null,
  viewportWidth: null,
  viewportHeight: null,
  keyboardOpen: false,
};

const terminalViews = new Map();
const inputFailures = new Map();
const tmuxClipboard = new GestureClipboard();
let tmuxCopyGesture = null;
const terminalPanelKeepAliveMs = 15 * 60 * 1000;
const inputHistoryStorageKey = "codex-terminal-input-history-v1";
const inputHistoryLimit = 3;
const inputDraftStorageKey = "codex-terminal-input-drafts-v1";
const terminalTheme = {
  background: "#050607", foreground: "#eef3f7", cursor: "#79f2c0",
  selectionBackground: "#315947aa", black: "#0b0d11", brightBlack: "#66717d",
  red: "#ff7b86", green: "#79f2c0", yellow: "#ffcc66", blue: "#72a7ff",
  magenta: "#c792ea", cyan: "#6bd9e8", white: "#dce4ec",
};
const elements = Object.fromEntries([
  "sidebar", "scrim", "openSidebar", "closeSidebar", "connectionDot",
  "sessionSearch", "sessionList", "sessionScrollbar", "sessionScrollbarThumb",
  "newSessionButton", "refreshButton", "refreshTime",
  "viewTitle", "viewSubtitle", "overviewButton", "multiViewButton", "newWindowButton",
  "openTerminalTab", "overviewView", "terminalView", "emptyView", "sessionCount",
  "sessionGrid", "openSelectedMulti", "multiSelectionHint", "windowStrip", "terminalGrid",
  "composer", "composerToggle", "composerClose", "quickKeys", "mobileDpad", "composerStatus", "targetSession",
  "terminalInput", "sendInputButton", "mobileDirectionToggle", "newSessionDialog", "newSessionForm", "createSessionSubmit",
  "newWindowDialog", "newWindowForm", "newWindowContext", "createWindowSubmit", "clientTakeover",
  "clientTakeoverEyebrow", "clientTakeoverTitle", "clientTakeoverMessage", "clientPresenceDot",
  "clientPresenceLabel", "reclaimClient", "toast",
  "openCopyText", "copyTextDialog", "copyTextContext", "copyTextScope", "copyTextContent", "copyTextAll", "selectCopyText", "copyTextFeedback",
  "sessionLabelDialog", "sessionLabelForm", "sessionLabelInput", "sessionLabelOriginal", "sessionLabelSave",
  "newSessionCwd", "directorySuggestions", "directoryOptions", "directoryStatus",
].map((id) => [id, document.getElementById(id)]));

function terminalOptions({ history = false } = {}) {
  return {
    allowProposedApi: true,
    convertEol: history,
    cursorBlink: !history,
    cursorStyle: "bar",
    disableStdin: history,
    // tmux handles ordinary drags and copies to the server's clipboard on
    // release. Option-drag must select locally so Cmd+C copies on this device.
    macOptionClickForcesSelection: true,
    macOptionIsMeta: false,
    fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
    fontSize: 14,
    lineHeight: 1.15,
    scrollback: history ? 3000 : 300,
    scrollOnUserInput: true,
    smoothScrollDuration: 140,
    theme: terminalTheme,
  };
}

// History pages are appended as the user reaches the top. Keep xterm's own
// scrollback large enough for everything already loaded; otherwise xterm will
// silently discard the oldest pages once the initial 3000-line buffer fills.
function ensureHistoryScrollback(view, content) {
  if (!view?.historyTerm) return;
  const logicalLines = Math.max(1, `${content || ""}`.split(/\r?\n/).length);
  const rows = Math.max(1, view.historyTerm.rows || 24);
  // A logical terminal line can wrap several times on a narrow mobile screen.
  // Leave generous room for wrapping plus the currently visible rows.
  const required = (logicalLines * 3) + (rows * 4);
  view.historyTerm.options.scrollback = Math.max(
    Number(view.historyTerm.options.scrollback) || 3000,
    required,
  );
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function sessionLabel(session) {
  return session?.displayName || session?.name || "当前终端";
}

function compactPath(value) {
  return `${value || ""}`.replace(/^\/Users\/[^/]+/, "~");
}

function relativeTime(timestamp) {
  if (!timestamp) return "暂无活动";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return "刚刚活跃";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function compactBytes(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function readInputHistoryStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(inputHistoryStorageKey) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function inputHistoryFor(sessionSlug) {
  const entries = readInputHistoryStore()[sessionSlug];
  return Array.isArray(entries)
    ? entries.filter((entry) => typeof entry === "string" && entry.trim() && !isBareTerminalProtocolArtifact(entry)).slice(0, inputHistoryLimit)
    : [];
}

function rememberInput(sessionSlug, text) {
  if (!sessionSlug || !text.trim()) return;
  const store = readInputHistoryStore();
  const previous = Array.isArray(store[sessionSlug]) ? store[sessionSlug] : [];
  store[sessionSlug] = [text, ...previous.filter((entry) => entry !== text)].slice(0, inputHistoryLimit);
  try { localStorage.setItem(inputHistoryStorageKey, JSON.stringify(store)); } catch {}
}

function resetInputHistoryNavigation() {
  state.inputHistoryIndex = -1;
  state.inputHistoryDraft = "";
}

function navigateInputHistory(direction) {
  if (!state.targetSlug) return false;
  const entries = inputHistoryFor(state.targetSlug);
  if (!entries.length) return false;

  if (direction < 0) {
    if (state.inputHistoryIndex < 0) state.inputHistoryDraft = elements.terminalInput.value;
    state.inputHistoryIndex = Math.min(entries.length - 1, state.inputHistoryIndex + 1);
    elements.terminalInput.value = entries[state.inputHistoryIndex];
  } else {
    if (state.inputHistoryIndex < 0) return false;
    state.inputHistoryIndex -= 1;
    elements.terminalInput.value = state.inputHistoryIndex < 0
      ? state.inputHistoryDraft
      : entries[state.inputHistoryIndex];
  }
  const end = elements.terminalInput.value.length;
  elements.terminalInput.setSelectionRange(end, end);
  scheduleInputDraftSave();
  return true;
}

function readInputDraftStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(inputDraftStorageKey) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function inputDraftFor(sessionSlug) {
  const draft = readInputDraftStore()[sessionSlug];
  if (isBareTerminalProtocolArtifact(draft)) {
    writeInputDraft(sessionSlug, "");
    return "";
  }
  return typeof draft === "string" ? draft : "";
}

function writeInputDraft(sessionSlug, text) {
  if (!sessionSlug) return;
  const store = readInputDraftStore();
  if (text) store[sessionSlug] = text.slice(0, 20000);
  else delete store[sessionSlug];
  try { localStorage.setItem(inputDraftStorageKey, JSON.stringify(store)); } catch {}
}

function flushInputDraft() {
  clearTimeout(state.inputDraftTimer);
  state.inputDraftTimer = null;
  if (state.inputDraftSlug) writeInputDraft(state.inputDraftSlug, elements.terminalInput.value);
}

function scheduleInputDraftSave() {
  clearTimeout(state.inputDraftTimer);
  state.inputDraftTimer = setTimeout(flushInputDraft, 180);
}

function setInputTarget(sessionSlug) {
  if (state.targetSlug === sessionSlug && state.inputDraftSlug === sessionSlug) return;
  flushInputDraft();
  state.targetSlug = sessionSlug;
  state.inputDraftSlug = sessionSlug;
  elements.terminalInput.value = inputDraftFor(sessionSlug);
  resetInputHistoryNavigation();
  updateComposerConnection();
}

function updateComposerConnection() {
  if (!elements.composerStatus) return;
  const slug = state.targetSlug;
  const view = slug && terminalViews.get(slug);
  const label = sessionLabel(getSession(slug));
  const pending = [...state.pendingInputs.values()].some((item) => item.sessionSlug === slug);
  let status;
  if (!state.clientActive) status = ["offline", "连接未就绪 · 点击重新连接后才能发送"];
  else if (inputFailures.has(slug)) status = ["error", "发送未确认 · 输入已保留，请检查后重试"];
  else if (state.queuedInput?.sessionSlug === slug) status = ["waiting", "等待终端连接 · 输入已暂存"];
  else if (pending) status = ["sending", "正在发送 · 等待终端确认"];
  else if (state.streamReady && view?.serverActive && view.inputReady) status = ["ready", "已连接 · 可以输入并发送"];
  else if (state.streamTimer || [WebSocket.CONNECTING, WebSocket.OPEN].includes(state.stream?.readyState)) status = ["connecting", "正在连接终端 · 发送内容会暂存"];
  else status = ["offline", "终端未连接 · 输入会暂存，连接后发送"];
  elements.composerStatus.dataset.state = status[0];
  elements.composerStatus.textContent = `${label ? `${label} · ` : ""}${status[1]}`;
}

function activeWindow(session) {
  return session?.windowList.find((window) => window.active) || session?.windowList[0];
}

function sessionStatus(session) {
  const command = activeWindow(session)?.command;
  if (command && !["zsh", "bash", "fish"].includes(command)) {
    return { label: `${command} 运行中`, className: "live" };
  }
  if (session.attached > 0) return { label: "网页已连接", className: "live" };
  return { label: "后台待命", className: "idle" };
}

function getSession(slug) {
  return state.sessions.find((session) => session.slug === slug);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.clientId ? { "X-Terminal-Client-Id": state.clientId } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function createClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateClientId() {
  try {
    const prefix = "codex-terminal-hub:";
    if (window.name.startsWith(prefix)) {
      const stored = window.name.slice(prefix.length);
      if (/^[A-Za-z0-9_-]{16,128}$/.test(stored)) return stored;
    }
    const id = createClientId();
    window.name = `${prefix}${id}`;
    return id;
  } catch {
    return createClientId();
  }
}

function telemetry() {
  return {
    visible: !document.hidden,
    focused: document.hasFocus(),
    lastActivityAt: state.lastActivityAt,
  };
}

function presenceLabel(status) {
  if (!status?.occupied) return "等待连接";
  if (status.phase === "grace") return `断线保护 ${Math.max(1, Math.ceil(status.graceRemainingMs / 1000))} 秒`;
  if (status.phase === "stale") return "原页面已离线";
  if (status.inUse) return "另一页面正在使用";
  if (status.displayed) return "另一页面正在展示";
  return "另一页面在后台";
}

function showTakeover(status) {
  state.clientActive = false;
  state.clientStatus = status;
  closeStream(false);
  elements.connectionDot.classList.remove("online");
  elements.clientTakeoverTitle.textContent = status?.occupied ? "另一页面已连接" : "终端等待连接";
  elements.clientPresenceLabel.textContent = presenceLabel(status);
  elements.clientPresenceDot.className = `client-presence-dot ${status?.phase || "stale"}`;
  elements.clientTakeoverMessage.textContent = status?.phase === "grace"
    ? "原页面可能只是短暂断网，服务仍在保护窗口内。需要切换到这里时，请手动重新连接。"
    : "tmux 和 Codex 仍在后台运行。点击重新连接后，本页面会成为唯一活动页面。";
  elements.clientTakeover.hidden = false;
  updateComposerConnection();
}

async function claimBrowser({ force = false } = {}) {
  const result = await api("/api/client/claim", {
    method: "POST",
    body: JSON.stringify({ clientId: state.clientId, force, ...telemetry() }),
  });
  state.clientStatus = result;
  if (!result.active) {
    showTakeover(result);
    return false;
  }
  state.clientActive = true;
  elements.clientTakeover.hidden = true;
  elements.connectionDot.classList.add("online");
  elements.connectionDot.title = "控制连接已建立";
  connectStream();
  updateComposerConnection();
  return true;
}

async function heartbeat() {
  if (!state.clientId) return;
  try {
    const status = await api("/api/client/heartbeat", {
      method: "POST",
      body: JSON.stringify({ clientId: state.clientId, ...telemetry() }),
    });
    if (!status.active && state.clientActive) showTakeover(status);
    else if (!state.clientActive) {
      state.clientStatus = status;
      elements.clientPresenceLabel.textContent = presenceLabel(status);
    }
  } catch {
    elements.connectionDot.classList.remove("online");
    updateComposerConnection();
  }
}

function streamSend(payload) {
  if (!state.streamReady || state.stream?.readyState !== WebSocket.OPEN) return false;
  state.stream.send(JSON.stringify(payload));
  return true;
}

function streamUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/terminal-stream?clientId=${encodeURIComponent(state.clientId)}`;
}

function connectStream() {
  if (!state.clientActive || [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.stream?.readyState)) return;
  clearTimeout(state.streamTimer);
  state.streamReady = false;
  const socket = new WebSocket(streamUrl());
  state.stream = socket;
  socket.addEventListener("open", () => {
    state.streamAttempt = 0;
    elements.connectionDot.classList.add("online");
    updateComposerConnection();
  });
  socket.addEventListener("message", (event) => {
    try {
      handleStreamMessage(JSON.parse(event.data));
    } catch (error) {
      showToast(`终端数据错误：${error.message}`, "error");
    }
  });
  socket.addEventListener("close", (event) => {
    if (state.stream !== socket) return;
    state.streamReady = false;
    for (const view of terminalViews.values()) {
      view.serverActive = false;
      view.inputReady = false;
    }
    elements.connectionDot.classList.remove("online");
    updateComposerConnection();
    if (event.code === 4001) {
      showTakeover({ occupied: true, phase: "live", inUse: true });
      return;
    }
    if (state.clientActive) {
      const delay = Math.min(10000, 500 * (2 ** state.streamAttempt++));
      state.streamTimer = setTimeout(connectStream, delay);
    }
  });
}

function closeStream(clearClient = true) {
  tmuxClipboard.cancel();
  tmuxCopyGesture = null;
  clearTimeout(state.streamTimer);
  state.streamTimer = null;
  if (clearClient) state.clientActive = false;
  const socket = state.stream;
  state.stream = null;
  state.streamReady = false;
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Page inactive");
  for (const view of terminalViews.values()) {
    view.serverActive = false;
    view.inputReady = false;
  }
  updateComposerConnection();
}

function handleStreamMessage(message) {
  if (message.type === "pong") {
    if (message.clientAt) state.latencyMs = Math.max(0, Date.now() - message.clientAt);
    for (const view of terminalViews.values()) updateTerminalStatus(view);
    updateTerminalSubtitle();
    return;
  }
  if (message.type === "ready") {
    state.streamReady = true;
    streamSend({ type: "ping", clientAt: Date.now() });
    syncVisibleTerminals();
    updateComposerConnection();
    return;
  }
  if (message.type === "input-ack") {
    const pending = state.pendingInputs.get(message.inputId);
    if (!pending) return;
    clearTimeout(pending.timer);
    state.pendingInputs.delete(message.inputId);
    inputFailures.delete(pending.sessionSlug);
    rememberInput(pending.sessionSlug, pending.text);
    if (state.inputDraftSlug === pending.sessionSlug && elements.terminalInput.value === pending.text) {
      elements.terminalInput.value = "";
      resetInputHistoryNavigation();
      writeInputDraft(pending.sessionSlug, "");
    } else if (state.inputDraftSlug === pending.sessionSlug) {
      writeInputDraft(pending.sessionSlug, elements.terminalInput.value);
    } else {
      writeInputDraft(pending.sessionSlug, "");
    }
    elements.sendInputButton.disabled = false;
    elements.sendInputButton.textContent = "发送 ↵";
    const session = getSession(message.session);
    showToast(`已发送到 ${sessionLabel(session)}`);
    elements.terminalInput.focus({ preventScroll: true });
    updateComposerConnection();
    return;
  }
  const view = terminalViews.get(message.session);
  if (!view) {
    if (message.type === "error") showToast(message.message || "终端连接错误", "error");
    return;
  }
  if (message.type === "clipboard") {
    if (view.visible && state.clientActive && !document.hidden
      && Date.now() - (view.lastClipboardActionAt || 0) < 15000
      && typeof message.text === "string" && message.text.length <= 1024 * 1024) {
      receiveTmuxClipboard(view, message.text);
    }
    return;
  }
  if (message.type === "snapshot") {
    view.flowState = "同步缓存";
    updateTerminalStatus(view);
    view.term.reset();
    view.term.write(message.data || "", () => {
      view.lastSeq = message.seq;
      streamSend({ type: "ack", session: view.slug, seq: message.seq });
      view.flowState = "实时";
      view.inputReady = true;
      updateTerminalStatus(view);
      updateComposerConnection();
      flushQueuedComposerInput(view.slug);
    });
    return;
  }
  if (message.type === "output") {
    view.liveOutputBytes += (message.data || "").length;
    view.term.write(message.data || "", () => {
      view.lastSeq = message.seq;
      streamSend({ type: "ack", session: view.slug, seq: message.seq });
      updateTerminalStatus(view);
    });
    return;
  }
  if (message.type === "flow") {
    view.flowState = message.state === "buffering" ? "正在稳流" : "实时";
    updateTerminalStatus(view);
    return;
  }
  if (message.type === "exit") {
    view.flowState = "会话已结束";
    view.term.write("\r\n\x1b[33m[tmux 会话已结束；终端连接已关闭]\x1b[0m\r\n");
    updateTerminalStatus(view);
    showToast("tmux session 已结束，正在返回总览");
    setTimeout(() => refreshSessions({ quiet: true }), 2500);
    return;
  }
  if (message.type === "error") {
    view.flowState = "连接错误";
    updateTerminalStatus(view);
    showToast(message.message || "终端连接错误", "error");
  }
}

function updateTerminalStatus(view) {
  if (view.historyActive) {
    const ageSeconds = view.historyFrozenAt
      ? Math.max(0, Math.round((Date.now() - view.historyFrozenAt) / 1000))
      : 0;
    const newOutputBytes = Math.max(0, view.liveOutputBytes - view.historyLiveBaseline);
    const earlierState = view.historyLoadingEarlier
      ? " · 加载更早内容…"
      : view.historyHasEarlier ? " · 顶部继续加载" : " · 已到最早";
    view.status.textContent = view.historyOpening
      ? "正在冻结当前屏幕…"
      : `缓存 · 冻结 ${ageSeconds}s${newOutputBytes ? ` · +${compactBytes(newOutputBytes)}` : ""}${earlierState} · 回实时`;
    view.status.classList.add("history");
    view.status.hidden = false;
    return;
  }
  const behind = Math.max(0, view.term.buffer.active.baseY - view.term.buffer.active.viewportY);
  view.behind = behind;
  const latency = state.latencyMs === null ? "测量中" : `${Math.round(state.latencyMs)} ms`;
  view.status.textContent = behind > 0
    ? `缓存历史 · 距实时 ${behind} 行`
    : view.flowState === "实时"
      ? `${view.historyReady ? "缓存已就绪" : "缓存建立中"} · 延迟 ${latency}`
      : `${view.flowState} · 延迟 ${latency}`;
  view.status.classList.toggle("history", behind > 0);
  view.status.hidden = false;
}

function updateTerminalSubtitle() {
  const sessions = visibleSessions();
  if (!sessions.length) return;
  const latency = state.latencyMs === null ? "测量中" : `${Math.round(state.latencyMs)} ms`;
  elements.viewSubtitle.textContent = sessions.length === 1
    ? `延迟 ${latency} · 滚动缓存按需加载 · ${compactPath(sessions[0].path)}`
    : `延迟 ${latency} · 一条连接 · ${sessions.length} 个 tmux sessions`;
}

async function loadHistoryCache(view, { refresh = false } = {}) {
  if (view.historyPromise) {
    const pending = await view.historyPromise;
    if (!refresh) return pending;
  }
  view.historyPromise = api(`/api/sessions/${view.slug}/history${refresh ? "?refresh=1" : ""}`)
    .then(async (snapshot) => {
      if (snapshot.pending) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(120, snapshot.retryAfterMs || 120)));
        return api(`/api/sessions/${view.slug}/history`);
      }
      return snapshot;
    })
    .then((snapshot) => {
      if (!snapshot?.content) return snapshot;
      if (view.historyCapturedAt === snapshot.capturedAt) return snapshot;
      view.historyCapturedAt = snapshot.capturedAt;
      view.historyContent = snapshot.content;
      view.historyNextBefore = snapshot.nextBefore ?? null;
      view.historyHasEarlier = Boolean(snapshot.hasEarlier && snapshot.nextBefore !== null);
      view.historyReady = false;
      ensureHistoryScrollback(view, snapshot.content);
      view.historyTerm.reset();
      return new Promise((resolve) => {
        view.historyTerm.write(snapshot.content, () => {
          view.historyReady = true;
          view.historyTerm.scrollToBottom();
          updateTerminalStatus(view);
          resolve(snapshot);
        });
      });
    })
    .catch((error) => {
      view.historyError = error.message || `${error}`;
      return null;
    })
    .finally(() => { view.historyPromise = null; });
  return view.historyPromise;
}

async function loadEarlierHistory(view) {
  if (!view.historyActive || view.historyOpening || view.historyLoadingEarlier || !view.historyHasEarlier || view.historyNextBefore === null || composerHasFocus()) return;
  const generation = view.historyGeneration;
  view.historyLoadingEarlier = true;
  updateTerminalStatus(view);
  const before = view.historyNextBefore;
  let pageAdvanced = false;
  try {
    const page = await api(`/api/sessions/${view.slug}/history?before=${encodeURIComponent(before)}`);
    // Discard responses from a reading session exited while the request ran.
    if (!view.historyActive || view.historyGeneration !== generation || composerHasFocus()) return;
    if (!page?.content || !page.lines) {
      view.historyHasEarlier = false;
      view.historyNextBefore = null;
      return;
    }
    const distanceFromBottom = Math.max(
      0,
      view.historyTerm.buffer.active.baseY - view.historyTerm.buffer.active.viewportY,
    );
    const needsSeparator = view.historyContent && page.content
      && !page.content.endsWith("\n") && !view.historyContent.startsWith("\n");
    view.historyContent = `${page.content}${needsSeparator ? "\r\n" : ""}${view.historyContent || ""}`;
    view.historyNextBefore = page.nextBefore ?? null;
    view.historyHasEarlier = Boolean(page.hasEarlier && page.nextBefore !== null);
    pageAdvanced = view.historyNextBefore !== null && view.historyNextBefore > before;
    view.historyError = null;
    await new Promise((resolve) => {
      ensureHistoryScrollback(view, view.historyContent);
      view.historyTerm.reset();
      view.historyTerm.write(view.historyContent, () => {
        if (view.historyActive && view.historyGeneration === generation) {
          view.historyTerm.scrollToBottom();
          if (distanceFromBottom) view.historyTerm.scrollLines(-distanceFromBottom);
        }
        resolve();
      });
    });
  } catch (error) {
    view.historyError = error.message || `${error}`;
    showToast(`历史缓存加载失败：${view.historyError}`, "error");
  } finally {
    view.historyLoadingEarlier = false;
    updateTerminalStatus(view);
    // Continue a gesture-initiated read if a short page still leaves us near
    // the boundary. Do not chain failed requests or a stale reading session.
    if (pageAdvanced && view.historyGeneration === generation) {
      requestAnimationFrame(() => {
        if (view.historyGeneration === generation) requestEarlierHistory(view);
      });
    }
  }
}

async function openHistoryCache(view) {
  if (composerHasFocus() || !view.visible) return false;
  if (view.historyActive) return true;
  const generation = ++view.historyGeneration;
  view.historyActive = true;
  view.historyOpening = true;
  view.historyFrozenAt = Date.now();
  view.historyLiveBaseline = view.liveOutputBytes;
  view.historyLayer.hidden = false;
  updateTerminalStatus(view);

  // Capture tmux once when history mode starts. The history terminal then stays
  // unchanged until the user returns to live mode.
  const snapshot = await loadHistoryCache(view, { refresh: true });
  if (!view.historyActive || view.historyGeneration !== generation || composerHasFocus()) return false;
  if (!view.historyReady) {
    view.historyActive = false;
    view.historyOpening = false;
    view.historyLayer.hidden = true;
    updateTerminalStatus(view);
    showToast(view.historyError || "历史缓存仍在建立，请稍后再试", "error");
    return false;
  }
  if (!view.historyActive) return false;
  view.historyOpening = false;
  view.historyFrozenAt = snapshot?.capturedAt || Date.now();
  requestAnimationFrame(() => {
    if (!view.historyActive || view.historyGeneration !== generation || composerHasFocus()) return;
    try { view.historyFit.fit(); } catch {}
    view.historyTerm.scrollToBottom();
    view.historyTerm.scrollLines(-4);
  });
  updateTerminalStatus(view);
  return true;
}

function returnToLive(view, { focus = true } = {}) {
  for (const cancel of view.cancelHistoryGestures) cancel();
  view.historyGeneration += 1;
  if (!view.historyActive) {
    view.term.scrollToBottom();
    updateTerminalStatus(view);
    return;
  }
  view.historyActive = false;
  view.historyOpening = false;
  view.historyLayer.hidden = true;
  view.term.scrollToBottom();
  if (focus) view.term.focus();
  updateTerminalStatus(view);
}

function composerHasFocus() {
  return elements.composer.contains(document.activeElement);
}

// Start pagination from reading gestures, with continuation after a successful
// page. Never start it from xterm reset/write/fit scroll events.
function requestEarlierHistory(view) {
  const preloadRows = Math.max(8, view.historyTerm.rows * 2);
  if (view.historyTerm.buffer.active.viewportY <= preloadRows) loadEarlierHistory(view);
}

function installTouchScroller(view, host, getTerminal, { openHistoryOnUp = false } = {}) {
  let gesture = null;
  let momentum = 0;
  const stopMomentum = () => {
    if (momentum) cancelAnimationFrame(momentum);
    momentum = 0;
  };
  const cancelGesture = () => { gesture = null; stopMomentum(); };
  view.cancelHistoryGestures.push(cancelGesture);
  host.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    if (composerHasFocus()) document.activeElement.blur();
    stopMomentum();
    gesture = { id: event.pointerId, y: event.clientY, lastY: event.clientY, lastAt: performance.now(), velocity: 0, carried: 0 };
  }, { capture: true });
  host.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const now = performance.now();
    const delta = event.clientY - gesture.lastY;
    if (Math.abs(event.clientY - gesture.y) > 5) {
      event.preventDefault();
      if (openHistoryOnUp && !view.historyActive && delta > 0) {
        openHistoryCache(view);
        gesture.lastY = event.clientY;
        gesture.lastAt = now;
        gesture.velocity = 0;
        gesture.carried = 0;
        return;
      }
      const terminal = getTerminal();
      const cellHeight = Math.max(12, host.clientHeight / Math.max(1, terminal.rows));
      gesture.carried += delta / cellHeight;
      const lines = Math.trunc(gesture.carried);
      if (lines) {
        terminal.scrollLines(-lines);
        if (lines > 0) requestEarlierHistory(view);
        gesture.carried -= lines;
      }
      gesture.velocity = delta / Math.max(8, now - gesture.lastAt);
    }
    gesture.lastY = event.clientY;
    gesture.lastAt = now;
  }, { passive: false, capture: true });
  const finish = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    let velocity = gesture.velocity;
    gesture = null;
    const step = () => {
      if (!view.visible || !view.historyActive || composerHasFocus()) { cancelGesture(); return; }
      velocity *= 0.92;
      if (Math.abs(velocity) < 0.015) {
        momentum = 0;
        return;
      }
      const terminal = getTerminal();
      const cellHeight = Math.max(12, host.clientHeight / Math.max(1, terminal.rows));
      terminal.scrollLines(Math.round((-velocity * 16) / cellHeight) || (velocity > 0 ? -1 : 1));
      if (velocity > 0) requestEarlierHistory(view);
      momentum = requestAnimationFrame(step);
    };
    if (Math.abs(velocity) > 0.05) momentum = requestAnimationFrame(step);
  };
  host.addEventListener("pointerup", finish, { capture: true });
  host.addEventListener("pointercancel", cancelGesture, { capture: true });
  host.addEventListener("wheel", (event) => {
    if (event.deltaY < 0 && view.historyActive) requestAnimationFrame(() => requestEarlierHistory(view));
  }, { passive: true });
  host.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" && event.buttons && view.historyActive) {
      requestAnimationFrame(() => requestEarlierHistory(view));
    }
  }, { passive: true });
  host.addEventListener("keydown", (event) => {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) && view.historyActive) {
      requestAnimationFrame(() => requestEarlierHistory(view));
    }
  });
  if (openHistoryOnUp) {
    host.addEventListener("wheel", (event) => {
      if (event.deltaY < 0 && !view.historyActive) {
        event.preventDefault();
        openHistoryCache(view);
      }
    }, { passive: false, capture: true });
  }
}

function ensureTerminalView(session) {
  let view = terminalViews.get(session.slug);
  if (view) {
    view.name.textContent = sessionLabel(session);
    view.name.title = `原名：${session.name}`;
    view.path.textContent = compactPath(activeWindow(session)?.path || session.path);
    return view;
  }
  const panel = document.createElement("article");
  panel.className = "terminal-panel";
  panel.dataset.terminalPanel = session.slug;
  panel.hidden = true;
  panel.innerHTML = `
    <header class="terminal-panel-heading">
      <strong data-terminal-name title="原名：${escapeHtml(session.name)}">${escapeHtml(sessionLabel(session))}</strong>
      <span data-terminal-path>${escapeHtml(compactPath(activeWindow(session)?.path || session.path))}</span>
      <span class="terminal-panel-spacer"></span>
      <button type="button" class="terminal-copy" title="打开纯文本，选择并复制">复制</button>
      <button type="button" class="terminal-search" title="查找当前缓存">查找</button>
      <button type="button" class="terminal-close-session" title="结束这个 tmux session">关闭</button>
    </header>
    <div class="xterm-host" data-xterm-host></div>
    <section class="xterm-history-layer" data-history-layer hidden>
      <div class="xterm-history-host" data-history-host></div>
    </section>
    <button type="button" class="terminal-history-status" hidden>实时</button>`;
  elements.terminalGrid.append(panel);
  const host = panel.querySelector("[data-xterm-host]");
  const historyLayer = panel.querySelector("[data-history-layer]");
  const historyHost = panel.querySelector("[data-history-host]");
  const fit = new FitAddon();
  const search = new SearchAddon();
  const historyFit = new FitAddon();
  const historySearch = new SearchAddon();
  const historyTerm = new Terminal(terminalOptions({ history: true }));
  const term = new Terminal(terminalOptions());
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon());
  term.open(host);
  historyTerm.loadAddon(historyFit);
  historyTerm.loadAddon(historySearch);
  historyTerm.open(historyHost);
  view = {
    slug: session.slug, panel, host, fit, search, term,
    historyLayer, historyHost, historyFit, historySearch, historyTerm,
    name: panel.querySelector("[data-terminal-name]"),
    path: panel.querySelector("[data-terminal-path]"),
    status: panel.querySelector(".terminal-history-status"),
    visible: false, serverActive: false, lastVisibleAt: Date.now(), lastSeq: 0,
    flowState: "连接中", behind: 0, fitTimer: null,
    historyActive: false, historyOpening: false, historyReady: false, historyPromise: null,
    historyGeneration: 0, cancelHistoryGestures: [],
    historyCapturedAt: null, historyFrozenAt: null, historyError: null,
    historyContent: "", historyNextBefore: null, historyHasEarlier: false, historyLoadingEarlier: false,
    liveOutputBytes: 0, historyLiveBaseline: 0, inputReady: false,
  };
  terminalViews.set(session.slug, view);
  // Only accept terminal copy requests following interaction with this screen.
  for (const eventName of ["pointerdown", "pointerup", "keydown"]) {
    host.addEventListener(eventName, () => { view.lastClipboardActionAt = Date.now(); }, { capture: true });
  }
  host.addEventListener("pointermove", (event) => {
    if (event.buttons) view.lastClipboardActionAt = Date.now();
  }, { passive: true });
  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType !== "mouse" || event.altKey || event.shiftKey
      || view.historyActive || term.modes.mouseTrackingMode === "none") return;
    tmuxCopyGesture = { view, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }, { capture: true });
  term.onData((data) => {
    if (isTerminalProtocolReply(data)) return;
    state.lastActivityAt = Date.now();
    if (!streamSend({ type: "input", session: view.slug, data })) showToast("终端正在重连，请稍后重试", "error");
  });
  term.onBinary((data) => {
    if (!streamSend({ type: "input", session: view.slug, data: btoa(data), encoding: "base64" })) {
      showToast("终端正在重连，请稍后重试", "error");
    }
  });
  term.onResize(({ cols, rows }) => {
    term.options.scrollback = Math.max(200, rows * 9);
    if (view.serverActive) streamSend({ type: "resize", session: view.slug, cols, rows });
  });
  term.onScroll(() => updateTerminalStatus(view));
  view.status.addEventListener("click", () => {
    if (view.historyActive) returnToLive(view);
    else openHistoryCache(view);
  });
  term.attachCustomWheelEventHandler((event) => {
    if (event.deltaY < 0 && !view.historyActive) {
      openHistoryCache(view);
      return false;
    }
    return true;
  });
  panel.querySelector(".terminal-search").addEventListener("click", () => {
    const needle = prompt("查找当前终端缓存中的文字：");
    if (needle) (view.historyActive ? historySearch : search).findNext(needle, {
      incremental: true,
      decorations: { matchBackground: "#705d19", activeMatchBackground: "#4a8067" },
    });
  });
  panel.querySelector(".terminal-close-session").addEventListener("click", () => closeSession(session.slug));
  panel.querySelector(".terminal-copy").addEventListener("click", () => openCopyText(view.slug));
  historyTerm.onScroll(() => {
    updateTerminalStatus(view);
  });
  const resizeObserver = new ResizeObserver(() => {
    if (!view.visible) return;
    clearTimeout(view.fitTimer);
    view.fitTimer = setTimeout(() => fitTerminal(view), 50);
  });
  resizeObserver.observe(host);
  resizeObserver.observe(historyHost);
  view.resizeObserver = resizeObserver;
  installTouchScroller(view, host, () => view.historyActive ? historyTerm : term, { openHistoryOnUp: true });
  installTouchScroller(view, historyHost, () => historyTerm);
  loadHistoryCache(view, { refresh: true });
  return view;
}

function fitTerminal(view) {
  if (!view.visible || view.panel.hidden || !view.host.clientWidth || !view.host.clientHeight) return;
  try {
    view.fit.fit();
    if (view.historyActive) view.historyFit.fit();
    if (view.serverActive) streamSend({ type: "resize", session: view.slug, cols: view.term.cols, rows: view.term.rows });
  } catch {}
}

let viewportFitTimer = null;
let composerFitTimer = null;

function refitVisibleTerminals() {
  for (const view of terminalViews.values()) if (view.visible) fitTerminal(view);
}

function syncComposerLayout({ fit = true } = {}) {
  // CSS grid reserves input space synchronously; only the terminals need refit.
  if (!fit) return;
  requestAnimationFrame(refitVisibleTerminals);
  clearTimeout(composerFitTimer);
  composerFitTimer = setTimeout(refitVisibleTerminals, 80);
}

function syncVisualViewport() {
  const viewport = window.visualViewport;
  const measuredWidth = Math.max(1, Math.round(viewport?.width || window.innerWidth));
  const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));
  const previousHeight = state.viewportHeight || height;
  const widthChanged = state.viewportWidth !== null && Math.abs(measuredWidth - state.viewportWidth) > 2;
  const keyboardOpening = !widthChanged && height < previousHeight - 60;
  const keyboardClosing = state.keyboardOpen && !keyboardOpening && height > previousHeight + 60;
  // iOS may report a narrower visual viewport while the keyboard is visible.
  // Keep the layout width stable; only an actual browser/orientation resize may
  // establish a new width.
  if (state.viewportWidth === null || widthChanged || !state.keyboardOpen) {
    state.viewportWidth = measuredWidth;
  }
  state.keyboardOpen = keyboardOpening || (state.keyboardOpen && !keyboardClosing);
  state.viewportHeight = height;
  document.documentElement.style.setProperty("--app-viewport-width", `${state.viewportWidth}px`);
  document.documentElement.style.setProperty("--app-viewport-height", `${height}px`);
  document.documentElement.style.setProperty("--app-viewport-top", `${Math.max(0, Math.round(viewport?.offsetTop || 0))}px`);
  document.documentElement.style.setProperty("--app-viewport-left", `${Math.max(0, Math.round(viewport?.offsetLeft || 0))}px`);
  // Safari can emit several visualViewport events while its address bar moves.
  // Wait for the viewport to settle so tmux receives one final resize.
  clearTimeout(viewportFitTimer);
  if (state.keyboardOpen && !keyboardClosing) {
    // Let CSS move the bottom composer into the visible viewport. Do not fit
    // xterm or send tmux a new size while the keyboard is animating.
    syncComposerLayout({ fit: false });
    return;
  }
  viewportFitTimer = setTimeout(() => {
    state.keyboardOpen = false;
    syncComposerLayout();
    refitVisibleTerminals();
  }, 180);
}

function activateTerminalView(session) {
  const view = ensureTerminalView(session);
  view.visible = true;
  view.lastVisibleAt = Date.now();
  view.panel.hidden = false;
  requestAnimationFrame(() => {
    fitTerminal(view);
    if (!view.serverActive && state.streamReady) {
      view.inputReady = false;
      view.serverActive = true;
      streamSend({ type: "subscribe", session: view.slug, cols: view.term.cols, rows: view.term.rows });
    }
  });
  return view;
}

function deactivateTerminalView(view) {
  tmuxClipboard.cancel(view.slug);
  if (tmuxCopyGesture?.view === view) tmuxCopyGesture = null;
  if (!view.visible) return;
  view.visible = false;
  returnToLive(view, { focus: false });
  view.lastVisibleAt = Date.now();
  view.panel.hidden = true;
  if (view.serverActive) streamSend({ type: "active", session: view.slug, active: false });
  view.serverActive = false;
}

function visibleSessions() {
  if (state.mode === "focus") return [getSession(state.activeSlug)].filter(Boolean);
  if (state.mode === "multi") return state.multiOpen.map(getSession).filter(Boolean);
  return [];
}

function syncVisibleTerminals() {
  const sessions = visibleSessions();
  const visible = new Set(sessions.map((session) => session.slug));
  for (const view of terminalViews.values()) {
    if (!visible.has(view.slug)) deactivateTerminalView(view);
  }
  if (!state.idleSuspended) sessions.forEach(activateTerminalView);
}

function renderSessionList() {
  const query = state.search.toLowerCase();
  const filtered = state.sessions.filter((session) => `${sessionLabel(session)} ${session.name} ${session.path}`.toLowerCase().includes(query));
  elements.sessionList.innerHTML = filtered.length ? filtered.map((session) => {
    const status = sessionStatus(session);
    return `<div class="session-list-row"><button class="session-item ${state.activeSlug === session.slug ? "active" : ""}" data-open-session="${session.slug}" title="原名：${escapeHtml(session.name)}">
      <span class="status-dot ${status.className}"></span><span class="session-copy"><strong>${escapeHtml(sessionLabel(session))}</strong>
      <small>${escapeHtml(compactPath(session.path))}</small></span><span class="session-badge">${session.windows}W</span></button>
      <button class="session-label-edit" data-edit-label="${session.slug}" title="修改显示名称" aria-label="修改 ${escapeHtml(sessionLabel(session))} 的显示名称">✎</button></div>`;
  }).join("") : `<div class="session-list-empty">${state.sessions.length ? "没有匹配的会话" : "还没有 tmux session"}</div>`;
  requestAnimationFrame(syncSessionScrollbar);
}

function sessionScrollGeometry() {
  const list = elements.sessionList;
  const track = elements.sessionScrollbar;
  const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
  const trackHeight = Math.max(0, track.clientHeight);
  const thumbHeight = Math.min(trackHeight, Math.max(34, Math.round(trackHeight * list.clientHeight / Math.max(1, list.scrollHeight))));
  const thumbTravel = Math.max(0, trackHeight - thumbHeight);
  return { maxScroll, trackHeight, thumbHeight, thumbTravel };
}

function syncSessionScrollbar() {
  const list = elements.sessionList;
  const track = elements.sessionScrollbar;
  const thumb = elements.sessionScrollbarThumb;
  const scrollable = list.scrollHeight - list.clientHeight > 1;
  track.hidden = !scrollable;
  if (!scrollable) return;

  const geometry = sessionScrollGeometry();
  const thumbTop = geometry.maxScroll
    ? Math.round((list.scrollTop / geometry.maxScroll) * geometry.thumbTravel)
    : 0;
  thumb.style.height = `${geometry.thumbHeight}px`;
  thumb.style.transform = `translateY(${thumbTop}px)`;
  track.setAttribute("aria-valuemax", String(Math.round(geometry.maxScroll)));
  track.setAttribute("aria-valuenow", String(Math.round(list.scrollTop)));
}

let sessionScrollDrag = null;

function moveSessionScrollbar(clientY, thumbOffset) {
  const trackRect = elements.sessionScrollbar.getBoundingClientRect();
  const geometry = sessionScrollGeometry();
  if (!geometry.maxScroll || !geometry.thumbTravel) return;
  const thumbTop = Math.max(0, Math.min(geometry.thumbTravel, clientY - trackRect.top - thumbOffset));
  elements.sessionList.scrollTop = (thumbTop / geometry.thumbTravel) * geometry.maxScroll;
}

function stopSessionScrollbarDrag(pointerId) {
  if (!sessionScrollDrag || (pointerId != null && pointerId !== sessionScrollDrag.pointerId)) return;
  try { elements.sessionScrollbar.releasePointerCapture(sessionScrollDrag.pointerId); } catch {}
  sessionScrollDrag = null;
  elements.sessionScrollbar.classList.remove("dragging");
}

function renderOverview() {
  elements.sessionCount.textContent = state.sessions.length;
  elements.emptyView.hidden = state.sessions.length > 0;
  elements.overviewView.hidden = state.sessions.length === 0 || state.mode !== "overview";
  elements.sessionGrid.innerHTML = state.sessions.map((session) => {
    const status = sessionStatus(session);
    const window = activeWindow(session);
    const selected = state.multiSelection.has(session.slug);
    return `<article class="session-card ${selected ? "selected" : ""}">
      <div class="session-card-top"><div><span class="status-line"><i class="status-dot ${status.className}"></i>${status.label}</span>
      <h3 title="原名：${escapeHtml(session.name)}">${escapeHtml(sessionLabel(session))}</h3></div><label class="multi-check" title="加入多窗"><input type="checkbox" data-multi-select="${session.slug}" ${selected ? "checked" : ""}></label></div>
      <p class="session-path" title="${escapeHtml(session.path)}">${escapeHtml(compactPath(session.path))}</p>
      <div class="session-meta"><span>${escapeHtml(window?.name || "shell")}</span><span>${session.windows} windows</span><span>${relativeTime(session.activity)}</span></div>
      <div class="session-card-actions"><button class="primary-button" data-open-session="${session.slug}">打开终端</button>
      <button class="quiet-button" data-add-window="${session.slug}">＋ Window</button>
      <button class="quiet-button" data-edit-label="${session.slug}">备注名</button>
      <button class="quiet-button session-close-button" data-close-session="${session.slug}">关闭</button></div></article>`;
  }).join("");
  updateMultiHint();
}

function renderWindowStrip(sessions) {
  if (sessions.length !== 1) {
    elements.windowStrip.innerHTML = `<span class="window-pill active">多窗模式 · ${sessions.length} sessions</span>`;
    return;
  }
  const session = sessions[0];
  elements.windowStrip.innerHTML = session.windowList.map((window) =>
    `<button class="window-pill ${window.active ? "active" : ""}" data-window-index="${window.index}" data-session-slug="${session.slug}">${window.index}: ${escapeHtml(window.name)}</button>`,
  ).join("");
}

function renderTerminal() {
  const sessions = visibleSessions();
  elements.terminalView.hidden = !sessions.length;
  elements.overviewView.hidden = true;
  elements.emptyView.hidden = true;
  elements.terminalGrid.classList.toggle("multi", sessions.length > 1);
  renderWindowStrip(sessions);
  if (!sessions.length) return showOverview();
  if (!sessions.some((session) => session.slug === state.targetSlug)) setInputTarget(sessions[0].slug);
  else if (state.inputDraftSlug !== state.targetSlug) setInputTarget(state.targetSlug);
  elements.targetSession.innerHTML = sessions.map((session) => `<option value="${session.slug}">${escapeHtml(sessionLabel(session))}</option>`).join("");
  elements.targetSession.value = state.targetSlug;
  elements.composer.hidden = false;
  document.querySelector(".main-area").classList.add("terminal-active");
  setComposer(true);
  // Reserve the composer before creating/subscribing xterm. Otherwise the first
  // fit uses the full screen and a second fit shrinks tmux by several rows.
  syncComposerLayout();
  syncVisibleTerminals();
  elements.newWindowButton.disabled = sessions.length !== 1;
  elements.openTerminalTab.disabled = sessions.length !== 1;
  elements.openCopyText.hidden = false;
  if (sessions.length === 1) {
    elements.viewTitle.textContent = sessionLabel(sessions[0]);
  } else {
    elements.viewTitle.textContent = "多窗终端";
  }
  updateTerminalSubtitle();
  renderSessionList();
}

function showOverview() {
  flushInputDraft();
  state.mode = "overview";
  state.activeSlug = null;
  elements.terminalView.hidden = true;
  elements.composer.hidden = true;
  document.querySelector(".main-area").classList.remove("terminal-active");
  setComposer(false);
  for (const view of terminalViews.values()) deactivateTerminalView(view);
  elements.viewTitle.textContent = "Sessions";
  elements.viewSubtitle.textContent = "全部 tmux 工作区";
  elements.newWindowButton.disabled = true;
  elements.openTerminalTab.disabled = true;
  elements.openCopyText.hidden = true;
  renderSessionList();
  renderOverview();
}

function openSession(slug) {
  if (!getSession(slug)) return;
  state.mode = "focus";
  state.activeSlug = slug;
  setInputTarget(slug);
  renderTerminal();
  closeSidebar();
}

function openMulti(slugs) {
  const valid = [...new Set(slugs)].filter(getSession).slice(0, 4);
  if (!valid.length) return;
  state.mode = "multi";
  state.multiOpen = valid;
  state.activeSlug = null;
  setInputTarget(valid[0]);
  renderTerminal();
  closeSidebar();
}

async function refreshSessions({ quiet = false } = {}) {
  if (!state.clientActive) return;
  try {
    const data = await api("/api/sessions");
    state.sessions = data.sessions;
    state.defaultCwd = data.defaultCwd;
    const valid = new Set(state.sessions.map((session) => session.slug));
    state.multiSelection = new Set([...state.multiSelection].filter((slug) => valid.has(slug)));
    state.multiOpen = state.multiOpen.filter((slug) => valid.has(slug));
    if (state.activeSlug && !valid.has(state.activeSlug)) showOverview();
    else if (state.mode === "overview") {
      renderSessionList(); renderOverview();
    } else renderTerminal();
    elements.refreshTime.textContent = `更新于 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    if (!quiet) showToast(error.message, "error");
  }
}

function setComposer(open) {
  state.composerOpen = Boolean(state.mode !== "overview" && state.clientActive);
  elements.composer.classList.toggle("open", state.composerOpen);
  elements.composer.classList.toggle("docked", state.composerOpen);
  elements.composer.setAttribute("aria-hidden", String(!state.composerOpen));
  elements.composerToggle.setAttribute("aria-expanded", String(state.composerOpen));
  elements.composerToggle.hidden = true;
  if (!state.composerOpen) {
    elements.mobileDirectionToggle?.setAttribute("aria-expanded", "false");
    elements.mobileDirectionToggle?.closest(".mobile-control-deck")?.classList.remove("controls-open");
  }
  requestAnimationFrame(syncComposerLayout);
}

function showToast(message, type = "success") {
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { elements.toast.className = "toast"; }, 3200);
}

let copyTextSnapshot = null;

function updateCopyText() {
  elements.copyTextContent.value = copyTextSnapshot?.[elements.copyTextScope.value] || "";
  elements.copyTextContent.scrollTop = 0;
  elements.copyTextAll.disabled = !elements.copyTextContent.value.trim();
  elements.copyTextFeedback.textContent = "长按文字选择并复制，也可以一键复制全部。";
}

function openCopyText(slug = state.targetSlug || state.activeSlug) {
  const view = terminalViews.get(slug);
  if (!view?.visible) return showToast("请先打开一个 session", "error");
  if (view.historyOpening) return showToast("缓存正在加载，请稍后复制", "error");
  const terminal = view.historyActive ? view.historyTerm : view.term;
  copyTextSnapshot = {
    screen: terminalPlainText(terminal),
    loaded: terminalPlainText(terminal, { viewportOnly: false }),
  };
  elements.copyTextContext.textContent = `${sessionLabel(getSession(slug))} · ${view.historyActive ? "历史缓存" : "实时屏幕"}的文字副本，打开后不再刷新。`;
  elements.copyTextScope.value = "screen";
  elements.copyTextScope.disabled = false;
  updateCopyText();
  elements.copyTextDialog.showModal();
}

async function receiveTmuxClipboard(view, text) {
  // Remember which request this is so a late permission rejection cannot
  // replace the text of a newer selection.
  const request = {};
  receiveTmuxClipboard.latest = request;
  const copied = await tmuxClipboard.write(view.slug, text);
  if (receiveTmuxClipboard.latest !== request) return;
  showToast(copied ? "所选文字已复制到当前设备" : "浏览器未允许自动复制，剪贴板未更新", copied ? "success" : "error");
}

document.addEventListener("pointermove", (event) => {
  const gesture = tmuxCopyGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) gesture.moved = true;
  gesture.view.lastClipboardActionAt = Date.now();
}, { capture: true, passive: true });
document.addEventListener("pointerup", (event) => {
  const gesture = tmuxCopyGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  tmuxCopyGesture = null;
  const view = gesture.view;
  if (!gesture.moved || !view.visible || view.historyActive || !state.clientActive || document.hidden) return;
  view.lastClipboardActionAt = Date.now();
  tmuxClipboard.begin(view.slug);
}, { capture: true });
document.addEventListener("pointercancel", () => { tmuxCopyGesture = null; });

elements.openCopyText.addEventListener("click", () => openCopyText());
elements.copyTextScope.addEventListener("change", updateCopyText);
elements.selectCopyText.addEventListener("click", () => {
  elements.copyTextContent.focus();
  elements.copyTextContent.select();
  elements.copyTextContent.setSelectionRange(0, elements.copyTextContent.value.length);
  elements.copyTextFeedback.textContent = "已全选，可使用系统菜单复制。";
});
elements.copyTextAll.addEventListener("click", async () => {
  const text = elements.copyTextContent.value;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(text);
    elements.copyTextFeedback.textContent = "已复制到当前设备的剪贴板。";
  } catch {
    elements.copyTextContent.focus();
    elements.copyTextContent.select();
    elements.copyTextContent.setSelectionRange(0, text.length);
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    elements.copyTextFeedback.textContent = copied
      ? "已复制到当前设备的剪贴板。"
      : "浏览器未允许一键复制。文字已全选，请长按并选择系统菜单中的复制。";
  }
});
elements.copyTextDialog.addEventListener("close", () => {
  copyTextSnapshot = null;
  elements.copyTextContent.value = "";
});

function openSidebar() { elements.sidebar.classList.add("open"); elements.scrim.classList.add("open"); }
function closeSidebar() { elements.sidebar.classList.remove("open"); elements.scrim.classList.remove("open"); }

function updateMultiHint() {
  const count = state.multiSelection.size;
  elements.multiSelectionHint.textContent = count ? `已选择 ${count} 个（最多 4 个）` : "未选择会话";
  elements.openSelectedMulti.disabled = count === 0;
}

function openNewSessionDialog() {
  const form = elements.newSessionForm;
  form.reset();
  form.elements.cwd.value = `${state.defaultCwd.replace(/\/+$/, "")}/`;
  form.elements.windowName.value = "codex";
  elements.newSessionDialog.showModal();
}

const directoryCompletion = { timer: null, controller: null, generation: 0, items: [], active: -1 };

function hideDirectorySuggestions() {
  clearTimeout(directoryCompletion.timer);
  directoryCompletion.controller?.abort();
  directoryCompletion.generation += 1;
  directoryCompletion.items = [];
  directoryCompletion.active = -1;
  elements.directorySuggestions.hidden = true;
  elements.directoryOptions.replaceChildren();
  elements.newSessionCwd.setAttribute("aria-expanded", "false");
  elements.newSessionCwd.removeAttribute("aria-activedescendant");
}

function requestDirectorySuggestions() {
  hideDirectorySuggestions();
  if (!elements.newSessionDialog.open) return;
  const generation = directoryCompletion.generation;
  const value = elements.newSessionCwd.value;
  elements.directorySuggestions.hidden = false;
  elements.directoryStatus.textContent = "正在读取文件夹…";
  elements.newSessionCwd.setAttribute("aria-expanded", "true");
  directoryCompletion.timer = setTimeout(async () => {
    const controller = new AbortController();
    directoryCompletion.controller = controller;
    try {
      const result = await api(`/api/directories?path=${encodeURIComponent(value)}`, { signal: controller.signal });
      if (generation !== directoryCompletion.generation || !elements.newSessionDialog.open) return;
      directoryCompletion.items = result.directories;
      elements.directoryStatus.textContent = result.directories.length
        ? `${result.parent} · ${result.truncated ? "前 80 项，请继续输入缩小范围" : `${result.directories.length} 个文件夹`}`
        : "没有匹配的子文件夹；已有路径可直接用于创建。";
      elements.directoryOptions.innerHTML = result.directories.map((item, index) =>
        `<button type="button" class="directory-option" id="directory-option-${index}" role="option" aria-selected="false" data-directory-index="${index}" data-directory-path="${escapeHtml(item.path)}">${escapeHtml(item.name)}/</button>`
      ).join("");
    } catch (error) {
      if (generation !== directoryCompletion.generation || error.name === "AbortError") return;
      elements.directoryStatus.textContent = `无法列出目录：${error.message}`;
    }
  }, 150);
}

function chooseDirectory(index) {
  const item = directoryCompletion.items[index];
  if (!item) return;
  selectDirectoryPath(item.path);
}

function selectDirectoryPath(path) {
  elements.newSessionCwd.value = `${path.replace(/\/+$/, "")}/`;
  elements.newSessionCwd.focus({ preventScroll: true });
  elements.newSessionCwd.setSelectionRange(elements.newSessionCwd.value.length, elements.newSessionCwd.value.length);
  requestDirectorySuggestions();
}

elements.newSessionCwd.addEventListener("focus", requestDirectorySuggestions);
elements.newSessionCwd.addEventListener("input", (event) => {
  if (!event.isComposing) requestDirectorySuggestions();
});
elements.newSessionCwd.addEventListener("compositionend", requestDirectorySuggestions);
elements.newSessionCwd.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  const { items } = directoryCompletion;
  if (["ArrowDown", "ArrowUp"].includes(event.key) && items.length) {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    directoryCompletion.active = directoryCompletion.active < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (directoryCompletion.active + direction + items.length) % items.length;
    for (const [index, button] of [...elements.directoryOptions.children].entries()) {
      button.setAttribute("aria-selected", String(index === directoryCompletion.active));
    }
    const selected = elements.directoryOptions.children[directoryCompletion.active];
    elements.newSessionCwd.setAttribute("aria-activedescendant", selected.id);
    selected.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && !elements.directorySuggestions.hidden) {
    event.preventDefault();
    if (directoryCompletion.active >= 0) chooseDirectory(directoryCompletion.active);
    else hideDirectorySuggestions();
  } else if (event.key === "Escape" && !elements.directorySuggestions.hidden) {
    event.preventDefault();
    hideDirectorySuggestions();
  }
});
elements.directoryOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-directory-path]");
  if (button) selectDirectoryPath(button.dataset.directoryPath);
});
elements.newSessionDialog.addEventListener("close", hideDirectorySuggestions);
// Safari can blur the input with relatedTarget=null when a suggestion is
// pressed. Removing the options in focusout would swallow its subsequent
// click. Dismiss only on an explicit interaction outside the picker.
elements.newSessionForm.addEventListener("focusin", (event) => {
  if (!event.target.closest(".directory-picker")) hideDirectorySuggestions();
});
document.addEventListener("pointerdown", (event) => {
  if (elements.newSessionDialog.open && !event.target.closest(".directory-picker")) hideDirectorySuggestions();
}, { capture: true });
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
});

function openSessionLabelDialog(slug) {
  const session = getSession(slug);
  if (!session) return;
  elements.sessionLabelForm.dataset.session = slug;
  elements.sessionLabelOriginal.textContent = `原名：${session.name}`;
  elements.sessionLabelInput.value = session.displayName || "";
  elements.sessionLabelDialog.showModal();
  elements.sessionLabelInput.focus();
  elements.sessionLabelInput.select();
}

elements.sessionLabelInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    if (!elements.sessionLabelSave.disabled) elements.sessionLabelForm.requestSubmit(elements.sessionLabelSave);
  }
});

elements.sessionLabelForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const slug = elements.sessionLabelForm.dataset.session;
  elements.sessionLabelSave.disabled = true;
  try {
    const data = await api(`/api/sessions/${slug}/display-name`, {
      method: "POST",
      body: JSON.stringify({ displayName: elements.sessionLabelInput.value.trim() }),
    });
    const session = getSession(slug);
    if (session) session.displayName = data.session.displayName;
    // Update labels without resubscribing, fitting or resetting terminals.
    renderSessionList();
    if (state.mode === "overview") renderOverview();
    for (const view of terminalViews.values()) {
      const current = getSession(view.slug);
      if (current) view.name.textContent = sessionLabel(current);
    }
    for (const option of elements.targetSession.options) {
      option.textContent = sessionLabel(getSession(option.value));
    }
    const visible = visibleSessions();
    if (visible.length === 1) elements.viewTitle.textContent = sessionLabel(visible[0]);
    elements.sessionLabelDialog.close();
    showToast(data.session.displayName ? "显示名称已保存" : "已恢复显示原名");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    elements.sessionLabelSave.disabled = false;
  }
});

function openNewWindowDialog(slug = state.targetSlug || state.activeSlug) {
  const session = getSession(slug);
  if (!session) return showToast("请先打开一个 session", "error");
  setInputTarget(slug);
  const form = elements.newWindowForm;
  form.elements.name.value = `codex-${session.windows + 1}`;
  form.elements.cwd.value = activeWindow(session)?.path || session.path;
  elements.newWindowContext.textContent = `将在 ${sessionLabel(session)} 中创建新的 tmux window。`;
  elements.newWindowDialog.showModal();
}

async function closeSession(slug) {
  const session = getSession(slug);
  if (!session || !confirm(`确定结束 tmux session “${sessionLabel(session)}”（原名：${session.name}）吗？其中运行的程序会一并终止。`)) return;
  try {
    await api(`/api/sessions/${slug}`, { method: "DELETE" });
    const view = terminalViews.get(slug);
    if (view) disposeTerminalView(view);
    showToast(`Session ${sessionLabel(session)} 已结束`);
    showOverview();
    await refreshSessions({ quiet: true });
  } catch (error) { showToast(error.message, "error"); }
}

function disposeTerminalView(view) {
  returnToLive(view, { focus: false });
  if (view.serverActive) streamSend({ type: "active", session: view.slug, active: false });
  view.resizeObserver?.disconnect();
  view.term.dispose();
  view.historyTerm.dispose();
  view.panel.remove();
  terminalViews.delete(view.slug);
}

function sendKey(key) {
  const codes = { escape: "\x1b", tab: "\t", enter: "\r", up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", "ctrl-c": "\x03", "ctrl-l": "\x0c" };
  const data = codes[key];
  if (!data || !state.targetSlug) return;
  if (!streamSend({ type: "input", session: state.targetSlug, data })) showToast("终端正在重连", "error");
}

function resetComposerSendButton() {
  elements.sendInputButton.disabled = false;
  elements.sendInputButton.textContent = "发送 ↵";
}

function sendComposerText(text, sessionSlug) {
  const inputId = crypto.randomUUID ? crypto.randomUUID() : `input_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  elements.sendInputButton.disabled = true;
  elements.sendInputButton.textContent = "发送中…";
  const sent = streamSend({ type: "input", session: sessionSlug, data: `${text}\r`, inputId });
  if (!sent) {
    resetComposerSendButton();
    state.queuedInput = { text, sessionSlug };
    showToast("终端正在连接，连接后会自动发送", "error");
    connectStream();
    updateComposerConnection();
    return;
  }
  const timer = setTimeout(() => {
    if (!state.pendingInputs.has(inputId)) return;
    state.pendingInputs.delete(inputId);
    inputFailures.set(sessionSlug, true);
    resetComposerSendButton();
    showToast("未收到终端确认，输入内容已保留，请重试", "error");
    updateComposerConnection();
  }, 5000);
  state.pendingInputs.set(inputId, { text, sessionSlug, timer });
  inputFailures.delete(sessionSlug);
  updateComposerConnection();
}

function flushQueuedComposerInput(sessionSlug) {
  const queued = state.queuedInput;
  if (!queued || queued.sessionSlug !== sessionSlug) return;
  const view = terminalViews.get(sessionSlug);
  if (!state.streamReady || !view?.inputReady) return;
  state.queuedInput = null;
  sendComposerText(queued.text, queued.sessionSlug);
}

function submitComposerInput() {
  const text = elements.terminalInput.value;
  if (!text.trim() || !state.targetSlug) return;
  const sessionSlug = state.targetSlug;
  const view = terminalViews.get(sessionSlug);
  if (view) returnToLive(view, { focus: false });
  if (!state.streamReady || !view?.inputReady) {
    state.queuedInput = { text, sessionSlug };
    elements.sendInputButton.disabled = true;
    elements.sendInputButton.textContent = "连接后发送…";
    connectStream();
    updateComposerConnection();
    return;
  }
  sendComposerText(text, sessionSlug);
}

elements.sessionList.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-label]");
  if (edit) return openSessionLabelDialog(edit.dataset.editLabel);
  const button = event.target.closest("[data-open-session]");
  if (button) openSession(button.dataset.openSession);
});
elements.sessionList.addEventListener("scroll", syncSessionScrollbar, { passive: true });
elements.sessionScrollbar.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  const thumbRect = elements.sessionScrollbarThumb.getBoundingClientRect();
  const onThumb = event.target === elements.sessionScrollbarThumb;
  const thumbOffset = onThumb
    ? event.clientY - thumbRect.top
    : Math.max(0, thumbRect.height / 2);
  sessionScrollDrag = { pointerId: event.pointerId, thumbOffset };
  elements.sessionScrollbar.setPointerCapture(event.pointerId);
  elements.sessionScrollbar.classList.add("dragging");
  moveSessionScrollbar(event.clientY, thumbOffset);
  event.preventDefault();
});
elements.sessionScrollbar.addEventListener("pointermove", (event) => {
  if (!sessionScrollDrag || event.pointerId !== sessionScrollDrag.pointerId) return;
  moveSessionScrollbar(event.clientY, sessionScrollDrag.thumbOffset);
  event.preventDefault();
});
elements.sessionScrollbar.addEventListener("pointerup", (event) => stopSessionScrollbarDrag(event.pointerId));
elements.sessionScrollbar.addEventListener("pointercancel", (event) => stopSessionScrollbarDrag(event.pointerId));
elements.sessionScrollbar.addEventListener("lostpointercapture", () => stopSessionScrollbarDrag());
elements.sessionScrollbar.addEventListener("keydown", (event) => {
  const amount = Math.max(44, Math.round(elements.sessionList.clientHeight * 0.85));
  const commands = {
    ArrowUp: () => elements.sessionList.scrollBy({ top: -44, behavior: "smooth" }),
    ArrowDown: () => elements.sessionList.scrollBy({ top: 44, behavior: "smooth" }),
    PageUp: () => elements.sessionList.scrollBy({ top: -amount, behavior: "smooth" }),
    PageDown: () => elements.sessionList.scrollBy({ top: amount, behavior: "smooth" }),
    Home: () => elements.sessionList.scrollTo({ top: 0, behavior: "smooth" }),
    End: () => elements.sessionList.scrollTo({ top: elements.sessionList.scrollHeight, behavior: "smooth" }),
  };
  if (!commands[event.key]) return;
  commands[event.key]();
  event.preventDefault();
});
elements.sessionGrid.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-label]");
  if (edit) return openSessionLabelDialog(edit.dataset.editLabel);
  const open = event.target.closest("[data-open-session]");
  if (open) openSession(open.dataset.openSession);
  const add = event.target.closest("[data-add-window]");
  if (add) openNewWindowDialog(add.dataset.addWindow);
  const close = event.target.closest("[data-close-session]");
  if (close) closeSession(close.dataset.closeSession);
});
elements.sessionGrid.addEventListener("change", (event) => {
  const input = event.target.closest("[data-multi-select]");
  if (!input) return;
  if (input.checked && state.multiSelection.size >= 4) {
    input.checked = false;
    return showToast("多窗最多同时打开 4 个 session", "error");
  }
  if (input.checked) state.multiSelection.add(input.dataset.multiSelect);
  else state.multiSelection.delete(input.dataset.multiSelect);
  renderOverview();
});
elements.windowStrip.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-window-index]");
  if (!button) return;
  try {
    await api(`/api/sessions/${button.dataset.sessionSlug}/select-window`, {
      method: "POST", body: JSON.stringify({ index: Number(button.dataset.windowIndex) }),
    });
    await refreshSessions({ quiet: true });
  } catch (error) { showToast(error.message, "error"); }
});
elements.newSessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return elements.newSessionDialog.close();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  elements.createSessionSubmit.disabled = true;
  try {
    const data = await api("/api/sessions", { method: "POST", body: JSON.stringify(payload) });
    elements.newSessionDialog.close();
    await refreshSessions({ quiet: true });
    openSession(data.session.slug);
    showToast(`Session ${sessionLabel(data.session)} 已创建`);
  } catch (error) { showToast(error.message, "error"); }
  finally { elements.createSessionSubmit.disabled = false; }
});
elements.newWindowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return elements.newWindowDialog.close();
  const session = getSession(state.targetSlug);
  if (!session) return;
  elements.createWindowSubmit.disabled = true;
  try {
    await api(`/api/sessions/${session.slug}/windows`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    elements.newWindowDialog.close();
    await refreshSessions({ quiet: true });
    openSession(session.slug);
    showToast(`已在 ${sessionLabel(session)} 中创建 Window`);
  } catch (error) { showToast(error.message, "error"); }
  finally { elements.createWindowSubmit.disabled = false; }
});
elements.sendInputButton.addEventListener("click", submitComposerInput);
elements.terminalInput.addEventListener("keydown", (event) => {
  // 229 is used by iOS/Android IMEs for punctuation and composition events.
  // It must never suppress the textarea's native input handling. Only avoid
  // submitting Enter while an IME is actively composing.
  if ((event.isComposing || event.keyCode === 229) && event.key === "Enter") return;
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === "ArrowUp") {
    if (navigateInputHistory(-1)) event.preventDefault();
    return;
  }
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === "ArrowDown") {
    if (navigateInputHistory(1)) event.preventDefault();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey && !event.repeat) {
    event.preventDefault();
    event.stopPropagation();
    if (!elements.sendInputButton.disabled) submitComposerInput();
  }
});
elements.terminalInput.addEventListener("input", () => {
  resetInputHistoryNavigation();
  scheduleInputDraftSave();
});
elements.quickKeys.addEventListener("click", (event) => { const button = event.target.closest("[data-key]"); if (button) sendKey(button.dataset.key); });
elements.mobileDpad.addEventListener("pointerdown", () => {
  state.mobileDpadInputMode = document.activeElement === elements.terminalInput;
}, { capture: true });
elements.mobileDpad.addEventListener("click", (event) => {
  const button = event.target.closest("[data-key]");
  if (!button) return;
  const direction = button.dataset.key === "up" ? -1 : button.dataset.key === "down" ? 1 : 0;
  if (state.mobileDpadInputMode && direction) {
    navigateInputHistory(direction);
    elements.terminalInput.focus({ preventScroll: true });
    state.mobileDpadInputMode = false;
    return;
  }
  state.mobileDpadInputMode = false;
  sendKey(button.dataset.key);
});
elements.targetSession.addEventListener("change", () => {
  setInputTarget(elements.targetSession.value);
});
elements.composerToggle.addEventListener("click", () => setComposer(true));
elements.composerClose.addEventListener("click", () => setComposer(false));
elements.mobileDirectionToggle.addEventListener("click", () => {
  const deck = elements.mobileDirectionToggle.closest(".mobile-control-deck");
  const open = !deck.classList.contains("controls-open");
  deck.classList.toggle("controls-open", open);
  elements.mobileDirectionToggle.setAttribute("aria-expanded", String(open));
});
elements.newSessionButton.addEventListener("click", openNewSessionDialog);
elements.newWindowButton.addEventListener("click", () => openNewWindowDialog());
elements.overviewButton.addEventListener("click", showOverview);
document.querySelectorAll('[data-action="overview"]').forEach((item) => item.addEventListener("click", (event) => { event.preventDefault(); showOverview(); }));
document.querySelectorAll('[data-action="new-session"]').forEach((item) => item.addEventListener("click", openNewSessionDialog));
elements.multiViewButton.addEventListener("click", () => openMulti(state.multiSelection.size ? [...state.multiSelection] : state.sessions.slice(0, 2).map((s) => s.slug)));
elements.openSelectedMulti.addEventListener("click", () => openMulti([...state.multiSelection]));
elements.openTerminalTab.addEventListener("click", () => { if (state.activeSlug) window.open(`/?session=${encodeURIComponent(state.activeSlug)}`, "_blank", "noopener"); });
elements.refreshButton.addEventListener("click", () => refreshSessions());
elements.sessionSearch.addEventListener("input", () => { state.search = elements.sessionSearch.value; renderSessionList(); });
elements.openSidebar.addEventListener("click", openSidebar);
elements.closeSidebar.addEventListener("click", closeSidebar);
elements.scrim.addEventListener("click", closeSidebar);
elements.reclaimClient.addEventListener("click", async () => {
  elements.reclaimClient.disabled = true;
  try {
    if (await claimBrowser({ force: true })) { await refreshSessions(); const requested = new URLSearchParams(location.search).get("session"); if (requested) openSession(requested); }
  } catch (error) { showToast(error.message, "error"); }
  finally { elements.reclaimClient.disabled = false; }
});

function markActivity() {
  state.lastActivityAt = Date.now();
  if (state.idleSuspended) {
    state.idleSuspended = false;
    for (const view of terminalViews.values()) {
      if (view.visible) {
        view.flowState = "正在恢复";
        updateTerminalStatus(view);
      }
    }
    syncVisibleTerminals();
  }
}

function returnVisibleHistoryToLive() {
  for (const view of terminalViews.values()) {
    if (view.visible) returnToLive(view, { focus: false });
  }
}

function isInsideSessionScreen(target) {
  return target instanceof Element && Boolean(target.closest(
    ".xterm-host, .xterm-history-layer, .terminal-history-status, .terminal-search, .terminal-copy, #openCopyText, #copyTextDialog",
  ));
}

// History is a temporary reading mode. Moving focus to any page control means
// the user has left the session screen, so the visible terminal resumes live.
document.addEventListener("pointerdown", (event) => {
  if (!isInsideSessionScreen(event.target)) returnVisibleHistoryToLive();
}, { capture: true });
document.addEventListener("focusin", (event) => {
  if (!isInsideSessionScreen(event.target)) returnVisibleHistoryToLive();
});
elements.terminalInput.addEventListener("focus", () => {
  returnVisibleHistoryToLive();
  syncVisualViewport();
});

for (const name of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(name, markActivity, { passive: true });
}
document.addEventListener("visibilitychange", () => {
  state.lastActivityAt = Date.now();
  if (document.hidden) flushInputDraft();
  if (document.hidden) for (const view of terminalViews.values()) if (view.visible) returnToLive(view, { focus: false });
  heartbeat();
});
window.addEventListener("blur", () => {
  setTimeout(() => { if (!document.hasFocus()) for (const view of terminalViews.values()) if (view.visible) returnToLive(view, { focus: false }); }, 150);
});
window.addEventListener("resize", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("scroll", syncVisualViewport, { passive: true });
const composerResizeObserver = new ResizeObserver(syncComposerLayout);
composerResizeObserver.observe(elements.composer);
const sessionListResizeObserver = new ResizeObserver(syncSessionScrollbar);
sessionListResizeObserver.observe(elements.sessionList);
window.addEventListener("beforeunload", () => {
  flushInputDraft();
  closeStream(false);
});

setInterval(heartbeat, 3000);
setInterval(() => { if (state.streamReady) streamSend({ type: "ping", clientAt: Date.now() }); }, 5000);
setInterval(() => {
  for (const view of terminalViews.values()) if (view.visible && view.historyActive) updateTerminalStatus(view);
}, 1000);
setInterval(() => refreshSessions({ quiet: true }), 15000);
setInterval(() => {
  const cutoff = Date.now() - terminalPanelKeepAliveMs;
  for (const view of terminalViews.values()) if (!view.visible && view.lastVisibleAt < cutoff) disposeTerminalView(view);
}, 60000);
setInterval(() => {
  if (!state.clientActive || state.idleSuspended || Date.now() - state.lastActivityAt < terminalPanelKeepAliveMs) return;
  state.idleSuspended = true;
  for (const view of terminalViews.values()) {
    if (!view.visible) continue;
    if (view.serverActive) streamSend({ type: "active", session: view.slug, active: false });
    view.serverActive = false;
    view.flowState = "闲置暂停 · 操作即恢复";
    updateTerminalStatus(view);
  }
}, 30000);

async function start() {
  syncVisualViewport();
  state.clientId = getOrCreateClientId();
  try {
    if (!(await claimBrowser())) return;
    await refreshSessions();
    const requested = new URLSearchParams(location.search).get("session");
    if (requested && getSession(requested)) openSession(requested);
    else showOverview();
  } catch (error) {
    showToast(error.message, "error");
    showTakeover({ occupied: false, phase: "stale" });
  }
}

start();
