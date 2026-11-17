import test from "node:test";
import assert from "node:assert/strict";
import { connectionFailure } from "../src/connection-health.js";

test("handshake has a deadline independent of socket close events", () => {
  assert.equal(connectionFailure({ now: 30001, startedAt: 1, ready: false }), null);
  assert.match(connectionFailure({ now: 30002, startedAt: 1, ready: false }), /握手/);
});

test("HTTP success or ongoing output cannot mask missing websocket pongs", () => {
  assert.equal(connectionFailure({ now: 60001, startedAt: 1, ready: true }), null);
  assert.match(connectionFailure({ now: 60002, startedAt: 1, ready: true }), /心跳/);
  assert.equal(connectionFailure({ now: 61000, startedAt: 1, ready: true, pongAt: 60000 }), null);
});

test("pending subscriptions expire, rendered and inactive sessions do not", () => {
  const status = { now: 62000, startedAt: 1, ready: true, pongAt: 61000 };
  const view = { serverActive: true, inputReady: false, subscriptionStartedAt: 1000 };
  assert.match(connectionFailure({ ...status, subscriptions: [view] }), /首屏/);
  assert.equal(connectionFailure({ ...status, subscriptions: [{ ...view, inputReady: true }] }), null);
  assert.equal(connectionFailure({ ...status, subscriptions: [{ ...view, serverActive: false }] }), null);
});

test("transport pong alone does not prove the terminal is operable", () => {
  const status = { now: 62000, startedAt: 1, ready: true, pongAt: 61000 };
  const view = { serverActive: true, inputReady: true, sessionCheckStartedAt: 1000 };
  assert.match(connectionFailure({ ...status, subscriptions: [view] }), /可操作性/);
  assert.equal(connectionFailure({ ...status, subscriptions: [{ ...view, sessionPongAt: 61000 }] }), null);
});

test('temporary silence preserves both pending snapshots and established sessions', () => {
  for (const inputReady of [false, true]) {
    assert.equal(connectionFailure({ now: 45000, startedAt: 1, ready: true, pongAt: 1,
      subscriptions: [{serverActive: true, inputReady, subscriptionStartedAt: 1, sessionPongAt: 1}] }), null);
  }
});
