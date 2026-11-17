import test from "node:test";
import assert from "node:assert/strict";
import { submitComposer } from "../composer-submit.mjs";

test("composer writes text then exactly one separate Enter", async () => {
  for (const data of ["中文，标点！\r", "hello", "first\nsecond\r"]) {
    const events = [];
    await submitComposer(value => events.push(value), data, async ms => events.push(ms));
    assert.deepEqual(events, [data.endsWith("\r") ? data.slice(0, -1) : data, 100, "\r"]);
  }
});
test("a failed text write is not retried and does not send Enter", async () => {
  let calls = 0;
  await assert.rejects(submitComposer(() => { calls++; throw new Error("closed"); }, "text\r"), /closed/);
  assert.equal(calls, 1);
});
