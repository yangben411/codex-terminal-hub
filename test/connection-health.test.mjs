import test from "node:test";
import assert from "node:assert/strict";
import { connectionFailure } from "../src/connection-health.js";

test("handshake has a deadline independent of socket close events", () => {
  assert.equal(connectionFailure({ now: 12000, startedAt: 1, ready: false }), null);
  assert.match(connectionFailure({ now: 12002, startedAt: 1, ready: false }), /握手/);
});

test("HTTP success or ongoing output cannot mask missing websocket pongs", () => {
  assert.equal(connectionFailure({ now: 15000, startedAt: 1, ready: true }), null);
  assert.match(connectionFailure({ now: 16000, startedAt: 1, ready: true }), /心跳/);
  assert.equal(connectionFailure({ now: 16000, startedAt: 1, ready: true, pongAt: 15000 }), null);
});

test("pending subscriptions expire, rendered and inactive sessions do not", () => {
  const status = { now: 20000, startedAt: 1, ready: true, pongAt: 19000 };
  const view = { serverActive: true, inputReady: false, subscriptionStartedAt: 1000 };
  assert.match(connectionFailure({ ...status, subscriptions: [view] }), /首屏/);
  assert.equal(connectionFailure({ ...status, subscriptions: [{ ...view, inputReady: true }] }), null);
  assert.equal(connectionFailure({ ...status, subscriptions: [{ ...view, serverActive: false }] }), null);
});

test("transport pong alone does not prove the terminal is operable", () => {
  const status = { now: 20000, startedAt: 1, ready: true, pongAt: 19000 };
  const view = { serverActive: true, inputReady: true, sessionCheckStartedAt: 1000 };
  assert.match(connectionFailure({ ...status, subscriptions: [view] }), /可操作性/);
  assert.equal(connectionFailure({ ...status, subscriptions: [{ ...view, sessionPongAt: 19000 }] }), null);
});
