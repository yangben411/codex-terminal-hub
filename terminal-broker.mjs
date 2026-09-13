import headlessPackage from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import * as pty from "node-pty";
import { decodeClipboardOsc } from "./terminal-clipboard.mjs";

const { Terminal: HeadlessTerminal } = headlessPackage;

function clampDimension(value, fallback, maximum) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(2, Math.min(maximum, number)) : fallback;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TerminalBroker {
  constructor({
    session,
    tmuxPath,
    tmuxArgs = [],
    exactTarget,
    captureHistory,
    exclusive = true,
    cols = 100,
    rows = 30,
    scrollbackPages = 10,
    idleTimeoutMs = 15 * 60 * 1000,
    replayBytes = 2 * 1024 * 1024,
    onOutput,
    onClipboard,
    onIdle,
    logger = () => {},
  }) {
    this.session = session;
    this.tmuxPath = tmuxPath;
    this.tmuxArgs = tmuxArgs;
    this.exactTarget = exactTarget;
    this.captureHistory = captureHistory;
    this.exclusive = exclusive;
    this.cols = clampDimension(cols, 100, 500);
    this.rows = clampDimension(rows, 30, 200);
    this.scrollbackPages = Math.max(3, Math.min(30, scrollbackPages));
    this.idleTimeoutMs = idleTimeoutMs;
    this.replayBytes = replayBytes;
    this.onOutput = onOutput;
    this.onClipboard = onClipboard;
    this.onIdle = onIdle;
    this.logger = logger;
    this.pty = null;
    this.terminal = null;
    this.serializer = null;
    this.terminalResponseDisposable = null;
    this.clipboardDisposable = null;
    this.listeners = new Set();
    this.exitListeners = new Set();
    this.replay = [];
    this.replaySize = 0;
    this.seq = 0;
    this.parsedSeq = 0;
    this.parseWaiters = [];
    this.idleTimer = null;
    this.startedAt = 0;
    this.lastOutputAt = 0;
    this.terminalResponses = 0;
    this.closed = false;
    this.startPromise = null;
  }

  async start() {
    if (this.pty && !this.closed) return this;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async #start() {
    this.closed = false;
    this.terminal = new HeadlessTerminal({
      allowProposedApi: true,
      cols: this.cols,
      rows: this.rows,
      scrollback: Math.max(500, this.rows * this.scrollbackPages),
      convertEol: false,
    });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
    this.clipboardDisposable = this.terminal.parser.registerOscHandler(52, (data) => {
      const text = decodeClipboardOsc(data);
      if (text !== null && this.pty && !this.closed) this.onClipboard?.(text);
      return true;
    });
    this.terminalResponseDisposable = this.terminal.onData((data) => {
      if (this.pty && !this.closed) {
        this.terminalResponses += 1;
        this.pty.write(data);
      }
    });

    try {
      const history = await this.captureHistory?.();
      if (history?.content) {
        const normalized = history.content.replace(/\r?\n/g, "\r\n");
        await this.#writeHeadless(normalized, 0);
      }
    } catch (error) {
      this.logger("initial history unavailable", `${this.session} ${error.message || error}`);
    }

    const args = [
      ...this.tmuxArgs,
      "attach-session",
      ...(this.exclusive ? ["-d"] : []),
      "-t",
      this.exactTarget(this.session),
    ];
    this.pty = pty.spawn(this.tmuxPath, args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: process.cwd(),
      env: {
        ...process.env,
        LANG: process.env.LANG || "en_US.UTF-8",
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
    this.startedAt = Date.now();
    this.pty.onData((data) => this.#handleData(data));
    this.pty.onExit(({ exitCode, signal }) => {
      this.closed = true;
      this.pty = null;
      this.#clearIdleTimer();
      const details = { exitCode, signal, session: this.session };
      for (const listener of this.exitListeners) listener(details);
      this.logger("pty stopped", `${this.session} code=${exitCode} signal=${signal}`);
    });
    await this.#waitForStartupSettle();
    this.logger("pty ready", `${this.session} ${this.cols}x${this.rows}`);
    return this;
  }

  async #waitForStartupSettle() {
    const deadline = Date.now() + 500;
    do {
      await wait(60);
      await this.waitUntilParsed(this.seq);
      if (Date.now() - (this.lastOutputAt || this.startedAt) >= 90) return;
    } while (!this.closed && Date.now() < deadline);
  }

  #handleData(data) {
    if (this.closed) return;
    const seq = ++this.seq;
    const bytes = byteLength(data);
    this.lastOutputAt = Date.now();
    const item = { seq, data, bytes };
    this.onOutput?.(item);
    this.replay.push(item);
    this.replaySize += bytes;
    while (this.replaySize > this.replayBytes && this.replay.length > 1) {
      this.replaySize -= this.replay.shift().bytes;
    }
    this.#writeHeadless(data, seq);
    for (const listener of this.listeners) listener(item);
  }

  #writeHeadless(data, seq) {
    return new Promise((resolve) => {
      this.terminal.write(data, () => {
        this.parsedSeq = Math.max(this.parsedSeq, seq);
        this.#resolveParseWaiters();
        resolve();
      });
    });
  }

  #resolveParseWaiters() {
    const pending = this.parseWaiters;
    this.parseWaiters = [];
    for (const waiter of pending) {
      if (this.parsedSeq >= waiter.seq) waiter.resolve();
      else this.parseWaiters.push(waiter);
    }
  }

  waitUntilParsed(seq = this.seq) {
    if (this.parsedSeq >= seq) return Promise.resolve();
    return new Promise((resolve) => this.parseWaiters.push({ seq, resolve }));
  }

  async snapshot() {
    const seq = this.seq;
    await this.waitUntilParsed(seq);
    return {
      seq,
      cols: this.cols,
      rows: this.rows,
      data: this.serializer.serialize({
        scrollback: Math.max(0, this.rows * (this.scrollbackPages - 1)),
      }),
    };
  }

  outputSince(seq) {
    if (seq >= this.seq) return [];
    if (!this.replay.length || seq < this.replay[0].seq - 1) return null;
    return this.replay.filter((item) => item.seq > seq);
  }

  write(data) {
    if (!this.pty || this.closed) throw new Error("Terminal is not connected");
    this.pty.write(data);
  }

  resize(cols, rows) {
    const nextCols = clampDimension(cols, this.cols, 500);
    const nextRows = clampDimension(rows, this.rows, 200);
    if (nextCols === this.cols && nextRows === this.rows) return;
    this.cols = nextCols;
    this.rows = nextRows;
    this.terminal.options.scrollback = Math.max(500, nextRows * this.scrollbackPages);
    this.terminal.resize(nextCols, nextRows);
    if (this.pty && !this.closed) this.pty.resize(nextCols, nextRows);
  }

  addListener(listener) {
    this.listeners.add(listener);
    this.#clearIdleTimer();
  }

  removeListener(listener) {
    this.listeners.delete(listener);
    if (!this.listeners.size) this.#scheduleIdle();
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  #scheduleIdle() {
    this.#clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.listeners.size || this.closed) return;
      this.onIdle?.(this);
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  #clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  close() {
    this.closed = true;
    this.#clearIdleTimer();
    this.listeners.clear();
    this.exitListeners.clear();
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {}
      this.pty = null;
    }
    this.terminalResponseDisposable?.dispose();
    this.terminalResponseDisposable = null;
    this.clipboardDisposable?.dispose();
    this.clipboardDisposable = null;
    this.terminal?.dispose();
    this.terminal = null;
    this.serializer = null;
    for (const waiter of this.parseWaiters) waiter.resolve();
    this.parseWaiters = [];
  }

  stats() {
    return {
      session: this.session,
      connected: Boolean(this.pty && !this.closed),
      subscribers: this.listeners.size,
      cols: this.cols,
      rows: this.rows,
      seq: this.seq,
      parsedSeq: this.parsedSeq,
      replayBytes: this.replaySize,
      startedAt: this.startedAt || null,
      lastOutputAt: this.lastOutputAt || null,
      terminalResponses: this.terminalResponses,
    };
  }
}

