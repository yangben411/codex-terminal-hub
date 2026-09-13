import assert from "node:assert/strict";
import { test } from "node:test";
import { GestureClipboard } from "../src/gesture-clipboard.js";

class Item {
  constructor(data) { this.data = data; }
}

test("clipboard write starts in the release gesture and receives tmux text later", async () => {
  let inGesture = true;
  const writes = [];
  const bridge = new GestureClipboard({ Item, clipboard: {
    write(items) {
      assert.ok(inGesture, "write must start before the network round trip");
      return items[0].data["text/plain"].then(async blob => writes.push(await blob.text()));
    },
  } });
  bridge.begin("session-a");
  inGesture = false;
  assert.deepEqual(writes, []);
  assert.equal(await bridge.write("session-a", "圈选文字\n  second line"), true);
  assert.deepEqual(writes, ["圈选文字\n  second line"]);
});

test("cancelled or superseded selections do not clear the clipboard or mix sessions", async () => {
  const writes = [];
  const bridge = new GestureClipboard({ Item, clipboard: {
    write(items) { return items[0].data["text/plain"].then(async blob => writes.push(await blob.text())); },
  } });
  bridge.begin("session-a");
  bridge.begin("session-b");
  assert.equal(await bridge.write("session-a", "stale selection"), false);
  assert.equal(await bridge.write("session-b", "current selection"), true);
  bridge.begin("session-c");
  bridge.cancel();
  await Promise.resolve();
  assert.deepEqual(writes, ["current selection"]);
});

test("browser denial reports failure without asking for another click", async () => {
  const bridge = new GestureClipboard({ Item, clipboard: {
    write() { return Promise.reject(new Error("NotAllowedError")); },
  } });
  bridge.begin("session-a");
  assert.equal(await bridge.write("session-a", "selected"), false);
  const unsupported = new GestureClipboard({ clipboard: {}, Item: null });
  assert.equal(await unsupported.write("session-a", "selected"), false);
});
