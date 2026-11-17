import assert from "node:assert/strict";
import { test } from "node:test";
import { HistorySnapshots } from "../history-snapshots.mjs";

test("frozen pages preserve all rows while new output, reflow and background captures replace the latest cache", () => {
  const store = new HistorySnapshots();
  const original = Array.from({ length: 1030 }, (_, i) => i % 9 ? `ROW_${i}` : "").join("\n") + "\n";
  let page = store.create("pcb", original, { paneWidth: 124, capturedAt: 1 }, 300);
  const id = page.snapshotId;
  let combined = page.content;
  while (page.nextBefore !== null) {
    store.create("pcb", original + "new output\n".repeat(40), { paneWidth: 46 }, 280);
    page = store.page("pcb", id, page.nextBefore);
    assert.equal(page.snapshotId, id);
    assert.equal(page.paneWidth, 124);
    combined = page.content + combined;
  }
  assert.equal(combined, original);
  assert.equal(store.page("other-session", id, 300), null);
});

test("evicted versions fail explicitly instead of using newer history", () => {
  const store = new HistorySnapshots({ maxBytes: 12 });
  const first = store.create("pcb", "a\nb\nc\n", {}, 2);
  store.create("pcb", "d\ne\nf\ng\n", {}, 2);
  assert.equal(store.page("pcb", first.snapshotId, 2), null);
});

test("paging preserves ANSI, repeated lines, blank rows and unterminated final row", () => {
  const store = new HistorySnapshots();
  const first = store.create("pcb", "\x1b[31mred\x1b[0m\nsame\nsame\n\nlast", {}, 2);
  let combined = first.content;
  let page = first;
  while (page.nextBefore !== null) {
    page = store.page("pcb", first.snapshotId, page.nextBefore);
    combined = page.content + combined;
  }
  assert.equal(combined, "\x1b[31mred\x1b[0m\nsame\nsame\n\nlast\n");
});
