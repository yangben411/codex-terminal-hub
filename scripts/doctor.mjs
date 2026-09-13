import { access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmuxPath, codexPath, isExecutable } from "../runtime-paths.mjs";

let failed = false;
function check(label, ok, detail, optional = false) {
  console.log(`${ok ? "OK" : optional ? "OPTIONAL" : "FAIL"} ${label}: ${detail}`);
  if (!ok && !optional) failed = true;
}
const [major, minor] = process.versions.node.split(".").map(Number);
check("Node", major > 22 || (major === 22 && minor >= 9), process.versions.node);
check("Host OS", ["darwin", "linux"].includes(process.platform), process.platform);
check("tmux", isExecutable(tmuxPath), tmuxPath);
if (isExecutable(tmuxPath)) console.log(execFileSync(tmuxPath, ["-V"], { encoding: "utf8" }).trim());
check("Codex CLI (Shell mode works without it)", isExecutable(codexPath), codexPath, true);
const built = await access(fileURLToPath(new URL("../public/terminal.js", import.meta.url))).then(() => true, () => false);
check("Browser bundle", built, built ? "built" : "run npm run build");
const host = process.env.CODEX_TERMINAL_HOST || "127.0.0.1";
check("Loopback listener", ["127.0.0.1", "::1", "localhost"].includes(host), host);
console.log("Remote access: tailscale serve --bg http://127.0.0.1:7681");
process.exitCode = failed ? 1 : 0;
