import test from "node:test";
import assert from "node:assert/strict";
import { pageIdentity } from "../src/page-identity.js";
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};
test("installed app keeps identity after its page session has been destroyed", () => {
  const local = storage();
  const previous = "existing_page_123456";
  assert.equal(pageIdentity({ standalone: true, local, session: storage(), previous, createId: () => "new_page_123456789" }), previous);
  assert.equal(pageIdentity({ standalone: true, local, session: storage(), createId: () => "new_page_123456789" }), previous);
});
test("ordinary tabs never inherit the installed app identity", () => {
  const local = storage();
  pageIdentity({ standalone: true, local, session: storage(), createId: () => "installed_123456789" });
  assert.equal(pageIdentity({ standalone: false, local, session: storage(), createId: () => "ordinary_1234567890" }), "ordinary_1234567890");
});
test("unavailable storage still yields a usable identity", () => {
  const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(pageIdentity({ standalone: true, local: unavailable, session: unavailable, createId: () => "fallback_1234567890" }), "fallback_1234567890");
});
