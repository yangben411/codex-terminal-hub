import test from "node:test";
import assert from "node:assert/strict";
import { StreamAttempts } from "../stream-attempts.mjs";
test("late older handshakes and duplicates cannot replace a newer connection", () => {
  const order = new StreamAttempts();
  assert.equal(order.accept("page", 102), true);
  assert.equal(order.accept("page", 101), false);
  assert.equal(order.accept("page", 102), false);
  assert.equal(order.accept("page", 103), true);
  assert.equal(order.accept("page", 0), false);
  assert.equal(order.accept("new-owner", 1), true);
  assert.equal(order.accept("new-owner", NaN), false);
});
