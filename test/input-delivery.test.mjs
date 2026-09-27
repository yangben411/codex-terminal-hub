import assert from "node:assert/strict";
import test from "node:test";
import { InputDelivery } from "../src/input-delivery.js";

function setup(sendResult = true) {
  const sent = [], changes = [], success = [], failures = [], timers = new Map();
  let id = 0;
  const delivery = new InputDelivery({
    send: data => { sent.push(data); return sendResult; },
    onChange: job => changes.push(job?.phase || "idle"),
    onSuccess: job => success.push(job), onFailure: job => failures.push(job),
    createId: () => `input-${++id}`,
    setTimer: fn => { const key = Symbol(); timers.set(key, fn); return key; },
    clearTimer: key => timers.delete(key),
  });
  return { delivery, sent, changes, success, failures, expire: () => [...timers.values()].forEach(fn => fn()) };
}

test("one submission stays locked through reconnect and delayed acknowledgement", () => {
  const f = setup();
  assert.equal(f.delivery.submit("你好", "s1"), true);
  assert.equal(f.delivery.submit("你好", "s1"), false);
  f.delivery.flush("s1", false);
  assert.equal(f.sent.length, 0);
  f.delivery.flush("s1", true);
  f.delivery.flush("s1", true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].data, "你好\r");
  assert.equal(f.delivery.ack("input-1", "s2"), false);
  assert.ok(f.delivery.job);
  assert.equal(f.delivery.ack("input-1", "s1"), true);
  assert.equal(f.delivery.job, null);
  assert.equal(f.success.length, 1);
  f.expire();
  assert.equal(f.failures.length, 0);
});

test("connection timeout cancels queued input so later snapshots cannot send it", () => {
  const f = setup();
  f.delivery.submit("queued", "s1");
  f.expire();
  f.delivery.flush("s1", true);
  assert.equal(f.sent.length, 0);
  assert.equal(f.delivery.job, null);
  assert.equal(f.failures.length, 1);
});

test("ACK timeout never resends and a late ACK cannot clear a newer submission", () => {
  const f = setup();
  f.delivery.submit("first", "s1");
  f.delivery.flush("s1", true);
  f.expire();
  f.delivery.flush("s1", true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.failures[0].phase, "sent");
  f.delivery.submit("second", "s1");
  assert.equal(f.delivery.ack("input-1", "s1"), false);
  assert.equal(f.delivery.job.text, "second");
});

test("transport refusal stays locked, explicit failure permanently cancels it", () => {
  const f = setup(false);
  f.delivery.submit("text", "s1");
  f.delivery.flush("s1", true);
  assert.equal(f.delivery.job.phase, "queued");
  assert.equal(f.delivery.submit("text", "s1"), false);
  f.delivery.fail();
  f.delivery.flush("s1", true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.delivery.job, null);
});
