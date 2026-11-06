import { test } from "node:test";
import assert from "node:assert/strict";
import { HistorySelectionGuard, initialTextSelection } from "../src/history-selection-guard.js";

test("pointer cancellation never releases a pending native long press", () => {
  const guard = new HistorySelectionGuard();
  guard.start(10, 10, 0);
  guard.cancel();
  assert.equal(guard.blocked, true);
  guard.end(900);
  assert.equal(guard.blocked, true, "no timer can unlock before a late selection appears");
  guard.start(10, 10, 1000, true);
  guard.move(10, 200, 1100, true);
  guard.end(1200, true);
  assert.equal(guard.blocked, true, "dragging a selection handle remains protected");
  guard.start(10, 10, 1500, false);
  guard.move(10, 70, 1530);
  guard.end(1600);
  assert.equal(guard.blocked, false, "a new unselected swipe resumes paging");
});

test("native scroll handoff waits for physical release but does not lock pagination", () => {
  const guard = new HistorySelectionGuard();
  guard.start(0, 0, 0);
  guard.cancel();
  guard.move(0, 50, 40);
  assert.equal(guard.blocked, true);
  guard.end(800);
  assert.equal(guard.blocked, false);
  guard.end(900); // duplicate touchend after pointerup
  assert.equal(guard.blocked, false);
});

test("stationary long press stays protected; a new tap without selection releases", () => {
  const guard = new HistorySelectionGuard();
  guard.start(0, 0, 0);
  guard.end(600);
  assert.equal(guard.blocked, true);
  guard.start(0, 0, 700);
  guard.end(750);
  assert.equal(guard.blocked, false);
});

test("system selection starts at visible text instead of whitespace or a newline", () => {
  const text = "\n   \n  中文 command\n";
  const range = initialTextSelection(text, 0);
  assert.equal(text.slice(range.start, range.end), "中文");
  assert.equal(range.row, 2);
  assert.deepEqual(initialTextSelection("\n  \n", 1), { start: 0, end: 0, row: 0 });
  const last = initialTextSelection(text, 3);
  assert.equal(text.slice(last.start, last.end), "中文");
});
