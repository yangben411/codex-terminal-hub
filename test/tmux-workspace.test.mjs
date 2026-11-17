import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, stat, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TmuxWorkspace } from "../tmux-workspace.mjs";
import { tmuxPath } from "../runtime-paths.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "hub-workspace-test-")));
  const socket = `workspace_test_${process.pid}_${Date.now()}`;
  const options = { tmuxPath, tmuxArgs: ["-L", socket, "-f", "/dev/null"],
    file: path.join(root, "state", "workspace.json"), fallbackCwd: root,
    shell: "/bin/sh", intervalMs: 1000 };
  const store = new TmuxWorkspace(options);
  t.after(async () => {
    await store.stop();
    await store.run(["kill-server"]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return { root, store, options };
}

test("workspace restores windows, directories, labels and panes as shells after tmux loss", { timeout: 15000 }, async t => {
  const { root, store, options } = await fixture(t);
  const cwd = path.join(root, "中文 项目");
  await mkdir(cwd);
  await store.run(["new-session", "-d", "-s", "project", "-n", "first", "-c", root, "-x", "160", "-y", "48", "/bin/sh"]);
  await store.run(["move-window", "-s", "=project:0", "-t", "=project:2"]);
  await store.run(["set-option", "-t", "=project:", "@codex_web_display_name", "项目标签"]);
  await store.run(["new-window", "-d", "-t", "=project:7", "-n", "second", "-c", cwd, "sleep 120"]);
  await store.run(["split-window", "-d", "-h", "-t", "=project:7", "-c", root, "/bin/sh"]);
  await store.run(["select-window", "-t", "=project:7"]);
  assert.equal((await store.start()).ready, true);
  const saved = JSON.parse(await readFile(options.file, "utf8"));
  assert.equal(saved.sessions[0].windows.length, 2);
  assert.equal((await stat(options.file)).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(saved).includes("sleep 120"), "saved metadata must not contain commands to replay");
  await store.stop();
  await store.run(["kill-server"]);
  // Wait for the isolated server socket to finish shutting down.
  await new Promise(resolve => setTimeout(resolve, 100));
  const restored = new TmuxWorkspace(options);
  t.after(() => restored.stop());
  assert.equal((await restored.start()).error, null);
  assert.equal(restored.restoredSessions, 1);
  const snapshot = await restored.capture();
  const session = snapshot.sessions[0];
  assert.equal(session.displayName, "项目标签");
  assert.deepEqual(session.windows.map(w => [w.index, w.name, w.active]), [[2, "first", false], [7, "second", true]]);
  assert.deepEqual(session.windows[1].panes.map(p => p.cwd), [cwd, root]);
  const commands = (await restored.run(["list-panes", "-a", "-F", "#{pane_current_command}"])).split("\n");
  assert.equal(commands.length, 3);
  assert.ok(commands.every(command => /^(sh|bash)$/.test(command)), "all restored panes run shells, never the saved application");
  const count = snapshot.sessions[0].windows.length;
  await restored.restore(saved);
  assert.equal((await restored.capture()).sessions[0].windows.length, count, "repeat restore must not duplicate live windows");
});

test("periodic saves track closed windows and an intentionally empty workspace", { timeout: 10000 }, async t => {
  const { store, options } = await fixture(t);
  await store.run(["new-session", "-d", "-s", "keep", "/bin/sh"]);
  await store.run(["new-window", "-d", "-t", "=keep:", "-n", "close-me", "/bin/sh"]);
  await store.start();
  await store.run(["kill-window", "-t", "=keep:1"]);
  const deadline = Date.now() + 4000;
  while (JSON.parse(await readFile(options.file, "utf8")).sessions[0].windows.length !== 1) {
    assert.ok(Date.now() < deadline, "periodic save should record the closed window");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await store.run(["kill-session", "-t", "=keep"]);
  await store.save();
  assert.deepEqual(JSON.parse(await readFile(options.file, "utf8")).sessions, []);
  await store.stop();
  const next = new TmuxWorkspace(options);
  t.after(() => next.stop());
  await next.start();
  assert.deepEqual((await next.capture()).sessions, []);
});

test("service restart leaves live sessions intact; damaged snapshots and tmux errors cannot overwrite saved state", async t => {
  const { store, options } = await fixture(t);
  await store.run(["new-session", "-d", "-s", "live", "/bin/sh"]);
  await store.start();
  await store.stop();
  const pid = await store.run(["display-message", "-p", "-t", "=live:", "#{pane_pid}"]);
  const next = new TmuxWorkspace(options);
  t.after(() => next.stop());
  await next.start();
  assert.equal(await next.run(["display-message", "-p", "-t", "=live:", "#{pane_pid}"]), pid);
  await next.stop();
  const saved = await readFile(options.file, "utf8");
  next.tmuxPath = "/does/not/exist/tmux";
  await next.save();
  assert.ok(next.lastError);
  assert.equal(await readFile(options.file, "utf8"), saved);
  await writeFile(options.file, "invalid json");
  const broken = new TmuxWorkspace(options);
  assert.equal((await broken.start()).ready, false);
  await broken.save();
  assert.equal(await readFile(options.file, "utf8"), "invalid json");
});

test("missing directories fall back and an interrupted restore preserves its original snapshot across restarts", async t => {
  const { store, options, root } = await fixture(t);
  assert.equal(await store.directory(path.join(root, "missing")), root);
  await store.run(["new-session", "-d", "-s", "saved", "/bin/sh"]);
  await store.start();
  await store.stop();
  const original = await readFile(options.file, "utf8");
  await store.run(["kill-server"]);
  await new Promise(resolve => setTimeout(resolve, 100));
  const failed = new TmuxWorkspace(options);
  failed.restore = async () => { throw new Error("simulated restore failure"); };
  assert.equal((await failed.start()).ready, false);
  const next = new TmuxWorkspace(options);
  assert.match((await next.start()).error, /interrupted/);
  await next.save();
  assert.equal(await readFile(options.file, "utf8"), original);
});
