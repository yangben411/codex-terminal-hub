import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const exec = promisify(execFile);
const clean = value => typeof value === "string" && !/[\u0000-\u001f\u007f]/u.test(value);

export class TmuxWorkspace {
  constructor({ tmuxPath, tmuxArgs = [], file, fallbackCwd = os.homedir(),
    shell = os.userInfo().shell || "/bin/sh", intervalMs = 60000, log = () => {} }) {
    Object.assign(this, { tmuxPath, tmuxArgs, file, fallbackCwd, shell, intervalMs, log });
    this.ready = false;
    this.pending = Promise.resolve();
    this.lastSavedAt = null;
    this.lastError = null;
    this.restoredSessions = 0;
  }

  async run(args, { allowEmpty = false } = {}) {
    try {
      return (await exec(this.tmuxPath, [...this.tmuxArgs, ...args], {
        timeout: 10000, maxBuffer: 8 * 1024 * 1024,
      })).stdout.trimEnd();
    } catch (error) {
      if (allowEmpty && /no server running|no sessions|error connecting.*No such file/i.test(error.stderr || "")) return "";
      throw error;
    }
  }

  async capture() {
    const separator = `__${randomUUID()}__`;
    const fields = ["session_name", "window_index", "window_name", "window_layout",
      "window_active", "pane_index", "pane_current_path", "pane_active",
      "@codex_web_display_name", "window_width", "window_height"];
    const output = await this.run(["list-panes", "-a", "-F",
      fields.map(key => `#{${key}}`).join(separator)], { allowEmpty: true });
    const sessions = new Map();
    for (const row of output ? output.split("\n") : []) {
      const values = row.split(separator);
      if (values.length !== fields.length) throw new Error("Cannot safely parse tmux workspace metadata");
      const [name, index, windowName, layout, active, paneIndex, cwd, paneActive, displayName, width, height] = values;
      if (!sessions.has(name)) sessions.set(name, { name, displayName, windows: [] });
      const session = sessions.get(name);
      let window = session.windows.find(item => item.index === Number(index));
      if (!window) {
        window = { index: Number(index), name: windowName, layout, active: active === "1",
          width: Number(width), height: Number(height), panes: [] };
        session.windows.push(window);
      }
      window.panes.push({ index: Number(paneIndex), cwd, active: paneActive === "1" });
    }
    const snapshot = { version: 1, savedAt: new Date().toISOString(), sessions: [...sessions.values()] };
    this.validate(snapshot);
    return snapshot;
  }

