import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { RenderFlow, TerminalBroker } from "../terminal-broker.mjs";
import { tmuxPath } from "../runtime-paths.mjs";

const execFileAsync = promisify(execFile);

test("RenderFlow pauses at the high-water mark and resumes after render ACK", () => {
  const flow = new RenderFlow({ highWaterBytes: 100, lowWaterBytes: 20 });
  assert.equal(flow.canSend(80), true);
  flow.sent(1, 80);
  assert.equal(flow.canSend(30), false);
  assert.equal(flow.paused, true);
  assert.equal(flow.acknowledge(1), true);
  assert.equal(flow.paused, false);
  assert.equal(flow.outstandingBytes, 0);
});

test("TerminalBroker attaches tmux, serializes history, and leaves the session alive", { timeout: 10000 }, async (context) => {
  try {
    await execFileAsync(tmuxPath, ["-V"]);
  } catch {
    context.skip("tmux is not installed");
    return;
  }
  const session = `broker_test_${process.pid}_${Date.now()}`;
  const tmuxArgs = ["-L", session, "-f", "/dev/null"];
  const run = (args) => execFileAsync(tmuxPath, [...tmuxArgs, ...args]);
  context.after(() => run(["kill-server"]).catch(() => {}));
  await run(["new-session", "-d", "-s", session, "/bin/bash --noprofile --norc"]);
  const broker = new TerminalBroker({
    session,
    tmuxPath,
    tmuxArgs,
    exactTarget: (name) => `=${name}`,
    captureHistory: async () => ({ content: "cached-line" }),
    exclusive: false,
    cols: 90,
    rows: 24,
    idleTimeoutMs: 60000,
  });
  try {
    await broker.start();
    let output = "";
    const marker = `BROKER_OK_${Date.now()}`;
    const cachePrefix = `CACHE_${Date.now()}`;
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`marker not received; output=${JSON.stringify(output)}`)), 5000);
      broker.addListener((item) => {
        output += item.data;
        if (output.includes(`${cachePrefix}_040`) && output.includes(marker)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    broker.write(`for i in {1..40}; do printf '${cachePrefix}_%03d\\n' $i; done; printf '%s%s\\n' 'BROKER_' '${marker.slice(7)}'\r`);
    await received;
    const snapshot = await broker.snapshot();
    assert.match(snapshot.data, new RegExp(marker));
    assert.match(snapshot.data, new RegExp(`${cachePrefix}_040`));
    const captured = await run([
      "capture-pane", "-p", "-S", "-216", "-t", `=${session}:`,
    ]);
    assert.match(captured.stdout, new RegExp(`${cachePrefix}_001`));
    assert.match(captured.stdout, new RegExp(`${cachePrefix}_040`));
    assert.doesNotMatch(captured.stdout, /0;276;0c/);
    assert.ok(snapshot.seq > 0);
    assert.ok(broker.stats().terminalResponses > 0);
    broker.close();
    await run(["has-session", "-t", `=${session}`]);
  } finally {
    broker.close();
    await run(["kill-session", "-t", `=${session}`]).catch(() => {});
  }
});
