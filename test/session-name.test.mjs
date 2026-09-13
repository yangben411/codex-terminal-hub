import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionNames } from "../session-name.mjs";

test("Chinese session titles become ASCII identifiers and keep their display labels", () => {
  assert.deepEqual(createSessionNames("服务器维护"), { name: "fu-wu-qi-wei-hu", displayName: "服务器维护" });
  assert.deepEqual(createSessionNames("project_ABC-1"), { name: "project_ABC-1", displayName: "" });
  const mixed = createSessionNames("API 接口测试");
  assert.match(mixed.name, /^api-jie-kou-ce-shi$/);
  assert.equal(mixed.displayName, "API 接口测试");
});

test("generated names avoid collisions, stay within tmux limits, and reject empty input", () => {
  assert.equal(createSessionNames("服务器维护", new Set(["fu-wu-qi-wei-hu", "fu-wu-qi-wei-hu-2"])).name, "fu-wu-qi-wei-hu-3");
  const long = "项目".repeat(32);
  const first = createSessionNames(long);
  const second = createSessionNames(long, new Set([first.name]));
  for (const value of [first, second, createSessionNames("🎉"), createSessionNames("---项目 / 测试---")]) {
    assert.match(value.name, /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/);
  }
  assert.notEqual(first.name, second.name);
  assert.throws(() => createSessionNames("   "));
  assert.throws(() => createSessionNames("a\nb"));
  assert.throws(() => createSessionNames("a".repeat(65)));
});
