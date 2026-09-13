import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function resolveDirectoryInput(input, baseDirectory) {
  if (typeof input !== "string" || input.length > 4096 || /[\u0000-\u001f]/u.test(input)) {
    throw new Error("目录路径无效");
  }
  let value = input;
  if (value === "~" || value.startsWith("~/")) value = os.homedir() + value.slice(1);
  return path.resolve(baseDirectory, value || ".");
}

export async function directorySuggestions(input, baseDirectory) {
  const resolved = resolveDirectoryInput(input, baseDirectory);
  const value = input === "~" || input.startsWith("~/") ? os.homedir() + input.slice(1) : input;
  const listingChildren = !input || input.endsWith("/");
  const parent = listingChildren ? resolved : resolveDirectoryInput(path.dirname(value), baseDirectory);
  const prefix = listingChildren ? "" : path.basename(value).toLocaleLowerCase();
  let entries;
  try { entries = await readdir(parent, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return { parent, directories: [], truncated: false };
    if (error.code === "EACCES" || error.code === "EPERM") throw new Error("没有权限读取这个目录");
    throw error;
  }
  entries = entries.filter(entry => entry.name.toLocaleLowerCase().startsWith(prefix)
    && (!entry.name.startsWith(".") || prefix.startsWith(".")))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  const directories = [];
  for (const entry of entries) {
    const fullPath = path.join(parent, entry.name);
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && await stat(fullPath).then(info => info.isDirectory(), () => false))) continue;
    directories.push({ name: entry.name, path: fullPath });
    if (directories.length > 80) break;
  }
  return { parent, directories: directories.slice(0, 80), truncated: directories.length > 80 };
}