export class RenderFlow {
  constructor({ highWaterBytes = 256 * 1024, lowWaterBytes = 64 * 1024 } = {}) {
    this.highWaterBytes = highWaterBytes;
    this.lowWaterBytes = lowWaterBytes;
    this.outstanding = new Map();
    this.outstandingBytes = 0;
    this.ackedSeq = 0;
    this.paused = false;
  }

  canSend(bytes) {
    if (this.paused || this.outstandingBytes + bytes > this.highWaterBytes) {
      this.paused = true;
      return false;
    }
    return true;
  }

  sent(seq, bytes) {
    if (!this.outstanding.has(seq)) {
      this.outstanding.set(seq, bytes);
      this.outstandingBytes += bytes;
    }
  }

  acknowledge(seq) {
    this.ackedSeq = Math.max(this.ackedSeq, Number(seq) || 0);
    for (const [itemSeq, bytes] of this.outstanding) {
      if (itemSeq <= this.ackedSeq) {
        this.outstanding.delete(itemSeq);
        this.outstandingBytes -= bytes;
      }
    }
    const shouldResume = this.paused && this.outstandingBytes <= this.lowWaterBytes;
    if (shouldResume) this.paused = false;
    return shouldResume;
  }

  reset(seq = this.ackedSeq) {
    this.outstanding.clear();
    this.outstandingBytes = 0;
    this.ackedSeq = Number(seq) || 0;
    this.paused = false;
  }
}
