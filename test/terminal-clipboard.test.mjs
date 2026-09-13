import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decodeClipboardOsc } from "../terminal-clipboard.mjs";
import { TerminalBroker } from "../terminal-broker.mjs";
import { tmuxPath as tmux } from "../runtime-paths.mjs";

const exec = promisify(execFile);

test("clipboard decoding preserves Unicode and rejects queries, malformed and oversized writes", () => {
  const text = "圈选内容\n  with indentation";
  assert.equal(decodeClipboardOsc(`c;${Buffer.from(text).toString("base64")}`), text);
  for (const data of ["c;?", "c;", "c;%%%", "c;A", "x;YWJj", `c;${"A".repeat(1500000)}`]) {
    assert.equal(decodeClipboardOsc(data), null);
  }
});

test("tmux copy-pipe-and-cancel emits one browser clipboard event and snapshots do not replay it", { timeout: 10000 }, async (t) => {
  try { await exec(tmux, ["-V"]); }
  catch { t.skip("tmux is not installed"); return; }
  const socket = `clipboard_test_${process.pid}_${Date.now()}`;
  const args = ["-L", socket, "-f", "/dev/null"];
  const run = async (...command) => (await exec(tmux, [...args, ...command])).stdout;
  let broker;
  t.after(async () => {
    broker?.close();
    await run("kill-server").catch(() => {});
  });
  // Isolated tmux instance and a no-op pipe, so the test never writes to the
  // user's server-side clipboard or changes their session bindings/buffers.
  await run("new-session", "-d", "-s", "copytest", "-x", "80", "-y", "24", "printf 'CLIPBOARD_TEST_中文\\n'; exec /bin/cat");
  await run("set-option", "-s", "set-clipboard", "external");
  await run("set-window-option", "-t", "=copytest:", "mode-keys", "emacs");
  const readyDeadline = Date.now() + 2500;
  while (!(await run("capture-pane", "-p", "-t", "=copytest:")).includes("CLIPBOARD_TEST_中文")) {
    assert.ok(Date.now() < readyDeadline, "fixture output must exist before starting selection");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const received = [];
  broker = new TerminalBroker({
    session: "copytest", tmuxPath: tmux, tmuxArgs: args,
    exactTarget: name => `=${name}`, cols: 80, rows: 24,
    onClipboard: text => received.push(text),
  });
  await broker.start();
  await run("copy-mode", "-t", "=copytest:");
  for (const command of ["history-top", "start-of-line", "select-line"]) {
    await run("send-keys", "-t", "=copytest:", "-X", command);
  }
  await run("send-keys", "-t", "=copytest:", "-X", "copy-pipe-and-cancel", "/usr/bin/true");
  const deadline = Date.now() + 2500;
  while (!received.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(received.length, 1, JSON.stringify({
    clients: await run("list-clients", "-F", "#{client_termname} #{client_termfeatures}"),
    buffer: await run("save-buffer", "-"),
    clipboardCapability: (await run("info")).split("\n").filter(line => /Ms:/.test(line)),
  }));
  assert.match(received[0], /^CLIPBOARD_TEST_中文\n?$/);
  assert.equal(received[0], await run("save-buffer", "-"), "browser receives exactly the raw tmux selection; show-buffer adds formatting");
  const snapshot = await broker.snapshot();
  assert.equal(received.length, 1);
  assert.ok(!snapshot.data.includes("\x1b]52;"));
  await run("has-session", "-t", "=copytest");
});
