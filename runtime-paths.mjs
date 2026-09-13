import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

export function isExecutable(file) {
  try { accessSync(file, constants.X_OK); return statSync(file).isFile(); }
  catch { return false; }
}

export function findExecutable(command, override) {
  const name = override || command;
  if (name.includes(path.sep)) return path.resolve(name);
  const directories = [...new Set([
    ...(process.env.PATH || "").split(path.delimiter).filter(Boolean),
    path.dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
  ])];
  return directories.map(dir => path.join(dir, name)).find(isExecutable) || name;
}

export const tmuxPath = findExecutable("tmux", process.env.TMUX_PATH);
export const codexPath = findExecutable("codex", process.env.CODEX_PATH);
const socketName = process.env.CODEX_TERMINAL_TMUX_SOCKET;
if (socketName && !/^[A-Za-z0-9_-]{1,80}$/.test(socketName)) {
  throw new Error("CODEX_TERMINAL_TMUX_SOCKET must contain 1-80 letters, numbers, underscores or dashes");
}
export const tmuxArgs = socketName ? ["-L", socketName] : [];

export function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
