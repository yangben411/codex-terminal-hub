import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { historyCaptureRange } from "../history-range.mjs";
import { tmuxPath as tmux } from "../runtime-paths.mjs";

const execFileAsync = promisify(execFile);

test("history paging preserves the visible screen, blank rows and the oldest single row", { timeout: 10000 }, async (t) => {
  try { await execFileAsync(tmux, ["-V"]); }
  catch { t.skip("tmux is not installed"); return; }
  const socket = `history_range_test_${process.pid}_${Date.now()}`;
  const run = async (...args) => (await execFileAsync(tmux, ["-L", socket, "-f", "/dev/null", ...args])).stdout;
  t.after(async () => { await run("kill-server").catch(() => {}); });

  for (const count of [0, 3, 85]) {
    const name = `rows_${count}`;
    const output = Array.from({ length: count }, (_, i) => `ROW_${String(i).padStart(3, "0")}`).join("\n");
    // All text is generated here. The trailing blank row must survive capture.
    const command = count ? `printf '%s\\n' '${output}'; exec /bin/cat` : "exec /bin/cat";
    await run("new-session", "-d", "-s", name, "-x", "80", "-y", "7", command);
    const target = `=${name}:`;
    const fullCapture = () => run("capture-pane", "-p", "-S", "-", "-E", "-", "-t", target);
    let full = await fullCapture();
    const deadline = Date.now() + 2000;
    while (count && !full.includes(`ROW_${String(count - 1).padStart(3, "0")}`) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
      full = await fullCapture();
    }
    if (count) assert.ok(full.includes(`ROW_${String(count - 1).padStart(3, "0")}`));
    const [historySize, paneHeight] = (await run("display-message", "-p", "-t", target, "#{history_size},#{pane_height}")).trim().split(",").map(Number);
    const visible = await run("capture-pane", "-p", "-S", "0", "-E", String(paneHeight - 1), "-t", target);
    let before = 0;
    let combined = "";
    let lastPage;
    do {
      const range = historyCaptureRange({ historySize, paneHeight, pageLines: 17, before });
      const page = await run("capture-pane", "-p", "-S", String(range.start), "-E", String(range.end), "-t", target);
      assert.equal(page.split("\n").length - 1, range.lines);
      if (before === 0) assert.ok(page.endsWith(visible), "first cache page includes the entire visible screen");
      combined = page + combined;
      before = range.nextBefore;
      lastPage = range;
    } while (before !== null);
    assert.equal(combined, full, "all pages exactly match tmux's complete capture without missing or duplicate rows");
    if (count === 85) assert.equal(lastPage.lines, 1, "oldest single row is retained");
    assert.equal(historyCaptureRange({ historySize, paneHeight, pageLines: 17, before: historySize + paneHeight }).lines, 0);
  }
});