  validate(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.sessions) || snapshot.sessions.length > 500) throw new Error("Invalid tmux workspace snapshot");
    const names = new Set();
    for (const session of snapshot.sessions) {
      if (!clean(session.name) || !session.name || /[.:]/.test(session.name) || names.has(session.name)
        || !clean(session.displayName) || !Array.isArray(session.windows) || !session.windows.length
        || session.windows.length > 200) throw new Error("Invalid saved session");
      names.add(session.name);
      const indices = new Set();
      for (const window of session.windows) {
        if (!Number.isInteger(window.index) || window.index < 0 || indices.has(window.index)
          || !clean(window.name) || !clean(window.layout) || !Array.isArray(window.panes)
          || !window.panes.length || window.panes.length > 100
          || !Number.isInteger(window.width) || window.width < 1 || window.width > 10000
          || !Number.isInteger(window.height) || window.height < 1 || window.height > 10000) throw new Error("Invalid saved window");
        indices.add(window.index);
        for (const pane of window.panes) {
          if (!Number.isInteger(pane.index) || pane.index < 0 || !clean(pane.cwd) || !path.isAbsolute(pane.cwd)) throw new Error("Invalid saved pane directory");
        }
      }
    }
  }

  async directory(cwd) {
    try { if ((await stat(cwd)).isDirectory()) return cwd; } catch {}
    this.log("workspace directory missing", cwd);
    try { if ((await stat(this.fallbackCwd)).isDirectory()) return this.fallbackCwd; } catch {}
    return os.homedir();
  }

  async restore(snapshot) {
    this.validate(snapshot);
    for (const session of snapshot.sessions) {
      // Never replace or add panes to a running session, including races with
      // another local terminal creating it during startup.
      const current = await this.capture();
      if (current.sessions.some(item => item.name === session.name)) continue;
      const windows = [...session.windows].sort((a, b) => a.index - b.index);
      const target = `=${session.name}`;
      for (let i = 0; i < windows.length; i++) {
        const window = windows[i];
        const panes = [...window.panes].sort((a, b) => a.index - b.index);
        const cwd = await this.directory(panes[0].cwd);
        let paneId;
        if (i === 0) {
          paneId = await this.run(["new-session", "-d", "-P", "-F", "#{pane_id}",
            "-s", session.name, "-n", window.name, "-c", cwd,
            "-x", String(Math.max(160, window.width)), "-y", String(Math.max(48, window.height)), this.shell]);
          await this.run(["set-option", "-t", `${target}:`, "renumber-windows", "off"]);
          const index = Number(await this.run(["display-message", "-p", "-t", paneId, "#{window_index}"]));
          if (index !== window.index) await this.run(["move-window", "-s", `${target}:${index}`, "-t", `${target}:${window.index}`]);
          if (session.displayName) await this.run(["set-option", "-t", `${target}:`, "@codex_web_display_name", session.displayName]);
        } else {
          paneId = await this.run(["new-window", "-d", "-P", "-F", "#{pane_id}",
            "-t", `${target}:${window.index}`, "-n", window.name, "-c", cwd, this.shell]);
        }
        const windowTarget = `${target}:${window.index}`;
        await this.run(["set-window-option", "-t", windowTarget, "automatic-rename", "off"]);
        let activePane = paneId;
        for (const pane of panes.slice(1)) {
          const created = await this.run(["split-window", "-d", "-P", "-F", "#{pane_id}",
            "-t", windowTarget, "-c", await this.directory(pane.cwd), this.shell]);
          if (pane.active) activePane = created;
          await this.run(["select-layout", "-t", windowTarget, "tiled"]);
        }
        if (panes.length > 1 && window.layout) {
          await this.run(["select-layout", "-t", windowTarget, window.layout]);
        }
        await this.run(["select-pane", "-t", activePane]);
      }
      const active = windows.find(window => window.active) || windows[0];
      await this.run(["select-window", "-t", `${target}:${active.index}`]);
      this.restoredSessions++;
    }
  }

  async persist(snapshot) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    this.lastSavedAt = snapshot.savedAt;
  }

  save() {
    const operation = this.pending.then(async () => {
      if (!this.ready) return;
      await this.persist(await this.capture());
      this.lastError = null;
    });
    this.pending = operation.catch(error => {
      this.lastError = error.message;
      this.log("workspace save failed", error.message);
    });
    return this.pending;
  }

  async start() {
    try {
      try {
        await stat(`${this.file}.restore-pending`);
        throw new Error("Previous workspace restore was interrupted; original snapshot preserved. Inspect restored sessions before removing .restore-pending");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      let snapshot;
      try { snapshot = JSON.parse(await readFile(this.file, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (snapshot) this.validate(snapshot);
      const current = await this.capture();
      // Restore only onto an empty tmux server. A Hub restart must not bring
      // deliberately closed windows back into otherwise running workspaces.
      if (!current.sessions.length && snapshot?.sessions.length) {
        await writeFile(`${this.file}.restore-pending`, snapshot.savedAt || "pending", { flag: "wx", mode: 0o600 });
        await this.restore(snapshot);
        await unlink(`${this.file}.restore-pending`);
      }
      this.ready = true;
      await this.save();
      this.timer = setInterval(() => this.save(), this.intervalMs);
      this.timer.unref();
      this.log("workspace persistence ready", `restored=${this.restoredSessions} interval=${this.intervalMs}ms`);
    } catch (error) {
      // Keep the original file intact when loading or restoring fails.
      this.lastError = error.message;
      this.log("workspace restore failed; snapshot preserved", error.message);
    }
    return this.status();
  }

  stop() { clearInterval(this.timer); return this.pending; }
  status() {
    return { enabled: true, ready: this.ready, intervalMs: this.intervalMs,
      lastSavedAt: this.lastSavedAt, restoredSessions: this.restoredSessions, error: this.lastError };
  }
}
