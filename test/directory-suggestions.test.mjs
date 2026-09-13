import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { directorySuggestions, resolveDirectoryInput } from "../directory-suggestions.mjs";

test("directory completion filters prefixes, drills down and excludes regular files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "terminal-directory-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ["Alpha", "alpine", "中文 项目", ".hidden", "Alpha/child"]) await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, "also-file.txt"), "test");
  await symlink(path.join(root, "Alpha"), path.join(root, "alias"));
  const names = result => result.directories.map(item => item.name).sort();
  assert.deepEqual(names(await directorySuggestions("", root)), ["Alpha", "alias", "alpine", "中文 项目"].sort());
  assert.deepEqual(names(await directorySuggestions("AL", root)), ["Alpha", "alias", "alpine"].sort());
  assert.deepEqual(names(await directorySuggestions(path.join(root, "Alpha") + "/", root)), ["child"]);
  assert.deepEqual(names(await directorySuggestions("中", root)), ["中文 项目"]);
  assert.deepEqual(names(await directorySuggestions(".", root)), [".hidden"]);
  assert.deepEqual(names(await directorySuggestions(path.join(root, ".h"), root)), [".hidden"]);
  assert.deepEqual(names(await directorySuggestions("missing/child", root)), []);
  assert.equal(resolveDirectoryInput("Alpha", root), path.join(root, "Alpha"));
  assert.equal(resolveDirectoryInput("~/work", root), path.join(os.homedir(), "work"));
  await assert.rejects(directorySuggestions("bad\u0000path", root), /无效/);
});
